// One explicit saved catalog search per client. It is deliberately simple on
// a phone: set the normal filter, save it, and manage it from “My space”.

import { backButtonText, cleanText } from './util.mjs';
import { scheduleSave } from './store.mjs';
import { normalizeUser } from './users.mjs';
import { telegramRequest } from './telegram.mjs';
import {
  applyCatalogFilter,
  catalogFilterPanel,
  catalogFilterSummary,
  catalogSearchActive,
  catalogSearchFilter,
  clearCatalogMessages,
  clearGalleryMessages,
  normalizedSavedSearch,
  propertyReadyForLanguage,
  publishedCatalog,
  sendCatalogPage,
  sendUiMessage,
} from './catalog.mjs';
import { INTERACTION_TEXT, MENU_LABELS, SAVED_SEARCH_TEXT, SUBSCRIPTION_TEXT } from './texts.mjs';
import { data } from './store.mjs';
import { similarSearchFilter } from './dead-end.mjs';

function template(text, values) {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll('{' + key + '}', String(value)), String(text || ''));
}

function savedSearchOf(user) {
  return normalizedSavedSearch(user && user.savedSearch);
}

function savedSearchNotificationActive(user) {
  const saved = savedSearchOf(user);
  return Boolean(saved && saved.enabled && user.propertyAlerts !== false);
}

function savedSearchMatches(user, record) {
  const saved = savedSearchOf(user);
  const language = user && user.preferredLanguage || 'ru';
  if (!saved || !saved.enabled || !record || record.status !== 'active' || !propertyReadyForLanguage(record, language)) return false;
  return applyCatalogFilter([record], saved.filter, language).length === 1;
}

function savedSearchResults(user) {
  const saved = savedSearchOf(user);
  if (!saved) return [];
  return applyCatalogFilter(publishedCatalog(user), saved.filter, user.preferredLanguage || 'ru');
}

function savedSearchText(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = SAVED_SEARCH_TEXT[language] || SAVED_SEARCH_TEXT.ru;
  const saved = savedSearchOf(user);
  if (!saved) return [copy.title, '', copy.empty].join('\n');
  const status = !saved.enabled
    ? copy.paused
    : user.propertyAlerts === false
      ? copy.notificationsOff
      : copy.active;
  return [
    copy.title,
    '',
    status,
    '',
    copy.criteria + ':',
    '🔎 ' + catalogFilterSummary(saved.filter, language),
    '',
    template(copy.matches, { count: savedSearchResults(user).length }),
  ].join('\n');
}

function savedSearchMarkup(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = SAVED_SEARCH_TEXT[language] || SAVED_SEARCH_TEXT.ru;
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const saved = savedSearchOf(user);
  const rows = [];
  if (!saved) {
    rows.push([{ text: '🔎 ' + copy.edit.replace(/^✏️\s*/, ''), callback_data: 'cfilter:open' }]);
  } else {
    rows.push([{ text: copy.showResults, callback_data: 'saved:results' }]);
    rows.push([{ text: copy.edit, callback_data: 'saved:edit' }]);
    rows.push([{ text: saved.enabled ? copy.pause : copy.resume, callback_data: 'saved:toggle' }]);
    if (user.propertyAlerts === false) {
      rows.push([{ text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).menuButton, callback_data: 'subs:menu' }]);
    }
    rows.push([{ text: copy.remove, callback_data: 'saved:delete' }]);
  }
  rows.push([{ text: backButtonText(labels.more), callback_data: 'nav:my' }]);
  return { inline_keyboard: rows };
}

async function sendSavedSearch(chatId, user, token) {
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  return sendUiMessage(chatId, user, savedSearchText(user), token, { reply_markup: savedSearchMarkup(user) });
}

async function acknowledge(query, token, text = '') {
  try {
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: cleanText(text, 180) || undefined,
    });
  } catch {
    // The requested action remains valid if the Telegram popup expired.
  }
}

async function handleSavedSearchCallback(query, token, notifyAction = null) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = SAVED_SEARCH_TEXT[language] || SAVED_SEARCH_TEXT.ru;
  const notify = (title, details = '') => {
    if (typeof notifyAction === 'function') void notifyAction(user, title, details);
  };

  if (action === 'view') {
    await acknowledge(query, token);
    notify('Открыл сохранённый поиск', savedSearchOf(user) ? catalogFilterSummary(savedSearchOf(user).filter, language) : 'Поиск ещё не сохранён');
    await sendSavedSearch(chatId, user, token);
    return;
  }

  // «Сообщить, когда появится похожий» на пустом экране похожих: поиск по
  // параметрам карточки, без захода в фильтр каталога. Каталог клиента при этом не
  // меняется — сохраняется только сам поиск.
  if (action === 'similar') {
    const id = String(query.data || '').split(':').slice(2).join(':');
    const record = data.objects.find((item) => item.id === id && ['active', 'reserved'].includes(item.status));
    if (!record) {
      await acknowledge(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
      return;
    }
    const filter = catalogSearchFilter(similarSearchFilter(record, language));
    if (!catalogSearchActive(filter)) {
      await acknowledge(query, token, copy.requiresFilter);
      return;
    }
    const previous = savedSearchOf(user);
    const now = new Date().toISOString();
    user.savedSearch = { filter, enabled: true, createdAt: previous && previous.createdAt || now, updatedAt: now };
    user.propertyAlerts = true;
    scheduleSave();
    notify(previous ? 'Обновил сохранённый поиск' : 'Сохранил поиск объектов', catalogFilterSummary(filter, language));
    await acknowledge(query, token, copy.saved);
    await sendSavedSearch(chatId, user, token);
    return;
  }

  if (action === 'save') {
    if (!catalogSearchActive(user.catalogFilter)) {
      await acknowledge(query, token, copy.requiresFilter);
      return;
    }
    const previous = savedSearchOf(user);
    const now = new Date().toISOString();
    user.savedSearch = {
      filter: catalogSearchFilter(user.catalogFilter),
      enabled: true,
      createdAt: previous && previous.createdAt || now,
      updatedAt: now,
    };
    user.propertyAlerts = true;
    scheduleSave();
    const summary = catalogFilterSummary(user.savedSearch.filter, language);
    notify(previous ? 'Обновил сохранённый поиск' : 'Сохранил поиск объектов', summary);
    await acknowledge(query, token, copy.saved);
    await sendSavedSearch(chatId, user, token);
    return;
  }

  const saved = savedSearchOf(user);
  if (!saved) {
    await acknowledge(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
    await sendSavedSearch(chatId, user, token);
    return;
  }

  if (action === 'results') {
    user.catalogFilter = { ...saved.filter };
    scheduleSave();
    await acknowledge(query, token);
    notify('Открыл результаты сохранённого поиска', catalogFilterSummary(saved.filter, language));
    await sendCatalogPage(chatId, user, token, 0, 'all');
    return;
  }

  if (action === 'edit') {
    user.catalogFilter = { ...saved.filter };
    scheduleSave();
    await acknowledge(query, token);
    const panel = catalogFilterPanel(user);
    await clearGalleryMessages(chatId, user, token);
    await clearCatalogMessages(chatId, user, token);
    await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
    return;
  }

  if (action === 'toggle') {
    saved.enabled = !saved.enabled;
    saved.updatedAt = new Date().toISOString();
    if (saved.enabled) user.propertyAlerts = true;
    user.savedSearch = saved;
    scheduleSave();
    notify(saved.enabled ? 'Возобновил сохранённый поиск' : 'Приостановил сохранённый поиск', catalogFilterSummary(saved.filter, language));
    await acknowledge(query, token, saved.enabled ? copy.resumedNotice : copy.pausedNotice);
    await sendSavedSearch(chatId, user, token);
    return;
  }

  if (action === 'delete') {
    const summary = catalogFilterSummary(saved.filter, language);
    user.savedSearch = null;
    scheduleSave();
    notify('Удалил сохранённый поиск', summary);
    await acknowledge(query, token, copy.removed);
    await sendSavedSearch(chatId, user, token);
    return;
  }

  await acknowledge(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
}

export {
  handleSavedSearchCallback,
  savedSearchMarkup,
  savedSearchMatches,
  savedSearchNotificationActive,
  savedSearchOf,
  savedSearchResults,
  savedSearchText,
  sendSavedSearch,
};
