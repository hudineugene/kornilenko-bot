// Каталог объектов: карточки, подписи, кнопки, фильтр.

import crypto from 'node:crypto';
import { cleanText, parseMoneyAmount } from './util.mjs';
import { imageBytes, imageExists } from './media.mjs';
import { CATALOG_FILTER_TEXT, COMPARISON_TEXT, EMPTY_STATE_TEXT, INTERACTION_TEXT, MANAGER_CONTACT_TEXT, MENU_LABELS, MY_AREA_TEXT, NAVIGATION_TEXT, PROPERTY_ACTION_TEXT, PROPERTY_BADGE_LABELS, PROPERTY_CONDITION_LABELS, PROPERTY_TYPE_LABELS, SAVED_SEARCH_TEXT, SELECTION_FORM_TEXT } from './texts.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordPropertyEvent } from './analytics.mjs';
import { normalizeUser } from './users.mjs';
import { knownFileId, rememberFileId, sendMessage, sendPhotoMessage, telegramMultipartRequest, telegramRequest } from './telegram.mjs';
import { menuKeyboard, sendLanguagePicker } from './menus.mjs';
import { createInquiry, notifyAdministratorAction } from './inquiries.mjs';
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

const RESIDENTIAL_PROPERTY_TYPES = new Set(['apartment', 'house', 'villa', 'townhouse', 'newbuild']);

// One publication standard for every catalog card. Drafts may stay incomplete,
// but a visible or reserved property must have enough structured information
// to look the same in every supported language.
function propertyPublicationIssues(record, language) {
  const issues = [];
  const type = cleanText(record && record.propertyType, 40);
  if (!localizedExact(record && record.title, language, 160)) issues.push('название');
  if (!localizedExact(record && record.description, language, 3000)) issues.push('описание');
  if (!localizedExact(record && record.city, language, 160)) issues.push('город');
  if (!recordImages(record, language).length) issues.push('фотография');
  if (!cleanText(record && record.reference, 80)) issues.push('номер объекта');
  if (type === 'land') {
    if (!(Number(record && record.plotArea) > 0)) issues.push('площадь участка');
  } else if (!(Number(record && record.area) > 0)) {
    issues.push('площадь');
  }
  if (RESIDENTIAL_PROPERTY_TYPES.has(type)) {
    if (!record || record.bedrooms == null || record.bedrooms === '' || !Number.isFinite(Number(record.bedrooms))) issues.push('спальни');
    if (!(Number(record && record.bathrooms) > 0)) issues.push('санузлы');
  }
  return issues;
}

function propertyPublicationReadiness(record) {
  return Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, propertyPublicationIssues(record, language)]));
}

function propertyReadyForLanguage(record, language) {
  return propertyPublicationIssues(record, language).length === 0;
}

function priceOnRequest(record, language) {
  return objectPriceText(record, language) === (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).priceOnRequest;
}

// Telegram gives every button in a row the same share of the phone width.
// Primary actions occupy a full row; only deliberately short secondary
// actions share a row. Administrator-defined labels are shortened here so a
// long customization cannot make a card unusable on a narrow screen.
function mobileButtonText(icon, label, maximum = 28) {
  return [icon, shortenedText(label, maximum)].filter(Boolean).join(' ');
}

function catalogFilterCriteriaCount(value) {
  const filter = normalizedCatalogFilter(value);
  return [filter.deal, filter.type, filter.bedrooms, filter.city, filter.district, filter.minPrice, filter.maxPrice, filter.sort]
    .filter(Boolean).length;
}

function contentButtons(record, language, user, kind = 'promotion', catalog = null) {
  const rows = [];
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if (kind === 'property') {
    // Четыре ряда вместо шести-семи. Карточка должна помещаться на экран
    // телефона целиком, иначе клиент листает кнопки вместо объектов.
    const isFavorite = Boolean(user && Array.isArray(user.favorites) && user.favorites.includes(record.id));
    const first = [];
    // Без цены самый короткий путь — спросить цену; забронированный объект
    // на просмотр не записывают, у него остаётся только «Связаться».
    const askPrice = priceOnRequest(record, language);
    const canVisit = record.status === 'active';
    if (askPrice) first.push({ text: mobileButtonText('💰', action.askPrice), callback_data: 'property:price:' + record.id });
    else if (canVisit) first.push({ text: mobileButtonText('📅', action.viewing), callback_data: 'property:viewing:' + record.id });
    first.push({ text: mobileButtonText('💬', action.contact), callback_data: 'property:manager:' + record.id });
    rows.push(first);

    // Фотографии — прямо с карточки, а не через «Подробнее»: это был самый
    // частый следующий шаг и стоил двух нажатий.
    const photos = recordImages(record, language);
    const second = [];
    // Цену спросили в первом ряду — запись на просмотр не теряется, а стоит тут.
    if (askPrice && canVisit) second.push({ text: mobileButtonText('📅', action.viewing), callback_data: 'property:viewing:' + record.id });
    if (photos.length > 1) second.push({ text: '📷 ' + action.photos + ' · ' + photos.length, callback_data: 'property:gallery:' + record.id });
    second.push({ text: mobileButtonText('📋', action.details), callback_data: 'property:details:' + record.id });
    rows.push(second);

    // Ряд значков: избранное, сравнение и переход между объектами. Подписи тут
    // не нужны — значки понятны, а место на телефоне дорого.
    const comparison = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
    const compared = Boolean(user && Array.isArray(user.comparisonIds) && user.comparisonIds.includes(record.id));
    const comparisonCount = user ? catalogRecords(user, 'comparison').length : 0;
    const icons = [
      { text: isFavorite ? '💔' : '❤️', callback_data: 'property:favorite:' + record.id },
      { text: compared ? '⚖️ · ' + comparisonCount : '⚖️', callback_data: compared ? 'compare:view' : 'property:compare:' + record.id },
    ];
    if (catalog && catalog.totalPages > 1) {
      const previousPage = (catalog.page - 1 + catalog.totalPages) % catalog.totalPages;
      const nextPage = (catalog.page + 1) % catalog.totalPages;
      icons.push({ text: '⬅️', callback_data: 'catalog:' + catalog.mode + ':' + previousPage });
      icons.push({ text: String(catalog.page + 1) + ' / ' + String(catalog.totalPages), callback_data: 'catalog:none:0' });
      icons.push({ text: '➡️', callback_data: 'catalog:' + catalog.mode + ':' + nextPage });
    }
    rows.push(icons);
  }
  const url = validHttpUrl(record.url);
  if (kind !== 'property' && url) {
    rows.push([{ text: '🌐 ' + action.viewWebsite, url }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'all' && catalog.filter && catalog.filter.available) {
    const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
    const filterCount = catalog.filter.summary ? catalogFilterCriteriaCount(user && user.catalogFilter) : 0;
    const filterRow = [{ text: shortenedText(copy.button, 24) + (filterCount ? ' · ' + filterCount : ''), callback_data: 'cfilter:open' }];
    if (catalog.filter.summary) filterRow.push({ text: mobileButtonText('💬', copy.sendToManager), callback_data: 'cfilter:manager' });
    rows.push(filterRow);
  }
  if (kind === 'property' && catalog && catalog.mode === 'recent') {
    rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).more, callback_data: 'nav:my' }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'comparison') {
    rows.push([{ text: (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).title, callback_data: 'compare:view' }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'similar' && user && user.similarPropertySourceId) {
    rows.push([{ text: mobileButtonText('⬅️', (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).backToCard), callback_data: 'property:return:' + user.similarPropertySourceId }]);
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

function numericText(value, language = 'ru', allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) return '';
  const locale = language === 'en' ? 'en-US' : language === 'es' ? 'es-ES' : 'ru-RU';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(number);
}

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£' };

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
    const currency = cleanText(record.currency, 10) || 'EUR';
    return [formatted, CURRENCY_SYMBOLS[currency.toUpperCase()] || currency, period].filter(Boolean).join(' ');
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

// The card shows the first paragraph of the description; bullet lists and
// the rest are in Details.
function descriptionTeaser(description) {
  const paragraph = String(description || '').split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^[-–—•*·▪✓✔✅☑🔹🔸]/u.test(line)) || '';
  return shortenedText(paragraph, 150);
}

// "Benidorm, Levante, Calle X 5, Benidorm" → the city is not repeated when
// the address already names it.
function locationText(parts, address) {
  const lower = address.toLowerCase();
  return parts.filter((part) => part && !(address && lower.includes(part.toLowerCase()))).concat(address ? [address] : []).join(', ');
}

function propertySpecRows(record, language) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const metre = language === 'ru' ? 'м' : 'm';
  const facts = [];
  const bedrooms = numericText(record.bedrooms, language, true);
  const bathrooms = numericText(record.bathrooms, language);
  const area = numericText(record.area, language);
  const plotArea = numericText(record.plotArea, language);
  const distanceSea = numericText(record.distanceSea, language);
  if (bedrooms) facts.push('🛏 ' + shortenedText(copy.bedroomsLabel, 22) + ': ' + bedrooms);
  if (bathrooms) facts.push('🚿 ' + shortenedText(copy.bathroomsLabel, 22) + ': ' + bathrooms);
  if (area) facts.push('📐 ' + shortenedText(copy.areaLabel, 22) + ': ' + area + ' ' + metre + '²');
  if (plotArea) facts.push('🌿 ' + shortenedText(copy.plotAreaLabel, 22) + ': ' + plotArea + ' ' + metre + '²');
  if (record.floor || record.floors) {
    const floorValue = [cleanText(record.floor, 20), cleanText(record.floors, 20)].filter(Boolean).join('/');
    facts.push('🏢 ' + shortenedText(copy.floor, 22) + ': ' + floorValue);
  }
  if (distanceSea) facts.push('🌊 ' + shortenedText(copy.distanceSeaLabel, 22) + ': ' + distanceSea + ' ' + metre);
  const rows = [];
  for (let index = 0; index < facts.length; index += 2) rows.push(facts.slice(index, index + 2).join('   ·   '));
  return rows;
}

function objectCaption(record, language, options = {}) {
  const full = Boolean(options.full);
  const maximum = Number.isFinite(Number(options.maximum))
    ? Math.max(300, Math.min(900, Number(options.maximum)))
    : 900;
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const title = localizedExact(record.title, language);
  const description = localizedExact(record.description, language);
  const address = localizedExact(record.address, language);
  const price = objectPriceText(record, language);
  const type = (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[record.propertyType] || '';
  const deal = record.dealType === 'rent'
    ? copy.forRent
    : copy.forSale;
  const place = [localizedExact(record.city, language, 160), localizedExact(record.district, language, 160)];
  const location = full ? locationText(place, address) : place.filter(Boolean).join(', ');
  const badgeNames = record.badges instanceof Array
    ? record.badges.map((badge) => (PROPERTY_BADGE_LABELS[language] || PROPERTY_BADGE_LABELS.ru)[badge]).filter(Boolean)
    : [];
  const status = record.status === 'reserved'
    ? '🟡 ' + copy.reserved
    : '🟢 ' + copy.available;
  const header = [title, [status, type, deal].filter(Boolean).join(' · ')];
  if (badgeNames.length) header.push('✦ ' + badgeNames.join(' · '));
  const commercial = [];
  if (price) commercial.push('💰 ' + price);
  if (location) commercial.push('📍 ' + location);
  const specs = propertySpecRows(record, language);
  if (!full) {
    const teaser = descriptionTeaser(description);
    const sections = [header.filter(Boolean), commercial, specs, teaser ? [teaser] : []].filter((section) => section.length);
    return shortenedText(sections.map((section) => section.join('\n')).join('\n\n'), maximum);
  }
  const details = [...specs];
  if (record.condition && (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition]) {
    details.push('🔑 ' + copy.conditionLabel + ': ' + (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition]);
  }
  if (record.reference) details.push('🏷 ' + copy.reference + ' ' + cleanText(record.reference, 80));
  const sections = [header.filter(Boolean), commercial];
  if (details.length) sections.push([copy.specificationsTitle, ...details]);
  if (description) sections.push([copy.descriptionTitle, description]);
  if (record.updatedAt) {
    const date = new Date(record.updatedAt);
    if (Number.isFinite(date.getTime())) {
      const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
      sections.push([copy.updated + ': ' + new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)]);
    }
  }
  return shortenedText(sections.filter((section) => section.length).map((section) => section.join('\n')).join('\n\n'), 3900);
}

function escapeTelegramHtml(value) {
  return String(value || '').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

function objectCaptionHtml(record, language, options = {}) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const headings = new Set([copy.specificationsTitle, copy.descriptionTitle]);
  let firstContent = true;
  return objectCaption(record, language, options).split('\n').map((line) => {
    const escaped = escapeTelegramHtml(line);
    if (!line) return '';
    if (firstContent) {
      firstContent = false;
      return '<b>' + escaped + '</b>';
    }
    if (line.startsWith('🟢 ') || line.startsWith('🟡 ') || line.startsWith('✦ ') || line.startsWith(copy.updated + ':')) return '<i>' + escaped + '</i>';
    if (line.startsWith('💰 ') || headings.has(line)) return '<b>' + escaped + '</b>';
    return escaped;
  }).join('\n');
}

function promotionBoundary(value, endOfDay) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(text + (endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'));
  return Date.parse(text);
}

function promotionIsActive(record, now = Date.now()) {
  if (!record.enabled) return false;
  const start = record.startAt ? promotionBoundary(record.startAt, false) : NaN;
  const end = record.endAt ? promotionBoundary(record.endAt, true) : NaN;
  return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end >= now);
}

// A filter is useful even in a short catalog: it also contains sorting and
// makes the way back to the chosen conditions predictable.
const CATALOG_FILTER_MIN_RECORDS = 1;
const CATALOG_FILTER_BEDROOMS = [1, 2, 3, 4];
const CATALOG_INLINE_LOCATION_LIMIT = 4;
const CATALOG_LOCATION_PAGE_SIZE = 6;

// Price limits offered in the filter: purchase prices and monthly rents.
const CATALOG_FILTER_PRICES = {
  sale: [150000, 250000, 400000, 600000, 1000000],
  rent: [800, 1200, 2000, 3000],
};

function normalizedCatalogFilter(value) {
  const filter = value && typeof value === 'object' ? value : {};
  const minPrice = Number(filter.minPrice);
  const maxPrice = Number(filter.maxPrice);
  const normalized = {
    deal: ['sale', 'rent'].includes(filter.deal) ? filter.deal : '',
    type: Object.hasOwn(PROPERTY_TYPE_LABELS.ru, filter.type) ? filter.type : '',
    bedrooms: CATALOG_FILTER_BEDROOMS.includes(Number(filter.bedrooms)) ? Number(filter.bedrooms) : 0,
    city: cleanText(filter.city, 160),
    district: cleanText(filter.district, 160),
    minPrice: Number.isFinite(minPrice) && minPrice > 0 && minPrice <= 1000000000 ? Math.round(minPrice) : 0,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 && maxPrice <= 1000000000 ? Math.round(maxPrice) : 0,
    sort: ['asc', 'desc'].includes(filter.sort) ? filter.sort : '',
  };
  // Corrupted or manually edited stored data must never produce an impossible
  // range. The established upper budget is kept and the invalid lower bound
  // is discarded; normal client input is validated before it reaches here.
  if (normalized.minPrice && normalized.maxPrice && normalized.minPrice > normalized.maxPrice) normalized.minPrice = 0;
  return normalized;
}

function catalogFilterActive(filter) {
  return Boolean(filter.deal || filter.type || filter.bedrooms || filter.city || filter.district || filter.minPrice || filter.maxPrice || filter.sort);
}

// Sorting changes only presentation, not which properties belong to a saved
// search. Keeping it out also prevents a harmless sort change from looking
// like a different search.
function catalogSearchFilter(value) {
  return { ...normalizedCatalogFilter(value), sort: '' };
}

function catalogSearchActive(value) {
  const filter = catalogSearchFilter(value);
  return Boolean(filter.deal || filter.type || filter.bedrooms || filter.city || filter.district || filter.minPrice || filter.maxPrice);
}

function normalizedSavedSearch(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const filter = catalogSearchFilter(source.filter);
  if (!catalogSearchActive(filter)) return null;
  return {
    filter,
    enabled: source.enabled !== false,
    createdAt: cleanText(source.createdAt, 40),
    updatedAt: cleanText(source.updatedAt, 40),
  };
}

function sameSavedSearch(value, filter) {
  const saved = normalizedSavedSearch(value);
  return Boolean(saved && JSON.stringify(saved.filter) === JSON.stringify(catalogSearchFilter(filter)));
}

function recordCity(record, language) {
  return localizedExact(record.city, language, 160);
}

function recordDistrict(record, language) {
  return localizedExact(record.district, language, 160);
}

function sameCity(a, b) {
  return String(a).toLocaleLowerCase() === String(b).toLocaleLowerCase();
}

// A short stable id for a city in a button: names can be longer than
// Telegram allows in callback data.
function cityKey(city) {
  return crypto.createHash('sha1').update(String(city).toLocaleLowerCase()).digest('hex').slice(0, 10);
}

// The cities of the published catalog in the client's language.
function catalogCities(records, language) {
  const cities = new Map();
  for (const record of records) {
    const city = recordCity(record, language);
    if (city && !cities.has(city.toLocaleLowerCase())) cities.set(city.toLocaleLowerCase(), city);
  }
  return Array.from(cities.values()).sort((a, b) => a.localeCompare(b));
}

// Districts depend on the chosen city. This keeps the filter compact and
// prevents two districts with the same name in different cities from being
// presented as one ambiguous option.
function catalogDistricts(records, language, city = '') {
  const districts = new Map();
  for (const record of records) {
    if (city && !sameCity(recordCity(record, language), city)) continue;
    const district = recordDistrict(record, language);
    if (district && !districts.has(district.toLocaleLowerCase())) districts.set(district.toLocaleLowerCase(), district);
  }
  return Array.from(districts.values()).sort((a, b) => a.localeCompare(b));
}

// Which price limits make sense: the chosen deal, or the only deal in the
// catalog. Mixed sale and rent prices cannot share one scale.
function catalogPriceDeal(filter, records) {
  if (filter.deal) return filter.deal;
  const deals = new Set(records.map((record) => (record.dealType === 'rent' ? 'rent' : 'sale')));
  return deals.size === 1 ? Array.from(deals)[0] : '';
}

// Build the exact filter that a facet button would produce. Counts in the
// panel therefore predict the result after the tap, including dependent
// resets such as a purchase price when switching to rent.
function catalogFacetFilter(value, facet, choice, records, language) {
  const filter = normalizedCatalogFilter(value);
  filter.sort = '';
  if (facet === 'deal') {
    filter.deal = ['sale', 'rent'].includes(choice) ? choice : '';
    const priceDeal = catalogPriceDeal(filter, records);
    if (!priceDeal || !CATALOG_FILTER_PRICES[priceDeal].includes(filter.maxPrice)) {
      filter.minPrice = 0;
      filter.maxPrice = 0;
    }
  }
  if (facet === 'type') filter.type = Object.hasOwn(PROPERTY_TYPE_LABELS.ru, choice) ? choice : '';
  if (facet === 'bedrooms') filter.bedrooms = CATALOG_FILTER_BEDROOMS.includes(Number(choice)) ? Number(choice) : 0;
  if (facet === 'city') {
    filter.city = cleanText(choice, 160);
    const validDistricts = catalogDistricts(records, language, filter.city);
    if (!filter.city || !validDistricts.some((district) => sameCity(district, filter.district))) filter.district = '';
  }
  if (facet === 'district') filter.district = cleanText(choice, 160);
  if (facet === 'priceRange') {
    filter.minPrice = 0;
    filter.maxPrice = 0;
  }
  if (facet === 'minPrice') filter.minPrice = normalizedCatalogFilter({ minPrice: choice }).minPrice;
  if (facet === 'maxPrice') {
    filter.maxPrice = normalizedCatalogFilter({ maxPrice: choice }).maxPrice;
    if (filter.minPrice && filter.maxPrice && filter.minPrice > filter.maxPrice) filter.minPrice = 0;
  }
  return filter;
}

function catalogFacetCount(records, filter, facet, choice, language) {
  return applyCatalogFilter(records, catalogFacetFilter(filter, facet, choice, records, language), language).length;
}

function countedFilterLabel(text, count, selected = false) {
  return (selected ? '✓ ' : '') + text + ' · ' + count;
}

function formattedPriceLimit(value, language) {
  const locale = language === 'en' ? 'en-US' : language === 'es' ? 'es-ES' : 'ru-RU';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value) + ' €';
}

function catalogPriceInputKeyboard(language, bound = 'max') {
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  return {
    keyboard: [[{ text: copy.cancelCustomPrice }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: cleanText(bound === 'min' ? copy.minimumPricePlaceholder : copy.customPricePlaceholder, 64),
  };
}

async function showCatalogPricePrompt(user, token, requestedBound = '') {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const bound = requestedBound === 'min' || (!requestedBound && user.pendingAction && user.pendingAction.priceBound === 'min') ? 'min' : 'max';
  const prompt = bound === 'min' ? copy.askMinimumPrice : copy.askCustomPrice;
  await sendUiMessage(user.chatId, user, prompt, token, { reply_markup: catalogPriceInputKeyboard(language, bound) });
  return true;
}

async function startCatalogPriceInput(user, token, requestedBound = 'max') {
  const priceBound = requestedBound === 'min' ? 'min' : 'max';
  user.pendingAction = { type: 'catalog_filter_price', priceBound, createdAt: new Date().toISOString() };
  user.expiredAction = null;
  scheduleSave();
  return showCatalogPricePrompt(user, token, priceBound);
}

// Нижняя граница «своей цены»: меньше — это не цена, а опечатка.
const CATALOG_PRICE_FLOOR = 100;

async function handleCatalogPriceInputMessage(message, user, token) {
  if (!user || !user.pendingAction || user.pendingAction.type !== 'catalog_filter_price') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const bound = user.pendingAction.priceBound === 'min' ? 'min' : 'max';
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text === copy.cancelCustomPrice) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.customPriceCancelled, token, { reply_markup: { remove_keyboard: true } });
    const panel = catalogFilterPanel(user);
    await sendUiMessage(user.chatId, user, panel.text, token, { reply_markup: panel.markup });
    return true;
  }
  // Цена объекта не бывает в пять евро: такое число — это опечатка или
  // количество комнат, и молча подставлять его в фильтр нельзя.
  const price = parseMoneyAmount(text);
  if (price < CATALOG_PRICE_FLOOR) {
    await sendMessage(user.chatId, copy.invalidCustomPrice, token, { reply_markup: catalogPriceInputKeyboard(language, bound) });
    return true;
  }
  const current = normalizedCatalogFilter(user.catalogFilter);
  const minPrice = bound === 'min' ? price : current.minPrice;
  const maxPrice = bound === 'max' ? price : current.maxPrice;
  if (minPrice && maxPrice && minPrice > maxPrice) {
    const conflict = copy.invalidPriceRange
      .replace('{min}', formattedPriceLimit(minPrice, language))
      .replace('{max}', formattedPriceLimit(maxPrice, language));
    await sendMessage(user.chatId, conflict, token, { reply_markup: catalogPriceInputKeyboard(language, bound) });
    return true;
  }
  user.catalogFilter = normalizedCatalogFilter({ ...current, [bound === 'min' ? 'minPrice' : 'maxPrice']: price });
  user.pendingAction = null;
  scheduleSave();
  const formatted = formattedPriceLimit(price, language);
  void notifyAdministratorAction(user, bound === 'min' ? 'Указал нижнюю границу цены в фильтре' : 'Указал верхнюю границу цены в фильтре', formatted);
  const confirmation = bound === 'min' ? copy.minimumPriceApplied : copy.customPriceApplied;
  await sendMessage(user.chatId, confirmation.replace('{price}', formatted), token, { reply_markup: { remove_keyboard: true } });
  const panel = catalogFilterPanel(user);
  await sendUiMessage(user.chatId, user, panel.text, token, { reply_markup: panel.markup });
  return true;
}

// A bedroom or price filter shows only properties where that value is known;
// sorting by price puts properties with a price on request last.
function applyCatalogFilter(records, value, language = 'ru') {
  const filter = normalizedCatalogFilter(value);
  const filtered = records.filter((record) => (!filter.deal || record.dealType === filter.deal)
    && (!filter.type || record.propertyType === filter.type)
    && (!filter.bedrooms || Number(record.bedrooms) >= filter.bedrooms)
    && (!filter.city || sameCity(recordCity(record, language), filter.city))
    && (!filter.district || sameCity(recordDistrict(record, language), filter.district))
    && (!filter.minPrice || (Number(record.priceValue) > 0 && Number(record.priceValue) >= filter.minPrice))
    && (!filter.maxPrice || (Number(record.priceValue) > 0 && Number(record.priceValue) <= filter.maxPrice)));
  if (!filter.sort) return filtered;
  const direction = filter.sort === 'desc' ? -1 : 1;
  return filtered
    .map((record, index) => ({ record, index, price: Number(record.priceValue) > 0 ? Number(record.priceValue) : null }))
    .sort((a, b) => {
      if (a.price === null || b.price === null) return a.price === b.price ? a.index - b.index : a.price === null ? 1 : -1;
      return (a.price - b.price) * direction || a.index - b.index;
    })
    .map((item) => item.record);
}

function catalogFilterSummary(value, language) {
  const filter = normalizedCatalogFilter(value);
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  return [
    filter.deal ? (filter.deal === 'rent' ? action.forRent : action.forSale) : '',
    filter.type ? (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[filter.type] : '',
    filter.city,
    filter.district,
    filter.bedrooms ? filter.bedrooms + '+ ' + copy.bedrooms : '',
    filter.minPrice ? copy.from + ' ' + formattedPriceLimit(filter.minPrice, language) : '',
    filter.maxPrice ? copy.upTo + ' ' + formattedPriceLimit(filter.maxPrice, language) : '',
    filter.sort === 'asc' ? copy.sortAsc : filter.sort === 'desc' ? copy.sortDesc : '',
  ].filter(Boolean).join(', ');
}

function selectionFromCatalogFilter(value, language) {
  const filter = normalizedCatalogFilter(value);
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const typeIndex = ['apartment', 'house', 'land', 'commercial'].indexOf(
    ['villa', 'townhouse'].includes(filter.type) ? 'house' : filter.type === 'newbuild' ? 'apartment' : filter.type,
  );
  return {
    deal: filter.deal === 'sale' ? copy.dealOptions[0] : filter.deal === 'rent' ? copy.dealOptions[1] : copy.dealOptions[2],
    type: typeIndex >= 0 ? copy.typeOptions[typeIndex] : copy.typeOptions[4],
    location: [filter.city, filter.district].filter(Boolean).join(', ') || copy.anyLocation,
    budget: [
      filter.minPrice ? (CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru).from + ' ' + formattedPriceLimit(filter.minPrice, language) : '',
      filter.maxPrice ? (CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru).upTo + ' ' + formattedPriceLimit(filter.maxPrice, language) : '',
    ].filter(Boolean).join(' ') || copy.noBudget,
    bedrooms: filter.bedrooms ? copy.bedroomOptions[Math.min(4, filter.bedrooms) - 1] : copy.bedroomOptions[4],
  };
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

// "all" is the catalog with the client's filter, "favorites" the saved
// properties, "matches" what fitted the client's last selection form and
// "similar" the ranked alternatives to the last property they opened.
const CATALOG_MODES = ['all', 'favorites', 'matches', 'similar', 'recent', 'comparison'];
const COMPARISON_LIMIT = 3;

function catalogMode(mode) {
  return CATALOG_MODES.includes(mode) ? mode : 'all';
}

function catalogHeading(mode, language) {
  if (mode === 'favorites') return (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
  if (mode === 'matches') return (SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru).matchesHeading;
  if (mode === 'similar') return (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).similarHeading;
  if (mode === 'recent') return (MY_AREA_TEXT[language] || MY_AREA_TEXT.ru).recentHeading;
  if (mode === 'comparison') return (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).title;
  return (MENU_LABELS[language] || MENU_LABELS.ru).objects;
}

function selectionMatchDetail(user, propertyId) {
  return (Array.isArray(user.selectionMatchDetails) ? user.selectionMatchDetails : [])
    .find((item) => item && String(item.id) === String(propertyId)) || null;
}

const SELECTION_REASON_KEYS = {
  deal: 'reasonDeal',
  type: 'reasonType',
  location: 'reasonLocation',
  budget: 'reasonBudget',
  bedrooms: 'reasonBedrooms',
  general: 'reasonGeneral',
};

const SELECTION_WARNING_KEYS = {
  location: 'warningLocation',
  budgetClose: 'warningBudgetClose',
  budgetHigh: 'warningBudgetHigh',
  priceMissing: 'warningPriceMissing',
  currency: 'warningCurrency',
  periodConverted: 'warningPeriodConverted',
  bedroomsClose: 'warningBedroomsClose',
  bedroomsMissing: 'warningBedroomsMissing',
};

function selectionMatchHtml(user, record, language, mode) {
  if (mode !== 'matches') return '';
  const detail = selectionMatchDetail(user, record.id);
  if (!detail) return '';
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const tierKey = detail.tier === 'exact' ? 'tierExact' : detail.tier === 'close' ? 'tierClose' : 'tierConsider';
  const reasons = (Array.isArray(detail.reasons) ? detail.reasons : [])
    .map((key) => cleanText(copy[SELECTION_REASON_KEYS[key]], 40))
    .filter(Boolean)
    .join(' · ');
  const warnings = (Array.isArray(detail.warnings) ? detail.warnings : [])
    .map((key) => cleanText(copy[SELECTION_WARNING_KEYS[key]], 50))
    .filter(Boolean)
    .join(' · ');
  const lines = ['<b>' + escapeTelegramHtml(shortenedText(copy[tierKey], 60)) + '</b>'];
  if (reasons) lines.push(escapeTelegramHtml(shortenedText(String(copy.whyMatch || '').replace('{reasons}', reasons), 180)));
  if (warnings) lines.push(escapeTelegramHtml(shortenedText(String(copy.noteMatch || '').replace('{warnings}', warnings), 180)));
  return lines.filter(Boolean).join('\n');
}

const SIMILAR_REASON_KEYS = {
  type: 'similarReasonType',
  relatedType: 'similarReasonRelatedType',
  city: 'similarReasonCity',
  district: 'similarReasonDistrict',
  price: 'similarReasonPrice',
  bedrooms: 'similarReasonBedrooms',
  area: 'similarReasonArea',
};

const SIMILAR_WARNING_KEYS = {
  priceDifferent: 'similarWarningPriceDifferent',
  priceMissing: 'similarWarningPriceMissing',
  currency: 'similarWarningCurrency',
};

function similarPropertyHtml(user, record, language, mode) {
  if (mode !== 'similar') return '';
  const detail = (Array.isArray(user.similarPropertyDetails) ? user.similarPropertyDetails : [])
    .find((item) => item && String(item.id) === String(record.id));
  if (!detail) return '';
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const reasons = (Array.isArray(detail.reasons) ? detail.reasons : [])
    .map((key) => cleanText(copy[SIMILAR_REASON_KEYS[key]], 60))
    .filter(Boolean)
    .join(' · ');
  const warnings = (Array.isArray(detail.warnings) ? detail.warnings : [])
    .map((key) => cleanText(copy[SIMILAR_WARNING_KEYS[key]], 80))
    .filter(Boolean)
    .join(' · ');
  const lines = [];
  if (reasons) lines.push(escapeTelegramHtml(shortenedText(String(copy.similarWhy || '').replace('{reasons}', reasons), 220)));
  if (warnings) lines.push(escapeTelegramHtml(shortenedText(String(copy.similarNote || '').replace('{warnings}', warnings), 220)));
  return lines.join('\n');
}

function propertyCardCaption(user, record, language, catalog) {
  const position = catalog && catalog.totalPages > 0 ? ' · ' + (catalog.page + 1) + ' / ' + catalog.totalPages : '';
  const heading = cleanText(catalog && catalog.heading, 160);
  const context = heading ? '<i>' + escapeTelegramHtml(heading + position) + '</i>' : '';
  const recommendation = selectionMatchHtml(user, record, language, catalog && catalog.mode)
    || similarPropertyHtml(user, record, language, catalog && catalog.mode);
  // Photo captions are limited by Telegram. The recommendation keeps enough
  // room while the Details button still exposes the full property text.
  const recommendationLength = recommendation.replace(/<[^>]*>/g, '').length;
  const maximum = recommendation ? Math.max(300, 950 - heading.length - position.length - recommendationLength) : 900;
  return [context, recommendation, objectCaptionHtml(record, language, { maximum })].filter(Boolean).join('\n\n');
}

function catalogRecords(user, mode = 'all') {
  const active = publishedCatalog(user);
  if (mode === 'matches') {
    const byId = new Map(active.filter((record) => record.status === 'active').map((record) => [record.id, record]));
    return (Array.isArray(user.selectionMatchIds) ? user.selectionMatchIds : []).map((id) => byId.get(String(id))).filter(Boolean);
  }
  if (mode === 'similar') {
    const byId = new Map(active.filter((record) => record.status === 'active').map((record) => [record.id, record]));
    return (Array.isArray(user.similarPropertyIds) ? user.similarPropertyIds : []).map((id) => byId.get(String(id))).filter(Boolean);
  }
  if (mode === 'recent') {
    const byId = new Map(active.map((record) => [record.id, record]));
    return (Array.isArray(user.recentlyViewed) ? user.recentlyViewed : [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
  }
  if (mode === 'comparison') {
    const byId = new Map(active.map((record) => [record.id, record]));
    return (Array.isArray(user.comparisonIds) ? user.comparisonIds : [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .slice(0, COMPARISON_LIMIT);
  }
  if (mode !== 'favorites') return applyCatalogFilter(active, user.catalogFilter, user.preferredLanguage || 'ru');
  const favorites = new Set(Array.isArray(user.favorites) ? user.favorites : []);
  return active.filter((record) => favorites.has(record.id));
}

// The property id is the stable anchor. Page numbers alone become stale when
// the administrator changes the catalog order or an object leaves the list.
function catalogPageFromContext(user, mode = 'all') {
  const records = catalogRecords(user, mode);
  if (!records.length) return 0;
  const context = user && user.catalogContext && catalogMode(user.catalogContext.mode) === catalogMode(mode)
    ? user.catalogContext
    : {};
  const propertyId = cleanText(context.propertyId, 100);
  const anchored = propertyId ? records.findIndex((record) => record.id === propertyId) : -1;
  if (anchored >= 0) return anchored;
  return Math.min(Math.max(0, Number(context.page) || 0), records.length - 1);
}

function rememberCatalogPosition(user, mode, page, record = null) {
  user.catalogContext = {
    mode: catalogMode(mode),
    page: Math.max(0, Number(page) || 0),
    propertyId: cleanText(record && record.id, 100),
  };
  scheduleSave();
}

function rememberRecentlyViewed(user, record, mode = 'all') {
  if (!user || !record || mode === 'recent') return;
  const recent = (Array.isArray(user.recentlyViewed) ? user.recentlyViewed : [])
    .map(String)
    .filter((id) => id && id !== String(record.id));
  user.recentlyViewed = [String(record.id), ...recent].slice(0, 20);
  scheduleSave();
}

// Places are stored as the client sees them. When the interface language
// changes, translate both city and district through matching properties
// instead of losing or mixing the location filter.
function translatedCatalogFilter(value, language) {
  const filter = normalizedCatalogFilter(value);
  if ((!filter.city && !filter.district) || !['ru', 'en', 'es'].includes(language)) return filter;
  const matchesLocalizedField = (record, field, valueToMatch) => !valueToMatch || ['ru', 'en', 'es']
    .some((candidate) => sameCity(field === 'city' ? recordCity(record, candidate) : recordDistrict(record, candidate), valueToMatch));
  const matched = data.objects.find((record) => matchesLocalizedField(record, 'city', filter.city)
    && matchesLocalizedField(record, 'district', filter.district));
  if (matched) {
    const city = recordCity(matched, language);
    const district = recordDistrict(matched, language);
    if (filter.city && city) filter.city = city;
    if (filter.district && district) filter.district = district;
  }
  return filter;
}

function translateCatalogFilterCity(user, language) {
  const filter = translatedCatalogFilter(user && user.catalogFilter, language);
  user.catalogFilter = catalogFilterActive(filter) ? filter : null;
  const saved = normalizedSavedSearch(user && user.savedSearch);
  if (saved) {
    saved.filter = catalogSearchFilter(translatedCatalogFilter(saved.filter, language));
    user.savedSearch = saved;
  }
  return filter;
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
  if (!records.length && mode === 'all' && filterState.summary) {
    await clearCatalogMessages(chatId, user, token);
    rememberCatalogPosition(user, 'all', 0);
    const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
    const labels = MENU_LABELS[language] || MENU_LABELS.ru;
    await sendUiMessage(chatId, user, copy.empty + '\n\n🔎 ' + filterState.summary, token, { reply_markup: { inline_keyboard: [
      [{ text: copy.button, callback_data: 'cfilter:open' }],
      [{ text: copy.reset, callback_data: 'cfilter:reset' }],
      [{ text: '💬 ' + copy.sendToManager, callback_data: 'cfilter:manager' }],
      [{ text: labels.selection, callback_data: 'selection:start' }],
      [{ text: '🏠 ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).mainMenu, callback_data: 'nav:menu' }],
    ] } });
    return true;
  }
  if (!records.length) {
    await clearCatalogMessages(chatId, user, token);
    rememberCatalogPosition(user, mode, 0);
    const empty = EMPTY_STATE_TEXT[language] || EMPTY_STATE_TEXT.ru;
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const manager = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    const text = mode === 'favorites'
      ? empty.favorites
      : mode === 'similar'
        ? action.noSimilar
        : mode === 'recent'
          ? (MY_AREA_TEXT[language] || MY_AREA_TEXT.ru).recentEmpty
          : mode === 'comparison'
            ? (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).empty
            : empty.catalog;
    const rows = [];
    if (mode !== 'all') rows.push([{ text: '🏘 ' + navigation.browse, callback_data: 'catalog:all:0' }]);
    if (mode === 'recent') rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).more, callback_data: 'nav:my' }]);
    if (mode === 'comparison') rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).more, callback_data: 'nav:my' }]);
    rows.push([{ text: manager.question, callback_data: 'contact:question' }]);
    rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
    await sendUiMessage(chatId, user, text || action.emptyFavorites, token, { reply_markup: { inline_keyboard: rows } });
    return true;
  }
  const totalPages = records.length;
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const record = records[safePage];
  rememberCatalogPosition(user, mode, safePage, record);
  const heading = catalogHeading(mode, language);
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
  const caption = propertyCardCaption(user, record, language, catalog);
  const images = recordImages(record, language);
  const markup = contentButtons(record, language, user, 'property', catalog);
  const previousMessageIds = Array.isArray(user.catalogMessageIds) ? [...user.catalogMessageIds] : [];
  const sentMessageIds = [];
  try {
    if (images.length) {
      const photoMessage = await sendPhotoMessage(chatId, images[0], caption, token, markup, { parseMode: 'HTML' });
      if (photoMessage && Number.isFinite(Number(photoMessage.message_id))) sentMessageIds.push(Number(photoMessage.message_id));
    } else {
      const textMessage = await sendMessage(chatId, caption, token, { ...(markup ? { reply_markup: markup } : {}), parse_mode: 'HTML' });
      if (textMessage && Number.isFinite(Number(textMessage.message_id))) sentMessageIds.push(Number(textMessage.message_id));
    }
  } catch (error) {
    await deleteCatalogMessages(chatId, sentMessageIds, token);
    throw error;
  }
  user.catalogMessageIds = sentMessageIds;
  rememberRecentlyViewed(user, record, catalog && catalog.mode);
  scheduleSave();
  await deleteCatalogMessages(chatId, previousMessageIds.filter((messageId) => !sentMessageIds.includes(Number(messageId))), token);
  recordPropertyEvent(record.id, 'impressions');
  return true;
}

async function editPropertyCard(chatId, user, token, message, record, catalog) {
  const messageId = Number(message && message.message_id);
  if (!Number.isFinite(messageId)) return false;
  const language = user.preferredLanguage || 'ru';
  const caption = propertyCardCaption(user, record, language, catalog);
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
            media: { type: 'photo', media: fileId, caption, parse_mode: 'HTML' },
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
          media: { type: 'photo', media: 'attach://photo', caption, parse_mode: 'HTML' },
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
        parse_mode: 'HTML',
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
  rememberRecentlyViewed(user, record, catalog && catalog.mode);
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
  const heading = catalogHeading(mode, language);
  rememberCatalogPosition(user, mode, safePage, record);
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

function catalogLocationPanel(user, facet = 'city', requestedPage = 0) {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const published = publishedCatalog(user);
  const city = filter.city || (catalogCities(published, language).length === 1 ? catalogCities(published, language)[0] : '');
  const isDistrict = facet === 'district' && Boolean(city);
  const values = isDistrict ? catalogDistricts(published, language, city) : catalogCities(published, language);
  const selected = isDistrict ? filter.district : filter.city;
  const targetFacet = isDistrict ? 'district' : 'city';
  const action = isDistrict ? 'district' : 'city';
  const choices = values.map((value) => ({
    value,
    count: catalogFacetCount(published, filter, targetFacet, value, language),
    selected: sameCity(value, selected),
  })).filter((item) => item.count > 0 || item.selected);
  const totalPages = Math.max(1, Math.ceil(choices.length / CATALOG_LOCATION_PAGE_SIZE));
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), totalPages - 1);
  const rows = [[{
    text: countedFilterLabel(isDistrict ? copy.anyDistrict : copy.anyCity, catalogFacetCount(published, filter, targetFacet, '', language), !selected),
    callback_data: 'cfilter:' + action + ':any',
  }]];
  for (const item of choices.slice(page * CATALOG_LOCATION_PAGE_SIZE, (page + 1) * CATALOG_LOCATION_PAGE_SIZE)) {
    rows.push([{
      text: countedFilterLabel(item.value, item.count, item.selected),
      callback_data: 'cfilter:' + action + ':' + cityKey(item.value),
    }]);
  }
  if (totalPages > 1) {
    rows.push([
      { text: '⬅️', callback_data: 'cfilter:' + (isDistrict ? 'districts' : 'cities') + ':' + Math.max(0, page - 1) },
      { text: String(page + 1) + ' / ' + String(totalPages), callback_data: 'cfilter:locationnone:0' },
      { text: '➡️', callback_data: 'cfilter:' + (isDistrict ? 'districts' : 'cities') + ':' + Math.min(totalPages - 1, page + 1) },
    ]);
  }
  if (isDistrict) rows.push([{ text: '↩ ' + copy.changeCity, callback_data: 'cfilter:cities:0' }]);
  rows.push([{ text: '⬅️ ' + copy.backToFilter, callback_data: 'cfilter:open' }]);
  return {
    text: isDistrict ? copy.districtPickerTitle.replace('{city}', city) : copy.cityPickerTitle,
    markup: { inline_keyboard: rows },
  };
}

function catalogFilterPanel(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const typeLabels = PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru;
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const published = publishedCatalog(user);
  const mark = (selected, text) => (selected ? '✓ ' : '') + text;
  const facetButton = (facet, choice, text, selected, callback) => {
    const count = catalogFacetCount(published, filter, facet, choice, language);
    return { count, selected, button: { text: countedFilterLabel(text, count, selected), callback_data: callback } };
  };
  // Options with no possible result disappear, except for the selected one:
  // the client must always be able to see and clear their current choice.
  const visibleButtons = (items) => items.filter((item) => item.count > 0 || item.selected).map((item) => item.button);
  const typeButtons = [facetButton('type', '', copy.anyType, !filter.type, 'cfilter:type:any')]
    .concat(Object.keys(typeLabels).map((type) => facetButton('type', type, typeLabels[type], filter.type === type, 'cfilter:type:' + type)));
  const rows = [[facetButton('deal', '', copy.anyDeal, !filter.deal, 'cfilter:deal:any').button]];
  const dealButtons = visibleButtons([
    facetButton('deal', 'sale', action.forSale, filter.deal === 'sale', 'cfilter:deal:sale'),
    facetButton('deal', 'rent', action.forRent, filter.deal === 'rent', 'cfilter:deal:rent'),
  ]);
  if (dealButtons.length) rows.push(dealButtons);
  const shownTypes = visibleButtons(typeButtons);
  if (shownTypes.length) rows.push([shownTypes[0]]);
  for (let index = 1; index < shownTypes.length; index += 2) rows.push(shownTypes.slice(index, index + 2));
  rows.push([facetButton('bedrooms', 0, copy.anyBedrooms, !filter.bedrooms, 'cfilter:bed:0').button]);
  const bedroomButtons = visibleButtons(CATALOG_FILTER_BEDROOMS.map((count) => facetButton('bedrooms', count, count + '+', filter.bedrooms === count, 'cfilter:bed:' + count)));
  for (let index = 0; index < bedroomButtons.length; index += 2) rows.push(bedroomButtons.slice(index, index + 2));
  // Cities appear once there is a choice; a chosen city stays visible even if
  // it is the only one left.
  const cities = catalogCities(published, language);
  if (cities.length > 1 || filter.city) {
    if (cities.length > CATALOG_INLINE_LOCATION_LIMIT) {
      rows.push([{
        text: countedFilterLabel(filter.city || copy.chooseCity, applyCatalogFilter(published, filter, language).length, Boolean(filter.city)),
        callback_data: 'cfilter:cities:0',
      }]);
    } else {
      const cityButtons = [facetButton('city', '', copy.anyCity, !filter.city, 'cfilter:city:any')]
        .concat(cities.map((city) => facetButton('city', city, city, sameCity(city, filter.city), 'cfilter:city:' + cityKey(city))));
      for (const button of visibleButtons(cityButtons)) rows.push([button]);
    }
  }
  // District is the second level of location. Show it after a city is chosen
  // (or when the catalog has only one city), so a large catalog stays readable.
  const districtCity = filter.city || (cities.length === 1 ? cities[0] : '');
  const districts = catalogDistricts(published, language, districtCity);
  if (districtCity && (districts.length > 1 || filter.district)) {
    if (districts.length > CATALOG_INLINE_LOCATION_LIMIT) {
      rows.push([{
        text: countedFilterLabel(filter.district || copy.chooseDistrict, applyCatalogFilter(published, filter, language).length, Boolean(filter.district)),
        callback_data: 'cfilter:districts:0',
      }]);
    } else {
      const districtButtons = [facetButton('district', '', copy.anyDistrict, !filter.district, 'cfilter:district:any')]
        .concat(districts.map((district) => facetButton('district', district, district, sameCity(district, filter.district), 'cfilter:district:' + cityKey(district))));
      for (const button of visibleButtons(districtButtons)) rows.push([button]);
    }
  }
  const priceDeal = catalogPriceDeal(filter, published);
  if (priceDeal) {
    const prices = CATALOG_FILTER_PRICES[priceDeal];
    const customPrice = filter.maxPrice && !prices.includes(filter.maxPrice) ? [filter.maxPrice] : [];
    const priceButtons = [facetButton('priceRange', 0, copy.anyPrice, !filter.minPrice && !filter.maxPrice, 'cfilter:price:0')]
      .concat(customPrice.map((price) => facetButton('maxPrice', price, copy.upTo + ' ' + formattedPriceLimit(price, language), true, 'cfilter:price:' + price)))
      .concat(prices.map((price) => facetButton('maxPrice', price, copy.upTo + ' ' + formattedPriceLimit(price, language), filter.maxPrice === price, 'cfilter:price:' + price)));
    const shownPrices = visibleButtons(priceButtons);
    if (shownPrices.length) rows.push([shownPrices[0]]);
    for (let index = 1; index < shownPrices.length; index += 2) rows.push(shownPrices.slice(index, index + 2));
    if (filter.minPrice) {
      rows.push([facetButton('minPrice', filter.minPrice, copy.from + ' ' + formattedPriceLimit(filter.minPrice, language), true, 'cfilter:minprice:' + filter.minPrice).button]);
    }
    rows.push([
      { text: '✎ ' + copy.minimumPrice, callback_data: 'cfilter:minprice:custom' },
      { text: '✎ ' + copy.customPrice, callback_data: 'cfilter:price:custom' },
    ]);
  }
  rows.push([
    { text: mark(filter.sort === 'asc', copy.sortAsc), callback_data: 'cfilter:sort:' + (filter.sort === 'asc' ? 'none' : 'asc') },
    { text: mark(filter.sort === 'desc', copy.sortDesc), callback_data: 'cfilter:sort:' + (filter.sort === 'desc' ? 'none' : 'desc') },
  ]);
  rows.push([{ text: copy.show + ': ' + applyCatalogFilter(published, filter, language).length, callback_data: 'cfilter:show' }]);
  if (catalogSearchActive(filter)) {
    const savedCopy = SAVED_SEARCH_TEXT[language] || SAVED_SEARCH_TEXT.ru;
    rows.push([{
      text: sameSavedSearch(user.savedSearch, filter)
        ? savedCopy.open
        : user.savedSearch
          ? savedCopy.update
          : savedCopy.save,
      callback_data: sameSavedSearch(user.savedSearch, filter) ? 'saved:view' : 'saved:save',
    }]);
  }
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
  if (action === 'locationnone') {
    await acknowledgeCallback(query, token);
    return;
  }
  if (action === 'cities' || action === 'districts') {
    await acknowledgeCallback(query, token);
    const locationPanel = catalogLocationPanel(user, action === 'districts' ? 'district' : 'city', Number(value) || 0);
    if (query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageText', {
          chat_id: chatId,
          message_id: query.message.message_id,
          text: locationPanel.text,
          reply_markup: locationPanel.markup,
        });
        return;
      } catch {
        // Send a new picker if Telegram can no longer edit the previous one.
      }
    }
    await sendUiMessage(chatId, user, locationPanel.text, token, { reply_markup: locationPanel.markup });
    return;
  }
  if (action === 'minprice' && value === 'custom') {
    await acknowledgeCallback(query, token);
    await startCatalogPriceInput(user, token, 'min');
    return;
  }
  if (action === 'price' && value === 'custom') {
    await acknowledgeCallback(query, token);
    await startCatalogPriceInput(user, token, 'max');
    return;
  }
  if (action === 'manager') {
    const copy = CATALOG_FILTER_TEXT[user.preferredLanguage] || CATALOG_FILTER_TEXT.ru;
    const summary = catalogFilterSummary(filter, user.preferredLanguage);
    if (!summary) {
      await acknowledgeCallback(query, token, (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).stale);
      return;
    }
    const reasons = [];
    if (filter.deal) reasons.push('deal');
    if (filter.type) reasons.push('type');
    if (filter.city || filter.district) reasons.push('location');
    if (filter.minPrice || filter.maxPrice) reasons.push('budget');
    if (filter.bedrooms) reasons.push('bedrooms');
    const matching = catalogRecords(user, 'all').filter((record) => record.status === 'active').slice(0, 20).map((record) => ({
      id: record.id,
      tier: 'exact',
      score: 100,
      reasons: reasons.length ? reasons : ['general'],
      warnings: [],
    }));
    user.selectionMatchIds = matching.map((item) => item.id);
    user.selectionMatchDetails = matching;
    createInquiry(user, copy.requestHeading + '\n\n' + summary, {
      type: 'selection',
      selection: selectionFromCatalogFilter(filter, user.preferredLanguage),
      matching: { results: matching, generatedAt: new Date().toISOString() },
    });
    scheduleSave();
    await acknowledgeCallback(query, token, copy.sentToManager);
    return;
  }
  if (action === 'show' || action === 'reset') {
    if (action === 'reset') user.catalogFilter = null;
    scheduleSave();
    await acknowledgeCallback(query, token);
    const summary = catalogFilterSummary(user.catalogFilter, user.preferredLanguage);
    if (action === 'show' && summary) void notifyAdministratorAction(user, 'Применил фильтр каталога', summary);
    await sendCatalogPage(chatId, user, token, 0, 'all');
    return;
  }
  if (action === 'deal') {
    const previousDeal = filter.deal;
    filter.deal = ['sale', 'rent'].includes(value) ? value : '';
    // Purchase and rent prices are on different scales.
    if (previousDeal !== filter.deal) {
      filter.minPrice = 0;
      filter.maxPrice = 0;
    } else {
      const priceDeal = catalogPriceDeal(filter, publishedCatalog(user));
      if (!priceDeal || !CATALOG_FILTER_PRICES[priceDeal].includes(filter.maxPrice)) filter.maxPrice = 0;
    }
  }
  if (action === 'type') filter.type = Object.hasOwn(PROPERTY_TYPE_LABELS.ru, value) ? value : '';
  if (action === 'bed') filter.bedrooms = CATALOG_FILTER_BEDROOMS.includes(Number(value)) ? Number(value) : 0;
  if (action === 'city') {
    filter.city = catalogCities(publishedCatalog(user), user.preferredLanguage).find((city) => cityKey(city) === value) || '';
    const validDistricts = catalogDistricts(publishedCatalog(user), user.preferredLanguage, filter.city);
    if (!filter.city || !validDistricts.some((district) => sameCity(district, filter.district))) filter.district = '';
  }
  if (action === 'district') {
    const cities = catalogCities(publishedCatalog(user), user.preferredLanguage);
    const districtCity = filter.city || (cities.length === 1 ? cities[0] : '');
    filter.district = catalogDistricts(publishedCatalog(user), user.preferredLanguage, districtCity)
      .find((district) => cityKey(district) === value) || '';
    if (filter.district && !filter.city && districtCity) filter.city = districtCity;
  }
  if (action === 'price') {
    filter.maxPrice = normalizedCatalogFilter({ maxPrice: value }).maxPrice;
    if (!filter.maxPrice) filter.minPrice = 0;
    else if (filter.minPrice > filter.maxPrice) filter.minPrice = 0;
  }
  if (action === 'minprice') filter.minPrice = normalizedCatalogFilter({ minPrice: value }).minPrice;
  if (action === 'sort') filter.sort = ['asc', 'desc'].includes(value) ? value : '';
  if (['deal', 'type', 'bed', 'city', 'district', 'price', 'minprice', 'sort'].includes(action)) {
    user.catalogFilter = catalogFilterActive(filter) ? filter : null;
    scheduleSave();
  }
  await acknowledgeCallback(query, token);
  const districtChoices = action === 'city' && filter.city
    ? catalogDistricts(publishedCatalog(user), user.preferredLanguage, filter.city)
    : [];
  const panel = districtChoices.length > CATALOG_INLINE_LOCATION_LIMIT
    ? catalogLocationPanel(user, 'district', 0)
    : catalogFilterPanel(user);
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
  return sendCatalogPage(chatId, user, token, catalogPageFromContext(user, 'all'), 'all');
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
  rememberCatalogPosition(user, 'all', Math.max(0, records.findIndex((item) => item.id === record.id)), record);
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
  CATALOG_FILTER_PRICES,
  CATALOG_MODES,
  COMPARISON_LIMIT,
  applyCatalogFilter,
  catalogCities,
  catalogDistricts,
  catalogHeading,
  catalogMode,
  catalogPageFromContext,
  catalogPriceDeal,
  cityKey,
  catalogFilterActive,
  catalogSearchActive,
  catalogSearchFilter,
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
  handleCatalogPriceInputMessage,
  localized,
  localizedExact,
  normalizedSavedSearch,
  normalizedCatalogFilter,
  numericText,
  objectCaption,
  objectCaptionHtml,
  objectPriceText,
  openPendingStartPayload,
  priceOnRequest,
  promotionButtons,
  promotionIsActive,
  propertyDeepLink,
  propertyIdFromStartPayload,
  propertyReadyForLanguage,
  propertyPublicationIssues,
  propertyPublicationReadiness,
  propertyShareUrl,
  publishedCatalog,
  recordImages,
  sendCatalog,
  sendCatalogPage,
  sendPropertyCard,
  sendUiMessage,
  showCatalogPricePrompt,
  startCatalogPriceInput,
  shortenedText,
  showCatalogPageFromCallback,
  sameSavedSearch,
  translateCatalogFilterCity,
  validHttpUrl,
  whatsappContactUrl,
};
