// Обзор: состояние бота, цифры за сегодня и неделю, что требует внимания,
// последние обращения. И раздел «Статистика» — вся аналитика в одном месте.

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

// Что требует внимания: только то, с чем администратор может что-то сделать.
function attentionItems() {
  var items = [];
  var waiting = (state.inquiries || []).filter(awaitsReply);
  if (waiting.length) items.push({ what: counted(waiting.length, "обращение ждёт", "обращения ждут", "обращений ждут") + " ответа", why: "Самое давнее — " + ago(waiting[waiting.length - 1].clientMessageAt || waiting[waiting.length - 1].createdAt), go: ["inquiries", "inbox"], kind: "bad" });
  var dueContacts = (state.inquiries || []).filter(function (item) { return item.status !== "closed" && item.followUpDate && item.followUpDate <= pipelineToday(); });
  if (dueContacts.length) items.push({ what: counted(dueContacts.length, "контакт запланирован", "контакта запланированы", "контактов запланированы") + " на сегодня или раньше", why: "Откройте рабочий список менеджера", go: ["inquiries", "tasks"], kind: "bad" });
  var unconfirmed = unconfirmedViewings();
  if (unconfirmed.length) items.push({ what: counted(unconfirmed.length, "просмотр", "просмотра", "просмотров") + " без подтверждения", why: "Клиент ждёт дату и время", go: ["inquiries", "viewings"], kind: "warn" });
  if (!state.config.active) items.push({ what: "Бот выключен", why: "Клиенты не получают ответов", go: ["settings", "connection"], kind: "bad" });
  if (state.config.active && !state.config.adminNotificationVerifiedAt) items.push({ what: "Админ-чат не проверен", why: "Уведомления о заявках могут не приходить", go: ["settings", "connection"], kind: "warn" });
  var hidden = (state.objects || []).filter(function (record) { return record.status !== "active"; }).length;
  var activeRecords = (state.objects || []).filter(function (record) { return record.status === "active"; });
  var active = activeRecords.length;
  if (!active) items.push({ what: "В каталоге нет активных объектов", why: hidden ? counted(hidden, "объект скрыт", "объекта скрыто", "объектов скрыто") : "Добавьте первый объект", go: ["catalog", "objects"], kind: "warn" });
  // Активный объект ещё не значит видимый: без обязательных полей карточка
  // не попадает в каталог, и клиент видит пустоту.
  if (active) {
    var invisible = activeRecords.filter(function (record) {
      var issues = record.publicationIssues || {};
      return ["ru", "en", "es"].every(function (language) { return (issues[language] || []).length > 0; });
    });
    if (invisible.length >= active) {
      items.push({ what: "Клиенты не видят ни одного объекта", why: "В карточках не хватает обязательных полей — каталог у клиента пустой", go: ["catalog", "objects"], kind: "bad" });
    } else if (invisible.length) {
      items.push({ what: counted(invisible.length, "объект не показывается", "объекта не показываются", "объектов не показываются") + " клиентам", why: "В карточках не хватает обязательных полей", go: ["catalog", "objects"], kind: "warn" });
    }
  }
  var errors = (state.errors || []).length;
  if (errors) items.push({ what: counted(errors, "ошибка", "ошибки", "ошибок") + " в журнале", why: "Последняя — " + ago(state.errors[0] && (state.errors[0].createdAt || state.errors[0].at)), go: ["settings", "data"], kind: "warn" });
  var requests = (state.groups || []).reduce(function (total, group) { return total + ((group.joinRequests || []).length); }, 0);
  if (requests) items.push({ what: counted(requests, "заявка", "заявки", "заявок") + " на вступление в группу", why: "Ждут одобрения", go: ["reach", "group"], kind: "warn" });
  return items;
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

VIEWS.overview = {
  subtitle: function () { return "Что происходит с ботом прямо сейчас"; },
  render: function (host) {
    var today = startOfToday(), week = startOfWeek();
    var todayKey = dayKeyOf(new Date());
    var waiting = (state.inquiries || []).filter(awaitsReply).length;
    var weekDays = lastDays(14);
    var attention = attentionItems();
    var recent = (state.inquiries || []).slice(0, 6);
    host.innerHTML =
      '<div class="grid cols-4" style="margin-bottom:12px">' +
        kpiCard("Клиенты", num(state.userCount), "+" + usersInRange(week) + " за 7 дней") +
        kpiCard("Обращения за 7 дней", num(inquiriesInRange(week).length), inquiriesInRange(today).length + " сегодня") +
        kpiCard("Ждут ответа", num(waiting), waiting ? "нужен ответ" : "все отвечены", waiting ? "down" : "up") +
        kpiCard("Просмотры", num(viewingList().length), unconfirmedViewings().length + " без подтверждения") +
      "</div>" +
      '<div class="split">' +
        '<div class="stack">' +
          '<div class="card"><header><h3>Сообщения и обращения, 14 дней</h3></header><div class="card-body">' +
            sparkline(weekDays, "received", "var(--brand)") +
            '<div class="legend"><span><i style="background:var(--brand)"></i>сообщения от клиентов</span><span>' + num(sumDays(weekDays, "received")) + " за 14 дней · " + num(sumDays(weekDays, "inquiries")) + " обращений</span></div>" +
          "</div></div>" +
          '<div class="card"><header><h3>Последние обращения</h3><div class="actions"><button class="btn ghost small" type="button" data-go="inquiries">Все</button></div></header>' +
            (recent.length ? '<div class="list">' + recent.map(function (item) {
              var user = (state.users || []).find(function (entry) { return entry.id === item.userId; }) || {};
              return '<div class="list-item clickable" data-inquiry="' + esc(item.id) + '">' +
                '<span class="avatar">' + esc(initials(user.firstName)) + "</span>" +
                '<span class="grow"><b>' + esc(user.firstName || "Клиент") + "</b> <span class=\"faint small\">" + esc(inquiryTypeName(item)) + "</span><br><span class=\"muted small\">" + esc(String(item.text || "").slice(0, 90)) + "</span></span>" +
                '<span class="small faint nowrap">' + ago(item.clientMessageAt || item.createdAt) + "</span>" +
                (item.searchLead ? '<span class="chip">ответ не нужен</span>' : awaitsReply(item) ? '<span class="chip bad">ждёт</span>' : '<span class="chip ok">ответ дан</span>') + "</div>";
            }).join("") + "</div>" : '<div class="empty"><b>Обращений пока нет</b>Они появятся, когда клиенты напишут боту</div>') +
          "</div>" +
        "</div>" +
        '<div class="stack">' +
          '<div class="card"><header><h3>Требует внимания</h3><div class="actions"><button class="btn ghost small" type="button" data-go="notifications">Центр уведомлений</button></div></header>' +
            (attention.length ? attention.map(function (item) {
              return '<div class="attention" data-go="' + item.go[0] + '" data-tab="' + (item.go[1] || "") + '">' +
                '<span class="chip ' + item.kind + '">!</span><span class="grow"><span class="what">' + esc(item.what) + '</span><br><span class="why">' + esc(item.why) + "</span></span>→</div>";
            }).join("") : '<div class="empty"><b>Всё в порядке</b>Ничего не ждёт вашего действия</div>') +
          "</div>" +
          '<div class="card"><header><h3>Состояние бота</h3></header><div class="card-body stack">' +
            '<label class="switch"><input type="checkbox" id="botActive"' + (state.config.active ? " checked" : "") + '><span class="track"></span><span>' + (state.config.active ? "Бот включён" : "Бот выключен") + "</span></label>" +
            '<div class="small muted">Связь: ' + esc(connectionText()) + "</div>" +
            '<div class="small muted">Клиентов в базе: ' + num(state.userCount) + " · активных: " + num(state.activeUserCount) + "</div>" +
            '<div class="row wrap"><button class="btn secondary small" type="button" data-go="settings" data-tab="connection">Настройки</button>' +
            '<button class="btn secondary small" type="button" data-go="stats">Статистика</button></div>' +
          "</div></div>" +
          '<div class="card"><header><h3>Быстрые действия</h3></header><div class="card-body row wrap">' +
            '<button class="btn secondary small" type="button" data-go="catalog" data-tab="objects">Добавить объект</button>' +
            '<button class="btn secondary small" type="button" data-go="reach" data-tab="campaigns">Создать рассылку</button>' +
            '<button class="btn secondary small" type="button" data-go="reach" data-tab="group">Написать в группу</button>' +
          "</div></div>" +
        "</div>" +
      "</div>";

    host.querySelectorAll("[data-go]").forEach(function (node) {
      node.onclick = function () { go(node.dataset.go, node.dataset.tab || ""); };
    });
    host.querySelectorAll("[data-inquiry]").forEach(function (node) {
      node.onclick = function () { openInquiry(node.dataset.inquiry); };
    });
    var toggle = host.querySelector("#botActive");
    if (toggle) toggle.onchange = async function () {
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
  return "работает" + (runtime.lastSuccessfulContactAt ? ", последний ответ " + ago(runtime.lastSuccessfulContactAt) : "");
}

function inquiryTypeName(item) {
  if (item.searchLead) return "искал объекты сам";
  return { lead: "заявка на звонок", viewing: "запись на просмотр", selection: "подбор", question: "вопрос по объекту", interest: "интерес к объекту", general: "сообщение" }[item.type] || "сообщение";
}

// --- Статистика ---------------------------------------------------------------
function barList(rows, total) {
  if (!rows.length) return '<div class="empty">Пока нет данных</div>';
  var top = Math.max.apply(null, rows.map(function (row) { return row[1]; }).concat([1]));
  return '<div class="card-body">' + rows.map(function (row) {
    return '<div class="bar-row"><span>' + esc(row[0]) + '<div class="bar"><span style="width:' + Math.round((row[1] / top) * 100) + '%"></span></div></span><b class="right">' + num(row[1]) + (total ? " <span class=\"faint small\">" + Math.round((row[1] / total) * 100) + "%</span>" : "") + "</b></div>";
  }).join("") + "</div>";
}

function recentReactions() {
  var events = [];
  (state.users || []).forEach(function (user) {
    (user.activity || []).forEach(function (item) { if (item.kind === "reaction") events.push({ user: user, item: item }); });
  });
  return events.sort(function (a, b) { return (Date.parse(b.item.createdAt) || 0) - (Date.parse(a.item.createdAt) || 0); }).slice(0, 10);
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

VIEWS.stats = {
  subtitle: function () { return "Аудитория, обращения, объекты и рассылки"; },
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
        kpiCard("Обращений за 30 дней", num(sumDays(days, "inquiries"))) +
        kpiCard("Конверсия в обращение", (state.userCount ? Math.round((inquiryUsers / state.userCount) * 100) : 0) + "%", "клиенты с обращением") +
      "</div>" +
      '<div class="card" style="margin-bottom:12px"><header><h3>Активность за 30 дней</h3></header><div class="card-body">' +
        sparkline(days, "received", "var(--brand)") +
        '<div class="legend"><span><i style="background:var(--brand)"></i>сообщения</span><span>обращений: ' + num(sumDays(days, "inquiries")) + " · новых клиентов: " + num(usersInRange(Date.now() - 30 * 864e5)) + "</span></div>" +
      "</div></div>" +
      '<div class="grid cols-2" style="margin-bottom:12px">' +
        '<div class="card"><header><h3>Обращения по типам</h3></header>' + barList(typeRows, inquiries.length) + "</div>" +
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
      '<div class="card"><header><h3>Эффективность объектов</h3><div class="actions"><span class="small faint">показы · подробнее · обращения</span></div></header>' +
        (properties.length ? '<div class="table-wrap"><table><thead><tr><th>Объект</th><th class="right">Показы</th><th class="right">Подробнее</th><th class="right">Обращения</th><th class="right">Интерес</th></tr></thead><tbody>' +
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
