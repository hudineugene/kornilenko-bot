// Каталог: объекты, акции и загрузка объектов с сайта.

const CATALOG_JS = String.raw`
var catalogSearch = "", catalogStatus = "";
var LANGUAGES = [["ru", "Русский"], ["en", "English"], ["es", "Español"]];
var PROPERTY_TYPES = [["apartment", "Квартира"], ["house", "Дом"], ["villa", "Вилла"], ["townhouse", "Таунхаус"], ["land", "Участок"], ["commercial", "Коммерческая"], ["newbuild", "Новостройка"], ["other", "Другое"]];
var PROPERTY_STATUS = [["active", "Активен"], ["reserved", "Забронирован"], ["sold", "Продан"], ["hidden", "Скрыт"]];
var BADGES = [["new", "Новинка"], ["recommended", "Рекомендуем"], ["exclusive", "Эксклюзив"], ["price_reduced", "Цена снижена"]];
var CONDITIONS = [["", "Не указано"], ["new", "Новое"], ["renovated", "После ремонта"], ["needs_renovation", "Требует ремонта"], ["under_construction", "Строится"]];

// Карточка показывается клиенту только на тех языках, где есть название и фото.
function missingLanguages(record) {
  return LANGUAGES.filter(function (language) {
    return !((record.title || {})[language[0]] || "").trim() || !propertyImages(record, language[0]).length;
  }).map(function (language) { return language[0].toUpperCase(); });
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
function imageUrl(kind, recordId, image, language) {
  return "/api/media/" + kind + "/" + encodeURIComponent(recordId) + "/" + encodeURIComponent(language) + "/" + encodeURIComponent(image.id);
}

// Поля с переводом: вкладки языков переключают все такие поля сразу.
function translatedField(name, label, value, multiline, placeholder) {
  return '<div class="field"><label>' + esc(label) + "</label>" + LANGUAGES.map(function (language) {
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
  root.querySelectorAll("[data-langtabs] button").forEach(function (button) {
    button.onclick = function () {
      root.querySelectorAll("[data-langtabs] button").forEach(function (other) { other.classList.toggle("active", other === button); });
      root.querySelectorAll(".lang-input").forEach(function (input) { input.classList.toggle("hidden", input.dataset.lang !== button.dataset.lang); });
      root.querySelectorAll("[data-langpane]").forEach(function (pane) { pane.classList.toggle("hidden", pane.dataset.langpane !== button.dataset.lang); });
    };
  });
}
function collectTranslated(root, name) {
  var value = {};
  root.querySelectorAll('[data-tr="' + name + '"]').forEach(function (input) { value[input.dataset.lang] = input.value.trim(); });
  return value;
}

// --- Объекты --------------------------------------------------------------------
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
    '<div class="card"><div class="table-wrap"><table><thead><tr><th style="width:52px"></th><th>Объект</th><th>Тип</th><th>Город</th><th class="right">Цена</th><th>Статус</th><th class="right">Показы</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (record, index) {
      var images = propertyImages(record, "ru");
      var stats = (state.analytics && state.analytics.properties && state.analytics.properties[record.id]) || {};
      return '<tr data-id="' + esc(record.id) + '">' +
        "<td>" + (images.length ? '<img class="thumb" src="' + imageUrl("objects", record.id, images[0], "ru") + '" alt="">' : '<span class="thumb"></span>') + "</td>" +
        '<td class="clickable" data-edit="1"><b>' + esc(localized(record.title, "ru") || "Без названия") + "</b>" +
          (record.reference ? ' <span class="small faint">' + esc(record.reference) + "</span>" : "") +
          (missingLanguages(record).length ? '<br><span class="chip warn">нет перевода: ' + esc(missingLanguages(record).join(", ")) + "</span>" : "") + "</td>" +
        "<td>" + esc((PROPERTY_TYPES.find(function (type) { return type[0] === record.propertyType; }) || ["", "—"])[1]) + '<br><span class="small faint">' + (record.dealType === "rent" ? "аренда" : "продажа") + "</span></td>" +
        "<td>" + esc(localized(record.city, "ru") || "—") + "</td>" +
        '<td class="right nowrap">' + (record.priceValue ? esc(money(record.priceValue, record.currency)) : esc(localized(record.price, "ru") || "по запросу")) + "</td>" +
        '<td><span class="chip ' + statusKind(record.status) + '">' + esc(statusName(record.status)) + "</span></td>" +
        '<td class="right">' + num(stats.views || 0) + "</td>" +
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
    row.querySelectorAll("[data-move]").forEach(function (button) {
      button.onclick = async function () {
        try { await send("/api/objects/" + encodeURIComponent(id) + "/move", "POST", { direction: button.dataset.move }); await reload(); } catch (error) { fail(error); }
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

// --- Редактор объекта и акции ------------------------------------------------
function imageBlock(kind, record, language) {
  var images = record ? propertyImages(record, language) : [];
  return '<div data-langpane="' + language + '" class="' + (language === "ru" ? "" : "hidden") + '">' +
    '<div class="row wrap" data-images="' + language + '">' + images.map(function (image) {
      return '<span class="row" style="position:relative"><img class="thumb" style="width:64px;height:48px" src="' + imageUrl(kind, record.id, image, language) + '" alt="">' +
        '<button class="btn ghost small" data-remove="' + esc(image.id) + '" type="button">✕</button></span>';
    }).join("") + "</div>" +
    '<input type="file" accept="image/jpeg,image/png" multiple data-upload="' + language + '" class="small">' +
    '<div class="hint">До 10 фото на язык. Первое — обложка карточки.</div></div>';
}

function openRecordEditor(kind, id) {
  var record = id ? (state[kind] || []).find(function (item) { return item.id === id; }) : null;
  var isObject = kind === "objects";
  var title = record ? localized(record.title, "ru") || "Без названия" : isObject ? "Новый объект" : "Новая акция";
  var body = '<div class="stack">' + languageTabs() +
    translatedField("title", "Название", record && record.title) +
    (isObject
      ? '<div class="grid cols-3">' +
          '<div class="field"><label>Тип</label><select id="fType">' + PROPERTY_TYPES.map(function (type) {
            return '<option value="' + type[0] + '"' + (record && record.propertyType === type[0] ? " selected" : "") + ">" + type[1] + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Сделка</label><select id="fDeal"><option value="sale"' + (record && record.dealType === "rent" ? "" : " selected") + '>Продажа</option><option value="rent"' + (record && record.dealType === "rent" ? " selected" : "") + ">Аренда</option></select></div>" +
          '<div class="field"><label>Статус</label><select id="fStatus">' + PROPERTY_STATUS.map(function (item) {
            return '<option value="' + item[0] + '"' + (record && record.status === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Цена</label><input id="fPrice" type="number" min="0" value="' + esc(record && record.priceValue || "") + '"></div>' +
          '<div class="field"><label>Валюта</label><select id="fCurrency">' + ["EUR", "USD", "GBP"].map(function (code) {
            return '<option value="' + code + '"' + (record && record.currency === code ? " selected" : "") + ">" + code + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Период</label><select id="fPeriod"><option value="total">Цена целиком</option><option value="month"' + (record && record.pricePeriod === "month" ? " selected" : "") + '>в месяц</option><option value="week"' + (record && record.pricePeriod === "week" ? " selected" : "") + ">в неделю</option></select></div>" +
          '<div class="field"><label>Спальни</label><input id="fBedrooms" type="number" min="0" value="' + esc(record && record.bedrooms || "") + '"></div>' +
          '<div class="field"><label>Санузлы</label><input id="fBathrooms" type="number" min="0" value="' + esc(record && record.bathrooms || "") + '"></div>' +
          '<div class="field"><label>Площадь, м²</label><input id="fArea" type="number" min="0" value="' + esc(record && record.area || "") + '"></div>' +
          '<div class="field"><label>Участок, м²</label><input id="fPlot" type="number" min="0" value="' + esc(record && record.plotArea || "") + '"></div>' +
          '<div class="field"><label>Этаж</label><input id="fFloor" value="' + esc(record && record.floor || "") + '"></div>' +
          '<div class="field"><label>Этажей в доме</label><input id="fFloors" value="' + esc(record && record.floors || "") + '"></div>' +
          '<div class="field"><label>До моря, м</label><input id="fSea" type="number" min="0" value="' + esc(record && record.distanceSea || "") + '"></div>' +
          '<div class="field"><label>Состояние</label><select id="fCondition">' + CONDITIONS.map(function (item) {
            return '<option value="' + item[0] + '"' + (record && record.condition === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Номер объекта</label><input id="fReference" value="' + esc(record && record.reference || "") + '"></div>' +
        "</div>" +
        translatedField("city", "Город", record && record.city) +
        translatedField("district", "Район", record && record.district) +
        translatedField("address", "Адрес", record && record.address) +
        translatedField("price", "Цена текстом (если не числом)", record && record.price) +
        translatedField("description", "Описание", record && record.description, true) +
        '<div class="field"><span class="field-label">Метки</span><div class="row wrap">' + BADGES.map(function (badge) {
          return '<label class="check"><input type="checkbox" data-badge="' + badge[0] + '"' + (record && (record.badges || []).indexOf(badge[0]) >= 0 ? " checked" : "") + "> " + badge[1] + "</label>";
        }).join("") + "</div></div>" +
        '<div class="grid cols-2"><div class="field"><label>Ссылка на объект</label><input id="fUrl" value="' + esc(record && record.url || "") + '"></div>' +
        '<div class="field"><label>Ссылка на карту</label><input id="fMap" value="' + esc(record && record.mapUrl || "") + '"></div></div>'
      : translatedField("text", "Текст акции", record && record.text, true) +
        '<div class="grid cols-2"><div class="field"><label>Начало</label><input id="fStart" type="date" value="' + esc((record && record.startAt || "").slice(0, 10)) + '"></div>' +
        '<div class="field"><label>Окончание</label><input id="fEnd" type="date" value="' + esc((record && record.endAt || "").slice(0, 10)) + '"></div></div>' +
        '<label class="check"><input type="checkbox" id="fEnabled"' + (!record || record.enabled !== false ? " checked" : "") + "> Акция показывается клиентам</label>" +
        '<div class="field"><label>Ссылка</label><input id="fUrl" value="' + esc(record && record.url || "") + '"></div>') +
    '<div class="field"><span class="field-label">Фотографии</span>' + LANGUAGES.map(function (language) { return imageBlock(kind, record, language[0]); }).join("") + "</div>" +
    "</div>";

  openDialog({
    title: title,
    drawer: true,
    body: body,
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveRecord" type="button">Сохранить</button>',
    ready: function (dialog) {
      bindLanguageTabs(dialog);
      var pendingImages = { ru: [], en: [], es: [] };
      var removedImages = { ru: [], en: [], es: [] };
      dialog.querySelectorAll("[data-upload]").forEach(function (input) {
        input.onchange = function () {
          var language = input.dataset.upload;
          Array.from(input.files || []).forEach(function (file) {
            var reader = new FileReader();
            reader.onload = function () {
              pendingImages[language].push({ dataUrl: reader.result, name: file.name });
              var list = dialog.querySelector('[data-images="' + language + '"]');
              var preview = document.createElement("img");
              preview.className = "thumb";
              preview.style.width = "64px";
              preview.style.height = "48px";
              preview.src = reader.result;
              list.appendChild(preview);
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
        };
      });
      dialog.querySelector("#saveRecord").onclick = async function () {
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
            ? await send("/api/" + kind + "/" + encodeURIComponent(record.id), "PUT", payload)
            : await send("/api/" + kind, "POST", payload);
          dialog.close();
          toast(result.alertsQueued ? "Сохранено, уведомления получат " + counted(result.alertsQueued, "клиент", "клиента", "клиентов") : "Сохранено");
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
      return '<tr data-id="' + esc(record.id) + '">' +
        "<td>" + (images.length ? '<img class="thumb" src="' + imageUrl("promotions", record.id, images[0], "ru") + '" alt="">' : '<span class="thumb"></span>') + "</td>" +
        '<td class="clickable" data-edit="1"><b>' + esc(localized(record.title, "ru") || "Без названия") + '</b><br><span class="small faint">' + esc(String(localized(record.text, "ru")).slice(0, 70)) + "</span></td>" +
        "<td>" + (record.startAt || record.endAt ? esc(dateShort(record.startAt) + " – " + dateShort(record.endAt)) : "без срока") + "</td>" +
        "<td>" + (record.enabled === false ? '<span class="chip">выключена</span>' : '<span class="chip ok">показывается</span>') + "</td>" +
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
