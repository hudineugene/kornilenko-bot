// Тексты бота: приветствие, запасные тексты разделов, контакты менеджера,
// автоответы и все подписи интерфейса.

const TEXTS_JS = String.raw`
var interfaceGroupOpen = "";

// --- Приветствие --------------------------------------------------------------
async function renderWelcome(host) {
  // Подписи кнопок приезжают отдельным запросом: рисуем экран, когда они уже
  // есть, иначе поля окажутся пустыми и сохранение сотрёт подписи.
  host.innerHTML = '<div class="card"><div class="card-body"><p class="muted small">Загружаю тексты…</p></div></div>';
  try {
    await loadInterfaceText();
  } catch (error) {
    host.innerHTML = '<div class="card"><div class="card-body"><div class="chip bad">' + esc(error.message) + "</div></div></div>";
    return;
  }
  var messages = state.config.messages || {};
  var images = state.welcomeImages || {};
  var labels = interfaceTexts().menuLabels || {};
  var hints = interfaceTexts().menuHints || {};
  var MENU_FIELDS = [
    ["objects", "Объекты"],
    ["selection", "Подбор"],
    ["contacts", "Связаться"],
    ["promotions", "Акции"],
    ["more", "Моё"],
    ["guide", "Как купить"],
    ["placeholder", "Подсказка в поле ввода"],
  ];
  host.innerHTML = '<div class="split"><div class="card"><header><h3>Приветствие и меню</h3></header><div class="card-body stack" id="welcomeForm">' +
      languageTabs() +
      '<div class="field"><label>Приветствие (/start)</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-tr="greeting" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" class="area-sm">' + esc((messages[language[0]] || {}).greeting || "") + "</textarea>";
      }).join("") + '<div class="hint">{first_name} подставит имя клиента, {last_name} — фамилию, {username} — ник в Telegram.</div></div>' +
      '<div class="field"><label>Подсказка под приветствием</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-hint="text" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc((hints[language[0]] || {}).text || "") + "</textarea>";
      }).join("") + '<div class="hint">Строку о том, сколько объектов в каталоге, бот добавляет сам.</div></div>' +
      '<div class="field"><label>Помощь (/help)</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-tr="help" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" class="area-lg">' + esc((messages[language[0]] || {}).help || "") + "</textarea>";
      }).join("") + "</div>" +
      '<div class="field"><label>Если бот не понял сообщение</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-tr="fallback" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc((messages[language[0]] || {}).fallback || "") + "</textarea>";
      }).join("") + "</div>" +
      '<div class="field"><span class="field-label">Кнопки меню</span><div class="grid cols-2">' + MENU_FIELDS.map(function (field) {
        return '<div class="field"><label>' + esc(field[1]) + "</label>" + LANGUAGES.map(function (language) {
          return '<input data-menu="' + field[0] + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" value="' + esc((labels[language[0]] || {})[field[0]] || "") + '">';
        }).join("") + "</div>";
      }).join("") + '</div><div class="hint">«Акции» показываются клиенту только когда есть действующие.</div></div>' +
      '<div class="field"><span class="field-label">Картинка приветствия</span>' + LANGUAGES.map(function (language) {
        var image = images[language[0]] || {};
        return '<div data-langpane="' + language[0] + '" class="' + (language[0] === "ru" ? "" : "hidden") + '">' +
          (image.exists ? '<img class="thumb thumb-md" src="/api/images/' + language[0] + '/welcome?rev=' + encodeURIComponent(image.updatedAt || "") + '" alt="">' : '<span class="muted small">Картинки нет</span>') +
          '<div class="row"><input type="file" accept="image/jpeg,image/png" data-welcome="' + language[0] + '">' +
          (image.exists ? '<button class="btn ghost small" type="button" data-drop="' + language[0] + '">Удалить</button>' : "") + "</div></div>";
      }).join("") + "</div>" +
    "</div></div>" +
    '<aside class="editor-preview-panel"><div class="editor-preview-head"><b>Как это выглядит у клиента</b><span id="welcomePreviewLanguage">Русский</span></div>' +
      '<div class="tg-preview" id="welcomePreview"></div>' +
      '<div class="tg-note gap-top">Имя показано как пример — бот подставит имя каждого клиента. Строку о каталоге бот считает сам.</div>' +
    "</aside></div>";

  bindLanguageTabs(host);
  var pendingImages = {};
  var exampleNames = { ru: "Анна", en: "Anna", es: "Ana" };
  var exampleCatalog = {
    ru: "Сейчас в каталоге: 12 объектов — Бенидорм, Альтеа, Кальпе",
    en: "In the catalogue right now: 12 properties — Benidorm, Altea, Calpe",
    es: "Ahora en el catálogo: 12 inmuebles — Benidorm, Altea, Calpe",
  };
  // Предпросмотр перерисовывается на каждый ввод: владелец видит ровно то,
  // что придёт клиенту, — картинку, текст и клавиатуру меню.
  function languageValue(selector, language) {
    var input = host.querySelector(selector + '[data-lang="' + language + '"]');
    return input ? String(input.value || "") : "";
  }
  function renderWelcomePreview() {
    var language = host.dataset.activeLanguage || "ru";
    var languageName = (LANGUAGES.find(function (item) { return item[0] === language; }) || ["", language])[1];
    host.querySelector("#welcomePreviewLanguage").textContent = languageName;
    var greeting = languageValue('[data-tr="greeting"]', language)
      .replace(/\{first_name\}/g, exampleNames[language] || "Anna")
      .replace(/\{last_name\}/g, "")
      .replace(/\{username\}/g, "anna");
    var hint = languageValue('[data-hint="text"]', language);
    var pending = pendingImages[language];
    var stored = (images[language] || {});
    var imageUrl = pending && pending.dataUrl
      ? pending.dataUrl
      : pending && pending.remove ? "" : stored.exists ? "/api/images/" + language + "/welcome?rev=" + encodeURIComponent(stored.updatedAt || "") : "";
    var text = [greeting, exampleCatalog[language] || exampleCatalog.ru, hint].filter(Boolean).join("\n\n");
    var buttons = MENU_FIELDS.filter(function (field) { return field[0] !== "placeholder"; })
      .map(function (field) { return languageValue('[data-menu="' + field[0] + '"]', language); })
      .filter(Boolean);
    host.querySelector("#welcomePreview").innerHTML =
      '<div class="tg-bubble">' + (imageUrl ? '<img src="' + esc(imageUrl) + '" alt="">' : "") +
        '<div class="tg-text">' + linkedPreview(text) + "</div></div>" +
      (buttons.length ? '<div class="tg-buttons">' + buttons.map(function (label) { return '<div class="tg-button">' + esc(label) + "</div>"; }).join("") + "</div>" : "") +
      '<div class="tg-note">В поле ввода: ' + esc(languageValue('[data-menu="placeholder"]', language) || "—") + "</div>";
  }
  host.addEventListener("input", renderWelcomePreview);
  host.addEventListener("langchange", renderWelcomePreview);
  host.querySelectorAll(".tabs button").forEach(function (button) {
    button.addEventListener("click", function () { setTimeout(renderWelcomePreview, 0); });
  });
  host.querySelectorAll("[data-welcome]").forEach(function (input) {
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        pendingImages[input.dataset.welcome] = { dataUrl: reader.result, name: file.name };
        watcher.mark();
        renderWelcomePreview();
      };
      reader.readAsDataURL(file);
    };
  });
  host.querySelectorAll("[data-drop]").forEach(function (button) {
    button.onclick = function () {
      pendingImages[button.dataset.drop] = { remove: true };
      button.disabled = true;
      watcher.mark();
      renderWelcomePreview();
    };
  });
  var watcher = watchForm(host, async function () {
    await send("/api/welcome", "PUT", {
      messages: buildMessages(host),
      menu: state.config.menu,
      images: pendingImages,
    });
    // Подписи кнопок и подсказка живут в текстах интерфейса — сохраняем их
    // тем же нажатием, чтобы владелец не искал вторую кнопку.
    var payload = JSON.parse(JSON.stringify(interfaceTexts()));
    LANGUAGES.forEach(function (language) {
      payload.menuLabels = payload.menuLabels || {};
      payload.menuLabels[language[0]] = payload.menuLabels[language[0]] || {};
      MENU_FIELDS.forEach(function (field) {
        var input = host.querySelector('[data-menu="' + field[0] + '"][data-lang="' + language[0] + '"]');
        if (input) payload.menuLabels[language[0]][field[0]] = input.value;
      });
      payload.menuHints = payload.menuHints || {};
      payload.menuHints[language[0]] = payload.menuHints[language[0]] || {};
      var hint = host.querySelector('[data-hint="text"][data-lang="' + language[0] + '"]');
      if (hint) payload.menuHints[language[0]].text = hint.value;
    });
    await send("/api/interface-text", "PUT", { interfaceText: payload });
    await loadInterfaceText(true);
  }, "Тексты приветствия изменены");
  renderWelcomePreview();
}

function buildMessages(host) {
  var messages = {};
  LANGUAGES.forEach(function (language) {
    messages[language[0]] = {
      greeting: (host.querySelector('[data-tr="greeting"][data-lang="' + language[0] + '"]') || {}).value || "",
      help: (host.querySelector('[data-tr="help"][data-lang="' + language[0] + '"]') || {}).value || "",
      fallback: (host.querySelector('[data-tr="fallback"][data-lang="' + language[0] + '"]') || {}).value || "",
    };
  });
  return messages;
}

// --- Запасные тексты разделов ---------------------------------------------------
function renderSections(host) {
  var menu = state.config.menu || {};
  // Контакты и «О компании» правятся на своей вкладке — здесь остаются только
  // тексты, которые клиент видит вместо пустого раздела.
  var fields = [["objects", "Объекты"], ["promotions", "Акции"]];
  host.innerHTML = '<div class="card"><header><h3>Если раздел пуст</h3><div class="actions"><span class="small faint">показываются, если карточек нет</span></div></header>' +
    '<div class="card-body stack" id="menuForm">' + languageTabs() +
    fields.map(function (field) {
      return '<div class="field"><label>' + field[1] + "</label>" + LANGUAGES.map(function (language) {
        return '<textarea data-tr="' + field[0] + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc(((menu[language[0]] || {})[field[0]]) || "") + "</textarea>";
      }).join("") + "</div>";
    }).join("") + "</div></div>";
  bindLanguageTabs(host);
  watchForm(host, async function () {
    var payload = {};
    LANGUAGES.forEach(function (language) {
      // Остальные тексты раздела оставляем как есть: они правятся на других
      // вкладках, и пустой ответ стёр бы их.
      payload[language[0]] = Object.assign({}, (state.config.menu || {})[language[0]] || {});
      fields.forEach(function (field) {
        payload[language[0]][field[0]] = host.querySelector('[data-tr="' + field[0] + '"][data-lang="' + language[0] + '"]').value;
      });
    });
    await send("/api/menu", "PUT", { menu: payload });
  }, "Тексты разделов изменены");
}

// --- Контакты -------------------------------------------------------------------
// Подпись кнопки на экране связи — та, что видит клиент (её можно править в «Тексты
// бота → Все подписи»), а не запомненная когда-то копия.
function contactScreenLabel(key, fallback) {
  var copy = (interfaceTexts().managerContact || {}).ru || {};
  return copy[key] || fallback;
}

function renderContacts(host) {
  var contacts = state.contacts || {};
  var hours = (state.config || {}).workingHours || {};
  var phones = String(contacts.phone || "").match(/\+?\d[\d\s().-]{5,}\d/g) || [];
  var whatsappAvailable = contacts.whatsappEnabled !== false && Boolean(contacts.whatsapp || phones[0]);
  var previewLines = [(contacts.text || {}).ru || ""];
  if (contacts.managerName) previewLines.push("👨‍💼 " + contacts.managerName);
  phones.forEach(function (phone) { previewLines.push("☎️ " + phone); });
  if (contacts.email) previewLines.push("✉️ " + contacts.email);
  host.innerHTML = '<div class="split"><div class="card"><header><h3>Менеджер и каналы связи</h3></header><div class="card-body stack" id="contactsForm">' +
      '<div class="grid cols-2">' +
        '<div class="field"><label for="cName">Имя менеджера или отдела</label><input id="cName" value="' + esc(contacts.managerName || "") + '"></div>' +
        '<div class="field"><label for="cPhone">Телефон</label><input id="cPhone" value="' + esc(contacts.phone || "") + '" placeholder="+34 600 000 000"></div>' +
        '<div class="field"><label for="cWhatsapp">WhatsApp</label><input id="cWhatsapp" value="' + esc(contacts.whatsapp || "") + '" placeholder="+34600000000 или wa.me/..."></div>' +
        '<div class="field"><label for="cTelegram">Telegram</label><input id="cTelegram" value="' + esc(contacts.telegram || "") + '" placeholder="@username"></div>' +
        '<div class="field"><label for="cEmail">E-mail</label><input id="cEmail" value="' + esc(contacts.email || "") + '"></div>' +
        '<div class="field"><label for="cSite">Сайт</label><input id="cSite" value="' + esc(contacts.website || "") + '"></div>' +
        '<div class="field"><label for="cMap">Ссылка на карту</label><input id="cMap" value="' + esc(contacts.mapUrl || "") + '"></div>' +
      "</div>" +
      '<label class="check"><input type="checkbox" id="cWhatsappOn"' + (contacts.whatsappEnabled !== false ? " checked" : "") + "> показывать кнопку WhatsApp</label>" +
      languageTabs() +
      '<div class="field"><label>Поясняющий текст</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-tr="text" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc((contacts.text || {})[language[0]] || "") + "</textarea>";
      }).join("") + "</div>" +
      '<div class="field"><label>О компании</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-about="1" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" class="area-lg">' + esc(((state.config.menu || {})[language[0]] || {}).about || "") + "</textarea>";
      }).join("") + '<div class="hint">Открывается кнопкой «ℹ️ О компании» на этом же экране у клиента.</div></div>' +
      '<div class="field"><span class="field-label">Как купить в Испании</span>' +
        '<div class="hint">Пять коротких экранов для покупателя из другой страны. Клиент открывает их кнопкой «🇪🇸 Как купить в Испании» на этом же экране.</div>' +
        (state.guidePages || []).map(function (page, index) {
          return '<details class="editor-section" data-guide="' + esc(page.id) + '"' + (index === 0 ? " open" : "") + '>' +
            '<summary><b>' + esc(page.title.ru) + "</b></summary>" +
            '<div class="editor-section-body stack">' +
            '<div class="field"><label>Заголовок</label>' + LANGUAGES.map(function (language) {
              return '<input data-guide-title="' + esc(page.id) + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" value="' + esc(page.title[language[0]] || "") + '">';
            }).join("") + "</div>" +
            '<div class="field"><label>Текст</label>' + LANGUAGES.map(function (language) {
              return '<textarea data-guide-text="' + esc(page.id) + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc(page.text[language[0]] || "") + "</textarea>";
            }).join("") + "</div></div></details>";
        }).join("") + "</div>" +
      '<div class="field"><label>Сообщение в нерабочее время</label>' + LANGUAGES.map(function (language) {
        return '<textarea data-hours="1" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc((hours.note || {})[language[0]] || "") + "</textarea>";
      }).join("") + '<div class="hint">{next} подставит ближайшее рабочее время. Сами часы работы — в «Настройках».</div></div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Так увидит клиент</h3></header><div class="card-body stack">' +
      '<div class="msg">' + esc(previewLines.filter(Boolean).join("\n\n")) + "</div>" +
      '<div class="row wrap">' + [whatsappAvailable ? "🟢 WhatsApp" : "", contacts.telegram ? "✈️ Telegram" : "", contacts.website ? "🌐 Сайт" : "", contacts.mapUrl ? "📍 Карта" : "", contactScreenLabel("request", "📞 Заказать звонок"), contactScreenLabel("question", "❓ Задать вопрос"), "ℹ️ О компании", "🏠 Главное меню"].filter(Boolean).map(function (label) {
        return '<span class="chip brand">' + esc(label) + "</span>";
      }).join("") + "</div>" +
    "</div></div></div>";
  bindLanguageTabs(host);
  watchForm(host, async function () {
    await send("/api/contacts", "PUT", {
      managerName: host.querySelector("#cName").value,
      phone: host.querySelector("#cPhone").value,
      whatsapp: host.querySelector("#cWhatsapp").value,
      whatsappEnabled: host.querySelector("#cWhatsappOn").checked,
      telegram: host.querySelector("#cTelegram").value,
      email: host.querySelector("#cEmail").value,
      website: host.querySelector("#cSite").value,
      mapUrl: host.querySelector("#cMap").value,
      text: collectTranslated(host, "text"),
    });
    // «О компании» и текст нерабочего времени хранятся в других местах, но
    // для владельца это один экран и одно сохранение.
    var menu = {};
    LANGUAGES.forEach(function (language) {
      menu[language[0]] = Object.assign({}, (state.config.menu || {})[language[0]] || {});
      var about = host.querySelector('[data-about="1"][data-lang="' + language[0] + '"]');
      if (about) menu[language[0]].about = about.value;
    });
    await send("/api/menu", "PUT", { menu: menu });
    var note = {};
    LANGUAGES.forEach(function (language) {
      var field = host.querySelector('[data-hours="1"][data-lang="' + language[0] + '"]');
      if (field) note[language[0]] = field.value;
    });
    // Страницы гида сохраняются тем же нажатием.
    const guide = (state.guidePages || []).map(function (page) {
      const title = {};
      const text = {};
      LANGUAGES.forEach(function (language) {
        const titleInput = host.querySelector('[data-guide-title="' + page.id + '"][data-lang="' + language[0] + '"]');
        const textInput = host.querySelector('[data-guide-text="' + page.id + '"][data-lang="' + language[0] + '"]');
        if (titleInput) title[language[0]] = titleInput.value;
        if (textInput) text[language[0]] = textInput.value;
      });
      return { id: page.id, title: title, text: text };
    });
    if (guide.length) await send("/api/guide", "PUT", { pages: guide });
    await send("/api/working-hours", "PUT", {
      enabled: hours.enabled === true,
      timeZone: state.config.timeZone,
      from: hours.from || "09:00",
      to: hours.to || "19:00",
      days: Array.isArray(hours.days) ? hours.days : [],
      replyMinutes: hours.replyMinutes || 0,
      note: note,
    });
  }, "Контакты изменены");
}

// --- Автоответы -------------------------------------------------------------------
var RULE_TYPES = [["contains", "содержит"], ["exact", "точное совпадение"], ["starts", "начинается с"]];
function renderRules(host) {
  var rules = (state.rules || []).slice().sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
  pageAction("＋ Автоответ", function () { openRuleEditor(null); });
  host.innerHTML = '<div class="split"><div class="stack"><div class="card"><div class="table-wrap"><table><thead><tr><th>Если сообщение</th><th>Ответ</th><th>Язык</th><th></th></tr></thead><tbody>' +
    (rules.length ? rules.map(function (rule) {
      return '<tr data-id="' + esc(rule.id) + '"><td class="clickable" data-edit="1"><b>' + esc(rule.trigger) + '</b><br><span class="small faint">' + esc((RULE_TYPES.find(function (type) { return type[0] === rule.type; }) || ["", ""])[1]) + "</span></td>" +
        "<td>" + esc(String(rule.answer).slice(0, 80)) + "</td><td>" + esc(rule.language === "all" ? "все" : rule.language.toUpperCase()) + "</td>" +
        '<td class="right nowrap">' + (rule.enabled === false ? '<span class="chip">выключен</span>' : "") +
        '<button class="btn ghost small" data-move="up" title="Проверять раньше">↑</button>' +
        '<button class="btn ghost small" data-move="down" title="Проверять позже">↓</button>' +
        '<button class="btn ghost small" data-delete="1">✕</button></td></tr>';
    }).join("") : '<tr><td colspan="4"><div class="empty"><b>Автоответов нет</b>Бот передаёт такие сообщения менеджеру</div></td></tr>') +
    "</tbody></table></div></div>" +
    // Шаблоны ответов — здесь же: это тоже заготовленный текст, только его
    // вставляет менеджер, а не отправляет бот.
    templatesCardHtml() + "</div>" +
    '<div class="card"><header><h3>Проверить сообщение</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="ruleTestText">Сообщение клиента</label><input id="ruleTestText" placeholder="Например: сколько стоит"></div>' +
      '<div class="field"><label for="ruleTestLang">Язык</label><select id="ruleTestLang"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div>' +
      '<button class="btn secondary" id="ruleTest" type="button">Проверить</button><div id="ruleTestResult" class="small muted"></div>' +
    "</div></div></div>";
  bindTemplatesCard(host, function () { renderRules(host); });
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    var id = row.dataset.id;
    row.querySelector("[data-edit]").onclick = function () { openRuleEditor(id); };
    row.querySelectorAll("[data-move]").forEach(function (button) {
      button.onclick = async function () {
        var ids = rules.map(function (rule) { return rule.id; });
        var index = ids.indexOf(id);
        var next = button.dataset.move === "up" ? index - 1 : index + 1;
        if (next < 0 || next >= ids.length) return;
        ids.splice(next, 0, ids.splice(index, 1)[0]);
        try { await send("/api/rules/reorder", "POST", { ids: ids }); await reload(); } catch (error) { fail(error); }
      };
    });
    row.querySelector("[data-delete]").onclick = async function () {
      if (!(await confirmDialog("Удалить автоответ?", "Бот перестанет отвечать на это сообщение.", "Удалить", true))) return;
      try { await api("/api/rules/" + encodeURIComponent(id), { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
    };
  });
  host.querySelector("#ruleTest").onclick = async function () {
    try {
      var result = await send("/api/rules/test", "POST", { text: host.querySelector("#ruleTestText").value, language: host.querySelector("#ruleTestLang").value });
      host.querySelector("#ruleTestResult").textContent = result.matched ? "Ответит: " + result.matched.answer : "Автоответа нет — сообщение уйдёт менеджеру";
    } catch (error) { fail(error); }
  };
}

function openRuleEditor(id) {
  var rule = id ? (state.rules || []).find(function (item) { return item.id === id; }) : null;
  openDialog({
    title: rule ? "Автоответ" : "Новый автоответ",
    protectChanges: true,
    body: '<div class="stack">' +
      '<div class="field"><label for="rTrigger">Если сообщение</label><input id="rTrigger" value="' + esc(rule && rule.trigger || "") + '"></div>' +
      '<div class="grid cols-2"><div class="field"><label for="rType">Как сравнивать</label><select id="rType">' + RULE_TYPES.map(function (type) {
        return '<option value="' + type[0] + '"' + (rule && rule.type === type[0] ? " selected" : "") + ">" + type[1] + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label for="rLang">Язык</label><select id="rLang"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="all">Любой</option></select></div></div>' +
      '<div class="field"><label for="rAnswer">Ответ бота</label><textarea id="rAnswer" class="area-sm">' + esc(rule && rule.answer || "") + "</textarea></div>" +
      '<label class="check"><input type="checkbox" id="rEnabled"' + (!rule || rule.enabled !== false ? " checked" : "") + "> автоответ включён</label></div>",
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn" id="saveRule" type="button">Сохранить</button>',
    ready: function (dialog) {
      if (rule) dialog.querySelector("#rLang").value = rule.language;
      dialog.querySelector("#saveRule").onclick = async function () {
        var payload = {
          trigger: dialog.querySelector("#rTrigger").value,
          type: dialog.querySelector("#rType").value,
          language: dialog.querySelector("#rLang").value,
          answer: dialog.querySelector("#rAnswer").value,
          enabled: dialog.querySelector("#rEnabled").checked,
        };
        try {
          if (rule) await send("/api/rules/" + encodeURIComponent(rule.id), "PUT", payload);
          else await send("/api/rules", "POST", payload);
          dialog.closeClean();
          toast("Сохранено");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

// --- Тексты интерфейса --------------------------------------------------------------
var INTERFACE_GROUPS = [
  ["menuLabels", "Кнопки главного меню"],
  ["menuHints", "Подсказка под приветствием"],
  ["mainMenu", "Текст главного меню"],
  ["myArea", "Раздел «Моё»"],
  ["savedSearch", "Сохранённый поиск"],
  ["comparison", "Сравнение объектов"],
  ["managerContact", "Связь с менеджером"],
  ["propertyActions", "Кнопки карточки объекта"],
  ["catalogFilter", "Фильтр каталога"],
  ["callbackForm", "Заявка на звонок"],
  ["viewingForm", "Запись на просмотр"],
  ["selectionForm", "Подбор объекта"],
  ["viewingNotices", "Напоминания о просмотре"],
  ["myRequests", "Мои заявки"],
  ["subscriptions", "Уведомления клиента"],
  ["calculator", "Калькулятор"],
  ["propertyAlerts", "Уведомления об объектах"],
  ["propertyTypes", "Типы недвижимости"],
  ["propertyBadges", "Метки объектов"],
  ["propertyConditions", "Состояние объекта"],
  ["privacy", "Данные клиента и политика"],
  ["emptyStates", "Если раздел пуст"],
  ["interaction", "Служебные сообщения"],
  ["commands", "Ответы на команды"],
  ["commandDescriptions", "Описания команд"],
  ["navigation", "Кнопки навигации"],
  ["languagePicker", "Выбор языка"],
  ["languageSelected", "После выбора языка"],
];

// Понятное название поля вместо внутреннего ключа. Для самых ходовых подписей
// оно записано словами; для остальных берём сам текст, который видит клиент, —
// по нему владелец и ищет. Ключ остаётся подсказкой при наведении: он нужен
// только для поддержки.
var INTERFACE_FIELD_NAMES = {
  menuLabels: {
    objects: "Кнопка меню «Каталог»", selection: "Кнопка меню «Подбор»", promotions: "Кнопка меню «Акции»",
    favorites: "Кнопка «Избранное»", contacts: "Кнопка меню «Связаться»", request: "Кнопка «Заказать звонок»",
    about: "Кнопка «О компании»", help: "Кнопка «Помощь»", more: "Кнопка меню «Моё»",
    language: "Кнопка «Сменить язык»", placeholder: "Подсказка в поле ввода",
  },
  propertyActions: {
    details: "Карточка объекта → кнопка «Подробнее»", contact: "Карточка объекта → кнопка «Связаться»",
    photos: "Карточка объекта → кнопка «Фото»", viewing: "Карточка объекта → кнопка «Записаться на просмотр»",
    cardFavorite: "Карточка объекта → кнопка «В избранное»", cardFavoriteRemove: "Карточка объекта → кнопка «Уже в избранном»",
    similar: "Карточка объекта → кнопка «Похожие»", question: "Карточка объекта → кнопка «Задать вопрос»",
    share: "Карточка объекта → кнопка «Поделиться»", openMap: "Карточка объекта → кнопка «Открыть карту»",
    viewWebsite: "Карточка объекта → кнопка «Посмотреть на сайте»", availability: "Карточка объекта → кнопка «Уточнить доступность»",
    interest: "Карточка объекта → кнопка «Заказать звонок»", received: "Ответ клиенту после заявки по объекту",
    priceOnRequest: "Карточка объекта → «Цена по запросу»", reserved: "Карточка объекта → метка «Забронирован»",
  },
  callbackForm: {
    askPhone: "Заявка на звонок → вопрос о телефоне", askTime: "Заявка на звонок → вопрос об удобном времени",
    askName: "Заявка на звонок → вопрос об имени", phoneButton: "Заявка на звонок → кнопка «Отправить мой номер»",
    success: "Заявка на звонок → подтверждение клиенту", chooseMethod: "Заявка на звонок → вопрос о способе связи",
    methodCall: "Способ связи → «Позвоните мне»", methodWhatsapp: "Способ связи → «Напишите в WhatsApp»",
    methodTelegram: "Способ связи → «Напишите в Telegram»",
  },
  viewingForm: {
    askDate: "Запись на просмотр → вопрос о дате", askTime: "Запись на просмотр → вопрос о времени",
    success: "Запись на просмотр → подтверждение клиенту", slotBooked: "Запись на просмотр → подтверждение при выборе свободного времени",
    sharePhoneForViewing: "Запись на просмотр → кнопка «Оставить номер»",
  },
};

function interfaceFieldLabel(group, key, value) {
  var named = INTERFACE_FIELD_NAMES[group] && INTERFACE_FIELD_NAMES[group][key];
  if (named) return named;
  var text = Array.isArray(value) ? value.join(", ") : String(value || "");
  var short = text.replace(/\s+/g, " ").trim();
  if (!short) return "Пустая подпись";
  return short.length <= 60 ? "«" + short + "»" : "«" + short.slice(0, 60) + "…»";
}

// {first_name} и соседей объясняем словами: владелец не обязан знать, что это
// подстановка.
function interfacePlaceholderHint(value) {
  var text = Array.isArray(value) ? value.join(" ") : String(value || "");
  var names = [];
  if (text.indexOf("{first_name}") >= 0) names.push("{first_name} — имя клиента");
  if (text.indexOf("{last_name}") >= 0) names.push("{last_name} — фамилия клиента");
  if (text.indexOf("{username}") >= 0) names.push("{username} — ник в Telegram");
  if (text.indexOf("{next}") >= 0) names.push("{next} — ближайшее рабочее время");
  if (text.indexOf("{count}") >= 0) names.push("{count} — число");
  if (text.indexOf("{city}") >= 0) names.push("{city} — город");
  return names.length ? '<div class="hint">' + esc(names.join(" · ")) + "</div>" : "";
}

async function renderInterface(host) {
  host.innerHTML = '<div class="card"><div class="card-body"><p class="muted small">Загружаю тексты…</p></div></div>';
  var texts;
  try {
    texts = await loadInterfaceText();
  } catch (error) {
    host.innerHTML = '<div class="card"><div class="card-body"><div class="chip bad">' + esc(error.message) + "</div></div></div>";
    return;
  }
  host.innerHTML = '<div class="toolbar"><div class="search"><input id="textSearch" placeholder="Найти текст"></div>' +
      '<span class="small faint">Здесь меняются все подписи, которые видит клиент</span></div>' +
    '<div class="card" id="interfaceForm"><div class="card-body stack">' + languageTabs() + "</div>" +
    INTERFACE_GROUPS.filter(function (group) { return texts[group[0]]; }).map(function (group) {
      var keys = Object.keys(texts[group[0]].ru || {});
      return '<details class="card flat-divided"' + (interfaceGroupOpen === group[0] ? " open" : "") + ' data-group="' + group[0] + '">' +
        '<summary class="pad-md"><b>' + esc(group[1]) + '</b> <span class="small faint">' + counted(keys.length, "текст", "текста", "текстов") + "</span></summary>" +
        '<div class="card-body grid cols-2">' + keys.map(function (key) {
          var value = (texts[group[0]].ru || {})[key];
          if (Array.isArray(value)) {
            return '<div class="field" data-text="' + esc(key) + '" title="' + esc(key) + '"><label>' + esc(interfaceFieldLabel(group[0], key, value)) + ' <span class="faint small">список</span></label>' + LANGUAGES.map(function (language) {
              return '<textarea data-group="' + group[0] + '" data-key="' + esc(key) + '" data-list="1" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc(((texts[group[0]][language[0]] || {})[key] || []).join("\n")) + "</textarea>";
            }).join("") + "</div>";
          }
          var long = String(value || "").length > 80;
          return '<div class="field" data-text="' + esc(key) + '" title="' + esc(key) + '"><label>' + esc(interfaceFieldLabel(group[0], key, value)) + "</label>" + LANGUAGES.map(function (language) {
            var text = (texts[group[0]][language[0]] || {})[key] || "";
            return long
              ? '<textarea data-group="' + group[0] + '" data-key="' + esc(key) + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc(text) + "</textarea>"
              : '<input data-group="' + group[0] + '" data-key="' + esc(key) + '" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '" value="' + esc(text) + '">';
          }).join("") + interfacePlaceholderHint(value) + "</div>";
        }).join("") + "</div></details>";
    }).join("") + "</div>";

  bindLanguageTabs(host);
  host.querySelectorAll("details").forEach(function (details) {
    details.addEventListener("toggle", function () { if (details.open) interfaceGroupOpen = details.dataset.group; });
  });
  var search = host.querySelector("#textSearch");
  search.oninput = function () {
    var query = search.value.trim().toLowerCase();
    host.querySelectorAll("details").forEach(function (details) {
      var hits = 0;
      details.querySelectorAll("[data-text]").forEach(function (field) {
        var match = !query || field.textContent.toLowerCase().indexOf(query) >= 0 || Array.from(field.querySelectorAll("input,textarea")).some(function (input) {
          return input.value.toLowerCase().indexOf(query) >= 0;
        });
        field.classList.toggle("hidden", !match);
        if (match) hits += 1;
      });
      details.classList.toggle("hidden", query && !hits);
      if (query && hits) details.open = true;
    });
  };
  watchForm(host, async function () {
    var payload = JSON.parse(JSON.stringify(interfaceTexts()));
    host.querySelectorAll("[data-group][data-key]").forEach(function (input) {
      var group = input.dataset.group, key = input.dataset.key, language = input.dataset.lang;
      payload[group] = payload[group] || {};
      payload[group][language] = payload[group][language] || {};
      payload[group][language][key] = input.dataset.list ? input.value.split("\n").map(function (line) { return line.trim(); }).filter(Boolean) : input.value;
    });
    await send("/api/interface-text", "PUT", { interfaceText: payload });
    await loadInterfaceText(true);
  }, "Тексты интерфейса изменены");
}

VIEWS.texts = {
  subtitle: function () { return "Всё, что бот говорит клиенту"; },
  render: function (host, tab) {
    if (tab === "sections") return renderSections(host);
    if (tab === "contacts") return renderContacts(host);
    if (tab === "rules") return renderRules(host);

    renderWelcome(host);
  },
};
`;

export { TEXTS_JS };
