import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "./seed.mts";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatResult = { answer: string; escalate: boolean; book: boolean; via: "ai" | "faq"; model?: string };

const MODELS = () => {
  const preferred = Netlify.env.get("CHAT_MODEL");
  return [preferred, "claude-haiku-5-5", "claude-sonnet-5-5"].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
};

function systemPrompt(s: Settings): string {
  return `Ты — вежливый онлайн-администратор учебного центра «${s.name}» (${s.city}).
Отвечай коротко: 1–4 предложения, простым языком, без markdown. Отвечай на языке клиента — русском или казахском.
Используй только факты из данных центра ниже. Не выдумывай цены, скидки, даты, преподавателей и обещания.
Если ответа в данных нет или вопрос требует решения человека (индивидуальная скидка, жалоба, возврат, особые условия, здоровье ребёнка),
скажи, что передашь вопрос администратору, и поставь в самом конце метку [ADMIN].
Если клиенту уместно записаться на бесплатный пробный урок или он сам этого хочет, предложи запись и поставь в конце метку [BOOK].
Не проси у клиента телефон и имя в тексте — для записи есть отдельная форма.
Не используй markdown, списки со звёздочками и эмодзи — ответ показывается как простой текст в чате или WhatsApp.
Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}.

Данные центра (JSON):
${JSON.stringify(s)}`;
}

const words = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []).map((w) => w.slice(0, 6)));

/** Ответ без ИИ: простые намерения и поиск по частым вопросам. */
export function faqAnswer(text: string, s: Settings): ChatResult {
  const t = text.toLowerCase();
  if (/(запис|пробн|хочу.*урок|жазыл)/.test(t))
    return { answer: `Конечно! Пробный урок — ${s.trial.price}, ${s.trial.durationMin} минут. Нажмите «Записаться», чтобы выбрать время.`, escalate: false, book: true, via: "faq" };
  if (/(цен|стоим|сколько|прайс|баға|қанша)/.test(t) && s.courses.length)
    return {
      answer: s.courses.map((c) => `${c.name} (${c.for}) — ${c.price}`).join("\n"),
      escalate: false,
      book: true,
      via: "faq",
    };
  if (/(адрес|где вы|находит|мекенжай|график|режим|часы работ)/.test(t))
    return { answer: `${s.address}. ${s.hours}.`, escalate: false, book: false, via: "faq" };

  const q = words(text);
  let best: { a: string; score: number } = { a: "", score: 0 };
  for (const f of s.faq) {
    const fw = words(f.q + " " + f.a);
    const score = [...q].filter((w) => fw.has(w)).length;
    if (score > best.score) best = { a: f.a, score };
  }
  if (best.score > 0) return { answer: best.a, escalate: false, book: false, via: "faq" };
  return {
    answer: "Уточню у администратора и вернусь с ответом. Оставьте телефон — вам перезвонят.",
    escalate: true,
    book: false,
    via: "faq",
  };
}

export async function chatAnswer(history: ChatTurn[], s: Settings): Promise<ChatResult> {
  const last = history.at(-1)?.content ?? "";
  if (!process.env.ANTHROPIC_API_KEY) return faqAnswer(last, s);

  const client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  for (const model of MODELS()) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 400,
        system: systemPrompt(s),
        messages: history,
      });
      let text = msg.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      const escalate = text.includes("[ADMIN]");
      const book = text.includes("[BOOK]");
      text = text.replace(/\[(ADMIN|BOOK)\]/g, "").trim();
      if (text) return { answer: text, escalate, book, via: "ai", model };
    } catch (e: any) {
      console.error(`chat model ${model} failed:`, e?.status ?? "", e?.message ?? e);
      if (e?.status && e.status !== 404 && e.status !== 400) break; // не модель, а сбой — не перебираем дальше
    }
  }
  return faqAnswer(last, s);
}
