// Service worker кабинета: запуск как приложения, офлайн-оболочка и push-уведомления.
// Данные (/api/*) никогда не кэшируются — только сама страница, стили и скрипты.
const VERSION = "cab-v2";
const SHELL = [
  "/cabinet/",
  "/cabinet/cabinet.js",
  "/cabinet/cabinet.css",
  "/assets/base.css",
  "/assets/qrcode.js",
  "/assets/logo-mark.svg",
  "/cabinet/icons/icon-192.png",
  "/cabinet/icons/badge-96.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    // Сначала сеть — чтобы всегда была свежая версия; без сети — сохранённая оболочка.
    e.respondWith(fetch(req).catch(() => caches.match("/cabinet/", { ignoreSearch: true })));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "ИИ-администратор", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "ИИ-администратор";
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || "",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: "/cabinet/icons/icon-192.png",
      badge: "/cabinet/icons/badge-96.png",
      lang: "ru",
      data: { url: d.url || "/cabinet/" },
    }),
    typeof d.badge === "number" && self.navigator.setAppBadge
      ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {})
      : null,
    // открытый кабинет сразу обновит список
    self.clients.matchAll({ type: "window" }).then((list) => list.forEach((c) => c.postMessage({ type: "push", url: d.url }))),
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/cabinet/", location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = list.find((c) => new URL(c.url).pathname.startsWith("/cabinet/"));
    if (win) {
      await win.focus();
      win.postMessage({ type: "open", url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
