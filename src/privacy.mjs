// Права клиента на свои данные: что бот о нём хранит, как мы с этим обращаемся
// и кнопка «удалить всё». Клиент не должен просить об этом менеджера.

import { backButtonText, cleanText, localDayKey } from './util.mjs';
import { PRIVACY_TEXT, MY_AREA_TEXT } from './texts.mjs';
import { data, scheduleSave } from './store.mjs';
import { eraseUserData, normalizeUser } from './users.mjs';
import { sendMessage, splitTelegramText } from './telegram.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { clearCatalogMessages, clearGalleryMessages, sendUiMessage } from './catalog.mjs';
import { menuKeyboard } from './menus.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';
import { recordError } from './analytics.mjs';
import { localized } from './catalog.mjs';
import { viewingDateLabel } from './viewings.mjs';

function copyFor(user) {
  const language = (user && user.preferredLanguage) || 'ru';
  return PRIVACY_TEXT[language] || PRIVACY_TEXT.ru;
}

// Дата по обычаю языка: 30.09.2026 / 30/09/2026 — как «Обновлено» на карточке.
function firstContactDate(value, language) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

// Список «что хранится» собирается из того, что действительно есть: пустых
// строк вида «телефон: нет» клиенту не нужно.
function storedSummary(user) {
  const language = (user && user.preferredLanguage) || 'ru';
  // Подписи в виде «что: сколько» — так не нужно согласовывать числа со словами
  // в трёх языках.
  const words = {
    ru: { name: 'имя в Telegram', username: 'имя пользователя', phone: 'телефон', contactName: 'имя для связи', requests: 'заявки и сообщения', favorites: 'избранное', comparison: 'сравнение', saved: 'сохранённый поиск', sharedLists: 'подборки, которыми вы поделились', recent: 'просмотренные объекты', since: 'первое обращение' },
    en: { name: 'Telegram name', username: 'username', phone: 'phone', contactName: 'contact name', requests: 'requests and messages', favorites: 'favourites', comparison: 'comparison', saved: 'saved search', sharedLists: 'shortlists you shared', recent: 'viewed properties', since: 'first contact' },
    es: { name: 'nombre en Telegram', username: 'usuario', phone: 'teléfono', contactName: 'nombre de contacto', requests: 'solicitudes y mensajes', favorites: 'favoritos', comparison: 'comparación', saved: 'búsqueda guardada', sharedLists: 'selecciones que compartiste', recent: 'inmuebles vistos', since: 'primer contacto' },
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
  const shared = Object.values(data.sharedLists || {}).filter((list) => String(list.owner) === String(user.id)).length;
  if (shared) rows.push('• ' + words.sharedLists + ': ' + shared);
  const recent = Array.isArray(user.recentlyViewed) ? user.recentlyViewed.length : 0;
  if (recent) rows.push('• ' + words.recent + ': ' + recent);
  if (user.firstSeenAt) rows.push('• ' + words.since + ': ' + firstContactDate(user.firstSeenAt, language));
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

// Под текстом политики — не кнопка «Как мы обращаемся с данными» (она вела бы на этот же экран), а возврат на «Ваши данные».
function policyMarkup(user) {
  const copy = copyFor(user);
  const labels = MY_AREA_TEXT[(user && user.preferredLanguage) || 'ru'] || MY_AREA_TEXT.ru;
  return {
    inline_keyboard: [
      [{ text: backButtonText(copy.title), callback_data: 'privacy:open' }],
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
    await sendMessage(chatId, parts[index], token, last ? { reply_markup: policyMarkup(user) } : {});
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
    //
    // Ждём отправки, а не отпускаем «в фоне»: уведомление в конце записывает,
    // кому адресовать ответ на него. Сделанное после удаления, это оставляло в
    // данных «адрес» удалённого клиента — ответ менеджера воссоздал бы его
    // карточку и обращение заново.
    try {
      await notifyAdministratorAction(user, 'Удалил свои данные', eraseDetails(user), '', null, { important: true });
    } catch (error) {
      recordError('Уведомление администратору', error);
    }
    const removed = eraseUserData(user);
    scheduleSave();
    return sendMessage(chatId, copy.erased, token, { reply_markup: menuKeyboard(language) }).then(() => removed);
  }

  await acknowledgeCallback(query, token);
  return sendPrivacyCentre(chatId, user, token);
}

// Подтверждённые просмотры, которые ещё впереди. Они исчезают вместе с
// данными клиента, а менеджер о них помнит только по уведомлению бота: без даты
// и объекта он может приехать на показ зря.
function upcomingConfirmedViewings(user, now = new Date()) {
  const today = localDayKey(now);
  return data.inquiries
    .filter((inquiry) => String(inquiry.userId) === String(user.id))
    .filter((inquiry) => inquiry.viewing && inquiry.viewing.confirmedAt && !inquiry.viewing.cancelledAt)
    .filter((inquiry) => String(inquiry.viewing.confirmedDate || '') >= today)
    .sort((first, second) => String(first.viewing.confirmedDate).localeCompare(String(second.viewing.confirmedDate)));
}

function eraseDetails(user, now = new Date()) {
  const lines = ['Клиент сам удалил данные через «🔒 Мои данные». Его заявки и переписка удалены безвозвратно.'];
  const viewings = upcomingConfirmedViewings(user, now);
  if (!viewings.length) return lines.join('\n');
  lines.push('', '⚠️ Вместе с ними пропадают подтверждённые просмотры:');
  for (const inquiry of viewings.slice(0, 5)) {
    const property = data.objects.find((item) => item.id === inquiry.propertyId);
    const what = property ? localized(property.title, 'ru') || property.reference || '' : '';
    const when = [viewingDateLabel(inquiry.viewing.confirmedDate, 'ru'), inquiry.viewing.confirmedTime].filter(Boolean).join(', ');
    lines.push('• ' + [when, what].filter(Boolean).join(' — '));
  }
  lines.push('', 'Запишите себе: в /viewings и в панели этих просмотров больше не будет, и напоминание бот никому не пришлёт.');
  return lines.join('\n');
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
