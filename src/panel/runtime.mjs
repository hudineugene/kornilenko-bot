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
  <header class="app-head" id="appHead">
    <button class="btn ghost icon menu-toggle" id="menuToggle" type="button" aria-label="Открыть меню" aria-expanded="false">☰</button>
    <div class="app-brand">
      <img src="/admin-assets/sidebar-logo.png" alt="">
      <b>Construcciones Kornilenko<span>панель бота</span></b>
    </div>
    <nav id="nav" class="head-nav" aria-label="Основная навигация"></nav>
    <div class="head-tools">
      <button class="notification-bell" id="notificationBell" type="button" aria-label="Открыть уведомления"><span aria-hidden="true">🔔</span><b class="hidden" id="notificationCount">0</b></button>
      <div class="state-line" id="botState"><span class="dot"></span><span id="botStateText">Загрузка…</span></div>
      <button class="btn ghost small" id="logoutBtn" type="button">Выйти</button>
    </div>
  </header>
  <div class="main">
    <div class="topbar">
      <div><h1 id="pageTitle">Обзор</h1><div class="sub" id="pageSubtitle"></div></div>
      <div class="grow"></div>
      <div id="pageActions" class="row"></div>
    </div>
    <div class="page" id="page"></div>
  </div>
</div>
<div id="toast" class="toast hidden"></div>
<div id="savebar" class="savebar hidden"><span class="grow" id="savebarText">Есть несохранённые изменения</span><button class="btn secondary" id="savebarReset" type="button">Отменить</button><button class="btn" id="savebarSave" type="button">Сохранить</button></div>
<div id="refreshHint" class="refresh-hint hidden"><span class="grow">Появились новые данные</span><button class="btn secondary" id="refreshHintApply" type="button">Обновить экран</button></div>
`;

const PANEL_RUNTIME_JS = String.raw`
var state = null, csrf = "", currentView = "overview", currentTab = "", dirtyForm = null, refreshTimer = 0, loginChallenge = "";
var currentRouteHash = "", allowNextRoute = false, routePromptOpen = false;
// stateVersion — отпечаток данных с сервера: если он не изменился, экран не
// перерисовываем. pageTouched — пользователь что-то ввёл на текущем экране,
// значит перерисовка стёрла бы его черновик. pendingRefresh — данные обновились,
// но экран оставлен как есть, и это видно по полоске.
var stateVersion = "", pageTouched = false, pendingRefresh = false;
var VIEWS = {};

function el(id) { return document.getElementById(id); }
function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function num(value) { return new Intl.NumberFormat("ru-RU").format(Number(value || 0)); }
function plural(value, one, few, many) { var n = Math.abs(Number(value || 0)) % 100, last = n % 10; return n > 10 && n < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many; }
function counted(value, one, few, many) { return num(value) + " " + plural(value, one, few, many); }
function money(value, currency) { return num(value) + " " + (currency === "USD" ? "$" : currency === "GBP" ? "£" : "€"); }
function panelTimeZone() { return state && state.config && state.config.timeZone || "Europe/Madrid"; }
function dateTime(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: panelTimeZone() }).format(new Date(value)); } catch (e) { return "—"; } }
function dateShort(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: panelTimeZone() }).format(new Date(value)); } catch (e) { return "—"; } }
function zonedParts(value) {
  var parts = new Intl.DateTimeFormat("en-CA", { timeZone: panelTimeZone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  var result = {};
  parts.forEach(function (part) { if (part.type !== "literal") result[part.type] = part.value; });
  return result;
}
function dateTimeLocalValue(value) {
  if (!value) return "";
  try { var parts = zonedParts(value); return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute; } catch (e) { return ""; }
}
function zonedDateTimeToIso(value) {
  var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  var target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  var guess = target;
  for (var index = 0; index < 3; index += 1) {
    var shown = zonedParts(guess);
    var shownUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute));
    guess += target - shownUtc;
  }
  return new Date(guess).toISOString();
}
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

// Считаем запросы, которые что-то меняют: пока такой запрос в пути, кнопка,
// которой его запустили, не нажимается — иначе второе нажатие отправило бы
// второе сообщение, создало второй объект или вторую публикацию.
var pendingChanges = 0;

// Сам вход и первичная настройка отвечают 401 на неверный пароль — это не
// истёкшая сессия.
function authRequest(url) {
  var path = String(url).split("?")[0];
  return path.indexOf("/api/login") === 0 || path.indexOf("/api/setup") === 0;
}

var appStarted = false, sessionEnded = false;

function sessionExpired() {
  if (sessionEnded || !appStarted) return;
  sessionEnded = true;
  clearInterval(refreshTimer);
  // Открытое окно — модальное, оно закрывает собой экран входа. Закрываем его
  // сами: иначе войти можно только закрыв окно вручную, а оно ещё и переспросит
  // про несохранённые изменения, которые сохранить всё равно уже некуда.
  var openWindows = Array.prototype.slice.call(document.querySelectorAll("dialog[open]"));
  openWindows.forEach(function (dialog) {
    if (dialog.closeClean) dialog.closeClean();
    else dialog.close();
  });
  var message = "Вход в панель перестал действовать. Введите пароль ещё раз.";
  if (isDirty() || openWindows.length) message += " Несохранённые изменения придётся внести заново.";
  clearDirty();
  hideRefreshHint();
  el("app").classList.add("hidden");
  el("loginScreen").classList.remove("hidden");
  el("loginCodeField").classList.add("hidden");
  el("loginPassword").value = "";
  var error = el("loginError");
  error.textContent = message;
  error.classList.remove("hidden");
  el("loginPassword").focus();
}

function api(url, options) {
  options = options || {};
  options.headers = Object.assign({ "content-type": "application/json" }, options.headers || {});
  var changing = Boolean(options.method) && options.method !== "GET";
  if (changing) options.headers["x-csrf-token"] = csrf;
  if (changing) pendingChanges += 1;
  return fetch(url, options).then(async function (response) {
    var body = {};
    try { body = await response.json(); } catch (e) {}
    if (!response.ok) {
      var error = new Error(body.error || "Ошибка запроса");
      error.status = response.status;
      // Вход перестал действовать: сессия истекла или бот перезапустили. Раньше
      // панель оставалась на экране со старыми данными и на каждое нажатие
      // показывала всплывающую ошибку — войти заново можно было только
      // перезагрузив страницу.
      if (response.status === 401 && !authRequest(url)) sessionExpired();
      throw error;
    }
    return body;
  }).finally(function () {
    if (changing) pendingChanges = Math.max(0, pendingChanges - 1);
  });
}

// Блокируем кнопку не в момент нажатия, а сразу после: иначе отправка формы
// (кнопка входа) не состоялась бы вовсе. Кнопка оживает, когда запросы,
// начатые этим нажатием, закончились.
function guardDoubleClicks() {
  document.addEventListener("click", function (event) {
    var node = event.target;
    var button = node && node.closest ? node.closest("button") : null;
    if (!button || button.disabled) return;
    setTimeout(function () {
      if (!pendingChanges || button.disabled) return;
      button.disabled = true;
      var timer = setInterval(function () {
        if (pendingChanges) return;
        clearInterval(timer);
        button.disabled = false;
      }, 60);
    }, 0);
  }, true);
}
function send(url, method, payload) { return api(url, { method: method, body: JSON.stringify(payload || {}) }); }

// Тексты интерфейса весят больше половины общего пакета, поэтому грузятся
// один раз и только там, где нужны: экран «Тексты бота» и предпросмотр карточки.
var interfaceTextCache = null;
var interfaceTextLoading = null;
function interfaceTexts() { return interfaceTextCache || {}; }
function loadInterfaceText(force) {
  if (interfaceTextCache && !force) return Promise.resolve(interfaceTextCache);
  // Два экрана могут попросить тексты одновременно — запрос всё равно один.
  if (interfaceTextLoading && !force) return interfaceTextLoading;
  interfaceTextLoading = api("/api/interface-text").then(function (body) {
    interfaceTextCache = body.interfaceText || {};
    interfaceTextLoading = null;
    return interfaceTextCache;
  }, function (error) {
    interfaceTextLoading = null;
    throw error;
  });
  return interfaceTextLoading;
}

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

// Опасные действия просят текущий пароль: одной открытой сессии недостаточно,
// чтобы скачать данные с токенами, заменить их или отдать заявки другому чату.
function askPassword(title, text) {
  return new Promise(function (resolve) {
    var dialog = openDialog({
      title: title,
      body: '<p class="muted small">' + esc(text) + '</p>' +
        '<div class="field"><label for="gatePassword">Текущий пароль панели</label>' +
        '<input id="gatePassword" type="password" autocomplete="current-password"></div>',
      footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="gateConfirm" type="button">Продолжить</button>',
      ready: function (node) {
        var input = node.querySelector("#gatePassword");
        var done = false;
        node.querySelector("#gateConfirm").onclick = function () {
          var value = input.value;
          if (!value) return toast("Введите текущий пароль панели", true);
          done = true;
          node.closeClean();
          resolve(value);
        };
        input.onkeydown = function (event) { if (event.key === "Enter") node.querySelector("#gateConfirm").click(); };
        node.addEventListener("close", function () { if (!done) resolve(""); });
        setTimeout(function () { input.focus(); }, 50);
      },
    });
    return dialog;
  });
}

function openDialog(options) {
  var dialog = document.createElement("dialog");
  var dialogDirty = false, closingDialog = false;
  if (options.drawer) dialog.className = "drawer";
  if (options.wide) dialog.classList.add("wide");
  dialog.innerHTML = '<div class="dialog-head"><h2>' + esc(options.title) + '</h2><div class="grow"></div><button class="btn ghost icon" data-close="1" type="button">✕</button></div>' +
    '<div class="dialog-body">' + options.body + '</div>' +
    (options.footer === null ? "" : '<div class="dialog-foot">' + (options.footer || '<button class="btn secondary" data-close="1" type="button">Закрыть</button>') + '</div>');
  document.body.appendChild(dialog);
  async function requestClose() {
    if (closingDialog) return;
    if (options.protectChanges && dialogDirty) {
      closingDialog = true;
      var discard = await confirmDialog("Закрыть без сохранения?", "Внесённые изменения будут потеряны.", "Закрыть", true);
      closingDialog = false;
      if (!discard) return;
    }
    dialog.close();
  }
  dialog.closeClean = function () { dialogDirty = false; dialog.close(); };
  dialog.querySelectorAll("[data-close]").forEach(function (button) { button.onclick = requestClose; });
  if (options.protectChanges) {
    dialog.addEventListener("input", function () { dialogDirty = true; });
    dialog.addEventListener("change", function () { dialogDirty = true; });
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); requestClose(); });
  }
  dialog.addEventListener("close", function () { dialog.remove(); });
  dialog.showModal();
  if (options.ready) options.ready(dialog);
  return dialog;
}

// Кнопки разметки над полем. Работают там, где бот понимает разметку:
// подпись и текст поста в группу или канал.
var MARKUP_EMOJI = ["🇪🇸", "🏗", "📍", "📞", "🌐", "🎵", "💬", "✅", "🔥", "❤️", "👉", "·"];

function markupToolbar(target) {
  return '<div class="row wrap markup-bar" data-markup="' + target + '">' +
    '<button class="btn ghost small" type="button" data-mark="bold" title="Жирный"><b>Ж</b></button>' +
    '<button class="btn ghost small" type="button" data-mark="italic" title="Курсив"><i>К</i></button>' +
    '<button class="btn ghost small" type="button" data-mark="link" title="Ссылка надписью">🔗 Ссылка</button>' +
    '<button class="btn ghost small" type="button" data-mark="mail" title="Ссылка на почту">✉️ Почта</button>' +
    '<button class="btn ghost small" type="button" data-mark="line" title="Линия-разделитель">━━</button>' +
    '<span class="grow"></span>' +
    MARKUP_EMOJI.map(function (sign) {
      return '<button class="btn ghost small" type="button" data-sign="' + esc(sign) + '">' + esc(sign) + "</button>";
    }).join("") + "</div>";
}

function insertAround(area, before, after, placeholder) {
  var start = area.selectionStart == null ? area.value.length : area.selectionStart;
  var end = area.selectionEnd == null ? start : area.selectionEnd;
  var selected = area.value.slice(start, end) || placeholder || "";
  area.value = area.value.slice(0, start) + before + selected + after + area.value.slice(end);
  area.focus();
  area.setSelectionRange(start + before.length, start + before.length + selected.length);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

function bindMarkupToolbar(root) {
  root.querySelectorAll("[data-markup]").forEach(function (bar) {
    var area = root.querySelector("#" + bar.dataset.markup);
    if (!area) return;
    bar.querySelectorAll("[data-mark]").forEach(function (button) {
      button.onclick = function () {
        if (button.dataset.mark === "bold") insertAround(area, "**", "**", "текст");
        else if (button.dataset.mark === "italic") insertAround(area, "__", "__", "текст");
        else if (button.dataset.mark === "line") insertAround(area, "\n━━━━━━━━━━━━━━━━━━\n", "", "");
        else if (button.dataset.mark === "mail") {
          var address = prompt("Адрес электронной почты", "");
          if (!address) return;
          insertAround(area, "[", "](mailto:" + address.trim() + ")", "Mail");
        }
        else {
          var url = prompt("Адрес ссылки", "https://");
          if (!url) return;
          insertAround(area, "[", "](" + url + ")", "название");
        }
      };
    });
    bar.querySelectorAll("[data-sign]").forEach(function (button) {
      button.onclick = function () { insertAround(area, button.dataset.sign, "", ""); };
    });
  });
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

// Экран перерисовал себя сам (сменили фильтр, набрали в поиске, пролистали
// список): отметка «человек что-то вводил» относилась к прежнему содержимому и
// снимается — иначе она остаётся до конца сеанса и автообновление больше ничего
// не показывает. Пока курсор стоит в поле, экран всё равно считается занятым:
// это проверяет pageBusy по фокусу.
function screenSettled() { pageTouched = false; }

async function confirmPageLeave() {
  if (!isDirty()) return true;
  return confirmDialog("Перейти без сохранения?", "На этой странице есть несохранённые изменения.", "Перейти", true);
}

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
// options пробрасываются в renderView: после действия внутри беседы (ответ,
// смена статуса) страница не должна прыгать наверх.
async function reload(render, options) {
  state = await api("/api/state");
  csrf = state.csrf;
  stateVersion = state.stateVersion || "";
  hideRefreshHint();
  renderNav();
  renderBotState();
  renderNotificationBell();
  if (render !== false) {
    // Данные перечитаны по действию человека, экран собирается заново — прежняя
    // форма исчезла вместе с ним, и отметка «есть несохранённые изменения»
    // относилась бы к форме, которой больше нет. Так было после смены токена:
    // полоса сохранения висела, уход со страницы спрашивал подтверждение, а
    // автообновление считало экран занятым. Обновление по таймеру идёт другим
    // путём (refresh) и черновик не трогает.
    clearDirty();
    renderView(options);
  }
}

// Пользователь печатает, уже что-то ввёл на этом экране или открыл окно:
// перерисовка стёрла бы черновик ответа, пост в канал или заметку по обращению.
// «Занят» — только про сам экран: счётчики и колокольчик обновляются всегда.
function pageBusy() {
  if (pageTouched || isDirty()) return true;
  // Поверх экрана открыто окно: его содержимое человек как раз и заполняет.
  if (document.querySelector("dialog[open]")) return true;
  var focused = document.activeElement;
  if (!focused || !el("page").contains(focused)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].indexOf(focused.tagName) >= 0 || focused.isContentEditable;
}

function showRefreshHint() {
  pendingRefresh = true;
  el("refreshHint").classList.remove("hidden");
}

function hideRefreshHint() {
  pendingRefresh = false;
  el("refreshHint").classList.add("hidden");
}

// Обновление по таймеру: сначала спрашиваем сервер, изменилось ли хоть что-то.
async function refresh() {
  var body = await api("/api/state?since=" + encodeURIComponent(stateVersion));
  if (body && body.unchanged) return;
  // Данные изменились — переписка открытой беседы могла пополниться.
  if (typeof conversationCache === "object") conversationCache = {};
  state = body;
  csrf = state.csrf;
  stateVersion = state.stateVersion || "";
  renderNav();
  renderBotState();
  renderNotificationBell();
  if (pageBusy()) return showRefreshHint();
  hideRefreshHint();
  renderView({ keepScroll: true });
}

function navItems() {
  var waiting = Number(state && state.unreadConversationCount) || (state && state.inquiries || []).filter(awaitsReply).length;
  return [
    { id: "overview", icon: "◉", title: "Обзор" },
    { id: "notifications", icon: "🔔", title: "Центр уведомлений", hidden: true },
    { id: "inquiries", icon: "✉", title: "Переписка", count: waiting, tabs: [["inbox", "Центр сообщений"], ["tasks", "Задачи"], ["pipeline", "Воронка"], ["viewings", "Просмотры"], ["clients", "База клиентов"]] },
    { id: "catalog", icon: "⌂", title: "Каталог", tabs: [["objects", "Объекты"], ["offers", "Акции"], ["feed", "Загрузка с сайта"]] },
    { id: "texts", icon: "✎", title: "Тексты бота", tabs: [["welcome", "Приветствие"], ["sections", "Разделы"], ["contacts", "Контакты"], ["rules", "Автоответы"], ["interface", "Интерфейс"]] },
    { id: "reach", icon: "➤", title: "Рассылки и каналы", tabs: [["campaigns", "Рассылки"], ["group", "Группы и каналы"], ["style", "Оформление постов"]] },
    { id: "stats", icon: "▦", title: "Статистика" },
    { id: "settings", icon: "⚙", title: "Настройки", tabs: [["connection", "Подключение"], ["work", "Работа с клиентами"], ["data", "Данные"], ["access", "Доступ"]] },
  ];
}

function awaitsReply(inquiry) {
  if (!inquiry || inquiry.status === "closed") return false;
  // Клиент искал сам и получил каталог — ответа никто не ждёт.
  if (inquiry.searchLead) return false;
  var replies = inquiry.replies || [];
  if (!replies.length) return inquiry.status === "new";
  var lastReply = Math.max.apply(null, replies.map(function (reply) { return Date.parse(reply.createdAt) || 0; }));
  return (Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0) > lastReply;
}

function renderNav() {
  el("nav").innerHTML = navItems().filter(function (item) { return !item.hidden; }).map(function (item) {
    var active = item.id === currentView;
    if (!item.tabs) {
      return '<button class="nav-item' + (active ? " active" : "") + '" data-view="' + item.id + '" type="button">' +
        '<span class="ico">' + item.icon + '</span><span>' + esc(item.title) + '</span>' +
        (item.count ? '<span class="count">' + num(item.count) + '</span>' : '') + '</button>';
    }
    return '<details class="nav-menu' + (active ? " active" : "") + '"><summary class="nav-item">' +
      '<span class="ico">' + item.icon + '</span><span>' + esc(item.title) + '</span>' +
      (item.count ? '<span class="count">' + num(item.count) + '</span>' : '') + '<span class="chevron">⌄</span></summary>' +
      '<div class="nav-dropdown"><div class="nav-caption">' + esc(item.title) + '</div>' + item.tabs.map(function (tab) {
        return '<button class="nav-subitem' + (active && currentTab === tab[0] ? " active" : "") + '" data-view="' + item.id + '" data-tab="' + tab[0] + '" type="button">' + esc(tab[1]) + '</button>';
      }).join("") + '</div></details>';
  }).join("");
  el("nav").querySelectorAll("[data-view]").forEach(function (button) {
    button.onclick = function () {
      go(button.dataset.view, button.dataset.tab || "");
      var menu = button.closest("details");
      if (menu) menu.open = false;
      el("nav").classList.remove("open");
      el("menuToggle").setAttribute("aria-expanded", "false");
    };
  });
}

function renderNotificationBell() {
  var button = el("notificationBell"), badge = el("notificationCount");
  var count = Number(state && state.notificationUnreadCount || 0);
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
  button.classList.toggle("active", currentView === "notifications");
  button.setAttribute("aria-label", count ? "Открыть уведомления: непрочитанных " + count : "Открыть уведомления");
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

async function go(view, tab) {
  var target = "#/" + view + (tab ? "/" + tab : "");
  if (location.hash === target) return true;
  if (!(await confirmPageLeave())) return false;
  clearDirty();
  allowNextRoute = true;
  location.hash = target;
  return true;
}

function applyRoute() {
  var parts = (location.hash || "").replace(/^#\//, "").split("/");
  var view = VIEWS[parts[0]] ? parts[0] : "overview";
  currentView = view;
  currentTab = parts[1] || "";
  currentRouteHash = location.hash || "#/overview";
  renderNav();
  renderNotificationBell();
  renderView();
}

async function handleHashChange() {
  if (allowNextRoute) {
    allowNextRoute = false;
    applyRoute();
    return;
  }
  if (!isDirty()) {
    applyRoute();
    return;
  }
  if (routePromptOpen) return;
  routePromptOpen = true;
  var requestedHash = location.hash;
  history.replaceState(null, "", currentRouteHash || "#/overview");
  var discard = await confirmPageLeave();
  routePromptOpen = false;
  if (!discard) return;
  clearDirty();
  allowNextRoute = true;
  location.hash = requestedHash;
}

function renderView(options) {
  if (!state) return;
  pageTouched = false;
  var item = navItems().find(function (entry) { return entry.id === currentView; });
  var view = VIEWS[currentView];
  if (!view) return;
  if (item && item.tabs && !item.tabs.some(function (tab) { return tab[0] === currentTab; })) currentTab = item.tabs[0][0];
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
  // Наверх прокручиваем только при переходе: обновление по таймеру не должно
  // выдёргивать страницу из-под рук.
  if (!(options && options.keepScroll)) window.scrollTo({ top: 0 });
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
  appStarted = true;
  sessionEnded = false;
  el("loginError").classList.add("hidden");
  el("loginScreen").classList.add("hidden");
  el("setupScreen").classList.add("hidden");
  el("app").classList.remove("hidden");
  applyRoute();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(function () {
    // Вкладку не смотрят — обновлять нечего. А несохранённая форма и открытое
    // окно больше не отменяют обновление целиком: счётчик «Переписки» и
    // колокольчик обновляются всегда, а экран под руками не трогаем — про новые
    // данные скажет полоска сверху.
    if (document.hidden) return;
    refresh().catch(function () {});
  }, 45000);
}

function bindShell() {
  window.addEventListener("hashchange", handleHashChange);
  el("menuToggle").onclick = function () {
    var open = !el("nav").classList.contains("open");
    el("nav").classList.toggle("open", open);
    el("menuToggle").setAttribute("aria-expanded", String(open));
  };
  el("notificationBell").onclick = function () { go("notifications"); };
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".nav-menu")) el("nav").querySelectorAll("details[open]").forEach(function (menu) { menu.open = false; });
    if (window.innerWidth <= 860 && !event.target.closest("#nav") && !event.target.closest("#menuToggle")) {
      el("nav").classList.remove("open");
      el("menuToggle").setAttribute("aria-expanded", "false");
    }
  });
  el("logoutBtn").onclick = async function () {
    await api("/api/logout", { method: "POST" }).catch(function () {});
    location.reload();
  };
  // Ввод на экране запоминается: пока он есть, автообновление экран не трогает.
  el("page").addEventListener("input", function () { pageTouched = true; });
  el("refreshHintApply").onclick = function () {
    hideRefreshHint();
    renderView({ keepScroll: true });
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
  guardDoubleClicks();
  window.addEventListener("beforeunload", function (event) {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
`;

export { PANEL_RUNTIME_JS, PANEL_SHELL };
