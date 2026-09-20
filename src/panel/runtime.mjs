// Каркас панели в браузере: вход, загрузка состояния, навигация, общие
// помощники (запросы, диалоги, панель сохранения, форматирование).

const PANEL_SHELL = String.raw`
<section id="setupScreen" class="auth hidden">
  <form id="setupForm" class="auth-card">
    <img src="/login-assets/logo.png" alt="">
    <h1>Первая настройка</h1>
    <p class="muted small">Укажите токен бота из BotFather и придумайте пароль от панели.</p>
    <div class="stack">
      <div class="field"><label for="setupToken">Токен бота</label><input id="setupToken" required placeholder="123456:AA..." autocomplete="off"></div>
      <div class="field"><label for="setupPassword">Пароль администратора</label><input id="setupPassword" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn" type="submit">Сохранить и открыть панель</button>
      <p id="setupError" class="small hidden" style="color:var(--bad)"></p>
    </div>
  </form>
</section>

<section id="loginScreen" class="auth hidden">
  <form id="loginForm" class="auth-card">
    <img src="/login-assets/logo.png" alt="">
    <h1>Панель бота</h1>
    <p class="muted small" id="loginSubtitle">Введите пароль администратора.</p>
    <div class="stack">
      <div class="field"><label for="loginPassword">Пароль</label><input id="loginPassword" type="password" required autocomplete="current-password"></div>
      <div class="field hidden" id="loginCodeField"><label for="loginCode">Код из Telegram</label><input id="loginCode" inputmode="numeric" autocomplete="one-time-code" placeholder="6 цифр"></div>
      <button class="btn" type="submit">Войти</button>
      <p id="loginError" class="small hidden" style="color:var(--bad)"></p>
    </div>
  </form>
</section>

<div id="app" class="app hidden">
  <aside class="side" id="side">
    <div class="side-brand">
      <img src="/admin-assets/sidebar-logo.png" alt="">
      <b>Construcciones<br>Kornilenko<span>панель бота</span></b>
    </div>
    <nav id="nav"></nav>
    <div class="side-foot">
      <div class="state-line" id="botState"><span class="dot"></span><span class="grow" id="botStateText">Загрузка…</span></div>
      <button class="btn ghost small" id="logoutBtn" type="button">Выйти</button>
    </div>
  </aside>
  <div class="main">
    <div class="topbar">
      <button class="btn ghost icon menu-toggle" id="menuToggle" type="button">☰</button>
      <div><h1 id="pageTitle">Обзор</h1><div class="sub" id="pageSubtitle"></div></div>
      <div class="grow"></div>
      <div id="pageActions" class="row"></div>
    </div>
    <div class="page" id="page"></div>
  </div>
</div>
<div id="toast" class="toast hidden"></div>
<div id="savebar" class="savebar hidden"><span class="grow" id="savebarText">Есть несохранённые изменения</span><button class="btn secondary" id="savebarReset" type="button">Отменить</button><button class="btn" id="savebarSave" type="button">Сохранить</button></div>
`;

const PANEL_RUNTIME_JS = String.raw`
var state = null, csrf = "", currentView = "overview", currentTab = "", dirtyForm = null, refreshTimer = 0, loginChallenge = "";
var VIEWS = {};

function el(id) { return document.getElementById(id); }
function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function num(value) { return new Intl.NumberFormat("ru-RU").format(Number(value || 0)); }
function plural(value, one, few, many) { var n = Math.abs(Number(value || 0)) % 100, last = n % 10; return n > 10 && n < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many; }
function counted(value, one, few, many) { return num(value) + " " + plural(value, one, few, many); }
function money(value, currency) { return num(value) + " " + (currency === "USD" ? "$" : currency === "GBP" ? "£" : "€"); }
function dateTime(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); } catch (e) { return "—"; } }
function dateShort(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(value)); } catch (e) { return "—"; } }
function ago(value) {
  var time = Date.parse(value || "");
  if (!time) return "—";
  var minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return minutes + " мин назад";
  var hours = Math.round(minutes / 60);
  if (hours < 24) return hours + " ч назад";
  var days = Math.round(hours / 24);
  return days < 30 ? counted(days, "день", "дня", "дней") + " назад" : dateShort(value);
}
function initials(name) { return String(name || "?").trim().slice(0, 1).toUpperCase(); }
function localized(value, language) { return value && typeof value === "object" ? String(value[language || "ru"] || value.ru || "") : String(value || ""); }

function api(url, options) {
  options = options || {};
  options.headers = Object.assign({ "content-type": "application/json" }, options.headers || {});
  if (options.method && options.method !== "GET") options.headers["x-csrf-token"] = csrf;
  return fetch(url, options).then(async function (response) {
    var body = {};
    try { body = await response.json(); } catch (e) {}
    if (!response.ok) { var error = new Error(body.error || "Ошибка запроса"); error.status = response.status; throw error; }
    return body;
  });
}
function send(url, method, payload) { return api(url, { method: method, body: JSON.stringify(payload || {}) }); }

function toast(text, bad) {
  var box = el("toast");
  box.textContent = text;
  box.classList.toggle("bad", Boolean(bad));
  box.classList.remove("hidden");
  clearTimeout(box._timer);
  box._timer = setTimeout(function () { box.classList.add("hidden"); }, 3600);
}
function fail(error) { toast(error && error.message ? error.message : "Не получилось", true); }

// Диалоги: подтверждение и произвольная форма.
function confirmDialog(title, text, confirmText, danger) {
  return new Promise(function (resolve) {
    var dialog = document.createElement("dialog");
    dialog.innerHTML = '<div class="dialog-head"><h2>' + esc(title) + '</h2></div><div class="dialog-body"><p class="muted">' + esc(text) + '</p></div>' +
      '<div class="dialog-foot"><button class="btn secondary" value="cancel">Отмена</button><button class="btn ' + (danger ? "danger" : "") + '" value="ok">' + esc(confirmText || "Подтвердить") + '</button></div>';
    document.body.appendChild(dialog);
    dialog.querySelectorAll("button").forEach(function (button) {
      button.onclick = function () { dialog.close(button.value); };
    });
    dialog.addEventListener("close", function () { resolve(dialog.returnValue === "ok"); dialog.remove(); });
    dialog.showModal();
  });
}

function openDialog(options) {
  var dialog = document.createElement("dialog");
  if (options.drawer) dialog.className = "drawer";
  dialog.innerHTML = '<div class="dialog-head"><h2>' + esc(options.title) + '</h2><div class="grow"></div><button class="btn ghost icon" data-close="1" type="button">✕</button></div>' +
    '<div class="dialog-body">' + options.body + '</div>' +
    (options.footer === null ? "" : '<div class="dialog-foot">' + (options.footer || '<button class="btn secondary" data-close="1" type="button">Закрыть</button>') + '</div>');
  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close]").forEach(function (button) { button.onclick = function () { dialog.close(); }; });
  dialog.addEventListener("close", function () { dialog.remove(); });
  dialog.showModal();
  if (options.ready) options.ready(dialog);
  return dialog;
}

// Панель сохранения: форма сообщает, что изменилась и как сохраниться.
function watchForm(root, save, label) {
  var changed = false;
  function mark() {
    if (changed) return;
    changed = true;
    dirtyForm = { save: save, root: root };
    el("savebarText").textContent = label || "Есть несохранённые изменения";
    el("savebar").classList.remove("hidden");
  }
  root.addEventListener("input", mark);
  root.addEventListener("change", mark);
  return { mark: mark };
}
function clearDirty() { dirtyForm = null; el("savebar").classList.add("hidden"); }
function isDirty() { return Boolean(dirtyForm); }

async function saveDirty() {
  if (!dirtyForm) return;
  var current = dirtyForm;
  try {
    await current.save();
    clearDirty();
    toast("Сохранено");
    await reload();
  } catch (error) { fail(error); }
}

// --- Состояние и навигация ---------------------------------------------------
async function reload(render) {
  state = await api("/api/state");
  csrf = state.csrf;
  renderNav();
  renderBotState();
  if (render !== false) renderView();
}

function navItems() {
  var waiting = (state && state.inquiries || []).filter(awaitsReply).length;
  return [
    { id: "overview", icon: "◉", title: "Обзор" },
    { id: "inquiries", icon: "✉", title: "Обращения", count: waiting, tabs: [["inbox", "Обращения"], ["viewings", "Просмотры"], ["clients", "Клиенты"]] },
    { id: "catalog", icon: "⌂", title: "Каталог", tabs: [["objects", "Объекты"], ["offers", "Акции"], ["feed", "Загрузка с сайта"]] },
    { id: "texts", icon: "✎", title: "Тексты бота", tabs: [["welcome", "Приветствие"], ["sections", "Разделы"], ["contacts", "Контакты"], ["rules", "Автоответы"], ["interface", "Интерфейс"]] },
    { id: "reach", icon: "➤", title: "Рассылки и каналы", tabs: [["campaigns", "Рассылки"], ["group", "Группы и каналы"]] },
    { id: "stats", icon: "▦", title: "Статистика" },
    { id: "settings", icon: "⚙", title: "Настройки", tabs: [["connection", "Подключение"], ["work", "Работа с клиентами"], ["data", "Данные"], ["access", "Доступ"]] },
  ];
}

function awaitsReply(inquiry) {
  if (!inquiry || inquiry.status === "closed") return false;
  var replies = inquiry.replies || [];
  if (!replies.length) return inquiry.status === "new";
  var lastReply = Math.max.apply(null, replies.map(function (reply) { return Date.parse(reply.createdAt) || 0; }));
  return (Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0) > lastReply;
}

function renderNav() {
  el("nav").innerHTML = navItems().map(function (item) {
    return '<button class="nav-item' + (item.id === currentView ? " active" : "") + '" data-view="' + item.id + '" type="button">' +
      '<span class="ico">' + item.icon + '</span><span class="grow">' + esc(item.title) + '</span>' +
      (item.count ? '<span class="count">' + num(item.count) + '</span>' : '') + '</button>';
  }).join("");
  el("nav").querySelectorAll("[data-view]").forEach(function (button) {
    button.onclick = function () { go(button.dataset.view); el("side").classList.remove("open"); };
  });
}

function renderBotState() {
  var runtime = state.runtime || {}, active = state.config.active;
  var bad = runtime.status === "error" || runtime.consecutiveFailures > 0;
  var dot = !active ? "off" : bad ? "bad" : "on";
  el("botState").querySelector(".dot").className = "dot " + dot;
  el("botStateText").innerHTML = !active
    ? "Бот выключен"
    : bad ? "Связь с Telegram потеряна" : "Бот работает" + (state.newInquiryCount ? ' · <b>' + num(state.newInquiryCount) + "</b> новых" : "");
}

function go(view, tab) {
  var target = "#/" + view + (tab ? "/" + tab : "");
  if (location.hash === target) applyRoute();
  else location.hash = target;
}

function applyRoute() {
  var parts = (location.hash || "").replace(/^#\//, "").split("/");
  var view = VIEWS[parts[0]] ? parts[0] : "overview";
  currentView = view;
  currentTab = parts[1] || "";
  renderNav();
  renderView();
}

function renderView() {
  if (!state) return;
  var item = navItems().find(function (entry) { return entry.id === currentView; });
  var view = VIEWS[currentView];
  if (!view) return;
  if (item && item.tabs && !item.tabs.some(function (tab) { return tab[0] === currentTab; })) currentTab = item.tabs[0][0];
  clearDirty();
  el("pageTitle").textContent = item ? item.title : "";
  el("pageSubtitle").textContent = view.subtitle ? view.subtitle() : "";
  el("pageActions").innerHTML = "";
  var page = el("page");
  page.innerHTML = (item && item.tabs ? '<div class="toolbar"><div class="tabs">' + item.tabs.map(function (tab) {
    return '<button type="button" data-tab="' + tab[0] + '" class="' + (tab[0] === currentTab ? "active" : "") + '">' + esc(tab[1]) + "</button>";
  }).join("") + "</div></div>" : "") + '<div id="viewBody"></div>';
  page.querySelectorAll("[data-tab]").forEach(function (button) {
    button.onclick = function () { go(currentView, button.dataset.tab); };
  });
  view.render(el("viewBody"), currentTab);
  window.scrollTo({ top: 0 });
}

function pageAction(label, handler, kind) {
  var button = document.createElement("button");
  button.className = "btn " + (kind || "");
  button.type = "button";
  button.textContent = label;
  button.onclick = handler;
  el("pageActions").appendChild(button);
  return button;
}

// --- Вход --------------------------------------------------------------------
async function boot() {
  var status = await api("/api/status");
  if (!status.configured) {
    el("setupScreen").classList.remove("hidden");
    return;
  }
  try {
    await startApp();
  } catch (error) {
    el("loginScreen").classList.remove("hidden");
    el("loginPassword").focus();
  }
}

async function startApp() {
  await reload(false);
  el("loginScreen").classList.add("hidden");
  el("setupScreen").classList.add("hidden");
  el("app").classList.remove("hidden");
  applyRoute();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(function () {
    if (document.hidden || isDirty() || document.querySelector("dialog[open]")) return;
    reload().catch(function () {});
  }, 45000);
}

function bindShell() {
  window.addEventListener("hashchange", applyRoute);
  el("menuToggle").onclick = function () { el("side").classList.toggle("open"); };
  el("logoutBtn").onclick = async function () {
    await api("/api/logout", { method: "POST" }).catch(function () {});
    location.reload();
  };
  el("savebarSave").onclick = saveDirty;
  el("savebarReset").onclick = function () { clearDirty(); renderView(); };
  el("loginForm").onsubmit = async function (event) {
    event.preventDefault();
    var error = el("loginError");
    error.classList.add("hidden");
    try {
      var code = el("loginCode").value.trim();
      var result = code && loginChallenge
        ? await send("/api/login/verify", "POST", { code: code, challenge: loginChallenge })
        : await send("/api/login", "POST", { password: el("loginPassword").value });
      if (result.twoFactor) {
        loginChallenge = result.challenge;
        el("loginCodeField").classList.remove("hidden");
        el("loginSubtitle").textContent = "Мы отправили код в Telegram администратору.";
        el("loginCode").focus();
        return;
      }
      await startApp();
    } catch (requestError) {
      if (requestError.status === 401 && loginChallenge) {
        loginChallenge = "";
        el("loginCode").value = "";
      }
      error.textContent = requestError.message;
      error.classList.remove("hidden");
    }
  };
  el("setupForm").onsubmit = async function (event) {
    event.preventDefault();
    var error = el("setupError");
    error.classList.add("hidden");
    try {
      await send("/api/setup", "POST", { token: el("setupToken").value.trim(), password: el("setupPassword").value });
      await startApp();
    } catch (requestError) {
      error.textContent = requestError.message;
      error.classList.remove("hidden");
    }
  };
  window.addEventListener("beforeunload", function (event) {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
`;

export { PANEL_RUNTIME_JS, PANEL_SHELL };
