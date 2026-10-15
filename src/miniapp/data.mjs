// Данные для Mini App: то же, что клиент видит в боте, но в виде структуры для интерфейса приложения. Здесь только чтение и
// сборка; ничего не записывается. Всё, что отсюда уходит наружу, и так видно любому в боте (каталог, контакты, «О компании»).

import { cleanText, displayPhone, managerNameFor, fillTemplate } from '../util.mjs';
import { data } from '../store.mjs';
import {
  PROPERTY_ACTION_TEXT, PROPERTY_BADGE_LABELS, PROPERTY_CONDITION_LABELS, PROPERTY_TYPE_LABELS,
} from '../texts.mjs';
import { normalizeGuidePages } from '../data-format.mjs';
import {
  distanceText, localized, localizedExact, objectPriceLine, objectPriceText, priceDropVisible, propertyReadyForLanguage,
  propertyShareUrl, rangeText, recordImages, validHttpUrl, whatsappContactUrl,
} from '../catalog.mjs';
import { calculatorAvailable, calculatorSettings, purchaseEstimate } from '../calculator.mjs';
import { CALCULATOR_TEXT, MENU_LABELS } from '../texts.mjs';
import { replyPromise } from '../hours.mjs';
import { imageExists } from '../media.mjs';
import { LANGUAGES, isCyrillic } from '../languages.mjs';
import { telegramInterfaceLanguage } from '../users.mjs';
import { aiAgentSettings } from '../ai-agent.mjs';
import { servicesOf } from './services.mjs';

const RESIDENTIAL = new Set(['apartment', 'house', 'villa', 'townhouse', 'newbuild']);

function appLanguage(requested, user = null, telegramCode = '') {
  if (LANGUAGES.includes(requested)) return requested;
  if (user && LANGUAGES.includes(user.preferredLanguage)) return user.preferredLanguage;
  // Тот же выбор, что у бота: язык Telegram, если он у нас есть; соседние языки — русский; остальное — английский.
  const raw = String(telegramCode || (user && user.languageCode) || '').trim();
  if (!raw) return 'ru';
  return telegramInterfaceLanguage({ languageCode: raw });
}

function visibleRecords(language) {
  return (Array.isArray(data.objects) ? data.objects : []).filter((record) => ['active', 'reserved'].includes(record.status) && propertyReadyForLanguage(record, language));
}

function findRecord(id, language) {
  return visibleRecords(language).find((record) => record.id === id) || null;
}

// Фото отдаётся по адресу /m/<объект>/<файл>: идентификатор снимка у каждого свой, угадать его чужой объект не позволяет.
function imageUrl(record, image) {
  return '/m/' + encodeURIComponent(record.id) + '/' + encodeURIComponent(image.id);
}

function imagesOf(record, language) {
  return recordImages(record, language).filter((image) => image && image.id);
}

// Найти снимок для выдачи: среди всех языков объекта.
function findImage(recordId, imageId) {
  const record = (data.objects || []).find((item) => item.id === recordId && ['active', 'reserved'].includes(item.status));
  if (!record) return null;
  const groups = record.imagesByLanguage && typeof record.imagesByLanguage === 'object' ? Object.values(record.imagesByLanguage) : [];
  for (const list of groups) {
    const found = (Array.isArray(list) ? list : []).find((image) => image && image.id === imageId && imageExists(image));
    if (found) return found;
  }
  return null;
}

function factList(record, language, full) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const unit = isCyrillic(language) ? 'м²' : 'm²';
  const residential = RESIDENTIAL.has(record.propertyType);
  const facts = [];
  const bedrooms = rangeText(record.bedrooms, record.bedroomsMax, language, true);
  const bathrooms = rangeText(record.bathrooms, 0, language);
  const area = rangeText(record.area, record.areaMax, language);
  if (residential && bedrooms) facts.push({ key: 'bedrooms', label: copy.bedroomsLabel, value: bedrooms });
  if (residential && bathrooms) facts.push({ key: 'bathrooms', label: copy.bathroomsLabel, value: bathrooms });
  if (area) facts.push({ key: 'area', label: copy.areaLabel, value: area + ' ' + unit });
  const plot = rangeText(record.plotArea, 0, language);
  if (plot) facts.push({ key: 'plot', label: copy.plotAreaLabel, value: plot + ' ' + unit });
  const sea = distanceText(record.distanceSea, language);
  if (sea) facts.push({ key: 'sea', label: copy.distanceSeaLabel, value: sea });
  if (full) {
    if (residential && (record.floor || record.floors)) {
      facts.push({ key: 'floor', label: copy.floor, value: [cleanText(record.floor, 20), cleanText(record.floors, 20)].filter(Boolean).join(' / ') });
    }
    const condition = (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition];
    if (condition) facts.push({ key: 'condition', label: copy.conditionLabel, value: condition });
    if (record.reference) facts.push({ key: 'reference', label: copy.reference.replace(/:$/, ''), value: cleanText(record.reference, 80) });
  }
  return facts;
}

// Описание: первый абзац — вступление, строки с точкой-маркером — список, остальные абзацы — текст.
function descriptionParts(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const intro = [];
  const bullets = [];
  const paragraphs = [];
  blocks.forEach((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const listed = lines.filter((line) => /^[•▫️▪️\-–—*]\s*/u.test(line));
    if (listed.length && listed.length === lines.length) listed.forEach((line) => bullets.push(line.replace(/^[•▫️▪️\-–—*]\s*/u, '')));
    else if (index === 0) intro.push(block);
    else paragraphs.push(block);
  });
  return { intro: intro.join('\n'), bullets, paragraphs };
}

function priceOf(record, language) {
  const previous = priceDropVisible(record) ? objectPriceText({ ...record, priceValue: record.previousPriceValue }, language) : '';
  return {
    text: objectPriceText(record, language),
    line: objectPriceLine(record, language),
    value: Number(record.priceValue) > 0 ? Number(record.priceValue) : 0,
    from: record.priceFrom === true,
    currency: cleanText(record.currency, 10) || 'EUR',
    previous,
    rent: record.dealType === 'rent',
  };
}

function cardOf(record, language) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const images = imagesOf(record, language);
  const city = localizedExact(record.city, language, 160);
  const district = localizedExact(record.district, language, 160);
  const badges = (Array.isArray(record.badges) ? record.badges : []).map((badge) => (PROPERTY_BADGE_LABELS[language] || PROPERTY_BADGE_LABELS.ru)[badge]).filter(Boolean);
  const condition = (PROPERTY_CONDITION_LABELS[language] || PROPERTY_CONDITION_LABELS.ru)[record.condition] || '';
  return {
    id: record.id,
    reference: cleanText(record.reference, 80),
    title: localizedExact(record.title, language) || localized(record.title, 'ru') || cleanText(record.reference, 80),
    type: record.propertyType,
    typeLabel: (PROPERTY_TYPE_LABELS[language] || PROPERTY_TYPE_LABELS.ru)[record.propertyType] || '',
    deal: record.dealType === 'rent' ? 'rent' : 'sale',
    dealLabel: record.dealType === 'rent' ? copy.forRent : copy.forSale,
    reserved: record.status === 'reserved',
    reservedLabel: copy.reserved,
    city,
    district,
    place: [city, district].filter(Boolean).join(' · '),
    condition,
    underConstruction: record.condition === 'under_construction',
    price: priceOf(record, language),
    facts: factList(record, language, false),
    badges,
    cover: images[0] ? imageUrl(record, images[0]) : '',
    photoCount: images.length,
    raw: {
      price: Number(record.priceValue) > 0 ? Number(record.priceValue) : 0,
      bedrooms: Number(record.bedrooms) || 0,
      bedroomsMax: Math.max(Number(record.bedrooms) || 0, Number(record.bedroomsMax) || 0),
      area: Number(record.area) || 0,
      areaMax: Math.max(Number(record.area) || 0, Number(record.areaMax) || 0),
      plot: Number(record.plotArea) || 0,
      sea: Number(record.distanceSea) || 0,
      bathrooms: Number(record.bathrooms) || 0,
    },
  };
}

// Калькулятор: сервер отдаёт цену, налоговые строки и настройки по умолчанию; ползунки считает само приложение той же формулой.
function calculatorOf(record, language) {
  if (!calculatorAvailable(record)) return null;
  const estimate = purchaseEstimate(record);
  const copy = CALCULATOR_TEXT[language] || CALCULATOR_TEXT.ru;
  return {
    price: estimate.price,
    currency: cleanText(record.currency, 10) || 'EUR',
    costs: estimate.costs.map((item) => ({ key: item.key, label: copy[item.key] || item.key, percent: item.percent })),
    defaults: { down: estimate.settings.downPaymentPercent, years: estimate.settings.years, interest: estimate.settings.interestPercent },
    note: estimate.business ? copy.businessNote : '',
    disclaimer: copy.disclaimer,
    labels: { costs: copy.costs, total: copy.total, mortgage: copy.mortgage, downPayment: copy.downPayment, loan: copy.loan, monthly: copy.monthly, upfront: copy.upfront, years: copy.years, price: copy.price },
  };
}

function similarOf(record, language, limit = 4) {
  const city = localizedExact(record.city, language, 160);
  return visibleRecords(language)
    .filter((item) => item.id !== record.id)
    .map((item) => ({ item, score: (localizedExact(item.city, language, 160) === city ? 2 : 0) + (item.propertyType === record.propertyType ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => cardOf(entry.item, language));
}

function detailOf(record, language) {
  const card = cardOf(record, language);
  const images = imagesOf(record, language);
  const description = descriptionParts(localizedExact(record.description, language, 6000) || localized(record.description, 'ru'));
  return {
    ...card,
    images: images.map((image) => imageUrl(record, image)),
    factsFull: factList(record, language, true),
    description,
    links: {
      map: validHttpUrl(record.mapUrl),
      video: validHttpUrl(record.videoUrl),
      site: validHttpUrl(record.url),
    },
    shareUrl: propertyShareUrl(record, language),
    calculator: calculatorOf(record, language),
    similar: similarOf(record, language),
  };
}

function companyOf(language, user = null) {
  const contact = data.contacts || {};
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const phones = (String(contact.phone || '').match(/\+?\d[\d\s().-]{5,}\d/g) || []).map((phone) => ({ text: displayPhone(phone), tel: phone.replace(/[^\d+]/g, '') }));
  const telegramName = String(contact.telegram || '').replace(/^@/, '');
  const telegram = /^[A-Za-z0-9_]{5,}$/.test(telegramName) ? 'https://t.me/' + telegramName : validHttpUrl(contact.telegram);
  const whatsapp = contact.whatsappEnabled === false ? '' : whatsappContactUrl(contact.whatsapp, phones[0] && phones[0].tel, '');
  const menu = data.config && data.config.menu && data.config.menu[language] ? data.config.menu[language] : {};
  const about = menu.about ? fillTemplate(menu.about, user || { firstName: '', lastName: '', username: '' }) : '';
  const trust = data.trust && typeof data.trust === 'object' ? data.trust : {};
  const reviews = (Array.isArray(trust.reviews) ? trust.reviews : []).filter((review) => review && review.allowed === true && review.name && review.text).slice(0, 5)
    .map((review) => ({ name: cleanText(review.name, 80), text: cleanText(review.text, 600) }));
  const guide = normalizeGuidePages(data.guidePages).map((page) => ({ title: page.title[language] || page.title.ru, text: page.text[language] || page.text.ru }));
  const promise = replyPromise(language);
  return {
    name: 'Construcciones Kornilenko',
    manager: managerNameFor(contact, language),
    photo: contact.photo && imageExists(contact.photo) ? '/c/photo' : '',
    phones,
    email: cleanText(contact.email, 254),
    website: validHttpUrl(contact.website),
    map: validHttpUrl(contact.mapUrl),
    telegram,
    whatsapp,
    intro: localizedExact(contact.text, language, 3200),
    about,
    promise,
    trust: {
      years: Number(trust.yearsOnMarket) > 0 ? Number(trust.yearsOnMarket) : 0,
      deals: Number(trust.dealsCount) > 0 ? Number(trust.dealsCount) : 0,
      registration: cleanText(trust.registration, 300),
      office: cleanText(trust.officeAddress, 300),
      reviewsUrl: validHttpUrl(trust.reviewsUrl),
      reviews,
    },
    guide,
    labels: { about: (MENU_LABELS[language] || MENU_LABELS.ru).about, details: copy.details },
  };
}

// Что можно отфильтровать: только то, что есть в каталоге.
function facetsOf(cards) {
  const cities = [];
  for (const card of cards) if (card.city && !cities.includes(card.city)) cities.push(card.city);
  const types = [];
  for (const card of cards) if (card.type && !types.some((item) => item.key === card.type)) types.push({ key: card.type, label: card.typeLabel });
  const prices = cards.map((card) => card.raw.price).filter((value) => value > 0);
  return {
    cities,
    types,
    price: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    maxBedrooms: Math.max(0, ...cards.map((card) => card.raw.bedroomsMax)),
    deals: [...new Set(cards.map((card) => card.deal))],
  };
}

// Личная страница клиента: его заявки в понятных этапах и недавно просмотренные проекты. Текст переписки не отдаётся.
function stepOf(inquiry) {
  if (inquiry.status === 'closed') return 4;
  const stage = inquiry.pipelineStage || '';
  if (['viewing', 'negotiation', 'won'].includes(stage) || (inquiry.viewing && inquiry.viewing.confirmedDate)) return 3;
  if (inquiry.status === 'in_progress' || ['contact', 'selection'].includes(stage)) return 2;
  return 1;
}

function meOf(user, language) {
  const visible = visibleRecords(language);
  const cardFor = (id) => {
    const record = visible.find((item) => item.id === id);
    return record ? cardOf(record, language) : null;
  };
  const inquiries = (Array.isArray(data.inquiries) ? data.inquiries : [])
    .filter((item) => String(item.userId) === String(user.id))
    .slice(-8)
    .reverse()
    .map((item) => {
      const card = item.propertyId ? cardFor(item.propertyId) : null;
      return {
        id: item.id,
        type: item.type,
        step: stepOf(item),
        createdAt: item.createdAt || '',
        propertyId: card ? card.id : '',
        title: card ? card.title : '',
        cover: card ? card.cover : '',
        viewing: item.viewing && (item.viewing.dateText || item.viewing.date)
          ? { date: item.viewing.dateText || item.viewing.date, time: item.viewing.confirmedTime || item.viewing.timeText || '', confirmed: Boolean(item.viewing.confirmedDate) }
          : null,
      };
    });
  const recent = (Array.isArray(user.recentlyViewed) ? user.recentlyViewed : []).map(cardFor).filter(Boolean).slice(0, 6);
  return { inquiries, recent };
}

function bootstrapOf(language, user = null) {
  const cards = visibleRecords(language).map((record) => cardOf(record, language));
  return {
    language,
    calculatorOn: Boolean(calculatorSettings().enabled),
    assistant: Boolean(aiAgentSettings()),
    cards,
    facets: facetsOf(cards),
    company: companyOf(language, user),
    services: servicesOf(language),
    favorites: user && Array.isArray(user.favorites) ? user.favorites.filter((id) => cards.some((card) => card.id === id)) : [],
    compare: user && Array.isArray(user.comparisonIds) ? user.comparisonIds.filter((id) => cards.some((card) => card.id === id)) : [],
  };
}

export { appLanguage, bootstrapOf, meOf, cardOf, companyOf, descriptionParts, detailOf, findImage, findRecord, visibleRecords };
