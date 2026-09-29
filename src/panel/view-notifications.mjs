// Действия над событиями ленты. Сама лента одна — «Список дел» на «Сегодня»
// (view-overview.mjs); отдельной страницы уведомлений больше нет, колокольчик
// считает ту же ленту.

const NOTIFICATIONS_JS = String.raw`
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
    // Старые записи в «Выполненном» хранят прежние адреса разделов: приводим к нынешним.
    var moved = normalizeRoute(target.view, target.tab || "");
    if (target.inquiryId && moved[0] === "clients" && moved[1] === "inbox") {
      selectConversation(target.inquiryId);
      await go("clients", "inbox");
    } else if (moved[0]) await go(moved[0], moved[1] || "");
  } catch (error) { if (button) button.disabled = false; fail(error); }
}
`;

export { NOTIFICATIONS_JS };
