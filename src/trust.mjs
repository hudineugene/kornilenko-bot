// «✅ Почему мы» — экран доверия. Покупатель из-за границы решает, доверить ли деньги
// незнакомой фирме: ему нужны лицо агента, цифры, регистрационные данные, адрес
// офиса и отзывы живых людей. Всё это вписывает владелец (панель → «Тексты бота →
// Почему мы»); бот сам ничего не сочиняет. Пока не заполнено ни одного пункта,
// экран и ведущие к нему кнопки клиентам не показываются.

import { cleanText, managerNameFor } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { normalizeUser } from './users.mjs';
import { sendUiMessage, validHttpUrl } from './catalog.mjs';
import { MENU_LABELS, NAVIGATION_TEXT } from './texts.mjs';
import { acknowledgeCallback, sendManagerPhoto, whatsappRow } from './sections.mjs';
import { imageExists } from './media.mjs';
import { addUk, isCyrillic } from './languages.mjs';

const TRUST_TEXT = {
  ru: {
    title: '✅ Почему мы',
    button: '✅ Почему мы',
    years: '📆 На рынке: ',
    deals: '🤝 Сделок: ',
    registration: '🏛 ',
    office: '📍 Офис: ',
    reviews: '⭐ Отзывы клиентов',
    reviewsLink: '⭐ Все отзывы',
    map: '📍 Офис на карте',
    yearsWord: ['год', 'года', 'лет'],
    whatsappHello: 'Здравствуйте! Хочу задать вопрос по вашей компании.',
  },
  en: {
    title: '✅ Why choose us',
    button: '✅ Why choose us',
    years: '📆 On the market: ',
    deals: '🤝 Deals closed: ',
    registration: '🏛 ',
    office: '📍 Office: ',
    reviews: '⭐ Client reviews',
    reviewsLink: '⭐ All reviews',
    map: '📍 Office on the map',
    yearsWord: ['year', 'years', 'years'],
    whatsappHello: 'Hello! I have a question about your company.',
  },
  es: {
    title: '✅ Por qué elegirnos',
    button: '✅ Por qué elegirnos',
    years: '📆 En el mercado: ',
    deals: '🤝 Operaciones cerradas: ',
    registration: '🏛 ',
    office: '📍 Oficina: ',
    reviews: '⭐ Opiniones de clientes',
    reviewsLink: '⭐ Todas las opiniones',
    map: '📍 Oficina en el mapa',
    yearsWord: ['año', 'años', 'años'],
    whatsappHello: '¡Hola! Tengo una pregunta sobre vuestra empresa.',
  },
};
addUk(TRUST_TEXT);

function copyFor(language) {
  return TRUST_TEXT[language] || TRUST_TEXT.ru;
}

function trustData() {
  return data.trust && typeof data.trust === 'object' ? data.trust : {};
}

// Отзывы, которые можно показывать: есть имя и текст, и владелец подтвердил
// разрешение автора на публикацию.
function shownReviews() {
  return (Array.isArray(trustData().reviews) ? trustData().reviews : []).filter((review) => review.allowed === true && review.name && review.text);
}

// Экран есть, только если владелец вписал хоть что-то от себя. Имя и фото агента
// одни экрана не создают: они есть на экране «Связаться».
function trustAvailable() {
  const trust = trustData();
  return Boolean(Number(trust.yearsOnMarket) > 0 || Number(trust.dealsCount) > 0 || trust.registration || trust.officeAddress || trust.reviewsUrl || shownReviews().length);
}

function russianPlural(count, forms) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (ones === 1) return forms[0];
  return ones >= 2 && ones <= 4 ? forms[1] : forms[2];
}

function trustText(language) {
  const copy = copyFor(language);
  const trust = trustData();
  const contact = data.contacts || {};
  const lines = [copy.title, ''];
  const years = Number(trust.yearsOnMarket) || 0;
  const deals = Number(trust.dealsCount) || 0;
  const name = managerNameFor(contact, language);
  if (name && !imageExists(contact.photo)) lines.push('👨‍💼 ' + name);
  if (years) lines.push(copy.years + years + ' ' + (isCyrillic(language) ? russianPlural(years, copy.yearsWord) : years === 1 ? copy.yearsWord[0] : copy.yearsWord[1]));
  if (deals) lines.push(copy.deals + deals);
  if (trust.registration) lines.push(copy.registration + cleanText(trust.registration, 500));
  if (trust.officeAddress) lines.push(copy.office + cleanText(trust.officeAddress, 300));
  const reviews = shownReviews();
  if (reviews.length) {
    lines.push('', copy.reviews);
    for (const review of reviews) {
      lines.push('«' + cleanText(review.text, 600) + '»', '— ' + [review.name, review.country].filter(Boolean).join(', '), '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function trustMarkup(language) {
  const copy = copyFor(language);
  const trust = trustData();
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const rows = [];
  const map = validHttpUrl(data.contacts && data.contacts.mapUrl);
  const links = [];
  if (trust.reviewsUrl) links.push({ text: copy.reviewsLink, url: trust.reviewsUrl });
  if (map && trust.officeAddress) links.push({ text: copy.map, url: map });
  if (links.length) rows.push(links);
  rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).contacts, callback_data: 'contact:question' }]);
  const whatsapp = whatsappRow(copy.whatsappHello);
  if (whatsapp) rows.push(whatsapp);
  rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
  return { inline_keyboard: rows };
}

// Ряд с кнопкой на других экранах (гид, «Подробнее», «Ещё», «Связаться»); null,
// пока экран пуст.
function trustButtonRow(language) {
  return trustAvailable() ? [{ text: copyFor(language).button, callback_data: 'trust:open' }] : null;
}

async function sendTrust(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const contact = data.contacts || {};
  const name = managerNameFor(contact, language);
  const photoMessageId = await sendManagerPhoto(chatId, user, contact, name, token);
  const sent = await sendUiMessage(chatId, user, trustText(language), token, { reply_markup: trustMarkup(language) });
  if (photoMessageId && sent && Number.isFinite(Number(sent.message_id))) {
    user.uiMessageIds = [photoMessageId, Number(sent.message_id)];
    scheduleSave();
  }
}

async function handleTrustCallback(query, token) {
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  // Владелец мог очистить экран, пока клиент читал: показывать нечего.
  if (!trustAvailable()) return;
  await sendTrust(chatId, user, token);
}

export { TRUST_TEXT, handleTrustCallback, sendTrust, shownReviews, trustAvailable, trustButtonRow, trustMarkup, trustText };
