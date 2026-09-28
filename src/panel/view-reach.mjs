// Рассылки клиентам и Telegram-группа, где бот администратор.

const REACH_JS = String.raw`
var selectedGroup = "";

function campaignPropertySignalLabel(signal) {
  return { any: "любой интерес", favorite: "в избранном", comparison: "сравнивает", viewed: "просматривал", match: "подходит по запросу", inquiry: "обращался" }[signal || "any"] || "любой интерес";
}
// Пауза из-за обрыва связи — не ошибка: рассылка продолжится сама.
function campaignStatusChip(entry) {
  if (entry.status === "failed") return '<span class="chip bad">ошибка</span>';
  if (entry.status === "queued" && entry.pausedAt) {
    return '<span class="chip warn" title="' + esc(entry.error || "") + '">пауза, продолжится сама</span>';
  }
  if (entry.status === "queued" || entry.status === "running") return '<span class="chip warn">идёт</span>';
  return '<span class="chip ok">отправлена</span>';
}

function campaignAudienceLabel(entry) {
  var parts = [];
  if ((entry.languages || []).length) parts.push((entry.languages || []).join(", ").toUpperCase());
  if ((entry.pipelineStages || []).length) parts.push((entry.pipelineStages || []).map(function (key) { var stage = PIPELINE_STAGES.find(function (item) { return item[0] === key; }); return stage ? stage[1] : key; }).join(", "));
  if ((entry.sources || []).length) parts.push("источник: " + entry.sources.join(", "));
  if (entry.propertyId) {
    var record = (state.objects || []).find(function (item) { return String(item.id) === String(entry.propertyId); });
    parts.push((record ? localized(record.title, "ru") || record.reference : "объект удалён") + " · " + campaignPropertySignalLabel(entry.propertySignal));
  }
  if ((entry.tags || []).length) parts.push("теги: " + entry.tags.join(", "));
  return parts.join(" · ") || "все доступные клиенты";
}

// --- Рассылки --------------------------------------------------------------------
function renderCampaigns(host) {
  var drafts = (state.broadcasts || []).filter(function (entry) { return entry.status === "draft" || entry.status === "scheduled"; });
  var history = (state.broadcasts || []).filter(function (entry) { return entry.status !== "draft" && entry.status !== "scheduled"; });
  pageAction("＋ Рассылка", function () { openCampaignEditor(null); });
  host.innerHTML =
    (drafts.length ? '<div class="card" style="margin-bottom:12px"><header><h3>Черновики и запланированные</h3></header><div class="table-wrap"><table><thead><tr><th>Текст</th><th>Когда</th><th>Аудитория</th><th></th></tr></thead><tbody>' +
      drafts.map(function (entry) {
        return '<tr data-id="' + esc(entry.id) + '"><td class="clickable" data-edit="1">' + esc(String(localized(entry.messages, "ru")).slice(0, 70)) + "</td>" +
          "<td>" + (entry.status === "scheduled" ? dateTime(entry.scheduledAt) : "черновик") + "</td>" +
          "<td>" + esc(campaignAudienceLabel(entry)) + "</td>" +
          '<td class="right"><button class="btn ghost small" data-delete="1">✕</button></td></tr>';
      }).join("") + "</tbody></table></div></div>" : "") +
    '<div class="card"><header><h3>История рассылок</h3><div class="actions"><span class="small faint">получатели · отклики · отписки</span></div></header><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Текст</th><th>Аудитория</th><th class="right">Отправлено</th><th class="right">Отклики</th><th class="right">Отписки</th><th>Статус</th></tr></thead><tbody>' +
    (history.length ? history.map(function (entry) {
      return "<tr><td class=\"nowrap\">" + dateShort(entry.startedAt) + "</td><td>" + esc(String(localized(entry.messages, "ru")).slice(0, 60)) + "</td><td class=\"small\">" + esc(campaignAudienceLabel(entry)) + "</td>" +
        '<td class="right">' + num(entry.sent) + '</td><td class="right">' + num(entry.responses) + '</td><td class="right">' + num(entry.unsubscribes) + "</td>" +
        "<td>" + campaignStatusChip(entry) + "</td></tr>";
    }).join("") : '<tr><td colspan="7"><div class="empty"><b>Рассылок ещё не было</b>Сообщение получат клиенты, которые не отписались</div></td></tr>') +
    "</tbody></table></div></div>";
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    var id = row.dataset.id;
    var edit = row.querySelector("[data-edit]");
    if (edit) edit.onclick = function () { openCampaignEditor(id); };
    var remove = row.querySelector("[data-delete]");
    if (remove) remove.onclick = async function () {
      if (!(await confirmDialog("Удалить рассылку?", "Черновик будет удалён.", "Удалить", true))) return;
      try { await api("/api/broadcasts/" + encodeURIComponent(id), { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
    };
  });
}

function openCampaignEditor(id) {
  var entry = id ? (state.broadcasts || []).find(function (item) { return item.id === id; }) : null;
  var tags = [];
  (state.users || []).forEach(function (user) { (user.tags || []).forEach(function (tag) { if (tags.indexOf(tag) < 0) tags.push(tag); }); });
  var sources = (state.sources || []).map(function (item) { return item.source; }).filter(Boolean);
  var selectedStage = entry && entry.pipelineStages && entry.pipelineStages[0] || "";
  var selectedSource = entry && entry.sources && entry.sources[0] || "";
  var selectedProperty = entry && entry.propertyId || "";
  var selectedSignal = entry && entry.propertySignal || "any";
  openDialog({
    title: entry ? "Рассылка" : "Новая рассылка",
    drawer: true,
    wide: true,
    protectChanges: true,
    body: '<div class="editor-layout"><div class="editor-form stack">' +
      '<div class="editor-language"><div class="row wrap">' + languageTabs() + '<span class="hint">Сообщение для выбранного языка</span></div></div>' +
      '<details class="editor-section" open><summary><b>Сообщение</b><span>текст, изображение и кнопка</span></summary><div class="editor-section-body stack">' +
        '<div class="field"><label>Текст сообщения</label>' + LANGUAGES.map(function (language) {
          return '<textarea data-tr="messages" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" style="min-height:150px" placeholder="Введите текст для ' + esc(language[1]) + '">' + esc((entry && entry.messages && entry.messages[language[0]]) || "") + "</textarea>";
        }).join("") + '<div class="hint">Подстановка <b>{first_name}</b> заменится именем клиента.</div></div>' +
        '<div class="grid cols-2"><div class="field"><label>Текст кнопки</label>' + LANGUAGES.map(function (language) {
          return '<input data-tr="buttonText" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" value="' + esc((entry && entry.buttonText && entry.buttonText[language[0]]) || "") + '" placeholder="Например: Посмотреть объект">';
        }).join("") + "</div>" +
        '<div class="field"><label for="campUrl">Ссылка кнопки</label><input id="campUrl" value="' + esc(entry && entry.buttonUrl || "") + '" placeholder="https://..."></div></div>' +
        '<div class="field"><span class="field-label">Изображение</span><div class="image-upload-row"><label class="btn secondary small">＋ Выбрать изображение<input id="campImage" class="file-hidden" type="file" accept="image/jpeg,image/png"></label><span class="small muted" id="campImageName">' + (entry && entry.image && entry.image.exists ? "Изображение загружено" : "Не выбрано") + "</span></div></div>" +
      "</div></details>" +
      '<details class="editor-section" open><summary><b>Получатели</b><span>языки и группы клиентов</span></summary><div class="editor-section-body stack">' +
        '<div class="field"><span class="field-label">Языки аудитории</span><div class="row wrap">' + LANGUAGES.map(function (language) {
          var checked = !entry || (entry.languages || []).indexOf(language[0]) >= 0;
          return '<label class="check"><input type="checkbox" data-audience="' + language[0] + '"' + (checked ? " checked" : "") + "> " + language[1] + "</label>";
        }).join("") + "</div></div>" +
        '<div class="grid cols-2"><div class="field"><label for="campStage">Этап воронки</label><select id="campStage"><option value="">Любой этап</option>' + PIPELINE_STAGES.map(function (stage) { return '<option value="' + stage[0] + '"' + (selectedStage === stage[0] ? " selected" : "") + '>' + esc(stage[1]) + "</option>"; }).join("") + '</select></div><div class="field"><label for="campSource">Источник клиента</label><select id="campSource"><option value="">Любой источник</option>' + sources.map(function (source) { return '<option value="' + esc(source) + '"' + (selectedSource === source ? " selected" : "") + '>' + esc(source) + "</option>"; }).join("") + "</select></div></div>" +
        '<div class="grid cols-2"><div class="field"><label for="campProperty">Интерес к объекту</label><select id="campProperty"><option value="">Не учитывать объект</option>' + (state.objects || []).map(function (record) { var title = localized(record.title, "ru") || record.reference || record.id; return '<option value="' + esc(record.id) + '"' + (selectedProperty === record.id ? " selected" : "") + '>' + esc(title) + "</option>"; }).join("") + '</select></div><div class="field"><label for="campPropertySignal">Как проявил интерес</label><select id="campPropertySignal"' + (selectedProperty ? "" : " disabled") + '>' + [["any", "Любое действие"], ["favorite", "Добавил в избранное"], ["comparison", "Сравнивает"], ["viewed", "Просматривал"], ["match", "Подходит по запросу"], ["inquiry", "Обращался по объекту"]].map(function (signal) { return '<option value="' + signal[0] + '"' + (selectedSignal === signal[0] ? " selected" : "") + '>' + signal[1] + "</option>"; }).join("") + "</select></div></div>" +
        (tags.length ? '<div class="field"><label for="campTags">Только клиенты с тегами</label><input id="campTags" value="' + esc((entry && entry.tags || []).join(", ")) + '" placeholder="' + esc(tags.join(", ")) + '"><div class="hint">Оставьте пустым, чтобы не ограничивать аудиторию тегами.</div></div>' : "") +
        '<div class="hint">Условия из разных полей применяются одновременно. Например: Spanish + «Подбор» + интерес к выбранной вилле.</div>' +
        '<div class="recipient-summary"><span>👥</span><div><b id="campEstimate">Считаем получателей…</b><small id="campEstimateDetails">Проверяем выбранный сегмент</small></div></div>' +
      "</div></details>" +
      '<details class="editor-section" open><summary><b>Время отправки</b><span>сейчас или по расписанию</span></summary><div class="editor-section-body">' +
        '<div class="field"><label for="campDate">Отправить позже</label><input id="campDate" type="datetime-local" value="' + esc(entry && entry.scheduledAt ? dateTimeLocalValue(entry.scheduledAt) : "") + '"><div class="hint">Оставьте поле пустым для отправки сейчас. Часовой пояс: ' + esc(timeZoneName()) + "</div></div>" +
      "</div></details></div>" +
      '<aside class="editor-preview-panel"><div class="editor-preview-head"><b>Предпросмотр Telegram</b><span id="campaignPreviewLanguage">Русский</span></div><div class="tg-preview" id="campaignPreview"></div><div class="tg-note" style="margin-top:8px">Имя в предпросмотре показано как пример. Перед отправкой бот подставит имя каждого клиента.</div></aside></div>',
    footer: '<button class="btn secondary" id="campTest" type="button">Себе для проверки</button><div class="grow"></div>' +
      '<button class="btn secondary" id="campDraft" type="button">В черновик</button><button class="btn" id="campSend" type="button">Отправить</button>',
    ready: function (dialog) {
      bindLanguageTabs(dialog);
      var image = null;
      var savedImageUrl = entry && entry.image && entry.image.exists ? "/api/media/broadcasts/" + encodeURIComponent(entry.id) : "";
      var exampleNames = { ru: "Анна", en: "Anna", es: "Ana" };
      function campaignLanguageValue(name, language) {
        var input = dialog.querySelector('[data-tr="' + name + '"][data-lang="' + language + '"]');
        return input ? String(input.value || "").trim() : "";
      }
      function renderCampaignPreview() {
        var language = dialog.dataset.activeLanguage || "ru";
        var languageName = (LANGUAGES.find(function (item) { return item[0] === language; }) || ["", language])[1];
        dialog.querySelector("#campaignPreviewLanguage").textContent = languageName;
        var message = campaignLanguageValue("messages", language).replace(/\{first_name\}/g, exampleNames[language] || "Anna");
        var buttonText = campaignLanguageValue("buttonText", language);
        var buttonUrl = String(dialog.querySelector("#campUrl").value || "").trim();
        var imageUrlValue = image ? image.dataUrl : savedImageUrl;
        var preview = dialog.querySelector("#campaignPreview");
        if (!message && !imageUrlValue) {
          preview.innerHTML = '<div class="editor-preview-empty">Введите сообщение или выберите изображение</div>';
          return;
        }
        preview.innerHTML = '<div class="tg-bubble">' + (imageUrlValue ? '<img src="' + esc(imageUrlValue) + '" alt="">' : "") +
          (message ? '<div class="tg-text">' + linkedPreview(message) + "</div>" : "") + "</div>" +
          (buttonText ? '<div class="tg-buttons"><div class="tg-button">' + esc(buttonText) + "</div></div>" : "") +
          (buttonText && !buttonUrl ? '<div class="tg-note" style="color:var(--warn)">Добавьте ссылку для кнопки</div>' : "");
      }
      dialog.querySelector("#campImage").onchange = function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          image = { dataUrl: reader.result, name: file.name };
          dialog.querySelector("#campImageName").textContent = file.name;
          renderCampaignPreview();
        };
        reader.readAsDataURL(file);
      };
      function payload(mode) {
        var body = {
          mode: mode,
          messages: collectTranslated(dialog, "messages"),
          buttonText: collectTranslated(dialog, "buttonText"),
          buttonUrl: dialog.querySelector("#campUrl").value,
          languages: Array.from(dialog.querySelectorAll("[data-audience]")).filter(function (box) { return box.checked; }).map(function (box) { return box.dataset.audience; }),
          tags: (dialog.querySelector("#campTags") ? dialog.querySelector("#campTags").value : "").split(",").map(function (tag) { return tag.trim(); }).filter(Boolean),
          pipelineStages: dialog.querySelector("#campStage").value ? [dialog.querySelector("#campStage").value] : [],
          sources: dialog.querySelector("#campSource").value ? [dialog.querySelector("#campSource").value] : [],
          propertyId: dialog.querySelector("#campProperty").value,
          propertySignal: dialog.querySelector("#campProperty").value ? dialog.querySelector("#campPropertySignal").value : "any",
        };
        var when = dialog.querySelector("#campDate").value;
        if (when && mode !== "draft") { body.mode = "schedule"; body.scheduledAt = zonedDateTimeToIso(when); }
        if (image) { body.imageDataUrl = image.dataUrl; body.imageName = image.name; }
        return body;
      }
      async function estimate() {
        try {
          var result = await send("/api/broadcast/estimate", "POST", payload("draft"));
          dialog.querySelector("#campEstimate").textContent = "Получателей: " + result.total;
          var languages = [result.byLanguage.ru ? "RU " + result.byLanguage.ru : "", result.byLanguage.en ? "EN " + result.byLanguage.en : "", result.byLanguage.es ? "ES " + result.byLanguage.es : ""].filter(Boolean).join(" · ");
          var sample = (result.sample || []).length ? "Пример: " + result.sample.join(", ") : "Нет подходящих клиентов";
          dialog.querySelector("#campEstimateDetails").textContent = [languages, sample].filter(Boolean).join(" · ");
          return result;
        } catch (error) {
          dialog.querySelector("#campEstimate").textContent = "Аудитория пока не определена";
          dialog.querySelector("#campEstimateDetails").textContent = error && error.message ? error.message : "Проверьте условия";
          return null;
        }
      }
      estimate();
      dialog.querySelectorAll("[data-audience]").forEach(function (box) { box.onchange = estimate; });
      ["#campStage", "#campSource", "#campPropertySignal"].forEach(function (selector) { dialog.querySelector(selector).onchange = estimate; });
      dialog.querySelector("#campProperty").onchange = function () {
        var enabled = Boolean(dialog.querySelector("#campProperty").value);
        dialog.querySelector("#campPropertySignal").disabled = !enabled;
        if (!enabled) dialog.querySelector("#campPropertySignal").value = "any";
        estimate();
      };
      var tagsInput = dialog.querySelector("#campTags");
      if (tagsInput) tagsInput.oninput = function () {
        clearTimeout(tagsInput._estimateTimer);
        tagsInput._estimateTimer = setTimeout(estimate, 300);
      };
      dialog.addEventListener("languagechange", renderCampaignPreview);
      dialog.addEventListener("input", renderCampaignPreview);
      dialog.addEventListener("change", renderCampaignPreview);
      renderCampaignPreview();
      dialog.querySelector("#campTest").onclick = async function () {
        try {
          await send("/api/broadcast/test", "POST", Object.assign(payload("draft"), { userId: String(state.config.adminChatId) }));
          toast("Отправлено вам в Telegram");
        } catch (error) { fail(error); }
      };
      dialog.querySelector("#campDraft").onclick = async function () {
        try {
          if (entry) await send("/api/broadcasts/" + encodeURIComponent(entry.id), "PATCH", payload("draft"));
          else await send("/api/broadcast", "POST", payload("draft"));
          dialog.closeClean(); toast("Черновик сохранён"); await reload();
        } catch (error) { fail(error); }
      };
      dialog.querySelector("#campSend").onclick = async function () {
        var when = dialog.querySelector("#campDate").value;
        var audience = await estimate();
        if (!audience || !audience.total) return toast("Для выбранных условий нет получателей", true);
        var currentPayload = payload(when ? "schedule" : "send");
        if (!when && !(await confirmDialog("Отправить рассылку?", "Получатели: " + counted(audience.total, "клиент", "клиента", "клиентов") + ". Сегмент: " + campaignAudienceLabel(currentPayload) + ". Отменить отправку нельзя.", "Отправить"))) return;
        try {
          var result = entry && entry.status !== "sent"
            ? await send("/api/broadcasts/" + encodeURIComponent(entry.id), "PATCH", currentPayload)
            : await send("/api/broadcast", "POST", currentPayload);
          dialog.closeClean();
          toast(when ? "Запланировано" : "Рассылка пошла, получателей: " + (result.total || 0));
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

// --- Группа ------------------------------------------------------------------------
function groupRights(group) {
  return group.rights || {};
}
function groupCan(group, right) {
  return group.status === "creator" || Boolean(groupRights(group)[right]);
}

// Группу, где бот уже состоит, Telegram сам не покажет: подключаем по ID.
function connectGroupCard(compact) {
  return '<div class="card"' + (compact ? ' style="margin-bottom:12px"' : "") + '><header><h3>Подключить группу или канал</h3></header><div class="card-body stack">' +
    '<div class="row wrap"><input id="newGroupId" placeholder="-1001234567890 или @channel" style="max-width:260px">' +
    '<button class="btn" id="connectGroup" type="button">Подключить</button></div>' +
    '<div class="hint">Бот уже должен состоять там администратором. ID начинается с -100; у канала подойдёт и @имя. Новую группу или канал, куда бота добавят позже, панель увидит сама.</div>' +
  "</div></div>";
}

// Плашка рубрики и постоянная подпись — общие для всех групп и каналов.
// Иногда вместо значка копируется его запись кодом: «U+1F1EA U+1F1F8».
// Такой текст Telegram покажет буквами, поэтому предлагаем его превратить.
var CODEPOINT_PATTERN = /U+([0-9A-Fa-f]{4,6})/g;

function hasCodepoints(text) {
  return CODEPOINT_PATTERN.test(String(text || ""));
}

function decodeCodepoints(text) {
  return String(text || "").replace(CODEPOINT_PATTERN, function (match, code) {
    try { return String.fromCodePoint(parseInt(code, 16)); } catch (error) { return match; }
  }).replace(/(\p{Regional_Indicator})\s+(\p{Regional_Indicator})/gu, "$1$2");
}

// [Надпись](ссылка) → кликабельная надпись в Telegram. В предпросмотре
// показываем её же подчёркнутой.
function linkedPreview(text) {
  var pattern = /\[([^\]\n]{1,120})\]\(((?:https?:\/\/|mailto:)[^\s()<>"']{4,500})\)/g;
  var out = "";
  var last = 0;
  var match;
  while ((match = pattern.exec(String(text || "")))) {
    out += esc(String(text).slice(last, match.index));
    out += '<a href="' + esc(match[2]) + '" target="_blank" rel="noreferrer">' + esc(match[1]) + "</a>";
    last = match.index + match[0].length;
  }
  out += esc(String(text || "").slice(last));
  return out
    .replace(/\*\*([^*\n]{1,200})\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]{1,200})__/g, "<i>$1</i>");
}

function publishing() {
  return state.publishing || { signature: "", signatureEnabled: true, rubrics: [] };
}

function rubricPicker() {
  var rubrics = publishing().rubrics || [];
  if (!rubrics.length) {
    return '<div class="hint">Плашки рубрик можно завести во вкладке «Оформление постов» — они добавляются к посту картинкой.</div>';
  }
  return '<div class="field"><label for="groupRubric">Рубрика</label><select id="groupRubric"><option value="">без плашки</option>' +
    rubrics.map(function (rubric) {
      var where = rubric.placement === "top" ? "сверху" : rubric.placement === "separate" ? "отдельным сообщением" : "внизу";
      return '<option value="' + esc(rubric.id) + '">' + esc(rubric.name) + " (" + where + ")</option>";
    }).join("") + '</select><div id="rubricPreview" class="hint"></div></div>';
}

function bindRubricPicker(host) {
  var select = host.querySelector("#groupRubric");
  if (!select) return;
  var show = function () {
    var rubric = (publishing().rubrics || []).find(function (item) { return item.id === select.value; });
    var ownPhoto = host.querySelector("#groupImage") && host.querySelector("#groupImage").files.length;
    var longText = ((host.querySelector("#groupText") || {}).value || "").length > 900;
    host.querySelector("#rubricPreview").innerHTML = rubric
      ? '<img class="thumb" style="width:120px;height:auto;border-radius:6px" src="/api/media/rubrics/' + encodeURIComponent(rubric.id) + '" alt=""> ' +
        (rubric.placement === "top"
          ? "плашка встанет над текстом"
          : rubric.placement === "separate"
            ? "текст уйдёт во всю ширину, плашка — сообщением сразу за ним"
            : ownPhoto || longText
              ? "плашка уйдёт сообщением сразу под постом (у поста своё фото или длинный текст)"
              : "плашка будет внизу самого сообщения; ширина текста — по ширине плашки")
      : "";
  };
  select.onchange = show;
  var text = host.querySelector("#groupText");
  if (text) text.oninput = show;
  var photo = host.querySelector("#groupImage");
  if (photo) photo.addEventListener("change", show);
  show();
}

function buttonsNote() {
  var list = (publishing().buttons || []).filter(function (button) { return button.text; });
  if (!list.length) return "";
  return '<div class="field"><span class="field-label">Кнопки под постом</span><div class="row wrap">' +
    list.map(function (button) { return '<span class="chip brand" style="padding:6px 12px">' + esc(button.text) + "</span>"; }).join("") +
    '</div><div class="hint">Настраиваются во вкладке «Оформление постов».</div></div>';
}

function signatureNote() {
  var current = publishing();
  if (!current.signature || !current.signatureEnabled) {
    return '<div class="hint">Постоянная подпись выключена или пуста — включить её можно во вкладке «Оформление постов».</div>';
  }
  var lines = String(current.signature).split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  var shown = current.signatureWrap === "keep" || !current.signatureWrap
    ? current.signature
    : lines.join(current.signatureWrap === "dot" ? " · " : " ");
  return '<div class="field"><span class="field-label">Подпись под постом</span>' +
    '<div class="msg small">' + linkedPreview(shown) + "</div>" +
    '<label class="check"><input type="checkbox" id="groupNoSignature"> этот пост без подписи</label></div>';
}

function groupKindName(group) {
  return group.type === "channel" ? "канал" : group.type === "supergroup" ? "супергруппа" : "группа";
}
function membersWord(group) {
  return group.type === "channel" ? "Подписчиков" : "Участников";
}

function bindConnectGroup(host) {
  var button = host.querySelector("#connectGroup");
  if (!button) return;
  button.onclick = async function () {
    var chatId = host.querySelector("#newGroupId").value.trim();
    button.disabled = true;
    try {
      var result = await send("/api/groups", "POST", { chatId: chatId });
      selectedGroup = result.group.id;
      toast("Группа подключена: " + (result.group.title || result.group.id));
      await reload();
    } catch (error) { fail(error); }
    button.disabled = false;
  };
}

function renderGroups(host) {
  var groups = state.groups || [];
  var active = groups.filter(function (group) { return ["member", "administrator", "creator"].indexOf(group.status) >= 0; });
  if (!selectedGroup && active.length) selectedGroup = active[0].id;
  var group = groups.find(function (item) { return item.id === selectedGroup; });
  if (!groups.length) {
    host.innerHTML = connectGroupCard(true) +
      '<div class="card"><div class="empty"><b>Группа пока не подключена</b>' +
      "Добавьте бота в группу и назначьте администратором — новая группа появится здесь сама.<br>" +
      "Если бот уже состоит в группе, укажите её ID выше.</div></div>";
    bindConnectGroup(host);
    return;
  }
  pageAction("Обновить", async function () {
    try { await send("/api/groups/refresh", "POST", {}); await reload(); toast("Обновлено"); } catch (error) { fail(error); }
  }, "secondary");
  host.innerHTML = (groups.length > 1 ? '<div class="toolbar"><div class="tabs" id="groupPicker">' + groups.map(function (item) {
      return '<button type="button" data-group="' + esc(item.id) + '" class="' + (item.id === selectedGroup ? "active" : "") + '">' + esc(item.title || item.id) + "</button>";
    }).join("") + "</div></div>" : "") + '<div id="groupBody"></div>' +
    '<div style="margin-top:12px">' + connectGroupCard(false) + "</div>";
  bindConnectGroup(host);
  host.querySelectorAll("#groupPicker button").forEach(function (button) {
    button.onclick = function () { selectedGroup = button.dataset.group; renderGroups(host); };
  });
  renderGroupCard(host.querySelector("#groupBody"), group || groups[0]);
}

// Очередь отложенных публикаций этой группы: раньше запланированный пост
// нигде не показывался — ни отменить, ни узнать, что он не ушёл.
function groupPostQueue(group) {
  var posts = (state.groupPosts || []).filter(function (post) { return String(post.groupId) === String(group.id); });
  if (!posts.length) return "";
  return '<div class="card"><header><h3>Отложенные публикации</h3><div class="actions"><span class="small faint">время по часовому поясу бота</span></div></header><div class="list">' +
    posts.map(function (post) {
      var failed = post.status === "failed";
      return '<div class="list-item"><span class="grow"><b>' + esc(String(post.text || "Публикация с фото").slice(0, 80)) + "</b>" +
        '<br><span class="muted small">' + esc(dateTime(post.sendAt)) + (failed && post.error ? " · " + esc(String(post.error).slice(0, 120)) : "") + "</span></span>" +
        '<span class="chip ' + (failed ? "bad" : "brand") + '">' + (failed ? "не ушла" : "ждёт отправки") + "</span>" +
        '<button class="btn ghost small" data-cancel-post="' + esc(post.id) + '" type="button">' + (failed ? "Убрать" : "Отменить") + "</button></div>";
    }).join("") + "</div></div>";
}

function renderGroupCard(host, group) {
  var admin = group.status === "administrator" || group.status === "creator";
  var pinned = (group.messages || []).find(function (message) { return message.messageId === group.pinnedMessageId; });
  host.innerHTML =
    '<div class="grid cols-4" style="margin-bottom:12px">' +
      kpiCard(membersWord(group), num(group.memberCount), groupKindName(group)) +
      kpiCard("Права бота", admin ? "администратор" : "участник", admin ? "" : "назначьте администратором", admin ? "up" : "down") +
      kpiCard("Сообщений видно", num((group.messages || []).length), "из последних 200") +
      kpiCard("Заявок на вступление", num((group.joinRequests || []).length), (group.joinRequests || []).length ? "ждут решения" : "") +
    "</div>" +
    (group.lastError ? '<div class="card" style="margin-bottom:12px"><div class="card-body"><span class="chip bad">' + esc(group.lastError) + "</span></div></div>" : "") +
    '<div class="split"><div class="stack">' +
      '<div class="card"><header><h3>' + (group.type === "channel" ? "Опубликовать в канале" : "Написать в группу") + '</h3></header><div class="card-body stack">' +
        markupToolbar("groupText") +
        '<textarea id="groupText" placeholder="' + (group.type === "channel" ? "Текст поста от имени канала" : "Текст сообщения от имени бота") + '" style="min-height:110px"></textarea>' +
        '<div class="hint">Ссылка надписью: <code>[смотреть объекты](https://t.me/…)</code></div>' +
        '<div class="grid cols-2"><div class="field"><label for="groupButtonText">Кнопка (необязательно)</label><input id="groupButtonText" placeholder="Смотреть объекты"></div>' +
        '<div class="field"><label for="groupButtonUrl">Ссылка кнопки</label><input id="groupButtonUrl" placeholder="https://t.me/…"></div></div>' +
        '<div class="grid cols-2"><div class="field"><label for="groupImage">Фото</label><input id="groupImage" type="file" accept="image/jpeg,image/png"></div>' +
        '<div class="field"><label for="groupWhen">Отправить позже</label><input id="groupWhen" type="datetime-local"></div></div>' +
        rubricPicker() +
        signatureNote() +
        buttonsNote() +
        '<div class="row wrap">' + (groupCan(group, "can_pin_messages") ? '<label class="check"><input type="checkbox" id="groupPin"> закрепить</label>' : "") +
        '<label class="check"><input type="checkbox" id="groupNotify" checked> со звуком</label>' +
        '<div class="grow"></div><button class="btn secondary" id="groupPreview" type="button">Себе для проверки</button>' +
        '<button class="btn" id="groupSend" type="button">Отправить</button></div>' +
      "</div></div>" +
      '<div class="card"><header><h3>Предпросмотр</h3><div class="actions"><span class="small faint">так увидят подписчики</span></div></header>' +
        '<div class="card-body"><div class="tg-preview" id="postPreview"></div></div></div>' +
      groupPostQueue(group) +
      '<div class="card"><header><h3>' + (group.type === "channel" ? "Последние посты" : "Что бот видел в группе") + '</h3><div class="actions"><span class="small faint">историю Telegram не отдаёт</span></div></header>' +
        ((group.messages || []).length ? '<div class="list">' + (group.messages || []).slice().reverse().slice(0, 40).map(function (message) {
          return '<div class="list-item"><span class="avatar">' + esc(initials(message.name)) + "</span>" +
            '<span class="grow"><b>' + esc(message.name) + "</b>" + (message.fromBot ? ' <span class="chip brand">бот</span>' : "") +
            (message.kind !== "text" ? ' <span class="chip">' + esc(message.kind) + "</span>" : "") +
            '<br><span class="muted small">' + esc(String(message.text || "").slice(0, 120)) + "</span></span>" +
            '<span class="small faint nowrap">' + dateShort(message.date) + "</span>" +
            (groupCan(group, "can_pin_messages") ? '<button class="btn ghost small" data-pin="' + message.messageId + '" title="Закрепить">📌</button>' : "") +
            (groupCan(group, "can_delete_messages") ? '<button class="btn ghost small" data-del="' + message.messageId + '" title="Удалить">✕</button>' : "") + "</div>";
        }).join("") + "</div>" : '<div class="empty"><b>Пока пусто</b>' + (group.type === "channel" ? "Посты появятся здесь после первой публикации." : "Бот видит сообщения группы, если в BotFather выключен privacy mode.") + "</div>") +
      "</div>" +
    "</div>" +
    '<div class="stack">' +
      '<div class="card"><header><h3>' + esc(group.title || "Группа") + "</h3></header><div class=\"card-body stack\">" +
        '<div class="small muted">ID ' + esc(group.id) + (group.username ? " · @" + esc(group.username) : "") + "</div>" +
        (pinned ? '<div class="msg">📌 ' + esc(String(pinned.text || "").slice(0, 160)) + '<div class="msg-meta"><button class="btn ghost small" id="unpin" type="button">Открепить</button></div></div>' : '<div class="small faint">Закреплённого сообщения нет</div>') +
        (groupCan(group, "can_change_info") ? '<div class="field"><label for="groupTitle">Название</label><input id="groupTitle" value="' + esc(group.title || "") + '"></div>' +
          '<div class="field"><label for="groupDescription">Описание</label><textarea id="groupDescription">' + esc(group.description || "") + "</textarea></div>" +
          '<button class="btn secondary small" id="groupSaveInfo" type="button">Сохранить название и описание</button>' : '<div class="chip warn">' + (admin ? "Боту не выдано право менять описание" : "Бот не администратор: доступна только отправка сообщений") + "</div>") +
      "</div></div>" +
      ((group.joinRequests || []).length ? '<div class="card"><header><h3>Заявки на вступление</h3></header><div class="list">' + group.joinRequests.map(function (request) {
        return '<div class="list-item"><span class="grow"><b>' + esc(request.name) + "</b>" + (request.username ? ' <span class="small faint">@' + esc(request.username) + "</span>" : "") + "</span>" +
          '<button class="btn small" data-approve="' + esc(request.userId) + '" type="button">Принять</button>' +
          '<button class="btn ghost small" data-decline="' + esc(request.userId) + '" type="button">Отклонить</button></div>';
      }).join("") + "</div></div>" : "") +
      (group.username ? '<div class="card"><header><h3>Публичная ссылка</h3></header><div class="card-body"><a href="https://t.me/' + esc(group.username) + '" target="_blank" rel="noreferrer">t.me/' + esc(group.username) + "</a></div></div>" : "") +
      '<div class="card"><header><h3>Ссылка-приглашение</h3></header><div class="card-body stack">' +
        (group.inviteLink ? '<div class="row"><input value="' + esc(group.inviteLink) + '" readonly id="inviteLink"><button class="btn ghost small" id="copyInvite" type="button">Копировать</button></div>' : '<span class="muted small">Ссылки нет</span>') +
        '<div class="row wrap"><button class="btn secondary small" id="makeInvite" type="button">Создать новую</button>' +
        (group.inviteLink ? '<button class="btn ghost small" id="revokeInvite" type="button">Отозвать</button>' : "") + "</div></div></div>" +
      '<div class="card"><header><h3>Администраторы</h3><div class="actions"><button class="btn ghost small" id="loadAdmins" type="button">Показать</button></div></header><div class="card-body" id="adminsBox"><span class="muted small">Список ' + (group.type === "channel" ? "подписчиков" : "участников") + " Telegram не отдаёт — только администраторов.</span></div></div>" +
      '<div class="card"><header><h3>Опасная зона</h3></header><div class="card-body row wrap">' +
        '<button class="btn ghost small" id="unpinAll" type="button">Открепить всё</button>' +
        '<button class="btn danger small" id="leaveGroup" type="button">' + (group.type === "channel" ? "Покинуть канал" : "Выйти из группы") + "</button></div></div>" +
    "</div></div>";

  var base = "/api/groups/" + encodeURIComponent(group.id);
  var image = null;
  var previewImage = "";
  host.querySelector("#groupImage").onchange = function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      image = reader.result;
      previewImage = reader.result;
      updatePreview();
    };
    reader.readAsDataURL(file);
  };
  bindRubricPicker(host);
  bindMarkupToolbar(host);

  // Предпросмотр повторяет правила отправки: подпись, плашка, кнопки.
  function previewState() {
    var current = publishing();
    var lines = String(current.signature || "").split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    var signature = !current.signatureEnabled || (host.querySelector("#groupNoSignature") && host.querySelector("#groupNoSignature").checked)
      ? ""
      : current.signatureWrap === "keep" || !current.signatureWrap
        ? current.signature
        : lines.join(current.signatureWrap === "dot" ? " · " : " ");
    var dividers = { thin: "─────────────────────", bold: "━━━━━━━━━━━━━━━━━━", dash: "- - - - - - - - - - - - - - - -", dots: "· · · · · · · · · · · · · · · ·" };
    var divider = signature ? dividers[current.signatureDivider] : "";
    var rubric = (current.rubrics || []).find(function (item) { return item.id === ((host.querySelector("#groupRubric") || {}).value || ""); });
    return {
      body: host.querySelector("#groupText").value,
      signature: signature,
      divider: divider,
      quote: Boolean(current.signatureQuote),
      rubric: rubric || null,
      ownImage: previewImage,
      buttonText: host.querySelector("#groupButtonText").value.trim(),
      buttonUrl: host.querySelector("#groupButtonUrl").value.trim(),
      permanent: (current.buttons || []).filter(function (button) { return button.text; }),
      perRow: current.buttonsPerRow || 3,
    };
  }

  function bubble(imageHtml, textHtml, imageBelow) {
    if (!imageHtml && !textHtml) return "";
    return '<div class="tg-bubble">' + (imageBelow ? textHtml + imageHtml : imageHtml + textHtml) + "</div>";
  }

  function updatePreview() {
    var view = previewState();
    var box = host.querySelector("#postPreview");
    if (!box) return;
    var plain = [view.body, [view.divider, view.signature].filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
    if (!plain && !view.ownImage && !view.rubric) {
      box.innerHTML = '<span class="tg-note">Наберите текст — здесь появится готовое сообщение.</span>';
      return;
    }
    var signatureHtml = view.signature
      ? '<div class="' + (view.quote ? "tg-quote" : "") + '" ' + (view.quote ? "" : 'style="margin-top:8px"') + ">" +
        (view.divider ? esc(view.divider) + "\n" : "") + linkedPreview(view.signature) + "</div>"
      : "";
    var textHtml = (view.body || signatureHtml)
      ? '<div class="tg-text">' + linkedPreview(view.body) + signatureHtml + "</div>"
      : "";
    var plateUrl = view.rubric ? "/api/media/rubrics/" + encodeURIComponent(view.rubric.id) : "";
    var plateHtml = plateUrl ? '<img src="' + plateUrl + '" alt="">' : "";
    var ownHtml = view.ownImage ? '<img src="' + view.ownImage + '" alt="">' : "";
    var placement = view.rubric ? view.rubric.placement || "bottom" : "";
    var plateInside = placement === "bottom" && !view.ownImage && plain && plain.length <= 1024;
    var html = "";
    var note = "";
    if (plateInside) {
      html += bubble(plateHtml, textHtml, true);
    } else if (view.ownImage || placement === "top") {
      html += bubble(view.ownImage ? ownHtml : plateHtml, textHtml, false);
      if (plain.length > 1024) note = "Текст длиннее 1024 знаков — он уйдёт отдельным сообщением под картинкой.";
    } else {
      html += bubble("", textHtml, false);
    }
    if (view.rubric && placement !== "top" && !plateInside) {
      html += bubble(plateHtml, "", false);
      note = note || (placement === "separate" ? "Плашка уходит сообщением сразу за постом." : "Плашка не помещается внутрь сообщения и уйдёт следом.");
    }
    var rows = [];
    if (view.buttonText && view.buttonUrl) rows.push([view.buttonText]);
    var row = [];
    view.permanent.forEach(function (button) {
      row.push(button.text);
      if (row.length >= view.perRow) {
        rows.push(row);
        row = [];
      }
    });
    if (row.length) rows.push(row);
    if (rows.length) {
      html += '<div class="tg-buttons">' + rows.map(function (buttons) {
        return '<div class="row">' + buttons.map(function (text) { return '<span class="tg-button">' + esc(text) + "</span>"; }).join("") + "</div>";
      }).join("") + "</div>";
    }
    box.innerHTML = html + (note ? '<span class="tg-note">' + esc(note) + "</span>" : "");
  }

  host.querySelector("#groupText").addEventListener("input", updatePreview);
  host.querySelector("#groupButtonText").addEventListener("input", updatePreview);
  host.querySelector("#groupButtonUrl").addEventListener("input", updatePreview);
  if (host.querySelector("#groupRubric")) host.querySelector("#groupRubric").addEventListener("change", updatePreview);
  if (host.querySelector("#groupNoSignature")) host.querySelector("#groupNoSignature").addEventListener("change", updatePreview);
  updatePreview();
  function postPayload() {
    var when = host.querySelector("#groupWhen").value;
    return {
      text: host.querySelector("#groupText").value,
      buttonText: host.querySelector("#groupButtonText").value,
      buttonUrl: host.querySelector("#groupButtonUrl").value,
      rubricId: (host.querySelector("#groupRubric") || {}).value || "",
      withoutSignature: Boolean(host.querySelector("#groupNoSignature") && host.querySelector("#groupNoSignature").checked),
      pin: Boolean(host.querySelector("#groupPin") && host.querySelector("#groupPin").checked),
      notify: host.querySelector("#groupNotify").checked,
      image: image,
      sendAt: when ? zonedDateTimeToIso(when) : "",
    };
  }
  host.querySelector("#groupPreview").onclick = async function () {
    try {
      await send(base + "/post", "POST", Object.assign(postPayload(), { preview: true, sendAt: "" }));
      toast("Отправили вам в Telegram — посмотрите, как встанет плашка");
    } catch (error) { fail(error); }
  };
  host.querySelector("#groupSend").onclick = async function () {
    var payload = postPayload();
    // Пост уходит всем подписчикам сразу и правке не подлежит: спрашиваем, куда
    // и когда. Кнопка стоит рядом с «Себе для проверки», промахнуться легко.
    var where = (group.title || groupKindName(group)) + (group.memberCount ? ", " + counted(group.memberCount, "подписчик", "подписчика", "подписчиков") : "");
    var when = payload.sendAt ? "Отправим " + dateTime(payload.sendAt) + "." : "Сообщение уйдёт сразу.";
    if (!(await confirmDialog(
      payload.sendAt ? "Запланировать публикацию?" : "Опубликовать?",
      where + ". " + when + " Изменить отправленное сообщение нельзя, только удалить.",
      payload.sendAt ? "Запланировать" : "Опубликовать"
    ))) return;
    try {
      await send(base + "/post", "POST", payload);
      toast(payload.sendAt ? "Публикация запланирована" : group.type === "channel" ? "Опубликовано в канале" : "Отправлено в группу");
      await reload();
    } catch (error) { fail(error); }
  };
  host.querySelectorAll("[data-cancel-post]").forEach(function (button) {
    button.onclick = async function () {
      // Спрашиваем: отменённую публикацию не вернуть, а текст поста пропадёт.
      if (!(await confirmDialog("Отменить публикацию?", "Запланированный пост будет удалён вместе с текстом. Восстановить его будет нельзя.", "Отменить публикацию", true))) return;
      try {
        await api("/api/group-posts/" + encodeURIComponent(button.dataset.cancelPost), { method: "DELETE" });
        toast("Публикация убрана");
        await reload();
      } catch (error) { fail(error); }
    };
  });
  host.querySelectorAll("[data-pin]").forEach(function (button) {
    button.onclick = async function () {
      try { await send(base + "/pin", "POST", { messageId: button.dataset.pin, notify: false }); toast("Закреплено"); await reload(); } catch (error) { fail(error); }
    };
  });
  host.querySelectorAll("[data-del]").forEach(function (button) {
    button.onclick = async function () {
      if (!(await confirmDialog("Удалить сообщение?", "Сообщение исчезнет у всех участников группы.", "Удалить", true))) return;
      try { await api(base + "/messages/" + button.dataset.del, { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
    };
  });
  var unpin = host.querySelector("#unpin");
  if (unpin) unpin.onclick = async function () {
    try { await send(base + "/unpin", "POST", { messageId: group.pinnedMessageId }); await reload(); } catch (error) { fail(error); }
  };
  host.querySelector("#unpinAll").onclick = async function () {
    if (!(await confirmDialog("Открепить все сообщения?", "В группе не останется закреплённых сообщений.", "Открепить", true))) return;
    try { await send(base + "/unpin", "POST", { all: true }); await reload(); } catch (error) { fail(error); }
  };
  var saveInfo = host.querySelector("#groupSaveInfo");
  if (saveInfo) saveInfo.onclick = async function () {
    try {
      await send(base + "/info", "PUT", { title: host.querySelector("#groupTitle").value, description: host.querySelector("#groupDescription").value });
      toast("Сохранено");
      await reload();
    } catch (error) { fail(error); }
  };
  host.querySelectorAll("[data-approve]").forEach(function (button) {
    button.onclick = async function () {
      try { await send(base + "/join-requests/" + button.dataset.approve, "POST", { approve: true }); toast("Принят"); await reload(); } catch (error) { fail(error); }
    };
  });
  host.querySelectorAll("[data-decline]").forEach(function (button) {
    button.onclick = async function () {
      try { await send(base + "/join-requests/" + button.dataset.decline, "POST", { approve: false }); await reload(); } catch (error) { fail(error); }
    };
  });
  host.querySelector("#makeInvite").onclick = async function () {
    try { var result = await send(base + "/invite-link", "POST", {}); toast("Ссылка готова"); await reload(); } catch (error) { fail(error); }
  };
  var revoke = host.querySelector("#revokeInvite");
  if (revoke) revoke.onclick = async function () {
    // Отзыв ломает ссылку у всех, кому её уже отправили или где её разместили.
    if (!(await confirmDialog(
      "Отозвать ссылку-приглашение?",
      "Прежняя ссылка перестанет работать у всех, кому вы её отправили или где разместили. Вместо неё нужно будет создать новую.",
      "Отозвать",
      true
    ))) return;
    try { await send(base + "/invite-link", "POST", { revoke: true }); toast("Ссылка отозвана"); await reload(); } catch (error) { fail(error); }
  };
  var copy = host.querySelector("#copyInvite");
  if (copy) copy.onclick = function () {
    navigator.clipboard.writeText(host.querySelector("#inviteLink").value).then(function () { toast("Скопировано"); });
  };
  host.querySelector("#loadAdmins").onclick = async function () {
    try {
      var result = await api(base + "/admins");
      host.querySelector("#adminsBox").innerHTML = '<div class="list">' + result.admins.map(function (admin) {
        return '<div class="list-item"><span class="avatar">' + esc(initials(admin.name)) + '</span><span class="grow"><b>' + esc(admin.name) + "</b>" +
          (admin.username ? ' <span class="small faint">@' + esc(admin.username) + "</span>" : "") + (admin.isBot ? ' <span class="chip">бот</span>' : "") +
          '<br><span class="small faint">' + esc(admin.status === "creator" ? "владелец" : "администратор") + (admin.customTitle ? " · " + esc(admin.customTitle) : "") + "</span></span>" +
          (admin.status !== "creator" && !admin.isBot ? '<button class="btn ghost small" data-ban="' + esc(admin.userId) + '" type="button">Забанить</button>' : "") + "</div>";
      }).join("") + "</div>";
      host.querySelectorAll("[data-ban]").forEach(function (button) {
        button.onclick = async function () {
          if (!(await confirmDialog("Забанить участника?", "Он не сможет вернуться в группу, пока вы не снимете бан.", "Забанить", true))) return;
          try { await send(base + "/members/" + button.dataset.ban + "/ban", "POST", { revokeMessages: false }); toast("Забанен"); } catch (error) { fail(error); }
        };
      });
    } catch (error) { fail(error); }
  };
  host.querySelector("#leaveGroup").onclick = async function () {
    if (!(await confirmDialog("Выйти?", "Бот покинет " + groupKindName(group) + ". Вернуть его сможет только администратор.", "Выйти", true))) return;
    try { await send(base + "/leave", "POST", {}); toast("Бот вышел из группы"); await reload(); } catch (error) { fail(error); }
  };
}

// --- Оформление постов ------------------------------------------------------------
// Telegram вписывает картинку в свой блок и, если она слишком широкая и
// низкая, дополняет пустоту размытой копией. Дорисованные поля нужного цвета
// убирают это размытие.
var PLATE_RATIO = 3;

function padPlate(dataUrl, color, ratio) {
  return new Promise(function (resolve) {
    var picture = new Image();
    picture.onload = function () {
      var width = picture.naturalWidth;
      var height = Math.round(width / (ratio || PLATE_RATIO));
      if (picture.naturalHeight >= height) return resolve(dataUrl);
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = color || "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(picture, 0, Math.round((height - picture.naturalHeight) / 2));
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    picture.onerror = function () { resolve(dataUrl); };
    picture.src = dataUrl;
  });
}

// Ширина картинки задаёт ширину текста под ней, поэтому о узкой плашке
// лучше предупредить сразу.
function checkPlateWidth(row, index, onPad) {
  var picture = row.querySelector("img");
  if (!picture) return;
  var show = function () {
    if (!picture.naturalWidth) return;
    var note = row.querySelector("[data-size]");
    if (!note) {
      note = document.createElement("span");
      note.className = "small";
      note.dataset.size = "1";
      note.style.flexBasis = "100%";
      row.appendChild(note);
    }
    var ratio = picture.naturalWidth / picture.naturalHeight;
    var narrow = picture.naturalWidth < 1000;
    var flat = ratio > PLATE_RATIO;
    var small = picture.naturalWidth < 1280;
    note.innerHTML = picture.naturalWidth + "×" + picture.naturalHeight + " (" + ratio.toFixed(1) + ":1)" +
      (narrow ? " — узкая: текст под ней будет сжат." : small ? " — для чёткости лучше 1280 точек по ширине." : "") +
      (flat ? ' — слишком вытянутая: Telegram добавит размытый фон сверху и снизу. <select data-padratio="' + index + '" style="width:auto;display:inline-block;padding:2px 6px"><option value="3">до 3:1</option><option value="2.5">до 2,5:1</option><option value="2">до 2:1</option><option value="1.78">до 16:9</option></select> <input type="color" data-padcolor="' + index + '" value="#ffffff" style="width:34px;height:24px;padding:0;vertical-align:middle"> <label class="check" style="display:inline-flex"><input type="checkbox" data-padtransparent="' + index + '"> прозрачный</label> <button class="btn ghost small" data-pad="' + index + '" type="button">Дорисовать фон</button>' : "");
    note.style.color = narrow || flat ? "var(--warn)" : "var(--faint)";
    var padButton = note.querySelector("[data-pad]");
    if (padButton) {
      padButton.onclick = function () {
        var transparentFill = note.querySelector("[data-padtransparent]");
        var color = transparentFill && transparentFill.checked ? "none" : note.querySelector("[data-padcolor]").value;
        var ratio = Number(note.querySelector("[data-padratio]").value) || PLATE_RATIO;
        padPlate(picture.src, color, ratio).then(function (padded) { onPad(index, padded); });
      };
    }
  };
  if (picture.complete) show();
  else picture.onload = show;
}

function renderPostStyle(host) {
  var current = publishing();
  // Выбранная, но ещё не сохранённая картинка живёт в самой рубрике
  // (rubric.pendingImage). Раньше картинки хранились отдельно по номеру строки:
  // удалил рубрику — список сдвинулся, а картинка досталась соседней.
  var rubrics = (current.rubrics || []).map(function (rubric) { return Object.assign({}, rubric); });
  // Перерисовка не должна стирать то, что уже набрали.
  var draft = { signature: current.signature || "", signatureEnabled: current.signatureEnabled !== false, signatureWrap: current.signatureWrap || "keep", signatureQuote: Boolean(current.signatureQuote), signatureDivider: current.signatureDivider || "none" };
  var buttons = (current.buttons || []).map(function (button) { return { text: button.text, url: button.url }; });
  var perRow = current.buttonsPerRow || 3;

  function draw() {
    host.innerHTML = '<div class="grid cols-2">' +
      '<div class="card"><header><h3>Постоянная подпись</h3></header><div class="card-body stack">' +
        '<p class="muted small">Добавляется в конце каждого поста в группу или канал. Сюда обычно ставят контакты, сайт и ссылки на соцсети — ссылки Telegram сделает кликабельными сам.</p>' +
        '<label class="switch"><input type="checkbox" id="signOn"' + (draft.signatureEnabled ? " checked" : "") + '><span class="track"></span><span>Подпись включена</span></label>' +
        '<div class="field"><label for="signText">Текст подписи</label>' + markupToolbar("signText") + '<textarea id="signText" style="min-height:130px" placeholder="Construcciones Kornilenko&#10;+34 664 17 96 37&#10;https://t.me/имя_бота">' + esc(draft.signature) + "</textarea></div>" +
        '<div class="field"><label for="signWrap">Переносы строк</label><select id="signWrap">' +
          '<option value="keep"' + (draft.signatureWrap === "keep" ? " selected" : "") + '>как набрано</option>' +
          '<option value="space"' + (draft.signatureWrap === "space" ? " selected" : "") + '>одной строкой (перенос по ширине)</option>' +
          '<option value="dot"' + (draft.signatureWrap === "dot" ? " selected" : "") + '>одной строкой через «·»</option>' +
        "</select></div>" +
        '<div class="hint">Ссылка надписью: <code>[ТикТок](https://tiktok.com/@ваш_аккаунт)</code>. Жирный: <code>**Название**</code>, курсив: <code>__текст__</code>. Значок тоже может быть ссылкой: <code>[🎵](https://…)</code>.</div>' +
        '<label class="check"><input type="checkbox" id="signQuote"' + (draft.signatureQuote ? " checked" : "") + '> подпись отдельным блоком (цитатой с полоской слева)</label>' +
        '<div class="field"><label for="signDivider">Линия над подписью</label><select id="signDivider">' +
          [["none", "без линии"], ["thin", "тонкая ─────"], ["bold", "жирная ━━━━━"], ["dash", "пунктир - - - -"], ["dots", "точки · · · ·"]].map(function (option) {
            return '<option value="' + option[0] + '"' + (draft.signatureDivider === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
          }).join("") +
        '</select><div class="hint">Длинная линия задаёт ширину сообщения: блок подписи перестаёт быть узким и виден сразу.</div></div>' +
        '<div class="field"><span class="field-label">Так уйдёт в Telegram</span><div class="msg small" id="signPreview"></div><div id="signCodes" class="hint" style="color:var(--warn)"></div></div>' +
        '<button class="btn" id="saveStyle" type="button">Сохранить</button>' +
      "</div></div>" +
      '<div class="card"><header><h3>Кнопки под постом</h3><div class="actions"><button class="btn secondary small" id="addButton" type="button">＋ Кнопка</button></div></header><div class="card-body stack">' +
        '<p class="muted small">Кнопки идут под каждым постом и ведут по ссылке. По ним удобно попадать с телефона, и в них видно, куда ведёт ссылка. Значок ставится прямо в названии: «🎵 ТикТок».</p>' +
        (buttons.length ? buttons.map(function (button, index) {
          return '<div class="row wrap" data-button="' + index + '">' +
            '<input data-bfield="text" value="' + esc(button.text || "") + '" placeholder="🎵 ТикТок" style="max-width:190px">' +
            '<input data-bfield="url" value="' + esc(button.url || "") + '" placeholder="https://..." class="grow">' +
            '<button class="btn ghost small" data-bdrop="' + index + '" type="button">✕</button></div>';
        }).join("") : '<span class="muted small">Кнопок нет.</span>') +
        '<div class="field"><label for="btnPerRow">Кнопок в ряд</label><select id="btnPerRow" style="max-width:140px">' +
          [1, 2, 3].map(function (value) { return '<option value="' + value + '"' + (perRow === value ? " selected" : "") + ">" + value + "</option>"; }).join("") +
        "</select></div>" +
        '<div class="field"><span class="field-label">Так будет выглядеть</span><div id="btnPreview" class="row wrap"></div></div>' +
      "</div></div>" +
      '<div class="card"><header><h3>Рубрики</h3><div class="actions"><button class="btn secondary small" id="addRubric" type="button">＋ Рубрика</button></div></header><div class="card-body stack">' +
        '<p class="muted small">Плашка — картинка с названием рубрики. Telegram вписывает её в свой блок: если картинка вытянута шире 3:1, он дополняет пустоту размытым фоном. Кнопка «Дорисовать фон» добавляет поля нужного цвета вместо размытия.<br>' +
          '<b>Внизу сообщения</b> — картинка внутри поста, текст над ней. Важно: у сообщения с картинкой ширина равна ширине картинки, поэтому узкая плашка сжимает текст. Делайте плашку шириной от 1280 точек.<br>' +
          '<b>Отдельным сообщением</b> — текст уходит обычным сообщением во всю ширину, плашка приходит сразу следом.<br>' +
          '<b>Над текстом</b> — плашка становится картинкой поста, текст под ней.</p>' +
        '<div id="plateSizes" class="hint"></div>' +
        (rubrics.length ? rubrics.map(function (rubric, index) {
          return '<div class="row wrap" data-rubric="' + index + '" style="border-top:1px solid var(--line-soft);padding-top:8px">' +
            (rubric.pendingImage ? '<img class="thumb" style="width:74px;height:52px" src="' + rubric.pendingImage + '" alt="">' : rubric.image && rubric.image.exists ? '<img class="thumb" style="width:74px;height:52px" src="/api/media/rubrics/' + encodeURIComponent(rubric.id) + "?rev=" + encodeURIComponent(rubric.image.updatedAt || "") + '" alt="">' : '<span class="thumb" style="width:74px;height:52px"></span>') +
            '<input data-field="name" value="' + esc(rubric.name || "") + '" placeholder="Название рубрики" style="max-width:220px">' +
            '<select data-field="placement" style="max-width:210px">' +
              '<option value="bottom"' + (rubric.placement === "bottom" || !rubric.placement ? " selected" : "") + '>внизу сообщения</option>' +
              '<option value="separate"' + (rubric.placement === "separate" ? " selected" : "") + '>отдельным сообщением</option>' +
              '<option value="top"' + (rubric.placement === "top" ? " selected" : "") + ">над текстом</option>" +
            "</select>" +
            '<input type="file" accept="image/jpeg,image/png" data-file="' + index + '" style="max-width:190px">' +
            '<button class="btn ghost small" data-drop="' + index + '" type="button">✕</button></div>';
        }).join("") : '<span class="muted small">Рубрик пока нет.</span>') +
      "</div></div></div>";

    var preview = function () {
      var lines = String(draft.signature || "").split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
      var text = draft.signatureWrap === "keep" ? draft.signature : lines.join(draft.signatureWrap === "dot" ? " · " : " ");
      var dividers = { thin: "─────────────────────", bold: "━━━━━━━━━━━━━━━━━━", dash: "- - - - - - - - - - - - - - - -", dots: "· · · · · · · · · · · · · · · ·" };
      if (dividers[draft.signatureDivider] && text) text = dividers[draft.signatureDivider] + "\n" + text;
      var box = host.querySelector("#signPreview");
      box.innerHTML = draft.signatureEnabled ? (linkedPreview(text) || "подпись пуста") : "подпись выключена";
      box.style.borderLeft = draft.signatureQuote && draft.signatureEnabled ? "3px solid var(--brand)" : "";
      box.style.paddingLeft = draft.signatureQuote && draft.signatureEnabled ? "10px" : "";
      var warn = host.querySelector("#signCodes");
      warn.innerHTML = hasCodepoints(draft.signature)
        ? 'Похоже, значок вставлен кодом (U+1F1EA) — Telegram покажет его буквами. <button class="btn ghost small" id="fixCodes" type="button">Преобразовать в значки</button>'
        : "";
      var fix = host.querySelector("#fixCodes");
      if (fix) fix.onclick = function () {
        draft.signature = decodeCodepoints(draft.signature);
        host.querySelector("#signText").value = draft.signature;
        preview();
      };
    };
    bindMarkupToolbar(host);
    host.querySelector("#signText").oninput = function (event) { draft.signature = event.target.value; preview(); };
    host.querySelector("#signWrap").onchange = function (event) { draft.signatureWrap = event.target.value; preview(); };
    host.querySelector("#signQuote").onchange = function (event) { draft.signatureQuote = event.target.checked; preview(); };
    host.querySelector("#signDivider").onchange = function (event) { draft.signatureDivider = event.target.value; preview(); };
    preview();
    host.querySelector("#signOn").onchange = function (event) { draft.signatureEnabled = event.target.checked; preview(); };
    var drawButtonPreview = function () {
      var box = host.querySelector("#btnPreview");
      var visible = buttons.filter(function (button) { return button.text; });
      // На телефоне ряд делится поровну: длинная подпись обрезается многоточием.
      var limit = perRow === 3 ? 10 : perRow === 2 ? 16 : 28;
      var tooLong = visible.filter(function (button) { return [...button.text].length > limit; });
      box.innerHTML = (visible.map(function (button) {
        var long = [...button.text].length > limit;
        return '<span class="chip ' + (long ? "warn" : "brand") + '" style="padding:6px 12px">' + esc(button.text) + "</span>";
      }).join("") || '<span class="muted small">кнопок нет</span>') +
        (tooLong.length ? '<div class="hint" style="flex-basis:100%;color:var(--warn)">При ' + perRow + ' кнопках в ряд на телефоне помещается около ' + limit + ' знаков — подписи длиннее обрежутся многоточием. Уменьшите число кнопок в ряд или сократите названия.</div>' : "");
    };
    drawButtonPreview();
    host.querySelectorAll("[data-button]").forEach(function (row) {
      var index = Number(row.dataset.button);
      row.querySelectorAll("[data-bfield]").forEach(function (input) {
        input.oninput = function () {
          buttons[index][input.dataset.bfield] = input.value;
          drawButtonPreview();
        };
      });
      row.querySelector("[data-bdrop]").onclick = function () {
        buttons.splice(index, 1);
        draw();
      };
    });
    host.querySelector("#btnPerRow").onchange = function (event) { perRow = Number(event.target.value); drawButtonPreview(); };
    host.querySelector("#addButton").onclick = function () {
      buttons.push({ text: "", url: "" });
      draw();
    };
    host.querySelector("#addRubric").onclick = function () {
      rubrics.push({ id: "", name: "", placement: "bottom", image: null });
      draw();
    };
    host.querySelectorAll("[data-rubric]").forEach(function (row) {
      var index = Number(row.dataset.rubric);
      row.querySelectorAll("[data-field]").forEach(function (input) {
        input.oninput = input.onchange = function () { rubrics[index][input.dataset.field] = input.value; };
      });
      row.querySelector("[data-drop]").onclick = function () {
        rubrics.splice(index, 1);
        draw();
      };
      row.querySelector("[data-file]").onchange = function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () { rubrics[index].pendingImage = reader.result; draw(); };
        reader.readAsDataURL(file);
      };
      checkPlateWidth(row, index, function (position, padded) {
        if (rubrics[position]) rubrics[position].pendingImage = padded;
        draw();
      });
    });
    host.querySelector("#saveStyle").onclick = async function () {
      try {
        await send("/api/publishing", "PUT", {
          signature: draft.signature,
          signatureEnabled: draft.signatureEnabled,
          signatureWrap: draft.signatureWrap,
          signatureQuote: draft.signatureQuote,
          signatureDivider: draft.signatureDivider,
          buttons: buttons.filter(function (button) { return button.text && button.url; }),
          buttonsPerRow: perRow,
          rubrics: rubrics.map(function (rubric) {
            return { id: rubric.id, name: rubric.name, placement: rubric.placement, imageDataUrl: rubric.pendingImage || "" };
          }),
        });
        toast("Сохранено");
        await reload();
      } catch (error) { fail(error); }
    };
  }
  draw();
}

VIEWS.posts = {
  subtitle: function () { return "Сообщения клиентам, группы и каналы бота"; },
  render: function (host, tab) {
    if (tab === "channel") return renderGroups(host);
    if (tab === "style") return renderPostStyle(host);
    renderCampaigns(host);
  },
};
`;

export { REACH_JS };
