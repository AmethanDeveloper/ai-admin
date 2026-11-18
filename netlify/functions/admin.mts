import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import {
  SLUG_RE, centersStore, clean, fail, getCenter, hashPassword, json, leadsStore, saveCenter, siteUrl, waNumbersStore,
  type Center, type WhatsAppConfig,
} from "../lib/core.mts";
import { blankSettings } from "../lib/seed.mts";
import { botUsername, ensureWebhook, tg, tgConfigured } from "../lib/telegram.mts";
import { listSubs, pushConfigured } from "../lib/push.mts";
import { sendTemplate } from "../lib/whatsapp.mts";

const mask = (v?: string) => (v ? `задан (…${v.slice(-4)})` : "");

async function centerDetails(c: Center) {
  const wa = c.whatsapp;
  return {
    slug: c.slug,
    name: c.settings.name,
    telegram: c.telegram?.chats ?? [],
    push: (await listSubs(c.slug)).map((s) => ({ device: s.device, createdAt: s.createdAt })),
    whatsapp: wa
      ? { enabled: wa.enabled, phoneNumberId: wa.phoneNumberId, displayPhone: wa.displayPhone, accessToken: mask(wa.accessToken),
          appSecret: mask(wa.appSecret), reminderTemplate: wa.reminderTemplate ?? "", templateLang: wa.templateLang ?? "ru" }
      : null,
  };
}

/** Доступ к управлению центрами — только по ключу SUPERADMIN_KEY из переменных окружения Netlify. */
function authorized(req: Request): boolean {
  const want = Netlify.env.get("SUPERADMIN_KEY") ?? "";
  const got = req.headers.get("x-admin-key") ?? "";
  if (want.length < 12 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async (req: Request) => {
  try {
    if (!authorized(req)) {
      await new Promise((r) => setTimeout(r, 600));
      return fail("Нет доступа", 401);
    }
    const parts = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
    const [section, slugParam, action] = parts;
    let b: any = {};
    if (req.method !== "GET") b = await req.json().catch(() => ({}));

    if (req.method === "GET" && section === "config") {
      const site = siteUrl(req);
      let username = "", webhook = "";
      if (tgConfigured()) {
        try {
          username = await botUsername();
          webhook = (await tg<{ url: string }>("getWebhookInfo")).url;
        } catch (e: any) { webhook = `ошибка: ${e?.message}`; }
      }
      return json({
        site,
        whatsapp: {
          webhookUrl: `${site}/api/whatsapp/webhook`,
          verifyToken: Netlify.env.get("WA_VERIFY_TOKEN") || "",
          appSecretSet: !!Netlify.env.get("WA_APP_SECRET"),
          tokenSet: !!Netlify.env.get("WA_TOKEN"),
        },
        telegram: { configured: tgConfigured(), username, webhook, expected: `${site}/api/telegram/webhook` },
        push: { configured: pushConfigured() },
      });
    }

    if (req.method === "POST" && section === "telegram" && slugParam === "setup") {
      if (!tgConfigured()) return fail("Не задан TELEGRAM_BOT_TOKEN");
      return json({ result: await ensureWebhook(siteUrl(req)) });
    }

    if (section !== "centers") return fail("Не найдено", 404);

    if (req.method === "GET" && slugParam && !action) {
      const center = await getCenter(slugParam);
      return center ? json(await centerDetails(center)) : fail("Центр не найден", 404);
    }

    if (req.method === "POST" && slugParam && action === "whatsapp" && !parts[3]) {
      const center = await getCenter(slugParam);
      if (!center) return fail("Центр не найден", 404);
      const prev = center.whatsapp;
      const phoneNumberId = clean(b.phoneNumberId, 40).replace(/\D/g, "");
      if (b.enabled && !phoneNumberId) return fail("Укажите Phone number ID из Meta");
      if (phoneNumberId) {
        const owner = await waNumbersStore().get(phoneNumberId, { type: "text" });
        if (owner && owner !== center.slug) return fail(`Этот номер уже привязан к центру ${owner}`, 409);
      }
      const next: WhatsAppConfig = {
        enabled: !!b.enabled,
        phoneNumberId,
        displayPhone: clean(b.displayPhone, 30),
        accessToken: clean(b.accessToken, 600) || prev?.accessToken,
        appSecret: clean(b.appSecret, 100) || prev?.appSecret,
        reminderTemplate: clean(b.reminderTemplate, 100).replace(/[^a-z0-9_]/g, "") || undefined,
        templateLang: clean(b.templateLang, 10) || "ru",
      };
      if (b.clearToken) next.accessToken = undefined;
      if (b.clearSecret) next.appSecret = undefined;
      if (prev?.phoneNumberId && prev.phoneNumberId !== phoneNumberId) await waNumbersStore().delete(prev.phoneNumberId);
      if (phoneNumberId) await waNumbersStore().set(phoneNumberId, center.slug);
      center.whatsapp = next;
      await saveCenter(center);
      return json(await centerDetails(center));
    }

    if (req.method === "POST" && slugParam && action === "whatsapp" && parts[3] === "test") {
      const center = await getCenter(slugParam);
      if (!center?.whatsapp?.phoneNumberId) return fail("Сначала сохраните настройки WhatsApp");
      const to = clean(b.to, 20).replace(/\D/g, "");
      if (to.length < 10) return fail("Укажите номер получателя");
      try {
        await sendTemplate(center.whatsapp, to, "hello_world", "en_US", []);
        return json({ ok: true });
      } catch (e: any) {
        return fail(e?.message || "Не удалось отправить", 502);
      }
    }

    if (req.method === "GET" && !slugParam) {
      const { blobs } = await centersStore().list();
      const leads = await leadsStore().list();
      const count = new Map<string, number>();
      for (const l of leads.blobs) {
        const c = l.key.split("/")[0];
        count.set(c, (count.get(c) ?? 0) + 1);
      }
      const centers = await Promise.all(
        blobs.map(async (x) => {
          const c = (await centersStore().get(x.key, { type: "json" })) as Center | null;
          return c && { slug: c.slug, name: c.settings.name, createdAt: c.createdAt, leads: count.get(c.slug) ?? 0 };
        }),
      );
      return json({ centers: centers.filter(Boolean) });
    }

    if (req.method === "POST" && !slugParam) {
      const slug = clean(b.slug, 40).toLowerCase();
      const name = clean(b.name, 80);
      const password = String(b.password ?? "");
      if (!SLUG_RE.test(slug)) return fail("Код центра: латиница, цифры и дефис, от 2 до 40 символов");
      if (!name) return fail("Укажите название центра");
      if (password.length < 8) return fail("Пароль — минимум 8 символов");
      if (await centersStore().get(slug, { type: "text" })) return fail("Такой код уже занят", 409);
      const center: Center = {
        slug,
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword(password),
        settings: blankSettings(name),
      };
      const { modified } = await centersStore().setJSON(slug, center, { onlyIfNew: true });
      if (!modified) return fail("Такой код уже занят", 409);
      return json({ ok: true, slug });
    }

    if (req.method === "POST" && slugParam && action === "password") {
      const center = await getCenter(slugParam);
      if (!center) return fail("Центр не найден", 404);
      const password = String(b.password ?? "");
      if (password.length < 8) return fail("Пароль — минимум 8 символов");
      center.passwordHash = hashPassword(password);
      await saveCenter(center);
      return json({ ok: true });
    }

    return fail("Не найдено", 404);
  } catch (e) {
    console.error(e);
    return fail("Ошибка сервера", 500);
  }
};

export const config: Config = { path: "/api/admin/*" };
