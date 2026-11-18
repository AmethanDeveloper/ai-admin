/*
 * Виджет ИИ-администратора для сайта учебного центра.
 *   <script src="https://ВАШ-САЙТ/widget.js" data-center="код-центра" async></script>
 * Необязательно: data-label="Текст кнопки", data-color="#1d6b57" (вместо цвета из кабинета), data-greeting="off".
 *
 * Чат рисуется прямо на странице, без iframe: всё лежит в shadow DOM, поэтому стили сайта и чата не мешают друг другу.
 * Логотип, цвет и шапка берутся из кабинета центра (раздел «Оформление чата»).
 * Событие для аналитики сайта: window.addEventListener("ai-admin:lead", (e) => …) — e.detail = { center, kind }.
 * Открыть чат своей кнопкой: AIAdmin.open() или AIAdmin.open("booking") — сразу запись на пробный, AIAdmin.open("courses") — цены.
 */
(function () {
  "use strict";
  if (window.__aiAdminWidget) return;
  var script = document.currentScript || document.querySelector('script[src*="widget.js"][data-center]');
  if (!script) return;
  var center = (script.getAttribute("data-center") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!center) return;
  window.__aiAdminWidget = true;
  // пока чат загружается, нажатия на кнопки сайта запоминаем
  var pending = null;
  window.AIAdmin = { open: function (what) { pending = what || "menu"; }, close: function () {} };

  var origin = new URL(script.src, location.href).origin;
  var label = script.getAttribute("data-label") || "Записаться на пробный";
  var colorAttr = /^#[0-9a-f]{6}$/i.test(script.getAttribute("data-color") || "") ? script.getAttribute("data-color") : "";
  var greetingOn = script.getAttribute("data-greeting") !== "off";
  var isPhone = function () { return window.matchMedia("(max-width: 520px)").matches; };

  var CHAT_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8.5L4 19.5z"/><path d="M8.5 9.5h7M8.5 12.5h4"/></svg>';
  var DOWN_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var X_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var UK = '<svg class="w-pattern" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0L60 30M60 0L0 30" stroke="#C8314A" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8314A" stroke-width="6"/></svg>';

  var CSS =
    ":host{all:initial}" +
    ".w{font:400 15px/1.4 'Onest',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#101C17;-webkit-font-smoothing:antialiased}" +
    ".w *,.w *::before,.w *::after{box-sizing:border-box}" +
    ".w-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;height:60px;border:0;border-radius:999px;background:var(--c);color:var(--on);" +
    "display:flex;align-items:center;gap:12px;padding:0 22px 0 8px;box-shadow:0 14px 34px rgba(16,28,23,.24);font:inherit;cursor:pointer;" +
    "transition:transform .15s ease,box-shadow .15s ease,padding .2s ease}" +
    ".w-btn:hover{transform:translateY(-2px);box-shadow:0 18px 40px rgba(16,28,23,.28)}" +
    ".w-btn:focus-visible{outline:3px solid var(--c);outline-offset:3px}" +
    ".w-ava{position:relative;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;flex:none}" +
    ".w-ava.img{background:#fff}.w-ava img{width:70%;height:70%;object-fit:contain}" +
    ".w-dot{position:absolute;right:0;top:0;width:12px;height:12px;border-radius:50%;background:#3DDC97;border:2px solid var(--c)}" +
    ".w-text{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left}.w-text b{font-size:15px;font-weight:600}.w-text small{font-size:12px;opacity:.85}" +
    ".w-x{display:none}" +
    ".w-btn.open{padding:0 8px}.w-btn.open .w-text,.w-btn.open .w-ava{display:none}.w-btn.open .w-x{display:flex;width:44px;height:44px;align-items:center;justify-content:center}" +
    ".w-tip{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:300px;background:#fff;border-radius:20px;overflow:hidden;" +
    "box-shadow:0 18px 50px rgba(16,28,23,.18),0 2px 6px rgba(16,28,23,.06);animation:w-in .3s ease both}" +
    "@keyframes w-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}" +
    ".w-tip-head{position:relative;display:flex;align-items:center;gap:10px;padding:12px 10px 12px 14px;overflow:hidden}" +
    ".w-tip-head.brand{background:var(--c);color:var(--on)}" +
    ".w-pattern{position:absolute;right:-60px;top:-24px;width:180px;height:90px;opacity:.16;pointer-events:none}" +
    ".w-logo{position:relative;width:36px;height:36px;border-radius:11px;background:var(--c);color:var(--on);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none}" +
    ".w-logo.img{background:#fff;border:1px solid #E3E9E4}.w-tip-head.brand .w-logo.img{border-color:transparent}.w-logo img{width:78%;height:78%;object-fit:contain}" +
    ".w-tip-names{position:relative;flex:1;min-width:0}.w-tip-names b{display:block;font-size:14px;font-weight:700}.w-tip-names small{font-size:12px;opacity:.78}" +
    ".w-close{position:relative;width:32px;height:32px;border:0;border-radius:10px;background:transparent;color:inherit;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.8}" +
    ".w-tip-body{padding:4px 14px 14px;display:flex;flex-direction:column;gap:12px}.w-tip-head.brand+.w-tip-body{padding-top:14px}" +
    ".w-tip-body p{margin:0;font-size:14.5px;line-height:1.5}" +
    ".w-tip-actions{display:flex;gap:8px}.w-tip-actions button{flex:1;height:44px;border-radius:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}" +
    ".w-go{border:0;background:var(--c);color:var(--on)}.w-alt{border:1px solid #E3E9E4;background:#fff;color:#101C17}" +
    ".w-panel{position:fixed;right:20px;bottom:96px;z-index:2147483001;width:400px;height:min(680px,calc(100vh - 120px));border-radius:22px;overflow:hidden;" +
    "background:#fff;box-shadow:0 24px 70px rgba(16,28,23,.28);opacity:0;transform:translateY(14px) scale(.98);transform-origin:bottom right;" +
    "pointer-events:none;visibility:hidden;transition:opacity .2s ease,transform .2s ease,visibility 0s .2s}" +
    ".w-panel.open{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .2s ease,transform .2s ease}" +
    "@media (max-width:520px){.w-panel{right:0;bottom:0;width:100vw;height:100%;height:100dvh;border-radius:0}" +
    ".w-btn{right:14px;bottom:14px;padding:0 8px}.w-btn .w-text{display:none}.w-btn.open{display:none}" +
    ".w-tip{right:14px;bottom:88px;width:calc(100vw - 28px);max-width:320px}}" +
    // значок «Powered by Netlify» бывает только на нашем домене (демо-страница) — поднимаемся над ним
    ".nl .w-btn{bottom:76px}.nl .w-tip{bottom:152px}.nl .w-panel{bottom:152px;height:min(680px,calc(100vh - 176px))}" +
    "@media (max-width:520px){.nl .w-btn{bottom:70px}.nl .w-tip{bottom:144px}.nl .w-panel{bottom:0;height:100%;height:100dvh}.nl .aa-composer{padding-bottom:66px}}" +
    "@media (prefers-reduced-motion:reduce){.w-btn,.w-panel,.w-tip{transition:none;animation:none}}";

  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html) n.innerHTML = html; return n; }
  function initials(name) { return (name || "").split(/[\s«»"'-]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase() || "AI"; }
  function isLight(hex) {
    var n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.AiAdminChat) return resolve();
      var s = document.createElement("script"); s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function start(cfg) {
    var brand = cfg.brand || {};
    var color = colorAttr || brand.color || "#0B6B4E";
    var on = isLight(color) ? "#111A15" : "#fff";
    var logo = brand.logo ? origin + brand.logo : "";

    if (!document.querySelector("link[data-aiadm-font]")) {
      var f = document.createElement("link");
      f.rel = "stylesheet"; f.setAttribute("data-aiadm-font", "");
      f.href = "https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(f);
    }

    var host = document.createElement("div");
    host.id = "ai-admin-widget";
    var shadow = host.attachShadow({ mode: "open" });
    var link = document.createElement("link"); link.rel = "stylesheet"; link.href = origin + "/chat/app.css";
    var style = document.createElement("style"); style.textContent = CSS;
    var w = el("div", "w");
    w.style.setProperty("--c", color);
    w.style.setProperty("--on", on);
    shadow.append(link, style, w);

    // кнопка
    var btn = el("button", "w-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "Открыть чат с администратором");
    btn.setAttribute("aria-expanded", "false");
    var ava = el("span", "w-ava" + (logo ? " img" : ""), logo ? "" : CHAT_ICON);
    if (logo) { var im = document.createElement("img"); im.src = logo; im.alt = ""; ava.appendChild(im); }
    ava.appendChild(el("span", "w-dot"));
    var text = el("span", "w-text");
    var b = document.createElement("b"); b.textContent = label;
    var sm = document.createElement("small"); sm.textContent = "ответим за секунды";
    text.append(b, sm);
    btn.append(ava, text, el("span", "w-x", DOWN_ICON));

    var panel = el("div", "w-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Чат " + cfg.name);
    w.append(panel, btn);

    // чат: скрипт подгружаем заранее, когда браузер свободен, чтобы окно открывалось мгновенно
    var chat = null, loading = null, tip = null, isOpen = false, savedOverflow = "";
    function ensureChat(startWith) {
      if (chat) return Promise.resolve(chat);
      if (!loading) loading = loadScript(origin + "/chat/app.js");
      return loading.then(function () {
        if (!chat) {
          chat = window.AiAdminChat.mount(panel, {
            center: center, origin: origin, embed: true, source: "виджет на сайте", start: startWith || null,
            onClose: close,
            onLead: function (d) { try { window.dispatchEvent(new CustomEvent("ai-admin:lead", { detail: d })); } catch (e) {} },
          });
          startWith = null;
        }
        return chat;
      });
    }
    (window.requestIdleCallback || function (f) { setTimeout(f, 2500); })(function () { if (!loading) loading = loadScript(origin + "/chat/app.js").catch(function () { loading = null; }); });

    function open(startWith) {
      hideTip(true);
      ensureChat(startWith).then(function (c) {
        if (startWith === "booking" && c.startBooking && c.__started) c.startBooking();
        if (startWith === "courses" && c.showCourses && c.__started) c.showCourses();
        c.__started = true;
        if (!isPhone()) setTimeout(function () { c.focus(); }, 220);
      }).catch(function () { window.open(origin + "/chat/?c=" + encodeURIComponent(center) + "&src=" + encodeURIComponent("виджет на сайте"), "_blank"); });
      isOpen = true;
      panel.classList.add("open");
      btn.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      btn.setAttribute("aria-label", "Свернуть чат");
      if (isPhone()) { savedOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden"; }
    }
    function close() {
      isOpen = false;
      panel.classList.remove("open");
      btn.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Открыть чат с администратором");
      document.documentElement.style.overflow = savedOverflow;
      btn.focus({ preventScroll: true });
    }
    btn.addEventListener("click", function () { isOpen ? close() : open(); });
    document.addEventListener("keydown", function (e) { if (isOpen && e.key === "Escape") close(); });

    // приветствие через несколько секунд, если посетитель его ещё не закрывал
    function hideTip(forever) {
      if (tip) { tip.remove(); tip = null; }
      if (forever) try { sessionStorage.setItem("aiadm-tip-closed", "1"); } catch (e) {}
    }
    function showTip() {
      if (isOpen || tip) return;
      try { if (sessionStorage.getItem("aiadm-tip-closed")) return; } catch (e) {}
      var brandHead = brand.header === "brand" && !colorAttr;
      tip = el("div", "w-tip");
      tip.setAttribute("role", "status");
      var head = el("div", "w-tip-head" + (brandHead ? " brand" : ""), brandHead && brand.pattern === "uk" ? UK : "");
      var lg = el("div", "w-logo" + (logo ? " img" : ""));
      if (logo) { var li = document.createElement("img"); li.src = logo; li.alt = ""; lg.appendChild(li); } else lg.textContent = initials(cfg.name);
      var names = el("div", "w-tip-names");
      var nb = document.createElement("b"); nb.textContent = cfg.name;
      var ns = document.createElement("small"); ns.textContent = "онлайн · отвечает сразу";
      names.append(nb, ns);
      var x = el("button", "w-close", X_ICON); x.type = "button"; x.setAttribute("aria-label", "Скрыть приветствие");
      x.addEventListener("click", function () { hideTip(true); });
      head.append(lg, names, x);
      var bodyEl = el("div", "w-tip-body");
      var p = document.createElement("p");
      p.textContent = "Здравствуйте! Подскажу по курсам и ценам и запишу на бесплатный пробный урок.";
      var acts = el("div", "w-tip-actions");
      var go = el("button", "w-go"); go.type = "button"; go.textContent = "Записаться";
      go.addEventListener("click", function () { open("booking"); });
      var alt = el("button", "w-alt"); alt.type = "button"; alt.textContent = "Узнать цены";
      alt.addEventListener("click", function () { open("courses"); });
      acts.append(go, alt);
      bodyEl.append(p, acts);
      tip.append(head, bodyEl);
      w.appendChild(tip);
    }
    if (greetingOn) setTimeout(showTip, 4000);

    // значок «Powered by Netlify» на странице? (на сайтах центров его нет)
    function badgeCheck() {
      var fr = document.getElementById("nl-badge-frame");
      w.classList.toggle("nl", !!fr && fr.offsetWidth > 0 && getComputedStyle(fr).display !== "none");
    }
    badgeCheck();
    if (window.MutationObserver) new MutationObserver(badgeCheck).observe(document.body, { childList: true });
    setTimeout(badgeCheck, 1500);
    setTimeout(badgeCheck, 5000);

    document.body.appendChild(host);
    window.AIAdmin = { open: function (what) { open(what === "booking" || what === "courses" ? what : null); }, close: close };
    if (pending) open(pending === "booking" || pending === "courses" ? pending : null);
  }

  function boot() {
    fetch(origin + "/api/public/" + encodeURIComponent(center))
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .then(start)
      .catch(function (e) { console.warn("ИИ-администратор: чат центра «" + center + "» не загрузился", e); });
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
