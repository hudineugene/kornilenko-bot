// Загрузка объектов из XML-выгрузки для порталов (формат Kyero v3, его
// отдают большинство сайтов агентств в Испании). Объекты сопоставляются по
// номеру (<ref>): новые создаются, у существующих обновляются цена и
// характеристики. Названия, тексты и фотографии, которые администратор уже
// заполнил в панели, не перезаписываются.

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { cleanText } from './util.mjs';
import { PLACES } from './places.mjs';
import { tellAdminProblem } from './notify-plan.mjs';
import { PROPERTY_TYPE_LABELS } from './texts.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { parseUploadedImage } from './admin-http.mjs';
import { configured } from './store.mjs';
import { deliverPropertyAlerts, propertyAlertDeliveries, rememberPriceChange } from './alerts.mjs';
import { propertyReadyForLanguage } from './catalog.mjs';

const MAX_FEED_BYTES = 20 * 1024 * 1024;
const MAX_FEED_PROPERTIES = 2000;
const MAX_IMAGES_PER_PROPERTY = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;
const IMAGE_TIMEOUT_MS = 15000;
const MAX_IMAGES_PER_IMPORT = 300;
const PHOTO_TIME_LIMIT_MS = 10 * 60 * 1000;
const DAILY_IMPORT_HOURS = { from: 9, to: 20 };
const FEED_REFRESH_MS = 24 * 60 * 60 * 1000;

// --- A small XML reader, enough for property feeds ---------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return Object.hasOwn(ENTITIES, entity.toLowerCase()) ? ENTITIES[entity.toLowerCase()] : match;
  });
}

// A single pass with indexOf: a broken file (an unclosed comment or CDATA)
// ends the scan instead of making it slow.
function parseXml(text) {
  const source = String(text);
  const root = { name: '#root', attributes: {}, children: [], text: '' };
  const stack = [root];
  const skipTo = (marker, from) => {
    const end = source.indexOf(marker, from);
    return end < 0 ? source.length : end + marker.length;
  };
  let position = 0;
  while (position < source.length) {
    const node = stack[stack.length - 1];
    const open = source.indexOf('<', position);
    if (open < 0) {
      node.text += decodeEntities(source.slice(position));
      break;
    }
    if (open > position) node.text += decodeEntities(source.slice(position, open));
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      node.text += source.slice(open + 9, end < 0 ? source.length : end);
      position = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!--', open)) { position = skipTo('-->', open + 4); continue; }
    if (source.startsWith('<?', open)) { position = skipTo('?>', open + 2); continue; }
    if (source.startsWith('<!', open)) { position = skipTo('>', open + 2); continue; }
    const close = source.indexOf('>', open + 1);
    if (close < 0) break;
    const tag = source.slice(open + 1, close);
    position = close + 1;
    if (tag.startsWith('/')) {
      // Tolerant: close up to the matching element, ignore a stray end tag.
      const name = tag.slice(1).trim();
      const index = stack.map((item) => item.name).lastIndexOf(name);
      if (index > 0) stack.length = index;
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const name = (body.match(/^[\w:.-]+/) || [''])[0];
    if (!name) continue;
    const attributes = {};
    for (const [, key, double, single] of body.slice(name.length).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[key] = decodeEntities(double !== undefined ? double : single);
    }
    const element = { name, attributes, children: [], text: '' };
    node.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  return root;
}

function child(node, name) {
  return node ? node.children.find((item) => item.name === name) || null : null;
}

function childrenOf(node, name) {
  return node ? node.children.filter((item) => item.name === name) : [];
}

function textOf(node, name) {
  const target = name ? child(node, name) : node;
  return target ? target.text.trim() : '';
}

// Descriptions in feeds often carry HTML; the bot sends plain text.
function plainText(value) {
  return decodeEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// <desc><en>…</en><es>…</es></desc> → { ru, en, es }; a plain text goes to
// every language.
function localizedOf(node, maximum) {
  if (!node) return { ru: '', en: '', es: '' };
  if (!node.children.length) {
    const plain = cleanText(plainText(node.text), maximum);
    return { ru: plain, en: plain, es: plain };
  }
  return Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(plainText(textOf(node, language)), maximum)]));
}

function numberOf(value) {
  const number = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

// --- Kyero fields → the bot's property ----------------------------------------

const TYPE_WORDS = [
  [/(land|plot|parcela|terreno|solar)/, 'land'],
  [/(commercial|shop|office|local|business|nave|warehouse|hotel|restaurant)/, 'commercial'],
  [/(town ?house|adosad|terraced|semi|pareado|duplex|bungalow)/, 'townhouse'],
  [/villa|chalet/, 'villa'],
  // Before "house": a penthouse is an apartment.
  [/(apartment|apartamento|flat|piso|penthouse|atico|ático|studio|estudio)/, 'apartment'],
  [/(house|casa|finca|country|detached|cortijo)/, 'house'],
];

function propertyTypeOf(value) {
  const text = String(value || '').toLowerCase();
  const found = TYPE_WORDS.find(([pattern]) => pattern.test(text));
  return found ? found[1] : 'other';
}

// A title when the feed has none: "Villa · Finestrat" in each language.
function generatedTitle(type, town) {
  return Object.fromEntries(['ru', 'en', 'es'].map((language) => [
    language,
    cleanText([(PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[type] || '', town].filter(Boolean).join(' · '), 160),
  ]));
}

function feedItemOf(node) {
  const reference = cleanText(textOf(node, 'ref') || textOf(node, 'id'), 80);
  // What the feed leaves out stays null, so an update keeps the admin's value.
  const typeText = textOf(node, 'type');
  const type = typeText ? propertyTypeOf(typeText) : null;
  const currencyText = textOf(node, 'currency').toUpperCase();
  const town = cleanText(textOf(node, 'town'), 160);
  const frequency = textOf(node, 'price_freq').toLowerCase();
  const surface = child(node, 'surface_area');
  const location = child(node, 'location');
  const latitude = Number(textOf(location, 'latitude'));
  const longitude = Number(textOf(location, 'longitude'));
  const titleNode = child(node, 'title');
  const urlNode = child(node, 'url');
  const url = urlNode ? (urlNode.children.length ? textOf(urlNode, 'en') || textOf(urlNode, 'es') || textOf(urlNode.children[0]) : textOf(urlNode)) : '';
  const images = childrenOf(child(node, 'images'), 'image')
    .map((image) => textOf(image, 'url') || image.attributes.url || '')
    .filter((address) => /^https?:\/\//i.test(address))
    .slice(0, MAX_IMAGES_PER_PROPERTY);
  const titles = titleNode ? localizedOf(titleNode, 160) : { ru: '', en: '', es: '' };
  const generated = generatedTitle(type || 'other', town);
  return {
    reference,
    fields: {
      dealType: frequency ? (['month', 'week'].includes(frequency) ? 'rent' : 'sale') : null,
      pricePeriod: frequency ? (frequency === 'month' ? 'month' : frequency === 'week' ? 'week' : 'total') : null,
      priceValue: numberOf(textOf(node, 'price')),
      currency: ['EUR', 'USD', 'GBP'].includes(currencyText) ? currencyText : null,
      propertyType: type,
      bedrooms: numberOf(textOf(node, 'beds')),
      bathrooms: numberOf(textOf(node, 'baths')),
      area: numberOf(textOf(surface, 'built')),
      plotArea: numberOf(textOf(surface, 'plot')),
      condition: textOf(node, 'new_build') === '1' ? 'new' : '',
    },
    texts: {
      title: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, titles[language] || generated[language]])),
      description: localizedOf(child(node, 'desc'), 3000),
      city: { ru: town, en: town, es: town },
      district: (() => { const place = cleanText(textOf(node, 'location_detail'), 160); return { ru: place, en: place, es: place }; })(),
      url: /^https?:\/\//i.test(url) ? cleanText(url, 500) : '',
      mapUrl: Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude || longitude) ? 'https://www.google.com/maps?q=' + latitude + ',' + longitude : '',
    },
    images,
  };
}

function readFeed(xml) {
  if (Buffer.byteLength(String(xml || '')) > MAX_FEED_BYTES) throw new Error('Файл выгрузки больше 20 МБ');
  const root = parseXml(xml);
  const container = child(root, 'root') || child(root, 'properties') || root;
  const nodes = childrenOf(container, 'property');
  if (!nodes.length) throw new Error('В файле нет объектов <property> — это не выгрузка в формате Kyero');
  return nodes.slice(0, MAX_FEED_PROPERTIES).map(feedItemOf);
}

// --- Applying ------------------------------------------------------------------

// References match as written, ignoring case and spaces around: "A-1" and
// "A1" are different properties.
function referenceKey(value) {
  return String(value || '').trim().toUpperCase();
}

function isEmptyLocalized(value) {
  return !value || !['ru', 'en', 'es'].some((language) => cleanText(value[language], 10));
}

function hasImages(record) {
  const images = record.imagesByLanguage || {};
  return ['ru', 'en', 'es'].some((language) => Array.isArray(images[language]) && images[language].length);
}

// What the import would do, without changing anything.
function planImport(items) {
  const byReference = new Map(data.objects.filter((record) => record.reference).map((record) => [referenceKey(record.reference), record]));
  const seen = new Set();
  const plan = { create: [], update: [], unchanged: [], skipped: [] };
  for (const item of items) {
    const key = referenceKey(item.reference);
    if (!key) {
      plan.skipped.push({ reference: '', reason: 'нет номера объекта (<ref>)' });
      continue;
    }
    if (seen.has(key)) {
      plan.skipped.push({ reference: item.reference, reason: 'номер повторяется в выгрузке' });
      continue;
    }
    seen.add(key);
    const existing = byReference.get(key);
    if (!existing) {
      plan.create.push(item);
      continue;
    }
    const changed = Object.entries(item.fields).some(([field, value]) => value != null && value !== '' && existing[field] !== value);
    const photosToAdd = !hasImages(existing) && item.images.length > 0;
    (changed || photosToAdd ? plan.update : plan.unchanged).push({ item, record: existing });
  }
  const inFeed = new Set(items.map((item) => referenceKey(item.reference)));
  plan.missing = data.objects.filter((record) => record.reference && !inFeed.has(referenceKey(record.reference)) && record.importedAt).map((record) => record.reference);
  return plan;
}

function planSummary(plan) {
  return {
    create: plan.create.length,
    update: plan.update.length,
    unchanged: plan.unchanged.length,
    skipped: plan.skipped,
    missing: plan.missing,
    examples: plan.create.slice(0, 5).map((item) => item.reference + ' — ' + (item.texts.title.ru || item.texts.title.en)),
  };
}

// Разрешение имени с коротким сроком: если сеть молчит, ждать нечего — по
// такому имени всё равно ничего не скачается, а проверка не должна подвешивать
// загрузку выгрузки.
const DNS_TIMEOUT_MS = 1500;

function dnsLookup(host, options) {
  return Promise.race([
    dns.lookup(host, options),
    new Promise((resolve, reject) => { setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS).unref(); }),
  ]);
}

// Photo links come from the feed, so they may not point into this computer
// or the local network.
//
// Адрес из выгрузки — это адрес с чужой стороны. Проверять только то, что
// написано в файле, мало: ссылка на обычный сайт может увести перенаправлением
// на 127.0.0.1 или 192.168.…, а обычное имя — указывать на домашний адрес. Тут
// собраны все три проверки: сам адрес, куда он разрешается и куда ведут
// перенаправления (их бот проходит сам, а не доверяет браузерной автоматике).
function privateIp(value) {
  let host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  if (!host) return true;
  // Адрес IPv4 внутри IPv6 браузерная нормализация пишет шестнадцатеричным
  // («::ffff:7f00:1» — это 127.0.0.1): разворачиваем обратно.
  const mapped = host.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    host = [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join('.');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [first, second] = host.split('.').map(Number);
    if (first === 127 || first === 0 || first === 10) return true;
    if (first === 169 && second === 254) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    // Адреса провайдерских сетей: снаружи по ним ничего полезного нет.
    if (first === 100 && second >= 64 && second <= 127) return true;
    return false;
  }
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
    return false;
  }
  return false;
}

function publicAddress(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  return !privateIp(host);
}

// Имя может указывать куда угодно, в том числе внутрь сети. Не разрешилось —
// отказываем: раньше такая ошибка означала «пропустить проверку», и достаточно
// было подгадать момент, когда DNS молчит.
async function addressResolvesOutside(address, lookup) {
  const host = new URL(address).hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return !privateIp(host);
  let records = [];
  try {
    records = await lookup(host, { all: true });
  } catch {
    return false;
  }
  if (!Array.isArray(records) || !records.length) return false;
  return records.every((record) => !privateIp(record && record.address));
}

// Один и тот же путь для фотографий и для самого файла выгрузки: проверяем
// адрес, разрешаем имя, идём по перенаправлениям сами и проверяем каждый шаг.
async function fetchChecked(address, fetcher, lookup, signal, what) {
  let current = address;
  for (let hop = 0; ; hop += 1) {
    if (!publicAddress(current)) throw new Error(what + ': адрес недоступен');
    if (!(await addressResolvesOutside(current, lookup))) throw new Error(what + ': адрес ведёт во внутреннюю сеть');
    const response = await fetcher(current, { signal, redirect: 'manual' });
    if (!REDIRECT_CODES.has(Number(response.status))) return response;
    if (hop >= MAX_IMAGE_REDIRECTS) throw new Error(what + ': слишком много перенаправлений');
    const location = response.headers.get('location');
    if (!location) throw new Error(what + ': перенаправление без адреса');
    current = new URL(location, current).toString();
  }
}

// The body up to a limit, without first taking a huge answer into memory.
async function readLimited(response, limit, what) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error(what + ' больше ' + Math.round(limit / 1024 / 1024) + ' МБ');
  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error(what + ' больше ' + Math.round(limit / 1024 / 1024) + ' МБ');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      reader.cancel().catch(() => {});
      throw new Error(what + ' больше ' + Math.round(limit / 1024 / 1024) + ' МБ');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const MAX_IMAGE_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

async function downloadImage(address, fetcher, lookup = dnsLookup) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetchChecked(address, fetcher, lookup, controller.signal, 'адрес фото');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = await readLimited(response, MAX_IMAGE_BYTES, 'Фото');
    const mime = type === 'image/png' || bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : 'image/jpeg';
    return parseUploadedImage('data:' + mime + ';base64,' + bytes.toString('base64'), address.split('/').pop().split('?')[0] || 'photo.jpg');
  } finally {
    clearTimeout(timer);
  }
}

// Photos of one import share a budget: a count and a time limit. What is
// left out is picked up by the next import (a property without photos gets
// them then).
function photoBudget(now = Date.now()) {
  return { left: MAX_IMAGES_PER_IMPORT, deadline: now + PHOTO_TIME_LIMIT_MS, skipped: 0 };
}

async function downloadImages(addresses, fetcher, budget, result, lookup = dnsLookup) {
  const images = [];
  for (const address of addresses) {
    if (budget.left <= 0 || Date.now() > budget.deadline) {
      budget.skipped += 1;
      continue;
    }
    budget.left -= 1;
    try {
      images.push(await downloadImage(address, fetcher, lookup));
      result.images += 1;
    } catch {
      result.imageErrors += 1;
    }
  }
  return images;
}

// The same photo files for every language; stored once on disk.
function imagesForAllLanguages(images) {
  return { ru: images, en: images.map((image) => ({ ...image, id: crypto.randomUUID() })), es: images.map((image) => ({ ...image, id: crypto.randomUUID() })) };
}

let importRunning = false;

// Creates and updates properties. New ones are hidden unless publishNew:
// the admin looks at them first. Returns counts and problems.
async function applyImport(items, options = {}) {
  if (importRunning) throw new Error('Загрузка с сайта уже идёт — дождитесь её окончания');
  importRunning = true;
  try {
    return await runImport(items, options);
  } finally {
    importRunning = false;
  }
}

async function runImport(items, options) {
  const fetcher = options.fetcher || fetch;
  // Разрешение имён можно подменить в проверках: настоящий DNS там ни к чему.
  const lookup = options.lookup || dnsLookup;
  const plan = planImport(items);
  const now = new Date().toISOString();
  const budget = photoBudget();
  const result = { ...planSummary(plan), images: 0, imageErrors: 0, imagesPostponed: 0, alerts: 0 };
  // Alerts of the whole import are sent together, at most one per client.
  const deliveries = [];
  for (const item of plan.create) {
    const images = await downloadImages(item.images, fetcher, budget, result, lookup);
    const record = {
      id: crypto.randomUUID(),
      status: 'hidden',
      reference: item.reference,
      ...item.fields,
      dealType: item.fields.dealType || 'sale',
      pricePeriod: item.fields.pricePeriod || 'total',
      currency: item.fields.currency || 'EUR',
      propertyType: item.fields.propertyType || 'other',
      title: item.texts.title,
      description: item.texts.description,
      address: { ru: '', en: '', es: '' },
      price: { ru: '', en: '', es: '' },
      city: item.texts.city,
      district: item.texts.district,
      url: item.texts.url,
      mapUrl: item.texts.mapUrl,
      floor: '',
      floors: '',
      distanceSea: null,
      badges: [],
      imagesByLanguage: imagesForAllLanguages(images),
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    // "Show at once" must not bypass the common card standard. A feed may
    // omit a translation or a key characteristic; keep such a record as a
    // draft so the administrator can complete it safely in the panel.
    if (options.publishNew && ['ru', 'en', 'es'].every((language) => propertyReadyForLanguage(record, language))) {
      record.status = 'active';
    }
    data.objects.push(record);
    deliveries.push(...propertyAlertDeliveries(record, null));
  }
  for (const { item, record } of plan.update) {
    const before = { status: record.status, priceValue: record.priceValue };
    for (const [field, value] of Object.entries(item.fields)) {
      if (value != null && value !== '') record[field] = value;
    }
    // Texts the admin wrote stay; empty ones are filled from the feed.
    for (const field of ['title', 'description', 'city', 'district']) {
      if (isEmptyLocalized(record[field])) record[field] = item.texts[field];
    }
    if (!record.url && item.texts.url) record.url = item.texts.url;
    if (!record.mapUrl && item.texts.mapUrl) record.mapUrl = item.texts.mapUrl;
    if (!hasImages(record) && item.images.length) {
      const images = await downloadImages(item.images, fetcher, budget, result, lookup);
      if (images.length) record.imagesByLanguage = imagesForAllLanguages(images);
    }
    record.importedAt = now;
    record.updatedAt = now;
    // Снижение цены из выгрузки тоже остаётся на карточке зачёркнутой старой
    // ценой — как при правке в панели.
    rememberPriceChange(record, before);
    deliveries.push(...propertyAlertDeliveries(record, before));
  }
  for (const { record } of plan.unchanged) record.importedAt = now;
  result.imagesPostponed = budget.skipped;
  saveDataNow();
  const perClient = new Map();
  for (const delivery of deliveries) if (!perClient.has(delivery.user.id)) perClient.set(delivery.user.id, delivery);
  result.alerts = perClient.size;
  if (perClient.size && configured() && data.config.active) {
    void deliverPropertyAlerts(Array.from(perClient.values())).catch((error) => recordError('Уведомления об объектах', error));
  }
  return result;
}

// Сам файл выгрузки — тоже адрес со стороны: настройку мог поменять кто угодно
// с доступом к панели.
async function fetchFeed(address, fetcher = fetch, lookup = dnsLookup) {
  if (!/^https?:\/\//i.test(String(address || ''))) throw new Error('Ссылка на выгрузку должна начинаться с http:// или https://');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Адрес выгрузки задаётся в панели, но проверяем его так же, как ссылки
    // на фотографии: настройку мог поменять кто угодно с доступом к панели, а
    // перенаправление увести бота во внутреннюю сеть.
    const response = await fetchChecked(address, fetcher, lookup, controller.signal, 'адрес выгрузки');
    if (!response.ok) throw new Error('сайт ответил ' + response.status);
    return (await readLimited(response, MAX_FEED_BYTES, 'Выгрузка')).toString('utf8');
  } catch (error) {
    throw new Error('Не удалось скачать выгрузку: ' + (error.name === 'AbortError' ? 'сайт не ответил за 30 секунд' : error.message));
  } finally {
    clearTimeout(timer);
  }
}

function feedSettings() {
  const source = data.config && data.config.feedImport && typeof data.config.feedImport === 'object' ? data.config.feedImport : {};
  return {
    url: cleanText(source.url, 1000),
    daily: source.daily === true,
    publishNew: source.publishNew === true,
    lastRunAt: cleanText(source.lastRunAt, 40),
    lastResult: source.lastResult && typeof source.lastResult === 'object' ? source.lastResult : null,
    lastError: cleanText(source.lastError, 300),
  };
}

// Once a day from the saved link, when that is switched on, in the daytime:
// clients may get alerts about new properties.
async function runDailyFeedImport(now = new Date(), fetcher = fetch, lookup = dnsLookup) {
  const settings = feedSettings();
  if (!settings.daily || !settings.url || importRunning) return null;
  if (now.getHours() < DAILY_IMPORT_HOURS.from || now.getHours() >= DAILY_IMPORT_HOURS.to) return null;
  const last = Date.parse(settings.lastRunAt || '');
  if (Number.isFinite(last) && now.getTime() - last < FEED_REFRESH_MS - 60 * 60 * 1000) return null;
  data.config.feedImport = { ...settings, lastRunAt: now.toISOString() };
  try {
    const result = await applyImport(readFeed(await fetchFeed(settings.url, fetcher, lookup)), { publishNew: settings.publishNew, fetcher, lookup });
    data.config.feedImport = { ...data.config.feedImport, lastResult: result, lastError: '' };
    saveDataNow();
    return result;
  } catch (error) {
    data.config.feedImport = { ...data.config.feedImport, lastError: cleanText(error.message, 300) };
    saveDataNow();
    recordError('Загрузка объектов с сайта', error);
    void tellAdminProblem('feed-import', '⚠️ Не удалось загрузить объекты с сайта: ' + cleanText(error.message, 200) + '. Завтра попробую снова; адрес можно проверить в «' + PLACES.feed + '».');
    return null;
  }
}

export {
  applyImport,
  fetchChecked,
  downloadImage,
  privateIp,
  feedItemOf,
  feedSettings,
  fetchFeed,
  parseXml,
  planImport,
  planSummary,
  propertyTypeOf,
  publicAddress,
  readFeed,
  runDailyFeedImport,
};
