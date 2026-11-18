import type { Config } from "@netlify/functions";
import { centersStore, siteUrl, type Center } from "../lib/core.mts";
import { notifyDigest } from "../lib/notify.mts";
import { listSubs, pushConfigured } from "../lib/push.mts";
import { ensureWebhook, tgConfigured } from "../lib/telegram.mts";

// Утренняя сводка администраторам — в Telegram и push в приложение кабинета:
// заявки за ночь, пробные на сегодня, вопросы без ответа.
// 04:00 UTC = 09:00 в Астане (UTC+5, без перехода на летнее время).

export default async () => {
  if (tgConfigured()) {
    try {
      await ensureWebhook(siteUrl());
    } catch (e: any) {
      console.error("webhook check failed:", e?.message);
    }
  }
  const { blobs } = await centersStore().list();
  for (const b of blobs) {
    const center = (await centersStore().get(b.key, { type: "json" })) as Center | null;
    if (!center) continue;
    const hasTg = tgConfigured() && !!center.telegram?.chats.length;
    const hasPush = pushConfigured() && (await listSubs(center.slug)).some((s) => s.events.digest);
    if (!hasTg && !hasPush) continue;
    try {
      await notifyDigest(center);
    } catch (e: any) {
      console.error(`digest for ${b.key} failed:`, e?.message);
    }
  }
};

export const config: Config = { schedule: "0 4 * * *" };
