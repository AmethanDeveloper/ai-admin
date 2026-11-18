import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { LEAD_STATUSES, applyStatus, getCenter, getLead, saveLead } from "../lib/core.mts";
import { chatCenter, h, leadKeyboard, leadText, linkChat, scheduleText, tg, unlinkChat } from "../lib/telegram.mts";

// Вебхук бота уведомлений: привязка чата администратора, кнопки статусов, команды.

function authorized(req: Request): boolean {
  const want = Netlify.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  return want.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const HELP =
  "Это бот уведомлений сервиса «ИИ-администратор».\n\n" +
  "Чтобы получать сюда заявки центра, откройте кабинет центра → вкладка «Установка» → «Подключить Telegram».\n\n" +
  "Команды: /today — пробные уроки на сегодня и завтра, /stop — отключить уведомления.";

async function onMessage(msg: any) {
  const chatId: number = msg.chat?.id;
  const text: string = (msg.text || "").trim();
  if (!chatId || !text.startsWith("/")) return;
  const [cmdRaw, arg = ""] = text.split(/\s+/, 2);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const reply = (t: string) => tg("sendMessage", { chat_id: chatId, text: t, parse_mode: "HTML", disable_web_page_preview: true });

  if (cmd === "/start") {
    if (!arg) return reply(h(HELP));
    const person = [msg.from?.first_name, msg.from?.username && `@${msg.from.username}`].filter(Boolean).join(" ");
    const who = msg.chat?.type !== "private" && msg.chat?.title ? `Группа «${msg.chat.title}»` : person || "чат";
    const center = await linkChat(arg, msg.chat, who);
    if (!center) return reply("Ссылка устарела или уже использована. Получите новую в кабинете: вкладка «Установка» → «Подключить Telegram».");
    return reply(
      `Готово! Сюда будут приходить заявки и вопросы центра <b>${h(center.settings.name)}</b>.\n\n` +
      "Статус заявки можно менять кнопками прямо под сообщением. Каждое утро в 9:00 пришлю сводку за ночь.\n\n" +
      "/today — пробные на сегодня и завтра\n/stop — отключить уведомления",
    );
  }

  const slug = await chatCenter(chatId);
  if (cmd === "/stop") {
    const was = await unlinkChat(chatId);
    return reply(was ? "Уведомления в этом чате отключены. Подключить снова можно из кабинета." : "Этот чат и так не подключён.");
  }
  if (cmd === "/today") {
    const center = slug ? await getCenter(slug) : null;
    return reply(center ? await scheduleText(center) : h(HELP));
  }
  if (cmd === "/help") return reply(h(HELP));
}

async function onCallback(cb: any) {
  const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, text });
  const [kind, slug, id, idx] = String(cb.data || "").split("|");
  const chatId: number = cb.message?.chat?.id;
  if (kind !== "s" || !chatId) return answer("Неизвестная команда");
  if ((await chatCenter(chatId)) !== slug) return answer("Этот чат не подключён к центру");
  const next = LEAD_STATUSES[Number(idx)];
  const [center, lead] = await Promise.all([getCenter(slug), getLead(slug, id)]);
  if (!center || !lead || !next) return answer("Заявка не найдена");
  if (lead.status === next) return answer(`Уже «${next}»`);
  await applyStatus(lead, next);
  await saveLead(lead);
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: cb.message.message_id,
    text: leadText(center, lead),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: leadKeyboard(center, lead),
  }).catch((e) => console.error("edit failed:", e?.message));
  return answer(`Статус: ${next}`);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("ok");
  if (!authorized(req)) return new Response("forbidden", { status: 403 });
  const update = await req.json().catch(() => ({}));
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (e: any) {
    console.error("telegram update failed:", e?.message ?? e);
  }
  // Всегда 200: иначе Telegram будет повторять то же обновление.
  return new Response("ok");
};

export const config: Config = { path: "/api/telegram/webhook" };
