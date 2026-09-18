// Загрузка объектов из XML-выгрузки для порталов (формат Kyero v3, его
// отдают большинство сайтов агентств в Испании). Объекты сопоставляются по
// номеру (<ref>): новые создаются, у существующих обновляются цена и
// характеристики. Названия, тексты и фотографии, которые администратор уже
// заполнил в панели, не перезаписываются.

import crypto from 'node:crypto';
import { cleanText } from './util.mjs';
import { PROPERTY_TYPE_LABELS } from './texts.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { parseUploadedImage } from './admin-http.mjs';
import { queuePropertyAlerts } from './alerts.mjs';

const MAX_FEED_BYTES = 20 * 1024 * 1024;
const MAX_FEED_PROPERTIES = 2000;
const MAX_IMAGES_PER_PROPERTY = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;
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

function parseXml(text) {
  const root = { name: '#root', attributes: {}, children: [], text: '' };
  const stack = [root];
  const pattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|</g;
  for (const match of String(text).matchAll(pattern)) {
    const node = stack[stack.length - 1];
    if (match[1] !== undefined) node.text += match[1];
    else if (match[2]) {
      // Tolerant: close up to the matching element, ignore a stray end tag.
      const index = stack.map((item) => item.name).lastIndexOf(match[2]);
      if (index > 0) stack.length = index;
    } else if (match[3]) {
      const attributes = {};
      for (const [, name, double, single] of String(match[4] || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attributes[name] = decodeEntities(double !== undefined ? double : single);
      }
      const element = { name: match[3], attributes, children: [], text: '' };
      node.children.push(element);
      if (!match[5]) stack.push(element);
    } else if (match[6] !== undefined) node.text += decodeEntities(match[6]);
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
  const type = propertyTypeOf(textOf(node, 'type'));
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
  const generated = generatedTitle(type, town);
  return {
    reference,
    fields: {
      dealType: ['month', 'week'].includes(frequency) ? 'rent' : 'sale',
      pricePeriod: frequency === 'month' ? 'month' : frequency === 'week' ? 'week' : 'total',
      priceValue: numberOf(textOf(node, 'price')),
      currency: ['EUR', 'USD', 'GBP'].includes(textOf(node, 'currency').toUpperCase()) ? textOf(node, 'currency').toUpperCase() : 'EUR',
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

function referenceKey(value) {
  return String(value || '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
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
    (changed ? plan.update : plan.unchanged).push({ item, record: existing });
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

async function downloadImage(address, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(address, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('больше 5 МБ');
    const mime = type === 'image/png' || bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : 'image/jpeg';
    return parseUploadedImage('data:' + mime + ';base64,' + bytes.toString('base64'), address.split('/').pop().split('?')[0] || 'photo.jpg');
  } finally {
    clearTimeout(timer);
  }
}

// Creates and updates properties. New ones are hidden unless publishNew:
// the admin looks at them first. Returns counts and problems.
async function applyImport(items, options = {}) {
  const fetcher = options.fetcher || fetch;
  const plan = planImport(items);
  const now = new Date().toISOString();
  const result = { ...planSummary(plan), images: 0, imageErrors: 0, alerts: 0 };
  for (const item of plan.create) {
    const images = [];
    for (const address of item.images) {
      try {
        images.push(await downloadImage(address, fetcher));
        result.images += 1;
      } catch (error) {
        result.imageErrors += 1;
      }
    }
    const record = {
      id: crypto.randomUUID(),
      status: options.publishNew && images.length ? 'active' : 'hidden',
      reference: item.reference,
      ...item.fields,
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
      // The same photo files for every language; stored once on disk.
      imagesByLanguage: { ru: images, en: images.map((image) => ({ ...image, id: crypto.randomUUID() })), es: images.map((image) => ({ ...image, id: crypto.randomUUID() })) },
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    data.objects.push(record);
    result.alerts += queuePropertyAlerts(record, null);
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
      const images = [];
      for (const address of item.images) {
        try {
          images.push(await downloadImage(address, fetcher));
          result.images += 1;
        } catch {
          result.imageErrors += 1;
        }
      }
      record.imagesByLanguage = { ru: images, en: images.map((image) => ({ ...image, id: crypto.randomUUID() })), es: images.map((image) => ({ ...image, id: crypto.randomUUID() })) };
    }
    record.importedAt = now;
    record.updatedAt = now;
    result.alerts += queuePropertyAlerts(record, before);
  }
  for (const { record } of plan.unchanged) record.importedAt = now;
  saveDataNow();
  return result;
}

async function fetchFeed(address, fetcher = fetch) {
  if (!/^https?:\/\//i.test(String(address || ''))) throw new Error('Ссылка на выгрузку должна начинаться с http:// или https://');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(address, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error('сайт ответил ' + response.status);
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_FEED_BYTES) throw new Error('выгрузка больше 20 МБ');
    return text;
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

// Once a day from the saved link, when that is switched on.
async function runDailyFeedImport(now = new Date(), fetcher = fetch) {
  const settings = feedSettings();
  if (!settings.daily || !settings.url) return null;
  const last = Date.parse(settings.lastRunAt || '');
  if (Number.isFinite(last) && now.getTime() - last < FEED_REFRESH_MS) return null;
  data.config.feedImport = { ...settings, lastRunAt: now.toISOString() };
  try {
    const result = await applyImport(readFeed(await fetchFeed(settings.url, fetcher)), { publishNew: settings.publishNew, fetcher });
    data.config.feedImport = { ...data.config.feedImport, lastResult: result, lastError: '' };
    saveDataNow();
    return result;
  } catch (error) {
    data.config.feedImport = { ...data.config.feedImport, lastError: cleanText(error.message, 300) };
    saveDataNow();
    recordError('Загрузка объектов с сайта', error);
    return null;
  }
}

export {
  applyImport,
  feedItemOf,
  feedSettings,
  fetchFeed,
  parseXml,
  planImport,
  planSummary,
  propertyTypeOf,
  readFeed,
  runDailyFeedImport,
};
