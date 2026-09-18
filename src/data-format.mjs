// Формат bot-data.json: значения по умолчанию, миграции и проверка загруженных данных.

import crypto from 'node:crypto';
import { cleanText, clone } from './util.mjs';
import { INTERFACE_TEXT_DEFAULTS } from './texts.mjs';

const DATA_VERSION = 17;
// 0 turns reminders about unanswered inquiries off.
const REMINDER_HOUR_OPTIONS = [0, 1, 2, 4, 8, 24];

const defaultData = {
  version: DATA_VERSION,
  config: {
    botToken: '',
    adminChatId: '',
    adminNotificationVerifiedAt: '',
    passwordSalt: '',
    passwordHash: '',
    messages: {
      ru: {
        greeting: 'Здравствуйте, {first_name}! Рад вас видеть. Чем могу помочь?',
        help: '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — специальные предложения\n📞 Позвоните мне — менеджер перезвонит в удобное время\n💬 Менеджер — задать вопрос, позвонить или написать в WhatsApp\n☰ Ещё — мои заявки, уведомления, о компании, смена языка\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
        fallback: 'Спасибо! Сообщение получено. Менеджер ответит в этом чате.',
      },
      en: {
        greeting: 'Hello, {first_name}! Glad to see you. How can I help?',
        help: '👋 How can I help?\n\n🏘 Properties — browse available real estate\n✨ Find for me — tell us what you are looking for and get matching options\n❤️ Favorites — return to saved properties\n🔥 Offers — current promotions\n📞 Call me back — a manager will call you at a convenient time\n💬 Manager — ask a question, call or write on WhatsApp\n☰ More — my requests, notifications, about us, language\n\nYou can also send a regular message. A manager will reply in this chat.',
        fallback: 'Thank you! Your message has been received. A manager will reply in this chat.',
      },
      es: {
        greeting: '¡Hola, {first_name}! Me alegra verte. ¿Cómo puedo ayudarte?',
        help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Inmuebles — ver las propiedades disponibles\n✨ Búsqueda — cuéntanos qué buscas y recibe opciones adecuadas\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — ofertas actuales\n📞 Llámame — un gestor te llamará cuando te venga bien\n💬 Gestor — hacer una pregunta, llamar o escribir por WhatsApp\n☰ Más — mis solicitudes, avisos, la empresa, idioma\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
        fallback: '¡Gracias! Hemos recibido tu mensaje. Un gestor responderá en este chat.',
      },
    },
    menu: {
      ru: {
        objects: 'Информация о наших объектах скоро появится.',
        contacts: 'Добавьте контактные данные в панели администратора.',
        promotions: 'Актуальных акций пока нет.',
        about: 'Добавьте информацию о компании в панели администратора.',
      },
      en: {
        objects: 'Information about our properties will be available soon.',
        contacts: 'Add your contact details in the admin panel.',
        promotions: 'There are no current special offers.',
        about: 'Add information about the company in the admin panel.',
      },
      es: {
        objects: 'La información sobre nuestras propiedades estará disponible pronto.',
        contacts: 'Añade tus datos de contacto en el panel de administración.',
        promotions: 'No hay promociones disponibles actualmente.',
        about: 'Añade información sobre la empresa en el panel de administración.',
      },
    },
    active: true,
    notifyMode: 'inquiries',
    reminderHours: 2,
    remoteAccess: false,
    tunnelToken: '',
    tunnelHostname: '',
  },
  bot: {
    id: null,
    username: '',
    firstName: '',
  },
  rules: [
    {
      id: 'welcome-demo',
      trigger: 'привет',
      type: 'contains',
      answer: 'Привет! Чем могу помочь?',
      language: 'ru',
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ],
  users: {},
  welcomeImages: { ru: null, en: null, es: null },
  objects: [],
  promotions: [],
  contacts: {
    managerName: '',
    phone: '',
    whatsapp: '',
    whatsappEnabled: true,
    telegram: '',
    email: '',
    website: '',
    mapUrl: '',
    text: { ru: '', en: '', es: '' },
  },
  interfaceText: {},
  stats: {
    messagesReceived: 0,
    messagesSent: 0,
    reactionsReceived: 0,
    startedAt: null,
    lastUpdateAt: null,
  },
  analytics: { daily: {}, properties: {} },
  errors: [],
  broadcasts: [],
  inquiries: [],
  replyTemplates: [],
  adminReplyTargets: {},
  adminReplyTargetsSince: '',
  telegramOffset: 0,
};

function normalizeStoredImages(record) {
  const source = Array.isArray(record && record.images) && record.images.length
    ? record.images
    : record && record.image
      ? [record.image]
      : [];
  return source.filter((image) => image && typeof image === 'object' && (image.dataBase64 || image.storageFile)).slice(0, 10).map((image) => ({
    ...image,
    id: cleanText(image.id, 80) || crypto.randomUUID(),
  }));
}

function normalizePropertyImages(record) {
  const stored = record && record.imagesByLanguage;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return Object.fromEntries(['ru', 'en', 'es'].map((language) => [
      language,
      normalizeStoredImages({ images: Array.isArray(stored[language]) ? stored[language] : [] }),
    ]));
  }
  // Images from older versions are treated as Russian so they are never
  // accidentally shown to English- or Spanish-speaking users.
  return { ru: normalizeStoredImages(record || {}), en: [], es: [] };
}

function normalizeLocalizedField(value, maximum) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(value[language], maximum)]));
  }
  const legacy = cleanText(value, maximum);
  return { ru: legacy, en: legacy, es: legacy };
}

function managerTerminology(value, language) {
  let text = String(value || '');
  if (language === 'en') {
    text = text.replace(/\ban agent\b/gi, (match) => match[0] === 'A' ? 'A manager' : 'a manager');
    text = text.replace(/\bagent\b/gi, (match) => match[0] === 'A' ? 'Manager' : 'manager');
  } else if (language === 'es') {
    text = text.replace(/\bun agente\b/gi, (match) => match[0] === 'U' ? 'Un gestor' : 'un gestor');
    text = text.replace(/\bagente\b/gi, (match) => match[0] === 'A' ? 'Gestor' : 'gestor');
  } else {
    // \b does not treat Cyrillic letters as word characters, hence the
    // explicit Unicode-aware boundaries.
    const word = (stem) => new RegExp(String.raw`(?<![\p{L}\p{N}_])` + stem + String.raw`(?![\p{L}\p{N}_])`, 'gu');
    text = text
      .replace(word('Агент'), 'Менеджер')
      .replace(word('агент'), 'менеджер')
      .replace(word('агента'), 'менеджера')
      .replace(word('агенту'), 'менеджеру')
      .replace(word('агентом'), 'менеджером');
  }
  return text;
}

// One-time upgrade of texts that still equal defaults from older versions.
function migrateDefaultTexts(messages) {
  if (messages.ru.help === 'Отправьте сообщение, и я постараюсь подобрать ответ.' || messages.ru.help.startsWith('Отправьте сообщение, и я постараюсь подобрать ответ. Чтобы сменить язык')) {
    messages.ru.help = defaultData.config.messages.ru.help;
  }
  if (messages.en.help.includes('Use the main menu buttons:') && !messages.en.help.includes('❤️ Favorites')) {
    messages.en.help = defaultData.config.messages.en.help;
  }
  if (messages.es.help.includes('Utiliza los botones del menú principal:') && !messages.es.help.includes('❤️ Favoritos')) {
    messages.es.help = defaultData.config.messages.es.help;
  }
  if (messages.ru.help.includes('Оставить заявку') || messages.ru.help.includes('☎️ Контакты')) messages.ru.help = defaultData.config.messages.ru.help;
  if (messages.en.help.includes('Contact a manager — request a call') || messages.en.help.includes('☎️ Contacts')) messages.en.help = defaultData.config.messages.en.help;
  if (messages.es.help.includes('Contactar con un gestor — solicitar una llamada') || messages.es.help.includes('☎️ Contactos')) messages.es.help = defaultData.config.messages.es.help;
  if (messages.ru.help.includes('🏘 Наши объекты —') && messages.ru.help.includes('❤️ Избранное —') && !messages.ru.help.includes('✨ Помогите подобрать объект')) messages.ru.help = defaultData.config.messages.ru.help;
  if (messages.en.help.includes('🏘 Our properties —') && messages.en.help.includes('❤️ Favorites —') && !messages.en.help.includes('✨ Help me find a property')) messages.en.help = defaultData.config.messages.en.help;
  if (messages.es.help.includes('🏘 Nuestros inmuebles —') && messages.es.help.includes('❤️ Favoritos —') && !messages.es.help.includes('✨ Ayúdame a elegir')) messages.es.help = defaultData.config.messages.es.help;
  if (!messages.ru.help.includes('☰ Ещё') && messages.ru.help.includes('ℹ️ О компании —') && messages.ru.help.includes('❓ Помощь —')) messages.ru.help = defaultData.config.messages.ru.help;
  if (!messages.en.help.includes('☰ More') && messages.en.help.includes('ℹ️ About —') && messages.en.help.includes('❓ Help —')) messages.en.help = defaultData.config.messages.en.help;
  if (!messages.es.help.includes('☰ Más') && messages.es.help.includes('ℹ️ La empresa —') && messages.es.help.includes('❓ Ayuda —')) messages.es.help = defaultData.config.messages.es.help;
  if (messages.ru.fallback === 'Спасибо за сообщение! Я передал его администратору.') messages.ru.fallback = defaultData.config.messages.ru.fallback;
  if (messages.en.fallback === 'Thank you for your message! I have passed it on to the administrator.') messages.en.fallback = defaultData.config.messages.en.fallback;
  if (messages.es.fallback === '¡Gracias por tu mensaje! Se lo he enviado al administrador.') messages.es.fallback = defaultData.config.messages.es.fallback;
}

// Version 16 added "property type" as step 2 of the selection form. Saved
// texts (the defaults are stored too) still say "1 of 4"; their step numbers
// are moved, keeping any wording the administrator changed.
const SELECTION_STEP_NUMBERS = { askDeal: 1, askLocation: 3, askBudget: 4, askBedrooms: 5 };

function migrateSelectionSteps(interfaceText) {
  const form = interfaceText && interfaceText.selectionForm;
  if (!form || typeof form !== 'object') return;
  for (const language of ['ru', 'en', 'es']) {
    const texts = form[language];
    if (!texts || typeof texts !== 'object') continue;
    for (const [key, step] of Object.entries(SELECTION_STEP_NUMBERS)) {
      if (typeof texts[key] !== 'string') continue;
      texts[key] = texts[key].replace(/^\s*[1-4]\s+(из|of|de)\s+4\./u, (match, word) => step + ' ' + word + ' 5.');
    }
  }
}

// Version 17 shortened the main menu buttons and moved "Call me back" onto
// the main keyboard. Saved labels and help texts (the defaults are stored
// too) that still equal the old defaults get the new ones; wording the
// administrator changed is kept.
const PREVIOUS_MENU_DEFAULTS = {
  ru: { objects: '🏘 Наши объекты', selection: '✨ Помогите подобрать объект', contacts: '💬 Связаться с менеджером', request: '📞 Заказать звонок' },
  en: { objects: '🏘 Our properties', selection: '✨ Help me find a property', contacts: '💬 Contact a manager', request: '📞 Request a call' },
  es: { objects: '🏘 Nuestros inmuebles', selection: '✨ Ayúdame a elegir', contacts: '💬 Contactar con un gestor', request: '📞 Solicitar una llamada' },
};
const PREVIOUS_HELP_DEFAULTS = {
  ru: '👋 Чем я могу помочь?\n\n🏘 Наши объекты — посмотреть недвижимость\n✨ Помогите подобрать объект — оставить пожелания менеджеру\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — посмотреть специальные предложения\n💬 Связаться с менеджером — задать вопрос или заказать звонок\n☰ Ещё — открыть информацию о компании и помощь\n🌐 Сменить язык — выбрать другой язык\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
  en: '👋 How can I help?\n\n🏘 Our properties — browse available real estate\n✨ Help me find a property — send your preferences to a manager\n❤️ Favorites — return to saved properties\n🔥 Offers — view current promotions\n💬 Contact a manager — ask a question or request a call\n☰ More — open company information and help\n🌐 Change language — select another language\n\nYou can also send a regular message. A manager will reply in this chat.',
  es: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Nuestros inmuebles — ver las propiedades disponibles\n✨ Ayúdame a elegir — enviar tus preferencias a un gestor\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — consultar las ofertas actuales\n💬 Contactar con un gestor — hacer una pregunta o solicitar una llamada\n☰ Más — abrir la información de la empresa y la ayuda\n🌐 Cambiar idioma — seleccionar otro idioma\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
};

function migrateShortMenu(interfaceText, messages) {
  const labels = interfaceText && interfaceText.menuLabels;
  for (const language of ['ru', 'en', 'es']) {
    const saved = labels && labels[language];
    if (saved && typeof saved === 'object') {
      for (const [key, previous] of Object.entries(PREVIOUS_MENU_DEFAULTS[language])) {
        if (saved[key] === previous) saved[key] = INTERFACE_TEXT_DEFAULTS.menuLabels[language][key];
      }
    }
    if (messages && messages[language] && messages[language].help === PREVIOUS_HELP_DEFAULTS[language]) {
      messages[language].help = defaultData.config.messages[language].help;
    }
  }
}

// Analytics buckets for deleted properties are never shown, so drop them.
function pruneOrphanPropertyAnalytics(root) {
  const properties = root && root.analytics && root.analytics.properties;
  if (!properties || typeof properties !== 'object') return;
  const existing = new Set((Array.isArray(root.objects) ? root.objects : []).map((record) => String(record.id)));
  for (const id of Object.keys(properties)) if (!existing.has(id)) delete properties[id];
}

function normalizeAdminReplyTargets(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [messageId, target] of Object.entries(value)) {
    // "123" in the main admin chat, "<chat id>:123" in a manager's chat.
    if (!/^(-?\d{4,20}:)?\d{1,20}$/.test(messageId) || !target || typeof target !== 'object') continue;
    const chatId = cleanText(target.chatId, 40);
    if (!/^-?\d{1,20}$/.test(chatId)) continue;
    result[messageId] = {
      chatId,
      inquiryId: cleanText(target.inquiryId, 100),
      sourceMessageId: Number.isFinite(Number(target.sourceMessageId)) && target.sourceMessageId != null ? Number(target.sourceMessageId) : null,
      createdAt: cleanText(target.createdAt, 40),
    };
  }
  return result;
}

const DAY_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Office hours. Off by default: until the administrator sets them, the bot
// never tells clients that the office is closed.
const DEFAULT_WORKING_HOURS = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  from: '09:00',
  to: '19:00',
  note: {
    ru: 'Сейчас нерабочее время — менеджер ответит {next}. Ваше сообщение сохранено.',
    en: 'Our office is closed now — a manager will reply {next}. Your message is saved.',
    es: 'Ahora estamos fuera de horario: un gestor responderá {next}. Tu mensaje está guardado.',
  },
};

// The purchase calculator under a property. Off until the administrator
// checks the rates: taxes depend on the region and change over time.
const DEFAULT_CALCULATOR = {
  enabled: false,
  resaleTaxPercent: 10,
  newBuildTaxPercent: 10,
  stampDutyPercent: 1.5,
  otherCostsPercent: 1.5,
  downPaymentPercent: 30,
  interestPercent: 4,
  years: 25,
};

function normalizeCalculator(value) {
  const source = value && typeof value === 'object' ? value : {};
  const number = (key, min, max) => {
    const parsed = Number(source[key]);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed * 100) / 100 : DEFAULT_CALCULATOR[key];
  };
  return {
    enabled: source.enabled === true,
    resaleTaxPercent: number('resaleTaxPercent', 0, 30),
    newBuildTaxPercent: number('newBuildTaxPercent', 0, 30),
    stampDutyPercent: number('stampDutyPercent', 0, 10),
    otherCostsPercent: number('otherCostsPercent', 0, 10),
    downPaymentPercent: number('downPaymentPercent', 0, 100),
    interestPercent: number('interestPercent', 0, 20),
    years: Math.round(number('years', 1, 40)),
  };
}

// When viewings can be booked: weekdays and start times. Off by default:
// then the client names a convenient time and the manager confirms it.
const DEFAULT_VIEWING_SLOTS = { enabled: false, days: [1, 2, 3, 4, 5, 6], times: ['10:00', '12:00', '16:00', '18:00'], daysAhead: 7, perSlot: 1 };

function normalizeViewingSlots(value) {
  const source = value && typeof value === 'object' ? value : {};
  const days = Array.isArray(source.days)
    ? Array.from(new Set(source.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort()
    : DEFAULT_VIEWING_SLOTS.days.slice();
  const times = Array.isArray(source.times)
    ? Array.from(new Set(source.times.map((time) => String(time).trim()).filter((time) => CLOCK_TIME_PATTERN.test(time)))).sort().slice(0, 12)
    : DEFAULT_VIEWING_SLOTS.times.slice();
  const daysAhead = Number(source.daysAhead);
  const perSlot = Number(source.perSlot);
  return {
    enabled: source.enabled === true && days.length > 0 && times.length > 0,
    days,
    times,
    daysAhead: Number.isInteger(daysAhead) && daysAhead >= 1 && daysAhead <= 30 ? daysAhead : DEFAULT_VIEWING_SLOTS.daysAhead,
    perSlot: Number.isInteger(perSlot) && perSlot >= 1 && perSlot <= 5 ? perSlot : DEFAULT_VIEWING_SLOTS.perSlot,
  };
}

// A weekly encrypted copy of the data sent to the admin chat. The key is
// derived from a password only the administrator knows; the password itself
// is not stored.
function normalizeTelegramBackup(value) {
  const source = value && typeof value === 'object' ? value : {};
  const salt = /^[0-9a-f]{32}$/.test(String(source.salt || '')) ? String(source.salt) : '';
  const key = /^[0-9a-f]{64}$/.test(String(source.key || '')) ? String(source.key) : '';
  return {
    enabled: source.enabled === true && Boolean(salt && key),
    salt,
    key,
    lastSentAt: cleanText(source.lastSentAt, 40),
    lastError: cleanText(source.lastError, 300),
  };
}

// Managers besides the main admin: each gets client inquiries in their own
// chat with the bot and can answer them.
const MAX_MANAGERS = 10;

function normalizeManagers(value, adminChatId = '') {
  if (!Array.isArray(value)) return [];
  const seen = new Set([String(adminChatId || '')]);
  const managers = [];
  for (const item of value) {
    const chatId = cleanText(item && item.chatId, 40);
    const name = cleanText(item && item.name, 60);
    if (!/^-?\d{4,20}$/.test(chatId) || !name || seen.has(chatId)) continue;
    seen.add(chatId);
    managers.push({ id: cleanText(item.id, 100) || crypto.randomUUID(), name, chatId, verifiedAt: cleanText(item.verifiedAt, 40) });
    if (managers.length >= MAX_MANAGERS) break;
  }
  return managers;
}

function normalizeWorkingHours(value) {
  const source = value && typeof value === 'object' ? value : {};
  const days = Array.isArray(source.days)
    ? Array.from(new Set(source.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort()
    : DEFAULT_WORKING_HOURS.days.slice();
  const from = CLOCK_TIME_PATTERN.test(String(source.from || '')) ? String(source.from) : DEFAULT_WORKING_HOURS.from;
  const to = CLOCK_TIME_PATTERN.test(String(source.to || '')) ? String(source.to) : DEFAULT_WORKING_HOURS.to;
  const note = source.note && typeof source.note === 'object' ? source.note : {};
  return {
    enabled: source.enabled === true && days.length > 0 && from < to,
    days,
    from,
    to,
    note: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(note[language], 500) || DEFAULT_WORKING_HOURS.note[language]])),
  };
}

// A viewing request: what the client asked for (date may be unknown, for
// "at the weekend" or a free-text answer), what the manager confirmed and
// what the bot already sent about it.
function normalizeViewing(value) {
  if (!value || typeof value !== 'object') return null;
  const day = (text) => (DAY_KEY_PATTERN.test(String(text || '')) ? String(text) : '');
  return {
    date: day(value.date),
    dateText: cleanText(value.dateText, 160),
    timeText: cleanText(value.timeText, 160),
    confirmedDate: day(value.confirmedDate),
    confirmedTime: CLOCK_TIME_PATTERN.test(String(value.confirmedTime || '')) ? String(value.confirmedTime) : '',
    confirmedAt: cleanText(value.confirmedAt, 40),
    cancelledAt: cleanText(value.cancelledAt, 40),
    remindedAt: cleanText(value.remindedAt, 40),
    feedbackAskedAt: cleanText(value.feedbackAskedAt, 40),
    feedback: ['liked', 'questions', 'disliked'].includes(value.feedback) ? value.feedback : '',
    feedbackAt: cleanText(value.feedbackAt, 40),
  };
}

const MAX_REPLY_TEMPLATES = 50;

function normalizeReplyTemplates(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: cleanText(item && item.id, 100) || crypto.randomUUID(),
    title: cleanText(item && item.title, 80),
    text: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(item && item.text && item.text[language], 4000)])),
    updatedAt: cleanText(item && item.updatedAt, 40) || new Date().toISOString(),
  })).filter((item) => item.title && (item.text.ru || item.text.en || item.text.es)).slice(0, MAX_REPLY_TEMPLATES);
}

function legacyConfigRemoved(config) {
  const { greeting, help, fallback, ...rest } = config;
  return rest;
}

function normalizeLoadedData(parsed) {
    const parsedConfig = parsed.config || {};
    const parsedMessages = parsedConfig.messages || {};
    const parsedMenu = parsedConfig.menu || {};
    // Text migrations below rewrite stored texts, so they must run only once:
    // for files written before DATA_VERSION. Running them on every load used
    // to silently discard the administrator's own edits after each restart.
    const storedVersion = Number(parsed.version) || 0;
    const legacyFormat = storedVersion < 14;
    const messages = {};
    const menu = {};
    for (const language of ['ru', 'en', 'es']) {
      messages[language] = {
        ...defaultData.config.messages[language],
        ...(parsedMessages[language] || {}),
      };
      if (legacyFormat) {
        messages[language].greeting = managerTerminology(messages[language].greeting, language);
        messages[language].help = managerTerminology(messages[language].help, language);
        messages[language].fallback = managerTerminology(messages[language].fallback, language);
      }
      menu[language] = {
        ...defaultData.config.menu[language],
        ...(parsedMenu[language] || {}),
      };
    }
    // Migrate data created by the previous one-language version. These fields
    // only matter when the file has no multilingual texts yet.
    if (!parsedMessages.ru) {
      if (typeof parsedConfig.greeting === 'string') messages.ru.greeting = parsedConfig.greeting;
      if (typeof parsedConfig.help === 'string') messages.ru.help = parsedConfig.help;
      if (typeof parsedConfig.fallback === 'string') messages.ru.fallback = parsedConfig.fallback;
    }
    if (legacyFormat) migrateDefaultTexts(messages);
    const users = parsed.users && typeof parsed.users === 'object' ? parsed.users : {};
    for (const [id, user] of Object.entries(users)) {
      users[id] = {
        ...user,
        id: String(user.id || id),
        contactName: cleanText(user.contactName, 120),
        phone: cleanText(user.phone, 80),
        preferredContactTime: cleanText(user.preferredContactTime, 160),
        tags: Array.isArray(user.tags) ? user.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20) : [],
        note: cleanText(user.note, 2000),
        favorites: Array.isArray(user.favorites) ? user.favorites.map(String).slice(0, 500) : [],
        catalogMessageIds: Array.isArray(user.catalogMessageIds)
          ? user.catalogMessageIds.map(Number).filter(Number.isFinite).slice(0, 20)
          : [],
        uiMessageIds: Array.isArray(user.uiMessageIds)
          ? user.uiMessageIds.map(Number).filter(Number.isFinite).slice(0, 20)
          : [],
        galleryMessageIds: Array.isArray(user.galleryMessageIds)
          ? user.galleryMessageIds.map(Number).filter(Number.isFinite).slice(0, 20)
          : [],
        lastCallback: user.lastCallback && typeof user.lastCallback === 'object' ? {
          key: cleanText(user.lastCallback.key, 120),
          at: Number(user.lastCallback.at) || 0,
        } : null,
        lastInboundMessageId: user.lastInboundMessageId != null && Number.isFinite(Number(user.lastInboundMessageId)) ? Number(user.lastInboundMessageId) : null,
        catalogContext: user.catalogContext && typeof user.catalogContext === 'object' ? {
          mode: ['all', 'favorites', 'matches'].includes(user.catalogContext.mode) ? user.catalogContext.mode : 'all',
          page: Math.max(0, Number(user.catalogContext.page) || 0),
        } : { mode: 'all', page: 0 },
        pendingAction: user.pendingAction && typeof user.pendingAction === 'object' ? user.pendingAction : null,
        expiredAction: user.expiredAction && typeof user.expiredAction === 'object' ? {
          type: cleanText(user.expiredAction.type, 40),
          propertyId: cleanText(user.expiredAction.propertyId, 100),
          createdAt: user.expiredAction.createdAt || new Date().toISOString(),
        } : null,
        pendingStartPayload: cleanText(user.pendingStartPayload, 100),
        activity: Array.isArray(user.activity) ? user.activity.slice(-50) : [],
      };
    }
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.map((rule, index) => ({
          ...rule,
          language: rule.language || 'ru',
          order: Number.isFinite(Number(rule.order)) ? Number(rule.order) : index,
          updatedAt: rule.updatedAt || rule.createdAt || new Date().toISOString(),
        }))
      : clone(defaultData.rules);
    const broadcasts = Array.isArray(parsed.broadcasts) ? parsed.broadcasts.map((source) => {
      const entry = source.messages ? { ...source } : {
        ...source,
        messages: { ru: source.text || '', en: source.text || '', es: source.text || '' },
        languages: [],
        tags: [],
        buttonText: { ru: '', en: '', es: '' },
        buttonUrl: '',
      };
      if (entry.status === 'running') entry.status = 'queued';
      for (const field of ['processedUserIds', 'respondedUserIds', 'inquiryUserIds', 'unsubscribedUserIds']) {
        entry[field] = Array.isArray(entry[field]) ? entry[field].map(String).slice(0, 100000) : [];
      }
      entry.failures = Array.isArray(entry.failures) ? entry.failures.slice(-100) : [];
      return entry;
    }) : [];
    const inquiries = Array.isArray(parsed.inquiries) ? parsed.inquiries.map((item) => ({
      ...item,
      id: String(item.id || crypto.randomUUID()),
      userId: String(item.userId || ''),
      chatId: item.chatId == null ? '' : String(item.chatId),
      language: ['ru', 'en', 'es'].includes(item.language) ? item.language : 'ru',
      text: cleanText(item.text, 4000),
      status: ['new', 'in_progress', 'closed'].includes(item.status) ? item.status : 'new',
      note: cleanText(item.note, 2000),
      type: ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(item.type) ? item.type : 'general',
      propertyId: cleanText(item.propertyId, 100),
      sourceMessageId: Number.isFinite(Number(item.sourceMessageId)) ? Number(item.sourceMessageId) : null,
      lead: item.lead && typeof item.lead === 'object' ? {
        name: cleanText(item.lead.name, 120),
        phone: cleanText(item.lead.phone, 80),
        preferredTime: cleanText(item.lead.preferredTime, 160),
      } : null,
      selection: item.selection && typeof item.selection === 'object' ? {
        deal: cleanText(item.selection.deal, 200),
        type: cleanText(item.selection.type, 200),
        location: cleanText(item.selection.location, 200),
        budget: cleanText(item.selection.budget, 200),
        bedrooms: cleanText(item.selection.bedrooms, 200),
      } : null,
      replies: Array.isArray(item.replies) ? item.replies.slice(-50) : [],
      remindedAt: cleanText(item.remindedAt, 40),
      viewing: item.type === 'viewing' ? normalizeViewing(item.viewing || {}) : null,
      // When the manager plans to contact the client again.
      followUpDate: DAY_KEY_PATTERN.test(String(item.followUpDate || '')) ? String(item.followUpDate) : '',
      followUpTime: CLOCK_TIME_PATTERN.test(String(item.followUpTime || '')) ? String(item.followUpTime) : '',
      followUpNotifiedAt: cleanText(item.followUpNotifiedAt, 40),
      // Who took the inquiry: the admin or one of the managers.
      assignee: cleanText(item.assignee, 60),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    })).slice(0, 5000) : [];
    const normalized = {
      ...clone(defaultData),
      ...parsed,
      version: DATA_VERSION,
      config: { ...defaultData.config, ...legacyConfigRemoved(parsedConfig), messages, menu },
      bot: { ...defaultData.bot, ...(parsed.bot || {}) },
      stats: { ...defaultData.stats, ...(parsed.stats || {}) },
      rules,
      users,
      welcomeImages: {
        ...defaultData.welcomeImages,
        ...(parsed.welcomeImages || {}),
      },
      objects: Array.isArray(parsed.objects) ? parsed.objects.map((record) => {
        const imagesByLanguage = normalizePropertyImages(record);
        const { image: legacyImage, images: legacyImages, ...propertyRecord } = record;
        return {
          ...propertyRecord,
          imagesByLanguage,
          dealType: ['sale', 'rent'].includes(record.dealType) ? record.dealType : 'sale',
          propertyType: cleanText(record.propertyType, 40) || 'apartment',
          reference: cleanText(record.reference, 80),
          city: normalizeLocalizedField(record.city, 160),
          district: normalizeLocalizedField(record.district, 160),
          price: normalizeLocalizedField(record.price, 120),
          currency: cleanText(record.currency, 10) || 'EUR',
          pricePeriod: ['total', 'month', 'week'].includes(record.pricePeriod) ? record.pricePeriod : 'total',
          badges: Array.isArray(record.badges) ? record.badges.map((item) => cleanText(item, 30)).filter(Boolean).slice(0, 6) : [],
        };
      }) : [],
      promotions: Array.isArray(parsed.promotions) ? parsed.promotions.map((record) => {
        const imagesByLanguage = normalizePropertyImages(record);
        const { image: legacyImage, images: legacyImages, ...promotionRecord } = record;
        return { ...promotionRecord, imagesByLanguage };
      }) : [],
      contacts: {
        ...defaultData.contacts,
        ...(parsed.contacts || {}),
        text: { ...defaultData.contacts.text, ...((parsed.contacts && parsed.contacts.text) || {}) },
      },
      interfaceText: parsed.interfaceText && typeof parsed.interfaceText === 'object' && !Array.isArray(parsed.interfaceText)
        ? parsed.interfaceText
        : {},
      analytics: {
        daily: parsed.analytics && parsed.analytics.daily && typeof parsed.analytics.daily === 'object'
          ? parsed.analytics.daily
          : {},
        properties: parsed.analytics && parsed.analytics.properties && typeof parsed.analytics.properties === 'object'
          ? parsed.analytics.properties
          : {},
      },
      errors: Array.isArray(parsed.errors) ? parsed.errors.slice(0, 100) : [],
      broadcasts,
      inquiries,
      telegramOffset: Number.isFinite(Number(parsed.telegramOffset)) ? Math.max(0, Number(parsed.telegramOffset)) : 0,
      adminReplyTargets: normalizeAdminReplyTargets(parsed.adminReplyTargets),
      // Notifications sent before this version have no entry in the map.
      adminReplyTargetsSince: cleanText(parsed.adminReplyTargetsSince, 40) || new Date().toISOString(),
    };
    // Version 15 made "only inquiries" the default: navigation is sent as a
    // daily digest instead of one message per click.
    if (storedVersion < 15) normalized.config.notifyMode = 'inquiries';
    if (storedVersion < 16) migrateSelectionSteps(normalized.interfaceText);
    if (storedVersion < 17) migrateShortMenu(normalized.interfaceText, normalized.config.messages);
    normalized.config.notifyMode = ['all', 'inquiries'].includes(normalized.config.notifyMode) ? normalized.config.notifyMode : 'inquiries';
    normalized.lastDigestFor = cleanText(parsed.lastDigestFor, 10);
    normalized.lastViewingAgendaFor = cleanText(parsed.lastViewingAgendaFor, 10);
    normalized.lastWeeklyReportFor = cleanText(parsed.lastWeeklyReportFor, 10);
    normalized.replyTemplates = normalizeReplyTemplates(parsed.replyTemplates);
    normalized.config.reminderHours = REMINDER_HOUR_OPTIONS.includes(Number(normalized.config.reminderHours)) ? Number(normalized.config.reminderHours) : 2;
    normalized.config.workingHours = normalizeWorkingHours(normalized.config.workingHours);
    normalized.config.calculator = normalizeCalculator(normalized.config.calculator);
    normalized.config.viewingSlots = normalizeViewingSlots(normalized.config.viewingSlots);
    normalized.config.telegramBackup = normalizeTelegramBackup(normalized.config.telegramBackup);
    normalized.config.adminName = cleanText(normalized.config.adminName, 60);
    // Messages about the bot itself (started, stopped, connection): on unless switched off.
    normalized.config.statusNotices = normalized.config.statusNotices !== false;
    normalized.config.managers = normalizeManagers(normalized.config.managers, normalized.config.adminChatId);
    pruneOrphanPropertyAnalytics(normalized);
    return normalized;
}

export {
  CLOCK_TIME_PATTERN,
  DATA_VERSION,
  DAY_KEY_PATTERN,
  DEFAULT_CALCULATOR,
  DEFAULT_VIEWING_SLOTS,
  DEFAULT_WORKING_HOURS,
  MAX_MANAGERS,
  MAX_REPLY_TEMPLATES,
  REMINDER_HOUR_OPTIONS,
  defaultData,
  legacyConfigRemoved,
  managerTerminology,
  migrateDefaultTexts,
  migrateSelectionSteps,
  migrateShortMenu,
  PREVIOUS_HELP_DEFAULTS,
  normalizeAdminReplyTargets,
  normalizeCalculator,
  normalizeManagers,
  normalizeLoadedData,
  normalizeLocalizedField,
  normalizePropertyImages,
  normalizeReplyTemplates,
  normalizeStoredImages,
  normalizeViewing,
  normalizeTelegramBackup,
  normalizeViewingSlots,
  normalizeWorkingHours,
  pruneOrphanPropertyAnalytics,
};
