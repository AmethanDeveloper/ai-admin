import { getStore } from "@netlify/blobs";
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_BRAND, DEFAULT_FOLLOWUP, DEMO_BRAND, DEMO_SETTINGS, DEMO_SLUG, type Brand, type FollowUp, type Settings } from "./seed.mts";

// ------------------------------------------------------------------ хранилища

const store = (name: string) => getStore({ name, consistency: "strong" });
export const centersStore = () => store("centers");
export const leadsStore = () => store("leads");
export const slotsStore = () => store("slot-index");
export const questionsStore = () => store("questions");
export const systemStore = () => store("system");
/** chatId Telegram → slug центра */
export const tgChatsStore = () => store("tg-chats");
/** одноразовые коды привязки Telegram: code → { center, exp } */
export const tgLinksStore = () => store("tg-links");
/** phone_number_id WhatsApp → slug центра */
export const waNumbersStore = () => store("wa-numbers");
/** id входящих сообщений WhatsApp, чтобы не обработать повтор от Meta дважды */
export const waSeenStore = () => store("wa-seen");
/** состояние диалога в WhatsApp: <slug>/<waId> → WaSession */
export const waSessionsStore = () => store("wa-sessions");
/** подписки на push-уведомления: <slug>/<id> → PushSub (см. lib/push.mts) */
export const pushSubsStore = () => store("push-subs");
/** логотипы центров: <slug> → картинка (png/jpeg/webp), тип и версия в metadata */
export const logosStore = () => store("logos");

export type TelegramChat = { id: number; name: string; linkedAt: string };
export type WhatsAppConfig = {
  enabled: boolean;
  phoneNumberId: string;
  displayPhone: string;
  accessToken?: string;
  appSecret?: string;
  reminderTemplate?: string;
  templateLang?: string;
};

export type Center = {
  slug: string;
  createdAt: string;
  passwordHash: string;
  settings: Settings;
  telegram?: { chats: TelegramChat[] };
  whatsapp?: WhatsAppConfig;
};

export const LEAD_STATUSES = ["новая", "записан", "подтвердил", "пришёл", "купил", "не пришёл", "отказ"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** Статусы, при которых заявка держит место в слоте пробного урока. */
export const HOLDS_SLOT: LeadStatus[] = ["записан", "подтвердил"];

export type Lead = {
  id: string;
  center: string;
  type: "trial" | "callback";
  createdAt: string;
  source: string;
  student?: string;
  course?: string;
  slot?: string | null;
  wish?: string;
  question?: string;
  name: string;
  phone: string;
  status: LeadStatus;
  comment?: string;
  consentAt: string;
  history: { at: string; status: LeadStatus }[];
  /** канал, откуда пришла заявка */
  channel?: "web" | "whatsapp";
  /** номер клиента в WhatsApp (только цифры) — для ответов и напоминаний */
  waId?: string;
  reminded24?: boolean;
  reminded2?: boolean;
  /** дожим после пробного: когда, кем и при каком статусе написали клиенту */
  followUp?: { at: string; by: "auto" | "manual"; status: LeadStatus };
};

export type Question = {
  id: string;
  createdAt: string;
  text: string;
  answer: string;
  escalated: boolean;
  resolved: boolean;
  session?: string;
  /** кто ответил: ИИ или запасной поиск по FAQ */
  via?: "ai" | "faq";
  model?: string;
  channel?: "web" | "whatsapp";
};

// ------------------------------------------------------------------ утилиты

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const fail = (message: string, status = 400) => json({ error: message }, status);

/** Сортируемый по времени id: время в base36 + случайный хвост. */
export const newId = () => Date.now().toString(36).padStart(9, "0") + randomBytes(3).toString("hex");

export const clean = (v: unknown, max = 200) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);
  if (d.length === 10) return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  if (d.length >= 10 && d.length <= 15) return "+" + d;
  return null;
}

// ------------------------------------------------------------------ пароли и токены

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return `pbkdf2$120000$${salt}$${hash}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [, iter, salt, hash] = stored.split("$");
  if (!iter || !salt || !hash) return false;
  const got = pbkdf2Sync(password, salt, Number(iter), 32, "sha256");
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

async function sessionSecret(): Promise<string> {
  const fromEnv = Netlify.env.get("SESSION_SECRET");
  if (fromEnv) return fromEnv;
  const sys = systemStore();
  const existing = await sys.get("session-secret", { type: "text" });
  if (existing) return existing;
  const fresh = randomBytes(32).toString("hex");
  await sys.set("session-secret", fresh, { onlyIfNew: true });
  return (await sys.get("session-secret", { type: "text" })) ?? fresh;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export async function issueToken(center: string, days = 30): Promise<string> {
  const payload = b64(JSON.stringify({ c: center, exp: Date.now() + days * 864e5 }));
  const sig = createHmac("sha256", await sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function readToken(req: Request): Promise<string | null> {
  return (await readTokenInfo(req))?.center ?? null;
}

/** Центр и срок действия токена — чтобы продлевать вход в установленном приложении. */
export async function readTokenInfo(req: Request): Promise<{ center: string; exp: number } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", await sessionSecret()).update(payload).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const { c, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof c === "string" && exp > Date.now() ? { center: c, exp } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ центры

export async function getCenter(slug: string): Promise<Center | null> {
  if (!SLUG_RE.test(slug)) return null;
  const found = (await centersStore().get(slug, { type: "json" })) as Center | null;
  if (found && slug === DEMO_SLUG && !found.settings.brand) {
    // демо-центр, созданный до появления оформления: новое имя и фирменный стиль
    if (found.settings.name === "BrightWay English") found.settings.name = DEMO_SETTINGS.name;
    found.settings.brand = structuredClone(DEMO_BRAND);
    await saveCenter(found);
  }
  if (found && slug === DEMO_SLUG && found.settings.brand?.logo === "/assets/bright-english-logo.svg") {
    // демо-школа сменила фирменный стиль: коралловый цвет и новый логотип
    found.settings.brand = structuredClone(DEMO_BRAND);
    await saveCenter(found);
  }
  if (found) return found;
  if (slug === DEMO_SLUG) {
    const demo: Center = {
      slug,
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(Netlify.env.get("DEMO_PASSWORD") || "demo2026"),
      settings: structuredClone(DEMO_SETTINGS),
    };
    await centersStore().setJSON(slug, demo, { onlyIfNew: true });
    return ((await centersStore().get(slug, { type: "json" })) as Center | null) ?? demo;
  }
  return null;
}

export const saveCenter = (c: Center) => centersStore().setJSON(c.slug, c);

/** Оформление центра с подстановкой значений по умолчанию. */
export const brandOf = (s: Settings): Brand => ({ ...DEFAULT_BRAND, ...(s.brand ?? {}) });

/** Адрес логотипа для чата: загруженный в кабинете или файл сервиса; "" — логотипа нет. */
export function logoUrl(slug: string, b: Brand): string {
  if (b.logo.startsWith("upload:")) return `/api/public/${slug}/logo?v=${encodeURIComponent(b.logo.slice(7))}`;
  if (/^\/assets\/[\w.-]+\.(svg|png|webp)$/.test(b.logo)) return b.logo;
  return "";
}

// ------------------------------------------------------------------ время и слоты

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Местное время центра в виде Date, у которого UTC-поля = местные значения. */
const localNow = (offset: number) => new Date(Date.now() + offset * 3600e3);

export function slotIso(y: number, m: number, d: number, hhmm: string, offset: number): string {
  const sign = offset >= 0 ? "+" : "-";
  const off = Math.abs(offset);
  return `${y}-${pad(m)}-${pad(d)}T${hhmm}${sign}${pad(Math.floor(off))}:${pad(Math.round((off % 1) * 60))}`;
}

export function formatSlot(iso: string | null | undefined): string {
  if (!iso) return "время согласует администратор";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, hm] = m;
  const dow = new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay();
  return `${DAY_RU[dow]} ${d}.${mo} в ${hm}`;
}

/** «04.11.2026 23:15» в местном времени центра. */
export function formatLocal(isoUtc: string, offset: number): string {
  const t = new Date(new Date(isoUtc).getTime() + offset * 3600e3);
  return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Сколько активных записей стоит на каждый слот центра. */
async function slotCounts(center: string): Promise<Map<string, number>> {
  const { blobs } = await slotsStore().list({ prefix: `${center}/` });
  const counts = new Map<string, number>();
  for (const b of blobs) {
    const slot = b.key.split("/")[1];
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return counts;
}

export async function availableSlots(center: Center, limit = 8): Promise<string[]> {
  const s = center.settings;
  const counts = await slotCounts(center.slug);
  const now = localNow(s.utcOffset);
  const minStart = now.getTime() + 3 * 3600e3; // не раньше чем через 3 часа
  const result: string[] = [];
  for (let shift = 0; shift < 21 && result.length < limit; shift++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + shift));
    const times = [...(s.slots[DAY_KEYS[day.getUTCDay()]] ?? [])].sort();
    for (const t of times) {
      if (!/^\d{2}:\d{2}$/.test(t)) continue;
      const [hh, mm] = t.split(":").map(Number);
      const localMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
      if (localMs < minStart) continue;
      const iso = slotIso(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t, s.utcOffset);
      if ((counts.get(iso) ?? 0) < s.trial.capacityPerSlot) result.push(iso);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export async function isSlotFree(center: Center, iso: string): Promise<boolean> {
  return (await availableSlots(center, 60)).includes(iso);
}

export const holdSlot = (lead: Lead) =>
  lead.slot ? slotsStore().set(`${lead.center}/${lead.slot}/${lead.id}`, "1") : Promise.resolve();

export const releaseSlot = (lead: Lead) =>
  lead.slot ? slotsStore().delete(`${lead.center}/${lead.slot}/${lead.id}`) : Promise.resolve();

// ------------------------------------------------------------------ заявки и вопросы

export async function listLeads(center: string): Promise<Lead[]> {
  const st = leadsStore();
  const { blobs } = await st.list({ prefix: `${center}/` });
  const items = await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }) as Promise<Lead | null>));
  return items.filter((x): x is Lead => !!x).sort((a, b) => (a.id < b.id ? 1 : -1));
}

export const saveLead = (lead: Lead) => leadsStore().setJSON(`${lead.center}/${lead.id}`, lead);

export async function getLead(center: string, id: string): Promise<Lead | null> {
  if (!/^[a-z0-9]{9,20}$/.test(id)) return null;
  return (await leadsStore().get(`${center}/${id}`, { type: "json" })) as Lead | null;
}

export type NewLead = {
  type: "trial" | "callback";
  source: string;
  channel: "web" | "whatsapp";
  name: string;
  phone: string;
  student?: string;
  course?: string;
  slot?: string | null;
  wish?: string;
  question?: string;
  waId?: string;
};

export class SlotTakenError extends Error {}

/** Создаёт заявку: проверяет слот, сохраняет, занимает место. Согласие проверяет вызывающий код. */
export async function createLead(center: Center, input: NewLead): Promise<Lead> {
  const slot = input.type === "trial" && input.slot ? input.slot : null;
  if (slot && !(await isSlotFree(center, slot))) throw new SlotTakenError("slot taken");
  const now = new Date().toISOString();
  const status: LeadStatus = input.type === "trial" && slot ? "записан" : "новая";
  const lead: Lead = {
    id: newId(),
    center: center.slug,
    type: input.type,
    createdAt: now,
    source: input.source,
    channel: input.channel,
    student: input.student || undefined,
    course: input.course || undefined,
    slot,
    wish: input.wish || undefined,
    question: input.question || undefined,
    name: input.name,
    phone: input.phone,
    waId: input.waId,
    status,
    consentAt: now,
    history: [{ at: now, status }],
  };
  await saveLead(lead);
  await holdSlot(lead);
  return lead;
}

/** Меняет статус заявки и место в слоте. Не сохраняет — это делает вызывающий код. */
export async function applyStatus(lead: Lead, next: LeadStatus): Promise<void> {
  if (next === lead.status) return;
  const held = HOLDS_SLOT.includes(lead.status);
  const holds = HOLDS_SLOT.includes(next);
  lead.status = next;
  lead.history.push({ at: new Date().toISOString(), status: next });
  if (held && !holds && next === "отказ") await releaseSlot(lead);
  if (!held && holds) await holdSlot(lead);
}

/** Переносит пробный урок на другой слот. */
export async function moveLead(center: Center, lead: Lead, slot: string): Promise<void> {
  if (!(await isSlotFree(center, slot))) throw new SlotTakenError("slot taken");
  if (HOLDS_SLOT.includes(lead.status)) await releaseSlot(lead);
  lead.slot = slot;
  lead.reminded24 = lead.reminded2 = false;
  if (lead.status !== "записан") {
    lead.status = "записан";
    lead.history.push({ at: new Date().toISOString(), status: "записан" });
  }
  await holdSlot(lead);
  await saveLead(lead);
}

// ------------------------------------------------------------------ дожим после пробного

export const followUpOf = (s: Settings): FollowUp => ({ ...DEFAULT_FOLLOWUP, ...(s.followUp ?? {}) });

/**
 * Кого пора дожать:
 * mark   — пробный прошёл больше 2 часов назад, а результат не отмечен;
 * came   — «пришёл», но не купил: через 20 часов после отметки;
 * noshow — «не пришёл»: через 2 часа после отметки.
 * Старше 14 дней не предлагаем — поздно. После дожима (followUp при том же статусе) — тоже нет.
 */
export type FollowUpKind = "mark" | "came" | "noshow";
export function followUpDue(lead: Lead, now = Date.now()): FollowUpKind | null {
  const H = 3600e3;
  if (lead.type !== "trial") return null;
  if (HOLDS_SLOT.includes(lead.status)) {
    if (!lead.slot) return null;
    const since = now - new Date(lead.slot).getTime();
    return since > 2 * H && since < 14 * 24 * H ? "mark" : null;
  }
  if (lead.status !== "пришёл" && lead.status !== "не пришёл") return null;
  if (lead.followUp?.status === lead.status) return null;
  const at = [...lead.history].reverse().find((h) => h.status === lead.status)?.at ?? lead.createdAt;
  const since = now - new Date(at).getTime();
  const wait = lead.status === "пришёл" ? 20 * H : 2 * H;
  if (since < wait || since > 14 * 24 * H) return null;
  return lead.status === "пришёл" ? "came" : "noshow";
}

/** Текст дожима с подстановкой {имя}, {центр}, {курс}. */
export function followUpText(center: Center, lead: Lead, kind: "came" | "noshow"): string {
  const t = followUpOf(center.settings)[kind];
  const first = lead.name.split(/[\s,(]+/)[0] || lead.name;
  return t.replace(/\{имя\}/g, first).replace(/\{центр\}/g, center.settings.name).replace(/\{курс\}/g, lead.course || "курс").trim();
}

/** Ссылка на сайт сервиса: из env Netlify (URL) или из запроса. */
export function siteUrl(req?: Request): string {
  const env = Netlify.env.get("URL");
  if (env) return env.replace(/\/$/, "");
  return req ? new URL(req.url).origin : "";
}

export async function listQuestions(center: string): Promise<Question[]> {
  const st = questionsStore();
  const { blobs } = await st.list({ prefix: `${center}/` });
  const recent = blobs.sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 200);
  const items = await Promise.all(recent.map((b) => st.get(b.key, { type: "json" }) as Promise<Question | null>));
  return items.filter((x): x is Question => !!x);
}
