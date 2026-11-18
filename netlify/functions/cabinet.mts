import type { Config } from "@netlify/functions";
import {
  HOLDS_SLOT, LEAD_STATUSES, applyStatus, clean, leadsStore, releaseSlot, fail, formatLocal, formatSlot, getCenter, getLead, hashPassword, json,
  brandOf, followUpOf, issueToken, listLeads, listQuestions, logoUrl, logosStore, questionsStore, readTokenInfo, saveCenter, saveLead,
  type Center, type LeadStatus, type Question,
} from "../lib/core.mts";
import { cleanEvents, deleteSub, getSub, listSubs, pushConfigured, pushStore, saveSub, sendOne, subView, vapidPublicKey } from "../lib/push.mts";
import { botUsername, createLinkCode, tgConfigured, unlinkChat } from "../lib/telegram.mts";

/** Что видно центру о подключённых каналах (без секретов). */
async function integrations(center: Center) {
  const wa = center.whatsapp;
  return {
    telegram: {
      configured: tgConfigured(),
      chats: (center.telegram?.chats ?? []).map((c) => ({ id: c.id, name: c.name, linkedAt: c.linkedAt })),
    },
    whatsapp: wa?.enabled && wa.phoneNumberId ? { enabled: true, displayPhone: wa.displayPhone } : { enabled: false },
    push: {
      configured: pushConfigured(),
      publicKey: pushConfigured() ? vapidPublicKey() : "",
      devices: (await listSubs(center.slug)).map(subView),
    },
  };
}
import { DEFAULT_BRAND, DEFAULT_FOLLOWUP, type Brand, type FollowUp, type Settings } from "../lib/seed.mts";

/** Оформление: цвет, шапка, узор. Логотип меняется только через /api/cabinet/logo. */
function sanitizeBrand(raw: any, prev: Brand | undefined): Brand {
  const base = { ...DEFAULT_BRAND, ...(prev ?? {}) };
  const color = typeof raw?.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toUpperCase() : base.color;
  const header = raw?.header === "brand" || raw?.header === "light" ? raw.header : base.header;
  const pattern = raw?.pattern === "uk" || raw?.pattern === "none" ? raw.pattern : base.pattern;
  return { color, header, pattern, logo: base.logo };
}

/** Дожим: пустой текст — вернуть стандартный. */
function sanitizeFollowUp(raw: any, prev: FollowUp | undefined): FollowUp {
  const base = { ...DEFAULT_FOLLOWUP, ...(prev ?? {}) };
  if (!raw || typeof raw !== "object") return base;
  const text = (v: unknown, def: string) => (typeof v === "string" ? clean(v, 600) || def : def);
  return {
    auto: typeof raw.auto === "boolean" ? raw.auto : base.auto,
    came: text(raw.came, DEFAULT_FOLLOWUP.came),
    noshow: text(raw.noshow, DEFAULT_FOLLOWUP.noshow),
  };
}

const LOGO_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function sanitizeSettings(raw: any, prev: Settings): Settings {
  const str = (v: unknown, max = 200) => clean(v, max);
  const list = <T,>(v: unknown, max: number, map: (x: any) => T | null): T[] =>
    (Array.isArray(v) ? v : []).slice(0, max).map(map).filter((x): x is T => x !== null);

  const slots: Record<string, string[]> = {};
  for (const d of DAYS) {
    slots[d] = list(raw?.slots?.[d], 12, (t) => {
      const m = String(t).trim().match(/^(\d{1,2})[:.](\d{2})$/);
      if (!m || +m[1] > 23 || +m[2] > 59) return null;
      return `${m[1].padStart(2, "0")}:${m[2]}`;
    });
    slots[d] = [...new Set(slots[d])].sort();
  }
  const cap = Number(raw?.trial?.capacityPerSlot);
  const dur = Number(raw?.trial?.durationMin);
  const off = Number(raw?.utcOffset);

  return {
    name: str(raw?.name, 80) || prev.name,
    city: str(raw?.city, 60),
    address: str(raw?.address, 200),
    hours: str(raw?.hours, 200),
    phone: str(raw?.phone, 40),
    utcOffset: Number.isFinite(off) && off >= -12 && off <= 14 ? off : prev.utcOffset,
    trial: {
      durationMin: Number.isFinite(dur) && dur >= 10 && dur <= 240 ? Math.round(dur) : prev.trial.durationMin,
      price: str(raw?.trial?.price, 60) || "бесплатно",
      capacityPerSlot: Number.isFinite(cap) && cap >= 1 && cap <= 50 ? Math.round(cap) : prev.trial.capacityPerSlot,
      whatHappens: str(raw?.trial?.whatHappens, 300),
    },
    slots,
    studentTypes: list(raw?.studentTypes, 10, (x) => str(x, 60) || null),
    courses: list(raw?.courses, 30, (c) => {
      const name = str(c?.name, 100);
      return name ? { name, for: str(c?.for, 100), format: str(c?.format, 200), price: str(c?.price, 80) } : null;
    }),
    faq: list(raw?.faq, 50, (f) => {
      const q = str(f?.q, 200);
      const a = str(f?.a, 600);
      return q && a ? { q, a } : null;
    }),
    brand: sanitizeBrand(raw?.brand, prev.brand),
    followUp: sanitizeFollowUp(raw?.followUp, prev.followUp),
  };
}

function csv(rows: (string | undefined | null)[][]): string {
  const cell = (v: string | undefined | null) => {
    const s = (v ?? "").replace(/"/g, '""');
    return /[";\n,]/.test(s) ? `"${s}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export default async (req: Request) => {
  try {
    const auth = await readTokenInfo(req);
    if (!auth) return fail("Войдите в кабинет заново", 401);
    const slug = auth.center;
    const center = await getCenter(slug);
    if (!center) return fail("Центр не найден", 404);

    const parts = new URL(req.url).pathname.replace(/^\/api\/cabinet\/?/, "").split("/").filter(Boolean);
    const [section, id] = parts;

    if (req.method === "GET" && section === "me") {
      // Вход живёт 30 дней и продлевается сам, пока кабинетом пользуются (важно для установленного приложения).
      const token = auth.exp - Date.now() < 20 * 864e5 ? await issueToken(slug) : undefined;
      const brand = brandOf(center.settings);
      return json({ slug: center.slug, settings: { ...center.settings, brand, followUp: followUpOf(center.settings) }, logoUrl: logoUrl(slug, brand), statuses: LEAD_STATUSES, integrations: await integrations(center), token });
    }

    if (section === "logo") {
      // Браузер присылает уже уменьшенную картинку (до 512×512) в виде data:URL. SVG не принимаем: в нём бывают скрипты.
      if (req.method === "POST") {
        const b = await readBody(req);
        const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b?.data ?? ""));
        if (!m) return fail("Нужна картинка PNG, JPG или WebP", 400);
        const buf = Buffer.from(m[2], "base64");
        if (buf.length > 400_000) return fail("Картинка слишком большая — до 400 КБ", 400);
        if (!LOGO_TYPES[m[1]](buf)) return fail("Файл не похож на картинку", 400);
        const v = Date.now().toString(36);
        await logosStore().set(slug, new Uint8Array(buf).buffer, { metadata: { type: m[1], v } });
        center.settings.brand = { ...brandOf(center.settings), logo: `upload:${v}` };
        await saveCenter(center);
        return json({ brand: center.settings.brand, logoUrl: logoUrl(slug, center.settings.brand) });
      }
      if (req.method === "DELETE") {
        await logosStore().delete(slug);
        center.settings.brand = { ...brandOf(center.settings), logo: "" };
        await saveCenter(center);
        return json({ brand: center.settings.brand, logoUrl: "" });
      }
    }

    if (section === "push") {
      const devices = async () => ({ devices: (await listSubs(slug)).map(subView) });
      if (req.method === "GET") return json({ configured: pushConfigured(), publicKey: pushConfigured() ? vapidPublicKey() : "", ...(await devices()) });
      if (req.method === "POST" && !id) {
        if (!pushConfigured()) return fail("Уведомления в приложении ещё не настроены на сервере. Напишите в поддержку.", 503);
        const body = await readBody(req);
        if ((await listSubs(slug)).length >= 20) return fail("Слишком много устройств. Отключите старые.", 400);
        const sub = await saveSub(slug, body?.subscription, clean(body?.device, 60), body?.events);
        if (!sub) return fail("Браузер прислал неподходящую подписку", 400);
        return json({ id: sub.id, ...(await devices()) });
      }
      const sub = id ? await getSub(slug, id) : null;
      if (id && !sub) return fail("Устройство не найдено", 404);
      if (req.method === "PATCH" && sub) {
        const body = await readBody(req);
        await pushStore().setJSON(`${slug}/${sub.id}`, { ...sub, events: cleanEvents(body?.events, sub.events) });
        return json(await devices());
      }
      if (req.method === "DELETE" && sub) {
        await deleteSub(slug, sub.id);
        return json(await devices());
      }
      if (req.method === "POST" && sub && parts[2] === "test") {
        const status = await sendOne(slug, sub, {
          title: "Уведомления работают",
          body: `Сюда будут приходить новые заявки ${center.settings.name}.`,
          url: "/cabinet/#leads",
          tag: "test",
        });
        if (status >= 200 && status < 300) return json({ ok: true });
        return fail(status === 404 || status === 410 ? "Устройство отписалось — включите уведомления заново" : `Push-сервис ответил ${status || "ошибкой сети"}`, 502);
      }
    }

    if (section === "telegram") {
      if (req.method === "POST") {
        if (!tgConfigured()) return fail("Telegram-бот сервиса ещё не настроен. Напишите в поддержку.", 503);
        const code = await createLinkCode(slug);
        return json({ url: `https://t.me/${await botUsername()}?start=${code}` });
      }
      if (req.method === "DELETE" && id) {
        await unlinkChat(Number(id), slug);
        const fresh = await getCenter(slug);
        return json(await integrations(fresh ?? center));
      }
      if (req.method === "GET") return json(await integrations(center));
    }

    if (req.method === "GET" && section === "leads") return json({ leads: await listLeads(slug) });

    if (req.method === "PATCH" && section === "leads" && id) {
      const lead = await getLead(slug, id);
      if (!lead) return fail("Заявка не найдена", 404);
      const b = await readBody(req);
      if (typeof b.comment === "string") lead.comment = clean(b.comment, 1000);
      if (typeof b.status === "string" && b.status !== lead.status) {
        const next = b.status as LeadStatus;
        if (!LEAD_STATUSES.includes(next)) return fail("Неизвестный статус");
        await applyStatus(lead, next);
      }
      // администратор написал клиенту (дожим) из кабинета
      if (b.followUp === true) lead.followUp = { at: new Date().toISOString(), by: "manual", status: lead.status };
      await saveLead(lead);
      return json({ lead });
    }

    if (req.method === "DELETE" && section === "leads" && id) {
      // удаление по запросу клиента (отзыв согласия)
      const lead = await getLead(slug, id);
      if (!lead) return fail("Заявка не найдена", 404);
      if (HOLDS_SLOT.includes(lead.status)) await releaseSlot(lead);
      await leadsStore().delete(`${slug}/${lead.id}`);
      return json({ ok: true });
    }

    if (req.method === "DELETE" && section === "questions" && id) {
      if (!/^[a-z0-9]{9,20}$/.test(id)) return fail("Вопрос не найден", 404);
      await questionsStore().delete(`${slug}/${id}`);
      return json({ ok: true });
    }

    if (req.method === "GET" && section === "questions") return json({ questions: await listQuestions(slug) });

    if (req.method === "PATCH" && section === "questions" && id) {
      if (!/^[a-z0-9]{9,20}$/.test(id)) return fail("Вопрос не найден", 404);
      const key = `${slug}/${id}`;
      const q = (await questionsStore().get(key, { type: "json" })) as Question | null;
      if (!q) return fail("Вопрос не найден", 404);
      const b = await readBody(req);
      q.resolved = b.resolved !== false;
      await questionsStore().setJSON(key, q);
      return json({ question: q });
    }

    if (req.method === "PUT" && section === "settings") {
      const b = await readBody(req);
      center.settings = sanitizeSettings(b.settings, center.settings);
      if (typeof b.newPassword === "string" && b.newPassword) {
        if (b.newPassword.length < 8) return fail("Пароль — минимум 8 символов");
        center.passwordHash = hashPassword(b.newPassword);
      }
      await saveCenter(center);
      return json({ settings: center.settings });
    }

    if (req.method === "GET" && section === "export") {
      const leads = await listLeads(slug);
      const rows = [
        ["Создана", "Тип", "Имя", "Телефон", "Кто учится", "Курс", "Пробный урок", "Пожелание по времени", "Вопрос", "Статус", "Комментарий", "Источник"],
        ...leads.map((l) => [
          formatLocal(l.createdAt, center.settings.utcOffset),
          l.type === "trial" ? "Пробный урок" : "Перезвонить",
          l.name, l.phone, l.student, l.course, l.slot ? formatSlot(l.slot) : "", l.wish, l.question,
          l.status, l.comment, l.source,
        ]),
      ];
      return new Response(csv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="zayavki-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    return fail("Не найдено", 404);
  } catch (e) {
    console.error(e);
    return fail("Ошибка сервера, попробуйте ещё раз", 500);
  }
};

export const config: Config = { path: "/api/cabinet/*" };
