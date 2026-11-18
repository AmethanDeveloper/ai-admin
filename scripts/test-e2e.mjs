// Сквозная проверка без интернета: локальный сервер + поддельные API Telegram и Meta (WhatsApp).
// Запуск: npm test (Node 22+). Данные теста пишутся в .local-blobs-test/ и стираются перед каждым запуском.
import http from "node:http";
import { spawn } from "node:child_process";
import { createECDH, createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const webpush = require("web-push");
const ece = require("http_ece");
const VAPID = webpush.generateVAPIDKeys();
const SITE = "http://localhost:8890";
const MOCK = 9999;
const ENV = {
  SUPERADMIN_KEY: "test-superadmin-key-123",
  TELEGRAM_BOT_TOKEN: "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  TELEGRAM_WEBHOOK_SECRET: "tg-secret-0123456789",
  WA_VERIFY_TOKEN: "wa-verify-0123456789",
  WA_APP_SECRET: "app-secret-xyz",
  TELEGRAM_API_BASE: `http://localhost:${MOCK}`,
  WA_GRAPH_BASE: `http://localhost:${MOCK}`,
  URL: SITE,
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_KEY: VAPID.privateKey,
  VAPID_SUBJECT: "mailto:test@example.com",
  PUSH_ALLOW_HOSTS: `localhost:${MOCK}`,
  FOLLOWUP_HOURS: "0-24",
  BLOB_DIR: path.join(ROOT, ".local-blobs-test"),
};

// ---------- поддельные API
const calls = [];
const migrate = { from: 0, to: 0 };
let msgId = 100;
http.createServer(async (req, res) => {
  let body = "";
  req.setEncoding("latin1");
  for await (const c of req) body += c;
  const url = req.url;
  if (url.startsWith("/push/")) {
    const raw = Buffer.from(body, "latin1");
    calls.push({ api: "push", path: url, headers: req.headers, raw });
    res.statusCode = url.startsWith("/push/gone") ? 410 : 201;
    res.end();
    return;
  }
  const data = body ? JSON.parse(Buffer.from(body, "latin1").toString("utf8")) : {};
  let result = true;
  if (url.includes("/bot")) {
    const method = url.split("/").pop();
    calls.push({ api: "tg", method, data });
    if (method === "sendMessage" && data.chat_id === migrate.from) {
      res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: migrate.to } }));
      return;
    }
    if (method === "getMe") result = { username: "ai_administrator_kz_bot" };
    else if (method === "getWebhookInfo") result = { url: calls.some((c) => c.method === "setWebhook") ? `${SITE}/api/telegram/webhook` : "" };
    else if (method === "sendMessage") result = { message_id: ++msgId };
    res.end(JSON.stringify({ ok: true, result }));
  } else {
    calls.push({ api: "wa", path: url, data, auth: req.headers.authorization });
    res.end(JSON.stringify({ messages: [{ id: `wamid.out${++msgId}` }] }));
  }
}).listen(MOCK);

// ---------- локальный сервер
await import("node:fs/promises").then((fs) => fs.rm(ENV.BLOB_DIR, { recursive: true, force: true }));
const srv = spawn("node", ["--experimental-strip-types", "scripts/local-dev.mjs", ROOT, "8890"], { cwd: ROOT, env: { ...process.env, ...ENV }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
srv.stdout.on("data", (d) => (log += d));
srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 50 && !log.includes("dev on"); i++) await new Promise((r) => setTimeout(r, 200));

const J = async (path, { method, body, headers = {}, raw } = {}) => {
  const res = await fetch(SITE + path, { method: method || (body !== undefined || raw ? "POST" : "GET"), headers: { "content-type": "application/json", ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};
const since = (n) => calls.slice(n);
const tgUpdate = (update) => J("/api/telegram/webhook", { body: update, headers: { "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET } });
const waPost = (messages, { from = "77011234567", name = "Айгерим", secret = ENV.WA_APP_SECRET, pnid = "1111" } = {}) => {
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { phone_number_id: pnid, display_phone_number: "77000000000" },
    contacts: [{ wa_id: from, profile: { name } }], messages: messages.map((m) => ({ from, timestamp: "1", ...m })) } }] }] });
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return J("/api/whatsapp/webhook", { raw, headers: { "x-hub-signature-256": sig } });
};
let mid = 0;
const text = (body) => ({ id: `wamid.in${++mid}`, type: "text", text: { body } });
const btn = (id) => ({ id: `wamid.in${++mid}`, type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: id } } });
const row = (id) => ({ id: `wamid.in${++mid}`, type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: id } } });
const waSent = (from) => since(from).filter((c) => c.api === "wa" && c.data.type);
const tgSent = (from, method = "sendMessage") => since(from).filter((c) => c.api === "tg" && c.method === method);
const show = (c) => c.data.type === "interactive" ? `[${c.data.interactive.type}] ${c.data.interactive.body.text.slice(0, 60).replace(/\n/g, " ")} | ${(c.data.interactive.action.buttons || c.data.interactive.action.sections[0].rows).map((b) => b.reply?.title || b.title).join(" / ")}` : `[${c.data.type}] ${(c.data.text?.body || c.data.template?.name || "").slice(0, 70).replace(/\n/g, " ")}`;

try {
  // 1. вход и привязка Telegram
  const { json: login } = await J("/api/login", { body: { center: "brightway", password: "demo2026" } });
  const auth = { authorization: `Bearer ${login.token}` };
  const { json: link } = await J("/api/cabinet/telegram", { method: "POST", headers: auth });
  assert.match(link.url, /^https:\/\/t\.me\/ai_administrator_kz_bot\?start=[\w-]+$/);
  const code = link.url.split("start=")[1];
  assert.equal((await tgUpdate({ message: { chat: { id: 555 }, from: { first_name: "Админ" }, text: "/start" } })).status, 200);
  assert.equal((await J("/api/telegram/webhook", { body: {}, headers: { "x-telegram-bot-api-secret-token": "wrong" } })).status, 403);
  let n = calls.length;
  await tgUpdate({ message: { chat: { id: 555 }, from: { first_name: "Админ", username: "admin" }, text: `/start ${code}` } });
  assert.match(tgSent(n)[0].data.text, /Готово/);
  const { json: me } = await J("/api/cabinet/me", { headers: auth });
  assert.equal(me.integrations.telegram.chats[0].id, 555);
  console.log("✓ Telegram привязан:", me.integrations.telegram.chats[0].name);
  n = calls.length;
  await tgUpdate({ message: { chat: { id: 777 }, text: `/start ${code}` } });
  assert.match(tgSent(n)[0].data.text, /устарела/);
  console.log("✓ повторное использование кода отклонено");

  // группа: /start@бот <код>, затем группа становится супергруппой
  const { json: glink } = await J("/api/cabinet/telegram", { method: "POST", headers: auth });
  const gcode = glink.url.split("start=")[1];
  await tgUpdate({ message: { chat: { id: -100, type: "group", title: "Ресепшен" }, from: { first_name: "Админ" }, text: `/start@ai_administrator_kz_bot ${gcode}` } });
  let ig2 = (await J("/api/cabinet/me", { headers: auth })).json.integrations.telegram.chats;
  assert.ok(ig2.some((c) => c.id === -100 && c.name === "Группа «Ресепшен»"));
  migrate.from = -100; migrate.to = -1009;
  n = calls.length;
  await J("/api/book", { body: { center: "brightway", type: "callback", name: "Тест", phone: "87010000000", consent: true } });
  assert.ok(tgSent(n).some((c) => c.data.chat_id === -1009));
  ig2 = (await J("/api/cabinet/me", { headers: auth })).json.integrations.telegram.chats;
  assert.ok(ig2.some((c) => c.id === -1009) && !ig2.some((c) => c.id === -100));
  await J("/api/cabinet/telegram/-1009", { method: "DELETE", headers: auth });
  console.log("✓ рабочая группа подключается, переход в супергруппу не ломает уведомления");

  // оформление чата: цвет, шапка, логотип; виджет ходит в API с чужих сайтов (CORS)
  {
    const { json: pubB } = await J("/api/public/brightway");
    assert.equal(pubB.name, "Bright English");
    assert.deepEqual(pubB.brand, { color: "#D63D32", header: "brand", pattern: "none", logo: "/assets/bright-english-mark.svg" });
    assert.ok(pubB.faq.length >= 3 && pubB.faq[0].q && pubB.faq[0].a);
    const pre = await fetch(SITE + "/api/book", { method: "OPTIONS", headers: { origin: "https://school.kz", "access-control-request-method": "POST" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    const get = await fetch(SITE + "/api/public/brightway", { headers: { origin: "https://school.kz" } });
    assert.equal(get.headers.get("access-control-allow-origin"), "*");
    const lg = await fetch(SITE + "/api/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
    assert.equal(lg.headers.get("access-control-allow-origin"), null);
    console.log("✓ демо-центр Bright English с логотипом и цветами; API открыт для виджета, вход в кабинет — нет");

    const me0 = (await J("/api/cabinet/me", { headers: auth })).json;
    const put = await J("/api/cabinet/settings", { method: "PUT", headers: auth, body: { settings: { ...me0.settings, brand: { color: "red;}", header: "x", pattern: "zz", logo: "/etc/passwd" } } } });
    assert.deepEqual(put.json.settings.brand, { color: "#D63D32", header: "brand", pattern: "none", logo: "/assets/bright-english-mark.svg" });
    const put2 = await J("/api/cabinet/settings", { method: "PUT", headers: auth, body: { settings: { ...me0.settings, brand: { color: "#be185d", header: "light", pattern: "none" } } } });
    assert.equal(put2.json.settings.brand.color, "#BE185D");
    assert.equal(put2.json.settings.brand.logo, "/assets/bright-english-mark.svg");
    console.log("✓ оформление сохраняется, мусор в цвете и логотипе отбрасывается");

    // настоящий PNG 1×1
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    assert.equal((await J("/api/cabinet/logo", { headers: auth, body: { data: "data:image/svg+xml;base64,PHN2Zy8+" } })).status, 400);
    assert.equal((await J("/api/cabinet/logo", { headers: auth, body: { data: "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64") } })).status, 400);
    const up = await J("/api/cabinet/logo", { headers: auth, body: { data: "data:image/png;base64," + png } });
    assert.equal(up.status, 200);
    assert.match(up.json.logoUrl, /^\/api\/public\/brightway\/logo\?v=\w+$/);
    const img = await fetch(SITE + up.json.logoUrl);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await img.arrayBuffer()).toString("base64"), png);
    assert.equal((await J("/api/public/brightway")).json.brand.logo, up.json.logoUrl);
    await J("/api/cabinet/logo", { method: "DELETE", headers: auth });
    assert.equal((await J("/api/public/brightway")).json.brand.logo, "");
    assert.equal((await fetch(SITE + "/api/public/brightway/logo")).status, 404);
    // вернуть демо как было
    await J("/api/cabinet/settings", { method: "PUT", headers: auth, body: { settings: { ...me0.settings, brand: { color: "#D63D32", header: "brand", pattern: "none" } } } });
    console.log("✓ логотип: загрузка, отдача, удаление; SVG и подделки под картинку не принимаются");
  }

  // push-уведомления в установленное приложение кабинета
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") };
  const decrypt = (c) => JSON.parse(ece.decrypt(c.raw, { version: "aes128gcm", privateKey: ecdh, authSecret }).toString());
  const pushSent = (from) => since(from).filter((c) => c.api === "push" && c.path === "/push/phone");
  assert.equal((await J("/api/cabinet/push", { body: { subscription: { endpoint: "https://evil.example/x", keys }, device: "x" }, headers: auth })).status, 400);
  const { json: ps } = await J("/api/cabinet/push", { body: { subscription: { endpoint: `http://localhost:${MOCK}/push/phone`, keys }, device: "iPhone · приложение" }, headers: auth });
  assert.equal(ps.devices.length, 1);
  assert.ok(!JSON.stringify(ps).includes(keys.p256dh));
  n = calls.length;
  assert.equal((await J(`/api/cabinet/push/${ps.id}/test`, { method: "POST", headers: auth })).status, 200);
  let pc = pushSent(n)[0];
  assert.equal(pc.headers["content-encoding"], "aes128gcm");
  assert.match(pc.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  assert.equal(decrypt(pc).title, "Уведомления работают");
  console.log("✓ push: подписка сохранена, проверочное уведомление зашифровано и расшифровывается");
  // чужой адрес подписки сервер не примет; отписавшееся устройство (410) удаляется само
  const { json: gone } = await J("/api/cabinet/push", { body: { subscription: { endpoint: `http://localhost:${MOCK}/push/gone`, keys }, device: "Старый телефон" }, headers: auth });
  assert.equal(gone.devices.length, 2);
  assert.equal((await J(`/api/cabinet/push/${gone.id}/test`, { method: "POST", headers: auth })).status, 502);
  assert.equal((await J("/api/cabinet/me", { headers: auth })).json.integrations.push.devices.length, 1);
  console.log("✓ push: устройство, которое отписалось, удаляется автоматически");

  // 2. запись с сайта → уведомление с кнопками
  const { json: pub } = await J("/api/public/brightway");
  n = calls.length;
  const { json: booked } = await J("/api/book", { body: { center: "brightway", type: "trial", student: "Взрослый", course: "Разговорный английский", slot: pub.slots[0].iso, name: "Ерлан", phone: "87011112233", consent: true, source: "QR-код" } });
  const note = tgSent(n)[0];
  assert.equal(note.data.chat_id, 555);
  assert.match(note.data.text, /Запись на пробный урок/);
  assert.equal(note.data.reply_markup.inline_keyboard.length, 3);
  console.log("✓ заявка с сайта пришла в Telegram:", note.data.text.split("\n")[2]);
  const pl = decrypt(pushSent(n).at(-1));
  assert.equal(pl.title, "Запись на пробный");
  assert.equal(pl.url, "/cabinet/#leads");
  assert.ok(pl.badge >= 1);
  console.log("✓ и push на телефон:", pl.title, "—", pl.body);
  // администратор выключил на устройстве заявки — push не приходит, Telegram приходит
  await J(`/api/cabinet/push/${ps.id}`, { method: "PATCH", body: { events: { leads: false } }, headers: auth });
  n = calls.length;
  await J("/api/book", { body: { center: "brightway", type: "callback", name: "Без пуша", phone: "87010000001", consent: true } });
  assert.equal(pushSent(n).length, 0);
  assert.equal(tgSent(n).length, 1);
  await J(`/api/cabinet/push/${ps.id}`, { method: "PATCH", body: { events: { leads: true } }, headers: auth });
  console.log("✓ выбор событий на устройстве соблюдается");

  // 3. кнопка статуса
  const cbData = note.data.reply_markup.inline_keyboard[0][1].callback_data; // «Пришёл»
  n = calls.length;
  await tgUpdate({ callback_query: { id: "cb1", data: cbData, message: { message_id: 101, chat: { id: 555 } } } });
  assert.match(tgSent(n, "editMessageText")[0].data.text, /Статус: <b>пришёл<\/b>/);
  assert.equal((await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === booked.id).status, "пришёл");
  n = calls.length;
  await tgUpdate({ callback_query: { id: "cb2", data: cbData, message: { message_id: 101, chat: { id: 999 } } } });
  assert.match(tgSent(n, "answerCallbackQuery")[0].data.text, /не подключён/);
  console.log("✓ статус меняется кнопкой, чужой чат не может менять");

  // 4. /today
  n = calls.length;
  await tgUpdate({ message: { chat: { id: 555 }, text: "/today" } });
  assert.match(tgSent(n)[0].data.text, /Пробные уроки/);
  console.log("✓ /today отвечает");

  // 5. настройка WhatsApp в админке
  const K = { "x-admin-key": ENV.SUPERADMIN_KEY };
  const { status: waSave, json: waCfg } = await J("/api/admin/centers/brightway/whatsapp", { body: { enabled: true, phoneNumberId: "1111", displayPhone: "+7 700 000 00 00", accessToken: "wa-access-token" }, headers: K });
  assert.equal(waSave, 200);
  assert.match(waCfg.whatsapp.accessToken, /задан/);
  const { json: cfg } = await J("/api/admin/config", { headers: K });
  assert.equal(cfg.whatsapp.verifyToken, ENV.WA_VERIFY_TOKEN);
  console.log("✓ WhatsApp настроен, токен в ответе скрыт:", waCfg.whatsapp.accessToken);

  // 6. проверка вебхука Meta
  const ver = await J(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${ENV.WA_VERIFY_TOKEN}&hub.challenge=4242`);
  assert.equal(ver.json, 4242);
  assert.equal((await J(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1`)).status, 403);
  n = calls.length;
  await waPost([text("Здравствуйте")], { secret: "wrong" });
  assert.equal(waSent(n).length, 0);
  console.log("✓ проверка Meta проходит, запрос с неверной подписью игнорируется");

  // 7. диалог записи в WhatsApp
  const step = async (m, label) => { const k = calls.length; await waPost([m]); const out = waSent(k); console.log(`  ${label} →`, out.map(show).join("  ||  ") || "(нет ответа)"); return out; };
  console.log("Диалог в WhatsApp:");
  let out = await step(text("Здравствуйте"), "Здравствуйте");
  assert.equal(out[0].data.interactive.type, "button");
  assert.equal(out[0].auth, "Bearer wa-access-token");
  out = await step(btn("book"), "Записаться");
  assert.equal(out[0].data.interactive.type, "list");
  out = await step(row("st_0"), "Ребёнок");
  out = await step(row("co_0"), "Курс");
  const slotRows = out[0].data.interactive.action.sections[0].rows;
  assert.ok(slotRows.length >= 2);
  out = await step(row("sl_0"), "Слот");
  assert.match(out[0].data.interactive.body.text, /Айгерим \(из профиля WhatsApp\)/);
  assert.match(out[0].data.interactive.body.text, /privacy/);
  n = calls.length;
  out = await step(btn("cf_yes"), "Подтвердить");
  assert.match(out[0].data.text.body, /Готово/);
  const waLeadNote = tgSent(n)[0];
  assert.match(waLeadNote.data.text, /WhatsApp/);
  console.log("✓ запись из WhatsApp пришла в Telegram");

  // повтор того же сообщения от Meta
  const dup = text("повтор");
  await waPost([dup]);
  n = calls.length;
  await waPost([dup]);
  assert.equal(waSent(n).length, 0);
  console.log("✓ повтор сообщения от Meta не обрабатывается дважды");

  // 8. вопрос без ответа → передать администратору
  out = await step(text("Сделаете скидку 50% если приведу троих друзей?"), "Вопрос про скидку");
  assert.ok(out.some((c) => c.data.interactive?.action?.buttons?.some((b) => b.reply.id === "esc_yes")));
  n = calls.length;
  out = await step(btn("esc_yes"), "Передать");
  assert.match(tgSent(n)[0].data.text, /Просит перезвонить/);
  console.log("✓ вопрос передан администратору в Telegram");

  // 9. напоминание и подтверждение
  const leads = (await J("/api/cabinet/leads", { headers: auth })).json.leads;
  const waLead = leads.find((l) => l.channel === "whatsapp" && l.type === "trial");
  assert.equal(waLead.waId, "77011234567");
  // сдвигаем урок на «через 20 часов» прямо в хранилище, чтобы сработало напоминание за сутки
  const bport = Number(log.match(/blobs on (\d+)/)[1]);
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, siteID: "local", token: "local-token" })).toString("base64");
  const { getStore } = await import(new URL(`file://${ROOT}/node_modules/@netlify/blobs/dist/main.js`).href);
  const leadsSt = getStore({ name: "leads", consistency: "strong" });
  const local = new Date(Date.now() + 20 * 3600e3 + 5 * 3600e3).toISOString().slice(0, 16);
  await leadsSt.setJSON(`brightway/${waLead.id}`, { ...waLead, slot: `${local}:00+05:00` });
  n = calls.length;
  await J("/__cron/reminders");
  const rem = waSent(n);
  console.log("  напоминание:", rem.map(show).join(" || "));
  assert.equal(rem.length, 1);
  assert.ok(rem[0].data.interactive.action.buttons.some((b) => b.reply.id === `rem_ok_${waLead.id}`));
  n = calls.length;
  await J("/__cron/reminders");
  assert.equal(waSent(n).length, 0);
  console.log("✓ напоминание за сутки отправлено один раз");
  n = calls.length;
  out = await step(btn(`rem_ok_${waLead.id}`), "Приду");
  const afterOk = (await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === waLead.id);
  assert.equal(afterOk.status, "подтвердил");
  console.log("✓ клиент подтвердил из WhatsApp, статус в кабинете:", afterOk.status);
  out = await step(btn(`rem_move_${waLead.id}`), "Перенести");
  assert.equal(out[0].data.interactive.type, "list");
  out = await step(row("sl_1"), "Новое время");
  const moved = (await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === waLead.id);
  assert.notEqual(moved.slot, `${local}:00+05:00`);
  console.log("✓ перенос через WhatsApp:", moved.slot);
  // вне 24-часового окна без шаблона — ничего не шлём
  const sess = getStore({ name: "wa-sessions", consistency: "strong" });
  const s0 = await sess.get(`brightway/77011234567`, { type: "json" });
  await sess.setJSON(`brightway/77011234567`, { ...s0, lastUserAt: new Date(Date.now() - 30 * 3600e3).toISOString() });
  const local2 = new Date(Date.now() + 90 * 60e3 + 5 * 3600e3).toISOString().slice(0, 16);
  const cur = (await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === waLead.id);
  await leadsSt.setJSON(`brightway/${waLead.id}`, { ...cur, slot: `${local2}:00+05:00`, reminded2: false });
  await J("/api/admin/centers/brightway/whatsapp", { body: { enabled: true, phoneNumberId: "1111", displayPhone: "+7 700 000 00 00", reminderTemplate: "trial_reminder", templateLang: "ru" }, headers: K });
  n = calls.length;
  await J("/__cron/reminders");
  const tpl = waSent(n);
  assert.equal(tpl[0]?.data.type, "template");
  console.log("✓ вне окна 24 ч уходит шаблон:", tpl[0].data.template.name, JSON.stringify(tpl[0].data.template.components[0].parameters.map((p) => p.text)));

  // 9б. дожим после пробного
  // WhatsApp-клиент пришёл на пробный 21 час назад и не купил → бот пишет сам (клиент писал недавно)
  await sess.setJSON(`brightway/77011234567`, { ...s0, lastUserAt: new Date().toISOString() });
  const curFu = (await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === waLead.id);
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  await leadsSt.setJSON(`brightway/${waLead.id}`, { ...curFu, status: "пришёл", history: [...curFu.history, { at: ago(21), status: "пришёл" }], followUp: undefined });
  n = calls.length;
  await J("/__cron/reminders");
  const fu = waSent(n).filter((c) => c.data.interactive?.action?.buttons?.some((b) => b.reply.id === `fu_buy_${waLead.id}`));
  assert.equal(fu.length, 1);
  assert.match(fu[0].data.interactive.body.text, /Спасибо, что пришли на пробный урок/);
  n = calls.length;
  await J("/__cron/reminders");
  assert.equal(waSent(n).filter((c) => c.data.interactive?.action?.buttons?.some((b) => b.reply.id.startsWith("fu_"))).length, 0);
  console.log("✓ дожим «пришёл, не купил» ушёл в WhatsApp один раз:", fu[0].data.interactive.body.text.slice(0, 60) + "…");
  n = calls.length;
  out = await step(btn(`fu_buy_${waLead.id}`), "Хочу в группу");
  const afterFu = (await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === waLead.id);
  assert.equal(afterFu.followUp.by, "auto");
  assert.match(afterFu.comment, /Хочет в группу/);
  assert.match(tgSent(n)[0].data.text, /Хочет в группу/);
  console.log("✓ «Хочу в группу» → комментарий в заявке и уведомление администратору");

  // заявка с сайта: не пришёл 3 часа назад → в сводке «дожать», администратор отмечает, что написал
  const bk = (await J("/api/cabinet/leads", { headers: auth })).json.leads.find((l) => l.id === booked.id);
  await leadsSt.setJSON(`brightway/${booked.id}`, { ...bk, status: "не пришёл", history: [...bk.history, { at: ago(3), status: "не пришёл" }] });

  // тексты дожима в настройках: свой текст сохраняется, пустой возвращает стандартный
  const me0 = (await J("/api/cabinet/me", { headers: auth })).json;
  assert.match(me0.settings.followUp.noshow, /Подобрать другое удобное время/);
  const put = await J("/api/cabinet/settings", { method: "PUT", headers: auth, body: { settings: { ...me0.settings, followUp: { auto: false, came: "Привет, {имя}! Ждём в «{центр}»", noshow: "" } } } });
  assert.equal(put.json.settings.followUp.came, "Привет, {имя}! Ждём в «{центр}»");
  assert.match(put.json.settings.followUp.noshow, /Подобрать другое удобное время/);
  assert.equal(put.json.settings.followUp.auto, false);
  await J("/api/cabinet/settings", { method: "PUT", headers: auth, body: { settings: { ...me0.settings } } });
  console.log("✓ тексты дожима настраиваются, пустой текст — стандартный");

  // 10. сводка
  n = calls.length;
  await J("/__cron/digest");
  const dig = tgSent(n)[0];
  assert.match(dig.data.text, /Дожать после пробного: 1/);
  const marked = (await J(`/api/cabinet/leads/${booked.id}`, { method: "PATCH", headers: auth, body: { followUp: true } })).json.lead;
  assert.deepEqual([marked.followUp.by, marked.followUp.status], ["manual", "не пришёл"]);
  console.log("✓ в сводке «Дожать после пробного», отметка «написали» из кабинета");
  assert.match(dig.data.text, /Доброе утро/);
  assert.ok(calls.some((c) => c.method === "setWebhook" && c.data.url === `${SITE}/api/telegram/webhook` && c.data.secret_token === ENV.TELEGRAM_WEBHOOK_SECRET));
  console.log("✓ утренняя сводка:", dig.data.text.split("\n").slice(2, 4).join(" | "));
  console.log("✓ вебхук Telegram установлен автоматически");
  const pd = since(n).filter((c) => c.api === "push" && c.path === "/push/phone").map(decrypt).find((x) => x.tag === "digest");
  assert.ok(pd && /Доброе утро/.test(pd.title));
  console.log("✓ сводка пришла и push-уведомлением:", pd.body);

  // 11. удаление заявки и отключение Telegram
  assert.equal((await J(`/api/cabinet/leads/${booked.id}`, { method: "DELETE", headers: auth })).status, 200);
  assert.ok(!(await J("/api/cabinet/leads", { headers: auth })).json.leads.some((l) => l.id === booked.id));
  const { json: ig } = await J("/api/cabinet/telegram/555", { method: "DELETE", headers: auth });
  assert.equal(ig.telegram.chats.length, 0);
  console.log("✓ удаление заявки и отключение Telegram работают");

  const { json: qs } = await J("/api/cabinet/questions", { headers: auth });
  console.log("✓ вопросы помечены источником:", qs.questions.slice(0, 3).map((q) => `${q.channel}/${q.via}`).join(", "));
  console.log("\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
} catch (e) {
  console.error("\nПРОВАЛ:", e.message);
  console.error("--- лог сервера ---\n" + log.split("\n").slice(-25).join("\n"));
  process.exitCode = 1;
} finally {
  srv.kill();
  process.exit();
}
