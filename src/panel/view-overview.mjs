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
function kpiCard(label, value, note, noteKind) {
  return '<div class="card kpi"><span class="label">' + esc(label) + '</span><span class="value">' + value + '</span>' +
    (note ? '<span class="delta ' + (noteKind || "") + '">' + note + "</span>" : "") + "</div>";
}

// Что требует внимания — один список на всю панель: его собирает бот
// (admin-notifications.mjs), тот же список показывают колокольчик и Центр
// уведомлений. Раньше Обзор считал своё в браузере, и на одном экране
// оказывались разные числа и разные поводы.
function attentionItems() {
  return (state.notifications || [])
    .filter(function (item) { return item.active && !item.handledAt; })
    .slice(0, 8);
}

function sparkline(days, field, color) {
  var values = days.map(function (key) { return dailyValue(key, field); });
  var top = Math.max.apply(null, values.concat([1]));
  // Пустой график выглядит как поломка, поэтому вместо него — строка текста.
  if (!values.some(Boolean)) return '<div class="muted small">За этот период сообщений не было.</div>';
  return '<div class="spark">' + values.map(function (value, index) {
    return '<div title="' + esc(days[index].slice(5) + ": " + value) + '"><i style="height:' + Math.round((value / top) * 100) + "%;background:" + color + '"></i></div>';
  }).join("") + "</div>";
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
    var weekDays = lastDays(14);
    var deeds = deedList();
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
            (deeds.length ? '<div class="deeds">' + deeds.map(function (item) {
              return '<div class="deed' + (item.severity === "bad" ? " urgent" : "") + '">' +
                '<span class="deed-icon">' + deedIcon(item) + '</span>' +
                '<span class="deed-body"><b>' + esc(item.title) + '</b><span>' + esc(item.text) + '</span></span>' +
                '<span class="deed-actions"><button class="btn small" type="button" data-deed="' + esc(item.id) + '">' + esc(deedAction(item)) + '</button>' +
                '<button class="btn ghost small" type="button" data-deed-hide="' + esc(item.id) + '" title="Убрать из списка дел">Скрыть</button></span>' +
              '</div>';
            }).join("") + '</div>' : '<div class="empty"><b>Дел нет</b>Все клиенты отвечены, просмотры подтверждены</div>') +
          "</div>" +
          '<div class="card"><header><h3>Сообщения и заявки, 14 дней</h3></header><div class="card-body">' +
            sparkline(weekDays, "received", "var(--brand)") +
            '<div class="legend"><span><i style="background:var(--brand)"></i>сообщения от клиентов</span><span>' + num(sumDays(weekDays, "received")) + " за 14 дней · " + num(sumDays(weekDays, "inquiries")) + " заявок</span></div>" +
          "</div></div>" +
        "</div>" +
        '<div class="stack">' +
          '<div class="card"><header><h3>Состояние бота</h3></header><div class="card-body stack">' +
            '<label class="switch"><input type="checkbox" id="botActive"' + (state.config.active ? " checked" : "") + '><span class="track"></span><span>' + (state.config.active ? "Бот включён" : "Бот выключен") + "</span></label>" +
            '<div class="small muted">Связь: ' + esc(connectionText()) + "</div>" +
            '<div class="small muted">Клиентов в базе: ' + num(state.userCount) + " · активных: " + num(state.activeUserCount) + "</div>" +
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
    host.querySelectorAll("[data-deed]").forEach(function (button) {
      button.onclick = function () {
        var item = (state.notifications || []).find(function (entry) { return entry.id === button.dataset.deed; });
        if (item) runDeed(item, button);
      };
    });
    host.querySelectorAll("[data-deed-hide]").forEach(function (button) {
      button.onclick = function () {
        var item = (state.notifications || []).find(function (entry) { return entry.id === button.dataset.deedHide; });
        if (item) changeNotification(item, "handled", button);
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
    '<div class="row"><input id="sourceLabel" placeholder="instagram" style="max-width:200px"><button class="btn secondary small" id="makeSourceLink" type="button">Собрать ссылку</button></div>' +
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
    var inquiries = state.inquiries || [];
    var inquiryUsers = new Set(inquiries.map(function (item) { return String(item.userId || ""); }).filter(Boolean)).size;
    var week = startOfWeek();
    var byType = {};
    inquiries.forEach(function (item) { byType[inquiryTypeName(item)] = (byType[inquiryTypeName(item)] || 0) + 1; });
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
      '<div class="grid cols-4" style="margin-bottom:12px">' +
        kpiCard("Всего клиентов", num(state.userCount), "+" + usersInRange(week) + " за 7 дней") +
        kpiCard("Сообщений за 30 дней", num(sumDays(days, "received"))) +
        kpiCard("Заявок за 30 дней", num(sumDays(days, "inquiries"))) +
        kpiCard("Конверсия в заявку", (state.userCount ? Math.round((inquiryUsers / state.userCount) * 100) : 0) + "%", "клиенты, оставившие заявку") +
      "</div>" +
      '<div class="card" style="margin-bottom:12px"><header><h3>Активность за 30 дней</h3></header><div class="card-body">' +
        sparkline(days, "received", "var(--brand)") +
        '<div class="legend"><span><i style="background:var(--brand)"></i>сообщения</span><span>заявок: ' + num(sumDays(days, "inquiries")) + " · новых клиентов: " + num(usersInRange(Date.now() - 30 * 864e5)) + "</span></div>" +
      "</div></div>" +
      '<div class="grid cols-2" style="margin-bottom:12px">' +
        '<div class="card"><header><h3>Заявки по типам</h3></header>' + barList(typeRows, inquiries.length) + "</div>" +
        '<div class="card"><header><h3>Откуда приходят клиенты</h3></header>' + barList(sources, state.userCount) + "</div>" +
      "</div>" +
      '<div class="grid cols-2" style="margin-bottom:12px">' +
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
      '<div class="card" style="margin-bottom:12px"><header><h3>Реакции клиентов</h3><div class="actions"><span class="small faint">всего ' + num((state.stats || {}).reactionsReceived) + "</span></div></header>" +
        (recentReactions().length ? '<div class="list">' + recentReactions().map(function (event) {
          return '<div class="list-item"><span class="avatar">' + esc(initials(event.user.firstName)) + '</span><span class="grow"><b>' + esc(userName(event.user)) + "</b> " + esc(event.item.text || "") + "</span>" +
            '<span class="small faint">' + ago(event.item.createdAt) + "</span></div>";
        }).join("") + "</div>" : '<div class="empty">Клиенты ещё не ставили реакции на сообщения бота</div>') +
      "</div>" +
      '<div class="card"><header><h3>Эффективность объектов</h3><div class="actions"><span class="small faint">видели в каталоге · открыли карточку · заявки</span></div></header>' +
        (properties.length ? '<div class="table-wrap"><table><thead><tr><th>Объект</th><th class="right">Показы</th><th class="right">Подробнее</th><th class="right">Заявки</th><th class="right">Интерес</th></tr></thead><tbody>' +
          properties.map(function (row) {
            var rate = row.views ? Math.round((row.inquiries / row.views) * 100) : 0;
            return '<tr class="clickable" data-property-insights="' + esc(row.id) + '"><td><b>' + esc(row.title) + '</b><br><span class="small faint">открыть клиентов и действия</span></td><td class="right">' + num(row.views) + '</td><td class="right">' + num(row.details) + '</td><td class="right">' + num(row.inquiries) + '</td><td class="right">' + rate + '%</td></tr>';
          }).join("") + "</tbody></table></div>" : '<div class="empty">Объектов пока нет</div>') +
      "</div>";
    bindSourceLink(host);
    host.querySelectorAll("[data-property-insights]").forEach(function (row) { row.onclick = function () { openObjectInsights(row.dataset.propertyInsights); }; });
  },
};
`;

export { OVERVIEW_JS };
