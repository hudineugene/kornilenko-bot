// Настройки: подключение к Telegram, работа с клиентами, данные и доступ.

const SETTINGS_JS = String.raw`
var WEEKDAYS = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"]];
var TIME_ZONE_OPTIONS = [["Europe/Madrid", "Испания — материк"], ["Atlantic/Canary", "Испания — Канарские острова"], ["Europe/Kyiv", "Украина"], ["Europe/Moscow", "Москва"], ["UTC", "UTC"]];

// Настройки сохраняются по полям: каждая правка присылает только то, что она
// меняет. Раньше уходил весь набор из состояния панели (с приветствием), а оно
// могло быть старше на 45 секунд, и переключатель «Бот включён» молча
// перезаписывал приветствие, изменённое в другой вкладке.
function settingsPayload() {
  return {};
}

// Виды сообщений администратору в Telegram; «не присылать» есть не у всех — заявки клиентов отключить нельзя.
var NOTIFY_KIND_ROWS = [
  ["inquiry", "Новые заявки и сообщения клиентов", false],
  ["reminder", "Напоминания: клиент без ответа, пора связаться", true],
  ["viewing", "Просмотры на сегодня", true],
  ["digest", "Сводка дня и недельный отчёт", true],
  ["system", "Запуск, остановка и сбои бота", false],
];
function notifyPrefsHtml(prefs) {
  var quiet = prefs.quiet || {};
  return '<div class="card"><header><h3>Звук уведомлений</h3></header><div class="card-body stack">' +
    NOTIFY_KIND_ROWS.map(function (row) {
      var value = (prefs.kinds || {})[row[0]] || "sound";
      return '<div class="field"><label for="np_' + row[0] + '">' + esc(row[1]) + '</label><select id="np_' + row[0] + '" data-np-kind="' + row[0] + '">' +
        '<option value="sound"' + (value === "sound" ? " selected" : "") + ">Со звуком</option>" +
        '<option value="silent"' + (value === "silent" ? " selected" : "") + ">Без звука</option>" +
        (row[2] ? '<option value="off"' + (value === "off" ? " selected" : "") + ">Не присылать</option>" : "") + "</select></div>";
    }).join("") +
    '<label class="check"><input type="checkbox" id="npQuiet"' + (quiet.enabled ? " checked" : "") + "> Тихие часы: в это время всё приходит без звука</label>" +
    '<div class="grid cols-2"><div class="field"><label for="npFrom">С</label><input type="time" id="npFrom" value="' + esc(quiet.from || "22:00") + '"></div><div class="field"><label for="npTo">До</label><input type="time" id="npTo" value="' + esc(quiet.to || "08:00") + '"></div></div>' +
    '<div class="hint">Сообщения не пропадают: в тихие часы они приходят в чат, но телефон молчит.</div>' +
  "</div></div>";
}
function notifyPrefsNow() {
  var prefs = state.config.notifyPrefs || {}, quiet = prefs.quiet || {}, kinds = {};
  NOTIFY_KIND_ROWS.forEach(function (row) { kinds[row[0]] = (prefs.kinds || {})[row[0]] || "sound"; });
  return { kinds: kinds, quiet: { enabled: Boolean(quiet.enabled), from: quiet.from || "22:00", to: quiet.to || "08:00" } };
}
function notifyPrefsFrom(host) {
  var kinds = {};
  host.querySelectorAll("[data-np-kind]").forEach(function (select) { kinds[select.dataset.npKind] = select.value; });
  return { kinds: kinds, quiet: { enabled: host.querySelector("#npQuiet").checked, from: host.querySelector("#npFrom").value, to: host.querySelector("#npTo").value } };
}

function renderConnection(host) {
  var config = state.config, bot = state.bot || {};
  host.innerHTML = '<div class="grid cols-2"><div class="stack">' +
    '<div class="card"><header><h3>Админ-чат в Telegram</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="setAdminChat">Telegram-чат администратора</label><input id="setAdminChat" value="' + esc(config.adminChatId || "") + '" placeholder="узнать: напишите боту /myid"></div>' +
      '<div class="row wrap"><button class="btn secondary small" id="testAdmin" type="button">Отправить тест</button>' +
        (config.adminNotificationVerifiedAt ? '<span class="chip ok">Проверен ' + dateShort(config.adminNotificationVerifiedAt) + "</span>" : chip("warn", 'Не проверен')) + "</div>" +
      '<div class="field"><label for="setNotify">Что присылать в Telegram</label><select id="setNotify">' +
        '<option value="inquiries"' + (config.notifyMode !== "all" ? " selected" : "") + ">Только заявки клиентов</option>" +
        '<option value="all"' + (config.notifyMode === "all" ? " selected" : "") + ">Все действия клиентов</option></select></div>" +
      '<label class="check"><input type="checkbox" id="setStatusNotices"' + (config.statusNotices !== false ? " checked" : "") + "> Сообщать о запуске и остановке бота</label>" +
    "</div></div>" + notifyPrefsHtml(config.notifyPrefs || {}) +
  "</div>" +
  '<div class="stack"><div class="card"><header><h3>Менеджеры</h3><div class="actions"><button class="btn secondary small" id="addManager" type="button">＋ Менеджер</button></div></header>' +
    '<div class="card-body stack"><div class="field"><label for="adminName">Как зовут главного администратора</label><input id="adminName" value="' + esc(config.adminName || "") + '" placeholder="Администратор"></div>' +
    '<div id="managerList" class="stack"></div>' +
    '<div class="hint">Менеджер открывает бота, отправляет /myid и присылает номер. Заявки приходят всем, отвечает любой.</div>' +
    '<div class="hint">Всё на этом экране — чат администратора, имя, менеджеры — сохраняется одной кнопкой «Сохранить» в полосе снизу.</div></div></div>' +
  '</div></div>';

  var managers = (config.managers || []).slice();
  // Один экран — одна полоса и одно сохранение. Раньше чат администратора
  // сохранялся полосой снизу, а менеджеры — своей кнопкой, и правка одного не
  // касалась другого.
  var watcher = watchForm(host, async function () {
    var adminChatId = host.querySelector("#setAdminChat").value.trim();
    var notifyMode = host.querySelector("#setNotify").value;
    var statusNotices = host.querySelector("#setStatusNotices").checked;
    var notifyPrefs = notifyPrefsFrom(host);
    var prefsChanged = JSON.stringify(notifyPrefs) !== JSON.stringify(notifyPrefsNow());
    var next = managers.filter(function (manager) { return manager.name || manager.chatId; });
    var adminName = host.querySelector("#adminName").value;
    var settingsChanged = adminChatId !== String(state.config.adminChatId || "") || notifyMode !== (state.config.notifyMode === "all" ? "all" : "inquiries") || statusNotices !== (state.config.statusNotices !== false) || prefsChanged;
    var chatChanged = adminChatId !== String(state.config.adminChatId || "");
    var before = JSON.stringify((state.config.managers || []).map(function (manager) { return [manager.name, manager.chatId]; }));
    var after = JSON.stringify(next.map(function (manager) { return [manager.name, manager.chatId]; }));
    var managersChanged = before !== after;
    var teamChanged = managersChanged || adminName !== String(state.config.adminName || "");
    // Смена чата администратора отдаёт заявки в другой Telegram-чат, а менеджер
    // получает заявки и отвечает от имени компании: спрашиваем текущий пароль —
    // один раз на обе правки.
    var password = "";
    if (chatChanged || managersChanged) {
      var reasons = [];
      if (chatChanged) reasons.push("заявки клиентов будут приходить в другой чат Telegram");
      if (managersChanged) reasons.push("менеджер получает заявки клиентов и отвечает от имени компании");
      password = await askPassword(chatChanged && managersChanged ? "Сохранить чат и менеджеров?" : chatChanged ? "Сменить чат администратора?" : "Изменить список менеджеров?", "Нужен текущий пароль панели: " + reasons.join("; ") + ".");
      if (!password) throw new Error("Сохранение отменено");
    }
    if (settingsChanged) {
      var payload = Object.assign(settingsPayload(), { adminChatId: adminChatId, notifyMode: notifyMode, statusNotices: statusNotices, notifyPrefs: notifyPrefs });
      if (chatChanged) payload.currentPassword = password;
      await send("/api/settings", "PUT", payload);
    }
    if (teamChanged) await send("/api/managers", "PUT", { adminName: adminName, managers: next, currentPassword: password });
  }, "Настройки команды изменены");

  host.querySelector("#testAdmin").onclick = async function () {
    try { await send("/api/admin-notification/test", "POST", { chatId: host.querySelector("#setAdminChat").value.trim() }); toast("Сообщение отправлено в Telegram"); await reload(); } catch (error) { fail(error); }
  };

  function drawManagers() {
    var list = host.querySelector("#managerList");
    list.innerHTML = managers.length ? managers.map(function (manager, index) {
      return '<div class="row" data-manager="' + index + '"><input class="grow" data-field="name" value="' + esc(manager.name || "") + '" placeholder="Имя">' +
        '<input class="field-sm" data-field="chatId" value="' + esc(manager.chatId || "") + '" placeholder="Telegram-чат">' +
        (manager.verifiedAt ? chip("ok", 'Ок') : manager.id ? '<button class="btn ghost small" data-test="' + esc(manager.id) + '" type="button">Тест</button>' : "") +
        '<button class="btn ghost small" data-drop="' + index + '" type="button">✕</button></div>';
    }).join("") : '<span class="small muted">Менеджеров нет — заявки приходят только администратору.</span>';
    list.querySelectorAll("[data-drop]").forEach(function (button) {
      button.onclick = function () { managers.splice(Number(button.dataset.drop), 1); drawManagers(); watcher.check(); };
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
  host.querySelector("#addManager").onclick = function () { managers.push({ name: "", chatId: "" }); drawManagers(); watcher.check(); };
}

// «Подключение к Telegram» — вкладка «Telegram и приложение» в «Настройках»: токен бота, включение и
// автозапуск нужны редко, и на рабочем экране «Настройки → Команда и доступ» им не место.
function renderTelegramConnection(host) {
  var config = state.config, bot = state.bot || {}, mini = config.miniApp || {};
  host.innerHTML = '<div class="grid cols-2"><div class="stack">' +
    '<div class="card"><header><h3>Бот</h3></header><div class="card-body stack">' +
      '<label class="switch"><input type="checkbox" id="setActive"' + (config.active ? " checked" : "") + '><span class="track"></span><span>Бот ' + (config.active ? "включён" : "выключен") + "</span></label>" +
      '<div class="small muted">' + esc(bot.firstName || "Бот") + (bot.username ? " · @" + esc(bot.username) : "") + " · " + esc(connectionText()) + "</div>" +
      '<div class="field"><label for="setToken">Новый токен из BotFather</label><input id="setToken" placeholder="оставьте пустым, чтобы не менять" autocomplete="off"></div>' +
      '<div class="field"><label for="setTokenPass">Текущий пароль панели</label><input id="setTokenPass" type="password" placeholder="нужен для смены токена" autocomplete="current-password"></div>' +
      '<div class="row wrap"><button class="btn secondary small" id="testToken" type="button">Проверить токен</button>' +
        '<button class="btn small" id="saveToken" type="button">Сменить токен</button><span id="tokenResult" class="small muted"></span></div>' +
      '<div class="hint">Токен меняется отдельной кнопкой и только по текущему паролю панели.</div>' +
    "</div></div>" +
  "</div>" +
  '<div class="stack">' +
    '<div class="card"><header><h3>Надёжный запуск</h3></header><div class="card-body stack">' +
      '<div class="row"><span class="dot" id="autostartDot"></span><span class="grow" id="autostartText">Проверяем автозапуск…</span></div>' +
      '<div class="hint">Windows запустит bot.exe после входа в систему и повторит запуск, если программа завершится с ошибкой.</div>' +
      '<button class="btn secondary small" id="autostartButton" type="button" disabled>Настроить</button>' +
    '</div></div>' +
    '<div class="card"><header><h3>Приложение в Telegram</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="appOn"' + (mini.enabled ? " checked" : "") + '> Показывать клиентам приложение: каталог, запись на просмотр, калькулятор</label>' +
      '<label class="check"><input type="checkbox" id="appOnly"' + (mini.appOnly ? " checked" : "") + '> Только приложение: бот отправляет клиентов в приложение, старые разделы не показывает</label>' +
      '<div class="field"><label for="appUrl">Адрес приложения</label><input id="appUrl" value="' + esc(mini.url || "") + '" placeholder="https://app.example.com" autocomplete="off"></div>' +
      '<div class="row wrap"><button class="btn secondary small" id="appCheck" type="button">Проверить адрес</button>' +
        '<button class="btn secondary small" id="appSave" type="button">Сохранить</button><span id="appResult" class="small muted"></span></div>' +
      '<div class="hint">Рядом с полем ввода в чате появится кнопка «Каталог». Адрес должен начинаться с https:// и вести на этот же сервер: как его завести — в инструкции «Приложение в Telegram».</div>' +
    '</div></div></div></div>';

  // Переключатель включает и выключает бота сразу, отдельной кнопки нет.
  host.querySelector("#setActive").onchange = function () { return setBotActive(this); };
  host.querySelector("#saveToken").onclick = async function () {
    var token = host.querySelector("#setToken").value.trim();
    var password = host.querySelector("#setTokenPass").value;
    if (!token) return toast("Введите новый токен", true);
    if (!password) return toast("Введите текущий пароль панели", true);
    if (!(await confirmDialog("Сменить токен бота?", "Бот переподключится к Telegram с новым токеном. Прежние ссылки на загруженные фотографии перестанут действовать, бот загрузит их заново.", "Сменить", true))) return;
    var button = this;
    button.disabled = true;
    try {
      await send("/api/settings", "PUT", Object.assign(settingsPayload(), { token: token, currentPassword: password }));
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
  host.querySelector("#appCheck").onclick = async function () {
    var result = host.querySelector("#appResult");
    result.textContent = "Проверяем…";
    try {
      var answer = await send("/api/miniapp/check", "POST", { url: host.querySelector("#appUrl").value });
      result.textContent = answer.ok ? "Адрес работает: приложение открывается" : answer.error;
    } catch (error) { result.textContent = error.message; }
  };
  host.querySelector("#appSave").onclick = async function () {
    var button = this;
    button.disabled = true;
    try {
      var answer = await send("/api/miniapp", "PUT", { enabled: host.querySelector("#appOn").checked, appOnly: host.querySelector("#appOnly").checked, url: host.querySelector("#appUrl").value });
      toast(answer.buttonError ? "Сохранено, но кнопку в Telegram поставить не удалось: " + answer.buttonError : answer.miniApp.enabled ? "Приложение включено" : "Приложение выключено");
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
}

function renderWork(host) {
  var hours = state.config.workingHours || {}, slots = state.config.viewingSlots || {}, calculator = state.config.calculator || {};
  var engagement = state.engagement || {};
  host.innerHTML = '<div class="grid cols-2">' +
    '<h2 class="group-title">Когда мы работаем</h2>' +
    '<div class="card"><header><h3>Рабочее время</h3></header><div class="card-body stack" id="hoursCard">' +
      '<label class="check"><input type="checkbox" id="hoursOn"' + (hours.enabled ? " checked" : "") + "> Предупреждать клиентов о нерабочем времени</label>" +
      '<div class="field"><label for="businessTimeZone">Часовой пояс компании</label><select id="businessTimeZone">' + TIME_ZONE_OPTIONS.map(function (option) {
        return '<option value="' + option[0] + '"' + ((state.config.timeZone || "Europe/Madrid") === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
      }).join("") + '</select><div class="hint">По этому времени работают расписания, напоминания и отложенные публикации.</div></div>' +
      '<div class="row"><div class="field"><label for="hoursFrom">С</label><input id="hoursFrom" type="time" value="' + esc(hours.from || "09:00") + '"></div>' +
      '<div class="field"><label for="hoursTo">До</label><input id="hoursTo" type="time" value="' + esc(hours.to || "19:00") + '"></div></div>' +
      '<div class="field"><span class="field-label">Рабочие дни</span><div class="row wrap">' + WEEKDAYS.map(function (day) {
        return '<label class="check"><input type="checkbox" data-day="' + day[0] + '"' + ((hours.days || []).indexOf(day[0]) >= 0 ? " checked" : "") + "> " + day[1] + "</label>";
      }).join("") + "</div></div>" +
      '<div class="field"><label for="replyMinutes">Обычно отвечаем за</label><select id="replyMinutes">' +
        [[0, "не обещать срок"], [5, "5 минут"], [10, "10 минут"], [15, "15 минут"], [30, "30 минут"], [60, "час"], [120, "2 часа"], [240, "4 часа"]].map(function (option) {
          return '<option value="' + option[0] + '"' + (Number(hours.replyMinutes || 0) === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
        }).join("") + '</select><div class="hint">Эту строку клиент видит на экране связи и после заявки. В нерабочее время вместо неё идёт текст ниже. Обещайте только то, что выдерживаете.</div></div>' +
      '<div class="hint">Сообщение, которое клиент видит в нерабочее время, — во вкладке «Тексты и контакты» → «Контакты».</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Свободное время для просмотров</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="slotsOn"' + (slots.enabled ? " checked" : "") + "> Предлагать клиенту свободные слоты</label>" +
      '<div class="field"><span class="field-label">Дни</span><div class="row wrap">' + WEEKDAYS.map(function (day) {
        return '<label class="check"><input type="checkbox" data-slotday="' + day[0] + '"' + ((slots.days || []).indexOf(day[0]) >= 0 ? " checked" : "") + "> " + day[1] + "</label>";
      }).join("") + "</div></div>" +
      '<div class="field"><label for="slotTimes">Время просмотров через запятую</label><input id="slotTimes" value="' + esc((slots.times || []).join(", ")) + '" placeholder="10:00, 12:00, 17:00"></div>' +
      '<div class="row"><div class="field"><label for="slotDays">На сколько дней вперёд</label><input id="slotDays" type="number" min="1" max="30" value="' + esc(slots.daysAhead || 7) + '"></div>' +
      '<div class="field"><label for="slotPer">Записей на одно время</label><input id="slotPer" type="number" min="1" max="10" value="' + esc(slots.perSlot || 1) + '"></div></div>' +
    "</div></div>" +
    '<h2 class="group-title">Напоминания и сообщения клиентам</h2>' +
    '<div class="card"><header><h3>Напоминания</h3></header><div class="card-body stack">' +
      '<div class="field"><label for="remindHours">Напомнить о заявке без ответа</label><select id="remindHours">' +
        [[0, "не напоминать"], [1, "через 1 час"], [2, "через 2 часа"], [4, "через 4 часа"], [8, "через 8 часов"], [24, "через сутки"]].map(function (option) {
          return '<option value="' + option[0] + '"' + (Number(state.config.reminderHours) === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
        }).join("") + "</select></div>" +
      '<div class="hint">Напоминания и сводки приходят только в рабочее время, если оно включено.</div>' +
      '<div class="field"><label for="retentionMonths">Сколько хранить данные клиента</label><select id="retentionMonths">' +
        [[0, "без срока"], [12, "12 месяцев"], [18, "18 месяцев"], [24, "24 месяца"], [36, "36 месяцев"], [48, "48 месяцев"]].map(function (option) {
          return '<option value="' + option[0] + '"' + (Number(state.config.retentionMonths) === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
        }).join("") + "</select></div>" +
      hintMore("Отсчёт от последней заявки клиента. Срок нужно указать в политике конфиденциальности.", "Раз в сутки бот удаляет данные тех, от кого давно ничего не было, и сообщает об этом. Не удаляются те, кто ждёт ответа, у кого впереди просмотр или стоит напоминание.") +
    "</div></div>" +
    // Автоматические сообщения: выключены, пока сами не включите.
    '<div class="card"><header><h3>Сообщения клиентам сами</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="digestOn"' + (engagement.digest ? " checked" : "") + '> Раз в неделю присылать «Что нового»: новые объекты и снижения цен</label>' +
      '<label class="check"><input type="checkbox" id="comebackOn"' + (engagement.comeback ? " checked" : "") + '> Напоминать тем, кто смотрел объекты и замолчал на 5–10 дней, если появилось подходящее</label>' +
      '<label class="check"><input type="checkbox" id="planReminderOn"' + (engagement.planReminder ? " checked" : "") + '> Напоминать о «Плане покупки» тем, кто его начал и замолчал на неделю (не чаще раза в две недели)</label>' +
      hintMore("Получат: " + num(engagement.audience || 0) + " — те, кто согласился на «Новости и акции». Объектов в продаже сейчас " + num(engagement.activeObjects || 0) + ". Включайте на живом каталоге.", "Пустое сообщение не отправляется, чаще раза в неделю дайджест не приходит, возврат — не чаще раза в три недели; каждое выключается одной кнопкой. На демо-объектах слать нечего.") +
    "</div></div>" +
    '<h2 class="group-title">Расчёт для клиента</h2>' +
    '<div class="card"><header><h3>Калькулятор покупки</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="calcOn"' + (calculator.enabled ? " checked" : "") + "> Показывать расчёт расходов в карточке</label>" +
      // Ставки задаёт бухгалтер, меняются редко: под спойлером, чтобы не занимать экран.
      '<details class="editor-section rates-details"><summary><b>Ставки налогов и сборов</b><span>ITP, IVA, гербовый сбор</span></summary><div class="editor-section-body stack">' +
      '<div class="grid cols-2">' +
        ["resaleTaxPercent:Налог, вторичка (ITP) %", "newBuildTaxPercent:Налог, новостройка (IVA) %", "businessTaxPercent:Налог, участок и коммерция (IVA) %", "stampDutyPercent:Гербовый сбор (AJD) %", "otherCostsPercent:Прочие расходы %", "downPaymentPercent:Первый взнос %", "interestPercent:Ставка ипотеки %", "years:Срок ипотеки, лет"].map(function (pair) {
          var parts = pair.split(":");
          return '<div class="field"><label>' + parts[1] + '</label><input data-calc="' + parts[0] + '" type="number" step="0.1" value="' + esc(calculator[parts[0]] != null ? calculator[parts[0]] : "") + '"></div>';
        }).join("") +
      "</div>" +
      hintMore("Ставки перед включением калькулятора сверьте с гестором.", "Какую ставку бот применяет: квартира, дом или вилла со статусом «новостройка» либо «строится» — IVA и гербовый сбор; те же объекты в остальных состояниях (включая «новое») — ITP; участок и коммерция — IVA как при продаже от компании, о чём клиент видит приписку.") +
      '</div></details>' +
    "</div></div>" +
    "</div>";

  bindLanguageTabs(host);
  // Одна полоса сохранения на весь экран: раньше под каждой карточкой была своя
  // кнопка «Сохранить», и правка в одной карточке терялась, если нажать соседнюю.
  async function saveHours() {
    await send("/api/working-hours", "PUT", {
      enabled: host.querySelector("#hoursOn").checked,
      timeZone: host.querySelector("#businessTimeZone").value,
      from: host.querySelector("#hoursFrom").value,
      to: host.querySelector("#hoursTo").value,
      days: Array.from(host.querySelectorAll("[data-day]")).filter(function (box) { return box.checked; }).map(function (box) { return Number(box.dataset.day); }),
      replyMinutes: host.querySelector("#replyMinutes").value,
      note: (state.config.workingHours || {}).note || {},
    });
  }
  async function saveSlots() {
    await send("/api/viewing-slots", "PUT", {
      enabled: host.querySelector("#slotsOn").checked,
      days: Array.from(host.querySelectorAll("[data-slotday]")).filter(function (box) { return box.checked; }).map(function (box) { return Number(box.dataset.slotday); }),
      times: host.querySelector("#slotTimes").value,
      daysAhead: host.querySelector("#slotDays").value,
      perSlot: host.querySelector("#slotPer").value,
    });
  }
  async function saveCalc() {
    var payload = { enabled: host.querySelector("#calcOn").checked };
    host.querySelectorAll("[data-calc]").forEach(function (input) { payload[input.dataset.calc] = input.value; });
    await send("/api/calculator", "PUT", payload);
  }
  async function saveReminders() {
    await send("/api/settings", "PUT", Object.assign(settingsPayload(), {
      reminderHours: Number(host.querySelector("#remindHours").value),
      retentionMonths: Number(host.querySelector("#retentionMonths").value),
    }));
  }
  async function saveEngagement() {
    await send("/api/engagement", "PUT", { digest: host.querySelector("#digestOn").checked, comeback: host.querySelector("#comebackOn").checked, planReminder: host.querySelector("#planReminderOn").checked });
  }
  watchForm(host, async function () {
    await saveHours();
    await saveSlots();
    await saveCalc();
    await saveReminders();
    await saveEngagement();
  }, "Настройки компании изменены");
}

function mediaCheckHtml(report) {
  var missing = report.missing || [];
  var rows = '<div class="row wrap">' +
    '<span class="chip ' + (missing.length ? "bad" : "ok") + '">' + (missing.length
      ? "нет файлов: " + missing.length + (report.missingRefs > missing.length ? " (ссылок на них: " + report.missingRefs + ")" : "")
      : "все файлы на месте") + "</span>" +
    '<span class="chip">Картинок в данных: ' + Number(report.total || 0) + "</span>" +
    (report.orphans ? '<span class="chip warn">Лишних файлов: ' + Number(report.orphans) + "</span>" : "") +
    (typeof report.restored === "number" && report.restored ? '<span class="chip ok">Вернули из копии: ' + report.restored + "</span>" : "") +
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

// Журнал ошибок: подряд идущие одинаковые (тот же раздел и то же сообщение) — одна строка
// «×5, последняя 16:37». Список идёт от новых к старым, поэтому первая в группе — последняя по времени.
function groupErrors(errors) {
  var groups = [];
  (errors || []).forEach(function (error) {
    var last = groups[groups.length - 1];
    if (last && (last.area || last.context) === (error.area || error.context) && last.message === error.message) last.count += 1;
    else groups.push(Object.assign({}, error, { count: 1 }));
  });
  return groups;
}

// Вкладка «Копии»: резервная копия, копия в Telegram, счётчики.
function renderDataCopies(host) {
  var backup = state.config.telegramBackup || {};
  host.innerHTML = '<div class="grid cols-2">' +
    '<div class="card"><header><h3>Резервная копия</h3></header><div class="card-body stack">' +
      '<p class="small muted">Копия содержит объекты, тексты, клиентов, заявки и фотографии. Храните её в надёжном месте.</p>' +
      '<div class="row wrap"><button class="btn secondary" id="downloadBackup" type="button">⬇ Скачать копию</button>' +
      '<label class="btn ghost clickable-area">⬆ Восстановить<input type="file" id="restoreFile" accept=".kbz,.json,.gz,.kbk,application/json,application/gzip,application/octet-stream" class="hidden"></label></div>' +
      '<div class="hint">Подходит любая копия, сделанная ботом: скачанная этой кнопкой, из папки <b>backups</b> рядом с ботом или присланная в Telegram (для неё понадобится пароль копии). Ежедневная копия создаётся сама. Перед восстановлением прежние данные бот складывает в ту же папку — вернуться будет куда.</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Копия в Telegram</h3></header><div class="card-body stack"><div class="stack" id="tgBackupForm">' +
      '<label class="check"><input type="checkbox" id="tgBackupOn"' + (backup.enabled ? " checked" : "") + "> Присылать зашифрованную копию раз в неделю</label>" +
      '<div class="field"><label for="tgBackupPass">Пароль шифрования</label><input id="tgBackupPass" type="password" autocomplete="new-password" placeholder="' + (backup.passwordSet ? "пароль сохранён" : "минимум 10 символов") + '"></div>' +
      '<div class="field"><label for="tgBackupPass2">Повторите пароль шифрования</label><input id="tgBackupPass2" type="password" autocomplete="new-password" placeholder="' + (backup.passwordSet ? "только если меняете пароль" : "тот же пароль ещё раз") + '"></div>' +
      '</div><div class="row wrap"><button class="btn ghost small" id="sendTgBackup" type="button">Отправить сейчас</button></div>' +
      (backup.lastSentAt ? '<div class="small muted">Последняя копия: ' + dateTime(backup.lastSentAt) + "</div>" : "") +
      (backup.lastError ? '<div class="banner bad">' + esc(backup.lastError) + "</div>" : "") +
      '<div class="hint">Файл .kbk можно восстановить здесь же — понадобится этот пароль.</div>' +
    "</div></div>" +
    '<div class="card"><header><h3>Статистика и история</h3></header><div class="card-body stack">' +
      '<div class="small muted">Сообщений получено: ' + num((state.stats || {}).messagesReceived) + " · отправлено: " + num((state.stats || {}).messagesSent) + "</div>" +
      '<div class="row wrap"><button class="btn ghost small" id="resetStats" type="button">Обнулить счётчики</button>' +
      '<button class="btn ghost small" id="clearActivity" type="button">Очистить историю активности</button></div>' +
      '<div class="hint">Заявки и клиенты при этом не удаляются.</div>' +
    "</div></div>" +
    "</div>";

  host.querySelector("#downloadBackup").onclick = async function () {
    var password = await askPassword("Скачать копию данных?", "В копии есть токен бота и данные клиентов, поэтому нужен текущий пароль панели.");
    if (!password) return;
    try {
      var pass = await send("/api/backup/ticket", "POST", { currentPassword: password });
      window.location.href = "/api/backup?ticket=" + encodeURIComponent(pass.ticket);
    } catch (error) { fail(error); }
  };
  host.querySelector("#restoreFile").onchange = async function (event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    input.value = "";
    var encrypted = /\.kbk$/i.test(file.name);
    if (!(await confirmDialog("Восстановить данные?", "Текущие данные бота будут заменены содержимым файла «" + file.name + "».", "Восстановить", true))) return;
    var current = await askPassword("Восстановить данные?", "Текущие данные будут заменены. Для этого нужен текущий пароль панели.");
    if (!current) return;
    // Своим окном с полем пароля: prompt() показывает набранное открытым текстом
    // и остаётся в истории браузера.
    var password = encrypted
      ? await askPassword("Пароль зашифрованной копии", "Файл «" + file.name + "» зашифрован. Введите пароль, которым он защищён.", "Пароль копии")
      : "";
    if (encrypted && !password) return toast("Без пароля зашифрованную копию не прочитать", true);
    try {
      // Файл уходит байтами: копия .json.gz и .kbk двоичные, а чтение текстом
      // их портит — сервер потом не может ни распаковать, ни расшифровать.
      var result = await api("/api/restore", {
        method: "POST",
        headers: Object.assign(
          { "content-type": "application/octet-stream", "x-current-password": btoa(unescape(encodeURIComponent(current))) },
          password ? { "x-backup-password": btoa(unescape(encodeURIComponent(password))) } : {},
        ),
        body: file,
      });
      var parts = ["Данные восстановлены"];
      if (result && result.restoredPhotos) parts.push("вернули фотографий: " + result.restoredPhotos);
      if (result && result.missingPhotos) parts.push("не найдено фотографий: " + result.missingPhotos);
      if (result && result.snapshot) parts.push("прежние данные сохранены: " + result.snapshot);
      toast(parts.join(". "));
      setTimeout(function () { location.reload(); }, 1200);
    } catch (error) { fail(error); }
  };
  // Поля копии в Telegram — форма: правка попадает в полосу «Сохранить» внизу.
  // Включение копии и смена её пароля отправляют все данные из бота: сервер требует
  // текущий пароль панели и повтор пароля копии — без них сохранить было нельзя.
  watchForm(host.querySelector("#tgBackupForm"), async function () {
    var enabled = host.querySelector("#tgBackupOn").checked;
    var pass = host.querySelector("#tgBackupPass").value;
    var confirmField = host.querySelector("#tgBackupPass2");
    if (pass && pass !== confirmField.value) {
      fieldError(confirmField, "Пароли копии не совпадают");
      throw new Error("Пароли копии не совпадают");
    }
    var payload = { enabled: enabled, password: pass, passwordConfirm: confirmField.value };
    if (enabled || pass) {
      var current = await askPassword("Копия в Telegram", "Копия отправляет из бота все данные: объекты, клиентов и заявки. Для этого нужен текущий пароль панели.");
      if (!current) throw new Error("Сохранение отменено");
      payload.currentPassword = current;
    }
    await send("/api/telegram-backup", "PUT", payload);
  }, "Настройки копии в Telegram изменены");
  host.querySelector("#sendTgBackup").onclick = async function () {
    try { await send("/api/telegram-backup/send", "POST", {}); toast("Копия отправлена в Telegram"); await reload(); } catch (error) { fail(error); }
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

// Вкладка «Проверка и журнал»: самопроверка, файлы картинок, журнал ошибок.
function renderDataCheck(host) {
  host.innerHTML = '<div class="grid cols-2">' +
    '<div class="card"><header><h3>Самопроверка</h3><div class="actions"><button class="btn secondary small" id="runSelfCheck" type="button">Проверить сейчас</button></div></header>' +
      '<div class="card-body stack" id="selfCheckBody"><p class="small muted">Проверяет токен и связь, чат администратора, видимость каталога у клиентов, файлы картинок и версию данных. Ничего не меняет.</p></div>' +
    "</div>" +
    '<div class="card"><header><h3>Файлы картинок</h3><div class="actions"><button class="btn secondary small" id="checkMedia" type="button">Проверить файлы</button></div></header>' +
      '<div class="card-body stack" id="mediaCheckBody"><p class="small muted">Сверяет картинки в данных с файлами в папке bot-media. Потерянные можно вернуть из ежедневной копии.</p></div>' +
    "</div>" +
    '<div class="card"><header><h3>Журнал ошибок</h3><div class="actions"><button class="btn ghost small" id="clearErrors" type="button">Очистить</button></div></header>' +
      ((state.errors || []).length ? '<div class="list">' + groupErrors(state.errors).slice(0, 20).map(function (error) {
        return '<div class="list-item"><span class="grow"><b>' + esc(error.area || error.context || "Ошибка") + '</b>' + (error.count > 1 ? ' <span class="chip warn">×' + error.count + "</span>" : "") + '<br><span class="small muted">' + esc(error.message) + "</span></span>" +
          '<span class="small muted nowrap">' + (error.count > 1 ? "последняя " : "") + dateTime(error.createdAt || error.at) + "</span></div>";
      }).join("") + "</div>" : '<div class="empty"><b>Ошибок нет</b></div>') +
    "</div>" +
    "</div>";

  function checkRow(check) {
    var kind = check.status === "bad" ? "bad" : check.status === "warn" ? "warn" : "ok";
    var mark = iconSpan(check.status === "bad" ? "close" : check.status === "warn" ? "warning" : "check");
    return '<div class="list-item"><span class="grow"><b>' + esc(check.title) + "</b><br><span class=\"muted small\">" + esc(check.detail) +
      (check.hint ? " · " + esc(check.hint) : "") + '</span></span><span class="chip ' + kind + '">' + mark + "</span></div>";
  }
  host.querySelector("#runSelfCheck").onclick = async function () {
    var body = host.querySelector("#selfCheckBody");
    body.innerHTML = '<p class="small muted">Проверяю…</p>';
    try {
      var report = await api("/api/self-check");
      var summary = report.bad ? "Есть проблемы: " + report.bad : report.warn ? "Стоит посмотреть: " + report.warn : "Всё в порядке";
      body.innerHTML = '<div class="row wrap"><span class="chip ' + (report.bad ? "bad" : report.warn ? "warn" : "ok") + '">' + esc(summary) + "</span>" +
        '<span class="small muted">проверено ' + dateTime(report.checkedAt) + "</span></div>" +
        '<div class="list">' + (report.checks || []).map(checkRow).join("") + "</div>";
    } catch (error) { body.innerHTML = '<div class="banner bad">' + esc(error.message) + "</div>"; }
  };
  host.querySelector("#checkMedia").onclick = async function () {
    var body = host.querySelector("#mediaCheckBody");
    body.innerHTML = '<p class="small muted">Сверяю файлы…</p>';
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
    } catch (error) { body.innerHTML = '<div class="banner bad">' + esc(error.message) + "</div>"; }
  };
  host.querySelector("#clearErrors").onclick = async function () {
    try { await api("/api/errors", { method: "DELETE" }); await reload(); } catch (error) { fail(error); }
  };
}

// Карточка «Проекты из файла»: живёт на вкладке «Объекты → Загрузка».
function renderFileImport(host) {
  var modeText = {
    partObjects: "Проекты из файла заменят одноимённые на сервере целиком: тексты, цену, статус и фото. Если в файле у проекта нет фото, прежние останутся.",
    partPhotos: "Изменятся только фотографии у проектов, которые уже есть. Новые проекты не добавляются, остальное не меняется.",
    partSea: "Изменится только расстояние до пляжа у проектов, которые уже есть. Новые проекты не добавляются, остальное не меняется.",
    partNone: "Проекты не изменятся: берётся только то, что отмечено ниже в «Дополнительно».",
  };
  function mode(id, title, hint, checked) {
    return '<label class="check mode-row"><input type="radio" name="fileMode" id="' + id + '"' + (checked ? " checked" : "") + '><span><b>' + title + '</b><span class="hint">' + hint + "</span></span></label>";
  }
  host.innerHTML = '<div class="card"><header><h3>Проекты из файла</h3></header><div class="card-body stack">' +
      '<p class="hint">Файл каталога: выберите, что с ним сделать, и загрузите. Клиенты, заявки, пароль, токен и админ-чат не меняются никогда.</p>' +
      '<div class="field"><span class="field-label">Что сделать с проектами</span><div class="stack">' +
        mode("partObjects", "Загрузить проекты целиком", "Новые добавятся, у существующих (по номеру) всё станет как в файле.", true) +
        mode("partPhotos", "Обновить только фотографии", "У проектов, которые уже есть. Тексты, цена и статус останутся.", false) +
        mode("partSea", "Обновить только расстояние до пляжа", "У проектов, которые уже есть. Всё остальное останется.", false) +
        mode("partNone", "Проекты не трогать", "Взять из файла только дополнительное ниже.", false) +
      "</div></div>" +
      '<div class="field"><span class="field-label">Дополнительно из файла</span><div class="stack">' +
        '<label class="check"><input type="checkbox" id="partContacts"> Контакты и фото менеджера</label>' +
        '<label class="check"><input type="checkbox" id="partAbout"> «О компании», цифры доверия и отзывы</label>' +
        '<label class="check"><input type="checkbox" id="partTexts"> Тексты бота: приветствие и фото, меню, гид «Как купить», план покупки, автоответы, шаблоны</label>' +
        '<label class="check"><input type="checkbox" id="partSettings"> Настройки: калькулятор, рабочее время, окна просмотров, часовой пояс</label>' +
      "</div></div>" +
      '<div class="banner warn" id="partsWarn" role="note"></div>' +
      '<div class="row wrap"><label class="btn ghost clickable-area">⬆ Выбрать файл каталога<input type="file" id="partsFile" accept=".kbz,.json,.gz,application/json,application/gzip,application/octet-stream" class="hidden"></label></div>' +
    "</div></div>";

  function showModeText() {
    var picked = Object.keys(modeText).filter(function (id) { return host.querySelector("#" + id).checked; })[0] || "partObjects";
    host.querySelector("#partsWarn").textContent = modeText[picked];
  }
  Object.keys(modeText).forEach(function (id) { host.querySelector("#" + id).onchange = showModeText; });
  showModeText();
  host.querySelector("#partsFile").onchange = async function (event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    input.value = "";
    var parts = [];
    if (host.querySelector("#partObjects").checked) parts.push("objects");
    if (host.querySelector("#partPhotos").checked) parts.push("photos");
    if (host.querySelector("#partSea").checked) parts.push("sea");
    if (host.querySelector("#partContacts").checked) parts.push("contacts");
    if (host.querySelector("#partAbout").checked) parts.push("about");
    if (host.querySelector("#partTexts").checked) parts.push("texts");
    if (host.querySelector("#partSettings").checked) parts.push("settings");
    if (!parts.length) return toast("Отметьте, что взять из файла", true);
    if (!(await confirmDialog("Взять данные из файла?", "Из файла «" + file.name + "»: " + host.querySelector("#partsWarn").textContent, "Взять", false))) return;
    var current = await askPassword("Взять данные из файла", "Нужен текущий пароль панели.");
    if (!current) return;
    try {
      var result = await api("/api/restore-parts?parts=" + parts.join(","), {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-current-password": btoa(unescape(encodeURIComponent(current))) },
        body: file,
      });
      var done = [];
      if (result.objectsAdded) done.push("добавлено проектов: " + result.objectsAdded);
      if (result.objectsUpdated) done.push("обновлено проектов: " + result.objectsUpdated);
      if (result.photosUpdated) done.push("фотографии обновлены у проектов: " + result.photosUpdated);
      if (result.seaUpdated) done.push("расстояние до пляжа обновлено у проектов: " + result.seaUpdated);
      if (result.contacts) done.push("контакты обновлены");
      if (result.about) done.push("«О компании» обновлено");
      if (result.texts) done.push("обновлено текстов и фото: " + result.texts);
      if (result.settings) done.push("обновлено настроек: " + result.settings);
      if (result.missingPhotos) done.push("не найдено фотографий: " + result.missingPhotos);
      toast(done.length ? done.join(". ") : "В файле нечего было брать");
      setTimeout(function () { location.reload(); }, 1500);
    } catch (error) { fail(error); }
  };
}

// Состояние туннеля словами: в данных лежат имена из кода (off, starting…).
var TUNNEL_STATUS_WORDS = { off: "выключен", starting: "запускается", online: "работает", error: "ошибка", missing: "не найден cloudflared.exe" };

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
    '<div class="card"><header><h3>Код из Telegram при входе</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="loginCodeOn"' + (config.loginCodeRequired ? " checked" : "") + "> Требовать код из Telegram при входе из интернета</label>" +
      '<div class="hint">' + (config.loginCodeRequired ? "Из интернета входят по паролю и коду из админ-чата." : "Из интернета входят только по паролю. Код из админ-чата защищает панель, если пароль угадают.") + "</div>" +
    "</div></div>" +
    '<div class="card"><header><h3>Доступ из интернета</h3></header><div class="card-body stack">' +
      '<label class="check"><input type="checkbox" id="remoteOn"' + (config.remoteAccess ? " checked" : "") + "> Разрешить вход в панель из интернета</label>" +
      '<div class="field"><label for="tunnelHost">Адрес панели в интернете</label><input id="tunnelHost" value="' + esc(config.tunnelHostname || "") + '" placeholder="panel.example.com"></div>' +
      '<div class="field"><label for="tunnelToken">Ключ доступа от Cloudflare</label><input id="tunnelToken" type="password" placeholder="' + (config.tunnelTokenSet ? "токен сохранён" : "из панели Cloudflare") + '"></div>' +
      '<button class="btn secondary small" id="saveRemote" type="button">Сохранить</button>' +
      '<div class="small muted">Состояние: ' + esc(TUNNEL_STATUS_WORDS[tunnel.status] || tunnel.status || "выключен") + (tunnel.url ? " · " + esc(tunnel.url) : "") + (tunnel.error ? " · " + esc(tunnel.error) : "") + "</div>" +
      '<div class="hint">' + (config.loginCodeRequired ? "Вход из интернета требует кода, который приходит в админ-чат Telegram." : "Вход из интернета — по паролю. Код из Telegram включается рядом.") + "</div>" +
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
  host.querySelector("#loginCodeOn").onchange = async function () {
    var box = this;
    var on = box.checked;
    try {
      if (on) {
        await send("/api/login-code", "PUT", { required: true });
      } else {
        if (!(await confirmDialog("Отключить код из Telegram?", "В панель из интернета будут входить только по паролю. Используйте длинный пароль, который нигде больше не применяется.", "Отключить", true))) { box.checked = true; return; }
        var password = await askPassword("Код из Telegram при входе", "Чтобы отключить код, введите текущий пароль панели.");
        if (!password) { box.checked = true; return; }
        await api("/api/login-code", { method: "PUT", headers: { "x-current-password": btoa(unescape(encodeURIComponent(password))) }, body: JSON.stringify({ required: false }) });
      }
      toast(on ? "Код из Telegram включён" : "Код из Telegram отключён");
      await reload();
    } catch (error) { box.checked = !on; fail(error); }
  };
  host.querySelector("#saveRemote").onclick = async function () {
    var on = host.querySelector("#remoteOn").checked;
    if (on && !(await confirmDialog(
      "Открыть панель из интернета?",
      "Панель станет доступна по адресу туннеля. Вход защищён " + (config.loginCodeRequired ? "паролем и кодом из Telegram" : "паролем") + ", но лучше включать это только когда нужно.",
      "Открыть",
      true
    ))) return;
    // Тот же порядок, что у восстановления копии: сначала пароль, потом
    // действие. Чужой туннель — это дорога в домашнюю сеть.
    var password = await askPassword("Доступ из интернета", "Чтобы изменить доступ и туннель, введите текущий пароль панели.");
    if (!password) return;
    try {
      await api("/api/remote-access", {
        method: "PUT",
        headers: { "x-current-password": btoa(unescape(encodeURIComponent(password))) },
        body: JSON.stringify({
          enabled: on,
          tunnelHostname: host.querySelector("#tunnelHost").value,
          tunnelToken: host.querySelector("#tunnelToken").value,
        }),
      });
      toast("Сохранено"); await reload();
    } catch (error) { fail(error); }
  };
}

// «Команда и доступ»: кто работает с ботом (менеджеры, админ-чат, звук) и как заходят в панель (пароль, интернет).
function renderTeamAndAccess(host) {
  host.innerHTML = '<div class="stack"><h2 class="group-title">Кто получает заявки и работает с ботом</h2><div id="teamPart"></div>' +
    '<h2 class="group-title">Вход в панель</h2><div id="accessPart"></div></div>';
  renderConnection(host.querySelector("#teamPart"));
  renderAccess(host.querySelector("#accessPart"));
}

VIEWS.settings = {
  render: function (host, tab) {
    // Редкое и осторожное — токен, копии, доступ из интернета — лежит теми же вкладками, что и повседневное:
    // отдельного «Обслуживания» третьего уровня нет. Загрузка проектов — в «Объекты → Загрузка».
    if (tab === "team") return renderTeamAndAccess(host);
    if (tab === "telegram") return renderTelegramConnection(host);
    if (tab === "data") return renderDataCopies(host);
    if (tab === "check") return renderDataCheck(host);
    renderWork(host);
  },
};
`;

export { SETTINGS_JS };
