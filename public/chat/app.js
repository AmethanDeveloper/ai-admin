/*
 * ИИ-администратор: чат. Один модуль для полноэкранной страницы /chat/ и для виджета на сайте центра.
 *   AiAdminChat.mount(container, { center, origin, embed, source, start, onClose, onLead })
 * container — элемент (или место внутри shadow DOM виджета). Стили: /chat/app.css.
 * origin — адрес сервиса ("" для своей страницы, иначе https://… — виджет ходит в API с сайта центра).
 */
(function () {
  "use strict";
  if (window.AiAdminChat) return;

  // ------------------------------------------------------------ иконки (контурные, цвет от текста)
  const SVG = (d, size = 18, w = 1.9) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    arrow: SVG('<path d="M5 12h13M13 6l6 6-6 6"/>', 18, 2),
    up: SVG('<path d="M12 19V5M6 11l6-6 6 6"/>', 20, 2),
    close: SVG('<path d="M6 9l6 6 6-6"/>', 20, 2),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 14, 2),
    clockL: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    book: SVG('<path d="M4 4.5h6a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H20z"/>'),
    pin: SVG('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    cal: SVG('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
    phone: SVG('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    chat: SVG('<path d="M4 19.5V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8.5L4 19.5z"/>'),
    map: SVG('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>', 17),
    check: SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 28, 2.4),
    chev: SVG('<path d="M9 6l6 6-6 6"/>', 18, 2),
  };
  const UK = '<svg class="aa-pattern" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0L60 30M60 0L0 30" stroke="#C8314A" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8314A" stroke-width="6"/></svg>';

  const DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const DOW_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  // ------------------------------------------------------------ мелочи

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v; // только наши иконки, никогда не данные
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const hexRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); const n = m ? parseInt(m[1], 16) : 0x0b6b4e; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const initials = (name) => (name || "").split(/[\s«»"'-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AI";
  const isFree = (price) => !price || /бесплат/i.test(price);
  function slotParts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso || "");
    if (!m) return null;
    const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
    return { date: `${m[1]}-${m[2]}-${m[3]}`, day: +m[3], month: +m[2] - 1, dow, time: m[4] };
  }
  /** «сегодня» / «завтра» по часовому поясу центра (он записан в самом слоте: …+05:00). */
  function relDay(iso) {
    const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso || "");
    const off = m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 300;
    const p = slotParts(iso);
    if (!p) return "";
    const today = new Date(Date.now() + off * 60e3).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + off * 60e3 + 864e5).toISOString().slice(0, 10);
    return p.date === today ? "сегодня" : p.date === tomorrow ? "завтра" : "";
  }
  const longDay = (p) => `${DOW_FULL[p.dow][0].toUpperCase()}${DOW_FULL[p.dow].slice(1)}, ${p.day} ${MONTHS[p.month]}`;
  const slotText = (iso) => { const p = slotParts(iso); return p ? `${DOW[p.dow]}, ${p.day} ${MONTHS[p.month]}, ${p.time}` : iso; };
  function nearText(iso) {
    const p = slotParts(iso);
    if (!p) return iso;
    const rel = relDay(iso);
    return `${rel || `${DOW[p.dow].toLowerCase()}, ${p.day} ${MONTHS[p.month]}`} в ${p.time}`;
  }
  function validPhone(raw) {
    let d = String(raw).replace(/\D/g, "");
    if (d.length === 11 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);
    return d.length >= 10 && d.length <= 15;
  }

  // ------------------------------------------------------------ чат

  function mount(container, options) {
    const o = Object.assign({ origin: "", embed: false, source: "ссылка на чат", start: null, onClose: null, onLead: null }, options || {});
    const CENTER = String(o.center || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const url = (p) => (o.origin || "") + p;

    let cfg = null, history = [], draft = {}, expect = null, resume = null, busy = false, lastBot = false;
    let session = "";
    try {
      session = sessionStorage.getItem("aiadm-session") || "";
      if (!session) { session = Math.random().toString(36).slice(2, 12); sessionStorage.setItem("aiadm-session", session); }
    } catch { session = Math.random().toString(36).slice(2, 12); }

    // --- разметка
    const logoBox = h("div", { class: "aa-logo-box", "aria-hidden": "true" });
    const nameEl = h("div", { class: "aa-name", text: "Загрузка…" });
    const subEl = h("div", { class: "aa-sub", text: "Администратор онлайн · отвечает сразу" });
    const stepsLabel = h("b", { text: "Запись на пробный урок" });
    const stepsCount = h("span");
    const bar = h("div", { class: "aa-bar", "aria-hidden": "true" });
    const steps = h("div", { class: "aa-steps", hidden: true }, h("div", { class: "aa-steps-top" }, stepsLabel, stepsCount), bar);
    const head = h("header", { class: "aa-head" },
      h("div", { class: "aa-head-row" },
        h("div", { class: "aa-logo" }, logoBox, h("span", { class: "aa-online", "aria-hidden": "true" })),
        h("div", { class: "aa-titles" }, nameEl, subEl, h("span", { class: "aa-pill-online", text: "Администратор онлайн · отвечает сразу" })),
        o.onClose ? h("button", { class: "aa-close", type: "button", "aria-label": "Свернуть чат", html: I.close, onclick: () => o.onClose() }) : null,
      ),
      steps,
    );
    const thread = h("div", { class: "aa-thread" });
    const log = h("div", { class: "aa-log", role: "log", "aria-live": "polite", "aria-label": "Переписка" }, thread);
    const input = h("input", { class: "aa-input", id: `aa-in-${CENTER}`, type: "text", maxlength: "1000", placeholder: "Напишите вопрос…", enterkeyhint: "send", autocomplete: "off" });
    const send = h("button", { class: "aa-send", type: "submit", "aria-label": "Отправить", html: I.up });
    const form = h("form", { class: "aa-composer", autocomplete: "off" },
      h("div", { class: "aa-composer-in" }, h("label", { class: "aa-sr", for: input.id, text: "Сообщение" }), input, send));
    const body = h("div", { class: "aa-body" }, log, form);
    const root = h("div", { class: `aa ${o.embed ? "aa-embed" : "aa-page"}`, "data-header": "light" }, head, body);
    container.appendChild(root);

    // --- вывод
    let holdTop = false; // приветствие показываем сверху, а дальше переписка прокручивается вниз
    const scroll = () => requestAnimationFrame(() => { if (!holdTop) log.scrollTop = log.scrollHeight; });
    function avatar(show) {
      const a = h("div", { class: `aa-ava${show ? "" : " ghost"}${cfg && cfg.brand && cfg.brand.logo ? " has-img" : ""}`, "aria-hidden": "true" });
      if (cfg && cfg.brand && cfg.brand.logo) a.append(h("img", { src: url(cfg.brand.logo), alt: "" }));
      else a.textContent = initials(cfg && cfg.name);
      return a;
    }
    function say(text, who = "bot", extra = "") {
      const msg = h("div", { class: `aa-msg ${extra}`.trim(), text });
      const row = h("div", { class: `aa-row ${who}` }, who === "bot" ? avatar(!lastBot) : null, msg);
      thread.append(row);
      lastBot = who === "bot";
      scroll();
      return msg;
    }
    function attach(node) {
      const wrap = h("div", { class: "aa-att" }, node);
      thread.append(wrap);
      lastBot = true;
      scroll();
      return wrap;
    }
    function typing() {
      const row = h("div", { class: "aa-row bot" }, avatar(!lastBot), h("div", { class: "aa-msg aa-typing", "aria-label": "Печатает" }, h("i"), h("i"), h("i")));
      thread.append(row);
      scroll();
      return () => row.remove();
    }
    async function botSay(text, extra) {
      const stop = typing();
      await pause(Math.min(900, 250 + text.length * 6));
      stop();
      return say(text, "bot", extra);
    }
    function user(text) { compact(); return say(text, "user"); }
    function compact() { root.classList.add("aa-compact"); }

    function chips(list) {
      const box = h("div", { class: "aa-chips" });
      for (const c of list) {
        box.append(h("button", {
          class: `aa-chip ${c.kind || ""}`.trim(), type: "button", text: c.label,
          onclick: () => { if (busy) return; box.parentElement && box.parentElement.remove(); c.run(); },
        }));
      }
      return attach(box);
    }
    function menu(except) {
      const all = [
        { id: "book", label: "Записаться на пробный урок", kind: "primary", run: () => startBooking(true) },
        { id: "courses", label: "Курсы и цены", run: showCourses },
        { id: "contacts", label: "Адрес и график", run: showContacts },
      ];
      chips(all.filter((c) => c.id !== except));
    }

    function setSteps(name) {
      if (!name) { steps.hidden = true; return; }
      const list = stepList();
      const i = list.indexOf(name);
      steps.hidden = false;
      stepsCount.textContent = `шаг ${i + 1} из ${list.length}`;
      bar.replaceChildren(...list.map((_, k) => h("i", { class: k <= i ? "on" : "" })));
    }
    function setInput(mode) {
      expect = mode;
      input.placeholder = mode === "wish" ? "Например: будни после 17:00" : "Напишите вопрос…";
      if (mode) setTimeout(() => input.focus(), 60);
    }

    async function api(path, payload) {
      const res = await fetch(url(path), payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : undefined);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || "Ошибка соединения"), { status: res.status });
      return data;
    }
    async function refreshSlots() { try { cfg.slots = (await api(`/api/public/${CENTER}`)).slots; } catch {} }

    // --- оформление центра
    function applyBrand() {
      const b = cfg.brand || {};
      const rgb = hexRgb(b.color);
      const light = lum(rgb) > 0.5;
      root.style.setProperty("--aa-accent", b.color || "#0B6B4E");
      root.style.setProperty("--aa-accent-soft", `rgba(${rgb},.10)`);
      root.style.setProperty("--aa-accent-line", `rgba(${rgb},.30)`);
      root.style.setProperty("--aa-on-accent", light ? "#111A15" : "#fff");
      const brandHead = b.header === "brand";
      root.dataset.header = brandHead ? "brand" : "light";
      if (brandHead) {
        root.style.setProperty("--aa-head-bg", b.color);
        root.style.setProperty("--aa-head-ink", light ? "#111A15" : "#fff");
        root.style.setProperty("--aa-head-sub", light ? "rgba(17,26,21,.72)" : "rgba(255,255,255,.78)");
        if (b.pattern === "uk") head.insertAdjacentHTML("afterbegin", UK);
        if (!o.embed) root.classList.add("aa-cover");
      }
      logoBox.replaceChildren();
      if (b.logo) { logoBox.classList.add("has-img"); logoBox.append(h("img", { src: url(b.logo), alt: "" })); }
      else logoBox.textContent = initials(cfg.name);
      nameEl.textContent = cfg.name;
    }

    // --- приветствие и меню
    function trialCard() {
      const t = cfg.trial || {};
      const free = isFree(t.price);
      const next = cfg.slots && cfg.slots[0];
      return h("div", { class: "aa-trial" },
        h("div", { class: "aa-trial-top" }, h("span", { class: "aa-pill", text: free ? "Бесплатно" : t.price }), t.durationMin ? h("span", { text: `${t.durationMin} минут` }) : null),
        h("h3", { text: "Пробный урок" }),
        h("p", { text: t.whatHappens || "Знакомство с преподавателем, тест на уровень и подбор группы" }),
        h("button", { class: "aa-btn", type: "button", onclick: () => !busy && startBooking(true) }, "Выбрать время", h("span", { html: I.arrow })),
        next ? h("div", { class: "aa-hint" }, h("span", { html: I.clock }), `Ближайшее свободное: ${nearText(next.iso)}`) : null,
      );
    }
    function tiles() {
      return h("div", { class: "aa-tiles" },
        h("button", { class: "aa-tile", type: "button", onclick: () => !busy && showCourses() }, h("span", { class: "aa-ico", html: I.book }), "Курсы и цены"),
        h("button", { class: "aa-tile", type: "button", onclick: () => !busy && showContacts() }, h("span", { class: "aa-ico", html: I.pin }), "Адрес и график"),
      );
    }
    function faqList() {
      const list = (cfg.faq || []).slice(0, 3);
      if (!list.length) return null;
      return h("div", { class: "aa-faq" }, h("h4", { text: "Часто спрашивают" }),
        list.map((f) => h("button", { type: "button", onclick: () => !busy && showFaq(f) }, f.q, h("span", { html: I.chev }))));
    }

    async function showCourses() {
      user("Курсы и цены");
      const courses = cfg.courses || [];
      if (!courses.length) { await botSay("Список курсов уточнит администратор. Запишитесь на пробный урок — там подберут программу."); return menu("courses"); }
      const t = cfg.trial || {};
      await botSay(`Вот наши курсы. Пробный урок — ${isFree(t.price) ? "бесплатно" : t.price}${t.durationMin ? `, ${t.durationMin} минут` : ""}.`);
      attach(h("div", { class: "aa-options" }, courses.map((c) => h("button", {
        class: "aa-option", type: "button", title: "Записаться на пробный по этому курсу",
        onclick: () => !busy && startBooking(false, { course: c.name }, `Хочу на пробный: ${c.name}`),
      },
        h("span", { class: "aa-option-main" }, h("span", { class: "aa-option-title", text: c.name }), h("span", { class: "aa-option-meta", text: [c.for, c.format].filter(Boolean).join(" · ") })),
        c.price ? h("span", { class: "aa-price" }, h("b", { text: c.price.replace(/\s*(в|\/)\s*(месяц|мес\.?)$/i, "") }), /месяц|мес/i.test(c.price) ? h("small", { text: "в месяц" }) : null) : null,
      ))));
      attach(h("button", { class: "aa-btn", type: "button", onclick: () => !busy && startBooking(true) }, "Записаться на пробный урок", h("span", { html: I.arrow })));
    }

    async function showContacts() {
      user("Адрес и график");
      const rows = [
        cfg.address && [I.pin, cfg.address],
        cfg.hours && [I.clockL, cfg.hours],
        cfg.phone && [I.phone, cfg.phone],
      ].filter(Boolean);
      if (!rows.length) { await botSay("Адрес и график уточнит администратор."); return menu("contacts"); }
      await botSay("Вот где мы и когда работаем:");
      attach(h("div", { class: "aa-card" },
        h("div", { class: "aa-summary" }, rows.map(([ico, text]) => h("div", { class: "aa-sline" }, h("span", { html: ico }), h("span", { text })))),
        cfg.address ? h("a", { class: "aa-btn ghost", href: mapUrl(), target: "_blank", rel: "noopener" }, h("span", { html: I.map }), "Как добраться") : null,
      ));
      menu("contacts");
    }
    const mapUrl = () => `https://2gis.kz/search/${encodeURIComponent([cfg.city, cfg.address].filter(Boolean).join(", "))}`;

    async function showFaq(f) {
      user(f.q);
      await botSay(f.a);
      menu();
    }

    // --- запись на пробный
    function stepList() {
      return [(cfg.studentTypes || []).length && "student", (cfg.courses || []).length && "course", "time", "contacts"].filter(Boolean);
    }
    function startBooking(echo, preset, echoText) {
      if (echo || echoText) user(echoText || "Хочу записаться на пробный урок");
      compact();
      draft = Object.assign({ type: "trial", name: draft.name, phone: draft.phone }, preset || {});
      setInput(null);
      next();
    }
    function next() {
      const list = stepList();
      if (list.includes("student") && !draft.student) return askStudent();
      if (list.includes("course") && draft.course === undefined) return askCourse();
      if (draft.slot === undefined) return askTime();
      return askContacts();
    }
    function optionList(items, onPick) {
      const box = h("div", { class: "aa-options" });
      for (const it of items) {
        const b = h("button", { class: `aa-option ${it.quiet ? "quiet" : ""}`.trim(), type: "button" },
          h("span", { class: "aa-option-main" }, h("span", { class: "aa-option-title", text: it.title }), it.meta ? h("span", { class: "aa-option-meta", text: it.meta }) : null),
          it.price ? h("span", { class: "aa-price" }, h("b", { text: it.price })) : null);
        b.addEventListener("click", () => {
          if (busy || box.classList.contains("done")) return;
          box.classList.add("done");
          b.classList.add("chosen");
          box.querySelectorAll("button").forEach((x) => { x.disabled = true; });
          onPick(it);
        });
        box.append(b);
      }
      return box;
    }
    async function askStudent() {
      resume = askStudent; setSteps("student");
      await botSay("Отлично! Кто будет учиться?");
      attach(optionList(cfg.studentTypes.map((t) => ({ title: t })), (it) => { user(it.title); draft.student = it.title; next(); }));
    }
    async function askCourse() {
      resume = askCourse; setSteps("course");
      await botSay("Какой курс интересует?");
      const items = cfg.courses.map((c) => ({ title: c.name, meta: c.for, value: c.name }));
      items.push({ title: "Пока не знаю — подскажут на уроке", quiet: true, value: "подобрать на пробном уроке" });
      attach(optionList(items, (it) => { user(it.quiet ? "Пока не знаю" : it.title); draft.course = it.value; next(); }));
    }
    async function askTime(note) {
      resume = askTime; setSteps("time");
      if (note) await botSay(note);
      const slots = cfg.slots || [];
      if (!slots.length) {
        await botSay("Свободных мест на ближайшие дни нет. Напишите, когда вам удобно, — администратор подберёт время.");
        draft.slot = null;
        return setInput("wish");
      }
      const t = cfg.trial || {};
      await botSay(`Выберите день и время.${t.durationMin ? ` Урок длится ${t.durationMin} минут${isFree(t.price) ? ", это бесплатно" : ""}.` : ""}`);
      attach(slotPicker(slots));
    }
    function slotPicker(slots) {
      const days = [];
      for (const s of slots) {
        const p = slotParts(s.iso);
        if (!p) continue;
        let d = days.find((x) => x.date === p.date);
        if (!d) { d = { date: p.date, p, times: [] }; days.push(d); }
        d.times.push({ iso: s.iso, time: p.time });
      }
      let current = 0;
      const card = h("div", { class: "aa-card aa-picker" });
      const dayRow = h("div", { class: "aa-days", role: "group", "aria-label": "День" });
      const cap = h("div", { class: "aa-day-cap" });
      const times = h("div", { class: "aa-times", role: "group", "aria-label": "Время" });
      function render() {
        dayRow.querySelectorAll(".aa-day").forEach((b, i) => b.setAttribute("aria-pressed", String(i === current)));
        const d = days[current];
        cap.textContent = longDay(d.p);
        times.replaceChildren(...d.times.map((t) => h("button", {
          type: "button", "aria-pressed": "false", text: t.time,
          onclick: (e) => pick(e.currentTarget, t),
        })));
      }
      function pick(btn, t) {
        if (busy || card.classList.contains("done")) return;
        btn.setAttribute("aria-pressed", "true");
        card.classList.add("done");
        draft.slot = t.iso; draft.slotLabel = slotText(t.iso); draft.wish = "";
        user(draft.slotLabel);
        next();
      }
      days.slice(0, 14).forEach((d, i) => dayRow.append(h("button", {
        class: "aa-day", type: "button", "aria-label": longDay(d.p),
        onclick: () => { current = i; render(); },
      }, h("small", { text: { сегодня: "Сегодня", завтра: "Завтра" }[relDay(d.times[0].iso)] || DOW[d.p.dow] }), h("b", { text: String(d.p.day) }))));
      card.append(dayRow, cap, times, h("button", {
        class: "aa-link", type: "button", text: "Нет подходящего времени",
        onclick: async () => {
          if (busy || card.classList.contains("done")) return;
          card.classList.add("done");
          user("Нет подходящего времени");
          draft.slot = null;
          await botSay("Напишите, в какие дни и часы вам удобно, — администратор подберёт время.");
          setInput("wish");
        },
      }));
      render();
      return card;
    }

    function field(label, type, value, auto) {
      const inp = h("input", { type, value: value || "", autocomplete: auto, required: true, maxlength: type === "tel" ? "30" : "80", ...(type === "tel" ? { inputmode: "tel", placeholder: "+7 7__ ___ __ __" } : {}) });
      const err = h("span", { class: "aa-err", "aria-live": "polite" });
      return { wrap: h("label", { class: "aa-field" }, label, inp, err), inp, err };
    }
    function contactForm({ summary, submitText, onSubmit }) {
      const name = field("Ваше имя", "text", draft.name, "name");
      const phone = field("Телефон — лучше тот, что в WhatsApp", "tel", draft.phone, "tel");
      const btn = h("button", { class: "aa-btn", type: "submit", text: submitText });
      const status = h("span", { class: "aa-err", role: "alert" });
      const privacy = h("a", { href: url("/privacy/"), target: "_blank", rel: "noopener", text: "Политика обработки данных" });
      const f = h("form", { class: "aa-card aa-form", novalidate: true }, summary, name.wrap, phone.wrap, btn, status,
        h("p", { class: "aa-consent" }, `Нажимая «${submitText}», вы соглашаетесь, что центр «${cfg.name}» обработает имя и телефон, чтобы связаться по заявке, в том числе с хранением на зарубежных серверах. `, privacy));
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busy) return;
        let ok = true;
        name.err.textContent = phone.err.textContent = status.textContent = "";
        name.inp.removeAttribute("aria-invalid"); phone.inp.removeAttribute("aria-invalid");
        if (name.inp.value.trim().length < 2) { name.err.textContent = "Напишите имя"; name.inp.setAttribute("aria-invalid", "true"); ok = false; }
        if (!validPhone(phone.inp.value)) { phone.err.textContent = "Не похоже на номер. Например: +7 701 123 45 67"; phone.inp.setAttribute("aria-invalid", "true"); ok = false; }
        if (!ok) return;
        draft.name = name.inp.value.trim().slice(0, 80);
        draft.phone = phone.inp.value.trim().slice(0, 30);
        btn.disabled = true; btn.textContent = "Отправляем…";
        const err = await onSubmit();
        if (err) { btn.disabled = false; btn.textContent = submitText; status.textContent = err; }
        else f.classList.add("sent");
      });
      setTimeout(() => (draft.name ? phone.inp : name.inp).focus({ preventScroll: true }), 80);
      return f;
    }

    async function askContacts() {
      resume = askContacts; setSteps("contacts");
      await botSay(draft.name && draft.phone ? "Проверьте данные и подтвердите запись:" : "Почти готово! Как к вам обращаться и куда позвонить?");
      const lines = [
        [I.cal, draft.slot ? draft.slotLabel : "Время подберёт администратор", draft.slot && (cfg.trial || {}).durationMin ? ` · ${cfg.trial.durationMin} минут` : ""],
        (draft.course || draft.student) && [I.book, [draft.course, draft.student && draft.student.toLowerCase()].filter(Boolean).join(" · "), ""],
        draft.wish && [I.chat, `Удобно: ${draft.wish}`, ""],
      ].filter(Boolean);
      const summary = h("div", { class: "aa-summary" },
        lines.map(([ico, main, extra], i) => h("div", { class: "aa-sline" }, h("span", { html: ico }), h("span", {}, i === 0 ? h("b", { text: main }) : main, extra))),
        h("button", {
          class: "aa-link", type: "button", text: "Изменить",
          onclick: () => { if (busy) return; user("Изменить запись"); draft = { type: "trial", name: draft.name, phone: draft.phone }; next(); },
        }));
      attach(contactForm({ summary, submitText: "Записаться", onSubmit: confirmTrial }));
    }

    async function confirmTrial() {
      busy = true;
      try {
        const r = await api("/api/book", {
          center: CENTER, type: "trial", student: draft.student, course: draft.course, slot: draft.slot || null,
          wish: draft.wish, name: draft.name, phone: draft.phone, consent: true, source: o.source,
        });
        busy = false;
        setSteps(null); resume = null;
        doneCard(r);
        if (o.onLead) try { o.onLead({ center: CENTER, kind: "trial" }); } catch {}
        draft = { name: draft.name, phone: draft.phone };
        refreshSlots();
        return null;
      } catch (e) {
        busy = false;
        if (e.status === 409) {
          await refreshSlots();
          draft.slot = undefined;
          askTime("Это время только что заняли. Выберите другое:");
          return "Время заняли — выберите другое ниже";
        }
        return e.message || "Не получилось отправить. Попробуйте ещё раз.";
      }
    }

    function doneCard(r) {
      const t = cfg.trial || {};
      const p = draft.slot && slotParts(draft.slot);
      const rows = [
        [I.clockL, `Пробный урок${t.durationMin ? `, ${t.durationMin} минут` : ""}${isFree(t.price) ? ", бесплатно" : t.price ? `, ${t.price}` : ""}`],
        (r.address || cfg.address) && [I.pin, r.address || cfg.address],
        [I.phone, "Администратор свяжется, чтобы подтвердить запись"],
      ].filter(Boolean);
      attach(h("div", { class: "aa-card aa-done" },
        h("div", { class: "aa-check", html: I.check }),
        h("h3", { text: p ? "Вы записаны!" : "Заявка принята!" }),
        h("p", { text: p ? `Ждём вас: ${DOW_FULL[p.dow]}, ${p.day} ${MONTHS[p.month]}, в ${p.time}` : "Администратор подберёт удобное время и свяжется с вами." }),
        h("div", { class: "aa-summary" }, rows.map(([ico, text]) => h("div", { class: "aa-sline" }, h("span", { html: ico }), h("span", { text })))),
        h("div", { class: "aa-done-actions" },
          (r.address || cfg.address) ? h("a", { class: "aa-btn ghost", href: mapUrl(), target: "_blank", rel: "noopener" }, h("span", { html: I.map }), "Как добраться") : null,
          h("button", { class: "aa-btn ghost", type: "button", text: "Ещё вопрос", onclick: () => input.focus() })),
      ));
    }

    // --- обратный звонок, если бот не знает ответа
    async function startCallback(question) {
      user("Оставить телефон");
      draft = { type: "callback", question, name: draft.name, phone: draft.phone };
      setSteps(null);
      await botSay("Администратор перезвонит и ответит. Оставьте, пожалуйста, имя и телефон:");
      attach(contactForm({
        summary: h("div", { class: "aa-summary" }, h("div", { class: "aa-sline" }, h("span", { html: I.chat }), h("span", { text: question }))),
        submitText: "Отправить",
        onSubmit: async () => {
          busy = true;
          try {
            await api("/api/book", { center: CENTER, type: "callback", name: draft.name, phone: draft.phone, question: draft.question, consent: true, source: o.source });
            busy = false;
            if (o.onLead) try { o.onLead({ center: CENTER, kind: "callback" }); } catch {}
            draft = { name: draft.name, phone: draft.phone };
            await botSay("Спасибо! Администратор перезвонит вам в рабочее время.");
            menu();
            return null;
          } catch (e) { busy = false; return e.message || "Не получилось отправить. Попробуйте ещё раз."; }
        },
      }));
    }

    // --- свободные вопросы
    async function ask(text) {
      user(text);
      history.push({ role: "user", content: text });
      busy = true; send.disabled = true;
      const stop = typing();
      try {
        const r = await api("/api/chat", { center: CENTER, history: history.slice(-10), session });
        stop();
        say(r.answer);
        history.push({ role: "assistant", content: r.answer });
        const after = [];
        if (r.escalate) after.push({ label: "Оставить телефон", kind: "primary", run: () => startCallback(text) });
        if (resume) {
          const back = resume;
          after.push({ label: "Продолжить запись", kind: r.escalate ? "" : "primary", run: () => back() });
        } else if (r.book || r.escalate) {
          after.push({ label: "Записаться на пробный урок", kind: r.escalate ? "" : "primary", run: () => startBooking(true) });
        }
        if (after.length) chips(after); else menu();
      } catch (e) {
        stop();
        history.pop();
        say(e.status === 429 ? "Слишком много сообщений подряд. Подождите минуту." : "Не получилось ответить. Попробуйте ещё раз.", "bot", "error");
      } finally {
        busy = false; send.disabled = false;
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || busy || !cfg) return;
      input.value = "";
      if (expect === "wish") {
        user(text);
        draft.wish = text.slice(0, 300);
        setInput(null);
        return next();
      }
      ask(text.slice(0, 1000));
    });

    // --- старт
    async function start() {
      try {
        cfg = await api(`/api/public/${CENTER}`);
      } catch (e) {
        nameEl.textContent = "Чат недоступен";
        say(e.status === 404 ? "Чат этого центра не найден. Проверьте ссылку." : "Не удалось загрузить чат. Обновите страницу.", "bot", "error");
        return;
      }
      applyBrand();
      if (!o.embed) document.title = `${cfg.name} — онлайн-администратор`;
      await botSay(`Здравствуйте! Я онлайн-администратор «${cfg.name}». Подскажу по курсам и ценам и запишу на пробный урок — в любое время.`);
      holdTop = true;
      attach(trialCard());
      attach(tiles());
      const faq = faqList();
      if (faq) attach(faq);
      requestAnimationFrame(() => { holdTop = false; });
      if (o.start === "booking") startBooking(true);
      else if (o.start === "courses") showCourses();
    }
    const ready = start();

    return {
      el: root,
      focus: () => input.focus(),
      startBooking: () => ready.then(() => cfg && !busy && startBooking(true)),
      showCourses: () => ready.then(() => cfg && !busy && showCourses()),
    };
  }

  window.AiAdminChat = { mount };
})();
