import { randomBytes } from "node:crypto";
import {
  LEAD_STATUSES, followUpDue, formatLocal, formatSlot, getCenter, listLeads, listQuestions, saveCenter, siteUrl,
  systemStore, tgChatsStore, tgLinksStore, type Center, type Lead, type LeadStatus, type Question,
} from "./core.mts";

// Один бот сервиса присылает уведомления администраторам всех центров.
// Токен — env TELEGRAM_BOT_TOKEN, секрет вебхука — env TELEGRAM_WEBHOOK_SECRET.

const API = () => (Netlify.env.get("TELEGRAM_API_BASE") || "https://api.telegram.org").replace(/\/$/, "");
export const tgToken = () => Netlify.env.get("TELEGRAM_BOT_TOKEN") || "";
export const tgConfigured = () => /^\d+:[\w-]{30,}$/.test(tgToken());

export async function tg<T = any>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!tgConfigured()) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const res = await fetch(`${API()}/bot${tgToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`Telegram ${method}: ${data.description || res.status}`), { code: data.error_code, migrateTo: data.parameters?.migrate_to_chat_id });
  return data.result as T;
}

export const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

export async function botUsername(): Promise<string> {
  const sys = systemStore();
  const cached = (await sys.get("tg-bot", { type: "json" })) as { username: string; tokenTail: string } | null;
  const tail = tgToken().slice(-6);
  if (cached?.username && cached.tokenTail === tail) return cached.username;
  const me = await tg<{ username: string }>("getMe");
  await sys.setJSON("tg-bot", { username: me.username, tokenTail: tail });
  return me.username;
}

// ------------------------------------------------------------------ привязка чатов

export async function createLinkCode(slug: string): Promise<string> {
  const code = randomBytes(9).toString("base64url");
  await tgLinksStore().setJSON(code, { center: slug, exp: Date.now() + 30 * 60e3 });
  return code;
}

export async function linkChat(code: string, chat: { id: number }, name: string): Promise<Center | null> {
  if (!/^[\w-]{8,64}$/.test(code)) return null;
  const link = (await tgLinksStore().get(code, { type: "json" })) as { center: string; exp: number } | null;
  if (!link || link.exp < Date.now()) return null;
  await tgLinksStore().delete(code);
  await unlinkChat(chat.id);
  const center = await getCenter(link.center);
  if (!center) return null;
  const chats = (center.telegram?.chats ?? []).filter((c) => c.id !== chat.id);
  chats.push({ id: chat.id, name: name.slice(0, 80), linkedAt: new Date().toISOString() });
  center.telegram = { chats: chats.slice(-10) };
  await saveCenter(center);
  await tgChatsStore().set(String(chat.id), center.slug);
  return center;
}

export async function unlinkChat(chatId: number, onlyFrom?: string): Promise<string | null> {
  const slug = await tgChatsStore().get(String(chatId), { type: "text" });
  if (!slug || (onlyFrom && slug !== onlyFrom)) return null;
  await tgChatsStore().delete(String(chatId));
  const center = await getCenter(slug);
  if (center?.telegram) {
    center.telegram.chats = center.telegram.chats.filter((c) => c.id !== chatId);
    await saveCenter(center);
  }
  return slug;
}

/** Группа стала супергруппой — у чата новый id, переносим привязку. */
async function migrateChat(center: Center, from: number, to: number) {
  await tgChatsStore().delete(String(from));
  await tgChatsStore().set(String(to), center.slug);
  const fresh = await getCenter(center.slug);
  if (fresh?.telegram) {
    fresh.telegram.chats = fresh.telegram.chats.map((c) => (c.id === from ? { ...c, id: to } : c));
    await saveCenter(fresh);
  }
}

export const chatCenter = (chatId: number) => tgChatsStore().get(String(chatId), { type: "text" });

// ------------------------------------------------------------------ сообщения о заявках

const SHOWN_STATUSES: LeadStatus[] = ["подтвердил", "пришёл", "купил", "не пришёл", "отказ"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function leadText(center: Center, lead: Lead, title?: string): string {
  const head = title ?? (lead.type === "trial" ? (lead.slot ? "Запись на пробный урок" : "Заявка на пробный урок") : "Просит перезвонить");
  const rows = [
    `<b>${h(head)}</b> · ${h(center.settings.name)}`,
    "",
    `<b>${h(lead.name)}</b>, ${h(lead.phone)}`,
    lead.student && `Кто учится: ${h(lead.student)}`,
    lead.course && `Курс: ${h(lead.course)}`,
    lead.type === "trial" && `Пробный: <b>${h(lead.slot ? formatSlot(lead.slot) : "время не выбрано")}</b>`,
    lead.wish && `Удобно: ${h(lead.wish)}`,
    lead.question && `Вопрос: ${h(lead.question)}`,
    `Откуда: ${h(lead.source)} · ${h(formatLocal(lead.createdAt, center.settings.utcOffset))}`,
    `Статус: <b>${h(lead.status)}</b>`,
  ];
  return rows.filter((x) => x !== false && x !== undefined).join("\n");
}

export function leadKeyboard(center: Center, lead: Lead) {
  const btn = (s: LeadStatus) => ({
    text: s === lead.status ? `• ${cap(s)}` : cap(s),
    callback_data: `s|${center.slug}|${lead.id}|${LEAD_STATUSES.indexOf(s)}`,
  });
  const digits = lead.phone.replace(/\D/g, "");
  return {
    inline_keyboard: [
      SHOWN_STATUSES.slice(0, 3).map(btn),
      SHOWN_STATUSES.slice(3).map(btn),
      [{ text: "Написать в WhatsApp", url: `https://wa.me/${digits}` }],
    ],
  };
}

async function broadcast(center: Center, text: string, extra: Record<string, unknown> = {}) {
  if (!tgConfigured()) return;
  const chats = center.telegram?.chats ?? [];
  await Promise.all(chats.map(async (c) => {
    const send = (chatId: number) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
    try {
      await send(c.id);
    } catch (e: any) {
      if (e?.migrateTo) {
        await migrateChat(center, c.id, e.migrateTo);
        await send(e.migrateTo).catch((x) => console.error(`telegram send to ${e.migrateTo} failed:`, x?.message));
        return;
      }
      console.error(`telegram send to ${c.id} failed:`, e?.message);
      if (e?.code === 403) await unlinkChat(c.id); // бота заблокировали или удалили из группы
    }
  }));
}

export const notifyLead = (center: Center, lead: Lead, title?: string) =>
  broadcast(center, leadText(center, lead, title), { reply_markup: leadKeyboard(center, lead) });

export function notifyQuestion(center: Center, q: Question, contact?: string) {
  const text = [
    `<b>Вопрос, на который бот не ответил</b> · ${h(center.settings.name)}`,
    "",
    `«${h(q.text)}»`,
    `Бот ответил: ${h(q.answer)}`,
    contact && `Контакт: ${h(contact)}`,
    `Канал: ${q.channel === "whatsapp" ? "WhatsApp" : "чат на сайте"}`,
  ].filter(Boolean).join("\n");
  const url = siteUrl();
  return broadcast(center, text, url ? { reply_markup: { inline_keyboard: [[{ text: "Открыть вопросы в кабинете", url: `${url}/cabinet/#questions` }]] } } : {});
}

// ------------------------------------------------------------------ сводки

const localDate = (offset: number, plusDays = 0) => {
  const t = new Date(Date.now() + offset * 3600e3 + plusDays * 864e5);
  return t.toISOString().slice(0, 10);
};

function trialsOn(leads: Lead[], ymd: string) {
  return leads
    .filter((l) => l.slot?.startsWith(ymd) && ["записан", "подтвердил"].includes(l.status))
    .sort((a, b) => (a.slot! < b.slot! ? -1 : 1));
}

const trialLine = (l: Lead) => `${h(l.slot!.slice(11, 16))} — ${h(l.name)}, ${h(l.phone)}${l.status === "подтвердил" ? " ✓" : ""}${l.course ? ` · ${h(l.course)}` : ""}`;

export async function scheduleText(center: Center): Promise<string> {
  const leads = await listLeads(center.slug);
  const off = center.settings.utcOffset;
  const today = trialsOn(leads, localDate(off));
  const tomorrow = trialsOn(leads, localDate(off, 1));
  return [
    `<b>Пробные уроки · ${h(center.settings.name)}</b>`,
    "",
    `<b>Сегодня</b> (${today.length})`,
    ...(today.length ? today.map(trialLine) : ["нет записей"]),
    "",
    `<b>Завтра</b> (${tomorrow.length})`,
    ...(tomorrow.length ? tomorrow.map(trialLine) : ["нет записей"]),
    "",
    "✓ — клиент подтвердил, что придёт.",
  ].join("\n");
}

export async function digestData(center: Center) {
  const leads = await listLeads(center.slug);
  const off = center.settings.utcOffset;
  const since = Date.now() - 13 * 3600e3; // с 20:00 вчерашнего дня, если сводка в 9:00
  const night = leads.filter((l) => new Date(l.createdAt).getTime() >= since);
  const today = trialsOn(leads, localDate(off));
  const open = (await listQuestions(center.slug)).filter((q) => q.escalated && !q.resolved).length;
  const fresh = leads.filter((l) => l.status === "новая").length;
  const follow = leads.filter((l) => followUpDue(l)).length;
  return { night, today, open, fresh, follow };
}

export async function sendDigest(center: Center, data?: Awaited<ReturnType<typeof digestData>>): Promise<boolean> {
  if (!center.telegram?.chats.length) return false;
  const off = center.settings.utcOffset;
  const { night, today, open, fresh, follow } = data ?? (await digestData(center));
  const text = [
    `<b>Доброе утро! Сводка · ${h(center.settings.name)}</b>`,
    "",
    night.length ? `<b>За ночь пришло заявок: ${night.length}</b>` : "За ночь новых заявок нет.",
    ...night.slice(0, 8).map((l) => `${h(formatLocal(l.createdAt, off).slice(11))} — ${h(l.name)} · ${l.type === "trial" ? (l.slot ? `пробный ${h(formatSlot(l.slot))}` : "пробный, время не выбрано") : "перезвонить"}`),
    "",
    `<b>Пробные сегодня: ${today.length}</b>`,
    ...today.map(trialLine),
    fresh ? `\nЖдут звонка (статус «новая»): ${fresh}` : "",
    open ? `Вопросов без ответа: ${open}` : "",
    follow ? `Дожать после пробного: ${follow} — список на сводке в кабинете` : "",
  ].filter((x) => x !== "").join("\n");
  const url = siteUrl();
  await broadcast(center, text, url ? { reply_markup: { inline_keyboard: [[{ text: "Открыть кабинет", url: `${url}/cabinet/` }]] } } : {});
  return true;
}

// ------------------------------------------------------------------ вебхук

export async function ensureWebhook(base: string): Promise<string> {
  const secret = Netlify.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  if (!tgConfigured() || secret.length < 16 || !base) return "skipped";
  const url = `${base}/api/telegram/webhook`;
  const info = await tg<{ url: string }>("getWebhookInfo");
  if (info.url === url) return "ok";
  await tg("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] });
  await tg("setMyCommands", {
    commands: [
      { command: "today", description: "Пробные уроки на сегодня и завтра" },
      { command: "stop", description: "Отключить уведомления в этом чате" },
    ],
  });
  return "set";
}
