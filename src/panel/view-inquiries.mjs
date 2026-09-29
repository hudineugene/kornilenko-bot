// Обращения, просмотры и клиенты: списки слева, карточка справа.

const INQUIRIES_JS = String.raw`
var inquiryFilter = { status: "waiting" };
// Ответ бота на поиск по переписке: сами сообщения в панель не уезжают, поэтому
// по ним ищет бот. Здесь — на какой запрос и какие беседы он нашёл.
var selectedInquiry = "";
// Беседу выбрала панель сама (при обновлении по таймеру), а не человек: как
// только на экран посмотрит человек, беседа считается прочитанной.
var selectionWasAuto = false;
// Беседу помечает прочитанной только человек, который её открыл. Панель сама
// выбирает первую беседу в списке (и заново при каждой перерисовке) — раньше
// из-за этого непрочитанные заявки «прочитывались» без участия владельца.
var conversationOpenedByUser = false;
function selectConversation(id) {
  selectedInquiry = id;
  conversationOpenedByUser = Boolean(id);
  selectionWasAuto = false;
}
var clientSearch = "";
var clientStageFilter = "";
var pipelineFilter = { search: "", assignee: "" };
var taskFilter = { scope: "action", search: "", assignee: "" };
var viewingMode = "calendar";
// Пока человек сам не выбрал вкладку, «Просмотры» открываются на очереди «Ждут
// подтверждения», если она не пуста: именно там менеджеру есть что делать.
var viewingModeChosen = false;
var VIEWING_QUICK_TIMES = ["10:00", "12:00", "17:00"];
var viewingWeekOffset = 0;
var PIPELINE_STAGES = [
  ["new", "Новый", "Первая заявка"],
  ["contact", "Связались", "Контакт установлен"],
  ["selection", "Подбор", "Ищем варианты"],
  ["viewing", "Просмотр", "Объекты показываются"],
  ["negotiation", "Переговоры", "Обсуждаем условия"],
  ["won", "Сделка", "Успешно завершено"],
  ["lost", "Неактуально", "Клиент выбыл"],
];

function userOf(item) {
  return (state.users || []).find(function (entry) { return entry.id === String(item.userId); }) || { firstName: "Клиент", id: item.userId };
}
function userName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "Без имени";
}
function savedSearchSummary(user) {
  var saved = user.savedSearch && user.savedSearch.filter ? user.savedSearch : null;
  if (!saved) return "не настроен";
  var filter = saved.filter || {};
  var types = { apartment: "квартира", house: "дом", villa: "вилла", townhouse: "таунхаус", land: "участок", commercial: "коммерческая", newbuild: "новостройка", other: "недвижимость" };
  var parts = [];
  if (filter.deal) parts.push(filter.deal === "rent" ? "аренда" : "продажа");
  if (filter.type) parts.push(types[filter.type] || filter.type);
  if (filter.city) parts.push(filter.city);
  if (filter.bedrooms) parts.push(filter.bedrooms + "+ спален");
  if (filter.minPrice) parts.push("от " + new Intl.NumberFormat("ru-RU").format(filter.minPrice) + " €");
  if (filter.maxPrice) parts.push("до " + new Intl.NumberFormat("ru-RU").format(filter.maxPrice) + " €");
  var active = saved.enabled !== false && user.propertyAlerts !== false;
  return (active ? "включён" : "на паузе") + (parts.length ? " · " + parts.join(", ") : "");
}
var MATCH_REASON_NAMES = { deal: "сделка", type: "тип", location: "район", budget: "бюджет", bedrooms: "спальни", general: "общие условия" };
var MATCH_WARNING_NAMES = {
  location: "другой район",
  budgetClose: "немного выше бюджета",
  budgetHigh: "выше бюджета",
  priceMissing: "нет цены — уточнить",
  currency: "другая валюта",
  periodConverted: "период цены пересчитан",
  bedroomsClose: "на одну спальню меньше",
  bedroomsMissing: "не указаны спальни — уточнить",
};
function selectionMatchingResults(item) {
  return item && item.matching && Array.isArray(item.matching.results) ? item.matching.results : [];
}
function selectionMatchingCounts(item) {
  var counts = { exact: 0, close: 0, consider: 0 };
  selectionMatchingResults(item).forEach(function (result) { if (counts[result.tier] != null) counts[result.tier] += 1; });
  return counts;
}
function selectionMatchingPanel(item) {
  if (!item || item.type !== "selection" || !item.matching) return "";
  var results = selectionMatchingResults(item);
  var counts = selectionMatchingCounts(item);
  if (!results.length) {
    return '<div class="msg"><b>🤖 Автоматический подбор: совпадений нет</b><br><span class="small muted">Нужен ручной подбор менеджера. Условия клиента сохранены выше.</span></div>';
  }
  var rows = results.map(function (result) {
    var property = (state.objects || []).find(function (record) { return String(record.id) === String(result.id); });
    var title = property ? localized(property.title, "ru") || property.reference || property.id : "Объект " + result.id;
    var tier = result.tier === "exact" ? ["точно", "ok"] : result.tier === "close" ? ["близко", "warn"] : ["рассмотреть", ""];
    var reasons = (result.reasons || []).map(function (key) { return MATCH_REASON_NAMES[key]; }).filter(Boolean);
    var warnings = (result.warnings || []).map(function (key) { return MATCH_WARNING_NAMES[key]; }).filter(Boolean);
    var needsData = (result.warnings || []).some(function (key) { return key === "priceMissing" || key === "bedroomsMissing"; });
    return '<div class="list-item start"><div class="grow"><div class="row wrap"><b>' + esc(title) + '</b><span class="chip ' + tier[1] + '">' + tier[0] + '</span><span class="small faint">оценка ' + Math.max(0, Math.min(100, Number(result.score) || 0)) + '%</span></div>' +
      (reasons.length ? '<div class="small faint gap-top-sm">Совпало: ' + esc(reasons.join(", ")) + '</div>' : "") +
      (warnings.length ? '<div class="small gap-top-sm ' + (needsData ? "bad-text" : "warn-text") + '">Учесть: ' + esc(warnings.join(", ")) + '</div>' : "") +
      '</div>' + (property ? '<button class="btn ghost small" type="button" data-match-property="' + esc(property.id) + '">Карточка</button>' : '<span class="chip bad">объект удалён</span>') + '</div>';
  }).join("");
  return '<div class="card flat"><header><h3>Автоматический подбор</h3><div class="actions"><span class="chip ok">точно ' + counts.exact + '</span><span class="chip warn">близко ' + counts.close + '</span><span class="chip">рассмотреть ' + counts.consider + '</span></div></header><div class="list">' + rows + '</div></div>';
}
// Просмотр — не обычное сообщение: у него есть дата, время и одно действие,
// которого от менеджера ждут. Показываем его карточкой прямо в переписке.
function viewingCardHtml(item, property) {
  var viewing = item && item.viewing;
  if (!viewing) return "";
  var when = [viewing.confirmedDate ? pipelineDate(viewing.confirmedDate) : viewing.dateText || "дата не выбрана",
    viewing.confirmedTime || viewing.timeText || ""].filter(Boolean).join(" · ");
  var state = viewing.cancelledAt
    ? { text: "Клиент отменил", chip: "" }
    : viewing.confirmedAt
      ? { text: "Подтверждён", chip: "ok" }
      : { text: "Ждёт подтверждения", chip: "warn" };
  return '<div class="viewing-card' + (viewing.confirmedAt ? " confirmed" : "") + '">' +
    '<div class="viewing-card-head"><b>📅 Запись на просмотр</b><span class="chip ' + state.chip + '">' + state.text + "</span></div>" +
    '<div class="viewing-card-when">' + esc(when) + "</div>" +
    (property ? '<div class="small muted">⌂ ' + esc(localized(property.title, "ru") || property.reference || property.id) + "</div>" : "") +
    (viewing.cancelledAt ? "" : '<button class="btn secondary small" id="confirmViewingInline" type="button">' + (viewing.confirmedAt ? "Перенести просмотр" : "Подтвердить и уведомить") + "</button>") +
    "</div>";
}

function statusChip(item) {
  var state = inquiryState(item);
  return '<span class="chip ' + state.chip + '">' + state.text + "</span>";
}
function inquiryUnread(item) {
  var incoming = (item.messages || []).filter(function (message) { return message.direction === "in"; }).map(function (message) { return Date.parse(message.createdAt) || 0; });
  var lastIncoming = Math.max.apply(null, [Date.parse(item.clientMessageAt || item.createdAt) || 0].concat(incoming));
  return lastIncoming > (Date.parse(item.readAt || "") || 0);
}
function conversationGroups() {
  var grouped = {};
  (state.inquiries || []).forEach(function (item) {
    var id = String(item.userId);
    if (!grouped[id]) grouped[id] = { userId: id, user: userOf(item), inquiries: [] };
    grouped[id].inquiries.push(item);
  });
  return Object.keys(grouped).map(function (id) {
    var group = grouped[id];
    group.inquiries.sort(function (a, b) { return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0); });
    group.latest = group.inquiries[0];
    group.active = group.inquiries.find(function (item) { return item.id === selectedInquiry; }) || group.inquiries.find(function (item) { return item.status !== "closed"; }) || group.latest;
    group.unread = group.inquiries.filter(inquiryUnread).length;
    group.waiting = group.inquiries.some(awaitsReply);
    group.answered = group.inquiries.some(function (item) { return item.status !== "closed" && !awaitsReply(item) && (item.replies || []).length; });
    group.closed = group.inquiries.every(function (item) { return item.status === "closed"; });
    // Диалог, где клиент только искал объекты сам: отвечать не на что.
    group.searchOnly = group.inquiries.every(function (item) { return item.searchLead; });
    return group;
  }).sort(function (a, b) { return (Date.parse(b.latest.updatedAt || b.latest.createdAt) || 0) - (Date.parse(a.latest.updatedAt || a.latest.createdAt) || 0); });
}
function conversationMatches(group) {
  if (inquiryFilter.status === "unread" && !group.unread) return false;
  if (inquiryFilter.status === "waiting" && !group.waiting) return false;
  if (inquiryFilter.status === "answered" && !group.answered) return false;
  if (inquiryFilter.status === "closed" && !group.closed) return false;
  return true;
}

function openInquiry(id) {
  selectConversation(id);
  go("inquiries", "inbox");
}

function inquiryRows() {
  return conversationGroups().filter(conversationMatches).reduce(function (rows, group) { return rows.concat(group.inquiries); }, []);
}

function pipelineStageOf(item) {
  if (!item) return "";
  if (PIPELINE_STAGES.some(function (stage) { return stage[0] === item.pipelineStage; })) return item.pipelineStage;
  if (item.status === "closed") return "";
  if (item.type === "viewing") return "viewing";
  if (item.type === "selection") return "selection";
  return item.status === "in_progress" ? "contact" : "new";
}
function pipelineStageOptions(current, includeEmpty) {
  return (includeEmpty ? '<option value=""' + (!current ? " selected" : "") + '>Этап не задан</option>' : "") + PIPELINE_STAGES.map(function (stage) {
    return '<option value="' + stage[0] + '"' + (current === stage[0] ? " selected" : "") + '>' + stage[1] + "</option>";
  }).join("");
}
function pipelineToday() {
  try { var parts = zonedParts(new Date()); return parts.year + "-" + parts.month + "-" + parts.day; } catch (error) { return new Date().toISOString().slice(0, 10); }
}
function pipelineDate(value) {
  var parts = String(value || "").split("-");
  return parts.length === 3 ? parts[2] + "." + parts[1] : "";
}
function pipelineOpportunityRows() {
  return conversationGroups().map(function (group) {
    var item = group.active, stage = pipelineStageOf(item);
    if (!stage || (item.status === "closed" && stage !== "won" && stage !== "lost")) return null;
    return { group: group, item: item, user: group.user, stage: stage };
  }).filter(Boolean);
}
function pipelineCardHtml(row) {
  var item = row.item, user = row.user;
  var property = item.propertyId ? (state.objects || []).find(function (record) { return record.id === item.propertyId; }) : null;
  var due = item.followUpDate && item.followUpDate <= pipelineToday();
  return '<article class="funnel-card' + (due ? " due" : "") + '">' +
    '<button class="funnel-open" data-inquiry="' + esc(item.id) + '" type="button"><span class="conversation-avatar">' + esc(initials(user.firstName)) + '</span><span class="funnel-person"><b>' + esc(userName(user)) + '</b><small>' + esc(inquiryTypeName(item)) + '</small></span><span class="funnel-arrow">→</span></button>' +
    (property ? '<div class="funnel-property">⌂ ' + esc(localized(property.title, "ru") || property.reference || property.id) + '</div>' : "") +
    '<div class="funnel-signals">' +
      (row.group.waiting ? '<span class="chip bad">Ждёт ответа</span>' : '<span class="chip ok">Отвечено</span>') +
      (item.assignee ? '<span class="chip">' + esc(item.assignee) + '</span>' : '<span class="chip warn">без менеджера</span>') +
      (item.followUpDate ? '<span class="chip ' + (due ? "bad" : "") + '">⏱ ' + pipelineDate(item.followUpDate) + (item.followUpTime ? " " + esc(item.followUpTime) : "") + '</span>' : "") +
    '</div><select class="pipeline-stage-select" data-pipeline-stage="' + esc(item.id) + '" aria-label="Этап">' + pipelineStageOptions(row.stage, false) + '</select></article>';
}
function renderPipeline(host) {
  screenSettled();
  var allRows = pipelineOpportunityRows();
  var managers = [state.config.adminName || "Администратор"].concat((state.config.managers || []).map(function (manager) { return manager.name; })).concat(allRows.map(function (row) { return row.item.assignee; })).filter(function (name, index, all) { return name && all.indexOf(name) === index; });
  var searchText = pipelineFilter.search.toLowerCase();
  var rows = allRows.filter(function (row) {
    if (pipelineFilter.assignee === "none" && row.item.assignee) return false;
    if (pipelineFilter.assignee && pipelineFilter.assignee !== "none" && row.item.assignee !== pipelineFilter.assignee) return false;
    if (!searchText) return true;
    var property = row.item.propertyId ? (state.objects || []).find(function (record) { return record.id === row.item.propertyId; }) : null;
    return [userName(row.user), row.user.username, row.user.phone, row.item.text, row.item.assignee, property && localized(property.title, "ru")].filter(Boolean).join(" ").toLowerCase().indexOf(searchText) >= 0;
  });
  var today = pipelineToday();
  var active = allRows.filter(function (row) { return row.stage !== "won" && row.stage !== "lost"; });
  var due = active.filter(function (row) { return row.item.followUpDate && row.item.followUpDate <= today; }).length;
  var waiting = active.filter(function (row) { return row.group.waiting; }).length;
  var unassigned = active.filter(function (row) { return !row.item.assignee; }).length;
  host.innerHTML = numberStrip([
      ["Активные клиенты", num(active.length), "", "Без «Выиграно» и «Проиграно»"],
      ["Ждут ответа", num(waiting), waiting ? "bad" : ""],
      ["Связаться", num(due), due ? "bad" : "", "Сегодня или просрочено"],
      ["Без менеджера", num(unassigned), unassigned ? "bad" : ""],
    ]) + '<div class="funnel-toolbar"><div class="search"><input id="pipelineSearch" placeholder="Найти клиента, объект или сообщение" value="' + esc(pipelineFilter.search) + '"></div><select id="pipelineAssignee"><option value="">Все менеджеры</option><option value="none"' + (pipelineFilter.assignee === "none" ? " selected" : "") + '>Без менеджера</option>' + managers.map(function (name) { return '<option value="' + esc(name) + '"' + (pipelineFilter.assignee === name ? " selected" : "") + '>' + esc(name) + "</option>"; }).join("") + '</select><span class="small muted">На доске: ' + rows.length + " из " + allRows.length + ' (вместе с завершёнными)</span></div>' +
    '<div class="funnel-board">' + PIPELINE_STAGES.map(function (stage) {
      var stageRows = rows.filter(function (row) { return row.stage === stage[0]; });
      return '<section class="funnel-column stage-' + stage[0] + '"><header><div><h3>' + stage[1] + '</h3><span>' + stage[2] + '</span></div><b>' + stageRows.length + '</b></header><div class="funnel-column-body">' + (stageRows.length ? stageRows.map(pipelineCardHtml).join("") : '<div class="funnel-empty">Нет клиентов</div>') + "</div></section>";
    }).join("") + "</div>";
  var search = host.querySelector("#pipelineSearch");
  search.oninput = function () {
    pipelineFilter.search = search.value.trim();
    clearTimeout(search._timer);
    search._timer = setTimeout(function () { renderPipeline(host); var next = host.querySelector("#pipelineSearch"); if (next) next.focus(); }, 250);
  };
  host.querySelector("#pipelineAssignee").onchange = function (event) { pipelineFilter.assignee = event.target.value; renderPipeline(host); };
  host.querySelectorAll("[data-inquiry]").forEach(function (button) {
    button.onclick = function () { selectConversation(button.dataset.inquiry); go("inquiries", "inbox"); };
  });
  host.querySelectorAll("[data-pipeline-stage]").forEach(function (select) {
    select.onchange = async function () {
      select.disabled = true;
      try {
        await send("/api/inquiries/" + encodeURIComponent(select.dataset.pipelineStage), "PATCH", { pipelineStage: select.value });
        toast("Этап обновлён");
        await reload();
      } catch (error) { select.disabled = false; fail(error); }
    };
  });
}

function taskScopeOf(row, today) {
  if (!row.item.followUpDate) return ["contact", "selection", "viewing", "negotiation"].includes(row.stage) ? "none" : "";
  if (row.item.followUpDate < today) return "overdue";
  if (row.item.followUpDate === today) return "today";
  return "future";
}
function taskStatusHtml(scope, item) {
  if (scope === "overdue") return '<span class="chip bad">Просрочено · ' + pipelineDate(item.followUpDate) + '</span>';
  if (scope === "today") return '<span class="chip warn">Сегодня' + (item.followUpTime ? " · " + esc(item.followUpTime) : "") + '</span>';
  if (scope === "future") return '<span class="chip brand">' + pipelineDate(item.followUpDate) + (item.followUpTime ? " · " + esc(item.followUpTime) : "") + '</span>';
  return '<span class="chip">Дата не назначена</span>';
}
function openTaskSchedule(item) {
  openDialog({
    title: item.followUpDate ? "Перенести контакт" : "Запланировать следующий шаг",
    body: '<div class="stack"><p class="small muted">После сохранения менеджер получит напоминание в Telegram в рабочее время.</p><div class="grid cols-2"><div class="field"><label for="taskDate">Дата</label><input id="taskDate" type="date" min="' + pipelineToday() + '" value="' + esc(item.followUpDate || pipelineToday()) + '"></div><div class="field"><label for="taskTime">Время, необязательно</label><input id="taskTime" type="time" value="' + esc(item.followUpTime || "") + '"></div></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveTaskDate" type="button">Сохранить</button>',
    ready: function (dialog) {
      dialog.querySelector("#saveTaskDate").onclick = async function () {
        var date = dialog.querySelector("#taskDate").value;
        if (!date) return toast("Выберите дату", true);
        try {
          await send("/api/inquiries/" + encodeURIComponent(item.id), "PATCH", { followUpDate: date, followUpTime: dialog.querySelector("#taskTime").value });
          dialog.close();
          toast("Контакт запланирован");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}
function taskCardHtml(row, scope) {
  var item = row.item, user = row.user;
  var property = item.propertyId ? (state.objects || []).find(function (record) { return record.id === item.propertyId; }) : null;
  var stage = PIPELINE_STAGES.find(function (entry) { return entry[0] === row.stage; });
  return '<article class="task-card ' + scope + '"><div class="task-main"><span class="conversation-avatar">' + esc(initials(user.firstName)) + '</span><div class="task-copy"><div class="row wrap"><b>' + esc(userName(user)) + '</b>' + taskStatusHtml(scope, item) + '</div><div class="small muted">' + esc(inquiryTypeName(item)) + (stage ? " · этап: " + esc(stage[1]) : "") + (item.assignee ? " · менеджер: " + esc(item.assignee) : " · менеджер не назначен") + '</div>' +
    (property ? '<div class="task-property">⌂ ' + esc(localized(property.title, "ru") || property.reference || property.id) + '</div>' : "") +
    (item.note ? '<div class="task-note">' + esc(item.note) + '</div>' : "") +
    '</div></div><div class="task-actions"><button class="btn ghost small" data-task-open="' + esc(item.id) + '" type="button">Открыть диалог</button><button class="btn secondary small" data-task-plan="' + esc(item.id) + '" type="button">' + (item.followUpDate ? "Перенести" : "Назначить дату") + '</button>' +
    (item.followUpDate ? '<button class="btn secondary small" data-task-done="' + esc(item.id) + '" type="button">✓ Выполнено</button>' : "") + '</div></article>';
}
function renderTasks(host) {
  screenSettled();
  var today = pipelineToday();
  var allRows = pipelineOpportunityRows().filter(function (row) { return row.stage !== "won" && row.stage !== "lost"; }).map(function (row) { row.taskScope = taskScopeOf(row, today); return row; }).filter(function (row) { return row.taskScope; });
  var counts = {
    action: allRows.filter(function (row) { return row.taskScope === "overdue" || row.taskScope === "today"; }).length,
    overdue: allRows.filter(function (row) { return row.taskScope === "overdue"; }).length,
    future: allRows.filter(function (row) { return row.taskScope === "future"; }).length,
    none: allRows.filter(function (row) { return row.taskScope === "none"; }).length,
    all: allRows.length,
  };
  var managers = [state.config.adminName || "Администратор"].concat((state.config.managers || []).map(function (manager) { return manager.name; })).concat(allRows.map(function (row) { return row.item.assignee; })).filter(function (name, index, all) { return name && all.indexOf(name) === index; });
  var searchText = taskFilter.search.toLowerCase();
  var rows = allRows.filter(function (row) {
    if (taskFilter.scope === "action" && row.taskScope !== "overdue" && row.taskScope !== "today") return false;
    if (!["", "action", "all"].includes(taskFilter.scope) && row.taskScope !== taskFilter.scope) return false;
    if (taskFilter.assignee === "none" && row.item.assignee) return false;
    if (taskFilter.assignee && taskFilter.assignee !== "none" && row.item.assignee !== taskFilter.assignee) return false;
    if (!searchText) return true;
    return [userName(row.user), row.user.username, row.user.phone, row.item.text, row.item.note, row.item.assignee].filter(Boolean).join(" ").toLowerCase().indexOf(searchText) >= 0;
  }).sort(function (a, b) {
    if (!a.item.followUpDate && b.item.followUpDate) return 1;
    if (a.item.followUpDate && !b.item.followUpDate) return -1;
    return String(a.item.followUpDate || "").localeCompare(String(b.item.followUpDate || "")) || String(a.item.followUpTime || "").localeCompare(String(b.item.followUpTime || ""));
  });
  host.innerHTML = numberStrip([
      ["К выполнению", num(counts.action), counts.action ? "bad" : "", "Сегодня и просроченные"],
      ["Просрочено", num(counts.overdue), counts.overdue ? "bad" : ""],
      ["Запланировано", num(counts.future), "", "На будущие даты"],
      ["Без следующего шага", num(counts.none), counts.none ? "bad" : "", "Активные клиенты без даты"],
    ]) + '<div class="task-toolbar"><div class="tabs" id="taskScope">' +
      [["action", "К выполнению", counts.action], ["overdue", "Просроченные", counts.overdue], ["future", "Будущие", counts.future], ["none", "Без даты", counts.none], ["all", "Все", counts.all]].map(function (entry) { return '<button type="button" data-scope="' + entry[0] + '" class="' + (taskFilter.scope === entry[0] ? "active" : "") + '">' + entry[1] + " · " + entry[2] + "</button>"; }).join("") +
      '</div><div class="task-controls"><div class="search"><input id="taskSearch" placeholder="Найти клиента или задачу" value="' + esc(taskFilter.search) + '"></div><select id="taskAssignee"><option value="">Все менеджеры</option><option value="none"' + (taskFilter.assignee === "none" ? " selected" : "") + '>Без менеджера</option>' + managers.map(function (name) { return '<option value="' + esc(name) + '"' + (taskFilter.assignee === name ? " selected" : "") + '>' + esc(name) + "</option>"; }).join("") + '</select></div></div>' +
    '<div class="task-list">' + (rows.length ? rows.map(function (row) { return taskCardHtml(row, row.taskScope); }).join("") : '<div class="card empty"><b>Дел в этой группе нет</b>Можно перейти к другим задачам или открыть воронку</div>') + "</div>";
  host.querySelectorAll("[data-scope]").forEach(function (button) { button.onclick = function () { taskFilter.scope = button.dataset.scope; renderTasks(host); }; });
  var search = host.querySelector("#taskSearch");
  search.oninput = function () { taskFilter.search = search.value.trim(); clearTimeout(search._timer); search._timer = setTimeout(function () { renderTasks(host); var next = host.querySelector("#taskSearch"); if (next) next.focus(); }, 250); };
  host.querySelector("#taskAssignee").onchange = function (event) { taskFilter.assignee = event.target.value; renderTasks(host); };
  host.querySelectorAll("[data-task-open]").forEach(function (button) { button.onclick = function () { selectConversation(button.dataset.taskOpen); go("inquiries", "inbox"); }; });
  host.querySelectorAll("[data-task-plan]").forEach(function (button) { button.onclick = function () { var row = allRows.find(function (entry) { return entry.item.id === button.dataset.taskPlan; }); if (row) openTaskSchedule(row.item); }; });
  host.querySelectorAll("[data-task-done]").forEach(function (button) {
    button.onclick = async function () {
      button.disabled = true;
      try { await send("/api/inquiries/" + encodeURIComponent(button.dataset.taskDone), "PATCH", { followUpDate: "", followUpTime: "" }); toast("Шаг выполнен"); await reload(); } catch (error) { button.disabled = false; fail(error); }
    };
  });
}

// Шаблоны ответов — карточка на вкладке «Автоответы и шаблоны»: рядом с
// автоответами, потому что это одно и то же по смыслу.
function templatesCardHtml() {
  var templates = state.replyTemplates || [];
  return '<div class="card"><header><h3>Шаблоны ответов</h3><div class="actions"><button class="btn secondary small" id="addTemplate" type="button">＋ Шаблон</button></div></header>' +
    '<div class="card-body stack" id="templateList">' + (templates.length ? templates.map(function (template) {
      return '<div class="card flat"><div class="card-body stack" data-template="' + esc(template.id) + '">' +
        '<input data-field="title" value="' + esc(template.title) + '" placeholder="Название шаблона">' +
        LANGUAGES.map(function (language) {
          return '<textarea data-field="' + language[0] + '" placeholder="' + language[1] + '">' + esc((template.text || {})[language[0]] || "") + "</textarea>";
        }).join("") +
        '<div class="row"><button class="btn secondary small" data-save="1" type="button">Сохранить</button><button class="btn ghost small" data-drop="1" type="button">Удалить</button></div>' +
      "</div></div>";
    }).join("") : '<div class="empty"><b>Шаблонов нет</b>Готовый текст менеджер вставляет в ответ одним нажатием</div>') + "</div></div>";
}

function bindTemplatesCard(host, redraw) {
  function bind() {
    host.querySelectorAll("[data-template]").forEach(function (card) {
      var id = card.dataset.template;
      var payload = function () {
        var text = {};
        LANGUAGES.forEach(function (language) { text[language[0]] = card.querySelector('[data-field="' + language[0] + '"]').value; });
        return { title: card.querySelector('[data-field="title"]').value, text: text };
      };
      card.querySelector("[data-save]").onclick = async function () {
        try {
          if (id === "new") await send("/api/reply-templates", "POST", payload());
          else await send("/api/reply-templates/" + encodeURIComponent(id), "PUT", payload());
          toast("Сохранено");
          await reload(false);
          redraw();
        } catch (error) { fail(error); }
      };
      card.querySelector("[data-drop]").onclick = async function () {
        if (id === "new") return card.closest(".card").remove();
        if (!(await confirmDialog("Удалить шаблон?", "Шаблон исчезнет из списка.", "Удалить", true))) return;
        try {
          await api("/api/reply-templates/" + encodeURIComponent(id), { method: "DELETE" });
          await reload(false);
          redraw();
        } catch (error) { fail(error); }
      };
    });
  }
  bind();
  host.querySelector("#addTemplate").onclick = function () {
    var list = host.querySelector("#templateList");
    var empty = list.querySelector(".empty");
    if (empty) empty.remove();
    var card = document.createElement("div");
    card.className = "card flat";
    card.innerHTML = '<div class="card-body stack" data-template="new"><input data-field="title" placeholder="Название шаблона">' +
      LANGUAGES.map(function (language) { return '<textarea data-field="' + language[0] + '" placeholder="' + language[1] + '"></textarea>'; }).join("") +
      '<div class="row"><button class="btn secondary small" data-save="1" type="button">Сохранить</button><button class="btn ghost small" data-drop="1" type="button">Удалить</button></div></div>';
    list.appendChild(card);
    bind();
  };
}


function renderInquiryList(host) {
  screenSettled();
  var allGroups = conversationGroups();
  var rows = allGroups.filter(conversationMatches);
  var selectedGroup = selectedInquiry ? allGroups.find(function (group) {
    return group.inquiries.some(function (item) { return item.id === selectedInquiry; });
  }) : null;
  // Открытая беседа остаётся в списке, даже если перестала подходить под фильтр.
  // Иначе после ответа она исчезала прямо из-под курсора: при фильтре «Ждут
  // ответа» отвеченная беседа выпадала из списка, и вместо неё открывался
  // другой клиент.
  if (selectedGroup && rows.indexOf(selectedGroup) < 0) rows = [selectedGroup].concat(rows);
  // Беседу сами не открываем: вход в раздел «Клиенты» открывал первую из
  // списка и тут же помечал её прочитанной — менеджер не читал, а клиент уже
  // считался «увиденным». Пока диалог не выбран, справа — «Выберите диалог».
  if (!selectedGroup) selectConversation("");
  // Беседу открыла панель во время обновления, а теперь на экран смотрит
  // человек: раньше она оставалась непрочитанной, пока не щёлкнешь по ней ещё
  // раз — по уже открытой.
  if (selectionWasAuto && !renderingAuto) {
    selectionWasAuto = false;
    conversationOpenedByUser = true;
  }
  pageAction("✎ Шаблоны ответов", function () { go("texts", "rules"); }, "secondary");
  pageAction("⋯", openInquiryExtras, "ghost");
  var counts = {
    unread: allGroups.filter(function (group) { return group.unread; }).length,
    waiting: allGroups.filter(function (group) { return group.waiting; }).length,
    answered: allGroups.filter(function (group) { return group.answered; }).length,
    closed: allGroups.filter(function (group) { return group.closed; }).length,
    all: allGroups.length,
  };
  var conversationItems = rows.map(function (group) {
    var item = group.latest, user = group.user;
    var selected = group.inquiries.some(function (entry) { return entry.id === selectedInquiry; });
    // Последнее сообщение беседы приходит в состоянии отдельно: сама переписка
    // в панель не уезжает. Раньше здесь всегда оставалось item.text — первое
    // сообщение клиента, то есть месяцами одно и то же.
    var lastMessage = item.lastMessage;
    var preview = lastMessage ? (lastMessage.text || lastMessage.fileName) : item.text;
    if (lastMessage && lastMessage.direction === "out" && preview) preview = "Вы: " + preview;
    var stateText = group.waiting ? "Ждёт ответа" : group.closed ? "Закрыт" : group.searchOnly ? "Ответ не нужен" : "Отвечено";
    var stateClass = group.waiting ? "bad" : group.closed ? "" : "ok";
    return '<button class="conversation-item' + (selected ? " selected" : "") + (group.unread ? " unread" : "") + '" data-id="' + esc(group.active.id) + '" data-user="' + esc(group.userId) + '" type="button">' +
      '<span class="conversation-avatar">' + esc(initials(user.firstName)) + (group.unread ? '<i></i>' : '') + '</span>' +
      '<span class="conversation-item-body"><span class="conversation-item-top"><b>' + esc(userName(user)) + '</b><time>' + ago(item.clientMessageAt || item.updatedAt || item.createdAt) + '</time></span>' +
      '<span class="conversation-preview">' + esc(String(preview || "Вложение").replace(/\s+/g, " ").slice(0, 100)) + '</span>' +
      '<span class="conversation-item-meta"><span>' + esc(inquiryTypeName(item)) + (group.inquiries.length > 1 ? " · " + group.inquiries.length + " заявки" : "") + '</span><span class="conversation-state ' + stateClass + '">' + stateText + '</span>' +
      (group.unread ? '<span class="unread-count">' + group.unread + '</span>' : '') + '</span></span></button>';
  }).join("");
  host.innerHTML =
    '<div class="messenger-toolbar">' +
      // На телефоне вкладки не помещаются: тот же выбор одной строкой.
      '<select class="messenger-filter-compact" id="inqStatusCompact">' +
        [["unread", "Непрочитанные", counts.unread], ["waiting", "Ждут ответа", counts.waiting],
          ["answered", "Отвеченные", counts.answered],
          ["closed", "Закрытые", counts.closed], ["", "Все", counts.all]].map(function (option) {
          return '<option value="' + option[0] + '"' + (inquiryFilter.status === option[0] ? " selected" : "") + ">" + option[1] + (option[2] ? " · " + option[2] : "") + "</option>";
        }).join("") + "</select>" +
      '<div class="tabs messenger-filters" id="inqStatus">' +
        '<button type="button" data-status="unread" class="' + (inquiryFilter.status === "unread" ? "active" : "") + '">Непрочитанные' + (counts.unread ? " · " + counts.unread : "") + "</button>" +
        '<button type="button" data-status="waiting" class="' + (inquiryFilter.status === "waiting" ? "active" : "") + '">Ждут ответа' + (counts.waiting ? " · " + counts.waiting : "") + "</button>" +
        '<button type="button" data-status="answered" class="' + (inquiryFilter.status === "answered" ? "active" : "") + '">Отвеченные' + (counts.answered ? " · " + counts.answered : "") + "</button>" +
        '<button type="button" data-status="closed" class="' + (inquiryFilter.status === "closed" ? "active" : "") + '">Закрытые' + (counts.closed ? " · " + counts.closed : "") + "</button>" +
        '<button type="button" data-status="" class="' + (inquiryFilter.status === "" ? "active" : "") + '">Все · ' + counts.all + "</button>" +
      "</div>" +
    "</div>" +
    '<div class="messenger-shell' + (selectedInquiry ? " chat-open" : "") + '"><aside class="card conversation-list-panel"><header><div><h3>Диалоги</h3><span class="small muted">Один клиент — одна переписка</span></div><span class="chip">' + rows.length + " из " + counts.all + '</span></header><div class="conversation-list">' +
      (conversationItems || '<div class="empty"><b>Диалогов не найдено</b>Измените фильтр или поисковый запрос</div>') +
    '</div></aside><section class="messenger-chat" id="inquiryCard"></section></div>';
  // На телефоне открытый диалог занимает весь экран: заголовок, вкладки и
  // фильтры (около 700 px) скрываются, остаётся «← Диалоги» и сама переписка.
  if (document.body && document.body.classList) document.body.classList.toggle("phone-chat", Boolean(selectedInquiry));

  host.querySelectorAll("#inqStatus button").forEach(function (button) {
    button.onclick = function () { inquiryFilter.status = button.dataset.status; renderInquiryList(host); };
  });
  var compact = host.querySelector("#inqStatusCompact");
  if (compact) compact.onchange = function () {
    inquiryFilter.status = compact.value;
    renderInquiryList(host);
  };
  host.querySelectorAll(".conversation-item[data-id]").forEach(function (row) {
    row.onclick = function () { selectConversation(row.dataset.id); renderInquiryList(host); };
  });
  renderInquiryCard(host.querySelector("#inquiryCard"));
}

// Уборка списка: закрытые, отвеченные или всё подряд, с отсечкой по возрасту.
// Те же правила, что и у бота: закрытые, и «отвеченные» — только там, где
// ответ отправлен, клиент не ждёт и заявка не в работе.
function cleanupMatches(item, scope) {
  if (scope === "all") return true;
  if (item.status === "closed") return true;
  if (scope === "closed") return false;
  return item.status !== "in_progress" && !awaitsReply(item) && (item.replies || []).length > 0;
}

// «⋯»: то, что делают раз в месяц, — выгрузка и очистка. Рядом с обычными
// кнопками им не место: одно нажатие мимо стоило бы заявок.
function openInquiryExtras() {
  openDialog({
    title: "Ещё действия",
    body: '<div class="stack">' +
      '<button class="btn secondary" id="extraExport" type="button">⬇ Выгрузить заявки в Excel</button>' +
      '<span class="small muted">Файл со всеми заявками и контактами — для отчёта или переноса.</span>' +
      '<button class="btn ghost" id="extraCleanup" type="button">🧹 Очистить заявки</button>' +
      '<span class="small muted">Удаляет старые заявки из панели без возможности восстановления.</span>' +
      "</div>",
    footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button>',
    ready: function (dialog) {
      dialog.querySelector("#extraExport").onclick = function () { dialog.closeClean(); exportInquiries(); };
      dialog.querySelector("#extraCleanup").onclick = function () { dialog.closeClean(); openCleanup(); };
    },
  });
}

function openCleanup() {
  var all = state.inquiries || [];
  var countFor = function (scope) { return all.filter(function (item) { return cleanupMatches(item, scope); }).length; };
  var closed = countFor("closed");
  openDialog({
    title: "Очистить заявки",
    body: '<div class="stack">' +
      '<p class="muted small">Заявки удаляются из панели без возможности восстановления. Клиенты и переписка в Telegram остаются.</p>' +
      '<div class="field"><label for="cleanScope">Какие удалить</label><select id="cleanScope">' +
        '<option value="closed">Только закрытые (' + closed + ")</option>" +
        '<option value="answered">Закрытые и отвеченные (' + countFor("answered") + ")</option>" +
        '<option value="all">Все, включая ждущие ответа и дела в работе (' + all.length + ")</option>" +
      "</select></div>" +
      '<div class="hint">«Закрытые и отвеченные» не трогают заявки в работе и те, где клиент ждёт ответа.</div>' +
      '<div class="field"><label for="cleanAge">Старше чем</label><select id="cleanAge">' +
        '<option value="0">любого возраста</option><option value="30">30 дней</option><option value="90" selected>90 дней</option><option value="180">180 дней</option><option value="365">года</option>' +
      "</select></div>" +
      '<div id="cleanPreview" class="chip warn"></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn danger" id="doClean" type="button">Удалить</button>',
    ready: function (dialog) {
      function matching() {
        var scope = dialog.querySelector("#cleanScope").value;
        var days = Number(dialog.querySelector("#cleanAge").value);
        var before = days ? Date.now() - days * 864e5 : Infinity;
        return all.filter(function (item) {
          var old = (Date.parse(item.updatedAt || item.createdAt) || 0) < before;
          return cleanupMatches(item, scope) && old;
        }).length;
      }
      function preview() { dialog.querySelector("#cleanPreview").textContent = "Будет удалено: " + matching(); }
      preview();
      dialog.querySelector("#cleanScope").onchange = preview;
      dialog.querySelector("#cleanAge").onchange = preview;
      dialog.querySelector("#doClean").onclick = async function () {
        if (!(await confirmDialog("Удалить заявки?", "Будет удалено: " + matching() + ". Отменить это нельзя.", "Удалить", true))) return;
        try {
          var result = await send("/api/inquiries/cleanup", "POST", { scope: dialog.querySelector("#cleanScope").value, olderThanDays: Number(dialog.querySelector("#cleanAge").value) });
          dialog.close();
          selectConversation("");
          toast("Удалено: " + result.removed + ", осталось: " + result.left);
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

async function exportInquiries() {
  try {
    var response = await fetch("/api/inquiries/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ ids: inquiryRows().map(function (item) { return item.id; }) }) });
    if (!response.ok) throw new Error("Не удалось выгрузить");
    var blob = await response.blob();
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Заявки.xlsx";
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) { fail(error); }
}

// Шаблон ответа добавляется к набранному, а не заменяет его: менеджер мог уже
// начать писать. Между набранным и шаблоном — пустая строка.
function withTemplate(current, text) {
  var typed = String(current || "").replace(/\s+$/, "");
  return typed ? typed + "\n\n" + text : text;
}

// Выгрузка клиентов: те, кто сейчас на экране (этап и поиск учтены), а не вся база.
async function exportClients(ids) {
  try {
    var response = await fetch("/api/users/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ ids: ids }) });
    if (!response.ok) throw new Error("Не удалось выгрузить");
    var blob = await response.blob();
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Клиенты.xlsx";
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Выгружено клиентов: " + ids.length);
  } catch (error) { fail(error); }
}

// Переписка беседы приходит отдельным запросом: в общем состоянии её нет,
// иначе панель тянула бы переписку всех клиентов каждые 45 секунд.
// Загруженное помним, пока открыта страница; при обновлении экрана и после
// отправки ответа берём заново.
var conversationCache = {};
var conversationLoading = {};

function conversationTimeline(userId) {
  var loaded = conversationCache[String(userId)];
  return loaded ? loaded.slice() : null;
}

function forgetConversation(userId) {
  delete conversationCache[String(userId)];
}

// Переписку не удалось загрузить: раньше карточка показывала «Сообщений пока
// нет» — то есть выдавала сбой связи за пустую переписку. Запоминаем причину и
// говорим правду, с кнопкой «Повторить».
var conversationFailed = {};

function loadConversation(userId, onReady) {
  var key = String(userId);
  if (conversationLoading[key] || conversationFailed[key]) return;
  conversationLoading[key] = true;
  api("/api/conversations/" + encodeURIComponent(key) + "/timeline").then(function (body) {
    conversationLoading[key] = false;
    conversationCache[key] = Array.isArray(body.messages) ? body.messages : [];
    if (onReady) onReady();
  }, function (error) {
    conversationLoading[key] = false;
    conversationFailed[key] = (error && error.message) || "связь с ботом потеряна";
    if (onReady) onReady();
  });
}
function conversationMessageHtml(message) {
  var icons = { photo: "🖼 Фотография", video: "🎬 Видео", voice: "🎙 Голосовое сообщение", audio: "🎵 Аудиофайл", document: "📎 Документ", location: "📍 Геолокация", contact: "👤 Контакт", sticker: "🙂 Стикер", other: "📎 Вложение" };
  var url = "/api/conversation-media/" + encodeURIComponent(message.id);
  var attachment = "";
  if (message.fileId && message.kind === "photo") attachment = '<a href="' + url + '" target="_blank" rel="noopener"><img class="conversation-photo" src="' + url + '" loading="lazy" alt="Фотография клиента"></a>';
  else if (message.fileId && message.kind === "voice") attachment = '<audio class="conversation-audio" controls preload="none" src="' + url + '"></audio>';
  else if (message.fileId && message.kind === "audio") attachment = '<audio class="conversation-audio" controls preload="none" src="' + url + '"></audio>';
  else if (message.fileId && message.kind === "video") attachment = '<video class="conversation-video" controls preload="metadata" src="' + url + '"></video>';
  else if (message.fileId) attachment = '<a class="btn ghost small" href="' + url + '" target="_blank" rel="noopener">Открыть файл</a>';
  var type = message.kind !== "text" ? '<div class="message-kind">' + esc(icons[message.kind] || icons.other) + (message.fileName ? " · " + esc(message.fileName) : "") + "</div>" : "";
  var reactions = message.reactions && message.reactions.length ? '<span class="message-reactions">' + esc(message.reactions.join(" ")) + "</span>" : "";
  var quote = message.replyToTelegramMessageId ? '<div class="message-quote-preview"><span>Ответ на сообщение</span>' + esc(message.replyToText || "Сообщение клиента") + "</div>" : "";
  var delivery = message.direction === "out" ? '<span class="message-delivery ' + (message.deliveryStatus === "failed" ? "bad" : "ok") + '">' + (message.deliveryStatus === "failed" ? "не доставлено" : "✓ доставлено") + "</span>" : "";
  var reply = message.direction === "in" && Number.isFinite(Number(message.telegramMessageId)) ? '<button class="message-reply-button" data-reply-target="' + esc(message.telegramMessageId) + '" type="button" title="Ответить на это сообщение" aria-label="Ответить на это сообщение">↩ Ответить</button>' : "";
  return '<div class="conversation-line ' + (message.direction === "out" ? "out" : "in") + '"><div class="msg ' + (message.direction === "out" ? "out" : "") + '">' + quote + type + attachment + (message.text ? '<div class="message-text">' + esc(message.text) + "</div>" : "") + '<div class="msg-meta"><span>' + esc(message.direction === "out" ? message.by || "панель" : "клиент") + " · " + dateTime(message.createdAt) + reactions + delivery + "</span>" + reply + "</div></div></div>";
}
function markConversationRead(userId) {
  var unread = false, now = new Date().toISOString();
  (state.inquiries || []).forEach(function (item) {
    if (String(item.userId) === String(userId) && inquiryUnread(item)) { item.readAt = now; unread = true; }
  });
  if (!unread) return;
  state.unreadConversationCount = Math.max(0, Number(state.unreadConversationCount || 0) - 1);
  renderNav();
  send("/api/conversations/" + encodeURIComponent(userId) + "/read", "POST", {}).catch(function (error) { fail(error); });
}

function renderInquiryCard(host) {
  var item = (state.inquiries || []).find(function (entry) { return entry.id === selectedInquiry; });
  if (!item) {
    host.innerHTML = '<div class="card"><div class="empty"><b>Выберите диалог</b>Здесь появится полная переписка с клиентом</div></div>';
    return;
  }
  var user = userOf(item);
  var related = (state.inquiries || []).filter(function (entry) { return String(entry.userId) === String(item.userId); }).sort(function (a, b) { return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0); });
  var property = item.propertyId ? (state.objects || []).find(function (record) { return record.id === item.propertyId; }) : null;
  var viewing = item.viewing || null;
  var managers = [state.config.adminName || "Администратор"].concat((state.config.managers || []).map(function (manager) { return manager.name; })).filter(function (name, index, all) { return name && all.indexOf(name) === index; });
  var timeline = conversationTimeline(item.userId);
  if (!timeline) {
    // Первый показ этой беседы: просим переписку и перерисовываем, когда придёт.
    loadConversation(item.userId, function () { renderInquiryCard(host); });
    timeline = [];
  }
  // Открыл человек — значит прочитал. Перерисовка того же экрана (обновление по
  // таймеру, смена фильтра) больше ничего не помечает.
  var openedByHuman = conversationOpenedByUser;
  if (conversationOpenedByUser) {
    conversationOpenedByUser = false;
    markConversationRead(item.userId);
  }
  host.innerHTML = '<div class="card conversation-card"><header class="conversation-head"><button class="btn ghost small conversation-back" id="backToList" type="button">← Диалоги</button><div class="conversation-person"><span class="conversation-avatar large">' + esc(initials(user.firstName)) + '</span><div><h3>' + esc(userName(user)) + '</h3><div class="small muted">' + (user.username ? "@" + esc(user.username) + " · " : "") + (user.phone ? esc(user.phone) + " · " : "") + "ID " + esc(user.id) + (user.source ? ' · источник: ' + esc(user.source) : "") + '</div></div></div><div class="actions">' + statusChip(item) + "</div></header>" +
    '<div class="card-body conversation-body conversation-split">' +
      '<div class="conversation-main">' +
      '<div class="conversation-context">' +
        (related.length > 1 ? '<div class="field grow"><label>Текущая заявка</label><select id="activeInquiry">' + related.map(function (entry) { return '<option value="' + esc(entry.id) + '"' + (entry.id === item.id ? " selected" : "") + '>' + esc(inquiryTypeName(entry)) + " · " + dateShort(entry.createdAt) + " · " + inquiryState(entry).text + "</option>"; }).join("") + "</select></div>" : '<div><span class="field-label">Текущая заявка</span><div class="conversation-context-title">' + esc(inquiryTypeName(item)) + " · " + dateTime(item.createdAt) + "</div></div>") +
        (property ? '<button class="property-link" id="linkedProperty" type="button">🏠 ' + esc(localized(property.title, "ru") || property.reference || property.id) + '<span>Открыть →</span></button>' : item.propertyId ? '<div class="chip bad">Связанный объект удалён</div>' : "") +
      '</div>' +
      viewingCardHtml(item, property) +
      '<div class="conversation-thread">' + (timeline.length
        ? timeline.map(conversationMessageHtml).join("")
        : conversationLoading[String(item.userId)] ? '<div class="empty"><b>Загружаем переписку…</b></div>'
          : conversationFailed[String(item.userId)]
            ? '<div class="empty"><b>Не удалось загрузить переписку</b>' + esc(conversationFailed[String(item.userId)]) + '<button class="btn secondary small" id="retryConversation" type="button">Повторить</button></div>'
            : '<div class="empty"><b>Сообщений пока нет</b></div>') + "</div>" +
      '<div class="reply-box"><div class="reply-box-head"><b>Ответить в Telegram</b>' +
        '<span class="small muted">' + ((state.replyTemplates || []).length ? "Шаблон — одним нажатием" : "") + "</span>" +
      '</div>' +
      // Шаблоны — кнопками, а не списком: на телефоне список открывался отдельным
      // окном, а выбранный шаблон стирал набранное. Кнопка вставляет текст и
      // ничего не затирает.
      ((state.replyTemplates || []).length ? '<div class="reply-templates" id="replyTemplates">' + state.replyTemplates.map(function (template) {
        return '<button class="btn secondary small template-chip" type="button" data-template="' + esc(template.id) + '" title="' + esc(String(localized(template.text, "ru") || "").slice(0, 120)) + '">' + esc(template.title) + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="reply-quote hidden" id="replyQuote"><div><span>Ответ на сообщение клиента</span><b id="replyQuoteText"></b></div><button class="reply-quote-remove" id="clearReplyQuote" type="button" aria-label="Убрать цитату">×</button></div>' +
      '<textarea id="replyText" maxlength="3800" placeholder="Напишите сообщение клиенту…"></textarea>' +
      '<div class="reply-attachments"><input class="hidden" id="replyFile" type="file" accept=".jpg,.jpeg,.png,.pdf,.txt,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,application/pdf,text/plain"><label class="btn secondary small" for="replyFile">📎 Добавить файл</label><span class="reply-file-name muted" id="replyFileName">Фотография до 5 МБ или документ до 10 МБ</span><button class="btn ghost small hidden" id="clearReplyFile" type="button">Убрать</button></div>' +
      '<details class="conversation-details"><summary><span><b>Кнопка-ссылка</b><small>клиент увидит её под сообщением</small></span><i>⌄</i></summary><div class="conversation-details-body"><div class="grid cols-2"><div class="field"><label for="replyButtonText">Текст кнопки</label><input id="replyButtonText" placeholder="Посмотреть объект"></div><div class="field"><label for="replyButtonUrl">Ссылка</label><input id="replyButtonUrl" placeholder="https://…"></div></div></div></details>' +
      '<div class="reply-delivery hidden" id="replyDelivery" aria-live="polite"><span id="replyDeliveryText"></span><button class="btn ghost small hidden" id="retryReply" type="button">Повторить отправку</button></div>' +
      '<div class="reply-actions"><button class="btn" id="sendReply" type="button">Отправить сообщение</button><span class="small muted">После ответа заявка станет «Отвечено». Закрыть её можно справа.</span></div></div>' +
      '</div>' +
      // Справа — всё, что менеджер меняет по этому клиенту. Одна панель, одна
      // кнопка сохранения: раньше статус сохранялся сам по нажатию, а этап,
      // заметка и теги — отдельно, и половина правок терялась.
      // На телефоне панель сворачивается под полем ответа: статус, этап, заметка
      // и «Сохранить» лежат прямо под ним, а не в конце длинной страницы.
      '<aside class="conversation-side"><details class="conversation-side-details" open><summary>Статус, этап и заметки</summary><div class="conversation-side-inner stack">' +
        selectionMatchingPanel(item) +
        (viewing ? '<div class="msg">📅 ' + esc((viewing.confirmedDate || viewing.dateText || "дата не выбрана") + " · " + (viewing.confirmedTime || viewing.timeText || "")) + (viewing.online ? "<br>📹 онлайн-показ по видеосвязи" : "") + (viewing.confirmedAt ? '<br><span class="small ok-text">просмотр подтверждён</span>' : '<br><span class="small warn-text">нужно подтвердить просмотр</span>') + "</div>" : "") +
        (viewing && !viewing.cancelledAt ? '<button class="btn secondary small" id="scheduleViewing" type="button">' + (viewing.confirmedAt ? "Перенести просмотр" : "Подтвердить и уведомить") + '</button>' : "") +
        // Статус один: «Ждёт ответа», «Отвечено» или «Закрыт». Первые два бот
        // ставит сам по переписке — руками остаётся только закрыть заявку или
        // открыть её снова. Этап сделки — отдельное необязательное поле ниже.
        '<div class="field"><label for="inqStatusValue">Статус</label><select id="inqStatusValue">' +
          [["open", item.status === "closed" ? "Открыть снова" : inquiryState(item).text], ["closed", "Закрыт"]].map(function (option) {
            return '<option value="' + option[0] + '"' + ((item.status === "closed" ? "closed" : "open") === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
          }).join("") + '</select></div>' +
        '<div class="field"><label for="inqPipeline">Этап сделки <span class="small faint">(по желанию)</span></label><select id="inqPipeline">' + pipelineStageOptions(pipelineStageOf(item), true) + '</select></div>' +
        '<div class="field"><label for="inqAssignee">Ответственный менеджер</label><select id="inqAssignee"><option value="">Не назначен</option>' + managers.map(function (name) { return '<option value="' + esc(name) + '"' + (item.assignee === name ? " selected" : "") + '>' + esc(name) + "</option>"; }).join("") + '</select></div>' +
        '<div class="row followup-fields"><div class="field grow"><label for="followDate">Следующий шаг</label><input type="date" id="followDate" value="' + esc(item.followUpDate || "") + '"></div><div class="field followup-time"><label for="followTime">Время</label><input type="time" id="followTime" value="' + esc(item.followUpTime || "") + '"></div></div>' +
        '<div class="field"><label for="inqNote">Заметка по этой заявке</label><textarea id="inqNote" placeholder="Что важно сделать по заявке">' + esc(item.note || "") + "</textarea></div>" +
        '<div class="field"><label for="clientTagsInq">Теги клиента</label><input id="clientTagsInq" value="' + esc((user.tags || []).join(", ")) + '" placeholder="покупка, горячий лид"></div>' +
        '<div class="field"><label for="clientNoteInq">Общая заметка о клиенте</label><textarea id="clientNoteInq" placeholder="Предпочтения, договорённости и важные детали">' + esc(user.note || "") + "</textarea></div>" +
        '<div class="conversation-save"><button class="btn" id="saveInq" type="button">Сохранить</button><button class="btn ghost small" id="openClientCard" type="button">Карточка клиента</button><button class="btn ghost small" id="inquiryExtras" type="button">⋯ Ещё</button></div>' +
      '</div></details></aside>' +
    "</div></div>";

  // Переписку открываем на последнем сообщении: читают всегда конец разговора,
  // а начало было видно месяц назад. Раньше беседа открывалась на самом старом
  // сообщении, и до нового приходилось листать.
  var thread = host.querySelector(".conversation-thread");
  if (thread && typeof thread.scrollHeight === "number") thread.scrollTop = thread.scrollHeight;
  // На узком экране список и беседа идут друг под другом: выбрал беседу —
  // покажи её, иначе менеджер остаётся смотреть на список и не понимает, что
  // что-то открылось.
  if (window.innerWidth <= 860) {
    // Панель заявки на телефоне закрыта, пока не понадобится.
    var sideDetails = host.querySelector(".conversation-side-details");
    if (sideDetails) sideDetails.open = false;
    // Открыли диалог — сразу конец переписки и поле ответа: последнее сообщение
    // над полем, без прокрутки через шапку и панель заявки.
    var replyBox = host.querySelector(".reply-box");
    if (openedByHuman && replyBox && replyBox.scrollIntoView) replyBox.scrollIntoView({ block: "end" });
  }

  var backToList = host.querySelector("#backToList");
  if (backToList) backToList.onclick = function () {
    selectConversation("");
    renderInquiryList(el("viewBody"));
  };
  var retryConversation = host.querySelector("#retryConversation");
  if (retryConversation) retryConversation.onclick = function () {
    delete conversationFailed[String(item.userId)];
    renderInquiryCard(host);
  };
  var activeInquiry = host.querySelector("#activeInquiry");
  if (activeInquiry) activeInquiry.onchange = function () { selectConversation(activeInquiry.value); renderInquiryList(el("viewBody")); };
  var linkedProperty = host.querySelector("#linkedProperty");
  if (linkedProperty) linkedProperty.onclick = function () { openRecordEditor("objects", property.id); };

  host.querySelectorAll("[data-match-property]").forEach(function (button) {
    button.onclick = function () { openRecordEditor("objects", button.dataset.matchProperty); };
  });

  var replyTarget = null;
  var replyAttachment = null;
  var replyRequestId = "";
  var replyText = host.querySelector("#replyText");
  var replyFile = host.querySelector("#replyFile");
  var replyDelivery = host.querySelector("#replyDelivery");
  var replyDeliveryText = host.querySelector("#replyDeliveryText");
  var retryReply = host.querySelector("#retryReply");
  function freshRequest() {
    replyRequestId = "";
    replyDelivery.classList.add("hidden");
    replyDelivery.classList.remove("ok", "bad");
    retryReply.classList.add("hidden");
  }
  function requestId() {
    if (!replyRequestId) replyRequestId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "reply-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    return replyRequestId;
  }
  function showReplyTarget(message) {
    replyTarget = message || null;
    var box = host.querySelector("#replyQuote");
    box.classList.toggle("hidden", !replyTarget);
    host.querySelector("#replyQuoteText").textContent = replyTarget ? (replyTarget.text || replyTarget.fileName || "Вложение клиента") : "";
    freshRequest();
    if (replyTarget) replyText.focus();
  }
  function showAttachment() {
    host.querySelector("#replyFileName").textContent = replyAttachment ? replyAttachment.name : "Фотография до 5 МБ или документ до 10 МБ";
    host.querySelector("#clearReplyFile").classList.toggle("hidden", !replyAttachment);
  }
  host.querySelectorAll("[data-reply-target]").forEach(function (button) {
    button.onclick = function () {
      var target = timeline.find(function (message) { return Number(message.telegramMessageId) === Number(button.dataset.replyTarget) && message.direction === "in"; });
      showReplyTarget(target);
    };
  });
  host.querySelector("#clearReplyQuote").onclick = function () { showReplyTarget(null); };
  host.querySelector("#clearReplyFile").onclick = function () { replyAttachment = null; replyFile.value = ""; showAttachment(); freshRequest(); };
  replyFile.onchange = function () {
    var file = replyFile.files && replyFile.files[0];
    if (!file) return;
    var name = String(file.name || "");
    var image = /\.(?:jpe?g|png)$/i.test(name);
    var documentFile = /\.(?:pdf|txt|docx?|xlsx?)$/i.test(name);
    var maximum = image ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if ((!image && !documentFile) || file.size > maximum) {
      replyFile.value = "";
      return toast(!image && !documentFile ? "Можно отправить фотографию или документ: PDF, Word, Excel, текст" : "Файл превышает допустимый размер", true);
    }
    var reader = new FileReader();
    reader.onload = function () { replyAttachment = { kind: image ? "image" : "document", name: name, dataUrl: String(reader.result || "") }; showAttachment(); freshRequest(); };
    reader.onerror = function () { replyFile.value = ""; toast("Не удалось прочитать файл", true); };
    reader.readAsDataURL(file);
  };
  async function sendReply() {
    var text = replyText.value.trim();
    if (!text && !replyAttachment) return toast("Введите сообщение или добавьте файл", true);
    if (replyAttachment && text.length > 800) return toast("С вложением подпись должна быть не длиннее 800 знаков", true);
    var button = host.querySelector("#sendReply");
    var payload = {
      text: text,
      clientRequestId: requestId(),
      buttonText: host.querySelector("#replyButtonText").value,
      buttonUrl: host.querySelector("#replyButtonUrl").value,
    };
    if (replyTarget) payload.replyToMessageId = replyTarget.telegramMessageId;
    if (replyAttachment && replyAttachment.kind === "image") { payload.imageDataUrl = replyAttachment.dataUrl; payload.imageName = replyAttachment.name; }
    if (replyAttachment && replyAttachment.kind === "document") { payload.documentDataUrl = replyAttachment.dataUrl; payload.documentName = replyAttachment.name; }
    button.disabled = true;
    button.textContent = "Отправляем…";
    replyDelivery.classList.remove("hidden", "ok", "bad");
    replyDeliveryText.textContent = "Отправляем сообщение в Telegram…";
    retryReply.classList.add("hidden");
    try {
      var result = await send("/api/inquiries/" + encodeURIComponent(item.id) + "/reply", "POST", payload);
      forgetConversation(item.userId);
      replyDelivery.classList.add("ok");
      replyDeliveryText.textContent = result.duplicate ? "✓ Сообщение уже было доставлено" : "✓ Доставлено в Telegram";
      toast(result.duplicate ? "Сообщение уже было доставлено" : "Ответ доставлен");
      // Остаёмся в той же беседе и на том же месте страницы.
      await reload(true, { keepScroll: true });
    } catch (error) {
      replyDelivery.classList.add("bad");
      replyDeliveryText.textContent = "Не отправлено: " + (error.message || "неизвестная ошибка");
      retryReply.classList.remove("hidden");
      toast("Сообщение не отправлено. Черновик сохранён.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Отправить сообщение";
    }
  }
  host.querySelector("#sendReply").onclick = sendReply;
  retryReply.onclick = sendReply;
  replyText.oninput = freshRequest;
  host.querySelectorAll("#replyTemplates [data-template]").forEach(function (button) {
    button.onclick = function () {
      var template = (state.replyTemplates || []).find(function (entry) { return entry.id === button.dataset.template; });
      if (!template) return;
      var text = localized(template.text, item.language || "ru") || template.text.ru || "";
      if (!text) return;
      replyText.value = withTemplate(replyText.value, text);
      freshRequest();
      if (replyText.focus) replyText.focus();
      // Курсор — в конец вставленного: можно сразу дописать своё.
      if (replyText.setSelectionRange) replyText.setSelectionRange(replyText.value.length, replyText.value.length);
    };
  });
  host.querySelector("#openClientCard").onclick = function () { openClient(String(item.userId)); };
  host.querySelector("#saveInq").onclick = async function () {
    try {
      // Статус и этап шлём, только если человек их изменил: неизменный этап
      // «Выиграно» вместе со статусом «Открыта» затирал бы одно другим.
      var patch = {
        note: host.querySelector("#inqNote").value,
        followUpDate: host.querySelector("#followDate").value,
        followUpTime: host.querySelector("#followTime").value,
        assignee: host.querySelector("#inqAssignee").value,
      };
      var wantClosed = host.querySelector("#inqStatusValue").value === "closed";
      if (wantClosed !== (item.status === "closed")) patch.status = wantClosed ? "closed" : "in_progress";
      var wantStage = host.querySelector("#inqPipeline").value;
      if (wantStage !== pipelineStageOf(item)) patch.pipelineStage = wantStage;
      await send("/api/inquiries/" + encodeURIComponent(item.id), "PATCH", patch);
      await send("/api/users/" + encodeURIComponent(user.id), "PATCH", {
        note: host.querySelector("#clientNoteInq").value,
        tags: host.querySelector("#clientTagsInq").value.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean),
      });
      toast("Сохранено");
      await reload(true, { keepScroll: true });
    } catch (error) { fail(error); }
  };
  host.querySelector("#inquiryExtras").onclick = function () {
    openDialog({
      title: "Ещё действия по заявке",
      body: '<div class="stack"><button class="btn danger" id="extraDelete" type="button">Удалить заявку</button>' +
        '<span class="small muted">Заявка исчезнет из панели. Переписка в Telegram останется.</span></div>',
      footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button>',
      ready: function (dialog) {
        dialog.querySelector("#extraDelete").onclick = async function () {
          if (!(await confirmDialog("Удалить заявку?", "Она исчезнет из панели. Переписка в Telegram останется.", "Удалить", true))) return;
          try {
            await api("/api/inquiries/" + encodeURIComponent(item.id), { method: "DELETE" });
            dialog.closeClean();
            selectConversation("");
            toast("Удалено");
            await reload();
          } catch (error) { fail(error); }
        };
      },
    });
  };
  var scheduleButton = host.querySelector("#scheduleViewing");
  if (scheduleButton) scheduleButton.onclick = function () { openViewingSchedule(item); };
  var inlineViewing = host.querySelector("#confirmViewingInline");
  if (inlineViewing) inlineViewing.onclick = function () { openViewingSchedule(item); };
}

// --- Просмотры ----------------------------------------------------------------
function viewingDateKey(item) {
  var viewing = item && item.viewing || {};
  var value = viewing.confirmedDate || viewing.date || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
function viewingDateAdd(key, days) {
  var date = new Date(String(key) + "T12:00:00Z");
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function viewingWeekStart() {
  var today = pipelineToday();
  var date = new Date(today + "T12:00:00Z");
  var fromMonday = (date.getUTCDay() + 6) % 7;
  return viewingDateAdd(today, -fromMonday + viewingWeekOffset * 7);
}
function viewingDayLabel(key) {
  try {
    var date = new Date(key + "T12:00:00Z");
    return {
      weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", ""),
      day: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(date).replace(".", ""),
    };
  } catch (error) { return { weekday: "", day: key }; }
}
function viewingRangeLabel(start) {
  var first = viewingDayLabel(start).day;
  var last = viewingDayLabel(viewingDateAdd(start, 6)).day;
  return first + " — " + last;
}
function viewingTimeLabel(item) {
  var viewing = item.viewing || {};
  return viewing.confirmedTime || viewing.timeText || "Время уточняется";
}
function viewingProperty(item) {
  return (state.objects || []).find(function (record) { return String(record.id) === String(item.propertyId); });
}
function viewingStatus(item, today) {
  var key = viewingDateKey(item);
  if (item.viewing.cancelledAt) return { key: "cancelled", text: "Отменён", chip: "", event: "cancelled" };
  if (item.status === "closed") return { key: "closed", text: "Закрыт", chip: "", event: "cancelled" };
  if (!item.viewing.confirmedAt) return { key: "pending", text: key && key < today ? "Просрочено" : "Ждёт подтверждения", chip: key && key < today ? "bad" : "warn", event: "pending" };
  if (key && key < today) return { key: "past", text: "Проведён", chip: "", event: "past" };
  return { key: "confirmed", text: "Подтверждён", chip: "ok", event: "confirmed" };
}
function viewingSort(a, b) {
  var aKey = viewingDateKey(a) || "9999-99-99";
  var bKey = viewingDateKey(b) || "9999-99-99";
  if (aKey !== bKey) return aKey.localeCompare(bKey);
  return viewingTimeLabel(a).localeCompare(viewingTimeLabel(b), "ru");
}
// Онлайн-показ по видеосвязи: менеджеру надо видеть это сразу, чтобы не
// готовить адрес и ключи.
function viewingOnlineTag(item) {
  return item && item.viewing && item.viewing.online ? ' <span class="chip brand">📹 онлайн</span>' : "";
}
function viewingEventHtml(item, today, compact) {
  var user = userOf(item), property = viewingProperty(item), status = viewingStatus(item, today);
  return '<article class="viewing-event ' + status.event + '">' +
    '<div class="viewing-event-head"><b class="viewing-event-time">' + esc(viewingTimeLabel(item)) + '</b><span class="chip ' + status.chip + '">' + esc(status.text) + '</span></div>' +
    '<div class="viewing-event-client">' + esc(userName(user)) + '</div>' +
    '<div class="viewing-event-property">⌂ ' + esc(property ? localized(property.title, "ru") || property.reference || property.id : "Объект не найден") + viewingOnlineTag(item) + '</div>' +
    (!compact && user.phone ? '<div class="small muted">' + esc(user.phone) + '</div>' : "") +
    '<div class="viewing-event-actions"><button class="btn ghost small" data-viewing-open="' + esc(item.id) + '" type="button">Заявка</button>' +
    (!item.viewing.cancelledAt && item.status !== "closed" ? '<button class="btn secondary small" data-viewing-schedule="' + esc(item.id) + '" type="button">' + (item.viewing.confirmedAt ? "Перенести" : "Подтвердить") + '</button>' : "") + '</div></article>';
}
function openViewingSchedule(item) {
  var viewing = item.viewing || {}, user = userOf(item), property = viewingProperty(item);
  // Дату не подставляем «сегодняшним числом»: если из просьбы клиента бот её не
  // разобрал, одно нажатие «Подтвердить» отправляло клиенту сегодняшний день, о
  // котором он не просил. Пустое поле заставляет выбрать дату осознанно.
  var currentDate = viewingDateKey(item);
  var currentTime = viewing.confirmedTime || (/^\d{2}:\d{2}$/.test(viewing.timeText || "") ? viewing.timeText : "");
  var moving = Boolean(viewing.confirmedAt);
  // Своими словами клиента: «в субботу после обеда». Менеджер должен видеть, о
  // чём просили, а не только поля даты и времени.
  var requested = [viewing.dateText, viewing.timeText].filter(Boolean).join(" · ");
  openDialog({
    title: moving ? "Перенести просмотр" : "Подтвердить просмотр",
    protectChanges: true,
    body: '<div class="stack"><div class="viewing-dialog-context"><span class="conversation-avatar">' + esc(initials(user.firstName)) + '</span><div><b>' + esc(userName(user)) + '</b><span>' + esc(property ? localized(property.title, "ru") || property.reference || property.id : "Объект не найден") + '</span></div></div>' +
      (requested ? '<div class="msg">📝 Клиент просил: ' + esc(requested) + '</div>' : '') +
      (viewing.online ? '<div class="msg">📹 Клиент выбрал онлайн-показ по видеосвязи: адрес ему не отправится, ссылку на видеосвязь пришлите в переписке.</div>' : '') +
      (currentDate ? '' : '<div class="msg attention">Дату из просьбы клиента бот не разобрал — выберите её сами. Клиент получит именно то, что здесь указано.</div>') +
      '<div class="grid cols-2"><div class="field"><label for="viewingScheduleDate">Дата</label><input id="viewingScheduleDate" type="date" min="' + esc(pipelineToday()) + '" value="' + esc(currentDate) + '"></div><div class="field"><label for="viewingScheduleTime">Время</label><input id="viewingScheduleTime" type="time" value="' + esc(currentTime) + '"><div class="quick-times">' + VIEWING_QUICK_TIMES.map(function (time) { return '<button class="btn ghost small" type="button" data-quick-time="' + time + '">' + time + '</button>'; }).join("") + '</div></div></div>' +
      '<div class="msg">После сохранения клиент получит ' + (moving ? "обновлённые" : "подтверждённые") + ' дату и время в Telegram.</div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveViewingSchedule" type="button">' + (moving ? "Перенести и уведомить" : "Подтвердить и уведомить") + '</button>',
    ready: function (dialog) {
      var dateInput = dialog.querySelector("#viewingScheduleDate");
      var timeInput = dialog.querySelector("#viewingScheduleTime");
      var save = dialog.querySelector("#saveViewingSchedule");
      save.onclick = async function () {
        if (!dateInput.value || !timeInput.value) return toast("Укажите дату и время просмотра", true);
        if (dateInput.value < pipelineToday()) return toast("Нельзя назначить просмотр на прошедшую дату", true);
        save.disabled = true;
        try {
          await send("/api/inquiries/" + encodeURIComponent(item.id) + "/viewing", "POST", { date: dateInput.value, time: timeInput.value });
          dialog.closeClean();
          toast(moving ? "Просмотр перенесён, клиент уведомлён" : "Просмотр подтверждён, клиент уведомлён");
          await reload();
        } catch (error) { save.disabled = false; fail(error); }
      };
      // Время одной кнопкой: набирать «12:00» руками ради обычного часа лишнее.
      dialog.querySelectorAll("[data-quick-time]").forEach(function (button) {
        button.onclick = function () { timeInput.value = button.dataset.quickTime; };
      });
      dateInput.focus();
    },
  });
}
function viewingHistoryHtml(rows, today) {
  if (!rows.length) return '<div class="card"><div class="empty"><b>История пока пуста</b>Здесь появятся прошедшие, закрытые и отменённые просмотры</div></div>';
  return '<div class="card"><div class="viewing-history">' + rows.slice(0, 80).map(function (item) {
    var key = viewingDateKey(item), label = key ? viewingDayLabel(key).day : item.viewing.dateText || "Дата не указана";
    return '<div class="viewing-history-row"><div class="viewing-history-date"><b>' + esc(label) + '</b><span>' + esc(viewingTimeLabel(item)) + '</span></div>' + viewingEventHtml(item, today, true) + '</div>';
  }).join("") + '</div></div>';
}
function renderViewings(host) {
  screenSettled();
  var today = pipelineToday();
  var rows = (state.inquiries || []).filter(function (item) { return item.type === "viewing" && item.viewing; });
  var active = rows.filter(function (item) { return !item.viewing.cancelledAt && item.status !== "closed"; });
  var pending = active.filter(function (item) { return !item.viewing.confirmedAt; }).sort(viewingSort);
  var upcoming = active.filter(function (item) { var key = viewingDateKey(item); return key && key >= today; });
  var todayRows = active.filter(function (item) { return viewingDateKey(item) === today; });
  var weekEnd = viewingDateAdd(today, 6);
  var nextSeven = active.filter(function (item) { var key = viewingDateKey(item); return key && key >= today && key <= weekEnd; });
  var history = rows.filter(function (item) { var key = viewingDateKey(item); return item.viewing.cancelledAt || item.status === "closed" || Boolean(item.viewing.confirmedAt && key && key < today); }).sort(function (a, b) { return -viewingSort(a, b); });
  var start = viewingWeekStart();
  var days = Array.from({ length: 7 }, function (_, index) { return viewingDateAdd(start, index); });
  var calendarRows = active.filter(function (item) { var key = viewingDateKey(item); return key && key >= start && key <= days[6]; }).sort(viewingSort);
  var withoutDate = active.filter(function (item) { return !viewingDateKey(item); });
  if (!viewingModeChosen) viewingMode = pending.length ? "pending" : "calendar";
  var body = "";
  if (viewingMode === "pending") {
    body = pending.length ? '<div class="viewing-pending-list">' + pending.map(function (item) {
      var key = viewingDateKey(item), requested = key ? viewingDayLabel(key).day + " · " + viewingTimeLabel(item) : (item.viewing.dateText || "Дата требует уточнения") + " · " + viewingTimeLabel(item);
      return '<div class="card viewing-pending-card"><div><span class="chip ' + (key && key < today ? "bad" : "warn") + '">' + (key && key < today ? "Просрочено" : "Ждёт подтверждения") + '</span><h3>' + esc(userName(userOf(item))) + '</h3><p>' + esc(localized(viewingProperty(item) && viewingProperty(item).title, "ru") || "Объект не найден") + viewingOnlineTag(item) + '</p><small>Запрошено: ' + esc(requested) + '</small></div><div class="viewing-pending-actions"><button class="btn ghost small" data-viewing-open="' + esc(item.id) + '" type="button">Открыть заявку</button><button class="btn" data-viewing-schedule="' + esc(item.id) + '" type="button">Подтвердить и уведомить</button></div></div>';
    }).join("") + '</div>' : '<div class="card"><div class="empty"><b>Все просмотры подтверждены</b>Новых записей, ожидающих ответа менеджера, нет</div></div>';
  } else if (viewingMode === "history") {
    body = viewingHistoryHtml(history, today);
  } else {
    body = '<div class="card viewing-calendar-card"><header><div><h3>Неделя</h3><div class="small muted">' + esc(viewingRangeLabel(start)) + '</div></div><div class="viewing-week-nav"><button class="btn secondary small" data-viewing-week="-1" type="button" aria-label="Предыдущая неделя">←</button><button class="btn ghost small" data-viewing-today type="button">Сегодня</button><button class="btn secondary small" data-viewing-week="1" type="button" aria-label="Следующая неделя">→</button></div></header><div class="viewing-calendar-shell"><div class="viewing-calendar">' + days.map(function (key) {
      var label = viewingDayLabel(key), items = calendarRows.filter(function (item) { return viewingDateKey(item) === key; });
      return '<section class="viewing-day' + (key === today ? " today" : "") + '"><div class="viewing-day-head"><span>' + esc(label.weekday) + '</span><b>' + esc(label.day) + '</b><i>' + items.length + '</i></div><div class="viewing-day-body">' + (items.length ? items.map(function (item) { return viewingEventHtml(item, today, true); }).join("") : '<div class="viewing-day-empty">Нет просмотров</div>') + '</div></section>';
    }).join("") + '</div></div></div>' + (withoutDate.length ? '<div class="card viewing-unscheduled"><header><div><h3>Требуется уточнить дату</h3><div class="small muted">Записи, которые нельзя поставить в календарь автоматически</div></div><span class="chip warn">' + withoutDate.length + '</span></header><div class="viewing-unscheduled-grid">' + withoutDate.map(function (item) { return viewingEventHtml(item, today, false); }).join("") + '</div></div>' : "");
  }
  host.innerHTML = numberStrip([
      ["Сегодня", num(todayRows.length)],
      ["Ближайшие 7 дней", num(nextSeven.length)],
      ["Ждут подтверждения", num(pending.length), pending.length ? "bad" : "", "Нужно ответить клиентам"],
      ["Подтверждено", num(upcoming.filter(function (item) { return item.viewing.confirmedAt; }).length), "", "Предстоящих"],
    ]) + '<div class="viewing-toolbar"><div class="tabs"><button class="' + (viewingMode === "calendar" ? "active" : "") + '" data-viewing-mode="calendar" type="button">Календарь</button><button class="' + (viewingMode === "pending" ? "active" : "") + '" data-viewing-mode="pending" type="button">Ждут подтверждения <span>' + pending.length + '</span></button><button class="' + (viewingMode === "history" ? "active" : "") + '" data-viewing-mode="history" type="button">История</button></div><span class="small muted">Время: ' + esc(timeZoneName()) + '</span></div>' + body;
  host.querySelectorAll("[data-viewing-mode]").forEach(function (button) { button.onclick = function () { viewingModeChosen = true; viewingMode = button.dataset.viewingMode; renderViewings(host); }; });
  host.querySelectorAll("[data-viewing-week]").forEach(function (button) { button.onclick = function () { viewingWeekOffset += Number(button.dataset.viewingWeek); renderViewings(host); }; });
  var todayButton = host.querySelector("[data-viewing-today]");
  if (todayButton) todayButton.onclick = function () { viewingWeekOffset = 0; renderViewings(host); };
  host.querySelectorAll("[data-viewing-open]").forEach(function (button) { button.onclick = function () { openInquiry(button.dataset.viewingOpen); }; });
  host.querySelectorAll("[data-viewing-schedule]").forEach(function (button) { button.onclick = function () { var item = rows.find(function (entry) { return entry.id === button.dataset.viewingSchedule; }); if (item) openViewingSchedule(item); }; });
}

// --- Клиенты --------------------------------------------------------------------
function clientActiveInquiry(inquiries) {
  return inquiries.find(function (item) { return item.status !== "closed"; }) || inquiries[0] || null;
}
function clientOpenInquiry(inquiries) {
  return inquiries.find(function (item) { return item.status !== "closed"; }) || null;
}
function clientStageLabel(item) {
  var key = pipelineStageOf(item);
  var stage = PIPELINE_STAGES.find(function (entry) { return entry[0] === key; });
  return stage ? stage[1] : "Этап не задан";
}
function clientPropertyRows(user) {
  var labels = {};
  function add(ids, label) {
    (ids || []).forEach(function (id) {
      id = String(id);
      labels[id] = labels[id] || [];
      if (labels[id].indexOf(label) < 0) labels[id].push(label);
    });
  }
  add(user.favorites, "избранное");
  add(user.comparisonIds, "сравнение");
  add(user.recentlyViewed, "просмотрено");
  add(user.selectionMatchIds, "подходит по запросу");
  return Object.keys(labels).map(function (id) {
    var property = (state.objects || []).find(function (record) { return String(record.id) === id; });
    return property ? { property: property, labels: labels[id] } : null;
  }).filter(Boolean).slice(0, 16);
}
function clientPropertiesHtml(user) {
  var rows = clientPropertyRows(user);
  if (!rows.length) return '<div class="empty"><b>Интересы ещё не сформированы</b>Здесь появятся избранные, просмотренные и подходящие объекты</div>';
  return '<div class="client-properties">' + rows.map(function (row) {
    var record = row.property;
    var price = record.priceValue ? money(record.priceValue, record.currency) : localized(record.price, "ru") || "цена по запросу";
    return '<button class="client-property" data-client-object="' + esc(record.id) + '" type="button"><span class="client-property-title"><b>' + esc(localized(record.title, "ru") || record.reference || record.id) + '</b><small>' + esc(row.labels.join(" · ")) + '</small></span><span class="client-property-price">' + esc(price) + '</span><span>→</span></button>';
  }).join("") + "</div>";
}
function clientSelectionText(inquiries) {
  var request = inquiries.find(function (item) { return item.type === "selection" && item.selection; });
  if (!request) return "Условия подбора пока не оставлены";
  var values = request.selection || {};
  return [values.deal, values.type, values.location, values.budget, values.bedrooms].filter(Boolean).join(" · ") || "Условия подбора пока не оставлены";
}

// Список клиентов показываем порциями: на тысячах строк браузер заметно
// задумывается, а молча обрывать список на трёхстах — обманывать владельца.
var CLIENTS_PAGE = 300;
var clientsShown = CLIENTS_PAGE;

function renderClients(host) {
  screenSettled();
  var rows = (state.users || []).map(function (user) {
    var inquiries = (state.inquiries || []).filter(function (item) { return String(item.userId) === user.id; });
    return { user: user, inquiries: inquiries, latest: clientActiveInquiry(inquiries), active: clientOpenInquiry(inquiries) };
  }).filter(function (row) {
    var user = row.user;
    if (clientStageFilter && pipelineStageOf(row.latest) !== clientStageFilter) return false;
    if (!clientSearch) return true;
    var haystack = (userName(user) + " " + (user.username || "") + " " + (user.phone || "") + " " + (user.id || "")).toLowerCase();
    return haystack.indexOf(clientSearch.toLowerCase()) >= 0;
  });
  host.innerHTML = '<div class="toolbar">' +
      '<select id="clientStage"><option value="">Все этапы</option>' + PIPELINE_STAGES.map(function (stage) { return '<option value="' + stage[0] + '"' + (clientStageFilter === stage[0] ? " selected" : "") + '>' + stage[1] + "</option>"; }).join("") + '</select><span class="small faint">Показано ' + num(rows.length) + " из " + num(state.userCount) + " · активных " + num(state.activeUserCount) + '</span><div class="grow"></div><button class="btn secondary small" id="exportClients" type="button" title="Таблица с теми, кого вы видите на экране: для обзвона, отчёта или переноса">⬇ В Excel</button></div>' +
    '<div class="card"><div class="table-wrap"><table class="table-cards clients-table"><thead><tr><th>Клиент</th><th>Источник и язык</th><th>Этап работы</th><th>Следующий шаг</th><th class="right">Последняя активность</th></tr></thead><tbody>' +
    (rows.length ? rows.slice(0, clientsShown).map(function (row) {
      var user = row.user, latest = row.latest, active = row.active;
      return '<tr class="clickable" data-id="' + esc(user.id) + '"><td><div class="row"><span class="avatar">' + esc(initials(user.firstName)) + "</span><span><b>" + esc(userName(user)) + "</b>" +
        (user.username ? ' <span class="small faint">@' + esc(user.username) + "</span>" : "") +
        (user.phone ? '<br><span class="small faint">' + esc(user.phone) + "</span>" : "") + "</span></div></td>" +
        "<td>" + esc(user.source || "без метки") + ' <span class="chip">' + esc((user.preferredLanguage || "—").toUpperCase()) + "</span>" + (user.blocked ? ' <span class="chip bad">недоступен</span>' : "") + "</td>" +
        "<td>" + (latest ? '<span class="chip brand">' + esc(clientStageLabel(latest)) + "</span>" : "—") + "</td>" +
        "<td>" + (active && active.followUpDate ? '<span class="chip ' + (active.followUpDate <= pipelineToday() ? "bad" : "") + '">' + pipelineDate(active.followUpDate) + (active.followUpTime ? " · " + esc(active.followUpTime) : "") + "</span>" : "—") + "</td>" +
        '<td class="right small faint nowrap">' + ago(user.lastSeenAt) + "</td></tr>";
    }).join("") : '<tr><td colspan="5"><div class="empty"><b>Никого не найдено</b></div></td></tr>') +
    "</tbody></table></div>" +
    (rows.length > clientsShown
      ? '<div class="card-body row"><span class="small faint">Показаны первые ' + num(clientsShown) + " из " + num(rows.length) + '</span><div class="grow"></div><button class="btn secondary small" id="moreClients" type="button">Показать ещё ' + num(Math.min(CLIENTS_PAGE, rows.length - clientsShown)) + "</button></div>"
      : "") +
    "</div>";
  host.querySelector("#exportClients").onclick = function () { exportClients(rows.map(function (row) { return row.user.id; })); };
  var moreClients = host.querySelector("#moreClients");
  if (moreClients) moreClients.onclick = function () { clientsShown += CLIENTS_PAGE; renderClients(host); };
  host.querySelector("#clientStage").onchange = function (event) { clientStageFilter = event.target.value; clientsShown = CLIENTS_PAGE; renderClients(host); };
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    row.onclick = function () { openClient(row.dataset.id); };
  });
}

function openClient(id) {
  var user = (state.users || []).find(function (entry) { return entry.id === id; });
  if (!user) return;
  var inquiries = (state.inquiries || []).filter(function (item) { return String(item.userId) === id; }).sort(function (a, b) { return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0); });
  var latest = clientActiveInquiry(inquiries);
  var active = clientOpenInquiry(inquiries);
  openDialog({
    title: userName(user),
    drawer: true,
    wide: true,
    protectChanges: true,
    body: '<div class="client-profile"><aside class="client-profile-side"><div class="client-profile-identity"><span class="conversation-avatar client-avatar">' + esc(initials(user.firstName)) + '</span><div><h2>' + esc(userName(user)) + '</h2><span class="small muted">ID ' + esc(user.id) + (user.username ? " · @" + esc(user.username) : "") + '</span></div></div>' +
      '<div class="client-facts"><div><span>Источник</span><b>' + esc(user.source || "без метки") + '</b></div><div><span>Первый контакт</span><b>' + dateTime(user.firstSeenAt) + '</b></div><div><span>Последняя активность</span><b>' + dateTime(user.lastSeenAt) + '</b></div>' + (latest ? '<div><span>Последний этап</span><b>' + esc(clientStageLabel(latest)) + '</b></div>' : "") + '</div>' +
      '<div class="client-edit stack"><div class="grid cols-2"><div class="field"><label for="clientContactName">Имя для связи</label><input id="clientContactName" data-client-edit value="' + esc(user.contactName || userName(user)) + '"></div><div class="field"><label for="clientLanguage">Язык</label><select id="clientLanguage" data-client-edit><option value="">Не выбран</option>' + [["ru", "Русский"], ["en", "English"], ["es", "Español"]].map(function (language) { return '<option value="' + language[0] + '"' + (user.preferredLanguage === language[0] ? " selected" : "") + '>' + language[1] + "</option>"; }).join("") + '</select></div></div><div class="field"><label for="clientPhone">Телефон</label><input id="clientPhone" data-client-edit value="' + esc(user.phone || "") + '" placeholder="+34 …"></div><div class="field"><label for="clientContactTime">Когда удобно связаться</label><input id="clientContactTime" data-client-edit value="' + esc(user.preferredContactTime || "") + '"></div><div class="field"><label for="clientTags">Теги через запятую</label><input id="clientTags" data-client-edit value="' + esc((user.tags || []).join(", ")) + '"></div><div class="field"><label for="clientNote">Общая заметка</label><textarea id="clientNote" data-client-edit>' + esc(user.note || "") + '</textarea></div><label class="check"><input type="checkbox" id="clientBlocked" data-client-edit' + (user.blocked ? " checked" : "") + '> не писать этому клиенту</label></div></aside>' +
      '<main class="client-profile-main"><div class="grid cols-4">' + kpiCard("Сообщений", num(user.messages)) + kpiCard("Заявок", num(inquiries.length)) + kpiCard("Избранное", num((user.favorites || []).length)) + kpiCard("Просмотрено", num((user.recentlyViewed || []).length)) + '</div>' +
      '<section class="card client-message-box"><header><div><h3>Написать клиенту</h3><span class="small muted">Сообщение уходит в общую переписку</span></div>' + (user.blocked || !user.chatId ? '<span class="chip bad">отправка недоступна</span>' : '<span class="chip ok">Telegram доступен</span>') + '</header><div class="card-body stack"><div class="small muted">Шаблоны, файлы, цитата и кнопка-ссылка — всё в одной форме на экране переписки.</div><button class="btn" id="clientWrite" type="button"' + (user.blocked || !user.chatId ? " disabled" : "") + '>Открыть диалог →</button></div></section>' +
      '<div class="grid cols-2 client-interest-grid"><section class="card"><header><h3>Запрос клиента</h3></header><div class="card-body stack"><div><span class="field-label">Сохранённый поиск</span><div>' + esc(savedSearchSummary(user)) + '</div></div><div><span class="field-label">Последняя заявка на подбор</span><div>' + esc(clientSelectionText(inquiries)) + '</div></div></div></section><section class="card"><header><h3>Следующее действие</h3></header><div class="card-body">' + (active ? '<div class="stack"><div class="row wrap"><span class="chip brand">' + esc(clientStageLabel(active)) + '</span>' + (active.assignee ? '<span class="chip">' + esc(active.assignee) + '</span>' : '<span class="chip warn">менеджер не назначен</span>') + '</div><div>' + (active.followUpDate ? "Связаться: " + pipelineDate(active.followUpDate) + (active.followUpTime ? " в " + esc(active.followUpTime) : "") : "Следующий шаг не назначен") + '</div><button class="btn secondary small" id="clientOpenTask" type="button">Открыть заявку</button></div>' : '<div class="empty"><b>Активных заявок нет</b></div>') + '</div></section></div>' +
      '<section class="card"><header><h3>Объекты и интересы</h3><div class="actions"><span class="small faint">избранное · сравнение · история · подбор</span></div></header>' + clientPropertiesHtml(user) + '</section>' +
      '<section class="card"><header><h3>История заявок</h3></header>' + (inquiries.length ? '<div class="client-inquiries">' + inquiries.slice(0, 20).map(function (item) { return '<button class="client-inquiry" data-client-inquiry="' + esc(item.id) + '" type="button"><span><b>' + esc(inquiryTypeName(item)) + '</b><small>' + esc(String(item.text || "").replace(/\s+/g, " ").slice(0, 100)) + '</small></span><span class="chip ' + (awaitsReply(item) ? "bad" : item.status === "closed" ? "" : "ok") + '">' + (awaitsReply(item) ? "ждёт ответа" : item.status === "closed" ? "закрыто" : "в работе") + '</span><time>' + dateTime(item.updatedAt || item.createdAt) + '</time><i>→</i></button>'; }).join("") + '</div>' : '<div class="empty"><b>Заявок ещё нет</b></div>') + '</section></main></div>',
      footer: '<button class="btn danger" id="eraseClient" type="button">Удалить данные</button><button class="btn ghost" id="exportClient" type="button">Выгрузить данные</button><div class="grow"></div><button class="btn secondary" data-close="1" type="button">Закрыть</button><button class="btn" id="saveClient" type="button">Сохранить</button>',
    ready: function (dialog) {
      var profileChanged = false;
      dialog.querySelectorAll("[data-client-edit]").forEach(function (field) { field.addEventListener("change", function () { profileChanged = true; }); field.addEventListener("input", function () { profileChanged = true; }); });
      async function confirmNavigation(title, action) {
        if (!profileChanged) return true;
        return confirmDialog(title, "Изменения в карточке клиента будут потеряны.", action, true);
      }
      function profilePayload() {
        return { contactName: dialog.querySelector("#clientContactName").value, phone: dialog.querySelector("#clientPhone").value, preferredContactTime: dialog.querySelector("#clientContactTime").value, preferredLanguage: dialog.querySelector("#clientLanguage").value, note: dialog.querySelector("#clientNote").value, tags: dialog.querySelector("#clientTags").value.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean), blocked: dialog.querySelector("#clientBlocked").checked };
      }
      async function saveProfile() {
        await send("/api/users/" + encodeURIComponent(user.id), "PATCH", profilePayload());
        profileChanged = false;
      }
      dialog.querySelector("#saveClient").onclick = async function () {
        try {
          await saveProfile();
          dialog.closeClean();
          toast("Сохранено");
          await reload();
        } catch (error) { fail(error); }
      };
      async function openConversation(inquiryId) {
        if (!(await confirmNavigation("Перейти без сохранения?", "Перейти"))) return;
        dialog.closeClean();
        selectConversation(inquiryId);
        await go("inquiries", "inbox");
      }
      dialog.querySelectorAll("[data-client-inquiry]").forEach(function (button) { button.onclick = function () { openConversation(button.dataset.clientInquiry); }; });
      var openTask = dialog.querySelector("#clientOpenTask");
      if (openTask && active) openTask.onclick = function () { openConversation(active.id); };
      var writeButton = dialog.querySelector("#clientWrite");
      if (writeButton) writeButton.onclick = function () { openConversation((active || latest || {}).id || ""); };
      dialog.querySelectorAll("[data-client-object]").forEach(function (button) {
        button.onclick = async function () {
          if (!(await confirmNavigation("Открыть объект без сохранения?", "Открыть"))) return;
          dialog.closeClean();
          openRecordEditor("objects", button.dataset.clientObject);
        };
      });
      dialog.querySelector("#exportClient").onclick = function () {
        window.location.href = "/api/users/" + encodeURIComponent(user.id) + "/export";
      };
      dialog.querySelector("#eraseClient").onclick = async function () {
        if (!(await confirmDialog("Удалить данные клиента?", "Переписка, заявки и контакты этого клиента будут удалены без возможности восстановления.", "Удалить", true))) return;
        try {
          await api("/api/users/" + encodeURIComponent(user.id), { method: "DELETE" });
          dialog.closeClean();
          toast("Данные удалены");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

VIEWS.clients = {
  subtitle: function () { return "Диалоги, следующие шаги и вся история общения"; },
  render: function (host, tab) {
    if (tab === "tasks") return renderTasks(host);
    if (tab === "pipeline") return renderPipeline(host);
    if (tab === "base") return renderClients(host);
    renderInquiryList(host);
  },
};

VIEWS.viewings = {
  subtitle: function () { return "Показы объектов: подтверждение, календарь и история"; },
  render: function (host) { renderViewings(host); },
};
`;

export { INQUIRIES_JS };
