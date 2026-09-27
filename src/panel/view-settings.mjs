// Настройки: подключение к Telegram, работа с клиентами, данные и доступ.

const SETTINGS_JS = String.raw`
var WEEKDAYS = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"]];
var TIME_ZONE_OPTIONS = [["Europe/Madrid", "Испания — материк"], ["Atlantic/Canary", "Испания — Канарские острова"], ["Europe/Kyiv", "Украина"], ["Europe/Moscow", "Москва"], ["UTC", "UTC"]];

// Настройки сохраняются одним запросом, поэтому неизменные поля посылаем как есть.
function settingsPayload() {
  return {
    messages: state.config.messages,
    adminChatId: state.config.adminChatId,
    notifyMode: state.config.notifyMode,
    reminderHours: state.config.reminderHours,
    timeZone: state.config.timeZone,
    statusNotices: state.config.statusNotices,
    active: state.config.active,
  };
}

function renderConnection(host) {
  var config = state.config, bot = state.bot || {};
  host.innerHTML = '<div class="grid cols-2"><div class="stack">' +
    '<div class="card"><header><h3>Бот</h3></header><div class="card-body stack">' +
      '<label class="switch"><input type="checkbox" id="setActive"' + (config.active ? " checked" : "") + '><span class="track"></span><span>Бот ' + (config.active ? "включён" : "выключен") + "</span></label>" +
      '<div class="small muted">' + esc(bot.firstName || "Бот") + (bot.username ? " · @" + esc(bot.username) : "") + " · " + esc(connectionText()) + "</div>" +
      '<div class="field"><label for="setToken">Новый токен из BotFather</label><input id="setToken" placeholder="оставьте пустым, чтобы не менять" autocomplete="off"></div>' +
      '<div class="field"><label for="setTokenPass">Текущий пароль панели</label><input id="setTokenPass" type="password" placeholder="нужен для смены токена" autocomplete="current-password"></div>' +
      '<div class="row wrap"><button class="btn secondary small" id="testToken" type="button">Проверить токен</button>' +
        '<button class="btn small" id="saveToken" type="button">Сменить токен</button><span id="tokenResult" class="small muted"></span></div>' +
      '<div class="hint">Токен меняется отдельной кнопкой: остальные настройки сохраняются сами, а подключение к Telegram — только по паролю.</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Админ-чат в Telegram</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="setAdminChat">Chat ID администратора</label><input id="setAdminChat" value="' + esc(config.adminChatId || "") + '" placeholder="узнать: напишите боту /myid"></div>' +
      '<div class="row wrap"><button class="btn secondary small" id="testAdmin" type="button">Отправить тест</button>' +
        (config.adminNotificationVerifiedAt ? '<span class="chip ok">проверен ' + dateShort(config.adminNotificationVerifiedAt) + "</span>" : '<span class="chip warn">не проверен</span>') + "</div>" +
      '<div class="field"><label for="setNotify">Что присылать в Telegram</label><select id="setNotify">' +
        '<option value="inquiries"' + (config.notifyMode !== "all" ? " selected" : "") + ">Только обращения и заявки</option>" +
        '<option value="all"' + (config.notifyMode === "all" ? " selected" : "") + ">Все действия клиентов</option></select></div>" +
      '<label class="check"><input type="checkbox" id="setStatusNotices"' + (config.statusNotices !== false ? " checked" : "") + "> сообщать о запуске и остановке бота</label>" +
    "</div></div>" +
  "</div>" +
  '<div class="stack"><div class="card"><header><h3>Менеджеры</h3><div class="actions"><button class="btn secondary small" id="addManager" type="button">＋ Менеджер</button></div></header>' +
    '<div class="card-body stack"><div class="field"><label for="adminName">Как зовут главного администратора</label><input id="adminName" value="' + esc(config.adminName || "") + '" placeholder="Администратор"></div>' +
    '<div id="managerList" class="stack"></div>' +
    '<div class="hint">Менеджер открывает бота, отправляет /myid и присылает номер. Заявки приходят всем, отвечает любой.</div>' +
    '<button class="btn secondary small" id="saveManagers" type="button">Сохранить менеджеров</button></div></div>' +
    '<div class="card"><header><h3>Надёжный запуск</h3></header><div class="card-body stack">' +
      '<div class="row"><span class="dot" id="autostartDot"></span><span class="grow" id="autostartText">Проверяем автозапуск…</span></div>' +
      '<div class="hint">Windows запустит bot.exe после входа в систему и повторит запуск, если программа завершится с ошибкой.</div>' +
      '<button class="btn secondary small" id="autostartButton" type="button" disabled>Настроить</button>' +
    '</div></div></div></div>';

  var watcher = watchForm(host.querySelector(".stack"), async function () {
    await send("/api/settings", "PUT", Object.assign(settingsPayload(), {
      adminChatId: host.querySelector("#setAdminChat").value.trim(),
      notifyMode: host.querySelector("#setNotify").value,
      statusNotices: host.querySelector("#setStatusNotices").checked,
      active: host.querySelector("#setActive").checked,
    }));
  }, "Настройки подключения изменены");

  host.querySelector("#saveToken").onclick = async function () {
    var token = host.querySelector("#setToken").value.trim();
    var password = host.querySelector("#setTokenPass").value;
    if (!token) return toast("Введите новый токен", true);
    if (!password) return toast("Введите текущий пароль панели", true);
    if (!(await confirmDialog("Сменить токен бота?", "Бот переподключится к Telegram с новым токеном. Прежние ссылки на загруженные фотографии перестанут действовать, бот загрузит их заново.", "Сменить", true))) return;
    var button = this;
    button.disabled = true;
    try {
      await send("/api/settings", "PUT", Object.assign(settingsPayload(), {
        token: token,
        currentPassword: password,
        adminChatId: host.querySelector("#setAdminChat").value.trim(),
        notifyMode: host.querySelector("#setNotify").value,
        statusNotices: host.querySelector("#setStatusNotices").checked,
        active: host.querySelector("#setActive").checked,
      }));
      host.querySelector("#setToken").value = "";
      host.querySelector("#setTokenPass").value = "";
      toast("Токен изменён, бот переподключается");
      await reload();
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  };
  host.querySelector("#testToken").onclick = async function () {
    var token = host.querySelector("#setToken").value.trim();
    host.querySelector("#tokenResult").textContent = "Проверяем…";
    try {
      var result = await send("/api/token-test", "POST", { token: token });
      host.querySelector("#tokenResult").textContent = "Токен рабочий: " + (result.bot && result.bot.firstName || "бот") + (result.bot && result.bot.username ? " @" + result.bot.username : "");
    } catch (error) { host.querySelector("#tokenResult").textContent = error.message; }
  };
  host.querySelector("#testAdmin").onclick = async function () {
    try { await send("/api/admin-notification/test", "POST", { chatId: host.querySelector("#setAdminChat").value.trim() }); toast("Сообщение отправлено в Telegram"); await reload(); } catch (error) { fail(error); }
  };

  var autostartInfo = null;
  function showAutostart(info) {
    autostartInfo = info;
    var dot = host.querySelector("#autostartDot");
    var text = host.querySelector("#autostartText");
    var button = host.querySelector("#autostartButton");
    if (!info.supported) {
      dot.className = "dot off";
      text.textContent = "Доступно в автономном bot.exe на Windows";
      button.textContent = "Недоступно";
      button.disabled = true;
      return;
    }
    dot.className = "dot " + (info.enabled ? "on" : "off");
    text.textContent = info.enabled ? "Автозапуск включён" : "Автозапуск выключен";
    button.textContent = info.enabled ? "Отключить автозапуск" : "Включить автозапуск";
    button.className = "btn " + (info.enabled ? "ghost" : "secondary") + " small";
    button.disabled = false;
  }
  api("/api/autostart").then(showAutostart).catch(function (error) {
    host.querySelector("#autostartText").textContent = error.message;
  });
  host.querySelector("#autostartButton").onclick = async function () {
    if (!autostartInfo || !autostartInfo.supported) return;
    var enabling = !autostartInfo.enabled;
    var accepted = await confirmDialog(
      enabling ? "Включить автозапуск?" : "Отключить автозапуск?",
      enabling ? "Бот будет запускаться после входа в Windows и восстанавливаться после сбоя." : "После следующего входа в Windows бот сам не запустится.",
      enabling ? "Включить" : "Отключить",
      false
    );
    if (!accepted) return;
    var button = host.querySelector("#autostartButton");
    button.disabled = true;
    try {
      showAutostart(await send("/api/autostart", "PUT", { enabled: enabling }));
      toast(enabling ? "Автозапуск включён" : "Автозапуск отключён");
    } catch (error) { fail(error); button.disabled = false; }
  };

  var managers = (config.managers || []).slice();
  function drawManagers() {
    var list = host.querySelector("#managerList");
    list.innerHTML = managers.length ? managers.map(function (manager, index) {
      return '<div class="row" data-manager="' + index + '"><input class="grow" data-field="name" value="' + esc(manager.name || "") + '" placeholder="Имя">' +
        '<input style="max-width:170px" data-field="chatId" value="' + esc(manager.chatId || "") + '" placeholder="Chat ID">' +
        (manager.verifiedAt ? '<span class="chip ok">ок</span>' : manager.id ? '<button class="btn ghost small" data-test="' + esc(manager.id) + '" type="button">Тест</button>' : "") +
        '<button class="btn ghost small" data-drop="' + index + '" type="button">✕</button></div>';
    }).join("") : '<span class="muted small">Менеджеров нет — заявки приходят только администратору.</span>';
    list.querySelectorAll("[data-drop]").forEach(function (button) {
      button.onclick = function () { managers.splice(Number(button.dataset.drop), 1); drawManagers(); };
    });
    list.querySelectorAll("[data-test]").forEach(function (button) {
      button.onclick = async function () {
        try { await send("/api/managers/" + encodeURIComponent(button.dataset.test) + "/test", "POST", {}); toast("Проверочное сообщение отправлено"); await reload(); } catch (error) { fail(error); }
      };
    });
    list.querySelectorAll("[data-manager] input").forEach(function (input) {
      input.oninput = function () {
        var index = Number(input.closest("[data-manager]").dataset.manager);
        managers[index][input.dataset.field] = input.value;
      };
    });
  }
  drawManagers();
  host.querySelector("#addManager").onclick = function () { managers.push({ name: "", chatId: "" }); drawManagers(); };
  host.querySelector("#saveManagers").onclick = async function () {
    try {
      await send("/api/managers", "PUT", { adminName: host.querySelector("#adminName").value, managers: managers.filter(function (manager) { return manager.name || manager.chatId; }) });
      toast("Менеджеры сохранены");
      await reload();
    } catch (error) { fail(error); }
  };
}

function renderWork(host) {
  var hours = state.config.workingHours || {}, slots = state.config.viewingSlots || {}, calculator = state.config.calculator || {};
  host.innerHTML = '<div class="grid cols-2">' +
    '<div class="card"><header><h3>Рабочее время</h3></header><div class="card-body stack" id="hoursCard">' +
      '<label class="check"><input type="checkbox" id="hoursOn"' + (hours.enabled ? " checked" : "") + "> предупреждать клиентов о нерабочем времени</label>" +
      '<div class="field"><label for="businessTimeZone">Часовой пояс компании</label><select id="businessTimeZone">' + TIME_ZONE_OPTIONS.map(function (option) {
        return '<option value="' + option[0] + '"' + ((state.config.timeZone || "Europe/Madrid") === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
      }).join("") + '</select><div class="hint">По этому времени работают расписания, напоминания и отложенные публикации.</div></div>' +
      '<div class="row"><div class="field"><label for="hoursFrom">С</label><input id="hoursFrom" type="time" value="' + esc(hours.from || "09:00") + '"></div>' +
      '<div class="field"><label for="hoursTo">До</label><input id="hoursTo" type="time" value="' + esc(hours.to || "19:00") + '"></div></div>' +
      '<div class="field"><span class="field-label">Рабочие дни</span><div class="row wrap">' + WEEKDAYS.map(function (day) {
        return '<label class="check"><input type="checkbox" data-day="' + day[0] + '"' + ((hours.days || []).indexOf(day[0]) >= 0 ? " checked" : "") + "> " + day[1] + "</label>";
      }).join("") + "</div></div>" +
      '<div class="field"><span class="field-label">Текст для клиента</span>' + languageTabs() + LANGUAGES.map(function (language) {
        return '<textarea data-tr="hoursNote" data-lang="' + language[0] + '" class="lang-input' + (language[0] === "ru" ? "" : " hidden") + '">' + esc((hours.note || {})[language[0]] || "") + "</textarea>";
      }).join("") + '<div class="hint">{next} подставит ближайшее рабочее время. Заполните текст на всех языках.</div></div>' +
      '<button class="btn secondary small" id="saveHours" type="button">Сохранить</button>' +
    "</div></div>" +
    '<div class="card"><header><h3>Свободное время для просмотров</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="slotsOn"' + (slots.enabled ? " checked" : "") + "> предлагать клиенту свободные слоты</label>" +
      '<div class="field"><span class="field-label">Дни</span><div class="row wrap">' + WEEKDAYS.map(function (day) {
        return '<label class="check"><input type="checkbox" data-slotday="' + day[0] + '"' + ((slots.days || []).indexOf(day[0]) >= 0 ? " checked" : "") + "> " + day[1] + "</label>";
      }).join("") + "</div></div>" +
      '<div class="field"><label for="slotTimes">Время показов через запятую</label><input id="slotTimes" value="' + esc((slots.times || []).join(", ")) + '" placeholder="10:00, 12:00, 17:00"></div>' +
      '<div class="row"><div class="field"><label for="slotDays">На сколько дней вперёд</label><input id="slotDays" type="number" min="1" max="30" value="' + esc(slots.daysAhead || 7) + '"></div>' +
      '<div class="field"><label for="slotPer">Записей на одно время</label><input id="slotPer" type="number" min="1" max="10" value="' + esc(slots.perSlot || 1) + '"></div></div>' +
      '<button class="btn secondary small" id="saveSlots" type="button">Сохранить</button>' +
    "</div></div>" +
    '<div class="card"><header><h3>Калькулятор покупки</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="calcOn"' + (calculator.enabled ? " checked" : "") + "> показывать расчёт расходов в карточке</label>" +
      '<div class="grid cols-2">' +
        ["resaleTaxPercent:Налог, вторичка %", "newBuildTaxPercent:Налог, новостройка %", "stampDutyPercent:Гербовый сбор %", "otherCostsPercent:Прочие расходы %", "downPaymentPercent:Первый взнос %", "mortgageRatePercent:Ставка ипотеки %", "mortgageYears:Срок ипотеки, лет"].map(function (pair) {
          var parts = pair.split(":");
          return '<div class="field"><label>' + parts[1] + '</label><input data-calc="' + parts[0] + '" type="number" step="0.1" value="' + esc(calculator[parts[0]] != null ? calculator[parts[0]] : "") + '"></div>';
        }).join("") +
      "</div><button class=\"btn secondary small\" id=\"saveCalc\" type=\"button\">Сохранить</button>" +
    "</div></div>" +
    '<div class="card"><header><h3>Напоминания</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="remindHours">Напомнить об обращении без ответа</label><select id="remindHours">' +
        [[0, "не напоминать"], [1, "через 1 час"], [2, "через 2 часа"], [4, "через 4 часа"], [8, "через 8 часов"], [24, "через сутки"]].map(function (option) {
          return '<option value="' + option[0] + '"' + (Number(state.config.reminderHours) === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
        }).join("") + "</select></div>" +
      '<div class="hint">Напоминания и сводки приходят только в рабочее время, если оно включено.</div>' +
      '<div class="field"><label for="retentionMonths">Сколько хранить данные клиента</label><select id="retentionMonths">' +
        [[0, "без срока"], [12, "12 месяцев"], [18, "18 месяцев"], [24, "24 месяца"], [36, "36 месяцев"], [48, "48 месяцев"]].map(function (option) {
          return '<option value="' + option[0] + '"' + (Number(state.config.retentionMonths) === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
        }).join("") + "</select></div>" +
      '<div class="hint">Отсчёт от последнего обращения клиента. Раз в сутки бот удаляет данные тех, от кого давно ничего не было, и сообщает об этом. Открытые дела и предстоящие просмотры не удаляются. Срок нужно указать в политике конфиденциальности.</div>' +
      '<button class="btn secondary small" id="saveReminders" type="button">Сохранить</button>' +
    "</div></div></div>";

  bindLanguageTabs(host);
  host.querySelector("#saveHours").onclick = async function () {
    try {
      await send("/api/working-hours", "PUT", {
        enabled: host.querySelector("#hoursOn").checked,
        timeZone: host.querySelector("#businessTimeZone").value,
        from: host.querySelector("#hoursFrom").value,
        to: host.querySelector("#hoursTo").value,
        days: Array.from(host.querySelectorAll("[data-day]")).filter(function (box) { return box.checked; }).map(function (box) { return Number(box.dataset.day); }),
        note: collectTranslated(host, "hoursNote"),
      });
      toast("Сохранено"); await reload();
    } catch (error) { fail(error); }
  };
  host.querySelector("#saveSlots").onclick = async function () {
    try {
      await send("/api/viewing-slots", "PUT", {
        enabled: host.querySelector("#slotsOn").checked,
        days: Array.from(host.querySelectorAll("[data-slotday]")).filter(function (box) { return box.checked; }).map(function (box) { return Number(box.dataset.slotday); }),
        times: host.querySelector("#slotTimes").value,
        daysAhead: host.querySelector("#slotDays").value,
        perSlot: host.querySelector("#slotPer").value,
      });
      toast("Сохранено"); await reload();
    } catch (error) { fail(error); }
  };
  host.querySelector("#saveCalc").onclick = async function () {
    var payload = { enabled: host.querySelector("#calcOn").checked };
    host.querySelectorAll("[data-calc]").forEach(function (input) { payload[input.dataset.calc] = input.value; });
    try { await send("/api/calculator", "PUT", payload); toast("Сохранено"); await reload(); } catch (error) { fail(error); }
  };
  host.querySelector("#saveReminders").onclick = async function () {
    try {
      await send("/api/settings", "PUT", Object.assign(settingsPayload(), {
        reminderHours: Number(host.querySelector("#remindHours").value),
        retentionMonths: Number(host.querySelector("#retentionMonths").value),
      }));
      toast("Сохранено"); await reload();
    } catch (error) { fail(error); }
  };
}

function mediaCheckHtml(report) {
  var missing = report.missing || [];
  var rows = '<div class="row wrap">' +
    '<span class="chip ' + (missing.length ? "bad" : "ok") + '">' + (missing.length
      ? "нет файлов: " + missing.length + (report.missingRefs > missing.length ? " (ссылок на них: " + report.missingRefs + ")" : "")
      : "все файлы на месте") + "</span>" +
    '<span class="chip">картинок в данных: ' + Number(report.total || 0) + "</span>" +
    (report.orphans ? '<span class="chip warn">лишних файлов: ' + Number(report.orphans) + "</span>" : "") +
    (typeof report.restored === "number" && report.restored ? '<span class="chip ok">вернули из копии: ' + report.restored + "</span>" : "") +
    "</div>";
  if (missing.length) {
    rows += '<div class="list">' + missing.slice(0, 20).map(function (name) {
      return '<div class="list-item"><span class="grow muted small">' + esc(name) + "</span></div>";
    }).join("") + "</div>" +
      '<div class="row wrap"><button class="btn secondary small" id="restoreMedia" type="button">Вернуть из ежедневной копии</button></div>' +
      '<div class="hint">Если файла нет и в копии, картинку нужно загрузить заново в карточке объекта.</div>';
  }
  return rows;
}

function renderData(host) {
  var backup = state.config.telegramBackup || {};
  host.innerHTML = '<div class="grid cols-2">' +
    '<div class="card"><header><h3>Резервная копия</h3></header><div class="card-body stack">' +
      '<p class="muted small">Копия содержит объекты, тексты, клиентов и обращения. Храните её в надёжном месте.</p>' +
      '<div class="row wrap"><button class="btn secondary" id="downloadBackup" type="button">⬇ Скачать копию</button>' +
      '<label class="btn ghost" style="cursor:pointer">⬆ Восстановить<input type="file" id="restoreFile" accept=".json,.gz,.kbk,application/json,application/gzip" class="hidden"></label></div>' +
      '<div class="hint">Подходит файл этой кнопки (.json.gz), обычный .json и зашифрованная копия из Telegram (.kbk — понадобится её пароль). Ежедневная копия создаётся сама в папке backups рядом с ботом.</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Копия в Telegram</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="tgBackupOn"' + (backup.enabled ? " checked" : "") + "> присылать зашифрованную копию раз в неделю</label>" +
      '<div class="field"><label for="tgBackupPass">Пароль шифрования</label><input id="tgBackupPass" type="password" placeholder="' + (backup.passwordSet ? "пароль сохранён" : "минимум 10 символов") + '"></div>' +
      '<div class="row wrap"><button class="btn secondary small" id="saveTgBackup" type="button">Сохранить</button>' +
      '<button class="btn ghost small" id="sendTgBackup" type="button">Отправить сейчас</button></div>' +
      (backup.lastSentAt ? '<div class="small muted">Последняя копия: ' + dateTime(backup.lastSentAt) + "</div>" : "") +
      (backup.lastError ? '<div class="chip bad">' + esc(backup.lastError) + "</div>" : "") +
      '<div class="hint">Файл .kbk можно восстановить здесь же — понадобится этот пароль.</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Самопроверка</h3><div class="actions"><button class="btn secondary small" id="runSelfCheck" type="button">Проверить сейчас</button></div></header>' +
      '<div class="card-body stack" id="selfCheckBody"><p class="muted small">Проверяет токен и связь, чат администратора, видимость каталога у клиентов, файлы картинок и версию данных. Ничего не меняет.</p></div>' +
    "</div>" +
    '<div class="card"><header><h3>Файлы картинок</h3><div class="actions"><button class="btn secondary small" id="checkMedia" type="button">Проверить файлы</button></div></header>' +
      '<div class="card-body stack" id="mediaCheckBody"><p class="muted small">Сверяет картинки в данных с файлами в папке bot-media. Потерянные можно вернуть из ежедневной копии.</p></div>' +
    "</div>" +
    '<div class="card"><header><h3>Журнал ошибок</h3><div class="actions"><button class="btn ghost small" id="clearErrors" type="button">Очистить</button></div></header>' +
      ((state.errors || []).length ? '<div class="list">' + state.errors.slice(0, 20).map(function (error) {
        return '<div class="list-item"><span class="grow"><b>' + esc(error.area || error.context || "Ошибка") + '</b><br><span class="muted small">' + esc(error.message) + "</span></span>" +
          '<span class="small faint nowrap">' + dateTime(error.createdAt || error.at) + "</span></div>";
      }).join("") + "</div>" : '<div class="empty"><b>Ошибок нет</b></div>') +
    "</div>" +
    '<div class="card"><header><h3>Статистика и история</h3></header><div class="card-body stack">' +
      '<div class="small muted">Сообщений получено: ' + num((state.stats || {}).messagesReceived) + " · отправлено: " + num((state.stats || {}).messagesSent) + "</div>" +
      '<div class="row wrap"><button class="btn ghost small" id="resetStats" type="button">Обнулить счётчики</button>' +
      '<button class="btn ghost small" id="clearActivity" type="button">Очистить историю активности</button></div>' +
      '<div class="hint">Обращения и клиенты при этом не удаляются.</div>' +
    "</div></div></div>";

  host.querySelector("#downloadBackup").onclick = function () { window.location.href = "/api/backup"; };
  host.querySelector("#restoreFile").onchange = async function (event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    input.value = "";
    var encrypted = /\.kbk$/i.test(file.name);
    if (!(await confirmDialog("Восстановить данные?", "Текущие данные бота будут заменены содержимым файла «" + file.name + "».", "Восстановить", true))) return;
    var password = encrypted ? prompt("Пароль от зашифрованной копии") : "";
    if (encrypted && !password) return toast("Без пароля зашифрованную копию не прочитать", true);
    try {
      // Файл уходит байтами: копия .json.gz и .kbk двоичные, а чтение текстом
      // их портит — сервер потом не может ни распаковать, ни расшифровать.
      var result = await api("/api/restore", {
        method: "POST",
        headers: Object.assign({ "content-type": "application/octet-stream" }, password ? { "x-backup-password": btoa(unescape(encodeURIComponent(password))) } : {}),
        body: file,
      });
      toast(result && result.missingPhotos ? "Данные восстановлены, не найдено фотографий: " + result.missingPhotos : "Данные восстановлены");
      setTimeout(function () { location.reload(); }, 1200);
    } catch (error) { fail(error); }
  };
  host.querySelector("#saveTgBackup").onclick = async function () {
    try {
      await send("/api/telegram-backup", "PUT", { enabled: host.querySelector("#tgBackupOn").checked, password: host.querySelector("#tgBackupPass").value });
      toast("Сохранено"); await reload();
    } catch (error) { fail(error); }
  };
  host.querySelector("#sendTgBackup").onclick = async function () {
    try { await send("/api/telegram-backup/send", "POST", {}); toast("Копия отправлена в Telegram"); await reload(); } catch (error) { fail(error); }
  };
  function checkRow(check) {
    var kind = check.status === "bad" ? "bad" : check.status === "warn" ? "warn" : "ok";
    var mark = check.status === "bad" ? "✕" : check.status === "warn" ? "!" : "✓";
    return '<div class="list-item"><span class="grow"><b>' + esc(check.title) + "</b><br><span class=\"muted small\">" + esc(check.detail) +
      (check.hint ? " · " + esc(check.hint) : "") + '</span></span><span class="chip ' + kind + '">' + mark + "</span></div>";
  }
  host.querySelector("#runSelfCheck").onclick = async function () {
    var body = host.querySelector("#selfCheckBody");
    body.innerHTML = '<p class="muted small">Проверяю…</p>';
    try {
      var report = await api("/api/self-check");
      var summary = report.bad ? "Есть проблемы: " + report.bad : report.warn ? "Стоит посмотреть: " + report.warn : "Всё в порядке";
      body.innerHTML = '<div class="row wrap"><span class="chip ' + (report.bad ? "bad" : report.warn ? "warn" : "ok") + '">' + esc(summary) + "</span>" +
        '<span class="small faint">проверено ' + dateTime(report.checkedAt) + "</span></div>" +
        '<div class="list">' + (report.checks || []).map(checkRow).join("") + "</div>";
    } catch (error) { body.innerHTML = '<div class="chip bad">' + esc(error.message) + "</div>"; }
  };
  host.querySelector("#checkMedia").onclick = async function () {
    var body = host.querySelector("#mediaCheckBody");
    body.innerHTML = '<p class="muted small">Сверяю файлы…</p>';
    try {
      var report = await send("/api/media-check", "POST", {});
      body.innerHTML = mediaCheckHtml(report);
      var restore = body.querySelector("#restoreMedia");
      if (restore) restore.onclick = async function () {
        try {
          var done = await send("/api/media-check", "POST", { restore: true });
          body.innerHTML = mediaCheckHtml(done);
          toast(done.restored ? "Вернули файлов: " + done.restored : "В копии этих файлов нет");
        } catch (error) { fail(error); }
      };
    } catch (error) { body.innerHTML = '<div class="chip bad">' + esc(error.message) + "</div>"; }
  };
  host.querySelector("#clearErrors").onclick = async function () {
    try { await api("/api/errors", { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
  };
  host.querySelector("#resetStats").onclick = async function () {
    if (!(await confirmDialog("Обнулить счётчики?", "Счётчики сообщений начнутся с нуля.", "Обнулить", true))) return;
    try { await send("/api/statistics/reset", "POST", {}); await reload(); } catch (error) { fail(error); }
  };
  host.querySelector("#clearActivity").onclick = async function () {
    if (!(await confirmDialog("Очистить историю активности?", "История действий клиентов будет удалена.", "Очистить", true))) return;
    try { await api("/api/activity", { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
  };
}

function renderAccess(host) {
  var config = state.config, runtime = state.runtime || {}, tunnel = runtime.tunnel || {};
  host.innerHTML = '<div class="grid cols-2">' +
    '<div class="card"><header><h3>Пароль от панели</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="curPass">Текущий пароль</label><input id="curPass" type="password" autocomplete="current-password"></div>' +
      '<div class="field"><label for="newPass">Новый пароль</label><input id="newPass" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="newPass2">Повторите пароль</label><input id="newPass2" type="password" autocomplete="new-password"></div>' +
      '<button class="btn secondary" id="savePassword" type="button">Сменить пароль</button>' +
      '<div class="hint">После смены пароля остальные сеансы завершатся.</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Доступ из интернета</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="remoteOn"' + (config.remoteAccess ? " checked" : "") + "> открыть панель по адресу через Cloudflare</label>" +
      '<div class="field"><label for="tunnelHost">Адрес панели</label><input id="tunnelHost" value="' + esc(config.tunnelHostname || "") + '" placeholder="panel.example.com"></div>' +
      '<div class="field"><label for="tunnelToken">Токен туннеля</label><input id="tunnelToken" type="password" placeholder="' + (config.tunnelTokenSet ? "токен сохранён" : "из панели Cloudflare") + '"></div>' +
      '<button class="btn secondary small" id="saveRemote" type="button">Сохранить</button>' +
      '<div class="small muted">Состояние: ' + esc(tunnel.status || "выключен") + (tunnel.url ? " · " + esc(tunnel.url) : "") + (tunnel.error ? " · " + esc(tunnel.error) : "") + "</div>" +
      '<div class="hint">Вход из интернета требует кода, который приходит в админ-чат Telegram.</div>' +
    "</div></div></div>";

  host.querySelector("#savePassword").onclick = async function () {
    try {
      await send("/api/settings", "PUT", Object.assign(settingsPayload(), {
        currentPassword: host.querySelector("#curPass").value,
        password: host.querySelector("#newPass").value,
        passwordConfirm: host.querySelector("#newPass2").value,
      }));
      toast("Пароль изменён");
      location.reload();
    } catch (error) { fail(error); }
  };
  host.querySelector("#saveRemote").onclick = async function () {
    try {
      await send("/api/remote-access", "PUT", {
        enabled: host.querySelector("#remoteOn").checked,
        tunnelHostname: host.querySelector("#tunnelHost").value,
        tunnelToken: host.querySelector("#tunnelToken").value,
      });
      toast("Сохранено"); await reload();
    } catch (error) { fail(error); }
  };
}

VIEWS.settings = {
  subtitle: function () { return "Подключение, работа с клиентами, данные и доступ"; },
  render: function (host, tab) {
    if (tab === "work") return renderWork(host);
    if (tab === "data") return renderData(host);
    if (tab === "access") return renderAccess(host);
    renderConnection(host);
  },
};
`;

export { SETTINGS_JS };
