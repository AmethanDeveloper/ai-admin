(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TOKEN_KEY = "aiadm-token";
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch {}

  const state = { slug: "", settings: null, statuses: [], integrations: null, leads: [], questions: [], days: 30, filter: "все", search: "", showAllQ: false };
  const DAYS = [["mon", "Пн"], ["tue", "Вт"], ["wed", "Ср"], ["thu", "Чт"], ["fri", "Пт"], ["sat", "Сб"], ["sun", "Вс"]];
  const DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  // ------------------------------------------------------------ сеть

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    if (res.status === 401 && !path.endsWith("/login")) { logout(); throw new Error("Сессия истекла, войдите заново"); }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.blob();
    if (!res.ok) throw new Error(data?.error || "Ошибка сервера");
    return data;
  }

  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ------------------------------------------------------------ время

  const pad = (n) => String(n).padStart(2, "0");
  function local(iso) {
    const off = state.settings?.utcOffset ?? 5;
    return new Date(new Date(iso).getTime() + off * 3600e3);
  }
  function fmtDate(iso) {
    const t = local(iso);
    return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  }
  function fmtSlot(iso) {
    if (!iso) return "";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
    if (!m) return iso;
    const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
    return `${DOW[dow]} ${m[3]}.${m[2]}, ${m[4]}`;
  }
  const slotTime = (iso) => (iso ? new Date(iso).getTime() : 0);

  /** Заявка пришла вне рабочего времени: до 9:00, после 20:00 или в воскресенье (по времени центра). */
  function afterHours(iso) {
    const t = local(iso);
    const h = t.getUTCHours();
    return h < 9 || h >= 20 || t.getUTCDay() === 0;
  }

  // ------------------------------------------------------------ дожим после пробного
  // Та же логика, что followUpDue в netlify/lib/core.mts — меняйте вместе.

  const H = 3600e3;
  function followUpDue(l, now = Date.now()) {
    if (l.type !== "trial") return null;
    if (["записан", "подтвердил"].includes(l.status)) {
      if (!l.slot) return null;
      const since = now - slotTime(l.slot);
      return since > 2 * H && since < 14 * 24 * H ? "mark" : null;
    }
    if (l.status !== "пришёл" && l.status !== "не пришёл") return null;
    if (l.followUp?.status === l.status) return null;
    const at = [...(l.history || [])].reverse().find((h) => h.status === l.status)?.at || l.createdAt;
    const since = now - new Date(at).getTime();
    if (since < (l.status === "пришёл" ? 20 : 2) * H || since > 14 * 24 * H) return null;
    return l.status === "пришёл" ? "came" : "noshow";
  }
  function followUpText(l, kind) {
    const t = state.settings?.followUp?.[kind] || "";
    const first = (l.name || "").split(/[\s,(]+/)[0] || l.name;
    return t.replace(/\{имя\}/g, first).replace(/\{центр\}/g, state.settings.name).replace(/\{курс\}/g, l.course || "курс").trim();
  }

  // ------------------------------------------------------------ вход

  function showLogin() {
    $("#appView").hidden = true;
    $("#offlineView").hidden = true;
    $("#loginView").hidden = false;
    openTab.cur = "";
    const p = new URLSearchParams(location.search);
    if (p.get("c")) $("#loginCenter").value = p.get("c");
    if (p.get("demo") === "1") fillDemo();
    setTimeout(() => ($("#loginCenter").value ? $("#loginPassword") : $("#loginCenter")).focus(), 30);
  }

  function showOffline() {
    $("#appView").hidden = true;
    $("#loginView").hidden = true;
    $("#offlineView").hidden = false;
    window.addEventListener("online", () => boot(), { once: true });
    clearInterval(showOffline._t);
    showOffline._t = setInterval(() => { if ($("#offlineView").hidden) clearInterval(showOffline._t); else boot(); }, 15_000);
  }
  $("#offlineRetry").addEventListener("click", () => boot());

  function fillDemo() { $("#loginCenter").value = "brightway"; $("#loginPassword").value = "demo2026"; }
  $("#fillDemo").addEventListener("click", fillDemo);

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#loginError");
    err.hidden = true;
    $("#loginBtn").disabled = true;
    try {
      const r = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ center: $("#loginCenter").value.trim().toLowerCase(), password: $("#loginPassword").value }),
      });
      token = r.token;
      try { localStorage.setItem(TOKEN_KEY, token); } catch {}
      $("#loginPassword").value = "";
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      $("#loginBtn").disabled = false;
    }
  });

  function logout() {
    token = "";
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    showLogin();
  }
  $("#logoutBtn").addEventListener("click", logout);

  // ------------------------------------------------------------ вкладки

  function openTab(name) {
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    const active = $(`#tabs button[data-tab="${name}"]`);
    if (active) { const bar = $("#tabs"); bar.scrollLeft = Math.max(0, active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2); }
    $$("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== name; });
    try { history.replaceState(null, "", `#${name}`); } catch {}
    if (name === "settings") renderSettings();
    if (openTab.cur !== name) animateView(name);
    openTab.cur = name;
  }

  /** Раздел появляется плавно: карточки по очереди, полоски воронки растут, цифры «набегают». */
  function animateView(name) {
    const view = $(`[data-view="${name}"]`);
    if (!view || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    view.classList.remove("enter");
    void view.offsetWidth;
    view.classList.add("enter");
    clearTimeout(animateView._t);
    animateView._t = setTimeout(() => view.classList.remove("enter"), 1600);
    if (name !== "overview") return;
    $$("#kpis .k-value, #funnel .f-num").forEach((el) => {
      const to = Number(el.textContent);
      if (!to) return;
      const t0 = performance.now();
      (function tick(now) {
        if (!el.isConnected) return;
        const k = Math.min(1, (now - t0) / 900);
        el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) openTab(b.dataset.tab); });

  // ------------------------------------------------------------ сводка

  $("#period").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-days]");
    if (!b) return;
    state.days = Number(b.dataset.days);
    $$("#period button").forEach((x) => x.classList.toggle("active", x === b));
    renderOverview();
    animateView("overview");
  });

  function inPeriod(l) {
    return !state.days || Date.now() - new Date(l.createdAt).getTime() <= state.days * 864e5;
  }

  const BOOKED = ["записан", "подтвердил", "пришёл", "купил", "не пришёл"];
  const CAME = ["пришёл", "купил"];

  function renderChecklist() {
    const s = state.settings, ig = state.integrations;
    if (!s || !ig) return;
    const items = [
      [s.courses.length > 0 && s.address, "Курсы, цены и адрес", "Бот отвечает только по этим данным.", "settings"],
      [Object.values(s.slots).some((d) => d.length), "Время пробных уроков", "Без него бот не сможет записать на пробный.", "settings"],
      [s.faq.length >= 3, "3+ частых вопроса", "Скидки, онлайн, оплата, возраст — чем больше ответов, тем реже вопросы уходят администратору.", "settings"],
      [ig.telegram.chats.length > 0 || ig.push?.devices.length > 0, "Уведомления администратору", "Подключите Telegram или установите кабинет как приложение и включите уведомления — заявки будут приходить сразу.", "install"],
      [state.leads.length > 0, "Первая заявка", "Поставьте ссылку на чат в Instagram и автоответ WhatsApp, распечатайте QR-код — и запишитесь сами для проверки.", "install"],
    ];
    const done = items.filter((i) => i[0]).length;
    const box = $("#checklist");
    box.hidden = done === items.length;
    box.innerHTML = `<h3>Подключение: ${done} из ${items.length}</h3>` + items.map(([ok, title, hint, tab]) =>
      `<div class="check ${ok ? "done" : ""}"><span class="box" aria-hidden="true"></span><div><div class="c-title">${esc(title)}</div>${ok ? "" : `<div class="c-hint">${esc(hint)} <button type="button" class="link" data-goto="${tab}">Открыть</button></div>`}</div></div>`).join("");
  }
  $("#checklist").addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) openTab(b.dataset.goto); });

  function renderFollow() {
    const now = Date.now();
    const due = state.leads.map((l) => [l, followUpDue(l, now)]).filter(([, k]) => k)
      .sort((a, b) => ({ mark: 0, came: 1, noshow: 2 }[a[1]] - { mark: 0, came: 1, noshow: 2 }[b[1]]) || slotTime(a[0].slot) - slotTime(b[0].slot));
    const done = state.leads.filter((l) => l.followUp);
    const won = done.filter((l) => l.status === "купил").length;
    const box = $("#follow");
    box.hidden = !due.length && !done.length;
    if (box.hidden) return;
    const why = { mark: "пробный прошёл — отметьте, пришёл ли", came: "был на пробном, ещё не купил", noshow: "не пришёл на пробный" };
    const tag = { mark: "отметить", came: "дожать", noshow: "вернуть" };
    const btn = (attrs, text, cls = "ghost") => `<button type="button" class="btn small ${cls}" ${attrs}>${text}</button>`;
    const rows = due.slice(0, 8).map(([l, k]) => {
      const msg = k === "mark" ? "" : followUpText(l, k);
      const actions = k === "mark"
        ? btn('data-st="пришёл"', "Пришёл") + btn('data-st="купил"', "Купил") + btn('data-st="не пришёл"', "Не пришёл")
        : `<a class="btn small" data-fu-wa href="${esc(waLink(l.phone))}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Написать в WhatsApp</a>`
          + (k === "came" ? btn('data-st="купил"', "Купил") : btn('data-st="отказ"', "Отказ"))
          + btn("data-fu-done", "Уже связались");
      return `<div class="fu-item" data-id="${esc(l.id)}">
        <div class="fu-main"><span class="fu-tag fu-${k}">${tag[k]}</span><b>${esc(l.name)}</b> · <span class="fu-phone">${esc(l.phone)}</span><div class="fu-why">${esc(why[k])}${l.slot ? ` · ${esc(fmtSlot(l.slot))}` : ""}${l.course ? ` · ${esc(l.course)}` : ""}</div>${msg ? `<div class="fu-msg">${esc(msg)}</div>` : ""}</div>
        <div class="fu-actions">${actions}</div>
      </div>`;
    }).join("");
    box.innerHTML = `<div class="fu-head"><h3>Дожать после пробного${due.length ? ` <span class="badge">${due.length}</span>` : ""}</h3>${done.length ? `<span class="fu-stat">После дожима купили: <b>${won}</b> из ${done.length}</span>` : ""}</div>`
      + (rows || `<div class="empty">Сейчас дожимать некого. Отмечайте «пришёл» и «не пришёл» после пробных — клиенты появятся здесь сами.</div>`)
      + (due.length > 8 ? `<p class="muted small">И ещё ${due.length - 8} — появятся, когда разберёте эти.</p>` : "");
  }

  $("#follow").addEventListener("click", async (e) => {
    const item = e.target.closest(".fu-item");
    if (!item) return;
    const id = item.dataset.id;
    const st = e.target.closest("[data-st]");
    try {
      if (st) {
        await patchLead(id, { status: st.dataset.st });
        toast(`Статус: ${st.dataset.st}`);
      } else if (e.target.closest("[data-fu-wa]")) {
        // ссылка откроет WhatsApp сама; отмечаем, что клиенту написали
        await patchLead(id, { followUp: true });
        toast("Отмечено: клиенту написали");
      } else if (e.target.closest("[data-fu-done]")) {
        await patchLead(id, { followUp: true });
        toast("Отмечено");
      } else return;
      renderOverview(); renderLeads();
    } catch (ex) { toast(ex.message); }
  });

  function renderOverview() {
    renderChecklist();
    renderFollow();
    const leads = state.leads.filter(inPeriod);
    const total = leads.length;
    const booked = leads.filter((l) => l.type === "trial" && (l.slot || BOOKED.includes(l.status)) && l.status !== "отказ").length;
    const came = leads.filter((l) => CAME.includes(l.status)).length;
    const bought = leads.filter((l) => l.status === "купил").length;
    const night = leads.filter((l) => afterHours(l.createdAt)).length;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

    $("#kpis").innerHTML = [
      ["Заявок", total, state.days ? `за ${state.days} дней` : "за всё время", ""],
      ["Записались на пробный", booked, `${pct(booked, total)}% от заявок`, ""],
      ["Купили", bought, `${pct(bought, total)}% от заявок`, ""],
      ["Заявок вне рабочего времени", night, "до 9:00, после 20:00 и в воскресенье — без бота их бы потеряли", "accent"],
    ].map(([l, v, n, cls]) => `<div class="kpi ${cls}"><div class="k-label">${esc(l)}</div><div class="k-value">${v}</div><div class="k-note">${esc(n)}</div></div>`).join("");

    const steps = [["Заявки", total], ["Записались на пробный", booked], ["Пришли на урок", came], ["Купили курс", bought]];
    const max = Math.max(total, 1);
    $("#funnel").innerHTML = steps.map(([label, n], i) => {
      const prev = i ? steps[i - 1][1] : 0;
      const sub = i ? `${pct(n, prev)}% от предыдущего шага` : "";
      return `<div class="funnel-row"><div class="f-label">${esc(label)}</div><div class="f-track"><div class="f-bar" style="width:${(n / max) * 100}%"></div></div><div class="f-num">${n}</div>${sub ? `<div class="f-sub">${sub}</div>` : ""}</div>`;
    }).join("") + `<p class="muted small">Статусы «пришёл» и «купил» отмечает администратор во вкладке «Заявки».</p>`;

    const now = Date.now();
    const up = state.leads
      .filter((l) => l.slot && ["записан", "подтвердил"].includes(l.status) && slotTime(l.slot) > now - 3600e3)
      .sort((a, b) => slotTime(a.slot) - slotTime(b.slot))
      .slice(0, 8);
    $("#upcoming").innerHTML = up.length
      ? up.map((l) => `<div class="up-item"><div class="up-when">${esc(fmtSlot(l.slot))}</div><div><div><b>${esc(l.name)}</b> · ${esc(l.phone)}</div><div class="up-who">${esc([l.student, l.course].filter(Boolean).join(" · "))}${l.status === "подтвердил" ? " · подтвердил" : ""}</div></div></div>`).join("")
      : `<div class="empty">Записей на ближайшие дни пока нет.</div>`;
  }

  // ------------------------------------------------------------ заявки

  const stClass = (s) => `st-${s.replace(/ /g, "-")}`;
  const waLink = (phone) => `https://wa.me/${phone.replace(/\D/g, "")}`;

  function renderFilters() {
    const counts = { все: state.leads.length };
    for (const s of state.statuses) counts[s] = state.leads.filter((l) => l.status === s).length;
    $("#filters").innerHTML = ["все", ...state.statuses]
      .filter((s) => s === "все" || counts[s])
      .map((s) => `<button type="button" class="filter ${state.filter === s ? "active" : ""}" data-f="${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}<span>${counts[s]}</span></button>`)
      .join("");
  }

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    state.filter = b.dataset.f;
    renderLeads();
  });
  $("#search").addEventListener("input", (e) => { state.search = e.target.value.trim().toLowerCase(); renderLeads(); });

  function renderLeads() {
    renderFilters();
    const q = state.search;
    const digits = q.replace(/\D/g, "");
    const list = state.leads.filter((l) =>
      (state.filter === "все" || l.status === state.filter) &&
      (!q || l.name.toLowerCase().includes(q) || (digits && l.phone.replace(/\D/g, "").includes(digits))));

    const newCount = state.leads.filter((l) => l.status === "новая").length;
    $("#newBadge").hidden = !newCount;
    $("#newBadge").textContent = newCount;

    if (!list.length) {
      $("#leadsList").innerHTML = `<div class="card empty">${state.leads.length ? "Под фильтр ничего не подходит." : "Заявок пока нет. Откройте чат по ссылке из вкладки «Установка» и запишитесь сами — заявка появится здесь."}</div>`;
      return;
    }
    $("#leadsList").innerHTML = list.map((l) => {
      const details = l.type === "callback"
        ? `<div class="l-detail"><b>Просит перезвонить.</b> ${esc(l.question || "")}</div>`
        : `<div class="l-detail">${[l.student && `<b>${esc(l.student)}</b>`, l.course && esc(l.course), l.wish && `Удобно: ${esc(l.wish)}`].filter(Boolean).join("<br>") || "—"}</div>`;
      return `<article class="lead ${l.status === "новая" ? "is-new" : ""}" data-id="${esc(l.id)}">
        <div>
          <div class="l-name">${esc(l.name)}${l.type === "callback" ? '<span class="tag cb">звонок</span>' : ""}${l.channel === "whatsapp" ? '<span class="tag wa">WhatsApp</span>' : ""}${l.followUp ? `<span class="tag fu" title="${esc(l.followUp.by === "auto" ? "Бот написал в WhatsApp" : "Администратор написал")} ${esc(fmtDate(l.followUp.at))}">дожали</span>` : ""}</div>
          <div class="l-meta">${esc(fmtDate(l.createdAt))} · ${esc(l.source || "")}</div>
          <div class="l-phone"><a href="tel:${esc(l.phone.replace(/[^\d+]/g, ""))}">${esc(l.phone)}</a><a class="wa" href="${esc(waLink(l.phone))}" target="_blank" rel="noopener">WhatsApp</a></div>
        </div>
        ${details}
        <div class="l-slot ${l.slot ? "" : "none"}">${l.slot ? esc(fmtSlot(l.slot)) : l.type === "trial" ? "время не выбрано" : ""}</div>
        <div class="l-actions">
          <select class="status-select ${stClass(l.status)}" aria-label="Статус">${state.statuses.map((s) => `<option ${s === l.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
          <input class="input comment" placeholder="Комментарий" value="${esc(l.comment || "")}" maxlength="1000" aria-label="Комментарий">
          <button class="del" type="button" data-del-lead>Удалить по просьбе клиента</button>
        </div>
      </article>`;
    }).join("");
  }

  async function patchLead(id, patch) {
    const r = await api(`/api/cabinet/leads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    const i = state.leads.findIndex((l) => l.id === id);
    if (i >= 0) state.leads[i] = r.lead;
    return r.lead;
  }

  $("#leadsList").addEventListener("change", async (e) => {
    const card = e.target.closest(".lead");
    if (!card) return;
    const id = card.dataset.id;
    try {
      if (e.target.matches(".status-select")) {
        e.target.className = `status-select ${stClass(e.target.value)}`;
        await patchLead(id, { status: e.target.value });
        toast("Статус сохранён");
        renderLeads();
        renderOverview();
      } else if (e.target.matches(".comment")) {
        await patchLead(id, { comment: e.target.value });
        toast("Комментарий сохранён");
      }
    } catch (ex) { toast(ex.message); }
  });

  $("#leadsList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del-lead]");
    if (!b) return;
    const card = b.closest(".lead");
    if (!confirm("Удалить заявку и данные клиента без возможности восстановления? Это делают, когда клиент отзывает согласие.")) return;
    try {
      await api(`/api/cabinet/leads/${encodeURIComponent(card.dataset.id)}`, { method: "DELETE" });
      state.leads = state.leads.filter((l) => l.id !== card.dataset.id);
      renderLeads(); renderOverview();
      toast("Заявка удалена");
    } catch (ex) { toast(ex.message); }
  });

  $("#exportBtn").addEventListener("click", async () => {
    try {
      const blob = await api("/api/cabinet/export");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `zayavki-${state.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (ex) { toast(ex.message); }
  });

  // ------------------------------------------------------------ вопросы

  function renderQuestions() {
    const open = state.questions.filter((q) => q.escalated && !q.resolved);
    $("#qBadge").hidden = !open.length;
    $("#qBadge").textContent = open.length;
    const list = state.showAllQ ? state.questions : open;
    $("#questionsList").innerHTML = list.length
      ? list.map((q) => `<div class="q ${q.escalated && !q.resolved ? "open" : ""}" data-id="${esc(q.id)}">
          <div class="q-text">${esc(q.text)}</div>
          <div class="q-when">${esc(fmtDate(q.createdAt))}${q.channel === "whatsapp" ? " · WhatsApp" : ""}</div>
          <div class="q-answer">Бот ответил${q.via ? `<span class="via">${q.via === "ai" ? "ИИ" : "по FAQ"}</span>` : ""}: ${esc(q.answer)}</div>
          <div class="q-actions">${q.escalated && !q.resolved ? '<button class="btn ghost small" type="button" data-resolve>Решено</button>' : '<span class="q-when">решено</span>'}<button class="del" type="button" data-del-q>Удалить</button></div>
        </div>`).join("")
      : `<div class="card empty">${state.showAllQ ? "Вопросов пока нет." : "Все вопросы решены — бот справился сам."}</div>`;
  }

  $("#showAllQ").addEventListener("change", (e) => { state.showAllQ = e.target.checked; renderQuestions(); });
  $("#questionsList").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-del-q]");
    if (d) {
      const id = d.closest(".q").dataset.id;
      if (!confirm("Удалить вопрос из истории?")) return;
      try {
        await api(`/api/cabinet/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
        state.questions = state.questions.filter((q) => q.id !== id);
        renderQuestions();
      } catch (ex) { toast(ex.message); }
      return;
    }
    const b = e.target.closest("[data-resolve]");
    if (!b) return;
    const id = b.closest(".q").dataset.id;
    try {
      const r = await api(`/api/cabinet/questions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ resolved: true }) });
      const i = state.questions.findIndex((q) => q.id === id);
      if (i >= 0) state.questions[i] = r.question;
      renderQuestions();
    } catch (ex) { toast(ex.message); }
  });

  // ------------------------------------------------------------ настройки

  const form = $("#settingsForm");

  function courseRow(c = {}) {
    const div = document.createElement("div");
    div.className = "row course";
    div.innerHTML = `
      <input class="input" data-k="name" placeholder="Название курса" maxlength="100" value="${esc(c.name)}" aria-label="Название курса">
      <input class="input" data-k="for" placeholder="Для кого" maxlength="100" value="${esc(c.for)}" aria-label="Для кого">
      <input class="input" data-k="format" placeholder="Формат: группа, сколько раз в неделю" maxlength="200" value="${esc(c.format)}" aria-label="Формат">
      <input class="input" data-k="price" placeholder="Цена" maxlength="80" value="${esc(c.price)}" aria-label="Цена">
      <button class="remove" type="button" aria-label="Удалить курс">×</button>`;
    return div;
  }

  function faqRow(f = {}) {
    const div = document.createElement("div");
    div.className = "row faq";
    div.innerHTML = `
      <input class="input" data-k="q" placeholder="Вопрос" maxlength="200" value="${esc(f.q)}" aria-label="Вопрос">
      <textarea class="textarea" data-k="a" placeholder="Ответ" maxlength="600" rows="2" aria-label="Ответ">${esc(f.a)}</textarea>
      <button class="remove" type="button" aria-label="Удалить вопрос">×</button>`;
    return div;
  }

  function renderSettings() {
    const s = state.settings;
    if (!s) return;
    const set = (name, v) => { const el = form.elements[name]; if (el) el.value = v ?? ""; };
    ["name", "city", "address", "hours", "phone"].forEach((k) => set(k, s[k]));
    set("trial.durationMin", s.trial.durationMin);
    set("trial.price", s.trial.price);
    set("trial.capacityPerSlot", s.trial.capacityPerSlot);
    set("trial.whatHappens", s.trial.whatHappens);
    set("studentTypes", s.studentTypes.join(", "));
    set("newPassword", "");
    const fu = s.followUp || {};
    set("followUp.came", fu.came);
    set("followUp.noshow", fu.noshow);
    form.elements["followUp.auto"].checked = fu.auto !== false;
    $("#daysGrid").innerHTML = DAYS.map(([k, ru]) => `<label>${ru}<input class="input" data-day="${k}" value="${esc((s.slots[k] || []).join(", "))}" placeholder="—"></label>`).join("");
    const cl = $("#coursesList"); cl.innerHTML = ""; s.courses.forEach((c) => cl.appendChild(courseRow(c)));
    const fl = $("#faqList"); fl.innerHTML = ""; s.faq.forEach((f) => fl.appendChild(faqRow(f)));
    $("#saveStatus").textContent = "";
    renderBrand();
  }

  // ------------------------------------------------------------ оформление чата

  const SWATCHES = ["#0B6B4E", "#1C2A5C", "#1F4FD8", "#0F766E", "#7A3FE0", "#BE185D", "#C2410C", "#111827"];
  const brandDraft = { color: "#0B6B4E", header: "light", pattern: "none" };
  const isLightColor = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5;
  };
  const initialsOf = (name) => (name || "").split(/[\s«»"'-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AI";

  function renderBrand() {
    const b = state.settings.brand || {};
    Object.assign(brandDraft, { color: b.color || "#0B6B4E", header: b.header || "light", pattern: b.pattern || "none" });
    form.querySelectorAll('input[name="brand.header"]').forEach((r) => { r.checked = r.value === brandDraft.header; });
    form.elements["brand.pattern"].checked = brandDraft.pattern === "uk";
    $("#pvOpen").href = `/chat/?c=${encodeURIComponent(state.slug)}`;
    updateBrand();
  }
  function updateBrand() {
    const custom = !SWATCHES.includes(brandDraft.color.toUpperCase());
    $("#swatches").innerHTML = SWATCHES.map((c) => `<button type="button" class="swatch" role="radio" aria-checked="${c === brandDraft.color.toUpperCase()}" aria-label="Цвет ${c}" data-color="${c}" style="background:${c}"></button>`).join("")
      + `<label class="swatch-custom ${custom ? "on" : ""}" title="Свой цвет"><input type="color" id="colorCustom" value="${esc(brandDraft.color)}" aria-label="Свой цвет"></label>`;
    const pattern = form.elements["brand.pattern"];
    pattern.disabled = brandDraft.header !== "brand";
    pattern.closest(".check-line").classList.toggle("disabled", pattern.disabled);
    const pv = $("#brandPreview");
    pv.style.setProperty("--c", brandDraft.color);
    pv.style.setProperty("--on", isLightColor(brandDraft.color) ? "#111A15" : "#fff");
    pv.classList.toggle("pv-brand", brandDraft.header === "brand");
    pv.classList.toggle("pv-uk", brandDraft.pattern === "uk");
    const name = form.elements.name.value.trim() || state.settings.name;
    $("#pvName").textContent = name;
    const logo = state.logoUrl;
    for (const box of [$("#pvLogo"), $("#logoTile")]) {
      box.innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : esc(initialsOf(name));
      box.classList.toggle(box.id === "pvLogo" ? "img" : "has", !!logo);
    }
    $("#logoRemove").hidden = !logo;
  }
  $("#swatches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (b) { brandDraft.color = b.dataset.color; updateBrand(); }
  });
  $("#swatches").addEventListener("input", (e) => {
    if (e.target.id === "colorCustom") { brandDraft.color = e.target.value.toUpperCase(); updateBrand(); setTimeout(() => $("#colorCustom")?.focus(), 0); }
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "brand.header") { brandDraft.header = e.target.value; if (brandDraft.header !== "brand") brandDraft.pattern = "none"; form.elements["brand.pattern"].checked = brandDraft.pattern === "uk"; updateBrand(); }
    if (e.target.name === "brand.pattern") { brandDraft.pattern = e.target.checked ? "uk" : "none"; updateBrand(); }
  });
  form.elements.name.addEventListener("input", () => updateBrand());

  /** Картинку уменьшаем в браузере до 256×256 (PNG с прозрачностью) — на сервер уходит маленький файл, SVG превращается в PNG. */
  async function shrinkLogo(file) {
    const src = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("Не получилось открыть картинку")); img.src = src; });
      const size = 256;
      const w = img.naturalWidth || size, h = img.naturalHeight || size;
      const k = Math.min(size / w, size / h);
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
      let data = canvas.toDataURL("image/png");
      if (data.length > 500_000) data = canvas.toDataURL("image/webp", 0.92);
      return data;
    } finally {
      URL.revokeObjectURL(src);
    }
  }
  $("#logoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("#logoStatus");
    if (file.size > 8_000_000) { status.textContent = "Файл слишком большой — до 8 МБ."; return; }
    status.textContent = "Загружаю…";
    try {
      const data = await shrinkLogo(file);
      const r = await api("/api/cabinet/logo", { method: "POST", body: JSON.stringify({ data }) });
      state.logoUrl = r.logoUrl;
      state.settings.brand = { ...state.settings.brand, logo: r.brand.logo };
      status.textContent = "Логотип сохранён — в чате он уже появился.";
      updateBrand();
    } catch (ex) {
      status.textContent = ex.message;
    }
  });
  $("#logoRemove").addEventListener("click", async () => {
    if (!confirm("Убрать логотип из чата?")) return;
    try {
      await api("/api/cabinet/logo", { method: "DELETE" });
      state.logoUrl = "";
      $("#logoStatus").textContent = "Логотип убран — вместо него в чате буквы названия.";
      updateBrand();
    } catch (ex) { toast(ex.message); }
  });

  $("#addCourse").addEventListener("click", () => { const r = courseRow(); $("#coursesList").appendChild(r); $("input", r).focus(); });
  $("#addFaq").addEventListener("click", () => { const r = faqRow(); $("#faqList").appendChild(r); $("input", r).focus(); });
  form.addEventListener("click", (e) => { if (e.target.matches(".remove")) e.target.closest(".row").remove(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    const settings = {
      name: v("name"), city: v("city"), address: v("address"), hours: v("hours"), phone: v("phone"),
      utcOffset: state.settings.utcOffset,
      trial: { durationMin: Number(v("trial.durationMin")), price: v("trial.price"), capacityPerSlot: Number(v("trial.capacityPerSlot")), whatHappens: v("trial.whatHappens") },
      slots: Object.fromEntries($$("#daysGrid input").map((i) => [i.dataset.day, i.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)])),
      studentTypes: v("studentTypes").split(",").map((x) => x.trim()).filter(Boolean),
      courses: $$("#coursesList .row").map((r) => Object.fromEntries($$("[data-k]", r).map((i) => [i.dataset.k, i.value.trim()]))).filter((c) => c.name),
      faq: $$("#faqList .row").map((r) => Object.fromEntries($$("[data-k]", r).map((i) => [i.dataset.k, i.value.trim()]))).filter((f) => f.q && f.a),
      brand: { color: brandDraft.color, header: brandDraft.header, pattern: brandDraft.pattern },
      followUp: { auto: form.elements["followUp.auto"].checked, came: v("followUp.came"), noshow: v("followUp.noshow") },
    };
    const status = $("#saveStatus");
    status.className = "save-status";
    status.textContent = "Сохраняю…";
    $("#saveBtn").disabled = true;
    try {
      const r = await api("/api/cabinet/settings", { method: "PUT", body: JSON.stringify({ settings, newPassword: v("newPassword") }) });
      state.settings = r.settings;
      $("#centerName").textContent = r.settings.name;
      renderSettings();
      status.className = "save-status ok";
      status.textContent = "Сохранено. Чат уже отвечает по новым данным.";
    } catch (ex) {
      status.className = "save-status err";
      status.textContent = ex.message;
    } finally {
      $("#saveBtn").disabled = false;
    }
  });

  // ------------------------------------------------------------ установка

  function renderInstall() {
    const origin = location.origin;
    $("#snippet").textContent = `<script src="${origin}/widget.js" data-center="${state.slug}" async></script>`;
    const link = `${origin}/chat/?c=${state.slug}&src=qr`;
    const plain = `${origin}/chat/?c=${state.slug}`;
    $("#chatLink").textContent = plain;
    $("#chatLinkOpen").href = plain;
    $("#posterLink").href = `/cabinet/poster/?c=${encodeURIComponent(state.slug)}`;
    try {
      const qr = qrcode(0, "M");
      qr.addData(link);
      qr.make();
      $("#qrBox").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch { $("#qrBox").textContent = "QR не загрузился"; }
    renderIntegrations();
  }

  $("#qrDownload").addEventListener("click", () => {
    const svg = $("#qrBox svg");
    if (!svg) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg.outerHTML], { type: "image/svg+xml" }));
    a.download = `qr-chat-${state.slug}.svg`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  function renderIntegrations() {
    const ig = state.integrations;
    if (!ig) return;
    const chats = ig.telegram.chats;
    $("#tgChats").innerHTML = !ig.telegram.configured
      ? '<p class="muted">Telegram-бот сервиса ещё не настроен.</p>'
      : chats.length
        ? chats.map((c) => `<div class="chat-item"><span><span class="ok-dot"></span><b>${esc(c.name)}</b> <span class="muted small">с ${esc(fmtDate(c.linkedAt))}</span></span><button class="del" type="button" data-unlink="${esc(String(c.id))}">Отключить</button></div>`).join("")
        : '<p><span class="off-dot"></span>Пока не подключён.</p>';
    $("#tgConnect").hidden = !ig.telegram.configured;
    $("#tgConnect").textContent = chats.length ? "Подключить ещё один чат" : "Подключить Telegram";
    const wa = ig.whatsapp;
    $("#waStatus").innerHTML = wa.enabled
      ? `<p><span class="ok-dot"></span>Бот отвечает в WhatsApp на номере <b>${esc(wa.displayPhone || "центра")}</b>.</p>${wa.displayPhone ? `<div class="code"><code id="waLink">https://wa.me/${esc(wa.displayPhone.replace(/\D/g, ""))}</code><button class="btn ghost small" type="button" data-copy="waLink">Копировать</button></div><p class="muted small">Эту ссылку ставьте в Instagram и рекламу «Написать в WhatsApp».</p>` : ""}`
      : '<p><span class="off-dot"></span>Не подключён. Подключение WhatsApp к номеру центра делает команда сервиса: нужен аккаунт Meta Business и отдельный номер для бота. Напишите нам — поможем.</p>';
  }

  let tgPoll = null;
  $("#tgConnect").addEventListener("click", async () => {
    const w = window.open("about:blank", "_blank");
    try {
      const { url } = await api("/api/cabinet/telegram", { method: "POST" });
      if (w) w.location.href = url; else window.location.href = url;
      const link = $("#tgLink");
      link.href = url; link.textContent = "Бот не открылся? Нажмите сюда"; link.hidden = false;
      const group = $("#tgGroup");
      group.href = url.replace("?start=", "?startgroup="); group.hidden = false;
      const before = state.integrations.telegram.chats.length;
      clearInterval(tgPoll);
      let n = 0;
      tgPoll = setInterval(async () => {
        if (++n > 40) return clearInterval(tgPoll);
        try {
          const ig = await api("/api/cabinet/telegram");
          if (ig.telegram.chats.length > before) {
            clearInterval(tgPoll);
            state.integrations = ig;
            renderIntegrations(); renderChecklist();
            link.hidden = true; $("#tgGroup").hidden = true;
            toast("Telegram подключён");
          }
        } catch {}
      }, 4000);
    } catch (ex) {
      if (w) w.close();
      toast(ex.message);
    }
  });

  $("#tgChats").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-unlink]");
    if (!b) return;
    if (!confirm("Отключить уведомления в этом чате?")) return;
    try {
      state.integrations = await api(`/api/cabinet/telegram/${encodeURIComponent(b.dataset.unlink)}`, { method: "DELETE" });
      renderIntegrations(); renderChecklist();
    } catch (ex) { toast(ex.message); }
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const text = document.getElementById(b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); toast("Скопировано"); }
    catch { toast("Выделите текст и скопируйте вручную"); }
  });

  // ------------------------------------------------------------ приложение и push-уведомления

  const UA = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(UA);
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const EVENTS = ["leads", "questions", "digest"];
  let swReg = null, installPrompt = null, mySubId = null;

  function deviceName() {
    const os = isIOS ? (/iPhone/.test(UA) ? "iPhone" : "iPad") : isAndroid ? "Android" : /Windows/.test(UA) ? "Windows" : /Mac/.test(UA) ? "Mac" : /Linux/.test(UA) ? "Linux" : "Устройство";
    const br = /Edg\//.test(UA) ? "Edge" : /YaBrowser/.test(UA) ? "Яндекс Браузер" : /OPR\//.test(UA) ? "Opera" : /Firefox\//.test(UA) ? "Firefox" : /Chrome\//.test(UA) ? "Chrome" : /Safari\//.test(UA) ? "Safari" : "";
    return standalone() ? `${os} · приложение` : br ? `${os} · ${br}` : os;
  }

  const b64ToBytes = (b64) => {
    const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  };
  async function subIdOf(endpoint) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
    return btoa(String.fromCharCode(...h)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
  }
  function sameKey(sub, key) {
    const a = sub.options?.applicationServerKey;
    if (!a) return true;
    const x = new Uint8Array(a), y = b64ToBytes(key);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = swReg || (await navigator.serviceWorker.getRegistration("/cabinet/"));
    return reg ? reg.pushManager.getSubscription() : null;
  }
  const readEvents = () => Object.fromEntries(EVENTS.map((k) => [k, $(`#pushEvents input[name="${k}"]`).checked]));

  async function renderApp() {
    const ig = state.integrations;
    if (!ig || !$("#appCard")) return;
    const inst = $("#appInstall");
    if (standalone()) inst.innerHTML = '<p><span class="ok-dot"></span>Кабинет открыт как приложение.</p>';
    else if (installPrompt) inst.innerHTML = '<div class="row-actions"><button class="btn small" type="button" id="installBtn">Установить приложение</button></div>';
    else if (isIOS) inst.innerHTML = '<ol class="steps"><li>Откройте эту страницу в <b>Safari</b>.</li><li>Нажмите «Поделиться» (квадрат со стрелкой вверх) внизу экрана.</li><li>Выберите «На экран „Домой“» и нажмите «Добавить».</li><li>Откройте кабинет с иконки на экране и войдите — дальше вход сохранится.</li></ol>';
    else if (isAndroid) inst.innerHTML = '<p>Откройте меню браузера <b>⋮</b> → «Установить приложение» или «Добавить на главный экран».</p>';
    else inst.innerHTML = '<p>В Chrome или Edge нажмите значок установки справа в адресной строке или меню <b>⋮</b> → «Установить ИИ-администратор». В других браузерах можно просто добавить кабинет в закладки.</p>';

    const p = ig.push || { configured: false, devices: [] };
    const sub = await currentSub().catch(() => null);
    mySubId = sub ? await subIdOf(sub.endpoint) : null;
    const mine = p.devices.find((d) => d.id === mySubId);
    let html, canOn = false;
    if (!p.configured) html = '<p class="muted">Уведомления в приложении ещё не настроены на сервере. Пока подключите Telegram ниже.</p>';
    else if (isIOS && !standalone()) html = '<p><span class="off-dot"></span>На iPhone и iPad уведомления работают только в установленном приложении (iOS 16.4 и новее). Сначала добавьте кабинет на экран «Домой» по шагам выше и откройте его оттуда.</p>';
    else if (!pushSupported()) html = '<p><span class="off-dot"></span>Этот браузер не умеет показывать уведомления. Откройте кабинет в Chrome, Edge, Safari или Firefox.</p>';
    else if (Notification.permission === "denied") html = '<p><span class="off-dot"></span>Уведомления запрещены в настройках браузера. Разрешите их для этого сайта (значок слева от адреса → «Уведомления») и обновите страницу.</p>';
    else if (mine) html = '<p><span class="ok-dot"></span>Уведомления на этом устройстве включены.</p>';
    else { html = '<p><span class="off-dot"></span>На этом устройстве уведомления выключены.</p>'; canOn = true; }
    $("#pushState").innerHTML = html;
    $("#pushOn").hidden = !canOn;
    $("#pushTest").hidden = $("#pushOff").hidden = !mine;
    $("#pushEvents").hidden = !(canOn || mine);
    if (mine) EVENTS.forEach((k) => { $(`#pushEvents input[name="${k}"]`).checked = mine.events[k] !== false; });
    $("#pushDevices").innerHTML = p.devices.length
      ? '<h4 class="sub-h">Устройства с уведомлениями</h4>' + p.devices.map((d) =>
        `<div class="chat-item"><span><span class="ok-dot"></span><b>${esc(d.device)}</b>${d.id === mySubId ? ' <span class="tag">это устройство</span>' : ""} <span class="muted small">с ${esc(fmtDate(d.createdAt))}</span></span><button class="del" type="button" data-push-del="${esc(d.id)}">Отключить</button></div>`).join("")
      : "";
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/cabinet/sw.js", { scope: "/cabinet/" })
      .then((r) => { swReg = r; renderApp(); })
      .catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (!token) return;
      if (e.data?.type === "open") {
        const tab = new URL(e.data.url, location.href).hash.slice(1);
        if (["overview", "leads", "questions", "settings", "install"].includes(tab)) openTab(tab);
      }
      if (e.data?.type === "push" || e.data?.type === "open") refresh().catch(() => {});
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderApp(); });
  window.addEventListener("appinstalled", () => { installPrompt = null; toast("Приложение установлено"); renderApp(); });

  $("#appInstall").addEventListener("click", async (e) => {
    if (!e.target.closest("#installBtn") || !installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    renderApp();
  });

  $("#pushOn").addEventListener("click", async () => {
    const btn = $("#pushOn");
    btn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Без разрешения браузера уведомления не придут"); return; }
      const reg = swReg || (await navigator.serviceWorker.ready);
      const key = state.integrations.push.publicKey;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const r = await api("/api/cabinet/push", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON(), device: deviceName(), events: readEvents() }) });
      state.integrations.push.devices = r.devices;
      toast("Уведомления включены — сейчас придёт проверочное");
      api(`/api/cabinet/push/${encodeURIComponent(r.id)}/test`, { method: "POST" }).catch((ex) => toast(ex.message));
    } catch (ex) {
      toast(ex.message || "Не получилось включить уведомления");
    } finally {
      btn.disabled = false;
      renderApp(); renderChecklist();
    }
  });

  $("#pushTest").addEventListener("click", async () => {
    if (!mySubId) return;
    try { await api(`/api/cabinet/push/${encodeURIComponent(mySubId)}/test`, { method: "POST" }); toast("Отправили — уведомление придёт через пару секунд"); }
    catch (ex) { toast(ex.message); renderApp(); }
  });

  async function removeDevice(id) {
    const r = await api(`/api/cabinet/push/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.integrations.push.devices = r.devices;
    if (id === mySubId) { const sub = await currentSub(); await sub?.unsubscribe().catch(() => {}); }
    renderApp(); renderChecklist();
  }
  $("#pushOff").addEventListener("click", () => mySubId && removeDevice(mySubId).then(() => toast("Уведомления на этом устройстве выключены")).catch((ex) => toast(ex.message)));
  $("#pushDevices").addEventListener("click", (e) => {
    const b = e.target.closest("[data-push-del]");
    if (b && confirm("Отключить уведомления на этом устройстве?")) removeDevice(b.dataset.pushDel).catch((ex) => toast(ex.message));
  });

  $("#pushEvents").addEventListener("change", async () => {
    if (!mySubId || !state.integrations.push.devices.some((d) => d.id === mySubId)) return;
    try {
      const r = await api(`/api/cabinet/push/${encodeURIComponent(mySubId)}`, { method: "PATCH", body: JSON.stringify({ events: readEvents() }) });
      state.integrations.push.devices = r.devices;
      toast("Сохранено");
    } catch (ex) { toast(ex.message); }
  });

  // ------------------------------------------------------------ загрузка

  async function refresh() {
    const [leads, questions] = await Promise.all([api("/api/cabinet/leads"), api("/api/cabinet/questions")]);
    state.leads = leads.leads;
    state.questions = questions.questions;
    const fresh = state.leads.filter((l) => l.status === "новая").length;
    try { if (navigator.setAppBadge) fresh ? navigator.setAppBadge(fresh) : navigator.clearAppBadge(); } catch {}
    renderOverview();
    // не перерисовываем список, пока администратор печатает комментарий
    if (!$("#leadsList").contains(document.activeElement)) renderLeads();
    renderQuestions();
  }

  async function boot() {
    if (!token) return showLogin();
    try {
      const me = await api("/api/cabinet/me");
      state.slug = me.slug;
      state.settings = me.settings;
      state.statuses = me.statuses;
      state.integrations = me.integrations;
      state.logoUrl = me.logoUrl || "";
      if (me.token) { token = me.token; try { localStorage.setItem(TOKEN_KEY, token); } catch {} }
    } catch (ex) {
      // без интернета не выкидываем на вход — ждём связь (вход сохранён)
      if (token && (ex instanceof TypeError || !navigator.onLine)) return showOffline();
      return showLogin();
    }
    $("#offlineView").hidden = true;
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    $("#centerName").textContent = state.settings.name;
    document.title = `${state.settings.name} — кабинет`;
    renderInstall();
    renderApp();
    await refresh().catch((ex) => toast(ex.message));
    const tab = location.hash.slice(1);
    openTab(["overview", "leads", "questions", "settings", "install"].includes(tab) ? tab : "overview");
    clearInterval(boot._t);
    boot._t = setInterval(() => { if (!document.hidden && token) refresh().catch(() => {}); }, 60_000);
  }

  boot();
})();
