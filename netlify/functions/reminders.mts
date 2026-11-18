import type { Config } from "@netlify/functions";
import { HOLDS_SLOT, centersStore, followUpDue, followUpOf, followUpText, formatSlot, listLeads, saveLead, type Center, type Lead } from "../lib/core.mts";
import { inServiceWindow, sendButtons, sendTemplate } from "../lib/whatsapp.mts";

// Напоминания о пробном уроке клиентам из WhatsApp: за сутки и за 2 часа.
// Внутри 24-часового окна (клиент писал недавно) — обычное сообщение с кнопками,
// вне окна — только одобренный в Meta шаблон (settings центра: reminderTemplate).
// Плюс дожим после пробного (пришёл и не купил / не пришёл) — тоже только клиентам из WhatsApp,
// только внутри 24-часового окна и днём (10:00–20:00 по времени центра). Остальных дожимает
// администратор из кабинета (карточка «Дожать» на сводке).
// Каждые 30 минут.

const H = 3600e3;

async function remind(center: Center, lead: Lead, kind: "24" | "2") {
  const cfg = center.whatsapp!;
  const label = formatSlot(lead.slot);
  const s = center.settings;
  if (await inServiceWindow(center.slug, lead.waId!)) {
    const text = kind === "24"
      ? `Напоминаем: пробный урок в «${s.name}» — *${label}*.${s.address ? `\nАдрес: ${s.address}` : ""}\n\nПридёте?`
      : `Через 2 часа пробный урок в «${s.name}» — *${label}*.${s.address ? `\nАдрес: ${s.address}` : ""}`;
    await sendButtons(cfg, lead.waId!, text, [
      { id: `rem_ok_${lead.id}`, title: "Приду" },
      { id: `rem_move_${lead.id}`, title: "Перенести" },
      { id: `rem_cancel_${lead.id}`, title: "Отменить" },
    ]);
    return "message";
  }
  if (cfg.reminderTemplate) {
    // Шаблон в Meta: {{1}} — время урока, {{2}} — название центра, {{3}} — адрес
    await sendTemplate(cfg, lead.waId!, cfg.reminderTemplate, cfg.templateLang || "ru", [label, s.name, s.address || "уточнит администратор"]);
    return "template";
  }
  return "skipped";
}

/** Дожим в WhatsApp. true — отправлено; false — нельзя писать без шаблона (останется администратору). */
async function followUp(center: Center, lead: Lead, kind: "came" | "noshow"): Promise<boolean> {
  if (!(await inServiceWindow(center.slug, lead.waId!))) return false;
  lead.followUp = { at: new Date().toISOString(), by: "auto", status: lead.status };
  await saveLead(lead); // отмечаем до отправки, чтобы при сбое не написать дважды
  const buttons = kind === "came"
    ? [{ id: `fu_buy_${lead.id}`, title: "Хочу в группу" }, { id: "fu_q", title: "Есть вопрос" }]
    : [{ id: `rem_move_${lead.id}`, title: "Выбрать время" }, { id: `fu_no_${lead.id}`, title: "Не нужно" }];
  await sendButtons(center.whatsapp!, lead.waId!, followUpText(center, lead, kind), buttons);
  return true;
}

/** Час по местному времени центра. */
const localHour = (center: Center) => new Date(Date.now() + center.settings.utcOffset * 3600e3).getUTCHours();

export default async () => {
  const { blobs } = await centersStore().list();
  const now = Date.now();
  for (const b of blobs) {
    const center = (await centersStore().get(b.key, { type: "json" })) as Center | null;
    if (!center?.whatsapp?.enabled) continue;
    const leads = (await listLeads(center.slug)).filter((l) => l.channel === "whatsapp" && l.waId && l.slot && HOLDS_SLOT.includes(l.status));
    for (const lead of leads) {
      const left = new Date(lead.slot!).getTime() - now;
      let kind: "24" | "2" | null = null;
      if (!lead.reminded2 && left > 0 && left <= 2 * H) kind = "2";
      else if (!lead.reminded24 && left > 3 * H && left <= 24 * H) kind = "24";
      if (!kind) continue;
      // отмечаем до отправки, чтобы при сбое не слать дважды
      if (kind === "2") lead.reminded2 = lead.reminded24 = true;
      else lead.reminded24 = true;
      await saveLead(lead);
      try {
        const how = await remind(center, lead, kind);
        console.log(`reminder ${kind}h ${center.slug}/${lead.id}: ${how}`);
      } catch (e: any) {
        console.error(`reminder ${center.slug}/${lead.id} failed:`, e?.message);
      }
    }

    if (!followUpOf(center.settings).auto) continue;
    // часы, когда бот дожимает сам (по времени центра); env FOLLOWUP_HOURS="10-20" — для тестов можно "0-24"
    const [from, to] = (Netlify.env.get("FOLLOWUP_HOURS") || "10-20").split("-").map(Number);
    const h = localHour(center);
    if (h < from || h >= to) continue;
    for (const lead of await listLeads(center.slug)) {
      if (lead.channel !== "whatsapp" || !lead.waId) continue;
      const kind = followUpDue(lead, now);
      if (kind !== "came" && kind !== "noshow") continue;
      try {
        const sent = await followUp(center, lead, kind);
        if (sent) console.log(`follow-up ${kind} ${center.slug}/${lead.id}`);
      } catch (e: any) {
        console.error(`follow-up ${center.slug}/${lead.id} failed:`, e?.message);
      }
    }
  }
};

export const config: Config = { schedule: "*/30 * * * *" };
