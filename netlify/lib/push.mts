import { createHash } from "node:crypto";
import webpush from "web-push";
import { formatSlot, listLeads, pushSubsStore, siteUrl, type Center, type Lead, type Question } from "./core.mts";

// Web Push: уведомления в установленное приложение кабинета (телефон, компьютер).
// Ключи VAPID — env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, контакт для push-сервисов — env VAPID_SUBJECT (mailto: или https:, по умолчанию адрес сайта).
// Подписки: стор "push-subs", ключ `${slug}/${id}`, id — хэш адреса подписки (одно устройство = одна запись).

export type PushEvent = "leads" | "questions" | "digest";
export type PushEvents = Record<PushEvent, boolean>;
export interface PushSub {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device: string;
  events: PushEvents;
  createdAt: string;
  lastOkAt?: string;
}
export interface PushPayload { title: string; body: string; url: string; tag: string; badge?: number }

export const pushStore = pushSubsStore;
export const DEFAULT_EVENTS: PushEvents = { leads: true, questions: true, digest: true };

const env = (k: string) => Netlify.env.get(k) || "";
export const vapidPublicKey = () => env("VAPID_PUBLIC_KEY");
export const pushConfigured = () => vapidPublicKey().length > 60 && env("VAPID_PRIVATE_KEY").length > 30;

// Сервер сам отправляет POST на адрес подписки, поэтому принимаем только адреса push-сервисов браузеров.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  const extra = env("PUSH_ALLOW_HOSTS").split(",").map((s) => s.trim()).filter(Boolean); // только для тестов
  if (extra.includes(u.host)) return true;
  return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("base64url").slice(0, 16);

export function cleanEvents(e: any, base: PushEvents = DEFAULT_EVENTS): PushEvents {
  const out = { ...base };
  for (const k of Object.keys(DEFAULT_EVENTS) as PushEvent[]) if (typeof e?.[k] === "boolean") out[k] = e[k];
  return out;
}

export async function saveSub(slug: string, sub: any, device: string, events?: any): Promise<PushSub | null> {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (!validEndpoint(endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) return null;
  const id = subId(endpoint);
  const old = (await pushStore().get(`${slug}/${id}`, { type: "json" })) as PushSub | null;
  const rec: PushSub = {
    id, endpoint, keys: { p256dh, auth },
    device: String(device || old?.device || "Устройство").slice(0, 60),
    events: cleanEvents(events, old?.events ?? DEFAULT_EVENTS),
    createdAt: old?.createdAt ?? new Date().toISOString(),
    lastOkAt: old?.lastOkAt,
  };
  await pushStore().setJSON(`${slug}/${id}`, rec);
  return rec;
}

export async function listSubs(slug: string): Promise<PushSub[]> {
  const st = pushStore();
  const { blobs } = await st.list({ prefix: `${slug}/` });
  const subs = await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }) as Promise<PushSub | null>));
  return subs.filter((s): s is PushSub => !!s).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export const getSub = (slug: string, id: string) => pushStore().get(`${slug}/${id}`, { type: "json" }) as Promise<PushSub | null>;
export const deleteSub = (slug: string, id: string) => pushStore().delete(`${slug}/${id}`);
export const deleteAllSubs = async (slug: string) => { for (const s of await listSubs(slug)) await deleteSub(slug, s.id); };

/** Публичный вид для кабинета — без ключей и адреса. */
export const subView = (s: PushSub) => ({ id: s.id, device: s.device, events: s.events, createdAt: s.createdAt, lastOkAt: s.lastOkAt });

/** Отправить одно уведомление. Возвращает HTTP-статус push-сервиса (0 — сеть недоступна). */
export async function sendOne(slug: string, sub: PushSub, payload: PushPayload): Promise<number> {
  const details = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: sub.keys },
    JSON.stringify(payload),
    {
      vapidDetails: { subject: env("VAPID_SUBJECT") || siteUrl() || "https://ai-admin-astana.netlify.app", publicKey: vapidPublicKey(), privateKey: env("VAPID_PRIVATE_KEY") },
      TTL: 12 * 3600,
      urgency: "high",
    },
  );
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(details.headers)) if (k.toLowerCase() !== "content-length") headers[k] = String(v);
  let status = 0;
  try {
    const res = await fetch(details.endpoint, { method: "POST", headers, body: new Uint8Array(details.body as Buffer) });
    status = res.status;
  } catch (e: any) {
    console.error(`push ${slug}/${sub.id}: сеть`, e?.message);
    return 0;
  }
  if (status === 404 || status === 410) {
    await deleteSub(slug, sub.id); // устройство отписалось или приложение удалено
  } else if (status >= 200 && status < 300) {
    if (!sub.lastOkAt || Date.now() - Date.parse(sub.lastOkAt) > 864e5) {
      await pushStore().setJSON(`${slug}/${sub.id}`, { ...sub, lastOkAt: new Date().toISOString() });
    }
  } else {
    console.error(`push ${slug}/${sub.id}: статус ${status}`);
  }
  return status;
}

export async function pushToCenter(center: Center, event: PushEvent, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const subs = (await listSubs(center.slug)).filter((s) => s.events[event] !== false);
  const results = await Promise.all(subs.map((s) => sendOne(center.slug, s, payload)));
  return results.filter((s) => s >= 200 && s < 300).length;
}

// ------------------------------------------------------------------ тексты

const freshCount = async (slug: string) => (await listLeads(slug)).filter((l) => l.status === "новая").length;

export async function pushLead(center: Center, lead: Lead, title?: string) {
  if (!pushConfigured()) return;
  const head = title ?? (lead.type === "trial" ? (lead.slot ? "Запись на пробный" : "Заявка на пробный") : "Просит перезвонить");
  const what = lead.type === "trial"
    ? (lead.slot ? `пробный ${formatSlot(lead.slot)}` : "пробный, время не выбрано")
    : (lead.question ? `«${lead.question.slice(0, 80)}»` : "перезвонить");
  const via = lead.channel === "whatsapp" ? " · WhatsApp" : "";
  await pushToCenter(center, "leads", {
    title: `${head}${via}`,
    body: [`${lead.name}, ${lead.phone}`, what, lead.course].filter(Boolean).join(" · "),
    url: `/cabinet/#leads`,
    tag: `lead-${lead.id}`,
    badge: await freshCount(center.slug),
  });
}

export async function pushQuestion(center: Center, q: Question) {
  if (!pushConfigured()) return;
  await pushToCenter(center, "questions", {
    title: "Вопрос без ответа",
    body: `«${q.text.slice(0, 140)}»${q.channel === "whatsapp" ? " · WhatsApp" : ""}`,
    url: `/cabinet/#questions`,
    tag: `q-${q.id}`,
  });
}

export async function pushDigest(center: Center, stats: { night: number; today: number; fresh: number; open: number; follow?: number }) {
  if (!pushConfigured() || !(stats.night || stats.today || stats.fresh || stats.open || stats.follow)) return;
  const parts = [
    stats.night ? `за ночь заявок: ${stats.night}` : "",
    `пробных сегодня: ${stats.today}`,
    stats.fresh ? `ждут звонка: ${stats.fresh}` : "",
    stats.open ? `вопросов без ответа: ${stats.open}` : "",
    stats.follow ? `дожать после пробного: ${stats.follow}` : "",
  ].filter(Boolean);
  await pushToCenter(center, "digest", {
    title: `Доброе утро! ${center.settings.name}`,
    body: parts.join(", ").replace(/^./, (c) => c.toUpperCase()),
    url: `/cabinet/#overview`,
    tag: "digest",
    badge: stats.fresh,
  });
}
