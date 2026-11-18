import type { Center, Lead, Question } from "./core.mts";
import { pushDigest, pushLead, pushQuestion } from "./push.mts";
import * as tg from "./telegram.mts";

// Единая точка уведомлений администратора: Telegram + push в приложение кабинета.
// Каналы независимы — ошибка одного не мешает другому.

const both = async (...jobs: Promise<unknown>[]) => {
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === "rejected") console.error("notify:", (r.reason as any)?.message ?? r.reason);
  }
};

export const notifyLead = (center: Center, lead: Lead, title?: string) =>
  both(tg.notifyLead(center, lead, title), pushLead(center, lead, title));

export const notifyQuestion = (center: Center, q: Question, contact?: string) =>
  both(tg.notifyQuestion(center, q, contact), pushQuestion(center, q));

export async function notifyDigest(center: Center) {
  const data = await tg.digestData(center);
  await both(
    tg.sendDigest(center, data),
    pushDigest(center, { night: data.night.length, today: data.today.length, fresh: data.fresh, open: data.open, follow: data.follow }),
  );
}
