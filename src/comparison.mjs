// Client-side property comparison: a small, mobile-friendly shortlist with
// the same criteria and order for every selected property.

import { cleanText } from './util.mjs';
import { scheduleSave } from './store.mjs';
import { normalizeUser } from './users.mjs';
import { telegramRequest } from './telegram.mjs';
import { whatsappRow } from './sections.mjs';
import { compareMessage } from './whatsapp-hot.mjs';
import {
  COMPARISON_LIMIT,
  catalogRecords,
  clearCatalogMessages,
  clearGalleryMessages,
  localizedExact,
  objectPriceText,
  sendUiMessage,
} from './catalog.mjs';
import {
  COMPARISON_TEXT,
  INTERACTION_TEXT,
  MENU_LABELS,
  PROPERTY_ACTION_TEXT,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_TYPE_LABELS,
} from './texts.mjs';

const INDEX_MARKS = ['1️⃣', '2️⃣', '3️⃣'];

function template(text, values) {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll('{' + key + '}', String(value)), String(text || ''));
}

function currentComparisonIds(user) {
  return catalogRecords(user, 'comparison').map((record) => record.id);
}

function normalizeComparisonSelection(user) {
  const current = currentComparisonIds(user);
  const stored = Array.isArray(user.comparisonIds) ? user.comparisonIds.map(String).slice(0, COMPARISON_LIMIT) : [];
  if (current.join('\u0000') !== stored.join('\u0000')) {
    user.comparisonIds = current;
    scheduleSave();
  }
  return current;
}

function comparisonContains(user, propertyId) {
  return currentComparisonIds(user).includes(String(propertyId));
}

function addToComparison(user, record) {
  const ids = normalizeComparisonSelection(user);
  if (ids.includes(record.id)) return { status: 'selected', count: ids.length };
  if (ids.length >= COMPARISON_LIMIT) return { status: 'limit', count: ids.length };
  user.comparisonIds = [...ids, record.id];
  scheduleSave();
  return { status: 'added', count: user.comparisonIds.length };
}

function numberValue(value, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) return '';
  return String(number).replace(/\.0+$/, '');
}

function recordValues(record, language) {
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const types = PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru;
  const conditions = PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru;
  const city = localizedExact(record.city, language, 160);
  const district = localizedExact(record.district, language, 160);
  const floor = [cleanText(record.floor, 20), cleanText(record.floors, 20)].filter(Boolean).join('/');
  const areaUnit = language === 'ru' ? 'м²' : 'm²';
  const distanceUnit = language === 'ru' ? 'м' : 'm';
  return {
    price: objectPriceText(record, language),
    location: [city, district].filter(Boolean).join(', '),
    type: [types[record.propertyType] || '', record.dealType === 'rent' ? action.forRent : action.forSale].filter(Boolean).join(' · '),
    area: numberValue(record.area) ? numberValue(record.area) + ' ' + areaUnit : '',
    plotArea: numberValue(record.plotArea) ? numberValue(record.plotArea) + ' ' + areaUnit : '',
    bedrooms: numberValue(record.bedrooms, true),
    bathrooms: numberValue(record.bathrooms),
    condition: conditions[record.condition] || '',
    floor,
    distanceSea: numberValue(record.distanceSea) ? numberValue(record.distanceSea) + ' ' + distanceUnit : '',
    status: record.status === 'reserved' ? '🟡 ' + action.reserved : '🟢 ' + action.available,
    reference: cleanText(record.reference, 80),
  };
}

function comparisonText(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
  const records = catalogRecords(user, 'comparison');
  if (!records.length) return [copy.title, '', copy.empty].join('\n');
  const lines = [
    copy.title,
    template(copy.selectedCount, { count: records.length, max: COMPARISON_LIMIT }),
    '',
    copy.intro,
    '',
    ...records.map((record, index) => INDEX_MARKS[index] + ' ' + (localizedExact(record.title, language, 160) || record.reference || record.id)),
  ];
  if (records.length === 1) lines.push('', copy.needMore);
  const values = records.map((record) => recordValues(record, language));
  const criteria = [
    ['price', copy.price],
    ['location', copy.location],
    ['type', copy.type],
    ['area', copy.area],
    ['plotArea', copy.plotArea],
    ['bedrooms', copy.bedrooms],
    ['bathrooms', copy.bathrooms],
    ['condition', copy.condition],
    ['floor', copy.floor],
    ['distanceSea', copy.distanceSea],
    ['status', copy.status],
    ['reference', copy.reference],
  ];
  for (const [key, label] of criteria) {
    if (!values.some((value) => value[key])) continue;
    lines.push('', label);
    values.forEach((value, index) => lines.push(INDEX_MARKS[index] + ' ' + (value[key] || copy.notSpecified)));
  }
  return lines.join('\n').slice(0, 4000);
}

function comparisonMarkup(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const records = catalogRecords(user, 'comparison');
  const rows = [];
  records.forEach((record, index) => {
    const title = cleanText(localizedExact(record.title, language, 160) || record.reference || record.id, 34);
    rows.push([{ text: INDEX_MARKS[index] + ' ' + copy.open + ': ' + title, callback_data: 'catalog:comparison:' + index }]);
    rows.push([{ text: '✕ ' + copy.remove + ': ' + title, callback_data: 'compare:remove:' + record.id }]);
  });
  if (records.length) {
    const whatsapp = whatsappRow(compareMessage(records.map((record) => localizedExact(record.title, language, 80) || record.reference || record.id), language));
    if (whatsapp) rows.push(whatsapp);
  }
  if (records.length < COMPARISON_LIMIT) rows.push([{ text: '🏘 ' + copy.browse, callback_data: 'catalog:all:0' }]);
  if (records.length) rows.push([{ text: '🗑 ' + copy.clear, callback_data: 'compare:clear' }]);
  rows.push([{ text: '⬅️ ' + labels.more, callback_data: 'nav:my' }]);
  return { inline_keyboard: rows };
}

async function sendComparison(chatId, user, token) {
  normalizeComparisonSelection(user);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  return sendUiMessage(chatId, user, comparisonText(user), token, { reply_markup: comparisonMarkup(user) });
}

async function acknowledge(query, token, text = '') {
  try {
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: cleanText(text, 180) || undefined,
    });
  } catch {
    // The action remains valid if Telegram has already expired the popup.
  }
}

async function handleComparisonCallback(query, token, notifyAction = null) {
  const [, action, ...rest] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
  if (action === 'view') {
    await acknowledge(query, token);
    if (typeof notifyAction === 'function') {
      void notifyAction(user, 'Открыл сравнение объектов', template(copy.selectedCount, { count: catalogRecords(user, 'comparison').length, max: COMPARISON_LIMIT }));
    }
    await sendComparison(chatId, user, token);
    return;
  }
  if (action === 'remove') {
    const propertyId = rest.join(':');
    const removed = catalogRecords(user, 'comparison').find((record) => record.id === propertyId);
    user.comparisonIds = (Array.isArray(user.comparisonIds) ? user.comparisonIds : []).map(String).filter((id) => id !== propertyId);
    scheduleSave();
    if (typeof notifyAction === 'function') {
      void notifyAction(user, 'Удалил объект из сравнения', removed ? (localizedExact(removed.title, language, 160) || removed.reference || removed.id) : propertyId);
    }
    await acknowledge(query, token, copy.removed);
    await sendComparison(chatId, user, token);
    return;
  }
  if (action === 'clear') {
    const count = catalogRecords(user, 'comparison').length;
    user.comparisonIds = [];
    scheduleSave();
    if (typeof notifyAction === 'function') void notifyAction(user, 'Очистил сравнение объектов', 'Удалено объектов: ' + count);
    await acknowledge(query, token, copy.cleared);
    await sendComparison(chatId, user, token);
    return;
  }
  await acknowledge(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
}

export {
  addToComparison,
  comparisonContains,
  comparisonMarkup,
  comparisonText,
  handleComparisonCallback,
  normalizeComparisonSelection,
  sendComparison,
};
