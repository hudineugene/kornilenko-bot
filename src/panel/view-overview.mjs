// Обзор: состояние бота, цифры за сегодня и неделю, что требует внимания,
// последние заявки. И раздел «Статистика» — вся аналитика в одном месте.

const OVERVIEW_JS = String.raw`
// Дни считаем по времени бота, а не браузера: сервер раскладывает статистику по своим
// суткам (по часам компьютера, где работает бот), и при входе из другого пояса столбики
// графика съезжали на день. Бот присылает своё время и сдвиг пояса вместе с состоянием.
function serverOffsetMinutes() {
  var offset = state && Number(state.serverTzOffset);
  return Number.isFinite(offset) ? offset : new Date().getTimezoneOffset();
}
// «Сейчас» по часам бота: время из состояния плюс сколько прошло с тех пор, как оно пришло.
function serverNow() {
  var base = state && Number(state.serverTime);
  if (!Number.isFinite(base) || !base) return Date.now();
  if (!state.receivedAt) state.receivedAt = Date.now();
  return base + (Date.now() - state.receivedAt);
}
function dayKeyOf(date) {
  var shifted = new Date(date.getTime() - serverOffsetMinutes() * 60000);
  return shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0") + "-" + String(shifted.getUTCDate()).padStart(2, "0");
}
function shiftDayKey(key, delta) {
  var parts = key.split("-").map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + delta));
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
}
function lastDays(count) {
  var today = dayKeyOf(new Date(serverNow()));
  var days = [];
  for (var index = count - 1; index >= 0; index -= 1) days.push(shiftDayKey(today, -index));
  return days;
}
function dailyValue(key, field) {
  var day = (state.analytics && state.analytics.daily && state.analytics.daily[key]) || {};
  return Number(day[field] || 0);
}
function sumDays(days, field) {
  return days.reduce(function (total, key) { return total + dailyValue(key, field); }, 0);
}
function usersInRange(from) {
  return (state.users || []).filter(function (user) { return (Date.parse(user.firstSeenAt) || 0) >= from; }).length;
}
function inquiriesInRange(from) {
  return (state.inquiries || []).filter(function (item) { return (Date.parse(item.createdAt) || 0) >= from; });
}
// Полночь суток бота, в миллисекундах.
function startOfDay(key) {
  var parts = key.split("-").map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) + serverOffsetMinutes() * 60000;
}
function startOfToday() { return startOfDay(dayKeyOf(new Date(serverNow()))); }
function startOfWeek() { return startOfDay(shiftDayKey(dayKeyOf(new Date(serverNow())), -6)); }

function viewingList() {
  return (state.inquiries || []).filter(function (item) { return item.type === "viewing" && item.viewing && item.status !== "closed" && !item.viewing.cancelledAt; });
}
function unconfirmedViewings() {
  return viewingList().filter(function (item) { return !item.viewing.confirmedAt; });
}
// Цифры одной строкой, как на «Сегодня»: ряд из четырёх карточек занимал треть
// экрана компьютера и целый экран телефона и повторялся на пяти экранах подряд.
// Каждый элемент: [подпись, число, "bad" — если число требует внимания, подсказка].
function numberStrip(items) {
  return '<div class="today-numbers">' + items.map(function (item) {
    return '<span' + (item[3] ? ' title="' + esc(item[3]) + '"' : '') + '>' + esc(item[0]) + ': <b' + (item[2] === "bad" ? ' class="bad"' : '') + '>' + item[1] + '</b>' + (item[3] ? '<small class="strip-hint">' + esc(item[3]) + '</small>' : '') + '</span>';
  }).join("") + '</div>';
}

function kpiCard(label, value, note, noteKind) {
  return '<div class="card kpi"><span class="label">' + esc(label) + '</span><span class="value">' + value + '</span>' +
    (note ? '<span class="delta ' + (noteKind || "") + '">' + note + "</span>" : "") + "</div>";
}

// «2026-09-29» → «29.09»: подписи под графиком.
function chartDay(key) {
  var parts = String(key).split("-");
  return parts.length === 3 ? parts[2] + "." + parts[1] : String(key);
}

// График по дням с осями: слева — наибольшее значение и ноль, снизу — даты, а
// у коротких графиков число стоит над каждым столбцом. Раньше были одни столбики
// без единой цифры, и по ним нельзя было понять ни сколько, ни когда.
function sparkline(days, field, color) {
  var values = days.map(function (key) { return dailyValue(key, field); });
  var top = Math.max.apply(null, values.concat([1]));
  // Пустой график выглядит как поломка, поэтому вместо него — строка текста.
  if (!values.some(Boolean)) return '<div class="muted small">За этот период сообщений не было.</div>';
  var labelled = days.length <= 14;
  var ticks = labelled
    ? days.map(function (key) { return chartDay(key); })
    : [0, Math.round((days.length - 1) / 4), Math.round((days.length - 1) / 2), Math.round(((days.length - 1) * 3) / 4), days.length - 1].map(function (index) { return chartDay(days[index]); });
  return '<div class="chart"><div class="chart-y"><span>' + num(top) + '</span><span>0</span></div><div class="chart-plot"><div class="spark">' + values.map(function (value, index) {
    var height = Math.round((value / top) * 100);
    return '<div title="' + esc(chartDay(days[index]) + ": " + value) + '"><i style="height:' + height + "%;background:" + color + '"></i>' +
      (labelled && value ? '<b style="bottom:calc(' + height + '% + 2px)">' + num(value) + "</b>" : "") + "</div>";
  }).join("") + '</div><div class="chart-x' + (labelled ? " even" : "") + '">' + ticks.map(function (label) { return "<span>" + esc(label) + "</span>"; }).join("") + "</div></div></div>";
}

// Что делать с событием: одна главная кнопка на строку. Клиент ждёт ответа —
// «Ответить», просмотр без подтверждения — «Подтвердить», остальное —
// «Открыть».
function deedAction(item) {
  if (item.kind === "message") return "Ответить";
  if (item.kind === "viewing") return "Подтвердить";
  if (item.kind === "task") return "Открыть диалог";
  if (item.kind === "catalog") return "Открыть каталог";
  if (item.kind === "group") return "Открыть заявки";
  if (item.kind === "broadcast") return "Открыть рассылки";
  return "Открыть";
}

function deedIcon(item) {
  return iconSpan({ message: "mail", task: "clock", viewing: "calendar", catalog: "home", group: "users", broadcast: "send", error: "warning", system: "gear" }[item.kind] || "info");
}

// «Мои / Все»: пока менеджер один, переключателя нет. С двумя и больше на
// «Сегодня» можно оставить только свои дела — те, где клиент закреплён за тобой.
// Кто «я», панель не знает (вход один на всех), поэтому имя выбирают и запоминают
// в этом браузере.
var todayScope = { mine: false, me: "" };
(function () {
  try {
    todayScope.mine = localStorage.getItem("today.mine") === "1";
    todayScope.me = localStorage.getItem("today.me") || "";
  } catch (error) {}
})();
function rememberTodayScope() {
  try {
    localStorage.setItem("today.mine", todayScope.mine ? "1" : "0");
    localStorage.setItem("today.me", todayScope.me || "");
  } catch (error) {}
}
function todayPeople() {
  return staffNames();
}
function deedAssignee(item) {
  var id = item.route && item.route.inquiryId;
  var inquiry = id ? (state.inquiries || []).find(function (entry) { return entry.id === id; }) : null;
  return inquiry ? inquiry.assignee || "" : null;
}
// Дела для «Мои»: клиент закреплён за выбранным человеком — и клиент, за которым
// ещё никто не закреплён: новую заявку иначе не видел бы никто, пока его не
// заметят в «Все» (такие дела помечены «без менеджера»). Чужие клиенты и всё, что
// клиентов не касается (ошибки, каталог, рассылки), — только в «Все».
function scopedDeeds(deeds) {
  var people = todayPeople();
  if (people.length < 2) return { shown: deeds, hidden: 0, active: false };
  if (people.indexOf(todayScope.me) < 0) todayScope.me = people[0];
  if (!todayScope.mine) return { shown: deeds, hidden: 0, active: false };
  var shown = deeds.filter(function (item) { var assignee = deedAssignee(item); return assignee === todayScope.me || assignee === ""; });
  return { shown: shown, hidden: deeds.length - shown.length, active: true };
}

// Лента одна: «Требуют внимания» — то, что ещё надо сделать; «Выполненное» —
// скрытое руками и то, что уже устранилось само. Колокольчик считает первую вкладку.
var feedFilter = "active";

function doneList() {
  return (state.notifications || [])
    .filter(function (item) { return item.handledAt || !item.active; })
    .sort(function (first, second) { return (Date.parse(second.handledAt || second.createdAt) || 0) - (Date.parse(first.handledAt || first.createdAt) || 0); })
    .slice(0, 30);
}

function doneRowsHtml() {
  var rows = doneList();
  if (!rows.length) return '<div class="empty"><b>Пока пусто</b>Сюда попадает то, что вы скрыли, и то, что решилось само</div>';
  return '<div class="deeds">' + rows.map(function (item) {
    var resolved = !item.active;
    return '<div class="deed done"><span class="deed-icon">' + deedIcon(item) + '</span>' +
      '<span class="deed-body"><b>' + esc(item.title) + '</b> <span class="chip ' + (resolved ? "ok" : "") + '">' + (resolved ? "причина устранена" : "скрыто") + '</span><span>' + esc(item.text) + '</span></span>' +
      '<span class="deed-actions">' + (!resolved ? '<button class="btn ghost small" data-notification-action="reopen" data-notification-id="' + esc(item.id) + '" type="button">Вернуть</button>' : "") + '</span></div>';
  }).join("") + '</div>';
}

// Сначала то, что горит, потом по времени: свежее сверху.
function deedList() {
  var rank = { bad: 0, warn: 1 };
  return (state.notifications || [])
    // «Нет связи с Telegram» — не дело менеджера: она в «Состоянии бота» и красной точкой в шапке.
    .filter(function (item) { return item.active && !item.handledAt && String(item.id).indexOf("system:connection:") !== 0; })
    .slice()
    .sort(function (first, second) {
      var weight = (rank[first.severity] === undefined ? 2 : rank[first.severity]) - (rank[second.severity] === undefined ? 2 : rank[second.severity]);
      if (weight) return weight;
      return (Date.parse(second.createdAt) || 0) - (Date.parse(first.createdAt) || 0);
    });
}

async function runDeed(item, button) {
  var target = item.route || {};
  // Просмотр подтверждается прямо отсюда, не уводя менеджера в другой раздел.
  if (item.kind === "viewing" && target.inquiryId) {
    var inquiry = (state.inquiries || []).find(function (entry) { return entry.id === target.inquiryId; });
    if (inquiry) return openViewingSchedule(inquiry);
  }
  // Новое сообщение клиента: отвечаем в окне, не уходя со «Сегодня».
  if (item.kind === "message" && target.inquiryId) {
    var waiting = (state.inquiries || []).find(function (entry) { return entry.id === target.inquiryId; });
    if (waiting) return openQuickReply(waiting.id, []);
  }
  return openNotification(item, button);
}

// --- Готовность к запуску -------------------------------------------------------
// Пока бот не готов принимать клиентов по-настоящему, на «Сегодня» стоит список
// того, что осталось сделать: токен, чат для заявок, каталог, политика, контакты,
// фото и срок ответа, копия данных, канал, первая заявка. У каждого неготового
// пункта — кнопка, которая ведёт прямо на нужный экран. Проверки берутся из
// самопроверки бота (/api/self-check), а не считаются заново; как только всё
// зелёное, блок исчезает.
var readinessCache = { at: 0, report: null };
var READINESS_TTL = 20000;

function readinessItems(report) {
  var checks = {};
  ((report && report.checks) || []).forEach(function (check) { checks[check.id] = check; });
  var config = state.config || {}, contacts = state.contacts || {};
  var items = [];
  function fromCheck(id, title, route) {
    var check = checks[id];
    // Сбой связи с Telegram показывается один раз — в «Состоянии бота»; здесь только «!» и ссылка туда.
    if (check) items.push({ id: id, title: title, ok: check.status === "ok", detail: id === "token" && check.status !== "ok" ? "Подробности — в «Состоянии бота»" : check.detail || "", route: route });
  }
  fromCheck("token", "Бот подключён к Telegram", ["settings", "telegram"]);
  fromCheck("admin", "Заявки приходят в ваш Telegram", ["settings", "team"]);
  fromCheck("catalog", "Клиенты видят каталог", ["objects", "list"]);
  fromCheck("privacy", "Политика конфиденциальности заполнена", ["texts", "interface", "policy"]);
  var hasChannel = Boolean(contacts.phone || contacts.whatsapp || contacts.telegram || contacts.email);
  items.push({ id: "contacts", title: "Контакты для связи заполнены", ok: hasChannel, detail: hasChannel ? "" : "Нет ни телефона, ни WhatsApp, ни Telegram, ни почты — клиенту некуда писать", route: ["texts", "contacts"] });
  var promise = Number(((config.workingHours || {}).replyMinutes) || 0);
  var agentMissing = [];
  if (!contacts.managerName) agentMissing.push("имя");
  if (!(contacts.photo && contacts.photo.exists)) agentMissing.push("фото");
  if (!promise) agentMissing.push("срок ответа");
  // Имя и фото — на «Контактах», срок ответа — в «Настройки → Компания»: кнопка ведёт туда, чего не хватает.
  var onlyReply = agentMissing.length === 1 && !promise;
  items.push({ id: "agent", title: "Лицо агента: имя, фото, срок ответа", ok: !agentMissing.length, detail: agentMissing.length ? "Не заполнено: " + agentMissing.join(", ") + (onlyReply ? " — в «Настройки → Компания»" : "") : "", route: onlyReply ? ["settings", "company"] : ["texts", "contacts"] });
  var copyOk = checks.version ? checks.version.status === "ok" : true;
  var offsite = Boolean((config.telegramBackup || {}).enabled);
  items.push({ id: "backup", title: "Копия данных сделана и лежит не только на этом компьютере", ok: copyOk && offsite, detail: !copyOk ? (checks.version.detail || "") : offsite ? "" : "Копия в Telegram не включена: все копии лежат на одном диске", route: ["settings", "data"] });
  var hasGroup = (state.groups || []).some(function (group) { return ["member", "administrator", "creator"].indexOf(group.status) >= 0; });
  items.push({ id: "channel", title: "Канал или группа подключены", ok: hasGroup, detail: hasGroup ? "" : "Бот пока не состоит ни в одном канале или группе", route: ["posts", "channels"] });
  var hasInquiry = (state.inquiries || []).length > 0;
  items.push({ id: "inquiry", title: "Первая заявка проверена", ok: hasInquiry, detail: hasInquiry ? "" : "Напишите боту сами и оставьте заявку — убедитесь, что она дошла", route: ["clients", "inbox"] });
  return items;
}

function readinessCard(items) {
  if (!items.length || items.every(function (item) { return item.ok; })) return "";
  var done = items.filter(function (item) { return item.ok; }).length;
  return '<div class="card gap-bottom readiness"><header><h3>Готовность к запуску</h3><div class="actions"><span class="chip ' + (done === items.length - 1 ? "warn" : "brand") + '">Готово ' + done + " из " + items.length + "</span></div></header>" +
    '<div class="list">' + items.map(function (item) {
      return '<div class="list-item"><span class="chip ' + (item.ok ? "ok" : "warn") + '">' + iconSpan(item.ok ? "check" : "warning") + "</span>" +
        '<span class="grow"><b>' + esc(item.title) + "</b>" + (item.ok || !item.detail ? "" : '<br><span class="muted small">' + esc(item.detail) + "</span>") + "</span>" +
        (item.ok ? "" : '<button class="btn secondary small" type="button" data-ready-go="' + esc(item.route.join("/")) + '">Настроить</button>') + "</div>";
    }).join("") + "</div></div>";
}

// Здоровье бота одним списком в карточке «Состояние бота»: то, что ломается тихо —
// связь с Telegram, диск, копия, файлы картинок, каналы. Берётся из той же
// самопроверки, что и чек-лист.
function healthRows(report) {
  var checks = {};
  ((report && report.checks) || []).forEach(function (check) { checks[check.id] = check; });
  var rows = [];
  function add(id, title) {
    if (checks[id]) rows.push({ title: title, status: checks[id].status, detail: checks[id].detail || "" });
  }
  if (!Object.keys(checks).length) return rows;
  add("token", "Telegram");
  add("disk", "Диск");
  add("version", "Копия данных");
  add("media", "Файлы картинок");
  var groups = (state.groups || []).filter(function (group) { return ["member", "administrator", "creator"].indexOf(group.status) >= 0; }).length;
  rows.push({ title: "Каналы и группы", status: groups ? "ok" : "warn", detail: groups ? "подключено " + groups : "не подключены" });
  return rows;
}

function healthHtml(rows) {
  if (!rows.length) return "";
  return '<div class="stack health">' + rows.map(function (row) {
    var kind = row.status === "bad" ? "bad" : row.status === "warn" ? "warn" : "ok";
    var mark = iconSpan(row.status === "bad" ? "close" : row.status === "warn" ? "warning" : "check");
    return '<div class="row"><span class="chip ' + kind + '">' + mark + "</span><span>" + esc(row.title + ": " + row.detail) + "</span></div>";
  }).join("") + "</div>";
}

async function loadReadiness(host) {
  var box = host.querySelector("#readiness");
  if (!box) return;
  try {
    if (!readinessCache.report || Date.now() - readinessCache.at > READINESS_TTL) {
      readinessCache = { at: Date.now(), report: await api("/api/self-check") };
    }
    if (!Array.isArray(readinessCache.report.checks)) return;
    var health = host.querySelector("#healthRows");
    if (health) health.innerHTML = healthHtml(healthRows(readinessCache.report));
    box.innerHTML = readinessCard(readinessItems(readinessCache.report));
    box.querySelectorAll("[data-ready-go]").forEach(function (button) {
      button.onclick = function () {
        var parts = button.dataset.readyGo.split("/");
        // «Настроить» у политики: открыть группу «Данные клиента и политика» и поставить курсор в поле,
        // а не оставить владельца перед 29 свёрнутыми группами.
        if (parts[0] === "texts" && parts[1] === "interface" && parts[2] === "policy") { interfaceGroupOpen = "privacy"; interfaceFocusKey = "policy"; }
        go(parts[0], parts[1] || "", parts[2] || "");
      };
    });
  } catch (error) {
    // Чек-лист — подсказка, а не работа: не вышло — «Сегодня» остаётся как было.
  }
}

VIEWS.today = {
  render: function (host) {
    var today = startOfToday(), week = startOfWeek();
    var waiting = waitingClients();
    var overdue = overdueClients();
    var weekDays = lastDays(7);
    var allDeeds = deedList();
    var scoped = scopedDeeds(allDeeds);
    var deeds = scoped.shown;
    var people = todayPeople();
    var unconfirmed = unconfirmedViewings().length;
    host.innerHTML =
      // Цифры — одной строкой: ряд из четырёх карточек занимал треть экрана и
      // повторялся на восьми экранах подряд.
      '<div class="today-numbers">' +
        '<span><b>' + num(waiting) + '</b> ' + plural(waiting, "клиент ждёт", "клиента ждут", "клиентов ждут") + ' ответа' + (overdue ? ' · <span class="late-note">из них дольше срока: ' + num(overdue) + '</span>' : '') + '</span>' +
        '<span><b>' + num(unconfirmed) + '</b> ' + plural(unconfirmed, "просмотр", "просмотра", "просмотров") + ' без подтверждения</span>' +
        '<span><b>' + num(inquiriesInRange(week).length) + '</b> ' + plural(inquiriesInRange(week).length, "заявка", "заявки", "заявок") + ' за 7 дней · ' + num(inquiriesInRange(today).length) + ' сегодня</span>' +
        '<span><b>' + num(state.userCount) + '</b> ' + plural(state.userCount, "клиент", "клиента", "клиентов") + ' в базе · +' + usersInRange(week) + ' за неделю</span>' +
      '</div>' +
      '<div class="week-line" id="weekLine"></div>' +
      '<div class="split">' +
        '<div class="stack">' +
          '<div class="card"><header><h3>Список дел</h3><div class="actions">' + (waiting ? '<button class="btn small" type="button" id="answerQueue" title="Открыть ответ тому, кто ждёт дольше всех, и дальше по очереди">Ответить по очереди · ' + num(waiting) + '</button>' : "") + '<div class="tabs" id="feedTabs">' +
            '<button type="button" class="' + (feedFilter === "active" ? "active" : "") + '" data-feed-filter="active">Требуют внимания <span>' + num(deeds.length) + '</span></button>' +
            '<button type="button" class="' + (feedFilter === "done" ? "active" : "") + '" data-feed-filter="done">Выполненное</button></div></div></header>' +
            (feedFilter === "done" ? doneRowsHtml() : "") +
            (feedFilter !== "done" && people.length > 1 ? '<div class="deeds-scope row wrap"><div class="tabs" id="deedScope"><button type="button" data-scope="all" class="' + (todayScope.mine ? "" : "active") + '">Все</button><button type="button" data-scope="mine" class="' + (todayScope.mine ? "active" : "") + '">Мои</button></div>' +
              '<label class="small muted" for="deedMe">Я —</label><select id="deedMe" style="width:auto;min-width:0">' + people.map(function (name) { return '<option value="' + esc(name) + '"' + (name === todayScope.me ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("") + "</select>" +
              (scoped.active && scoped.hidden ? '<span class="small muted">Ещё ' + num(scoped.hidden) + ' — чужие или не про клиентов: они в «Все»</span>' : "") + "</div>" : "") +
            (feedFilter === "done" ? "" : deeds.length ? '<div class="deeds">' + deeds.map(function (item) {
              return '<div class="deed' + (item.severity === "bad" ? " urgent" : "") + '">' +
                '<span class="deed-icon">' + deedIcon(item) + '</span>' +
                '<span class="deed-body"><b>' + esc(item.title) + '</b>' + (people.length > 1 && deedAssignee(item) === "" ? ' <span class="chip warn">Без менеджера</span>' : "") + '<span>' + esc(item.text) + '</span></span>' +
                '<span class="deed-actions"><button class="btn secondary small" type="button" data-deed=""' + esc(item.id) + '">' + esc(deedAction(item)) + '</button>' +
                '<button class="btn ghost small" type="button" data-deed-hide="' + esc(item.id) + '" title="Убрать из списка дел">Скрыть</button></span>' +
              '</div>';
            }).join("") + '</div>' : '<div class="empty"><b>' + (scoped.active ? "Своих дел нет" : "Дел нет") + '</b>' + (scoped.active ? "За вами закреплённых дел сейчас нет" : "Все клиенты отвечены, просмотры подтверждены") + '</div>') +
          "</div>" +
          '<div id="readiness"></div>' +
        "</div>" +
        '<div class="stack">' +
          '<div class="card"><header><h3>Состояние бота</h3></header><div class="card-body stack">' +
            '<label class="switch"><input type="checkbox" id="botActive"' + (state.config.active ? " checked" : "") + '><span class="track"></span><span>' + (state.config.active ? "Бот включён" : "Бот выключен") + "</span></label>" +
            '<div class="small muted">Связь: ' + esc(connectionText()) + "</div>" +
            '<div id="healthRows"></div>' +
            '<div class="small muted">Клиентов в базе: ' + num(state.userCount) + " · им можно писать: " + num(state.activeUserCount) + " · согласились на рассылки: " + num(state.newsConsentCount) + "</div>" +
          "</div></div>" +
        "</div>" +
      "</div>";

    host.querySelectorAll("[data-go]").forEach(function (node) {
      node.onclick = function () { go(node.dataset.go, node.dataset.tab || ""); };
    });
    var answerQueue = host.querySelector("#answerQueue");
    if (answerQueue) answerQueue.onclick = function () { openNextQuickReply([]); };
    loadReadiness(host);
    loadWeekLine(host);
    host.querySelectorAll("[data-feed-filter]").forEach(function (button) {
      button.onclick = function () { feedFilter = button.dataset.feedFilter; VIEWS.today.render(host); };
    });
    host.querySelectorAll("[data-notification-action]").forEach(function (button) {
      button.onclick = function () {
        var item = (state.notifications || []).find(function (entry) { return entry.id === button.dataset.notificationId; });
        if (item) changeNotification(item, button.dataset.notificationAction, button);
      };
    });
    host.querySelectorAll("#deedScope [data-scope]").forEach(function (button) {
      button.onclick = function () { todayScope.mine = button.dataset.scope === "mine"; rememberTodayScope(); VIEWS.today.render(host); };
    });
    var deedMe = host.querySelector("#deedMe");
    if (deedMe) deedMe.onchange = function () { todayScope.me = deedMe.value; rememberTodayScope(); VIEWS.today.render(host); };
    host.querySelectorAll("[data-deed]").forEach(function (button) {
      button.onclick = function () {
        var item = (state.notifications || []).find(function (entry) { return entry.id === button.dataset.deed; });
        if (item) runDeed(item, button);
      };
    });
    host.querySelectorAll("[data-deed-hide]").forEach(function (button) {
      button.onclick = function () {
        var item = (state.notifications || []).find(function (entry) { return entry.id === button.dataset.deedHide; });
        // Сервер знает действие «handle»: «handled» он отвергал, и «Скрыть»
        // показывало ошибку вместо того, чтобы убрать дело из списка.
        // Скрытое дело можно вернуть тут же, из уведомления.
        if (item) changeNotification(item, "handle", button, { label: "Вернуть", run: function () { changeNotification(item, "reopen"); } });
      };
    });
    // Быстрые действия открывают редактор, а не список: «Добавить объект»
    // должно добавлять объект.
    // Быстрые действия — в шапке страницы, а не карточкой в самом низу.
    pageAction("＋ Объект", async function () {
      if (await go("objects", "list")) openRecordEditor("objects", null);
    }, "secondary");
    pageAction("✉ Рассылка", async function () {
      if (await go("posts", "broadcast")) openCampaignEditor(null);
    }, "secondary");
    pageAction("➤ Пост в канал", function () { go("posts", "channel"); }, "secondary");
    var toggle = host.querySelector("#botActive");
    if (toggle) toggle.onchange = function () { return setBotActive(toggle); };
  },
};

function connectionText() {
  var runtime = state.runtime || {};
  if (!state.config.active) return "бот выключен в панели";
  if (runtime.status === "error") return "ошибка: " + (runtime.lastError || "нет связи");
  if (runtime.consecutiveFailures) return "переподключение, попыток: " + runtime.consecutiveFailures;
  // Пока ответы приходят, время последнего не показываем: оно меняется каждые
  // несколько секунд, а экран от этого перерисовывался целиком. Как только
  // ответов нет дольше двух минут — показываем, это уже важно.
  var contact = Date.parse(runtime.lastSuccessfulContactAt || "");
  var stale = isFinite(contact) && Date.now() - contact > 120000;
  return "работает" + (stale ? ", последний ответ " + ago(runtime.lastSuccessfulContactAt) : "");
}

function inquiryTypeName(item) {
  if (item.searchLead) return "искал объекты сам";
  return { lead: "заявка на звонок", viewing: "запись на просмотр", selection: "подбор объекта", question: "вопрос по объекту", interest: "интерес к объекту", general: "сообщение" }[item.type] || "сообщение";
}

function barList(rows, total) {
  if (!rows.length) return '<div class="empty"><b>Пока нет данных</b></div>';
  var top = Math.max.apply(null, rows.map(function (row) { return row[1]; }).concat([1]));
  return '<div class="card-body">' + rows.map(function (row) {
    return '<div class="bar-row"><span>' + esc(row[0]) + '<div class="bar"><span style="width:' + Math.round((row[1] / top) * 100) + '%"></span></div></span><b class="right">' + num(row[1]) + (total ? " <span class=\"muted small\">" + Math.round((row[1] / total) * 100) + "%</span>" : "") + "</b></div>";
  }).join("") + "</div>";
}

// Реклама → сделки: по каждой метке ссылки видно, сколько пришло клиентов и что
// они дали — заявки, записи на просмотр, сделки. Конструктор ссылки — тут же:
// собрал метку, разместил, через неделю смотришь в эту таблицу.
function sourceLink(label) {
  var username = (state.bot || {}).username || "";
  return username && label ? "https://t.me/" + username + "?start=src_" + label : "";
}

function sourceTableCard() {
  var rows = (state.sources || []).slice().sort(function (a, b) { return (b.deals || 0) - (a.deals || 0) || (b.users || 0) - (a.users || 0); });
  var total = { users: 0, inquiries: 0, viewings: 0, deals: 0 };
  rows.forEach(function (row) {
    total.users += row.users || 0; total.inquiries += row.inquiries || 0; total.viewings += row.viewings || 0; total.deals += row.deals || 0;
  });
  var username = (state.bot || {}).username || "";
  return '<div class="card gap-bottom" id="sourceCard"><header><h3>Реклама: клиенты и сделки</h3><div class="actions"><span class="small muted">по метке ссылки, за всё время</span></div></header>' +
    (rows.length ? '<div class="table-wrap"><table class="source-table table-stack"><thead><tr><th>Источник</th><th class="right">Клиентов</th><th class="right">Заявок</th><th class="right">Записались на просмотр</th><th class="right">Сделок</th><th></th></tr></thead><tbody>' +
      rows.map(function (row) {
        var label = row.source || "";
        return "<tr><td><b>" + esc(label || "без метки") + "</b></td><td class=\"right\">" + num(row.users) + "</td><td class=\"right\">" + num(row.inquiries) + "</td><td class=\"right\">" + num(row.viewings) + "</td><td class=\"right\">" + (row.deals ? "<b>" + num(row.deals) + "</b>" : "0") + "</td>" +
          '<td class="right">' + (label && username ? '<button class="btn ghost small" type="button" title="Скопировать ссылку с этой меткой" data-copy-source="' + esc(label) + '">Ссылка</button>' : "") + "</td></tr>";
      }).join("") +
      '<tr class="source-total"><td>Всего</td><td class="right">' + num(total.users) + '</td><td class="right">' + num(total.inquiries) + '</td><td class="right">' + num(total.viewings) + '</td><td class="right">' + num(total.deals) + "</td><td></td></tr>" +
    "</tbody></table></div>" : '<div class="empty"><b>Пока нет данных</b>Разместите ссылку с меткой ниже — здесь появится, сколько клиентов она привела</div>') +
    '<div class="card-body stack"><div class="week-subtitle">Ссылка с меткой источника</div>' +
    '<p class="muted small">Разместите такую ссылку в рекламе или соцсетях — в карточке клиента, уведомлениях и этой таблице будет видно, откуда он пришёл и что дал.</p>' +
    '<div class="row"><input id="sourceLabel" placeholder="instagram" class="field-md"><button class="btn secondary small" id="makeSourceLink" type="button">Собрать ссылку</button></div>' +
    '<div class="row"><input id="sourceLink" readonly value="' + (username ? esc("https://t.me/" + username + "?start=src_метка") : "Сначала подключите бота") + '"><button class="btn ghost small" id="copySourceLink" type="button">Копировать</button></div>' +
  "</div></div>";
}

function bindSourceLink(host) {
  var make = host.querySelector("#makeSourceLink");
  if (!make) return;
  make.onclick = function () {
    var label = (host.querySelector("#sourceLabel").value || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    host.querySelector("#sourceLabel").value = label;
    host.querySelector("#sourceLink").value = sourceLink(label) || "Укажите метку латиницей";
  };
  host.querySelector("#copySourceLink").onclick = function () {
    navigator.clipboard.writeText(host.querySelector("#sourceLink").value).then(function () { toast("Скопировано"); });
  };
  host.querySelectorAll("[data-copy-source]").forEach(function (button) {
    button.onclick = function () {
      navigator.clipboard.writeText(sourceLink(button.dataset.copySource)).then(function () { toast("Ссылка скопирована"); });
    };
  });
}

function recentReactions() {
  var events = [];
  (state.users || []).forEach(function (user) {
    (user.activity || []).forEach(function (item) { if (item.kind === "reaction") events.push({ user: user, item: item }); });
  });
  return events.sort(function (a, b) { return (Date.parse(b.item.createdAt) || 0) - (Date.parse(a.item.createdAt) || 0); }).slice(0, 10);
}

// --- Неделя одной страницей -------------------------------------------------------
// Главное для владельца — итоги недели: сколько пришло, сколько записалось и
// сколько сделок, откуда клиенты. Цифры считает бот (те же, что он присылает по
// понедельникам), панель их только показывает. Всё остальное — под «Подробнее».
// Открываем на идущей неделе: итоги нужны именно сейчас, а прошлая во вторник
// почти пуста. Переключатель «Прошлая» рядом.
var reportWeek = "current";

function weekTrend(current, previous) {
  if (current === previous) return '<span class="week-trend">как раньше</span>';
  return '<span class="week-trend ' + (current > previous ? "up" : "down") + '">' + (current > previous ? "↑ +" : "↓ −") + Math.abs(current - previous) + " · было " + previous + "</span>";
}

function weekTile(label, value, note) {
  return '<div class="week-tile"><span class="week-label">' + esc(label) + '</span><b class="week-value">' + num(value) + "</b>" + (note || "") + "</div>";
}

// Воронка бота: из новых клиентов недели — сколько дошли до каждого шага. Каталог
// и «Подробнее» бот стал помечать не сразу, поэтому, если отметки начались позже
// начала недели, цифры этих двух шагов у пришедших раньше неполные — так и сказано.
function funnelSteps(funnel) {
  var tracked = Boolean(funnel.trackedFrom);
  return [["Зашли", funnel.joined]]
    .concat(tracked ? [["Открыли каталог", funnel.catalog], ["Нажали «Подробнее»", funnel.details]] : [])
    .concat([["Оставили заявку", funnel.inquiry], ["Записались на просмотр", funnel.viewing], ["Получили подтверждение", funnel.confirmed]]);
}

function funnelTable(title, rows, tracked, labelOf) {
  if (!rows.length) return "";
  return '<div><div class="week-subtitle">' + esc(title) + '</div><div class="table-wrap"><table class="funnel-table table-stack"><thead><tr><th></th><th class="right">Зашли</th>' +
    (tracked ? '<th class="right">Каталог</th><th class="right">«Подробнее»</th>' : "") +
    '<th class="right">Заявка</th><th class="right">Запись</th><th class="right">Подтв.</th></tr></thead><tbody>' +
    rows.map(function (row) {
      return "<tr><td><b>" + esc(labelOf(row.key)) + '</b></td><td class="right">' + num(row.joined) + "</td>" +
        (tracked ? '<td class="right">' + num(row.catalog) + '</td><td class="right">' + num(row.details) + "</td>" : "") +
        '<td class="right">' + num(row.inquiry) + '</td><td class="right">' + num(row.viewing) + '</td><td class="right">' + num(row.confirmed) + "</td></tr>";
    }).join("") + "</tbody></table></div></div>";
}

function funnelBlock(funnel) {
  if (!funnel || !funnel.joined) return "";
  var tracked = Boolean(funnel.trackedFrom);
  var languageName = { ru: "Русский", en: "English", es: "Español", unknown: "Язык не выбран" };
  return '<div class="funnel-report"><div class="week-subtitle">Воронка бота: новые клиенты недели</div>' +
    barList(funnelSteps(funnel), funnel.joined) +
    (funnel.goals && funnel.goals.answered ? '<div class="small muted">🎯 Цели: для жизни ' + num(funnel.goals.live) + ", инвестиция и аренда " + num(funnel.goals.invest) + ", пока смотрят " + num(funnel.goals.browse) + (funnel.goals.mostlyBrowsing ? ' — <b>большинство «пока смотрит»: деление по целям почти не помогает</b>' : "") + "</div>" : "") +
    (tracked && funnel.partial ? '<div class="small muted">Каталог и «Подробнее» бот считает с ' + esc(funnel.trackedFrom) + ": у клиентов, пришедших раньше, эти цифры неполные.</div>" : "") +
    (!tracked ? '<div class="small muted">Открытия каталога и «Подробнее» бот начнёт считать после этого обновления — пока в воронке только то, что видно по заявкам.</div>' : "") +
    '<div class="grid cols-2">' +
      funnelTable("По языкам", funnel.byLanguage || [], tracked, function (key) { return languageName[key] || key; }) +
      funnelTable("По меткам ссылок", funnel.bySource || [], tracked, function (key) { return key; }) +
    "</div></div>";
}

function weeklyCard(payload) {
  var report = payload.report;
  var comparedWith = report.which === "current" ? "с тем же отрезком прошлой недели" : "с позапрошлой неделей";
  return '<div class="card gap-bottom"><header><h3>Неделя ' + esc(report.label) + '</h3><div class="actions">' +
      '<div class="tabs" id="weekScope"><button type="button" data-week="last" class="' + (report.which === "last" ? "active" : "") + '">Прошлая</button>' +
      '<button type="button" data-week="current" class="' + (report.which === "current" ? "active" : "") + '">Эта, пока идёт</button></div>' +
      '<button class="btn secondary small" id="weekCopy" type="button" title="Тот же текст, что бот присылает в Telegram по понедельникам">Скопировать текстом</button></div></header>' +
    '<div class="card-body stack">' +
      '<div class="week-grid">' +
        weekTile("Новых клиентов", report.users.count, weekTrend(report.users.count, report.users.previous)) +
        weekTile("Заявок", report.inquiries.count, weekTrend(report.inquiries.count, report.inquiries.previous)) +
        weekTile("Записались на просмотр", report.viewings.booked, '<span class="week-trend">прошло ' + num(report.viewings.held) + "</span>") +
        weekTile("Сделок", report.deals.count, weekTrend(report.deals.count, report.deals.previous)) +
        weekTile("Без ответа сейчас", report.waiting, report.waiting ? '<span class="week-trend down">ждут ответа</span>' : '<span class="week-trend up">все отвечены</span>') +
      "</div>" +
      '<div class="small muted">Сравнение — ' + comparedWith + '.</div>' +
      (report.inquiries.byType.length ? '<div class="row wrap">' + report.inquiries.byType.map(function (row) { return '<span class="chip">' + esc(row[0]) + " — " + num(row[1]) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="grid cols-2">' +
        '<div><div class="week-subtitle">Откуда пришли новые клиенты</div>' + barList(report.sources, report.users.count) + "</div>" +
        '<div><div class="week-subtitle">Больше всего заявок</div>' + (report.topProperties.length ? '<div class="list">' + report.topProperties.map(function (row) {
          return '<div class="list-item"><span class="grow">' + esc(row.name) + "</span><b>" + num(row.count) + "</b></div>";
        }).join("") + "</div>" : '<div class="empty"><b>Заявок по объектам не было</b></div>') + "</div>" +
      "</div>" +
      funnelBlock(report.funnel) +
      (report.broadcasts.count ? '<div class="small muted">' + iconSpan("mail") + ' Рассылок: ' + num(report.broadcasts.count) + ", получили " + num(report.broadcasts.sent) + ", откликнулись " + num(report.broadcasts.responded) + "</div>" : "") +
    "</div></div>";
}

async function loadWeekly(host) {
  var box = host.querySelector("#weeklyReport");
  if (!box) return;
  try {
    var payload = await api("/api/weekly-report?week=" + encodeURIComponent(reportWeek));
    box.innerHTML = weeklyCard(payload);
    box.querySelectorAll("#weekScope [data-week]").forEach(function (button) {
      button.onclick = function () { reportWeek = button.dataset.week; loadWeekly(host); };
    });
    var copy = box.querySelector("#weekCopy");
    if (copy) copy.onclick = function () {
      navigator.clipboard.writeText(payload.text).then(function () { toast("Скопировано"); });
    };
  } catch (error) {
    box.innerHTML = '<div class="card gap-bottom"><div class="empty"><b>Не удалось загрузить неделю</b>' + esc(error && error.message || "") + "</div></div>";
  }
}

// Строка недели на «Сегодня»: главное числами и ссылка в «Отчёт».
function weekLineHtml(payload) {
  var report = payload.report;
  return '<span class="week-line-text"><b>Неделя ' + esc(report.label) + (report.which === "current" ? " (идёт)" : "") + ':</b> ' +
    num(report.users.count) + " " + plural(report.users.count, "новый клиент", "новых клиента", "новых клиентов") + " · " +
    num(report.inquiries.count) + " " + plural(report.inquiries.count, "заявка", "заявки", "заявок") + " · " +
    num(report.deals.count) + " " + plural(report.deals.count, "сделка", "сделки", "сделок") + "</span>" +
    '<button class="btn ghost small" type="button" data-go="reports">Открыть отчёт →</button>';
}

async function loadWeekLine(host) {
  var box = host.querySelector("#weekLine");
  if (!box) return;
  try {
    box.innerHTML = weekLineHtml(await api("/api/weekly-report?week=current"));
    box.querySelectorAll("[data-go]").forEach(function (node) {
      node.onclick = function () { go(node.dataset.go, node.dataset.tab || ""); };
    });
  } catch (error) {
    // Строка — подсказка: не вышло, «Сегодня» остаётся как было.
  }
}

// Итоги недели и цифры за 30 дней — отдельный пункт меню «Отчёт».
VIEWS.reports = {
  render: function (host) {
    var days = lastDays(30);
    // Заявки считаем по самому списку заявок и в одном окне — 30 дней: и плитка,
    // и «по типам», и подпись под графиком. Раньше плитка брала суточный счётчик
    // аналитики, а «по типам» — всё время, и числа не сходились.
    var monthStart = Date.now() - 30 * 864e5;
    var monthInquiries = inquiriesInRange(monthStart);
    var inquiries = state.inquiries || [];
    var inquiryUsers = new Set(inquiries.map(function (item) { return String(item.userId || ""); }).filter(Boolean)).size;
    var week = startOfWeek();
    var byType = {};
    monthInquiries.forEach(function (item) { byType[inquiryTypeName(item)] = (byType[inquiryTypeName(item)] || 0) + 1; });
    var typeRows = Object.keys(byType).map(function (name) { return [name, byType[name]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var properties = (state.objects || []).map(function (record) {
      var stats = (state.analytics && state.analytics.properties && state.analytics.properties[record.id]) || {};
      return { id: record.id, title: localized(record.title, "ru") || record.reference || record.id, views: Number(stats.impressions || stats.views || 0), details: Number(stats.details || 0), inquiries: catalogPropertyStats(record).inquiries };
    }).sort(function (a, b) { return b.views - a.views; });
    var counts = state.languageCounts || {};
    var languages = { ru: counts.ru, en: counts.en, es: counts.es, unknown: counts.unknown };
    var campaigns = (state.broadcasts || []).filter(function (entry) { return entry.sent; });

    host.innerHTML =
      '<div id="weeklyReport"><div class="card gap-bottom"><div class="empty"><b>Загрузка…</b></div></div></div>' +
      sourceTableCard() +
      '<details class="card gap-bottom report-more"><summary>Подробнее: 30 дней, источники, языки, рассылки, объекты</summary><div class="card-body">' +
      numberStrip([
        ["Всего клиентов", num(state.userCount), "", "+" + usersInRange(week) + " за 7 дней"],
        ["Сообщений за 30 дней", num(sumDays(days, "received"))],
        ["Заявок за 30 дней", num(monthInquiries.length)],
        ["Конверсия в заявку", (state.userCount ? Math.round((inquiryUsers / state.userCount) * 100) : 0) + "% (" + inquiryUsers + " из " + state.userCount + " клиентов в базе)", "", "Какая доля клиентов в базе хоть раз оставила заявку"],
      ]) +
      '<div class="card gap-bottom"><header><h3>Активность за 30 дней</h3></header><div class="card-body">' +
        sparkline(days, "received", "var(--brand)") +
        '<div class="legend"><span><i class="brand-dot"></i>Столбики — сообщения от клиентов за день</span><span>Всего за 30 дней: <b>' + num(sumDays(days, "received")) + '</b> сообщений</span><span>Заявок: <b>' + num(monthInquiries.length) + '</b></span><span>Новых клиентов: <b>' + num(usersInRange(monthStart)) + "</b></span></div>" +
      "</div></div>" +
      '<div class="grid cols-2 gap-bottom">' +
        '<div class="card"><header><h3>Заявки по типам, 30 дней</h3></header>' + barList(typeRows, monthInquiries.length) + "</div>" +
      "</div>" +
      '<div class="grid cols-2 gap-bottom">' +
        '<div class="card"><header><h3>Языки клиентов</h3></header>' + barList(Object.keys(languages).filter(function (code) { return languages[code]; }).map(function (code) {
          return [{ ru: "Русский", en: "English", es: "Español", unknown: "Язык не выбран" }[code] || code, languages[code]];
        }), counts.all) + "</div>" +
        '<div class="card"><header><h3>Рассылки</h3></header>' +
          (campaigns.length ? '<div class="table-wrap"><table class="table-stack"><thead><tr><th>Дата</th><th>Отправлено</th><th>Отклики</th><th>Отписки</th></tr></thead><tbody>' +
            campaigns.slice(0, 8).map(function (entry) {
              return "<tr><td>" + dateShort(entry.startedAt) + "</td><td>" + num(entry.sent) + "</td><td>" + num(entry.responses) + "</td><td>" + num(entry.unsubscribes) + "</td></tr>";
            }).join("") + "</tbody></table></div>" : '<div class="empty"><b>Рассылок ещё не было</b></div>') +
        "</div>" +
      "</div>" +
      '<div class="card gap-bottom"><header><h3>Реакции клиентов</h3><div class="actions"><span class="small muted">всего ' + num((state.stats || {}).reactionsReceived) + "</span></div></header>" +
        (recentReactions().length ? '<div class="list">' + recentReactions().map(function (event) {
          return '<div class="list-item"><span class="avatar">' + esc(initials(event.user.firstName)) + '</span><span class="grow"><b>' + esc(userName(event.user)) + "</b> " + esc(event.item.text || "") + "</span>" +
            '<span class="small muted">' + ago(event.item.createdAt) + "</span></div>";
        }).join("") + "</div>" : '<div class="empty"><b>Реакций пока нет</b>Клиенты ещё не ставили реакции на сообщения бота</div>') +
      "</div>" +
      '<div class="card"><header><h3>Эффективность объектов</h3><div class="actions"><span class="small muted">видели в каталоге · открыли карточку · заявки</span></div></header>' +
        (properties.length ? '<div class="table-wrap"><table class="table-stack"><thead><tr><th>Объект</th><th class="right" title="Сколько раз объект показался клиенту в каталоге бота">Видели в каталоге</th><th class="right" title="Сколько раз открыли его карточку">Открыли карточку</th><th class="right">Заявки</th><th class="right" title="Какая доля увидевших открыла карточку">Доля открывших</th></tr></thead><tbody>' +
          properties.map(function (row) {
            var rate = row.views ? Math.round((row.details / row.views) * 100) : 0;
            return '<tr class="clickable" data-property-insights="' + esc(row.id) + '"><td><b>' + esc(row.title) + '</b><br><span class="small muted">открыть клиентов и действия</span></td><td class="right">' + num(row.views) + '</td><td class="right">' + num(row.details) + '</td><td class="right">' + num(row.inquiries) + '</td><td class="right">' + rate + '%</td></tr>';
          }).join("") + "</tbody></table></div>" : '<div class="empty"><b>Объектов пока нет</b></div>') +
      "</div></div></details>";
    loadWeekly(host);
    bindSourceLink(host);
    host.querySelectorAll("[data-property-insights]").forEach(function (row) { row.onclick = function () { openObjectInsights(row.dataset.propertyInsights); }; });
  },
};
`;

export { OVERVIEW_JS };
