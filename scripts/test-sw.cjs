// npm test: обработчики push и notificationclick из sw.js с подставным окружением service worker.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const code = fs.readFileSync(require("path").join(__dirname, "../public/cabinet/sw.js"), "utf8");
const handlers = {}, shown = [], posted = [], opened = [], badges = [];
const win = { url: "https://x.app/cabinet/#overview", focus: async () => { win.focused = true; }, postMessage: (m) => posted.push(m) };
let windows = [win];
const self = {
  addEventListener: (t, f) => (handlers[t] = f),
  registration: { showNotification: async (t, o) => shown.push({ t, o }) },
  navigator: { setAppBadge: async (n) => badges.push(n), clearAppBadge: async () => badges.push(0) },
  clients: { matchAll: async () => windows, openWindow: async (u) => opened.push(u), claim: async () => {} },
  skipWaiting: () => {},
};
vm.runInNewContext(code, { self, caches: {}, location: { origin: "https://x.app" }, URL, fetch, console });
const run = async (type, ev) => { let p; ev.waitUntil = (x) => (p = x); handlers[type](ev); await p; };
(async () => {
  await run("push", { data: { json: () => ({ title: "Запись на пробный", body: "Ерлан", url: "/cabinet/#leads", tag: "lead-1", badge: 3 }) } });
  assert.equal(shown[0].t, "Запись на пробный");
  assert.equal(shown[0].o.tag, "lead-1"); assert.equal(shown[0].o.renotify, true);
  assert.equal(shown[0].o.icon, "/cabinet/icons/icon-192.png"); assert.equal(shown[0].o.data.url, "/cabinet/#leads");
  assert.deepEqual(badges, [3]); assert.equal(posted[0].type, "push");
  await run("push", { data: { json: () => { throw new Error("not json"); }, text: () => "просто текст" } });
  assert.equal(shown[1].t, "ИИ-администратор"); assert.equal(shown[1].o.body, "просто текст");
  const n = { data: { url: "/cabinet/#questions" }, close() { this.closed = true; } };
  await run("notificationclick", { notification: n });
  assert.ok(n.closed && win.focused); assert.deepEqual(posted.at(-1), { type: "open", url: "https://x.app/cabinet/#questions" });
  windows = [];
  await run("notificationclick", { notification: { data: { url: "/cabinet/#leads" }, close() {} } });
  assert.deepEqual(opened, ["https://x.app/cabinet/#leads"]);
  console.log("sw.js: push → уведомление и значок; нажатие → открытый кабинет или новое окно — OK");
})().catch((e) => { console.error("ПРОВАЛ", e); process.exit(1); });
