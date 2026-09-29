// Обзор: состояние бота, цифры за сегодня и неделю, что требует внимания,
// последние заявки. И раздел «Статистика» — вся аналитика в одном месте.

const OVERVIEW_JS = String.raw`
function dayKeyOf(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
function lastDays(count) {
  var days = [];
  for (var index = count - 1; index >= 0; index -= 1) {
    var date = new Date();
    date.setDate(date.getDate() - index);
    days.push(dayKeyOf(date));
  }
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
function startOfToday() { var date = new Date(); date.setHours(0, 0, 0, 0); return date.getTime(); }
function startOfWeek() { var date = new Date(); date.setDate(date.getDate() - 6); date.setHours(0, 0, 0, 0); return date.getTime(); }

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
    return '<span' + (item[3] ? ' title="' + esc(item[3]) + '"' : '') + '>' + esc(item[0]) + ': <b' + (item[2] === "bad" ? ' class="bad"' : '') + '>' + item[1] + '</b></span>';
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
  return { message: "✉", task: "⏱", viewing: "📅", catalog: "⌂", group: "👥", broadcast: "➤", error: "!", system: "⚙" }[item.kind] || "•";
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
  var names = [state.config.adminName || "Администратор"].concat((state.config.managers || []).map(function (manager) { return manager.name; })).filter(Boolean);
  return names.filter(function (name, index) { return names.indexOf(name) === index; });
}
function deedAssignee(item) {
  var id = item.route && item.route.inquiryId;
  var inquiry = id ? (state.inquiries || []).find(function (entry) { return entry.id === id; }) : null;
  return inquiry ? inquiry.assignee || "" : null;
}
// Дела для «Мои»: клиент закреплён за выбранным человеком. Что клиентов не
// касается (ошибки, каталог, рассылки) или ещё ничьё — только в «Все».
function scopedDeeds(deeds) {
  var people = todayPeople();
  if (people.length < 2) return { shown: deeds, hidden: 0, active: false };
  if (people.indexOf(todayScope.me) < 0) todayScope.me = people[0];
  if (!todayScope.mine) return { shown: deeds, hidden: 0, active: false };
  var shown = deeds.filter(function (item) { return deedAssignee(item) === todayScope.me; });
  return { shown: shown, hidden: deeds.length - shown.length, active: true };
}

// Сначала то, что горит, потом по времени: свежее сверху.
function deedList() {
  var rank = { bad: 0, warn: 1 };
  return (state.notifications || [])
    .filter(function (item) { return item.active && !item.handledAt; })
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
  return openNotification(item, button);
}

VIEWS.today = {
  subtitle: function () { return "Что нужно сделать прямо сейчас"; },
  render: function (host) {
    var today = startOfToday(), week = startOfWeek();
    var waiting = waitingClients();
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
        '<span><b>' + num(waiting) + '</b> ' + plural(waiting, "клиент ждёт", "клиента ждут", "клиентов ждут") + ' ответа</span>' +
        '<span><b>' + num(unconfirmed) + '</b> ' + plural(unconfirmed, "просмотр", "просмотра", "просмотров") + ' без подтверждения</span>' +
        '<span><b>' + num(inquiriesInRange(week).length) + '</b> ' + plural(inquiriesInRange(week).length, "заявка", "заявки", "заявок") + ' за 7 дней · ' + num(inquiriesInRange(today).length) + ' сегодня</span>' +
        '<span><b>' + num(state.userCount) + '</b> ' + plural(state.userCount, "клиент", "клиента", "клиентов") + ' в базе · +' + usersInRange(week) + ' за неделю</span>' +
      '</div>' +
      '<div class="split">' +
        '<div class="stack">' +
          '<div class="card"><header><h3>Список дел</h3><div class="actions">' +
            (deeds.length ? '<span class="chip ' + (deeds.some(function (item) { return item.severity === "bad"; }) ? "bad" : "warn") + '">' + num(deeds.length) + '</span>' : '') +
            '<button class="btn ghost small" type="button" data-go="notifications">Все события</button></div></header>' +
            (people.length > 1 ? '<div class="deeds-scope row wrap"><div class="tabs" id="deedScope"><button type="button" data-scope="all" class="' + (todayScope.mine ? "" : "active") + '">Все</button><button type="button" data-scope="mine" class="' + (todayScope.mine ? "active" : "") + '">Мои</button></div>' +
              '<label class="small muted" for="deedMe">Я —</label><select id="deedMe" style="width:auto;min-width:0">' + people.map(function (name) { return '<option value="' + esc(name) + '"' + (name === todayScope.me ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("") + "</select>" +
              (scoped.active && scoped.hidden ? '<span class="small faint">Ещё ' + num(scoped.hidden) + ' — чужие, без менеджера или не про клиентов: они в «Все»</span>' : "") + "</div>" : "") +
            (deeds.length ? '<div class="deeds">' + deeds.map(function (item) {
              return '<div class="deed' + (item.severity === "bad" ? " urgent" : "") + '">' +
                '<span class="deed-icon">' + deedIcon(item) + '</span>' +
                '<span class="deed-body"><b>' + esc(item.title) + '</b><span>' + esc(item.text) + '</span></span>' +
                '<span class="deed-actions"><button class="btn small" type="button" data-deed="' + esc(item.id) + '">' + esc(deedAction(item)) + '</button>' +
                '<button class="btn ghost small" type="button" data-deed-hide="' + esc(item.id) + '" title="Убрать из списка дел">Скрыть</button></span>' +
              '</div>';
            }).join("") + '</div>' : '<div class="empty"><b>' + (scoped.active ? "Своих дел нет" : "Дел нет") + '</b>' + (scoped.active ? "За вами закреплённых дел сейчас нет" : "Все клиенты отвечены, просмотры подтверждены") + '</div>') +
          "</div>" +
          '<div class="card"><header><h3>Сообщения и заявки, 7 дней</h3></header><div class="card-body">' +
            sparkline(weekDays, "received", "var(--brand)") +
            '<div class="legend"><span><i class="brand-dot"></i>Столбики — сообщения от клиентов за день</span><span>Всего за 7 дней: <b>' + num(sumDays(weekDays, "received")) + '</b> сообщений, <b>' + num(inquiriesInRange(week).length) + '</b> ' + plural(inquiriesInRange(week).length, "заявка", "заявки", "заявок") + "</span></div>" +
          "</div></div>" +
        "</div>" +
        '<div class="stack">' +
          '<div class="card"><header><h3>Состояние бота</h3></header><div class="card-body stack">' +
            '<label class="switch"><input type="checkbox" id="botActive"' + (state.config.active ? " checked" : "") + '><span class="track"></span><span>' + (state.config.active ? "Бот включён" : "Бот выключен") + "</span></label>" +
            '<div class="small muted">Связь: ' + esc(connectionText()) + "</div>" +
            '<div class="small muted">Клиентов в базе: ' + num(state.userCount) + " · им можно писать: " + num(state.activeUserCount) + "</div>" +
            '<div class="row wrap"><button class="btn secondary small" type="button" data-go="settings" data-tab="team">Настройки</button>' +
            '<button class="btn secondary small" type="button" data-go="settings" data-tab="reports">Отчёты</button></div>' +
          "</div></div>" +
          '<div class="card"><header><h3>Быстрые действия</h3></header><div class="card-body row wrap">' +
            '<button class="btn secondary small" type="button" id="quickObject">Добавить объект</button>' +
            '<button class="btn secondary small" type="button" id="quickBroadcast">Создать рассылку</button>' +
            '<button class="btn secondary small" type="button" data-go="posts" data-tab="channel">Написать в канал</button>' +
          "</div></div>" +
        "</div>" +
      "</div>";

    host.querySelectorAll("[data-go]").forEach(function (node) {
      node.onclick = function () { go(node.dataset.go, node.dataset.tab || ""); };
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
    var quickObject = host.querySelector("#quickObject");
    if (quickObject) quickObject.onclick = async function () {
      if (await go("objects", "list")) openRecordEditor("objects", null);
    };
    var quickBroadcast = host.querySelector("#quickBroadcast");
    if (quickBroadcast) quickBroadcast.onclick = async function () {
      if (await go("posts", "broadcast")) openCampaignEditor(null);
    };
    var toggle = host.querySelector("#botActive");
    if (toggle) toggle.onchange = async function () {
      // Выключение останавливает бота для всех клиентов: спрашиваем. Включение
      // ничего не ломает, поэтому проходит сразу.
      if (!toggle.checked && !(await confirmDialog(
        "Выключить бота?",
        "Клиенты перестанут получать ответы: меню, каталог и заявки работать не будут.",
        "Выключить", true))) {
        toggle.checked = true;
        return;
      }
      try {
        await send("/api/settings", "PUT", Object.assign(settingsPayload(), { active: toggle.checked }));
        toast(toggle.checked ? "Бот включён" : "Бот выключен");
        await reload();
      } catch (error) { fail(error); toggle.checked = !toggle.checked; }
    };
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
  return { lead: "заявка на звонок", viewing: "запись на просмотр", selection: "подбор", question: "вопрос по объекту", interest: "интерес к объекту", general: "сообщение" }[item.type] || "сообщение";
}

function barList(rows, total) {
  if (!rows.length) return '<div class="empty">Пока нет данных</div>';
  var top = Math.max.apply(null, rows.map(function (row) { return row[1]; }).concat([1]));
  return '<div class="card-body">' + rows.map(function (row) {
    return '<div class="bar-row"><span>' + esc(row[0]) + '<div class="bar"><span style="width:' + Math.round((row[1] / top) * 100) + '%"></span></div></span><b class="right">' + num(row[1]) + (total ? " <span class=\"faint small\">" + Math.round((row[1] / total) * 100) + "%</span>" : "") + "</b></div>";
  }).join("") + "</div>";
}

function sourceLinkCard() {
  var username = (state.bot || {}).username || "";
  return '<div class="card"><header><h3>Ссылки с меткой источника</h3></header><div class="card-body stack">' +
    '<p class="muted small">Разместите такую ссылку в рекламе или соцсетях — в карточке клиента, уведомлениях и выгрузке будет видно, откуда он пришёл.</p>' +
    '<div class="row"><input id="sourceLabel" placeholder="instagram" class="field-md"><button class="btn secondary small" id="makeSourceLink" type="button">Собрать ссылку</button></div>' +
    '<div class="row"><input id="sourceLink" readonly value="' + (username ? esc("https://t.me/" + username + "?start=src_метка") : "Сначала подключите бота") + '"><button class="btn ghost small" id="copySourceLink" type="button">Копировать</button></div>' +
  "</div></div>";
}

function bindSourceLink(host) {
  var username = (state.bot || {}).username || "";
  var make = host.querySelector("#makeSourceLink");
  if (!make) return;
  make.onclick = function () {
    var label = (host.querySelector("#sourceLabel").value || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    host.querySelector("#sourceLabel").value = label;
    host.querySelector("#sourceLink").value = username && label ? "https://t.me/" + username + "?start=src_" + label : "Укажите метку латиницей";
  };
  host.querySelector("#copySourceLink").onclick = function () {
    navigator.clipboard.writeText(host.querySelector("#sourceLink").value).then(function () { toast("Скопировано"); });
  };
}

function recentReactions() {
  var events = [];
  (state.users || []).forEach(function (user) {
    (user.activity || []).forEach(function (item) { if (item.kind === "reaction") events.push({ user: user, item: item }); });
  });
  return events.sort(function (a, b) { return (Date.parse(b.item.createdAt) || 0) - (Date.parse(a.item.createdAt) || 0); }).slice(0, 10);
}

// «Отчёты» живут в настройках: это не ежедневная работа.
VIEWS.reports = {
  subtitle: function () { return "Аудитория, заявки, объекты и рассылки"; },
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
    var sources = (state.sources || []).map(function (item) { return [item.source || "без метки", item.users || 0]; }).sort(function (a, b) { return b[1] - a[1]; });
    var properties = (state.objects || []).map(function (record) {
      var stats = (state.analytics && state.analytics.properties && state.analytics.properties[record.id]) || {};
      return { id: record.id, title: localized(record.title, "ru") || record.reference || record.id, views: Number(stats.impressions || stats.views || 0), details: Number(stats.details || 0), inquiries: catalogPropertyStats(record).inquiries };
    }).sort(function (a, b) { return b.views - a.views; });
    var counts = state.languageCounts || {};
    var languages = { ru: counts.ru, en: counts.en, es: counts.es, unknown: counts.unknown };
    var campaigns = (state.broadcasts || []).filter(function (entry) { return entry.sent; });

    host.innerHTML =
      numberStrip([
        ["Всего клиентов", num(state.userCount), "", "+" + usersInRange(week) + " за 7 дней"],
        ["Сообщений за 30 дней", num(sumDays(days, "received"))],
        ["Заявок за 30 дней", num(monthInquiries.length)],
        ["Конверсия в заявку", (state.userCount ? Math.round((inquiryUsers / state.userCount) * 100) : 0) + "%", "", "клиенты, оставившие заявку"],
      ]) +
      '<div class="card gap-bottom"><header><h3>Активность за 30 дней</h3></header><div class="card-body">' +
        sparkline(days, "received", "var(--brand)") +
        '<div class="legend"><span><i class="brand-dot"></i>Столбики — сообщения от клиентов за день</span><span>Всего за 30 дней: <b>' + num(sumDays(days, "received")) + '</b> сообщений</span><span>Заявок: <b>' + num(monthInquiries.length) + '</b></span><span>Новых клиентов: <b>' + num(usersInRange(monthStart)) + "</b></span></div>" +
      "</div></div>" +
      '<div class="grid cols-2 gap-bottom">' +
        '<div class="card"><header><h3>Заявки по типам, 30 дней</h3></header>' + barList(typeRows, monthInquiries.length) + "</div>" +
        '<div class="card"><header><h3>Откуда приходят клиенты</h3></header>' + barList(sources, state.userCount) + "</div>" +
      "</div>" +
      '<div class="grid cols-2 gap-bottom">' +
        sourceLinkCard() +
        '<div class="card"><header><h3>Языки клиентов</h3></header>' + barList(Object.keys(languages).filter(function (code) { return languages[code]; }).map(function (code) {
          return [{ ru: "Русский", en: "English", es: "Español", unknown: "Язык не выбран" }[code] || code, languages[code]];
        }), counts.all) + "</div>" +
        '<div class="card"><header><h3>Рассылки</h3></header>' +
          (campaigns.length ? '<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Отправлено</th><th>Отклики</th><th>Отписки</th></tr></thead><tbody>' +
            campaigns.slice(0, 8).map(function (entry) {
              return "<tr><td>" + dateShort(entry.startedAt) + "</td><td>" + num(entry.sent) + "</td><td>" + num(entry.responses) + "</td><td>" + num(entry.unsubscribes) + "</td></tr>";
            }).join("") + "</tbody></table></div>" : '<div class="empty">Рассылок ещё не было</div>') +
        "</div>" +
      "</div>" +
      '<div class="card gap-bottom"><header><h3>Реакции клиентов</h3><div class="actions"><span class="small faint">всего ' + num((state.stats || {}).reactionsReceived) + "</span></div></header>" +
        (recentReactions().length ? '<div class="list">' + recentReactions().map(function (event) {
          return '<div class="list-item"><span class="avatar">' + esc(initials(event.user.firstName)) + '</span><span class="grow"><b>' + esc(userName(event.user)) + "</b> " + esc(event.item.text || "") + "</span>" +
            '<span class="small faint">' + ago(event.item.createdAt) + "</span></div>";
        }).join("") + "</div>" : '<div class="empty">Клиенты ещё не ставили реакции на сообщения бота</div>') +
      "</div>" +
      '<div class="card"><header><h3>Эффективность объектов</h3><div class="actions"><span class="small faint">видели в каталоге · открыли карточку · заявки</span></div></header>' +
        (properties.length ? '<div class="table-wrap"><table><thead><tr><th>Объект</th><th class="right">Показы</th><th class="right">Подробнее</th><th class="right">Заявки</th><th class="right" title="Какая доля показов закончилась открытой карточкой">Открыли карточку</th></tr></thead><tbody>' +
          properties.map(function (row) {
            var rate = row.views ? Math.round((row.details / row.views) * 100) : 0;
            return '<tr class="clickable" data-property-insights="' + esc(row.id) + '"><td><b>' + esc(row.title) + '</b><br><span class="small faint">открыть клиентов и действия</span></td><td class="right">' + num(row.views) + '</td><td class="right">' + num(row.details) + '</td><td class="right">' + num(row.inquiries) + '</td><td class="right">' + rate + '%</td></tr>';
          }).join("") + "</tbody></table></div>" : '<div class="empty">Объектов пока нет</div>') +
      "</div>";
    bindSourceLink(host);
    host.querySelectorAll("[data-property-insights]").forEach(function (row) { row.onclick = function () { openObjectInsights(row.dataset.propertyInsights); }; });
  },
};
`;

export { OVERVIEW_JS };
