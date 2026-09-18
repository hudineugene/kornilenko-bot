// Уведомления клиентам об объектах: избранное и подбор.

import { dayKey, delay } from './util.mjs';
import { imageExists } from './media.mjs';
import { PROPERTY_ALERT_TEXT, SELECTION_FORM_TEXT } from './texts.mjs';
import { configured, data, saveDataNow, scheduleSave } from './store.mjs';
import { recordError, recordPropertyEvent } from './analytics.mjs';
import { normalizeUser, userById } from './users.mjs';
import { sendMessage, sendPhotoMessage } from './telegram.mjs';
import { menuKeyboard } from './menus.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';
import { contentButtons, localizedExact, objectCaption, objectPriceText, propertyReadyForLanguage, recordImages } from './catalog.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { userUnavailableError } from './broadcasts.mjs';

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

// The largest amount in a free-text budget: "до 600 000 €", "1,2 млн",
// "600k", "600 mil". 0 when no amount can be read.
function budgetLimit(text) {
  const normalized = String(text || '').toLowerCase().replace(/(\d)[\s\u00a0.](?=\d{3}(?!\d))/g, '$1');
  let best = 0;
  for (const match of normalized.matchAll(/(\d+(?:[.,]\d+)?)\s*(млн|миллион\S*|mln|millones|million|m(?![\p{L}])|тыс\S*|k(?![\p{L}])|mil(?![\p{L}]))?/gu)) {
    const unit = match[2] || '';
    const multiplier = unit === 'm' || /^(млн|миллион|mln|millones|million)/.test(unit) ? 1e6 : /^(тыс|k|mil)/.test(unit) ? 1e3 : 1;
    const value = Number(match[1].replace(',', '.')) * multiplier;
    if (value >= 1000) best = Math.max(best, value);
  }
  return best;
}

function locationMatches(request, record) {
  const place = ['city', 'district', 'address', 'title']
    .flatMap((field) => ['ru', 'en', 'es'].map((language) => localizedExact(record[field], language, 400)))
    .join(' ')
    .toLowerCase();
  const words = String(request || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
  return words.some((word) => place.includes(word));
}

// Unknown data never excludes a property: a missing price or bedroom count
// passes, so the manager-worthy lead is not lost.
function selectionMatches(inquiry, record) {
  const selection = inquiry.selection || {};
  const copy = SELECTION_FORM_TEXT[inquiry.language] || SELECTION_FORM_TEXT.ru;
  const deal = copy.dealOptions.indexOf(selection.deal);
  if (deal === 0 && record.dealType !== 'sale') return false;
  if (deal === 1 && record.dealType !== 'rent') return false;
  const wantedBedrooms = copy.bedroomOptions.indexOf(selection.bedrooms) + 1;
  const bedrooms = Number(record.bedrooms);
  if (wantedBedrooms >= 1 && wantedBedrooms <= 4 && bedrooms > 0 && bedrooms < wantedBedrooms) return false;
  const limit = selection.budget && selection.budget !== copy.noBudget ? budgetLimit(selection.budget) : 0;
  const price = Number(record.priceValue);
  if (limit && price > 0 && price > limit * 1.1) return false;
  if (selection.location && selection.location !== copy.anyLocation && !locationMatches(selection.location, record)) return false;
  return true;
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
      const key = priceDropped ? 'price:' + record.id + ':' + newPrice : 'available:' + record.id + ':' + dayKey();
      if (user.alertsSent && user.alertsSent[key]) continue;
      const heading = priceDropped
        ? copy.priceDrop + '\n💰 ' + objectPriceText({ ...record, priceValue: oldPrice }, user.preferredLanguage) + ' → ' + objectPriceText(record, user.preferredLanguage)
        : copy.backAvailable;
      deliveries.push({ user, record, heading, key });
      notified.add(user.id);
    }
  }
  if (!before || becameAvailable) {
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
  const caption = [heading, objectCaption(record, language)].join('\n\n').slice(0, 1000);
  const buttons = contentButtons(record, language, user, 'property');
  const markup = { inline_keyboard: [...(buttons ? buttons.inline_keyboard : []), [{ text: copy.turnOff, callback_data: 'alerts:off' }]] };
  const image = recordImages(record, language)[0];
  // Sent as a separate message: the client's open catalog is left untouched.
  if (imageExists(image)) await sendPhotoMessage(user.chatId, image, caption, token, markup);
  else await sendMessage(user.chatId, caption, token, { reply_markup: markup });
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
      if (userUnavailableError(error)) delivery.user.blocked = true;
      recordError('Уведомление об объекте', error);
    }
    await delay(PROPERTY_ALERT_SPACING_MS);
  }
  saveDataNow();
  return sent;
}

// Called after a property is created or saved in the panel. Returns how many
// clients will be notified; sending runs in the background.
function queuePropertyAlerts(record, before) {
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
  ALERT_MEMORY_MS,
  PROPERTY_ALERT_SPACING_MS,
  SELECTION_ALERT_WINDOW_MS,
  alertsEnabled,
  budgetLimit,
  deliverPropertyAlerts,
  handleAlertsCallback,
  locationMatches,
  propertyAlertDeliveries,
  queuePropertyAlerts,
  rememberAlert,
  selectionMatches,
  sendPropertyAlert,
};
