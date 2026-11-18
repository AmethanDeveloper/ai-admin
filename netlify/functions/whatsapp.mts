import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { getCenter, waNumbersStore, waSeenStore } from "../lib/core.mts";
import { handleIncoming, verifySignature, type Incoming } from "../lib/whatsapp.mts";

// Вебхук WhatsApp Cloud API. URL для Meta: https://<сайт>/api/whatsapp/webhook
// GET  — проверка Meta (hub.verify_token = env WA_VERIFY_TOKEN)
// POST — входящие сообщения; подпись X-Hub-Signature-256 проверяется секретом приложения Meta
//        (appSecret центра или env WA_APP_SECRET).

function verifyToken(got: string | null): boolean {
  const want = Netlify.env.get("WA_VERIFY_TOKEN") || "";
  if (want.length < 12 || !got || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function handleWebhook(raw: string, signature: string | null) {
  let body: any;
  try { body = JSON.parse(raw); } catch { return; }
  if (body?.object !== "whatsapp_business_account") return;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value ?? {};
      const messages: Incoming[] = v.messages ?? [];
      if (!messages.length) continue; // статусы доставки нам не нужны
      const pnid = String(v.metadata?.phone_number_id ?? "");
      const slug = pnid ? await waNumbersStore().get(pnid, { type: "text" }) : null;
      const center = slug ? await getCenter(slug) : null;
      const cfg = center?.whatsapp;
      if (!center || !cfg?.enabled || cfg.phoneNumberId !== pnid) {
        console.warn(`whatsapp: номер ${pnid} не привязан ни к одному центру`);
        continue;
      }
      const secret = cfg.appSecret || Netlify.env.get("WA_APP_SECRET") || "";
      if (!verifySignature(raw, signature, secret)) {
        console.error(`whatsapp: неверная подпись запроса для ${slug}`);
        continue;
      }
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? "")]));
      for (const msg of messages) {
        const { modified } = await waSeenStore().set(String(msg.id), "1", { onlyIfNew: true });
        if (!modified) continue; // Meta прислала повтор
        try {
          await handleIncoming(center, cfg, msg, names.get(String(msg.from)) || undefined);
        } catch (e: any) {
          console.error(`whatsapp: ошибка обработки ${msg.id}:`, e?.message ?? e);
        }
      }
    }
  }
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && verifyToken(url.searchParams.get("hub.verify_token"));
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const work = handleWebhook(raw, req.headers.get("x-hub-signature-256")).catch((e) => console.error("whatsapp webhook:", e?.message ?? e));
  // Meta ждёт быстрый ответ 200, иначе повторяет доставку. Обрабатываем после ответа, если платформа умеет.
  if (typeof context.waitUntil === "function") context.waitUntil(work);
  else await work;
  return new Response("ok");
};

export const config: Config = { path: "/api/whatsapp/webhook" };
