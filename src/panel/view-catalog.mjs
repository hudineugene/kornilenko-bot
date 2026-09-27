// Каталог: объекты, акции и загрузка объектов с сайта.

const CATALOG_JS = String.raw`
var catalogSearch = "", catalogStatus = "";
var LANGUAGES = [["ru", "Русский"], ["en", "English"], ["es", "Español"]];
var PROPERTY_TYPES = [["apartment", "Квартира"], ["house", "Дом"], ["villa", "Вилла"], ["townhouse", "Таунхаус"], ["land", "Участок"], ["commercial", "Коммерческая"], ["newbuild", "Новостройка"], ["other", "Другое"]];
var PROPERTY_STATUS = [["active", "Активен"], ["reserved", "Забронирован"], ["sold", "Продан"], ["hidden", "Скрыт"]];
var BADGES = [["new", "Новинка"], ["recommended", "Рекомендуем"], ["exclusive", "Эксклюзив"], ["price_reduced", "Цена снижена"]];
var CONDITIONS = [["", "Не указано"], ["new", "Новое"], ["renovated", "После ремонта"], ["needs_renovation", "Требует ремонта"], ["under_construction", "Строится"]];

// Панель получает от сервера единый список обязательных полей для каждого языка.
function missingLanguages(record) {
  return LANGUAGES.filter(function (language) {
    var issues = record.publicationIssues && record.publicationIssues[language[0]];
    return Array.isArray(issues) ? issues.length : !((record.title || {})[language[0]] || "").trim() || !propertyImages(record, language[0]).length;
  }).map(function (language) { return language[0].toUpperCase(); });
}
function publicationSummary(record) {
  var readiness = record.publicationIssues || {};
  var unique = [];
  LANGUAGES.forEach(function (language) {
    (readiness[language[0]] || []).forEach(function (issue) { if (unique.indexOf(issue) < 0) unique.push(issue); });
  });
  return unique.slice(0, 4).join(", ") + (unique.length > 4 ? "…" : "");
}

function statusName(value) {
  var found = PROPERTY_STATUS.find(function (item) { return item[0] === value; });
  return found ? found[1] : value;
}
function statusKind(value) {
  return value === "active" ? "ok" : value === "reserved" ? "warn" : "";
}
function propertyImages(record, language) {
  var byLanguage = record.imagesByLanguage || {};
  return byLanguage[language] || [];
}
function imageUrl(kind, recordId, image) {
  return "/api/media/" + kind + "/" + encodeURIComponent(recordId) + "?imageId=" + encodeURIComponent(image.id);
}

function promotionStatus(record) {
  if (record.enabled === false) return { label: "выключена", kind: "" };
  var now = Date.now();
  var start = record.startAt ? Date.parse(record.startAt + (/^\d{4}-\d{2}-\d{2}$/.test(record.startAt) ? "T00:00:00.000" : "")) : NaN;
  var end = record.endAt ? Date.parse(record.endAt + (/^\d{4}-\d{2}-\d{2}$/.test(record.endAt) ? "T23:59:59.999" : "")) : NaN;
  if (Number.isFinite(start) && start > now) return { label: "запланирована", kind: "brand" };
  if (Number.isFinite(end) && end < now) return { label: "завершена", kind: "warn" };
  return { label: "показывается", kind: "ok" };
}

// Поля с переводом: вкладки языков переключают все такие поля сразу.
function translatedField(name, label, value, multiline, placeholder, required) {
  return '<div class="field"><label>' + esc(label) + (required ? ' <span class="required">*</span>' : "") + "</label>" + LANGUAGES.map(function (language) {
    var text = (value && value[language[0]]) || "";
    return multiline
      ? '<textarea data-tr="' + name + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" placeholder="' + esc(placeholder || language[1]) + '">' + esc(text) + "</textarea>"
      : '<input data-tr="' + name + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" placeholder="' + esc(placeholder || language[1]) + '" value="' + esc(text) + '">';
  }).join("") + "</div>";
}
function languageTabs() {
  return '<div class="tabs" data-langtabs="1">' + LANGUAGES.map(function (language, index) {
    return '<button type="button" data-lang="' + language[0] + '" class="' + (index ? "" : "active") + '">' + language[1] + "</button>";
  }).join("") + "</div>";
}
function bindLanguageTabs(root) {
  var active = root.querySelector("[data-langtabs] button.active");
  root.dataset.activeLanguage = active ? active.dataset.lang : "ru";
  root.querySelectorAll("[data-langtabs] button").forEach(function (button) {
    button.onclick = function () {
      root.querySelectorAll("[data-langtabs] button").forEach(function (other) { other.classList.toggle("active", other === button); });
      root.querySelectorAll(".lang-input").forEach(function (input) { input.classList.toggle("hidden", input.dataset.lang !== button.dataset.lang); });
      root.querySelectorAll("[data-langpane]").forEach(function (pane) { pane.classList.toggle("hidden", pane.dataset.langpane !== button.dataset.lang); });
      root.dataset.activeLanguage = button.dataset.lang;
      root.dispatchEvent(new CustomEvent("languagechange", { detail: { language: button.dataset.lang } }));
    };
  });
}
function collectTranslated(root, name) {
  var value = {};
  root.querySelectorAll('[data-tr="' + name + '"]').forEach(function (input) { value[input.dataset.lang] = input.value.trim(); });
  return value;
}

// --- Объекты --------------------------------------------------------------------
function catalogPropertyStats(record) {
  var raw = (state.analytics && state.analytics.properties && state.analytics.properties[record.id]) || {};
  var resetAt = Date.parse(state.stats && state.stats.statisticsResetAt || "") || 0;
  var inquiries = (state.inquiries || []).filter(function (item) {
    return String(item.propertyId || "") === String(record.id) && (!resetAt || (Date.parse(item.createdAt || "") || 0) >= resetAt);
  }).length;
  return {
    impressions: Number(raw.impressions || raw.views || 0),
    details: Number(raw.details || 0),
    inquiries: inquiries,
  };
}
function renderObjects(host) {
  var rows = (state.objects || []).filter(function (record) {
    if (catalogStatus && record.status !== catalogStatus) return false;
    if (!catalogSearch) return true;
    var haystack = (localized(record.title, "ru") + " " + (record.reference || "") + " " + localized(record.city, "ru")).toLowerCase();
    return haystack.indexOf(catalogSearch.toLowerCase()) >= 0;
  });
  pageAction("＋ Объект", function () { openRecordEditor("objects", null); });
  pageAction("⇩ Загрузить с сайта", function () { go("catalog", "feed"); }, "secondary");
  host.innerHTML = '<div class="toolbar"><div class="search"><input id="catalogSearch" placeholder="Название, номер, город" value="' + esc(catalogSearch) + '"></div>' +
      '<select id="catalogStatus" style="max-width:170px"><option value="">Все статусы</option>' + PROPERTY_STATUS.map(function (item) {
        return '<option value="' + item[0] + '"' + (catalogStatus === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
      }).join("") + "</select>" +
      '<span class="small faint">' + counted(rows.length, "объект", "объекта", "объектов") + "</span></div>" +
    '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:52px"></th><th>Объект</th><th>Тип</th><th>Город</th><th class="right">Цена</th><th>Статус</th><th class="right">Эффективность</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (record, index) {
      var images = propertyImages(record, "ru");
      var stats = catalogPropertyStats(record);
      return '<tr data-id="' + esc(record.id) + '">' +
        "<td>" + (images.length ? '<img class="thumb" src="' + imageUrl("objects", record.id, images[0], "ru") + '" alt="">' : '<span class="thumb"></span>') + "</td>" +
        '<td class="clickable" data-edit="1"><b>' + esc(localized(record.title, "ru") || "Без названия") + "</b>" +
          (record.reference ? ' <span class="small faint">' + esc(record.reference) + "</span>" : "") +
          (missingLanguages(record).length ? '<br><span class="chip warn" title="' + esc(publicationSummary(record)) + '">не готово: ' + esc(missingLanguages(record).join(", ")) + "</span>" : '<br><span class="chip ok">карточка готова</span>') + "</td>" +
        "<td>" + esc((PROPERTY_TYPES.find(function (type) { return type[0] === record.propertyType; }) || ["", "—"])[1]) + '<br><span class="small faint">' + (record.dealType === "rent" ? "аренда" : "продажа") + "</span></td>" +
        "<td>" + esc(localized(record.city, "ru") || "—") + "</td>" +
        '<td class="right nowrap">' + (record.priceValue ? esc(money(record.priceValue, record.currency)) : esc(localized(record.price, "ru") || "по запросу")) + "</td>" +
        '<td><span class="chip ' + statusKind(record.status) + '">' + esc(statusName(record.status)) + "</span></td>" +
        '<td class="right"><button class="object-performance" data-insights="1" type="button" title="Открыть аналитику объекта"><b>' + num(stats.impressions) + '</b><small>' + num(stats.inquiries) + ' обращ.</small></button></td>' +
        '<td class="right nowrap"><button class="btn ghost small" data-move="up" title="Выше">↑</button><button class="btn ghost small" data-move="down" title="Ниже">↓</button>' +
        '<button class="btn ghost small" data-copy="1" title="Копия">⧉</button><button class="btn ghost small" data-delete="1" title="Удалить">✕</button></td></tr>';
    }).join("") : '<tr><td colspan="8"><div class="empty"><b>Объектов нет</b>Добавьте первый или загрузите выгрузку с сайта</div></td></tr>') +
    "</tbody></table></div></div>";

  var search = host.querySelector("#catalogSearch");
  search.oninput = function () {
    catalogSearch = search.value.trim();
    clearTimeout(search._timer);
    search._timer = setTimeout(function () { renderView(); }, 250);
  };
  host.querySelector("#catalogStatus").onchange = function (event) { catalogStatus = event.target.value; renderView(); };
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    var id = row.dataset.id;
    row.querySelector("[data-edit]").onclick = function () { openRecordEditor("objects", id); };
    row.querySelector("[data-insights]").onclick = function () { openObjectInsights(id); };
    row.querySelectorAll("[data-move]").forEach(function (button) {
      button.onclick = async function () {
        try { await send("/api/objects/" + encodeURIComponent(id) + "/move", "POST", { step: button.dataset.move === "up" ? -1 : 1 }); await reload(); } catch (error) { fail(error); }
      };
    });
    row.querySelector("[data-copy]").onclick = async function () {
      try { await send("/api/objects/" + encodeURIComponent(id) + "/duplicate", "POST", {}); toast("Копия создана"); await reload(); } catch (error) { fail(error); }
    };
    row.querySelector("[data-delete]").onclick = async function () {
      if (!(await confirmDialog("Удалить объект?", "Карточка исчезнет из каталога бота.", "Удалить", true))) return;
      try { await api("/api/objects/" + encodeURIComponent(id), { method: "DELETE" }); toast("Удалено"); await reload(); } catch (error) { fail(error); }
    };
  });
}

function insightSignalLabel(signal) {
  return { favorite: "❤️ в избранном", comparison: "⚖️ сравнивает", viewed: "просматривал", match: "подходит по запросу", inquiry: "есть обращение" }[signal] || signal;
}

async function openObjectInsights(id) {
  var record = (state.objects || []).find(function (item) { return String(item.id) === String(id); });
  if (!record) return;
  try {
    var insights = await api("/api/objects/" + encodeURIComponent(id) + "/insights");
    var stats = insights.analytics || {}, summary = insights.summary || {}, clients = insights.clients || [];
    var impressions = Number(stats.impressions || 0), details = Number(stats.details || 0), inquiries = Number(summary.inquiries || 0), viewings = Number(summary.viewings || 0);
    function percent(value, total) { return total ? Math.round((Number(value || 0) / total) * 100) + "%" : "—"; }
    var image = propertyImages(record, "ru")[0];
    var title = localized(record.title, "ru") || record.reference || "Объект";
    var location = [localized(record.city, "ru"), localized(record.district, "ru")].filter(Boolean).join(", ");
    var dialog = openDialog({
      title: "Эффективность объекта",
      drawer: true,
      wide: true,
      body: '<div class="object-insights stack"><section class="object-insights-head">' +
          (image ? '<img src="' + imageUrl("objects", record.id, image) + '" alt="">' : '<span class="object-insights-placeholder">⌂</span>') +
          '<div><h2>' + esc(title) + '</h2><div class="small muted">' + esc([record.reference, location].filter(Boolean).join(" · ") || "Без номера и расположения") + '</div><div class="row wrap" style="margin-top:7px"><span class="chip ' + statusKind(record.status) + '">' + esc(statusName(record.status)) + '</span><span class="small faint">данные обновлены ' + (stats.updatedAt ? ago(stats.updatedAt) : "ещё не собирались") + '</span></div></div></section>' +
        '<div class="grid cols-4 object-insight-kpis">' + kpiCard("Показы", num(impressions), "карточек в каталоге") + kpiCard("Открыли подробнее", num(details), percent(details, impressions) + " от показов") + kpiCard("Обращения", num(inquiries), percent(inquiries, impressions) + " от показов") + kpiCard("Просмотры объекта", num(viewings), percent(viewings, inquiries) + " от обращений") + '</div>' +
        '<section class="card"><header><div><h3>Путь клиента</h3><span class="small muted">События считаются с момента последнего обнуления статистики</span></div></header><div class="card-body"><div class="object-path"><div><b>' + num(impressions) + '</b><span>увидели карточку</span></div><i>→</i><div><b>' + num(details) + '</b><span>открыли подробнее</span></div><i>→</i><div><b>' + num(inquiries) + '</b><span>обратились</span></div><i>→</i><div><b>' + num(viewings) + '</b><span>записались на просмотр</span></div></div><div class="row wrap object-signal-summary"><span class="chip">❤️ Сейчас в избранном: ' + num(summary.favorites) + '</span><span class="chip">⚖️ Сравнивают: ' + num(summary.comparisons) + '</span><span class="chip">Просматривали: ' + num(summary.viewed) + '</span><span class="chip">Подходит по запросу: ' + num(summary.matches) + '</span><span class="chip">Галерея: ' + num(stats.galleries) + '</span><span class="chip">Связь с менеджером: ' + num(stats.managerContacts) + '</span></div></div></section>' +
        '<section class="card"><header><div><h3>Заинтересованные клиенты</h3><span class="small muted">Сначала показаны клиенты с обращениями и сильными сигналами</span></div><span class="chip brand">' + num(summary.clients) + '</span></header>' +
          (clients.length ? '<div class="object-client-list">' + clients.map(function (client) {
            var displayName = client.contactName || [client.firstName, client.lastName].filter(Boolean).join(" ") || (client.username ? "@" + client.username : "Клиент " + client.id);
            return '<div class="object-client"><button class="object-client-main" data-insight-client="' + esc(client.id) + '" type="button"><span class="conversation-avatar">' + esc(initials(displayName)) + '</span><span class="object-client-copy"><b>' + esc(displayName) + '</b><small>' + esc([client.phone, client.username ? "@" + client.username : "", (client.preferredLanguage || "").toUpperCase()].filter(Boolean).join(" · ") || "контакты не указаны") + '</small><span class="row wrap">' + client.signals.map(function (signal) { return '<span class="chip ' + (signal === "inquiry" ? "brand" : "") + '">' + esc(insightSignalLabel(signal)) + '</span>'; }).join("") + '</span></span></button>' +
              (client.latestInquiryId ? '<button class="btn secondary small" data-insight-conversation="' + esc(client.latestInquiryId) + '" type="button">Переписка' + (client.inquiryCount > 1 ? " · " + num(client.inquiryCount) : "") + '</button>' : '<span class="small faint">' + ago(client.lastSeenAt) + '</span>') + '</div>';
          }).join("") + '</div>' : '<div class="empty"><b>Сигналов интереса пока нет</b>Здесь появятся клиенты, которые смотрели, сохраняли, сравнивали объект или обращались по нему</div>') + '</section></div>',
      footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button><button class="btn" id="editInsightObject" type="button">Редактировать объект</button>',
      ready: function (root) {
        root.querySelector("#editInsightObject").onclick = function () { root.closeClean(); openRecordEditor("objects", id); };
        root.querySelectorAll("[data-insight-client]").forEach(function (button) {
          button.onclick = function () { root.closeClean(); openClient(button.dataset.insightClient); };
        });
        root.querySelectorAll("[data-insight-conversation]").forEach(function (button) {
          button.onclick = async function () {
            root.closeClean();
            selectedInquiry = button.dataset.insightConversation;
            await go("inquiries", "inbox");
          };
        });
      },
    });
    return dialog;
  } catch (error) { fail(error); }
}

// --- Редактор объекта и акции ------------------------------------------------
function imageBlock(kind, record, language) {
  var images = record ? propertyImages(record, language) : [];
  return '<div data-langpane="' + language + '" class="' + (language === "ru" ? "" : "hidden") + '">' +
    '<div class="image-list" data-images="' + language + '">' + images.map(function (image) {
      return '<span class="media-thumb"><img src="' + imageUrl(kind, record.id, image, language) + '" alt="">' +
        '<button class="media-remove" data-remove="' + esc(image.id) + '" type="button" title="Убрать фото">✕</button></span>';
    }).join("") + "</div>" +
    '<div class="image-upload-row"><label class="btn secondary small">＋ Добавить фото<input type="file" accept="image/jpeg,image/png" multiple data-upload="' + language + '" class="file-hidden"></label>' +
    '<span class="small muted" data-image-count="' + language + '">' + images.length + ' из 10</span></div>' +
    '<div class="hint">Первое фото станет обложкой. Для каждого языка загружается свой набор.</div></div>';
}

function openRecordEditor(kind, id) {
  var record = id ? (state[kind] || []).find(function (item) { return item.id === id; }) : null;
  var isObject = kind === "objects";
  var title = record ? localized(record.title, "ru") || "Без названия" : isObject ? "Новый объект" : "Новая акция";
  var body = '<div class="editor-layout"><div class="editor-form stack">' +
    '<div class="editor-language"><div class="row wrap">' + languageTabs() + '<span class="hint">Редактируется выбранный язык</span></div></div>' +
    (isObject ? '<div class="publication-check" id="publicationCheck"></div>' : "") +
    '<details class="editor-section" open><summary><b>Карточка для клиента</b><span>название, описание и фотографии</span></summary><div class="editor-section-body stack">' +
      translatedField("title", "Название", record && record.title, false, "", true) +
      (isObject ? translatedField("description", "Описание", record && record.description, true, "", true) : translatedField("text", "Текст акции", record && record.text, true)) +
      '<div class="field"><span class="field-label">Фотографии' + (isObject ? ' <span class="required">*</span>' : "") + '</span>' + LANGUAGES.map(function (language) { return imageBlock(kind, record, language[0]); }).join("") + "</div>" +
    "</div></details>" +
    (isObject
      ? '<details class="editor-section" open><summary><b>Цена и расположение</b><span>главные данные карточки</span></summary><div class="editor-section-body stack"><div class="grid cols-3">' +
          '<div class="field"><label>Тип</label><select id="fType">' + PROPERTY_TYPES.map(function (type) {
            return '<option value="' + type[0] + '"' + (record && record.propertyType === type[0] ? " selected" : "") + ">" + type[1] + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Сделка</label><select id="fDeal"><option value="sale"' + (record && record.dealType === "rent" ? "" : " selected") + '>Продажа</option><option value="rent"' + (record && record.dealType === "rent" ? " selected" : "") + ">Аренда</option></select></div>" +
          '<div class="field"><label>Статус</label><select id="fStatus">' + PROPERTY_STATUS.map(function (item) {
            return '<option value="' + item[0] + '"' + ((record ? record.status : "hidden") === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Цена</label><input id="fPrice" type="number" min="0" value="' + esc(record && record.priceValue || "") + '"></div>' +
          '<div class="field"><label>Валюта</label><select id="fCurrency">' + ["EUR", "USD", "GBP"].map(function (code) {
            return '<option value="' + code + '"' + (record && record.currency === code ? " selected" : "") + ">" + code + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Период</label><select id="fPeriod"><option value="total">Цена целиком</option><option value="month"' + (record && record.pricePeriod === "month" ? " selected" : "") + '>в месяц</option><option value="week"' + (record && record.pricePeriod === "week" ? " selected" : "") + ">в неделю</option></select></div>" +
        "</div>" +
        '<div class="grid cols-3">' + translatedField("city", "Город", record && record.city, false, "", true) + translatedField("district", "Район", record && record.district) + translatedField("price", "Цена по запросу / текст", record && record.price) + "</div>" +
        '<div class="hint">В краткой карточке показываются цена, город и район. Текстовая цена используется, если числовая цена не указана.</div></div></details>' +
        '<details class="editor-section"><summary><b>Характеристики</b><span>единые строки с понятными подписями</span></summary><div class="editor-section-body stack"><div class="grid cols-3">' +
          '<div class="field"><label>Спальни <span class="required" data-required="bedrooms">*</span></label><input id="fBedrooms" type="number" min="0" value="' + esc(record && record.bedrooms != null ? record.bedrooms : "") + '"></div>' +
          '<div class="field"><label>Санузлы <span class="required" data-required="bathrooms">*</span></label><input id="fBathrooms" type="number" min="0" value="' + esc(record && record.bathrooms || "") + '"></div>' +
          '<div class="field"><label>Площадь, м² <span class="required" data-required="area">*</span></label><input id="fArea" type="number" min="0" value="' + esc(record && record.area || "") + '"></div>' +
          '<div class="field"><label>Участок, м² <span class="required" data-required="plotArea">*</span></label><input id="fPlot" type="number" min="0" value="' + esc(record && record.plotArea || "") + '"></div>' +
          '<div class="field"><label>Этаж</label><input id="fFloor" value="' + esc(record && record.floor || "") + '"></div>' +
          '<div class="field"><label>Этажей в доме</label><input id="fFloors" value="' + esc(record && record.floors || "") + '"></div>' +
          '<div class="field"><label>До моря, м</label><input id="fSea" type="number" min="0" value="' + esc(record && record.distanceSea || "") + '"></div>' +
          '<div class="field"><label>Состояние</label><select id="fCondition">' + CONDITIONS.map(function (item) {
            return '<option value="' + item[0] + '"' + (record && record.condition === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
          }).join("") + "</select></div>" +
        "</div>" +
        '<div class="field"><span class="field-label">Метки</span><div class="row wrap">' + BADGES.map(function (badge) {
          return '<label class="check"><input type="checkbox" data-badge="' + badge[0] + '"' + (record && (record.badges || []).indexOf(badge[0]) >= 0 ? " checked" : "") + "> " + badge[1] + "</label>";
        }).join("") + "</div></div></div></details>" +
        '<details class="editor-section"><summary><b>Адрес и ссылки</b><span>данные подробной карточки и внешние страницы</span></summary><div class="editor-section-body stack">' +
          '<div class="grid cols-2"><div class="field"><label>Номер объекта <span class="required">*</span></label><input id="fReference" value="' + esc(record && record.reference || "") + '"></div>' + translatedField("address", "Адрес", record && record.address) + "</div>" +
          '<div class="grid cols-2"><div class="field"><label>Ссылка на объект</label><input id="fUrl" value="' + esc(record && record.url || "") + '"></div>' +
          '<div class="field"><label>Ссылка на карту</label><input id="fMap" value="' + esc(record && record.mapUrl || "") + '"></div></div>' +
          '<div class="hint">Номер объекта и полный адрес показываются клиенту только после нажатия «Подробнее».</div>' +
        "</div></details>"
      : '<details class="editor-section" open><summary><b>Показ акции</b><span>срок действия и ссылка</span></summary><div class="editor-section-body stack">' +
          '<div class="grid cols-2"><div class="field"><label>Начало</label><input id="fStart" type="date" value="' + esc((record && record.startAt || "").slice(0, 10)) + '"></div>' +
          '<div class="field"><label>Окончание</label><input id="fEnd" type="date" value="' + esc((record && record.endAt || "").slice(0, 10)) + '"></div></div>' +
          '<label class="check"><input type="checkbox" id="fEnabled"' + (!record || record.enabled !== false ? " checked" : "") + "> Акция включена</label>" +
          '<div class="hint">Включённая акция показывается только между датами начала и окончания включительно.</div>' +
          '<div class="field"><label>Ссылка</label><input id="fUrl" value="' + esc(record && record.url || "") + '"></div>' +
        "</div></details>") +
    '</div><aside class="editor-preview-panel"><div class="editor-preview-head"><b>Как увидит клиент</b><span id="recordPreviewLanguage">Русский</span></div><div class="tg-preview" id="recordPreview"></div><div class="tg-note" style="margin-top:8px">Предпросмотр обновляется сразу. Telegram может незначительно изменить переносы строк.</div></aside></div>';

  openDialog({
    title: title,
    drawer: true,
    wide: true,
    protectChanges: true,
    body: body,
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveRecord" type="button">Сохранить</button>',
    ready: function (dialog) {
      bindLanguageTabs(dialog);
      var pendingImages = { ru: [], en: [], es: [] };
      var removedImages = { ru: [], en: [], es: [] };
      var previewWords = {
        ru: { empty: "Заполните карточку — здесь появится её вид в Telegram", sold: "Продан", hidden: "Скрыт", promotion: "Подробнее об акции" },
        en: { empty: "Fill in the card to see its Telegram preview here", sold: "Sold", hidden: "Hidden", promotion: "Learn more" },
        es: { empty: "Completa la ficha para ver aquí su aspecto en Telegram", sold: "Vendido", hidden: "Oculto", promotion: "Más información" },
      };
      function value(id) {
        var input = dialog.querySelector("#" + id);
        return input ? String(input.value || "").trim() : "";
      }
      function translatedValue(name, language) {
        var input = dialog.querySelector('[data-tr="' + name + '"][data-lang="' + language + '"]');
        return input ? String(input.value || "").trim() : "";
      }
      function interfaceCopy(group, language) {
        return ((interfaceTexts()[group] || {})[language] || {});
      }
      function editorPublicationIssues(language) {
        if (!isObject) return [];
        var issues = [];
        var type = value("fType");
        if (!translatedValue("title", language)) issues.push("название");
        if (!translatedValue("description", language)) issues.push("описание");
        if (!translatedValue("city", language)) issues.push("город");
        if (!dialog.querySelector('[data-images="' + language + '"] .media-thumb')) issues.push("фотография");
        if (!value("fReference")) issues.push("номер объекта");
        if (type === "land") {
          if (!(Number(value("fPlot")) > 0)) issues.push("площадь участка");
        } else if (!(Number(value("fArea")) > 0)) issues.push("площадь");
        if (["apartment", "house", "villa", "townhouse", "newbuild"].indexOf(type) >= 0) {
          if (value("fBedrooms") === "" || !Number.isFinite(Number(value("fBedrooms")))) issues.push("спальни");
          if (!(Number(value("fBathrooms")) > 0)) issues.push("санузлы");
        }
        return issues;
      }
      function renderPublicationCheck() {
        if (!isObject) return;
        var rows = LANGUAGES.map(function (language) {
          return { code: language[0], name: language[1], issues: editorPublicationIssues(language[0]) };
        });
        var ready = rows.every(function (row) { return !row.issues.length; });
        var status = value("fStatus");
        var liveAndIncomplete = ["active", "reserved"].indexOf(status) >= 0 && !ready;
        dialog.querySelector("#publicationCheck").innerHTML =
          '<div class="publication-head"><div><b>Готовность карточки</b><span>Единый стандарт для всех языков</span></div><span class="chip ' + (ready ? "ok" : "warn") + '">' + (ready ? "готова к публикации" : "нужно заполнить") + "</span></div>" +
          '<div class="publication-rows">' + rows.map(function (row) {
            return '<div class="publication-row"><b>' + row.code.toUpperCase() + '</b><span class="grow">' + esc(row.name) + '</span><span class="' + (row.issues.length ? "warn-text" : "ok-text") + '">' + (row.issues.length ? esc(row.issues.join(", ")) : "готово") + "</span></div>";
          }).join("") + "</div>" +
          (liveAndIncomplete ? '<div class="publication-warning">Сохранить карточку можно и так, но клиенты видят её только на тех языках, где заполнено всё. Пока не хватает данных, объект в каталоге не показывается.</div>' : "");
        var type = value("fType");
        var residential = ["apartment", "house", "villa", "townhouse", "newbuild"].indexOf(type) >= 0;
        dialog.querySelectorAll("[data-required]").forEach(function (marker) {
          var required = marker.dataset.required === "plotArea" ? type === "land" : marker.dataset.required === "area" ? type !== "land" : residential;
          marker.classList.toggle("hidden", !required);
        });
      }
      function metreShort(language) {
        return language === "ru" ? "м" : "m";
      }
      function pricePreview(language, actions) {
        var amount = Number(value("fPrice"));
        if (Number.isFinite(amount) && amount > 0) {
          var locale = language === "en" ? "en-US" : language === "es" ? "es-ES" : "ru-RU";
          var currency = value("fCurrency") || "EUR";
          var symbols = { EUR: "€", USD: "$", GBP: "£" };
          var period = value("fPeriod") === "month" ? actions.priceMonth : value("fPeriod") === "week" ? actions.priceWeek : "";
          return [new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount), symbols[currency] || currency, period].filter(Boolean).join(" ");
        }
        return translatedValue("price", language) || actions.priceOnRequest || "";
      }
      function renderRecordPreview() {
        var language = dialog.dataset.activeLanguage || "ru";
        var words = previewWords[language] || previewWords.ru;
        var languageName = (LANGUAGES.find(function (item) { return item[0] === language; }) || ["", language])[1];
        dialog.querySelector("#recordPreviewLanguage").textContent = languageName;
        var preview = dialog.querySelector("#recordPreview");
        var titleText = translatedValue("title", language);
        var cover = dialog.querySelector('[data-images="' + language + '"] .media-thumb img');
        var imageHtml = cover ? '<img src="' + esc(cover.src) + '" alt="">' : "";
        var lines = [];
        var buttons = [];
        if (isObject) {
          var actions = interfaceCopy("propertyActions", language);
          var comparison = interfaceCopy("comparison", language);
          var status = value("fStatus");
          var statusText = status === "reserved" ? "🟡 " + (actions.reserved || "") : status === "sold" ? "⚪ " + words.sold : status === "hidden" ? "⚪ " + words.hidden : "🟢 " + (actions.available || "");
          var typeText = interfaceCopy("propertyTypes", language)[value("fType")] || "";
          var dealText = value("fDeal") === "rent" ? actions.forRent : actions.forSale;
          var city = translatedValue("city", language), district = translatedValue("district", language);
          var locale = language === "en" ? "en-US" : language === "es" ? "es-ES" : "ru-RU";
          var metre = metreShort(language);
          function factNumber(field) {
            var raw = value(field);
            var number = Number(raw);
            return raw !== "" && Number.isFinite(number) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(number) : raw;
          }
          var facts = [];
          if (value("fBedrooms") !== "") facts.push("🛏 " + (actions.bedroomsLabel || "") + ": " + factNumber("fBedrooms"));
          if (value("fBathrooms")) facts.push("🚿 " + (actions.bathroomsLabel || "") + ": " + factNumber("fBathrooms"));
          if (value("fArea")) facts.push("📐 " + (actions.areaLabel || "") + ": " + factNumber("fArea") + " " + metre + "²");
          if (value("fPlot")) facts.push("🌿 " + (actions.plotAreaLabel || "") + ": " + factNumber("fPlot") + " " + metre + "²");
          if (value("fFloor") || value("fFloors")) facts.push("🏢 " + (actions.floor || "") + ": " + [value("fFloor"), value("fFloors")].filter(Boolean).join("/"));
          if (value("fSea")) facts.push("🌊 " + (actions.distanceSeaLabel || "") + ": " + factNumber("fSea") + " " + metre);
          var specs = [];
          for (var factIndex = 0; factIndex < facts.length; factIndex += 2) specs.push(facts.slice(factIndex, factIndex + 2).join("   ·   "));
          var badges = Array.from(dialog.querySelectorAll("[data-badge]:checked")).map(function (box) { return interfaceCopy("propertyBadges", language)[box.dataset.badge]; }).filter(Boolean);
          if (titleText) lines.push(titleText);
          lines.push([statusText.trim(), typeText, dealText].filter(Boolean).join(" · "));
          if (badges.length) lines.push("✦ " + badges.join(" · "));
          var shownPrice = pricePreview(language, actions);
          if (shownPrice || city || district) lines.push("");
          if (shownPrice) lines.push("💰 " + shownPrice);
          if (city || district) lines.push("📍 " + [city, district].filter(Boolean).join(", "));
          if (specs.length) lines.push("", ...specs);
          var description = translatedValue("description", language).split("\n").map(function (line) { return line.trim(); }).find(Boolean) || "";
          if (description) lines.push("", description.length > 150 ? description.slice(0, 149).trim() + "…" : description);
          if ((!Number.isFinite(Number(value("fPrice"))) || Number(value("fPrice")) <= 0) && !translatedValue("price", language)) buttons.push('<div class="tg-button">💰 ' + esc(actions.askPrice || "") + "</div>");
          if (status === "active") buttons.push('<div class="tg-button">📅 ' + esc(actions.viewing || "") + "</div>");
          buttons.push('<div class="tg-button">📋 ' + esc(actions.details || "") + "</div>");
          buttons.push('<div class="row"><div class="tg-button">❤️ ' + esc(actions.cardFavorite || "") + '</div><div class="tg-button">⚖️ ' + esc(comparison.cardAddShort || comparison.cardAdd || "") + "</div></div>");
          buttons.push('<div class="tg-button">💬 ' + esc(actions.contactManager || "") + "</div>");
        } else {
          var promoActions = interfaceCopy("propertyActions", language);
          if (titleText) lines.push(titleText);
          var promoText = translatedValue("text", language);
          if (promoText) lines.push(promoText);
          if (value("fUrl")) buttons.push('<div class="tg-button">🌐 ' + esc(promoActions.viewWebsite || words.promotion) + "</div>");
        }
        if (!imageHtml && !lines.filter(Boolean).length) {
          preview.innerHTML = '<div class="editor-preview-empty">' + esc(words.empty) + "</div>";
          return;
        }
        var previewText = lines.filter(function (line, index, items) { return line || index === 0 || items[index - 1]; }).map(function (line, index) {
          var safe = esc(line);
          if (line && (index === 0 || line.indexOf("💰 ") === 0)) return "<b>" + safe + "</b>";
          if (line && (/^[🟢🟡⚪]/u.test(line) || line.indexOf("✦ ") === 0)) return "<i>" + safe + "</i>";
          return safe;
        }).join("\n");
        preview.innerHTML = '<div class="tg-bubble">' + imageHtml + '<div class="tg-text">' + previewText + "</div></div>" +
          (buttons.length ? '<div class="tg-buttons">' + buttons.join("") + "</div>" : "");
      }
      function updateImageCount(language) {
        var list = dialog.querySelector('[data-images="' + language + '"]');
        var count = list ? list.querySelectorAll(".media-thumb").length : 0;
        var label = dialog.querySelector('[data-image-count="' + language + '"]');
        if (label) label.textContent = count + " из 10";
        var upload = dialog.querySelector('[data-upload="' + language + '"]');
        if (upload) {
          upload.disabled = count >= 10;
          upload.closest("label").style.opacity = count >= 10 ? ".55" : "";
        }
      }
      function addPendingImage(language, pending) {
        var list = dialog.querySelector('[data-images="' + language + '"]');
        var tile = document.createElement("span");
        tile.className = "media-thumb";
        tile.innerHTML = '<img src="' + esc(pending.dataUrl) + '" alt=""><button class="media-remove" type="button" title="Убрать фото">✕</button>';
        tile.querySelector("button").onclick = function () {
          pendingImages[language] = pendingImages[language].filter(function (item) { return item !== pending; });
          tile.remove();
          updateImageCount(language);
          renderRecordPreview();
          dialog.dispatchEvent(new Event("change", { bubbles: true }));
        };
        list.appendChild(tile);
        updateImageCount(language);
        renderRecordPreview();
      }
      dialog.querySelectorAll("[data-upload]").forEach(function (input) {
        input.onchange = function () {
          var language = input.dataset.upload;
          var count = dialog.querySelectorAll('[data-images="' + language + '"] .media-thumb').length;
          var files = Array.from(input.files || []).slice(0, Math.max(0, 10 - count));
          if ((input.files || []).length > files.length) toast("Для одного языка можно добавить не больше 10 фотографий");
          files.forEach(function (file) {
            var reader = new FileReader();
            reader.onload = function () {
              var pending = { dataUrl: reader.result, name: file.name };
              pendingImages[language].push(pending);
              addPendingImage(language, pending);
            };
            reader.readAsDataURL(file);
          });
          input.value = "";
        };
      });
      dialog.querySelectorAll("[data-remove]").forEach(function (button) {
        button.onclick = function () {
          var pane = button.closest("[data-langpane]");
          removedImages[pane.dataset.langpane].push(button.dataset.remove);
          button.parentElement.remove();
          updateImageCount(pane.dataset.langpane);
          renderRecordPreview();
          dialog.dispatchEvent(new Event("change", { bubbles: true }));
        };
      });
      LANGUAGES.forEach(function (language) { updateImageCount(language[0]); });
      dialog.addEventListener("languagechange", renderRecordPreview);
      dialog.addEventListener("input", renderRecordPreview);
      dialog.addEventListener("change", renderRecordPreview);
      dialog.addEventListener("input", renderPublicationCheck);
      dialog.addEventListener("change", renderPublicationCheck);
      renderRecordPreview();
      renderPublicationCheck();
      // Предпросмотр говорит теми же словами, что бот: тексты интерфейса
      // грузятся отдельно, поэтому обновляем его, когда они приедут.
      loadInterfaceText().then(renderRecordPreview).catch(function () {});
      dialog.querySelector("#saveRecord").onclick = async function () {
        // Незаполненную карточку сохраняем: клиент увидит её только на тех
        // языках, где всё заполнено. Раньше кнопка «Сохранить» здесь молча
        // ничего не делала, и поправить город в карточке было нельзя.
        var incomplete = isObject && ["active", "reserved"].indexOf(value("fStatus")) >= 0
          ? LANGUAGES.map(function (language) { return { language: language[0], issues: editorPublicationIssues(language[0]) }; }).filter(function (entry) { return entry.issues.length; })
          : [];
        var payload = {
          title: collectTranslated(dialog, "title"),
          url: (dialog.querySelector("#fUrl") || {}).value || "",
          imageDataUrlsByLanguage: pendingImages,
          removeImageIdsByLanguage: removedImages,
        };
        if (isObject) {
          Object.assign(payload, {
            propertyType: dialog.querySelector("#fType").value,
            dealType: dialog.querySelector("#fDeal").value,
            status: dialog.querySelector("#fStatus").value,
            priceValue: dialog.querySelector("#fPrice").value,
            currency: dialog.querySelector("#fCurrency").value,
            pricePeriod: dialog.querySelector("#fPeriod").value,
            bedrooms: dialog.querySelector("#fBedrooms").value,
            bathrooms: dialog.querySelector("#fBathrooms").value,
            area: dialog.querySelector("#fArea").value,
            plotArea: dialog.querySelector("#fPlot").value,
            floor: dialog.querySelector("#fFloor").value,
            floors: dialog.querySelector("#fFloors").value,
            distanceSea: dialog.querySelector("#fSea").value,
            condition: dialog.querySelector("#fCondition").value,
            reference: dialog.querySelector("#fReference").value,
            mapUrl: dialog.querySelector("#fMap").value,
            city: collectTranslated(dialog, "city"),
            district: collectTranslated(dialog, "district"),
            address: collectTranslated(dialog, "address"),
            price: collectTranslated(dialog, "price"),
            description: collectTranslated(dialog, "description"),
            badges: Array.from(dialog.querySelectorAll("[data-badge]")).filter(function (box) { return box.checked; }).map(function (box) { return box.dataset.badge; }),
          });
        } else {
          Object.assign(payload, {
            text: collectTranslated(dialog, "text"),
            startAt: dialog.querySelector("#fStart").value,
            endAt: dialog.querySelector("#fEnd").value,
            enabled: dialog.querySelector("#fEnabled").checked,
          });
        }
        try {
          var result = record
            ? await send("/api/" + kind + "/" + encodeURIComponent(record.id), "PATCH", payload)
            : await send("/api/" + kind, "POST", payload);
          dialog.closeClean();
          var done = result.alertsQueued ? "Сохранено, уведомления получат " + counted(result.alertsQueued, "клиент", "клиента", "клиентов") : "Сохранено";
          if (incomplete.length) {
            done += ". Клиенты пока не видят карточку на " + incomplete.map(function (entry) { return entry.language.toUpperCase(); }).join(", ") +
              ": не хватает " + incomplete[0].issues.join(", ");
          }
          toast(done, incomplete.length > 0);
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

// --- Акции ------------------------------------------------------------------
function renderOffers(host) {
  var rows = state.promotions || [];
  pageAction("＋ Акция", function () { openRecordEditor("promotions", null); });
  host.innerHTML = '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:52px"></th><th>Акция</th><th>Срок</th><th>Показ</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (record) {
      var images = propertyImages(record, "ru");
      var displayStatus = promotionStatus(record);
      return '<tr data-id="' + esc(record.id) + '">' +
        "<td>" + (images.length ? '<img class="thumb" src="' + imageUrl("promotions", record.id, images[0], "ru") + '" alt="">' : '<span class="thumb"></span>') + "</td>" +
        '<td class="clickable" data-edit="1"><b>' + esc(localized(record.title, "ru") || "Без названия") + '</b><br><span class="small faint">' + esc(String(localized(record.text, "ru")).slice(0, 70)) + "</span></td>" +
        "<td>" + (record.startAt || record.endAt ? esc(dateShort(record.startAt) + " – " + dateShort(record.endAt)) : "без срока") + "</td>" +
        '<td><span class="chip ' + displayStatus.kind + '">' + displayStatus.label + "</span></td>" +
        '<td class="right"><button class="btn ghost small" data-delete="1">✕</button></td></tr>';
    }).join("") : '<tr><td colspan="5"><div class="empty"><b>Акций нет</b>Клиенты видят раздел «Акции» только когда есть действующие</div></td></tr>') +
    "</tbody></table></div></div>";
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    var id = row.dataset.id;
    row.querySelector("[data-edit]").onclick = function () { openRecordEditor("promotions", id); };
    row.querySelector("[data-delete]").onclick = async function () {
      if (!(await confirmDialog("Удалить акцию?", "Она исчезнет из раздела «Акции».", "Удалить", true))) return;
      try { await api("/api/promotions/" + encodeURIComponent(id), { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
    };
  });
}

// --- Загрузка с сайта ----------------------------------------------------------
function renderFeed(host) {
  var settings = state.config.feedImport || {};
  var last = settings.lastResult || null;
  host.innerHTML = '<div class="grid cols-2"><div class="card"><header><h3>Выгрузка с сайта</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="feedUrl">Ссылка на XML-выгрузку (формат Kyero)</label><input id="feedUrl" value="' + esc(settings.url || "") + '" placeholder="https://сайт/feed.xml"></div>' +
      '<label class="check"><input type="checkbox" id="feedPublish"' + (settings.publishNew ? " checked" : "") + "> новые объекты сразу показывать клиентам</label>" +
      '<label class="check"><input type="checkbox" id="feedDaily"' + (settings.daily ? " checked" : "") + "> обновлять каждый день</label>" +
      '<div class="row wrap"><button class="btn secondary" id="feedCheck" type="button">Проверить</button><button class="btn" id="feedImport" type="button">Загрузить</button><button class="btn ghost small" id="feedSave" type="button">Сохранить настройки</button></div>' +
      '<div id="feedResult" class="small muted"></div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Последняя загрузка</h3></header><div class="card-body stack">' +
      (settings.lastRunAt ? '<div class="small muted">' + dateTime(settings.lastRunAt) + "</div>" : '<div class="muted">Загрузок ещё не было</div>') +
      (last ? '<div class="grid cols-3">' + kpiCard("Добавлено", num(last.added)) + kpiCard("Обновлено", num(last.updated)) + kpiCard("Фото", num(last.photos)) + "</div>" : "") +
      (settings.lastError ? '<div class="chip bad">' + esc(settings.lastError) + "</div>" : "") +
      '<div class="hint">Объекты сопоставляются по номеру (ref). Тексты, которые вы правили в панели, не перезаписываются.</div>' +
    "</div></div></div>";

  function payload() {
    return { url: host.querySelector("#feedUrl").value.trim(), publishNew: host.querySelector("#feedPublish").checked, daily: host.querySelector("#feedDaily").checked };
  }
  host.querySelector("#feedCheck").onclick = async function () {
    host.querySelector("#feedResult").textContent = "Проверяем…";
    try {
      var result = await send("/api/feed/preview", "POST", payload());
      host.querySelector("#feedResult").textContent = "Будет добавлено: " + result.added + ", обновлено: " + result.updated + ", фотографий: " + result.photos + ".";
    } catch (error) { host.querySelector("#feedResult").textContent = ""; fail(error); }
  };
  host.querySelector("#feedImport").onclick = async function () {
    if (!(await confirmDialog("Загрузить объекты?", "Новые объекты добавятся, существующие обновятся по номеру.", "Загрузить"))) return;
    host.querySelector("#feedResult").textContent = "Загружаем, это может занять несколько минут…";
    try {
      var result = await send("/api/feed/import", "POST", payload());
      toast("Добавлено " + result.added + ", обновлено " + result.updated);
      await reload();
    } catch (error) { host.querySelector("#feedResult").textContent = ""; fail(error); }
  };
  host.querySelector("#feedSave").onclick = async function () {
    try { await send("/api/feed/settings", "PUT", payload()); toast("Настройки сохранены"); await reload(); } catch (error) { fail(error); }
  };
}

VIEWS.catalog = {
  subtitle: function () { return "Объекты и акции, которые видит клиент"; },
  render: function (host, tab) {
    if (tab === "offers") return renderOffers(host);
    if (tab === "feed") return renderFeed(host);
    renderObjects(host);
  },
};
`;

export { CATALOG_JS };
