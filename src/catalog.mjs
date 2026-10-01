// Каталог объектов: карточки, подписи, кнопки, фильтр.

import crypto from 'node:crypto';
import { cleanText, formatMoney, formatNumber, parseMoneyAmount } from './util.mjs';
import { imageBytes, imageExists } from './media.mjs';
import { CATALOG_FILTER_TEXT, COMPARISON_TEXT, EMPTY_STATE_TEXT, INTERACTION_TEXT, MANAGER_CONTACT_TEXT, MENU_LABELS, MY_AREA_TEXT, NAVIGATION_TEXT, PROPERTY_ACTION_TEXT, PROPERTY_BADGE_LABELS, PROPERTY_CONDITION_LABELS, PROPERTY_TYPE_LABELS, SAVED_SEARCH_TEXT, SELECTION_FORM_TEXT } from './texts.mjs';
import { data, scheduleSave } from './store.mjs';
import { markFunnel, recordDaily, recordPropertyEvent } from './analytics.mjs';
import { digestHeading } from './digest-text.mjs';
import { normalizeUser } from './users.mjs';
import { knownFileId, rememberFileId, sendMessage, sendPhotoMessage, telegramMultipartRequest, telegramRequest } from './telegram.mjs';
import { menuKeyboard, sendLanguagePicker } from './menus.mjs';
import { createInquiry, notifyAdministratorAction } from './inquiries.mjs';
import { acknowledgeCallback, whatsappRow } from './sections.mjs';
import { searchMessage } from './whatsapp-hot.mjs';
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

// Ссылка на чат WhatsApp. С message в поле ввода уже стоит готовый текст:
// клиент видит, что писать, а менеджер — с чем к нему пришли. Если владелец
// сам вписал text в свою ссылку, его текст остаётся.
function whatsappContactUrl(value, fallbackPhone = '', message = '') {
  const raw = cleanText(value, 500);
  const linked = validHttpUrl(raw);
  const withMessage = (link) => {
    const text = cleanText(message, 400);
    if (!text || /[?&]text=/.test(link)) return link;
    return link + (link.includes('?') ? '&' : '?') + 'text=' + encodeURIComponent(text);
  };
  if (linked) {
    try {
      const host = new URL(linked).hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'wa.me' || host === 'api.whatsapp.com' || host.endsWith('.whatsapp.com')) return withMessage(linked);
    } catch {}
  }
  const digits = String(raw || fallbackPhone || '').replace(/\D/g, '');
  return digits.length >= 7 ? withMessage('https://wa.me/' + digits) : '';
}

// Фотографии дома от языка клиента не зависят. Свой набор для языка бывает
// нужен (планировка с подписями, например), но если его нет — показываем
// общие, а не прячем объект от целого языка.
function recordImages(record, language) {
  if (record && record.imagesByLanguage && typeof record.imagesByLanguage === 'object') {
    const order = ['ru', 'en', 'es'].includes(language)
      ? [language, ...['ru', 'en', 'es'].filter((code) => code !== language)]
      : ['ru', 'en', 'es'];
    for (const candidate of order) {
      const images = record.imagesByLanguage[candidate];
      const ready = Array.isArray(images) ? images.filter(imageExists).slice(0, 10) : [];
      if (ready.length) return ready;
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
    .filter(Boolean).length + featuresOf(filter).length;
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
    if (askPrice) first.push({ text: mobileButtonText('💰', action.askPriceShort || action.askPrice), callback_data: 'property:price:' + record.id });
    else if (canVisit) first.push({ text: mobileButtonText('📅', action.viewingShort || action.viewing), callback_data: 'property:viewing:' + record.id });
    first.push({ text: mobileButtonText('💬', action.contact), callback_data: 'property:manager:' + record.id });
    rows.push(first);

    // Фотографии — прямо с карточки, а не через «Подробнее»: это был самый
    // частый следующий шаг и стоил двух нажатий.
    const photos = recordImages(record, language);
    const second = [];
    const galleryButton = photos.length > 1 ? { text: '📷 ' + action.photos + ' · ' + photos.length, callback_data: 'property:gallery:' + record.id } : null;
    const detailsButton = { text: mobileButtonText('ℹ️', action.details), callback_data: 'property:details:' + record.id };
    if (askPrice && canVisit) {
      // Цену спросили в первом ряду — запись на просмотр не теряется, а стоит тут. Больше двух кнопок в ряду не бывает:
      // «Подробнее» с фото — отдельным рядом.
      second.push({ text: mobileButtonText('📅', action.viewingShort || action.viewing), callback_data: 'property:viewing:' + record.id });
      second.push(galleryButton || detailsButton);
      rows.push(second);
      if (galleryButton) rows.push([detailsButton]);
    } else {
      if (galleryButton) second.push(galleryButton);
      second.push(detailsButton);
      rows.push(second);
    }

    // Ряд значков: избранное, сравнение и переход между объектами. Подписи тут
    // не нужны — значки понятны, а место на телефоне дорого.
    const comparison = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
    const compared = Boolean(user && Array.isArray(user.comparisonIds) && user.comparisonIds.includes(record.id));
    const comparisonCount = user ? catalogRecords(user, 'comparison').length : 0;
    const icons = [
      // Значок показывает состояние, а не действие: 🤍 — не в избранном, ❤️ — в избранном.
      { text: isFavorite ? '❤️' : '🤍', callback_data: 'property:favorite:' + record.id },
      { text: compared ? '⚖️ · ' + comparisonCount : '⚖️', callback_data: compared ? 'compare:view' : 'property:compare:' + record.id },
    ];
    if (catalog && catalog.totalPages > 1) {
      const previousPage = (catalog.page - 1 + catalog.totalPages) % catalog.totalPages;
      const nextPage = (catalog.page + 1) % catalog.totalPages;
      icons.push({ text: '◀️', callback_data: 'catalog:' + catalog.mode + ':' + previousPage });
      icons.push({ text: String(catalog.page + 1) + ' / ' + String(catalog.totalPages), callback_data: 'catalog:none:0' });
      icons.push({ text: '▶️', callback_data: 'catalog:' + catalog.mode + ':' + nextPage });
    }
    rows.push(icons);
  }
  const url = validHttpUrl(record.url);
  if (kind !== 'property' && url) {
    rows.push([{ text: '🌐 ' + action.viewWebsite, url }]);
  }
  // Видео-тур — на самой карточке: для покупателя из другой страны это
  // единственный способ «сходить» на просмотр сегодня.
  const video = kind === 'property' ? validHttpUrl(record.videoUrl) : '';
  if (video) rows.push([{ text: mobileButtonText('🎥', action.videoTour), url: video }]);
  if (kind === 'property' && catalog && catalog.mode === 'all' && catalog.filter && catalog.filter.available) {
    const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
    const filterCount = catalog.filter.summary ? catalogFilterCriteriaCount(user && user.catalogFilter) : 0;
    // Отметка, а не число: «Фильтр · 4» читалось как «4 объекта», а это было
    // число заданных условий. Какие именно условия — видно в заголовке.
    const filterRow = [{ text: shortenedText(copy.button, 24) + (filterCount ? ' ✓' : ''), callback_data: 'cfilter:open' }];
    if (catalog.filter.summary) filterRow.push({ text: mobileButtonText('💬', copy.sendToManager), callback_data: 'cfilter:manager' });
    // Когда объектов много, листать карточки по одной долго — предлагаем список. «Фильтр» и «Списком» — одним рядом.
    const listButton = kind === 'property' && catalog.totalPages > CATALOG_LIST_PAGE_SIZE
      ? { text: copy.listMode, callback_data: 'clist:' + catalog.mode + ':' + Math.floor(catalog.page / CATALOG_LIST_PAGE_SIZE) }
      : null;
    if (listButton && filterRow.length < 2) filterRow.push(listButton);
    rows.push(filterRow);
    if (listButton && filterRow.length >= 2 && !filterRow.includes(listButton)) rows.push([listButton]);
  } else if (kind === 'property' && catalog && catalog.totalPages > CATALOG_LIST_PAGE_SIZE) {
    const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
    rows.push([{ text: copy.listMode, callback_data: 'clist:' + catalog.mode + ':' + Math.floor(catalog.page / CATALOG_LIST_PAGE_SIZE) }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'recent') {
    rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).more, callback_data: 'nav:my' }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'favorites') {
    rows.push([{ text: mobileButtonText('', action.shareList, 34), callback_data: 'shared:create' }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'shared') {
    rows.push([{ text: '🏘 ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).browse, callback_data: 'catalog:all:0' }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'comparison') {
    rows.push([{ text: (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).title, callback_data: 'compare:view' }]);
  }
  if (kind === 'property' && catalog && catalog.mode === 'similar' && user && user.similarPropertySourceId) {
    rows.push([{ text: mobileButtonText('⬅️', (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).backToCard), callback_data: 'property:return:' + user.similarPropertySourceId }]);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

const START_PAYLOAD_LIMIT = 64;

function propertyDeepLink(record, source = '') {
  const username = cleanText(data.bot && data.bot.username, 80).replace(/^@/, '');
  const id = cleanText(record && record.id, 100);
  if (!username || !/^[A-Za-z0-9_]{5,}$/.test(username) || !/^[A-Za-z0-9_-]{8,100}$/.test(id)) return '';
  // Telegram принимает после ?start= не больше 64 знаков: длиннее — ссылка
  // просто не открывается. Код объекта сокращать нельзя, поэтому такая ссылка
  // невозможна, а метка источника занимает только то, что осталось.
  const prefix = 'property_' + id;
  if (prefix.length > START_PAYLOAD_LIMIT) return '';
  // Метка источника едет тем же адресом: Telegram отдаёт боту только одно
  // значение после ?start=, поэтому объект и метку разделяем двумя знаками
  // подчёркивания.
  const room = START_PAYLOAD_LIMIT - prefix.length - '__src_'.length;
  const label = room > 0 ? cleanText(source, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, room) : '';
  return 'https://t.me/' + username + '?start=property_' + id + (label ? '__src_' + label : '');
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
  return formatNumber(number, language, 2);
}

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£' };

function objectPriceText(record, language) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const priceValue = Number(record.priceValue);
  if (Number.isFinite(priceValue) && priceValue > 0) {
    const period = record.pricePeriod === 'month'
      ? copy.priceMonth
      : record.pricePeriod === 'week'
        ? copy.priceWeek
        : '';
    const currency = cleanText(record.currency, 10) || 'EUR';
    // «От»: у комплекса из нескольких квартир цена — самого дешёвого варианта.
    const prefix = record.priceFrom === true ? copy.priceFrom : '';
    return [prefix, formatMoney(priceValue, CURRENCY_SYMBOLS[currency.toUpperCase()] || currency, language, 2), period].filter(Boolean).join(' ');
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

// The card shows the first paragraph of the description, no longer than two phone lines (≈72 characters);
// bullet lists and the rest are in Details.
const TEASER_LIMIT = 72;
function descriptionTeaser(description) {
  const paragraph = String(description || '').split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^[-–—•*·▪✓✔✅☑🔹🔸]/u.test(line)) || '';
  return shortenedText(paragraph, TEASER_LIMIT);
}

// "Benidorm, Levante, Calle X 5, Benidorm" → the city is not repeated when
// the address already names it.
function locationText(parts, address) {
  const lower = address.toLowerCase();
  return parts.filter((part) => part && !(address && lower.includes(part.toLowerCase()))).concat(address ? [address] : []).join(', ');
}

// compact — для карточки в каталоге: значок и число одной строкой. Подписи
// («Спальни: 2») занимали три строки из шести, а значки понятны без слов.
// Полная карточка («Подробнее») по-прежнему с подписями.
function propertySpecRows(record, language, options = {}) {
  const compact = Boolean(options.compact);
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const metre = language === 'ru' ? 'м' : 'm';
  const facts = [];
  const bedrooms = numericText(record.bedrooms, language, true);
  const bathrooms = numericText(record.bathrooms, language);
  const area = numericText(record.area, language);
  const plotArea = numericText(record.plotArea, language);
  const distanceSea = numericText(record.distanceSea, language);
  const fact = (icon, label, value) => (compact ? icon + ' ' + value : icon + ' ' + shortenedText(label, 22) + ': ' + value);
  // Спальни, санузлы и этаж — у жилья; у участка и коммерции их нет, даже если в карточке стоит 0.
  const residential = RESIDENTIAL_PROPERTY_TYPES.has(cleanText(record.propertyType, 40));
  if (residential && bedrooms) facts.push(fact('🛏', copy.bedroomsLabel, bedrooms));
  if (residential && bathrooms) facts.push(fact('🚿', copy.bathroomsLabel, bathrooms));
  if (area) facts.push(fact('📐', copy.areaLabel, area + ' ' + metre + '²'));
  if (plotArea) facts.push(fact('🌿', copy.plotAreaLabel, plotArea + ' ' + metre + '²'));
  if (residential && (record.floor || record.floors)) {
    const floorValue = [cleanText(record.floor, 20), cleanText(record.floors, 20)].filter(Boolean).join('/');
    facts.push(fact('🏢', copy.floor, floorValue));
  }
  if (distanceSea) facts.push(fact('🌊', copy.distanceSeaLabel, distanceSea + ' ' + metre));
  if (compact) {
    // Одна длинная строка переносилась на экране телефона («🌊 150 м» оставалась сиротой): собираем строки до 30 знаков.
    const lines = [];
    let current = '';
    for (const item of facts) {
      const next = current ? current + ' · ' + item : item;
      if (current && Array.from(next).length > 30) {
        lines.push(current);
        current = item;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines;
  }
  return facts;
}

// Цена за метр — то, чем покупатели сравнивают объекты между собой. Считаем
// только для продажи и только когда есть и цена, и площадь.
function pricePerSquareMetre(record, language) {
  if (record.dealType === 'rent') return '';
  const price = Number(record.priceValue);
  const area = Number(record.area);
  if (!Number.isFinite(price) || !Number.isFinite(area) || price <= 0 || area <= 0) return '';
  const metre = language === 'ru' ? 'м' : 'm';
  const perMetre = Math.round(price / area);
  const symbol = record.currency === 'USD' ? '$' : record.currency === 'GBP' ? '£' : '€';
  return formatMoney(perMetre, symbol, language, 0) + '/' + metre + '²';
}

// «Рынок»: обычная цена за м² в районе (а если в районе мало объектов — в городе) по нашему же каталогу. Честность важнее
// полноты: сравнение показываем только когда в группе не меньше пяти объектов на продажу в одной валюте с известной
// площадью; берём медиану (одна дорогая вилла её не сдвигает), округляем до десятка — «≈ 3 300», а не «3 287».
const MARKET_MIN_RECORDS = 5;
function marketComparison(record, user, language) {
  if (!record || record.dealType === 'rent') return null;
  const own = Number(record.priceValue) / Number(record.area);
  if (!Number.isFinite(own) || own <= 0) return null;
  const key = (value) => localizedExact(value, 'ru', 160).toLowerCase();
  const comparable = publishedCatalog(user).filter((item) => item.dealType !== 'rent' && item.currency === record.currency
    && Number(item.priceValue) > 0 && Number(item.area) > 0 && key(item.city) && key(item.city) === key(record.city));
  if (!comparable.some((item) => item.id === record.id)) comparable.push(record);
  const byDistrict = key(record.district) ? comparable.filter((item) => key(item.district) === key(record.district)) : [];
  const group = byDistrict.length >= MARKET_MIN_RECORDS ? byDistrict : comparable;
  if (group.length < MARKET_MIN_RECORDS) return null;
  const values = group.map((item) => Number(item.priceValue) / Number(item.area)).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const typical = Math.round(median / 10) * 10;
  if (!(typical > 0)) return null;
  const percent = Math.round((own - median) / median * 100);
  const district = group === byDistrict ? localizedExact(record.district, language, 160) : '';
  return { place: [district, localizedExact(record.city, language, 160)].filter(Boolean).join(', '), typical, count: group.length, percent };
}

// Строка цены карточки: цена и, для продажи, цена за метр. Без значка 💰: она и так единственная жирная.
function objectPriceLine(record, language) {
  const price = objectPriceText(record, language);
  const perMetre = pricePerSquareMetre(record, language);
  return price ? price + (perMetre ? ' · ' + perMetre : '') : '';
}

function objectCaption(record, language, options = {}) {
  const full = Boolean(options.full);
  const maximum = Number.isFinite(Number(options.maximum))
    ? Math.max(300, Math.min(900, Number(options.maximum)))
    : 900;
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const title = localizedExact(record.title, language);
  const description = localizedExact(record.description, language);
  // Владелец опубликовал объект по-русски и скопировал русский текст в английскую/испанскую карточку:
  // клиент честно видит пометку, а не выдуманный перевод.
  const inRussian = language !== 'ru' && description && description === localizedExact(record.description, 'ru');
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
  // «Доступен» не пишем: это состояние по умолчанию, а строка съедала место.
  // Важно обратное — что объект уже забронирован.
  const status = record.status === 'reserved' ? '🟡 ' + copy.reserved : '';
  // Метка («Новинка») — в той же строке, что тип и сделка: отдельная строка съедала место карточки.
  const header = [title, [status, type, deal, badgeNames.length ? '✦ ' + badgeNames.join(' · ') : ''].filter(Boolean).join(' · ')];
  const commercial = [];
  const priceLine = objectPriceLine(record, language);
  if (priceLine) commercial.push(priceLine);
  if (location) commercial.push('📍 ' + location);
  const specs = propertySpecRows(record, language, { compact: !full });
  if (!full) {
    const teaser = descriptionTeaser(description);
    // Цена, место и характеристики — один блок без пустой строки: так карточка каталога не длиннее десяти строк телефона.
    const sections = [header.filter(Boolean), commercial.concat(specs), teaser ? [teaser] : [], inRussian && copy.inRussian ? [copy.inRussian] : []].filter((section) => section.length);
    return shortenedText(sections.map((section) => section.join('\n')).join('\n\n'), maximum);
  }
  const details = [...specs];
  if (record.condition && (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition]) {
    details.push('🛠 ' + copy.conditionLabel + ': ' + (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition]);
  }
  if (record.reference) details.push('🏷 ' + copy.reference + ' ' + cleanText(record.reference, 80));
  const sections = [header.filter(Boolean), commercial];
  if (details.length) sections.push([copy.specificationsTitle, ...details]);
  const market = options.market;
  if (market && copy.marketTitle) {
    const symbol = record.currency === 'USD' ? '$' : record.currency === 'GBP' ? '£' : '€';
    const metre = (language === 'ru' ? 'м' : 'm') + '²';
    const verdict = Math.abs(market.percent) < 3 ? copy.marketSame : (market.percent > 0 ? copy.marketHigher : copy.marketLower).replace('{percent}', () => String(Math.abs(market.percent)));
    sections.push([copy.marketTitle,
      copy.marketLine.replace('{place}', () => market.place).replace('{price}', () => formatMoney(market.typical, symbol, language, 0) + '/' + metre).replace('{count}', () => String(market.count)),
      verdict]);
  }
  if (description) sections.push([copy.descriptionTitle, description, ...(inRussian && copy.inRussian ? ['', copy.inRussian] : [])]);
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

// Пока снижение свежее, на карточке рядом с ценой стоит прежняя, зачёркнутая.
// Через месяц пометка снимается сама: старое снижение уже не новость.
const PRICE_DROP_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;

function priceDropVisible(record, now = Date.now()) {
  const previous = Number(record && record.previousPriceValue);
  const current = Number(record && record.priceValue);
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current) || current <= 0 || current >= previous) return false;
  const changed = Date.parse(record && record.priceChangedAt || '');
  return !Number.isFinite(changed) || now - changed <= PRICE_DROP_VISIBLE_MS;
}

function objectCaptionHtml(record, language, options = {}) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const headings = new Set([copy.specificationsTitle, copy.descriptionTitle, copy.marketTitle]);
  const priceLine = objectPriceLine(record, language);
  let contentLines = 0;
  return objectCaption(record, language, options).split('\n').map((line) => {
    const escaped = escapeTelegramHtml(line);
    if (!line) return '';
    contentLines += 1;
    if (contentLines === 1) return '<b>' + escaped + '</b>';
    // Вторая строка — «тип · сделка» (и «Забронирован», если он есть). Раньше
    // она узнавалась по значку состояния, но «Доступен» мы больше не пишем.
    if (contentLines === 2 && line !== priceLine && !line.startsWith('📍 ')) return '<i>' + escaped + '</i>';
    if (line.startsWith('🟡 ') || line.startsWith(copy.updated + ':')) return '<i>' + escaped + '</i>';
    // Цена снизилась — прежняя остаётся рядом зачёркнутой: клиенту видно, что
    // объект подешевел, а не просто «стоит столько».
    if (line === priceLine && priceDropVisible(record)) {
      const previous = escapeTelegramHtml(objectPriceText({ ...record, priceValue: record.previousPriceValue }, language));
      return '<b><s>' + previous + '</s> ' + escaped + '</b>';
    }
    if (line === priceLine || headings.has(line)) return '<b>' + escaped + '</b>';
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
// Признаки, которые клиент называет словами: «у моря», «с бассейном». В данных объекта для них отдельных полей нет, поэтому
// честно проверяем то, что есть: расстояние до моря (до 500 м) и слова в карточке, которую написал владелец. Не написано в
// карточке — объект под признак не попадает.
const CATALOG_FEATURES = ['sea', 'pool', 'terrace', 'parking', 'garden'];
const SEA_NEAR_METRES = 500;
const FEATURE_PATTERNS = {
  sea: /первая линия|первой линии|у моря|на берегу моря|beachfront|seafront|first line|frente al mar|primera l[ií]nea/iu,
  pool: /бассейн|(?<![\p{L}])pool(?![\p{L}])|piscina/iu,
  terrace: /террас|terrace|terraza/iu,
  parking: /парковк|гараж|parking|garage|garaje|aparcamiento/iu,
  garden: /(?<![\p{L}])сад(?:ом|а|у|е|ы)?(?![\p{L}])|garden|jard[ií]n/iu,
};

const featuresOf = (filter) => (Array.isArray(filter.features) ? filter.features : []);

function recordHasFeature(record, key) {
  if (key === 'sea') {
    const distance = Number(record.distanceSea);
    if (distance > 0 && distance <= SEA_NEAR_METRES) return true;
  }
  const pattern = FEATURE_PATTERNS[key];
  if (!pattern) return false;
  const text = ['ru', 'en', 'es'].map((code) => localizedExact(record.title, code, 300) + ' ' + localizedExact(record.description, code, 3000)).join(' ');
  return pattern.test(text);
}
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
  const features = Array.isArray(filter.features) ? CATALOG_FEATURES.filter((key) => featuresOf(filter).includes(key)) : [];
  if (features.length) normalized.features = features;
  // Corrupted or manually edited stored data must never produce an impossible
  // range. The established upper budget is kept and the invalid lower bound
  // is discarded; normal client input is validated before it reaches here.
  if (normalized.minPrice && normalized.maxPrice && normalized.minPrice > normalized.maxPrice) normalized.minPrice = 0;
  return normalized;
}

function catalogFilterActive(filter) {
  return Boolean(filter.deal || filter.type || filter.bedrooms || filter.city || filter.district || filter.minPrice || filter.maxPrice || featuresOf(filter).length || filter.sort);
}

// Sorting changes only presentation, not which properties belong to a saved
// search. Keeping it out also prevents a harmless sort change from looking
// like a different search.
function catalogSearchFilter(value) {
  return { ...normalizedCatalogFilter(value), sort: '' };
}

function catalogSearchActive(value) {
  const filter = catalogSearchFilter(value);
  return Boolean(filter.deal || filter.type || filter.bedrooms || filter.city || filter.district || filter.minPrice || filter.maxPrice || featuresOf(filter).length);
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
  if (deals.size === 1) return Array.from(deals)[0];
  // Бюджет клиент хочет задать первым, до «Продажа / Аренда»: пока сделка не выбрана, в смешанном
  // каталоге показываем пороги продажи, а выбор цены сам ставит «Продажа» (это видно в подписи фильтра).
  return deals.size > 1 ? 'sale' : '';
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
  if (facet === 'feature' && CATALOG_FEATURES.includes(choice)) {
    filter.features = featuresOf(filter).includes(choice) ? featuresOf(filter).filter((key) => key !== choice) : CATALOG_FEATURES.filter((key) => key === choice || featuresOf(filter).includes(key));
  }
  if (facet === 'priceRange') {
    filter.minPrice = 0;
    filter.maxPrice = 0;
  }
  if ((facet === 'minPrice' || facet === 'maxPrice') && !filter.deal) filter.deal = catalogPriceDeal(filter, records);
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

// Кнопки главного экрана фильтра — без счётчиков: «✓ Продажа и аренда · 5» в тройном ряду обрезалось, а
// «· 5» на коротких кнопках читалось как «1+·4». Число подходящих объектов — на «Показать» и в заголовке.
const FILTER_TYPE_LABELS = {
  ru: { apartment: 'Квартира', house: 'Дом', villa: 'Вилла', townhouse: 'Таунхаус', land: 'Участок', commercial: 'Коммерция', newbuild: 'Новостр.', other: 'Другое' },
  en: { apartment: 'Apartment', house: 'House', villa: 'Villa', townhouse: 'Townhouse', land: 'Land', commercial: 'Commercial', newbuild: 'New build', other: 'Other' },
  es: { apartment: 'Piso', house: 'Casa', villa: 'Villa', townhouse: 'Adosado', land: 'Terreno', commercial: 'Comercial', newbuild: 'Obra nueva', other: 'Otro' },
};

function markedFilterLabel(text, selected = false) {
  return (selected ? '✓ ' : '') + text;
}

function formattedPriceLimit(value, language) {
  return formatMoney(value, '€', language, 0);
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
    await sendMessage(user.chatId, copy.customPriceCancelled, token, { reply_markup: menuKeyboard(language) });
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
      .replace('{min}', () => (formattedPriceLimit(minPrice, language)))
      .replace('{max}', () => (formattedPriceLimit(maxPrice, language)));
    await sendMessage(user.chatId, conflict, token, { reply_markup: catalogPriceInputKeyboard(language, bound) });
    return true;
  }
  user.catalogFilter = normalizedCatalogFilter({ ...current, [bound === 'min' ? 'minPrice' : 'maxPrice']: price });
  if (!user.catalogFilter.deal) user.catalogFilter.deal = catalogPriceDeal(user.catalogFilter, publishedCatalog(user));
  user.pendingAction = null;
  scheduleSave();
  const formatted = formattedPriceLimit(price, language);
  void notifyAdministratorAction(user, bound === 'min' ? 'Указал нижнюю границу цены в фильтре' : 'Указал верхнюю границу цены в фильтре', formatted);
  const confirmation = bound === 'min' ? copy.minimumPriceApplied : copy.customPriceApplied;
  await sendMessage(user.chatId, confirmation.replace('{price}', () => (formatted)), token, { reply_markup: menuKeyboard(language) });
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
    && (!filter.maxPrice || (Number(record.priceValue) > 0 && Number(record.priceValue) <= filter.maxPrice))
    && featuresOf(filter).every((key) => recordHasFeature(record, key)));
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

function featureLabel(copy, key) {
  return copy['feature' + key.charAt(0).toUpperCase() + key.slice(1)] || key;
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
    ...featuresOf(filter).map((key) => featureLabel(copy, key).replace(/^\P{L}+/u, '').toLocaleLowerCase(language)),
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
const CATALOG_MODES = ['all', 'favorites', 'matches', 'similar', 'recent', 'comparison', 'digest', 'shared'];
const COMPARISON_LIMIT = 3;

function catalogMode(mode) {
  return CATALOG_MODES.includes(mode) ? mode : 'all';
}

// «Что понял бот»: над карточкой в каталоге с условиями — «🔎 Вилла · у моря · бассейн — подходит: 1». Без условий заголовка нет.
function understoodLine(user, language, count) {
  const summary = user ? catalogFilterState(user).summary : '';
  if (!summary) return '';
  const wizard = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const found = (count === 1 && wizard.wizardFoundOne ? wizard.wizardFoundOne : wizard.wizardFound).replace('{count}', () => String(count));
  // Не длиннее двух строк телефона (≈72 знака): условия сокращаются, число подходящих остаётся.
  return '🔎 ' + shortenedText(summary.replace(/, /g, ' · '), Math.max(20, 70 - Array.from(found).length - 3)) + ' — ' + found;
}

function catalogHeading(mode, language, user = null, count = 0) {
  if (mode === 'all') return understoodLine(user, language, count) || (MENU_LABELS[language] || MENU_LABELS.ru).objects;
  if (mode === 'favorites') return (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
  if (mode === 'matches') return (SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru).matchesHeading;
  if (mode === 'similar') return (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).similarHeading;
  if (mode === 'recent') return (MY_AREA_TEXT[language] || MY_AREA_TEXT.ru).recentHeading;
  if (mode === 'digest') return digestHeading(language);
  if (mode === 'comparison') return (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).title;
  if (mode === 'shared') return (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).sharedHeading.replace('{count}', () => String(count || ''));
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
  if (reasons) lines.push(escapeTelegramHtml(shortenedText(String(copy.whyMatch || '').replace('{reasons}', () => (reasons)), 180)));
  if (warnings) lines.push(escapeTelegramHtml(shortenedText(String(copy.noteMatch || '').replace('{warnings}', () => (warnings)), 180)));
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
    // Не больше трёх причин: остальное — шум на карточке.
    .slice(0, 3)
    .join(' · ');
  const warnings = (Array.isArray(detail.warnings) ? detail.warnings : [])
    .map((key) => cleanText(copy[SIMILAR_WARNING_KEYS[key]], 80))
    .filter(Boolean)
    .join(' · ');
  const lines = [];
  if (reasons) lines.push(escapeTelegramHtml(shortenedText(String(copy.similarWhy || '').replace('{reasons}', () => (reasons)), 220)));
  if (warnings) lines.push(escapeTelegramHtml(shortenedText(String(copy.similarNote || '').replace('{warnings}', () => (warnings)), 220)));
  return lines.join('\n');
}

function propertyCardCaption(user, record, language, catalog) {
  // Номер объекта в списке не повторяем: он и так на кнопке между стрелками.
  // Общий каталог заголовка над карточкой не получает: «🏘 Объекты» съедало две строки. Он нужен там, где
  // список особый — избранное, похожие, подобранные, сравнение.
  const plainHeading = cleanText(catalog && catalog.heading, 160);
  const heading = plainHeading === (MENU_LABELS[language] || MENU_LABELS.ru).objects ? '' : plainHeading;
  const position = '';
  const context = heading ? '<i>' + escapeTelegramHtml(heading) + '</i>' : '';
  const recommendation = selectionMatchHtml(user, record, language, catalog && catalog.mode)
    || similarPropertyHtml(user, record, language, catalog && catalog.mode);
  // Photo captions are limited by Telegram. The recommendation keeps enough
  // room while the Details button still exposes the full property text.
  const recommendationLength = recommendation.replace(/<[^>]*>/g, '').length;
  const maximum = recommendation ? Math.max(300, 950 - heading.length - position.length - recommendationLength) : 900;
  // Строка «что понял бот» в каталоге стоит вплотную к карточке, без пустой строки: так карточка с условиями не длиннее 12 строк.
  const separator = catalog && catalog.mode === 'all' && plainHeading.startsWith('🔎 ') && !recommendation ? '\n' : '\n\n';
  return [context, recommendation, objectCaptionHtml(record, language, { maximum })].filter(Boolean).join(separator);
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
  if (mode === 'digest') {
    const byId = new Map(active.filter((record) => record.status === 'active').map((record) => [record.id, record]));
    return (Array.isArray(user.digestIds) ? user.digestIds : []).map((id) => byId.get(String(id))).filter(Boolean);
  }
  if (mode === 'recent') {
    const byId = new Map(active.map((record) => [record.id, record]));
    return (Array.isArray(user.recentlyViewed) ? user.recentlyViewed : [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
  }
  if (mode === 'shared') {
    const list = sharedListByCode(user && user.sharedListCode);
    const byId = new Map(active.map((record) => [record.id, record]));
    return list ? list.ids.map((id) => byId.get(String(id))).filter(Boolean) : [];
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

// Where the client is in the list, taken from what the bot remembers rather
// than from the card text: the position was removed from the caption, and a
// context parsed from it came out as «page 1 of 1» — the «⬅️ 3/4 ➡️» row, the
// filter and «list» buttons vanished after «Details → Collapse» or
// «Photos → back to the card».
function catalogViewContext(user, record, language) {
  const remembered = catalogMode(user && user.catalogContext && user.catalogContext.mode);
  let mode = 'all';
  let records = catalogRecords(user, remembered);
  if (records.some((item) => item.id === record.id)) mode = remembered;
  else records = catalogRecords(user, 'all');
  const index = records.findIndex((item) => item.id === record.id);
  return {
    mode,
    page: Math.max(0, index),
    totalPages: Math.max(1, records.length),
    heading: catalogHeading(mode, language, user, records.length),
    filter: mode === 'all' ? catalogFilterState(user) : null,
  };
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

// --- Список объектов --------------------------------------------------------
// Одно сообщение на восемь строк: тип, город, цена, спальни. Когда объектов
// десятки, листать карточки по одной — самый долгий способ их посмотреть.
const CATALOG_LIST_PAGE_SIZE = 8;

function catalogListLine(record, language, number) {
  const type = (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[record.propertyType] || '';
  const city = localizedExact(record.city, language, 80);
  const price = objectPriceText(record, language);
  const bedrooms = Number(record.bedrooms) > 0 ? record.bedrooms + ' ' + (language === 'ru' ? 'сп.' : language === 'es' ? 'dorm.' : 'bed') : '';
  const area = Number(record.area) > 0 ? numericText(record.area, language) + ' ' + (language === 'ru' ? 'м' : 'm') + '²' : '';
  // «250 000 € · 2 сп. · 70 м² · Бенидорм»: то, чем объекты различаются, а не «Квартира · Бенидорм» пять раз подряд. Тип — только у
  // необычного (вилла, участок): квартира подразумевается. Строка не длиннее 38 знаков: длиннее — переносится, и восемь объектов
  // занимают шестнадцать строк.
  const LIMIT = 38;
  const prefix = String(number) + '. ';
  const build = (list) => prefix + list.filter(Boolean).join(' · ');
  const kind = record.propertyType && record.propertyType !== 'apartment' ? type : '';
  // Город целиком или никак («Benid…» ничего не говорит): если не помещается, сначала уходит площадь, потом спальни, потом город.
  const variants = [
    [kind, price, bedrooms, area, city],
    [kind, price, bedrooms, '', city],
    [kind, price, '', '', city],
    [kind, price, bedrooms, area],
    [kind, price, bedrooms],
    [kind, price],
  ];
  const chosen = variants.find((list) => Array.from(build(list)).length <= LIMIT) || variants[variants.length - 1];
  return build(chosen);
}

function catalogListPanel(user, records, page, mode) {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const pages = Math.max(1, Math.ceil(records.length / CATALOG_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const shown = records.slice(safePage * CATALOG_LIST_PAGE_SIZE, (safePage + 1) * CATALOG_LIST_PAGE_SIZE);
  const lines = shown.map((record, index) => catalogListLine(record, language, safePage * CATALOG_LIST_PAGE_SIZE + index + 1));
  const rows = [];
  // Номера — по четыре в ряд: так восемь объектов занимают две строки кнопок.
  for (let index = 0; index < shown.length; index += 4) {
    rows.push(shown.slice(index, index + 4).map((record, position) => ({
      text: String(safePage * CATALOG_LIST_PAGE_SIZE + index + position + 1),
      callback_data: 'catalog:' + mode + ':' + records.indexOf(record),
    })));
  }
  if (pages > 1) {
    rows.push([
      { text: '◀️', callback_data: 'clist:' + mode + ':' + ((safePage - 1 + pages) % pages) },
      { text: String(safePage + 1) + ' / ' + String(pages), callback_data: 'catalog:none:0' },
      { text: '▶️', callback_data: 'clist:' + mode + ':' + ((safePage + 1) % pages) },
    ]);
  }
  rows.push([{ text: copy.cardMode, callback_data: 'catalog:' + mode + ':' + (safePage * CATALOG_LIST_PAGE_SIZE) }]);
  if (mode === 'all') rows.push([{ text: copy.button, callback_data: 'cfilter:open' }]);
  rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
  return {
    text: [copy.listTitle + ' · ' + records.length, lines.join('\n'), copy.listHint].filter(Boolean).join('\n\n'),
    markup: { inline_keyboard: rows },
  };
}

async function sendCatalogList(chatId, user, token, page = 0, mode = 'all') {
  const records = catalogRecords(user, mode);
  if (!records.length) return sendCatalogPage(chatId, user, token, 0, mode);
  await clearCatalogMessages(chatId, user, token);
  const panel = catalogListPanel(user, records, page, mode);
  await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
  return true;
}

async function handleCatalogListCallback(query, token) {
  const [, mode, page] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  const records = catalogRecords(user, CATALOG_MODES.includes(mode) ? mode : 'all');
  if (!records.length) return sendCatalogPage(chatId, user, token, 0, mode);
  const panel = catalogListPanel(user, records, Number(page) || 0, CATALOG_MODES.includes(mode) ? mode : 'all');
  if (query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', {
        chat_id: chatId,
        message_id: query.message.message_id,
        text: panel.text,
        reply_markup: panel.markup,
      });
      return true;
    } catch {
      // Сообщение уже не изменить — покажем список заново.
    }
  }
  await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
  return true;
}

// Условия чуть мягче тех, под которые ничего не нашлось. Пробуем по одному, от
// самого безобидного: бюджет +20 %, без района, без города, на спальню меньше,
// без типа. Возвращаем первое, где что-то есть.
function relaxedCatalogFilter(user) {
  const language = user.preferredLanguage || 'ru';
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const published = publishedCatalog(user);
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const steps = [];
  // «change» — что именно смягчили: «Без условия „Дом“», а не голое «Сад» (как раньше выглядело «Ближайшие варианты: 1 — Сад»).
  const raised = Math.ceil((filter.maxPrice * 1.2) / 1000) * 1000;
  if (filter.maxPrice) steps.push({ filter: { ...filter, maxPrice: raised }, change: copy.changePrice.replace('{value}', () => formattedPriceLimit(raised, language)) });
  if (filter.district) steps.push({ filter: { ...filter, district: '' }, change: copy.changeDistrict.replace('{value}', () => filter.district) });
  if (filter.city) steps.push({ filter: { ...filter, city: '', district: '' }, change: copy.relaxCity.replace('{value}', () => filter.city) });
  if (filter.bedrooms > 1) steps.push({ filter: { ...filter, bedrooms: filter.bedrooms - 1 }, change: copy.changeBedrooms });
  if (filter.type) steps.push({ filter: { ...filter, type: '' }, change: copy.changeType.replace('{value}', () => (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[filter.type] || filter.type) });
  for (const step of steps) {
    const count = applyCatalogFilter(published, step.filter, language).length;
    if (count) return { filter: step.filter, count, change: step.change, summary: catalogFilterSummary(step.filter, language) };
  }
  return null;
}

// Пример запроса для приветствия берём из настоящего каталога: чтобы клиент,
// написавший его слово в слово, что-то получил. Пока подходящего объекта нет,
// примера просто нет.
const EXAMPLE_FEATURE_PHRASES = {
  ru: { pool: 'с бассейном', sea: 'у моря', terrace: 'с террасой', garden: 'с садом', parking: 'с парковкой' },
  en: { pool: 'with a pool', sea: 'by the sea', terrace: 'with a terrace', garden: 'with a garden', parking: 'with parking' },
  es: { pool: 'con piscina', sea: 'cerca del mar', terrace: 'con terraza', garden: 'con jardín', parking: 'con parking' },
};

function searchExampleText(user, language) {
  const record = publishedCatalog(user).find((item) => item.status === 'active' && item.dealType !== 'rent'
    && Number(item.bedrooms) > 0 && Number(item.priceValue) > 0 && localizedExact(item.city, language, 80));
  if (!record) return '';
  const city = localizedExact(record.city, language, 80);
  const price = Number(record.priceValue);
  const step = price < 100000 ? 10000 : price < 500000 ? 50000 : 100000;
  const limit = formatMoney(Math.ceil(price / step) * step, '€', language, 0);
  const bedrooms = Number(record.bedrooms);
  // С признаком, если он у объекта есть: клиент видит, что бот понимает «с бассейном», «у моря» (проверка — по каталогу).
  const featureKey = ['pool', 'sea', 'terrace', 'garden', 'parking'].find((key) => recordHasFeature(record, key));
  const phrase = featureKey ? EXAMPLE_FEATURE_PHRASES[language][featureKey] || EXAMPLE_FEATURE_PHRASES.ru[featureKey] : '';
  if (language === 'en') return bedrooms + (bedrooms === 1 ? ' bedroom' : ' bedrooms') + ' in ' + city + (phrase ? ' ' + phrase : '') + ' under ' + limit;
  if (language === 'es') return bedrooms + (bedrooms === 1 ? ' dormitorio' : ' dormitorios') + ' en ' + city + (phrase ? ' ' + phrase : '') + ' hasta ' + limit;
  const word = bedrooms % 10 === 1 && bedrooms % 100 !== 11 ? 'спальня' : [2, 3, 4].includes(bedrooms % 10) && ![12, 13, 14].includes(bedrooms % 100) ? 'спальни' : 'спален';
  return city + ', ' + bedrooms + ' ' + word + (phrase ? ', ' + phrase : '') + ', до ' + limit;
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
    // Пустой ответ — не тупик: показываем, что найдётся при небольшом смягчении
    // условий (бюджет чуть выше, без района или города), и предлагаем следить
    // за новыми объектами или передать запрос менеджеру.
    const nearby = relaxedCatalogFilter(user);
    const nearbyLine = nearby ? '\n\n' + copy.nearby.replace('{count}', () => (String(nearby.count))).replace('{change}', () => (nearby.change)) : '';
    const notify = (SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru).wizardNotify;
    // Четыре действия вместо семи-восьми: ближайшее (если есть), следить за новыми, написать
    // менеджеру (WhatsApp рядом), сбросить условия. «Фильтр», «Подбор» и «Главное меню» — на
    // клавиатуре внизу.
    const talk = [{ text: '💬 ' + copy.sendToManager, callback_data: 'cfilter:manager' }];
    const whatsapp = whatsappRow(searchMessage(filterState.summary, language));
    if (whatsapp) talk.push(...whatsapp);
    await sendUiMessage(chatId, user, copy.empty + '\n\n🔎 ' + filterState.summary + nearbyLine, token, { reply_markup: { inline_keyboard: [
      ...(nearby ? [[{ text: copy.showNearby, callback_data: 'cfilter:nearby' }]] : []),
      [{ text: notify, callback_data: 'saved:save' }],
      talk,
      // «Фильтр» рядом со сбросом: текст зовёт изменить условия, значит и кнопка нужна.
      [{ text: copy.button, callback_data: 'cfilter:open' }],
      [{ text: copy.reset, callback_data: 'cfilter:reset' }],
    ] } });
    return true;
  }
  if (!records.length) {
    await clearCatalogMessages(chatId, user, token);
    rememberCatalogPosition(user, mode, 0);
    const empty = EMPTY_STATE_TEXT[language] || EMPTY_STATE_TEXT.ru;
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const manager = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    const text = mode === 'shared'
      ? action.listUnavailable
      : mode === 'favorites'
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
  if (mode === 'all') markFunnel(user, 'catalog');
  const heading = catalogHeading(mode, language, user, records.length);
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

// Показ одной фотографии объекта прямо в карточке. Сообщение то же самое —
// меняются картинка, подпись и кнопки, поэтому чат не растёт.
async function showPropertyPhoto(chatId, user, token, message, record, index) {
  const messageId = Number(message && message.message_id);
  if (!Number.isFinite(messageId) || !Array.isArray(message.photo) || !message.photo.length) return false;
  const language = user.preferredLanguage || 'ru';
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const images = recordImages(record, language);
  if (!images.length) return false;
  const total = images.length;
  const current = ((Number(index) || 0) % total + total) % total;
  const image = images[current];
  const title = localizedExact(record.title, language) || record.reference || '';
  // Номер фотографии — только на кнопке между стрелками: в подписи он повторялся.
  const caption = title ? '<b>' + escapeTelegramHtml(title) + '</b>' : '';

  const rows = [];
  if (total > 1) {
    rows.push([
      { text: '◀️', callback_data: 'property:photo:' + ((current - 1 + total) % total) + ':' + record.id },
      { text: (current + 1) + ' / ' + total, callback_data: 'property:photo:' + current + ':' + record.id },
      { text: '▶️', callback_data: 'property:photo:' + ((current + 1) % total) + ':' + record.id },
    ]);
  }
  const actions = [];
  if (record.status === 'active') actions.push({ text: mobileButtonText('📅', action.viewingShort || action.viewing), callback_data: 'property:viewing:' + record.id });
  actions.push({ text: mobileButtonText('💬', action.contact), callback_data: 'property:manager:' + record.id });
  rows.push(actions);
  rows.push([{ text: '⬅️ ' + navigation.backToCard, callback_data: 'property:card:' + record.id }]);

  try {
    const fileId = knownFileId(image);
    let result = null;
    if (fileId) {
      try {
        result = await telegramRequest(token, 'editMessageMedia', {
          chat_id: chatId,
          message_id: messageId,
          media: { type: 'photo', media: fileId, caption, parse_mode: 'HTML' },
          reply_markup: { inline_keyboard: rows },
        });
      } catch {
        // Файл на стороне Telegram устарел — отправим байтами.
        rememberFileId(image, '');
      }
    }
    if (!result) {
      const bytes = imageBytes(image);
      result = await telegramMultipartRequest(token, 'editMessageMedia', {
        chat_id: String(chatId),
        message_id: String(messageId),
        media: { type: 'photo', media: 'attach://photo', caption, parse_mode: 'HTML' },
        reply_markup: { inline_keyboard: rows },
        photo: new Blob([bytes], { type: image.mimeType }),
      });
      if (result && Array.isArray(result.photo) && result.photo.length) {
        rememberFileId(image, result.photo[result.photo.length - 1].file_id);
      }
    }
    return true;
  } catch {
    return false;
  }
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
  const heading = catalogHeading(mode, language, user, records.length);
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
      { text: '◀️', callback_data: 'cfilter:' + (isDistrict ? 'districts' : 'cities') + ':' + Math.max(0, page - 1) },
      { text: String(page + 1) + ' / ' + String(totalPages), callback_data: 'cfilter:locationnone:0' },
      { text: '▶️', callback_data: 'cfilter:' + (isDistrict ? 'districts' : 'cities') + ':' + Math.min(totalPages - 1, page + 1) },
    ]);
  }
  if (isDistrict) rows.push([{ text: '⬅️ ' + copy.changeCity, callback_data: 'cfilter:cities:0' }]);
  rows.push([{ text: '⬅️ ' + copy.backToFilter, callback_data: 'cfilter:open' }]);
  return {
    text: isDistrict ? copy.districtPickerTitle.replace('{city}', () => (city)) : copy.cityPickerTitle,
    markup: { inline_keyboard: rows },
  };
}

// --- Мастер подбора ---------------------------------------------------------
// Пять шагов в одном сообщении: сделка, тип, город, бюджет, спальни. На каждом
// шаге видно, сколько объектов подходит, поэтому клиент не собирает вслепую
// условия, под которые ничего нет.
const SELECTION_WIZARD_STEPS = ['deal', 'type', 'city', 'budget', 'bedrooms', 'done'];

function selectionWizardPanel(user, step) {
  const language = user.preferredLanguage || 'ru';
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const filter = normalizedCatalogFilter(user.catalogFilter, language);
  const published = publishedCatalog(user);
  const found = applyCatalogFilter(published, filter, language).length;
  let current = SELECTION_WIZARD_STEPS.includes(step) ? step : 'deal';
  // Под выбранные условия ничего нет — дальше не спрашиваем ни тип, ни бюджет,
  // ни спальни: каждый следующий вопрос только ведёт в тот же тупик. Клиенту
  // остаётся вернуться на шаг, начать заново или передать запрос менеджеру.
  const dead = !found && current !== 'deal';
  if (dead) current = 'done';
  const rows = [];
  const skip = (next, label = copy.wizardSkip) => ({ text: label, callback_data: 'sel:skip:' + next });
  const summary = catalogFilterSummary(filter, language);
  const heading = [
    copy.wizardTitle,
    summary,
    found ? (found === 1 && copy.wizardFoundOne ? copy.wizardFoundOne : copy.wizardFound).replace('{count}', () => (String(found))) : copy.wizardNothing,
  ].filter(Boolean).join('\n\n');

  if (current === 'deal') {
    const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    // Мастер отвечает словами продавца: «Купить / Снять», а не названиями режимов каталога «Продажа / Аренда».
    rows.push([{ text: copy.wizardBuy || action.forSale, callback_data: 'sel:deal:sale' }, { text: copy.wizardRent || action.forRent, callback_data: 'sel:deal:rent' }]);
    rows.push([skip('type')]);
  } else if (current === 'type') {
    const labels = PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru;
    // Только типы, которые есть при выбранной сделке: «аренда» + «участок» без
    // единого участка в аренде — заведомо пустой выбор.
    const types = Object.keys(labels).filter((type) => catalogFacetCount(published, filter, 'type', type, language) > 0);
    for (let index = 0; index < types.length; index += 2) {
      rows.push(types.slice(index, index + 2).map((type) => ({ text: labels[type], callback_data: 'sel:type:' + type })));
    }
    rows.push([skip('city')]);
  } else if (current === 'city') {
    const cities = catalogCities(published, language).filter((city) => catalogFacetCount(published, filter, 'city', city, language) > 0).slice(0, 8);
    for (let index = 0; index < cities.length; index += 2) {
      rows.push(cities.slice(index, index + 2).map((city) => ({ text: city, callback_data: 'sel:city:' + cityKey(city) })));
    }
    rows.push([skip('budget')]);
  } else if (current === 'budget') {
    const deal = catalogPriceDeal(filter, published) || 'sale';
    const prices = CATALOG_FILTER_PRICES[deal] || [];
    const usablePrices = prices.filter((price) => catalogFacetCount(published, filter, 'maxPrice', price, language) > 0);
    for (let index = 0; index < usablePrices.length; index += 2) {
      rows.push(usablePrices.slice(index, index + 2).map((price) => ({
        text: (CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru).upTo + ' ' + formattedPriceLimit(price, language),
        callback_data: 'sel:price:' + price,
      })));
    }
    rows.push([skip('bedrooms', copy.wizardSkipBudget || copy.wizardSkip)]);
  } else if (current === 'bedrooms') {
    rows.push(CATALOG_FILTER_BEDROOMS.map((count) => ({ text: count + '+', callback_data: 'sel:bed:' + count })));
    rows.push([skip('done')]);
  } else {
    // Итог: посмотреть подходящие, подписаться на новые или отдать менеджеру.
    if (found) rows.push([{ text: (found === 1 && copy.wizardShowOne ? copy.wizardShowOne : copy.wizardShow).replace('{count}', () => (String(found))), callback_data: 'sel:show' }]);
    rows.push([{ text: copy.wizardNotify, callback_data: 'saved:save' }]);
    rows.push([{ text: copy.wizardManager, callback_data: 'cfilter:manager' }]);
    if (dead) rows.push([{ text: copy.wizardRestart, callback_data: 'sel:restart:deal' }]);
  }
  if (current !== 'deal') {
    // Из тупика «Назад» ведёт на последний вопрос, а не на «итог».
    const previous = dead
      ? SELECTION_WIZARD_STEPS[Math.max(0, SELECTION_WIZARD_STEPS.indexOf(step) - 1)]
      : SELECTION_WIZARD_STEPS[Math.max(0, SELECTION_WIZARD_STEPS.indexOf(current) - 1)];
    rows.push([{ text: copy.wizardBack, callback_data: 'sel:back:' + previous }]);
  }
  const question = {
    deal: copy.wizardDeal, type: copy.wizardType, city: copy.wizardCity,
    budget: copy.wizardBudget, bedrooms: copy.wizardBedrooms, done: '',
  }[current];
  return { text: [heading, question].filter(Boolean).join('\n\n'), markup: { inline_keyboard: rows } };
}

async function sendSelectionWizard(chatId, user, token, step = 'deal') {
  // Мастер начинается с чистого листа: прежний фильтр не должен молча
  // подмешиваться в новые пожелания.
  if (step === 'deal') {
    user.catalogFilter = null;
    scheduleSave();
  }
  const panel = selectionWizardPanel(user, step);
  await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
}

async function handleSelectionWizardCallback(query, token) {
  const [, action, value] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const filter = normalizedCatalogFilter(user.catalogFilter, language);
  const published = publishedCatalog(user);
  let step = 'deal';
  if (action === 'deal') {
    filter.deal = ['sale', 'rent'].includes(value) ? value : '';
    step = 'type';
  } else if (action === 'type') {
    filter.type = Object.hasOwn(PROPERTY_TYPE_LABELS.ru, value) ? value : '';
    step = 'city';
  } else if (action === 'city') {
    filter.city = catalogCities(published, language).find((city) => cityKey(city) === value) || '';
    step = 'budget';
  } else if (action === 'price') {
    filter.maxPrice = normalizedCatalogFilter({ maxPrice: value }).maxPrice;
    step = 'bedrooms';
  } else if (action === 'bed') {
    filter.bedrooms = CATALOG_FILTER_BEDROOMS.includes(Number(value)) ? Number(value) : 0;
    step = 'done';
  } else if (action === 'restart') {
    // Начать заново: прежние условия сбрасываются.
    for (const key of Object.keys(filter)) delete filter[key];
    Object.assign(filter, normalizedCatalogFilter(null, language));
    step = 'deal';
  } else if (action === 'skip' || action === 'back') {
    step = SELECTION_WIZARD_STEPS.includes(value) ? value : 'deal';
    // «Назад» — это «выбрать заново»: выбор этого шага и следующих снимается, и условия с числом подходящих показывают то, что реально выбрано.
    if (action === 'back') {
      const cleared = { deal: ['deal', 'minPrice', 'maxPrice', 'type', 'city', 'district', 'bedrooms'], type: ['type', 'city', 'district', 'maxPrice', 'minPrice', 'bedrooms'], city: ['city', 'district', 'maxPrice', 'minPrice', 'bedrooms'], budget: ['maxPrice', 'minPrice', 'bedrooms'], bedrooms: ['bedrooms'] }[step] || [];
      const fresh = normalizedCatalogFilter(null, language);
      for (const key of cleared) filter[key] = fresh[key];
    }
  } else if (action === 'show') {
    user.catalogFilter = catalogFilterActive(filter) ? filter : null;
    scheduleSave();
    await acknowledgeCallback(query, token);
    // Менеджер видит, что искал клиент, даже если тот больше ничего не нажмёт:
    // запись «искал сам» в панели, как у поиска обычным сообщением. Ответа она
    // не требует, а тёплого клиента менеджер не упускает.
    const shownSummary = catalogFilterSummary(user.catalogFilter, language);
    if (shownSummary) createInquiry(user, '🔎 Подбор в боте: ' + shownSummary, { type: 'general', searchLead: true });
    await sendCatalogPage(chatId, user, token, 0, 'all');
    return;
  }
  user.catalogFilter = catalogFilterActive(filter) ? filter : null;
  scheduleSave();
  await acknowledgeCallback(query, token);
  const panel = selectionWizardPanel(user, step);
  if (query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', {
        chat_id: chatId,
        message_id: query.message.message_id,
        text: panel.text,
        reply_markup: panel.markup,
      });
      return;
    } catch {
      // Сообщение уже не изменить — покажем мастер заново.
    }
  }
  await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
}

function catalogFilterPanel(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const typeLabels = { ...(PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru), ...(FILTER_TYPE_LABELS[language] || FILTER_TYPE_LABELS.ru) };
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const published = publishedCatalog(user);
  const mark = (selected, text) => (selected ? '✓ ' : '') + text;
  const facetButton = (facet, choice, text, selected, callback) => {
    const count = catalogFacetCount(published, filter, facet, choice, language);
    return { count, selected, button: { text: markedFilterLabel(text, selected), callback_data: callback } };
  };
  // Options with no possible result disappear, except for the selected one:
  // the client must always be able to see and clear their current choice.
  const visibleButtons = (items) => items.filter((item) => item.count > 0 || item.selected).map((item) => item.button);
  const typeButtons = [facetButton('type', '', copy.anyType, !filter.type, 'cfilter:type:any')]
    .concat(Object.keys(typeLabels).map((type) => facetButton('type', type, typeLabels[type], filter.type === type, 'cfilter:type:' + type)));
  // Экран фильтра — не больше восьми рядов кнопок: длинный список никто не
  // дочитывает. Частое остаётся на виду, редкое (сортировка, своя цена,
  // сохранённый поиск, сброс) уезжает под «Ещё». Раньше рядов бывало
  // пятнадцать — фильтр не помещался на экран телефона.
  const MAX_ROWS = 8;
  const dealRows = [[facetButton('deal', '', copy.anyDeal, !filter.deal, 'cfilter:deal:any').button].concat(visibleButtons([
    facetButton('deal', 'sale', action.forSale, filter.deal === 'sale', 'cfilter:deal:sale'),
    facetButton('deal', 'rent', action.forRent, filter.deal === 'rent', 'cfilter:deal:rent'),
  ]))];

  // Типы — по три в ряд: подписи короткие, а рядов уходит втрое меньше.
  const shownTypes = visibleButtons(typeButtons);
  const typeRows = [];
  for (let index = 0; index < shownTypes.length; index += 3) typeRows.push(shownTypes.slice(index, index + 3));

  // Спальни — один ряд: короткое «🛏 Любые» и числа «1+ … 4+» (длинная подпись первой кнопки обрезалась).
  const bedroomRow = [facetButton('bedrooms', 0, copy.anyBedrooms.replace(/^🛏 /u, !filter.bedrooms ? '' : '🛏 '), !filter.bedrooms, 'cfilter:bed:0').button]
    .concat(visibleButtons(CATALOG_FILTER_BEDROOMS.map((count) => facetButton('bedrooms', count, count + '+', filter.bedrooms === count, 'cfilter:bed:' + count))));
  const bedroomRows = [bedroomRow];

  // Город и район — кнопки-списки в одном ряду: раньше каждый город занимал
  // отдельный ряд и каталог из восьми городов съедал весь экран.
  const found = applyCatalogFilter(published, filter, language).length;
  const cities = catalogCities(published, language);
  const districtCity = filter.city || (cities.length === 1 ? cities[0] : '');
  const districts = catalogDistricts(published, language, districtCity);
  const locationRow = [];
  if (cities.length > 1 || filter.city) {
    locationRow.push({
      text: markedFilterLabel(filter.city || copy.chooseCity, Boolean(filter.city)),
      callback_data: 'cfilter:cities:0',
    });
  }
  if (districtCity && (districts.length > 1 || filter.district)) {
    locationRow.push({
      text: markedFilterLabel(filter.district || copy.chooseDistrict, Boolean(filter.district)),
      callback_data: 'cfilter:districts:0',
    });
  }
  const locationRows = locationRow.length ? [locationRow] : [];

  // Цена — тоже кнопка-список: пороги, своя цена и нижняя граница живут на
  // отдельном экране, а здесь видно выбранное.
  const priceDeal = catalogPriceDeal(filter, published);
  const priceRows = priceDeal
    ? [[{ text: markedFilterLabel(catalogPriceLabel(filter, language), Boolean(filter.minPrice || filter.maxPrice)), callback_data: 'cfilter:prices:0' }]]
    : [];

  // Город и цена — один ряд, когда обе подписи короткие (по две кнопки в ряду — до 15 знаков): так фильтр остаётся в шести рядах.
  if (locationRows.length === 1 && locationRow.length === 1 && priceRows.length === 1 && [locationRow[0], priceRows[0][0]].every((button) => Array.from(button.text).length <= 15)) {
    locationRow.push(priceRows[0][0]);
    priceRows.length = 0;
  }
  // «Показать» и «Ещё» — одним рядом: экран фильтра не длиннее шести рядов.
  const tail = [
    [{ text: copy.show + ' ' + found, callback_data: 'cfilter:show' }, { text: '⋯ ' + copy.moreOptions + (featuresOf(filter).length + (filter.sort ? 1 : 0) ? ' · ' + (featuresOf(filter).length + (filter.sort ? 1 : 0)) : ''), callback_data: 'cfilter:more' }],
  ];
  // Если в каталоге много типов или цен, лишние ряды убираем — сначала у цен,
  // потом у типов. Хотя бы один ряд у каждого остаётся.
  const blocks = [dealRows, typeRows, bedroomRows, locationRows, priceRows];
  const total = () => blocks.reduce((sum, block) => sum + block.length, 0) + tail.length;
  for (const block of [typeRows]) {
    while (total() > MAX_ROWS && block.length > 1) block.pop();
  }
  const rows = blocks.reduce((all, block) => all.concat(block), []).concat(tail);
  // Заголовок — состояние: что выбрано и сколько подходит (раньше выбранное было видно только по галочкам в семи рядах).
  const conditions = catalogFilterSummary(filter, language);
  const wizard = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const foundText = (found === 1 && wizard.wizardFoundOne ? wizard.wizardFoundOne : wizard.wizardFound).replace('{count}', () => String(found));
  const heading = [copy.button, [foundText, conditions].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  return { text: heading, markup: { inline_keyboard: rows } };
}

// Подпись кнопки цены: «Цена: любая» или выбранные границы.
function catalogPriceLabel(filter, language) {
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const parts = [];
  if (filter.minPrice) parts.push(copy.from + ' ' + formattedPriceLimit(filter.minPrice, language));
  if (filter.maxPrice) parts.push(copy.upTo + ' ' + formattedPriceLimit(filter.maxPrice, language));
  return parts.length ? parts.join(' ') : copy.anyPrice;
}

// Экран цены: готовые пороги по два в ряд, своя цена и нижняя граница. На
// основном экране фильтра всё это занимало до четырёх рядов.
function catalogPricePanel(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const filter = normalizedCatalogFilter(user.catalogFilter);
  const published = publishedCatalog(user);
  const priceDeal = catalogPriceDeal(filter, published);
  const prices = priceDeal ? CATALOG_FILTER_PRICES[priceDeal] : [];
  const rows = [[{
    text: countedFilterLabel(copy.anyPrice, catalogFacetCount(published, filter, 'priceRange', 0, language), !filter.minPrice && !filter.maxPrice),
    callback_data: 'cfilter:price:0',
  }]];
  const custom = filter.maxPrice && !prices.includes(filter.maxPrice) ? [filter.maxPrice] : [];
  // Порог, под который ничего нет, не показываем — кроме выбранного.
  const limits = custom.concat(prices).map((price) => ({
    count: catalogFacetCount(published, filter, 'maxPrice', price, language),
    selected: filter.maxPrice === price,
    price,
  })).filter((item) => item.count > 0 || item.selected).map((item) => ({
    text: countedFilterLabel(copy.upTo + ' ' + formattedPriceLimit(item.price, language), item.count, item.selected),
    callback_data: 'cfilter:price:' + item.price,
  }));
  for (let index = 0; index < limits.length; index += 2) rows.push(limits.slice(index, index + 2));
  if (filter.minPrice) {
    rows.push([{ text: '✓ ' + copy.from + ' ' + formattedPriceLimit(filter.minPrice, language), callback_data: 'cfilter:minprice:0' }]);
  }
  rows.push([
    { text: '✏️ ' + copy.minimumPrice, callback_data: 'cfilter:minprice:custom' },
    { text: '✏️ ' + copy.customPrice, callback_data: 'cfilter:price:custom' },
  ]);
  rows.push([{ text: '⬅️ ' + copy.backToFilter, callback_data: 'cfilter:open' }]);
  return { text: [copy.priceTitle, copy.priceHint].filter(Boolean).join('\n'), markup: { inline_keyboard: rows } };
}

// «Ещё»: то, чем пользуются редко — сортировка, своя цена, сохранённый поиск и
// сброс. На основном экране фильтра им не место.
function catalogFilterExtraScreen(user, language) {
  const copy = CATALOG_FILTER_TEXT[language] || CATALOG_FILTER_TEXT.ru;
  const savedCopy = SAVED_SEARCH_TEXT[language] || SAVED_SEARCH_TEXT.ru;
  const filter = normalizedCatalogFilter(user.catalogFilter, language);
  const mark = (active, label) => (active ? '✓ ' : '') + label;
  const rows = [];
  rows.push([
    { text: mark(filter.sort === 'asc', copy.sortAsc), callback_data: 'cfilter:sort:' + (filter.sort === 'asc' ? 'none' : 'asc') },
    { text: mark(filter.sort === 'desc', copy.sortDesc), callback_data: 'cfilter:sort:' + (filter.sort === 'desc' ? 'none' : 'desc') },
  ]);
  // Признаки: показываем те, что есть хотя бы у одного объекта (или уже выбраны); по два в ряд, галочка — выбран.
  const published = publishedCatalog(user);
  const featureButtons = CATALOG_FEATURES
    .filter((key) => featuresOf(filter).includes(key) || published.some((record) => recordHasFeature(record, key)))
    .map((key) => ({ text: (featuresOf(filter).includes(key) ? '✓ ' : '') + featureLabel(copy, key), callback_data: 'cfilter:feat:' + key }));
  for (let index = 0; index < featureButtons.length; index += 2) rows.push(featureButtons.slice(index, index + 2));
  if (catalogSearchActive(filter)) {
    rows.push([{
      text: sameSavedSearch(user.savedSearch, filter) ? savedCopy.open : user.savedSearch ? savedCopy.update : savedCopy.save,
      callback_data: sameSavedSearch(user.savedSearch, filter) ? 'saved:view' : 'saved:save',
    }]);
  }
  if (catalogFilterActive(filter)) rows.push([{ text: copy.reset, callback_data: 'cfilter:reset' }]);
  rows.push([{ text: '⬅️ ' + copy.backToFilter, callback_data: 'cfilter:open' }]);
  return { text: copy.moreTitle, markup: { inline_keyboard: rows } };
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
  if (action === 'cities' || action === 'districts' || action === 'prices') {
    await acknowledgeCallback(query, token);
    const locationPanel = action === 'prices'
      ? catalogPricePanel(user)
      : catalogLocationPanel(user, action === 'districts' ? 'district' : 'city', Number(value) || 0);
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
    // Ответ виден в самом чате: итог «Передали: … Ответим здесь» вместо одной
    // всплывашки. Кнопки повтора нет — второе нажатие завело бы вторую заявку.
    const navigation = NAVIGATION_TEXT[user.preferredLanguage] || NAVIGATION_TEXT.ru;
    const done = {
      text: copy.handedOver.replace('{summary}', () => (summary)),
      markup: { inline_keyboard: [[{ text: '🏘 ' + navigation.browse, callback_data: 'catalog:all:0' }], [{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]] },
    };
    const editable = query.message && query.message.message_id && typeof query.message.text === 'string' && !Array.isArray(query.message.photo);
    if (editable) {
      try {
        await telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: done.text, reply_markup: done.markup });
        return;
      } catch {
        // Не удалось изменить — пришлём итог отдельным сообщением.
      }
    }
    await sendUiMessage(chatId, user, done.text, token, { reply_markup: done.markup });
    return;
  }
  if (action === 'nearby') {
    const nearby = relaxedCatalogFilter(user);
    await acknowledgeCallback(query, token);
    if (nearby) {
      user.catalogFilter = nearby.filter;
      scheduleSave();
    }
    await sendCatalogPage(chatId, user, token, 0, 'all');
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
  // Бюджет задан до выбора сделки: в смешанном каталоге это пороги продажи, и «Продажа» ставится сама.
  if ((action === 'price' || action === 'minprice') && (filter.maxPrice || filter.minPrice) && !filter.deal) filter.deal = catalogPriceDeal(filter, publishedCatalog(user));
  if (action === 'sort') filter.sort = ['asc', 'desc'].includes(value) ? value : '';
  if (action === 'feat') {
    const toggled = catalogFacetFilter(filter, 'feature', value, [], user.preferredLanguage).features;
    if (toggled && toggled.length) filter.features = toggled;
    else delete filter.features;
  }
  if (['deal', 'type', 'bed', 'city', 'district', 'price', 'minprice', 'sort', 'feat'].includes(action)) {
    user.catalogFilter = catalogFilterActive(filter) ? filter : null;
    scheduleSave();
  }
  await acknowledgeCallback(query, token);
  const districtChoices = action === 'city' && filter.city
    ? catalogDistricts(publishedCatalog(user), user.preferredLanguage, filter.city)
    : [];
  // Признаки и сортировка переключаются на месте, на экране «Ещё»: четыре признака — четыре нажатия, а не восемь.
  const panel = ['more', 'feat', 'sort'].includes(action)
    ? catalogFilterExtraScreen(user, user.preferredLanguage)
    : districtChoices.length > CATALOG_INLINE_LOCATION_LIMIT
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

// --- Подборки по ссылке -------------------------------------------------------------------------------------------------
const SHARED_LIST_DAYS = 90;
const SHARED_LIST_MAX_IDS = 20;
const SHARED_LIST_PER_OWNER = 5;
const SHARED_LIST_TOTAL = 300;

function sharedListExpired(list) {
  const created = Date.parse(list && list.createdAt);
  return !Number.isFinite(created) || Date.now() - created > SHARED_LIST_DAYS * 24 * 3600 * 1000;
}

function sharedListByCode(code) {
  const key = String(code || '');
  const list = /^[A-Za-z0-9_-]{6,32}$/.test(key) && data.sharedLists ? data.sharedLists[key] : null;
  return list && !sharedListExpired(list) ? list : null;
}

// Просроченные — вон; у одного хозяина не больше пяти; всего не больше трёхсот (самые старые уходят первыми).
// Получатель подборки отметил объект 🤍 — отправитель узнаёт (один раз на объект и получателя).
async function notifySharedListOwner(user, record, token) {
  const list = sharedListByCode(user && user.sharedListCode);
  if (!list || String(list.owner) === String(user.id) || !list.ids.includes(record.id)) return false;
  const owner = data.users[String(list.owner)];
  if (!owner || !owner.chatId || owner.blocked) return false;
  list.marked = list.marked && typeof list.marked === 'object' ? list.marked : {};
  const seen = Array.isArray(list.marked[user.id]) ? list.marked[user.id] : [];
  if (seen.includes(record.id)) return false;
  if (Object.keys(list.marked).length >= 20 && !list.marked[user.id]) return false;
  list.marked[user.id] = [...seen, record.id].slice(-20);
  scheduleSave();
  const language = owner.preferredLanguage || 'ru';
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const title = localizedExact(record.title, language) || record.reference || '';
  try {
    await sendMessage(owner.chatId, copy.sharedMarked.replace('{title}', () => title), token, { track: false });
    return true;
  } catch {
    return false;
  }
}

function pruneSharedLists() {
  if (!data.sharedLists) data.sharedLists = {};
  const entries = Object.entries(data.sharedLists).filter(([, list]) => !sharedListExpired(list));
  const byOwner = new Map();
  const keep = [];
  for (const entry of entries.sort((a, b) => Date.parse(b[1].createdAt) - Date.parse(a[1].createdAt))) {
    const count = (byOwner.get(entry[1].owner) || 0) + 1;
    byOwner.set(entry[1].owner, count);
    if (count <= SHARED_LIST_PER_OWNER) keep.push(entry);
  }
  data.sharedLists = Object.fromEntries(keep.slice(0, SHARED_LIST_TOTAL));
}

// Избранное клиента → подборка с короткой ссылкой. Тот же набор объектов у того же хозяина — та же ссылка, а не новая.
function createSharedList(user) {
  const ids = catalogRecords(user, 'favorites').map((record) => record.id).slice(0, SHARED_LIST_MAX_IDS);
  const username = cleanText(data.bot && data.bot.username, 80).replace(/^@/, '');
  if (!ids.length || !/^[A-Za-z0-9_]{5,}$/.test(username)) return null;
  if (!data.sharedLists) data.sharedLists = {};
  pruneSharedLists();
  const same = Object.entries(data.sharedLists).find(([, list]) => String(list.owner) === String(user.id) && list.ids.slice().sort().join('|') === ids.slice().sort().join('|'));
  const code = same ? same[0] : crypto.randomBytes(8).toString('base64url');
  if (!same) data.sharedLists[code] = { ids, owner: String(user.id), createdAt: new Date().toISOString(), opens: 0 };
  if (!same) pruneSharedLists();
  recordDaily('shared');
  scheduleSave();
  return { code, count: ids.length, link: 'https://t.me/' + username + '?start=list_' + code };
}

function sharedListCodeFromStartPayload(payload) {
  const match = cleanText(payload, 140).match(/^list_([A-Za-z0-9_-]{6,32})$/);
  return match ? match[1] : '';
}

function propertyIdFromStartPayload(payload) {
  const value = cleanText(payload, 140);
  // Сначала ссылка с меткой источника: в простом виде «код объекта» захватил бы
  // и метку — коды объектов тоже бывают с подчёркиваниями.
  const tagged = value.match(/^property_([A-Za-z0-9_-]{8,100}?)__src_[a-z0-9_-]{1,40}$/);
  if (tagged) return tagged[1];
  const plain = value.match(/^property_([A-Za-z0-9_-]{8,100})$/);
  return plain ? plain[1] : '';
}

// Метка источника из ссылки на объект: «пришёл из канала», а не «пришёл сам».
function sourceFromStartPayload(payload) {
  const match = cleanText(payload, 140).match(/^property_[A-Za-z0-9_-]{8,100}?__src_([a-z0-9_-]{1,40})$/);
  return match ? match[1] : '';
}

async function openPendingStartPayload(user, token) {
  const payload = cleanText(user && user.pendingStartPayload, 100);
  if (!payload) return false;
  user.pendingStartPayload = '';
  scheduleSave();
  const language = user.preferredLanguage || 'ru';
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const listCode = sharedListCodeFromStartPayload(payload);
  if (listCode) {
    const list = sharedListByCode(listCode);
    user.sharedListCode = list ? listCode : '';
    const available = list ? catalogRecords(user, 'shared') : [];
    if (!available.length) {
      await sendMessage(user.chatId, action.listUnavailable, token, { reply_markup: menuKeyboard(language) });
      return true;
    }
    list.opens = (Number(list.opens) || 0) + 1;
    recordDaily('shared_open');
    scheduleSave();
    await sendCatalogPage(user.chatId, user, token, 0, 'shared');
    return true;
  }
  const propertyId = propertyIdFromStartPayload(payload);
  if (!propertyId) return false;
  const record = data.objects.find((item) => item.id === propertyId && ['active', 'reserved'].includes(item.status) && propertyReadyForLanguage(item, language));
  if (!record) {
    await sendMessage(user.chatId, action.propertyUnavailable, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  const heading = '🔖 ' + action.propertyHeading;
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
      { text: '◀️', callback_data: 'promotions:' + previousPage },
      { text: String(page + 1) + ' / ' + String(totalPages), callback_data: 'promotions:none' },
      { text: '▶️', callback_data: 'promotions:' + nextPage },
    ]);
  }
  // У акции есть выход в меню, как у любого экрана.
  rows.push([{ text: '🏠 ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).mainMenu, callback_data: 'nav:menu' }]);
  return rows.length ? { inline_keyboard: rows } : null;
}

export {
  catalogFilterExtraScreen,
  catalogPricePanel,
  mobileButtonText,
  priceDropVisible,
  showPropertyPhoto,
  CATALOG_FILTER_BEDROOMS,
  CATALOG_FILTER_MIN_RECORDS,
  CATALOG_FILTER_PRICES,
  CATALOG_MODES,
  COMPARISON_LIMIT,
  applyCatalogFilter,
  catalogCities,
  catalogDistricts,
  catalogHeading,
  catalogViewContext,
  catalogMode,
  catalogPageFromContext,
  catalogPriceDeal,
  cityKey,
  catalogFilterActive,
  catalogSearchActive,
  catalogSearchFilter,
  catalogFilterPanel,
  escapeTelegramHtml,
  handleCatalogListCallback,
  sendCatalogList,
  handleSelectionWizardCallback,
  sendSelectionWizard,
  searchExampleText,
  catalogListLine,
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
  marketComparison,
  recordHasFeature,
  objectCaptionHtml,
  objectPriceText,
  objectPriceLine,
  locationText,
  propertySpecRows,
  openPendingStartPayload,
  createSharedList,
  notifySharedListOwner,
  sharedListCodeFromStartPayload,
  sharedListByCode,
  priceOnRequest,
  promotionButtons,
  promotionIsActive,
  propertyDeepLink,
  sourceFromStartPayload,
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
