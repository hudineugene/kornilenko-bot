// Права клиента на свои данные: что бот о нём хранит, как мы с этим обращаемся
// и кнопка «удалить всё». Клиент не должен просить об этом менеджера.

import { cleanText } from './util.mjs';
import { PRIVACY_TEXT, MY_AREA_TEXT } from './texts.mjs';
import { data, scheduleSave } from './store.mjs';
import { eraseUserData, normalizeUser } from './users.mjs';
import { sendMessage, splitTelegramText } from './telegram.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { clearCatalogMessages, clearGalleryMessages, sendUiMessage } from './catalog.mjs';
import { menuKeyboard } from './menus.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';

function copyFor(user) {
  const language = (user && user.preferredLanguage) || 'ru';
  return PRIVACY_TEXT[language] || PRIVACY_TEXT.ru;
}

// Список «что хранится» собирается из того, что действительно есть: пустых
// строк вида «телефон: нет» клиенту не нужно.
function storedSummary(user) {
  const language = (user && user.preferredLanguage) || 'ru';
  // Подписи в виде «что: сколько» — так не нужно согласовывать числа со словами
  // в трёх языках.
  const words = {
    ru: { name: 'имя в Telegram', username: 'имя пользователя', phone: 'телефон', contactName: 'имя для связи', requests: 'заявки и сообщения', favorites: 'избранное', comparison: 'сравнение', saved: 'сохранённый поиск', recent: 'просмотренные объекты', since: 'первое обращение' },
    en: { name: 'Telegram name', username: 'username', phone: 'phone', contactName: 'contact name', requests: 'requests and messages', favorites: 'favorites', comparison: 'comparison', saved: 'saved search', recent: 'viewed properties', since: 'first contact' },
    es: { name: 'nombre en Telegram', username: 'usuario', phone: 'teléfono', contactName: 'nombre de contacto', requests: 'solicitudes y mensajes', favorites: 'favoritos', comparison: 'comparación', saved: 'búsqueda guardada', recent: 'inmuebles vistos', since: 'primer contacto' },
  }[language] || {};
  const rows = [];
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  if (fullName) rows.push('• ' + words.name + ': ' + fullName);
  if (user.username) rows.push('• ' + words.username + ': @' + user.username);
  if (user.contactName) rows.push('• ' + words.contactName + ': ' + user.contactName);
  if (user.phone) rows.push('• ' + words.phone + ': ' + user.phone);
  const requests = data.inquiries.filter((inquiry) => String(inquiry.userId) === String(user.id)).length;
  if (requests) rows.push('• ' + words.requests + ': ' + requests);
  const favorites = Array.isArray(user.favorites) ? user.favorites.length : 0;
  if (favorites) rows.push('• ' + words.favorites + ': ' + favorites);
  const comparison = Array.isArray(user.comparisonIds) ? user.comparisonIds.length : 0;
  if (comparison) rows.push('• ' + words.comparison + ': ' + comparison);
  if (user.savedSearch) rows.push('• ' + words.saved);
  const recent = Array.isArray(user.recentlyViewed) ? user.recentlyViewed.length : 0;
  if (recent) rows.push('• ' + words.recent + ': ' + recent);
  if (user.firstSeenAt) rows.push('• ' + words.since + ': ' + String(user.firstSeenAt).slice(0, 10).split('-').reverse().join('.'));
  return rows;
}

function privacyMarkup(user) {
  const copy = copyFor(user);
  const labels = MY_AREA_TEXT[(user && user.preferredLanguage) || 'ru'] || MY_AREA_TEXT.ru;
  return {
    inline_keyboard: [
      [{ text: copy.policyButton, callback_data: 'privacy:policy' }],
      [{ text: copy.eraseButton, callback_data: 'privacy:erase' }],
      [{ text: copy.back || ('⬅️ ' + labels.title), callback_data: 'nav:my' }],
    ],
  };
}

async function sendPrivacyCentre(chatId, user, token) {
  const copy = copyFor(user);
  const rows = storedSummary(user);
  const body = rows.length ? [copy.storedTitle, ...rows].join('\n') : copy.nothing;
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  return sendUiMessage(chatId, user, [copy.title, '', copy.intro, '', body].join('\n'), token, { reply_markup: privacyMarkup(user) });
}

// Политика бывает длинной: отправляем частями, чтобы Telegram не обрезал.
async function sendPrivacyPolicy(chatId, user, token) {
  const copy = copyFor(user);
  const parts = splitTelegramText([copy.policyTitle, '', copy.policy].join('\n'));
  for (let index = 0; index < parts.length; index += 1) {
    const last = index === parts.length - 1;
    await sendMessage(chatId, parts[index], token, last ? { reply_markup: privacyMarkup(user) } : {});
  }
  return true;
}

async function handlePrivacyCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const copy = copyFor(user);
  const language = user.preferredLanguage || 'ru';

  if (action === 'policy') {
    await acknowledgeCallback(query, token);
    void notifyAdministratorAction(user, 'Открыл политику конфиденциальности', '');
    return sendPrivacyPolicy(chatId, user, token);
  }

  if (action === 'erase') {
    await acknowledgeCallback(query, token);
    return sendUiMessage(chatId, user, [copy.eraseTitle, '', copy.eraseWarning].join('\n'), token, {
      reply_markup: {
        inline_keyboard: [
          [{ text: copy.eraseConfirm, callback_data: 'privacy:erased' }],
          [{ text: copy.eraseCancel, callback_data: 'privacy:open' }],
        ],
      },
    });
  }

  if (action === 'erased') {
    await acknowledgeCallback(query, token);
    // Сообщаем администратору до удаления: после него имени уже не будет.
    // Важное уведомление: вместе с данными исчезают и обращения клиента,
    // поэтому оно приходит и в режиме «только обращения».
    void notifyAdministratorAction(user, 'Удалил свои данные', 'Клиент сам удалил данные через «🔒 Мои данные». Его заявки и переписка удалены безвозвратно.', '', null, { important: true });
    const removed = eraseUserData(user);
    scheduleSave();
    return sendMessage(chatId, copy.erased, token, { reply_markup: menuKeyboard(language) }).then(() => removed);
  }

  await acknowledgeCallback(query, token);
  return sendPrivacyCentre(chatId, user, token);
}

// Приписка к вопросу о телефоне: зачем он нужен и где посмотреть политику.
function phoneNotice(language) {
  const copy = PRIVACY_TEXT[language] || PRIVACY_TEXT.ru;
  return cleanText(copy.phoneNotice, 300);
}

// Черновик политики узнаётся по подстановкам в квадратных скобках.
function policyIsDraft() {
  const values = ['ru', 'en', 'es'].map((language) => String((PRIVACY_TEXT[language] || {}).policy || ''));
  return values.some((value) => !value.trim() || /\[[^\]]+\]/.test(value));
}

export {
  handlePrivacyCallback,
  phoneNotice,
  policyIsDraft,
  privacyMarkup,
  sendPrivacyCentre,
  sendPrivacyPolicy,
  storedSummary,
};
