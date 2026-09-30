// Client-side property comparison: a small, mobile-friendly shortlist with
// the same criteria and order for every selected property.

import { cleanText, formatMoney } from './util.mjs';
import { calculatorAvailable, purchaseEstimate } from './calculator.mjs';
import { createInquiry } from './inquiries.mjs';
import { withOffHoursNote } from './hours.mjs';
import { sendMessage } from './telegram.mjs';
import { menuKeyboard } from './menus.mjs';
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

// Числа для «лучшего значения»: сравнивать можно только сопоставимое. Цены — если
// у всех объектов одна сделка (продажа/аренда) и одна валюта; иначе деньги рядом
// не ставим. Пусто (0) — значение неизвестно.
function comparableNumbers(records) {
  const currencies = new Set(records.map((record) => cleanText(record.currency || 'EUR', 10).toUpperCase()));
  const deals = new Set(records.map((record) => record.dealType === 'rent' ? 'rent' : 'sale'));
  const sameMoney = currencies.size === 1 && deals.size === 1;
  const positive = (value) => (Number(value) > 0 ? Number(value) : 0);
  const costsAvailable = sameMoney && records.every((record) => calculatorAvailable(record));
  return {
    sameMoney,
    currency: [...currencies][0],
    price: records.map((record) => (sameMoney ? positive(record.priceValue) : 0)),
    pricePerM2: records.map((record) => (sameMoney && positive(record.priceValue) && positive(record.area) ? positive(record.priceValue) / positive(record.area) : 0)),
    area: records.map((record) => positive(record.area)),
    distanceSea: records.map((record) => positive(record.distanceSea)),
    purchaseCosts: records.map((record) => (costsAvailable ? purchaseEstimate(record).costsTotal : 0)),
  };
}

// Индекс лучшего значения: меньше — лучше (цена, расходы, расстояние), больше —
// лучше (площадь). Галочка нужна, только когда есть из чего выбирать: известно
// хотя бы два значения и они не равны.
const BEST_LOWEST = { price: true, pricePerM2: true, area: false, distanceSea: true, purchaseCosts: true };

function bestIndex(key, numbers) {
  const values = numbers[key];
  const known = values.filter((value) => value > 0);
  if (known.length < 2 || known.every((value) => value === known[0])) return -1;
  const target = BEST_LOWEST[key] ? Math.min(...known) : Math.max(...known);
  return values.indexOf(target);
}

function comparisonText(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
  const records = catalogRecords(user, 'comparison');
  if (!records.length) return [copy.title, '', copy.empty].join('\n');
  const lines = [
    copy.title,
    template(copy.selectedCount, { count: records.length, max: COMPARISON_LIMIT }),
  ];
  if (records.length === 1) lines.push('', copy.needMore);
  const values = records.map((record) => recordValues(record, language));
  const numbers = comparableNumbers(records);
  const symbol = numbers.currency === 'EUR' ? '€' : numbers.currency;
  const unit = language === 'ru' ? 'м²' : 'm²';
  values.forEach((value, index) => {
    if (numbers.pricePerM2[index]) value.pricePerM2 = formatMoney(Math.round(numbers.pricePerM2[index]), symbol, language, 0) + '/' + unit;
    if (numbers.purchaseCosts[index]) value.purchaseCosts = '≈ ' + formatMoney(Math.round(numbers.purchaseCosts[index]), symbol, language, 0);
  });
  // Один блок на объект (шесть-семь строк), а не столбик по критериям: три объекта по десять критериев были
  // шестьюдесятью строками и тремя экранами прокрутки. Пустые значения не показываем («—» не нужен), лучшее
  // помечено ★ и только там, где сравнимо (одна сделка и валюта, известно хотя бы два значения).
  let anyBest = false;
  const mark = (key, index) => {
    if (BEST_LOWEST[key] === undefined || bestIndex(key, numbers) !== index) return '';
    anyBest = true;
    return ' ★';
  };
  // Состояние «Забронирован» видно, только если объекты в нём различаются.
  const statusDiffers = new Set(values.map((value) => String(value.status || ''))).size > 1;
  const blocks = values.map((value, index) => {
    const record = records[index];
    const title = localizedExact(record.title, language, 160) || record.reference || record.id;
    const price = [value.price ? value.price + mark('price', index) : '', value.pricePerM2 ? value.pricePerM2 + mark('pricePerM2', index) : ''].filter(Boolean).join(' · ');
    const main = [value.bedrooms ? '🛏 ' + value.bedrooms : '', value.bathrooms ? '🚿 ' + value.bathrooms : '', value.area ? '📐 ' + value.area + mark('area', index) : ''].filter(Boolean).join(' · ');
    const extra = [value.plotArea ? '🌿 ' + value.plotArea : '', value.floor ? '🏢 ' + value.floor : '', value.distanceSea ? '🌊 ' + value.distanceSea + mark('distanceSea', index) : ''].filter(Boolean).join(' · ');
    const kind = [value.type, value.condition, statusDiffers ? value.status : ''].filter(Boolean).join(' · ');
    const place = value.location ? '📍 ' + value.location : '';
    const costs = value.purchaseCosts ? '🧾 ' + value.purchaseCosts + mark('purchaseCosts', index) : '';
    return [INDEX_MARKS[index] + ' ' + title, price, main, extra, kind, place, costs].filter(Boolean).join('\n');
  });
  lines.push('', blocks.join('\n\n'));
  if (anyBest) lines.push('', copy.bestValue);
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
    // Один ряд на объект: «Открыть» и «Убрать». Название стоит в тексте под тем же номером.
    rows.push([
      { text: INDEX_MARKS[index] + ' ' + copy.open, callback_data: 'catalog:comparison:' + index },
      { text: '✕ ' + copy.remove, callback_data: 'compare:remove:' + record.id },
    ]);
  });
  // «Обсудить» и WhatsApp — одним рядом; «Добавить» и «Очистить» — одним. Всего не больше шести рядов.
  if (records.length) {
    const talk = [{ text: copy.discuss, callback_data: 'compare:discuss' }];
    const whatsapp = whatsappRow(compareMessage(records.map((record) => localizedExact(record.title, language, 80) || record.reference || record.id), language));
    if (whatsapp) talk.push(...whatsapp);
    rows.push(talk);
  }
  const housekeeping = [];
  if (records.length < COMPARISON_LIMIT) housekeeping.push({ text: '🏘 ' + copy.browse, callback_data: 'catalog:all:0' });
  if (records.length) housekeeping.push({ text: '🗑 ' + copy.clear, callback_data: 'compare:clear' });
  if (housekeeping.length) rows.push(housekeeping);
  rows.push([{ text: '⬅️ ' + copy.back, callback_data: 'nav:my' }]);
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
  if (action === 'discuss') {
    const records = catalogRecords(user, 'comparison');
    if (!records.length) {
      await acknowledge(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
      return;
    }
    await acknowledge(query, token);
    const titles = records.map((record) => '• ' + (localizedExact(record.title, language, 160) || record.reference || record.id));
    createInquiry(user, [copy.discussRequest, ...titles].join('\n'), { type: 'question', propertyId: records[0].id });
    await sendMessage(chatId, withOffHoursNote(copy.discussSent, language, { user }), token, { reply_markup: menuKeyboard(language) });
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
