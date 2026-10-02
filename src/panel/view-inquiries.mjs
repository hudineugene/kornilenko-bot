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
// silent — выбор сделала сама панель (открытие по адресу, служебный сброс): адрес
// при этом не трогаем. Выбор человека, пока он в «Диалогах», кладёт адрес диалога
// в историю браузера: «Назад» возвращает к списку, а ссылка ведёт к клиенту.
function selectConversation(id, silent) {
  selectedInquiry = id;
  conversationOpenedByUser = Boolean(id);
  selectionWasAuto = false;
  if (!silent && currentView === "clients" && currentTab === "inbox") pushRoute("clients", "inbox", id);
}
var clientStageFilter = "";
var taskFilter = { scope: "action" };

// Один фильтр на все виды «Клиентов» (диалоги, воронка, база, следующие шаги):
// менеджер, шаг «сегодня / просрочено» и поиск. Раньше у воронки и «шагов» были
// свои отдельные поля, у диалогов и базы — никаких, и при смене вида фильтр
// терялся. Теперь выбранное остаётся, а «Сбросить» очищает всё.
var clientFilter = { search: "", assignee: "", step: "" };

function clientFilterActive() {
  return Boolean(clientFilter.search || clientFilter.assignee || clientFilter.step);
}

// Шаг открытой заявки: «просрочен» (дата прошла), «сегодня» или пусто.
function stepScopeOf(inquiry, today) {
  if (!inquiry || inquiry.status === "closed" || !inquiry.followUpDate) return "";
  return inquiry.followUpDate < today ? "overdue" : inquiry.followUpDate === today ? "today" : "";
}

function assigneeMatches(assignee) {
  if (!clientFilter.assignee) return true;
  return clientFilter.assignee === "none" ? !assignee : assignee === clientFilter.assignee;
}

function filterHaystack(user, inquiries) {
  var parts = [userName(user), user.username, user.phone, user.id];
  inquiries.forEach(function (item) {
    var property = item.propertyId ? (state.objects || []).find(function (record) { return record.id === item.propertyId; }) : null;
    parts.push(item.text, item.assignee, item.note, property && localized(property.title, "ru"));
  });
  parts.push(user.note);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// Клиент целиком: подходит, если под условия попадает хоть одна его открытая заявка.
// options.steps === false — шаг не учитываем (у «Следующих шагов» свои вкладки).
function userFilterMatches(user, inquiries, options) {
  var open = inquiries.filter(function (item) { return item.status !== "closed"; });
  if (clientFilter.assignee && !open.some(function (item) { return assigneeMatches(item.assignee); })) return false;
  if (clientFilter.step && !(options && options.steps === false)) {
    var today = pipelineToday();
    if (!inquiries.some(function (item) { return stepScopeOf(item, today) === clientFilter.step; })) return false;
  }
  return !clientFilter.search || filterHaystack(user, inquiries).indexOf(clientFilter.search.toLowerCase()) >= 0;
}

// Одна заявка (карточка воронки, задача): условия применяются к ней самой.
function itemFilterMatches(user, item, options) {
  if (!assigneeMatches(item.assignee)) return false;
  if (clientFilter.step && !(options && options.steps === false) && stepScopeOf(item, pipelineToday()) !== clientFilter.step) return false;
  return !clientFilter.search || filterHaystack(user, [item]).indexOf(clientFilter.search.toLowerCase()) >= 0;
}

// Сколько клиентов с шагом на сегодня и с просроченным — для кнопок фильтра.
function filterStepCounts() {
  var today = pipelineToday(), byScope = { today: {}, overdue: {} };
  (state.inquiries || []).forEach(function (item) {
    var scope = stepScopeOf(item, today);
    if (scope) byScope[scope][String(item.userId)] = true;
  });
  return { today: Object.keys(byScope.today).length, overdue: Object.keys(byScope.overdue).length };
}

function clientFilterBar(options) {
  var counts = filterStepCounts();
  var names = transferStaff().concat((state.inquiries || []).map(function (item) { return item.assignee; })).filter(function (name, index, all) { return name && all.indexOf(name) === index; });
  var showManagers = transferStaff().length > 1 || Boolean(clientFilter.assignee);
  return '<div class="client-filter">' +
    (options.search ? '<div class="search"><input id="cfSearch" placeholder="Найти клиента, объект или сообщение" value="' + esc(clientFilter.search) + '"></div>' : "") +
    (showManagers ? '<select id="cfAssignee" aria-label="Менеджер"><option value="">Все менеджеры</option>' +
      (transferStaff().length > 1 || clientFilter.assignee === "none" ? '<option value="none"' + (clientFilter.assignee === "none" ? " selected" : "") + ">Без менеджера</option>" : "") +
      names.map(function (name) { return '<option value="' + esc(name) + '"' + (clientFilter.assignee === name ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("") + "</select>" : "") +
    (options.steps && (counts.today || counts.overdue || clientFilter.step) ? '<div class="tabs" id="cfSteps">' +
      '<button type="button" data-step="today" class="' + (clientFilter.step === "today" ? "active" : "") + '">Шаг сегодня · ' + counts.today + "</button>" +
      '<button type="button" data-step="overdue" class="' + (clientFilter.step === "overdue" ? "active" : "") + '">Шаг просрочен · ' + counts.overdue + "</button></div>" : "") +
    (clientFilterActive() ? '<button class="btn ghost small" id="cfReset" type="button">Сбросить</button>' : "") +
    (options.note ? '<span class="small muted">' + esc(options.note) + "</span>" : "") +
  "</div>";
}

function bindClientFilterBar(host, rerender) {
  var search = host.querySelector("#cfSearch");
  if (search) search.oninput = function () {
    clientFilter.search = search.value.trim();
    clearTimeout(search._timer);
    search._timer = setTimeout(function () { rerender(); var next = host.querySelector("#cfSearch"); if (next) next.focus(); }, 250);
  };
  var assignee = host.querySelector("#cfAssignee");
  if (assignee) assignee.onchange = function (event) { clientFilter.assignee = event.target.value; rerender(); };
  ["today", "overdue"].forEach(function (step) {
    var button = host.querySelector('[data-step="' + step + '"]');
    if (button) button.onclick = function () { clientFilter.step = clientFilter.step === step ? "" : step; rerender(); };
  });
  var reset = host.querySelector("#cfReset");
  if (reset) reset.onclick = function () { clientFilter.search = ""; clientFilter.assignee = ""; clientFilter.step = ""; rerender(); };
}
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
  return userById(item.userId) || { firstName: "Клиент", id: item.userId };
}
// Клиент пишет не по-русски — метка EN/ES рядом с именем: видно до открытия диалога, на каком языке отвечать.
function languageChip(user, item) {
  var language = String((user && user.preferredLanguage) || (item && item.language) || "ru");
  return language !== "ru" && LANGUAGE_WORDS[language] ? ' <span class="chip lang-chip" title="Клиент пишет на языке: ' + LANGUAGE_WORDS[language] + '">' + language.toUpperCase() + "</span>" : "";
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
    return '<div class="list-item start"><div class="grow"><div class="row wrap"><b>' + esc(title) + '</b><span class="chip ' + tier[1] + '">' + tier[0] + '</span><span class="small muted">оценка ' + Math.max(0, Math.min(100, Number(result.score) || 0)) + '%</span></div>' +
      (reasons.length ? '<div class="small muted gap-top-sm">Совпало: ' + esc(reasons.join(", ")) + '</div>' : "") +
      (warnings.length ? '<div class="banner gap-top-sm ' + (needsData ? "bad" : "warn") + '">Учесть: ' + esc(warnings.join(", ")) + '</div>' : "") +
      '</div>' + (property ? '<button class="btn ghost small" type="button" data-match-property="' + esc(property.id) + '">Карточка</button>' : chip("bad", 'Объект удалён')) + '</div>';
  }).join("");
  return '<div class="card flat"><header><h3>Автоматический подбор</h3><div class="actions"><span class="chip ok">Точно ' + counts.exact + '</span><span class="chip warn">Близко ' + counts.close + '</span><span class="chip">Рассмотреть ' + counts.consider + '</span></div></header><div class="list">' + rows + '</div></div>';
}
// Просмотр — не обычное сообщение: у него есть дата, время и одно действие,
// которого от менеджера ждут. Показываем его карточкой прямо в переписке.
// Окно «Предложить объекты»: отметить до 12 объектов, которые клиент сейчас видит в каталоге.
function openOfferPicker(chosen, done) {
  var records = (state.objects || []).filter(function (record) { return record.status === "active" || record.status === "reserved"; });
  var picked = chosen.slice();
  function rowHtml(record) {
    var price = record.priceValue ? (record.priceFrom ? "от " : "") + money(record.priceValue, record.currency) : "";
    var place = [localized(record.city, "ru"), price].filter(Boolean).join(" · ");
    return '<label class="check offer-row" data-offer-row="' + esc(record.id) + '" data-search="' + esc((localized(record.title, "ru") + " " + localized(record.city, "ru") + " " + (record.reference || "")).toLowerCase()) + '">' +
      '<input type="checkbox" value="' + esc(record.id) + '"' + (picked.indexOf(record.id) >= 0 ? " checked" : "") + "> <span><b>" + esc(localized(record.title, "ru") || record.reference || record.id) + '</b><span class="small muted">' + esc(place) + "</span></span></label>";
  }
  openDialog({
    title: "Предложить объекты",
    body: '<div class="stack">' +
      '<div class="field"><label for="offerSearch">Поиск</label><input id="offerSearch" type="search" placeholder="Название, город или номер"></div>' +
      '<div class="offer-list" id="offerList">' + (records.length ? records.map(rowHtml).join("") : '<div class="empty"><b>Нет объектов, видимых клиентам</b></div>') + "</div>" +
      '<div class="hint" id="offerCount"></div>' +
      '<div class="hint">Клиент получит ваше сообщение и кнопку «Смотреть список»: карточки откроются в чате. Объект, не заполненный на языке клиента, не отправится.</div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="offerDone" type="button">Готово</button>',
    ready: function (dialog) {
      var counter = dialog.querySelector("#offerCount");
      function refresh() {
        picked = [];
        dialog.querySelectorAll("#offerList input:checked").forEach(function (box) { picked.push(box.value); });
        counter.textContent = "Выбрано: " + picked.length + " из 12";
      }
      dialog.querySelectorAll("#offerList input").forEach(function (box) {
        box.onchange = function () {
          refresh();
          if (picked.length > 12) { box.checked = false; refresh(); toast("В подборке не больше 12 объектов", true); }
        };
      });
      dialog.querySelector("#offerSearch").oninput = function (event) {
        var needle = String(event.target.value || "").trim().toLowerCase();
        dialog.querySelectorAll("[data-offer-row]").forEach(function (row) { row.classList.toggle("hidden", Boolean(needle) && row.dataset.search.indexOf(needle) < 0); });
      };
      dialog.querySelector("#offerDone").onclick = function () { refresh(); dialog.closeClean(); done(picked); };
      refresh();
    },
  });
}

// Что клиент ответил на вопрос «Как прошёл просмотр?»: видно прямо в карточке просмотра.
function viewingFeedbackChip(viewing) {
  var words = { liked: ["ok", "Понравилось"], questions: ["warn", "Остались вопросы"], disliked: ["bad", "Не подошло"] };
  var found = words[viewing.feedback];
  return found ? '<span class="chip ' + found[0] + '" title="Ответ клиента после просмотра">' + found[1] + "</span>" : "";
}
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
    '<div class="viewing-card-head"><b>' + iconSpan("calendar") + ' Запись на просмотр</b><span class="chip ' + state.chip + '">' + state.text + "</span>" + viewingFeedbackChip(viewing) + "</div>" +
    '<div class="viewing-card-when">' + esc(when) + "</div>" +
    (property ? '<div class="small muted">' + iconSpan("home") + ' ' + esc(localized(property.title, "ru") || property.reference || property.id) + "</div>" : "") +
    (viewing.cancelledAt ? "" : '<button class="btn secondary small" id="confirmViewingInline" type="button">' + (viewing.confirmedAt ? "Перенести просмотр" : "Подтвердить и уведомить") + "</button>") +
    // Файл календаря — у подтверждённого просмотра с точным временем.
    (viewing.confirmedAt && !viewing.cancelledAt && viewing.confirmedDate && viewing.confirmedTime ? '<a class="btn ghost small" href="/api/inquiries/' + encodeURIComponent(item.id) + '/viewing.ics" download title="Добавить в календарь" aria-label="Добавить в календарь">' + iconSpan("calendar") + "</a>" : "") +
    "</div>";
}

function statusChip(item, extraClass) {
  var state = inquiryState(item);
  return '<span class="chip ' + state.chip + (extraClass ? " " + extraClass : "") + '">' + state.text + "</span>";
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
    // Как долго ждёт: самая давняя из ждущих заявок и самый строгий уровень.
    group.waitLevel = "";
    group.waitAge = 0;
    group.inquiries.forEach(function (item) {
      var level = waitLevel(item);
      if (WAIT_RANK[level] > WAIT_RANK[group.waitLevel]) group.waitLevel = level;
      if (level) group.waitAge = Math.max(group.waitAge, waitAge(item));
    });
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
  return userFilterMatches(group.user, group.inquiries);
}

function openInquiry(id) {
  selectConversation(id);
  go("clients", "inbox");
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
// Смена этапа с «Вернуть»: запоминаем статус и этап, какими они были, и кнопка в
// уведомлении возвращает оба (закрытие сделки закрывает и заявку).
function inquiryStateBefore(item) {
  return { status: item.status, pipelineStage: item.pipelineStage || "", wonAt: item.wonAt || "" };
}

async function restoreInquiryState(id, before) {
  try {
    var body = { status: before.status, pipelineStage: before.pipelineStage };
    if (before.wonAt) body.wonAt = before.wonAt;
    await send("/api/inquiries/" + encodeURIComponent(id), "PATCH", body);
    toast("Возвращено");
    await reload();
  } catch (error) { fail(error); }
}

function undoInquiryState(id, before) {
  return { label: "Вернуть", run: function () { return restoreInquiryState(id, before); } };
}

async function changeStageWithUndo(item, stage) {
  var before = inquiryStateBefore(item);
  await send("/api/inquiries/" + encodeURIComponent(item.id), "PATCH", { pipelineStage: stage });
  toast("Этап обновлён", false, undoInquiryState(item.id, before));
  await reload();
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
// Список этапов на карточке воронки: «Перенести в…» и остальные этапы. Текущий
// не повторяем — карточка уже стоит в его колонке.
function pipelineMoveOptions(current) {
  return '<option value="" selected>Перенести в…</option>' + PIPELINE_STAGES.filter(function (stage) { return stage[0] !== current; }).map(function (stage) {
    return '<option value="' + stage[0] + '">' + stage[1] + "</option>";
  }).join("");
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
    (property ? '<div class="funnel-property">' + iconSpan("home") + ' ' + esc(localized(property.title, "ru") || property.reference || property.id) + '</div>' : "") +
    '<div class="funnel-signals">' +
      // Значок — только то, что требует внимания: «Отвечено» — обычное состояние, а
      // «без менеджера» имеет смысл, когда в команде есть кому назначить.
      (row.group.waiting ? '<span class="chip ' + WAIT_CHIP[row.group.waitLevel] + '" title="Клиент ждёт ответа">Ждёт · ' + waitDuration(row.group.waitAge) + '</span>' : "") +
      (item.assignee ? '<span class="chip">' + esc(item.assignee) + '</span>' : transferStaff().length > 1 ? chip("warn", 'Без менеджера') : "") +
      (item.followUpDate ? stepChip(item.followUpDate, item.followUpTime) : "") +
    '</div><button class="btn ghost icon funnel-move" data-pipeline-move="' + esc(item.id) + '" type="button" aria-label="Перенести на другой этап" title="Перенести на другой этап">⇄</button></article>';
}
function renderPipeline(host) {
  screenSettled();
  var allRows = pipelineOpportunityRows();
  var rows = allRows.filter(function (row) { return itemFilterMatches(row.user, row.item); });
  var today = pipelineToday();
  var active = allRows.filter(function (row) { return row.stage !== "won" && row.stage !== "lost"; });
  var due = active.filter(function (row) { return row.item.followUpDate && row.item.followUpDate <= today; }).length;
  var waiting = active.filter(function (row) { return row.group.waiting; }).length;
  var unassigned = active.filter(function (row) { return !row.item.assignee; }).length;
  var canAssign = transferStaff().length > 1;
  host.innerHTML = numberStrip([
      ["В работе", num(active.length), "", "Клиенты без этапов «Сделка» и «Неактуально»"],
      ["Ждут ответа", num(waiting), waiting ? "bad" : ""],
      ["Связаться", num(due), due ? "bad" : "", "Шаг на сегодня или уже просрочен"],
    ].concat(canAssign ? [["Без менеджера", num(unassigned), unassigned ? "bad" : ""]] : [])) + clientFilterBar({ search: true, steps: true, note: "На доске: " + rows.length + " из " + allRows.length + " (вместе с завершёнными)" }) +
    '<div class="funnel-board">' + PIPELINE_STAGES.map(function (stage) {
      var stageRows = rows.filter(function (row) { return row.stage === stage[0]; });
      return '<section class="funnel-column stage-' + stage[0] + '"><header><div><h3>' + stage[1] + '</h3><span>' + stage[2] + '</span></div><b>' + stageRows.length + '</b></header><div class="funnel-column-body">' + (stageRows.length ? stageRows.map(pipelineCardHtml).join("") : '<div class="funnel-empty">Нет клиентов</div>') + "</div></section>";
    }).join("") + "</div>";
  bindClientFilterBar(host, function () { renderPipeline(host); });
  host.querySelectorAll("[data-inquiry]").forEach(function (button) {
    button.onclick = function () { selectConversation(button.dataset.inquiry); go("clients", "inbox"); };
  });
  // Перенос — по кнопке «⇄» на карточке: одно окно со списком этапов вместо выпадающего списка в каждой карточке.
  host.querySelectorAll("[data-pipeline-move]").forEach(function (button) {
    button.onclick = function () {
      var moved = (state.inquiries || []).find(function (entry) { return entry.id === button.dataset.pipelineMove; });
      if (!moved) return;
      var current = pipelineStageOf(moved);
      var owner = userById(moved.userId) || {};
      openDialog({
        title: "Перенести: " + userName(owner),
        body: '<div class="stack stage-picker">' + PIPELINE_STAGES.map(function (stage) {
          return '<button class="btn ' + (stage[0] === current ? "" : "secondary") + ' stage-pick" type="button" data-stage="' + stage[0] + '"' + (stage[0] === current ? ' disabled aria-current="true"' : "") + '><b>' + esc(stage[1]) + '</b><span>' + esc(stage[2]) + "</span></button>";
        }).join("") + "</div>",
        footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button>',
        ready: function (dialog) {
          dialog.querySelectorAll("[data-stage]").forEach(function (pick) {
            pick.onclick = async function () {
              dialog.closeClean();
              try { await changeStageWithUndo(moved, pick.dataset.stage); } catch (error) { fail(error); }
            };
          });
        },
      });
    };
  });
}

function taskScopeOf(row, today) {
  if (!row.item.followUpDate) return ["contact", "selection", "viewing", "negotiation"].includes(row.stage) ? "none" : "";
  if (row.item.followUpDate < today) return "overdue";
  if (row.item.followUpDate === today) return "today";
  return "future";
}
// Дата следующего шага — одним видом везде (дела, воронка, база): просрочен — красный, сегодня — жёлтый
// (человек должен решить), впереди — синий (идёт своим чередом).
function stepChip(date, time) {
  var when = pipelineDate(date) + (time ? " · " + esc(time) : "");
  var today = pipelineToday();
  if (date < today) return '<span class="chip bad">Шаг просрочен · ' + pipelineDate(date) + "</span>";
  if (date === today) return '<span class="chip warn">Сегодня' + (time ? " · " + esc(time) : "") + "</span>";
  return '<span class="chip brand">' + when + "</span>";
}
function taskStatusHtml(scope, item) {
  if (item.followUpDate) return stepChip(item.followUpDate, item.followUpTime);
  return chip("", 'Дата не назначена');
}
function openTaskSchedule(item) {
  openDialog({
    title: item.followUpDate ? "Перенести контакт" : "Запланировать следующий шаг",
    body: '<div class="stack"><p class="small muted">После сохранения менеджер получит напоминание в Telegram в рабочее время.</p><div class="grid cols-2"><div class="field"><label for="taskDate">Дата</label><input id="taskDate" type="date" min="' + pipelineToday() + '" value="' + esc(item.followUpDate || pipelineToday()) + '"></div><div class="field"><label for="taskTime">Время, необязательно</label><input id="taskTime" type="time" value="' + esc(item.followUpTime || "") + '"></div></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveTaskDate" type="button">Сохранить</button>',
    ready: function (dialog) {
      dialog.querySelector("#saveTaskDate").onclick = async function () {
        var date = dialog.querySelector("#taskDate").value;
        if (!date) return fieldError(dialog.querySelector("#taskDate"), "Выберите дату");
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
    (property ? '<div class="task-property">' + iconSpan("home") + ' ' + esc(localized(property.title, "ru") || property.reference || property.id) + '</div>' : "") +
    ((user.note || item.note) ? '<div class="task-note">' + esc(user.note || item.note) + '</div>' : "") +
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
  var rows = allRows.filter(function (row) {
    if (taskFilter.scope === "action" && row.taskScope !== "overdue" && row.taskScope !== "today") return false;
    if (!["", "action", "all"].includes(taskFilter.scope) && row.taskScope !== taskFilter.scope) return false;
    return itemFilterMatches(row.user, row.item, { steps: false });
  }).sort(function (a, b) {
    if (!a.item.followUpDate && b.item.followUpDate) return 1;
    if (a.item.followUpDate && !b.item.followUpDate) return -1;
    return String(a.item.followUpDate || "").localeCompare(String(b.item.followUpDate || "")) || String(a.item.followUpTime || "").localeCompare(String(b.item.followUpTime || ""));
  });
  // Числа стоят в самих вкладках («К выполнению · 1»): отдельная строка тех же счётчиков другими словами только повторяла их.
  host.innerHTML = '' + '<div class="task-toolbar"><div class="tabs" id="taskScope">' +
      [["action", "К выполнению", counts.action], ["overdue", "Шаг просрочен", counts.overdue], ["future", "Будущие", counts.future], ["none", "Без даты", counts.none], ["all", "Все", counts.all]].map(function (entry) { return '<button type="button" data-scope="' + entry[0] + '" class="' + (taskFilter.scope === entry[0] ? "active" : "") + '">' + entry[1] + " · " + entry[2] + "</button>"; }).join("") +
      '</div></div>' + clientFilterBar({ search: true, steps: false }) +
    '<div class="task-list">' + (rows.length ? rows.map(function (row) { return taskCardHtml(row, row.taskScope); }).join("") : '<div class="card empty"><b>Дел в этой группе нет</b>Можно перейти к другим группам или открыть воронку</div>') + "</div>";
  host.querySelectorAll("[data-scope]").forEach(function (button) { button.onclick = function () { taskFilter.scope = button.dataset.scope; renderTasks(host); }; });
  bindClientFilterBar(host, function () { renderTasks(host); });
  host.querySelectorAll("[data-task-open]").forEach(function (button) { button.onclick = function () { selectConversation(button.dataset.taskOpen); go("clients", "inbox"); }; });
  host.querySelectorAll("[data-task-plan]").forEach(function (button) { button.onclick = function () { var row = allRows.find(function (entry) { return entry.item.id === button.dataset.taskPlan; }); if (row) openTaskSchedule(row.item); }; });
  host.querySelectorAll("[data-task-done]").forEach(function (button) {
    button.onclick = async function () {
      button.disabled = true;
      try { await send("/api/inquiries/" + encodeURIComponent(button.dataset.taskDone), "PATCH", { followUpDate: "", followUpTime: "" }); toast("Шаг выполнен"); await reload(); } catch (error) { button.disabled = false; fail(error); }
    };
  });
}

// Шаблоны ответов — карточка на вкладке «Автоответы»: рядом с
// автоответами, потому что это одно и то же по смыслу.
function templatesCardHtml() {
  var templates = state.replyTemplates || [];
  return '<div class="card"><header><h3>Шаблоны ответов</h3><div class="actions"><button class="btn secondary small" id="addTemplate" type="button">＋ Шаблон</button></div></header>' +
    '<div class="card-body"><span class="hint">В тексте можно писать {имя} и {объект}: подставятся имя клиента и название объекта. Нет текста на языке клиента — вставится русский, панель предупредит.</span></div>' +
    '<div class="card-body stack" id="templateList">' + (templates.length ? templates.map(function (template) {
      return '<div class="card flat"><div class="card-body stack" data-template="' + esc(template.id) + '">' +
        '<input data-field="title" value="' + esc(template.title) + '" placeholder="Название шаблона">' +
        LANGUAGES.map(function (language) {
          return '<textarea data-field="' + language[0] + '" placeholder="' + language[1] + '">' + esc((template.text || {})[language[0]] || "") + "</textarea>";
        }).join("") +
        '<div class="row"><button class="btn ghost small" data-drop="1" type="button">Удалить</button></div>' +
      "</div></div>";
    }).join("") : '<div class="empty"><b>Шаблонов нет</b>Готовый текст менеджер вставляет в ответ одним нажатием</div>') + "</div></div>";
}

// Шаблоны — форма: правка любого поля или новый шаблон включает полосу «Сохранить» внизу,
// которая записывает всё изменённое разом. Раньше у каждого шаблона была своя кнопка, и
// правка в одном терялась, если нажать соседний.
function bindTemplatesCard(host, redraw) {
  var list = host.querySelector("#templateList");
  function cardPayload(card) {
    var text = {};
    LANGUAGES.forEach(function (language) { text[language[0]] = card.querySelector('[data-field="' + language[0] + '"]').value; });
    return { title: card.querySelector('[data-field="title"]').value, text: text };
  }
  var initial = {};
  function remember() {
    host.querySelectorAll("[data-template]").forEach(function (card) { initial[card.dataset.template] = JSON.stringify(cardPayload(card)); });
  }
  function bindDrop() {
    host.querySelectorAll("[data-template]").forEach(function (card) {
      var id = card.dataset.template;
      card.querySelector("[data-drop]").onclick = async function () {
        if (id === "new") { card.closest(".card").remove(); watcher.check(); return; }
        if (!(await confirmDialog("Удалить шаблон?", "Шаблон исчезнет из списка.", "Удалить", true))) return;
        try {
          await api("/api/reply-templates/" + encodeURIComponent(id), { method: "DELETE" });
          await reload(false);
          redraw();
        } catch (error) { fail(error); }
      };
    });
  }
  var watcher = watchForm(list, async function () {
    var cards = Array.prototype.slice.call(host.querySelectorAll("[data-template]"));
    for (var index = 0; index < cards.length; index++) {
      var card = cards[index], id = card.dataset.template, body = cardPayload(card);
      if (id === "new") await send("/api/reply-templates", "POST", body);
      else if (JSON.stringify(body) !== initial[id]) await send("/api/reply-templates/" + encodeURIComponent(id), "PATCH", body);
    }
  }, "Шаблоны ответов изменены");
  remember();
  bindDrop();
  host.querySelector("#addTemplate").onclick = function () {
    var empty = list.querySelector(".empty");
    if (empty) empty.remove();
    var card = document.createElement("div");
    card.className = "card flat";
    card.innerHTML = '<div class="card-body stack" data-template="new"><input data-field="title" placeholder="Название шаблона">' +
      LANGUAGES.map(function (language) { return '<textarea data-field="' + language[0] + '" placeholder="' + language[1] + '"></textarea>'; }).join("") +
      '<div class="row"><button class="btn ghost small" data-drop="1" type="button">Удалить</button></div></div>';
    list.appendChild(card);
    bindDrop();
    watcher.mark();
  };
}


// «Диалоги» рисуются порциями: тысяча строк в списке — это полмегабайта разметки, которая
// перестраивается при каждом обновлении. Открытый диалог всегда виден, даже если он дальше.
var CONVERSATIONS_PAGE = 100;
var conversationsShown = CONVERSATIONS_PAGE;
// Пакетный режим списка диалогов: отметить нескольких клиентов и закрыть или передать их одним действием.
var batchMode = false;
var batchPicked = {};

function renderInquiryList(host) {
  screenSettled();
  var allGroups = conversationGroups();
  // В «Диалогах» — те, кто писал; в базе клиентов их больше: остальные пока только
  // нажимали кнопки. Без этой строки 9 клиентов в базе и 8 в диалогах читались как ошибка.
  var withoutConversation = Math.max(0, Number(state.userCount || 0) - allGroups.length);
  var noConversation = withoutConversation ? " · в базе ещё " + counted(withoutConversation, "клиент", "клиента", "клиентов") + " без переписки" : "";
  var rows = allGroups.filter(conversationMatches);
  // «Ждут ответа» — очередь: сверху тот, кто ждёт дольше всех, а не кто написал последним.
  if (inquiryFilter.status === "waiting") rows.sort(function (a, b) { return b.waitAge - a.waitAge; });
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
  if (!selectedGroup) selectConversation("", true);
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
  var shownRows = rows.slice(0, conversationsShown);
  if (selectedGroup && rows.indexOf(selectedGroup) >= 0 && shownRows.indexOf(selectedGroup) < 0) shownRows.push(selectedGroup);
  var moreRows = rows.length - shownRows.length;
  var conversationItems = shownRows.map(function (group) {
    var item = group.latest, user = group.user;
    var selected = group.inquiries.some(function (entry) { return entry.id === selectedInquiry; });
    // Последнее сообщение беседы приходит в состоянии отдельно: сама переписка
    // в панель не уезжает. Раньше здесь всегда оставалось item.text — первое
    // сообщение клиента, то есть месяцами одно и то же.
    var lastMessage = item.lastMessage;
    var preview = lastMessage ? (lastMessage.text || lastMessage.fileName) : item.text;
    if (lastMessage && lastMessage.direction === "out" && preview) preview = (lastMessage.fromBot ? "Бот: " : "Вы: ") + preview;
    var stateText = group.waiting ? "Ждёт ответа · " + waitDuration(group.waitAge) : group.closed ? "Закрыт" : group.searchOnly ? "Ответ не нужен" : "Отвечено";
    var stateClass = group.waiting ? (group.waitLevel === "fresh" ? "warn" : group.waitLevel === "overdue" ? "bad overdue" : "bad") : group.closed ? "" : "ok";
    return '<button class="conversation-item' + (selected ? " selected" : "") + (group.unread ? " unread" : "") + (batchMode && batchPicked[group.userId] ? " batch-picked" : "") + '" data-id="' + esc(group.active.id) + '" data-user="' + esc(group.userId) + '" type="button">' +
      (batchMode ? '<span class="batch-mark" aria-hidden="true">' + (batchPicked[group.userId] ? "☑" : "☐") + "</span>" : "") +
      '<span class="conversation-avatar">' + esc(initials(user.firstName)) + (group.unread ? '<i></i>' : '') + '</span>' +
      '<span class="conversation-item-body"><span class="conversation-item-top"><b>' + esc(userName(user)) + '</b>' + languageChip(user, item) + '<time>' + ago(item.clientMessageAt || item.updatedAt || item.createdAt) + '</time></span>' +
      '<span class="conversation-preview">' + esc(String(preview || "Вложение").replace(/\s+/g, " ").slice(0, 100)) + '</span>' +
      '<span class="conversation-item-meta"><span>' + esc(inquiryTypeName(item)) + (group.inquiries.length > 1 ? " · " + group.inquiries.length + " заявки" : "") + '</span><span class="conversation-state ' + stateClass + '" title="' + esc(stateText) + '">' + esc(stateText.replace(/^Ждёт ответа/, "Ждёт").replace("меньше минуты", "только что")) + '</span>' +
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
      clientFilterBar({ search: false, steps: true }) +
    "</div>" +
    '<div class="messenger-shell' + (selectedInquiry ? " chat-open" : "") + '"><aside class="card conversation-list-panel"><header><div><h3>Диалоги</h3><span class="small muted">Один клиент — один диалог' + noConversation + '</span></div><span class="chip">' + rows.length + " из " + counts.all + '</span><button class="btn ghost small" id="batchToggle" type="button">' + (batchMode ? "Готово" : "Выбрать") + "</button></header>" +
      (batchMode ? '<div class="batch-bar row wrap" id="batchBar"><span class="small" id="batchCount"></span><div class="grow"></div>' + (transferStaff().length > 1 ? '<button class="btn secondary small" id="batchTransfer" type="button">Передать…</button>' : "") + '<button class="btn secondary small" id="batchClose" type="button">Закрыть</button></div>' : "") +
      '<div class="conversation-list">' +
      (conversationItems || '<div class="empty"><b>Диалогов не найдено</b>Измените фильтр или поисковый запрос</div>') +
      (moreRows > 0 ? '<div class="card-body row"><span class="small muted">Показано ' + num(shownRows.length) + " из " + num(rows.length) + '</span><div class="grow"></div><button class="btn secondary small" id="moreConversations" type="button">Показать ещё ' + num(Math.min(CONVERSATIONS_PAGE, moreRows)) + "</button></div>" : "") +
    '</div></aside><section class="messenger-chat" id="inquiryCard"></section></div>';
  // На телефоне открытый диалог занимает весь экран: заголовок, вкладки и
  // фильтры (около 700 px) скрываются, остаётся «← Диалоги» и сама переписка.
  if (document.body && document.body.classList) document.body.classList.toggle("phone-chat", Boolean(selectedInquiry));

  host.querySelectorAll("#inqStatus button").forEach(function (button) {
    button.onclick = function () { inquiryFilter.status = button.dataset.status; conversationsShown = CONVERSATIONS_PAGE; renderInquiryList(host); };
  });
  bindClientFilterBar(host, function () { conversationsShown = CONVERSATIONS_PAGE; renderInquiryList(host); });
  var moreConversations = host.querySelector("#moreConversations");
  if (moreConversations) moreConversations.onclick = function () { conversationsShown += CONVERSATIONS_PAGE; renderInquiryList(host); };
  var compact = host.querySelector("#inqStatusCompact");
  if (compact) compact.onchange = function () {
    inquiryFilter.status = compact.value;
    conversationsShown = CONVERSATIONS_PAGE;
    renderInquiryList(host);
  };
  host.querySelectorAll(".conversation-item[data-id]").forEach(function (row) {
    row.onclick = function () {
      if (!batchMode) { selectConversation(row.dataset.id); renderInquiryList(host); return; }
      var picked = !batchPicked[row.dataset.user];
      if (picked) batchPicked[row.dataset.user] = true; else delete batchPicked[row.dataset.user];
      row.classList.toggle("batch-picked", picked);
      var mark = row.querySelector(".batch-mark");
      if (mark) mark.textContent = picked ? "☑" : "☐";
      showBatchCount(host);
    };
  });
  var batchToggle = host.querySelector("#batchToggle");
  if (batchToggle) batchToggle.onclick = function () { batchMode = !batchMode; batchPicked = {}; renderInquiryList(host); };
  if (batchMode) {
    showBatchCount(host);
    var batchTransfer = host.querySelector("#batchTransfer");
    if (batchTransfer) batchTransfer.onclick = function () { openBatchTransfer(host); };
    host.querySelector("#batchClose").onclick = function () { closeBatch(host); };
  }
  renderInquiryCard(host.querySelector("#inquiryCard"));
}

// Открытые заявки выбранных клиентов: по ним и работают пакетные действия.
function batchInquiries() {
  return (state.inquiries || []).filter(function (item) { return batchPicked[String(item.userId)] && item.status !== "closed"; });
}
function showBatchCount(host) {
  var clients = Object.keys(batchPicked).length, open = batchInquiries().length;
  var label = host.querySelector("#batchCount");
  if (label) label.textContent = clients ? "Выбрано клиентов: " + clients + (open ? " · открытых заявок: " + open : " · открытых заявок нет") : "Отметьте клиентов в списке";
  ["#batchTransfer", "#batchClose"].forEach(function (selector) {
    var button = host.querySelector(selector);
    if (button) button.disabled = !open;
  });
}
function finishBatch() { batchMode = false; batchPicked = {}; }

async function closeBatch(host) {
  var items = batchInquiries();
  if (!items.length) return;
  if (!(await confirmDialog("Закрыть " + items.length + " " + plural(items.length, "заявку", "заявки", "заявок") + "?", "Клиентам ничего не отправится. Закрытые заявки лежат во вкладке «Закрытые»; сразу после закрытия это можно отменить.", "Закрыть"))) return;
  var before = items.map(function (item) { return { id: item.id, state: inquiryStateBefore(item) }; });
  try {
    for (var index = 0; index < items.length; index += 1) await send("/api/inquiries/" + encodeURIComponent(items[index].id), "PATCH", { status: "closed" });
    finishBatch();
    toast("Закрыто заявок: " + items.length, false, { label: "Вернуть", run: async function () {
      try {
        for (var back = 0; back < before.length; back += 1) await restoreInquiryStateQuiet(before[back].id, before[back].state);
        toast("Возвращено");
        await reload();
      } catch (error) { fail(error); }
    } });
    await reload();
  } catch (error) { fail(error); await reload(); }
}
async function restoreInquiryStateQuiet(id, before) {
  var body = { status: before.status, pipelineStage: before.pipelineStage };
  if (before.wonAt) body.wonAt = before.wonAt;
  await send("/api/inquiries/" + encodeURIComponent(id), "PATCH", body);
}

function openBatchTransfer(host) {
  var items = batchInquiries().filter(function (item) { return !item.searchLead; });
  if (!items.length) return toast("У выбранных клиентов нет заявок, которые можно передать", true);
  openDialog({
    title: "Передать выбранных",
    body: '<div class="stack"><p class="small muted">Открытых заявок: <b>' + items.length + "</b>. Они перейдут к выбранному менеджеру; ему придёт одна сводка в Telegram.</p>" +
      '<div class="field"><label for="batchTo">Кому передать</label><select id="batchTo">' + transferOptions(transferStaff(), false) + "</select></div></div>",
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="batchDo" type="button">Передать</button>',
    ready: function (dialog) {
      dialog.querySelector("#batchDo").onclick = async function () {
        var to = dialog.querySelector("#batchTo").value;
        if (!to) return;
        try {
          var result = await send("/api/inquiries/transfer", "POST", { ids: items.map(function (item) { return item.id; }), to: to });
          dialog.closeClean();
          finishBatch();
          toast(result.moved ? transferDoneText(result, to) : "Все выбранные уже у этого менеджера");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
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
      (transferStaff().length > 1 ? '<button class="btn secondary" id="extraTransfer" type="button">🔁 Передать всех клиентов менеджера…</button>' +
        '<span class="small muted">Например, на время отпуска: открытые заявки перейдут к другому, ему придёт сводка в Telegram.</span>' : "") +
      '<button class="btn ghost" id="extraCleanup" type="button">🧹 Очистить заявки</button>' +
      '<span class="small muted">Удаляет старые заявки из панели без возможности восстановления.</span>' +
      "</div>",
    footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button>',
    ready: function (dialog) {
      dialog.querySelector("#extraExport").onclick = function () { dialog.closeClean(); openExportDialog(); };
      dialog.querySelector("#extraCleanup").onclick = function () { dialog.closeClean(); openCleanup(); };
      var extraTransfer = dialog.querySelector("#extraTransfer");
      if (extraTransfer) extraTransfer.onclick = function () { dialog.closeClean(); openTransferDialog("all"); };
    },
  });
}

// --- Передача клиента ---------------------------------------------------------
// Ответственный хранится именем; передача меняет его и сообщает новому менеджеру
// в Telegram. Одного клиента — из карточки диалога; всех клиентов человека
// (отпуск, увольнение) — из «⋯». Бот честно говорит, дошло ли уведомление.
function transferStaff() {
  return staffNames();
}

function transferOptions(names, withNobody) {
  return (withNobody ? '<option value="">Без менеджера</option>' : "") + names.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + "</option>"; }).join("");
}

function transferDoneText(result, who) {
  return (result.moved > 1 ? "Передано заявок: " + result.moved + " — " : "Передано: ") + who + ". " +
    (result.notified ? "Уведомление ушло в Telegram." : "Уведомление в Telegram не отправлено — сообщите ему сами.");
}

// Клиент, которого нет в боте (позвонил, написал в WhatsApp): заводим руками. Чата в Telegram у него не
// будет — писать ему из панели нельзя, но он есть в базе, ему можно поставить шаг и назначить просмотр.
function openManualClient() {
  var sources = ["звонок", "WhatsApp", "знакомые", "сайт", "реклама"];
  openDialog({
    title: "Новый клиент",
    body: '<div class="stack"><p class="small muted">Для тех, кто позвонил или написал в WhatsApp: в боте его нет, но в базе он будет. Писать ему из панели нельзя — только вести заметки и назначать просмотры.</p>' +
      '<div class="field"><label for="mcName">Имя <span class="required">*</span></label><input id="mcName" placeholder="Джон Смит"></div>' +
      '<div class="grid cols-2"><div class="field"><label for="mcPhone">Телефон</label><input id="mcPhone" placeholder="+34 …"></div>' +
      '<div class="field"><label for="mcLanguage">Язык</label><select id="mcLanguage"><option value="">Не выбран</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div></div>' +
      '<div class="field"><label for="mcSource">Откуда</label><input id="mcSource" list="mcSourceList" value="звонок"><datalist id="mcSourceList">' + sources.map(function (name) { return '<option value="' + esc(name) + '">'; }).join("") + '</datalist></div>' +
      '<div class="field"><label for="mcNote">Заметка</label><textarea id="mcNote" placeholder="Что просил, когда удобно"></textarea></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="mcCreate" type="button">Добавить клиента</button>',
    protectChanges: true,
    ready: function (dialog) {
      dialog.querySelector("#mcCreate").onclick = async function () {
        var name = dialog.querySelector("#mcName").value.trim();
        if (!name) return fieldError(dialog.querySelector("#mcName"), "Укажите имя клиента");
        try {
          var result = await send("/api/users", "POST", {
            name: name,
            phone: dialog.querySelector("#mcPhone").value.trim(),
            language: dialog.querySelector("#mcLanguage").value,
            source: dialog.querySelector("#mcSource").value.trim(),
            note: dialog.querySelector("#mcNote").value,
          });
          dialog.closeClean();
          toast("Клиент добавлен");
          await reload();
          openClient(result.id);
        } catch (error) { fail(error); }
      };
    },
  });
}

// Встреча, назначенная по телефону: клиент из списка, объект (по желанию), день и время. Подтверждена сразу;
// клиенту в Telegram ничего не уходит.
function openManualViewing(userId) {
  var users = (state.users || []).slice().sort(function (a, b) { return userName(a).localeCompare(userName(b), "ru"); });
  var objects = (state.objects || []).filter(function (record) { return ["active", "reserved"].indexOf(record.status) >= 0; });
  var now = new Date();
  var minDay = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  openDialog({
    title: "Назначить просмотр",
    body: '<div class="stack"><p class="small muted">Встреча, о которой договорились по телефону. Клиенту в Telegram сообщение не уйдёт — она появится в календаре и в утренней сводке.</p>' +
      '<div class="field"><label for="mvUser">Клиент <span class="required">*</span></label><select id="mvUser"><option value="">Выберите клиента</option>' + users.map(function (user) {
        return '<option value="' + esc(user.id) + '"' + (String(user.id) === String(userId) ? " selected" : "") + ">" + esc(userName(user) + (user.phone ? " · " + user.phone : "")) + "</option>";
      }).join("") + '</select><div class="hint">Нет в списке? Сначала «＋ Клиент» в «Базе клиентов».</div></div>' +
      '<div class="field"><label for="mvObject">Объект</label><select id="mvObject"><option value="">Не выбран</option>' + objects.map(function (record) {
        return '<option value="' + esc(record.id) + '">' + esc(localized(record.title, "ru") || record.reference || record.id) + "</option>";
      }).join("") + '</select></div>' +
      '<div class="grid cols-2"><div class="field"><label for="mvDate">День <span class="required">*</span></label><input type="date" id="mvDate" min="' + minDay + '"></div>' +
      '<div class="field"><label for="mvTime">Время</label><input type="time" id="mvTime"></div></div>' +
      '<div class="field"><label for="mvNote">Заметка</label><textarea id="mvNote" placeholder="О чём договорились"></textarea></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="mvCreate" type="button">Назначить</button>',
    protectChanges: true,
    ready: function (dialog) {
      dialog.querySelector("#mvCreate").onclick = async function () {
        var chosen = dialog.querySelector("#mvUser").value;
        var day = dialog.querySelector("#mvDate").value;
        if (!chosen) return fieldError(dialog.querySelector("#mvUser"), "Выберите клиента");
        if (!day) return fieldError(dialog.querySelector("#mvDate"), "Выберите день");
        try {
          await send("/api/viewings", "POST", { userId: chosen, propertyId: dialog.querySelector("#mvObject").value, date: day, time: dialog.querySelector("#mvTime").value, note: dialog.querySelector("#mvNote").value });
          dialog.closeClean();
          toast("Просмотр назначен");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

async function openTransferDialog(mode, item) {
  var names = transferStaff();
  if (mode === "one") {
    if (isDirty() && !(await confirmDialog("Передать без сохранения правок?", "В карточке есть несохранённые изменения — при передаче они пропадут. Сначала нажмите «Сохранить».", "Всё равно передать", true))) return;
    var user = userOf(item);
    openDialog({
      title: "Передать клиента",
      body: '<div class="stack"><p class="small muted"><b>' + esc(userName(user)) + "</b> перейдёт к выбранному менеджеру и появится у него в «Мои». Ему придёт уведомление в Telegram — на него можно ответить, и ответ уйдёт клиенту.</p>" +
        '<div class="field"><label for="transferTo">Кому передать</label><select id="transferTo">' + transferOptions(names.filter(function (name) { return name !== item.assignee; }), false) + "</select></div></div>",
      footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="doTransfer" type="button">Передать</button>',
      ready: function (dialog) {
        dialog.querySelector("#doTransfer").onclick = async function () {
          var to = dialog.querySelector("#transferTo").value;
          if (!to) return;
          try {
            var result = await send("/api/inquiries/" + encodeURIComponent(item.id) + "/transfer", "POST", { to: to });
            dialog.closeClean();
            toast(result.moved ? transferDoneText(result, to) : "Клиент уже у этого менеджера");
            await reload();
          } catch (error) { fail(error); }
        };
      },
    });
    return;
  }
  var openFor = function (name) {
    return (state.inquiries || []).filter(function (entry) { return entry.status !== "closed" && !entry.searchLead && String(entry.assignee || "") === name; }).length;
  };
  openDialog({
    title: "Передать всех клиентов менеджера",
    body: '<div class="stack"><p class="small muted">Открытые заявки перейдут к выбранному менеджеру. Закрытые останутся как история. Ему придёт одна сводка в Telegram.</p>' +
      '<div class="field"><label for="transferFrom">У кого забрать</label><select id="transferFrom">' + transferOptions(names, true) + "</select></div>" +
      '<div class="field"><label for="transferTo">Кому передать</label><select id="transferTo">' + transferOptions(names, false) + "</select></div>" +
      '<div class="chip warn" id="transferCount"></div><div class="small bad-text" id="transferHint"></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="doTransfer" type="button">Передать</button>',
    ready: function (dialog) {
      // Кнопка гаснет сама, пока выбраны один и тот же человек: нажатие внутри
      // открытого окна блокирует кнопку до его закрытия, поэтому «отказ по
      // нажатию» оставил бы окно без рабочей кнопки.
      var count = function () {
        var from = dialog.querySelector("#transferFrom").value, to = dialog.querySelector("#transferTo").value;
        dialog.querySelector("#transferCount").textContent = "Будет передано заявок: " + openFor(from);
        dialog.querySelector("#transferHint").textContent = from === to ? "Выберите разных людей: клиенты уже у этого менеджера." : "";
        dialog.querySelector("#doTransfer").disabled = from === to;
      };
      dialog.querySelector("#transferFrom").onchange = count;
      dialog.querySelector("#transferTo").onchange = count;
      count();
      dialog.querySelector("#doTransfer").onclick = async function () {
        var from = dialog.querySelector("#transferFrom").value, to = dialog.querySelector("#transferTo").value;
        if (!to) return;
        if (from === to) { dialog.querySelector("#transferHint").textContent = "Выберите разных людей: клиенты уже у этого менеджера."; return; }
        try {
          var result = await send("/api/inquiries/transfer", "POST", { from: from, to: to });
          dialog.closeClean();
          toast(result.moved ? transferDoneText(result, to) : "Нечего передавать: у " + (from || "«без менеджера»") + " нет открытых заявок");
          await reload();
        } catch (error) { fail(error); }
      };
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
      '<p class="small muted">Заявки удаляются из панели без возможности восстановления. Клиенты и переписка в Telegram остаются.</p>' +
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

// Что выгружать: заявки, как они сейчас на экране (с фильтром и поиском), или все за период — для отчёта за месяц.
function openExportDialog() {
  var shown = inquiryRows().length;
  var today = dayKeyOf(new Date(serverNow()));
  var monthAgo = shiftDayKey(today, -30);
  openDialog({
    title: "Выгрузить заявки в Excel",
    body: '<div class="stack">' +
      '<label class="check"><input type="radio" name="exScope" value="screen" checked> Как сейчас на экране (' + num(shown) + ')</label>' +
      '<label class="check"><input type="radio" name="exScope" value="period"> Все за период</label>' +
      '<div class="grid cols-2"><div class="field"><label for="exFrom">С</label><input type="date" id="exFrom" value="' + monthAgo + '"></div><div class="field"><label for="exTo">По</label><input type="date" id="exTo" value="' + today + '"></div></div>' +
      '<div class="hint">Период считается по дню создания заявки, обе даты включительно.</div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="exGo" type="button">Выгрузить</button>',
    ready: function (dialog) {
      dialog.querySelector("#exGo").onclick = async function () {
        var period = dialog.querySelector('[name="exScope"][value="period"]').checked;
        var from = dialog.querySelector("#exFrom").value, to = dialog.querySelector("#exTo").value;
        if (period && (!from || !to)) return fieldError(dialog.querySelector(from ? "#exTo" : "#exFrom"), "Укажите обе даты периода");
        if (period && from > to) return fieldError(dialog.querySelector("#exFrom"), "Начало периода позже конца");
        dialog.closeClean();
        await exportInquiries(period ? { from: from, to: to } : null);
      };
    },
  });
}

async function exportInquiries(period) {
  try {
    var response = await fetch("/api/inquiries/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(period ? period : { ids: inquiryRows().map(function (item) { return item.id; }) }) });
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
// --- Быстрый ответ -------------------------------------------------------------
// Ответить клиенту, не уходя с экрана «Сегодня»: окно с последним сообщением,
// шаблонами и полем ответа. «Отправить и следующий» — сразу к тому, кто ждёт
// дольше всех из оставшихся. Вложения и кнопки-ссылки — в полном диалоге.
function waitingQueue(handled) {
  return conversationGroups().filter(function (group) {
    return group.waiting && (handled || []).indexOf(String(group.userId)) < 0;
  }).sort(function (a, b) { return b.waitAge - a.waitAge; });
}

function waitingInquiryOf(group) {
  var waiting = group.inquiries.filter(awaitsReply).sort(function (a, b) { return waitAge(b) - waitAge(a); });
  return waiting[0] || group.active;
}

async function openNextQuickReply(handled) {
  var next = waitingQueue(handled)[0];
  if (!next) {
    toast("Больше никто не ждёт ответа");
    return false;
  }
  openQuickReply(waitingInquiryOf(next).id, handled);
  return true;
}

var LANGUAGE_WORDS = { en: "английский", es: "испанский" };

function openQuickReply(inquiryId, handledBefore) {
  var handled = (handledBefore || []).slice();
  var item = (state.inquiries || []).find(function (entry) { return entry.id === inquiryId; });
  if (!item) return;
  var user = userOf(item);
  var last = item.lastMessage;
  var lastText = String((last && last.direction !== "out" && (last.text || last.fileName)) || item.text || "").replace(/\s+/g, " ");
  var waiting = inquiryState(item);
  var clientLanguage = String(user.preferredLanguage || item.language || "ru");
  var requestKey = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "quick-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  openDialog({
    title: "Ответ: " + userName(user),
    body: '<div class="stack"><div class="row wrap"><span class="chip ' + esc(waiting.chip) + '">' + esc(waiting.text) + '</span><span class="small muted">' + esc(inquiryTypeName(item)) + '</span></div>' +
      '<div class="msg qr-last">' + esc(lastText) + "</div>" +
      // Клиент пишет не по-русски — сказать об этом заранее: отвечать надо на его языке.
      (clientLanguage !== "ru" && LANGUAGE_WORDS[clientLanguage] ? '<div class="small"><span class="chip brand">' + esc(clientLanguage.toUpperCase()) + '</span> Клиент пишет на языке: ' + esc(LANGUAGE_WORDS[clientLanguage]) + ' — ответьте на нём; шаблоны подставятся на этом языке.</div>' : "") +
      ((state.replyTemplates || []).length ? "" : '<div class="small muted">Шаблонов ответов пока нет. <button class="btn ghost small" id="qrTemplates" type="button">Создать шаблон</button></div>') +
      ((state.replyTemplates || []).length ? '<div class="reply-templates">' + state.replyTemplates.map(function (template) {
        return '<button class="btn secondary small template-chip" type="button" data-template="' + esc(template.id) + '" title="' + esc(String(localized(template.text, "ru") || "").slice(0, 120)) + '">' + esc(template.title) + "</button>";
      }).join("") + "</div>" : "") +
      '<textarea id="qrText" maxlength="3800" placeholder="Напишите ответ клиенту…"></textarea>' +
      '<div class="small bad-text" id="qrError"></div></div>',
    footer: '<button class="btn ghost" id="qrOpen" type="button">Открыть диалог</button><button class="btn ghost" id="qrSkip" type="button">Пропустить</button><div class="grow"></div>' +
      '<button class="btn secondary" id="qrSend" type="button">Отправить</button><button class="btn" id="qrSendNext" type="button">Отправить и следующий</button>',
    ready: function (dialog) {
      var text = dialog.querySelector("#qrText");
      var error = dialog.querySelector("#qrError");
      var makeTemplate = dialog.querySelector("#qrTemplates");
      if (makeTemplate) makeTemplate.onclick = function () { dialog.closeClean(); go("texts", "rules"); };
      (state.replyTemplates || []).forEach(function (template) {
        var button = dialog.querySelector('[data-template="' + template.id + '"]');
        if (button) button.onclick = function () {
          if (!insertTemplate(template, item, user, text)) return;
          if (text.focus) text.focus();
        };
      });
      async function submit(goNext, button) {
        var message = text.value.trim();
        if (!message) return fieldError(text, "Введите сообщение");
        button.disabled = true;
        error.textContent = "";
        try {
          await send("/api/inquiries/" + encodeURIComponent(item.id) + "/reply", "POST", { text: message, clientRequestId: requestKey });
          forgetConversation(item.userId);
          toast("Ответ доставлен");
          dialog.closeClean();
          handled.push(String(item.userId));
          await reload();
          if (goNext) await openNextQuickReply(handled);
        } catch (failure) {
          // Черновик остаётся, очередь не двигается: сообщение не ушло.
          error.textContent = "Не отправлено: " + (failure && failure.message || "неизвестная ошибка");
          toast("Сообщение не отправлено. Черновик сохранён.", true);
          button.disabled = false;
        }
      }
      dialog.querySelector("#qrSendNext").onclick = function () { return submit(true, dialog.querySelector("#qrSendNext")); };
      dialog.querySelector("#qrSend").onclick = function () { return submit(false, dialog.querySelector("#qrSend")); };
      dialog.querySelector("#qrSkip").onclick = async function () {
        handled.push(String(item.userId));
        dialog.closeClean();
        await openNextQuickReply(handled);
      };
      dialog.querySelector("#qrOpen").onclick = async function () {
        dialog.closeClean();
        selectConversation(item.id);
        await go("clients", "inbox");
      };
      if (text.focus) text.focus();
    },
  });
}

// Текст шаблона для этого клиента: на его языке, а если такого нет — русский (или любой заполненный).
// {имя} и {объект} подставляются: имя клиента и название объекта из его заявки на языке клиента.
// missing — шаблона на языке клиента нет, менеджер должен об этом знать до отправки.
function templateFor(template, item, user) {
  var language = String((user && user.preferredLanguage) || item.language || "ru");
  var texts = template.text || {};
  var own = String(texts[language] || "");
  var body = own || String(texts.ru || texts.en || texts.es || "");
  var object = (state.objects || []).find(function (record) { return String(record.id) === String(item.propertyId || ""); });
  var name = String((user && (user.contactName || user.firstName)) || "");
  body = body.replace(/\{(?:имя|name)\}/gi, name || "").replace(/\{(?:объект|property)\}/gi, object ? localized(object.title, own ? language : "ru") : "");
  return { text: body, missing: language !== "ru" && !own && Boolean(body), language: language };
}
function insertTemplate(template, item, user, field) {
  var found = templateFor(template, item, user);
  if (!found.text) return false;
  field.value = withTemplate(field.value, found.text);
  if (found.missing) toast("Шаблона на языке клиента (" + found.language.toUpperCase() + ") нет — вставлен русский текст. Переведите его перед отправкой.", true);
  return true;
}

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
  var delivery = message.direction === "out" ? '<span class="message-delivery ' + (message.deliveryStatus === "failed" ? "bad" : "ok") + '">' + (message.deliveryStatus === "failed" ? "не доставлено" : iconSpan("check") + " доставлено") + "</span>" : "";
  var reply = message.direction === "in" && Number.isFinite(Number(message.telegramMessageId)) ? '<button class="message-reply-button" data-reply-target="' + esc(message.telegramMessageId) + '" type="button" title="Ответить на это сообщение" aria-label="Ответить на это сообщение">↩ Ответить</button>' : "";
  return '<div class="conversation-line ' + (message.direction === "out" ? "out" : "in") + '"><div class="msg ' + (message.direction === "out" ? "out" : "") + '">' + quote + type + attachment + (message.text ? '<div class="message-text">' + esc(message.text) + "</div>" : "") + '<div class="msg-meta"><span>' + esc(message.direction === "out" ? message.by || "панель" : "клиент") + " · " + dateTime(message.createdAt) + reactions + delivery + "</span>" + reply + "</div></div></div>";
}
function markConversationRead(userId) {
  var unread = false, now = new Date().toISOString();
  (state.inquiries || []).forEach(function (item) {
    if (String(item.userId) === String(userId) && inquiryUnread(item)) { item.readAt = now; unread = true; }
  });
  if (!unread) return;
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
  var related = inquiriesOfUser(item.userId).sort(function (a, b) { return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0); });
  var property = item.propertyId ? (state.objects || []).find(function (record) { return record.id === item.propertyId; }) : null;
  var viewing = item.viewing || null;
  var managers = staffNames();
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
  host.innerHTML = '<div class="card conversation-card"><header class="conversation-head"><button class="btn ghost small conversation-back" id="backToList" type="button">← Диалоги</button><div class="conversation-person"><span class="conversation-avatar large">' + esc(initials(user.firstName)) + '</span><div><h3>' + esc(userName(user)) + '</h3><div class="small muted">' + [user.username ? "@" + esc(user.username) : "", user.phone ? esc(user.phone) : "", user.source ? "источник: " + esc(user.source) : ""].filter(Boolean).join(" · ") + '</div></div></div><div class="actions"><button class="btn secondary small conversation-side-toggle" id="sideToggle" type="button" aria-expanded="false" title="Статус, этап, заметка и следующий шаг">⋯ Сведения</button>' + statusChip(item, "status-in-head") + "</div></header>" +
    '<div class="card-body conversation-body conversation-split">' +
      '<div class="conversation-main">' +
      '<div class="conversation-context">' +
        (related.length > 1 ? '<div class="field grow"><label for="activeInquiry">Текущая заявка</label><select id="activeInquiry">' + related.map(function (entry) { return '<option value="' + esc(entry.id) + '"' + (entry.id === item.id ? " selected" : "") + '>' + esc(inquiryTypeName(entry)) + " · " + dateShort(entry.createdAt) + " · " + inquiryState(entry).text + "</option>"; }).join("") + "</select></div>" : '<div><span class="field-label">Текущая заявка</span><div class="conversation-context-title">' + esc(inquiryTypeName(item)) + " · " + dateTime(item.createdAt) + "</div></div>") +
        (property ? '<button class="property-link" id="linkedProperty" type="button">' + iconSpan("home") + ' ' + esc(localized(property.title, "ru") || property.reference || property.id) + '<span>Открыть →</span></button>' : item.propertyId ? '<div class="chip bad">Объект удалён</div>' : "") +
      '</div>' +
      viewingCardHtml(item, property) +
      '<div class="conversation-thread">' + (timeline.length
        ? timeline.map(conversationMessageHtml).join("")
        : conversationLoading[String(item.userId)] ? '<div class="empty"><b>Загрузка…</b></div>'
          : conversationFailed[String(item.userId)]
            ? '<div class="empty"><b>Не удалось загрузить сообщения</b>' + esc(conversationFailed[String(item.userId)]) + '<button class="btn secondary small" id="retryConversation" type="button">Повторить</button></div>'
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
      '<div class="reply-attachments"><input class="hidden" id="replyFile" type="file" accept=".jpg,.jpeg,.png,.pdf,.txt,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,application/pdf,text/plain"><label class="btn secondary small" for="replyFile">📎 Добавить файл</label><span class="reply-file-name muted" id="replyFileName">Фотография до 5 МБ или документ до 10 МБ</span><button class="btn ghost small hidden" id="clearReplyFile" type="button">Убрать</button>' +
        '<button class="btn secondary small" id="offerPick" type="button" title="Выбрать объекты: клиент получит кнопку «Смотреть список» и откроет карточки прямо в чате">🏘 Предложить объекты</button><span class="small muted hidden" id="offerChosen"></span></div>' +
      '<details class="editor-section"><summary><b>Кнопка-ссылка</b><span>клиент увидит её под сообщением</span></summary><div class="editor-section-body"><div class="grid cols-2"><div class="field"><label for="replyButtonText">Текст кнопки</label><input id="replyButtonText" placeholder="Посмотреть объект"></div><div class="field"><label for="replyButtonUrl">Ссылка</label><input id="replyButtonUrl" placeholder="https://…"></div></div></div></details>' +
      '<div class="reply-delivery hidden" id="replyDelivery" aria-live="polite"><span id="replyDeliveryText"></span><button class="btn ghost small hidden" id="retryReply" type="button">Повторить отправку</button></div>' +
      '<div class="reply-actions"><button class="btn" id="sendReply" type="button">Отправить сообщение</button><span class="small muted">После ответа заявка станет «Отвечено». Закрыть её можно справа.</span></div></div>' +
      '</div>' +
      // Справа — всё, что менеджер меняет по этому клиенту. Одна панель, одна
      // кнопка сохранения: раньше статус сохранялся сам по нажатию, а этап,
      // заметка и теги — отдельно, и половина правок терялась.
      // На телефоне панель сворачивается под полем ответа: статус, этап, заметка
      // и «Сохранить» лежат прямо под ним, а не в конце длинной страницы.
      '<div class="side-backdrop"></div>' +
      '<aside class="conversation-side"><button class="btn ghost small side-close" id="sideClose" type="button">✕ Закрыть</button><details class="conversation-side-details" open><summary>Статус, этап и заметки</summary><div class="conversation-side-inner stack">' +
        selectionMatchingPanel(item) +
        // Статус один: «Ждёт ответа», «Отвечено» или «Закрыт». Первые два бот
        // ставит сам по переписке — руками остаётся только закрыть заявку или
        // открыть её снова. Этап сделки — отдельное необязательное поле ниже.
        '<div class="field"><label for="inqStatusValue">Статус</label><select id="inqStatusValue">' +
          [["open", item.status === "closed" ? "Открыть снова" : inquiryState(item).text], ["closed", "Закрыт"]].map(function (option) {
            return '<option value="' + option[0] + '"' + ((item.status === "closed" ? "closed" : "open") === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
          }).join("") + '</select></div>' +
        '<div class="field"><label for="inqPipeline">Этап <span class="small muted">(по желанию)</span></label><select id="inqPipeline">' + pipelineStageOptions(pipelineStageOf(item), true) + '</select></div>' +
        '<div class="field"><label for="inqAssignee">Ответственный менеджер</label><div class="row"><select id="inqAssignee" class="grow"><option value="">Не назначен</option>' + managers.map(function (name) { return '<option value="' + esc(name) + '"' + (item.assignee === name ? " selected" : "") + '>' + esc(name) + "</option>"; }).join("") + '</select>' +
          (managers.length > 1 ? '<button class="btn secondary small" id="transferInq" type="button" title="Передать клиента другому менеджеру и сообщить ему в Telegram">Передать…</button>' : "") + '</div></div>' +
        '<div class="row followup-fields"><div class="field grow"><label for="followDate">Следующий шаг</label><input type="date" id="followDate" value="' + esc(item.followUpDate || "") + '"></div><div class="field followup-time"><label for="followTime">Время</label><input type="time" id="followTime" value="' + esc(item.followUpTime || "") + '"></div></div>' +
        '<div class="field"><label for="inqNote">Заметка о клиенте</label><textarea id="inqNote" placeholder="Предпочтения, договорённости, что важно сделать">' + esc(user.note || item.note || "") + "</textarea></div>" +
        '<div class="field"><label for="clientTagsInq">Теги клиента</label><input id="clientTagsInq" value="' + esc((user.tags || []).join(", ")) + '" placeholder="покупка, горячий лид"></div>' +
        '<div class="conversation-save"><button class="btn" id="saveInq" type="button">Сохранить</button><button class="btn ghost small" id="openClientCard" type="button">Карточка клиента</button></div>' +
        '<div class="row divided"><button class="btn danger-outline small" id="deleteInq" type="button">Удалить заявку</button><span class="small muted">Переписка в Telegram останется.</span></div>' +
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
    // На телефоне диалог — целый экран: переписка прокручивается внутри, поле ответа
    // стоит под ней, а статус, этап и заметки выезжают панелью «⋯ Сведения». Раньше
    // они лежали под полем ответа за тысячей пикселей, а страница и переписка
    // прокручивались одна внутри другой.
    var sideDetails = host.querySelector(".conversation-side-details");
    if (sideDetails) sideDetails.open = true;
  }
  var conversationBox = host.querySelector(".conversation-card");
  function setSidePanel(open) {
    if (conversationBox) conversationBox.classList.toggle("side-open", open);
    var toggle = host.querySelector("#sideToggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
  }
  var sideToggle = host.querySelector("#sideToggle");
  if (sideToggle) sideToggle.onclick = function () { setSidePanel(!(conversationBox && conversationBox.classList.contains("side-open"))); };
  var sideClose = host.querySelector("#sideClose");
  if (sideClose) sideClose.onclick = function () { setSidePanel(false); };
  var sideBackdrop = host.querySelector(".side-backdrop");
  if (sideBackdrop) sideBackdrop.onclick = function () { setSidePanel(false); };

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
  var offerIds = [];
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
    host.querySelector("#replyFileName").classList.toggle("has-file", Boolean(replyAttachment));
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
  // Подборка: выбранные объекты уйдут вместе с ответом кнопкой «Смотреть список»; без текста уйдёт стандартная фраза.
  function showOffers() {
    var chip = host.querySelector("#offerChosen");
    chip.classList.toggle("hidden", !offerIds.length);
    chip.textContent = offerIds.length ? "Объектов в подборке: " + offerIds.length : "";
    host.querySelector("#offerPick").textContent = offerIds.length ? "🏘 Изменить подборку" : "🏘 Предложить объекты";
    freshRequest();
  }
  host.querySelector("#offerPick").onclick = function () {
    openOfferPicker(offerIds, function (ids) { offerIds = ids; showOffers(); });
  };
  async function sendReply() {
    var text = replyText.value.trim();
    if (!text && !replyAttachment && !offerIds.length) return toast("Введите сообщение, добавьте файл или выберите объекты", true);
    if (replyAttachment && offerIds.length) return toast("Подборку и файл отправьте по отдельности", true);
    if (replyAttachment && text.length > 800) return toast("С вложением подпись должна быть не длиннее 800 знаков", true);
    var button = host.querySelector("#sendReply");
    var payload = {
      text: text,
      clientRequestId: requestId(),
      buttonText: host.querySelector("#replyButtonText").value,
      buttonUrl: host.querySelector("#replyButtonUrl").value,
    };
    if (offerIds.length) payload.offerIds = offerIds;
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
      replyDeliveryText.textContent = result.duplicate ? "Сообщение уже было доставлено" : "Доставлено в Telegram";
      toast(result.duplicate ? "Сообщение уже было доставлено" : result.skipped ? "Ответ доставлен. Объектов не отправлено (не видны клиенту): " + result.skipped : "Ответ доставлен");
      offerIds = [];
      // Остаёмся в той же беседе и на том же месте страницы.
      await reload();
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
      if (!insertTemplate(template, item, userOf(item), replyText)) return;
      freshRequest();
      if (replyText.focus) replyText.focus();
      // Курсор — в конец вставленного: можно сразу дописать своё.
      if (replyText.setSelectionRange) replyText.setSelectionRange(replyText.value.length, replyText.value.length);
    };
  });
  host.querySelector("#openClientCard").onclick = function () { openClient(String(item.userId)); };
  // Один запрос: заявка, заметка и теги клиента сохраняются вместе или не
  // сохраняются совсем. Форма под наблюдением — несохранённая правка не теряется
  // при уходе со страницы, а кнопка в панели и кнопка полосы сохранения делают одно
  // и то же.
  var initialNote = host.querySelector("#inqNote").value;
  var initialTags = host.querySelector("#clientTagsInq").value;
  async function saveInquiryPanel() {
    // Статус и этап шлём, только если человек их изменил: неизменный этап
    // «Выиграно» вместе со статусом «Открыта» затирал бы одно другим.
    // Заметка и теги клиента живут и в карточке клиента: шлём их, только если правили здесь, — иначе
    // сохранение из диалога затирало бы то, что успели записать в карточке (и наоборот).
    var patch = {
      followUpDate: host.querySelector("#followDate").value,
      followUpTime: host.querySelector("#followTime").value,
      assignee: host.querySelector("#inqAssignee").value,
    };
    var noteNow = host.querySelector("#inqNote").value;
    if (noteNow !== initialNote) patch.note = noteNow;
    var tagsNow = host.querySelector("#clientTagsInq").value;
    if (tagsNow !== initialTags) patch.tags = tagsNow.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean);
    var wantClosed = host.querySelector("#inqStatusValue").value === "closed";
    if (wantClosed !== (item.status === "closed")) patch.status = wantClosed ? "closed" : "in_progress";
    var wantStage = host.querySelector("#inqPipeline").value;
    if (wantStage !== pipelineStageOf(item)) patch.pipelineStage = wantStage;
    await send("/api/inquiries/" + encodeURIComponent(item.id), "PATCH", patch);
    // Статус или этап менялись — их можно вернуть; правку заметки «возвращать» не предлагаем.
    return "status" in patch || "pipelineStage" in patch ? undoInquiryState(item.id, inquiryStateBefore(item)) : null;
  }
  var sidePanel = host.querySelector(".conversation-side");
  if (sidePanel) watchForm(sidePanel, async function () { await saveInquiryPanel(); }, "Есть несохранённые изменения по заявке и клиенту");
  host.querySelector("#saveInq").onclick = async function () {
    try {
      var undo = await saveInquiryPanel();
      toast("Сохранено", false, undo || undefined);
      await reload();
    } catch (error) { fail(error); }
  };
  // Удаление — не меню из одного пункта, а кнопка внизу панели: спрашивает и удаляет.
  host.querySelector("#deleteInq").onclick = async function () {
    if (!(await confirmDialog("Удалить заявку?", "Она исчезнет из панели. Переписка в Telegram останется.", "Удалить", true))) return;
    try {
      await api("/api/inquiries/" + encodeURIComponent(item.id), { method: "DELETE" });
      selectConversation("");
      toast("Удалено");
      await reload();
    } catch (error) { fail(error); }
  };
  var transferButton = host.querySelector("#transferInq");
  if (transferButton) transferButton.onclick = function () { return openTransferDialog("one", item); };
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
  if (!item.viewing.confirmedAt) return { key: "pending", text: key && key < today ? "Дата прошла" : "Ждёт подтверждения", chip: key && key < today ? "bad" : "warn", event: "pending" };
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
  return item && item.viewing && item.viewing.online ? ' <span class="chip brand">' + iconSpan("video") + ' онлайн</span>' : "";
}
function viewingEventHtml(item, today, compact) {
  var user = userOf(item), property = viewingProperty(item), status = viewingStatus(item, today);
  return '<article class="viewing-event ' + status.event + '">' +
    '<div class="viewing-event-head"><b class="viewing-event-time">' + esc(viewingTimeLabel(item)) + '</b><span class="chip ' + status.chip + '">' + esc(status.text) + '</span></div>' +
    '<div class="viewing-event-client">' + esc(userName(user)) + '</div>' +
    '<div class="viewing-event-property">' + iconSpan("home") + ' ' + esc(property ? localized(property.title, "ru") || property.reference || property.id : "Объект не найден") + viewingOnlineTag(item) + '</div>' +
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
      (viewing.online ? '<div class="msg">' + iconSpan("video") + ' Клиент выбрал онлайн-просмотр по видеосвязи: адрес ему не отправится, ссылку на видеосвязь пришлите в переписке.</div>' : '') +
      (currentDate ? '' : '<div class="msg attention">Дату из просьбы клиента бот не разобрал — выберите её сами. Клиент получит именно то, что здесь указано.</div>') +
      '<div class="grid cols-2"><div class="field"><label for="viewingScheduleDate">Дата</label><input id="viewingScheduleDate" type="date" min="' + esc(pipelineToday()) + '" value="' + esc(currentDate) + '"></div><div class="field"><label for="viewingScheduleTime">Время</label><input id="viewingScheduleTime" type="time" value="' + esc(currentTime) + '"><div class="quick-times">' + VIEWING_QUICK_TIMES.map(function (time) { return '<button class="btn ghost small" type="button" data-quick-time="' + time + '">' + time + '</button>'; }).join("") + '</div></div></div>' +
      '<div class="msg">После сохранения клиент получит ' + (moving ? "обновлённые" : "подтверждённые") + ' дату и время в Telegram.</div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveViewingSchedule" type="button">' + (moving ? "Перенести и уведомить" : "Подтвердить и уведомить") + '</button>',
    ready: function (dialog) {
      var dateInput = dialog.querySelector("#viewingScheduleDate");
      var timeInput = dialog.querySelector("#viewingScheduleTime");
      var save = dialog.querySelector("#saveViewingSchedule");
      save.onclick = async function () {
        if (!dateInput.value || !timeInput.value) return fieldError(dateInput.value ? timeInput : dateInput, "Укажите дату и время просмотра");
        if (dateInput.value < pipelineToday()) return fieldError(dateInput, "Нельзя назначить просмотр на прошедшую дату");
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
  pageAction("＋ Просмотр", function () { openManualViewing(""); });
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
      return '<div class="card viewing-pending-card"><div><span class="chip ' + (key && key < today ? "bad" : "warn") + '">' + (key && key < today ? "Дата прошла" : "Ждёт подтверждения") + '</span><h3>' + esc(userName(userOf(item))) + '</h3><p>' + esc(localized(viewingProperty(item) && viewingProperty(item).title, "ru") || "Объект не найден") + viewingOnlineTag(item) + '</p><small>Запрошено: ' + esc(requested) + '</small></div><div class="viewing-pending-actions"><button class="btn ghost small" data-viewing-open="' + esc(item.id) + '" type="button">Открыть заявку</button><button class="btn" data-viewing-schedule="' + esc(item.id) + '" type="button">Подтвердить и уведомить</button></div></div>';
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
  host.querySelectorAll("[data-viewing-mode]").forEach(function (button) { button.onclick = function () { viewingModeChosen = true; viewingMode = button.dataset.viewingMode; pushRoute("viewings", viewingMode, ""); renderViewings(host); }; });
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
  if (!rows.length) return '<div class="card-body"><span class="small muted">Интересы пока не сформированы: избранное, просмотренное и подходящие объекты появятся здесь.</span></div>';
  return '<div class="client-properties">' + rows.map(function (row) {
    var record = row.property;
    var price = record.priceValue ? (record.priceFrom ? "от " : "") + money(record.priceValue, record.currency) : localized(record.price, "ru") || "цена по запросу";
    return '<button class="client-property" data-client-object="' + esc(record.id) + '" type="button"><span class="client-property-title"><b>' + esc(localized(record.title, "ru") || record.reference || record.id) + '</b><small>' + esc(row.labels.join(" · ")) + '</small></span><span class="client-property-price">' + esc(price) + '</span><span>→</span></button>';
  }).join("") + "</div>";
}
// «Сообщений» у клиента — сколько он написал. Счётчик в профиле ведётся с того
// дня, как он появился, и мог отстать от переписки (у прежних клиентов — 0 при
// живом диалоге): берём большее из него и того, что видно в диалогах.
function clientMessageTotal(user, inquiries) {
  var inDialogs = (inquiries || []).reduce(function (sum, item) { return sum + (Number(item.clientMessageCount) || 0); }, 0);
  return Math.max(Number(user.messages) || 0, inDialogs);
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
  pageAction("＋ Клиент", openManualClient);
  var rows = (state.users || []).map(function (user) {
    var inquiries = inquiriesOfUser(user.id);
    return { user: user, inquiries: inquiries, latest: clientActiveInquiry(inquiries), active: clientOpenInquiry(inquiries) };
  }).filter(function (row) {
    var user = row.user;
    if (clientStageFilter && pipelineStageOf(row.latest) !== clientStageFilter) return false;
    if (!userFilterMatches(user, row.inquiries)) return false;
    return true;
  });
  host.innerHTML = clientFilterBar({ search: false, steps: true }) + '<div class="toolbar">' +
      '<select id="clientStage"><option value="">Все этапы</option>' + PIPELINE_STAGES.map(function (stage) { return '<option value="' + stage[0] + '"' + (clientStageFilter === stage[0] ? " selected" : "") + '>' + stage[1] + "</option>"; }).join("") + '</select><span class="small muted">Показано ' + num(rows.length) +  " из " + num(state.userCount) + (Number(state.activeUserCount) !== Number(state.userCount) ? " · им можно писать: " + num(state.activeUserCount) : "") + '</span><div class="grow"></div><button class="btn secondary small" id="exportClients" type="button" title="Таблица с теми, кого вы видите на экране: для обзвона, отчёта или переноса">⬇ В Excel</button></div>' +
    '<div class="card"><div class="table-wrap"><table class="table-cards clients-table"><thead><tr><th>Клиент</th><th>Источник и язык</th><th>Этап</th><th>Следующий шаг</th><th class="right">Последняя активность</th></tr></thead><tbody>' +
    (rows.length ? rows.slice(0, clientsShown).map(function (row) {
      var user = row.user, latest = row.latest, active = row.active;
      return '<tr class="clickable" data-id="' + esc(user.id) + '"><td><div class="row"><span class="avatar">' + esc(initials(user.firstName)) + "</span><span><b>" + esc(userName(user)) + "</b>" +
        (user.username ? ' <span class="small muted">@' + esc(user.username) + "</span>" : "") +
        (user.phone ? '<br><span class="small muted">' + esc(user.phone) + "</span>" : "") + "</span></div></td>" +
        "<td>" + esc(sourceName(user.source) || "без метки") + ' <span class="chip">' + esc((user.preferredLanguage || "—").toUpperCase()) + "</span>" + (user.blocked ? ' ' + chip("bad", 'Недоступен') : "") + "</td>" +
        "<td>" + (latest ? '<span class="chip brand">' + esc(clientStageLabel(latest)) + "</span>" : "—") + "</td>" +
        "<td>" + (active && active.followUpDate ? stepChip(active.followUpDate, active.followUpTime) : "—") + "</td>" +
        '<td class="right small muted nowrap">' + ago(user.lastSeenAt) + "</td></tr>";
    }).join("") : '<tr><td colspan="5"><div class="empty"><b>Никого не найдено</b></div></td></tr>') +
    "</tbody></table></div>" +
    (rows.length > clientsShown
      ? '<div class="card-body row"><span class="small muted">Показаны первые ' + num(clientsShown) + " из " + num(rows.length) + '</span><div class="grow"></div><button class="btn secondary small" id="moreClients" type="button">Показать ещё ' + num(Math.min(CLIENTS_PAGE, rows.length - clientsShown)) + "</button></div>"
      : "") +
    "</div>";
  host.querySelector("#exportClients").onclick = function () { exportClients(rows.map(function (row) { return row.user.id; })); };
  var moreClients = host.querySelector("#moreClients");
  if (moreClients) moreClients.onclick = function () { clientsShown += CLIENTS_PAGE; renderClients(host); };
  bindClientFilterBar(host, function () { clientsShown = CLIENTS_PAGE; renderClients(host); });
  host.querySelector("#clientStage").onchange = function (event) { clientStageFilter = event.target.value; clientsShown = CLIENTS_PAGE; renderClients(host); };
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    row.onclick = function () { openClient(row.dataset.id); };
  });
}

// Один и тот же человек мог оказаться в базе дважды: позвонил (завели руками), а потом написал боту. Совпадение —
// по телефону (последние 9 цифр, без кода страны).
function phoneKey(user) {
  var digits = String((user && user.phone) || "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : "";
}
function duplicatesOf(user) {
  var key = phoneKey(user);
  if (!key) return [];
  return (state.users || []).filter(function (other) { return String(other.id) !== String(user.id) && phoneKey(other) === key; }).slice(0, 3);
}
// Кого во кого вливать: в карточку с чатом в Telegram; если чатов нет ни у кого — в открытую. Две карточки с чатами не склеить.
function mergePlan(user, other) {
  if (user.chatId && other.chatId) return null;
  return other.chatId ? { keepId: other.id, mergeId: user.id } : { keepId: user.id, mergeId: other.id };
}
async function mergeClients(dialog, user, other) {
  var plan = mergePlan(user, other);
  var keep = userById(plan.keepId);
  var gone = userById(plan.mergeId);
  if (!(await confirmDialog("Объединить карточки?", "«" + userName(gone) + "» вольётся в «" + userName(keep) + "»: заявки, заметки, теги и избранное окажутся в одной карточке, лишняя исчезнет. Это можно вернуть сразу после объединения.", "Объединить"))) return;
  try {
    var result = await send("/api/users/merge", "POST", plan);
    dialog.closeClean();
    toast("Карточки объединены", false, { label: "Вернуть", run: async function () {
      try { await send("/api/users/unmerge", "POST", { token: result.undoToken }); toast("Возвращено"); await reload(); } catch (error) { fail(error); }
    } });
    await reload();
  } catch (error) { fail(error); }
}

function openClient(id) {
  var user = userById(id);
  // Клиента нет в общем состоянии (старше 500-го) или карточка неполная: запрашиваем
  // полную у бота и открываем снова.
  if (!user || user.partial) {
    ensureClientLoaded(id).then(function () {
      var loaded = userById(id);
      if (loaded && !loaded.partial) openClient(id);
    }).catch(fail);
    return;
  }
  var inquiries = inquiriesOfUser(id).sort(function (a, b) { return (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0); });
  var latest = clientActiveInquiry(inquiries);
  var active = clientOpenInquiry(inquiries);
  var hasWish = savedSearchSummary(user) !== "не настроен" || clientSelectionText(inquiries) !== "Условия подбора пока не оставлены";
  openDialog({
    title: userName(user),
    drawer: true,
    wide: true,
    protectChanges: true,
    body: '<div class="client-profile"><aside class="client-profile-side"><div class="client-profile-identity"><span class="conversation-avatar client-avatar">' + esc(initials(user.firstName)) + '</span><div><h2>' + esc(userName(user)) + '</h2><span class="small muted">ID ' + esc(user.id) + (user.username ? " · @" + esc(user.username) : "") + '</span></div></div>' +
      '<div class="client-facts"><div><span>Источник</span><b>' + esc(sourceName(user.source) || "без метки") + '</b></div>' + (user.plan && user.plan.startedAt ? '<div><span>План покупки</span><b>' + Object.keys(user.plan.done || {}).length + ' из 10 шагов' + (Object.keys(user.plan.help || {}).length ? ', просит помощи' : '') + '</b></div>' : "") + (user.goal ? '<div><span>Цель</span><b>' + esc({ live: "купить для жизни", invest: "инвестиция и аренда", browse: "пока смотрит" }[user.goal] || "") + '</b></div>' : "") + '<div><span>Первый контакт</span><b>' + dateTime(user.firstSeenAt) + '</b></div><div><span>Последняя активность</span><b>' + dateTime(user.lastSeenAt) + '</b></div>' + (latest ? '<div><span>Этап</span><b>' + esc(clientStageLabel(latest)) + '</b></div>' : "") + '</div>' +
      '<div class="client-edit stack"><div class="grid cols-2"><div class="field"><label for="clientContactName">Имя для связи</label><input id="clientContactName" data-client-edit value="' + esc(user.contactName || userName(user)) + '"></div><div class="field"><label for="clientLanguage">Язык</label><select id="clientLanguage" data-client-edit><option value="">Не выбран</option>' + [["ru", "Русский"], ["en", "English"], ["es", "Español"]].map(function (language) { return '<option value="' + language[0] + '"' + (user.preferredLanguage === language[0] ? " selected" : "") + '>' + language[1] + "</option>"; }).join("") + '</select></div></div><div class="field"><label for="clientPhone">Телефон</label><input id="clientPhone" data-client-edit value="' + esc(user.phone || "") + '" placeholder="+34 …"></div><div class="field"><label for="clientContactTime">Когда удобно связаться</label><input id="clientContactTime" data-client-edit value="' + esc(user.preferredContactTime || "") + '"></div><div class="field"><label for="clientTags">Теги клиента</label><input id="clientTags" data-client-edit value="' + esc((user.tags || []).join(", ")) + '"></div><div class="field"><label for="clientNote">Заметка о клиенте</label><textarea id="clientNote" data-client-edit>' + esc(user.note || "") + '</textarea></div><label class="check"><input type="checkbox" id="clientBlocked" data-client-edit' + (user.blocked ? " checked" : "") + '> Не писать этому клиенту</label></div></aside>' +
      '<main class="client-profile-main">' + duplicatesOf(user).map(function (other) {
        return '<section class="card"><div class="card-body row wrap">' + chip("warn", 'Возможный дубль') + '<span>Тот же телефон у клиента «' + esc(userName(other)) + '»' + (other.chatId ? "" : " (заведён вручную)") + '</span>' +
          (mergePlan(user, other) ? '<button class="btn secondary small" type="button" data-client-merge="' + esc(other.id) + '">Объединить</button>' : '<span class="small muted">Оба пишут через Telegram — объединить нельзя</span>') + '</div></section>';
      }).join("") + numberStrip([["Сообщений", num(clientMessageTotal(user, inquiries))], ["Заявок", num(inquiries.length)], ["Избранное", num((user.favorites || []).length)], ["Просмотрено", num((user.recentlyViewed || []).length)]]) +
      '<section class="card client-message-box"><header><div><h3>Написать клиенту</h3><span class="small muted">Сообщение уходит клиенту в Telegram</span></div>' + (user.blocked || !user.chatId ? chip("bad", 'Отправка недоступна') : chip("ok", 'Telegram доступен')) + '</header><div class="card-body stack"><div class="small muted">Шаблоны, файлы, цитата и кнопка-ссылка — всё в одной форме на экране переписки.</div><button class="btn" id="clientWrite" type="button"' + (user.blocked || !user.chatId ? " disabled" : "") + '>Открыть диалог →</button><button class="btn secondary" id="clientViewing" type="button">Назначить просмотр</button>' + (!user.chatId ? '<div class="small muted">Клиент заведён вручную: в боте его нет, писать ему из панели нельзя.</div>' : '') + '</div></section>' +
      '<div class="grid cols-2 client-interest-grid">' + (!hasWish ? '<section class="card"><div class="card-body"><span class="small muted">Условия поиска: клиент пока не оставлял ни сохранённого поиска, ни заявки на подбор.</span></div></section>' : '<section class="card"><header><h3>Запрос клиента</h3></header><div class="card-body stack"><div><span class="field-label">Сохранённый поиск</span><div>' + esc(savedSearchSummary(user)) + '</div></div><div><span class="field-label">Последняя заявка на подбор</span><div>' + esc(clientSelectionText(inquiries)) + '</div></div></div></section>') + '<section class="card"><header><h3>Следующее действие</h3></header><div class="card-body">' + (active ? '<div class="stack"><div class="row wrap"><span class="chip brand">' + esc(clientStageLabel(active)) + '</span>' + (active.assignee ? '<span class="chip">' + esc(active.assignee) + '</span>' : chip("warn", 'Менеджер не назначен')) + '</div><div>' + (active.followUpDate ? "Связаться: " + pipelineDate(active.followUpDate) + (active.followUpTime ? " в " + esc(active.followUpTime) : "") : "Следующий шаг не назначен") + '</div><button class="btn secondary small" id="clientOpenTask" type="button">Открыть заявку</button></div>' : '<div class="stack"><div class="small muted">Активных заявок нет. Можно поставить шаг — например, «позвонить в четверг»: он появится в «Следующих шагах» и в напоминаниях.</div><div class="grid cols-2"><div class="field"><label for="stepDate">День</label><input type="date" id="stepDate"></div><div class="field"><label for="stepTime">Время</label><input type="time" id="stepTime"></div></div><div class="field"><label for="stepNote">Что сделать</label><input id="stepNote" maxlength="300" placeholder="Позвонить, уточнить бюджет"></div><button class="btn secondary small" id="clientStep" type="button">Поставить шаг</button></div>') + '</div></section></div>' +
      '<section class="card"><header><h3>Объекты и интересы</h3><div class="actions"><span class="small muted">избранное · сравнение · история · подбор</span></div></header>' + clientPropertiesHtml(user) + '</section>' +
      '<section class="card"><header><h3>История заявок</h3></header>' + (inquiries.length ? '<div class="client-inquiries">' + inquiries.slice(0, 20).map(function (item) { return '<button class="client-inquiry" data-client-inquiry="' + esc(item.id) + '" type="button"><span><b>' + esc(inquiryTypeName(item)) + '</b><small>' + esc(String(item.text || "").replace(/\s+/g, " ").slice(0, 100)) + '</small></span><span class="chip ' + (awaitsReply(item) ? "bad" : item.status === "closed" ? "" : "ok") + '">' + (awaitsReply(item) ? "ждёт ответа" : item.status === "closed" ? "закрыто" : "в работе") + '</span><time>' + dateTime(item.updatedAt || item.createdAt) + '</time><i>→</i></button>'; }).join("") + '</div>' : '<div class="empty"><b>Заявок ещё нет</b></div>') + '</section>' +
      // Удаление — в самом конце карточки, отдельным блоком: раньше красная кнопка
      // стояла в нижней полосе вплотную к «Закрыть» и «Сохранить».
      '<section class="card danger-zone"><header><h3>Удаление данных клиента</h3></header><div class="card-body stack"><div class="small muted">Переписка, заявки и контакты этого клиента будут удалены без возможности восстановления. Если данные могут понадобиться, сначала нажмите «Выгрузить данные».</div><div><button class="btn danger-outline" id="eraseClient" type="button">Удалить данные клиента</button></div></div></section></main></div>',
      footer: '<button class="btn ghost" id="exportClient" type="button">Выгрузить данные</button><div class="grow"></div><button class="btn secondary" data-close="1" type="button">Закрыть</button><button class="btn" id="saveClient" type="button">Сохранить</button>',
    ready: function (dialog) {
      var profileChanged = false;
      dialog.querySelectorAll("[data-client-edit]").forEach(function (field) { field.addEventListener("change", function () { profileChanged = true; }); field.addEventListener("input", function () { profileChanged = true; }); });
      async function confirmNavigation(title, action) {
        if (!profileChanged) return true;
        return confirmDialog(title, "Изменения в карточке клиента будут потеряны.", action, true);
      }
      function profilePayload() {
        var payload = { contactName: dialog.querySelector("#clientContactName").value, phone: dialog.querySelector("#clientPhone").value, preferredContactTime: dialog.querySelector("#clientContactTime").value, preferredLanguage: dialog.querySelector("#clientLanguage").value, blocked: dialog.querySelector("#clientBlocked").checked };
        // Заметка и теги — те же, что в боковой панели диалога: шлём, только если правили здесь.
        var noteNow = dialog.querySelector("#clientNote").value;
        if (noteNow !== (user.note || "")) payload.note = noteNow;
        var tagsNow = dialog.querySelector("#clientTags").value;
        if (tagsNow !== (user.tags || []).join(", ")) payload.tags = tagsNow.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean);
        return payload;
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
        await go("clients", "inbox");
      }
      dialog.querySelectorAll("[data-client-inquiry]").forEach(function (button) { button.onclick = function () { openConversation(button.dataset.clientInquiry); }; });
      var openTask = dialog.querySelector("#clientOpenTask");
      if (openTask && active) openTask.onclick = function () { openConversation(active.id); };
      dialog.querySelectorAll("[data-client-merge]").forEach(function (button) {
        button.onclick = function () { return mergeClients(dialog, user, userById(button.dataset.clientMerge)); };
      });
      var stepButton = dialog.querySelector("#clientStep");
      if (stepButton) stepButton.onclick = async function () {
        var day = dialog.querySelector("#stepDate").value;
        if (!day) return fieldError(dialog.querySelector("#stepDate"), "Выберите день следующего шага");
        try {
          await send("/api/users/" + encodeURIComponent(user.id) + "/step", "POST", { date: day, time: dialog.querySelector("#stepTime").value, note: dialog.querySelector("#stepNote").value });
          dialog.closeClean();
          toast("Шаг назначен на " + pipelineDate(day));
          await reload();
        } catch (error) { fail(error); }
      };
      var viewingButton = dialog.querySelector("#clientViewing");
      if (viewingButton) viewingButton.onclick = function () { dialog.closeClean(); openManualViewing(user.id); };
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
  render: function (host, tab) {
    if (tab === "tasks") return renderTasks(host);
    if (tab === "pipeline") return renderPipeline(host);
    if (tab === "base") return renderClients(host);
    renderInquiryList(host);
  },
};

VIEWS.viewings = {
  render: function (host) { renderViewings(host); },
};
`;

export { INQUIRIES_JS };
