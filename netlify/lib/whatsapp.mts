import { createHmac, timingSafeEqual } from "node:crypto";
import { chatAnswer, type ChatTurn } from "./ai.mts";
import {
  SlotTakenError, applyStatus, availableSlots, createLead, formatSlot, getLead, moveLead, newId, normalizePhone,
  questionsStore, saveLead, siteUrl, waSessionsStore, type Center, type Question, type WhatsAppConfig,
} from "./core.mts";
import { notifyLead } from "./notify.mts";

// ------------------------------------------------------------------ WhatsApp Cloud API

const GRAPH = () => (Netlify.env.get("WA_GRAPH_BASE") || "https://graph.facebook.com").replace(/\/$/, "");
const VERSION = () => Netlify.env.get("WA_GRAPH_VERSION") || "v23.0";
const token = (cfg: WhatsAppConfig) => cfg.accessToken || Netlify.env.get("WA_TOKEN") || "";
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

async function graph(cfg: WhatsAppConfig, payload: Record<string, unknown>) {
  const res = await fetch(`${GRAPH()}/${VERSION()}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token(cfg)}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${data?.error?.message || "ошибка отправки"}`);
  return data;
}

export type Button = { id: string; title: string };
export type Row = { id: string; title: string; description?: string };

export const sendText = (cfg: WhatsAppConfig, to: string, body: string) =>
  graph(cfg, { recipient_type: "individual", to, type: "text", text: { body: cut(body, 4000), preview_url: true } });

export const sendButtons = (cfg: WhatsAppConfig, to: string, body: string, buttons: Button[]) =>
  graph(cfg, {
    recipient_type: "individual", to, type: "interactive",
    interactive: {
      type: "button",
      body: { text: cut(body, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: cut(b.title, 20) } })) },
    },
  });

export const sendList = (cfg: WhatsAppConfig, to: string, body: string, button: string, rows: Row[]) =>
  graph(cfg, {
    recipient_type: "individual", to, type: "interactive",
    interactive: {
      type: "list",
      body: { text: cut(body, 1024) },
      action: {
        button: cut(button, 20),
        sections: [{
          title: "Варианты",
          rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })),
        }],
      },
    },
  });

export const sendTemplate = (cfg: WhatsAppConfig, to: string, name: string, lang: string, params: string[]) =>
  graph(cfg, {
    recipient_type: "individual", to, type: "template",
    template: {
      name, language: { code: lang },
      ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: cut(text, 120) })) }] } : {}),
    },
  });

export const markRead = (cfg: WhatsAppConfig, messageId: string) =>
  graph(cfg, { status: "read", message_id: messageId }).catch(() => undefined);

export function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(raw).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

// ------------------------------------------------------------------ диалог

type Step = "idle" | "student" | "course" | "slot" | "wish" | "name_text" | "confirm" | "escalate";
type Draft = { student?: string; course?: string; slot?: string | null; slotLabel?: string; wish?: string; name?: string; moveLeadId?: string };
export type WaSession = {
  step: Step;
  draft: Draft;
  history: ChatTurn[];
  slots?: string[];
  lastQuestion?: string;
  profileName?: string;
  lastUserAt: string;
};

const DAY = 864e5;
const fresh = (profileName?: string): WaSession => ({ step: "idle", draft: {}, history: [], profileName, lastUserAt: new Date().toISOString() });

export async function loadSession(slug: string, waId: string): Promise<WaSession | null> {
  return (await waSessionsStore().get(`${slug}/${waId}`, { type: "json" })) as WaSession | null;
}
const saveSession = (slug: string, waId: string, s: WaSession) => waSessionsStore().setJSON(`${slug}/${waId}`, s);

/** Можно ли писать клиенту без шаблона: прошло меньше 24 часов с его последнего сообщения. */
export async function inServiceWindow(slug: string, waId: string, marginMin = 15): Promise<boolean> {
  const s = await loadSession(slug, waId);
  return !!s && Date.now() - new Date(s.lastUserAt).getTime() < DAY - marginMin * 60e3;
}

const MENU: Button[] = [
  { id: "book", title: "Записаться" },
  { id: "courses", title: "Курсы и цены" },
  { id: "address", title: "Адрес и график" },
];
const GREETING_RE = /^(привет|здравствуй|здравствуйте|добрый (день|вечер|утро)|доброе утро|сәлем|сәлеметсіз бе|салем|hi|hello|начать|старт|start|\/start)[\s!.,)]*$/i;
const MENU_RE = /^(меню|menu|назад|главное меню)$/i;

type Ctx = { center: Center; cfg: WhatsAppConfig; to: string; s: WaSession };

const privacy = () => `${siteUrl()}/privacy/`;
const consentLine = (c: Center, what: string) =>
  `Нажимая «${what}», вы соглашаетесь, что центр «${c.settings.name}» обработает ваше имя и номер телефона, чтобы связаться по заявке, в том числе с хранением на зарубежных серверах. Политика: ${privacy()}`;

async function say(x: Ctx, text: string, buttons?: Button[]) {
  if (!buttons?.length) return sendText(x.cfg, x.to, text);
  if (text.length <= 1000) return sendButtons(x.cfg, x.to, text, buttons);
  await sendText(x.cfg, x.to, text);
  return sendButtons(x.cfg, x.to, "Что дальше?", buttons);
}

async function menu(x: Ctx, greet: boolean) {
  x.s.step = "idle";
  const name = x.center.settings.name;
  const text = greet
    ? `Здравствуйте! Я онлайн-администратор «${name}». Отвечу на вопросы о курсах и ценах и запишу на бесплатный пробный урок — в любое время.\n\nНапишите вопрос или выберите:`
    : "Чем ещё помочь? Напишите вопрос или выберите:";
  return say(x, text, MENU);
}

function coursesText(c: Center): string {
  const s = c.settings;
  const lines = s.courses.length
    ? s.courses.map((k) => `• *${k.name}*${k.for ? ` (${k.for})` : ""}${k.format ? `\n  ${k.format}` : ""}${k.price ? `\n  ${k.price}` : ""}`).join("\n")
    : "Список курсов уточнит администратор.";
  return `${lines}\n\nПробный урок — ${s.trial.price}, ${s.trial.durationMin} минут.`;
}

function addressText(c: Center): string {
  const s = c.settings;
  return [s.address && `Адрес: ${s.address}`, s.hours && `График: ${s.hours}`, s.phone && `Телефон: ${s.phone}`].filter(Boolean).join("\n") || "Адрес уточнит администратор.";
}

// ---------- запись на пробный

async function startBooking(x: Ctx) {
  x.s.draft = { name: x.s.draft.name };
  const types = x.center.settings.studentTypes;
  if (!types.length) return askCourse(x);
  x.s.step = "student";
  return sendList(x.cfg, x.to, "Отлично! Кто будет учиться?", "Выбрать", types.map((t, i) => ({ id: `st_${i}`, title: t })));
}

async function askCourse(x: Ctx) {
  const courses = x.center.settings.courses.slice(0, 9);
  if (!courses.length) { x.s.draft.course = ""; return askSlot(x); }
  x.s.step = "course";
  return sendList(x.cfg, x.to, "Какой курс интересует?", "Выбрать курс", [
    ...courses.map((c, i) => ({ id: `co_${i}`, title: c.name, description: [c.for, c.price].filter(Boolean).join(" · ") })),
    { id: "co_none", title: "Подскажите на уроке" },
  ]);
}

async function askSlot(x: Ctx, note?: string) {
  const slots = await availableSlots(x.center, 9);
  x.s.slots = slots;
  const t = x.center.settings.trial;
  if (!slots.length) {
    x.s.step = "wish";
    return sendText(x.cfg, x.to, `${note ? note + "\n\n" : ""}Ближайшие свободные места закончились. Напишите, в какие дни и часы вам удобно, — администратор подберёт время.`);
  }
  x.s.step = "slot";
  return sendList(x.cfg, x.to, `${note ? note + "\n\n" : ""}Выберите время пробного урока (${t.durationMin} минут, ${t.price}):`, "Выбрать время", [
    ...slots.map((iso, i) => ({ id: `sl_${i}`, title: formatSlot(iso) })),
    ...(x.s.draft.moveLeadId ? [] : [{ id: "sl_none", title: "Нет удобного времени" }]),
  ]);
}

async function askName(x: Ctx) {
  const p = x.s.profileName?.trim();
  if (x.s.draft.name) return confirm(x);
  if (p) {
    x.s.step = "confirm";
    x.s.draft.name = p;
    return confirm(x, true);
  }
  x.s.step = "name_text";
  return sendText(x.cfg, x.to, "Как к вам обращаться? Если учится ребёнок — напишите и его имя.");
}

async function confirm(x: Ctx, nameFromProfile = false) {
  x.s.step = "confirm";
  const d = x.s.draft;
  const lines: string[] = ["*Проверьте запись:*"];
  if (d.student) lines.push(`Кто учится: ${d.student}`);
  if (d.course) lines.push(`Курс: ${d.course}`);
  lines.push(`Время: ${d.slotLabel || "подберёт администратор"}`);
  if (d.wish) lines.push(`Удобно: ${d.wish}`);
  lines.push(`Имя: ${d.name}${nameFromProfile ? " (из профиля WhatsApp)" : ""}`, "Телефон: этот номер WhatsApp", "", consentLine(x.center, "Подтвердить"));
  return sendButtons(x.cfg, x.to, lines.join("\n"), [
    { id: "cf_yes", title: "Подтвердить" },
    { id: "cf_name", title: "Другое имя" },
    { id: "cf_no", title: "Отмена" },
  ]);
}

async function finishBooking(x: Ctx) {
  const d = x.s.draft;
  const phone = normalizePhone("+" + x.to) ?? "+" + x.to;
  try {
    const lead = await createLead(x.center, {
      type: "trial", source: "WhatsApp", channel: "whatsapp", name: d.name || x.s.profileName || "Без имени", phone,
      student: d.student, course: d.course, slot: d.slot ?? null, wish: d.wish, waId: x.to,
    });
    x.s.step = "idle";
    x.s.draft = { name: d.name };
    const addr = x.center.settings.address;
    await say(x, d.slot
      ? `Готово! Ждём вас: *${formatSlot(d.slot)}*.${addr ? `\nАдрес: ${addr}` : ""}\nАдминистратор свяжется с вами для подтверждения.`
      : "Готово! Администратор свяжется с вами и подберёт удобное время.");
    await notifyLead(x.center, lead);
  } catch (e) {
    if (e instanceof SlotTakenError) return askSlot(x, "Это время только что заняли.");
    throw e;
  }
}

// ---------- перенос и подтверждение из напоминания

async function reminderAction(x: Ctx, action: string, leadId: string) {
  const lead = await getLead(x.center.slug, leadId);
  if (!lead || lead.waId !== x.to) return menu(x, false);
  if (action === "ok") {
    await applyStatus(lead, "подтвердил");
    await saveLead(lead);
    await sendText(x.cfg, x.to, `Спасибо! Ждём вас: ${formatSlot(lead.slot)}.`);
    return notifyLead(x.center, lead, "Клиент подтвердил пробный");
  }
  if (action === "cancel") {
    await applyStatus(lead, "отказ");
    await saveLead(lead);
    await sendText(x.cfg, x.to, "Запись отменена. Если передумаете — напишите «записаться».");
    return notifyLead(x.center, lead, "Клиент отменил пробный");
  }
  if (action === "move") {
    x.s.draft = { name: lead.name, moveLeadId: lead.id };
    return askSlot(x, "Хорошо, давайте перенесём.");
  }
}

// ---------- ответы на дожим после пробного

async function followUpAction(x: Ctx, action: string, leadId: string) {
  const lead = await getLead(x.center.slug, leadId);
  if (!lead || lead.waId !== x.to) return menu(x, false);
  if (action === "buy") {
    lead.comment = [lead.comment, "Хочет в группу (ответ на дожим в WhatsApp)"].filter(Boolean).join(" · ").slice(0, 1000);
    await saveLead(lead);
    await sendText(x.cfg, x.to, "Отлично! Передал администратору — он свяжется с вами, чтобы закрепить место в группе и рассказать об оплате.");
    return notifyLead(x.center, lead, "Хочет в группу после пробного — свяжитесь");
  }
  if (action === "no") {
    await applyStatus(lead, "отказ");
    await saveLead(lead);
    return sendText(x.cfg, x.to, "Хорошо, спасибо за ответ! Если захотите вернуться — просто напишите.");
  }
}

async function finishMove(x: Ctx, slot: string) {
  const lead = await getLead(x.center.slug, x.s.draft.moveLeadId!);
  x.s.draft = { name: x.s.draft.name };
  x.s.step = "idle";
  if (!lead) return menu(x, false);
  try {
    await moveLead(x.center, lead, slot);
  } catch (e) {
    if (e instanceof SlotTakenError) { x.s.draft.moveLeadId = lead.id; return askSlot(x, "Это время только что заняли."); }
    throw e;
  }
  await sendText(x.cfg, x.to, `Перенесли! Ждём вас: *${formatSlot(slot)}*.`);
  return notifyLead(x.center, lead, "Клиент перенёс пробный");
}

// ---------- свободные вопросы

async function ask(x: Ctx, text: string, withMenu = false) {
  x.s.history = [...x.s.history, { role: "user" as const, content: text }].slice(-8);
  const r = await chatAnswer(x.s.history, x.center.settings);
  x.s.history = [...x.s.history, { role: "assistant" as const, content: r.answer }].slice(-8);
  const q: Question = {
    id: newId(), createdAt: new Date().toISOString(), text, answer: r.answer, escalated: r.escalate,
    resolved: !r.escalate, session: `wa:${x.to.slice(-4)}`, via: r.via, model: r.model, channel: "whatsapp",
  };
  await questionsStore().setJSON(`${x.center.slug}/${q.id}`, q);

  const booking = ["student", "course", "slot", "confirm"].includes(x.s.step);
  if (r.escalate) {
    x.s.step = "escalate";
    x.s.lastQuestion = text;
    // Номер в WhatsApp уже известен — просьбу «оставьте телефон» из ответа убираем, всё шлём одним сообщением.
    const answer = r.answer.replace(/[^.!?\n]*(оставьте|напишите|укажите)[^.!?\n]*(телефон|номер)[^.!?\n]*[.!?]?/gi, "").trim();
    const ask = `Передать вопрос администратору? Он ответит вам здесь или позвонит по этому номеру.\n\n${consentLine(x.center, "Передать")}`;
    return sendButtons(x.cfg, x.to, answer ? `${cut(answer, 600)}\n\n${ask}` : ask, [
      { id: "esc_yes", title: "Передать" },
      { id: "esc_no", title: "Не нужно" },
    ]);
  }
  if (booking) return sendText(x.cfg, x.to, `${r.answer}\n\nЧтобы продолжить запись, выберите вариант в сообщении выше или напишите «меню».`);
  if (r.book) return say(x, r.answer, [{ id: "book", title: "Записаться" }, { id: "courses", title: "Курсы и цены" }]);
  return withMenu ? say(x, r.answer, MENU) : sendText(x.cfg, x.to, r.answer);
}

async function escalate(x: Ctx) {
  const phone = normalizePhone("+" + x.to) ?? "+" + x.to;
  const lead = await createLead(x.center, {
    type: "callback", source: "WhatsApp", channel: "whatsapp", name: x.s.draft.name || x.s.profileName || "Без имени",
    phone, question: x.s.lastQuestion, waId: x.to,
  });
  x.s.step = "idle";
  await sendText(x.cfg, x.to, "Передал администратору. Он ответит вам здесь или позвонит в рабочее время.");
  return notifyLead(x.center, lead);
}

// ---------- входящее сообщение

export type Incoming = { id: string; from: string; type: string; text?: { body: string }; interactive?: any; button?: { text?: string; payload?: string } };

export async function handleIncoming(center: Center, cfg: WhatsAppConfig, msg: Incoming, profileName?: string) {
  const to = msg.from.replace(/\D/g, "");
  let s = await loadSession(center.slug, to);
  const isNew = !s || Date.now() - new Date(s.lastUserAt).getTime() > DAY;
  if (!s || isNew) s = fresh(profileName ?? s?.profileName);
  if (profileName) s.profileName = profileName;
  s.lastUserAt = new Date().toISOString();
  const x: Ctx = { center, cfg, to, s };
  await markRead(cfg, msg.id);

  try {
    const id: string | undefined = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? msg.button?.payload;
    const text = (msg.text?.body ?? msg.button?.text ?? "").trim();

    if (id) await onChoice(x, id);
    else if (!text) await sendText(cfg, to, "Пока я понимаю только текст. Напишите, пожалуйста, вопрос словами.");
    else await onText(x, text, isNew);
  } finally {
    await saveSession(center.slug, to, s);
  }
}

async function onChoice(x: Ctx, id: string) {
  const s = x.s;
  const num = (p: string) => Number(id.slice(p.length));
  if (id === "menu") return menu(x, false);
  if (id === "book") return startBooking(x);
  if (id === "courses") return say(x, coursesText(x.center), [{ id: "book", title: "Записаться" }, { id: "address", title: "Адрес и график" }]);
  if (id === "address") return say(x, addressText(x.center), [{ id: "book", title: "Записаться" }, { id: "courses", title: "Курсы и цены" }]);

  if (id.startsWith("st_")) {
    s.draft.student = x.center.settings.studentTypes[num("st_")] ?? "";
    return askCourse(x);
  }
  if (id.startsWith("co_")) {
    s.draft.course = id === "co_none" ? "подобрать на пробном уроке" : x.center.settings.courses[num("co_")]?.name ?? "";
    return askSlot(x);
  }
  if (id === "sl_none") {
    s.draft.slot = null;
    s.draft.slotLabel = undefined;
    s.step = "wish";
    return sendText(x.cfg, x.to, "Напишите, в какие дни и часы вам удобно, — администратор подберёт время.");
  }
  if (id.startsWith("sl_")) {
    const iso = s.slots?.[num("sl_")];
    if (!iso) return askSlot(x, "Список времени обновился.");
    if (s.draft.moveLeadId) return finishMove(x, iso);
    s.draft.slot = iso;
    s.draft.slotLabel = formatSlot(iso);
    s.draft.wish = undefined;
    return askName(x);
  }
  if (id === "cf_yes" && s.step === "confirm") return finishBooking(x);
  if (id === "cf_name") {
    s.draft.name = undefined;
    s.step = "name_text";
    return sendText(x.cfg, x.to, "Как к вам обращаться? Если учится ребёнок — напишите и его имя.");
  }
  if (id === "cf_no") { s.draft = { name: s.draft.name }; return menu(x, false); }
  if (id === "esc_yes" && s.step === "escalate") return escalate(x);
  if (id === "esc_no") { s.step = "idle"; return say(x, "Хорошо. Если появятся вопросы — пишите.", MENU); }

  const rem = id.match(/^rem_(ok|move|cancel)_([a-z0-9]{9,20})$/);
  if (rem) return reminderAction(x, rem[1], rem[2]);
  const fu = id.match(/^fu_(buy|no)_([a-z0-9]{9,20})$/);
  if (fu) return followUpAction(x, fu[1], fu[2]);
  if (id === "fu_q") { s.step = "idle"; return sendText(x.cfg, x.to, "Напишите ваш вопрос — отвечу или передам администратору."); }
  return menu(x, false);
}

async function onText(x: Ctx, text: string, isNew: boolean) {
  const s = x.s;
  if (s.step === "wish") {
    s.draft.wish = text.slice(0, 300);
    return askName(x);
  }
  if (s.step === "name_text") {
    if (text.length < 2) return sendText(x.cfg, x.to, "Напишите, пожалуйста, имя полностью.");
    s.draft.name = text.slice(0, 80);
    return confirm(x);
  }
  if (MENU_RE.test(text)) return menu(x, false);
  if (/^записа(ться|ть|тся)\b|^хочу записаться|^жазыл/i.test(text) && text.length < 40) return startBooking(x);
  if (GREETING_RE.test(text)) return menu(x, true);
  // в первом сообщении с вопросом сразу показываем и меню
  return ask(x, text.slice(0, 1000), isNew);
}
