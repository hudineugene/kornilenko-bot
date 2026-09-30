// Каталог: объекты, акции и загрузка объектов с сайта.

const CATALOG_JS = String.raw`
var catalogStatus = "";
var LANGUAGES = [["ru", "Русский"], ["en", "English"], ["es", "Español"]];
var PROPERTY_TYPES = [["apartment", "Квартира"], ["house", "Дом"], ["villa", "Вилла"], ["townhouse", "Таунхаус"], ["land", "Участок"], ["commercial", "Коммерческая"], ["newbuild", "Новостройка"], ["other", "Другое"]];
var PROPERTY_STATUS = [["active", "Опубликован"], ["reserved", "Забронирован"], ["sold", "Продан"], ["hidden", "Черновик — клиенты не видят"]];
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
// Удаление с «Вернуть»: бот несколько минут хранит удалённую запись вместе с
// фотографиями, и кнопка в уведомлении возвращает её на прежнее место.
async function removeWithUndo(kind, id, doneText) {
  await api("/api/" + kind + "/" + encodeURIComponent(id), { method: "DELETE" });
  toast(doneText, false, {
    label: "Вернуть",
    run: async function () {
      try {
        await send("/api/" + kind + "/" + encodeURIComponent(id) + "/restore", "POST", {});
        toast("Возвращено");
        await reload();
      } catch (error) { fail(error); }
    },
  });
  await reload();
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
    return !catalogStatus || record.status === catalogStatus;
  });
  pageAction("＋ Объект", function () { openRecordEditor("objects", null); });
  pageAction("⇩ Загрузить с сайта", function () { go("settings", "feed"); }, "secondary");
  host.innerHTML = '<div class="toolbar">' +
      '<select id="catalogStatus" class="field-sm"><option value="">Все статусы</option>' + PROPERTY_STATUS.map(function (item) {
        return '<option value="' + item[0] + '"' + (catalogStatus === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
      }).join("") + "</select>" +
      '<span class="small muted">' + counted(rows.length, "объект", "объекта", "объектов") + "</span></div>" +
    '<div class="card"><div class="table-wrap"><table class="table-cards objects-table"><thead><tr><th class="thumb-xs"></th><th>Объект</th><th>Тип</th><th>Город</th><th class="right">Цена</th><th>Статус</th><th class="right">Эффективность</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (record, index) {
      var images = propertyImages(record, "ru");
      var stats = catalogPropertyStats(record);
      return '<tr class="clickable" data-id="' + esc(record.id) + '">' +
        "<td>" + (images.length ? '<img class="thumb" loading="lazy" decoding="async" src="' + imageUrl("objects", record.id, images[0], "ru") + '" alt="">' : '<span class="thumb"></span>') + "</td>" +
        '<td class="clickable" data-edit="1"><b>' + esc(localized(record.title, "ru") || "Без названия") + "</b>" +
          (record.reference ? ' <span class="small muted">' + esc(record.reference) + "</span>" : "") +
          (missingLanguages(record).length ? '<br><span class="chip warn" title="' + esc(publicationSummary(record)) + '">не готово: ' + esc(missingLanguages(record).join(", ")) + "</span>" : "") + "</td>" +
        "<td>" + esc((PROPERTY_TYPES.find(function (type) { return type[0] === record.propertyType; }) || ["", "—"])[1]) + '<br><span class="small muted">' + (record.dealType === "rent" ? "аренда" : "продажа") + "</span></td>" +
        "<td>" + esc(localized(record.city, "ru") || "—") + "</td>" +
        '<td class="right nowrap">' + (record.priceValue ? esc(money(record.priceValue, record.currency)) : esc(localized(record.price, "ru") || "по запросу")) + "</td>" +
        '<td><span class="chip ' + statusKind(record.status) + '">' + esc(statusName(record.status)) + "</span></td>" +
        // Цифры с подписями: сколько показов и сколько заявок. Иначе два числа подряд
        // читаются как что угодно.
        '<td class="right"><button class="object-performance" data-insights="1" type="button" title="Открыть аналитику объекта">' +
          '<span>' + iconSpan("eye") + ' в каталоге: ' + num(stats.impressions) + "</span>" +
          '<span>' + iconSpan("inbox") + ' ' + counted(stats.inquiries, "заявка", "заявки", "заявок") + "</span></button></td>" +
        '<td class="right nowrap"><button class="btn ghost small" data-more="1" title="Ещё действия">⋯</button></td></tr>';
    }).join("") : '<tr><td colspan="8"><div class="empty"><b>Объектов нет</b>Добавьте первый или загрузите выгрузку с сайта</div></td></tr>') +
    "</tbody></table></div></div>";

  host.querySelector("#catalogStatus").onchange = function (event) { catalogStatus = event.target.value; renderView(); };
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    var id = row.dataset.id;
    row.querySelector("[data-edit]").onclick = function () { openRecordEditor("objects", id); };
    // Клик по любому месту строки, кроме кнопок, открывает редактор: «Эффективность» — только по своей кнопке.
    row.onclick = function (event) {
      var target = event && event.target;
      if (target && target.closest && target.closest("button, a, label, input, select")) return;
      openRecordEditor("objects", id);
    };
    row.querySelector("[data-insights]").onclick = function (event) { if (event && event.stopPropagation) event.stopPropagation(); openObjectInsights(id); };
    row.querySelector("[data-more]").onclick = function () { openObjectExtras(id); };
    row.querySelectorAll("[data-move]").forEach(function (button) {
      button.onclick = async function () {
        try { await send("/api/objects/" + encodeURIComponent(id) + "/move", "POST", { step: button.dataset.move === "up" ? -1 : 1 }); await reload(); } catch (error) { fail(error); }
      };
    });
    row.querySelectorAll("[data-copy]").forEach(function (button) { button.onclick = async function () {
      try { await send("/api/objects/" + encodeURIComponent(id) + "/duplicate", "POST", {}); toast("Копия создана"); await reload(); } catch (error) { fail(error); }
    }; });
    row.querySelectorAll("[data-delete]").forEach(function (button) { button.onclick = async function () {
      if (!(await confirmDialog("Удалить объект?", "Карточка исчезнет из каталога бота.", "Удалить", true))) return;
      try { await removeWithUndo("objects", id, "Объект удалён"); } catch (error) { fail(error); }
    }; });
  });
}

// «⋯» у объекта: порядок в списке, копия и удаление. Раньше это были четыре
// значка подряд — ↑ ↓ ⧉ ✕, — и «✕» (удалить) стоял вплотную к стрелке «ниже»,
// которую нажимают часто.
function openObjectExtras(id) {
  var record = (state.objects || []).find(function (item) { return String(item.id) === String(id); });
  var title = record ? localized(record.title, "ru") || "Без названия" : "Объект";
  openDialog({
    title: "Ещё действия",
    body: '<div class="stack"><div class="small muted">' + esc(title) + "</div>" +
      '<button class="btn secondary" data-edit-object="1" type="button">✎ Редактировать</button>' +
      '<button class="btn" data-channel="1" type="button">➤ Опубликовать в канал</button>' +
      '<span class="small muted">Пост с фотографией, ценой и кнопкой «Смотреть в боте».</span>' +
      '<div class="row"><button class="btn secondary" data-move="up" type="button">↑ Поднять в списке</button>' +
      '<button class="btn secondary" data-move="down" type="button">↓ Опустить в списке</button></div>' +
      '<button class="btn secondary" data-copy="1" type="button">⧉ Создать копию</button>' +
      '<span class="small muted">Копия создаётся черновиком — клиенты её не видят, пока не опубликуете.</span>' +
      '<button class="btn danger-outline" data-delete="1" type="button">Удалить объект</button>' +
      '<span class="small muted">Карточка исчезнет из каталога бота. Если передумаете, 15 минут можно нажать «Вернуть».</span></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button>',
    ready: function (dialog) {
      dialog.querySelector("[data-edit-object]").onclick = function () { dialog.closeClean(); openRecordEditor("objects", id); };
      dialog.querySelector("[data-channel]").onclick = function () {
        dialog.closeClean();
        openChannelPost(id);
      };
      dialog.querySelectorAll("[data-move]").forEach(function (button) {
        button.onclick = async function () {
          try {
            await send("/api/objects/" + encodeURIComponent(id) + "/move", "POST", { step: button.dataset.move === "up" ? -1 : 1 });
            await reload();
          } catch (error) { fail(error); }
        };
      });
      dialog.querySelector("[data-copy]").onclick = async function () {
        try {
          await send("/api/objects/" + encodeURIComponent(id) + "/duplicate", "POST", {});
          dialog.closeClean();
          toast("Копия создана");
          await reload();
        } catch (error) { fail(error); }
      };
      dialog.querySelector("[data-delete]").onclick = async function () {
        if (!(await confirmDialog("Удалить объект?", "Карточка исчезнет из каталога бота.", "Удалить", true))) return;
        try {
          dialog.closeClean();
          await removeWithUndo("objects", id, "Объект удалён");
        } catch (error) { fail(error); }
      };
    },
  });
}

// Пост об объекте в канал: текст берём из карточки, чтобы в канале и в боте
// клиент видел одно и то же, но даём поправить перед отправкой.
function openChannelPost(id) {
  var record = (state.objects || []).find(function (item) { return String(item.id) === String(id); });
  if (!record) return;
  var channels = (state.groups || []).filter(function (group) { return group.type === "channel"; });
  if (!channels.length) {
    return openDialog({
      title: "Каналов пока нет",
      body: '<div class="stack"><div>Чтобы публиковать объекты, подключите канал в «Публикации → Каналы и группы» и сделайте бота его администратором.</div></div>',
      footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button><button class="btn" id="goChannels" type="button">Открыть «Каналы и группы»</button>',
      ready: function (dialog) {
        dialog.querySelector("#goChannels").onclick = function () { dialog.closeClean(); go("posts", "channels"); };
      },
    });
  }
  openDialog({
    title: "Опубликовать в канал",
    protectChanges: true,
    body: '<div class="stack">' +
      '<div class="field"><label for="channelTarget">Канал</label><select id="channelTarget">' + channels.map(function (group) {
        return '<option value="' + esc(group.id) + '">' + esc(group.title || group.id) + (group.memberCount ? " · " + counted(group.memberCount, "подписчик", "подписчика", "подписчиков") : "") + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label for="channelLanguage">Язык поста</label><select id="channelLanguage">' + LANGUAGES.map(function (language) {
        return '<option value="' + language[0] + '">' + language[1] + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label for="channelText">Текст поста</label><textarea id="channelText" class="area-sm" placeholder="Загрузка…"></textarea>' +
      '<div class="hint">По умолчанию — та же подпись, что видит клиент в карточке объекта.</div></div>' +
      '<div class="grid cols-2"><div class="field"><label for="channelButton">Кнопка</label><input id="channelButton" value="🏠 Смотреть в боте"></div>' +
      '<div class="field"><label for="channelWhen">Отправить позже</label><input id="channelWhen" type="datetime-local"></div></div>' +
      '<div class="msg">Кнопка ведёт на карточку этого объекта в боте. По ссылке видно, что клиент пришёл из канала.</div>' +
      "</div>",
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="channelSend" type="button">Опубликовать</button>',
    ready: function (dialog) {
      var text = dialog.querySelector("#channelText");
      var language = dialog.querySelector("#channelLanguage");
      // Текст показываем тот же, что стоит в карточке на выбранном языке.
      function fillText() {
        var caption = [localized(record.title, language.value), localized(record.city, language.value), localized(record.description, language.value)]
          .filter(Boolean).join("\n\n");
        text.value = caption;
      }
      fillText();
      language.onchange = fillText;
      dialog.querySelector("#channelSend").onclick = async function () {
        var when = dialog.querySelector("#channelWhen").value;
        var target = dialog.querySelector("#channelTarget");
        var where = target.options[target.selectedIndex].textContent;
        if (!(await confirmDialog(
          when ? "Запланировать публикацию?" : "Опубликовать в канал?",
          where + ". " + (when ? "Отправим " + dateTime(zonedDateTimeToIso(when)) + "." : "Пост уйдёт сразу.") + " Изменить опубликованное нельзя, только удалить.",
          when ? "Запланировать" : "Опубликовать"
        ))) return;
        try {
          await send("/api/objects/" + encodeURIComponent(id) + "/channel-post", "POST", {
            groupId: target.value,
            language: language.value,
            text: text.value,
            buttonText: dialog.querySelector("#channelButton").value,
            sendAt: when ? zonedDateTimeToIso(when) : "",
          });
          dialog.closeClean();
          toast(when ? "Публикация запланирована" : "Опубликовано в канале");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

function insightSignalLabel(signal) {
  return { favorite: "❤️ в избранном", comparison: "⚖️ сравнивает", viewed: "просматривал", match: "подходит по запросу", inquiry: "есть заявка" }[signal] || signal;
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
          (image ? '<img loading="lazy" decoding="async" src="' + imageUrl("objects", record.id, image) + '" alt="">' : '<span class="object-insights-placeholder">' + iconSpan("home") + '</span>') +
          '<div><h2>' + esc(title) + '</h2><div class="small muted">' + esc([record.reference, location].filter(Boolean).join(" · ") || "Без номера и расположения") + '</div><div class="row wrap gap-top"><span class="chip ' + statusKind(record.status) + '">' + esc(statusName(record.status)) + '</span><span class="small muted">данные обновлены ' + (stats.updatedAt ? ago(stats.updatedAt) : "ещё не собирались") + '</span></div></div></section>' +
        '<div class="grid cols-4 object-insight-kpis">' + kpiCard("Видели в каталоге", num(impressions), "раз показана в каталоге") + kpiCard("Открыли карточку", num(details), percent(details, impressions) + " от увидевших") + kpiCard("Заявки", num(inquiries), percent(inquiries, impressions) + " от увидевших") + kpiCard("Записались на просмотр", num(viewings), percent(viewings, inquiries) + " от заявок") + '</div>' +
        '<section class="card"><header><div><h3>Путь клиента</h3><span class="small muted">События считаются с момента последнего обнуления статистики</span></div></header><div class="card-body"><div class="object-path"><div><b>' + num(impressions) + '</b><span>видели в каталоге</span></div><i>→</i><div><b>' + num(details) + '</b><span>открыли карточку</span></div><i>→</i><div><b>' + num(inquiries) + '</b><span>оставили заявку</span></div><i>→</i><div><b>' + num(viewings) + '</b><span>записались на просмотр</span></div></div><div class="row wrap object-signal-summary"><span class="chip">❤️ В избранном у клиентов: ' + num(summary.favorites) + '</span><span class="chip">⚖️ Сравнивают клиентов: ' + num(summary.comparisons) + '</span><span class="chip">Недавно смотрели клиентов: ' + num(summary.viewed) + '</span><span class="chip">Подходит по запросу клиентов: ' + num(summary.matches) + '</span><span class="chip">Фото листали раз: ' + num(stats.galleries) + '</span><span class="chip">Просили менеджера раз: ' + num(stats.managerContacts) + '</span></div></div></section>' +
        '<section class="card"><header><div><h3>Заинтересованные клиенты</h3><span class="small muted">Сначала показаны клиенты с заявками и сильными сигналами</span></div><span class="chip brand">' + num(summary.clients) + '</span></header>' +
          (clients.length ? '<div class="object-client-list">' + clients.map(function (client) {
            var displayName = client.contactName || [client.firstName, client.lastName].filter(Boolean).join(" ") || (client.username ? "@" + client.username : "Клиент " + client.id);
            return '<div class="object-client"><button class="object-client-main" data-insight-client="' + esc(client.id) + '" type="button"><span class="conversation-avatar">' + esc(initials(displayName)) + '</span><span class="object-client-copy"><b>' + esc(displayName) + '</b><small>' + esc([client.phone, client.username ? "@" + client.username : "", (client.preferredLanguage || "").toUpperCase()].filter(Boolean).join(" · ") || "контакты не указаны") + '</small><span class="row wrap">' + client.signals.map(function (signal) { return '<span class="chip ' + (signal === "inquiry" ? "brand" : "") + '">' + esc(insightSignalLabel(signal)) + '</span>'; }).join("") + '</span></span></button>' +
              (client.latestInquiryId ? '<button class="btn secondary small" data-insight-conversation="' + esc(client.latestInquiryId) + '" type="button">Переписка' + (client.inquiryCount > 1 ? " · " + num(client.inquiryCount) : "") + '</button>' : '<span class="small muted">' + ago(client.lastSeenAt) + '</span>') + '</div>';
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
            selectConversation(button.dataset.insightConversation);
            await go("clients", "inbox");
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
  // Русский набор — общий: его видят клиенты на всех языках, пока для языка
  // не загрузили свой. Поэтому у остальных языков блок свёрнут и подписан
  // как необязательный.
  var common = language === "ru";
  var body = '<div class="image-list" data-images="' + language + '">' + images.map(function (image) {
      return '<span class="media-thumb"><img loading="lazy" decoding="async" src="' + imageUrl(kind, record.id, image, language) + '" alt="">' +
        '<button class="media-remove" data-remove="' + esc(image.id) + '" type="button" title="Убрать фото">✕</button></span>';
    }).join("") + "</div>" +
    '<div class="image-upload-row"><label class="btn secondary small">＋ Добавить фото<input type="file" accept="image/jpeg,image/png" multiple data-upload="' + language + '" class="file-hidden"></label>' +
    '<span class="small muted" data-image-count="' + language + '">' + images.length + ' из 10</span></div>';
  if (common) {
    return '<div data-langpane="ru">' + body +
      '<div class="hint">Первое фото станет обложкой. Эти фотографии видят клиенты на всех языках.</div></div>';
  }
  return '<details class="editor-section" data-langpane="' + language + '"' + (images.length ? " open" : "") + '>' +
    '<summary><b>Свои фотографии для языка ' + language.toUpperCase() + '</b><span>необязательно: без них показываются общие</span></summary>' +
    '<div class="editor-section-body stack">' + body + "</div></details>";
}

function openRecordEditor(kind, id) {
  var record = id ? (state[kind] || []).find(function (item) { return item.id === id; }) : null;
  var isObject = kind === "objects";
  var title = record ? localized(record.title, "ru") || "Без названия" : isObject ? "Новый объект" : "Новая акция";
  var body = '<div class="editor-layout"><div class="editor-form stack">' +
    '<div class="editor-language"><div class="row wrap">' + languageTabs() + '<span class="hint">Редактируется выбранный язык</span></div></div>' +
    (isObject ? '<div class="publication-check" id="publicationCheck"></div>' : "") +
    '<details class="editor-section" open><summary><b>Карточка для клиента</b><span>название, описание и фотографии</span></summary><div class="editor-section-body stack">' +
      // Номер объекта обязателен для публикации, поэтому стоит первым: раньше
      // он прятался в свёрнутом разделе внизу и о нём вспоминали последним.
      (isObject ? '<div class="field"><label for="fReference">Номер объекта <span class="required">*</span></label><input id="fReference" value="' + esc(record && record.reference || "") + '" placeholder="REF-1024"><div class="hint">Свой код объекта. Клиент видит его в подробной карточке.</div></div>' : "") +
      translatedField("title", "Название", record && record.title, false, "", true) +
      (isObject ? translatedField("description", "Описание", record && record.description, true, "", true) : translatedField("text", "Текст акции", record && record.text, true)) +
      '<div class="field photo-field"><span class="field-label">Фотографии' + (isObject ? ' <span class="required">*</span>' : "") + '</span>' + LANGUAGES.map(function (language) { return imageBlock(kind, record, language[0]); }).join("") + "</div>" +
    "</div></details>" +
    (isObject
      ? '<details class="editor-section" open><summary><b>Цена и расположение</b><span>главные данные карточки</span></summary><div class="editor-section-body stack"><div class="grid cols-3">' +
          '<div class="field"><label>Тип</label><select id="fType">' + PROPERTY_TYPES.map(function (type) {
            return '<option value="' + type[0] + '"' + (record && record.propertyType === type[0] ? " selected" : "") + ">" + type[1] + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Сделка</label><select id="fDeal"><option value="sale"' + (record && record.dealType === "rent" ? "" : " selected") + '>Продажа</option><option value="rent"' + (record && record.dealType === "rent" ? " selected" : "") + ">Аренда</option></select></div>" +
          '<input type="hidden" id="fStatus" value="' + esc(record ? record.status : "hidden") + '">' +
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
          '<div class="field" data-field="plotArea"><label>Участок, м² <span class="required" data-required="plotArea">*</span></label><input id="fPlot" type="number" min="0" value="' + esc(record && record.plotArea || "") + '"></div>' +
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
          translatedField("address", "Адрес", record && record.address) +
          '<div class="grid cols-2"><div class="field"><label>Ссылка на объект</label><input id="fUrl" value="' + esc(record && record.url || "") + '"></div>' +
          '<div class="field"><label>Ссылка на карту</label><input id="fMap" value="' + esc(record && record.mapUrl || "") + '"></div></div>' +
          '<div class="field"><label for="fVideo">Видео или 3D-тур</label><input id="fVideo" value="' + esc(record && record.videoUrl || "") + '" placeholder="https://youtu.be/… или Matterport"><div class="hint">Клиент увидит на карточке кнопку «🎥 Видео-тур». Для покупателей из другой страны это замена поездке.</div></div>' +
          '<div class="hint">Полный адрес показывается клиенту только после нажатия «Подробнее».</div>' +
        "</div></details>"
      : '<details class="editor-section" open><summary><b>Показ акции</b><span>срок действия и ссылка</span></summary><div class="editor-section-body stack">' +
          '<div class="grid cols-2"><div class="field"><label>Начало</label><input id="fStart" type="date" value="' + esc((record && record.startAt || "").slice(0, 10)) + '"></div>' +
          '<div class="field"><label>Окончание</label><input id="fEnd" type="date" value="' + esc((record && record.endAt || "").slice(0, 10)) + '"></div></div>' +
          '<label class="check"><input type="checkbox" id="fEnabled"' + (!record || record.enabled !== false ? " checked" : "") + "> Акция включена</label>" +
          '<div class="hint">Включённая акция показывается только между датами начала и окончания включительно.</div>' +
          '<div class="field"><label>Ссылка</label><input id="fUrl" value="' + esc(record && record.url || "") + '"></div>' +
        "</div></details>") +
    '</div><aside class="editor-preview-panel"><div class="editor-preview-head"><b>Как увидит клиент</b><span id="recordPreviewLanguage">Русский</span></div><div class="tg-preview" id="recordPreview"></div><div class="tg-note gap-top">Предпросмотр обновляется сразу. Telegram может незначительно изменить переносы строк.</div></aside></div>';

  openDialog({
    title: title,
    drawer: true,
    wide: true,
    protectChanges: true,
    body: body,
    // У объекта главные действия — внизу формы и зависят от состояния: черновик
    // публикуют, опубликованный сохраняют или снимают с публикации. Раньше
    // «Опубликовать» стояло в самом верху, а внизу была одна «Сохранить».
    footer: isObject
      ? '<button class="btn secondary editor-cancel" data-close="1" type="button">Отмена</button><span class="grow"></span><span class="row wrap editor-foot" id="editorFoot"></span>'
      : '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveRecord" type="button">Сохранить</button>',
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
        var ownPhotos = dialog.querySelector('[data-images="' + language + '"] .media-thumb');
        var commonPhotos = dialog.querySelector('[data-images="ru"] .media-thumb');
        if (!ownPhotos && !commonPhotos) issues.push("фотография");
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
      // Тексты, которые различаются по языкам: название, описание, город и остальное с data-tr.
      // Пустые английские и испанские поля можно заполнить русским текстом, чтобы объект вышел
      // в каталог сегодня, а не после перевода трёх полей на каждом языке.
      function copyFromRussian() {
        var copied = 0;
        dialog.querySelectorAll('[data-tr][data-lang="ru"]').forEach(function (source) {
          var text = String(source.value || "").trim();
          if (!text) return;
          ["en", "es"].forEach(function (code) {
            var target = dialog.querySelector('[data-tr="' + source.dataset.tr + '"][data-lang="' + code + '"]');
            if (target && !String(target.value || "").trim()) { target.value = text; copied += 1; }
          });
        });
        return copied;
      }
      function russianTextsReady() {
        return ["title", "description", "city"].every(function (name) { return Boolean(translatedValue(name, "ru")); });
      }
      function renderPublicationCheck() {
        if (!isObject) return;
        var rows = LANGUAGES.map(function (language) {
          return { code: language[0], name: language[1], issues: editorPublicationIssues(language[0]) };
        });
        var ready = rows.every(function (row) { return !row.issues.length; });
        // Опубликовать можно, когда готова русская карточка: английскую и испанскую владелец
        // копирует с русской (клиент увидит пометку «на русском») и переводит, когда дойдут руки.
        var russianReady = !rows[0].issues.length;
        var textIssues = ["название", "описание", "город"];
        var copyable = russianReady && rows.some(function (row) { return row.code !== "ru" && row.issues.some(function (issue) { return textIssues.indexOf(issue) >= 0; }); });
        var status = value("fStatus");
        var liveAndIncomplete = ["active", "reserved"].indexOf(status) >= 0 && !ready;
        // Значок говорит про то, что видит клиент, а не про заполненность полей:
        // Прежняя подпись про готовность у скрытого объекта читалась как
        // «объект уже опубликован».
        var live = ["active", "reserved"].indexOf(status) >= 0;
        var state = !ready ? { text: "нужно заполнить", chip: "warn" }
          : live ? { text: status === "reserved" ? "виден клиентам · забронирован" : "виден клиентам", chip: "ok" }
            : status === "sold" ? { text: "продан — снят с показа", chip: "" }
              : { text: "черновик — клиенты не видят", chip: "warn" };
        // Один список на три языка повторялся трижды и занимал первый экран телефона.
        // Теперь — одна строка «Не хватает: N полей (что именно)», а разбор по языкам
        // раскрывается по нажатию.
        var missing = [];
        rows.forEach(function (row) { row.issues.forEach(function (issue) { if (missing.indexOf(issue) < 0) missing.push(issue); }); });
        var missingWords = counted(missing.length, "поле", "поля", "полей");
        var missingLine = missing.length ? "Не хватает: " + missingWords + " (" + missing.slice(0, 3).join(", ") + (missing.length > 3 ? "…" : "") + ")" : "";
        dialog.querySelector("#publicationCheck").innerHTML =
          '<div class="publication-head"><div><b>Готовность карточки</b><span>Единый стандарт для всех языков</span></div><span class="chip ' + state.chip + '">' + state.text + "</span></div>" +
          (missing.length
            ? '<details class="publication-details"><summary class="warn-text">' + esc(missingLine) + '</summary><div class="publication-rows">' + rows.map(function (row) {
                return '<div class="publication-row"><b>' + row.code.toUpperCase() + '</b><span class="grow">' + esc(row.name) + '</span><span class="' + (row.issues.length ? "warn-text" : "ok-text") + '">' + (row.issues.length ? esc(row.issues.join(", ")) : "готово") + "</span></div>";
              }).join("") + "</div></details>"
            : '<div class="publication-ready ok-text">Все поля заполнены на трёх языках</div>') +
          (copyable ? '<div class="publication-actions"><button class="btn secondary small" id="copyFromRu" type="button">Скопировать тексты из русского</button><span class="small muted">Пустые английские и испанские поля заполнятся русским текстом; клиент увидит пометку «на русском».</span></div>' : "") +
          // Состояние объекта на рынке: бронь и продажа — отдельные пометки, а не
          // поле «Статус», которое дублировало кнопку «Опубликовать».
          (live || status === "sold" ? '<div class="publication-actions">' +
            (status === "active" ? '<button class="btn ghost small" data-set-status="reserved" type="button">Отметить забронированным</button>' : "") +
            (status === "reserved" ? '<button class="btn ghost small" data-set-status="active" type="button">Снять бронь</button>' : "") +
            (live ? '<button class="btn ghost small" data-set-status="sold" type="button">Отметить проданным</button>' : "") +
            (status === "sold" ? '<button class="btn ghost small" data-set-status="active" type="button"' + (russianReady ? "" : " disabled") + '>Вернуть в продажу</button>' : "") +
          "</div>" : "") +
          (liveAndIncomplete ? '<div class="publication-warning">Сохранить карточку можно и так, но клиенты видят её только на тех языках, где заполнено всё. Пока не хватает данных, объект в каталоге не показывается.</div>' : "");
        // Кнопка стоит в блоке готовности (не в подвале), поэтому привязывается здесь.
        var copyButton = dialog.querySelector("#copyFromRu");
        if (copyButton) copyButton.onclick = function () {
          var count = copyFromRussian();
          toast(count ? "Скопировано полей: " + count + ". Переведите их, когда будет время" : "Копировать нечего");
          renderPublicationCheck();
          renderRecordPreview();
        };
        dialog.querySelectorAll("[data-set-status]").forEach(function (button) {
          button.onclick = function () {
            dialog.querySelector("#fStatus").value = button.dataset.setStatus;
            renderPublicationCheck();
            renderRecordPreview();
          };
        });
        // Подвал: главное действие — справа, второстепенные — слева от него.
        var foot = dialog.querySelector("#editorFoot");
        if (foot) {
          foot.innerHTML = live
            ? '<button class="btn secondary" id="unpublish" type="button" title="Объект пропадёт из каталога, переписка и заявки останутся">Снять с публикации</button>' +
              '<button class="btn secondary" id="postToChannel" type="button"' + (record ? "" : " disabled") + ' title="' + (record ? "Пост с фотографией, ценой и кнопкой «Смотреть в боте»" : "Сначала сохраните объект") + '">➤ В канал</button>' +
              '<button class="btn" id="saveRecord" type="button">Сохранить</button>'
            : '<button class="btn secondary" id="saveDraft" type="button">' + (status === "sold" ? "Сохранить" : "Сохранить как черновик") + '</button>' +
              (status === "sold" || russianReady ? "" : '<span class="small warn-text publish-why" id="publishWhy">Опубликовать нельзя. ' + esc(missingLine) + "</span>") +
              (status === "sold" ? "" : '<button class="btn" id="publishNow" type="button"' + (russianReady ? "" : " disabled") + ' title="' + (ready ? "Объект сразу появится в каталоге у клиентов" : russianReady ? "Появится в каталоге; английский и испанский тексты будут русскими" : "Сначала заполните русскую карточку") + '">Опубликовать</button>');
          var bind = function (id, handler) { var button = foot.querySelector(id); if (button) button.onclick = handler; };
          bind("#saveRecord", saveRecord);
          bind("#saveDraft", saveRecord);
          bind("#publishNow", async function () {
            // Не хватает только английского и испанского — публикуем с русским текстом, но спрашиваем.
            if (!ready && russianReady && !(await confirmDialog("Опубликовать с русским текстом?", "Английский и испанский тексты, которых ещё нет, будут скопированы с русского. Клиенты на этих языках увидят русский текст с пометкой «Text in Russian». Перевести можно позже.", "Опубликовать"))) return;
            if (!ready) copyFromRussian();
            dialog.querySelector("#fStatus").value = "active";
            saveRecord();
          });
          bind("#unpublish", function () { dialog.querySelector("#fStatus").value = "hidden"; saveRecord(); });
          bind("#postToChannel", function () { if (record) openChannelPost(record.id); });
        }
        var type = value("fType");
        var residential = ["apartment", "house", "villa", "townhouse", "newbuild"].indexOf(type) >= 0;
        dialog.querySelectorAll("[data-required]").forEach(function (marker) {
          var required = marker.dataset.required === "plotArea" ? type === "land" : marker.dataset.required === "area" ? type !== "land" : residential;
          marker.classList.toggle("hidden", !required);
        });
        // У квартиры участка не бывает — поле не показываем вовсе.
        var plotField = dialog.querySelector('[data-field="plotArea"]');
        if (plotField) plotField.classList.toggle("hidden", ["apartment", "newbuild"].indexOf(type) >= 0);
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
      // Предпросмотр объекта: небольшая задержка, чтобы не слать запрос на каждую набранную букву, и номер запроса —
      // ответ на устаревший запрос не затирает свежий.
      var previewTimer = 0, previewSerial = 0;
      function scheduleObjectPreview(language, imageHtml) {
        clearTimeout(previewTimer);
        var serial = ++previewSerial;
        previewTimer = setTimeout(function () {
          var fields = recordFields();
          fields.language = language;
          send("/api/preview/object", "POST", fields).then(function (card) {
            if (serial !== previewSerial) return;
            var button = function (text) { return '<div class="tg-button">' + esc(text) + "</div>"; };
            dialog.querySelector("#recordPreview").innerHTML = '<div class="tg-bubble">' + imageHtml + '<div class="tg-text">' + card.caption + "</div></div>" +
              ((card.rows || []).length ? '<div class="tg-buttons">' + card.rows.map(function (row) {
                return row.length > 1 ? '<div class="row">' + row.map(button).join("") + "</div>" : button(row[0]);
              }).join("") + "</div>" : "");
          }).catch(function () {});
        }, 180);
      }
      function renderRecordPreview() {
        var language = dialog.dataset.activeLanguage || "ru";
        var words = previewWords[language] || previewWords.ru;
        var languageName = (LANGUAGES.find(function (item) { return item[0] === language; }) || ["", language])[1];
        dialog.querySelector("#recordPreviewLanguage").textContent = languageName;
        var preview = dialog.querySelector("#recordPreview");
        var titleText = translatedValue("title", language);
        var cover = dialog.querySelector('[data-images="' + language + '"] .media-thumb img')
          || dialog.querySelector('[data-images="ru"] .media-thumb img');
        var imageHtml = cover ? '<img src="' + esc(cover.src) + '" alt="">' : "";
        // Карточка объекта собирается на сервере тем же кодом, что и карточка в боте: подпись и кнопки берутся оттуда.
        if (isObject) {
          if (!imageHtml && !translatedValue("title", language) && !value("fPrice") && !translatedValue("description", language)) {
            preview.innerHTML = '<div class="editor-preview-empty">' + esc(words.empty) + "</div>";
            return;
          }
          scheduleObjectPreview(language, imageHtml);
          return;
        }
        var lines = [];
        var buttons = [];
        {
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
      // Поля карточки для сервера — и при сохранении, и для предпросмотра (без фотографий).
      function recordFields() {
        var fields = {
          title: collectTranslated(dialog, "title"),
          url: (dialog.querySelector("#fUrl") || {}).value || "",
        };
        if (isObject) {
          Object.assign(fields, {
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
            videoUrl: dialog.querySelector("#fVideo").value,
            city: collectTranslated(dialog, "city"),
            district: collectTranslated(dialog, "district"),
            address: collectTranslated(dialog, "address"),
            price: collectTranslated(dialog, "price"),
            description: collectTranslated(dialog, "description"),
            badges: Array.from(dialog.querySelectorAll("[data-badge]")).filter(function (box) { return box.checked; }).map(function (box) { return box.dataset.badge; }),
          });
        } else {
          Object.assign(fields, {
            text: collectTranslated(dialog, "text"),
            startAt: dialog.querySelector("#fStart").value,
            endAt: dialog.querySelector("#fEnd").value,
            enabled: dialog.querySelector("#fEnabled").checked,
          });
        }
        return fields;
      }
      async function saveRecord() {
        // Незаполненную карточку сохраняем: клиент увидит её только на тех
        // языках, где всё заполнено. Раньше кнопка «Сохранить» здесь молча
        // ничего не делала, и поправить город в карточке было нельзя.
        var incomplete = isObject && ["active", "reserved"].indexOf(value("fStatus")) >= 0
          ? LANGUAGES.map(function (language) { return { language: language[0], issues: editorPublicationIssues(language[0]) }; }).filter(function (entry) { return entry.issues.length; })
          : [];
        var payload = Object.assign(recordFields(), {
          imageDataUrlsByLanguage: pendingImages,
          removeImageIdsByLanguage: removedImages,
        });
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
      }
      if (!isObject) dialog.querySelector("#saveRecord").onclick = saveRecord;
    },
  });
}

// Начало текста без обрыва на полуслове: если обрезали — многоточие.
function shortText(value, limit) {
  var text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit).replace(/\s+\S*$/, "") + "…" : text;
}

// --- Акции ------------------------------------------------------------------
function renderOffers(host) {
  var rows = state.promotions || [];
  pageAction("＋ Акция", function () { openRecordEditor("promotions", null); });
  host.innerHTML = '<div class="card"><div class="table-wrap"><table class="table-stack"><thead><tr><th class="thumb-xs"></th><th>Акция</th><th>Срок</th><th>Статус</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (record) {
      var images = propertyImages(record, "ru");
      var displayStatus = promotionStatus(record);
      return '<tr data-id="' + esc(record.id) + '">' +
        "<td>" + (images.length ? '<img class="thumb" loading="lazy" decoding="async" src="' + imageUrl("promotions", record.id, images[0], "ru") + '" alt="">' : '<span class="thumb"></span>') + "</td>" +
        '<td class="clickable" data-edit="1"><b>' + esc(localized(record.title, "ru") || "Без названия") + '</b><br><span class="small muted">' + esc(shortText(localized(record.text, "ru"), 70)) + "</span></td>" +
        "<td>" + (record.startAt || record.endAt ? esc(dateShort(record.startAt) + " – " + dateShort(record.endAt)) : "без срока") + "</td>" +
        '<td><span class="chip ' + displayStatus.kind + '">' + displayStatus.label + "</span></td>" +
        '<td class="right nowrap"><button class="btn ghost small" data-more="1" title="Ещё действия" type="button">⋯</button></td></tr>';
    }).join("") : '<tr><td colspan="5"><div class="empty"><b>Акций нет</b>Клиенты видят раздел «Акции» только когда есть действующие</div></td></tr>') +
    "</tbody></table></div></div>";
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    var id = row.dataset.id;
    row.querySelector("[data-edit]").onclick = function () { openRecordEditor("promotions", id); };
    row.querySelector("[data-more]").onclick = function () { openOfferExtras(id); };
  });
}

// То же «⋯», что у объектов: редкие и опасные действия — не в строке рядом с частыми.
function openOfferExtras(id) {
  var record = (state.promotions || []).find(function (item) { return String(item.id) === String(id); });
  var title = record ? localized(record.title, "ru") || "Без названия" : "Акция";
  openDialog({
    title: "Ещё действия",
    body: '<div class="stack"><div class="small muted">' + esc(title) + "</div>" +
      '<button class="btn danger-outline" data-delete="1" type="button">Удалить акцию</button>' +
      '<span class="small muted">Она исчезнет из раздела «Акции». Если передумаете, 15 минут можно нажать «Вернуть».</span></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Закрыть</button>',
    ready: function (dialog) {
      dialog.querySelector("[data-delete]").onclick = async function () {
        if (!(await confirmDialog("Удалить акцию?", "Она исчезнет из раздела «Акции».", "Удалить", true))) return;
        try {
          dialog.closeClean();
          await removeWithUndo("promotions", id, "Акция удалена");
        } catch (error) { fail(error); }
      };
    },
  });
}

// --- Загрузка с сайта ----------------------------------------------------------
function renderFeed(host) {
  var settings = state.config.feedImport || {};
  var last = settings.lastResult || null;
  host.innerHTML = '<div class="grid cols-2"><div class="card"><header><h3>Выгрузка с сайта</h3></header><div class="card-body stack"><div class="stack" id="feedForm">' +
      '<div class="field"><label for="feedUrl">Ссылка на выгрузку объектов с вашего сайта</label><input id="feedUrl" value="' + esc(settings.url || "") + '" placeholder="https://сайт/feed.xml"></div>' +
      '<label class="check"><input type="checkbox" id="feedPublish"' + (settings.publishNew ? " checked" : "") + "> новые объекты сразу показывать клиентам</label>" +
      '<label class="check"><input type="checkbox" id="feedDaily"' + (settings.daily ? " checked" : "") + "> обновлять каждый день</label>" +
      '</div><div class="row wrap"><button class="btn secondary" id="feedCheck" type="button">Проверить</button><button class="btn" id="feedImport" type="button">Загрузить</button></div>' +
      '<div id="feedResult" class="small muted"></div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Последняя загрузка</h3></header><div class="card-body stack">' +
      (settings.lastRunAt ? '<div class="small muted">' + dateTime(settings.lastRunAt) + "</div>" : '<div class="muted">Загрузок ещё не было</div>') +
      (last ? '<div class="grid cols-3">' + kpiCard("Добавлено", num(last.added)) + kpiCard("Обновлено", num(last.updated)) + kpiCard("Фото", num(last.photos)) + "</div>" : "") +
      (settings.lastError ? '<div class="banner bad">' + esc(settings.lastError) + "</div>" : "") +
      '<div class="hint">Объекты сопоставляются по номеру объекта из выгрузки. Тексты, которые вы правили в панели, не перезаписываются.</div>' +
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
    host.querySelector("#feedResult").textContent = "Загрузка… это может занять несколько минут";
    try {
      var result = await send("/api/feed/import", "POST", payload());
      toast("Добавлено " + result.added + ", обновлено " + result.updated);
      await reload();
    } catch (error) { host.querySelector("#feedResult").textContent = ""; fail(error); }
  };
  // Ссылка и два флажка — форма: полоса «Сохранить» внизу. «Проверить» и «Загрузить» — действия.
  watchForm(host.querySelector("#feedForm"), async function () {
    await send("/api/feed/settings", "PUT", payload());
  }, "Настройки загрузки с сайта изменены");
}

VIEWS.objects = {
  render: function (host, tab) {
    if (tab === "offers") return renderOffers(host);
    renderObjects(host);
  },
};
`;

export { CATALOG_JS };
