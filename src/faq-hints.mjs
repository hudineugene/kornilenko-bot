// Подсказки к частым вопросам. Клиент пишет «где ваш офис?», «какие налоги?», «кто вы?», «пришлите планировку» — раньше такое
// сообщение молча уходило менеджеру, хотя ответ на кнопку или два уже есть в самом боте. Теперь бот отвечает короткой подсказкой
// с кнопками на готовые экраны (контакты и карта, «О компании», справочник по покупке, каталог). Сообщение менеджеру уходит
// как прежде: подсказка ничего не заменяет, а только не оставляет клиента в тишине. Свои ответы на вопросы владелец по-прежнему
// настраивает в «Тексты бота → Автоответы» — они сильнее подсказок.

import { data } from './store.mjs';
import { validHttpUrl } from './catalog.mjs';
import { GUIDE_COSTS_PAGE } from './goal.mjs';

const COOLDOWN_MS = 30 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 200;
const lastHints = new Map();

// Порядок важен: берётся первая подходящая тема. Слова — корни, ищутся внутри сообщения.
const INTENTS = [
  {
    key: 'contacts',
    words: {
      ru: ['телефон', 'позвонить', 'контакты', 'ваш адрес', 'адрес офиса', 'где офис', 'офис', 'где вы находитесь', 'как вас найти', 'ватсап', 'вотсап', 'whatsapp'],
      en: ['phone number', 'your phone', 'call you', 'your contacts', 'your address', 'your office', 'where are you located', 'where is your office', 'whatsapp'],
      es: ['teléfono', 'telefono', 'llamaros', 'vuestro contacto', 'vuestra dirección', 'vuestra direccion', 'vuestra oficina', 'dónde estáis', 'donde estais', 'whatsapp'],
    },
  },
  {
    key: 'about',
    words: {
      ru: ['кто вы', 'кто такие', 'о компании', 'о вашей компании', 'вы застройщик', 'застройщик или', 'вы агентство', 'агентство или', 'вам можно доверять', 'надёжн', 'надежн', 'сколько лет на рынке', 'опыт работы'],
      en: ['who are you', 'about your company', 'about the company', 'are you a developer', 'developer or', 'are you an agency', 'agency or', 'can i trust', 'are you reliable', 'how long have you'],
      es: ['quiénes sois', 'quienes sois', 'sobre la empresa', 'sois promotor', 'promotor o', 'sois una agencia', 'agencia o', 'puedo confiar', 'sois fiables', 'cuánto tiempo lleváis', 'cuanto tiempo llevais'],
    },
  },
  {
    key: 'howto',
    words: {
      ru: ['как купить', 'как происходит покупка', 'порядок покупки', 'этапы сделки', 'какие документы', 'как оформить', 'процесс покупки', 'что такое nie', 'нужен ли nie'],
      en: ['how to buy', 'how do i buy', 'buying process', 'steps to buy', 'what documents', 'which documents', 'what is nie', 'do i need nie'],
      es: ['cómo comprar', 'como comprar', 'proceso de compra', 'pasos para comprar', 'qué documentos', 'que documentos', 'necesito nie'],
    },
  },
  {
    key: 'costs',
    words: {
      ru: ['налог', 'расходы при покупке', 'дополнительные расходы', 'сколько стоит оформление', 'ипотек', 'кредит', 'нотариус', 'itp', 'iva'],
      en: ['taxes', 'closing costs', 'extra costs', 'additional costs', 'mortgage', 'loan', 'notary', 'itp', 'iva'],
      es: ['impuestos', 'gastos de compra', 'gastos adicionales', 'hipoteca', 'préstamo', 'prestamo', 'notario', 'itp', 'iva'],
    },
  },
  {
    key: 'photos',
    words: {
      ru: ['планировк', 'фото', 'видео', 'рендер', 'чертеж', 'чертёж'],
      en: ['floor plan', 'floorplan', 'layout', 'photos', 'pictures', 'video', 'render'],
      es: ['planos', 'plano de', 'fotos', 'vídeo', 'video', 'render'],
    },
  },
  {
    key: 'price',
    // «Сколько стоит двухкомнатная?» — про объект; «сколько стоит содержание квартиры» — уже про другое, подсказка не нужна.
    needs: ['квартир', 'комнат', 'спальн', 'вилл', 'апартамент', 'студи', 'объект', 'flat', 'apartment', 'villa', 'bedroom', 'studio', 'piso', 'dormitorio'],
    blocks: ['содержан', 'коммунал', 'обслужив', 'аренд', 'maintenance', 'upkeep', 'community fee', 'rent', 'comunidad', 'alquiler'],
    words: {
      ru: ['сколько стоит', 'какая цена', 'цена', 'стоимость', 'прайс', 'почём', 'почем'],
      en: ['how much', 'price', 'what does it cost', 'cost of'],
      es: ['cuánto cuesta', 'cuanto cuesta', 'precio', 'cuánto vale', 'cuanto vale'],
    },
  },
];

const TEXT = {
  ru: {
    contacts: '📍 Контакты и офис — по кнопкам ниже.',
    about: 'ℹ️ Коротко о компании — по кнопке ниже.',
    howto: '📖 Порядок покупки в Испании по шагам — в нашем справочнике.',
    costs: '🧾 Налоги, расходы и ипотека — в нашем справочнике. Точный расчёт по вашему объекту сделает менеджер.',
    photos: '📷 Фотографии и характеристики — в карточках объектов (кнопка «Фото»). Планировки и дополнительные материалы пришлёт менеджер.',
    price: '💶 Цены указаны в карточках («от …» — цена самого доступного варианта). Актуальный прайс по вариантам пришлёт менеджер.',
    manager: 'Менеджер тоже получил ваше сообщение.',
    buttons: { contacts: '☎️ Контакты', map: '📍 Офис на карте', about: 'ℹ️ О компании', guide: '📖 Как купить', costs: '🧾 Сколько стоит сделка', catalog: '🏘 Объекты' },
  },
  en: {
    contacts: '📍 Contacts and office — use the buttons below.',
    about: 'ℹ️ A short word about the company — use the button below.',
    howto: '📖 The buying process in Spain, step by step — in our guide.',
    costs: '🧾 Taxes, costs and mortgages — in our guide. An agent will calculate exact figures for your property.',
    photos: '📷 Photos and details are on the property cards (the “Photos” button). An agent will send floor plans and extra materials.',
    price: '💶 Prices are on the cards (“from …” is the price of the most affordable option). An agent will send the current price list for the options.',
    manager: 'An agent also received your message.',
    buttons: { contacts: '☎️ Contacts', map: '📍 Office on the map', about: 'ℹ️ About', guide: '📖 Buying guide', costs: '🧾 Closing costs', catalog: '🏘 Properties' },
  },
  es: {
    contacts: '📍 Contacto y oficina: en los botones de abajo.',
    about: 'ℹ️ Unas palabras sobre la empresa: en el botón de abajo.',
    howto: '📖 El proceso de compra en España paso a paso: en nuestra guía.',
    costs: '🧾 Impuestos, gastos e hipoteca: en nuestra guía. Un asesor calculará las cifras exactas de tu inmueble.',
    photos: '📷 Las fotos y los datos están en las fichas (botón «Fotos»). Un asesor te enviará los planos y más material.',
    price: '💶 Los precios están en las fichas («desde …» es el precio de la opción más económica). Un asesor te enviará la lista de precios actual.',
    manager: 'Un asesor también ha recibido tu mensaje.',
    buttons: { contacts: '☎️ Contacto', map: '📍 Oficina en el mapa', about: 'ℹ️ La empresa', guide: '📖 Cómo comprar', costs: '🧾 Gastos de compra', catalog: '🏘 Inmuebles' },
  },
};

function normalized(text) {
  return String(text || '').toLocaleLowerCase('ru-RU').replace(/[ё]/g, 'е').replace(/\s+/g, ' ').trim();
}

// Подсказки без риска ошибиться: только навигационные темы. Про налоги, ипотеку и цену клиент после первого сообщения получает
// ответ менеджера, а не подсказку («И ещё вопрос про налоги» в уже открытом разговоре остаётся без реакции бота).
const FOLLOW_UP_INTENTS = new Set(['contacts', 'about', 'howto', 'photos']);

function intentOf(text, followUp = false) {
  const message = normalized(text);
  if (!message || message.length > MAX_MESSAGE_LENGTH) return '';
  for (const intent of INTENTS) {
    if (followUp && !FOLLOW_UP_INTENTS.has(intent.key)) continue;
    if (!Object.values(intent.words).some((list) => list.some((word) => message.includes(normalized(word))))) continue;
    if (intent.needs && !intent.needs.some((word) => message.includes(word))) continue;
    if (intent.blocks && intent.blocks.some((word) => message.includes(word))) continue;
    return intent.key;
  }
  return '';
}

function rowsFor(key, language) {
  const labels = (TEXT[language] || TEXT.ru).buttons;
  const map = validHttpUrl(data.contacts && data.contacts.mapUrl);
  if (key === 'contacts') {
    return [[{ text: labels.contacts, callback_data: 'contact:show' }, ...(map ? [{ text: labels.map, url: map }] : [])]];
  }
  if (key === 'about') return [[{ text: labels.about, callback_data: 'nav:about' }]];
  if (key === 'howto') return [[{ text: labels.guide, callback_data: 'guide:page:0' }]];
  if (key === 'costs') return [[{ text: labels.costs, callback_data: 'guide:page:' + GUIDE_COSTS_PAGE }]];
  return [[{ text: labels.catalog, callback_data: 'catalog:all:0' }]];
}

// { text, markup } или null. Одна и та же подсказка одному клиенту — не чаще раза в полчаса.
// followUp — сообщение в уже открытом разговоре: тогда только навигационные подсказки.
function faqHint(text, language, user, { followUp = false, now = Date.now() } = {}) {
  const key = intentOf(text, followUp);
  if (!key) return null;
  const copy = TEXT[language] || TEXT.ru;
  const memory = String(user && user.id) + ':' + key;
  if (now - (lastHints.get(memory) || 0) < COOLDOWN_MS) return null;
  lastHints.set(memory, now);
  if (lastHints.size > 5000) lastHints.delete(lastHints.keys().next().value);
  return { key, text: copy[key] + ' ' + copy.manager, markup: { inline_keyboard: rowsFor(key, language) } };
}

function resetFaqHints() {
  lastHints.clear();
}

export { faqHint, intentOf, resetFaqHints };
