// Панель: проверка и разбор данных, присланных из форм.

import crypto from 'node:crypto';
import { MAX_IMAGE_BYTES } from './config.mjs';
import { cleanText } from './util.mjs';
import { DATA_VERSION, PIPELINE_STAGES, normalizePropertyImages, normalizeStoredImages } from './data-format.mjs';
import { imageBytes, imageExists } from './media.mjs';
import { data } from './store.mjs';
import { validHttpUrl } from './catalog.mjs';
// Счёт попыток входа живёт рядом с картой попыток, в admin-http.
import { LOGIN_LIMIT_PER_ADDRESS, LOGIN_LIMIT_TOTAL, attemptKey, expandIpv6, forgetLoginAttempts, loginAllowed, loginAttempts, parseUploadedImage, rememberFailedLogin } from './admin-http.mjs';

function replyTemplateInput(body) {
  const title = cleanText(body && body.title, 80);
  if (!title) throw new Error('Укажите название шаблона');
  const text = translatedInput(body && body.text, 4000, true);
  return { title, text };
}

function translatedInput(value, maxLength, required = false) {
  const result = {};
  for (const language of ['ru', 'en', 'es']) result[language] = cleanText(value && value[language], maxLength);
  if (required && !result.ru && !result.en && !result.es) throw new Error('Заполните текст хотя бы на одном языке');
  return result;
}

function messagesInput(value) {
  const incomingMessages = value && typeof value === 'object' ? value : {};
  const nextMessages = {};
  for (const language of ['ru', 'en', 'es']) {
    const incoming = incomingMessages[language] || {};
    nextMessages[language] = {
      greeting: cleanText(incoming.greeting, 4000),
      help: cleanText(incoming.help, 4000),
      fallback: cleanText(incoming.fallback, 4000),
    };
    if (!nextMessages[language].greeting || !nextMessages[language].help) {
      throw new Error('Приветствие и помощь должны быть заполнены на всех языках');
    }
  }
  return nextMessages;
}

function menuInput(value) {
  const incomingMenu = value && typeof value === 'object' ? value : {};
  const nextMenu = {};
  for (const language of ['ru', 'en', 'es']) {
    const incoming = incomingMenu[language] || {};
    nextMenu[language] = {};
    for (const key of ['objects', 'contacts', 'promotions', 'about']) {
      nextMenu[language][key] = cleanText(incoming[key], 4000);
      if (!nextMenu[language][key]) throw new Error('Заполните все пункты меню на каждом языке');
    }
  }
  return nextMenu;
}

function validateStoredImage(image, label) {
  if (!image) return;
  if (!image || typeof image !== 'object' || !imageExists(image)) {
    throw new Error('Некорректное изображение: ' + label);
  }
  const bytes = imageBytes(image);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Некорректный размер изображения: ' + label);
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (!isJpeg && !isPng) throw new Error('Некорректный формат изображения: ' + label);
}

// Проверка делится надвое. Сначала — что это вообще наша копия и подходящая
// версия: это можно сделать, ничего не трогая на диске. И только потом, когда
// фотографии из копии уже лежат на месте, проверяются сами изображения.
function validateBackupStructure(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('Некорректная структура файла');
  // Копия из более новой версии: восстановить её — значит потерять всё, чего
  // эта программа ещё не знает.
  const backupVersion = Number(backup.version) || 0;
  if (backupVersion > DATA_VERSION) {
    throw new Error('Копия сделана более новой версией бота (' + backupVersion + ', программа понимает '
      + DATA_VERSION + '). Обновите бота и повторите');
  }
  if (!backup.config || typeof backup.config !== 'object') throw new Error('В копии отсутствуют настройки');
  if (!cleanText(backup.config.passwordHash, 300) || !cleanText(backup.config.passwordSalt, 300)) {
    throw new Error('В копии отсутствуют настройки входа');
  }
  if (backup.users != null && (typeof backup.users !== 'object' || Array.isArray(backup.users))) throw new Error('Некорректный список пользователей');
  if (backup.users && Object.keys(backup.users).length > 100000) throw new Error('Слишком много пользователей в копии');
  for (const key of ['rules', 'objects', 'promotions', 'broadcasts', 'inquiries', 'errors']) {
    if (backup[key] != null && !Array.isArray(backup[key])) throw new Error('Некорректный раздел: ' + key);
  }
}

function validateBackupPayload(backup) {
  validateBackupStructure(backup);
  for (const language of ['ru', 'en', 'es']) validateStoredImage(backup.welcomeImages && backup.welcomeImages[language], 'приветствие ' + language);
  validateStoredImage(backup.contacts && backup.contacts.photo, 'фото менеджера');
  for (const key of ['objects', 'promotions', 'broadcasts']) {
    for (const record of backup[key] || []) {
      validateStoredImage(record && record.image, key);
      for (const image of (record && Array.isArray(record.images) ? record.images : [])) validateStoredImage(image, key + ' gallery');
      if ((key === 'objects' || key === 'promotions') && record && record.imagesByLanguage && typeof record.imagesByLanguage === 'object') {
        for (const language of ['ru', 'en', 'es']) {
          for (const image of (Array.isArray(record.imagesByLanguage[language]) ? record.imagesByLanguage[language] : [])) {
            validateStoredImage(image, key + ' ' + language + ' gallery');
          }
        }
      }
    }
  }
}

function parseOptionalImage(body, existing) {
  if (body.removeImage) return null;
  if (body.imageDataUrl) return parseUploadedImage(body.imageDataUrl, body.imageName || 'image.jpg');
  return existing || null;
}

function optionalNumber(value, label, maximum = 1000000000) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) throw new Error('Некорректное значение: ' + label);
  return number;
}

function languageImageInput(body, field, language, legacyField) {
  const group = body && body[field];
  if (group && typeof group === 'object' && !Array.isArray(group)) return group[language];
  return language === 'ru' && legacyField ? body[legacyField] : undefined;
}

function parseContentImages(body, currentImages, language) {
  let images = normalizeStoredImages({ images: currentImages });
  const removeAll = Boolean(languageImageInput(body, 'removeImagesByLanguage', language, 'removeImage'));
  if (removeAll) images = [];
  const removedInput = languageImageInput(body, 'removeImageIdsByLanguage', language, 'removeImageIds');
  const removed = new Set(Array.isArray(removedInput) ? removedInput.map(String) : []);
  images = images.filter((image) => !removed.has(String(image.id)));
  const orderInput = languageImageInput(body, 'imageOrderByLanguage', language, 'imageOrder');
  const order = Array.isArray(orderInput) ? orderInput.map(String) : [];
  if (order.length) {
    const positions = new Map(order.map((id, index) => [id, index]));
    images.sort((a, b) => (positions.has(String(a.id)) ? positions.get(String(a.id)) : 1000) - (positions.has(String(b.id)) ? positions.get(String(b.id)) : 1000));
  }
  const incomingInput = languageImageInput(body, 'imageDataUrlsByLanguage', language, 'imageDataUrls');
  const incoming = Array.isArray(incomingInput) ? incomingInput : [];
  const added = [];
  for (const item of incoming) {
    if (images.length + added.length >= 10) throw new Error('Для языка ' + language.toUpperCase() + ' можно загрузить не более 10 фотографий');
    const image = parseUploadedImage(item && item.dataUrl, item && item.name || 'property.jpg');
    added.push({ token: cleanText(item && item.clientId, 100) || image.id, image });
  }
  if (language === 'ru' && !incoming.length && body.imageDataUrl) {
    images = [parseUploadedImage(body.imageDataUrl, body.imageName || 'property.jpg')];
  }
  const sequenceInput = languageImageInput(body, 'imageSequenceByLanguage', language, 'imageSequence');
  const sequence = Array.isArray(sequenceInput) ? sequenceInput.map(String).slice(0, 20) : [];
  if (!sequence.length) return images.concat(added.map((item) => item.image));
  const available = new Map();
  for (const image of images) available.set(String(image.id), image);
  for (const item of added) available.set(item.token, item.image);
  const ordered = [];
  for (const token of sequence) {
    const image = available.get(token);
    if (!image || ordered.includes(image)) continue;
    ordered.push(image);
  }
  for (const image of images.concat(added.map((item) => item.image))) {
    if (!ordered.includes(image)) ordered.push(image);
  }
  return ordered.slice(0, 10);
}

function parseContentRecord(body, kind, existing = {}) {
  const now = new Date().toISOString();
  const localizedImageKind = kind === 'objects' || kind === 'promotions';
  const currentImagesByLanguage = localizedImageKind ? normalizePropertyImages(existing) : { ru: [], en: [], es: [] };
  const imagesByLanguage = localizedImageKind ? Object.fromEntries(['ru', 'en', 'es'].map((language) => [
    language,
    parseContentImages(body, currentImagesByLanguage[language], language),
  ])) : { ru: [], en: [], es: [] };
  const mapUrl = kind === 'objects' ? cleanText(body.mapUrl, 500) : '';
  const videoUrl = kind === 'objects' ? cleanText(body.videoUrl, 500) : '';
  const common = {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    title: translatedInput(body.title, 160, true),
    url: cleanText(body.url, 500),
    image: localizedImageKind ? undefined : parseOptionalImage(body, existing.image),
    updatedAt: now,
    createdAt: existing.createdAt || now,
  };
  if (common.url && !validHttpUrl(common.url)) throw new Error('Ссылка должна начинаться с http:// или https://');
  if (mapUrl && !validHttpUrl(mapUrl)) throw new Error('Ссылка на карту должна начинаться с http:// или https://');
  if (videoUrl && !validHttpUrl(videoUrl)) throw new Error('Ссылка на видео или 3D-тур должна начинаться с http:// или https://');
  if (kind === 'objects') {
    delete common.images;
    delete common.image;
    const record = {
      ...common,
      imagesByLanguage,
      description: translatedInput(body.description, 3000),
      address: translatedInput(body.address, 500),
      price: translatedInput(body.price, 120),
      priceValue: optionalNumber(body.priceValue, 'цена'),
      currency: ['EUR', 'USD', 'GBP', 'UAH', 'RUB'].includes(body.currency) ? body.currency : 'EUR',
      pricePeriod: ['total', 'month', 'week'].includes(body.pricePeriod) ? body.pricePeriod : 'total',
      priceFrom: body.priceFrom === true,
      dealType: ['sale', 'rent'].includes(body.dealType) ? body.dealType : 'sale',
      propertyType: ['apartment', 'house', 'villa', 'townhouse', 'land', 'commercial', 'newbuild', 'other'].includes(body.propertyType) ? body.propertyType : 'apartment',
      reference: cleanText(body.reference, 80),
      city: translatedInput(body.city, 160),
      district: translatedInput(body.district, 160),
      bedrooms: optionalNumber(body.bedrooms, 'спальни', 100),
      // Комплекс из нескольких вариантов: верхняя граница спален и площади (0 — не указана).
      bedroomsMax: optionalNumber(body.bedroomsMax, 'спальни до', 100) || 0,
      areaMax: optionalNumber(body.areaMax, 'площадь до', 1000000) || 0,
      bathrooms: optionalNumber(body.bathrooms, 'санузлы', 100),
      area: optionalNumber(body.area, 'площадь', 1000000),
      plotArea: optionalNumber(body.plotArea, 'площадь участка', 10000000),
      floor: cleanText(body.floor, 20),
      floors: cleanText(body.floors, 20),
      distanceSea: optionalNumber(body.distanceSea, 'расстояние до моря', 100000),
      condition: ['new', 'renovated', 'needs_renovation', 'under_construction', ''].includes(body.condition) ? body.condition : '',
      mapUrl,
      videoUrl,
      badges: Array.isArray(body.badges) ? body.badges.filter((item) => ['new', 'recommended', 'exclusive', 'price_reduced'].includes(item)) : [],
      status: ['active', 'hidden', 'reserved', 'sold'].includes(body.status) ? body.status : 'active',
    };
    // Карточку сохраняем и незаполненной: клиент видит объект только на тех
    // языках, где заполнено всё (catalog.mjs), поэтому недоделанная карточка
    // никуда не попадёт сама. Отказ в сохранении означал бы, что объект из
    // выгрузки нельзя даже поправить — ни город, ни название.
    return record;
  }
  const startAt = cleanText(body.startAt, 40);
  const endAt = cleanText(body.endAt, 40);
  if (startAt && !Number.isFinite(Date.parse(startAt))) throw new Error('Некорректная дата начала акции');
  if (endAt && !Number.isFinite(Date.parse(endAt))) throw new Error('Некорректная дата окончания акции');
  if (startAt && endAt && Date.parse(startAt) > Date.parse(endAt)) throw new Error('Дата окончания должна быть позже даты начала');
  return {
    ...common,
    imagesByLanguage,
    text: translatedInput(body.text, 3000),
    startAt,
    endAt,
    enabled: body.enabled !== false,
  };
}

function rulesConflict(candidate, exceptId = '') {
  const input = cleanText(candidate.trigger, 200).toLocaleLowerCase('ru-RU');
  return data.rules.filter((rule) => {
    if (rule.id === exceptId || !rule.enabled) return false;
    const sameLanguage = rule.language === candidate.language || rule.language === 'all' || candidate.language === 'all';
    if (!sameLanguage) return false;
    const trigger = cleanText(rule.trigger, 200).toLocaleLowerCase('ru-RU');
    return trigger === input || (rule.type === 'contains' && input.includes(trigger)) || (candidate.type === 'contains' && trigger.includes(input));
  });
}

function parseBroadcast(body, existing = {}, options = {}) {
  const requireMessages = options.requireMessages !== false;
  const requireSelectedTexts = options.requireSelectedTexts !== false;
  const messages = translatedInput(body.messages || (body.text ? { ru: body.text, en: body.text, es: body.text } : {}), 4000, requireMessages);
  const languages = Array.isArray(body.languages) ? body.languages.filter((language) => ['ru', 'en', 'es'].includes(language)) : [];
  if (requireSelectedTexts) {
    if (!languages.length) throw new Error('Выберите хотя бы один язык аудитории');
    for (const language of languages) {
      if (!messages[language]) throw new Error('Заполните текст для каждого выбранного языка');
    }
  }
  const buttonUrl = cleanText(body.buttonUrl, 500);
  const buttonText = translatedInput(body.buttonText, 80);
  if (buttonUrl && !validHttpUrl(buttonUrl)) throw new Error('Ссылка кнопки должна начинаться с http:// или https://');
  if (buttonUrl && languages.some((language) => !buttonText[language])) throw new Error('Введите название кнопки для каждого выбранного языка');
  const scheduledAt = cleanText(body.scheduledAt, 40);
  if (scheduledAt && !Number.isFinite(Date.parse(scheduledAt))) throw new Error('Некорректная дата рассылки');
  const pipelineStages = Array.isArray(body.pipelineStages) ? body.pipelineStages.filter((stage) => PIPELINE_STAGES.includes(stage)).slice(0, PIPELINE_STAGES.length) : [];
  const sources = Array.isArray(body.sources) ? body.sources.map((source) => cleanText(source, 80)).filter(Boolean).slice(0, 20) : [];
  const propertyId = cleanText(body.propertyId, 100);
  const propertySignal = ['any', 'favorite', 'comparison', 'viewed', 'match', 'inquiry'].includes(body.propertySignal) ? body.propertySignal : 'any';
  if (propertyId && !data.objects.some((record) => String(record.id) === propertyId)) throw new Error('Выбранный объект больше не найден в каталоге');
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    messages,
    languages,
    tags: Array.isArray(body.tags) ? body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20) : [],
    pipelineStages,
    sources,
    propertyId,
    propertySignal: propertyId ? propertySignal : 'any',
    // Карточкой объекта: фотография и кнопки вместо голого текста.
    sendAsCard: Boolean(propertyId) && body.sendAsCard === true,
    buttonText,
    buttonUrl,
    image: parseOptionalImage(body, existing.image),
    scheduledAt,
    status: existing.status || 'draft',
    createdAt: existing.createdAt || now,
    updatedAt: now,
    total: Number(existing.total || 0),
    sent: Number(existing.sent || 0),
    failed: Number(existing.failed || 0),
  };
}

export {
  validateBackupStructure,
  LOGIN_LIMIT_PER_ADDRESS,
  expandIpv6,
  forgetLoginAttempts,
  rememberFailedLogin,
  LOGIN_LIMIT_TOTAL,
  attemptKey,
  languageImageInput,
  loginAllowed,
  menuInput,
  messagesInput,
  optionalNumber,
  parseBroadcast,
  parseContentImages,
  parseContentRecord,
  parseOptionalImage,
  replyTemplateInput,
  rulesConflict,
  translatedInput,
  validateBackupPayload,
  validateStoredImage,
};
