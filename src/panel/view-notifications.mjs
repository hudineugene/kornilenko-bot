// Рабочий центр уведомлений администратора.

const NOTIFICATIONS_JS = String.raw`
var notificationFilter = "active";
var notificationKind = "";

var NOTIFICATION_KINDS = {
  message: { icon: "✉", label: "Сообщения" },
  task: { icon: "⏱", label: "Следующие шаги" },
  viewing: { icon: "⌂", label: "Просмотры" },
  broadcast: { icon: "➤", label: "Рассылки" },
  error: { icon: "!", label: "Ошибки" },
  system: { icon: "⚙", label: "Система" },
};

function notificationMeta(item) {
  return NOTIFICATION_KINDS[item.kind] || { icon: "•", label: "Событие" };
}

function notificationStatus(item) {
  if (!item.active) return '<span class="chip ok">причина устранена</span>';
  if (item.handledAt) return '<span class="chip">обработано</span>';
  if (item.readAt) return '<span class="chip brand">прочитано</span>';
  return '<span class="chip bad">новое</span>';
}

function notificationRows() {
  return (state.notifications || []).filter(function (item) {
    if (notificationKind && item.kind !== notificationKind) return false;
    if (notificationFilter === "active") return item.active && !item.handledAt;
    if (notificationFilter === "unread") return item.active && !item.readAt && !item.handledAt;
    if (notificationFilter === "handled") return Boolean(item.handledAt);
    return true;
  });
}

async function changeNotification(item, action, button, undo) {
  if (button) button.disabled = true;
  try {
    await send("/api/admin-notifications/" + encodeURIComponent(item.id), "PATCH", { action: action });
    await reload();
    if (undo) toast(action === "handle" ? "Дело скрыто" : "Готово", false, undo);
  } catch (error) { if (button) button.disabled = false; fail(error); }
}

async function openNotification(item, button) {
  if (button) button.disabled = true;
  try {
    if (!item.readAt) {
      await send("/api/admin-notifications/" + encodeURIComponent(item.id), "PATCH", { action: "read" });
      await reload(false);
    }
    var target = item.route || {};
    if (target.inquiryId && target.view === "inquiries" && target.tab === "inbox") {
      selectConversation(target.inquiryId);
      await go("inquiries", "inbox");
    } else if (target.view) await go(target.view, target.tab || "");
  } catch (error) { if (button) button.disabled = false; fail(error); }
}

function renderNotifications(host) {
  var all = state.notifications || [];
  var active = all.filter(function (item) { return item.active && !item.handledAt; });
  var unread = active.filter(function (item) { return !item.readAt; });
  var urgent = active.filter(function (item) { return item.severity === "bad"; });
  var handled = all.filter(function (item) { return item.handledAt; });
  var rows = notificationRows();
  var kinds = Object.keys(NOTIFICATION_KINDS).filter(function (kind) { return all.some(function (item) { return item.kind === kind; }); });

  if (unread.length) pageAction("Прочитать все", async function () {
    try { await send("/api/admin-notifications/read-all", "POST", {}); toast("Уведомления отмечены прочитанными"); await reload(); } catch (error) { fail(error); }
  }, "secondary");

  host.innerHTML = numberStrip([
      ["Требуют внимания", num(active.length), active.length ? "bad" : ""],
      ["Непрочитанные", num(unread.length)],
      ["Срочные", num(urgent.length), urgent.length ? "bad" : ""],
      ["Обработанные", num(handled.length), "", "Сохранены в истории"],
    ]) + '<div class="notification-toolbar"><div class="tabs">' +
      '<button class="' + (notificationFilter === "active" ? "active" : "") + '" data-notification-filter="active" type="button">Требуют внимания <span>' + active.length + '</span></button>' +
      '<button class="' + (notificationFilter === "unread" ? "active" : "") + '" data-notification-filter="unread" type="button">Непрочитанные <span>' + unread.length + '</span></button>' +
      '<button class="' + (notificationFilter === "handled" ? "active" : "") + '" data-notification-filter="handled" type="button">Обработанные</button>' +
      '<button class="' + (notificationFilter === "all" ? "active" : "") + '" data-notification-filter="all" type="button">Все</button></div>' +
      '<select id="notificationKind" aria-label="Тип уведомления"><option value="">Все типы</option>' + kinds.map(function (kind) { return '<option value="' + kind + '"' + (notificationKind === kind ? " selected" : "") + '>' + esc(NOTIFICATION_KINDS[kind].label) + '</option>'; }).join("") + '</select></div>' +
    '<div class="notification-help"><span>«Скрыть» убирает событие из активной очереди, но не изменяет саму заявку, просмотр или рассылку. Скрытое можно вернуть.</span></div>' +
    '<div class="notification-list">' + (rows.length ? rows.map(function (item) {
      var meta = notificationMeta(item);
      return '<article class="card notification-card ' + esc(item.severity) + (!item.readAt && item.active ? " unread" : "") + '">' +
        '<div class="notification-icon">' + meta.icon + '</div><div class="notification-copy"><div class="notification-card-head"><span class="notification-kind">' + esc(meta.label) + '</span><time>' + esc(ago(item.createdAt)) + '</time>' + notificationStatus(item) + '</div><h3>' + esc(item.title) + '</h3><p>' + esc(item.text) + '</p>' + (!item.active ? '<small>Источник события уже не требует действия.</small>' : "") + '</div>' +
        '<div class="notification-actions">' + (item.route && item.route.view ? '<button class="btn small" data-notification-open="' + esc(item.id) + '" type="button">Открыть</button>' : "") +
          // Два действия на карточку: «Открыть» (открытое считается прочитанным) и «Скрыть».
          // Раньше было ещё «Прочитано» и «Обработано» — три слова на одно действие.
          (item.active && !item.handledAt ? '<button class="btn ghost small" data-notification-action="handle" data-notification-id="' + esc(item.id) + '" type="button">Скрыть</button>' : item.active && item.handledAt ? '<button class="btn ghost small" data-notification-action="reopen" data-notification-id="' + esc(item.id) + '" type="button">Вернуть</button>' : "") + '</div></article>';
    }).join("") : '<div class="card"><div class="empty"><b>' + (notificationFilter === "active" ? "Всё под контролем" : "Уведомлений в этой группе нет") + '</b>' + (notificationFilter === "active" ? "Нет событий, которые требуют действия администратора" : "Измените фильтр, чтобы увидеть другие события") + '</div></div>') + '</div>';

  host.querySelectorAll("[data-notification-filter]").forEach(function (button) { button.onclick = function () { notificationFilter = button.dataset.notificationFilter; renderView(); }; });
  host.querySelector("#notificationKind").onchange = function (event) { notificationKind = event.target.value; renderView(); };
  host.querySelectorAll("[data-notification-open]").forEach(function (button) { button.onclick = function () { var item = all.find(function (entry) { return entry.id === button.dataset.notificationOpen; }); if (item) openNotification(item, button); }; });
  host.querySelectorAll("[data-notification-action]").forEach(function (button) { button.onclick = function () { var item = all.find(function (entry) { return entry.id === button.dataset.notificationId; }); if (item) changeNotification(item, button.dataset.notificationAction, button, button.dataset.notificationAction === "handle" ? { label: "Вернуть", run: function () { changeNotification(item, "reopen"); } } : undefined); }; });
}

VIEWS.notifications = {
  subtitle: function () { return "Сообщения, задачи, просмотры, рассылки и состояние системы"; },
  render: renderNotifications,
};
`;

export { NOTIFICATIONS_JS };
