// Каталог объектов: карточки, подписи, кнопки, фильтр.

import { cleanText } from './util.mjs';
import { imageBytes, imageExists } from './media.mjs';
import { CATALOG_FILTER_TEXT, EMPTY_STATE_TEXT, MANAGER_CONTACT_TEXT, MENU_LABELS, NAVIGATION_TEXT, PROPERTY_ACTION_TEXT, PROPERTY_BADGE_LABELS, PROPERTY_CONDITION_LABELS, PROPERTY_TYPE_LABELS } from './texts.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordPropertyEvent } from './analytics.mjs';
import { normalizeUser } from './users.mjs';
import { knownFileId, rememberFileId, sendMessage, sendPhotoMessage, telegramMultipartRequest, telegramRequest } from './telegram.mjs';
import { menuKeyboard, sendLanguagePicker } from './menus.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { start } from './lifecycle.mjs';

function localized(value, language) {
  if (!value || typeof value !== 'object') return '';
  return cleanText(value[language] || value.ru || value.en || value.es, 4000);
}

function localizedExact(value, language, maximum = 4000) {
  if (!value || typeof value !== 'object') return '';
  return cleanText(value[language], maximum);
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function whatsappContactUrl(value, fallbackPhone = '') {
  const raw = cleanText(value, 500);
  const linked = validHttpUrl(raw);
  if (linked) {
    try {
      const host = new URL(linked).hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'wa.me' || host === 'api.whatsapp.com' || host.endsWith('.whatsapp.com')) return linked;
    } catch {}
  }
  const digits = String(raw || fallbackPhone || '').replace(/\D/g, '');
  return digits.length >= 7 ? 'https://wa.me/' + digits : '';
}

function recordImages(record, language) {
  if (record && record.imagesByLanguage && typeof record.imagesByLanguage === 'object') {
    if (['ru', 'en', 'es'].includes(language)) {
      const exact = record.imagesByLanguage[language];
      return Array.isArray(exact) ? exact.filter(imageExists).slice(0, 10) : [];
    }
    for (const candidate of ['ru', 'en', 'es']) {
      const images = record.imagesByLanguage[candidate];
      if (Array.isArray(images) && images.length) return images.filter(imageExists).slice(0, 10);
    }
    return [];
  }
  if (Array.isArray(record && record.images) && record.images.length) return record.images.filter(imageExists).slice(0, 10);
  return record && imageExists(record.image) ? [record.image] : [];
}

function propertyReadyForLanguage(record, language) {
  return Boolean(
    localizedExact(record && record.title, language)
    && recordImages(record, language).length
  );
}

function priceOnRequest(record, language) {
  return objectPriceText(record, language) === (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).priceOnRequest;
}

function contentButtons(record, language, user, kind = 'promotion', catalog = null) {
  const rows = [];
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if (kind === 'property') {
    const isFavorite = Boolean(user && Array.isArray(user.favorites) && user.favorites.includes(record.id));
    // Without a price the shortest path to a request is asking for it.
    if (priceOnRequest(record, language)) rows.push([{ text: '💰 ' + action.askPrice, callback_data: 'property:price:' + record.id }]);
    rows.push([{ text: '📋 ' + action.details, callback_data: 'property:details:' + record.id }]);
    rows.push([{ text: '💬 ' + action.contactManager, callback_data: 'property:manager:' + record.id }]);
    rows.push([{ text: isFavorite ? '💔 ' + action.favoriteRemoveButton : '❤️ ' + action.favoriteButton, callback_data: 'property:favorite:' + record.id }]);
  }
  const url = validHttpUrl(record.url);
  if (kind !== 'property' && url) {
    rows.push([{ text: '🌐 ' + action.viewWebsite, url }]);
  }
  if (kind === 'property' && catalog && catalog.totalPages > 1) {
    const previousPage = (catalog.page - 1 + catalog.totalPages) % catalog.totalPages;
    const nextPage = (catalog.page + 1) % catalog.totalPages;
    const navigation = [{ text: '⬅️', callback_data: 'catalog:' + catalog.mode + ':' + previousPage }];
    navigation.push({ text: String(catalog.page + 1) + ' / ' + String(catalog.totalPages), callback_data: 'catalog:none:0' });
    navigation.push({ text: '➡️', callback_data: 'catalog:' + catalog.mode + ':' + nextPage });
    rows.push(navigation);
  }
  if (kind === 'property' && catalog && catalog.mode === 'all' && catalog.filter && catalog.filter.available) {
    const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
    rows.push([{ text: cleanText(copy.button + (catalog.filter.summary ? ': ' + catalog.filter.summary : ''), 64), callback_data: 'cfilter:open' }]);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

function propertyDeepLink(record) {
  const username = cleanText(data.bot && data.bot.username, 80).replace(/^@/, '');
  const id = cleanText(record && record.id, 100);
  if (!username || !/^[A-Za-z0-9_]{5,}$/.test(username) || !/^[A-Za-z0-9_-]{8,100}$/.test(id)) return '';
  return 'https://t.me/' + username + '?start=property_' + id;
}

function propertyShareUrl(record, language) {
  const link = propertyDeepLink(record);
  if (!link) return '';
  const title = localizedExact(record.title, language) || record.reference || '';
  const text = (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).sharePrefix;
  return 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text + title);
}

function numericText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(number).replace(/\.0+$/, '') : '';
}

function objectPriceText(record, language) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const priceValue = Number(record.priceValue);
  if (Number.isFinite(priceValue) && priceValue > 0) {
    const locale = language === 'en' ? 'en-US' : language === 'es' ? 'es-ES' : 'ru-RU';
    const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(priceValue);
    const period = record.pricePeriod === 'month'
      ? copy.priceMonth
      : record.pricePeriod === 'week'
        ? copy.priceWeek
        : '';
    return [formatted, cleanText(record.currency, 10) || 'EUR', period].filter(Boolean).join(' ');
  }
  return localizedExact(record.price, language, 120) || copy.priceOnRequest;
}

function shortenedText(value, maximum) {
  const text = cleanText(value, 4000);
  if (text.length <= maximum) return text;
  const slice = text.slice(0, maximum + 1);
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf(' '));
  return slice.slice(0, boundary > Math.floor(maximum * 0.65) ? boundary + (slice[boundary] === '.' ? 1 : 0) : maximum).trimEnd() + '…';
}

function objectCaption(record, language, options = {}) {
  const full = Boolean(options.full);
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const lines = [localizedExact(record.title, language)];
  const description = localizedExact(record.description, language);
  const address = localizedExact(record.address, language);
  const price = objectPriceText(record, language);
  const type = (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[record.propertyType] || '';
  const deal = record.dealType === 'rent'
    ? copy.forRent
    : copy.forSale;
  const location = [localizedExact(record.city, language, 160), localizedExact(record.district, language, 160), address].filter(Boolean).join(', ');
  const badgeNames = record.badges instanceof Array
    ? record.badges.map((badge) => (PROPERTY_BADGE_LABELS[language] || PROPERTY_BADGE_LABELS.ru)[badge]).filter(Boolean)
    : [];
  const specs = [];
  const status = record.status === 'reserved'
    ? '🟡 ' + copy.reserved
    : '🟢 ' + copy.available;
  lines.push(status);
  if (numericText(record.bedrooms)) specs.push('🛏 ' + numericText(record.bedrooms));
  if (numericText(record.bathrooms)) specs.push('🚿 ' + numericText(record.bathrooms));
  if (numericText(record.area)) specs.push('📐 ' + numericText(record.area) + ' м²');
  if (numericText(record.plotArea)) specs.push('🌿 ' + numericText(record.plotArea) + ' м²');
  if (record.floor || record.floors) {
    const floorValue = [cleanText(record.floor, 20), cleanText(record.floors, 20)].filter(Boolean).join('/');
    specs.push(copy.floor + ' ' + floorValue);
  }
  if (numericText(record.distanceSea)) specs.push('🌊 ' + numericText(record.distanceSea) + ' м');
  if (badgeNames.length) lines.push('⭐ ' + badgeNames.join(' · '));
  if (type) lines.push(type + ' · ' + deal);
  if (price) lines.push('💰 ' + price);
  if (location) lines.push('📍 ' + location);
  if (specs.length) lines.push(specs.join('  ·  '));
  if (record.condition && (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition]) {
    lines.push('🔑 ' + (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition]);
  }
  if (record.reference) lines.push(copy.reference + ' ' + cleanText(record.reference, 80));
  if (description) lines.push('', full ? description : shortenedText(description, 280));
  if (full && record.updatedAt) {
    const date = new Date(record.updatedAt);
    if (Number.isFinite(date.getTime())) {
      const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
      lines.push('', copy.updated + ': ' + new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date));
    }
  }
  return lines.filter((line, index) => line !== '' || index > 0).join('\n').slice(0, full ? 3900 : 900);
}

function promotionIsActive(record, now = Date.now()) {
  if (!record.enabled) return false;
  const start = record.startAt ? Date.parse(record.startAt) : NaN;
  const end = record.endAt ? Date.parse(record.endAt) : NaN;
  return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end >= now);
}

// The filter only appears once the catalog is big enough to need it.
const CATALOG_FILTER_MIN_RECORDS = 6;
const CATALOG_FILTER_BEDROOMS = [1, 2, 3, 4];

function normalizedCatalogFilter(value) {
  const filter = value && typeof value === 'object' ? value : {};
  return {
    deal: ['sale', 'rent'].includes(filter.deal) ? filter.deal : '',
    type: Object.hasOwn(PROPERTY_TYPE_LABELS.ru, filter.type) ? filter.type : '',
    bedrooms: CATALOG_FILTER_BEDROOMS.includes(Number(filter.bedrooms)) ? Number(filter.bedrooms) : 0,
  };
}

function catalogFilterActive(filter) {
  return Boolean(filter.deal || filter.type || filter.bedrooms);
}

// A bedroom filter shows only properties with a known bedroom count.
function applyCatalogFilter(records, value) {
  const filter = normalizedCatalogFilter(value);
  return records.filter((record) => (!filter.deal || record.dealType === filter.deal)
    && (!filter.type || record.propertyType === filter.type)
    && (!filter.bedrooms || Number(record.bedrooms) >= filter.bedrooms));
}

function catalogFilterSummary(value, language) {
  const filter = normalizedCatalogFilter(value);
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  return [
    filter.deal ? (filter.deal === 'rent' ? action.forRent : action.forSale) : '',
    filter.type ? (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[filter.type] : '',
    filter.bedrooms ? filter.bedrooms + '+ ' + copy.bedrooms : '',
  ].filter(Boolean).join(', ');
}

function publishedCatalog(user) {
  const language = user.preferredLanguage || 'ru';
  return data.objects.filter((record) => ['active', 'reserved'].includes(record.status) && propertyReadyForLanguage(record, language));
}

// What the catalog card needs to show about the filter.
function catalogFilterState(user) {
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const active = catalogFilterActive(filter);
  return {
    available: active || publishedCatalog(user).length >= CATALOG_FILTER_MIN_RECORDS,
    summary: active ? catalogFilterSummary(filter, user.preferredLanguage || 'ru') : '',
  };
}

function catalogRecords(user, mode = 'all') {
  const active = publishedCatalog(user);
  if (mode !== 'favorites') return applyCatalogFilter(active, user.catalogFilter);
  const favorites = new Set(Array.isArray(user.favorites) ? user.favorites : []);
  return active.filter((record) => favorites.has(record.id));
}

async function deleteCatalogMessages(chatId, messageIds, token) {
  const ids = Array.from(new Set((Array.isArray(messageIds) ? messageIds : [])
    .map(Number)
    .filter(Number.isFinite)))
    .slice(0, 20)
    .reverse();
  for (const messageId of ids) {
    try {
      await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: messageId });
    } catch {
      // Old messages may already be gone or outside Telegram's deletion window.
    }
  }
}

async function clearCatalogMessages(chatId, user, token) {
  if (!user) return;
  const previous = Array.isArray(user.catalogMessageIds) ? user.catalogMessageIds.map(Number).filter(Number.isFinite) : [];
  user.catalogMessageIds = [];
  scheduleSave();
  await deleteCatalogMessages(chatId, previous, token);
}

async function clearUiMessages(chatId, user, token, exceptMessageIds = []) {
  if (!user) return;
  const except = new Set((Array.isArray(exceptMessageIds) ? exceptMessageIds : []).map(Number).filter(Number.isFinite));
  const previous = Array.isArray(user.uiMessageIds) ? user.uiMessageIds.map(Number).filter(Number.isFinite) : [];
  const removable = previous.filter((messageId) => !except.has(messageId));
  user.uiMessageIds = previous.filter((messageId) => except.has(messageId));
  scheduleSave();
  await deleteCatalogMessages(chatId, removable, token);
}

async function clearGalleryMessages(chatId, user, token) {
  if (!user) return;
  const previous = Array.isArray(user.galleryMessageIds) ? user.galleryMessageIds.map(Number).filter(Number.isFinite) : [];
  user.galleryMessageIds = [];
  scheduleSave();
  await deleteCatalogMessages(chatId, previous, token);
}

async function sendUiMessage(chatId, user, text, token, options = {}) {
  await clearUiMessages(chatId, user, token);
  const message = await sendMessage(chatId, text, token, options);
  if (message && Number.isFinite(Number(message.message_id))) {
    user.uiMessageIds = [Number(message.message_id)];
    scheduleSave();
  }
  return message;
}

async function sendCatalogPage(chatId, user, token, page = 0, mode = 'all') {
  const language = user.preferredLanguage || 'ru';
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const records = catalogRecords(user, mode);
  const filterState = catalogFilterState(user);
  if (!records.length && mode !== 'favorites' && filterState.summary) {
    await clearCatalogMessages(chatId, user, token);
    user.catalogContext = { mode: 'all', page: 0 };
    scheduleSave();
    const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
    const labels = MENU_LABELS[language] || MENU_LABELS.ru;
    await sendUiMessage(chatId, user, copy.empty + '\n\n🔎 ' + filterState.summary, token, { reply_markup: { inline_keyboard: [
      [{ text: copy.reset, callback_data: 'cfilter:reset' }],
      [{ text: labels.selection, callback_data: 'selection:start' }],
      [{ text: '🏠 ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).mainMenu, callback_data: 'nav:menu' }],
    ] } });
    return true;
  }
  if (!records.length) {
    await clearCatalogMessages(chatId, user, token);
    user.catalogContext = { mode: mode === 'favorites' ? 'favorites' : 'all', page: 0 };
    scheduleSave();
    const empty = EMPTY_STATE_TEXT[language] || EMPTY_STATE_TEXT.ru;
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const manager = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    const text = mode === 'favorites' ? empty.favorites : empty.catalog;
    const rows = [];
    if (mode === 'favorites') rows.push([{ text: '🏘 ' + navigation.browse, callback_data: 'catalog:all:0' }]);
    rows.push([{ text: manager.question, callback_data: 'contact:question' }]);
    rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
    await sendUiMessage(chatId, user, text || action.emptyFavorites, token, { reply_markup: { inline_keyboard: rows } });
    return true;
  }
  const totalPages = records.length;
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  user.catalogContext = { mode: mode === 'favorites' ? 'favorites' : 'all', page: safePage };
  scheduleSave();
  const record = records[safePage];
  const heading = mode === 'favorites'
    ? (MENU_LABELS[language] || MENU_LABELS.ru).favorites
    : (MENU_LABELS[language] || MENU_LABELS.ru).objects;
  await sendPropertyCard(chatId, user, token, record, {
    heading,
    page: safePage,
    totalPages,
    mode,
    filter: mode === 'all' ? filterState : null,
  });
  return true;
}

async function sendPropertyCard(chatId, user, token, record, catalog = null) {
  await clearUiMessages(chatId, user, token);
  const language = user.preferredLanguage || 'ru';
  const position = catalog && catalog.totalPages > 1 ? ' · ' + (catalog.page + 1) + ' / ' + catalog.totalPages : '';
  const heading = cleanText(catalog && catalog.heading, 160);
  const caption = ([heading + position, objectCaption(record, language)].filter(Boolean).join('\n\n')).slice(0, 1000);
  const images = recordImages(record, language);
  const markup = contentButtons(record, language, user, 'property', catalog);
  const previousMessageIds = Array.isArray(user.catalogMessageIds) ? [...user.catalogMessageIds] : [];
  const sentMessageIds = [];
  try {
    if (images.length) {
      const photoMessage = await sendPhotoMessage(chatId, images[0], caption, token, markup);
      if (photoMessage && Number.isFinite(Number(photoMessage.message_id))) sentMessageIds.push(Number(photoMessage.message_id));
    } else {
      const textMessage = await sendMessage(chatId, caption, token, markup ? { reply_markup: markup } : {});
      if (textMessage && Number.isFinite(Number(textMessage.message_id))) sentMessageIds.push(Number(textMessage.message_id));
    }
  } catch (error) {
    await deleteCatalogMessages(chatId, sentMessageIds, token);
    throw error;
  }
  user.catalogMessageIds = sentMessageIds;
  scheduleSave();
  await deleteCatalogMessages(chatId, previousMessageIds.filter((messageId) => !sentMessageIds.includes(Number(messageId))), token);
  recordPropertyEvent(record.id, 'impressions');
  return true;
}

async function editPropertyCard(chatId, user, token, message, record, catalog) {
  const messageId = Number(message && message.message_id);
  if (!Number.isFinite(messageId)) return false;
  const language = user.preferredLanguage || 'ru';
  const position = catalog && catalog.totalPages > 1 ? ' · ' + (catalog.page + 1) + ' / ' + catalog.totalPages : '';
  const heading = cleanText(catalog && catalog.heading, 160);
  const caption = ([heading + position, objectCaption(record, language)].filter(Boolean).join('\n\n')).slice(0, 1000);
  const images = recordImages(record, language);
  const markup = contentButtons(record, language, user, 'property', catalog);
  try {
    if (images.length && Array.isArray(message.photo) && message.photo.length) {
      const image = images[0];
      let result;
      const fileId = knownFileId(image);
      if (fileId) {
        try {
          result = await telegramRequest(token, 'editMessageMedia', {
            chat_id: chatId,
            message_id: messageId,
            media: { type: 'photo', media: fileId, caption },
            reply_markup: markup,
          });
        } catch {
          rememberFileId(image, '');
        }
      }
      if (!result) {
        const bytes = imageBytes(image);
        result = await telegramMultipartRequest(token, 'editMessageMedia', {
          chat_id: String(chatId),
          message_id: String(messageId),
          media: { type: 'photo', media: 'attach://photo', caption },
          reply_markup: markup,
          photo: new Blob([bytes], { type: image.mimeType }),
        });
        if (result && Array.isArray(result.photo) && result.photo.length) {
          rememberFileId(image, result.photo[result.photo.length - 1].file_id);
        }
      }
    } else if (!images.length && message.text) {
      await telegramRequest(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: caption,
        disable_web_page_preview: true,
        reply_markup: markup,
      });
    } else {
      return false;
    }
  } catch {
    return false;
  }
  const previous = Array.isArray(user.catalogMessageIds) ? user.catalogMessageIds.map(Number).filter(Number.isFinite) : [];
  user.catalogMessageIds = [messageId];
  scheduleSave();
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await deleteCatalogMessages(chatId, previous.filter((id) => id !== messageId));
  recordPropertyEvent(record.id, 'impressions');
  return true;
}

async function showCatalogPageFromCallback(chatId, user, token, page, mode, message) {
  const language = user.preferredLanguage || 'ru';
  const records = catalogRecords(user, mode);
  if (!records.length) return sendCatalogPage(chatId, user, token, 0, mode);
  const safePage = Math.min(Math.max(0, Number(page) || 0), records.length - 1);
  const record = records[safePage];
  const heading = mode === 'favorites'
    ? (MENU_LABELS[language] || MENU_LABELS.ru).favorites
    : (MENU_LABELS[language] || MENU_LABELS.ru).objects;
  user.catalogContext = { mode, page: safePage };
  scheduleSave();
  const edited = await editPropertyCard(chatId, user, token, message, record, {
    heading,
    page: safePage,
    totalPages: records.length,
    mode,
    filter: mode === 'all' ? catalogFilterState(user) : null,
  });
  if (edited) return true;
  await sendCatalogPage(chatId, user, token, safePage, mode);
  if (message && message.message_id) {
    try { await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: message.message_id }); } catch {}
  }
  return true;
}

function catalogFilterPanel(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const typeLabels = PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru;
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const published = publishedCatalog(user);
  const mark = (selected, text) => (selected ? '✓ ' : '') + text;
  // Only types that actually exist in the catalog are offered.
  const types = Object.keys(typeLabels).filter((type) => published.some((record) => record.propertyType === type));
  const typeButtons = [{ text: mark(!filter.type, copy.anyType), callback_data: 'cfilter:type:any' }]
    .concat(types.map((type) => ({ text: mark(filter.type === type, typeLabels[type]), callback_data: 'cfilter:type:' + type })));
  const rows = [
    [
      { text: mark(!filter.deal, copy.anyDeal), callback_data: 'cfilter:deal:any' },
      { text: mark(filter.deal === 'sale', action.forSale), callback_data: 'cfilter:deal:sale' },
      { text: mark(filter.deal === 'rent', action.forRent), callback_data: 'cfilter:deal:rent' },
    ],
  ];
  for (let index = 0; index < typeButtons.length; index += 2) rows.push(typeButtons.slice(index, index + 2));
  rows.push([{ text: mark(!filter.bedrooms, copy.anyBedrooms), callback_data: 'cfilter:bed:0' }]);
  rows.push(CATALOG_FILTER_BEDROOMS.map((count) => ({ text: mark(filter.bedrooms === count, count + '+'), callback_data: 'cfilter:bed:' + count })));
  rows.push([{ text: copy.show + ': ' + applyCatalogFilter(published, filter).length, callback_data: 'cfilter:show' }]);
  if (catalogFilterActive(filter)) rows.push([{ text: copy.reset, callback_data: 'cfilter:reset' }]);
  return { text: copy.title, markup: { inline_keyboard: rows } };
}

async function handleCatalogFilterCallback(query, token) {
  const [, action, value] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  if (!user.preferredLanguage) {
    await acknowledgeCallback(query, token);
    return sendLanguagePicker(chatId, token, '');
  }
  const filter = normalizedCatalogFilter(user.catalogFilter);
  if (action === 'show' || action === 'reset') {
    if (action === 'reset') user.catalogFilter = null;
    scheduleSave();
    await acknowledgeCallback(query, token);
    const summary = catalogFilterSummary(user.catalogFilter, user.preferredLanguage);
    if (action === 'show' && summary) void notifyAdministratorAction(user, 'Применил фильтр каталога', summary);
    await sendCatalogPage(chatId, user, token, 0, 'all');
    return;
  }
  if (action === 'deal') filter.deal = ['sale', 'rent'].includes(value) ? value : '';
  if (action === 'type') filter.type = Object.hasOwn(PROPERTY_TYPE_LABELS.ru, value) ? value : '';
  if (action === 'bed') filter.bedrooms = CATALOG_FILTER_BEDROOMS.includes(Number(value)) ? Number(value) : 0;
  if (['deal', 'type', 'bed'].includes(action)) {
    user.catalogFilter = catalogFilterActive(filter) ? filter : null;
    scheduleSave();
  }
  await acknowledgeCallback(query, token);
  const panel = catalogFilterPanel(user);
  if (action !== 'open' && query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: panel.text, reply_markup: panel.markup });
      return;
    } catch {
      // The panel is sent again below if the old one can no longer be edited.
    }
  }
  await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
}

async function sendCatalog(chatId, user, token) {
  const context = user.catalogContext && user.catalogContext.mode === 'all' ? user.catalogContext : { page: 0 };
  return sendCatalogPage(chatId, user, token, Math.max(0, Number(context.page) || 0), 'all');
}

function propertyIdFromStartPayload(payload) {
  const match = cleanText(payload, 100).match(/^property_([A-Za-z0-9_-]{8,100})$/);
  return match ? match[1] : '';
}

async function openPendingStartPayload(user, token) {
  const payload = cleanText(user && user.pendingStartPayload, 100);
  if (!payload) return false;
  user.pendingStartPayload = '';
  scheduleSave();
  const propertyId = propertyIdFromStartPayload(payload);
  if (!propertyId) return false;
  const language = user.preferredLanguage || 'ru';
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const record = data.objects.find((item) => item.id === propertyId && ['active', 'reserved'].includes(item.status) && propertyReadyForLanguage(item, language));
  if (!record) {
    await sendMessage(user.chatId, action.propertyUnavailable, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  const heading = '🏠 ' + action.propertyHeading;
  const records = catalogRecords(user, 'all');
  user.catalogContext = { mode: 'all', page: Math.max(0, records.findIndex((item) => item.id === record.id)) };
  scheduleSave();
  await sendPropertyCard(user.chatId, user, token, record, { heading, page: 0, totalPages: 1, mode: 'all' });
  return true;
}

function promotionButtons(record, language, page, totalPages) {
  const base = contentButtons(record, language);
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  // Every promotion lets the client respond with one tap.
  const rows = [[{ text: '💬 ' + action.promotionAsk, callback_data: 'promotions:ask:' + record.id }]];
  if (base && Array.isArray(base.inline_keyboard)) rows.push(...base.inline_keyboard);
  if (totalPages > 1) {
    const previousPage = (page - 1 + totalPages) % totalPages;
    const nextPage = (page + 1) % totalPages;
    rows.push([
      { text: '⬅️', callback_data: 'promotions:' + previousPage },
      { text: String(page + 1) + ' / ' + String(totalPages), callback_data: 'promotions:none' },
      { text: '➡️', callback_data: 'promotions:' + nextPage },
    ]);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

export {
  CATALOG_FILTER_BEDROOMS,
  CATALOG_FILTER_MIN_RECORDS,
  applyCatalogFilter,
  catalogFilterActive,
  catalogFilterPanel,
  catalogFilterState,
  catalogFilterSummary,
  catalogRecords,
  clearCatalogMessages,
  clearGalleryMessages,
  clearUiMessages,
  contentButtons,
  deleteCatalogMessages,
  editPropertyCard,
  handleCatalogFilterCallback,
  localized,
  localizedExact,
  normalizedCatalogFilter,
  numericText,
  objectCaption,
  objectPriceText,
  openPendingStartPayload,
  priceOnRequest,
  promotionButtons,
  promotionIsActive,
  propertyDeepLink,
  propertyIdFromStartPayload,
  propertyReadyForLanguage,
  propertyShareUrl,
  publishedCatalog,
  recordImages,
  sendCatalog,
  sendCatalogPage,
  sendPropertyCard,
  sendUiMessage,
  shortenedText,
  showCatalogPageFromCallback,
  validHttpUrl,
  whatsappContactUrl,
};
