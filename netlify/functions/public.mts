import type { Config, Context } from "@netlify/functions";
import { chatAnswer, type ChatTurn } from "../lib/ai.mts";
import {
  SlotTakenError, availableSlots, brandOf, checkPassword, clean, createLead, fail, formatSlot, getCenter, issueToken,
  json, logoUrl, logosStore, newId, normalizePhone, questionsStore, type Question,
} from "../lib/core.mts";
import { notifyLead, notifyQuestion } from "../lib/notify.mts";

/** Фоновая работа после ответа клиенту (уведомления), если платформа это поддерживает. */
const later = (context: Context, p: Promise<unknown>) => {
  const safe = p.catch((e) => console.error("background task failed:", e?.message ?? e));
  if (typeof context.waitUntil === "function") context.waitUntil(safe);
  else return safe;
};

async function body(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

// GET /api/public/:center — всё, что нужно чату: курсы, адрес и свободные слоты
async function publicInfo(slug: string) {
  const center = await getCenter(slug);
  if (!center) return fail("Центр не найден", 404);
  const s = center.settings;
  const slots = await availableSlots(center);
  const brand = brandOf(s);
  return json({
    slug: center.slug,
    name: s.name,
    brand: { color: brand.color, header: brand.header, pattern: brand.pattern, logo: logoUrl(center.slug, brand) },
    faq: s.faq.slice(0, 12),
    city: s.city,
    address: s.address,
    hours: s.hours,
    phone: s.phone,
    trial: s.trial,
    studentTypes: s.studentTypes,
    courses: s.courses,
    slots: slots.map((iso) => ({ iso, label: formatSlot(iso) })),
  });
}

// GET /api/public/:center/logo — логотип, загруженный в кабинете
async function logo(slug: string) {
  const got = await logosStore().getWithMetadata(slug, { type: "arrayBuffer" });
  if (!got) return new Response("not found", { status: 404 });
  const type = String(got.metadata?.type || "image/png");
  return new Response(got.data, {
    headers: {
      "content-type": /^image\/(png|jpeg|webp)$/.test(type) ? type : "application/octet-stream",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
}

// POST /api/chat — свободный вопрос клиента
async function chat(req: Request, context: Context) {
  const b = await body(req);
  const center = await getCenter(clean(b.center, 40));
  if (!center) return fail("Центр не найден", 404);

  const raw: unknown[] = Array.isArray(b.history) ? b.history.slice(-10) : [];
  const history: ChatTurn[] = [];
  for (const t of raw as any[]) {
    const role = t?.role === "assistant" ? "assistant" : "user";
    const content = clean(t?.content, 1000);
    if (!content) continue;
    if (history.length && history.at(-1)!.role === role) history.at(-1)!.content += "\n" + content;
    else history.push({ role, content });
  }
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history.at(-1)!.role !== "user") return fail("Пустой вопрос");

  const result = await chatAnswer(history, center.settings);
  const q: Question = {
    id: newId(),
    createdAt: new Date().toISOString(),
    text: history.at(-1)!.content,
    answer: result.answer,
    escalated: result.escalate,
    resolved: !result.escalate,
    session: clean(b.session, 40) || undefined,
    via: result.via,
    model: result.model,
    channel: "web",
  };
  await questionsStore().setJSON(`${center.slug}/${q.id}`, q);
  if (q.escalated) await later(context, notifyQuestion(center, q));
  return json({ answer: result.answer, escalate: result.escalate, book: result.book });
}

// POST /api/book — запись на пробный урок или просьба перезвонить
async function book(req: Request, context: Context) {
  const b = await body(req);
  const center = await getCenter(clean(b.center, 40));
  if (!center) return fail("Центр не найден", 404);
  if (b.consent !== true) return fail("Нужно согласие на обработку данных");

  const name = clean(b.name, 80);
  const phone = normalizePhone(clean(b.phone, 30));
  if (name.length < 2) return fail("Укажите имя");
  if (!phone) return fail("Проверьте номер телефона");

  const type = b.type === "callback" ? "callback" : "trial";
  const slot = type === "trial" && b.slot ? clean(b.slot, 40) : null;
  try {
    const lead = await createLead(center, {
      type,
      source: clean(b.source, 40) || "чат на сайте",
      channel: "web",
      name,
      phone,
      student: clean(b.student, 80),
      course: clean(b.course, 120),
      slot,
      wish: clean(b.wish, 300),
      question: clean(b.question, 1000),
    });
    await later(context, notifyLead(center, lead));
    return json({ ok: true, id: lead.id, slotLabel: slot ? formatSlot(slot) : null, address: center.settings.address });
  } catch (e) {
    if (e instanceof SlotTakenError) return fail("Это время уже заняли, выберите другое", 409);
    throw e;
  }
}

// POST /api/login — вход в кабинет центра
async function login(req: Request) {
  const b = await body(req);
  const slug = clean(b.center, 40).toLowerCase();
  const center = await getCenter(slug);
  const ok = !!center && checkPassword(String(b.password ?? ""), center.passwordHash);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    return fail("Неверный код центра или пароль", 401);
  }
  return json({ token: await issueToken(center!.slug), center: center!.slug, name: center!.settings.name });
}

// Чат-виджет работает прямо на сайте центра (не в iframe), поэтому публичные запросы разрешены с любых сайтов.
// Вход в кабинет (/api/login) — только со своего сайта.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

async function route(req: Request, context: Context): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && context.params.center && path.endsWith("/logo")) return await logo(context.params.center);
  if (req.method === "GET" && context.params.center) return await publicInfo(context.params.center);
  if (req.method === "POST" && path === "/api/chat") return await chat(req, context);
  if (req.method === "POST" && path === "/api/book") return await book(req, context);
  if (req.method === "POST" && path === "/api/login") return await login(req);
  return fail("Не найдено", 404);
}

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname;
  const cors = path !== "/api/login";
  if (req.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 405, headers: cors ? CORS : {} });
  let res: Response;
  try {
    res = await route(req, context);
  } catch (e) {
    console.error(e);
    res = fail("Ошибка сервера, попробуйте ещё раз", 500);
  }
  if (cors) for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
};

export const config: Config = {
  path: ["/api/public/:center", "/api/public/:center/logo", "/api/chat", "/api/book", "/api/login"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
