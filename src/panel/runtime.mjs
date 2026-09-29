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
  <div id="linkAlert" class="link-alert hidden" role="alert"><div class="grow"><b>Нет связи с ботом</b><span id="linkAlertText"></span></div><button class="btn secondary small" id="linkAlertRetry" type="button">Проверить сейчас</button></div>
  <header class="app-head" id="appHead">
    <button class="btn ghost icon menu-toggle" id="menuToggle" type="button" aria-label="Открыть меню" aria-expanded="false">☰</button>
    <div class="app-brand">
      <img src="/admin-assets/sidebar-logo.png" alt="">
      <b>Construcciones Kornilenko<span>панель бота</span></b>
    </div>
    <nav id="nav" class="head-nav" aria-label="Основная навигация"></nav>
    <div class="global-search" id="globalSearchBox" role="search">
      <input id="globalSearch" type="search" placeholder="Поиск: клиент, объект, сообщение" title="Поиск и действия (Ctrl+K)" autocomplete="off" aria-label="Поиск по клиентам, объектам и сообщениям">
      <div class="global-results hidden" id="globalResults"></div>
    </div>
    <div class="head-tools">
      <button class="btn ghost icon search-toggle" id="searchToggle" type="button" aria-label="Поиск">🔍</button>
      <button class="btn ghost icon" id="soundToggle" type="button" aria-pressed="false" title="Звук о новом сообщении: выключен">🔇</button>
      <button class="notification-bell" id="notificationBell" type="button" aria-label="Открыть уведомления"><span aria-hidden="true">🔔</span><b class="hidden" id="notificationCount">0</b></button>
      <div class="state-line" id="botState"><span class="dot"></span><span id="botStateText">Загрузка…</span></div>
      <button class="btn ghost small" id="logoutBtn" type="button">Выйти</button>
    </div>
  </header>
  <nav id="tabbar" class="tabbar" aria-label="Разделы"></nav>
  <div id="moreSheet" class="more-sheet hidden" role="menu" aria-label="Остальные разделы"></div>
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
<div id="saveAlert" class="save-alert hidden" role="alert"><b>⚠️ Бот не может сохранить данные на диск</b><span id="saveAlertText"></span></div>
`;

const PANEL_RUNTIME_JS = String.raw`
var state = null, csrf = "", currentView = "today", currentTab = "", currentSub = "", dirtyForm = null, refreshTimer = 0, loginChallenge = "";
var currentRouteHash = "", allowNextRoute = false, routePromptOpen = false;
// stateVersion — отпечаток данных с сервера: если он не изменился, экран не
// перерисовываем. pageTouched — пользователь что-то ввёл на текущем экране,
// значит перерисовка стёрла бы его черновик. pendingRefresh — данные обновились,
// но экран оставлен как есть, и это видно по полоске.
var stateVersion = "", pageTouched = false, pendingRefresh = false;
// Какой экран открыт в «Обслуживании» (данные, доступ, выгрузка, подписи).
var serviceScreen = "data";
// Экран рисуется сам (обновление по таймеру) или по действию человека. Разделам
// это важно: при входе в «Переписку» открытую беседу человек видит и читает, а
// при обновлении по таймеру экран мог быть и не на виду.
var renderingAuto = false;
var VIEWS = {};

function el(id) { return document.getElementById(id); }
function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function num(value) { return new Intl.NumberFormat("ru-RU").format(Number(value || 0)); }
function plural(value, one, few, many) { var n = Math.abs(Number(value || 0)) % 100, last = n % 10; return n > 10 && n < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many; }
function counted(value, one, few, many) { return num(value) + " " + plural(value, one, few, many); }
function money(value, currency) { return num(value) + " " + (currency === "USD" ? "$" : currency === "GBP" ? "£" : "€"); }
function panelTimeZone() { return state && state.config && state.config.timeZone || "Europe/Madrid"; }
// Часовой пояс человеческими словами: «Испания — материк», а не Europe/Madrid.
var TIME_ZONE_NAMES = { "Europe/Madrid": "Испания — материк", "Atlantic/Canary": "Канарские острова", "Europe/Moscow": "Москва", "Europe/Kyiv": "Киев", "Europe/Lisbon": "Португалия", "Europe/London": "Лондон", "UTC": "UTC" };
function timeZoneName() { var zone = panelTimeZone(); return TIME_ZONE_NAMES[zone] || zone; }
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

// Связь панели с ботом (не с Telegram: та видна в состоянии бота). Одна осечка — не
// беда (перезапуск, сеть моргнула); вторая подряд — красная полоса на всех экранах.
// Раньше обновление по таймеру молча проглатывало обрыв, точка оставалась «Бот
// работает», а данные на экране тихо старели.
var linkState = { failures: 0, lastOkAt: Date.now(), retryTimer: 0 };

function noteLinkOk() {
  var wasDown = linkState.failures >= 2;
  linkState.failures = 0;
  linkState.lastOkAt = Date.now();
  if (linkState.retryTimer) { clearTimeout(linkState.retryTimer); linkState.retryTimer = 0; }
  el("linkAlert").classList.add("hidden");
  if (wasDown && state) renderBotState();
}

function noteLinkFailure(error) {
  // Ответил сам бот (например, «вход не действует») — связь есть.
  if (error && error.status && (error.status < 502 || error.status > 504)) return;
  linkState.failures += 1;
  if (linkState.failures >= 2) showLinkAlert();
  // Пока связи нет, спрашиваем чаще, чем раз в 45 секунд: как только бот вернётся, полоса уйдёт.
  if (!linkState.retryTimer) {
    linkState.retryTimer = setTimeout(function () {
      linkState.retryTimer = 0;
      if (typeof refresh === "function" && appStarted && !sessionEnded) refresh().catch(function () {});
    }, linkState.failures >= 2 ? 10000 : 6000);
  }
}

function showLinkAlert() {
  el("linkAlertText").textContent = "Панель не достаёт до бота: возможно, он остановлен или перезапускается. Данные на экране могут быть устаревшими (последнее обновление — " + ago(new Date(linkState.lastOkAt).toISOString()) + "). Запустите бота (start-bot.ps1) — панель подключится сама.";
  el("linkAlert").classList.remove("hidden");
  // Точка в шапке не может говорить «Бот работает», когда до него не достучаться.
  var box = el("botState");
  box.querySelector(".dot").className = "dot off";
  el("botStateText").textContent = "Нет связи с ботом";
  box.dataset.state = "off";
  box.dataset.short = "Нет связи";
  box.title = "Нет связи с ботом";
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
      // Бот ответил (пусть и отказом): связь есть. 502–504 — не он, а то, что перед ним.
      if (response.status < 502 || response.status > 504) noteLinkOk();
      else noteLinkFailure(error);
      // Вход перестал действовать: сессия истекла или бот перезапустили. Раньше
      // панель оставалась на экране со старыми данными и на каждое нажатие
      // показывала всплывающую ошибку — войти заново можно было только
      // перезагрузив страницу.
      if (response.status === 401 && !authRequest(url)) sessionExpired();
      throw error;
    }
    noteLinkOk();
    return body;
  }, function (failure) {
    // До бота не достучались (остановлен, перезапускается, сеть). Браузер называет
    // это «Failed to fetch» — по-русски и с подсказкой, что делать.
    noteLinkFailure(failure);
    var friendly = new Error("Нет связи с ботом. Проверьте, что он запущен (start-bot.ps1); панель повторит попытку сама.");
    friendly.network = true;
    throw friendly;
  }).finally(function () {
    if (changing) pendingChanges = Math.max(0, pendingChanges - 1);
  });
}

// Блокируем кнопку не в момент нажатия, а сразу после: иначе отправка формы
// (кнопка входа) не состоялась бы вовсе. Кнопка оживает, когда запросы,
// начатые этим нажатием, закончились.
//
// Отдельно — действия с подтверждением: запрос уходит не сразу, сначала
// открывается окно «Удалить?». Пока оно открыто, запросов нет, и прежняя защита
// кнопку не держала: второе нажатие открывало второе окно, а значит и второе
// удаление. Поэтому открытое окно тоже держит кнопку.
function waitingForAnswer() {
  return Boolean(document.querySelector("dialog[open]"));
}

function guardDoubleClicks() {
  document.addEventListener("click", function (event) {
    var node = event.target;
    var button = node && node.closest ? node.closest("button") : null;
    if (!button || button.disabled) return;
    setTimeout(function () {
      if ((!pendingChanges && !waitingForAnswer()) || button.disabled) return;
      button.disabled = true;
      var timer = setInterval(function () {
        if (pendingChanges || waitingForAnswer()) return;
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

// action — необязательная кнопка в самом уведомлении: {label, run}. Так после
// «Скрыть» остаётся возможность вернуть дело, пока уведомление на экране.
function toast(text, bad, action) {
  var box = el("toast");
  box.textContent = text;
  box.classList.toggle("bad", Boolean(bad));
  box.classList.remove("hidden");
  if (action && action.label) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.onclick = function () {
      box.classList.add("hidden");
      if (action.run) action.run();
    };
    box.appendChild(document.createTextNode(" "));
    box.appendChild(button);
  }
  clearTimeout(box._timer);
  box._timer = setTimeout(function () { box.classList.add("hidden"); }, action ? 8000 : 3600);
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
function askPassword(title, text, label) {
  return new Promise(function (resolve) {
    var dialog = openDialog({
      title: title,
      body: '<p class="muted small">' + esc(text) + '</p>' +
        '<div class="field"><label for="gatePassword">' + esc(label || "Текущий пароль панели") + '</label>' +
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
// «Изменилась» — значит значения полей отличаются от тех, что были при показе
// экрана: если значение вернули как было, полоса пропадает. Раньше она оставалась
// до сохранения или отмены, и плашка «Настройки компании изменены» висела над
// экраном, где ничего не менялось. Правки не из полей (выбранный файл, фото)
// код объявляет сам через mark(): их сравнить с полями нельзя, и такая отметка
// от возврата текста к прежнему не снимается.
function formSignature(root) {
  var parts = [];
  Array.prototype.forEach.call(root.querySelectorAll("input, select, textarea"), function (field, index) {
    if (field.type === "file") return;
    parts.push((field.id || field.name || index) + "=" + (field.type === "checkbox" || field.type === "radio" ? (field.checked ? "1" : "0") : String(field.value)));
  });
  return parts.join("\u0001");
}

function watchForm(root, save, label) {
  var initial = null;
  var forced = false;
  function show() {
    dirtyForm = { save: save, root: root };
    el("savebarText").textContent = label || "Есть несохранённые изменения";
    el("savebar").classList.remove("hidden");
  }
  function hide() {
    if (dirtyForm && dirtyForm.root === root) clearDirty();
  }
  // Первый снимок — после того, как экран дорисуется до конца: поля заполняют
  // сразу за вызовом watchForm.
  setTimeout(function () { if (initial === null) initial = formSignature(root); }, 0);
  function check() {
    if (initial === null) initial = formSignature(root);
    if (forced || formSignature(root) !== initial) show();
    else hide();
  }
  function mark() {
    forced = true;
    show();
  }
  root.addEventListener("input", check);
  root.addEventListener("change", check);
  return { mark: mark, check: check };
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
  checkNewClientMessage();
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
// перерисовка стёрла бы черновик ответа, пост в канал или заметку по заявке.
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
  checkNewClientMessage();
  // Вкладку не смотрят: экран перерисуем, когда в неё вернутся.
  if (document.hidden) { staleWhileHidden = true; return; }
  if (pageBusy()) return showRefreshHint();
  hideRefreshHint();
  renderView({ keepScroll: true, auto: true });
}

// Сколько клиентов ждут ответа. Число приходит от бота и одинаково на всех
// экранах: на значке в меню, в карточке «Ждут ответа» на Обзоре и во вкладке
// «Ждут ответа» в «Переписке». Раньше каждый экран считал по-своему — по
// заявкам, по диалогам или по непрочитанным — и три числа не сходились.
function waitingClients() {
  var count = Number(state && state.waitingConversationCount);
  if (Number.isFinite(count)) return count;
  var clients = {};
  (state && state.inquiries || []).forEach(function (item) {
    if (awaitsReply(item)) clients[String(item.userId)] = true;
  });
  return Object.keys(clients).length;
}

// Значки разделов — один набор линейных SVG (толщина, скругления и размер общие;
// цвет берут от текста). Раньше были глифы ◉ ✉ ⌂ ➤ ✎ ⚙ вперемешку с цветным
// эмодзи 📅: разного размера, веса и цвета, и на разных системах разные.
function navIcon(id) {
  var bodies = {
    today: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/>',
    notifications: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    clients: '<path d="M4 5.5h16v11H9.5L5 20.5v-4H4z"/>',
    viewings: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    objects: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-6h4v6"/>',
    posts: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    texts: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    reports: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (bodies[id] || "") + "</svg>";
}

function navItems() {
  return [
    { id: "today", icon: navIcon("today"), title: "Сегодня", count: waitingClients(), late: overdueClients() },
    { id: "clients", icon: navIcon("clients"), title: "Клиенты", tabs: [["inbox", "Диалоги"], ["tasks", "Следующие шаги"], ["pipeline", "Воронка"], ["base", "База клиентов"]] },
    { id: "viewings", icon: navIcon("viewings"), title: "Просмотры" },
    { id: "objects", icon: navIcon("objects"), title: "Объекты", tabs: [["list", "Объекты"], ["offers", "Акции"]] },
    { id: "posts", icon: navIcon("posts"), title: "Публикации", tabs: [["broadcast", "Очередь и история"], ["channel", "Пост в канал"]] },
    { id: "reports", icon: navIcon("reports"), title: "Отчёт" },
    { id: "texts", icon: navIcon("texts"), title: "Тексты бота", tabs: [["welcome", "Приветствие и меню"], ["contacts", "Контакты и о компании"], ["trust", "Почему мы"], ["plan", "План покупки"], ["sections", "Если раздел пуст"], ["rules", "Автоответы и шаблоны"]] },
    { id: "settings", icon: navIcon("settings"), title: "Настройки", tabs: [["company", "Компания"], ["team", "Команда"], ["service", "Обслуживание"]] },
  ];
}

// Старые адреса панели и ссылки из уведомлений ведут на прежние разделы.
// Переводим их в новые, чтобы ни одна закладка и ни одна кнопка не сломались.
var LEGACY_ROUTES = {
  "overview": ["today", ""],
  // Отдельной страницы уведомлений нет: лента одна — «Список дел» на «Сегодня».
  "notifications": ["today", ""],
  "stats": ["reports", ""],
  "inquiries": { "": ["clients", "inbox"], "inbox": ["clients", "inbox"], "tasks": ["clients", "tasks"], "pipeline": ["clients", "pipeline"], "viewings": ["viewings", ""], "clients": ["clients", "base"] },
  "catalog": { "": ["objects", "list"], "objects": ["objects", "list"], "offers": ["objects", "offers"], "feed": ["settings", "service"] },
  "reach": { "": ["posts", "broadcast"], "campaigns": ["posts", "broadcast"], "group": ["posts", "channel"], "style": ["posts", "style"] },
  "settings": { "reports": ["reports", ""], "connection": ["settings", "service"], "telegram": ["settings", "service"], "work": ["settings", "company"], "data": ["settings", "service"], "access": ["settings", "service"] },
  "texts": { "interface": ["settings", "service"] },
};

// Какой экран «Обслуживания» открыть, если пришли по старому адресу.
var LEGACY_SERVICE = { "settings/connection": "telegram", "settings/telegram": "telegram", "catalog/feed": "feed", "settings/data": "data", "settings/access": "access", "texts/interface": "interface" };

function normalizeRoute(view, tab) {
  var key = String(view || "") + "/" + String(tab || "");
  if (LEGACY_SERVICE[key]) serviceScreen = LEGACY_SERVICE[key];
  var rule = LEGACY_ROUTES[view];
  if (!rule) return [view, tab || ""];
  if (Array.isArray(rule)) return rule.slice();
  var moved = rule[String(tab || "")];
  return moved ? moved.slice() : [view, tab || ""];
}

// Одно состояние заявки на всю панель: ждёт ответа, отвечено или закрыта.
// Первые два бот считает сам по переписке, закрывает заявку только человек.
function inquiryState(inquiry) {
  if (!inquiry) return { key: "answered", text: "Отвечено", chip: "ok" };
  if (inquiry.status === "closed") return { key: "closed", text: "Закрыт", chip: "" };
  // Клиент искал сам и получил каталог — ответа никто не ждёт.
  if (inquiry.searchLead) return { key: "answered", text: "Ответ не нужен", chip: "" };
  if (awaitsReply(inquiry)) {
    var level = waitLevel(inquiry);
    return { key: "waiting", level: level, text: "Ждёт ответа · " + waitDuration(waitAge(inquiry)), chip: WAIT_CHIP[level] || "bad" };
  }
  return { key: "answered", text: "Отвечено", chip: "ok" };
}

// Возраст ожидания: «Ждёт ответа» через минуту и через двое суток — не одно и то же.
// Три уровня: в норме (ещё в пределах срока напоминания из настроек), дольше срока,
// дольше суток. Срок «не напоминать» (0) не отключает подсветку: берём два часа.
// Один источник для списка диалогов, воронки, карточки, «Сегодня» и меню.
var WAIT_CHIP = { fresh: "warn", late: "bad", overdue: "bad overdue" };
var WAIT_RANK = { "": 0, fresh: 1, late: 2, overdue: 3 };
var WAIT_DAY_MS = 24 * 3600000;

function waitThresholdMs() {
  var hours = Number(state && state.config && state.config.reminderHours);
  return (hours > 0 ? hours : 2) * 3600000;
}
// Сколько клиент ждёт, считая от его последнего сообщения.
function waitAge(inquiry, now) {
  var since = Date.parse(inquiry && (inquiry.clientMessageAt || inquiry.createdAt) || "") || 0;
  return since ? Math.max(0, (now || Date.now()) - since) : 0;
}
function waitLevel(inquiry, now) {
  if (!awaitsReply(inquiry)) return "";
  var age = waitAge(inquiry, now);
  if (age >= WAIT_DAY_MS) return "overdue";
  return age >= waitThresholdMs() ? "late" : "fresh";
}
function waitDuration(ms) {
  var minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "меньше минуты";
  if (minutes < 60) return minutes + " мин";
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " ч";
  return Math.floor(hours / 24) + " дн";
}
// Сколько клиентов ждут дольше срока (одного клиента с несколькими заявками — один раз).
function overdueClients() {
  var clients = {};
  (state && state.inquiries || []).forEach(function (item) {
    if (WAIT_RANK[waitLevel(item)] >= WAIT_RANK.late) clients[String(item.userId)] = true;
  });
  return Object.keys(clients).length;
}

function awaitsReply(inquiry) {
  if (!inquiry || inquiry.status === "closed") return false;
  // Клиент искал сам и получил каталог — ответа никто не ждёт.
  if (inquiry.searchLead) return false;
  var replies = inquiry.replies || [];
  if (!replies.length) {
    if (inquiry.status === "new") return true;
    // «В работу» — это «взял», а не «ответил»; так же считает и бот.
    var confirmedViewing = Boolean(inquiry.viewing && inquiry.viewing.confirmedAt);
    var clientWrote = (inquiry.messages || []).some(function (message) { return message.direction === "in"; });
    return inquiry.status === "in_progress" && clientWrote && !confirmedViewing;
  }
  var lastReply = Math.max.apply(null, replies.map(function (reply) { return Date.parse(reply.createdAt) || 0; }));
  return (Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0) > lastReply;
}

function renderNav() {
  // Нажатие на раздел открывает раздел. Подвкладки живут полосой на самой
  // странице: раньше они были выведены дважды — и в меню, и на странице, — а
  // нажатие на раздел только раскрывало список.
  el("nav").innerHTML = navItems().filter(function (item) { return !item.hidden; }).map(function (item) {
    var active = item.id === currentView;
    return '<button class="nav-item' + (active ? " active" : "") + '" data-view="' + item.id + '" type="button">' +
      '<span class="ico">' + item.icon + '</span><span>' + esc(item.title) + '</span>' +
      (item.count ? '<span class="count' + (item.late ? " late" : "") + '"' + (item.late ? ' title="Из них ' + num(item.late) + ' ждут дольше срока"' : "") + '>' + num(item.count) + '</span>' : '') + '</button>';
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
  renderTabBar();
}

// На телефоне разделы — внизу, под большим пальцем: четыре главных и «Ещё».
// Раньше был гамбургер: любая смена раздела требовала двух нажатий, а список
// закрывал половину экрана. Остальные разделы и «Выйти» — в листе «Ещё».
var staleWhileHidden = false;
var TAB_BAR_VIEWS = ["today", "clients", "viewings", "objects"];
function renderTabBar() {
  var items = navItems().filter(function (item) { return !item.hidden; });
  var main = TAB_BAR_VIEWS.map(function (id) { return items.find(function (item) { return item.id === id; }); }).filter(Boolean);
  var rest = navItems().filter(function (item) { return TAB_BAR_VIEWS.indexOf(item.id) < 0; });
  var moreActive = TAB_BAR_VIEWS.indexOf(currentView) < 0;
  el("tabbar").innerHTML = main.map(function (item) {
    return '<button class="tab' + (item.id === currentView ? " active" : "") + '" data-tab-view="' + item.id + '" type="button"' + (item.id === currentView ? ' aria-current="page"' : "") + '>' +
      '<span class="tab-ico">' + item.icon + '</span><span class="tab-title">' + esc(item.title) + '</span>' +
      (item.count ? '<b class="tab-count">' + num(item.count) + '</b>' : "") + '</button>';
  }).join("") + '<button class="tab' + (moreActive ? " active" : "") + '" id="tabMore" type="button" aria-haspopup="true" aria-expanded="false"><span class="tab-ico">⋯</span><span class="tab-title">Ещё</span></button>';
  el("moreSheet").innerHTML = rest.map(function (item) {
    return '<button class="more-item' + (item.id === currentView ? " active" : "") + '" data-tab-view="' + item.id + '" type="button"><span class="ico">' + item.icon + '</span><span>' + esc(item.title) + '</span></button>';
  }).join("") + '<button class="more-item" id="moreLogout" type="button"><span class="ico">⏻</span><span>Выйти</span></button>';
  function closeSheet() {
    el("moreSheet").classList.add("hidden");
    var more = el("tabMore");
    if (more) more.setAttribute("aria-expanded", "false");
  }
  el("tabbar").querySelectorAll("[data-tab-view]").forEach(function (button) {
    button.onclick = function () { closeSheet(); go(button.dataset.tabView, ""); };
  });
  el("moreSheet").querySelectorAll("[data-tab-view]").forEach(function (button) {
    button.onclick = function () { closeSheet(); go(button.dataset.tabView, ""); };
  });
  el("moreLogout").onclick = function () { el("logoutBtn").onclick(); };
  el("tabMore").onclick = function (event) {
    if (event && event.stopPropagation) event.stopPropagation();
    var open = el("moreSheet").classList.contains("hidden");
    el("moreSheet").classList.toggle("hidden", !open);
    el("tabMore").setAttribute("aria-expanded", String(open));
  };
}

// --- Общий поиск в шапке ----------------------------------------------------
// Одно поле вместо трёх на разных экранах: клиенты (имя, @username, телефон),
// объекты (название, номер, город) и сообщения (по всей переписке — этим
// занимается бот, у панели её нет). Результат открывается сразу.
var globalSearchTimer = 0, globalSearchSerial = 0;

function globalSearchMatches(query) {
  var needle = String(query || "").trim().toLowerCase();
  if (needle.length < 2) return { clients: [], objects: [] };
  var clients = (state.users || []).filter(function (user) {
    return (userName(user) + " " + (user.username || "") + " " + (user.phone || "") + " " + (user.id || "")).toLowerCase().indexOf(needle) >= 0;
  }).slice(0, 5);
  var objects = (state.objects || []).filter(function (record) {
    var words = ["ru", "en", "es"].map(function (code) { return localized(record.title, code) + " " + localized(record.city, code); }).join(" ");
    return (words + " " + (record.reference || "") + " " + (record.id || "")).toLowerCase().indexOf(needle) >= 0;
  }).slice(0, 5);
  return { clients: clients, objects: objects };
}

// Ctrl+K: то же поле поиска, но с действиями. Без запроса — самые частые действия,
// с запросом — те, чьё название или слова рядом совпали. Клиентов ищет бот по
// всей базе (в панель попадают только 500 последних).
var PALETTE_ACTIONS = [
  { title: "Новый объект", words: "добавить создать объект каталог", run: async function () { if (await go("objects", "list")) openRecordEditor("objects", null); } },
  { title: "Создать рассылку", words: "рассылка новости акция", run: async function () { if (await go("posts", "broadcast")) openCampaignEditor(null); } },
  { title: "Написать в канал", words: "пост канал публикация", run: function () { return go("posts", "channel"); } },
  { title: "Открыть просмотры", words: "просмотры календарь запись встречи", run: function () { return go("viewings"); } },
  { title: "Сегодня", words: "главная дела список", run: function () { return go("today"); } },
  { title: "Диалоги", words: "клиенты переписка сообщения", run: function () { return go("clients", "inbox"); } },
  { title: "Воронка", words: "клиенты этапы сделки", run: function () { return go("clients", "pipeline"); } },
  { title: "Отчёт", words: "неделя итоги реклама", run: function () { return go("reports"); } },
  { title: "Настройки компании", words: "часы работы калькулятор напоминания", run: function () { return go("settings", "company"); } },
];
var paletteOpen = false;

function globalSearchActions(query) {
  var needle = String(query || "").trim().toLowerCase();
  var all = PALETTE_ACTIONS.map(function (action, index) { return { title: action.title, index: index, hay: (action.title + " " + action.words).toLowerCase() }; });
  if (!needle) return all.slice(0, 6);
  return all.filter(function (action) { return action.hay.indexOf(needle) >= 0; }).slice(0, 5);
}

// Полная карточка клиента. В общем состоянии — 500 последних и «неполные» клиенты
// из заявок; остальных (и неполных) запрашиваем у бота по одному.
async function ensureClientLoaded(id) {
  var known = (state.users || []).find(function (user) { return user.id === id; });
  if (known && !known.partial) return true;
  var answer = await api("/api/users/" + encodeURIComponent(id));
  state.users = (state.users || []).filter(function (user) { return user.id !== id; }).concat([answer.user]);
  return true;
}

function paletteShortcut(event) {
  if (!(event && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "k")) return false;
  if (event.preventDefault) event.preventDefault();
  paletteOpen = true;
  el("globalSearchBox").classList.add("open");
  var input = el("globalSearch");
  if (input.focus) input.focus();
  if (input.select) input.select();
  globalSearchRun(input.value);
  return true;
}

function globalSearchSection(title, rows) {
  if (!rows.length) return "";
  return '<div class="global-group"><div class="global-title">' + esc(title) + '</div>' + rows.map(function (row) {
    return '<button class="global-item" type="button" data-kind="' + row.kind + '" data-id="' + esc(row.id) + '"><b>' + esc(row.title) + '</b><span>' + esc(row.note || "") + '</span></button>';
  }).join("") + '</div>';
}

function globalSearchDraw(query, matches, messages, pending) {
  var box = el("globalResults");
  var actions = globalSearchActions(query);
  var writing = (matches.clients || []).slice(0, 3).map(function (user) {
    return { kind: "write", id: user.id, title: "✉ Написать: " + (user.name || userName(user)), note: "" };
  });
  var html =
    globalSearchSection("Действия", actions.map(function (action) { return { kind: "action", id: String(action.index), title: action.title, note: "" }; })) +
    globalSearchSection("Клиенты", matches.clients.map(function (user) {
      return { kind: "client", id: user.id, title: user.name || userName(user), note: [user.username ? "@" + user.username : "", user.phone || ""].filter(Boolean).join(" · ") };
    })) +
    globalSearchSection("Объекты", matches.objects.map(function (record) {
      return { kind: "object", id: record.id, title: localized(record.title, "ru") || record.reference || record.id, note: [record.reference || "", localized(record.city, "ru")].filter(Boolean).join(" · ") };
    })) +
    globalSearchSection("Написать клиенту", writing) +
    globalSearchSection("Сообщения", messages);
  if (!html) html = '<div class="global-empty">' + (pending ? "Ищем в переписке…" : "Ничего не найдено") + '</div>';
  else if (pending) html += '<div class="global-empty">Ищем в переписке…</div>';
  box.innerHTML = html;
  box.classList.remove("hidden");
  box.querySelectorAll("[data-kind]").forEach(function (button) {
    button.onclick = function () { globalSearchOpen(button.dataset.kind, button.dataset.id); };
  });
}

function globalSearchClose(clear) {
  paletteOpen = false;
  el("globalResults").classList.add("hidden");
  el("globalSearchBox").classList.remove("open");
  if (clear) el("globalSearch").value = "";
}

function globalSearchOpen(kind, id) {
  globalSearchClose(true);
  if (kind === "action") return PALETTE_ACTIONS[Number(id)] ? PALETTE_ACTIONS[Number(id)].run() : undefined;
  if (kind === "client" || kind === "write") {
    var known = (state.users || []).find(function (user) { return user.id === id; });
    var show = function () {
      if (kind === "client") return openClient(id);
      // «Написать»: последняя заявка клиента открывается в диалогах; без заявок — карточка, где есть поле сообщения.
      var latest = (state.inquiries || []).filter(function (item) { return String(item.userId) === id; }).sort(function (a, b) { return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0); })[0];
      return latest ? openInquiry(latest.id) : openClient(id);
    };
    if (known && !known.partial) return show();
    return ensureClientLoaded(id).then(show).catch(fail);
  }
  if (kind === "object") return openRecordEditor("objects", id);
  if (kind === "message") return openInquiry(id);
}

function globalSearchRun(query) {
  var needle = String(query || "").trim();
  var serial = ++globalSearchSerial;
  if (needle.length < 2) {
    if (!paletteOpen) { el("globalResults").classList.add("hidden"); return; }
    globalSearchDraw(needle, { clients: [], objects: [] }, [], false);
    return;
  }
  var matches = globalSearchMatches(needle);
  globalSearchDraw(needle, matches, [], true);
  api("/api/conversations/search?q=" + encodeURIComponent(needle)).then(function (answer) {
    if (serial !== globalSearchSerial) return;
    var seen = {};
    var messages = [];
    (answer.inquiryIds || []).forEach(function (inquiryId) {
      var item = (state.inquiries || []).find(function (entry) { return entry.id === inquiryId; });
      if (!item || seen[item.userId]) return;
      seen[item.userId] = true;
      messages.push({ kind: "message", id: item.id, title: userName(userOf(item)), note: String((item.lastMessage && (item.lastMessage.text || item.lastMessage.fileName)) || item.text || "").replace(/\s+/g, " ").slice(0, 80) });
    });
    // Клиенты с сервера: вся база, а не только 500 последних; повторы (уже найденные
    // в панели) не показываем второй раз.
    var known = {};
    matches.clients.forEach(function (user) { known[user.id] = true; });
    var remote = (answer.clients || []).filter(function (user) { return !known[user.id]; });
    var merged = { clients: matches.clients.map(function (user) { return { id: user.id, name: userName(user), username: user.username, phone: user.phone }; }).concat(remote).slice(0, 8), objects: matches.objects };
    globalSearchDraw(needle, merged, messages.slice(0, 5), false);
  }).catch(function () {
    if (serial === globalSearchSerial) globalSearchDraw(needle, matches, [], false);
  });
}

function initGlobalSearch() {
  var input = el("globalSearch");
  input.oninput = function () {
    clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(function () { globalSearchRun(input.value); }, 250);
  };
  input.onkeydown = function (event) {
    if (event.key === "Escape") return globalSearchClose(true);
    if (event.key === "Enter") {
      var first = el("globalResults").querySelector("[data-kind]");
      if (first) globalSearchOpen(first.dataset.kind, first.dataset.id);
    }
  };
  input.onfocus = function () { if (String(input.value || "").trim().length >= 2) globalSearchRun(input.value); };
  document.addEventListener("keydown", paletteShortcut);
  // На телефоне поле прячется за значком 🔍 и раскрывается под шапкой.
  el("searchToggle").onclick = function () {
    var open = !el("globalSearchBox").classList.contains("open");
    el("globalSearchBox").classList.toggle("open", open);
    if (open) input.focus();
  };
}

// --- Новое сообщение, пока вкладка не на виду -----------------------------------
// Вкладку с панелью держат открытой, а смотрят в неё редко. Заголовок вкладки
// показывает, сколько клиентов ждут ответа, а на новое сообщение вкладка мигает
// «✉ Новое сообщение» (и по желанию подаёт короткий звук), пока в неё не вернутся.
// Звук выключен, пока его не включат: неожиданный сигнал на рабочем месте хуже тишины.
// last: null — данных ещё не читали; 0 — прочитали, сообщений от клиентов не было.
var alertKit = { last: null, flashTimer: 0, flashOn: false, sound: false, baseTitle: "", audio: null };
(function () {
  try { alertKit.sound = localStorage.getItem("alert.sound") === "1"; } catch (error) {}
})();

function alertBaseTitle() {
  if (!alertKit.baseTitle) alertKit.baseTitle = String(document.title || "Панель Telegram-бота").replace(/^\(\d+\)\s*/, "");
  return alertKit.baseTitle;
}
function titleWithCount() {
  var waiting = state ? waitingClients() : 0;
  return (waiting ? "(" + waiting + ") " : "") + alertBaseTitle();
}
function stopTitleFlash() {
  if (alertKit.flashTimer) clearInterval(alertKit.flashTimer);
  alertKit.flashTimer = 0;
  alertKit.flashOn = false;
  document.title = titleWithCount();
}
function startTitleFlash() {
  if (alertKit.flashTimer) return;
  alertKit.flashTimer = setInterval(function () {
    alertKit.flashOn = !alertKit.flashOn;
    document.title = alertKit.flashOn ? "✉ Новое сообщение" : titleWithCount();
  }, 1200);
}
// Один звуковой контекст на страницу. Созданный без нажатия браузер держит
// приостановленным и до первого нажатия молчит; поэтому контекст создаётся и
// возобновляется на первом же нажатии (unlockAudio), а перед каждым сигналом
// проверяется ещё раз. Раньше на каждый сигнал создавался новый контекст, и после
// перезагрузки страницы звук не работал, пока что-нибудь не нажмёшь.
function alertAudio() {
  if (alertKit.audio) return alertKit.audio;
  var Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  try { alertKit.audio = new Context(); } catch (error) { return null; }
  return alertKit.audio;
}
function unlockAudio() {
  if (!alertKit.sound) return;
  var audio = alertAudio();
  if (audio && audio.state === "suspended" && audio.resume) {
    var done = function () { if (typeof renderSoundToggle === "function") renderSoundToggle(); };
    audio.resume().then(done, done);
  }
}
// Короткий двойной сигнал без файла со звуком: браузер сам его синтезирует.
function playAlertSound() {
  try {
    var context = alertAudio();
    if (!context) return;
    var ring = function () {
      [0, 0.22].forEach(function (offset) {
        var tone = context.createOscillator(), volume = context.createGain();
        tone.frequency.value = 880;
        volume.gain.setValueAtTime(0.0001, context.currentTime + offset);
        volume.gain.exponentialRampToValueAtTime(0.12, context.currentTime + offset + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.16);
        tone.connect(volume);
        volume.connect(context.destination);
        tone.start(context.currentTime + offset);
        tone.stop(context.currentTime + offset + 0.18);
      });
    };
    if (context.state === "suspended" && context.resume) context.resume().then(ring, function () {});
    else ring();
  } catch (error) {}
}
function tabIsAway() {
  return Boolean(document.hidden) || (typeof document.hasFocus === "function" && !document.hasFocus());
}
// Вызывается после каждого обновления данных. Первое чтение только запоминает
// время: старые сообщения новыми не считаются.
function checkNewClientMessage() {
  var latest = Number(state && state.latestClientMessageAt) || 0;
  // Первое чтение только запоминает, что было. Пустая база (0) — тоже «что было»:
  // раньше 0 читался как «ещё не смотрели», и самое первое сообщение проходило молча.
  var first = alertKit.last === null;
  var previous = first ? latest : alertKit.last;
  alertKit.last = Math.max(previous, latest);
  document.title = alertKit.flashTimer && alertKit.flashOn ? "✉ Новое сообщение" : titleWithCount();
  if (first || latest <= previous) return false;
  if (!tabIsAway()) return false;
  startTitleFlash();
  if (alertKit.sound) playAlertSound();
  return true;
}
function renderSoundToggle() {
  var button = el("soundToggle");
  button.textContent = alertKit.sound ? "🔊" : "🔇";
  button.setAttribute("aria-pressed", String(alertKit.sound));
  var waiting = alertKit.sound && alertKit.audio && alertKit.audio.state === "suspended";
  button.title = "Звук о новом сообщении: " + (alertKit.sound ? (waiting ? "включён, но браузер ждёт первого нажатия на странице" : "включён") : "выключен");
}
function bindAlerts() {
  renderSoundToggle();
  el("soundToggle").onclick = function () {
    alertKit.sound = !alertKit.sound;
    try { localStorage.setItem("alert.sound", alertKit.sound ? "1" : "0"); } catch (error) {}
    renderSoundToggle();
    // Сигнал при включении — чтобы сразу было слышно, что звук работает.
    if (alertKit.sound) playAlertSound();
  };
  // Первое нажатие или клавиша на странице «будит» звук заранее.
  ["pointerdown", "keydown"].forEach(function (type) { document.addEventListener(type, unlockAudio, { passive: true }); });
  window.addEventListener("focus", stopTitleFlash);
}

function renderNotificationBell() {
  var button = el("notificationBell"), badge = el("notificationCount");
  // Колокольчик считает то же, что и «Список дел»: нерешённые дела, а не только непрочитанные.
  var count = state ? deedList().length : 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
  button.classList.toggle("active", currentView === "today");
  button.setAttribute("aria-label", count ? "Открыть список дел: " + count + " " + plural(count, "дело", "дела", "дел") : "Открыть список дел");
  button.title = count ? count + " " + plural(count, "дело", "дела", "дел") + " требуют внимания" : "Дел нет";
}

// Запись на диск не удалась: полоса видна на всех экранах, пока не получится.
// Молчать нельзя — всё, что владелец делает сейчас, живёт только в памяти.
function renderSaveAlert() {
  var save = (state.runtime || {}).save || {};
  var alert = el("saveAlert");
  if (!save.error) {
    alert.classList.add("hidden");
    return;
  }
  var when = save.nextRetryAt ? Date.parse(save.nextRetryAt) : NaN;
  var retry = isFinite(when)
    ? " Бот пробует записать снова" + (when > Date.now() ? " в " + dateTime(save.nextRetryAt) : "") + "."
    : "";
  el("saveAlertText").textContent = save.error + "."
    + " Изменения пока только в памяти: если бота закрыть, они потеряются." + retry
    + " Обычно так бывает из-за антивируса, программы резервного копирования или нехватки места на диске.";
  alert.classList.remove("hidden");
}

function renderBotState() {
  var runtime = state.runtime || {}, active = state.config.active;
  renderSaveAlert();
  var bad = runtime.status === "error" || runtime.consecutiveFailures > 0;
  var dot = !active ? "off" : bad ? "bad" : "on";
  el("botState").querySelector(".dot").className = "dot " + dot;
  el("botStateText").innerHTML = !active
    ? "Бот выключен"
    : bad ? "Связь с Telegram потеряна" : "Бот работает" + (state.newInquiryCount ? ' · <b>' + num(state.newInquiryCount) + "</b> новых" : "");
  // Когда шапка тесная, текст состояния прячется, остаётся точка — а слова в подсказке.
  // При беде рядом с точкой остаётся короткая подпись (на телефоне её рисуют стили).
  el("botState").title = el("botStateText").textContent || "";
  el("botState").setAttribute("aria-label", el("botStateText").textContent || "");
  el("botState").dataset.state = dot;
  el("botState").dataset.short = dot === "off" ? "Выключен" : dot === "bad" ? "Нет связи" : "";
}

async function go(view, tab, sub) {
  var route = normalizeRoute(view, tab);
  // Переход в «Диалоги» из другого места (задачи, уведомление) с уже выбранной
  // беседой ведёт по адресу этой беседы.
  if (!sub && route[0] === "clients" && route[1] === "inbox" && selectedInquiry && conversationOpenedByUser) sub = selectedInquiry;
  var target = routeHash(route[0], route[1], sub);
  if (location.hash === target) return true;
  if (!(await confirmPageLeave())) return false;
  clearDirty();
  allowNextRoute = true;
  location.hash = target;
  return true;
}

// Адрес состоит из трёх частей: #/раздел/вкладка/подробность. Подробность — то,
// что раньше жило только в памяти страницы и пропадало при «Назад» и в ссылке:
// экран «Обслуживания», вкладка «Просмотров» (у неё она стоит на месте вкладки),
// открытый диалог.
var VIEWING_MODES = ["calendar", "pending", "history"];

function routeHash(view, tab, sub) {
  return "#/" + view + (tab ? "/" + tab : "") + (sub ? "/" + sub : "");
}

// Шаг в истории браузера без перерисовки: экран уже показан, меняется адрес.
function pushRoute(view, tab, sub) {
  var hash = routeHash(view, tab || "", sub || "");
  if (hash === currentRouteHash) return;
  currentRouteHash = hash;
  currentView = view;
  currentTab = tab || "";
  currentSub = sub || "";
  history.pushState(null, "", hash);
}

function applyRoute() {
  var parts = (location.hash || "").replace(/^#\//, "").split("/");
  var route = normalizeRoute(parts[0], parts[1]);
  var view = VIEWS[route[0]] ? route[0] : "today";
  var tab = route[1] || "";
  var sub = parts[2] || "";
  // Каждый заход в «Просмотры» снова начинается с очереди подтверждения.
  if (view === "viewings" && currentView !== "viewings") viewingModeChosen = false;
  if (view === "settings" && tab === "service") {
    // Раздел «Обслуживания»: из адреса, а без него (или по старой ссылке) — тот, что открыт.
    if (SERVICE_SCREENS.some(function (item) { return item[0] === sub; })) serviceScreen = sub;
    sub = serviceScreen;
  } else if (view === "viewings") {
    if (VIEWING_MODES.indexOf(tab) >= 0) {
      viewingMode = tab;
      viewingModeChosen = true;
    } else tab = "";
    sub = "";
  } else if (view === "clients" && tab === "inbox" && sub) {
    if ((state.inquiries || []).some(function (item) { return item.id === sub; })) selectConversation(sub, true);
    else sub = "";
  } else sub = "";
  currentView = view;
  currentTab = tab;
  currentSub = sub;
  currentRouteHash = routeHash(view, tab, sub);
  if (location.hash && location.hash !== currentRouteHash) {
    allowNextRoute = true;
    history.replaceState(null, "", currentRouteHash);
  }
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
  history.replaceState(null, "", currentRouteHash || "#/today");
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
  // Экран диалога на телефоне прячет обвязку; с любого другого экрана метка снимается.
  if (document.body && document.body.classList) document.body.classList.remove("phone-chat");
  renderingAuto = Boolean(options && options.auto);
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

// Кнопка в шапке экрана. Экран может перерисовать себя (выбрали клиента, сменили
// фильтр) и позвать pageAction снова, не очищая шапку: кнопка с тем же названием
// тогда обновляется, а не добавляется второй раз — раньше «Шаблоны ответов» и «⋯»
// после нескольких переходов по диалогам стояли по четыре пары.
function pageAction(label, handler, kind) {
  var box = el("pageActions");
  var button = Array.prototype.filter.call(box.children || [], function (item) { return item.textContent === label; })[0];
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    box.appendChild(button);
  }
  button.className = "btn " + (kind || "");
  button.onclick = handler;
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
    // Скрытая вкладка тоже спрашивает бота (дёшево: «изменилось ли что-то?»), но
    // ничего не перерисовывает: так вкладка успевает мигнуть о новом сообщении.
    refresh().catch(function () {});
  }, 45000);
}

function bindShell() {
  window.addEventListener("hashchange", handleHashChange);
  // Вернулись во вкладку: в скрытой вкладке обновление не идёт, и ждать до 45
  // секунд незачем — спрашиваем данные сразу.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !appStarted || sessionEnded) return;
    stopTitleFlash();
    refresh().then(function () {
      // Пока вкладка была скрыта, данные обновились, а экран нет.
      if (!staleWhileHidden) return;
      staleWhileHidden = false;
      if (pageBusy()) showRefreshHint();
      else renderView({ keepScroll: true, auto: true });
    }).catch(function () {});
  });
  bindAlerts();
  initGlobalSearch();
  el("menuToggle").onclick = function () {
    var open = !el("nav").classList.contains("open");
    el("nav").classList.toggle("open", open);
    el("menuToggle").setAttribute("aria-expanded", String(open));
  };
  // Колокольчик ведёт в «Сегодня»: там тот же список дел, но с кнопками.
  el("notificationBell").onclick = function () { go("today"); };
  // На телефоне текст состояния не помещается: нажатие на точку показывает его.
  el("botState").onclick = function () { toast(el("botState").title || "Состояние бота"); };
  document.addEventListener("click", function (event) {
    if (event.target.closest && !event.target.closest("#globalSearchBox") && !event.target.closest("#searchToggle")) {
      el("globalResults").classList.add("hidden");
    }
    if (event.target.closest && !event.target.closest("#moreSheet") && !event.target.closest("#tabMore")) {
      el("moreSheet").classList.add("hidden");
      if (el("tabMore")) el("tabMore").setAttribute("aria-expanded", "false");
    }
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
  el("linkAlertRetry").onclick = function () { refresh().catch(function () {}); };
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
