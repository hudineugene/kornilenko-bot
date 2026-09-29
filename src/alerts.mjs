// Уведомления клиентам об объектах: избранное и подбор.

import { cleanText, delay, largestMoneyAmount, localDayKey } from './util.mjs';
import { imageExists } from './media.mjs';
import { PROPERTY_ALERT_TEXT, SAVED_SEARCH_TEXT, SELECTION_FORM_TEXT } from './texts.mjs';
import { configured, data, saveDataNow, scheduleSave } from './store.mjs';
import { recordError, recordPropertyEvent } from './analytics.mjs';
import { markUnavailable, normalizeUser, userById } from './users.mjs';
import { sendMessage, sendPhotoMessage } from './telegram.mjs';
import { menuKeyboard } from './menus.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';
import { contentButtons, localizedExact, objectCaptionHtml, objectPriceText, propertyReadyForLanguage, recordImages } from './catalog.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { userUnavailableError } from './broadcasts.mjs';
import { savedSearchMatches } from './saved-search.mjs';

// --- Property alerts ---------------------------------------------------------
// A client hears about a property again when it matters to them: a favourite
// got cheaper or is available again, or a newly published property fits the
// wishes they left in "Help me find a property". Every message has a button
// to stop these alerts.

const PROPERTY_ALERT_SPACING_MS = 60;
const SELECTION_ALERT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const ALERT_MEMORY_MS = 180 * 24 * 60 * 60 * 1000;

function alertsEnabled(user) {
  return Boolean(user && user.chatId && !user.blocked && user.preferredLanguage && user.propertyAlerts !== false);
}

function rememberAlert(user, key) {
  const sent = user.alertsSent && typeof user.alertsSent === 'object' ? user.alertsSent : {};
  const cutoff = Date.now() - ALERT_MEMORY_MS;
  for (const [storedKey, at] of Object.entries(sent)) if (Date.parse(at) < cutoff) delete sent[storedKey];
  sent[key] = new Date().toISOString();
  user.alertsSent = sent;
}

// Бюджет из подбора разбирается тем же способом, что и поиск фразой:
// «до 600 000 €», «1,2 млн», «300к», «€350,000», «до 800» для аренды.
function budgetLimit(text) {
  return largestMoneyAmount(text, 100);
}

function normalizedSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function locationMatches(request, record) {
  const place = ['city', 'district', 'address', 'title']
    .flatMap((field) => ['ru', 'en', 'es'].map((language) => localizedExact(record[field], language, 400)))
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const words = normalizedSearchText(request).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
  return words.some((word) => place.includes(word));
}

// The answers to "What kind of property?" in the selection form, in order;
// the last answer, "Any", has no group.
const SELECTION_TYPE_GROUPS = [['apartment', 'newbuild'], ['house', 'villa', 'townhouse'], ['land'], ['commercial']];

const SELECTION_TIER_ORDER = { exact: 0, close: 1, consider: 2 };

function requestedCurrency(text) {
  const value = normalizedSearchText(text);
  const words = value.split(/[^\p{L}]+/u).filter(Boolean);
  if (value.includes('$') || words.some((word) => word === 'usd' || word.startsWith('dollar') || word.startsWith('dolar') || word.startsWith('доллар'))) return 'USD';
  if (value.includes('£') || words.some((word) => word === 'gbp' || word.startsWith('pound') || word.startsWith('libra') || word.startsWith('фунт'))) return 'GBP';
  if (value.includes('₴') || words.some((word) => word === 'uah' || word === 'грн' || word.startsWith('грив'))) return 'UAH';
  if (value.includes('₽') || words.some((word) => word === 'rub' || word.startsWith('руб'))) return 'RUB';
  if (value.includes('€') || words.some((word) => word === 'eur' || word.startsWith('euro') || word === 'евро')) return 'EUR';
  return '';
}

function requestedRentPeriod(text) {
  const words = normalizedSearchText(text).split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some((word) => word.startsWith('week') || word.startsWith('semana') || word.startsWith('недел'))) return 'week';
  if (words.some((word) => word.startsWith('month') || word.startsWith('mensual') || word === 'mes' || word.startsWith('месяц') || word.startsWith('месяч'))) return 'month';
  return '';
}

function comparableRentPrice(record, period) {
  const price = Number(record.priceValue);
  if (!(price > 0)) return 0;
  const recordPeriod = record.pricePeriod === 'week' ? 'week' : 'month';
  if (period === recordPeriod) return price;
  return period === 'week' ? price * 12 / 52 : price * 52 / 12;
}

// Each requested criterion contributes to a transparent score. A deal or
// property-type mismatch is a different search, so it is rejected. Price,
// bedrooms and location may produce a useful nearby option, but missing data
// can never be called an exact match.
function selectionEvaluation(inquiry, record) {
  const selection = inquiry.selection || {};
  const copy = SELECTION_FORM_TEXT[inquiry.language] || SELECTION_FORM_TEXT.ru;
  let earned = 0;
  let possible = 0;
  const reasons = [];
  const warnings = [];

  const deal = copy.dealOptions.indexOf(selection.deal);
  if (deal === 0 || deal === 1) {
    possible += 20;
    const wantedDeal = deal === 0 ? 'sale' : 'rent';
    if (record.dealType !== wantedDeal) return null;
    earned += 20;
    reasons.push('deal');
  }

  const typeGroup = SELECTION_TYPE_GROUPS[(copy.typeOptions || []).indexOf(selection.type)];
  if (typeGroup) {
    possible += 25;
    if (!typeGroup.includes(record.propertyType)) return null;
    earned += 25;
    reasons.push('type');
  }

  if (selection.location && selection.location !== copy.anyLocation) {
    possible += 20;
    if (locationMatches(selection.location, record)) {
      earned += 20;
      reasons.push('location');
    } else {
      warnings.push('location');
    }
  }

  const limit = selection.budget && selection.budget !== copy.noBudget ? budgetLimit(selection.budget) : 0;
  if (limit) {
    possible += 20;
    const currency = cleanText(record.currency, 10).toUpperCase() || 'EUR';
    const wantedCurrency = requestedCurrency(selection.budget);
    const wantedPeriod = record.dealType === 'rent' ? (requestedRentPeriod(selection.budget) || 'month') : 'total';
    let price = Number(record.priceValue);
    if (record.dealType === 'rent') price = comparableRentPrice(record, wantedPeriod);
    if (wantedCurrency && currency !== wantedCurrency) {
      warnings.push('currency');
    } else if (!(price > 0)) {
      warnings.push('priceMissing');
    } else if (price <= limit) {
      earned += 20;
      reasons.push('budget');
      if (record.dealType === 'rent' && requestedRentPeriod(selection.budget)
        && record.pricePeriod !== requestedRentPeriod(selection.budget)) warnings.push('periodConverted');
    } else if (price <= limit * 1.1) {
      earned += 10;
      warnings.push('budgetClose');
    } else if (price <= limit * 1.25) {
      earned += 4;
      warnings.push('budgetHigh');
    } else {
      return null;
    }
  }

  const wantedBedrooms = copy.bedroomOptions.indexOf(selection.bedrooms) + 1;
  const bedrooms = Number(record.bedrooms);
  if (wantedBedrooms >= 1 && wantedBedrooms <= 4) {
    possible += 15;
    if (!(bedrooms > 0)) {
      warnings.push('bedroomsMissing');
    } else if (bedrooms >= wantedBedrooms) {
      earned += 15;
      reasons.push('bedrooms');
    } else if (bedrooms === wantedBedrooms - 1) {
      earned += 5;
      warnings.push('bedroomsClose');
    } else {
      return null;
    }
  }

  if (!possible) return { tier: 'exact', score: 100, reasons: ['general'], warnings: [] };
  const score = Math.round(earned / possible * 100);
  if (score < 40) return null;
  const hasApproximation = warnings.some((key) => key !== 'periodConverted');
  const tier = !hasApproximation ? 'exact' : score >= 70 ? 'close' : 'consider';
  return { tier, score, reasons: reasons.length ? reasons : ['general'], warnings };
}

// New-property notifications are deliberately quiet: only an exact result is
// pushed automatically. Nearby options remain visible in the requested list.
function selectionMatches(inquiry, record) {
  const evaluation = selectionEvaluation(inquiry, record);
  return Boolean(evaluation && evaluation.tier === 'exact');
}

// Published properties that already fit a selection form, best first by the
// catalog order. Shown to the client right after they send the form.
const SELECTION_MATCHES_SHOWN = 20;

function currentSelectionRanking(user, selection) {
  const language = user.preferredLanguage || 'ru';
  const request = { selection, language };
  return data.objects
    .map((record, index) => ({ record, index, evaluation: selectionEvaluation(request, record) }))
    .filter((item) => item.record.status === 'active' && propertyReadyForLanguage(item.record, language) && item.evaluation)
    .sort((left, right) => SELECTION_TIER_ORDER[left.evaluation.tier] - SELECTION_TIER_ORDER[right.evaluation.tier]
      || right.evaluation.score - left.evaluation.score
      || left.index - right.index)
    .map((item) => ({ record: item.record, ...item.evaluation }))
    .slice(0, SELECTION_MATCHES_SHOWN);
}

function currentSelectionMatches(user, selection) {
  return currentSelectionRanking(user, selection).map((item) => item.record);
}

// Who should hear about this property after it was created or saved.
// before: the status and price before the change, or null for a new record.
function propertyAlertDeliveries(record, before) {
  if (record.status !== 'active') return [];
  const deliveries = [];
  const notified = new Set();
  const becameAvailable = Boolean(before && before.status !== 'active');
  const oldPrice = Number(before && before.priceValue);
  const newPrice = Number(record.priceValue);
  const priceDropped = Boolean(before && before.status === 'active' && oldPrice > 0 && newPrice > 0 && newPrice < oldPrice);
  if (priceDropped || becameAvailable) {
    for (const user of Object.values(data.users)) {
      if (!alertsEnabled(user) || !Array.isArray(user.favorites) || !user.favorites.includes(record.id)) continue;
      if (!propertyReadyForLanguage(record, user.preferredLanguage)) continue;
      const copy = PROPERTY_ALERT_TEXT[user.preferredLanguage] || PROPERTY_ALERT_TEXT.ru;
      const key = priceDropped ? 'price:' + record.id + ':' + newPrice : 'available:' + record.id + ':' + localDayKey();
      if (user.alertsSent && user.alertsSent[key]) continue;
      const heading = priceDropped
        ? copy.priceDrop + '\n💰 ' + objectPriceText({ ...record, priceValue: oldPrice }, user.preferredLanguage) + ' → ' + objectPriceText(record, user.preferredLanguage)
        : copy.backAvailable;
      deliveries.push({ user, record, heading, key });
      notified.add(user.id);
    }
  }
  if (!before || becameAvailable) {
    // An explicit saved search has priority over the older, implicit matching
    // from a selection request. A client receives the property only once.
    for (const user of Object.values(data.users)) {
      if (!alertsEnabled(user) || notified.has(user.id) || !savedSearchMatches(user, record)) continue;
      const key = becameAvailable
        ? 'saved-available:' + record.id + ':' + localDayKey()
        : 'saved-match:' + record.id;
      if (user.alertsSent && user.alertsSent[key]) continue;
      deliveries.push({
        user,
        record,
        heading: (SAVED_SEARCH_TEXT[user.preferredLanguage] || SAVED_SEARCH_TEXT.ru).newMatch,
        key,
      });
      notified.add(user.id);
    }
    const since = Date.now() - SELECTION_ALERT_WINDOW_MS;
    const latestSelection = new Map();
    for (const inquiry of data.inquiries) {
      if (inquiry.type !== 'selection' || !inquiry.selection || Date.parse(inquiry.createdAt) < since) continue;
      if (!latestSelection.has(inquiry.userId)) latestSelection.set(inquiry.userId, inquiry);
    }
    for (const [userId, inquiry] of latestSelection) {
      const user = userById(userId);
      if (!alertsEnabled(user) || notified.has(user.id) || !propertyReadyForLanguage(record, user.preferredLanguage)) continue;
      const key = 'match:' + record.id;
      if (user.alertsSent && user.alertsSent[key]) continue;
      if (!selectionMatches(inquiry, record)) continue;
      deliveries.push({ user, record, heading: (PROPERTY_ALERT_TEXT[user.preferredLanguage] || PROPERTY_ALERT_TEXT.ru).newMatch, key });
    }
  }
  return deliveries;
}

async function sendPropertyAlert(delivery, token) {
  const { user, record, heading } = delivery;
  const language = user.preferredLanguage;
  const copy = PROPERTY_ALERT_TEXT[language] || PROPERTY_ALERT_TEXT.ru;
  const caption = ['<i>' + String(heading || '').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]) + '</i>', objectCaptionHtml(record, language)].join('\n\n');
  const buttons = contentButtons(record, language, user, 'property');
  const markup = { inline_keyboard: [...(buttons ? buttons.inline_keyboard : []), [{ text: copy.turnOff, callback_data: 'alerts:off' }]] };
  const image = recordImages(record, language)[0];
  // Sent as a separate message: the client's open catalog is left untouched.
  if (imageExists(image)) await sendPhotoMessage(user.chatId, image, caption, token, markup, { parseMode: 'HTML' });
  else await sendMessage(user.chatId, caption, token, { reply_markup: markup, parse_mode: 'HTML' });
  recordPropertyEvent(record.id, 'impressions');
}

async function deliverPropertyAlerts(deliveries, token = data.config.botToken) {
  let sent = 0;
  for (const delivery of deliveries) {
    try {
      await sendPropertyAlert(delivery, token);
      rememberAlert(delivery.user, delivery.key);
      sent += 1;
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(delivery.user);
      recordError('Уведомление об объекте', error);
    }
    await delay(PROPERTY_ALERT_SPACING_MS);
  }
  saveDataNow();
  return sent;
}

// Called after a property is created or saved in the panel. Returns how many
// clients will be notified; sending runs in the background.
// Прежняя цена нужна не только для уведомления: она остаётся на карточке
// зачёркнутой, чтобы снижение было видно всем, а не только избранному.
// Через месяц пометка снимается сама — старое снижение уже не новость.
function rememberPriceChange(record, before) {
  const oldPrice = Number(before && before.priceValue);
  const newPrice = Number(record.priceValue);
  if (!Number.isFinite(oldPrice) || oldPrice <= 0) return;
  if (Number.isFinite(newPrice) && newPrice > 0 && newPrice < oldPrice) {
    record.previousPriceValue = oldPrice;
    record.priceChangedAt = new Date().toISOString();
    return;
  }
  // Цена выросла или пропала — зачёркивать больше нечего. Равная цена не
  // считается изменением: раньше любое сохранение объекта без правки цены
  // стирало зачёркнутую старую цену, и снижение исчезало с карточки.
  if (!Number.isFinite(newPrice) || newPrice > oldPrice) {
    record.previousPriceValue = 0;
    record.priceChangedAt = '';
  }
}

// Когда объект впервые стал доступен клиентам: по этой дате дайджест находит новые.
// Прежние объекты без даты новыми не считаются.
function rememberPublication(record) {
  if (record.status === 'active' && !record.publishedAt) record.publishedAt = new Date().toISOString();
}

function queuePropertyAlerts(record, before) {
  rememberPriceChange(record, before);
  rememberPublication(record);
  if (!configured() || !data.config.active) return 0;
  const deliveries = propertyAlertDeliveries(record, before);
  if (deliveries.length) {
    void deliverPropertyAlerts(deliveries).catch((error) => recordError('Уведомления об объектах', error));
  }
  return deliveries.length;
}

async function handleAlertsCallback(query, token) {
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const copy = PROPERTY_ALERT_TEXT[user.preferredLanguage] || PROPERTY_ALERT_TEXT.ru;
  const enable = String(query.data || '') === 'alerts:on';
  user.propertyAlerts = enable;
  scheduleSave();
  await acknowledgeCallback(query, token);
  void notifyAdministratorAction(user, enable ? 'Включил уведомления об объектах' : 'Отключил уведомления об объектах');
  await sendMessage(chatId, enable ? copy.turnedOn : copy.turnedOff, token, enable
    ? { reply_markup: menuKeyboard(user.preferredLanguage || 'ru') }
    : { reply_markup: { inline_keyboard: [[{ text: copy.turnOn, callback_data: 'alerts:on' }]] } });
}

export {
  rememberPriceChange,
  ALERT_MEMORY_MS,
  PROPERTY_ALERT_SPACING_MS,
  SELECTION_ALERT_WINDOW_MS,
  SELECTION_TYPE_GROUPS,
  SELECTION_MATCHES_SHOWN,
  alertsEnabled,
  budgetLimit,
  currentSelectionMatches,
  currentSelectionRanking,
  deliverPropertyAlerts,
  handleAlertsCallback,
  locationMatches,
  propertyAlertDeliveries,
  queuePropertyAlerts,
  rememberAlert,
  selectionEvaluation,
  selectionMatches,
  sendPropertyAlert,
};
