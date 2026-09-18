#!/usr/bin/env node
'use strict';

/**
 * Telegram bot + web admin panel in one file.
 * Requirements: Node.js 18+ (no npm packages are needed).
 * Start: node bot.js
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');
let sea = null;
try { sea = require('node:sea'); } catch { sea = { isSea: () => false }; }

const HOST = process.env.ADMIN_HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.BOT_DATA_FILE || path.join(__dirname, 'bot-data.json');
const MEDIA_DIRECTORY = process.env.BOT_MEDIA_DIRECTORY || path.join(path.dirname(DATA_FILE), 'bot-media');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_BODY_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_OUTPUT_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const LOGIN_ASSET_DIRECTORY = path.join(__dirname, 'Kornilenko_Login_Codex_Assets');
const ADMIN_ASSET_DIRECTORY = path.join(__dirname, 'Kornilenko_Admin_Codex_Assets');

function loadBundledAsset(assetDirectory, assetKey, fileName, mimeType) {
  let bytes = null;
  if (sea.isSea()) {
    try {
      bytes = Buffer.from(sea.getAsset(assetKey));
    } catch {
      bytes = null;
    }
  }
  if (!bytes) {
    const filePath = path.join(assetDirectory, fileName);
    if (fs.existsSync(filePath)) bytes = fs.readFileSync(filePath);
  }
  if (!bytes) return null;
  return {
    bytes,
    mimeType,
    etag: '"' + crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '"',
  };
}

const LOGIN_ASSETS = {
  background: loadBundledAsset(LOGIN_ASSET_DIRECTORY, 'login-background', 'login_background_codex_1920x1080.png', 'image/png'),
  logo: loadBundledAsset(LOGIN_ASSET_DIRECTORY, 'login-logo', 'kornilenko_logo_exact.png', 'image/png'),
};

const ADMIN_ASSETS = {
  header: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-header', 'admin_header_background_1920x480.webp', 'image/webp'),
  headerMobile: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-header-mobile', 'admin_header_background_mobile_960x480.webp', 'image/webp'),
  sidebarLogo: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-sidebar-logo', 'kornilenko_logo_sidebar_320.png', 'image/png'),
};

const defaultData = {
  version: 13,
  config: {
    botToken: '',
    adminChatId: '',
    adminNotificationVerifiedAt: '',
    passwordSalt: '',
    passwordHash: '',
    messages: {
      ru: {
        greeting: 'Здравствуйте, {first_name}! Рад вас видеть. Чем могу помочь?',
        help: '👋 Чем я могу помочь?\n\n🏘 Наши объекты — посмотреть недвижимость\n✨ Помогите подобрать объект — оставить пожелания менеджеру\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — посмотреть специальные предложения\n💬 Связаться с менеджером — задать вопрос или заказать звонок\n☰ Ещё — открыть информацию о компании и помощь\n🌐 Сменить язык — выбрать другой язык\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
        fallback: 'Спасибо! Сообщение получено. Менеджер ответит в этом чате.',
      },
      en: {
        greeting: 'Hello, {first_name}! Glad to see you. How can I help?',
        help: '👋 How can I help?\n\n🏘 Our properties — browse available real estate\n✨ Help me find a property — send your preferences to a manager\n❤️ Favorites — return to saved properties\n🔥 Offers — view current promotions\n💬 Contact a manager — ask a question or request a call\n☰ More — open company information and help\n🌐 Change language — select another language\n\nYou can also send a regular message. A manager will reply in this chat.',
        fallback: 'Thank you! Your message has been received. A manager will reply in this chat.',
      },
      es: {
        greeting: '¡Hola, {first_name}! Me alegra verte. ¿Cómo puedo ayudarte?',
        help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Nuestros inmuebles — ver las propiedades disponibles\n✨ Ayúdame a elegir — enviar tus preferencias a un gestor\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — consultar las ofertas actuales\n💬 Contactar con un gestor — hacer una pregunta o solicitar una llamada\n☰ Más — abrir la información de la empresa y la ayuda\n🌐 Cambiar idioma — seleccionar otro idioma\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
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
  telegramOffset: 0,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function storedImageFile(image) {
  const fileName = image && typeof image.storageFile === 'string' ? image.storageFile.trim() : '';
  if (!fileName || path.basename(fileName) !== fileName || !/^[A-Za-z0-9_-]+\.(?:jpg|png)$/i.test(fileName)) return '';
  return fileName;
}

function imageStoragePath(image) {
  const fileName = storedImageFile(image);
  return fileName ? path.join(MEDIA_DIRECTORY, fileName) : '';
}

function imageExists(image) {
  if (!image || typeof image !== 'object') return false;
  if (typeof image.dataBase64 === 'string' && image.dataBase64.length > 0) return true;
  const filePath = imageStoragePath(image);
  return Boolean(filePath && fs.existsSync(filePath));
}

function imageBytes(image) {
  if (!image || typeof image !== 'object') throw new Error('Изображение не найдено');
  if (typeof image.dataBase64 === 'string' && image.dataBase64.length > 0) {
    return Buffer.from(image.dataBase64, 'base64');
  }
  const filePath = imageStoragePath(image);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Файл изображения не найден');
  return fs.readFileSync(filePath);
}

function forEachStoredImage(root, callback) {
  if (!root || typeof root !== 'object') return;
  for (const language of ['ru', 'en', 'es']) callback(root.welcomeImages && root.welcomeImages[language]);
  for (const record of Array.isArray(root.objects) ? root.objects : []) {
    callback(record && record.image);
    for (const image of record && Array.isArray(record.images) ? record.images : []) callback(image);
    for (const language of ['ru', 'en', 'es']) {
      for (const image of record && record.imagesByLanguage && Array.isArray(record.imagesByLanguage[language]) ? record.imagesByLanguage[language] : []) callback(image);
    }
  }
  for (const key of ['promotions', 'broadcasts']) {
    for (const record of Array.isArray(root[key]) ? root[key] : []) {
      callback(record && record.image);
      for (const image of record && Array.isArray(record.images) ? record.images : []) callback(image);
      if (key === 'promotions') {
        for (const language of ['ru', 'en', 'es']) {
          for (const image of record && record.imagesByLanguage && Array.isArray(record.imagesByLanguage[language]) ? record.imagesByLanguage[language] : []) callback(image);
        }
      }
    }
  }
}

function containsEmbeddedImages(root) {
  let found = false;
  forEachStoredImage(root, (image) => {
    if (image && typeof image.dataBase64 === 'string' && image.dataBase64.length) found = true;
  });
  return found;
}

function persistImage(image) {
  if (!image || typeof image !== 'object' || typeof image.dataBase64 !== 'string' || !image.dataBase64.length) return;
  const bytes = Buffer.from(image.dataBase64, 'base64');
  const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
  const safeId = String(image.id || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID();
  const fileName = safeId + '.' + extension;
  const target = path.join(MEDIA_DIRECTORY, fileName);
  const temporary = target + '.tmp';
  fs.mkdirSync(MEDIA_DIRECTORY, { recursive: true });
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
  image.id = safeId;
  image.storageFile = fileName;
  image.size = bytes.length;
  delete image.dataBase64;
}

function externalizeImages(root) {
  forEachStoredImage(root, persistImage);
}

function cleanupOrphanImages(root) {
  if (!fs.existsSync(MEDIA_DIRECTORY)) return;
  const referenced = new Set();
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName) referenced.add(fileName.toLocaleLowerCase('en-US'));
  });
  for (const entry of fs.readdirSync(MEDIA_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.(?:jpg|png)$/i.test(entry.name)) continue;
    if (!referenced.has(entry.name.toLocaleLowerCase('en-US'))) fs.unlinkSync(path.join(MEDIA_DIRECTORY, entry.name));
  }
}

function ensureMigrationBackup() {
  if (!fs.existsSync(DATA_FILE)) return '';
  const backupDirectory = path.join(path.dirname(DATA_FILE), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const existing = fs.readdirSync(backupDirectory).find((name) => /^pre-media-migration-.*\.json$/i.test(name));
  if (existing) return path.join(backupDirectory, existing);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const target = path.join(backupDirectory, 'pre-media-migration-' + stamp + '.json');
  fs.copyFileSync(DATA_FILE, target, fs.constants.COPYFILE_EXCL);
  return target;
}

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
    text = text
      .replace(/\bАгент\b/g, 'Менеджер')
      .replace(/\bагент\b/g, 'менеджер')
      .replace(/\bагента\b/g, 'менеджера')
      .replace(/\bагенту\b/g, 'менеджеру')
      .replace(/\bагентом\b/g, 'менеджером');
  }
  return text;
}

function normalizeLoadedData(parsed) {
    const parsedConfig = parsed.config || {};
    const parsedMessages = parsedConfig.messages || {};
    const parsedMenu = parsedConfig.menu || {};
    const messages = {};
    const menu = {};
    for (const language of ['ru', 'en', 'es']) {
      messages[language] = {
        ...defaultData.config.messages[language],
        ...(parsedMessages[language] || {}),
      };
      messages[language].greeting = managerTerminology(messages[language].greeting, language);
      messages[language].help = managerTerminology(messages[language].help, language);
      messages[language].fallback = managerTerminology(messages[language].fallback, language);
      menu[language] = {
        ...defaultData.config.menu[language],
        ...(parsedMenu[language] || {}),
      };
    }
    // Migrate data created by the previous one-language version.
    if (typeof parsedConfig.greeting === 'string') messages.ru.greeting = parsedConfig.greeting;
    if (typeof parsedConfig.help === 'string') messages.ru.help = parsedConfig.help;
    if (typeof parsedConfig.fallback === 'string') messages.ru.fallback = parsedConfig.fallback;
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
          mode: ['all', 'favorites'].includes(user.catalogContext.mode) ? user.catalogContext.mode : 'all',
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
      entry.processedUserIds = Array.isArray(entry.processedUserIds)
        ? entry.processedUserIds.map(String).slice(0, 100000)
        : [];
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
        location: cleanText(item.selection.location, 200),
        budget: cleanText(item.selection.budget, 200),
        bedrooms: cleanText(item.selection.bedrooms, 200),
      } : null,
      replies: Array.isArray(item.replies) ? item.replies.slice(-50) : [],
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    })).slice(0, 5000) : [];
    return {
      ...clone(defaultData),
      ...parsed,
      version: 13,
      config: { ...defaultData.config, ...parsedConfig, messages, menu },
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
    };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return clone(defaultData);
  try {
    return normalizeLoadedData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (error) {
    console.error('Не удалось прочитать файл данных:', error.message);
    console.error('Исправьте или удалите файл:', DATA_FILE);
    process.exit(1);
  }
}

let data = loadData();
let saveTimer = null;

function saveDataNow() {
  const directory = path.dirname(DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  if (containsEmbeddedImages(data)) {
    ensureMigrationBackup();
    externalizeImages(data);
  }
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
  cleanupOrphanImages(data);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveDataNow();
    } catch (error) {
      console.error('Ошибка сохранения:', error.message);
    }
  }, 150);
}

if (containsEmbeddedImages(data)) {
  try {
    saveDataNow();
    console.log('Фотографии перенесены в отдельное локальное хранилище:', MEDIA_DIRECTORY);
  } catch (error) {
    console.error('Не удалось перенести фотографии в локальное хранилище:', error.message);
    process.exit(1);
  }
}

function configured() {
  return Boolean(data.config.botToken && data.config.passwordHash && data.config.passwordSalt);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password) {
  try {
    const candidate = Buffer.from(crypto.scryptSync(password, data.config.passwordSalt, 64));
    const expected = Buffer.from(data.config.passwordHash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function fillTemplate(template, user) {
  return String(template)
    .replaceAll('{first_name}', user.firstName || 'друг')
    .replaceAll('{last_name}', user.lastName || '')
    .replaceAll('{username}', user.username ? '@' + user.username : '');
}

function dayKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function recordDaily(kind, detail = '', amount = 1) {
  const key = dayKey();
  const daily = data.analytics.daily[key] || { received: 0, sent: 0, reactions: 0, inquiries: 0, menu: {} };
  if (kind === 'received' || kind === 'sent') daily[kind] = Number(daily[kind] || 0) + 1;
  if (kind === 'reaction') daily.reactions = Number(daily.reactions || 0) + Math.max(1, Number(amount) || 1);
  if (kind === 'inquiry') daily.inquiries = Number(daily.inquiries || 0) + 1;
  if (kind === 'menu' && detail) daily.menu[detail] = Number(daily.menu[detail] || 0) + 1;
  data.analytics.daily[key] = daily;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 120);
  for (const storedKey of Object.keys(data.analytics.daily)) {
    if (storedKey < dayKey(cutoff)) delete data.analytics.daily[storedKey];
  }
}

function propertyAnalytics(propertyId) {
  const id = String(propertyId || '');
  if (!id) return null;
  const current = data.analytics.properties[id] || {};
  const bucket = {
    impressions: Number(current.impressions || 0),
    details: Number(current.details || 0),
    galleries: Number(current.galleries || 0),
    managerContacts: Number(current.managerContacts || 0),
    similar: Number(current.similar || 0),
    availability: Number(current.availability || 0),
    interests: Number(current.interests || 0),
    viewings: Number(current.viewings || 0),
    questions: Number(current.questions || 0),
    favorites: Number(current.favorites || 0),
    updatedAt: current.updatedAt || '',
  };
  data.analytics.properties[id] = bucket;
  return bucket;
}

function recordPropertyEvent(propertyId, kind) {
  const bucket = propertyAnalytics(propertyId);
  if (!bucket || !Object.hasOwn(bucket, kind)) return;
  bucket[kind] += 1;
  bucket.updatedAt = new Date().toISOString();
  scheduleSave();
}

function recordError(area, error) {
  const message = cleanText(error && error.message ? error.message : error, 600) || 'Неизвестная ошибка';
  data.errors.unshift({ id: crypto.randomUUID(), area: cleanText(area, 80), message, createdAt: new Date().toISOString() });
  data.errors = data.errors.slice(0, 100);
  scheduleSave();
}

function recordActivity(user, direction, text, kind = 'message', metadata = {}) {
  if (!user) return null;
  user.activity = Array.isArray(user.activity) ? user.activity : [];
  const entry = {
    id: crypto.randomUUID(),
    direction,
    kind,
    text: cleanText(text, 500),
    createdAt: new Date().toISOString(),
  };
  if (Number.isFinite(Number(metadata.messageId))) entry.messageId = Number(metadata.messageId);
  if (Array.isArray(metadata.messageIds)) {
    entry.messageIds = metadata.messageIds
      .map((messageId) => Number(messageId))
      .filter(Number.isFinite)
      .slice(0, 20);
  }
  if (Number.isFinite(Number(metadata.targetMessageId))) entry.targetMessageId = Number(metadata.targetMessageId);
  if (Array.isArray(metadata.reactions)) entry.reactions = metadata.reactions.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20);
  if (metadata.reactionAction) entry.reactionAction = cleanText(metadata.reactionAction, 20);
  if (metadata.targetText) entry.targetText = cleanText(metadata.targetText, 500);
  user.activity.push(entry);
  user.activity = user.activity.slice(-50);
  return entry;
}

function userByChatId(chatId) {
  return Object.values(data.users).find((user) => String(user.chatId) === String(chatId));
}

function telegramErrorCode(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (current.code) return String(current.code).toUpperCase();
    current = current.cause;
  }
  return '';
}

function telegramErrorMessage(error) {
  if (error && error.name === 'AbortError') return 'Запрос к Telegram отменён.';
  const status = Number(error && error.status);
  const telegramCode = Number(error && error.telegramCode);
  const code = telegramErrorCode(error);
  const raw = cleanText(error && error.message ? error.message : error, 600);

  if (status === 401 || telegramCode === 401) {
    return 'Telegram отклонил токен бота. Проверьте токен в настройках.';
  }
  if (status === 409 || telegramCode === 409) {
    return 'Этот бот уже запущен в другом месте. Оставьте включённым только один экземпляр.';
  }
  if (status === 429 || telegramCode === 429) {
    return 'Telegram временно ограничил частоту запросов. Бот повторит подключение автоматически.';
  }
  if (status >= 500 || telegramCode >= 500) {
    return 'Telegram временно недоступен. Бот повторит подключение автоматически.';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'Windows заблокировала сетевое подключение к Telegram. Проверьте брандмауэр или антивирус.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Не удалось найти сервер Telegram. Проверьте интернет-соединение и DNS.';
  }
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code)) {
    return 'Telegram не ответил вовремя. Бот повторит подключение автоматически.';
  }
  if (['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code)) {
    return 'Соединение с Telegram было прервано. Бот повторит подключение автоматически.';
  }
  if (raw === 'fetch failed' || raw === 'Failed to fetch') {
    return 'Не удалось соединиться с Telegram. Проверьте интернет и доступ приложения к сети.';
  }
  return raw || 'Не удалось выполнить запрос к Telegram.';
}

function normalizeTelegramError(error, status, telegramCode) {
  if (error && error.name === 'AbortError') return error;
  const source = error instanceof Error ? error : new Error(String(error || 'Telegram API error'));
  if (status != null) source.status = status;
  if (telegramCode != null) source.telegramCode = telegramCode;
  const normalized = new Error(telegramErrorMessage(source), { cause: source });
  normalized.code = telegramErrorCode(source);
  normalized.status = source.status;
  normalized.telegramCode = source.telegramCode;
  return normalized;
}

async function telegramRequest(token, method, payload, signal) {
  let response;
  try {
    response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal,
    });
  } catch (error) {
    throw normalizeTelegramError(error);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body || !body.ok) {
    throw normalizeTelegramError(
      new Error((body && body.description) || 'Telegram API error'),
      response.status,
      body && body.error_code
    );
  }
  return body.result;
}

async function telegramMultipartRequest(token, method, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    form.append(key, typeof value === 'string' || value instanceof Blob ? value : JSON.stringify(value));
  }
  let response;
  try {
    response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      body: form,
    });
  } catch (error) {
    throw normalizeTelegramError(error);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body || !body.ok) {
    throw normalizeTelegramError(
      new Error((body && body.description) || 'Telegram API error'),
      response.status,
      body && body.error_code
    );
  }
  return body.result;
}

async function sendPhotoMessage(chatId, image, caption, token, replyMarkup) {
  let result;
  if (image.telegramFileId) {
    try {
      result = await telegramRequest(token, 'sendPhoto', {
        chat_id: chatId,
        photo: image.telegramFileId,
        caption: caption || undefined,
        reply_markup: replyMarkup,
      });
    } catch {
      image.telegramFileId = '';
    }
  }
  if (!result) {
    const bytes = imageBytes(image);
    result = await telegramMultipartRequest(token, 'sendPhoto', {
      chat_id: String(chatId),
      photo: new Blob([bytes], { type: image.mimeType }),
      caption: caption || undefined,
      reply_markup: replyMarkup,
    });
    if (result && Array.isArray(result.photo) && result.photo.length) {
      image.telegramFileId = result.photo[result.photo.length - 1].file_id || '';
    }
  }
  data.stats.messagesSent += 1;
  recordDaily('sent');
  recordActivity(userByChatId(chatId), 'out', caption || '[Изображение]', 'photo', { messageId: result && result.message_id });
  scheduleSave();
  return result;
}

async function sendPhotoAlbum(chatId, images, token, caption = '') {
  const album = (Array.isArray(images) ? images : [])
    .filter(imageExists)
    .slice(0, 10);
  if (!album.length) return [];
  if (album.length === 1) {
    const message = await sendPhotoMessage(chatId, album[0], cleanText(caption, 1000), token, null);
    return message ? [message] : [];
  }

  const firstCaption = cleanText(caption, 1000);
  let result;
  if (album.every((image) => image.telegramFileId)) {
    try {
      result = await telegramRequest(token, 'sendMediaGroup', {
        chat_id: chatId,
        media: album.map((image, index) => ({
          type: 'photo',
          media: image.telegramFileId,
          ...(index === 0 && firstCaption ? { caption: firstCaption } : {}),
        })),
      });
    } catch {
      for (const image of album) image.telegramFileId = '';
    }
  }

  if (!result) {
    const fields = {
      chat_id: String(chatId),
      media: album.map((image, index) => ({
        type: 'photo',
        media: 'attach://photo' + index,
        ...(index === 0 && firstCaption ? { caption: firstCaption } : {}),
      })),
    };
    album.forEach((image, index) => {
      const bytes = imageBytes(image);
      fields['photo' + index] = new Blob([bytes], { type: image.mimeType });
    });
    result = await telegramMultipartRequest(token, 'sendMediaGroup', fields);
    if (Array.isArray(result)) {
      result.forEach((message, index) => {
        if (message && Array.isArray(message.photo) && message.photo.length && album[index]) {
          album[index].telegramFileId = message.photo[message.photo.length - 1].file_id || '';
        }
      });
    }
  }

  const messages = Array.isArray(result) ? result : [];
  const messageIds = messages.map((message) => Number(message && message.message_id)).filter(Number.isFinite);
  data.stats.messagesSent += messages.length;
  for (let index = 0; index < messages.length; index += 1) recordDaily('sent');
  recordActivity(userByChatId(chatId), 'out', firstCaption || '[Альбом: ' + messages.length + ' фото]', 'album', {
    messageId: messageIds[0],
    messageIds,
  });
  scheduleSave();
  return messages;
}

function splitTelegramText(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  const chunks = [];
  let remaining = String(text || '');
  while (remaining.length > limit) {
    const minimumNaturalBreak = Math.floor(limit * 0.65);
    const window = remaining.slice(0, limit + 1);
    let cut = window.lastIndexOf('\n\n', limit);
    if (cut < minimumNaturalBreak) cut = window.lastIndexOf('\n', limit);
    if (cut < minimumNaturalBreak) cut = window.lastIndexOf(' ', limit);
    if (cut < minimumNaturalBreak) cut = limit;
    if (cut > 0 && /[\uD800-\uDBFF]/.test(remaining.charAt(cut - 1)) && /[\uDC00-\uDFFF]/.test(remaining.charAt(cut))) cut -= 1;
    const chunk = remaining.slice(0, cut).trimEnd();
    chunks.push(chunk || remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendMessage(chatId, text, token = data.config.botToken, options = {}) {
  if (!text) return;
  const { track = true, ...telegramOptions } = options || {};
  const chunks = splitTelegramText(text);
  const { reply_markup: replyMarkup, reply_parameters: replyParameters, entities, ...baseOptions } = telegramOptions;
  let result = null;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    result = await telegramRequest(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
      ...baseOptions,
      ...(chunks.length === 1 && entities ? { entities } : {}),
      ...(index === 0 && replyParameters ? { reply_parameters: replyParameters } : {}),
      ...(index === chunks.length - 1 && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (track) {
      data.stats.messagesSent += 1;
      recordDaily('sent');
      recordActivity(userByChatId(chatId), 'out', chunk, 'message', { messageId: result && result.message_id });
    }
  }
  if (track) scheduleSave();
  return result;
}

const runtime = {
  generation: 0,
  abortController: null,
  status: 'stopped',
  lastError: '',
  lastErrorAt: null,
  lastSuccessfulContactAt: null,
  consecutiveFailures: 0,
  nextRetryAt: null,
  offset: Number(data.telegramOffset || 0),
  pollingStartedAt: null,
  broadcastRunning: false,
};

function markTelegramSuccess() {
  runtime.status = 'online';
  runtime.lastError = '';
  runtime.lastErrorAt = null;
  runtime.lastSuccessfulContactAt = new Date().toISOString();
  runtime.consecutiveFailures = 0;
  runtime.nextRetryAt = null;
}

function markTelegramFailure(error, status = 'reconnecting') {
  const firstFailure = runtime.consecutiveFailures === 0;
  runtime.status = status;
  runtime.lastError = telegramErrorMessage(error);
  runtime.lastErrorAt = new Date().toISOString();
  runtime.consecutiveFailures += 1;
  return firstFailure;
}

const LANGUAGE_NAMES = { ru: 'Русский', en: 'English', es: 'Español' };
const LANGUAGE_SELECTED = {
  ru: 'Готово — выбран русский язык',
  en: 'Done — English is selected',
  es: 'Listo — has seleccionado español',
};
const MENU_LABELS = {
  ru: { objects: '🏘 Наши объекты', selection: '✨ Помогите подобрать объект', promotions: '🔥 Акции', favorites: '❤️ Избранное', contacts: '💬 Связаться с менеджером', request: '📞 Заказать звонок', about: 'ℹ️ О компании', help: '❓ Помощь', more: '☰ Ещё', language: '🌐 Сменить язык', placeholder: 'Выберите раздел' },
  en: { objects: '🏘 Our properties', selection: '✨ Help me find a property', promotions: '🔥 Offers', favorites: '❤️ Favorites', contacts: '💬 Contact a manager', request: '📞 Request a call', about: 'ℹ️ About', help: '❓ Help', more: '☰ More', language: '🌐 Change language', placeholder: 'Choose a menu item' },
  es: { objects: '🏘 Nuestros inmuebles', selection: '✨ Ayúdame a elegir', promotions: '🔥 Promociones', favorites: '❤️ Favoritos', contacts: '💬 Contactar con un gestor', request: '📞 Solicitar una llamada', about: 'ℹ️ La empresa', help: '❓ Ayuda', more: '☰ Más', language: '🌐 Cambiar idioma', placeholder: 'Elige una opción' },
};
const LEGACY_MENU_LABELS = {
  ru: { objects: 'Наши объекты', contacts: 'Контакты', promotions: 'Акции', favorites: 'Избранное', request: 'Оставить заявку', about: 'О нас', language: 'Сменить язык' },
  en: { objects: 'Our properties', contacts: 'Contacts', promotions: 'Special offers', favorites: 'Favorites', request: 'Contact an agent', about: 'About us', language: 'Change language' },
  es: { objects: 'Nuestros inmuebles', contacts: 'Contactos', promotions: 'Promociones', favorites: 'Favoritos', request: 'Contactar con un agente', about: 'Sobre nosotros', language: 'Cambiar idioma' },
};
const MENU_HINTS = {
  ru: 'Выберите интересующий раздел в меню ниже 👇',
  en: 'Choose a section from the menu below 👇',
  es: 'Elige una sección del menú 👇',
};
const MAIN_MENU_TEXT = {
  ru: 'Главное меню. Что вас интересует?',
  en: 'Main menu. What are you interested in?',
  es: 'Menú principal. ¿Qué te interesa?',
};
const MANAGER_CONTACT_TEXT = {
  ru: { intro: '💬 Выберите удобный способ связи с менеджером.', tapPhone: 'Нажмите на номер, чтобы позвонить.', call: 'Позвонить', whatsapp: 'WhatsApp', telegram: 'Telegram', website: 'Сайт', map: 'Карта', request: '📞 Заказать звонок', question: '❓ Задать вопрос', askQuestion: 'Напишите ваш вопрос. Менеджер ответит в этом чате.', received: 'Спасибо! Вопрос передан менеджеру.', replyHeader: '👨‍💼 Ответ менеджера', cancel: 'Отменить' },
  en: { intro: '💬 Choose a convenient way to contact a manager.', tapPhone: 'Tap a phone number to call.', call: 'Call', whatsapp: 'WhatsApp', telegram: 'Telegram', website: 'Website', map: 'Map', request: '📞 Request a call', question: '❓ Ask a question', askQuestion: 'Send your question. A manager will reply in this chat.', received: 'Thank you! Your question has been sent to a manager.', replyHeader: '👨‍💼 Manager reply', cancel: 'Cancel' },
  es: { intro: '💬 Elige una forma cómoda de contactar con un gestor.', tapPhone: 'Pulsa un número para llamar.', call: 'Llamar', whatsapp: 'WhatsApp', telegram: 'Telegram', website: 'Sitio web', map: 'Mapa', request: '📞 Solicitar una llamada', question: '❓ Hacer una pregunta', askQuestion: 'Escribe tu pregunta. Un gestor responderá en este chat.', received: '¡Gracias! Tu pregunta ha sido enviada a un gestor.', replyHeader: '👨‍💼 Respuesta del gestor', cancel: 'Cancelar' },
};
const NAVIGATION_TEXT = {
  ru: { mainMenu: 'Главное меню', backToCard: 'К карточке объекта', close: 'Закрыть', browse: 'Посмотреть объекты', readMore: 'Читать подробнее' },
  en: { mainMenu: 'Main menu', backToCard: 'Back to property', close: 'Close', browse: 'Browse properties', readMore: 'Read more' },
  es: { mainMenu: 'Menú principal', backToCard: 'Volver al inmueble', close: 'Cerrar', browse: 'Ver inmuebles', readMore: 'Leer más' },
};
const INTERACTION_TEXT = {
  ru: { failed: 'Не удалось выполнить действие. Попробуйте ещё раз.', duplicate: 'Подождите секунду…', stale: 'Это действие уже завершено. Выберите нужный раздел в меню.', unfinished: 'У вас осталась незавершённая форма. Продолжить с сохранённого шага или вернуться в главное меню?', continueForm: '▶️ Продолжить заполнение', discardForm: '✕ Закрыть форму', expired: 'Прошло больше суток, поэтому незавершённая форма была закрыта. Начните заново — ранее введённые данные не будут отправлены.', resume: '🔄 Начать заново', backToMenu: '🏠 Вернуться в главное меню', hideGallery: 'Скрыть фотографии и вернуться' },
  en: { failed: 'The action could not be completed. Please try again.', duplicate: 'Please wait a moment…', stale: 'This action has already finished. Choose a section from the menu.', unfinished: 'You have an unfinished form. Continue from the saved step or return to the main menu?', continueForm: '▶️ Continue form', discardForm: '✕ Close form', expired: 'More than 24 hours have passed, so the unfinished form was closed. Start again — your earlier entries will not be sent.', resume: '🔄 Start again', backToMenu: '🏠 Return to main menu', hideGallery: 'Hide photos and go back' },
  es: { failed: 'No se pudo completar la acción. Inténtalo de nuevo.', duplicate: 'Espera un momento…', stale: 'Esta acción ya ha terminado. Elige una sección del menú.', unfinished: 'Tienes un formulario sin terminar. ¿Quieres continuar desde el paso guardado o volver al menú principal?', continueForm: '▶️ Continuar formulario', discardForm: '✕ Cerrar formulario', expired: 'Han pasado más de 24 horas, por lo que el formulario sin terminar se ha cerrado. Empieza de nuevo; los datos anteriores no se enviarán.', resume: '🔄 Empezar de nuevo', backToMenu: '🏠 Volver al menú principal', hideGallery: 'Ocultar fotos y volver' },
};
const COMMAND_TEXT = {
  ru: { cancelled: 'Действие отменено. Вы вернулись в главное меню.', nothingToCancel: 'Сейчас нет незавершённых действий. Главное меню уже доступно.', unknown: 'Я не знаю такую команду. Выберите нужный раздел в меню или используйте /help.', myId: 'Ваш Telegram Chat ID:' },
  en: { cancelled: 'The action has been cancelled. You are back in the main menu.', nothingToCancel: 'There is no unfinished action right now. The main menu is ready.', unknown: 'I do not recognise that command. Choose a section from the menu or use /help.', myId: 'Your Telegram Chat ID:' },
  es: { cancelled: 'La acción se ha cancelado. Has vuelto al menú principal.', nothingToCancel: 'No hay ninguna acción pendiente. El menú principal está disponible.', unknown: 'No reconozco ese comando. Elige una sección del menú o usa /help.', myId: 'Tu ID de chat de Telegram:' },
};
const EMPTY_STATE_TEXT = {
  ru: { catalog: 'Сейчас в каталоге нет доступных объектов. Менеджер поможет подобрать подходящий вариант.', favorites: 'В избранном пока ничего нет. Откройте каталог и нажмите ❤️ у понравившегося объекта.', promotions: 'Активных акций сейчас нет. Посмотрите наши объекты или задайте вопрос менеджеру.' },
  en: { catalog: 'There are no available properties in the catalogue right now. A manager can help you find a suitable option.', favorites: 'Your favorites are empty. Open the catalogue and tap ❤️ on a property you like.', promotions: 'There are no active offers right now. Browse our properties or ask a manager.' },
  es: { catalog: 'Ahora mismo no hay inmuebles disponibles en el catálogo. Un gestor puede ayudarte a encontrar una opción.', favorites: 'Todavía no tienes favoritos. Abre el catálogo y pulsa ❤️ en un inmueble.', promotions: 'No hay promociones activas ahora mismo. Consulta nuestros inmuebles o pregunta a un gestor.' },
};
const PROPERTY_TYPE_LABELS = {
  ru: { apartment: 'Квартира', house: 'Дом', villa: 'Вилла', townhouse: 'Таунхаус', land: 'Участок', commercial: 'Коммерческая недвижимость', newbuild: 'Новостройка', other: 'Недвижимость' },
  en: { apartment: 'Apartment', house: 'House', villa: 'Villa', townhouse: 'Townhouse', land: 'Land', commercial: 'Commercial property', newbuild: 'New development', other: 'Property' },
  es: { apartment: 'Apartamento', house: 'Casa', villa: 'Villa', townhouse: 'Adosado', land: 'Terreno', commercial: 'Propiedad comercial', newbuild: 'Obra nueva', other: 'Inmueble' },
};
const PROPERTY_BADGE_LABELS = {
  ru: { new: 'Новинка', recommended: 'Рекомендуем', exclusive: 'Эксклюзив', price_reduced: 'Цена снижена' },
  en: { new: 'New', recommended: 'Recommended', exclusive: 'Exclusive', price_reduced: 'Price reduced' },
  es: { new: 'Nuevo', recommended: 'Recomendado', exclusive: 'Exclusivo', price_reduced: 'Precio reducido' },
};
const PROPERTY_CONDITION_LABELS = {
  ru: { new: 'Новое', renovated: 'После ремонта', needs_renovation: 'Требует ремонта', under_construction: 'Строится' },
  en: { new: 'New', renovated: 'Renovated', needs_renovation: 'Needs renovation', under_construction: 'Under construction' },
  es: { new: 'Nuevo', renovated: 'Reformado', needs_renovation: 'Para reformar', under_construction: 'En construcción' },
};
const PROPERTY_ACTION_TEXT = {
  ru: { details: 'Подробнее', contactManager: 'Связаться с менеджером', share: 'Поделиться', sharePrefix: 'Посмотрите этот объект: ', viewWebsite: 'Посмотреть на сайте', openMap: 'Открыть карту', interest: 'Заказать звонок', viewing: 'Записаться на просмотр', availability: 'Уточнить доступность', similar: 'Показать похожие объекты', question: 'Задать вопрос', gallery: 'Все фотографии', favoriteButton: 'Добавить в избранное', favoriteRemoveButton: 'Убрать из избранного', favoriteAdd: 'Добавлено в избранное', favoriteRemove: 'Удалено из избранного', askQuestion: 'Напишите ваш вопрос по этому объекту. Можно отправить текст, фотографию или голосовое сообщение.', cancel: 'Отменить действие', cancelled: 'Действие отменено', received: 'Спасибо! Менеджер получил ваше обращение и ответит в этом чате.', emptyFavorites: 'В избранном пока нет объектов. Добавляйте их кнопкой ❤️ под карточкой.', forRent: 'Аренда', forSale: 'Продажа', reserved: 'Забронирован', available: 'Доступен', priceMonth: '/ месяц', priceWeek: '/ неделю', priceOnRequest: 'Цена по запросу', floor: 'Этаж', reference: '№ объекта:', updated: 'Обновлено', propertyUnavailable: 'Этот объект уже недоступен.', propertyHeading: 'Объект', requestViewingPrefix: 'Запрос на просмотр:', questionPrefix: 'Вопрос по объекту:', interestPrefix: 'Интересует объект:', noSimilar: 'Сейчас похожих объектов нет. Менеджер может предложить другие варианты.', similarHeading: 'Похожий объект', managerPrompt: 'Как менеджер может помочь по этому объекту?', photosUnavailable: 'Фотографии пока недоступны', nextProperty: 'Следующий объект →', nextPrompt: 'Что вы хотите сделать дальше?' },
  en: { details: 'View details', contactManager: 'Contact a manager', share: 'Share property', sharePrefix: 'Take a look at this property: ', viewWebsite: 'View on website', openMap: 'Open map', interest: 'Request a call', viewing: 'Book a viewing', availability: 'Check availability', similar: 'Show similar properties', question: 'Ask a question', gallery: 'All photos', favoriteButton: 'Add to favorites', favoriteRemoveButton: 'Remove from favorites', favoriteAdd: 'Added to favorites', favoriteRemove: 'Removed from favorites', askQuestion: 'Send your question about this property. You can send text, a photo, or a voice message.', cancel: 'Cancel action', cancelled: 'Action cancelled', received: 'Thank you! A manager received your message and will reply in this chat.', emptyFavorites: 'Your favorites are empty. Add properties with the ❤️ button under a card.', forRent: 'For rent', forSale: 'For sale', reserved: 'Reserved', available: 'Available', priceMonth: '/ month', priceWeek: '/ week', priceOnRequest: 'Price on request', floor: 'Floor', reference: 'Ref:', updated: 'Updated', propertyUnavailable: 'This property is no longer available.', propertyHeading: 'Property', requestViewingPrefix: 'Viewing request:', questionPrefix: 'Question about:', interestPrefix: 'Interested in:', noSimilar: 'No similar properties are available right now. A manager can suggest alternatives.', similarHeading: 'Similar property', managerPrompt: 'How would you like the manager to help with this property?', photosUnavailable: 'Photos are not available yet', nextProperty: 'Next property →', nextPrompt: 'What would you like to do next?' },
  es: { details: 'Ver detalles', contactManager: 'Contactar con un gestor', share: 'Compartir inmueble', sharePrefix: 'Mira este inmueble: ', viewWebsite: 'Ver en el sitio web', openMap: 'Abrir mapa', interest: 'Solicitar una llamada', viewing: 'Reservar una visita', availability: 'Consultar disponibilidad', similar: 'Ver inmuebles similares', question: 'Hacer una pregunta', gallery: 'Todas las fotos', favoriteButton: 'Añadir a favoritos', favoriteRemoveButton: 'Quitar de favoritos', favoriteAdd: 'Añadido a favoritos', favoriteRemove: 'Eliminado de favoritos', askQuestion: 'Escribe tu pregunta sobre este inmueble. Puedes enviar texto, una foto o un mensaje de voz.', cancel: 'Cancelar acción', cancelled: 'Acción cancelada', received: '¡Gracias! Un gestor ha recibido tu mensaje y responderá en este chat.', emptyFavorites: 'Todavía no tienes favoritos. Añade inmuebles con el botón ❤️ de la ficha.', forRent: 'Alquiler', forSale: 'Venta', reserved: 'Reservado', available: 'Disponible', priceMonth: '/ mes', priceWeek: '/ semana', priceOnRequest: 'Precio a consultar', floor: 'Planta', reference: 'Ref.:', updated: 'Actualizado', propertyUnavailable: 'Este inmueble ya no está disponible.', propertyHeading: 'Inmueble', requestViewingPrefix: 'Solicitud de visita:', questionPrefix: 'Pregunta sobre:', interestPrefix: 'Interés en:', noSimilar: 'No hay inmuebles similares disponibles ahora mismo. Un gestor puede sugerirte alternativas.', similarHeading: 'Inmueble similar', managerPrompt: '¿Cómo quieres que te ayude el gestor con este inmueble?', photosUnavailable: 'Las fotos aún no están disponibles', nextProperty: 'Siguiente inmueble →', nextPrompt: '¿Qué quieres hacer ahora?' },
};
const LEAD_FORM_TEXT = {
  ru: {
    askName: 'Давайте быстро оформим заявку — это займёт меньше минуты.\n\n1 из 3. Как к вам обращаться?',
    askPhone: '2 из 3. Укажите номер телефона или нажмите «Отправить мой номер».\n\nОтправляя номер, вы разрешаете использовать его для связи по вашей заявке.',
    askTime: '3 из 3. Когда вам удобно принять звонок?',
    phoneButton: '📱 Отправить мой номер',
    cancel: '✕ Отменить заявку',
    cancelled: 'Заполнение заявки отменено.',
    invalidName: 'Пожалуйста, напишите имя — не менее двух символов.',
    invalidPhone: 'Не удалось распознать номер. Введите его с кодом страны или нажмите «Отправить мой номер».',
    invalidTime: 'Напишите удобное время, например: «завтра после 16:00».',
    timeOptions: ['Сегодня после 18:00', 'Завтра 10:00–13:00', 'В любое время'],
    review: 'Проверьте данные перед отправкой:',
    reviewLabels: ['Имя', 'Телефон', 'Удобное время'],
    confirm: '✅ Отправить заявку',
    edit: '✏️ Изменить данные',
    editName: '✏️ Изменить имя',
    editPhone: '📱 Изменить телефон',
    editTime: '🕒 Изменить время',
    savedName: 'Использовать имя',
    savedPhone: 'Использовать номер',
    success: 'Спасибо! Заявка отправлена. Менеджер свяжется с вами в указанное время.',
  },
  en: {
    askName: 'Let’s make a quick request — it will take less than a minute.\n\n1 of 3. What is your name?',
    askPhone: '2 of 3. Enter your phone number or tap “Share my phone number”.\n\nBy sending your number, you allow us to use it to contact you about this request.',
    askTime: '3 of 3. When is a convenient time for a call?',
    phoneButton: '📱 Share my phone number',
    cancel: '✕ Cancel request',
    cancelled: 'The request has been cancelled.',
    invalidName: 'Please enter your name using at least two characters.',
    invalidPhone: 'We could not recognise the number. Include the country code or tap “Share my phone number”.',
    invalidTime: 'Enter a convenient time, for example: “tomorrow after 4 pm”.',
    timeOptions: ['Today after 6 pm', 'Tomorrow 10 am–1 pm', 'Any time'],
    review: 'Please check your details before sending:',
    reviewLabels: ['Name', 'Phone', 'Preferred time'],
    confirm: '✅ Send request',
    edit: '✏️ Edit details',
    editName: '✏️ Edit name',
    editPhone: '📱 Edit phone',
    editTime: '🕒 Edit time',
    savedName: 'Use saved name',
    savedPhone: 'Use saved number',
    success: 'Thank you! Your request has been sent. A manager will contact you at the selected time.',
  },
  es: {
    askName: 'Vamos a completar una solicitud rápida; tardará menos de un minuto.\n\n1 de 3. ¿Cómo te llamas?',
    askPhone: '2 de 3. Indica tu teléfono o pulsa «Compartir mi teléfono».\n\nAl enviar tu número, permites que lo utilicemos para contactar contigo sobre esta solicitud.',
    askTime: '3 de 3. ¿Cuándo te viene bien recibir una llamada?',
    phoneButton: '📱 Compartir mi teléfono',
    cancel: '✕ Cancelar solicitud',
    cancelled: 'La solicitud ha sido cancelada.',
    invalidName: 'Escribe tu nombre con al menos dos caracteres.',
    invalidPhone: 'No pudimos reconocer el número. Incluye el prefijo del país o pulsa «Compartir mi teléfono».',
    invalidTime: 'Indica una hora conveniente, por ejemplo: «mañana después de las 16:00».',
    timeOptions: ['Hoy después de las 18:00', 'Mañana 10:00–13:00', 'A cualquier hora'],
    review: 'Comprueba tus datos antes de enviar:',
    reviewLabels: ['Nombre', 'Teléfono', 'Hora preferida'],
    confirm: '✅ Enviar solicitud',
    edit: '✏️ Cambiar datos',
    editName: '✏️ Cambiar nombre',
    editPhone: '📱 Cambiar teléfono',
    editTime: '🕒 Cambiar hora',
    savedName: 'Usar el nombre guardado',
    savedPhone: 'Usar el número guardado',
    success: '¡Gracias! Tu solicitud ha sido enviada. Un gestor te llamará a la hora indicada.',
  },
};
const VIEWING_FORM_TEXT = {
  ru: {
    askDate: '📅 Когда вам удобно посмотреть этот объект?',
    dateOptions: ['Сегодня', 'Завтра', 'В выходные', 'Другая дата'],
    askTime: '🕒 В какое время вам удобно?',
    timeOptions: ['Утром', 'Днём', 'Вечером', 'Другое время'],
    askCustom: 'Напишите удобные дату и время одним сообщением, например: «25 сентября после 16:00».',
    askCustomTime: 'Напишите удобное время, например: «после 16:00».',
    review: 'Проверьте запись на просмотр:',
    reviewLabels: ['Объект', 'Дата', 'Время'],
    unavailable: 'Этот объект больше недоступен для просмотра.',
    asSpecified: 'Как указано',
    confirm: '✅ Отправить менеджеру',
    restart: '✏️ Изменить дату и время',
    editDate: '📅 Изменить дату',
    editTime: '🕒 Изменить время',
    cancel: '✕ Отменить запись',
    cancelled: 'Запись на просмотр отменена.',
    invalid: 'Пожалуйста, выберите вариант на клавиатуре или напишите удобные дату и время.',
    success: 'Заявка на просмотр отправлена. Менеджер подтвердит дату и время в этом чате.',
  },
  en: {
    askDate: '📅 When would you like to view this property?',
    dateOptions: ['Today', 'Tomorrow', 'This weekend', 'Another date'],
    askTime: '🕒 What time is convenient?',
    timeOptions: ['Morning', 'Afternoon', 'Evening', 'Another time'],
    askCustom: 'Send a convenient date and time in one message, for example: “25 September after 4 pm”.',
    askCustomTime: 'Send a convenient time, for example: “after 4 pm”.',
    review: 'Please check your viewing request:',
    reviewLabels: ['Property', 'Date', 'Time'],
    unavailable: 'This property is no longer available for viewing.',
    asSpecified: 'As specified',
    confirm: '✅ Send to manager',
    restart: '✏️ Change date and time',
    editDate: '📅 Change date',
    editTime: '🕒 Change time',
    cancel: '✕ Cancel viewing',
    cancelled: 'The viewing request has been cancelled.',
    invalid: 'Choose an option from the keyboard or send a convenient date and time.',
    success: 'Your viewing request has been sent. A manager will confirm the date and time in this chat.',
  },
  es: {
    askDate: '📅 ¿Cuándo te gustaría visitar este inmueble?',
    dateOptions: ['Hoy', 'Mañana', 'Este fin de semana', 'Otra fecha'],
    askTime: '🕒 ¿A qué hora te viene bien?',
    timeOptions: ['Por la mañana', 'Por la tarde', 'Por la noche', 'Otra hora'],
    askCustom: 'Escribe una fecha y hora convenientes en un mensaje, por ejemplo: «25 de septiembre después de las 16:00».',
    askCustomTime: 'Escribe una hora conveniente, por ejemplo: «después de las 16:00».',
    review: 'Comprueba tu solicitud de visita:',
    reviewLabels: ['Inmueble', 'Fecha', 'Hora'],
    unavailable: 'Este inmueble ya no está disponible para visitas.',
    asSpecified: 'Según lo indicado',
    confirm: '✅ Enviar al gestor',
    restart: '✏️ Cambiar fecha y hora',
    editDate: '📅 Cambiar fecha',
    editTime: '🕒 Cambiar hora',
    cancel: '✕ Cancelar visita',
    cancelled: 'La solicitud de visita ha sido cancelada.',
    invalid: 'Elige una opción del teclado o escribe una fecha y hora convenientes.',
    success: 'Tu solicitud de visita ha sido enviada. Un gestor confirmará la fecha y hora en este chat.',
  },
};
const SELECTION_FORM_TEXT = {
  ru: {
    intro: '✨ Я задам несколько коротких вопросов и передам ваши пожелания менеджеру.',
    askDeal: '1 из 4. Вы рассматриваете покупку или аренду?',
    dealOptions: ['Покупка', 'Аренда', 'Пока не решил(а)'],
    askLocation: '2 из 4. Какой город, район или направление вас интересует?',
    anyLocation: 'Район не важен',
    askBudget: '3 из 4. Какой бюджет вы рассматриваете? Можно написать сумму и валюту.',
    noBudget: 'Бюджет пока не определён',
    askBedrooms: '4 из 4. Сколько спален нужно?',
    bedroomOptions: ['1 спальня', '2 спальни', '3 спальни', '4+ спальни', 'Не важно'],
    review: 'Проверьте пожелания:',
    summaryTitle: 'Подбор объекта',
    labels: ['Цель', 'Район', 'Бюджет', 'Спальни'],
    confirm: '✅ Отправить менеджеру',
    restart: '✏️ Заполнить заново',
    editDeal: '✏️ Изменить цель',
    editLocation: '📍 Изменить район',
    editBudget: '💶 Изменить бюджет',
    editBedrooms: '🛏 Изменить спальни',
    cancel: '✕ Отменить подбор',
    cancelled: 'Подбор объекта отменён.',
    invalid: 'Пожалуйста, напишите ответ или выберите один из вариантов.',
    success: 'Спасибо! Пожелания переданы менеджеру. Подходящие варианты придут в этот чат.',
  },
  en: {
    intro: '✨ I will ask a few short questions and send your preferences to a manager.',
    askDeal: '1 of 4. Are you looking to buy or rent?',
    dealOptions: ['Buy', 'Rent', 'Not sure yet'],
    askLocation: '2 of 4. Which city, area, or location interests you?',
    anyLocation: 'Any location',
    askBudget: '3 of 4. What budget are you considering? You can include the amount and currency.',
    noBudget: 'Budget not decided yet',
    askBedrooms: '4 of 4. How many bedrooms do you need?',
    bedroomOptions: ['1 bedroom', '2 bedrooms', '3 bedrooms', '4+ bedrooms', 'Any'],
    review: 'Please check your preferences:',
    summaryTitle: 'Property selection',
    labels: ['Purpose', 'Location', 'Budget', 'Bedrooms'],
    confirm: '✅ Send to manager',
    restart: '✏️ Start again',
    editDeal: '✏️ Edit purpose',
    editLocation: '📍 Edit location',
    editBudget: '💶 Edit budget',
    editBedrooms: '🛏 Edit bedrooms',
    cancel: '✕ Cancel selection',
    cancelled: 'Property selection has been cancelled.',
    invalid: 'Send an answer or choose one of the options.',
    success: 'Thank you! Your preferences have been sent to a manager. Suitable options will arrive in this chat.',
  },
  es: {
    intro: '✨ Te haré unas preguntas breves y enviaré tus preferencias a un gestor.',
    askDeal: '1 de 4. ¿Quieres comprar o alquilar?',
    dealOptions: ['Comprar', 'Alquilar', 'Aún no lo sé'],
    askLocation: '2 de 4. ¿Qué ciudad, zona o ubicación te interesa?',
    anyLocation: 'Cualquier ubicación',
    askBudget: '3 de 4. ¿Qué presupuesto consideras? Puedes indicar la cantidad y la moneda.',
    noBudget: 'Presupuesto por definir',
    askBedrooms: '4 de 4. ¿Cuántos dormitorios necesitas?',
    bedroomOptions: ['1 dormitorio', '2 dormitorios', '3 dormitorios', '4+ dormitorios', 'No importa'],
    review: 'Comprueba tus preferencias:',
    summaryTitle: 'Selección de inmueble',
    labels: ['Objetivo', 'Zona', 'Presupuesto', 'Dormitorios'],
    confirm: '✅ Enviar al gestor',
    restart: '✏️ Empezar de nuevo',
    editDeal: '✏️ Cambiar objetivo',
    editLocation: '📍 Cambiar zona',
    editBudget: '💶 Cambiar presupuesto',
    editBedrooms: '🛏 Cambiar dormitorios',
    cancel: '✕ Cancelar selección',
    cancelled: 'La selección de inmueble ha sido cancelada.',
    invalid: 'Escribe una respuesta o elige una de las opciones.',
    success: '¡Gracias! Tus preferencias han sido enviadas a un gestor. Recibirás opciones adecuadas en este chat.',
  },
};

const LANGUAGE_PICKER_TEXT = {
  ru: '🌐 Choose your language\nElige tu idioma\nВыберите язык',
  en: '🌐 Choose your language\nElige tu idioma\nВыберите язык',
  es: '🌐 Choose your language\nElige tu idioma\nВыберите язык',
};

const BOT_COMMAND_DESCRIPTIONS = {
  ru: { start: 'Запустить бота', menu: 'Открыть главное меню', language: 'Сменить язык', help: 'Помощь', cancel: 'Отменить текущее действие' },
  en: { start: 'Start the bot', menu: 'Open main menu', language: 'Change language', help: 'Help', cancel: 'Cancel current action' },
  es: { start: 'Iniciar el bot', menu: 'Abrir el menú principal', language: 'Cambiar idioma', help: 'Ayuda', cancel: 'Cancelar la acción actual' },
};

// Every phrase below is shown to a bot user. The administrator can override it
// without changing this file; these values remain the safe multilingual defaults.
const INTERFACE_TEXT_TARGETS = {
  languageSelected: { target: LANGUAGE_SELECTED, scalarKey: 'text' },
  languagePicker: { target: LANGUAGE_PICKER_TEXT, scalarKey: 'text' },
  commandDescriptions: { target: BOT_COMMAND_DESCRIPTIONS },
  menuLabels: { target: MENU_LABELS },
  menuHints: { target: MENU_HINTS, scalarKey: 'text' },
  mainMenu: { target: MAIN_MENU_TEXT, scalarKey: 'text' },
  managerContact: { target: MANAGER_CONTACT_TEXT },
  navigation: { target: NAVIGATION_TEXT },
  interaction: { target: INTERACTION_TEXT },
  commands: { target: COMMAND_TEXT },
  emptyStates: { target: EMPTY_STATE_TEXT },
  propertyTypes: { target: PROPERTY_TYPE_LABELS },
  propertyBadges: { target: PROPERTY_BADGE_LABELS },
  propertyConditions: { target: PROPERTY_CONDITION_LABELS },
  propertyActions: { target: PROPERTY_ACTION_TEXT },
  callbackForm: { target: LEAD_FORM_TEXT },
  viewingForm: { target: VIEWING_FORM_TEXT },
  selectionForm: { target: SELECTION_FORM_TEXT },
};

const INTERFACE_TEXT_DEFAULTS = Object.fromEntries(Object.entries(INTERFACE_TEXT_TARGETS).map(([group, descriptor]) => [
  group,
  Object.fromEntries(['ru', 'en', 'es'].map((language) => [
    language,
    descriptor.scalarKey
      ? { [descriptor.scalarKey]: descriptor.target[language] }
      : clone(descriptor.target[language]),
  ])),
]));

function normalizedInterfaceText(value, strict = false) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [group, languages] of Object.entries(INTERFACE_TEXT_DEFAULTS)) {
    result[group] = {};
    for (const language of ['ru', 'en', 'es']) {
      const defaults = languages[language];
      const source = incoming[group] && incoming[group][language] && typeof incoming[group][language] === 'object'
        ? incoming[group][language]
        : {};
      result[group][language] = {};
      for (const [key, fallback] of Object.entries(defaults)) {
        if (Array.isArray(fallback)) {
          const values = Array.isArray(source[key])
            ? source[key].map((item) => cleanText(item, 80)).filter(Boolean)
            : [];
          if (strict && values.length !== fallback.length) {
            throw new Error('В списке «' + group + ' / ' + key + '» должно быть ' + fallback.length + ' строк');
          }
          result[group][language][key] = values.length === fallback.length ? values : clone(fallback);
          continue;
        }
        const text = cleanText(source[key], String(fallback).length > 55 || String(fallback).includes('\n') ? 4000 : 80);
        if (strict && !text) throw new Error('Все тексты интерфейса должны быть заполнены');
        result[group][language][key] = text || fallback;
      }
    }
  }
  return result;
}

function applyInterfaceText(value = data.interfaceText) {
  const next = normalizedInterfaceText(value);
  for (const [group, descriptor] of Object.entries(INTERFACE_TEXT_TARGETS)) {
    for (const language of ['ru', 'en', 'es']) {
      const languageValue = next[group][language];
      if (descriptor.scalarKey) descriptor.target[language] = languageValue[descriptor.scalarKey];
      else descriptor.target[language] = clone(languageValue);
    }
  }
  data.interfaceText = next;
  return next;
}

applyInterfaceText();

function languageMessages(language) {
  return data.config.messages[language] || data.config.messages.ru;
}

function menuKeyboard(language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  return {
    keyboard: [
      [{ text: labels.objects }],
      [{ text: labels.selection }],
      [{ text: labels.favorites }, { text: labels.promotions }],
      [{ text: labels.contacts }],
      [{ text: labels.more }, { text: labels.language }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: labels.placeholder,
  };
}

function menuItemForText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  return ['objects', 'selection', 'contacts', 'promotions', 'favorites', 'request', 'about', 'help', 'more'].find((key) => {
    return labels[key] === text || legacy[key] === text;
  }) || '';
}

function isLanguageChangeText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  return text === labels.language || text === legacy.language;
}

function savedLeadOption(user, language, field) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const value = field === 'phone' ? cleanText(user && user.phone, 40) : cleanText(user && user.contactName, 40);
  if (!value) return '';
  return cleanText((field === 'phone' ? copy.savedPhone : copy.savedName) + ': ' + value, 64);
}

function leadFormKeyboard(language, step, user) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const keyboard = [];
  const savedName = savedLeadOption(user, language, 'name');
  const savedPhone = savedLeadOption(user, language, 'phone');
  if (step === 'name' && savedName) keyboard.push([{ text: savedName }]);
  if (step === 'phone') {
    if (savedPhone) keyboard.push([{ text: savedPhone }]);
    keyboard.push([{ text: copy.phoneButton, request_contact: true }]);
  }
  if (step === 'time') {
    keyboard.push([{ text: copy.timeOptions[0] }, { text: copy.timeOptions[1] }]);
    keyboard.push([{ text: copy.timeOptions[2] }]);
  }
  if (step === 'confirm') {
    keyboard.push([{ text: copy.confirm }]);
    keyboard.push([{ text: copy.editName }]);
    keyboard.push([{ text: copy.editPhone }]);
    keyboard.push([{ text: copy.editTime }]);
  }
  keyboard.push([{ text: copy.cancel }]);
  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: cleanText(step === 'phone' ? copy.askPhone : step === 'time' ? copy.askTime : step === 'confirm' ? copy.review : copy.askName, 64),
  };
}

function leadReviewText(copy, lead, language) {
  const labels = copy.reviewLabels;
  return [copy.review, '', labels[0] + ': ' + lead.name, labels[1] + ': ' + lead.phone, labels[2] + ': ' + lead.preferredTime].join('\n');
}

async function sendLeadReview(user, pending, token, language) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  pending.step = 'confirm';
  pending.editing = '';
  scheduleSave();
  await sendMessage(user.chatId, leadReviewText(copy, {
    name: cleanText(pending.data && pending.data.name, 120),
    phone: cleanText(pending.data && pending.data.phone, 80),
    preferredTime: cleanText(pending.data && pending.data.preferredTime, 160),
  }, language), token, { reply_markup: leadFormKeyboard(language, 'confirm', user) });
}

function validLeadPhone(value) {
  const phone = cleanText(value, 80);
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 20 ? phone : '';
}

function preferredTimeWithDate(value, language, createdAt) {
  const text = cleanText(value, 160);
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const optionIndex = copy.timeOptions.indexOf(text);
  if (optionIndex !== 0 && optionIndex !== 1) return text;
  const date = new Date(createdAt || Date.now());
  if (!Number.isFinite(date.getTime())) return text;
  if (optionIndex === 1) date.setDate(date.getDate() + 1);
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
  const calendarDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return text + ' (' + calendarDate + ')';
}

function pendingActionExpired(user) {
  if (!user || !user.pendingAction) return false;
  const createdAt = Date.parse(user.pendingAction.createdAt || '');
  return !Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_ACTION_TTL_MS;
}

function rememberExpiredAction(user, pending) {
  if (!user || !pending) return null;
  const type = pending.type === 'property_selection' ? 'selection'
    : pending.type === 'viewing_form' ? 'viewing'
      : pending.type === 'manager_question' ? 'manager_question'
        : pending.type === 'question' ? 'property_question'
          : pending.type === 'lead' ? 'lead'
            : '';
  if (!type) return null;
  user.expiredAction = {
    type,
    propertyId: cleanText(pending.propertyId, 100),
    createdAt: new Date().toISOString(),
  };
  return user.expiredAction;
}

function expiredActionKeyboard(language) {
  const copy = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
  return {
    keyboard: [[{ text: copy.resume }], [{ text: copy.backToMenu }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: copy.resume,
  };
}

function unfinishedActionKeyboard(language) {
  const copy = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
  return oneColumnReplyKeyboard([copy.continueForm], copy.discardForm, copy.unfinished);
}

async function showPendingActionStep(user, token) {
  const pending = user && user.pendingAction;
  if (!pending) return false;
  const language = user.preferredLanguage || 'ru';
  if (pending.type === 'lead') {
    const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
    const step = ['name', 'phone', 'time', 'confirm'].includes(pending.step) ? pending.step : 'name';
    if (step === 'confirm') {
      await sendLeadReview(user, pending, token, language);
      return true;
    }
    const prompt = step === 'phone' ? copy.askPhone : step === 'time' ? copy.askTime : copy.askName;
    await sendMessage(user.chatId, prompt, token, { reply_markup: leadFormKeyboard(language, step, user) });
    return true;
  }
  if (pending.type === 'viewing_form') {
    const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
    const property = data.objects.find((item) => item.id === pending.propertyId && item.status === 'active');
    if (!property) {
      user.pendingAction = null;
      scheduleSave();
      await sendMessage(user.chatId, copy.unavailable, token, { reply_markup: menuKeyboard(language) });
      return true;
    }
    const step = ['date', 'time', 'custom', 'custom_time', 'confirm'].includes(pending.step) ? pending.step : 'date';
    if (step === 'confirm') {
      await sendViewingReview(user, pending, property, token, language);
      return true;
    }
    const prompt = step === 'time' ? copy.askTime : step === 'custom_time' ? copy.askCustomTime : step === 'custom' ? copy.askCustom : copy.askDate;
    const title = step === 'date' ? localizedExact(property.title, language) || property.reference || '' : '';
    await sendMessage(user.chatId, [title ? '🏠 ' + title : '', prompt].filter(Boolean).join('\n\n'), token, { reply_markup: viewingKeyboard(language, step) });
    return true;
  }
  if (pending.type === 'property_selection') {
    const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
    const step = ['deal', 'location', 'budget', 'bedrooms', 'confirm'].includes(pending.step) ? pending.step : 'deal';
    if (step === 'confirm') {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    const prompt = step === 'location' ? copy.askLocation : step === 'budget' ? copy.askBudget : step === 'bedrooms' ? copy.askBedrooms : copy.askDeal;
    await sendMessage(user.chatId, prompt, token, { reply_markup: selectionKeyboard(language, step) });
    return true;
  }
  if (pending.type === 'manager_question') {
    const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    await sendMessage(user.chatId, copy.askQuestion, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  if (pending.type === 'question' && pending.propertyId) {
    const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    const property = data.objects.find((item) => item.id === pending.propertyId && ['active', 'reserved'].includes(item.status));
    if (property) {
      const title = localizedExact(property.title, language) || property.reference || '';
      await sendMessage(user.chatId, [title ? '🏠 ' + title : '', copy.askQuestion].filter(Boolean).join('\n\n'), token, { reply_markup: menuKeyboard(language) });
      return true;
    }
  }
  user.pendingAction = null;
  scheduleSave();
  await sendMainMenu(user.chatId, user, token);
  return true;
}

function duplicateInboundMessage(user, messageId) {
  if (!user || !Number.isFinite(Number(messageId))) return false;
  const normalizedId = Number(messageId);
  if (Number(user.lastInboundMessageId) === normalizedId) return true;
  user.lastInboundMessageId = normalizedId;
  scheduleSave();
  return false;
}

function duplicateCallback(user, key, intervalMs = 1400) {
  if (!user) return false;
  const now = Date.now();
  const normalizedKey = cleanText(key, 120);
  const previous = user.lastCallback && typeof user.lastCallback === 'object' ? user.lastCallback : null;
  if (previous && previous.key === normalizedKey && now - Number(previous.at || 0) < intervalMs) return true;
  user.lastCallback = { key: normalizedKey, at: now };
  scheduleSave();
  return false;
}

function isStaleFormControl(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const keys = ['confirm', 'cancel', 'edit', 'editName', 'editPhone', 'editTime', 'restart', 'editDate', 'editDeal', 'editLocation', 'editBudget', 'editBedrooms'];
  for (const language of ['ru', 'en', 'es']) {
    const interaction = INTERACTION_TEXT[language];
    if (interaction && [interaction.continueForm, interaction.discardForm, interaction.resume, interaction.backToMenu].includes(value)) return true;
    for (const source of [LEAD_FORM_TEXT[language], VIEWING_FORM_TEXT[language], SELECTION_FORM_TEXT[language]]) {
      if (source && keys.some((key) => source[key] && source[key] === value)) return true;
    }
  }
  return false;
}

async function startLeadForm(user, token, context = {}) {
  const language = user.preferredLanguage || 'ru';
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  user.pendingAction = {
    type: 'lead',
    step: 'name',
    propertyId: cleanText(context.propertyId, 100),
    data: {},
    createdAt: new Date().toISOString(),
  };
  scheduleSave();
  await sendMessage(user.chatId, copy.askName, token, { reply_markup: leadFormKeyboard(language, 'name', user) });
}

async function handleLeadFormMessage(message, user, token) {
  const pending = user.pendingAction;
  if (!pending || pending.type !== 'lead') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text === copy.cancel) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.cancelled, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  pending.data = pending.data && typeof pending.data === 'object' ? pending.data : {};
  if (pending.step === 'name') {
    const savedName = savedLeadOption(user, language, 'name');
    const name = cleanText(savedName && text === savedName ? user.contactName : text, 120);
    if (name.length < 2) {
      await sendMessage(user.chatId, copy.invalidName, token, { reply_markup: leadFormKeyboard(language, 'name', user) });
      return true;
    }
    pending.data.name = name;
    if (pending.editing === 'name') {
      await sendLeadReview(user, pending, token, language);
      return true;
    }
    pending.step = 'phone';
    scheduleSave();
    await sendMessage(user.chatId, copy.askPhone, token, { reply_markup: leadFormKeyboard(language, 'phone', user) });
    return true;
  }
  if (pending.step === 'phone') {
    const savedPhone = savedLeadOption(user, language, 'phone');
    const phone = validLeadPhone(message.contact && message.contact.phone_number ? message.contact.phone_number : savedPhone && text === savedPhone ? user.phone : text);
    if (!phone) {
      await sendMessage(user.chatId, copy.invalidPhone, token, { reply_markup: leadFormKeyboard(language, 'phone', user) });
      return true;
    }
    pending.data.phone = phone;
    if (pending.editing === 'phone') {
      await sendLeadReview(user, pending, token, language);
      return true;
    }
    pending.step = 'time';
    scheduleSave();
    await sendMessage(user.chatId, copy.askTime, token, { reply_markup: leadFormKeyboard(language, 'time', user) });
    return true;
  }
  if (pending.step === 'confirm') {
    const editStep = text === copy.editName ? 'name' : text === copy.editPhone ? 'phone' : text === copy.editTime ? 'time' : '';
    if (editStep) {
      pending.step = editStep;
      pending.editing = editStep;
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      const prompt = editStep === 'phone' ? copy.askPhone : editStep === 'time' ? copy.askTime : copy.askName;
      await sendMessage(user.chatId, prompt, token, { reply_markup: leadFormKeyboard(language, editStep, user) });
      return true;
    }
    if (text === copy.edit) {
      pending.step = 'name';
      pending.editing = '';
      pending.data = {};
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      await sendMessage(user.chatId, copy.askName, token, { reply_markup: leadFormKeyboard(language, 'name', user) });
      return true;
    }
    const lead = {
      name: cleanText(pending.data.name, 120),
      phone: cleanText(pending.data.phone, 80),
      preferredTime: cleanText(pending.data.preferredTime, 160),
    };
    if (text !== copy.confirm) {
      await sendMessage(user.chatId, leadReviewText(copy, lead, language), token, { reply_markup: leadFormKeyboard(language, 'confirm', user) });
      return true;
    }
    const propertyId = cleanText(pending.propertyId, 100);
    user.contactName = lead.name;
    user.phone = lead.phone;
    user.preferredContactTime = lead.preferredTime;
    user.pendingAction = null;
    createInquiry(user, [
      'Имя: ' + lead.name,
      'Телефон: ' + lead.phone,
      'Удобное время: ' + lead.preferredTime,
    ].join('\n'), { type: 'lead', propertyId, lead, sourceMessage: message });
    saveDataNow();
    const property = propertyId ? data.objects.find((item) => item.id === propertyId) : null;
    const propertyTitle = property ? localizedExact(property.title, language) : '';
    await sendMessage(user.chatId, [copy.success, propertyTitle ? '🏠 ' + propertyTitle : ''].filter(Boolean).join('\n\n'), token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  const preferredTime = preferredTimeWithDate(text, language, pending.createdAt);
  if (preferredTime.length < 2) {
    await sendMessage(user.chatId, copy.invalidTime, token, { reply_markup: leadFormKeyboard(language, 'time', user) });
    return true;
  }
  pending.data.preferredTime = preferredTime;
  await sendLeadReview(user, pending, token, language);
  return true;
}

function oneColumnReplyKeyboard(options, cancelText, placeholder) {
  return {
    keyboard: [...options.map((text) => [{ text }]), [{ text: cancelText }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: cleanText(placeholder, 64),
  };
}

function viewingDateValue(value, copy, language) {
  const index = copy.dateOptions.indexOf(value);
  if (index < 0 || index > 2) return value;
  const date = new Date();
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
  if (index === 2) {
    const daysUntilSaturday = date.getDay() === 0 ? 6 : (6 - date.getDay() + 7) % 7;
    const saturday = new Date(date);
    saturday.setDate(date.getDate() + daysUntilSaturday);
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);
    const formatter = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
    return value + ' (' + formatter.format(saturday) + '–' + formatter.format(sunday) + ')';
  }
  if (index === 1) date.setDate(date.getDate() + 1);
  const formatted = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return value + ' (' + formatted + ')';
}

function viewingKeyboard(language, step) {
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  if (step === 'date') return oneColumnReplyKeyboard(copy.dateOptions, copy.cancel, copy.askDate);
  if (step === 'time') return oneColumnReplyKeyboard(copy.timeOptions, copy.cancel, copy.askTime);
  if (step === 'confirm') return oneColumnReplyKeyboard([copy.confirm, copy.editDate, copy.editTime], copy.cancel, copy.review);
  return oneColumnReplyKeyboard([], copy.cancel, step === 'custom_time' ? copy.askCustomTime : copy.askCustom);
}

function viewingReviewText(copy, property, pending, language) {
  const labels = copy.reviewLabels;
  const title = localizedExact(property && property.title, language) || (property && property.reference) || '';
  return [copy.review, '', labels[0] + ': ' + title, labels[1] + ': ' + cleanText(pending.data.date, 160), labels[2] + ': ' + cleanText(pending.data.time, 160)].join('\n');
}

async function sendViewingReview(user, pending, property, token, language) {
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  pending.step = 'confirm';
  scheduleSave();
  await sendMessage(user.chatId, viewingReviewText(copy, property, pending, language), token, { reply_markup: viewingKeyboard(language, 'confirm') });
}

async function startViewingForm(user, record, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  user.pendingAction = { type: 'viewing_form', propertyId: record.id, step: 'date', data: {}, createdAt: new Date().toISOString() };
  scheduleSave();
  const title = localizedExact(record.title, language) || record.reference || '';
  await sendMessage(user.chatId, [title ? '🏠 ' + title : '', copy.askDate].filter(Boolean).join('\n\n'), token, { reply_markup: viewingKeyboard(language, 'date') });
}

async function handleViewingFormMessage(message, user, token) {
  const pending = user.pendingAction;
  if (!pending || pending.type !== 'viewing_form') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  const property = data.objects.find((item) => item.id === pending.propertyId && item.status === 'active');
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!property) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.unavailable, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  if (text === copy.cancel) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.cancelled, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  pending.data = pending.data && typeof pending.data === 'object' ? pending.data : {};
  if (pending.step === 'date') {
    const optionIndex = copy.dateOptions.indexOf(text);
    if (optionIndex < 0) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: viewingKeyboard(language, 'date') });
      return true;
    }
    if (optionIndex === 3) {
      pending.step = 'custom';
      scheduleSave();
      await sendMessage(user.chatId, copy.askCustom, token, { reply_markup: viewingKeyboard(language, 'custom') });
      return true;
    }
    pending.data.date = viewingDateValue(text, copy, language);
    if (pending.editing === 'date' && pending.data.time) {
      await sendViewingReview(user, pending, property, token, language);
      return true;
    }
    pending.step = 'time';
    scheduleSave();
    await sendMessage(user.chatId, copy.askTime, token, { reply_markup: viewingKeyboard(language, 'time') });
    return true;
  }
  if (pending.step === 'time') {
    const optionIndex = copy.timeOptions.indexOf(text);
    if (optionIndex < 0) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: viewingKeyboard(language, 'time') });
      return true;
    }
    if (optionIndex === 3) {
      pending.step = 'custom_time';
      scheduleSave();
      await sendMessage(user.chatId, copy.askCustomTime, token, { reply_markup: viewingKeyboard(language, 'custom_time') });
      return true;
    }
    pending.data.time = text;
    await sendViewingReview(user, pending, property, token, language);
    return true;
  }
  if (pending.step === 'custom' || pending.step === 'custom_time') {
    if (text.length < 3) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: viewingKeyboard(language, pending.step) });
      return true;
    }
    if (pending.step === 'custom') {
      pending.data.date = text;
      pending.data.time = copy.asSpecified;
    } else {
      pending.data.time = text;
    }
    await sendViewingReview(user, pending, property, token, language);
    return true;
  }
  if (pending.step === 'confirm') {
    const editStep = text === copy.editDate ? 'date' : text === copy.editTime ? 'time' : '';
    if (editStep) {
      pending.step = editStep;
      pending.editing = editStep;
      scheduleSave();
      const prompt = editStep === 'date' ? copy.askDate : copy.askTime;
      await sendMessage(user.chatId, prompt, token, { reply_markup: viewingKeyboard(language, editStep) });
      return true;
    }
    if (text === copy.restart) {
      pending.step = 'date';
      pending.data = {};
      pending.editing = '';
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      await sendMessage(user.chatId, copy.askDate, token, { reply_markup: viewingKeyboard(language, 'date') });
      return true;
    }
    if (text !== copy.confirm) {
      await sendMessage(user.chatId, viewingReviewText(copy, property, pending, language), token, { reply_markup: viewingKeyboard(language, 'confirm') });
      return true;
    }
    const details = [
      propertyRequestText(property, language, 'viewing'),
      copy.reviewLabels[1] + ': ' + cleanText(pending.data.date, 160),
      copy.reviewLabels[2] + ': ' + cleanText(pending.data.time, 160),
    ].join('\n');
    user.pendingAction = null;
    createInquiry(user, details, { type: 'viewing', propertyId: property.id, sourceMessage: message });
    recordPropertyEvent(property.id, 'viewings');
    saveDataNow();
    await sendMessage(user.chatId, [copy.success, '🏠 ' + (localizedExact(property.title, language) || property.reference || '')].filter(Boolean).join('\n\n'), token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  return false;
}

function selectionKeyboard(language, step) {
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  if (step === 'deal') return oneColumnReplyKeyboard(copy.dealOptions, copy.cancel, copy.askDeal);
  if (step === 'location') return oneColumnReplyKeyboard([copy.anyLocation], copy.cancel, copy.askLocation);
  if (step === 'budget') return oneColumnReplyKeyboard([copy.noBudget], copy.cancel, copy.askBudget);
  if (step === 'bedrooms') return oneColumnReplyKeyboard(copy.bedroomOptions, copy.cancel, copy.askBedrooms);
  return oneColumnReplyKeyboard([copy.confirm, copy.editDeal, copy.editLocation, copy.editBudget, copy.editBedrooms], copy.cancel, copy.review);
}

function selectionReviewText(copy, pending) {
  const values = [pending.data.deal, pending.data.location, pending.data.budget, pending.data.bedrooms];
  return [copy.review, '', ...copy.labels.map((label, index) => label + ': ' + cleanText(values[index], 200))].join('\n');
}

async function sendSelectionReview(user, pending, token, language) {
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  pending.step = 'confirm';
  pending.editing = '';
  scheduleSave();
  await sendMessage(user.chatId, selectionReviewText(copy, pending), token, { reply_markup: selectionKeyboard(language, 'confirm') });
}

async function startSelectionForm(user, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  user.pendingAction = { type: 'property_selection', step: 'deal', data: {}, createdAt: new Date().toISOString() };
  scheduleSave();
  await sendMessage(user.chatId, copy.intro + '\n\n' + copy.askDeal, token, { reply_markup: selectionKeyboard(language, 'deal') });
}

async function handleSelectionFormMessage(message, user, token) {
  const pending = user.pendingAction;
  if (!pending || pending.type !== 'property_selection') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text === copy.cancel) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.cancelled, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  pending.data = pending.data && typeof pending.data === 'object' ? pending.data : {};
  if (pending.step === 'deal') {
    if (!copy.dealOptions.includes(text)) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: selectionKeyboard(language, 'deal') });
      return true;
    }
    pending.data.deal = text;
    if (pending.editing === 'deal') {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    pending.step = 'location';
    scheduleSave();
    await sendMessage(user.chatId, copy.askLocation, token, { reply_markup: selectionKeyboard(language, 'location') });
    return true;
  }
  if (pending.step === 'location' || pending.step === 'budget') {
    if (text.length < 2) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: selectionKeyboard(language, pending.step) });
      return true;
    }
    const completedStep = pending.step;
    pending.data[completedStep] = text;
    if (pending.editing === completedStep) {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    pending.step = pending.step === 'location' ? 'budget' : 'bedrooms';
    scheduleSave();
    const prompt = pending.step === 'budget' ? copy.askBudget : copy.askBedrooms;
    await sendMessage(user.chatId, prompt, token, { reply_markup: selectionKeyboard(language, pending.step) });
    return true;
  }
  if (pending.step === 'bedrooms') {
    if (!copy.bedroomOptions.includes(text)) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: selectionKeyboard(language, 'bedrooms') });
      return true;
    }
    pending.data.bedrooms = text;
    if (pending.editing === 'bedrooms') {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    await sendSelectionReview(user, pending, token, language);
    return true;
  }
  if (pending.step === 'confirm') {
    const editStep = text === copy.editDeal ? 'deal'
      : text === copy.editLocation ? 'location'
        : text === copy.editBudget ? 'budget'
          : text === copy.editBedrooms ? 'bedrooms'
            : '';
    if (editStep) {
      pending.step = editStep;
      pending.editing = editStep;
      scheduleSave();
      const prompt = editStep === 'deal' ? copy.askDeal : editStep === 'location' ? copy.askLocation : editStep === 'budget' ? copy.askBudget : copy.askBedrooms;
      await sendMessage(user.chatId, prompt, token, { reply_markup: selectionKeyboard(language, editStep) });
      return true;
    }
    if (text === copy.restart) {
      pending.step = 'deal';
      pending.data = {};
      pending.editing = '';
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      await sendMessage(user.chatId, copy.askDeal, token, { reply_markup: selectionKeyboard(language, 'deal') });
      return true;
    }
    if (text !== copy.confirm) {
      await sendMessage(user.chatId, selectionReviewText(copy, pending), token, { reply_markup: selectionKeyboard(language, 'confirm') });
      return true;
    }
    const selection = {
      deal: cleanText(pending.data.deal, 200),
      location: cleanText(pending.data.location, 200),
      budget: cleanText(pending.data.budget, 200),
      bedrooms: cleanText(pending.data.bedrooms, 200),
    };
    const inquiryText = selectionReviewText(copy, pending).replace(copy.review, copy.summaryTitle).trim();
    user.pendingAction = null;
    createInquiry(user, inquiryText, { type: 'selection', selection, sourceMessage: message });
    saveDataNow();
    await sendMessage(user.chatId, copy.success, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  return false;
}

async function restartExpiredAction(user, token) {
  const action = user && user.expiredAction;
  if (!action) return false;
  const language = user.preferredLanguage || 'ru';
  user.expiredAction = null;
  scheduleSave();
  const property = action.propertyId
    ? data.objects.find((item) => item.id === action.propertyId && ['active', 'reserved'].includes(item.status))
    : null;
  if (action.type === 'selection') {
    await startSelectionForm(user, token);
    return true;
  }
  if (action.type === 'lead') {
    await startLeadForm(user, token, { propertyId: property ? property.id : '' });
    return true;
  }
  if (action.type === 'viewing' && property && property.status === 'active') {
    await startViewingForm(user, property, token);
    return true;
  }
  if (action.type === 'property_question' && property) {
    const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    user.pendingAction = { type: 'question', propertyId: property.id, createdAt: new Date().toISOString() };
    scheduleSave();
    await sendMessage(user.chatId, copy.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + copy.cancel, callback_data: 'property:cancel:' + property.id }]] },
    });
    return true;
  }
  if (action.type === 'manager_question') {
    const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    user.pendingAction = { type: 'manager_question', createdAt: new Date().toISOString() };
    scheduleSave();
    await sendMessage(user.chatId, copy.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + copy.cancel, callback_data: 'contact:cancel' }]] },
    });
    return true;
  }
  await sendMessage(user.chatId, (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).propertyUnavailable, token, { reply_markup: menuKeyboard(language) });
  return true;
}

async function sendWelcome(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  const greeting = fillTemplate(languageMessages(language).greeting, user) + '\n\n' + MENU_HINTS[language];
  const keyboard = menuKeyboard(language);
  const image = data.welcomeImages[language];
  if (imageExists(image)) {
    if (greeting.length <= 1000) {
      await sendPhotoMessage(chatId, image, greeting, token, keyboard);
    } else {
      await sendPhotoMessage(chatId, image, '', token, null);
      await sendMessage(chatId, greeting, token, { reply_markup: keyboard });
    }
  } else {
    await sendMessage(chatId, greeting, token, { reply_markup: keyboard });
  }
}

async function sendMainMenu(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  await sendMessage(chatId, MAIN_MENU_TEXT[language] || MAIN_MENU_TEXT.ru, token, { reply_markup: menuKeyboard(language) });
}

async function sendMoreMenu(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const prompt = language === 'en'
    ? 'More useful sections:'
    : language === 'es'
      ? 'Más secciones útiles:'
      : 'Дополнительные разделы:';
  await sendUiMessage(chatId, user, prompt, token, {
    reply_markup: {
      inline_keyboard: [
        [{ text: labels.about, callback_data: 'nav:about' }],
        [{ text: labels.help, callback_data: 'nav:help' }],
        [{ text: labels.language, callback_data: 'nav:language' }],
        [{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }],
      ],
    },
  });
}

async function sendLanguagePicker(chatId, token, currentLanguage = '') {
  const language = ['ru', 'en', 'es'].includes(currentLanguage) ? currentLanguage : 'ru';
  const languageButton = (language, flag) => ({
    text: (currentLanguage === language ? '✓ ' : '') + flag + ' ' + LANGUAGE_NAMES[language],
    callback_data: 'language:' + language,
  });
  await sendMessage(
    chatId,
    LANGUAGE_PICKER_TEXT[language] || LANGUAGE_PICKER_TEXT.ru,
    token,
    {
      reply_markup: {
        inline_keyboard: [
          [languageButton('ru', '🇷🇺')],
          [languageButton('en', '🇬🇧')],
          [languageButton('es', '🇪🇸')],
        ],
      },
    }
  );
}

async function configureBotCommands(token) {
  const commandsFor = (language) => Object.entries(BOT_COMMAND_DESCRIPTIONS[language] || BOT_COMMAND_DESCRIPTIONS.en)
    .map(([command, description]) => ({ command, description }));
  const commandSets = {
    default: commandsFor('en'),
    ru: commandsFor('ru'),
    en: commandsFor('en'),
    es: commandsFor('es'),
  };
  for (const [language, commands] of Object.entries(commandSets)) {
    const payload = { commands };
    if (language !== 'default') payload.language_code = language;
    await telegramRequest(token, 'setMyCommands', payload);
  }
}

function publicRuntime() {
  return {
    status: runtime.status,
    lastError: runtime.lastError,
    lastErrorAt: runtime.lastErrorAt,
    lastSuccessfulContactAt: runtime.lastSuccessfulContactAt,
    consecutiveFailures: runtime.consecutiveFailures,
    nextRetryAt: runtime.nextRetryAt,
    pollingStartedAt: runtime.pollingStartedAt,
    broadcastRunning: runtime.broadcastRunning,
  };
}

function normalizeUser(from, chatId, countMessage = true) {
  const id = String(from.id);
  const previous = data.users[id] || {};
  const user = {
    id,
    chatId,
    firstName: from.first_name || '',
    lastName: from.last_name || '',
    username: from.username || '',
    languageCode: from.language_code || '',
    preferredLanguage: previous.preferredLanguage || '',
    contactName: previous.contactName || '',
    phone: previous.phone || '',
    preferredContactTime: previous.preferredContactTime || '',
    firstSeenAt: previous.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    messages: Number(previous.messages || 0) + (countMessage ? 1 : 0),
    blocked: Boolean(previous.blocked),
    tags: Array.isArray(previous.tags) ? previous.tags : [],
    note: previous.note || '',
    favorites: Array.isArray(previous.favorites) ? previous.favorites : [],
    catalogMessageIds: Array.isArray(previous.catalogMessageIds) ? previous.catalogMessageIds : [],
    uiMessageIds: Array.isArray(previous.uiMessageIds) ? previous.uiMessageIds : [],
    galleryMessageIds: Array.isArray(previous.galleryMessageIds) ? previous.galleryMessageIds : [],
    lastCallback: previous.lastCallback && typeof previous.lastCallback === 'object' ? previous.lastCallback : null,
    lastInboundMessageId: previous.lastInboundMessageId != null && Number.isFinite(Number(previous.lastInboundMessageId)) ? Number(previous.lastInboundMessageId) : null,
    catalogContext: previous.catalogContext && typeof previous.catalogContext === 'object' ? {
      mode: ['all', 'favorites'].includes(previous.catalogContext.mode) ? previous.catalogContext.mode : 'all',
      page: Math.max(0, Number(previous.catalogContext.page) || 0),
    } : { mode: 'all', page: 0 },
    pendingAction: previous.pendingAction && typeof previous.pendingAction === 'object' ? previous.pendingAction : null,
    expiredAction: previous.expiredAction && typeof previous.expiredAction === 'object' ? previous.expiredAction : null,
    pendingStartPayload: cleanText(previous.pendingStartPayload, 100),
    activity: Array.isArray(previous.activity) ? previous.activity : [],
  };
  data.users[id] = user;
  return user;
}

function createInquiry(user, text, context = {}) {
  const now = new Date().toISOString();
  const inquiry = {
    id: crypto.randomUUID(),
    userId: String(user.id),
    chatId: String(user.chatId),
    language: ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'ru',
    text: cleanText(text, 4000),
    type: ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(context.type) ? context.type : 'general',
    propertyId: cleanText(context.propertyId, 100),
    sourceMessageId: Number.isFinite(Number(context.sourceMessage && context.sourceMessage.message_id)) ? Number(context.sourceMessage.message_id) : null,
    lead: context.lead && typeof context.lead === 'object' ? {
      name: cleanText(context.lead.name, 120),
      phone: cleanText(context.lead.phone, 80),
      preferredTime: cleanText(context.lead.preferredTime, 160),
    } : null,
    selection: context.selection && typeof context.selection === 'object' ? {
      deal: cleanText(context.selection.deal, 200),
      location: cleanText(context.selection.location, 200),
      budget: cleanText(context.selection.budget, 200),
      bedrooms: cleanText(context.selection.bedrooms, 200),
    } : null,
    status: 'new',
    note: '',
    replies: [],
    createdAt: now,
    updatedAt: now,
  };
  data.inquiries.unshift(inquiry);
  data.inquiries = data.inquiries.slice(0, 5000);
  recordDaily('inquiry');
  scheduleSave();
  if (context.sourceMessage && !context.sourceMessage.text) {
    void copyUserMessageToAdministrator(context.sourceMessage, data.config.botToken)
      .then(() => notifyAdministrator(inquiry, user));
  } else {
    void notifyAdministrator(inquiry, user);
  }
  return inquiry;
}

function administratorTargetLines(user, inquiryId = '', sourceMessageId = null) {
  const lines = [
    '',
    '↩️ Ответьте на это сообщение, чтобы написать пользователю от имени бота.',
    'Получатель ID: ' + String(user.chatId),
  ];
  if (inquiryId) lines.push('Обращение ID: ' + inquiryId);
  if (Number.isFinite(Number(sourceMessageId))) lines.push('Сообщение пользователя ID: ' + Number(sourceMessageId));
  return lines;
}

async function notifyAdministratorAction(user, title, details = '', inquiryId = '', sourceMessageId = null) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken || !user || !user.chatId || String(user.chatId) === adminChatId) return false;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';
  const username = user.username ? ' (@' + user.username + ')' : '';
  const notification = [
    'Действие пользователя',
    '',
    'Пользователь: ' + name + username,
    'ID: ' + user.id,
    'Язык: ' + (LANGUAGE_NAMES[user.preferredLanguage] || 'не выбран'),
    'Действие: ' + cleanText(title, 160),
  ];
  if (details) notification.push('', cleanText(details, 4000));
  notification.push(...administratorTargetLines(user, inquiryId, sourceMessageId));
  try {
    await sendMessage(adminChatId, notification.join('\n'), data.config.botToken, { track: false });
    if (!data.config.adminNotificationVerifiedAt) {
      data.config.adminNotificationVerifiedAt = new Date().toISOString();
      scheduleSave();
    }
    return true;
  } catch (error) {
    data.config.adminNotificationVerifiedAt = '';
    recordError('Уведомление администратору', error);
    return false;
  }
}

async function notifyAdministrator(inquiry, user) {
  const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  const propertyLine = property
    ? 'Объект: ' + (localized(property.title, inquiry.language) || property.reference || property.id)
    : '';
  return notifyAdministratorAction(user, 'Новое обращение', [
    'Тип: ' + ({ question: 'вопрос по объекту', interest: 'интерес к объекту', selection: 'подбор недвижимости', viewing: 'запись на просмотр', lead: 'заявка на звонок', general: 'сообщение' }[inquiry.type] || 'сообщение'),
    propertyLine,
    inquiry.text,
  ].filter(Boolean).join('\n'), inquiry.id, inquiry.sourceMessageId);
}

async function copyUserMessageToAdministrator(message, token) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !message || !message.chat || String(message.chat.id) === adminChatId) return false;
  try {
    await telegramRequest(token, 'copyMessage', {
      chat_id: adminChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
    return true;
  } catch (error) {
    recordError('Копирование сообщения администратору', error);
    return false;
  }
}

function messageSummary(message) {
  if (!message) return 'Сообщение';
  if (message.text) return cleanText(message.text, 4000);
  if (message.caption) return cleanText(message.caption, 4000);
  if (message.photo) return 'Фотография';
  if (message.video) return 'Видео';
  if (message.voice) return 'Голосовое сообщение';
  if (message.audio) return 'Аудиофайл';
  if (message.document) return 'Документ' + (message.document.file_name ? ': ' + cleanText(message.document.file_name, 160) : '');
  if (message.location) return 'Геолокация';
  if (message.contact) return 'Контакт';
  if (message.sticker) return 'Стикер';
  return 'Нетекстовое сообщение';
}

function reactionInfo(reaction) {
  if (!reaction || typeof reaction !== 'object') return null;
  if (reaction.type === 'emoji' && reaction.emoji) {
    return { key: 'emoji:' + reaction.emoji, label: cleanText(reaction.emoji, 20) };
  }
  if (reaction.type === 'custom_emoji' && reaction.custom_emoji_id) {
    return { key: 'custom:' + reaction.custom_emoji_id, label: '✦ пользовательский эмодзи' };
  }
  if (reaction.type === 'paid') return { key: 'paid', label: '⭐' };
  return null;
}

async function handleMessageReaction(change) {
  if (!change || !change.chat || !change.user) return;
  const user = normalizeUser(change.user, change.chat.id, false);
  const oldItems = (Array.isArray(change.old_reaction) ? change.old_reaction : []).map(reactionInfo).filter(Boolean);
  const newItems = (Array.isArray(change.new_reaction) ? change.new_reaction : []).map(reactionInfo).filter(Boolean);
  const oldKeys = new Set(oldItems.map((item) => item.key));
  const newKeys = new Set(newItems.map((item) => item.key));
  const added = newItems.filter((item) => !oldKeys.has(item.key));
  const removed = oldItems.filter((item) => !newKeys.has(item.key));
  if (!added.length && !removed.length) return;

  user.activity = Array.isArray(user.activity) ? user.activity : [];
  const target = [...user.activity].reverse().find((entry) => entry.direction === 'out' && (
    Number(entry.messageId) === Number(change.message_id) ||
    (Array.isArray(entry.messageIds) && entry.messageIds.some((messageId) => Number(messageId) === Number(change.message_id)))
  ));
  if (target) {
    target.reactions = newItems.map((item) => item.label);
    target.reactionUpdatedAt = new Date(Number(change.date || 0) * 1000 || Date.now()).toISOString();
  }

  let reactionAction = 'changed';
  let actionText;
  if (added.length && removed.length) {
    actionText = 'Изменил реакцию: ' + removed.map((item) => item.label).join(' ') + ' → ' + added.map((item) => item.label).join(' ');
  } else if (added.length) {
    reactionAction = 'added';
    actionText = 'Поставил реакцию ' + added.map((item) => item.label).join(' ');
  } else {
    reactionAction = 'removed';
    actionText = 'Убрал реакцию ' + removed.map((item) => item.label).join(' ');
  }
  const targetText = target && target.text ? target.text : 'Сообщение №' + String(change.message_id);
  recordActivity(user, 'in', actionText, 'reaction', {
    targetMessageId: change.message_id,
    reactions: newItems.map((item) => item.label),
    reactionAction,
    targetText,
  });
  if (added.length) {
    data.stats.reactionsReceived = Number(data.stats.reactionsReceived || 0) + added.length;
    recordDaily('reaction', '', added.length);
  }
  data.stats.lastUpdateAt = new Date().toISOString();
  scheduleSave();
  void notifyAdministratorAction(user, actionText, 'На сообщение: ' + targetText);
}

function administratorReplyTarget(message) {
  const replied = message && message.reply_to_message;
  const source = String(replied && (replied.text || replied.caption) || '');
  const recipient = source.match(/Получатель ID:\s*(-?\d{4,20})/);
  const inquiry = source.match(/Обращение ID:\s*([A-Za-z0-9-]{8,100})/);
  const sourceMessage = source.match(/Сообщение пользователя ID:\s*(\d{1,20})/);
  return recipient ? { chatId: recipient[1], inquiryId: inquiry ? inquiry[1] : '', sourceMessageId: sourceMessage ? Number(sourceMessage[1]) : null } : null;
}

async function handleAdministratorReply(message, token) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !message || !message.chat || String(message.chat.id) !== adminChatId) return false;
  const target = administratorReplyTarget(message);
  if (!target) return false;
  const user = userByChatId(target.chatId);
  try {
    const language = user && user.preferredLanguage || 'ru';
    const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
    const replyParameters = Number.isFinite(Number(target.sourceMessageId))
      ? { message_id: Number(target.sourceMessageId), allow_sending_without_reply: true }
      : null;
    let copied;
    let sentCount = 1;
    if (message.text) {
      copied = await sendMessage(target.chatId, header + '\n\n' + cleanText(message.text, 3800), token, {
        track: false,
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
    } else {
      await sendMessage(target.chatId, header, token, {
        track: false,
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
      copied = await telegramRequest(token, 'copyMessage', {
        chat_id: target.chatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      });
      sentCount = 2;
    }
    data.stats.messagesSent += sentCount;
    for (let index = 0; index < sentCount; index += 1) recordDaily('sent');
    recordActivity(user, 'out', messageSummary(message), 'admin_reply', { messageId: copied && copied.message_id });
    if (target.inquiryId) {
      const inquiry = data.inquiries.find((item) => item.id === target.inquiryId);
      if (inquiry) {
        inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
        inquiry.replies.push({ id: crypto.randomUUID(), text: messageSummary(message), source: 'telegram', createdAt: new Date().toISOString() });
        inquiry.replies = inquiry.replies.slice(-50);
        if (inquiry.status === 'new') inquiry.status = 'in_progress';
        inquiry.updatedAt = new Date().toISOString();
      }
    }
    saveDataNow();
    await sendMessage(adminChatId, '✅ Сообщение отправлено пользователю' + (user ? ' ' + ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.id) : '') + '.', token, { track: false });
  } catch (error) {
    if (user && userUnavailableError(error)) user.blocked = true;
    recordError('Ответ администратора из Telegram', error);
    await sendMessage(adminChatId, '❌ Не удалось отправить сообщение: ' + error.message, token, { track: false }).catch(() => {});
  }
  return true;
}

function findRule(text, language) {
  const input = text.toLocaleLowerCase('ru-RU').trim();
  return [...data.rules].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).find((rule) => {
    if (!rule.enabled || !rule.trigger || ![language, 'all'].includes(rule.language || 'ru')) return false;
    const trigger = String(rule.trigger).toLocaleLowerCase('ru-RU').trim();
    if (rule.type === 'exact') return input === trigger;
    if (rule.type === 'starts') return input.startsWith(trigger);
    return input.includes(trigger);
  });
}

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

function contentButtons(record, language, user, kind = 'promotion', catalog = null) {
  const rows = [];
  const action = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if (kind === 'property') {
    const isFavorite = Boolean(user && Array.isArray(user.favorites) && user.favorites.includes(record.id));
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

function catalogRecords(user, mode = 'all') {
  const language = user.preferredLanguage || 'ru';
  const active = data.objects.filter((record) => ['active', 'reserved'].includes(record.status) && propertyReadyForLanguage(record, language));
  if (mode !== 'favorites') return active;
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
      if (image.telegramFileId) {
        try {
          result = await telegramRequest(token, 'editMessageMedia', {
            chat_id: chatId,
            message_id: messageId,
            media: { type: 'photo', media: image.telegramFileId, caption },
            reply_markup: markup,
          });
        } catch {
          image.telegramFileId = '';
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
          image.telegramFileId = result.photo[result.photo.length - 1].file_id || '';
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
  });
  if (edited) return true;
  await sendCatalogPage(chatId, user, token, safePage, mode);
  if (message && message.message_id) {
    try { await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: message.message_id }); } catch {}
  }
  return true;
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
  const rows = base && Array.isArray(base.inline_keyboard) ? [...base.inline_keyboard] : [];
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

async function sendPromotionPage(chatId, user, token, page = 0) {
  const language = user.preferredLanguage || 'ru';
  const records = data.promotions.filter((record) => {
    return promotionIsActive(record) && (localizedExact(record.title, language) || localizedExact(record.text, language));
  }).slice(0, 12);
  if (!records.length) {
    await clearCatalogMessages(chatId, user, token);
    const empty = EMPTY_STATE_TEXT[language] || EMPTY_STATE_TEXT.ru;
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const manager = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    await sendUiMessage(chatId, user, empty.promotions, token, { reply_markup: { inline_keyboard: [
      [{ text: '🏘 ' + navigation.browse, callback_data: 'catalog:all:0' }],
      [{ text: manager.question, callback_data: 'contact:question' }],
    ] } });
    return true;
  }
  const safePage = Math.min(Math.max(0, Number(page) || 0), records.length - 1);
  const record = records[safePage];
  const title = localizedExact(record.title, language);
  const body = localizedExact(record.text, language);
  const caption = [('🔥 ' + title).trim(), body, (safePage + 1) + ' / ' + records.length].filter(Boolean).join('\n\n').slice(0, 1000);
  const markup = promotionButtons(record, language, safePage, records.length);
  const previousMessageIds = Array.isArray(user.catalogMessageIds) ? [...user.catalogMessageIds] : [];
  let message;
  const image = recordImages(record, language)[0];
  if (imageExists(image)) message = await sendPhotoMessage(chatId, image, caption, token, markup);
  else message = await sendMessage(chatId, caption, token, markup ? { reply_markup: markup } : {});
  const nextIds = message && Number.isFinite(Number(message.message_id)) ? [Number(message.message_id)] : [];
  user.catalogMessageIds = nextIds;
  scheduleSave();
  await deleteCatalogMessages(chatId, previousMessageIds.filter((messageId) => !nextIds.includes(Number(messageId))), token);
  return true;
}

async function sendPromotions(chatId, user, token) {
  return sendPromotionPage(chatId, user, token, 0);
}

async function sendContacts(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
  const contact = data.contacts || defaultData.contacts;
  const phones = String(contact.phone || '').match(/\+?\d[\d\s().-]{5,}\d/g) || [];
  const lines = [localizedExact(contact.text, language, 3200) || copy.intro];
  const managerName = cleanText(contact.managerName, 160);
  const email = cleanText(contact.email, 254);
  if (managerName) lines.push('👨‍💼 ' + managerName);
  if (phones.length) lines.push(copy.tapPhone);
  for (const phone of phones) lines.push('☎️ ' + cleanText(phone, 80));
  if (email) lines.push('✉️ ' + email);
  const text = lines.filter(Boolean).join('\n\n');
  const entities = [];
  for (const phone of phones) {
    const display = cleanText(phone, 80);
    const offset = text.lastIndexOf(display);
    if (offset >= 0) entities.push({ type: 'phone_number', offset, length: display.length });
  }
  if (email) {
    const offset = text.lastIndexOf(email);
    if (offset >= 0) entities.push({ type: 'email', offset, length: email.length });
  }
  const buttons = [];
  const site = validHttpUrl(contact.website);
  const map = validHttpUrl(contact.mapUrl);
  const whatsapp = contact.whatsappEnabled === false ? '' : whatsappContactUrl(contact.whatsapp, phones[0]);
  const telegramName = String(contact.telegram || '').replace(/^@/, '');
  const telegram = /^[A-Za-z0-9_]{5,}$/.test(telegramName)
    ? 'https://t.me/' + telegramName
    : validHttpUrl(contact.telegram);
  if (whatsapp) buttons.push([{ text: '🟢 ' + copy.whatsapp, url: whatsapp }]);
  if (telegram) buttons.push([{ text: '✈️ ' + copy.telegram, url: telegram }]);
  if (site) buttons.push([{ text: '🌐 ' + copy.website, url: site }]);
  if (map) buttons.push([{ text: '📍 ' + copy.map, url: map }]);
  buttons.push([{ text: copy.request, callback_data: 'contact:lead' }]);
  buttons.push([{ text: copy.question, callback_data: 'contact:question' }]);
  buttons.push([{ text: '🏠 ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).mainMenu, callback_data: 'nav:menu' }]);
  await sendUiMessage(chatId, user, text, token, {
    ...(entities.length ? { entities } : {}),
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleContactCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
  if (action !== 'cancel') await acknowledgeCallback(query, token);
  if (action === 'lead') return startLeadForm(user, token);
  if (action === 'question') {
    user.pendingAction = { type: 'manager_question', createdAt: new Date().toISOString() };
    scheduleSave();
    await sendMessage(chatId, copy.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + copy.cancel, callback_data: 'contact:cancel' }]] },
    });
    return;
  }
  if (action === 'cancel') {
    if (user.pendingAction && user.pendingAction.type === 'manager_question') user.pendingAction = null;
    scheduleSave();
    await acknowledgeCallback(query, token, (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).cancelled);
  }
}

function aboutPreview(text) {
  const value = cleanText(text, 4000);
  if (value.length <= 850) return value;
  const paragraphs = value.split(/\n\s*\n/).filter(Boolean);
  let preview = '';
  for (const paragraph of paragraphs) {
    if (preview && preview.length + paragraph.length + 2 > 850) break;
    preview += (preview ? '\n\n' : '') + paragraph;
  }
  return preview || shortenedText(value, 850);
}

async function sendAbout(chatId, user, token, full = false) {
  const language = user.preferredLanguage || 'ru';
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const source = fillTemplate(data.config.menu[language].about, user);
  const text = full ? source : aboutPreview(source);
  const rows = [];
  if (!full && text.length < source.length) rows.push([{ text: '📖 ' + navigation.readMore, callback_data: 'about:full' }]);
  rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).contacts, callback_data: 'about:contact' }]);
  rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
  await sendUiMessage(chatId, user, text, token, { reply_markup: { inline_keyboard: rows } });
}

async function sendHelp(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const messages = languageMessages(language);
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const text = fillTemplate(messages.help, user);
  await sendUiMessage(chatId, user, text, token, { reply_markup: { inline_keyboard: [
    [{ text: labels.objects, callback_data: 'catalog:all:0' }],
    [{ text: labels.selection, callback_data: 'selection:start' }],
    [{ text: labels.contacts, callback_data: 'contact:question' }],
    [{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }],
  ] } });
}

async function handleNavigationCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (action === 'menu') return sendMainMenu(chatId, user, token);
  if (action === 'about') return sendAbout(chatId, user, token);
  if (action === 'help') return sendHelp(chatId, user, token);
  if (action === 'language') return sendLanguagePicker(chatId, token, user.preferredLanguage || '');
  if (action === 'close' && query.message && query.message.message_id) {
    user.uiMessageIds = (Array.isArray(user.uiMessageIds) ? user.uiMessageIds : []).filter((messageId) => Number(messageId) !== Number(query.message.message_id));
    scheduleSave();
    try {
      await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: query.message.message_id });
    } catch {
      // The action is still complete when an old message can no longer be deleted.
    }
  }
}

async function handleSelectionCallback(query, token) {
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  await startSelectionForm(user, token);
}

async function handleAboutCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (action === 'contact') return sendContacts(chatId, user, token);
  if (action === 'full') return sendAbout(chatId, user, token, true);
}

async function handlePromotionCallback(query, token) {
  const rawPage = String(query.data || '').split(':')[1] || '0';
  if (rawPage === 'none') return acknowledgeCallback(query, token);
  const page = Number(rawPage);
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  await sendPromotionPage(chatId, user, token, page);
}

async function handleLanguageCallback(query, token) {
  const language = String(query.data || '').replace('language:', '');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  if (!LANGUAGE_NAMES[language]) {
    const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    return acknowledgeCallback(query, token, copy.stale);
  }
  user.preferredLanguage = language;
  user.pendingAction = null;
  user.expiredAction = null;
  data.stats.lastUpdateAt = new Date().toISOString();
  scheduleSave();
  void notifyAdministratorAction(user, 'Сменил язык', 'Выбран язык: ' + LANGUAGE_NAMES[language]);

  try {
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: LANGUAGE_SELECTED[language],
    });
  } catch {
    // The language still gets saved if the short-lived callback notification expires.
  }

  if (query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', {
        chat_id: chatId,
        message_id: query.message.message_id,
        text: LANGUAGE_SELECTED[language],
      });
    } catch {
      // A callback can still continue when the original picker is no longer editable.
    }
  }
  await sendWelcome(chatId, user, token);
  await openPendingStartPayload(user, token);
}

async function acknowledgeCallback(query, token, text = '') {
  try {
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: cleanText(text, 180) || undefined,
    });
  } catch {
    // The requested action can still complete when the short callback notification expires.
  }
}

async function handleCatalogCallback(query, token) {
  const parts = String(query.data || '').split(':');
  const mode = parts[1];
  if (mode === 'none') return acknowledgeCallback(query, token);
  if (!['all', 'favorites'].includes(mode)) return acknowledgeCallback(query, token);
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (!user.preferredLanguage) return sendLanguagePicker(chatId, token, '');
  void notifyAdministratorAction(
    user,
    mode === 'favorites' ? 'Листает избранные объекты' : 'Листает каталог объектов',
    'Страница: ' + (Math.max(0, Number(parts[2] || 0)) + 1)
  );
  await showCatalogPageFromCallback(chatId, user, token, Number(parts[2] || 0), mode, query.message);
}

function propertyRequestText(record, language, type) {
  const title = localizedExact(record.title, language) || record.reference || record.id;
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if (type === 'viewing') return copy.requestViewingPrefix + ' ' + title;
  if (type === 'question') return copy.questionPrefix + ' ' + title;
  return copy.interestPrefix + ' ' + title;
}

function catalogContextFromMessage(message, language) {
  const source = String(message && (message.caption || message.text) || '');
  const favoriteHeading = (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
  const position = source.match(/·\s*(\d+)\s*\/\s*(\d+)/);
  return {
    mode: source.includes(favoriteHeading) ? 'favorites' : 'all',
    page: Math.max(0, Number(position && position[1] || 1) - 1),
    totalPages: Math.max(1, Number(position && position[2] || 1)),
    heading: source.includes(favoriteHeading) ? favoriteHeading : (MENU_LABELS[language] || MENU_LABELS.ru).objects,
  };
}

function configuredWhatsappUrl() {
  const phone = (String(data.contacts && data.contacts.phone || '').match(/\+?\d[\d\s().-]{5,}\d/) || [])[0] || '';
  return whatsappContactUrl(data.contacts && data.contacts.whatsapp, phone);
}

function propertyManagerMarkup(record, language, returnToCatalog = false) {
  const text = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const rows = [];
  if (record.status === 'reserved') {
    rows.push([{ text: '🔔 ' + text.availability, callback_data: 'property:availability:' + record.id }]);
    rows.push([{ text: '🏘 ' + text.similar, callback_data: 'property:similar:' + record.id }]);
  } else {
    rows.push([{ text: '📞 ' + text.interest, callback_data: 'property:interest:' + record.id }]);
    rows.push([{ text: '📅 ' + text.viewing, callback_data: 'property:viewing:' + record.id }]);
  }
  rows.push([{ text: '❓ ' + text.question, callback_data: 'property:question:' + record.id }]);
  const whatsapp = configuredWhatsappUrl();
  if (whatsapp) rows.push([{ text: '🟢 WhatsApp', url: whatsapp }]);
  rows.push([{ text: '⬅️ ' + navigation.backToCard, callback_data: 'property:' + (returnToCatalog ? 'return' : 'card') + ':' + record.id }]);
  return { inline_keyboard: rows };
}

async function sendSimilarProperty(chatId, user, record, token) {
  const language = user.preferredLanguage || 'ru';
  const candidates = data.objects.filter((item) => item.id !== record.id && item.status === 'active' && propertyReadyForLanguage(item, language));
  const city = localizedExact(record.city, language, 160);
  const district = localizedExact(record.district, language, 160);
  const sourcePrice = Number(record.priceValue) || 0;
  const sourceBedrooms = Number(record.bedrooms) || 0;
  const sourceArea = Number(record.area) || 0;
  const similar = candidates.map((item) => {
    let score = 0;
    if (item.dealType === record.dealType) score += 45;
    if (item.propertyType === record.propertyType) score += 40;
    if (city && localizedExact(item.city, language, 160).toLocaleLowerCase() === city.toLocaleLowerCase()) score += 35;
    if (district && localizedExact(item.district, language, 160).toLocaleLowerCase() === district.toLocaleLowerCase()) score += 20;
    const candidatePrice = Number(item.priceValue) || 0;
    if (sourcePrice && candidatePrice) score += Math.max(0, 25 - Math.round(Math.abs(candidatePrice - sourcePrice) / sourcePrice * 50));
    const candidateBedrooms = Number(item.bedrooms) || 0;
    if (sourceBedrooms && candidateBedrooms) score += Math.max(0, 12 - Math.abs(candidateBedrooms - sourceBedrooms) * 5);
    const candidateArea = Number(item.area) || 0;
    if (sourceArea && candidateArea) score += Math.max(0, 10 - Math.round(Math.abs(candidateArea - sourceArea) / sourceArea * 20));
    return { item, score };
  }).sort((a, b) => b.score - a.score)[0]?.item;
  if (!similar) {
    const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    await sendMessage(chatId, copy.noSimilar, token, { reply_markup: { inline_keyboard: [[{ text: (MENU_LABELS[language] || MENU_LABELS.ru).contacts, callback_data: 'contact:question' }]] } });
    return;
  }
  const heading = '🏘 ' + (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).similarHeading;
  const allRecords = catalogRecords(user, 'all');
  user.catalogContext = { mode: 'all', page: Math.max(0, allRecords.findIndex((item) => item.id === similar.id)) };
  scheduleSave();
  await sendPropertyCard(chatId, user, token, similar, { heading, page: 0, totalPages: 1, mode: 'all' });
}

async function handlePropertyCallback(query, token) {
  const parts = String(query.data || '').split(':');
  const actionName = parts[1];
  const propertyId = parts.slice(2).join(':');
  const record = data.objects.find((item) => item.id === propertyId && ['active', 'reserved'].includes(item.status));
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const text = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if ((!record || !propertyReadyForLanguage(record, language)) && actionName !== 'cancel') {
    await acknowledgeCallback(query, token, text.propertyUnavailable);
    return;
  }
  if (actionName === 'cancel') {
    if (user.pendingAction && user.pendingAction.propertyId === propertyId) user.pendingAction = null;
    scheduleSave();
    await acknowledgeCallback(query, token, text.cancelled);
    if (query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [] },
        });
      } catch {
        // The cancellation is complete even if Telegram no longer allows editing the prompt.
      }
    }
    return;
  }
  if (actionName === 'card') {
    await acknowledgeCallback(query, token);
    if (query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: contentButtons(record, language, user, 'property', catalogContextFromMessage(query.message, language)),
        });
      } catch {
        await sendPropertyCard(chatId, user, token, record, { heading: (MENU_LABELS[language] || MENU_LABELS.ru).objects, page: 0, totalPages: 1, mode: 'all' });
      }
    }
    return;
  }
  if (actionName === 'return') {
    await acknowledgeCallback(query, token);
    let mode = user.catalogContext && user.catalogContext.mode === 'favorites' ? 'favorites' : 'all';
    let records = catalogRecords(user, mode);
    if (!records.some((item) => item.id === record.id)) {
      mode = 'all';
      records = catalogRecords(user, mode);
    }
    const page = Math.max(0, records.findIndex((item) => item.id === record.id));
    await sendCatalogPage(chatId, user, token, page, mode);
    if (query.message && query.message.message_id) {
      try { await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: query.message.message_id }); } catch {}
    }
    return;
  }
  if (actionName === 'next') {
    await acknowledgeCallback(query, token);
    let mode = user.catalogContext && user.catalogContext.mode === 'favorites' ? 'favorites' : 'all';
    let records = catalogRecords(user, mode);
    let currentIndex = records.findIndex((item) => item.id === record.id);
    if (currentIndex < 0) {
      mode = 'all';
      records = catalogRecords(user, mode);
      currentIndex = records.findIndex((item) => item.id === record.id);
    }
    const nextPage = currentIndex >= 0 && records.length ? (currentIndex + 1) % records.length : -1;
    if (nextPage >= 0) await sendCatalogPage(chatId, user, token, nextPage, mode);
    return;
  }
  if (actionName === 'details') {
    recordPropertyEvent(record.id, 'details');
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const rows = [];
    const images = recordImages(record, language);
    if (images.length > 1) rows.push([{ text: '📷 ' + text.gallery + ' (' + images.length + ')', callback_data: 'property:gallery:' + record.id }]);
    const external = validHttpUrl(record.url);
    const map = validHttpUrl(record.mapUrl);
    const share = propertyShareUrl(record, language);
    if (external) rows.push([{ text: '🌐 ' + text.viewWebsite, url: external }]);
    if (map) rows.push([{ text: '📍 ' + text.openMap, url: map }]);
    if (share) rows.push([{ text: '📤 ' + text.share, url: share }]);
    rows.push([{ text: '💬 ' + text.contactManager, callback_data: 'property:manager:' + record.id }]);
    rows.push([{ text: '✕ ' + navigation.close, callback_data: 'nav:close' }]);
    await acknowledgeCallback(query, token);
    await sendUiMessage(chatId, user, objectCaption(record, language, { full: true }), token, { reply_markup: { inline_keyboard: rows } });
    return;
  }
  if (actionName === 'manager') {
    recordPropertyEvent(record.id, 'managerContacts');
    await acknowledgeCallback(query, token);
    const source = String(query.message && (query.message.caption || query.message.text) || '');
    const favoriteHeading = (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
    const isCatalogCard = Boolean(query.message && query.message.caption)
      || source.includes((MENU_LABELS[language] || MENU_LABELS.ru).objects)
      || source.includes(favoriteHeading);
    if (isCatalogCard && query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: query.message.message_id, reply_markup: propertyManagerMarkup(record, language) });
        return;
      } catch {
        // Fall back to a compact service message when the original card cannot be edited.
      }
    }
    const title = localizedExact(record.title, language) || record.reference || '';
    await sendUiMessage(chatId, user, [title, text.managerPrompt].filter(Boolean).join('\n\n'), token, { reply_markup: propertyManagerMarkup(record, language, true) });
    return;
  }
  if (actionName === 'availability') {
    recordPropertyEvent(record.id, 'availability');
    await acknowledgeCallback(query, token);
    const inquiry = propertyRequestText(record, language, 'question') + '\n\n' + text.availability;
    createInquiry(user, inquiry, { type: 'question', propertyId: record.id, sourceMessage: query.message });
    await sendMessage(chatId, [text.received, '🏠 ' + (localizedExact(record.title, language) || record.reference || '')].filter(Boolean).join('\n\n'), token, { reply_markup: menuKeyboard(language) });
    return;
  }
  if (actionName === 'similar') {
    recordPropertyEvent(record.id, 'similar');
    await acknowledgeCallback(query, token);
    await sendSimilarProperty(chatId, user, record, token);
    return;
  }
  if (actionName === 'favorite') {
    const favorites = new Set(Array.isArray(user.favorites) ? user.favorites : []);
    let notice;
    if (favorites.has(record.id)) {
      favorites.delete(record.id);
      notice = text.favoriteRemove;
    } else {
      favorites.add(record.id);
      notice = text.favoriteAdd;
      recordPropertyEvent(record.id, 'favorites');
    }
    user.favorites = Array.from(favorites).slice(0, 500);
    scheduleSave();
    void notifyAdministratorAction(user, favorites.has(record.id) ? 'Добавил объект в избранное' : 'Удалил объект из избранного', localizedExact(record.title, language) || record.reference || record.id);
    const messageText = String(query.message && (query.message.caption || query.message.text) || '');
    const favoriteHeading = (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
    if (!favorites.has(record.id) && messageText.includes(favoriteHeading)) {
      await acknowledgeCallback(query, token, notice);
      const pageMatch = messageText.match(/·\s*(\d+)\s*\/\s*\d+/);
      const requestedPage = Math.max(0, Number(pageMatch && pageMatch[1] || 1) - 1);
      const remaining = catalogRecords(user, 'favorites');
      if (remaining.length) await sendCatalogPage(chatId, user, token, Math.min(requestedPage, remaining.length - 1), 'favorites');
      else {
        const previous = Array.isArray(user.catalogMessageIds) ? [...user.catalogMessageIds] : [];
        user.catalogMessageIds = [];
        scheduleSave();
        await deleteCatalogMessages(chatId, previous, token);
        await sendCatalogPage(chatId, user, token, 0, 'favorites');
      }
      return;
    }
    if (query.message && query.message.message_id && query.message.reply_markup && Array.isArray(query.message.reply_markup.inline_keyboard)) {
      const replacement = favorites.has(record.id) ? '💔 ' + text.favoriteRemoveButton : '❤️ ' + text.favoriteButton;
      const markup = {
        inline_keyboard: query.message.reply_markup.inline_keyboard.map((row) => row.map((button) => {
          return button.callback_data === 'property:favorite:' + record.id ? { ...button, text: replacement } : button;
        })),
      };
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: markup,
        });
      } catch {
        // The favorite is saved even when an older Telegram message cannot be edited.
      }
    }
    await acknowledgeCallback(query, token, notice);
    return;
  }
  if (actionName === 'gallery') {
    const images = recordImages(record, language);
    if (!images.length) {
      await acknowledgeCallback(query, token, text.photosUnavailable);
      return;
    }
    void notifyAdministratorAction(user, 'Открыл фотографии объекта', localizedExact(record.title, language) || record.reference || record.id);
    recordPropertyEvent(record.id, 'galleries');
    await acknowledgeCallback(query, token, text.gallery);
    const albumTitle = localizedExact(record.title, language) || record.reference || '';
    await clearGalleryMessages(chatId, user, token);
    const albumMessages = await sendPhotoAlbum(chatId, images, token, albumTitle);
    user.galleryMessageIds = albumMessages.map((message) => Number(message && message.message_id)).filter(Number.isFinite).slice(0, 20);
    scheduleSave();
    const interaction = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
    const nextRows = [
      [{ text: '📋 ' + text.details, callback_data: 'property:details:' + record.id }],
      [{ text: '💬 ' + text.contactManager, callback_data: 'property:manager:' + record.id }],
    ];
    const context = user.catalogContext && typeof user.catalogContext === 'object' ? user.catalogContext : { mode: 'all', page: 0 };
    const contextRecords = catalogRecords(user, context.mode);
    const currentIndex = contextRecords.findIndex((item) => item.id === record.id);
    if (currentIndex >= 0 && contextRecords.length > 1) {
      nextRows.push([{ text: text.nextProperty, callback_data: 'property:next:' + record.id }]);
    }
    nextRows.push([{ text: '⬅️ ' + interaction.hideGallery, callback_data: 'property:return:' + record.id }]);
    await sendUiMessage(chatId, user, text.nextPrompt, token, { reply_markup: { inline_keyboard: nextRows } });
    return;
  }
  if (actionName === 'interest') {
    recordPropertyEvent(record.id, 'interests');
    void notifyAdministratorAction(user, 'Начал заявку по объекту', localizedExact(record.title, language) || record.reference || record.id);
    await acknowledgeCallback(query, token);
    await startLeadForm(user, token, { propertyId: record.id });
    return;
  }
  if (actionName === 'viewing' || actionName === 'question') {
    if (actionName === 'viewing') {
      await acknowledgeCallback(query, token);
      if (record.status === 'reserved') {
        const inquiry = propertyRequestText(record, language, 'question') + '\n\n' + text.availability;
        createInquiry(user, inquiry, { type: 'question', propertyId: record.id, sourceMessage: query.message });
        await sendMessage(chatId, [text.received, '🏠 ' + (localizedExact(record.title, language) || record.reference || '')].filter(Boolean).join('\n\n'), token, { reply_markup: menuKeyboard(language) });
      } else {
        await startViewingForm(user, record, token);
      }
      return;
    }
    user.pendingAction = { type: actionName, propertyId: record.id, createdAt: new Date().toISOString() };
    scheduleSave();
    void notifyAdministratorAction(user, actionName === 'viewing' ? 'Нажал «Записаться на просмотр»' : 'Нажал «Задать вопрос»', localizedExact(record.title, language) || record.reference || record.id);
    await acknowledgeCallback(query, token);
    await sendMessage(chatId, text.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + text.cancel, callback_data: 'property:cancel:' + record.id }]] },
    });
    return;
  }
  await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
}

async function handleUpdate(update, token) {
  if (update.message_reaction) {
    await handleMessageReaction(update.message_reaction);
    return;
  }
  if (update.callback_query) {
    const callbackData = String(update.callback_query.data || '');
    const callbackChatId = update.callback_query.message && update.callback_query.message.chat
      ? update.callback_query.message.chat.id
      : update.callback_query.from.id;
    const callbackUser = normalizeUser(update.callback_query.from, callbackChatId, false);
    if (duplicateCallback(callbackUser, callbackData)) {
      const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
      await acknowledgeCallback(update.callback_query, token, copy.duplicate);
      return;
    }
    try {
      if (callbackData.startsWith('language:')) await handleLanguageCallback(update.callback_query, token);
      else if (callbackData.startsWith('catalog:')) await handleCatalogCallback(update.callback_query, token);
      else if (callbackData.startsWith('property:')) await handlePropertyCallback(update.callback_query, token);
      else if (callbackData.startsWith('promotions:')) await handlePromotionCallback(update.callback_query, token);
      else if (callbackData.startsWith('contact:')) await handleContactCallback(update.callback_query, token);
      else if (callbackData.startsWith('about:')) await handleAboutCallback(update.callback_query, token);
      else if (callbackData.startsWith('nav:')) await handleNavigationCallback(update.callback_query, token);
      else if (callbackData.startsWith('selection:')) await handleSelectionCallback(update.callback_query, token);
      else {
        const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
        await acknowledgeCallback(update.callback_query, token, copy.stale);
      }
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Действие пользователя', error);
      console.error('Не удалось выполнить действие пользователя:', error.message);
      const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
      await sendMessage(callbackChatId, copy.failed, token, { reply_markup: menuKeyboard(callbackUser.preferredLanguage || 'ru') }).catch(() => {});
    }
    return;
  }
  const message = update.message;
  if (!message || !message.from || !message.chat) return;
  if (await handleAdministratorReply(message, token)) return;

  const user = normalizeUser(message.from, message.chat.id);
  if (duplicateInboundMessage(user, message.message_id)) return;
  const expiredPending = pendingActionExpired(user) ? user.pendingAction : null;
  if (expiredPending) {
    rememberExpiredAction(user, expiredPending);
    user.pendingAction = null;
    scheduleSave();
  }
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const summary = messageSummary(message);
  data.stats.messagesReceived += 1;
  recordDaily('received');
  recordActivity(user, 'in', summary, text ? 'message' : 'media', { messageId: message.message_id });
  data.stats.lastUpdateAt = new Date().toISOString();
  scheduleSave();

  let answer = '';
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const commandArgument = cleanText(text.split(/\s+/).slice(1).join(' '), 100);
  if (command === '/start' && commandArgument) {
    user.pendingStartPayload = commandArgument;
    scheduleSave();
  }
  if (command === '/myid') {
    void notifyAdministratorAction(user, 'Запросил свой Telegram ID', 'Chat ID: ' + String(message.chat.id));
    const copy = COMMAND_TEXT[user.preferredLanguage || 'ru'] || COMMAND_TEXT.ru;
    await sendMessage(message.chat.id, copy.myId + ' ' + String(message.chat.id), token);
    return;
  }
  if (command === '/language' || (user.preferredLanguage && isLanguageChangeText(text, user.preferredLanguage)) || !user.preferredLanguage) {
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    void notifyAdministratorAction(user, user.preferredLanguage ? 'Открыл выбор языка' : 'Первый запуск — выбор языка', summary);
    try {
      await clearUiMessages(message.chat.id, user, token);
      await clearGalleryMessages(message.chat.id, user, token);
      await clearCatalogMessages(message.chat.id, user, token);
      await sendLanguagePicker(message.chat.id, token, user.preferredLanguage || '');
    } catch (error) {
      runtime.lastError = error.message;
    }
    return;
  }

  const messages = languageMessages(user.preferredLanguage);
  if (command === '/start' || command === '/menu') {
    if (command === '/start' && !commandArgument && user.pendingAction) {
      const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
      void notifyAdministratorAction(user, 'Вернулся к незавершённой форме', summary);
      await sendMessage(message.chat.id, copy.unfinished, token, { reply_markup: unfinishedActionKeyboard(user.preferredLanguage) });
      return;
    }
    user.pendingAction = null;
    user.expiredAction = null;
    if (command === '/menu') user.pendingStartPayload = '';
    scheduleSave();
    void notifyAdministratorAction(user, command === '/start' ? 'Запустил бота' : 'Открыл главное меню', summary);
    try {
      if (command === '/start' && await openPendingStartPayload(user, token)) return;
      await sendMainMenu(message.chat.id, user, token);
    } catch (error) {
      runtime.lastError = error.message;
      console.error('Не удалось показать главное меню:', error.message);
    }
    return;
  }
  else if (command === '/help') {
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    void notifyAdministratorAction(user, 'Открыл раздел «Помощь»', summary);
    await clearUiMessages(message.chat.id, user, token);
    await clearGalleryMessages(message.chat.id, user, token);
    await clearCatalogMessages(message.chat.id, user, token);
    await sendHelp(message.chat.id, user, token);
    return;
  }
  else if (command === '/cancel') {
    const hadPendingAction = Boolean(user.pendingAction || user.expiredAction);
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    const copy = COMMAND_TEXT[user.preferredLanguage] || COMMAND_TEXT.ru;
    void notifyAdministratorAction(user, hadPendingAction ? 'Отменил текущее действие' : 'Открыл главное меню командой /cancel', summary);
    await sendMessage(message.chat.id, hadPendingAction ? copy.cancelled : copy.nothingToCancel, token, { reply_markup: menuKeyboard(user.preferredLanguage) });
    return;
  }
  else if (command.startsWith('/')) {
    const copy = COMMAND_TEXT[user.preferredLanguage] || COMMAND_TEXT.ru;
    const interaction = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    const hasPendingAction = Boolean(user.pendingAction);
    const hasExpiredAction = Boolean(user.expiredAction);
    void notifyAdministratorAction(user, 'Ввёл неизвестную команду', cleanText(command, 80));
    const commandMessage = hasExpiredAction ? copy.unknown + '\n\n' + interaction.expired : hasPendingAction ? copy.unknown + '\n\n' + interaction.unfinished : copy.unknown;
    await sendMessage(message.chat.id, commandMessage, token, {
      reply_markup: hasExpiredAction ? expiredActionKeyboard(user.preferredLanguage) : hasPendingAction ? unfinishedActionKeyboard(user.preferredLanguage) : menuKeyboard(user.preferredLanguage),
    });
    return;
  }
  else if (expiredPending && (!text || !menuItemForText(text, user.preferredLanguage))) {
    const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    await sendMessage(message.chat.id, copy.expired, token, { reply_markup: expiredActionKeyboard(user.preferredLanguage) });
    return;
  }
  else if (user.expiredAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).resume) {
    await restartExpiredAction(user, token);
    return;
  }
  else if (user.expiredAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).backToMenu) {
    user.expiredAction = null;
    scheduleSave();
    await sendMainMenu(message.chat.id, user, token);
    return;
  }
  else if (user.expiredAction && (!text || !menuItemForText(text, user.preferredLanguage))) {
    user.expiredAction = null;
    scheduleSave();
    if (text && isStaleFormControl(text)) {
      const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
      await sendMessage(message.chat.id, copy.stale, token, { reply_markup: menuKeyboard(user.preferredLanguage) });
      return;
    }
    createInquiry(user, text || summary, { type: 'general', sourceMessage: message });
    answer = fillTemplate(messages.fallback, user);
  }
  else if (user.pendingAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).continueForm) {
    await showPendingActionStep(user, token);
    return;
  }
  else if (user.pendingAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).discardForm) {
    user.pendingAction = null;
    scheduleSave();
    await sendMainMenu(message.chat.id, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'lead' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleLeadFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'viewing_form' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleViewingFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'property_selection' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleSelectionFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'manager_question' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    user.pendingAction = null;
    createInquiry(user, text || summary, { type: 'question', sourceMessage: message });
    scheduleSave();
    answer = (MANAGER_CONTACT_TEXT[user.preferredLanguage] || MANAGER_CONTACT_TEXT.ru).received;
  }
  else if (user.pendingAction && (!text || !menuItemForText(text, user.preferredLanguage))) {
    const pending = user.pendingAction;
    user.pendingAction = null;
    const property = data.objects.find((item) => item.id === pending.propertyId);
    if (property) {
      const type = pending.type === 'viewing' ? 'viewing' : 'question';
      const prefix = propertyRequestText(property, user.preferredLanguage, type);
      createInquiry(user, prefix + '\n\n' + (text || summary), { type, propertyId: property.id, sourceMessage: message });
      recordPropertyEvent(property.id, type === 'viewing' ? 'viewings' : 'questions');
      const received = (PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).received;
      const propertyTitle = localizedExact(property.title, user.preferredLanguage) || property.reference || '';
      answer = [received, propertyTitle ? '🏠 ' + propertyTitle : ''].filter(Boolean).join('\n\n');
    } else {
      answer = user.preferredLanguage === 'en' ? 'This property is no longer available.' : user.preferredLanguage === 'es' ? 'Este inmueble ya no está disponible.' : 'Этот объект уже недоступен.';
    }
    scheduleSave();
  }
  else if (text && isStaleFormControl(text)) {
    const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    await sendMessage(message.chat.id, copy.stale, token, { reply_markup: menuKeyboard(user.preferredLanguage) });
    return;
  }
  else if (text) {
    const menuItem = menuItemForText(text, user.preferredLanguage);
    if (menuItem) {
      user.pendingAction = null;
      user.expiredAction = null;
      scheduleSave();
      recordDaily('menu', menuItem);
      void notifyAdministratorAction(user, 'Открыл раздел «' + (MENU_LABELS[user.preferredLanguage][menuItem] || menuItem).replace(/^[^\p{L}\p{N}]+/u, '') + '»', summary);
      try {
        await clearUiMessages(message.chat.id, user, token);
        await clearGalleryMessages(message.chat.id, user, token);
        if (!['objects', 'favorites', 'promotions'].includes(menuItem)) await clearCatalogMessages(message.chat.id, user, token);
        if (menuItem === 'objects' && await sendCatalog(message.chat.id, user, token)) return;
        if (menuItem === 'selection') {
          await startSelectionForm(user, token);
          return;
        }
        if (menuItem === 'promotions' && await sendPromotions(message.chat.id, user, token)) return;
        if (menuItem === 'favorites') {
          const context = user.catalogContext && user.catalogContext.mode === 'favorites' ? user.catalogContext : { page: 0 };
          await sendCatalogPage(message.chat.id, user, token, Math.max(0, Number(context.page) || 0), 'favorites');
          return;
        }
        if (menuItem === 'request') {
          await startLeadForm(user, token);
          return;
        }
        if (menuItem === 'contacts') {
          await sendContacts(message.chat.id, user, token);
          return;
        }
        if (menuItem === 'more') {
          await sendMoreMenu(message.chat.id, user, token);
          return;
        }
        if (menuItem === 'about') {
          await sendAbout(message.chat.id, user, token);
          return;
        }
        if (menuItem === 'help') {
          await sendHelp(message.chat.id, user, token);
          return;
        }
      } catch (error) {
        recordError('Содержимое меню', error);
        runtime.lastError = error.message;
        answer = user.preferredLanguage === 'en' ? 'This section is temporarily unavailable. Please try again.' : user.preferredLanguage === 'es' ? 'Esta sección no está disponible temporalmente. Inténtalo de nuevo.' : 'Раздел временно недоступен. Попробуйте ещё раз.';
      }
      if (!answer) {
        const heading = MENU_LABELS[user.preferredLanguage][menuItem];
        answer = heading + '\n\n' + fillTemplate(data.config.menu[user.preferredLanguage][menuItem], user);
      }
    }
    else {
      const rule = findRule(text, user.preferredLanguage);
      if (rule) {
        void notifyAdministratorAction(user, 'Получил автоматический ответ', 'Сообщение: ' + text + '\nПравило: ' + rule.trigger);
        answer = fillTemplate(rule.answer, user);
      }
      else {
        createInquiry(user, text, { type: 'general', sourceMessage: message });
        answer = fillTemplate(messages.fallback, user);
      }
    }
  } else {
    createInquiry(user, summary, { type: 'general', sourceMessage: message });
    answer = fillTemplate(messages.fallback, user);
  }

  if (answer) {
    try {
      await sendMessage(message.chat.id, answer, token, {
        reply_markup: menuKeyboard(user.preferredLanguage),
      });
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Ответ пользователю', error);
      console.error('Не удалось ответить пользователю:', error.message);
    }
  }
}

async function pollingLoop(generation, token) {
  let backoff = 1000;
  runtime.status = 'connecting';
  runtime.lastError = '';
  runtime.lastErrorAt = null;
  runtime.lastSuccessfulContactAt = null;
  runtime.consecutiveFailures = 0;
  runtime.nextRetryAt = null;
  runtime.pollingStartedAt = new Date().toISOString();

  try {
    const me = await telegramRequest(token, 'getMe', {});
    if (generation !== runtime.generation) return;
    data.bot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
    data.stats.startedAt = data.stats.startedAt || new Date().toISOString();
    markTelegramSuccess();
    scheduleSave();
    try {
      await configureBotCommands(token);
    } catch (error) {
      console.error('Не удалось обновить список команд Telegram:', error.message);
    }
    void runDueBroadcasts();
  } catch (error) {
    if (generation !== runtime.generation || error.name === 'AbortError') return;
    markTelegramFailure(error, 'error');
    recordError('Подключение к Telegram', error);
    console.error('Ошибка подключения к Telegram:', telegramErrorMessage(error));
  }

  while (
    generation === runtime.generation &&
    data.config.active &&
    token === data.config.botToken
  ) {
    const controller = new AbortController();
    runtime.abortController = controller;
    try {
      const updates = await telegramRequest(token, 'getUpdates', {
        offset: runtime.offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query', 'message_reaction'],
      }, controller.signal);
      if (generation !== runtime.generation) break;
      markTelegramSuccess();
      backoff = 1000;
      for (const update of updates) {
        await handleUpdate(update, token);
        runtime.offset = Math.max(runtime.offset, Number(update.update_id) + 1);
        data.telegramOffset = runtime.offset;
      }
      if (updates.length) saveDataNow();
    } catch (error) {
      if (error.name === 'AbortError' || generation !== runtime.generation) break;
      const firstFailure = markTelegramFailure(error, 'reconnecting');
      if (firstFailure) recordError('Связь с Telegram', error);
      runtime.nextRetryAt = new Date(Date.now() + backoff).toISOString();
      console.error('Связь с Telegram потеряна, повтор подключения:', telegramErrorMessage(error));
      await delay(backoff);
      runtime.nextRetryAt = null;
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  if (generation === runtime.generation) {
    runtime.status = data.config.active ? 'error' : 'stopped';
    runtime.nextRetryAt = null;
  }
}

function restartPolling() {
  runtime.generation += 1;
  if (runtime.abortController) runtime.abortController.abort();
  runtime.abortController = null;
  runtime.offset = Number(data.telegramOffset || 0);
  runtime.lastError = '';
  runtime.lastErrorAt = null;
  runtime.lastSuccessfulContactAt = null;
  runtime.consecutiveFailures = 0;
  runtime.nextRetryAt = null;
  if (configured() && data.config.active) {
    void pollingLoop(runtime.generation, data.config.botToken);
  } else {
    runtime.status = 'stopped';
  }
}

function broadcastUsers(entry) {
  const languages = Array.isArray(entry.languages) ? entry.languages.filter((language) => ['ru', 'en', 'es'].includes(language)) : [];
  const requiredTags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).toLocaleLowerCase('ru-RU')) : [];
  return Object.values(data.users).filter((user) => {
    if (user.blocked || !user.chatId) return false;
    if (languages.length && !languages.includes(user.preferredLanguage || 'ru')) return false;
    if (requiredTags.length) {
      const userTags = (user.tags || []).map((tag) => String(tag).toLocaleLowerCase('ru-RU'));
      if (!requiredTags.some((tag) => userTags.includes(tag))) return false;
    }
    return true;
  });
}

async function deliverBroadcast(user, entry, token = data.config.botToken) {
  const language = user.preferredLanguage || 'ru';
  const text = fillTemplate(localized(entry.messages, language), user);
  const url = validHttpUrl(entry.buttonUrl);
  const buttonText = localized(entry.buttonText, language);
  const markup = url && buttonText ? { inline_keyboard: [[{ text: buttonText, url }]] } : null;
  if (imageExists(entry.image)) {
    if (text.length <= 1000) await sendPhotoMessage(user.chatId, entry.image, text, token, markup);
    else {
      await sendPhotoMessage(user.chatId, entry.image, '', token, null);
      await sendMessage(user.chatId, text, token, markup ? { reply_markup: markup } : {});
    }
  } else {
    await sendMessage(user.chatId, text, token, markup ? { reply_markup: markup } : {});
  }
}

function userUnavailableError(error) {
  if (error && error.telegramCode === 403) return true;
  if (!error || error.telegramCode !== 400) return false;
  const message = String(error.message || '').toLocaleLowerCase('en-US');
  return message.includes('chat not found') || message.includes('user is deactivated');
}

async function runBroadcast(entry) {
  if (runtime.broadcastRunning) throw new Error('Рассылка уже выполняется');
  runtime.broadcastRunning = true;
  entry.status = 'running';
  entry.startedAt = entry.startedAt || new Date().toISOString();
  entry.sent = Number(entry.sent || 0);
  entry.failed = Number(entry.failed || 0);
  entry.processedUserIds = Array.isArray(entry.processedUserIds) ? entry.processedUserIds.map(String) : [];
  entry.failures = Array.isArray(entry.failures) ? entry.failures : [];
  const processed = new Set(entry.processedUserIds);
  const users = broadcastUsers(entry);
  entry.total = Math.max(Number(entry.total || 0), users.length);
  saveDataNow();

  try {
    for (const user of users) {
      if (processed.has(String(user.id))) continue;
      try {
        await deliverBroadcast(user, entry);
        entry.sent += 1;
      } catch (error) {
        entry.failed += 1;
        if (userUnavailableError(error)) user.blocked = true;
        entry.failures.push({
          userId: String(user.id),
          message: cleanText(error.message, 300),
          createdAt: new Date().toISOString(),
        });
        entry.failures = entry.failures.slice(-100);
        recordError('Рассылка', error);
      }
      processed.add(String(user.id));
      entry.processedUserIds = Array.from(processed);
      if (entry.processedUserIds.length % 20 === 0) saveDataNow();
      else scheduleSave();
      await delay(45);
    }
    entry.status = 'done';
    entry.finishedAt = new Date().toISOString();
  } finally {
    runtime.broadcastRunning = false;
    saveDataNow();
  }
}

async function runDueBroadcasts() {
  if (runtime.broadcastRunning || !configured() || !data.config.active || runtime.status !== 'online') return;
  const due = data.broadcasts.find((entry) => {
    if (entry.status === 'queued') return true;
    return entry.status === 'scheduled' && entry.scheduledAt && Date.parse(entry.scheduledAt) <= Date.now();
  });
  if (!due) return;
  try {
    await runBroadcast(due);
  } catch (error) {
    due.status = 'failed';
    due.error = cleanText(error.message, 400);
    recordError('Запланированная рассылка', error);
  }
}

const sessions = new Map();
const loginAttempts = new Map();

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function getSession(req) {
  const id = parseCookies(req.headers.cookie).admin_session;
  const session = id && sessions.get(id);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function createSession(res) {
  const id = crypto.randomBytes(32).toString('hex');
  const session = {
    id,
    csrf: crypto.randomBytes(24).toString('hex'),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(id, session);
  res.setHeader('set-cookie', 'admin_session=' + id + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200');
  return session;
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', 'no-store');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
  );
}

function json(res, status, payload) {
  securityHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function html(res, content) {
  securityHeaders(res);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(content);
}

function binaryImage(res, image) {
  const bytes = imageBytes(image);
  securityHeaders(res);
  res.writeHead(200, {
    'content-type': image.mimeType,
    'content-length': bytes.length,
  });
  res.end(bytes);
}

function binaryLoginAsset(req, res, asset) {
  if (!asset) {
    securityHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Не найдено');
  }
  securityHeaders(res);
  res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  res.setHeader('etag', asset.etag);
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'content-type': asset.mimeType,
    'content-length': asset.bytes.length,
  });
  res.end(asset.bytes);
}

function parseUploadedImage(dataUrl, originalName) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Поддерживаются изображения JPG и PNG');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('Изображение пустое');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Размер изображения не должен превышать 5 МБ');
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if ((match[1] === 'image/jpeg' && !isJpeg) || (match[1] === 'image/png' && !isPng)) {
    throw new Error('Содержимое файла не соответствует формату изображения');
  }
  return {
    id: crypto.randomUUID(),
    mimeType: match[1],
    dataBase64: bytes.toString('base64'),
    name: path.basename(cleanText(originalName, 120)) || (isPng ? 'welcome.png' : 'welcome.jpg'),
    size: bytes.length,
    updatedAt: new Date().toISOString(),
    telegramFileId: '',
  };
}

function readBody(req, maximumBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const bytes = await readBody(req);
  try {
    return bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
  } catch {
    throw new Error('Некорректный JSON');
  }
}

async function readBackup(req) {
  const bytes = await readBody(req, MAX_BACKUP_BODY_BYTES);
  let decoded = bytes;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      decoded = zlib.gunzipSync(bytes, { maxOutputLength: MAX_BACKUP_OUTPUT_BYTES });
    } catch {
      throw new Error('Не удалось распаковать резервную копию');
    }
  }
  if (decoded.length > MAX_BACKUP_OUTPUT_BYTES) throw new Error('Резервная копия слишком большая');
  let payload;
  try {
    payload = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw new Error('Некорректный файл резервной копии');
  }
  return payload && payload.backup && typeof payload.backup === 'object' ? payload.backup : payload;
}

function requireAuth(req, res, requireCsrf = false) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: 'Требуется вход' });
    return null;
  }
  if (requireCsrf && req.headers['x-csrf-token'] !== session.csrf) {
    json(res, 403, { error: 'Защитный код устарел. Обновите страницу.' });
    return null;
  }
  return session;
}

function imageMeta(image) {
  return imageExists(image) ? {
    exists: true,
    id: image.id || '',
    name: image.name,
    size: image.size,
    mimeType: image.mimeType,
    updatedAt: image.updatedAt,
  } : { exists: false };
}

function publicRecord(record, collection) {
  const { image, images, imagesByLanguage, ...publicFields } = record;
  if (collection === 'objects' || collection === 'promotions') {
    const publicImagesByLanguage = Object.fromEntries(['ru', 'en', 'es'].map((language) => [
      language,
      recordImages(record, language).map(imageMeta),
    ]));
    const cover = recordImages(record)[0];
    return {
      ...publicFields,
      image: imageMeta(cover),
      images: publicImagesByLanguage.ru,
      imagesByLanguage: publicImagesByLanguage,
      collection,
    };
  }
  const sourceImages = recordImages({ image, images });
  return { ...publicFields, image: imageMeta(sourceImages[0]), images: sourceImages.map(imageMeta), collection };
}

function languageCounts() {
  const result = { all: 0, ru: 0, en: 0, es: 0, unknown: 0 };
  for (const user of Object.values(data.users)) {
    if (user.blocked || !user.chatId) continue;
    result.all += 1;
    const language = ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'unknown';
    result[language] += 1;
  }
  return result;
}

function safeState(session) {
  const users = Object.values(data.users)
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(0, 500);
  return {
    csrf: session.csrf,
    bot: data.bot,
    runtime: publicRuntime(),
    config: {
      messages: data.config.messages,
      menu: data.config.menu,
      active: data.config.active,
      adminChatId: data.config.adminChatId || '',
      adminNotificationVerifiedAt: data.config.adminNotificationVerifiedAt || '',
    },
    welcomeImages: Object.fromEntries(['ru', 'en', 'es'].map((language) => {
      const image = data.welcomeImages[language];
      return [language, imageMeta(image)];
    })),
    rules: data.rules,
    users,
    userCount: Object.keys(data.users).length,
    activeUserCount: Object.values(data.users).filter((user) => !user.blocked && user.chatId).length,
    stats: data.stats,
    analytics: data.analytics,
    objects: data.objects.map((record) => publicRecord(record, 'objects')),
    promotions: data.promotions.map((record) => publicRecord(record, 'promotions')),
    contacts: data.contacts,
    interfaceText: normalizedInterfaceText(data.interfaceText),
    errors: data.errors,
    languageCounts: languageCounts(),
    broadcasts: data.broadcasts.map((entry) => ({ ...entry, image: imageMeta(entry.image) })),
    inquiries: data.inquiries,
    newInquiryCount: data.inquiries.filter((item) => item.status === 'new').length,
  };
}

function loginAllowed(ip) {
  const now = Date.now();
  let item = loginAttempts.get(ip);
  if (!item || item.resetAt < now) item = { count: 0, resetAt: now + 15 * 60 * 1000 };
  item.count += 1;
  loginAttempts.set(ip, item);
  return item.count <= 10;
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

function validateBackupPayload(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('Некорректная структура файла');
  if (!backup.config || typeof backup.config !== 'object') throw new Error('В копии отсутствуют настройки');
  if (!cleanText(backup.config.passwordHash, 300) || !cleanText(backup.config.passwordSalt, 300)) {
    throw new Error('В копии отсутствуют настройки входа');
  }
  if (backup.users != null && (typeof backup.users !== 'object' || Array.isArray(backup.users))) throw new Error('Некорректный список пользователей');
  if (backup.users && Object.keys(backup.users).length > 100000) throw new Error('Слишком много пользователей в копии');
  for (const key of ['rules', 'objects', 'promotions', 'broadcasts', 'inquiries', 'errors']) {
    if (backup[key] != null && !Array.isArray(backup[key])) throw new Error('Некорректный раздел: ' + key);
  }
  for (const language of ['ru', 'en', 'es']) validateStoredImage(backup.welcomeImages && backup.welcomeImages[language], 'приветствие ' + language);
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
  if (kind === 'objects') {
    delete common.images;
    delete common.image;
    return {
      ...common,
      imagesByLanguage,
      description: translatedInput(body.description, 3000),
      address: translatedInput(body.address, 500),
      price: translatedInput(body.price, 120),
      priceValue: optionalNumber(body.priceValue, 'цена'),
      currency: ['EUR', 'USD', 'GBP', 'UAH', 'RUB'].includes(body.currency) ? body.currency : 'EUR',
      pricePeriod: ['total', 'month', 'week'].includes(body.pricePeriod) ? body.pricePeriod : 'total',
      dealType: ['sale', 'rent'].includes(body.dealType) ? body.dealType : 'sale',
      propertyType: ['apartment', 'house', 'villa', 'townhouse', 'land', 'commercial', 'newbuild', 'other'].includes(body.propertyType) ? body.propertyType : 'apartment',
      reference: cleanText(body.reference, 80),
      city: translatedInput(body.city, 160),
      district: translatedInput(body.district, 160),
      bedrooms: optionalNumber(body.bedrooms, 'спальни', 100),
      bathrooms: optionalNumber(body.bathrooms, 'санузлы', 100),
      area: optionalNumber(body.area, 'площадь', 1000000),
      plotArea: optionalNumber(body.plotArea, 'площадь участка', 10000000),
      floor: cleanText(body.floor, 20),
      floors: cleanText(body.floors, 20),
      distanceSea: optionalNumber(body.distanceSea, 'расстояние до моря', 100000),
      condition: ['new', 'renovated', 'needs_renovation', 'under_construction', ''].includes(body.condition) ? body.condition : '',
      mapUrl,
      badges: Array.isArray(body.badges) ? body.badges.filter((item) => ['new', 'recommended', 'exclusive', 'price_reduced'].includes(item)) : [],
      status: ['active', 'hidden', 'reserved', 'sold'].includes(body.status) ? body.status : 'active',
    };
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
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    messages,
    languages,
    tags: Array.isArray(body.tags) ? body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20) : [],
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

function portableBackupData() {
  const payload = clone(data);
  forEachStoredImage(payload, (image) => {
    if (!image) return;
    const bytes = imageBytes(image);
    image.dataBase64 = bytes.toString('base64');
    image.size = bytes.length;
    delete image.storageFile;
  });
  return payload;
}

function sendBackupDownload(res, filename) {
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(portableBackupData()), 'utf8'), { level: 6 });
  securityHeaders(res);
  res.writeHead(200, {
    'content-type': 'application/gzip',
    'content-disposition': 'attachment; filename="' + filename + '"',
    'content-length': compressed.length,
    'cache-control': 'no-store',
  });
  res.end(compressed);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, {
      configured: configured(),
      setupLocalOnly: !configured(),
      botName: data.bot.firstName || '',
    });
  }

  if (url.pathname === '/api/setup' && req.method === 'POST') {
    if (configured()) return json(res, 409, { error: 'Первичная настройка уже выполнена' });
    if (!isLocalRequest(req)) return json(res, 403, { error: 'Настройка доступна только с этого компьютера' });
    const body = await readJson(req);
    const token = cleanText(body.token, 256);
    const password = String(body.password || '');
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return json(res, 400, { error: 'Токен выглядит некорректно' });
    }
    if (password.length < 8) return json(res, 400, { error: 'Пароль должен содержать минимум 8 символов' });
    let me;
    try {
      me = await telegramRequest(token, 'getMe', {});
    } catch (error) {
      return json(res, 400, { error: 'Telegram не принял токен: ' + error.message });
    }
    const passwordData = hashPassword(password);
    data.config.botToken = token;
    data.telegramOffset = 0;
    data.config.passwordSalt = passwordData.salt;
    data.config.passwordHash = passwordData.hash;
    data.bot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
    saveDataNow();
    const session = createSession(res);
    restartPolling();
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!configured()) return json(res, 409, { error: 'Сначала завершите настройку' });
    const ip = req.socket.remoteAddress || 'unknown';
    if (!loginAllowed(ip)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    const body = await readJson(req);
    if (!verifyPassword(String(body.password || ''))) {
      await delay(250);
      return json(res, 401, { error: 'Неверный пароль' });
    }
    loginAttempts.delete(ip);
    const session = createSession(res);
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    sessions.delete(session.id);
    res.setHeader('set-cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, safeState(session));
  }

  if (url.pathname === '/api/welcome' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const body = await readJson(req);
      const nextMessages = messagesInput(body.messages);
      const nextMenu = menuInput(body.menu);
      const nextImages = { ...data.welcomeImages };
      const imageChanges = body.images && typeof body.images === 'object' ? body.images : {};
      for (const language of ['ru', 'en', 'es']) {
        const change = imageChanges[language];
        if (!change) continue;
        if (change.remove) nextImages[language] = null;
        else if (change.dataUrl) nextImages[language] = parseUploadedImage(change.dataUrl, change.name || ('welcome-' + language + '.jpg'));
      }
      data.config.messages = nextMessages;
      data.config.menu = nextMenu;
      data.welcomeImages = nextImages;
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/backup' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    try {
      return sendBackupDownload(res, 'telegram-bot-backup-' + dayKey() + '.json.gz');
    } catch (error) {
      recordError('Создание резервной копии', error);
      return json(res, 500, { error: 'Не удалось создать резервную копию: ' + error.message });
    }
  }

  if (url.pathname === '/api/restore' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const backup = await readBackup(req);
      if (!backup || typeof backup !== 'object') throw new Error('Выберите корректный файл резервной копии');
      validateBackupPayload(backup);
      const restored = normalizeLoadedData(backup);
      data = restored;
      applyInterfaceText();
      saveDataNow();
      restartPolling();
      sessions.clear();
      const nextSession = createSession(res);
      return json(res, 200, { ok: true, csrf: nextSession.csrf });
    } catch (error) {
      return json(res, 400, { error: 'Не удалось восстановить копию: ' + error.message });
    }
  }

  if (url.pathname === '/api/token-test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const token = cleanText(body.token, 256) || data.config.botToken;
    try {
      const me = await telegramRequest(token, 'getMe', {});
      return json(res, 200, { ok: true, username: me.username || '', firstName: me.first_name || '' });
    } catch (error) {
      return json(res, 400, { error: 'Telegram не принял токен: ' + error.message });
    }
  }

  if (url.pathname === '/api/errors' && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    data.errors = [];
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/statistics/reset' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    data.stats.messagesReceived = 0;
    data.stats.messagesSent = 0;
    data.stats.reactionsReceived = 0;
    data.stats.statisticsResetAt = new Date().toISOString();
    data.analytics = { daily: {}, properties: {} };
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/activity' && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    for (const user of Object.values(data.users)) {
      user.activity = [];
      user.messages = 0;
      user.firstSeenAt = '';
      user.lastSeenAt = '';
    }
    data.activityClearedAt = new Date().toISOString();
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  const mediaMatch = url.pathname.match(/^\/api\/media\/(objects|promotions|broadcasts)\/([^/]+)$/);
  if (mediaMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const collection = mediaMatch[1] === 'broadcasts' ? data.broadcasts : data[mediaMatch[1]];
    const record = collection.find((item) => item.id === decodeURIComponent(mediaMatch[2]));
    if (!record) return json(res, 404, { error: 'Изображение не найдено' });
    const imageId = cleanText(url.searchParams.get('imageId'), 80);
    const searchableImages = mediaMatch[1] === 'objects' || mediaMatch[1] === 'promotions'
      ? ['ru', 'en', 'es'].flatMap((language) => recordImages(record, language))
      : recordImages(record);
    const image = imageId ? searchableImages.find((item) => String(item.id) === imageId) : (record.image || searchableImages[0]);
    if (!imageExists(image)) return json(res, 404, { error: 'Изображение не найдено' });
    return binaryImage(res, image);
  }

  if ((url.pathname === '/api/objects' || url.pathname === '/api/promotions') && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const kind = url.pathname.endsWith('objects') ? 'objects' : 'promotions';
    try {
      const record = parseContentRecord(await readJson(req), kind);
      data[kind].unshift(record);
      saveDataNow();
      return json(res, 201, { ok: true, id: record.id });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const contentMatch = url.pathname.match(/^\/api\/(objects|promotions)\/([^/]+)$/);
  if (contentMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const kind = contentMatch[1];
    const record = data[kind].find((item) => item.id === decodeURIComponent(contentMatch[2]));
    if (!record) return json(res, 404, { error: 'Запись не найдена' });
    try {
      Object.assign(record, parseContentRecord(await readJson(req), kind, record));
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (contentMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const kind = contentMatch[1];
    const before = data[kind].length;
    data[kind] = data[kind].filter((item) => item.id !== decodeURIComponent(contentMatch[2]));
    if (data[kind].length === before) return json(res, 404, { error: 'Запись не найдена' });
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/contacts' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const website = cleanText(body.website, 500);
    const mapUrl = cleanText(body.mapUrl, 500);
    const whatsapp = cleanText(body.whatsapp, 500);
    const email = cleanText(body.email, 254);
    if (website && !validHttpUrl(website)) return json(res, 400, { error: 'Ссылка на сайт должна начинаться с http:// или https://' });
    if (mapUrl && !validHttpUrl(mapUrl)) return json(res, 400, { error: 'Ссылка на карту должна начинаться с http:// или https://' });
    if (whatsapp && !whatsappContactUrl(whatsapp)) return json(res, 400, { error: 'Укажите номер WhatsApp с кодом страны или ссылку wa.me' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Проверьте адрес электронной почты' });
    data.contacts = {
      managerName: cleanText(body.managerName, 160),
      phone: cleanText(body.phone, 80),
      whatsapp,
      whatsappEnabled: body.whatsappEnabled !== false,
      telegram: cleanText(body.telegram, 500),
      email,
      website,
      mapUrl,
      text: translatedInput(body.text, 2000),
    };
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/interface-text' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const body = await readJson(req);
      data.interfaceText = normalizedInterfaceText(body.interfaceText, true);
      applyInterfaceText();
      saveDataNow();
      if (data.config.active && data.config.botToken) {
        configureBotCommands(data.config.botToken).catch((error) => recordError('Обновление команд Telegram', error));
      }
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/admin-notification/test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const adminChatId = cleanText(data.config.adminChatId, 40);
    if (!adminChatId) return json(res, 400, { error: 'Сначала укажите Chat ID администратора' });
    try {
      await sendMessage(adminChatId, '✅ Уведомления работают. Теперь действия пользователей будут приходить в этот чат.', data.config.botToken, { track: false });
      data.config.adminNotificationVerifiedAt = new Date().toISOString();
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      data.config.adminNotificationVerifiedAt = '';
      saveDataNow();
      recordError('Проверка уведомлений', error);
      const notFound = /chat not found/i.test(String(error && error.message));
      return json(res, 400, {
        error: notFound
          ? 'Telegram не нашёл этот Chat ID. Откройте бота с нужного аккаунта, отправьте /start, затем /myid и сохраните полученный номер.'
          : 'Не удалось отправить уведомление: ' + error.message,
      });
    }
  }

  const directMessageMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/message$/);
  if (directMessageMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = data.users[decodeURIComponent(directMessageMatch[1])];
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    if (!user.chatId || user.blocked) return json(res, 400, { error: 'Пользователь сейчас недоступен для сообщений' });
    try {
      const body = await readJson(req);
      const text = cleanText(body.text, 4000);
      const buttonText = cleanText(body.buttonText, 80);
      const buttonUrl = cleanText(body.buttonUrl, 500);
      if (!text && !body.imageDataUrl) return json(res, 400, { error: 'Введите сообщение или добавьте изображение' });
      if (buttonUrl && !validHttpUrl(buttonUrl)) return json(res, 400, { error: 'Ссылка кнопки должна начинаться с http:// или https://' });
      if ((buttonText && !buttonUrl) || (buttonUrl && !buttonText)) return json(res, 400, { error: 'Для кнопки нужны и название, и ссылка' });
      const image = body.imageDataUrl ? parseUploadedImage(body.imageDataUrl, body.imageName || 'message.jpg') : null;
      const markup = buttonText && buttonUrl ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] } : null;
      const language = user.preferredLanguage || 'ru';
      const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
      const outgoingText = text ? header + '\n\n' + text : header;
      if (image && outgoingText.length <= 1000) await sendPhotoMessage(user.chatId, image, outgoingText, data.config.botToken, markup);
      else if (image) {
        await sendPhotoMessage(user.chatId, image, '', data.config.botToken, null);
        await sendMessage(user.chatId, outgoingText, data.config.botToken, markup ? { reply_markup: markup } : {});
      } else {
        await sendMessage(user.chatId, outgoingText, data.config.botToken, markup ? { reply_markup: markup } : {});
      }
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      if (userUnavailableError(error)) user.blocked = true;
      recordError('Личное сообщение пользователю', error);
      return json(res, 400, { error: 'Не удалось отправить сообщение: ' + error.message });
    }
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = data.users[decodeURIComponent(userMatch[1])];
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    const body = await readJson(req);
    if (body.note != null) user.note = cleanText(body.note, 2000);
    if (Array.isArray(body.tags)) user.tags = body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20);
    if (['ru', 'en', 'es', ''].includes(body.preferredLanguage)) user.preferredLanguage = body.preferredLanguage;
    if (typeof body.blocked === 'boolean') user.blocked = body.blocked;
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  const inquiryMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)$/);
  if (inquiryMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(inquiryMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    if (body.status != null && !['new', 'in_progress', 'closed'].includes(body.status)) {
      return json(res, 400, { error: 'Некорректный статус обращения' });
    }
    if (body.status != null) inquiry.status = body.status;
    if (body.note != null) inquiry.note = cleanText(body.note, 2000);
    inquiry.updatedAt = new Date().toISOString();
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  const inquiryReplyMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/reply$/);
  if (inquiryReplyMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(inquiryReplyMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    const text = cleanText(body.text, 4000);
    if (!text) return json(res, 400, { error: 'Введите ответ пользователю' });
    const user = data.users[inquiry.userId] || userByChatId(inquiry.chatId);
    if (!user || !user.chatId) return json(res, 400, { error: 'У пользователя нет доступного чата' });
    try {
      const language = user.preferredLanguage || inquiry.language || 'ru';
      const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
      const replyParameters = Number.isFinite(Number(inquiry.sourceMessageId))
        ? { message_id: Number(inquiry.sourceMessageId), allow_sending_without_reply: true }
        : null;
      const sentMessage = await sendMessage(user.chatId, header + '\n\n' + text, data.config.botToken, {
        reply_markup: menuKeyboard(user.preferredLanguage || inquiry.language || 'ru'),
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
      inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
      inquiry.replies.push({
        id: crypto.randomUUID(),
        text,
        source: 'panel',
        createdAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        telegramMessageId: sentMessage && sentMessage.message_id ? Number(sentMessage.message_id) : null,
      });
      inquiry.replies = inquiry.replies.slice(-50);
      inquiry.status = body.keepOpen ? 'in_progress' : 'closed';
      inquiry.updatedAt = new Date().toISOString();
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      if (userUnavailableError(error)) user.blocked = true;
      recordError('Ответ на обращение', error);
      return json(res, 400, { error: 'Не удалось отправить ответ: ' + error.message });
    }
  }

  const welcomeImageMatch = url.pathname.match(/^\/api\/images\/(ru|en|es)\/welcome$/);
  if (welcomeImageMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const image = data.welcomeImages[welcomeImageMatch[1]];
    if (!imageExists(image)) return json(res, 404, { error: 'Изображение не загружено' });
    return binaryImage(res, image);
  }

  if (welcomeImageMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    try {
      data.welcomeImages[welcomeImageMatch[1]] = parseUploadedImage(body.dataUrl, body.name);
      saveDataNow();
      return json(res, 201, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (welcomeImageMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    data.welcomeImages[welcomeImageMatch[1]] = null;
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/rules/test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const text = cleanText(body.text, 1000);
    const language = ['ru', 'en', 'es'].includes(body.language) ? body.language : 'ru';
    if (!text) return json(res, 400, { error: 'Введите тестовое сообщение' });
    const rule = findRule(text, language);
    return json(res, 200, { matched: rule || null });
  }

  if (url.pathname === '/api/rules/reorder' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    if (!Array.isArray(body.ids) || body.ids.length !== data.rules.length) return json(res, 400, { error: 'Некорректный порядок правил' });
    const known = new Set(data.rules.map((rule) => rule.id));
    if (new Set(body.ids).size !== known.size || body.ids.some((id) => !known.has(id))) return json(res, 400, { error: 'Некорректный список правил' });
    const byId = new Map(data.rules.map((rule) => [rule.id, rule]));
    data.rules = body.ids.map((id, index) => ({ ...byId.get(id), order: index, updatedAt: new Date().toISOString() }));
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/rules' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const trigger = cleanText(body.trigger, 200);
    const answer = cleanText(body.answer, 4000);
    const type = ['contains', 'exact', 'starts'].includes(body.type) ? body.type : 'contains';
    const language = ['ru', 'en', 'es', 'all'].includes(body.language) ? body.language : 'ru';
    if (!trigger || !answer) return json(res, 400, { error: 'Заполните условие и ответ' });
    const candidate = {
      id: crypto.randomUUID(),
      trigger,
      type,
      answer,
      language,
      enabled: true,
      order: data.rules.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const conflicts = rulesConflict(candidate);
    data.rules.push(candidate);
    saveDataNow();
    return json(res, 201, { ok: true, id: candidate.id, conflicts: conflicts.map((rule) => rule.id) });
  }

  const ruleMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/);
  if (ruleMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const rule = data.rules.find((item) => item.id === decodeURIComponent(ruleMatch[1]));
    if (!rule) return json(res, 404, { error: 'Правило не найдено' });
    const body = await readJson(req);
    if (typeof body.enabled === 'boolean') rule.enabled = body.enabled;
    if (body.trigger != null) rule.trigger = cleanText(body.trigger, 200) || rule.trigger;
    if (body.answer != null) rule.answer = cleanText(body.answer, 4000) || rule.answer;
    if (['contains', 'exact', 'starts'].includes(body.type)) rule.type = body.type;
    if (['ru', 'en', 'es', 'all'].includes(body.language)) rule.language = body.language;
    rule.updatedAt = new Date().toISOString();
    const conflicts = rulesConflict(rule, rule.id);
    saveDataNow();
    return json(res, 200, { ok: true, conflicts: conflicts.map((item) => item.id) });
  }

  if (ruleMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const before = data.rules.length;
    data.rules = data.rules.filter((item) => item.id !== decodeURIComponent(ruleMatch[1]));
    if (data.rules.length === before) return json(res, 404, { error: 'Правило не найдено' });
    data.rules.forEach((rule, index) => { rule.order = index; });
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/menu' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const body = await readJson(req);
      data.config.menu = menuInput(body.menu);
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    let nextMessages;
    try {
      nextMessages = messagesInput(body.messages);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    let tokenChanged = false;
    let nextBot = data.bot;
    const newToken = cleanText(body.token, 256);
    if (newToken) {
      try {
        const me = await telegramRequest(newToken, 'getMe', {});
        nextBot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
      } catch (error) {
        return json(res, 400, { error: 'Telegram не принял новый токен: ' + error.message });
      }
      tokenChanged = true;
    }

    const newPassword = String(body.password || '');
    let passwordData = null;
    if (newPassword) {
      if (newPassword.length < 8) return json(res, 400, { error: 'Новый пароль должен содержать минимум 8 символов' });
      if (newPassword !== String(body.passwordConfirm || '')) return json(res, 400, { error: 'Пароли не совпадают' });
      passwordData = hashPassword(newPassword);
    }
    const previousAdminChatId = String(data.config.adminChatId || '');
    const adminChatId = body.adminChatId == null ? previousAdminChatId : cleanText(body.adminChatId, 40);
    if (adminChatId && !/^-?\d{4,20}$/.test(adminChatId)) return json(res, 400, { error: 'Chat ID должен состоять из цифр' });

    if (tokenChanged) {
      data.bot = nextBot;
      data.config.botToken = newToken;
      data.telegramOffset = 0;
      for (const language of ['ru', 'en', 'es']) {
        if (data.welcomeImages[language]) data.welcomeImages[language].telegramFileId = '';
      }
      for (const collection of [data.objects, data.promotions, data.broadcasts]) {
        for (const record of collection) if (record.image) record.image.telegramFileId = '';
      }
    }
    if (passwordData) {
      data.config.passwordSalt = passwordData.salt;
      data.config.passwordHash = passwordData.hash;
    }
    data.config.adminChatId = adminChatId;
    if (adminChatId !== previousAdminChatId) data.config.adminNotificationVerifiedAt = '';
    data.config.messages = nextMessages;
    const activeChanged = data.config.active !== Boolean(body.active);
    data.config.active = Boolean(body.active);
    saveDataNow();
    if (activeChanged || tokenChanged) restartPolling();
    if (passwordData) {
      for (const id of sessions.keys()) if (id !== session.id) sessions.delete(id);
    }
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/broadcast/estimate' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const entry = parseBroadcast(await readJson(req), {}, { requireMessages: false, requireSelectedTexts: false });
      return json(res, 200, { total: broadcastUsers(entry).length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/broadcast/test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const user = body.userId ? data.users[String(body.userId)] : null;
    if (!user || !user.chatId) return json(res, 400, { error: 'Выберите получателя тестового сообщения' });
    try {
      await deliverBroadcast(user, parseBroadcast(body));
      return json(res, 200, { ok: true });
    } catch (error) {
      recordError('Тест рассылки', error);
      return json(res, 400, { error: error.message });
    }
  }

  if ((url.pathname === '/api/broadcast' || url.pathname === '/api/broadcasts') && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    try {
      const mode = ['draft', 'schedule', 'send'].includes(body.mode) ? body.mode : 'send';
      const entry = parseBroadcast(body, {}, {
        requireMessages: mode !== 'draft',
        requireSelectedTexts: mode !== 'draft',
      });
      if (mode === 'schedule') {
        if (!entry.scheduledAt || Date.parse(entry.scheduledAt) <= Date.now()) throw new Error('Укажите будущую дату и время');
        entry.status = 'scheduled';
      } else if (mode === 'draft') entry.status = 'draft';
      else {
        if (!data.config.active) throw new Error('Сначала включите бота в настройках');
        if (runtime.broadcastRunning) return json(res, 409, { error: 'Предыдущая рассылка еще выполняется' });
        if (!broadcastUsers(entry).length) throw new Error('Для выбранных языков и тегов нет получателей');
        entry.status = 'queued';
      }
      data.broadcasts.unshift(entry);
      data.broadcasts = data.broadcasts.slice(0, 100);
      saveDataNow();
      if (mode === 'send') void runBroadcast(entry).catch((error) => {
        entry.status = 'failed';
        entry.error = cleanText(error.message, 400);
        runtime.lastError = error.message;
        recordError('Рассылка', error);
      });
      return json(res, mode === 'send' ? 202 : 201, { ok: true, id: entry.id, total: broadcastUsers(entry).length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const broadcastMatch = url.pathname.match(/^\/api\/broadcasts\/([^/]+)$/);
  if (broadcastMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const entry = data.broadcasts.find((item) => item.id === decodeURIComponent(broadcastMatch[1]));
    if (!entry) return json(res, 404, { error: 'Рассылка не найдена' });
    if (!['draft', 'scheduled'].includes(entry.status)) return json(res, 409, { error: 'Завершенную или выполняемую рассылку нельзя изменить' });
    try {
      const body = await readJson(req);
      const nextStatus = body.mode === 'schedule' ? 'scheduled' : 'draft';
      const updated = parseBroadcast(body, entry, {
        requireMessages: nextStatus !== 'draft',
        requireSelectedTexts: nextStatus !== 'draft',
      });
      updated.status = nextStatus;
      if (updated.status === 'scheduled' && (!updated.scheduledAt || Date.parse(updated.scheduledAt) <= Date.now())) throw new Error('Укажите будущую дату и время');
      Object.assign(entry, updated);
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (broadcastMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const entry = data.broadcasts.find((item) => item.id === decodeURIComponent(broadcastMatch[1]));
    if (!entry) return json(res, 404, { error: 'Рассылка не найдена' });
    if (entry.status === 'running') return json(res, 409, { error: 'Выполняемую рассылку нельзя удалить' });
    data.broadcasts = data.broadcasts.filter((item) => item.id !== entry.id);
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Не найдено' });
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Пульт бота</title>
  <style>
    :root{--bg:#07111f;--panel:#0d1b2b;--panel2:#102338;--line:#1d3852;--text:#f2f7fb;--muted:#8fa9bd;--blue:#2aabee;--blue2:#168bd0;--green:#35d49a;--red:#ff6b7a;--amber:#ffca68;--shadow:0 20px 55px rgba(0,0,0,.28)}
    *{box-sizing:border-box}html{font-size:16px}body{margin:0;background:radial-gradient(circle at 88% -10%,#123555 0,transparent 30%),var(--bg);color:var(--text);font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}button,input,textarea,select{font:inherit}button{cursor:pointer}a{color:inherit}.hidden{display:none!important}
    .auth{min-height:100vh;display:grid;place-items:center;padding:24px}.auth-card{width:min(460px,100%);background:linear-gradient(160deg,rgba(16,35,56,.97),rgba(9,24,39,.97));border:1px solid var(--line);border-radius:28px;padding:34px;box-shadow:var(--shadow)}.brandmark{width:52px;height:52px;border-radius:17px;background:linear-gradient(135deg,var(--blue),#2075e8);display:grid;place-items:center;font-weight:850;font-size:23px;box-shadow:0 12px 28px rgba(42,171,238,.25);transform:rotate(-4deg)}h1{font-size:28px;line-height:1.15;margin:22px 0 8px;letter-spacing:-.04em}h2{font-size:22px;letter-spacing:-.03em;margin:0}.lead{color:var(--muted);margin:0 0 26px}.field{display:grid;gap:8px;margin:16px 0}.field label{font-size:14px;color:#b8cad8;font-weight:650}.input,.select,.textarea{width:100%;color:var(--text);background:#091725;border:1px solid var(--line);border-radius:13px;padding:12px 14px;outline:none;transition:.18s border,.18s box-shadow}.textarea{min-height:110px;resize:vertical}.input:focus,.select:focus,.textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(42,171,238,.13)}.hint{font-size:13px;color:var(--muted)}
    .btn{border:0;border-radius:12px;padding:11px 16px;color:white;background:var(--blue2);font-weight:750;transition:.16s transform,.16s filter}.btn:hover{filter:brightness(1.1)}.btn:active{transform:translateY(1px)}.btn:disabled{opacity:.5;cursor:not-allowed}.btn.secondary{background:#18324b;color:#d7e7f2;border:1px solid #284a67}.btn.danger{background:rgba(255,107,122,.12);color:#ff9daa;border:1px solid rgba(255,107,122,.25)}.btn.wide{width:100%;padding:13px}.error{color:#ffadb6;background:rgba(255,107,122,.1);border:1px solid rgba(255,107,122,.2);padding:10px 12px;border-radius:11px;margin-top:14px;font-size:14px}.success{color:#82e9c2;background:rgba(53,212,154,.09);border:1px solid rgba(53,212,154,.2);padding:10px 12px;border-radius:11px;margin-top:14px;font-size:14px}
    .shell{min-height:100vh;display:grid;grid-template-columns:245px 1fr}.sidebar{border-right:1px solid var(--line);padding:24px 18px;display:flex;flex-direction:column;background:rgba(7,17,31,.72);backdrop-filter:blur(16px);position:sticky;top:0;height:100vh}.side-brand{display:flex;gap:13px;align-items:center;padding:0 9px 24px}.side-brand .brandmark{width:42px;height:42px;border-radius:14px;font-size:18px}.brand-title{font-weight:800}.brand-sub{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:145px}.nav{display:grid;gap:6px}.nav button{border:0;background:transparent;color:#9bb2c5;border-radius:12px;padding:11px 13px;text-align:left;font-weight:680;display:flex;gap:11px;align-items:center}.nav button:hover{background:#0f2337;color:white}.nav button.active{background:linear-gradient(90deg,rgba(42,171,238,.18),rgba(42,171,238,.05));color:#dff4ff;box-shadow:inset 3px 0 var(--blue)}.nav-icon{width:22px;text-align:center}.side-foot{margin-top:auto;border-top:1px solid var(--line);padding:18px 8px 0}.status-line{display:flex;align-items:center;gap:9px;color:#c6d8e5;font-size:14px}.dot{width:9px;height:9px;border-radius:50%;background:var(--muted);box-shadow:0 0 0 4px rgba(143,169,189,.08)}.dot.online{background:var(--green);box-shadow:0 0 0 4px rgba(53,212,154,.1)}.dot.error,.dot.reconnecting{background:var(--amber)}
    .main{min-width:0;padding:28px 32px 48px}.topbar{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:30px}.eyebrow{text-transform:uppercase;letter-spacing:.13em;color:var(--blue);font-size:12px;font-weight:800}.page-title{font-size:30px;line-height:1.2;letter-spacing:-.045em;margin:3px 0}.top-actions{display:flex;gap:10px;align-items:center}.content{max-width:1180px}.view{display:none}.view.active{display:block}.grid{display:grid;gap:16px}.stats{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}.card{background:linear-gradient(155deg,rgba(16,35,56,.95),rgba(11,27,44,.95));border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 12px 34px rgba(0,0,0,.12)}.stat-label{font-size:13px;color:var(--muted);font-weight:650}.stat-value{font-size:31px;font-weight:850;letter-spacing:-.05em;margin:8px 0 2px}.stat-note{font-size:12px;color:#718fa7}.split{grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr)}.card-head{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:18px}.card-title{font-size:17px;font-weight:800}.card-note{font-size:13px;color:var(--muted);margin-top:2px}.signal{height:120px;display:flex;align-items:end;gap:7px;padding-top:15px}.signal i{display:block;flex:1;min-width:4px;border-radius:5px 5px 2px 2px;background:linear-gradient(to top,#177dc2,var(--blue));opacity:.5}.signal i:nth-child(3n){opacity:.95}.signal i:nth-child(4n){opacity:.72}.activity-item{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(29,56,82,.72)}.activity-item:last-child{border:0}.avatar{width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:#173651;color:#a8ddfa;display:grid;place-items:center;font-weight:800}.activity-main{min-width:0}.activity-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.activity-meta{font-size:12px;color:var(--muted)}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:18px}.section-copy{color:var(--muted);margin:5px 0 0}.form-row{display:grid;grid-template-columns:minmax(0,1fr) 180px 180px;gap:12px}.rules{display:grid;gap:10px;margin-top:18px}.rule{display:grid;grid-template-columns:auto minmax(150px,.7fr) 150px minmax(220px,1.3fr) auto;align-items:center;gap:14px;background:#0b1b2b;border:1px solid var(--line);border-radius:14px;padding:14px}.rule.off{opacity:.55}.rule-trigger{font-weight:760}.rule-answer{color:#b7cad8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;background:rgba(42,171,238,.1);color:#8cd8ff;font-size:12px;font-weight:750}.toggle{appearance:none;width:40px;height:23px;border-radius:99px;background:#26425a;position:relative;transition:.2s}.toggle:after{content:"";position:absolute;width:17px;height:17px;border-radius:50%;background:white;top:3px;left:3px;transition:.2s}.toggle:checked{background:var(--blue2)}.toggle:checked:after{left:20px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:16px}.table{width:100%;border-collapse:collapse;min-width:680px;background:#0b1b2b}.table th,.table td{text-align:left;padding:14px 16px;border-bottom:1px solid var(--line)}.table th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.table tr:last-child td{border:0}.user-name{font-weight:750}.muted{color:var(--muted)}.empty{text-align:center;color:var(--muted);padding:38px 20px}.broadcast-layout{grid-template-columns:minmax(0,1fr) minmax(320px,.75fr)}.history{display:grid;gap:10px}.history-item{background:#0b1b2b;border:1px solid var(--line);border-radius:13px;padding:14px}.history-top{display:flex;justify-content:space-between;gap:12px}.progress{height:6px;border-radius:99px;background:#1b344a;margin-top:12px;overflow:hidden}.progress span{display:block;height:100%;background:var(--green)}.settings-grid{grid-template-columns:minmax(0,1fr) minmax(300px,.7fr)}.switch-row{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:16px;background:#0b1b2b;border:1px solid var(--line);border-radius:14px}.template-vars{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.template-vars code{background:#122b43;color:#9bdcff;border-radius:7px;padding:3px 7px;font-size:12px}.lang-tabs{display:flex;gap:7px;padding:5px;background:#091725;border:1px solid var(--line);border-radius:13px;margin-bottom:18px}.lang-tab{flex:1;border:0;border-radius:9px;padding:9px;background:transparent;color:var(--muted);font-weight:750}.lang-tab.active{background:#173a57;color:#dff4ff}.lang-pane,.menu-lang-pane{display:none}.lang-pane.active,.menu-lang-pane.active{display:block}.menu-editor{grid-template-columns:minmax(280px,.7fr) minmax(0,1.3fr)}.image-preview{aspect-ratio:16/10;margin:18px 0 12px;border:1px dashed #31536d;border-radius:15px;background:#091725;display:grid;place-items:center;overflow:hidden;color:var(--muted);text-align:center;padding:12px}.image-preview img{width:100%;height:100%;object-fit:cover;border-radius:10px}.upload-actions{display:flex;gap:9px}.toast{position:fixed;right:22px;bottom:22px;max-width:380px;background:#102b40;border:1px solid #2c5775;color:white;padding:13px 16px;border-radius:13px;box-shadow:var(--shadow);z-index:5}.mobile-menu{display:none}
    @media(max-width:900px){.shell{grid-template-columns:1fr}.sidebar{position:fixed;z-index:4;left:0;right:0;bottom:0;top:auto;height:auto;border-right:0;border-top:1px solid var(--line);padding:8px;background:#091725}.side-brand,.side-foot{display:none}.nav{display:flex;overflow:auto}.nav button{flex:1;min-width:92px;display:grid;justify-items:center;gap:2px;padding:7px 5px;font-size:11px}.nav-icon{font-size:17px}.main{padding:24px 18px 100px}.stats{grid-template-columns:repeat(2,1fr)}.split,.broadcast-layout,.settings-grid,.menu-editor{grid-template-columns:1fr}.top-actions .secondary{display:none}}
    @media(max-width:620px){.auth-card{padding:25px;border-radius:22px}.topbar{align-items:flex-start}.page-title{font-size:25px}.stats{grid-template-columns:1fr 1fr}.stat-value{font-size:25px}.form-row{grid-template-columns:1fr}.rule{grid-template-columns:auto 1fr auto}.rule .badge{display:none}.rule-answer{grid-column:2/4}.main{padding-left:13px;padding-right:13px}.card{padding:16px}.section-head{align-items:flex-start;flex-direction:column}.section-head .btn{width:100%}}
  </style>
</head>
<body>
  <section id="setupScreen" class="auth hidden">
    <form id="setupForm" class="auth-card">
      <div class="brandmark">TG</div>
      <h1>Подключите бота</h1>
      <p class="lead">Один раз укажите токен из BotFather и придумайте пароль для панели.</p>
      <div class="field"><label for="setupToken">Токен Telegram-бота</label><input class="input" id="setupToken" name="token" autocomplete="off" placeholder="123456789:AA..." required><span class="hint">Токен проверяется напрямую через Telegram.</span></div>
      <div class="field"><label for="setupPassword">Пароль администратора</label><input class="input" id="setupPassword" name="password" type="password" minlength="8" autocomplete="new-password" required><span class="hint">Минимум 8 символов.</span></div>
      <button class="btn wide" type="submit">Подключить и запустить</button>
      <div id="setupMessage"></div>
    </form>
  </section>

  <section id="loginScreen" class="auth hidden">
    <form id="loginForm" class="auth-card">
      <div class="brandmark">TG</div>
      <h1>Пульт бота</h1>
      <p class="lead">Введите пароль администратора.</p>
      <div class="field"><label for="loginPassword">Пароль</label><input class="input" id="loginPassword" name="password" type="password" autocomplete="current-password" required autofocus></div>
      <button class="btn wide" type="submit">Войти</button>
      <div id="loginMessage"></div>
    </form>
  </section>

  <div id="app" class="shell hidden">
    <aside class="sidebar">
      <div class="side-brand"><div class="brandmark">TG</div><div><div class="brand-title">Пульт бота</div><div id="botUsername" class="brand-sub">Telegram</div></div></div>
      <nav class="nav" id="nav">
        <button class="active" data-view="dashboard"><span class="nav-icon">⌁</span>Обзор</button>
        <button data-view="menu"><span class="nav-icon">▦</span>Меню</button>
        <button data-view="rules"><span class="nav-icon">≡</span>Ответы</button>
        <button data-view="users"><span class="nav-icon">◉</span>Люди</button>
        <button data-view="broadcast"><span class="nav-icon">↗</span>Рассылка</button>
        <button data-view="settings"><span class="nav-icon">⚙</span>Настройки</button>
      </nav>
      <div class="side-foot"><div class="status-line"><span id="sideDot" class="dot"></span><span id="sideStatus">Проверка связи</span></div></div>
    </aside>

    <main class="main">
      <header class="topbar"><div><div class="eyebrow" id="eyebrow">Центр управления</div><div class="page-title" id="pageTitle">Обзор</div></div><div class="top-actions"><button id="refreshBtn" class="btn secondary">Обновить</button><button id="logoutBtn" class="btn danger">Выйти</button></div></header>
      <div class="content">
        <section class="view active" id="view-dashboard">
          <div class="grid stats">
            <div class="card"><div class="stat-label">Пользователи</div><div class="stat-value" id="statUsers">0</div><div class="stat-note" id="statActiveUsers">0 доступны</div></div>
            <div class="card"><div class="stat-label">Получено сообщений</div><div class="stat-value" id="statReceived">0</div><div class="stat-note">за всё время</div></div>
            <div class="card"><div class="stat-label">Отправлено</div><div class="stat-value" id="statSent">0</div><div class="stat-note">ответы и рассылки</div></div>
            <div class="card"><div class="stat-label">Правила ответов</div><div class="stat-value" id="statRules">0</div><div class="stat-note" id="statRulesEnabled">0 включено</div></div>
          </div>
          <div class="grid split">
            <div class="card"><div class="card-head"><div><div class="card-title">Пульс общения</div><div class="card-note">Визуальный ритм активности бота</div></div><span id="dashboardStatus" class="badge">—</span></div><div class="signal" aria-hidden="true"><i style="height:24%"></i><i style="height:42%"></i><i style="height:31%"></i><i style="height:66%"></i><i style="height:48%"></i><i style="height:84%"></i><i style="height:55%"></i><i style="height:73%"></i><i style="height:44%"></i><i style="height:91%"></i><i style="height:62%"></i><i style="height:78%"></i><i style="height:50%"></i><i style="height:69%"></i><i style="height:96%"></i><i style="height:72%"></i><i style="height:88%"></i><i style="height:57%"></i></div></div>
            <div class="card"><div class="card-head"><div><div class="card-title">Недавние пользователи</div><div class="card-note">Последние диалоги</div></div></div><div id="recentUsers"></div></div>
          </div>
        </section>

        <section class="view" id="view-menu">
          <div class="section-head"><div><h2>Приветствие и меню</h2><p class="section-copy">Изображение и содержание четырех разделов для каждого языка.</p></div></div>
          <form id="menuForm">
            <div id="menuLanguageTabs" class="lang-tabs" style="max-width:520px"><button type="button" class="lang-tab active" data-language="ru">Русский</button><button type="button" class="lang-tab" data-language="en">English</button><button type="button" class="lang-tab" data-language="es">Español</button></div>
            <div class="menu-lang-pane active" data-menu-language-pane="ru"><div class="grid menu-editor"><div class="card"><div class="card-title">Приветственное изображение</div><div class="card-note">JPG или PNG, не более 5 МБ</div><div id="welcomeImagePreviewRu" class="image-preview"><span>Изображение не загружено</span></div><div class="field"><input id="welcomeImageFileRu" class="input" type="file" accept="image/jpeg,image/png"></div><div class="upload-actions"><button type="button" class="btn upload-welcome" data-language="ru">Загрузить</button><button type="button" class="btn danger remove-welcome" data-language="ru">Удалить</button></div></div><div class="card"><div class="field"><label for="menuObjectsRu">Наши объекты</label><textarea id="menuObjectsRu" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuContactsRu">Контакты</label><textarea id="menuContactsRu" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuPromotionsRu">Акции</label><textarea id="menuPromotionsRu" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuAboutRu">О нас</label><textarea id="menuAboutRu" class="textarea" maxlength="4000" required></textarea></div></div></div></div>
            <div class="menu-lang-pane" data-menu-language-pane="en"><div class="grid menu-editor"><div class="card"><div class="card-title">Welcome image</div><div class="card-note">JPG or PNG, up to 5 MB</div><div id="welcomeImagePreviewEn" class="image-preview"><span>No image uploaded</span></div><div class="field"><input id="welcomeImageFileEn" class="input" type="file" accept="image/jpeg,image/png"></div><div class="upload-actions"><button type="button" class="btn upload-welcome" data-language="en">Upload</button><button type="button" class="btn danger remove-welcome" data-language="en">Remove</button></div></div><div class="card"><div class="field"><label for="menuObjectsEn">Our properties</label><textarea id="menuObjectsEn" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuContactsEn">Contacts</label><textarea id="menuContactsEn" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuPromotionsEn">Special offers</label><textarea id="menuPromotionsEn" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuAboutEn">About us</label><textarea id="menuAboutEn" class="textarea" maxlength="4000" required></textarea></div></div></div></div>
            <div class="menu-lang-pane" data-menu-language-pane="es"><div class="grid menu-editor"><div class="card"><div class="card-title">Imagen de bienvenida</div><div class="card-note">JPG o PNG, hasta 5 MB</div><div id="welcomeImagePreviewEs" class="image-preview"><span>No se ha cargado ninguna imagen</span></div><div class="field"><input id="welcomeImageFileEs" class="input" type="file" accept="image/jpeg,image/png"></div><div class="upload-actions"><button type="button" class="btn upload-welcome" data-language="es">Subir</button><button type="button" class="btn danger remove-welcome" data-language="es">Eliminar</button></div></div><div class="card"><div class="field"><label for="menuObjectsEs">Nuestros inmuebles</label><textarea id="menuObjectsEs" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuContactsEs">Contactos</label><textarea id="menuContactsEs" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuPromotionsEs">Promociones</label><textarea id="menuPromotionsEs" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuAboutEs">Sobre nosotros</label><textarea id="menuAboutEs" class="textarea" maxlength="4000" required></textarea></div></div></div></div>
            <div style="margin-top:16px"><button class="btn" type="submit">Сохранить тексты меню</button></div>
          </form>
        </section>

        <section class="view" id="view-rules">
          <div class="section-head"><div><h2>Автоматические ответы</h2><p class="section-copy">Бот проверяет включенные правила сверху вниз.</p></div></div>
          <div class="card">
            <form id="ruleForm"><div class="form-row"><div class="field"><label for="ruleTrigger">Что пишет пользователь</label><input id="ruleTrigger" class="input" maxlength="200" placeholder="Например: цена" required></div><div class="field"><label for="ruleType">Условие</label><select id="ruleType" class="select"><option value="contains">Содержит</option><option value="exact">Точное совпадение</option><option value="starts">Начинается с</option></select></div><div class="field"><label for="ruleLanguage">Язык ответа</label><select id="ruleLanguage" class="select"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="all">Все языки</option></select></div></div><div class="field"><label for="ruleAnswer">Ответ бота</label><textarea id="ruleAnswer" class="textarea" maxlength="4000" placeholder="Напишите ответ..." required></textarea></div><button class="btn" type="submit">Добавить ответ</button></form>
            <div id="rulesList" class="rules"></div>
          </div>
        </section>

        <section class="view" id="view-users">
          <div class="section-head"><div><h2>Пользователи</h2><p class="section-copy">Люди, которые хотя бы раз написали боту.</p></div><input id="userSearch" class="input" style="max-width:280px" placeholder="Найти пользователя"></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Пользователь</th><th>Username</th><th>Сообщения</th><th>Последняя активность</th><th>Статус</th></tr></thead><tbody id="usersBody"></tbody></table></div>
        </section>

        <section class="view" id="view-broadcast">
          <div class="section-head"><div><h2>Рассылка</h2><p class="section-copy">Одно сообщение всем доступным пользователям.</p></div></div>
          <div class="grid broadcast-layout"><div class="card"><form id="broadcastForm"><div class="field"><label for="broadcastText">Текст сообщения</label><textarea id="broadcastText" class="textarea" style="min-height:190px" maxlength="4000" placeholder="Напишите сообщение для рассылки..." required></textarea><div class="template-vars"><code>{first_name}</code><code>{last_name}</code><code>{username}</code></div></div><button id="broadcastBtn" class="btn" type="submit">Начать рассылку</button></form></div><div class="card"><div class="card-head"><div><div class="card-title">История</div><div class="card-note">Последние отправки</div></div></div><div id="broadcastHistory" class="history"></div></div></div>
        </section>

        <section class="view" id="view-settings">
          <div class="section-head"><div><h2>Настройки</h2><p class="section-copy">Основные тексты, подключение и состояние бота.</p></div></div>
          <form id="settingsForm" class="grid settings-grid"><div class="card"><div id="languageTabs" class="lang-tabs"><button type="button" class="lang-tab active" data-language="ru">Русский</button><button type="button" class="lang-tab" data-language="en">English</button><button type="button" class="lang-tab" data-language="es">Español</button></div><div class="lang-pane active" data-language-pane="ru"><div class="field"><label for="settingGreetingRu">Приветствие /start</label><textarea id="settingGreetingRu" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingHelpRu">Ответ /help</label><textarea id="settingHelpRu" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingFallbackRu">Если правило не найдено</label><textarea id="settingFallbackRu" class="textarea" maxlength="4000"></textarea></div></div><div class="lang-pane" data-language-pane="en"><div class="field"><label for="settingGreetingEn">Greeting /start</label><textarea id="settingGreetingEn" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingHelpEn">Reply /help</label><textarea id="settingHelpEn" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingFallbackEn">When no rule matches</label><textarea id="settingFallbackEn" class="textarea" maxlength="4000"></textarea></div></div><div class="lang-pane" data-language-pane="es"><div class="field"><label for="settingGreetingEs">Saludo /start</label><textarea id="settingGreetingEs" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingHelpEs">Respuesta /help</label><textarea id="settingHelpEs" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingFallbackEs">Si ninguna regla coincide</label><textarea id="settingFallbackEs" class="textarea" maxlength="4000"></textarea></div></div><div class="template-vars"><code>{first_name}</code><code>{last_name}</code><code>{username}</code></div></div><div class="card"><div class="switch-row"><div><div class="card-title">Бот включен</div><div class="card-note">При выключении сообщения не обрабатываются</div></div><input id="settingActive" class="toggle" type="checkbox"></div><div class="field"><label for="settingToken">Новый токен</label><input id="settingToken" class="input" autocomplete="off" placeholder="Оставьте пустым, чтобы не менять"><span class="hint">Текущий токен никогда не показывается.</span></div><div class="field"><label for="settingPassword">Новый пароль панели</label><input id="settingPassword" class="input" type="password" minlength="8" autocomplete="new-password" placeholder="Оставьте пустым, чтобы не менять"></div><button class="btn wide" type="submit">Сохранить настройки</button></div></form>
        </section>
      </div>
    </main>
  </div>
  <div id="toast" class="toast hidden" role="status"></div>

  <script>
    (function(){
      'use strict';
      var state = null;
      var csrf = '';
      var currentView = 'dashboard';
      var refreshTimer = null;
      var titles = {dashboard:'Обзор',menu:'Приветствие и меню',rules:'Ответы',users:'Пользователи',broadcast:'Рассылка',settings:'Настройки'};
      function el(id){return document.getElementById(id)}
      function esc(value){return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
      function fmtNumber(value){return new Intl.NumberFormat('ru-RU').format(Number(value||0))}
      function fmtDate(value){if(!value)return '—';try{return new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}catch{return '—'}}
      function api(url,options){options=options||{};options.headers=Object.assign({'content-type':'application/json'},options.headers||{});if(options.method&&options.method!=='GET')options.headers['x-csrf-token']=csrf;return fetch(url,options).then(async function(r){var body={};try{body=await r.json()}catch{}if(!r.ok){var e=new Error(body.error||'Ошибка запроса');e.status=r.status;throw e}return body})}
      function message(target,text,ok){target.innerHTML='<div class="'+(ok?'success':'error')+'">'+esc(text)+'</div>'}
      function toast(text){var box=el('toast');box.textContent=text;box.classList.remove('hidden');clearTimeout(box._timer);box._timer=setTimeout(function(){box.classList.add('hidden')},3200)}
      function setScreen(name){['setupScreen','loginScreen','app'].forEach(function(id){el(id).classList.toggle('hidden',id!==name)})}
      async function boot(){
        try{
          var status=await api('/api/status');
          if(!status.configured){setScreen('setupScreen');return}
          try{await loadState();setScreen('app');startRefresh()}catch(e){setScreen('loginScreen')}
        }catch(e){setScreen('loginScreen');message(el('loginMessage'),'Не удалось связаться с сервером',false)}
      }
      function startRefresh(){clearInterval(refreshTimer);refreshTimer=setInterval(function(){loadState(true)},5000)}
      async function loadState(silent){
        try{state=await api('/api/state');csrf=state.csrf;render();return state}catch(e){if(e.status===401){clearInterval(refreshTimer);setScreen('loginScreen')}else if(!silent)throw e}
      }
      function runtimeLabel(status){return {online:'На связи',connecting:'Подключение',reconnecting:'Восстановление связи',stopped:'Остановлен',error:'Ошибка'}[status]||status}
      function userName(user){return [user.firstName,user.lastName].filter(Boolean).join(' ')||'Без имени'}
      function initials(user){var parts=[user.firstName,user.lastName].filter(Boolean);return (parts.map(function(x){return x[0]}).join('').slice(0,2)||'?').toUpperCase()}
      function render(){
        if(!state)return;
        el('botUsername').textContent=state.bot.username?'@'+state.bot.username:(state.bot.firstName||'Telegram');
        var status=state.runtime.status;el('sideStatus').textContent=runtimeLabel(status);el('sideDot').className='dot '+status;el('dashboardStatus').textContent=runtimeLabel(status);
        el('statUsers').textContent=fmtNumber(state.userCount);el('statActiveUsers').textContent=fmtNumber(state.activeUserCount)+' доступны';el('statReceived').textContent=fmtNumber(state.stats.messagesReceived);el('statSent').textContent=fmtNumber(state.stats.messagesSent);el('statRules').textContent=fmtNumber(state.rules.length);el('statRulesEnabled').textContent=fmtNumber(state.rules.filter(function(x){return x.enabled}).length)+' включено';
        renderRecent();renderMenu();renderRules();renderUsers();renderBroadcasts();renderSettings();
      }
      function renderRecent(){var users=state.users.slice(0,4);el('recentUsers').innerHTML=users.length?users.map(function(u){return '<div class="activity-item"><div class="avatar">'+esc(initials(u))+'</div><div class="activity-main"><div class="activity-name">'+esc(userName(u))+'</div><div class="activity-meta">'+fmtNumber(u.messages)+' сообщ. · '+esc(fmtDate(u.lastSeenAt))+'</div></div></div>'}).join(''):'<div class="empty">Пока никто не написал</div>'}
      function renderMenu(){var active=document.activeElement;var editing=active&&el('menuForm').contains(active)&&!active.classList.contains('upload-welcome')&&!active.classList.contains('remove-welcome');['ru','en','es'].forEach(function(language){var suffix=language[0].toUpperCase()+language.slice(1);if(!editing){var menu=state.config.menu[language];el('menuObjects'+suffix).value=menu.objects;el('menuContacts'+suffix).value=menu.contacts;el('menuPromotions'+suffix).value=menu.promotions;el('menuAbout'+suffix).value=menu.about}var meta=state.welcomeImages[language];var preview=el('welcomeImagePreview'+suffix);if(meta&&meta.exists){preview.innerHTML='<img src="/api/images/'+language+'/welcome?rev='+encodeURIComponent(meta.updatedAt||'')+'" alt="Приветственное изображение">'}else{preview.innerHTML='<span>'+(language==='en'?'No image uploaded':language==='es'?'No se ha cargado ninguna imagen':'Изображение не загружено')+'</span>'}var remove=document.querySelector('.remove-welcome[data-language="'+language+'"]');if(remove)remove.disabled=!(meta&&meta.exists)})}
      function typeLabel(type){return {contains:'содержит',exact:'точно',starts:'начинается'}[type]||type}
      function languageLabel(language){return {ru:'Русский',en:'English',es:'Español',all:'Все языки'}[language]||'Русский'}
      function renderRules(){el('rulesList').innerHTML=state.rules.length?state.rules.map(function(r){return '<div class="rule '+(r.enabled?'':'off')+'"><input class="toggle rule-toggle" data-id="'+esc(r.id)+'" type="checkbox" '+(r.enabled?'checked':'')+' aria-label="Включить правило"><div class="rule-trigger">'+esc(r.trigger)+'</div><span class="badge">'+esc(typeLabel(r.type)+' · '+languageLabel(r.language))+'</span><div class="rule-answer" title="'+esc(r.answer)+'">'+esc(r.answer)+'</div><button class="btn danger delete-rule" data-id="'+esc(r.id)+'">Удалить</button></div>'}).join(''):'<div class="empty">Добавьте первый автоматический ответ</div>'}
      function filteredUsers(){var q=el('userSearch').value.toLocaleLowerCase('ru-RU').trim();if(!q)return state.users;return state.users.filter(function(u){return (userName(u)+' '+u.username+' '+u.id).toLocaleLowerCase('ru-RU').includes(q)})}
      function renderUsers(){var users=filteredUsers();el('usersBody').innerHTML=users.length?users.map(function(u){return '<tr><td><div class="user-name">'+esc(userName(u))+'</div><div class="muted">ID '+esc(u.id)+'</div></td><td>'+(u.username?'@'+esc(u.username):'—')+'</td><td>'+fmtNumber(u.messages)+'</td><td>'+esc(fmtDate(u.lastSeenAt))+'</td><td><span class="badge">'+(u.blocked?'Недоступен':esc(u.preferredLanguage?languageLabel(u.preferredLanguage):'Язык не выбран'))+'</span></td></tr>'}).join(''):'<tr><td colspan="5" class="empty">Ничего не найдено</td></tr>'}
      function renderBroadcasts(){el('broadcastBtn').disabled=state.runtime.broadcastRunning;el('broadcastBtn').textContent=state.runtime.broadcastRunning?'Рассылка выполняется…':'Начать рассылку';var list=state.broadcasts;el('broadcastHistory').innerHTML=list.length?list.slice(0,6).map(function(b){var progress=b.total?Math.round((b.sent+b.failed)/b.total*100):100;return '<div class="history-item"><div class="history-top"><strong>'+esc(b.text.slice(0,44))+(b.text.length>44?'…':'')+'</strong><span class="muted">'+esc(fmtDate(b.createdAt))+'</span></div><div class="card-note">Отправлено '+fmtNumber(b.sent)+' из '+fmtNumber(b.total)+(b.failed?' · ошибок '+fmtNumber(b.failed):'')+'</div><div class="progress"><span style="width:'+progress+'%"></span></div></div>'}).join(''):'<div class="empty">Рассылок еще не было</div>'}
      function renderSettings(){var active=document.activeElement;var editing=active&&el('settingsForm').contains(active);if(editing)return;['ru','en','es'].forEach(function(language){var suffix=language[0].toUpperCase()+language.slice(1);var messages=state.config.messages[language];el('settingGreeting'+suffix).value=messages.greeting;el('settingHelp'+suffix).value=messages.help;el('settingFallback'+suffix).value=messages.fallback});el('settingActive').checked=state.config.active}
      function switchView(name){currentView=name;document.querySelectorAll('.view').forEach(function(node){node.classList.toggle('active',node.id==='view-'+name)});document.querySelectorAll('#nav button').forEach(function(node){node.classList.toggle('active',node.dataset.view===name)});el('pageTitle').textContent=titles[name]||name;if(name==='users')renderUsers();window.scrollTo({top:0,behavior:'smooth'})}
      el('setupForm').addEventListener('submit',async function(e){e.preventDefault();var btn=e.submitter;btn.disabled=true;btn.textContent='Проверяю токен…';el('setupMessage').innerHTML='';try{var result=await api('/api/setup',{method:'POST',body:JSON.stringify({token:el('setupToken').value,password:el('setupPassword').value})});csrf=result.csrf;await loadState();setScreen('app');startRefresh();toast('Бот подключен и запущен')}catch(err){message(el('setupMessage'),err.message,false)}finally{btn.disabled=false;btn.textContent='Подключить и запустить'}});
      el('loginForm').addEventListener('submit',async function(e){e.preventDefault();var btn=e.submitter;btn.disabled=true;el('loginMessage').innerHTML='';try{var result=await api('/api/login',{method:'POST',body:JSON.stringify({password:el('loginPassword').value})});csrf=result.csrf;el('loginPassword').value='';await loadState();setScreen('app');startRefresh()}catch(err){message(el('loginMessage'),err.message,false)}finally{btn.disabled=false}});
      el('logoutBtn').addEventListener('click',async function(){try{await api('/api/logout',{method:'POST',body:'{}'})}catch{}csrf='';state=null;clearInterval(refreshTimer);setScreen('loginScreen')});
      el('refreshBtn').addEventListener('click',function(){loadState().then(function(){toast('Данные обновлены')})});
      el('nav').addEventListener('click',function(e){var button=e.target.closest('button[data-view]');if(button)switchView(button.dataset.view)});
      el('ruleForm').addEventListener('submit',async function(e){e.preventDefault();var btn=e.submitter;btn.disabled=true;try{await api('/api/rules',{method:'POST',body:JSON.stringify({trigger:el('ruleTrigger').value,type:el('ruleType').value,language:el('ruleLanguage').value,answer:el('ruleAnswer').value})});e.target.reset();await loadState();toast('Ответ добавлен')}catch(err){toast(err.message)}finally{btn.disabled=false}});
      el('rulesList').addEventListener('change',async function(e){if(!e.target.classList.contains('rule-toggle'))return;try{await api('/api/rules/'+encodeURIComponent(e.target.dataset.id),{method:'PATCH',body:JSON.stringify({enabled:e.target.checked})});await loadState(true)}catch(err){toast(err.message);await loadState(true)}});
      el('rulesList').addEventListener('click',async function(e){var btn=e.target.closest('.delete-rule');if(!btn)return;if(!confirm('Удалить этот автоматический ответ?'))return;try{await api('/api/rules/'+encodeURIComponent(btn.dataset.id),{method:'DELETE',body:'{}'});await loadState();toast('Ответ удален')}catch(err){toast(err.message)}});
      el('userSearch').addEventListener('input',renderUsers);
      el('broadcastForm').addEventListener('submit',async function(e){e.preventDefault();if(!confirm('Начать рассылку всем доступным пользователям?'))return;var btn=e.submitter;btn.disabled=true;try{await api('/api/broadcast',{method:'POST',body:JSON.stringify({text:el('broadcastText').value})});el('broadcastText').value='';await loadState();toast('Рассылка началась')}catch(err){toast(err.message)}finally{btn.disabled=false}});
      el('menuLanguageTabs').addEventListener('click',function(e){var button=e.target.closest('.lang-tab');if(!button)return;el('menuLanguageTabs').querySelectorAll('.lang-tab').forEach(function(node){node.classList.toggle('active',node===button)});document.querySelectorAll('.menu-lang-pane').forEach(function(node){node.classList.toggle('active',node.dataset.menuLanguagePane===button.dataset.language)})});
      document.querySelectorAll('.upload-welcome').forEach(function(button){button.addEventListener('click',async function(){var language=button.dataset.language;var suffix=language[0].toUpperCase()+language.slice(1);var input=el('welcomeImageFile'+suffix);var file=input.files&&input.files[0];if(!file){toast('Сначала выберите изображение');return}if(file.size>5*1024*1024){toast('Размер изображения не должен превышать 5 МБ');return}button.disabled=true;try{var dataUrl=await new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result)};reader.onerror=function(){reject(new Error('Не удалось прочитать файл'))};reader.readAsDataURL(file)});await api('/api/images/'+language+'/welcome',{method:'POST',body:JSON.stringify({dataUrl:dataUrl,name:file.name})});input.value='';await loadState();toast('Изображение сохранено')}catch(err){toast(err.message)}finally{button.disabled=false}})});
      document.querySelectorAll('.remove-welcome').forEach(function(button){button.addEventListener('click',async function(){if(!confirm('Удалить приветственное изображение для этого языка?'))return;button.disabled=true;try{await api('/api/images/'+button.dataset.language+'/welcome',{method:'DELETE',body:'{}'});await loadState();toast('Изображение удалено')}catch(err){toast(err.message)}finally{button.disabled=false}})});
      el('menuForm').addEventListener('submit',async function(e){e.preventDefault();var btn=e.submitter;btn.disabled=true;var menu={};['ru','en','es'].forEach(function(language){var suffix=language[0].toUpperCase()+language.slice(1);menu[language]={objects:el('menuObjects'+suffix).value,contacts:el('menuContacts'+suffix).value,promotions:el('menuPromotions'+suffix).value,about:el('menuAbout'+suffix).value}});try{await api('/api/menu',{method:'PUT',body:JSON.stringify({menu:menu})});await loadState();toast('Тексты меню сохранены')}catch(err){toast(err.message)}finally{btn.disabled=false}});
      el('languageTabs').addEventListener('click',function(e){var button=e.target.closest('.lang-tab');if(!button)return;el('languageTabs').querySelectorAll('.lang-tab').forEach(function(node){node.classList.toggle('active',node===button)});document.querySelectorAll('.lang-pane').forEach(function(node){node.classList.toggle('active',node.dataset.languagePane===button.dataset.language)})});
      el('settingsForm').addEventListener('submit',async function(e){e.preventDefault();var btn=e.submitter;btn.disabled=true;var messages={};['ru','en','es'].forEach(function(language){var suffix=language[0].toUpperCase()+language.slice(1);messages[language]={greeting:el('settingGreeting'+suffix).value,help:el('settingHelp'+suffix).value,fallback:el('settingFallback'+suffix).value}});try{await api('/api/settings',{method:'PUT',body:JSON.stringify({messages:messages,active:el('settingActive').checked,token:el('settingToken').value,password:el('settingPassword').value})});el('settingToken').value='';el('settingPassword').value='';await loadState();toast('Настройки сохранены')}catch(err){toast(err.message)}finally{btn.disabled=false}});
      boot();
    })();
  </script>
</body>
</html>`;

const ADMIN_HTML_V2 = String.raw`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Пульт Telegram-бота</title>
  <style>
    :root{--bg:#07111f;--panel:#0d1c2c;--panel2:#10263b;--line:#1d3b56;--text:#f3f8fc;--muted:#91aabd;--blue:#2aabee;--blue2:#168bd0;--green:#36d39a;--red:#ff7280;--amber:#ffc85f;--shadow:0 20px 55px rgba(0,0,0,.3)}
    *{box-sizing:border-box}html{font-size:16px;scroll-behavior:smooth}body{margin:0;min-height:100vh;overflow-x:hidden;background:radial-gradient(circle at 88% -10%,#123858 0,transparent 30%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid rgba(42,171,238,.5);outline-offset:2px}.hidden{display:none!important}h1,h2,h3,p{margin-top:0}h1{font-size:29px;line-height:1.15;letter-spacing:-.04em;margin-bottom:8px}h2{font-size:23px;letter-spacing:-.03em;margin-bottom:4px}h3{font-size:17px;margin-bottom:4px}.muted{color:var(--muted)}.small{font-size:12px}.danger-text{color:#ff9ca7}.success-text{color:#7ae7bc}
    .auth{min-height:100vh;display:grid;place-items:center;padding:22px}.auth-card{width:min(470px,100%);background:linear-gradient(160deg,rgba(16,38,59,.98),rgba(8,23,38,.98));border:1px solid var(--line);border-radius:26px;padding:32px;box-shadow:var(--shadow)}.brandmark{width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,var(--blue),#2075e8);display:grid;place-items:center;font-weight:900;font-size:20px;box-shadow:0 12px 28px rgba(42,171,238,.25)}.lead{color:var(--muted);margin-bottom:24px}
    .field{display:grid;gap:7px;margin:14px 0}.field label,.label{font-size:13px;color:#bdd0df;font-weight:700}.input,.select,.textarea{width:100%;min-width:0;color:var(--text);background:#081725;border:1px solid var(--line);border-radius:12px;padding:11px 13px;transition:.18s;border-color:.18s;outline:0}.textarea{min-height:105px;resize:vertical}.input:focus,.select:focus,.textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(42,171,238,.12)}.hint,.counter{font-size:12px;color:var(--muted)}.counter{text-align:right;margin-top:-4px}
    .btn{border:0;border-radius:11px;padding:10px 15px;background:var(--blue2);color:white;font-weight:760;transition:.15s}.btn:hover{filter:brightness(1.1)}.btn:active{transform:translateY(1px)}.btn:disabled{opacity:.5;cursor:not-allowed}.btn.secondary{background:#17334c;border:1px solid #2a4e69;color:#dbeaf3}.btn.ghost{background:transparent;border:1px solid var(--line);color:#c1d3df}.btn.danger{background:rgba(255,114,128,.1);border:1px solid rgba(255,114,128,.28);color:#ff9da7}.btn.wide{width:100%;padding:13px}.btn.tiny{padding:7px 9px;font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}.error,.success,.notice{padding:10px 12px;border-radius:11px;margin-top:12px;font-size:13px}.error{color:#ffadb6;background:rgba(255,107,122,.1);border:1px solid rgba(255,107,122,.2)}.success{color:#82e9c2;background:rgba(53,212,154,.09);border:1px solid rgba(53,212,154,.2)}.notice{color:#ffe2a2;background:rgba(255,200,95,.08);border:1px solid rgba(255,200,95,.2)}
    .shell{min-height:100vh;display:grid;grid-template-columns:244px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;padding:22px 17px;display:flex;flex-direction:column;border-right:1px solid var(--line);background:rgba(6,17,30,.76);backdrop-filter:blur(16px);z-index:20}.side-brand{display:flex;gap:12px;align-items:center;padding:0 8px 22px}.side-brand .brandmark{width:41px;height:41px;border-radius:13px;font-size:17px}.brand-title{font-weight:850}.brand-sub{max-width:148px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:12px}.nav{display:grid;gap:5px}.nav button,.more-panel button{border:0;background:transparent;color:#9eb5c7;border-radius:11px;padding:10px 12px;text-align:left;font-weight:700;display:flex;gap:10px;align-items:center}.nav button:hover,.more-panel button:hover{background:#10253a;color:white}.nav button.active,.more-panel button.active{background:linear-gradient(90deg,rgba(42,171,238,.2),rgba(42,171,238,.05));color:#e0f5ff;box-shadow:inset 3px 0 var(--blue)}.nav-icon{width:22px;text-align:center;font-size:17px}.side-foot{margin-top:auto;border-top:1px solid var(--line);padding:17px 8px 0}.status-line{display:flex;align-items:center;gap:9px}.dot{width:9px;height:9px;border-radius:50%;background:var(--muted)}.dot.online{background:var(--green);box-shadow:0 0 0 4px rgba(54,211,154,.1)}.dot.error,.dot.reconnecting{background:var(--amber)}#moreBtn{display:none}.more-panel{display:none}
    .main{min-width:0;padding:27px 31px 70px}.content{max-width:1200px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:27px}.eyebrow{text-transform:uppercase;letter-spacing:.13em;color:var(--blue);font-size:11px;font-weight:850}.page-title{font-size:29px;font-weight:850;line-height:1.2;letter-spacing:-.04em}.top-actions{display:flex;gap:8px}.view{display:none}.view.active{display:block}.grid{display:grid;gap:15px}.stats{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:15px}.card{min-width:0;background:linear-gradient(155deg,rgba(16,38,59,.96),rgba(10,26,42,.96));border:1px solid var(--line);border-radius:17px;padding:19px;box-shadow:0 12px 34px rgba(0,0,0,.12)}.stat-label{font-size:12px;color:var(--muted);font-weight:700}.stat-value{font-size:30px;font-weight:880;letter-spacing:-.05em;margin:6px 0 1px}.stat-note,.card-note{font-size:12px;color:var(--muted)}.card-head,.section-head,.row-between{display:flex;align-items:center;justify-content:space-between;gap:14px}.card-head{margin-bottom:15px}.section-head{align-items:end;margin-bottom:17px}.section-copy{color:var(--muted);margin:3px 0 0}.split{grid-template-columns:minmax(0,1.35fr) minmax(290px,.65fr)}.dashboard-grid{grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr)}.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:15px}.quick button{text-align:left;padding:14px}.badge{display:inline-flex;max-width:100%;align-items:center;border-radius:999px;padding:4px 9px;background:rgba(42,171,238,.11);color:#93dcff;font-size:11px;font-weight:780}.badge.warn{background:rgba(255,200,95,.1);color:#ffdc8c}.badge.ok{background:rgba(54,211,154,.1);color:#77e7bd}.activity-item{display:flex;gap:11px;padding:11px 0;border-bottom:1px solid rgba(29,59,86,.72)}.activity-item:last-child{border:0}.avatar{width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:#173853;color:#a9dff9;display:grid;place-items:center;font-weight:850}.activity-main{min-width:0}.activity-name{font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-meta{font-size:11px;color:var(--muted)}.chart{height:170px;display:flex;align-items:end;gap:7px;padding-top:18px}.bar-wrap{height:100%;flex:1;min-width:5px;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:6px}.bar{width:100%;max-width:34px;min-height:4px;border-radius:6px 6px 2px 2px;background:linear-gradient(to top,#157bbd,var(--blue))}.bar-label{font-size:9px;color:#7893a8;transform:rotate(-35deg);white-space:nowrap}.error-list,.record-list,.history,.timeline{display:grid;gap:9px}.error-item,.record,.history-item,.timeline-item{background:#081a2a;border:1px solid var(--line);border-radius:13px;padding:13px}.error-item strong{display:block;margin-bottom:2px}
    .tabs{display:flex;gap:6px;padding:5px;background:#071725;border:1px solid var(--line);border-radius:12px;margin-bottom:16px;overflow:auto}.tabs button{flex:1;white-space:nowrap;border:0;border-radius:8px;padding:8px 11px;background:transparent;color:var(--muted);font-weight:750}.tabs button.active{background:#173a57;color:#e4f6ff}.pane{display:none}.pane.active{display:block}.form-grid{grid-template-columns:minmax(270px,.72fr) minmax(0,1.28fr)}.editor-grid{grid-template-columns:minmax(0,.85fr) minmax(320px,1.15fr)}.image-preview{aspect-ratio:16/10;margin:13px 0;border:1px dashed #315670;border-radius:14px;background:#071725;display:grid;place-items:center;overflow:hidden;color:var(--muted);text-align:center;padding:10px}.image-preview img{width:100%;height:100%;object-fit:cover;border-radius:9px}.record{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:12px;align-items:center}.record-thumb{width:76px;height:62px;border-radius:10px;background:#122c43;display:grid;place-items:center;color:#7898ae;overflow:hidden}.record-thumb img{width:100%;height:100%;object-fit:cover}.record-title{font-weight:790;overflow-wrap:anywhere}.record-meta{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.record-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.subsection{margin-top:19px}.check-row{display:flex;align-items:center;gap:9px;padding:9px 0}.toggle{appearance:none;width:41px;height:23px;border-radius:99px;background:#29455b;position:relative;flex:none}.toggle:after{content:"";position:absolute;width:17px;height:17px;border-radius:50%;background:white;top:3px;left:3px;transition:.18s}.toggle:checked{background:var(--blue2)}.toggle:checked:after{left:21px}.rule-tools{display:grid;grid-template-columns:minmax(0,1fr) 180px auto;gap:9px;margin-bottom:13px}.rule{display:grid;grid-template-columns:auto minmax(120px,.65fr) minmax(150px,1.35fr) auto;align-items:center;gap:11px}.rule.off{opacity:.55}.rule-answer{color:#b8cbd8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rule-order{display:flex;gap:4px}.users-layout{grid-template-columns:minmax(0,1.15fr) minmax(310px,.85fr)}.user-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.user-card{text-align:left;color:inherit;width:100%;border:1px solid var(--line);background:#081a2a;border-radius:13px;padding:13px}.user-card:hover,.user-card.active{border-color:#34739b;background:#0c2236}.tag-list{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.tag{font-size:10px;background:#17354e;color:#acd8ef;border-radius:99px;padding:3px 7px}.timeline-item.in{border-left:3px solid var(--blue)}.timeline-item.out{border-left:3px solid var(--green)}.timeline-text{overflow-wrap:anywhere}.broadcast-layout{grid-template-columns:minmax(0,1.1fr) minmax(310px,.9fr)}.language-checks{display:flex;gap:13px;flex-wrap:wrap}.preview{background:#eaf2f8;color:#172633;border-radius:18px;padding:14px;min-height:130px}.preview-bubble{background:white;border-radius:14px 14px 14px 4px;padding:11px 13px;box-shadow:0 4px 14px rgba(0,0,0,.1);white-space:pre-wrap;overflow-wrap:anywhere}.preview-button{margin-top:6px;background:#d7ecf7;color:#147db7;border-radius:9px;padding:8px;text-align:center;font-weight:700}.progress{height:6px;border-radius:99px;background:#1b3a51;margin-top:9px;overflow:hidden}.progress span{display:block;height:100%;background:var(--green)}.settings-grid{grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr)}.switch-row{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:14px;background:#081a2a;border:1px solid var(--line);border-radius:13px}.sticky-actions{position:sticky;bottom:10px;z-index:8;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding:10px 12px;background:rgba(8,24,39,.94);backdrop-filter:blur(10px);border:1px solid #2c5975;border-radius:13px;box-shadow:var(--shadow)}.empty{text-align:center;color:var(--muted);padding:30px 14px}.toast{position:fixed;right:20px;bottom:20px;z-index:60;max-width:min(390px,calc(100vw - 26px));background:#102d43;border:1px solid #31627e;padding:12px 15px;border-radius:12px;box-shadow:var(--shadow)}.dirty-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:55;width:min(620px,calc(100vw - 28px));display:flex;align-items:center;justify-content:space-between;gap:12px;background:#132f45;border:1px solid #3a7191;border-radius:14px;padding:10px 12px;box-shadow:var(--shadow)}
    @media(max-width:1000px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.split,.dashboard-grid,.form-grid,.editor-grid,.broadcast-layout,.settings-grid,.users-layout{grid-template-columns:1fr}.user-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:900px){.shell{display:block}.sidebar{position:fixed;left:0;right:0;top:auto;bottom:0;width:auto;height:auto;border:0;border-top:1px solid var(--line);padding:7px 8px;background:#071725}.side-brand,.side-foot{display:none}.nav{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}.nav button{min-width:0;justify-content:center;display:grid;text-align:center;gap:1px;padding:6px 3px;font-size:10px}.nav-icon{width:auto;font-size:17px}.nav .secondary-nav{display:none}#moreBtn{display:grid}.main{padding:22px 17px 110px}.more-panel{position:fixed;display:grid;right:10px;bottom:76px;width:210px;z-index:45;background:#0c2134;border:1px solid var(--line);border-radius:14px;padding:7px;box-shadow:var(--shadow)}.more-panel.hidden{display:none!important}.top-actions .refresh-label{display:none}.dirty-bar{bottom:82px}}
    @media(max-width:620px){.auth-card{padding:24px;border-radius:21px}.topbar{align-items:flex-start}.page-title{font-size:25px}.main{padding-left:12px;padding-right:12px}.card{padding:15px}.stats{grid-template-columns:1fr 1fr}.stat-value{font-size:25px}.quick{grid-template-columns:1fr}.section-head{align-items:flex-start;flex-direction:column}.rule-tools{grid-template-columns:1fr}.rule{grid-template-columns:auto 1fr}.rule-answer{grid-column:2}.rule .badge{grid-column:2}.rule-actions{grid-column:1/3}.record{grid-template-columns:58px minmax(0,1fr)}.record-thumb{width:58px;height:54px}.record-actions{grid-column:1/3;justify-content:stretch}.record-actions .btn{flex:1}.user-cards{grid-template-columns:1fr}.actions>.btn{flex:1}.dirty-bar{font-size:12px}.dirty-bar .actions{flex-wrap:nowrap}.dirty-bar .btn{padding:8px 9px}}
  </style>
</head>
<body>
  <section id="setupScreen" class="auth hidden"><form id="setupForm" class="auth-card"><div class="brandmark">TG</div><h1>Подключите бота</h1><p class="lead">Укажите токен из BotFather и придумайте пароль для панели. Это потребуется только один раз.</p><div class="field"><label for="setupToken">Токен Telegram-бота</label><input id="setupToken" class="input" autocomplete="off" placeholder="123456789:AA..." required><span class="hint">Токен проверяется напрямую через Telegram.</span></div><div class="field"><label for="setupPassword">Пароль администратора</label><input id="setupPassword" class="input" type="password" minlength="8" autocomplete="new-password" required><span class="hint">Минимум 8 символов.</span></div><button class="btn wide" type="submit">Подключить и запустить</button><div id="setupMessage"></div></form></section>
  <section id="loginScreen" class="auth hidden"><form id="loginForm" class="auth-card"><div class="brandmark">TG</div><h1>Пульт бота</h1><p class="lead">Введите пароль администратора.</p><div class="field"><label for="loginPassword">Пароль</label><input id="loginPassword" class="input" type="password" autocomplete="current-password" required autofocus></div><button class="btn wide" type="submit">Войти</button><div id="loginMessage"></div></form></section>

  <div id="app" class="shell hidden">
    <aside class="sidebar">
      <div class="side-brand"><div class="brandmark">TG</div><div><div class="brand-title">Пульт бота</div><div id="botUsername" class="brand-sub">Telegram</div></div></div>
      <nav id="nav" class="nav" aria-label="Основная навигация">
        <button class="active" data-view="dashboard"><span class="nav-icon">⌁</span><span>Обзор</span></button>
        <button data-view="content"><span class="nav-icon">▦</span><span>Контент</span></button>
        <button class="secondary-nav" data-view="rules"><span class="nav-icon">≡</span><span>Ответы</span></button>
        <button data-view="users"><span class="nav-icon">◉</span><span>Пользователи</span></button>
        <button class="secondary-nav" data-view="broadcast"><span class="nav-icon">↗</span><span>Рассылки</span></button>
        <button class="secondary-nav" data-view="settings"><span class="nav-icon">⚙</span><span>Настройки</span></button>
        <button id="moreBtn" type="button"><span class="nav-icon">•••</span><span>Ещё</span></button>
      </nav>
      <div class="side-foot"><div class="status-line"><span id="sideDot" class="dot"></span><span id="sideStatus">Проверка связи</span></div></div>
    </aside>
    <div id="morePanel" class="more-panel hidden"><button data-view="rules"><span class="nav-icon">≡</span>Ответы</button><button data-view="broadcast"><span class="nav-icon">↗</span>Рассылки</button><button data-view="settings"><span class="nav-icon">⚙</span>Настройки</button></div>

    <main class="main">
      <header class="topbar"><div><div class="eyebrow">Центр управления</div><div id="pageTitle" class="page-title">Обзор</div></div><div class="top-actions"><button id="refreshBtn" class="btn secondary"><span class="refresh-label">Обновить</span><span aria-hidden="true"> ↻</span></button><button id="logoutBtn" class="btn danger">Выйти</button></div></header>
      <div class="content">
        <section id="view-dashboard" class="view active">
          <div class="grid stats"><div class="card"><div class="stat-label">Пользователи</div><div id="statUsers" class="stat-value">0</div><div id="statActiveUsers" class="stat-note">0 доступны</div></div><div class="card"><div class="stat-label">Получено сообщений</div><div id="statReceived" class="stat-value">0</div><div class="stat-note">за всё время</div></div><div class="card"><div class="stat-label">Отправлено</div><div id="statSent" class="stat-value">0</div><div class="stat-note">ответы и рассылки</div></div><div class="card"><div class="stat-label">Активные правила</div><div id="statRules" class="stat-value">0</div><div id="statRulesEnabled" class="stat-note">0 всего</div></div></div>
          <div class="quick"><button class="btn secondary quick-link" data-view="content">＋ Добавить объект</button><button class="btn secondary quick-link" data-view="broadcast">↗ Создать рассылку</button><button class="btn secondary quick-link" data-view="rules">≡ Добавить ответ</button></div>
          <div class="grid dashboard-grid"><div class="card"><div class="card-head"><div><h3>Активность за 14 дней</h3><div class="card-note">Реальные входящие и исходящие сообщения</div></div><span id="dashboardStatus" class="badge">—</span></div><div id="activityChart" class="chart" aria-label="График активности"></div></div><div class="card"><div class="card-head"><div><h3>Недавние пользователи</h3><div class="card-note">Последние диалоги</div></div></div><div id="recentUsers"></div></div></div>
          <div class="card subsection"><div class="card-head"><div><h3>Журнал ошибок</h3><div class="card-note">Последние проблемы подключения и отправки</div></div><button id="clearErrorsBtn" class="btn ghost tiny">Очистить</button></div><div id="errorList" class="error-list"></div></div>
        </section>

        <section id="view-content" class="view">
          <div class="section-head"><div><h2>Контент бота</h2><p class="section-copy">Приветствие, каталог объектов, акции и контакты в одном месте.</p></div></div>
          <div id="contentTabs" class="tabs" role="tablist"><button class="active" data-content-tab="intro" role="tab" aria-selected="true">Приветствие</button><button data-content-tab="objects" role="tab">Объекты</button><button data-content-tab="promotions" role="tab">Акции</button><button data-content-tab="contacts" role="tab">Контакты</button></div>
          <div id="content-intro" class="pane active">
            <form id="introForm" data-saveable>
              <div id="introLangTabs" class="tabs" data-tabs="intro"><button class="active" data-language="ru">Русский</button><button data-language="en">English</button><button data-language="es">Español</button></div>
              <div class="pane active" data-pane-group="intro" data-language="ru"><div class="grid form-grid"><div class="card"><h3>Приветственное изображение</h3><div class="card-note">JPG или PNG до 5 МБ</div><div id="welcomePreviewRu" class="image-preview">Изображение не загружено</div><input id="welcomeFileRu" class="input" type="file" accept="image/jpeg,image/png"><button class="btn danger tiny stage-remove-welcome" data-language="ru" type="button">Удалить изображение</button></div><div class="card intro-fields" data-language="ru"></div></div></div>
              <div class="pane" data-pane-group="intro" data-language="en"><div class="grid form-grid"><div class="card"><h3>Welcome image</h3><div class="card-note">JPG or PNG up to 5 MB</div><div id="welcomePreviewEn" class="image-preview">No image uploaded</div><input id="welcomeFileEn" class="input" type="file" accept="image/jpeg,image/png"><button class="btn danger tiny stage-remove-welcome" data-language="en" type="button">Remove image</button></div><div class="card intro-fields" data-language="en"></div></div></div>
              <div class="pane" data-pane-group="intro" data-language="es"><div class="grid form-grid"><div class="card"><h3>Imagen de bienvenida</h3><div class="card-note">JPG o PNG hasta 5 MB</div><div id="welcomePreviewEs" class="image-preview">No hay imagen</div><input id="welcomeFileEs" class="input" type="file" accept="image/jpeg,image/png"><button class="btn danger tiny stage-remove-welcome" data-language="es" type="button">Eliminar imagen</button></div><div class="card intro-fields" data-language="es"></div></div></div>
              <div class="sticky-actions"><span class="muted">Сохраните тексты и изображение одной кнопкой</span><button class="btn" type="submit">Сохранить приветствие</button></div>
            </form>
          </div>
          <div id="content-objects" class="pane"><div class="grid editor-grid"><div class="card"><div class="card-head"><div><h3>Каталог объектов</h3><div class="card-note">Активные карточки показываются пользователю по порядку</div></div><button id="newObjectBtn" class="btn tiny">＋ Новый</button></div><div id="objectList" class="record-list"></div></div><form id="objectForm" class="card" data-saveable><input id="objectId" type="hidden"><div class="row-between"><h3 id="objectFormTitle">Новый объект</h3><span id="objectImageNote" class="badge">Без изображения</span></div><div class="field"><label for="objectStatus">Статус</label><select id="objectStatus" class="select"><option value="active">Показывать</option><option value="hidden">Скрыт</option><option value="sold">Продан</option></select></div><div id="objectLangTabs" class="tabs" data-tabs="object"><button class="active" data-language="ru">RU</button><button data-language="en">EN</button><button data-language="es">ES</button></div><div class="entity-panes" data-entity="object"></div><div class="field"><label for="objectPrice">Цена или подпись к цене</label><input id="objectPrice" class="input" maxlength="120" placeholder="от 120 000 €"></div><div class="field"><label for="objectUrl">Ссылка «Подробнее»</label><input id="objectUrl" class="input" type="url" placeholder="https://..."></div><div class="field"><label for="objectImage">Изображение</label><input id="objectImage" class="input" type="file" accept="image/jpeg,image/png"></div><label class="check-row"><input id="objectRemoveImage" type="checkbox"> Удалить текущее изображение</label><div class="actions"><button class="btn" type="submit">Сохранить объект</button><button id="cancelObjectBtn" class="btn ghost" type="button">Очистить</button></div></form></div></div>
          <div id="content-promotions" class="pane"><div class="grid editor-grid"><div class="card"><div class="card-head"><div><h3>Акции</h3><div class="card-note">Период действия включается и завершается автоматически</div></div><button id="newPromotionBtn" class="btn tiny">＋ Новая</button></div><div id="promotionList" class="record-list"></div></div><form id="promotionForm" class="card" data-saveable><input id="promotionId" type="hidden"><div class="row-between"><h3 id="promotionFormTitle">Новая акция</h3><span id="promotionImageNote" class="badge">Без изображения</span></div><label class="check-row"><input id="promotionEnabled" class="toggle" type="checkbox" checked> Акция включена</label><div id="promotionLangTabs" class="tabs" data-tabs="promotion"><button class="active" data-language="ru">RU</button><button data-language="en">EN</button><button data-language="es">ES</button></div><div class="entity-panes" data-entity="promotion"></div><div class="grid" style="grid-template-columns:1fr 1fr"><div class="field"><label for="promotionStart">Начало</label><input id="promotionStart" class="input" type="datetime-local"></div><div class="field"><label for="promotionEnd">Окончание</label><input id="promotionEnd" class="input" type="datetime-local"></div></div><div class="field"><label for="promotionUrl">Ссылка «Подробнее»</label><input id="promotionUrl" class="input" type="url" placeholder="https://..."></div><div class="field"><label for="promotionImage">Изображение</label><input id="promotionImage" class="input" type="file" accept="image/jpeg,image/png"></div><label class="check-row"><input id="promotionRemoveImage" type="checkbox"> Удалить текущее изображение</label><div class="actions"><button class="btn" type="submit">Сохранить акцию</button><button id="cancelPromotionBtn" class="btn ghost" type="button">Очистить</button></div></form></div></div>
          <div id="content-contacts" class="pane"><form id="contactsForm" data-saveable><div class="grid form-grid"><div class="card"><h3>Каналы связи</h3><div class="field"><label for="contactPhone">Телефон</label><input id="contactPhone" class="input" maxlength="80" placeholder="+34 ..."></div><div class="field"><label for="contactTelegram">Telegram</label><input id="contactTelegram" class="input" maxlength="500" placeholder="@username или https://t.me/..."></div><div class="field"><label for="contactWebsite">Сайт</label><input id="contactWebsite" class="input" type="url" placeholder="https://..."></div><div class="field"><label for="contactMap">Ссылка на карту</label><input id="contactMap" class="input" type="url" placeholder="https://maps.google.com/..."></div></div><div class="card"><h3>Вводный текст</h3><div class="field"><label for="contactTextRu">Русский</label><textarea id="contactTextRu" class="textarea" maxlength="2000"></textarea></div><div class="field"><label for="contactTextEn">English</label><textarea id="contactTextEn" class="textarea" maxlength="2000"></textarea></div><div class="field"><label for="contactTextEs">Español</label><textarea id="contactTextEs" class="textarea" maxlength="2000"></textarea></div><button class="btn" type="submit">Сохранить контакты</button></div></div></form></div>
        </section>

        <section id="view-rules" class="view">
          <div class="section-head"><div><h2>Автоматические ответы</h2><p class="section-copy">Порядок важен: бот применяет первое подходящее правило.</p></div></div>
          <div class="grid split"><form id="ruleForm" class="card" data-saveable><input id="ruleId" type="hidden"><h3 id="ruleFormTitle">Новое правило</h3><div class="field"><label for="ruleTrigger">Фраза пользователя</label><input id="ruleTrigger" class="input" maxlength="200" required></div><div class="grid" style="grid-template-columns:1fr 1fr"><div class="field"><label for="ruleType">Условие</label><select id="ruleType" class="select"><option value="contains">Содержит</option><option value="exact">Точное совпадение</option><option value="starts">Начинается с</option></select></div><div class="field"><label for="ruleLanguage">Язык</label><select id="ruleLanguage" class="select"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="all">Все языки</option></select></div></div><div class="field"><label for="ruleAnswer">Ответ</label><textarea id="ruleAnswer" class="textarea" maxlength="4000" required></textarea></div><div class="actions"><button class="btn" type="submit">Сохранить</button><button id="cancelRuleBtn" class="btn ghost" type="button">Очистить</button></div></form><form id="ruleTestForm" class="card"><h3>Проверить сообщение</h3><div class="card-note">Покажет правило, которое сработает первым</div><div class="field"><label for="ruleTestText">Сообщение</label><input id="ruleTestText" class="input" required placeholder="Например: здравствуйте"></div><div class="field"><label for="ruleTestLanguage">Язык</label><select id="ruleTestLanguage" class="select"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div><button class="btn secondary" type="submit">Проверить</button><div id="ruleTestResult"></div></form></div>
          <div class="card subsection"><div class="rule-tools"><input id="ruleSearch" class="input" placeholder="Поиск по фразе или ответу"><select id="ruleFilterLanguage" class="select"><option value="">Все языки</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="all">Все языки</option></select><span id="ruleCount" class="badge">0</span></div><div id="rulesList" class="record-list"></div></div>
        </section>

        <section id="view-users" class="view">
          <div class="section-head"><div><h2>Пользователи</h2><p class="section-copy">Поиск, язык, теги, заметки и последние сообщения.</p></div></div>
          <div class="grid users-layout"><div class="card"><div class="grid" style="grid-template-columns:minmax(0,1fr) 170px"><input id="userSearch" class="input" placeholder="Имя, username, ID или тег"><select id="userLanguageFilter" class="select"><option value="">Все языки</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="unknown">Не выбран</option></select></div><div id="userCards" class="user-cards subsection"></div></div><div id="userDetail" class="card"><div class="empty">Выберите пользователя</div></div></div>
        </section>

        <section id="view-broadcast" class="view">
          <div class="section-head"><div><h2>Рассылки</h2><p class="section-copy">Выберите аудиторию, проверьте сообщение и отправьте сейчас или по расписанию.</p></div></div>
          <div class="grid broadcast-layout"><form id="broadcastForm" class="card" data-saveable><input id="broadcastId" type="hidden"><div class="row-between"><h3 id="broadcastFormTitle">Новая рассылка</h3><span id="recipientEstimate" class="badge">0 получателей</span></div><div class="field"><span class="label">Языки аудитории</span><div class="language-checks"><label><input class="broadcast-language" type="checkbox" value="ru" checked> Русский</label><label><input class="broadcast-language" type="checkbox" value="en" checked> English</label><label><input class="broadcast-language" type="checkbox" value="es" checked> Español</label></div></div><div class="field"><label for="broadcastTags">Теги аудитории</label><input id="broadcastTags" class="input" placeholder="vip, investor"><span class="hint">Пусто — все пользователи выбранных языков.</span></div><div id="broadcastLangTabs" class="tabs" data-tabs="broadcast"><button class="active" data-language="ru">RU</button><button data-language="en">EN</button><button data-language="es">ES</button></div><div class="entity-panes" data-entity="broadcast"></div><div class="field"><label for="broadcastImage">Изображение</label><input id="broadcastImage" class="input" type="file" accept="image/jpeg,image/png"></div><label class="check-row"><input id="broadcastRemoveImage" type="checkbox"> Удалить текущее изображение</label><div class="field"><label for="broadcastButtonUrl">Ссылка кнопки</label><input id="broadcastButtonUrl" class="input" type="url" placeholder="https://..."></div><div class="grid" style="grid-template-columns:repeat(3,1fr)"><div class="field"><label for="broadcastButtonRu">Кнопка RU</label><input id="broadcastButtonRu" class="input" maxlength="80"></div><div class="field"><label for="broadcastButtonEn">Button EN</label><input id="broadcastButtonEn" class="input" maxlength="80"></div><div class="field"><label for="broadcastButtonEs">Botón ES</label><input id="broadcastButtonEs" class="input" maxlength="80"></div></div><div class="field"><label for="broadcastSchedule">Дата и время отправки</label><input id="broadcastSchedule" class="input" type="datetime-local"></div><div class="field"><label for="broadcastTestUser">Получатель теста</label><select id="broadcastTestUser" class="select"><option value="">Выберите пользователя</option></select></div><div class="actions"><button class="btn ghost" data-mode="draft" type="submit">Сохранить черновик</button><button class="btn secondary" data-mode="test" type="submit">Тест</button><button class="btn secondary" data-mode="schedule" type="submit">Запланировать</button><button id="broadcastSendBtn" class="btn" data-mode="send" type="submit">Отправить сейчас</button></div></form><div><div class="card"><div class="card-head"><div><h3>Предпросмотр</h3><div class="card-note">Подстановка данных показана на примере</div></div><select id="previewLanguage" class="select" style="width:auto"><option value="ru">RU</option><option value="en">EN</option><option value="es">ES</option></select></div><div class="preview"><div id="broadcastPreview" class="preview-bubble">Введите текст сообщения</div></div></div><div class="card subsection"><h3>История и черновики</h3><div id="broadcastHistory" class="history subsection"></div></div></div></div>
        </section>

        <section id="view-settings" class="view">
          <div class="section-head"><div><h2>Настройки</h2><p class="section-copy">Тексты отделены от технических параметров и резервных копий.</p></div></div>
          <div class="grid settings-grid"><form id="messagesForm" class="card" data-saveable><h3>Системные сообщения</h3><div id="messageLangTabs" class="tabs" data-tabs="messages"><button class="active" data-language="ru">Русский</button><button data-language="en">English</button><button data-language="es">Español</button></div><div class="entity-panes" data-entity="messages"></div><div class="hint">Можно использовать {first_name}, {last_name}, {username}</div><button class="btn subsection" type="submit">Сохранить тексты</button></form><div><form id="technicalForm" class="card" data-saveable><h3>Подключение и безопасность</h3><div class="switch-row"><div><strong>Бот включен</strong><div class="card-note">При выключении новые сообщения не обрабатываются</div></div><input id="settingActive" class="toggle" type="checkbox" aria-label="Бот включен"></div><div class="field"><label for="settingToken">Новый токен</label><input id="settingToken" class="input" autocomplete="off" placeholder="Оставьте пустым, чтобы не менять"><span class="hint">Текущий токен не показывается.</span></div><button id="tokenTestBtn" class="btn secondary tiny" type="button">Проверить токен</button><div class="field"><label for="settingPassword">Новый пароль</label><input id="settingPassword" class="input" type="password" minlength="8" autocomplete="new-password"></div><div class="field"><label for="settingPasswordConfirm">Повторите пароль</label><input id="settingPasswordConfirm" class="input" type="password" minlength="8" autocomplete="new-password"></div><button class="btn" type="submit">Сохранить технические настройки</button></form><div class="card subsection"><h3>Резервная копия</h3><p class="card-note">Копия содержит настройки, контент и пользователей. Храните файл в безопасном месте.</p><div class="actions"><a class="btn secondary" href="/api/backup">Скачать копию</a><label class="btn ghost">Восстановить<input id="restoreFile" type="file" accept="application/json" hidden></label></div></div></div></div>
        </section>
      </div>
    </main>
  </div>
  <div id="toast" class="toast hidden" role="status" aria-live="polite"></div>
  <div id="dirtyBar" class="dirty-bar hidden"><span>Есть несохранённые изменения</span><div class="actions"><button id="discardChangesBtn" class="btn ghost tiny">Отменить</button><button id="saveChangesBtn" class="btn tiny">Сохранить</button></div></div>

  <script>
  (function(){
    "use strict";
    var state=null,csrf="",currentView="dashboard",refreshTimer=null,selectedUserId="",dirty=new Set(),activeDirty=null,ignoreDirty=false;
    var welcomeRemove={ru:false,en:false,es:false};
    var titles={dashboard:"Обзор",content:"Контент",rules:"Автоматические ответы",users:"Пользователи",broadcast:"Рассылки",settings:"Настройки"};
    var languages=["ru","en","es"];
    function el(id){return document.getElementById(id)}
    function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
    function fmtNumber(value){return new Intl.NumberFormat("ru-RU").format(Number(value||0))}
    function fmtDate(value){if(!value)return "—";try{return new Intl.DateTimeFormat("ru-RU",{dateStyle:"short",timeStyle:"short"}).format(new Date(value))}catch(e){return "—"}}
    function localDate(value){if(!value)return "";var date=new Date(value);if(!Number.isFinite(date.getTime()))return "";var local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
    function api(url,options){options=options||{};options.headers=Object.assign({"content-type":"application/json"},options.headers||{});if(options.method&&options.method!=="GET")options.headers["x-csrf-token"]=csrf;return fetch(url,options).then(async function(response){var body={};try{body=await response.json()}catch(e){}if(!response.ok){var error=new Error(body.error||"Ошибка запроса");error.status=response.status;throw error}return body})}
    function message(target,text,ok){target.innerHTML='<div class="'+(ok?"success":"error")+'">'+esc(text)+"</div>"}
    function toast(text){var box=el("toast");box.textContent=text;box.classList.remove("hidden");clearTimeout(box._timer);box._timer=setTimeout(function(){box.classList.add("hidden")},3600)}
    function setScreen(name){["setupScreen","loginScreen","app"].forEach(function(id){el(id).classList.toggle("hidden",id!==name)})}
    function userName(user){return [user.firstName,user.lastName].filter(Boolean).join(" ")||"Без имени"}
    function initials(user){return ([user.firstName,user.lastName].filter(Boolean).map(function(x){return x[0]}).join("").slice(0,2)||"?").toUpperCase()}
    function languageLabel(value){return {ru:"Русский",en:"English",es:"Español",all:"Все языки"}[value]||"Не выбран"}
    function statusLabel(value){return {online:"На связи",connecting:"Подключение",reconnecting:"Восстановление связи",stopped:"Остановлен",error:"Ошибка"}[value]||value}
    function localized(value,language){return value&&typeof value==="object"?(value[language]||value.ru||value.en||value.es||""):""}
    function fileData(file){return new Promise(function(resolve,reject){if(!file)return resolve("");if(file.size>5*1024*1024)return reject(new Error("Изображение больше 5 МБ"));var reader=new FileReader();reader.onload=function(){resolve(reader.result)};reader.onerror=function(){reject(new Error("Не удалось прочитать файл"))};reader.readAsDataURL(file)})}
    function markDirty(form){if(ignoreDirty||!form)return;dirty.add(form);activeDirty=form;refreshDirty()}
    function clearDirty(form){dirty.delete(form);if(activeDirty===form)activeDirty=Array.from(dirty).pop()||null;refreshDirty()}
    function refreshDirty(){el("dirtyBar").classList.toggle("hidden",dirty.size===0)}
    function discardAll(){dirty.clear();activeDirty=null;welcomeRemove={ru:false,en:false,es:false};refreshDirty();loadState()}
    function safeNavigate(view){if(dirty.size&&!confirm("Есть несохранённые изменения. Покинуть раздел и отменить их?"))return;discardAll();switchView(view)}
    async function boot(){try{var status=await api("/api/status");if(!status.configured){setScreen("setupScreen");return}try{await loadState();setScreen("app");startRefresh()}catch(e){setScreen("loginScreen")}}catch(e){setScreen("loginScreen");message(el("loginMessage"),"Не удалось связаться с сервером",false)}}
    function startRefresh(){clearInterval(refreshTimer);refreshTimer=setInterval(function(){loadState(true)},7000)}
    async function loadState(silent){try{state=await api("/api/state");csrf=state.csrf;render();return state}catch(e){if(e.status===401){clearInterval(refreshTimer);setScreen("loginScreen");if(!silent)throw e}else if(!silent)throw e}}
    function render(){if(!state)return;ignoreDirty=true;el("botUsername").textContent=state.bot.username?"@"+state.bot.username:(state.bot.firstName||"Telegram");var status=state.runtime.status;el("sideStatus").textContent=statusLabel(status);el("sideDot").className="dot "+status;el("dashboardStatus").textContent=statusLabel(status);el("dashboardStatus").className="badge "+(status==="online"?"ok":"warn");el("statUsers").textContent=fmtNumber(state.userCount);el("statActiveUsers").textContent=fmtNumber(state.activeUserCount)+" доступны";el("statReceived").textContent=fmtNumber(state.stats.messagesReceived);el("statSent").textContent=fmtNumber(state.stats.messagesSent);el("statRules").textContent=fmtNumber(state.rules.filter(function(x){return x.enabled}).length);el("statRulesEnabled").textContent=fmtNumber(state.rules.length)+" всего";renderDashboard();renderIntro();renderObjects();renderPromotions();renderContacts();renderRules();renderUsers();renderBroadcasts();renderSettings();addCounters();ignoreDirty=false}
    function renderDashboard(){var users=state.users.slice(0,4);el("recentUsers").innerHTML=users.length?users.map(function(u){return '<div class="activity-item"><div class="avatar">'+esc(initials(u))+'</div><div class="activity-main"><div class="activity-name">'+esc(userName(u))+'</div><div class="activity-meta">'+fmtNumber(u.messages)+" сообщ. · "+esc(fmtDate(u.lastSeenAt))+"</div></div></div>"}).join(""):'<div class="empty">Пока никто не написал</div>';var points=[],max=1;for(var i=13;i>=0;i--){var d=new Date();d.setUTCDate(d.getUTCDate()-i);var key=d.toISOString().slice(0,10),v=state.analytics.daily[key]||{},total=Number(v.received||0)+Number(v.sent||0);max=Math.max(max,total);points.push({key:key,total:total})}el("activityChart").innerHTML=points.map(function(p){return '<div class="bar-wrap" title="'+esc(p.key+": "+p.total)+'"><div class="bar" style="height:'+Math.max(4,Math.round(p.total/max*100))+'%"></div><span class="bar-label">'+esc(p.key.slice(5))+"</span></div>"}).join("");el("errorList").innerHTML=state.errors.length?state.errors.slice(0,8).map(function(item){return '<div class="error-item"><strong>'+esc(item.area||"Ошибка")+'</strong><div class="danger-text">'+esc(item.message)+'</div><div class="small muted">'+esc(fmtDate(item.createdAt))+"</div></div>"}).join(""):'<div class="empty">Ошибок не зафиксировано</div>';el("clearErrorsBtn").disabled=!state.errors.length}
    function introFields(language){var labels={ru:["Наши объекты — резервный текст","Контакты — резервный текст","Акции — резервный текст","О нас"],en:["Our properties — fallback","Contacts — fallback","Special offers — fallback","About us"],es:["Inmuebles — texto alternativo","Contactos — texto alternativo","Promociones — texto alternativo","Sobre nosotros"]}[language];var keys=["objects","contacts","promotions","about"],suffix=language[0].toUpperCase()+language.slice(1);return keys.map(function(key,index){return '<div class="field"><label for="menu'+key+suffix+'">'+esc(labels[index])+'</label><textarea id="menu'+key+suffix+'" class="textarea" maxlength="4000" required></textarea></div>'}).join("")}
    function renderIntro(){document.querySelectorAll(".intro-fields").forEach(function(node){if(!node.children.length)node.innerHTML=introFields(node.dataset.language)});if(dirty.has(el("introForm")))return;languages.forEach(function(language){var suffix=language[0].toUpperCase()+language.slice(1),menu=state.config.menu[language];["objects","contacts","promotions","about"].forEach(function(key){el("menu"+key+suffix).value=menu[key]});var meta=state.welcomeImages[language],preview=el("welcomePreview"+suffix);preview.innerHTML=meta&&meta.exists?'<img src="/api/images/'+language+'/welcome?rev='+encodeURIComponent(meta.updatedAt||"")+'" alt="Приветственное изображение">':"<span>Изображение не загружено</span>";welcomeRemove[language]=false})}
    function entityFields(kind,language){var suffix=language[0].toUpperCase()+language.slice(1),titleLabel=language==="ru"?"Название":language==="en"?"Title":"Título";if(kind==="object")return '<div class="pane '+(language==="ru"?"active":"")+'" data-pane-group="object" data-language="'+language+'"><div class="field"><label for="objectTitle'+suffix+'">'+titleLabel+'</label><input id="objectTitle'+suffix+'" class="input" maxlength="160"></div><div class="field"><label for="objectAddress'+suffix+'">'+(language==="ru"?"Адрес":language==="en"?"Address":"Dirección")+'</label><input id="objectAddress'+suffix+'" class="input" maxlength="500"></div><div class="field"><label for="objectDescription'+suffix+'">'+(language==="ru"?"Описание":language==="en"?"Description":"Descripción")+'</label><textarea id="objectDescription'+suffix+'" class="textarea" maxlength="3000"></textarea></div></div>';if(kind==="promotion")return '<div class="pane '+(language==="ru"?"active":"")+'" data-pane-group="promotion" data-language="'+language+'"><div class="field"><label for="promotionTitle'+suffix+'">'+titleLabel+'</label><input id="promotionTitle'+suffix+'" class="input" maxlength="160"></div><div class="field"><label for="promotionText'+suffix+'">'+(language==="ru"?"Описание":language==="en"?"Description":"Descripción")+'</label><textarea id="promotionText'+suffix+'" class="textarea" maxlength="3000"></textarea></div></div>';if(kind==="broadcast")return '<div class="pane '+(language==="ru"?"active":"")+'" data-pane-group="broadcast" data-language="'+language+'"><div class="field"><label for="broadcastText'+suffix+'">'+(language==="ru"?"Сообщение":language==="en"?"Message":"Mensaje")+'</label><textarea id="broadcastText'+suffix+'" class="textarea broadcast-text" maxlength="4000" placeholder="{first_name}, ..."></textarea></div></div>';return '<div class="pane '+(language==="ru"?"active":"")+'" data-pane-group="messages" data-language="'+language+'"><div class="field"><label for="settingGreeting'+suffix+'">Приветствие</label><textarea id="settingGreeting'+suffix+'" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingHelp'+suffix+'">Ответ /help</label><textarea id="settingHelp'+suffix+'" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="settingFallback'+suffix+'">Если ответ не найден</label><textarea id="settingFallback'+suffix+'" class="textarea" maxlength="4000"></textarea></div></div>'}
    function ensureEntityFields(){document.querySelectorAll(".entity-panes").forEach(function(container){if(container.children.length)return;container.innerHTML=languages.map(function(language){return entityFields(container.dataset.entity,language)}).join("")})}
    function recordThumb(collection,item){return item.image&&item.image.exists?'<img src="/api/media/'+collection+"/"+encodeURIComponent(item.id)+"?rev="+encodeURIComponent(item.image.updatedAt||"")+'" alt="">':"▧"}
    function renderObjects(){ensureEntityFields();el("objectList").innerHTML=state.objects.length?state.objects.map(function(item){var status={active:"Показывается",hidden:"Скрыт",sold:"Продан"}[item.status]||item.status;return '<div class="record"><div class="record-thumb">'+recordThumb("objects",item)+'</div><div><div class="record-title">'+esc(localized(item.title,"ru")||"Без названия")+'</div><div class="record-meta">'+esc(status)+(item.price?" · "+esc(item.price):"")+"</div></div><div class=\"record-actions\"><button class=\"btn secondary tiny edit-object\" data-id=\""+esc(item.id)+"\">Изменить</button><button class=\"btn danger tiny delete-object\" data-id=\""+esc(item.id)+"\">Удалить</button></div></div>"}).join(""):'<div class="empty">Добавьте первый объект</div>'}
    function renderPromotions(){ensureEntityFields();el("promotionList").innerHTML=state.promotions.length?state.promotions.map(function(item){var active=item.enabled&&(!item.startAt||Date.parse(item.startAt)<=Date.now())&&(!item.endAt||Date.parse(item.endAt)>=Date.now());return '<div class="record"><div class="record-thumb">'+recordThumb("promotions",item)+'</div><div><div class="record-title">'+esc(localized(item.title,"ru")||"Без названия")+'</div><div class="record-meta">'+(active?"Активна":item.enabled?"Вне периода":"Выключена")+(item.endAt?" · до "+esc(fmtDate(item.endAt)):"")+"</div></div><div class=\"record-actions\"><button class=\"btn secondary tiny edit-promotion\" data-id=\""+esc(item.id)+"\">Изменить</button><button class=\"btn danger tiny delete-promotion\" data-id=\""+esc(item.id)+"\">Удалить</button></div></div>"}).join(""):'<div class="empty">Акций пока нет</div>'}
    function renderContacts(){if(dirty.has(el("contactsForm")))return;el("contactPhone").value=state.contacts.phone||"";el("contactTelegram").value=state.contacts.telegram||"";el("contactWebsite").value=state.contacts.website||"";el("contactMap").value=state.contacts.mapUrl||"";languages.forEach(function(language){var suffix=language[0].toUpperCase()+language.slice(1);el("contactText"+suffix).value=state.contacts.text[language]||""})}
    function resetObject(){ignoreDirty=true;el("objectForm").reset();el("objectId").value="";el("objectFormTitle").textContent="Новый объект";el("objectImageNote").textContent="Без изображения";languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("objectTitle"+s).value="";el("objectAddress"+s).value="";el("objectDescription"+s).value=""});clearDirty(el("objectForm"));ignoreDirty=false}
    function editObject(id){var item=state.objects.find(function(x){return x.id===id});if(!item)return;ignoreDirty=true;el("objectId").value=id;el("objectFormTitle").textContent="Редактирование объекта";el("objectStatus").value=item.status;el("objectPrice").value=item.price||"";el("objectUrl").value=item.url||"";el("objectImageNote").textContent=item.image&&item.image.exists?item.image.name:"Без изображения";languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("objectTitle"+s).value=item.title[language]||"";el("objectAddress"+s).value=item.address[language]||"";el("objectDescription"+s).value=item.description[language]||""});clearDirty(el("objectForm"));ignoreDirty=false;el("objectForm").scrollIntoView({behavior:"smooth",block:"start"})}
    function resetPromotion(){ignoreDirty=true;el("promotionForm").reset();el("promotionId").value="";el("promotionEnabled").checked=true;el("promotionFormTitle").textContent="Новая акция";el("promotionImageNote").textContent="Без изображения";languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("promotionTitle"+s).value="";el("promotionText"+s).value=""});clearDirty(el("promotionForm"));ignoreDirty=false}
    function editPromotion(id){var item=state.promotions.find(function(x){return x.id===id});if(!item)return;ignoreDirty=true;el("promotionId").value=id;el("promotionEnabled").checked=item.enabled;el("promotionStart").value=localDate(item.startAt);el("promotionEnd").value=localDate(item.endAt);el("promotionUrl").value=item.url||"";el("promotionFormTitle").textContent="Редактирование акции";el("promotionImageNote").textContent=item.image&&item.image.exists?item.image.name:"Без изображения";languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("promotionTitle"+s).value=item.title[language]||"";el("promotionText"+s).value=item.text[language]||""});clearDirty(el("promotionForm"));ignoreDirty=false;el("promotionForm").scrollIntoView({behavior:"smooth",block:"start"})}
    function typeLabel(type){return {contains:"содержит",exact:"точно",starts:"начинается"}[type]||type}
    function filteredRules(){var q=el("ruleSearch").value.toLocaleLowerCase("ru-RU").trim(),lang=el("ruleFilterLanguage").value;return state.rules.slice().sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}).filter(function(rule){return (!lang||rule.language===lang)&&(!q||(rule.trigger+" "+rule.answer).toLocaleLowerCase("ru-RU").includes(q))})}
    function renderRules(){var rules=filteredRules();el("ruleCount").textContent=rules.length+" правил";el("rulesList").innerHTML=rules.length?rules.map(function(r,index){return '<div class="record rule '+(r.enabled?"":"off")+'"><input class="toggle rule-toggle" data-id="'+esc(r.id)+'" type="checkbox" '+(r.enabled?"checked":"")+' aria-label="Правило включено"><div><div class="record-title">'+esc(r.trigger)+'</div><span class="badge">'+esc(typeLabel(r.type)+" · "+languageLabel(r.language))+'</span></div><div class="rule-answer" title="'+esc(r.answer)+'">'+esc(r.answer)+'</div><div class="record-actions rule-actions"><span class="rule-order"><button class="btn ghost tiny move-rule" data-id="'+esc(r.id)+'" data-step="-1" aria-label="Поднять">↑</button><button class="btn ghost tiny move-rule" data-id="'+esc(r.id)+'" data-step="1" aria-label="Опустить">↓</button></span><button class="btn secondary tiny edit-rule" data-id="'+esc(r.id)+'">Изменить</button><button class="btn ghost tiny duplicate-rule" data-id="'+esc(r.id)+'">Копия</button><button class="btn danger tiny delete-rule" data-id="'+esc(r.id)+'">Удалить</button></div></div>'}).join(""):'<div class="empty">Правила не найдены</div>'}
    function editRule(id,duplicate){var r=state.rules.find(function(x){return x.id===id});if(!r)return;ignoreDirty=true;el("ruleId").value=duplicate?"":id;el("ruleTrigger").value=r.trigger;el("ruleType").value=r.type;el("ruleLanguage").value=r.language;el("ruleAnswer").value=r.answer;el("ruleFormTitle").textContent=duplicate?"Копия правила":"Редактирование правила";ignoreDirty=false;if(duplicate)markDirty(el("ruleForm"));el("ruleForm").scrollIntoView({behavior:"smooth"})}
    function filteredUsers(){var q=el("userSearch").value.toLocaleLowerCase("ru-RU").trim(),lang=el("userLanguageFilter").value;return state.users.filter(function(user){var actual=user.preferredLanguage||"unknown",hay=(userName(user)+" "+user.username+" "+user.id+" "+(user.tags||[]).join(" ")).toLocaleLowerCase("ru-RU");return (!lang||lang===actual)&&(!q||hay.includes(q))})}
    function renderUsers(){var users=filteredUsers();el("userCards").innerHTML=users.length?users.map(function(u){return '<button class="user-card '+(selectedUserId===u.id?"active":"")+'" data-user-id="'+esc(u.id)+'"><div class="row-between"><strong>'+esc(userName(u))+'</strong><span class="badge">'+esc(languageLabel(u.preferredLanguage))+'</span></div><div class="small muted">'+(u.username?"@"+esc(u.username)+" · ":"")+"ID "+esc(u.id)+"</div><div class=\"small muted\">"+fmtNumber(u.messages)+" сообщ. · "+esc(fmtDate(u.lastSeenAt))+'</div><div class="tag-list">'+(u.tags||[]).map(function(tag){return '<span class="tag">'+esc(tag)+"</span>"}).join("")+"</div></button>"}).join(""):'<div class="empty">Пользователи не найдены</div>';if(selectedUserId)renderUserDetail(selectedUserId);var select=el("broadcastTestUser"),current=select.value;select.innerHTML='<option value="">Выберите пользователя</option>'+state.users.filter(function(u){return !u.blocked&&u.chatId}).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(userName(u))+" · "+esc(languageLabel(u.preferredLanguage))+"</option>"}).join("");select.value=current}
    function renderUserDetail(id){var currentForm=el("userForm");if(currentForm&&dirty.has(currentForm)&&selectedUserId===id)return;var u=state.users.find(function(x){return x.id===id});if(!u){el("userDetail").innerHTML='<div class="empty">Пользователь не найден</div>';return}el("userDetail").innerHTML='<div class="row-between"><div><h3>'+esc(userName(u))+'</h3><div class="small muted">'+(u.username?"@"+esc(u.username)+" · ":"")+"ID "+esc(u.id)+'</div></div><div class="avatar">'+esc(initials(u))+'</div></div><form id="userForm" data-saveable><div class="field"><label for="userPreferredLanguage">Язык</label><select id="userPreferredLanguage" class="select"><option value="">Не выбран</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div><div class="field"><label for="userTags">Теги через запятую</label><input id="userTags" class="input" maxlength="500" value="'+esc((u.tags||[]).join(", "))+'"></div><div class="field"><label for="userNote">Заметка администратора</label><textarea id="userNote" class="textarea" maxlength="2000">'+esc(u.note||"")+'</textarea></div><button class="btn" type="submit">Сохранить карточку</button></form><div class="subsection"><h3>Последние сообщения</h3><div class="timeline">'+((u.activity||[]).length?(u.activity||[]).slice().reverse().slice(0,20).map(function(a){return '<div class="timeline-item '+esc(a.direction)+'"><div class="small muted">'+(a.direction==="in"?"Пользователь":"Бот")+" · "+esc(fmtDate(a.createdAt))+'</div><div class="timeline-text">'+esc(a.text)+"</div></div>"}).join(""):'<div class="empty">История пока пуста</div>')+"</div></div>";el("userPreferredLanguage").value=u.preferredLanguage||"";el("userForm").addEventListener("submit",saveUser)}
    function broadcastStatus(status){return {draft:"Черновик",scheduled:"Запланирована",queued:"В очереди",running:"Выполняется",done:"Завершена",failed:"Ошибка"}[status]||status}
    function renderBroadcasts(){el("broadcastSendBtn").disabled=state.runtime.broadcastRunning;var list=state.broadcasts;el("broadcastHistory").innerHTML=list.length?list.slice(0,20).map(function(b){var text=localized(b.messages,"ru"),progress=b.total?Math.round((Number(b.sent||0)+Number(b.failed||0))/b.total*100):0;return '<div class="history-item"><div class="row-between"><strong>'+esc(text.slice(0,52)||(broadcastStatus(b.status)))+(text.length>52?"…":"")+'</strong><span class="badge '+(b.status==="done"?"ok":b.status==="failed"?"warn":"")+'">'+esc(broadcastStatus(b.status))+'</span></div><div class="small muted">'+esc(fmtDate(b.scheduledAt||b.createdAt))+" · "+fmtNumber(b.sent)+" из "+fmtNumber(b.total)+(b.failed?" · ошибок "+fmtNumber(b.failed):"")+'</div><div class="progress"><span style="width:'+progress+'%"></span></div><div class="actions subsection"><button class="btn ghost tiny duplicate-broadcast" data-id="'+esc(b.id)+'">Копия</button>'+(['draft','scheduled'].includes(b.status)?'<button class="btn secondary tiny edit-broadcast" data-id="'+esc(b.id)+'">Изменить</button><button class="btn danger tiny delete-broadcast" data-id="'+esc(b.id)+'">Удалить</button>':"")+"</div></div>"}).join(""):'<div class="empty">Рассылок ещё не было</div>';updateBroadcastPreview();updateRecipientEstimate()}
    function renderSettings(){ensureEntityFields();if(!dirty.has(el("messagesForm")))languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1),m=state.config.messages[language];el("settingGreeting"+s).value=m.greeting;el("settingHelp"+s).value=m.help;el("settingFallback"+s).value=m.fallback});if(!dirty.has(el("technicalForm")))el("settingActive").checked=state.config.active}
    function addCounters(){document.querySelectorAll("textarea[maxlength],input[maxlength]").forEach(function(node){if(node.nextElementSibling&&node.nextElementSibling.classList.contains("counter"))return;var counter=document.createElement("span");counter.className="counter";node.insertAdjacentElement("afterend",counter);var update=function(){counter.textContent=node.value.length+" / "+node.maxLength};node.addEventListener("input",update);update()})}
    function switchView(name){currentView=name;document.querySelectorAll(".view").forEach(function(node){node.classList.toggle("active",node.id==="view-"+name)});document.querySelectorAll("[data-view]").forEach(function(node){node.classList.toggle("active",node.dataset.view===name)});el("pageTitle").textContent=titles[name]||name;el("morePanel").classList.add("hidden");window.scrollTo({top:0,behavior:"smooth"})}
    function switchContentTab(name){document.querySelectorAll("[data-content-tab]").forEach(function(node){var on=node.dataset.contentTab===name;node.classList.toggle("active",on);node.setAttribute("aria-selected",on?"true":"false")});document.querySelectorAll('[id^="content-"]').forEach(function(node){node.classList.toggle("active",node.id==="content-"+name)})}
    function translated(prefix,keys){var result={};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);result[language]={};keys.forEach(function(key){result[language][key]=el(prefix+key+s).value})});return result}
    async function saveIntro(event){event.preventDefault();var button=event.submitter;button.disabled=true;try{var menu={};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);menu[language]={objects:el("menuobjects"+s).value,contacts:el("menucontacts"+s).value,promotions:el("menupromotions"+s).value,about:el("menuabout"+s).value}});await api("/api/menu",{method:"PUT",body:JSON.stringify({menu:menu})});for(var i=0;i<languages.length;i++){var language=languages[i],s=language[0].toUpperCase()+language.slice(1),file=el("welcomeFile"+s).files[0];if(file){await api("/api/images/"+language+"/welcome",{method:"POST",body:JSON.stringify({dataUrl:await fileData(file),name:file.name})})}else if(welcomeRemove[language])await api("/api/images/"+language+"/welcome",{method:"DELETE",body:"{}"})}clearDirty(el("introForm"));await loadState();toast("Приветствие сохранено")}catch(e){toast(e.message)}finally{button.disabled=false}}
    function collectTranslations(prefix,fields){var result={};fields.forEach(function(field){result[field]={};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);result[field][language]=el(prefix+field[0].toUpperCase()+field.slice(1)+s).value})});return result}
    async function saveObject(event){event.preventDefault();var button=event.submitter;button.disabled=true;try{var values=collectTranslations("object",["title","address","description"]),file=el("objectImage").files[0],body={title:values.title,address:values.address,description:values.description,price:el("objectPrice").value,url:el("objectUrl").value,status:el("objectStatus").value,removeImage:el("objectRemoveImage").checked};if(file){body.imageDataUrl=await fileData(file);body.imageName=file.name}var id=el("objectId").value;await api(id?"/api/objects/"+encodeURIComponent(id):"/api/objects",{method:id?"PATCH":"POST",body:JSON.stringify(body)});clearDirty(el("objectForm"));resetObject();await loadState();toast("Объект сохранён")}catch(e){toast(e.message)}finally{button.disabled=false}}
    async function savePromotion(event){event.preventDefault();var button=event.submitter;button.disabled=true;try{var values=collectTranslations("promotion",["title","text"]),file=el("promotionImage").files[0],body={title:values.title,text:values.text,url:el("promotionUrl").value,startAt:el("promotionStart").value?new Date(el("promotionStart").value).toISOString():"",endAt:el("promotionEnd").value?new Date(el("promotionEnd").value).toISOString():"",enabled:el("promotionEnabled").checked,removeImage:el("promotionRemoveImage").checked};if(file){body.imageDataUrl=await fileData(file);body.imageName=file.name}var id=el("promotionId").value;await api(id?"/api/promotions/"+encodeURIComponent(id):"/api/promotions",{method:id?"PATCH":"POST",body:JSON.stringify(body)});clearDirty(el("promotionForm"));resetPromotion();await loadState();toast("Акция сохранена")}catch(e){toast(e.message)}finally{button.disabled=false}}
    async function saveContacts(event){event.preventDefault();var button=event.submitter;button.disabled=true;try{var text={};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);text[language]=el("contactText"+s).value});await api("/api/contacts",{method:"PUT",body:JSON.stringify({phone:el("contactPhone").value,telegram:el("contactTelegram").value,website:el("contactWebsite").value,mapUrl:el("contactMap").value,text:text})});clearDirty(el("contactsForm"));await loadState();toast("Контакты сохранены")}catch(e){toast(e.message)}finally{button.disabled=false}}
    async function saveRule(event){event.preventDefault();var button=event.submitter,id=el("ruleId").value;button.disabled=true;try{var result=await api(id?"/api/rules/"+encodeURIComponent(id):"/api/rules",{method:id?"PATCH":"POST",body:JSON.stringify({trigger:el("ruleTrigger").value,type:el("ruleType").value,language:el("ruleLanguage").value,answer:el("ruleAnswer").value})});clearDirty(el("ruleForm"));el("ruleForm").reset();el("ruleId").value="";el("ruleFormTitle").textContent="Новое правило";await loadState();toast(result.conflicts&&result.conflicts.length?"Сохранено. Внимание: найдено похожее правило":"Правило сохранено")}catch(e){toast(e.message)}finally{button.disabled=false}}
    async function saveUser(event){event.preventDefault();var button=event.submitter;button.disabled=true;try{await api("/api/users/"+encodeURIComponent(selectedUserId),{method:"PATCH",body:JSON.stringify({preferredLanguage:el("userPreferredLanguage").value,tags:el("userTags").value.split(",").map(function(x){return x.trim()}).filter(Boolean),note:el("userNote").value})});clearDirty(el("userForm"));await loadState();toast("Карточка пользователя сохранена")}catch(e){toast(e.message)}finally{button.disabled=false}}
    function collectBroadcast(){return (async function(){var messages={},buttonText={};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);messages[language]=el("broadcastText"+s).value;buttonText[language]=el("broadcastButton"+s).value});var file=el("broadcastImage").files[0],body={messages:messages,languages:Array.from(document.querySelectorAll(".broadcast-language:checked")).map(function(x){return x.value}),tags:el("broadcastTags").value.split(",").map(function(x){return x.trim()}).filter(Boolean),buttonText:buttonText,buttonUrl:el("broadcastButtonUrl").value,scheduledAt:el("broadcastSchedule").value?new Date(el("broadcastSchedule").value).toISOString():"",removeImage:el("broadcastRemoveImage").checked};if(file){body.imageDataUrl=await fileData(file);body.imageName=file.name}return body})()}
    function resetBroadcast(){ignoreDirty=true;el("broadcastForm").reset();el("broadcastId").value="";document.querySelectorAll(".broadcast-language").forEach(function(x){x.checked=true});languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("broadcastText"+s).value="";el("broadcastButton"+s).value=""});el("broadcastFormTitle").textContent="Новая рассылка";clearDirty(el("broadcastForm"));ignoreDirty=false;updateBroadcastPreview();updateRecipientEstimate()}
    function editBroadcast(id,duplicate){var b=state.broadcasts.find(function(x){return x.id===id});if(!b)return;ignoreDirty=true;el("broadcastId").value=duplicate?"":id;el("broadcastTags").value=(b.tags||[]).join(", ");el("broadcastButtonUrl").value=b.buttonUrl||"";el("broadcastSchedule").value=localDate(b.scheduledAt);document.querySelectorAll(".broadcast-language").forEach(function(x){x.checked=!(b.languages||[]).length||(b.languages||[]).includes(x.value)});languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("broadcastText"+s).value=(b.messages&&b.messages[language])||"";el("broadcastButton"+s).value=(b.buttonText&&b.buttonText[language])||""});el("broadcastFormTitle").textContent=duplicate?"Копия рассылки":"Редактирование рассылки";ignoreDirty=false;if(duplicate)markDirty(el("broadcastForm"));updateBroadcastPreview();updateRecipientEstimate();el("broadcastForm").scrollIntoView({behavior:"smooth"})}
    async function submitBroadcast(event){event.preventDefault();var button=event.submitter,mode=button.dataset.mode||"draft";button.disabled=true;try{var body=await collectBroadcast();body.mode=mode;if(mode==="test"){body.userId=el("broadcastTestUser").value;await api("/api/broadcast/test",{method:"POST",body:JSON.stringify(body)});toast("Тестовое сообщение отправлено");return}if(mode==="send"&&!confirm("Отправить сообщение "+el("recipientEstimate").textContent+"?"))return;var id=el("broadcastId").value,url=id&&mode!=="send"?"/api/broadcasts/"+encodeURIComponent(id):"/api/broadcasts";await api(url,{method:id&&mode!=="send"?"PATCH":"POST",body:JSON.stringify(body)});if(id&&mode==="send")await api("/api/broadcasts/"+encodeURIComponent(id),{method:"DELETE",body:"{}"});clearDirty(el("broadcastForm"));resetBroadcast();await loadState();toast(mode==="send"?"Рассылка началась":mode==="schedule"?"Рассылка запланирована":"Черновик сохранён")}catch(e){toast(e.message)}finally{button.disabled=false}}
    function updateRecipientEstimate(){if(!state)return;var langs=Array.from(document.querySelectorAll(".broadcast-language:checked")).map(function(x){return x.value}),tags=el("broadcastTags").value.split(",").map(function(x){return x.trim().toLocaleLowerCase("ru-RU")}).filter(Boolean),total=state.users.filter(function(u){if(u.blocked||!u.chatId)return false;if(langs.length&&!langs.includes(u.preferredLanguage||"ru"))return false;if(tags.length){var own=(u.tags||[]).map(function(x){return x.toLocaleLowerCase("ru-RU")});if(!tags.some(function(tag){return own.includes(tag)}))return false}return true}).length;el("recipientEstimate").textContent=total+" получателей"}
    function updateBroadcastPreview(){var language=el("previewLanguage").value,s=language[0].toUpperCase()+language.slice(1),text=(el("broadcastText"+s)&&el("broadcastText"+s).value)||"";text=text.replaceAll("{first_name}","Анна").replaceAll("{last_name}","Иванова").replaceAll("{username}","@anna");var button=(el("broadcastButton"+s)&&el("broadcastButton"+s).value)||"";el("broadcastPreview").innerHTML=esc(text||"Введите текст сообщения")+(button?'<div class="preview-button">'+esc(button)+"</div>":"")}
    async function saveMessages(event){event.preventDefault();var button=event.submitter,messages={};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);messages[language]={greeting:el("settingGreeting"+s).value,help:el("settingHelp"+s).value,fallback:el("settingFallback"+s).value}});button.disabled=true;try{await api("/api/settings",{method:"PUT",body:JSON.stringify({messages:messages,active:state.config.active,token:"",password:"",passwordConfirm:""})});clearDirty(el("messagesForm"));await loadState();toast("Системные тексты сохранены")}catch(e){toast(e.message)}finally{button.disabled=false}}
    async function saveTechnical(event){event.preventDefault();var button=event.submitter;button.disabled=true;try{await api("/api/settings",{method:"PUT",body:JSON.stringify({messages:state.config.messages,active:el("settingActive").checked,token:el("settingToken").value,password:el("settingPassword").value,passwordConfirm:el("settingPasswordConfirm").value})});el("settingToken").value="";el("settingPassword").value="";el("settingPasswordConfirm").value="";clearDirty(el("technicalForm"));await loadState();toast("Технические настройки сохранены")}catch(e){toast(e.message)}finally{button.disabled=false}}
    el("setupForm").addEventListener("submit",async function(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{var result=await api("/api/setup",{method:"POST",body:JSON.stringify({token:el("setupToken").value,password:el("setupPassword").value})});csrf=result.csrf;await loadState();setScreen("app");startRefresh();toast("Бот подключён")}catch(err){message(el("setupMessage"),err.message,false)}finally{button.disabled=false}});
    el("loginForm").addEventListener("submit",async function(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{var result=await api("/api/login",{method:"POST",body:JSON.stringify({password:el("loginPassword").value})});csrf=result.csrf;el("loginPassword").value="";await loadState();setScreen("app");startRefresh()}catch(err){message(el("loginMessage"),err.message,false)}finally{button.disabled=false}});
    el("logoutBtn").addEventListener("click",async function(){if(dirty.size&&!confirm("Несохранённые изменения будут потеряны. Выйти?"))return;try{await api("/api/logout",{method:"POST",body:"{}"})}catch(e){}csrf="";state=null;clearInterval(refreshTimer);setScreen("loginScreen")});
    el("refreshBtn").addEventListener("click",function(){if(dirty.size)return toast("Сначала сохраните или отмените изменения");loadState().then(function(){toast("Данные обновлены")})});
    el("nav").addEventListener("click",function(e){var button=e.target.closest("button");if(!button)return;if(button.id==="moreBtn"){el("morePanel").classList.toggle("hidden");return}if(button.dataset.view)safeNavigate(button.dataset.view)});
    el("morePanel").addEventListener("click",function(e){var button=e.target.closest("[data-view]");if(button)safeNavigate(button.dataset.view)});
    document.querySelectorAll(".quick-link").forEach(function(button){button.addEventListener("click",function(){safeNavigate(button.dataset.view);if(button.dataset.view==="content")switchContentTab("objects")})});
    el("contentTabs").addEventListener("click",function(e){var button=e.target.closest("[data-content-tab]");if(button)switchContentTab(button.dataset.contentTab)});
    document.addEventListener("click",function(e){var button=e.target.closest("[data-tabs] button");if(!button)return;var group=button.parentElement.dataset.tabs,language=button.dataset.language;button.parentElement.querySelectorAll("button").forEach(function(x){var on=x===button;x.classList.toggle("active",on);x.setAttribute("aria-selected",on?"true":"false")});document.querySelectorAll('[data-pane-group="'+group+'"]').forEach(function(x){x.classList.toggle("active",x.dataset.language===language)})});
    document.addEventListener("input",function(e){var form=e.target.closest("form[data-saveable]");if(form)markDirty(form);if(e.target.closest("#broadcastForm")){updateBroadcastPreview();updateRecipientEstimate()}});
    document.addEventListener("change",function(e){var form=e.target.closest("form[data-saveable]");if(form)markDirty(form);if(e.target.closest("#broadcastForm")){updateBroadcastPreview();updateRecipientEstimate()}});
    document.querySelectorAll(".stage-remove-welcome").forEach(function(button){button.addEventListener("click",function(){var language=button.dataset.language,s=language[0].toUpperCase()+language.slice(1);welcomeRemove[language]=true;el("welcomeFile"+s).value="";el("welcomePreview"+s).innerHTML="<span>Изображение будет удалено после сохранения</span>";markDirty(el("introForm"))})});
    languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("welcomeFile"+s).addEventListener("change",function(){var file=this.files[0];if(!file)return;welcomeRemove[language]=false;el("welcomePreview"+s).innerHTML='<img src="'+URL.createObjectURL(file)+'" alt="Предпросмотр изображения">'})});
    el("objectImage").addEventListener("change",function(){if(this.files[0])el("objectImageNote").textContent=this.files[0].name});el("promotionImage").addEventListener("change",function(){if(this.files[0])el("promotionImageNote").textContent=this.files[0].name});
    el("introForm").addEventListener("submit",saveIntro);el("objectForm").addEventListener("submit",saveObject);el("promotionForm").addEventListener("submit",savePromotion);el("contactsForm").addEventListener("submit",saveContacts);el("ruleForm").addEventListener("submit",saveRule);el("broadcastForm").addEventListener("submit",submitBroadcast);el("messagesForm").addEventListener("submit",saveMessages);el("technicalForm").addEventListener("submit",saveTechnical);
    el("newObjectBtn").addEventListener("click",resetObject);el("cancelObjectBtn").addEventListener("click",resetObject);el("newPromotionBtn").addEventListener("click",resetPromotion);el("cancelPromotionBtn").addEventListener("click",resetPromotion);
    el("objectList").addEventListener("click",async function(e){var edit=e.target.closest(".edit-object"),del=e.target.closest(".delete-object");if(edit)return editObject(edit.dataset.id);if(del&&confirm("Удалить объект?")){try{await api("/api/objects/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Объект удалён")}catch(err){toast(err.message)}}});
    el("promotionList").addEventListener("click",async function(e){var edit=e.target.closest(".edit-promotion"),del=e.target.closest(".delete-promotion");if(edit)return editPromotion(edit.dataset.id);if(del&&confirm("Удалить акцию?")){try{await api("/api/promotions/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Акция удалена")}catch(err){toast(err.message)}}});
    el("ruleSearch").addEventListener("input",renderRules);el("ruleFilterLanguage").addEventListener("change",renderRules);el("cancelRuleBtn").addEventListener("click",function(){ignoreDirty=true;el("ruleForm").reset();el("ruleId").value="";el("ruleFormTitle").textContent="Новое правило";clearDirty(el("ruleForm"));ignoreDirty=false});
    el("rulesList").addEventListener("change",async function(e){if(!e.target.classList.contains("rule-toggle"))return;try{await api("/api/rules/"+encodeURIComponent(e.target.dataset.id),{method:"PATCH",body:JSON.stringify({enabled:e.target.checked})});await loadState(true)}catch(err){toast(err.message);await loadState(true)}});
    el("rulesList").addEventListener("click",async function(e){var edit=e.target.closest(".edit-rule"),copy=e.target.closest(".duplicate-rule"),del=e.target.closest(".delete-rule"),move=e.target.closest(".move-rule");if(edit)return editRule(edit.dataset.id,false);if(copy)return editRule(copy.dataset.id,true);if(del&&confirm("Удалить правило?")){try{await api("/api/rules/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Правило удалено")}catch(err){toast(err.message)}return}if(move){var ordered=state.rules.slice().sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}),index=ordered.findIndex(function(x){return x.id===move.dataset.id}),next=index+Number(move.dataset.step);if(next<0||next>=ordered.length)return;var temp=ordered[index];ordered[index]=ordered[next];ordered[next]=temp;try{await api("/api/rules/reorder",{method:"POST",body:JSON.stringify({ids:ordered.map(function(x){return x.id})})});await loadState();toast("Порядок изменён")}catch(err){toast(err.message)}}});
    el("ruleTestForm").addEventListener("submit",async function(e){e.preventDefault();try{var result=await api("/api/rules/test",{method:"POST",body:JSON.stringify({text:el("ruleTestText").value,language:el("ruleTestLanguage").value})});message(el("ruleTestResult"),result.matched?"Сработает: «"+result.matched.trigger+"» → "+result.matched.answer:"Ни одно правило не сработает",Boolean(result.matched))}catch(err){message(el("ruleTestResult"),err.message,false)}});
    el("userSearch").addEventListener("input",renderUsers);el("userLanguageFilter").addEventListener("change",renderUsers);el("userCards").addEventListener("click",function(e){var card=e.target.closest("[data-user-id]");if(!card)return;var userForm=el("userForm");if(userForm&&dirty.has(userForm)&&card.dataset.userId!==selectedUserId&&!confirm("Отменить несохранённые изменения в карточке пользователя?"))return;if(userForm)clearDirty(userForm);selectedUserId=card.dataset.userId;renderUsers()});
    el("broadcastHistory").addEventListener("click",async function(e){var edit=e.target.closest(".edit-broadcast"),copy=e.target.closest(".duplicate-broadcast"),del=e.target.closest(".delete-broadcast");if(edit)return editBroadcast(edit.dataset.id,false);if(copy)return editBroadcast(copy.dataset.id,true);if(del&&confirm("Удалить рассылку?")){try{await api("/api/broadcasts/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Рассылка удалена")}catch(err){toast(err.message)}}});
    el("previewLanguage").addEventListener("change",updateBroadcastPreview);
    el("tokenTestBtn").addEventListener("click",async function(){var button=this;button.disabled=true;try{var result=await api("/api/token-test",{method:"POST",body:JSON.stringify({token:el("settingToken").value})});toast("Токен работает: "+(result.username?"@"+result.username:result.firstName))}catch(e){toast(e.message)}finally{button.disabled=false}});
    el("clearErrorsBtn").addEventListener("click",async function(){if(!confirm("Очистить журнал ошибок?"))return;try{await api("/api/errors",{method:"DELETE",body:"{}"});await loadState();toast("Журнал очищен")}catch(e){toast(e.message)}});
    el("restoreFile").addEventListener("change",async function(){var file=this.files[0];if(!file)return;if(!confirm("Восстановить данные из выбранной копии? Текущие данные будут заменены.")){this.value="";return}try{var backup=JSON.parse(await file.text());await api("/api/restore",{method:"POST",body:JSON.stringify({backup:backup})});dirty.clear();refreshDirty();await loadState();toast("Резервная копия восстановлена")}catch(e){toast(e.message)}finally{this.value=""}});
    el("saveChangesBtn").addEventListener("click",function(){if(activeDirty)activeDirty.requestSubmit()});el("discardChangesBtn").addEventListener("click",function(){if(confirm("Отменить все несохранённые изменения?"))discardAll()});
    window.addEventListener("beforeunload",function(e){if(!dirty.size)return;e.preventDefault();e.returnValue=""});
    ensureEntityFields();document.querySelectorAll("[data-tabs]").forEach(function(tabs){tabs.setAttribute("role","tablist");tabs.querySelectorAll("button").forEach(function(button,index){button.setAttribute("role","tab");button.setAttribute("aria-selected",index===0?"true":"false")})});document.querySelectorAll("[data-pane-group]").forEach(function(pane){pane.setAttribute("role","tabpanel")});boot();
  })();
  </script>
</body>
</html>`;

const ADMIN_HTML_V3 = String.raw`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Управление Telegram-ботом</title>
  <style>
    :root{--canvas:#f4f6fa;--surface:#fff;--surface-soft:#f8f9fc;--ink:#172033;--muted:#667085;--subtle:#98a2b3;--line:#e4e7ec;--line-strong:#d0d5dd;--brand:#4058d6;--brand-dark:#3047bf;--brand-soft:#eef0ff;--violet:#7b61d1;--green:#159570;--green-soft:#e9f8f3;--amber:#c97912;--amber-soft:#fff4df;--red:#d14343;--red-soft:#fff0f0;--shadow:0 16px 42px rgba(31,43,78,.11);--shadow-sm:0 4px 14px rgba(31,43,78,.07);--radius:16px}
    *{box-sizing:border-box}html{font-size:16px}body{margin:0;min-height:100vh;overflow-x:hidden;background:var(--canvas);color:var(--ink);font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid rgba(64,88,214,.22);outline-offset:2px}.hidden{display:none!important}h1,h2,h3,p{margin-top:0}h1{font-size:1.8rem;line-height:1.2;letter-spacing:-.035em;margin-bottom:.35rem}h2{font-size:1.35rem;line-height:1.25;letter-spacing:-.025em;margin-bottom:.25rem}h3{font-size:1rem;margin-bottom:.2rem}.muted{color:var(--muted)}.small{font-size:.8rem}.tiny{font-size:.74rem}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.danger-text{color:var(--red)}.success-text{color:var(--green)}
    .auth{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(420px,.72fr);background:var(--surface)}.auth-visual{position:relative;overflow:hidden;display:flex;align-items:flex-end;padding:64px;color:white;background:linear-gradient(145deg,#2d43b9 0%,#5368db 55%,#8268d8 100%)}.auth-visual:before{content:"";position:absolute;inset:9% 10% 20% 22%;border:1px solid rgba(255,255,255,.24);border-radius:42px;transform:rotate(-8deg)}.auth-visual:after{content:"";position:absolute;width:360px;height:360px;border:80px solid rgba(255,255,255,.08);border-radius:50%;right:-130px;top:-110px}.auth-copy{position:relative;z-index:1;max-width:620px}.auth-copy strong{display:block;font-size:2.5rem;line-height:1.12;letter-spacing:-.05em;margin-bottom:18px}.auth-card-wrap{display:grid;place-items:center;padding:40px}.auth-card{width:min(430px,100%)}.logo{width:46px;height:46px;border-radius:14px;background:var(--brand);color:white;display:grid;place-items:center;font-weight:900;letter-spacing:-.05em;box-shadow:0 10px 22px rgba(64,88,214,.25)}.auth-card .logo{margin-bottom:28px}.lead{color:var(--muted);margin-bottom:25px}
    .field{display:grid;gap:7px;margin:14px 0}.field label,.field-label{font-size:.875rem;font-weight:700;color:#344054}.input,.select,.textarea{width:100%;min-width:0;border:1px solid var(--line-strong);border-radius:11px;background:var(--surface);color:var(--ink);padding:11px 12px;outline:none;transition:.16s}.input:hover,.select:hover,.textarea:hover{border-color:#adb5c3}.input:focus,.select:focus,.textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(64,88,214,.1)}.textarea{min-height:110px;resize:vertical}.hint,.counter{font-size:.76rem;color:var(--muted)}.counter{text-align:right;margin-top:-4px}.form-error,.form-success,.callout{padding:11px 13px;border-radius:10px;margin-top:12px;font-size:.875rem}.form-error{color:#b42318;background:#fef3f2;border:1px solid #fecdca}.form-success{color:#067647;background:#ecfdf3;border:1px solid #abefc6}.callout{color:#854a0e;background:var(--amber-soft);border:1px solid #f2d49a}
    .btn{min-height:40px;border:1px solid transparent;border-radius:10px;padding:9px 14px;display:inline-flex;align-items:center;justify-content:center;gap:7px;text-decoration:none;background:var(--brand);color:white;font-weight:750;transition:.15s}.btn:hover{background:var(--brand-dark)}.btn:disabled{opacity:.48;cursor:not-allowed}.btn.secondary{background:var(--surface);color:#344054;border-color:var(--line-strong);box-shadow:0 1px 2px rgba(16,24,40,.04)}.btn.secondary:hover{background:#f9fafb}.btn.soft{background:var(--brand-soft);color:var(--brand-dark)}.btn.soft:hover{background:#e2e6ff}.btn.danger{background:var(--surface);color:var(--red);border-color:#f0b9b9}.btn.danger:hover{background:var(--red-soft)}.btn.ghost{background:transparent;color:var(--muted)}.btn.ghost:hover{background:#eef1f6;color:var(--ink)}.btn.small{min-height:34px;padding:6px 10px;font-size:.8rem}.btn.icon{width:40px;padding:0}.btn.wide{width:100%}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .app{min-height:100vh;display:grid;grid-template-columns:272px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:#172033;color:#dce2f0;padding:20px 14px;display:flex;flex-direction:column;z-index:30}.brand{display:flex;align-items:center;gap:12px;padding:3px 9px 18px}.brand .logo{width:39px;height:39px;border-radius:12px;background:#6677e6;box-shadow:none}.brand-name{font-weight:850;color:white}.brand-user{font-size:.76rem;color:#98a5bd;max-width:165px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bot-status{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 7px 18px;padding:10px 11px;border:1px solid #34405a;border-radius:11px;background:#1e2940}.status-copy{min-width:0}.status-copy strong{display:block;font-size:.82rem;color:#f6f7fb}.status-copy span{display:block;font-size:.72rem;color:#94a1ba}.status-dot{width:9px;height:9px;border-radius:50%;background:#98a2b3;flex:none}.status-dot.online{background:#39d49a;box-shadow:0 0 0 4px rgba(57,212,154,.12)}.status-dot.error,.status-dot.reconnecting{background:#ffbc58}
    .nav-scroll{overflow:auto;padding-bottom:8px}.nav-group{margin-bottom:17px}.nav-label{padding:0 11px;margin-bottom:5px;color:#7f8ba4;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;font-weight:800}.nav-item{width:100%;border:0;border-radius:9px;background:transparent;color:#aeb9cd;display:flex;align-items:center;gap:10px;padding:9px 10px;text-align:left;font-size:.875rem;font-weight:690}.nav-item:hover{background:#202d45;color:white}.nav-item.active{background:#2b3853;color:white}.nav-icon{width:24px;height:24px;border-radius:7px;background:#253149;display:grid;place-items:center;font-size:.75rem;font-weight:850}.nav-item.active .nav-icon{background:#6879e8}.nav-count{margin-left:auto;min-width:24px;text-align:center;font-size:.7rem;color:#a9b4ca;background:#26334a;border-radius:99px;padding:2px 6px}.sidebar-footer{margin-top:auto;padding:14px 9px 2px;border-top:1px solid #2c374d;color:#7f8ba4;font-size:.72rem}.mobile-bar,.sidebar-overlay{display:none}
    .main{min-width:0}.topbar{height:72px;position:sticky;top:0;z-index:20;background:rgba(244,246,250,.9);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:space-between;gap:18px;padding:0 32px;border-bottom:1px solid rgba(228,231,236,.8)}.breadcrumb{font-size:.76rem;color:var(--muted);margin-bottom:1px}.top-title{font-weight:830;font-size:1.05rem}.top-actions{display:flex;gap:8px}.workspace{padding:30px 32px 70px;max-width:1460px}.view{display:none}.view.active{display:block}.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:23px}.page-copy{color:var(--muted);margin:0;max-width:670px;font-size:.92rem}.grid{display:grid;gap:16px}.card{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:19px;box-shadow:var(--shadow-sm)}.card.flat{box-shadow:none}.card-head,.row-between{display:flex;align-items:center;justify-content:space-between;gap:14px}.card-head{margin-bottom:15px}.card-note{font-size:.8rem;color:var(--muted)}.badge{display:inline-flex;align-items:center;border-radius:99px;padding:4px 9px;font-size:.72rem;font-weight:800;background:#eef1f6;color:#475467}.badge.brand{background:var(--brand-soft);color:var(--brand-dark)}.badge.good{background:var(--green-soft);color:#08795b}.badge.warn{background:var(--amber-soft);color:#9d5d12}.badge.bad{background:var(--red-soft);color:#b42318}
    .home-hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:16px;margin-bottom:16px}.health{position:relative;overflow:hidden;background:linear-gradient(135deg,#3249c0,#6475e4);color:white;border:0;padding:25px}.health:after{content:"";position:absolute;width:230px;height:230px;border:55px solid rgba(255,255,255,.08);border-radius:50%;right:-80px;top:-100px}.health-content{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.health-label{font-size:.78rem;color:#d9dfff;text-transform:uppercase;letter-spacing:.1em;font-weight:800}.health-title{font-size:1.65rem;font-weight:850;letter-spacing:-.035em;margin:9px 0 7px}.health-note{color:#e0e5ff;max-width:590px;font-size:.9rem}.health .btn{margin-top:20px;background:white;color:#3047bf}.health-number{font-size:3rem;font-weight:880;line-height:1}.attention-list{display:grid;gap:8px;margin-top:12px}.attention-item{display:flex;align-items:center;gap:10px;padding:10px 11px;background:var(--surface-soft);border-radius:10px}.attention-icon{width:30px;height:30px;border-radius:9px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;font-weight:900}.attention-main{min-width:0;flex:1}.attention-main strong{display:block;font-size:.84rem}.attention-main span{display:block;color:var(--muted);font-size:.75rem}.metric-grid{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}.metric{padding:17px}.metric-label{color:var(--muted);font-size:.78rem;font-weight:700}.metric-value{font-size:1.7rem;line-height:1.2;font-weight:880;letter-spacing:-.04em;margin:8px 0 2px}.metric-delta{font-size:.74rem;color:var(--muted)}.dashboard-grid{grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr)}.chart{height:185px;display:flex;align-items:end;gap:8px;padding-top:20px}.chart-column{height:100%;flex:1;min-width:5px;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:7px}.chart-bar{width:100%;max-width:34px;min-height:4px;border-radius:6px 6px 2px 2px;background:linear-gradient(to top,#4058d6,#8390ed)}.chart-label{font-size:.64rem;color:var(--subtle);white-space:nowrap}.quick-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:16px}.quick-card{border:1px solid var(--line);border-radius:13px;background:var(--surface);padding:15px;text-align:left;color:inherit}.quick-card:hover{border-color:#aab4ef;box-shadow:var(--shadow-sm)}.quick-icon{width:35px;height:35px;border-radius:10px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;font-weight:900;margin-bottom:11px}.quick-card strong{display:block}.quick-card span{font-size:.78rem;color:var(--muted)}.list{display:grid;gap:8px}.list-item{display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--line)}.list-item:last-child{border:0}.avatar{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:#edf0ff;color:#4356c1;font-weight:850;flex:none}.list-main{min-width:0;flex:1}.list-main strong{display:block;font-size:.87rem}.list-main span{display:block;font-size:.74rem;color:var(--muted)}
    .lang-switch{display:inline-flex;padding:4px;border:1px solid var(--line);border-radius:11px;background:var(--surface-soft);gap:3px;margin-bottom:17px}.lang-switch button{min-width:82px;border:0;border-radius:8px;background:transparent;color:var(--muted);padding:7px 11px;font-weight:750}.lang-switch button.active{background:var(--surface);color:var(--brand);box-shadow:0 1px 5px rgba(31,43,78,.09)}.lang-pane{display:none}.lang-pane.active{display:block}.welcome-layout{grid-template-columns:350px minmax(0,1fr)}.phone{width:310px;max-width:100%;margin:auto;border:8px solid #222c3e;border-radius:36px;background:#e9f1f7;padding:14px 10px 18px;box-shadow:var(--shadow)}.phone-top{text-align:center;font-size:.7rem;font-weight:800;color:#4b596b;margin-bottom:13px}.chat-bubble{background:white;border-radius:14px 14px 14px 5px;padding:9px;box-shadow:0 3px 10px rgba(24,32,51,.08)}.chat-photo{aspect-ratio:16/10;background:#dfe5ec;border-radius:9px;display:grid;place-items:center;overflow:hidden;color:#7b8798;font-size:.75rem}.chat-photo img{width:100%;height:100%;object-fit:cover}.chat-text{padding:9px 4px 3px;white-space:pre-wrap;font-size:.79rem;color:#283446}.chat-keyboard{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:9px}.chat-keyboard span{background:#fff;border-radius:7px;text-align:center;padding:6px 3px;font-size:.67rem;color:#344054}.chat-keyboard span.menu-wide{grid-column:1/3;background:#eef0ff;color:#4058d6;font-weight:800}.section-stack{display:grid;gap:16px}.form-section{border-top:1px solid var(--line);padding-top:16px;margin-top:16px}.form-section:first-child{border:0;padding-top:0;margin-top:0}.form-section-title{font-weight:800;margin-bottom:3px}.two-col{grid-template-columns:1fr 1fr}.three-col{grid-template-columns:repeat(3,1fr)}.sticky-save{position:sticky;bottom:14px;z-index:12;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;margin-top:16px;border:1px solid #c7cff7;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border-radius:12px;box-shadow:var(--shadow)}
    .toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 190px auto;gap:9px;margin-bottom:16px}.section-copy-editor{margin-bottom:16px}.textarea.compact{min-height:86px}.textarea.section-long{min-height:240px}.catalog-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.content-card{overflow:hidden;padding:0}.content-cover{position:relative;aspect-ratio:16/9;background:#eef1f5;display:grid;place-items:center;color:var(--subtle);overflow:hidden}.content-cover img{width:100%;height:100%;object-fit:cover}.content-photo-count{position:absolute;right:8px;bottom:8px;padding:4px 7px;border-radius:7px;background:rgba(23,32,51,.82);color:white;font-size:.7rem;font-weight:750}.content-body{padding:15px}.content-title{font-weight:820;margin-bottom:3px;overflow-wrap:anywhere}.content-meta{font-size:.76rem;color:var(--muted);min-height:23px}.content-actions{display:flex;gap:7px;margin-top:13px}.content-actions .btn{flex:1}.empty{padding:38px 18px;text-align:center;color:var(--muted);border:1px dashed var(--line-strong);border-radius:13px}.empty strong{display:block;color:#475467;margin-bottom:4px}.contacts-layout{grid-template-columns:minmax(0,1fr) 360px}.contact-preview{position:sticky;top:96px}.contact-channel{display:flex;gap:11px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}.contact-channel:last-child{border:0}.channel-icon{width:36px;height:36px;border-radius:10px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;font-weight:900}
    .reply-layout{grid-template-columns:minmax(0,1fr) 340px}.reply-layout>*,.audience-layout>*,.inquiry-layout>*{min-width:0}.reply-row{display:grid;grid-template-columns:auto minmax(150px,.6fr) minmax(180px,1.4fr) auto;gap:12px;align-items:center;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.reply-row.off{opacity:.55}.toggle{appearance:none;width:42px;height:24px;border-radius:99px;background:#c5cad3;position:relative;flex:none}.toggle:after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:white;box-shadow:0 1px 3px #0002;transition:.17s}.toggle:checked{background:var(--brand)}.toggle:checked:after{left:21px}.reply-trigger{font-weight:800}.reply-answer{font-size:.83rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.order-buttons{display:flex;gap:4px}
    .campaign-layout{grid-template-columns:minmax(0,1.15fr) minmax(330px,.85fr)}.audience-checks{display:flex;gap:14px;flex-wrap:wrap}.campaign-preview{position:sticky;top:96px}.preview-shell{background:#dfeaf1;padding:17px;border-radius:15px;min-height:180px}.preview-message{background:white;color:#283446;border-radius:13px 13px 13px 4px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.88rem;box-shadow:0 4px 14px rgba(31,43,78,.09)}.preview-button{background:#d5ebf7;color:#1973a6;border-radius:8px;padding:8px;text-align:center;margin-top:6px;font-weight:760}.history-item{border:1px solid var(--line);border-radius:12px;padding:13px;background:var(--surface)}.progress{height:6px;border-radius:99px;background:#edf0f4;overflow:hidden;margin-top:9px}.progress span{display:block;height:100%;background:var(--green)}.history-actions{margin-top:10px}
    .audience-layout,.inquiry-layout{grid-template-columns:minmax(0,1.05fr) minmax(340px,.95fr)}.user-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.user-card{width:100%;min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:13px;text-align:left;color:inherit}.user-card:hover,.user-card.active{border-color:#aab4ef;background:#fafbff}.tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.tag{font-size:.67rem;padding:3px 7px;border-radius:99px;background:#eef1f6;color:#475467}.user-detail,.inquiry-detail{position:sticky;top:96px}.timeline{display:grid;gap:7px;max-height:430px;overflow:auto}.timeline-item{border-radius:10px;padding:10px 11px;background:var(--surface-soft);border-left:3px solid var(--brand)}.timeline-item.out{border-left-color:var(--green)}.timeline-item.reaction{border-left-color:var(--violet);background:#faf8ff}.timeline-text{font-size:.83rem;overflow-wrap:anywhere}.timeline-reactions{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.reaction-chip{display:inline-flex;align-items:center;min-height:25px;padding:2px 8px;border:1px solid #d9d2f4;border-radius:99px;background:#f3f0ff;color:#5f46b5;font-size:.76rem;font-weight:800}.reaction-target{margin-top:5px;overflow-wrap:anywhere}.reaction-row{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;color:inherit;padding:10px 0;display:flex;align-items:center;gap:11px;text-align:left}.reaction-row:last-child{border-bottom:0}.reaction-row:hover .list-main strong{color:var(--brand)}.reaction-emoji{width:38px;height:38px;border-radius:12px;background:#f3f0ff;display:grid;place-items:center;font-size:1.15rem;flex:none}.inquiry-card{width:100%;min-width:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:13px;text-align:left;color:inherit}.inquiry-card:hover,.inquiry-card.active{border-color:#aab4ef;background:#fafbff}.inquiry-text{margin-top:7px;color:#344054;font-size:.87rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.inquiry-meta{font-size:.75rem;color:var(--muted);margin-top:5px}
    .settings-layout{grid-template-columns:minmax(0,1fr) minmax(320px,.72fr)}.switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px;background:var(--surface-soft);border:1px solid var(--line);border-radius:12px}.data-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.data-row:last-child{border:0}.data-action{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft)}.data-action>div{min-width:0}.data-action .btn{flex:none}.error-item{padding:11px 12px;border-left:3px solid var(--red);background:#fff8f8;border-radius:8px}.error-item strong{font-size:.83rem}.error-item div{font-size:.76rem}
    dialog{border:0;padding:0;background:transparent;max-width:none;max-height:none}dialog::backdrop{background:rgba(20,28,45,.4);backdrop-filter:blur(2px)}.drawer{position:fixed;right:0;top:0;width:min(620px,100vw);height:100vh;margin:0;background:var(--surface);box-shadow:-20px 0 60px rgba(25,34,55,.18);overflow:auto}.drawer-head{position:sticky;top:0;z-index:3;background:rgba(255,255,255,.94);backdrop-filter:blur(10px);padding:18px 22px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.drawer-body{padding:20px 22px 100px}.drawer-footer{position:fixed;right:0;bottom:0;width:min(620px,100vw);display:flex;justify-content:flex-end;gap:8px;padding:13px 22px;background:rgba(255,255,255,.95);border-top:1px solid var(--line);backdrop-filter:blur(12px)}.dialog-title{font-size:1.1rem;font-weight:850}.close-btn{border:0;background:#f2f4f7;border-radius:9px;width:36px;height:36px;color:#475467;font-size:1.2rem}.global-unsaved{position:fixed;left:calc(272px + (100vw - 272px)/2);bottom:18px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:12px;background:#172033;color:white;padding:10px 12px;border-radius:12px;box-shadow:var(--shadow)}.global-unsaved span{font-size:.82rem}.toast{position:fixed;right:20px;bottom:20px;z-index:80;max-width:min(420px,calc(100vw - 24px));padding:12px 15px;border-radius:11px;background:#172033;color:white;box-shadow:var(--shadow);font-size:.87rem}
    @media(max-width:1180px){.catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.welcome-layout,.contacts-layout,.campaign-layout,.audience-layout,.inquiry-layout,.settings-layout{grid-template-columns:1fr}.contact-preview,.campaign-preview,.user-detail,.inquiry-detail{position:static}.reply-layout{grid-template-columns:1fr}}
    @media(max-width:920px){.app{display:block}.sidebar{position:fixed;left:0;top:0;width:min(310px,86vw);transform:translateX(-105%);transition:transform .2s;box-shadow:var(--shadow)}.sidebar.open{transform:none}.sidebar-overlay{display:block;position:fixed;inset:0;background:rgba(20,28,45,.38);z-index:29}.mobile-bar{height:64px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:25}.mobile-brand{display:flex;align-items:center;gap:9px;font-weight:820}.mobile-brand .logo{width:34px;height:34px;border-radius:10px;font-size:.8rem}.mobile-menu{border:1px solid var(--line);background:var(--surface);border-radius:10px;width:40px;height:40px}.topbar{display:none}.workspace{padding:24px 17px 88px}.global-unsaved{left:50%;bottom:14px}}
    @media(max-width:650px){body{font-size:15px}.auth{display:block}.auth-visual{display:none}.auth-card-wrap{min-height:100vh;padding:25px}.workspace{padding-left:12px;padding-right:12px}.page-head{flex-direction:column}.page-head>.actions,.page-head>.btn{width:100%}.page-head>.actions .btn{flex:1}.home-hero,.dashboard-grid,.two-col,.three-col{grid-template-columns:1fr}.metric-grid{grid-template-columns:1fr 1fr}.health-content{display:block}.health-number{margin-top:18px}.quick-grid,.catalog-grid,.user-grid{grid-template-columns:1fr}.toolbar{grid-template-columns:1fr!important}.reply-row{grid-template-columns:auto minmax(0,1fr)}.reply-answer{grid-column:2}.reply-row>.actions{grid-column:1/3}.welcome-layout{grid-template-columns:1fr}.phone{width:285px}.card{padding:15px}.drawer-body{padding:16px 15px 94px}.drawer-head{padding:14px 15px}.drawer-footer{padding:11px 15px}.sticky-save{align-items:flex-start;flex-direction:column}.sticky-save .btn{width:100%}.global-unsaved{width:calc(100vw - 24px);justify-content:space-between}.global-unsaved .btn{min-height:34px;padding:5px 9px}.campaign-actions .btn{flex:1}.chart{gap:4px}.chart-label{font-size:.58rem}}

    /* Calm professional workspace refinement */
    :root{--canvas:#f6f7f9;--surface-soft:#f8f9fb;--ink:#182230;--muted:#667085;--line:#e6e8ec;--line-strong:#d8dce2;--brand:#3157d5;--brand-dark:#2748b8;--brand-soft:#eef2ff;--shadow:0 8px 24px rgba(24,34,48,.06);--shadow-sm:none;--radius:12px}
    body{letter-spacing:-.005em}h1{font-size:1.65rem;font-weight:750;letter-spacing:-.03em}h2{font-weight:740}h3{font-weight:720}.page-copy{font-size:.9rem;line-height:1.45}.small{font-size:.82rem}.tiny{font-size:.75rem}
    .auth-visual{background:#182230}.auth-visual:before,.auth-visual:after{display:none}.auth-copy strong{font-size:2.25rem;font-weight:720;letter-spacing:-.04em}.logo{box-shadow:none}
    .app{grid-template-columns:248px minmax(0,1fr)}.sidebar{padding:18px 12px;background:#182230}.brand{padding:2px 8px 17px}.brand .logo{background:#4966d8}.brand-name{font-weight:730}.bot-status{margin:0 5px 20px;padding:10px;background:#202c3d;border-color:#344054}.nav-group{margin-bottom:16px}.nav-label{font-size:.72rem;letter-spacing:.09em;padding:0 9px;color:#8b96aa}.nav-item{position:relative;padding:9px 10px;font-size:.875rem;font-weight:620;border-radius:8px}.nav-icon{display:none}.nav-item.active{background:#2a3850}.nav-item.active:before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:2px;background:#8295ee}.nav-count{font-size:.72rem;background:#2b384d}.sidebar-footer{padding-left:8px;font-size:.75rem}
    .topbar{height:64px;padding:0 28px;background:rgba(246,247,249,.94)}.breadcrumb{font-size:.78rem}.top-title{font-size:1rem;font-weight:700}.workspace{padding:28px 30px 72px;max-width:1420px}.page-head{margin-bottom:20px}.card{padding:18px;border-radius:12px;box-shadow:none}.card-head{margin-bottom:14px}.btn{min-height:38px;border-radius:8px;font-weight:650;padding:8px 13px}.btn.small{min-height:32px}.input,.select,.textarea{border-radius:8px;padding:10px 11px}.field label,.field-label{font-weight:650}.badge{border-radius:7px;font-weight:650;padding:4px 8px}
    .home-hero{grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:14px;margin-bottom:14px}.health{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-left:4px solid var(--brand);padding:20px}.health:after{display:none}.health-content{align-items:center}.health-label{color:var(--muted);font-size:.74rem;letter-spacing:.08em}.health-title{font-size:1.35rem;font-weight:740;letter-spacing:-.025em;margin:6px 0 5px}.health-note{color:var(--muted);max-width:650px}.health .btn{margin-top:15px;background:var(--surface);color:var(--brand-dark);border:1px solid var(--line-strong)}.health .btn:hover{background:var(--brand-soft)}.health-number{font-size:2.2rem;font-weight:740;color:var(--ink)}
    .attention-list{gap:5px}.attention-item{width:100%;border:1px solid transparent;text-align:left;color:inherit}.attention-item:hover{border-color:var(--line-strong);background:#f5f7fa}.attention-icon{width:28px;height:28px;border-radius:7px;background:var(--surface-soft);color:var(--brand);font-size:.8rem}
    .metric-grid{gap:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px}.metric{border:0;border-right:1px solid var(--line);border-radius:0;padding:16px}.metric:last-child{border-right:0}.metric-label{font-size:.8rem;font-weight:620}.metric-value{font-size:1.6rem;font-weight:740;margin-top:6px}.dashboard-grid{gap:14px}.chart-bar{background:#5570dd}.quick-grid{gap:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface);margin-top:14px}.quick-card{border:0;border-right:1px solid var(--line);border-radius:0;padding:15px}.quick-card:last-child{border-right:0}.quick-card:hover{background:var(--surface-soft);box-shadow:none}.quick-icon{display:none}.quick-card strong{font-weight:680}.list-item{padding:9px 0}
    .lang-switch{border-radius:9px;background:#f2f4f7;margin-bottom:15px}.lang-switch button{border-radius:6px;font-weight:620}.welcome-layout{align-items:start}.sticky-save{border-radius:10px;box-shadow:0 5px 18px rgba(24,34,48,.07)}#saveWelcomeTop3,#saveContactsTop3{display:none}.phone{border-width:6px;border-radius:31px;box-shadow:none}.chat-bubble{box-shadow:none}
    .toolbar{margin-bottom:14px}.content-card{border-radius:12px}.content-title{font-weight:700}.empty{border:0;background:var(--surface-soft);border-radius:10px}.reply-row{border-radius:10px}.reply-trigger{font-weight:680}.user-card{border-radius:10px}.campaign-preview,.contact-preview,.user-detail{top:84px}.preview-shell{border-radius:10px}.preview-message{box-shadow:none}.history-item{border-radius:10px}.switch-row{border-radius:10px}.drawer{width:min(760px,100vw);box-shadow:-12px 0 40px rgba(24,34,48,.14)}.drawer-footer{width:min(760px,100vw)}.close-btn{border-radius:8px}.global-unsaved{left:calc(248px + (100vw - 248px)/2);border-radius:9px}.toast{border-radius:9px}
    .admin-gallery{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.language-gallery{padding:14px;margin-top:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft)}.gallery-item{position:relative;aspect-ratio:4/3;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}.gallery-item img{width:100%;height:100%;object-fit:cover}.gallery-item .gallery-number{position:absolute;left:6px;top:6px;background:rgba(23,32,51,.82);color:white;border-radius:6px;padding:3px 6px;font-size:.68rem}.gallery-actions{position:absolute;right:5px;bottom:5px;display:flex;gap:4px}.gallery-actions button{width:28px;height:28px;border:0;border-radius:7px;background:rgba(255,255,255,.94);color:#344054;font-weight:800}.gallery-empty{grid-column:1/-1;padding:18px;text-align:center;color:var(--muted);background:var(--surface);border-radius:10px}.property-context{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;align-items:center;margin:16px 0;padding:13px;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft)}.property-context strong,.property-context span{grid-column:1}.property-context .btn{grid-column:2;grid-row:1/3}.performance-list{display:grid;gap:8px}.performance-row{width:100%;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) repeat(4,90px);align-items:center;gap:10px;padding:11px 5px;border-bottom:1px solid var(--line)}.performance-row:hover{background:var(--surface-soft)}.performance-row:last-child{border-bottom:0}.performance-name{min-width:0}.performance-name strong,.performance-name span{display:block}.performance-name strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.performance-value{text-align:right}.performance-value strong,.performance-value span{display:block}.performance-value span,.performance-name span{font-size:.72rem;color:var(--muted)}
    .language-health{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.language-health .badge{font-size:.68rem}.language-health .badge.warn{border-color:#fed7aa;color:#9a3412;background:#fff7ed}.language-health .badge.good{border-color:#bbf7d0;color:#166534;background:#f0fdf4}.translation-summary{margin:12px 0 2px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;color:var(--muted);font-size:.78rem}.translation-summary strong{color:var(--text)}
    .direct-message-composer.composer-collapsed form{display:none}.composer-toggle{margin-left:auto}#errorList3{max-height:320px;overflow:auto;padding-right:4px}
    #confirmDialog3{width:auto;max-width:none;padding:0;border:0;border-radius:16px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.24);overflow:hidden}#confirmDialog3::backdrop{background:rgba(15,23,42,.48);backdrop-filter:blur(2px)}.confirm-panel{width:min(440px,calc(100vw - 28px));padding:24px;background:#fff}.confirm-panel h3{margin-bottom:8px}.confirm-panel p{color:var(--muted);line-height:1.55}.confirm-panel .actions{justify-content:flex-end;margin-top:22px}
    .chat-keyboard span:last-child{grid-column:auto}
    @media(max-width:920px){.sidebar{width:min(310px,86vw)}.workspace{padding:22px 18px 84px}.home-hero{grid-template-columns:1fr}.global-unsaved{left:50%}}
    @media(max-width:650px){h1{font-size:1.55rem}.workspace{padding-left:12px;padding-right:12px}.page-head{gap:10px;margin-bottom:18px}.page-copy{font-size:.88rem}.home-hero{gap:12px}.health{padding:17px}.health-content{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px}.health-number{margin:0;font-size:1.9rem}.health-content>div:last-child{text-align:right}.health .btn{grid-column:1/3}.metric-grid{grid-template-columns:1fr 1fr}.metric{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px}.metric:nth-child(2){border-right:0}.metric:nth-child(3),.metric:nth-child(4){border-bottom:0}.metric:nth-child(4){border-right:0}.quick-grid{display:grid}.quick-card{border-right:0;border-bottom:1px solid var(--line)}.quick-card:last-child{border-bottom:0}.welcome-layout{padding-bottom:84px}.welcome-layout>.card:first-child{order:2}.welcome-layout>.section-stack{order:1}.card{padding:14px}#saveWelcomeTop3,#saveContactsTop3{display:none}.sticky-save{bottom:10px}.mobile-bar{height:60px;padding:0 12px}.mobile-menu{width:38px;height:38px}.drawer-head{padding:13px 15px}.drawer-body{padding-top:15px}.drawer-footer{padding:10px 12px}.drawer-footer .btn{flex:1}.admin-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.property-context{grid-template-columns:1fr}.property-context .btn{grid-column:1;grid-row:auto}.performance-row{grid-template-columns:1fr 1fr}.performance-name{grid-column:1/-1}.performance-value{text-align:left}}

    /* Construcciones Kornilenko login */
    .auth.brand-auth{position:relative;isolation:isolate;display:grid;grid-template-columns:1fr;place-items:center;min-height:100vh;min-height:100svh;overflow:hidden;background:#f6f8fb url("/login-assets/background.png") center/cover no-repeat;color:#172033}
    .brand-auth .auth-card-wrap{position:relative;z-index:2;width:100%;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:42px 24px 112px}
    .brand-auth .auth-card{width:min(574px,calc(100vw - 48px));min-height:692px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:42px 64px 40px;border:1px solid rgba(210,216,226,.82);border-radius:16px;background:rgba(255,255,255,.965);box-shadow:0 24px 70px rgba(47,64,91,.12);transform:translateY(18px)}
    .auth-company-logo{display:block;width:248px;max-width:75%;height:auto;object-fit:contain;margin:0 auto 34px}
    .brand-auth .auth-card h1{margin:0 0 10px;color:#142031;font-size:2.35rem;font-weight:820;line-height:1.16;letter-spacing:-.035em;text-align:center}
    .brand-auth .auth-card .lead{max-width:390px;margin:0 auto 33px;color:#71809a;font-size:1rem;line-height:1.45;text-align:center}
    .brand-auth .field{width:100%;margin:10px 0 0}
    .visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
    .auth-password-control{position:relative;width:100%}.auth-password-control .input{height:58px;margin:0;padding:0 52px;border:1px solid #cfd7e5;border-radius:11px;background:#fff;color:#172033;font-size:1rem;box-shadow:0 1px 2px rgba(31,43,78,.02)}.auth-password-control .input::placeholder{color:#a4afc2}.auth-password-control .input:hover{border-color:#aebbd0}.auth-password-control .input:focus{border-color:#3972eb;box-shadow:0 0 0 3px rgba(49,105,232,.12)}
    .auth-field-icon,.auth-password-toggle{position:absolute;top:50%;transform:translateY(-50%);display:grid;place-items:center;color:#7186a5}.auth-field-icon{left:18px;width:21px;height:21px;pointer-events:none}.auth-password-toggle{right:10px;width:40px;height:40px;border:0;border-radius:8px;background:transparent}.auth-password-toggle:hover{background:#f2f5fa;color:#2f6de7}.auth-field-icon svg,.auth-password-toggle svg{width:21px;height:21px;display:block}
    .brand-auth .login-submit{width:100%;height:56px;margin-top:18px;border-radius:10px;background:#2f6fec;border-color:#2f6fec;font-size:1rem;font-weight:750;box-shadow:0 9px 20px rgba(47,111,236,.17)}.brand-auth .login-submit:hover{background:#245fd7;border-color:#245fd7}.brand-auth .login-submit:active{transform:translateY(1px)}
    .auth-support{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:34px;color:#71809a;font-size:.92rem}.auth-support svg{width:20px;height:20px;color:#2f6fec;flex:none}.auth-support a{color:#2f6fec;text-underline-offset:3px}.auth-support a:hover{color:#214fb4}
    .auth-side-copy{position:absolute;z-index:1;color:#8a96a9}.auth-side-copy:after{content:"";display:block;width:47px;height:2px;margin-top:25px;background:#98a4b6}.auth-side-left{left:clamp(60px,13vw,250px);top:40%;max-width:280px;font-size:2rem;line-height:1.22;font-weight:350;letter-spacing:-.025em}.auth-side-right{right:clamp(42px,4.5vw,90px);top:7.3%;width:175px;font-size:.9rem;line-height:1.65;font-weight:650;letter-spacing:.31em;text-transform:uppercase}.auth-side-right:after{margin-top:12px;width:38px}
    .auth-footer{position:absolute;z-index:2;left:50%;bottom:68px;transform:translateX(-50%);width:min(680px,calc(100vw - 40px));color:#72819a;font-size:.74rem;line-height:1.65;text-align:center}.auth-footer span{display:block}
    .brand-auth .form-error,.brand-auth .form-success{width:100%;text-align:left}
    @media(max-width:1320px){.auth-side-left{left:5vw;font-size:1.65rem;max-width:220px}.auth-side-right{right:3vw}}
    @media(max-width:1080px){.auth-side-copy{display:none}}
    @media(max-height:830px) and (min-width:651px){.brand-auth .auth-card-wrap{padding-bottom:82px}.brand-auth .auth-card{min-height:590px;padding-top:26px;padding-bottom:28px}.auth-company-logo{width:220px;margin-bottom:13px}.brand-auth .auth-card h1{font-size:1.8rem}.brand-auth .auth-card .lead{margin-bottom:15px}.auth-support{margin-top:22px}.auth-footer{bottom:14px}}
    @media(max-width:650px){.auth.brand-auth{display:grid;background-position:58% center}.auth.brand-auth:before{content:"";position:absolute;inset:0;background:rgba(247,249,252,.34);z-index:0}.brand-auth .auth-card-wrap{min-height:100vh;min-height:100svh;padding:22px 16px 92px}.brand-auth .auth-card{width:100%;min-height:0;padding:30px 24px 31px;border-radius:15px;transform:none;box-shadow:0 18px 48px rgba(47,64,91,.14)}.auth-company-logo{width:220px;margin-bottom:18px}.brand-auth .auth-card h1{font-size:1.72rem}.brand-auth .auth-card .lead{font-size:.94rem;margin-bottom:20px}.auth-password-control .input{height:54px}.brand-auth .login-submit{height:52px}.auth-support{margin-top:26px;gap:7px;font-size:.84rem;flex-wrap:wrap}.auth-footer{bottom:14px;font-size:.67rem;line-height:1.5}}
    @media(max-width:390px){.brand-auth .auth-card{padding-left:18px;padding-right:18px}.auth-company-logo{width:190px}.auth-support{font-size:.78rem}.auth-footer{font-size:.62rem}}

    /* Construcciones Kornilenko administration */
    .icon-sprite{position:absolute;width:0;height:0;overflow:hidden}
    .app{--canvas:#f8fafc;--surface:#fff;--surface-soft:#f8fafc;--ink:#0f172a;--muted:#64748b;--subtle:#94a3b8;--line:#e2e8f0;--line-strong:#cbd5e1;--brand:#2563eb;--brand-dark:#1d4ed8;--brand-soft:#eff6ff;--green:#16a34a;--green-soft:#ecfdf5;--amber:#d97706;--amber-soft:#fff7ed;--violet:#7c3aed;--red:#dc2626;--red-soft:#fef2f2;--shadow:0 16px 38px rgba(15,23,42,.08);--shadow-sm:0 4px 16px rgba(15,23,42,.055);--radius:13px;grid-template-columns:250px minmax(0,1fr);background:var(--canvas);font-size:15px}
    .app .sidebar{order:0;position:sticky;top:0;height:100vh;padding:22px 14px 14px;background:#fff;color:var(--ink);border-right:1px solid var(--line);box-shadow:5px 0 24px rgba(15,23,42,.035)}
    .app .brand{order:1;display:block;padding:0 8px 20px;margin:0;border-bottom:1px solid #edf1f6;text-align:center}
    .sidebar-logo{display:block;width:206px;max-width:100%;height:auto;margin:0 auto;object-fit:contain}
    .brand-account{max-width:100%;margin-top:7px;color:var(--muted);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app .nav-scroll{order:2;flex:1;min-height:0;overflow:auto;padding:18px 2px 10px;scrollbar-width:thin;scrollbar-color:#d8e0eb transparent}
    .app .nav-group{margin-bottom:20px}.app .nav-label{padding:0 11px;margin-bottom:6px;color:#94a3b8;font-size:.66rem;font-weight:800;letter-spacing:.12em}
    .app .nav-item{position:relative;min-height:40px;border:0;border-radius:9px;padding:8px 10px;color:#475569;background:transparent;gap:10px;font-size:.86rem;font-weight:650}
    .app .nav-item:hover{color:#1e3a8a;background:#f8fafc}.app .nav-item.active{color:#1d4ed8;background:#eff6ff}
    .app .nav-item.active:before{content:"";position:absolute;left:-2px;top:8px;bottom:8px;width:3px;border-radius:3px;background:#2563eb}
    .app .nav-icon{display:grid;width:23px;height:23px;place-items:center;border-radius:7px;color:#64748b;background:transparent;flex:none}
    .app .nav-icon svg,.app .top-actions svg,.app .metric-icon svg,.app .health-orbit svg,.app .card-title-icon svg{width:19px;height:19px;display:block;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
    .app .nav-item.active .nav-icon{color:#2563eb;background:#dbeafe}.app .nav-count{margin-left:auto;min-width:23px;padding:2px 6px;color:#64748b;background:#f1f5f9;font-size:.66rem}.app .nav-item.active .nav-count{color:#1d4ed8;background:#dbeafe}
    .app .bot-status{order:3;margin:6px 3px 10px;padding:12px;border:1px solid #dbe5ef;border-radius:11px;background:#f8fafc}.app .status-copy strong{color:#0f172a;font-size:.8rem}.app .status-copy span{color:#64748b;font-size:.69rem}.app .status-dot.online{background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.13)}
    .app .sidebar-footer{order:4;margin-top:0;padding:12px 8px 2px;border-top:1px solid #edf1f6;color:#94a3b8;font-size:.67rem;line-height:1.45}
    .app .main{position:relative;min-width:0;min-height:100vh;background:var(--canvas);isolation:isolate}.app.dashboard-home .main:before{content:"";position:absolute;z-index:-1;left:0;right:0;top:0;height:382px;background:#eef4fb url("/admin-assets/header.webp") center top/cover no-repeat;border-bottom:1px solid rgba(203,213,225,.65)}
    .app .topbar{height:64px;position:sticky;top:0;z-index:20;padding:0 30px;background:rgba(248,250,252,.88);border-bottom:1px solid rgba(226,232,240,.86);backdrop-filter:blur(14px)}.app.dashboard-home .topbar{background:rgba(255,255,255,.56)}
    .top-context{min-width:0}.app .breadcrumb{color:#64748b;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;font-weight:750}.app .top-title{color:#0f172a;font-size:.96rem;font-weight:760}
    .app .top-actions{display:flex;align-items:center;gap:8px}.top-icon-action,.top-notice{position:relative;width:38px;height:38px;display:grid;place-items:center;border:1px solid #dfe6ef;border-radius:10px;background:rgba(255,255,255,.88);color:#52647c}.top-icon-action:hover,.top-notice:hover{color:#2563eb;border-color:#bfdbfe;background:#eff6ff}.top-notice span{position:absolute;right:-4px;top:-5px;min-width:18px;height:18px;display:grid;place-items:center;padding:0 4px;border:2px solid #fff;border-radius:99px;background:#ef4444;color:#fff;font-size:.58rem;font-weight:850}.top-profile{height:42px;display:flex;align-items:center;gap:9px;margin:0 3px 0 5px;padding:0 12px 0 7px;border-left:1px solid #dbe3ed}.top-avatar{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:.77rem;font-weight:850}.top-profile strong,.top-profile small{display:block;line-height:1.25}.top-profile strong{font-size:.76rem}.top-profile small{color:#64748b;font-size:.64rem}
    .app .workspace{position:relative;z-index:1;width:100%;max-width:1520px;padding:27px 30px 72px}.app .page-head{margin-bottom:20px}.app .page-head h1{color:#0f172a;font-size:1.75rem;font-weight:780}.app .page-copy{color:#64748b}
    .dashboard-welcome{min-height:239px;align-items:center;margin:0!important;padding:22px 7px 24px}.dashboard-welcome>div{max-width:745px}.dashboard-kicker{margin-bottom:11px;color:#2563eb;font-size:.7rem;font-weight:850;letter-spacing:.18em;text-transform:uppercase}.app .dashboard-welcome h1{margin:0 0 11px;font-size:clamp(2.25rem,3.5vw,3.15rem);font-weight:790;line-height:1.04;letter-spacing:-.045em}.dashboard-welcome .page-copy{max-width:680px;color:#52647c;font-size:.97rem;line-height:1.55}.welcome-line{display:block;width:54px;height:3px;margin:21px 0 13px;border-radius:9px;background:#2563eb}.dashboard-welcome blockquote{margin:0;color:#64748b;font-size:.82rem;font-style:italic}
    .app .card{border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.96);padding:18px;box-shadow:var(--shadow-sm)}.app .card-head{margin-bottom:14px}.app .card-head h3{color:#172033;font-size:1rem;font-weight:760}.app .card-note{font-size:.75rem}.app .badge.brand{display:inline-flex;margin:0;padding:4px 8px;color:#1d4ed8;background:#eff6ff;border-radius:8px;font-size:.68rem}
    .app .home-hero{grid-template-columns:minmax(0,1.16fr) minmax(350px,.84fr);gap:14px;margin-bottom:14px}.app .health{padding:20px;border:1px solid #d9e3ef;border-left:4px solid #2563eb;color:#0f172a;background:rgba(255,255,255,.97)}.app .health-content{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:24px}.app .health-label{color:#64748b;font-size:.69rem}.app .health-title{margin:5px 0 5px;color:#0f172a;font-size:1.35rem;font-weight:770}.app .health-note{color:#64748b;font-size:.82rem;line-height:1.4}.app .health .btn{min-height:34px;margin-top:13px;padding:6px 10px;color:#1d4ed8;background:#eff6ff;border:1px solid #dbeafe}.app .health .btn:hover{background:#dbeafe}.health-orbit{width:54px;height:54px;display:grid;place-items:center;border-radius:50%;color:#2563eb;background:#eff6ff}.health-orbit svg{width:25px!important;height:25px!important}.health-audience{text-align:right;min-width:78px}.app .health-number{color:#0f172a;font-size:2.25rem;font-weight:790}.attention-card{min-height:100%}.card-title-row{display:flex;align-items:center;gap:10px}.card-title-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;color:#2563eb;background:#eff6ff}.app .attention-list{gap:6px;margin-top:4px}.app .attention-item{min-height:47px;border:1px solid #eef2f7;background:#f8fafc}.app .attention-item:hover{border-color:#bfdbfe;background:#eff6ff}.app .attention-icon{color:#2563eb;background:#dbeafe}.app .attention-main strong{font-size:.8rem}.app .attention-main span{font-size:.7rem}
    .app .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:14px;border:0;border-radius:0;overflow:visible;background:transparent}.app .metric{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid var(--line);border-radius:13px;background:#fff}.app .metric:last-child{border:1px solid var(--line)}.metric-icon{width:43px;height:43px;display:grid;place-items:center;border-radius:11px;flex:none}.metric-blue{color:#2563eb;background:#eff6ff}.metric-green{color:#16a34a;background:#ecfdf5}.metric-purple{color:#7c3aed;background:#f5f3ff}.metric-amber{color:#d97706;background:#fff7ed}.app .metric-label{font-size:.72rem;font-weight:680}.app .metric-value{margin:2px 0 0;color:#0f172a;font-size:1.72rem;font-weight:790}.app .metric-delta{font-size:.68rem}
    .app .dashboard-grid{grid-template-columns:minmax(0,1.48fr) minmax(320px,.72fr);align-items:start;gap:14px}.dashboard-side-stack{display:grid;gap:14px}.chart-card{min-height:432px}.chart-legend{display:flex;gap:15px;margin-top:7px;color:#64748b;font-size:.69rem}.chart-legend span{display:flex;align-items:center;gap:6px}.chart-legend i{width:9px;height:9px;border-radius:3px}.legend-received{background:#2563eb}.legend-sent{background:#a78bfa}.app .chart{height:335px;gap:8px;padding-top:24px}.app .chart-column{gap:8px}.chart-bars{width:100%;flex:1;min-height:0;display:flex;align-items:end;justify-content:center;gap:3px}.app .chart-bar{width:min(12px,44%);max-width:12px;border-radius:5px 5px 2px 2px;background:#2563eb}.app .chart-bar.sent{background:#a78bfa}.app .chart-label{font-size:.6rem}.app .list-item{padding:8px 0}.app .avatar{width:35px;height:35px;border-radius:10px;font-size:.75rem}.app .list-main strong{font-size:.8rem}.app .list-main span{font-size:.68rem}.inquiry-mini-status{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:none}.inquiry-mini-status.new{background:#2563eb}.inquiry-mini-status.in_progress{background:#f59e0b}.inquiry-mini-status.closed{background:#22c55e}
    .app .btn{border-radius:9px}.app .quick-grid{gap:12px;border:0;border-radius:0;background:transparent;overflow:visible}.app .quick-card{border:1px solid var(--line);border-radius:12px;background:#fff}.app .quick-card:last-child{border:1px solid var(--line)}.app .quick-card:hover{border-color:#bfdbfe;background:#f8fbff}.app .quick-icon{display:grid}
    .app .lang-switch{border-color:#dbe3ed;background:#f1f5f9}.app .lang-switch button.active{color:#1d4ed8}.app .input,.app .select,.app .textarea{border-color:#cfd8e5;border-radius:9px}.app .input:focus,.app .select:focus,.app .textarea:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}.app .sticky-save{border-color:#bfdbfe;border-radius:11px}.app .content-card,.app .reply-row,.app .user-card,.app .inquiry-card,.app .switch-row,.app .data-action{border-radius:11px}
    .notification-help{display:grid;gap:4px;margin:14px 0 16px;color:#6b4f16;background:#fffbeb;border-color:#fde68a}.notification-help strong{color:#854d0e;margin-bottom:2px}.notification-help span{display:block}.notification-help code{padding:2px 5px;border-radius:5px;color:#1d4ed8;background:#eff6ff;font-weight:750}.direct-message-composer{margin-top:18px;padding:16px;border:1px solid #bfdbfe;border-radius:12px;background:#f8fbff}.direct-message-composer>.row-between{margin-bottom:12px}.direct-message-composer .textarea{min-height:120px}.lead-summary{margin:16px 0;padding:13px 14px;border:1px solid #c7cff7;border-radius:11px;background:#f7f8ff}.lead-summary-title{font-weight:850;color:var(--brand-dark);margin-bottom:7px}.lead-summary-row{display:grid;grid-template-columns:118px minmax(0,1fr);gap:9px;padding:6px 0;border-top:1px solid #e3e6f7}.lead-summary-row:first-of-type{border-top:0}.lead-summary-row span{font-size:.76rem;color:var(--muted)}.lead-summary-row strong{font-size:.84rem;overflow-wrap:anywhere}
    .interface-help{display:grid;gap:4px;margin:0 0 16px;color:#31506f;background:#f0f7ff;border-color:#cfe3f7}.interface-help strong{color:#1d4ed8}.interface-groups{display:grid;gap:11px;margin-top:16px}.interface-group{padding:0!important;overflow:hidden}.interface-group>summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;cursor:pointer;list-style:none}.interface-group>summary::-webkit-details-marker{display:none}.interface-group>summary:after{content:"＋";color:#64748b;font-weight:800}.interface-group[open]>summary{border-bottom:1px solid var(--line)}.interface-group[open]>summary:after{content:"−"}.interface-group-title{display:grid;gap:2px}.interface-group-title span{color:#64748b;font-size:.74rem;font-weight:500}.interface-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 16px;padding:5px 18px 17px}.interface-grid .field{align-content:start}.interface-grid .textarea{min-height:92px}.interface-grid .interface-wide{grid-column:1/-1}.interface-list-note{display:block;color:#64748b;font-size:.72rem}
    @media(min-width:901px) and (max-width:1279px){.app{grid-template-columns:86px minmax(0,1fr)}.app .sidebar{padding-left:10px;padding-right:10px}.app .brand{padding-left:0;padding-right:0}.sidebar-logo{width:64px}.brand-account,.app .nav-label,.app .nav-text,.app .nav-count,.app .status-copy,.app .sidebar-footer{display:none}.app .nav-scroll{padding-top:14px}.app .nav-group{margin-bottom:8px}.app .nav-item{width:52px;margin:0 auto;justify-content:center;padding:8px}.app .nav-icon{width:30px;height:30px}.app .bot-status{width:52px;min-height:43px;margin:6px auto 4px;justify-content:center}.app .topbar{padding-left:24px;padding-right:24px}.app .workspace{padding-left:24px;padding-right:24px}.global-unsaved{left:calc(86px + (100vw - 86px)/2)}.app .home-hero{grid-template-columns:1fr}.app .metric-grid{grid-template-columns:1fr 1fr}.app .dashboard-grid{grid-template-columns:1fr}.dashboard-side-stack{grid-template-columns:1fr 1fr}.chart-card{min-height:390px}.app .chart{height:290px}}
    @media(max-width:900px){.app{display:block}.app .sidebar{position:fixed;left:0;top:0;width:min(310px,88vw);height:100vh;transform:translateX(-105%);transition:transform .2s;box-shadow:0 22px 55px rgba(15,23,42,.18)}.app .sidebar.open{transform:none}.app .brand{padding-bottom:15px}.sidebar-logo{width:190px}.app .nav-label,.app .nav-text,.app .nav-count,.app .status-copy,.app .sidebar-footer{display:block}.app .nav-item{width:100%;justify-content:flex-start}.app .nav-count{margin-left:auto}.app .bot-status{width:auto;justify-content:space-between}.app .mobile-bar{height:64px;background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}.mobile-brand img{width:118px;height:48px;object-fit:contain}.mobile-brand>span{padding-left:9px;border-left:1px solid #e2e8f0;font-size:.83rem}.app .workspace{padding:22px 18px 84px}.app.dashboard-home .main:before{top:0;height:345px;background-image:url("/admin-assets/header-mobile.webp")}.dashboard-welcome{min-height:258px;padding-top:15px}.app .home-hero{grid-template-columns:1fr}.app .dashboard-grid{grid-template-columns:1fr}.dashboard-side-stack{grid-template-columns:1fr 1fr}.global-unsaved{left:50%}}
    @media(max-width:650px){.mobile-brand img{width:98px}.app .workspace{padding-left:12px;padding-right:12px}.dashboard-welcome{min-height:265px;padding-left:3px}.app .dashboard-welcome h1{font-size:2.25rem}.dashboard-welcome .page-copy{font-size:.88rem}.app .health-content{grid-template-columns:minmax(0,1fr) auto;gap:14px}.health-orbit{display:none}.health-audience{grid-column:2;grid-row:1}.app .metric-grid{grid-template-columns:1fr 1fr;gap:10px}.app .metric{display:block;padding:13px}.metric-icon{width:36px;height:36px;margin-bottom:9px}.app .metric-value{font-size:1.5rem}.app .dashboard-grid{gap:12px}.dashboard-side-stack{grid-template-columns:1fr}.chart-card{min-height:345px}.app .chart{height:245px;gap:3px}.chart-legend{gap:10px}.app .quick-card{border-radius:10px}.top-profile{display:none}.interface-grid{grid-template-columns:1fr}.interface-grid .interface-wide{grid-column:auto}}
    @media(max-width:420px){.app .metric-grid{grid-template-columns:1fr}.app .metric{display:flex}.metric-icon{margin-bottom:0}.app .health-content{display:block}.health-audience{text-align:left;margin-top:14px}.app .chart-label{font-size:.53rem}.dashboard-welcome blockquote{font-size:.75rem}}

    /* Horizontal navigation: one compact sticky header instead of a sidebar */
    .app{display:block;grid-template-columns:none}
    .app .app-header{position:sticky;top:0;left:auto;width:100%;height:72px;padding:0 22px;display:flex;flex-direction:row;align-items:center;gap:16px;overflow:visible;color:var(--ink);background:rgba(255,255,255,.96);border:0;border-bottom:1px solid var(--line);box-shadow:0 5px 20px rgba(15,23,42,.055);backdrop-filter:blur(16px);z-index:70}
    .app .brand{order:0;display:flex;align-items:center;gap:12px;min-width:190px;margin:0;padding:0 18px 0 0;border:0;border-right:1px solid #e8edf3;text-align:left}
    .app .sidebar-logo{width:126px;max-width:none;height:52px;margin:0;object-fit:contain}
    .brand-context{min-width:0;display:none;gap:1px}.brand-context strong{max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#172033;font-size:.78rem;font-weight:780}.brand-context .brand-account{max-width:92px;margin:0;font-size:.62rem}
    .app .nav-scroll{order:1;flex:1;min-width:0;display:flex;align-items:center;gap:4px;padding:0;overflow:visible}
    .app .nav-group{position:relative;margin:0}.nav-group-toggle{min-height:40px;display:flex;align-items:center;gap:7px;padding:8px 11px;border:0;border-radius:9px;color:#475569;background:transparent;cursor:pointer;list-style:none;font-size:.84rem;font-weight:680;white-space:nowrap}.nav-group-toggle::-webkit-details-marker{display:none}.nav-group-toggle:hover,.nav-group[open]>.nav-group-toggle,.nav-group:has(.nav-item.active)>.nav-group-toggle{color:#1d4ed8;background:#eff6ff}.nav-chevron{display:inline-block;color:#94a3b8;font-size:.9rem;line-height:1;transition:transform .16s}.nav-group[open] .nav-chevron{transform:rotate(180deg)}
    .nav-dropdown{position:absolute;left:0;top:calc(100% + 10px);width:280px;display:grid;gap:3px;padding:8px;border:1px solid #dce4ee;border-radius:12px;background:#fff;box-shadow:0 18px 42px rgba(15,23,42,.14);z-index:75}.nav-dropdown:before{content:"";position:absolute;left:26px;top:-6px;width:11px;height:11px;transform:rotate(45deg);background:#fff;border-left:1px solid #dce4ee;border-top:1px solid #dce4ee}
    .app .nav-item{position:relative;width:auto;min-height:40px;display:flex;align-items:center;gap:8px;margin:0;padding:8px 11px;border:0;border-radius:9px;color:#475569;background:transparent;font-size:.84rem;font-weight:670;white-space:nowrap}.app .nav-item:hover{color:#1d4ed8;background:#f5f8ff}.app .nav-item.active{color:#1d4ed8;background:#eff6ff}.app .nav-item.active:before{display:none}.app .nav-primary .nav-icon{display:none}.app .nav-primary .nav-count{margin-left:2px}.nav-dropdown .nav-item{width:100%;min-height:42px;text-align:left}.nav-dropdown .nav-icon{display:grid;width:26px;height:26px}.nav-dropdown .nav-count{margin-left:auto}
    .header-tools{order:2;display:flex;align-items:center;gap:9px;margin-left:auto}.app .header-tools .bot-status{order:0;width:auto;min-width:128px;min-height:42px;display:flex;justify-content:flex-start;gap:9px;margin:0;padding:6px 10px;border-color:#dce5ef;border-radius:10px;background:#f8fafc}.app .header-tools .status-dot{order:0}.app .header-tools .status-copy{order:1}.app .header-tools .status-copy strong{font-size:.72rem}.app .header-tools .status-copy span{font-size:.6rem;white-space:nowrap}.app .header-tools .top-actions{display:flex}.app .top-profile{margin-left:0;padding-right:8px}.app .sidebar-footer,.app .mobile-bar,.app .topbar{display:none!important}.app .mobile-menu{display:none}
    .app .main{min-height:calc(100vh - 72px)}.app .workspace{width:100%;max-width:1720px;margin:0 auto;padding:24px clamp(20px,2.2vw,36px) 72px}.app.dashboard-home .main:before{top:0}.campaign-preview,.contact-preview,.user-detail{top:90px}.global-unsaved{left:50%}
    @media(min-width:901px) and (max-width:1199px){.app .app-header{gap:10px;padding-left:16px;padding-right:16px}.app .brand{min-width:auto;padding-right:12px}.app .sidebar-logo{width:112px}.brand-context{display:none}.app .nav-scroll{gap:1px}.app .nav-item,.nav-group-toggle{padding-left:8px;padding-right:8px;font-size:.79rem}.app .nav-primary .nav-icon{display:none}.app .top-profile{display:none}.app .header-tools{gap:5px}.app .header-tools .bot-status{min-width:0;padding-left:8px;padding-right:8px}.app .header-tools .status-copy span{display:none}.app .workspace{padding-left:22px;padding-right:22px}.app .home-hero{grid-template-columns:minmax(0,1.16fr) minmax(330px,.84fr)}.app .metric-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.app .dashboard-grid{grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr)}.dashboard-side-stack{grid-template-columns:1fr}}
    @media(max-width:900px){.app{display:block}.app .app-header{position:sticky;top:0;width:100%;height:62px;padding:0 10px;gap:6px;transform:none;box-shadow:0 5px 18px rgba(15,23,42,.075)}.app .brand{flex:1;min-width:0;margin:0;padding:0 8px 0 0;border-right:0;gap:8px}.app .sidebar-logo{width:108px;height:48px}.brand-context{display:grid}.brand-context strong{max-width:105px;font-size:.73rem}.brand-context .brand-account{display:none}.app .mobile-menu{order:3;width:36px;height:36px;display:grid;place-items:center;flex:none;border:1px solid #dce4ee;border-radius:9px;background:#fff;color:#334155;font-size:1.05rem}.app .mobile-menu:hover{color:#1d4ed8;background:#eff6ff}.app .header-tools{order:2;gap:4px;margin-left:0}.app .header-tools .bot-status,.app .top-profile{display:none}.app .top-actions{gap:4px}.top-icon-action,.top-notice{width:35px;height:35px;border-radius:9px}.app .nav-scroll{position:fixed;left:0;right:0;top:62px;z-index:72;display:none;max-height:calc(100vh - 62px);max-height:calc(100svh - 62px);overflow:auto;padding:10px;background:#fff;border-top:1px solid var(--line);box-shadow:0 18px 42px rgba(15,23,42,.16)}.app .app-header.open .nav-scroll{display:grid;align-content:start;gap:5px}.app .nav-primary,.nav-group-toggle{width:100%;min-height:44px;justify-content:flex-start;padding:10px 12px;font-size:.88rem}.app .nav-primary .nav-icon{display:grid}.app .nav-primary .nav-count{margin-left:auto}.app .nav-group{width:100%}.nav-group-toggle{justify-content:space-between}.nav-dropdown{position:static;width:100%;margin:4px 0 2px;padding:5px 5px 5px 13px;border:0;border-left:2px solid #dbeafe;border-radius:0;background:#f8fafc;box-shadow:none}.nav-dropdown:before{display:none}.nav-dropdown .nav-item{background:transparent}.sidebar-overlay:not(.hidden){display:block;position:fixed;inset:62px 0 0;background:rgba(15,23,42,.35);z-index:68}.app .main{min-height:calc(100vh - 62px)}.app .workspace{padding:20px 18px 84px}.app.dashboard-home .main:before{top:0;height:345px;background-image:url("/admin-assets/header-mobile.webp")}.dashboard-welcome{min-height:258px;padding-top:15px}.app .home-hero{grid-template-columns:1fr}.app .dashboard-grid{grid-template-columns:1fr}.dashboard-side-stack{grid-template-columns:1fr 1fr}.global-unsaved{left:50%}}
    @media(max-width:650px){.app .sidebar-logo{width:94px}.brand-context strong{max-width:76px}.app #refreshBtn3{display:none}.app .workspace{padding-left:12px;padding-right:12px}.dashboard-welcome{min-height:265px;padding-left:3px}.app .dashboard-welcome h1{font-size:2.25rem}.dashboard-welcome .page-copy{font-size:.88rem}.app .health-content{grid-template-columns:minmax(0,1fr) auto;gap:14px}.health-orbit{display:none}.health-audience{grid-column:2;grid-row:1}.app .metric-grid{grid-template-columns:1fr 1fr;gap:10px}.app .metric{display:block;padding:13px}.metric-icon{width:36px;height:36px;margin-bottom:9px}.app .metric-value{font-size:1.5rem}.app .dashboard-grid{gap:12px}.dashboard-side-stack{grid-template-columns:1fr}.chart-card{min-height:345px}.app .chart{height:245px;gap:3px}.chart-legend{gap:10px}.app .quick-card{border-radius:10px}.interface-grid{grid-template-columns:1fr}.interface-grid .interface-wide{grid-column:auto}}
    @media(max-width:430px){.brand-context{display:none}.app .sidebar-logo{width:108px}.app .top-notice,.app #logoutBtn3{width:34px;height:34px}.app .mobile-menu{width:34px;height:34px}}
    /* Compact dashboard: important numbers and pending work stay above the fold */
    .app.dashboard-home .workspace{padding-top:0}
    .app .dashboard-welcome{min-height:154px;padding-top:18px;padding-bottom:18px}
    .app .dashboard-welcome h1{font-size:clamp(2rem,3vw,2.65rem);margin-bottom:7px}
    .dashboard-welcome .page-copy{font-size:.9rem;line-height:1.45}
    .welcome-line{margin:14px 0 9px}
    .app .home-hero{align-items:start}
    .app .health{min-height:0}
    .attention-card{min-height:0}
    .dashboard-priority-note{display:flex;align-items:center;gap:8px;margin:-2px 0 12px;color:#64748b;font-size:.76rem}
    .dashboard-priority-note:before{content:"";width:7px;height:7px;border-radius:50%;background:#2563eb;box-shadow:0 0 0 4px #dbeafe}
    .editor-step-nav{position:sticky;top:74px;z-index:2;display:flex;gap:6px;margin:-4px 0 16px;padding:8px;border:1px solid #dbe5ef;border-radius:12px;background:rgba(255,255,255,.96);box-shadow:0 8px 22px rgba(15,23,42,.06);overflow:auto;backdrop-filter:blur(10px)}
    .editor-step-nav button{min-height:34px;flex:0 0 auto;padding:6px 10px;border:0;border-radius:8px;color:#475569;background:#f1f5f9;font-size:.74rem;font-weight:750;cursor:pointer}.editor-step-nav button:hover{color:#1d4ed8;background:#dbeafe}
    .property-editor-block{scroll-margin-top:132px}.property-editor-block+.property-editor-block{margin-top:16px}.property-card-preview{margin:12px 0 16px;padding:14px;border:1px solid #bfdbfe;border-radius:12px;background:linear-gradient(145deg,#f8fbff,#eef6ff)}
    .property-preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.property-preview-shell{display:grid;grid-template-columns:92px minmax(0,1fr);gap:12px;align-items:start;padding:12px;border-radius:12px;background:#fff;box-shadow:0 6px 18px rgba(15,23,42,.07)}.property-preview-image{height:82px;display:grid;place-items:center;overflow:hidden;border-radius:9px;color:#64748b;background:#e2e8f0;font-size:.68rem;text-align:center}.property-preview-image img{width:100%;height:100%;object-fit:cover}.property-preview-copy{min-width:0;display:grid;gap:4px}.property-preview-copy strong{font-size:.9rem}.property-preview-copy span{color:#64748b;font-size:.74rem;line-height:1.35}.property-preview-copy .property-preview-price{color:#0f172a;font-weight:800}.translation-summary{display:grid;gap:4px}.translation-summary .summary-note{display:block;margin-top:5px;color:#64748b}
    .campaign-readiness,.campaign-safety{display:grid;gap:8px;margin:10px 0 14px;padding:12px;border:1px solid #dbe5ef;border-radius:11px;background:#f8fafc}.campaign-safety.warn{border-color:#fed7aa;background:#fff7ed}.campaign-safety.good{border-color:#bbf7d0;background:#f0fdf4}.campaign-ready-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.78rem}.campaign-ready-row strong{font-size:.76rem}.campaign-ready-row span{color:#64748b}.campaign-safety-list{display:flex;flex-wrap:wrap;gap:6px}.inquiry-card.new{border-left:4px solid #2563eb;background:#f8fbff}.delivery-state{display:inline-flex;align-items:center;gap:4px;margin-left:6px;color:#15803d;font-weight:700}.delivery-state.failed{color:#b91c1c}
    :focus-visible{outline:3px solid rgba(37,99,235,.38);outline-offset:2px}
    @media(max-width:650px){.editor-step-nav{top:62px}.property-preview-shell{grid-template-columns:72px minmax(0,1fr)}.property-preview-image{height:66px}#campaignForm3 .card-head{flex-wrap:wrap}#campaignEstimate3{max-width:100%;white-space:normal}}
    @media(max-width:900px){.app .dashboard-welcome{min-height:132px;padding-top:15px;padding-bottom:15px}.app .dashboard-welcome h1{font-size:2rem}.dashboard-welcome blockquote,.welcome-line{display:none}.dashboard-priority-note{margin-top:2px}}
  </style>
</head>
<body>
  <section id="setupScreen3" class="auth hidden"><div class="auth-visual"><div class="auth-copy"><strong>Ваш Telegram-бот.<br>Под полным контролем.</strong><p>Контент, пользователи и рассылки собраны в одном понятном рабочем кабинете.</p></div></div><div class="auth-card-wrap"><form id="setupForm3" class="auth-card"><div class="logo">TG</div><h1>Подключение бота</h1><p class="lead">Укажите токен из BotFather и создайте пароль администратора.</p><div class="field"><label for="setupToken3">Токен Telegram-бота</label><input id="setupToken3" class="input" autocomplete="off" placeholder="123456789:AA..." required><span class="hint">Токен проверяется через Telegram.</span></div><div class="field"><label for="setupPassword3">Пароль администратора</label><input id="setupPassword3" class="input" type="password" minlength="8" autocomplete="new-password" required><span class="hint">Минимум 8 символов.</span></div><button class="btn wide" type="submit">Подключить бота</button><div id="setupMessage3"></div></form></div></section>
  <section id="loginScreen3" class="auth brand-auth hidden">
    <div class="auth-side-copy auth-side-left" aria-hidden="true">Надёжные<br>пространства<br>для будущего</div>
    <div class="auth-side-copy auth-side-right" aria-hidden="true">Строим<br>сегодня<br>для лучшего<br>завтра</div>
    <div class="auth-card-wrap">
      <form id="loginForm3" class="auth-card">
        <img class="auth-company-logo" src="/login-assets/logo.png" alt="Construcciones Kornilenko">
        <h1>Вход в кабинет</h1>
        <p class="lead">Введите пароль администратора<br>для управления Telegram-ботом</p>
        <div class="field">
          <label class="visually-hidden" for="loginPassword3">Пароль</label>
          <div class="auth-password-control">
            <span class="auth-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 14v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
            <input id="loginPassword3" class="input" type="password" autocomplete="current-password" placeholder="Пароль" required autofocus>
            <button id="loginPasswordToggle3" class="auth-password-toggle" type="button" aria-label="Показать пароль" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.7" stroke="currentColor" stroke-width="1.8"/></svg></button>
          </div>
        </div>
        <button class="btn login-submit" type="submit">Войти</button>
        <div id="loginMessage3"></div>
        <div class="auth-support"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m21 4-3 16-6-4-3 3v-5l8-7-10 6-4-2 18-7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span>Нужна помощь? <a href="https://t.me/construcciones_kornilenko_bot" target="_blank" rel="noopener noreferrer">Напишите в поддержку</a></span></div>
      </form>
    </div>
    <footer class="auth-footer"><span>© 2026 Construcciones Kornilenko. Панель управления Telegram-ботом.</span><span>Строим сегодня для лучшего завтра.</span></footer>
  </section>

  <div id="app3" class="app dashboard-home hidden">
    <svg class="icon-sprite" aria-hidden="true"><symbol id="i-home" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8Z"/></symbol><symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></symbol><symbol id="i-building" viewBox="0 0 24 24"><path d="M4 21V5l8-3v19M12 8h8v13M2 21h20M7 7h2M7 11h2M7 15h2M15 12h2M15 16h2"/></symbol><symbol id="i-percent" viewBox="0 0 24 24"><path d="m6 18 12-12M7.5 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></symbol><symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></symbol><symbol id="i-phone" viewBox="0 0 24 24"><path d="M8.5 3H5.7A2.7 2.7 0 0 0 3 5.7C3 14.15 9.85 21 18.3 21a2.7 2.7 0 0 0 2.7-2.7v-2.8l-4-1-1.2 2.2a14.4 14.4 0 0 1-8.5-8.5L9.5 7l-1-4Z"/></symbol><symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></symbol><symbol id="i-reply" viewBox="0 0 24 24"><path d="m9 8-5 4 5 4v-3h4c4 0 6 2 7 5 0-7-3-10-7-10H9Z"/></symbol><symbol id="i-send" viewBox="0 0 24 24"><path d="m3 11 18-8-7 18-3-7-8-3Z"/><path d="m11 14 4-4"/></symbol><symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v2"/></symbol><symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.7.6 1 .27.27.62.4 1 .4h.09v4H21a1.7 1.7 0 0 0-1.6.6Z"/></symbol><symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 6v5h-5M4 18v-5h5M18.5 9a7 7 0 0 0-12-2L4 11M5.5 15a7 7 0 0 0 12 2L20 13"/></symbol><symbol id="i-logout" viewBox="0 0 24 24"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M18 12H8"/></symbol><symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></symbol></svg>
    <header id="sidebar3" class="sidebar app-header">
      <div class="brand"><img class="sidebar-logo" src="/admin-assets/sidebar-logo.png" alt="Construcciones Kornilenko"><div class="brand-context"><strong id="topTitle3">Главная</strong><span id="botUsername3" class="brand-account">Telegram</span></div></div>
      <button id="mobileMenuBtn3" class="mobile-menu" type="button" aria-label="Открыть меню" aria-expanded="false">☰</button>
      <nav id="nav3" class="nav-scroll" aria-label="Разделы панели">
        <button class="nav-item nav-primary active" data-view="home"><span class="nav-icon"><svg><use href="#i-home"></use></svg></span><span class="nav-text">Главная</span></button>
        <details class="nav-group"><summary class="nav-group-toggle"><span>Контент</span><span class="nav-chevron" aria-hidden="true">⌄</span></summary><div class="nav-dropdown"><button class="nav-item" data-view="welcome"><span class="nav-icon"><svg><use href="#i-image"></use></svg></span><span class="nav-text">Приветствие</span></button><button class="nav-item" data-view="interface"><span class="nav-icon"><svg><use href="#i-settings"></use></svg></span><span class="nav-text">Тексты интерфейса</span></button><button class="nav-item" data-view="properties"><span class="nav-icon"><svg><use href="#i-building"></use></svg></span><span class="nav-text">Объекты</span><span id="navPropertyCount" class="nav-count">0</span></button><button class="nav-item" data-view="offers"><span class="nav-icon"><svg><use href="#i-percent"></use></svg></span><span class="nav-text">Акции</span><span id="navOfferCount" class="nav-count">0</span></button><button class="nav-item" data-view="about"><span class="nav-icon"><svg><use href="#i-info"></use></svg></span><span class="nav-text">О нас</span></button><button class="nav-item" data-view="contacts"><span class="nav-icon"><svg><use href="#i-phone"></use></svg></span><span class="nav-text">Контакты менеджера</span></button></div></details>
        <details class="nav-group"><summary class="nav-group-toggle"><span>Коммуникации</span><span class="nav-chevron" aria-hidden="true">⌄</span></summary><div class="nav-dropdown"><button class="nav-item" data-view="inquiries"><span class="nav-icon"><svg><use href="#i-mail"></use></svg></span><span class="nav-text">Обращения</span><span id="navInquiryCount" class="nav-count">0</span></button><button class="nav-item" data-view="replies"><span class="nav-icon"><svg><use href="#i-reply"></use></svg></span><span class="nav-text">Автоответы</span><span id="navReplyCount" class="nav-count">0</span></button><button class="nav-item" data-view="campaigns"><span class="nav-icon"><svg><use href="#i-send"></use></svg></span><span class="nav-text">Рассылки</span></button></div></details>
        <button class="nav-item nav-primary" data-view="audience"><span class="nav-icon"><svg><use href="#i-users"></use></svg></span><span class="nav-text">Пользователи</span><span id="navUserCount" class="nav-count">0</span></button>
        <button class="nav-item nav-primary" data-view="settings"><span class="nav-icon"><svg><use href="#i-settings"></use></svg></span><span class="nav-text">Настройки</span></button>
      </nav>
      <div class="header-tools"><div class="bot-status" title="Состояние подключения"><span id="sideDot3" class="status-dot"></span><div class="status-copy"><strong id="sideStatus3">Проверка связи</strong><span id="sideStatusNote3">Состояние бота</span></div></div><div class="top-actions"><button id="refreshBtn3" class="top-icon-action" aria-label="Обновить данные"><svg><use href="#i-refresh"></use></svg></button><button class="top-notice quick-nav" data-view="inquiries" aria-label="Открыть обращения"><svg><use href="#i-bell"></use></svg><span id="topInquiryCount3">0</span></button><div class="top-profile"><span class="top-avatar">A</span><span><strong>Администратор</strong><small>Управление ботом</small></span></div><button id="logoutBtn3" class="top-icon-action" aria-label="Выйти"><svg><use href="#i-logout"></use></svg></button></div></div>
      <span id="breadcrumb3" class="visually-hidden">Обзор</span><span id="mobileTitle3" class="visually-hidden">Главная</span>
    </header>
    <div id="sidebarOverlay3" class="sidebar-overlay hidden"></div>
    <main class="main">
      <div class="workspace">
        <section id="view-home" class="view active">
          <div class="page-head dashboard-welcome"><div><div class="dashboard-kicker">Панель управления</div><h1>Добро пожаловать!</h1><p class="page-copy">Управляйте объектами, обращениями и рекламой вашего Telegram-бота в одном понятном кабинете.</p><span class="welcome-line"></span><blockquote>«Строим сегодня для лучшего завтра»</blockquote></div></div>
          <div class="home-hero"><div class="card health"><div class="health-content"><div><div class="health-label">Состояние бота</div><div id="healthTitle3" class="health-title">Проверяем подключение</div><div id="healthNote3" class="health-note">Получаем актуальные данные.</div><button class="btn quick-nav" data-view="settings">Открыть настройки</button></div><div class="health-orbit" aria-hidden="true"><svg><use href="#i-send"></use></svg></div><div class="health-audience"><div id="healthNumber3" class="health-number">0</div><div class="small">в аудитории</div></div></div></div><div class="card attention-card"><div class="card-head"><div class="card-title-row"><span class="card-title-icon"><svg><use href="#i-bell"></use></svg></span><div><h3>Требует внимания</h3><div class="card-note">Что стоит заполнить или проверить</div></div></div></div><div id="attentionList3" class="attention-list"></div></div></div>
          <div class="grid metric-grid"><div class="card metric"><span class="metric-icon metric-blue"><svg><use href="#i-users"></use></svg></span><div><div class="metric-label">Пользователи</div><div id="metricUsers3" class="metric-value">0</div><div id="metricUsersNote3" class="metric-delta">0 доступны</div></div></div><div class="card metric"><span class="metric-icon metric-green"><svg><use href="#i-building"></use></svg></span><div><div class="metric-label">Активные объекты</div><div id="metricReceived3" class="metric-value">0</div><div class="metric-delta">показываются в боте</div></div></div><div class="card metric"><span class="metric-icon metric-purple"><svg><use href="#i-mail"></use></svg></span><div><div class="metric-label">Новые обращения</div><div id="metricSent3" class="metric-value">0</div><div class="metric-delta">требуют ответа</div></div></div><div class="card metric"><span class="metric-icon metric-amber"><svg><use href="#i-percent"></use></svg></span><div><div class="metric-label">Интерес к объектам</div><div id="metricReplies3" class="metric-value">0</div><div id="metricRepliesNote3" class="metric-delta">заявки и действия</div></div></div></div>
          <div class="grid dashboard-grid"><div class="card chart-card"><div class="card-head"><div><h3>Сообщения за 14 дней</h3><div class="chart-legend"><span><i class="legend-received"></i>Входящие</span><span><i class="legend-sent"></i>Ответы бота</span></div></div><span id="chartTotal3" class="badge brand">0 сообщений</span></div><div id="activityChart3" class="chart" aria-label="График сообщений"></div></div><div class="dashboard-side-stack"><div class="card"><div class="card-head"><div><h3>Последние пользователи</h3><div class="card-note">Недавняя активность</div></div><button class="btn ghost small quick-nav" data-view="audience">Все</button></div><div id="recentUsers3" class="list"></div></div><div class="card"><div class="card-head"><div><h3>Реакции клиентов</h3><div class="card-note">Оценки сообщений и предложений</div></div><span id="reactionTotal3" class="badge brand">0</span></div><div id="recentReactions3" class="list"></div></div><div class="card"><div class="card-head"><div><h3>Последние обращения</h3><div class="card-note">Запросы потенциальных клиентов</div></div><button class="btn ghost small quick-nav" data-view="inquiries">Все</button></div><div id="recentInquiries3" class="list"></div></div></div></div>
          <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Эффективность объектов</h3><div class="card-note">Показы карточек и действия потенциальных клиентов</div></div><button class="btn ghost small quick-nav" data-view="properties">Все объекты</button></div><div id="propertyPerformance3" class="performance-list"></div></div>
          <div class="grid quick-grid"><button class="quick-card quick-nav" data-view="properties"><span class="quick-icon">＋</span><strong>Добавить объект</strong><span>Создать карточку в каталоге</span></button><button class="quick-card quick-nav" data-view="campaigns"><span class="quick-icon">↗</span><strong>Создать рассылку</strong><span>Сообщить новость аудитории</span></button><button class="quick-card quick-nav" data-view="replies"><span class="quick-icon">↩</span><strong>Настроить ответ</strong><span>Автоматизировать частый вопрос</span></button></div>
          <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Журнал ошибок</h3><div class="card-note">Последние проблемы подключения и отправки</div></div><button id="clearErrorsBtn3" class="btn danger small">Очистить</button></div><div id="errorList3" class="list"></div></div>
        </section>

        <section id="view-welcome" class="view">
          <div class="page-head"><div><h1>Приветствие</h1><p class="page-copy">Первое сообщение, изображение, помощь и ответ на неизвестный вопрос.</p></div><button id="saveWelcomeTop3" class="btn">Сохранить</button></div>
          <form id="welcomeForm3" data-saveable><div id="welcomeLang3" class="lang-switch" role="tablist"><button class="active" data-lang="ru" type="button" role="tab" aria-selected="true">Русский</button><button data-lang="en" type="button" role="tab">English</button><button data-lang="es" type="button" role="tab">Español</button></div><div id="welcomePanes3"></div><div class="sticky-save"><div><strong>Приветствие</strong><div class="card-note">Сохраните тексты и выбранное изображение</div></div><button class="btn" type="submit">Сохранить изменения</button></div></form>
        </section>

        <section id="view-interface" class="view">
          <div class="page-head"><div><h1>Тексты интерфейса</h1><p class="page-copy">Все постоянные надписи, кнопки, подсказки и сообщения форм, которые видит пользователь бота.</p></div><button id="saveInterfaceTop3" class="btn">Сохранить</button></div>
          <div class="callout interface-help"><strong>Как редактировать</strong><span>Выберите язык, откройте нужную группу и измените текст. В полях со списками каждый вариант располагается на отдельной строке.</span></div>
          <form id="interfaceForm3" data-saveable><div id="interfaceLang3" class="lang-switch" role="tablist"><button class="active" data-lang="ru" type="button" role="tab" aria-selected="true">Русский</button><button data-lang="en" type="button" role="tab">English</button><button data-lang="es" type="button" role="tab">Español</button></div><div id="interfacePanes3"></div><div class="sticky-save"><div><strong>Интерфейс бота</strong><div class="card-note">Изменения применятся ко всем новым сообщениям</div></div><button class="btn" type="submit">Сохранить тексты</button></div></form>
        </section>

        <section id="view-properties" class="view">
          <div class="page-head"><div><h1>Объекты</h1><p class="page-copy">Карточки недвижимости, которые пользователь видит в разделе «Наши объекты».</p></div><button id="newPropertyBtn3" class="btn">＋ Добавить объект</button></div>
          <details class="card section-copy-editor"><summary><strong>Текст пустого каталога</strong> <span class="card-note">показывается, если активных объектов нет</span></summary><form id="propertySectionForm3" data-saveable><div class="grid three-col" style="margin-top:16px"><div class="field"><label for="sectionObjectsRu3">Русский</label><textarea id="sectionObjectsRu3" class="textarea compact" maxlength="4000" required></textarea></div><div class="field"><label for="sectionObjectsEn3">English</label><textarea id="sectionObjectsEn3" class="textarea compact" maxlength="4000" required></textarea></div><div class="field"><label for="sectionObjectsEs3">Español</label><textarea id="sectionObjectsEs3" class="textarea compact" maxlength="4000" required></textarea></div></div><button class="btn secondary small" type="submit">Сохранить текст</button></form></details>
          <div class="toolbar"><input id="propertySearch3" class="input" placeholder="Найти по названию, городу или номеру"><select id="propertyStatusFilter3" class="select"><option value="">Все статусы</option><option value="active">Показываются</option><option value="reserved">Забронированы</option><option value="hidden">Скрыты</option><option value="sold">Проданы</option></select><span id="propertyResultCount3" class="badge">0 объектов</span></div><div id="propertyGrid3" class="grid catalog-grid"></div>
        </section>

        <section id="view-offers" class="view">
          <div class="page-head"><div><h1>Акции</h1><p class="page-copy">Предложения с автоматическим включением и завершением по указанным датам.</p></div><button id="newOfferBtn3" class="btn">＋ Добавить акцию</button></div>
          <details class="card section-copy-editor"><summary><strong>Текст при отсутствии акций</strong> <span class="card-note">показывается, если действующих акций нет</span></summary><form id="offerSectionForm3" data-saveable><div class="grid three-col" style="margin-top:16px"><div class="field"><label for="sectionPromotionsRu3">Русский</label><textarea id="sectionPromotionsRu3" class="textarea compact" maxlength="4000" required></textarea></div><div class="field"><label for="sectionPromotionsEn3">English</label><textarea id="sectionPromotionsEn3" class="textarea compact" maxlength="4000" required></textarea></div><div class="field"><label for="sectionPromotionsEs3">Español</label><textarea id="sectionPromotionsEs3" class="textarea compact" maxlength="4000" required></textarea></div></div><button class="btn secondary small" type="submit">Сохранить текст</button></form></details>
          <div class="toolbar"><input id="offerSearch3" class="input" placeholder="Найти акцию"><select id="offerStatusFilter3" class="select"><option value="">Все</option><option value="active">Активные</option><option value="scheduled">Запланированные</option><option value="expired">Завершённые</option><option value="disabled">Выключенные</option></select><span id="offerResultCount3" class="badge">0 акций</span></div><div id="offerGrid3" class="grid catalog-grid"></div>
        </section>

        <section id="view-about" class="view">
          <div class="page-head"><div><h1>О нас</h1><p class="page-copy">Текст о компании, который пользователь получает после нажатия кнопки «О нас».</p></div></div>
          <form id="aboutForm3" class="card" data-saveable><div class="card-head"><div><h3>Текст на трёх языках</h3><div class="card-note">Каждая языковая версия сохраняется одновременно</div></div><button class="btn" type="submit">Сохранить «О нас»</button></div><div class="grid three-col"><div class="field"><label for="sectionAboutRu3">Русский</label><textarea id="sectionAboutRu3" class="textarea section-long" maxlength="4000" required></textarea></div><div class="field"><label for="sectionAboutEn3">English</label><textarea id="sectionAboutEn3" class="textarea section-long" maxlength="4000" required></textarea></div><div class="field"><label for="sectionAboutEs3">Español</label><textarea id="sectionAboutEs3" class="textarea section-long" maxlength="4000" required></textarea></div></div><div class="hint">Можно использовать {first_name}, {last_name}, {username}</div></form>
        </section>

        <section id="view-contacts" class="view">
          <div class="page-head"><div><h1>Контакты менеджера</h1><p class="page-copy">Здесь задаются все способы связи, которые бот показывает клиенту.</p></div><button id="saveContactsTop3" class="btn">Сохранить</button></div>
          <form id="contactsForm3" data-saveable><div class="grid contacts-layout"><div class="section-stack"><div class="card"><div class="card-head"><div><h3>Менеджер и каналы связи</h3><div class="card-note">Пустой канал не будет показан пользователю</div></div></div><div class="field"><label for="contactManagerName3">Имя менеджера или отдела</label><input id="contactManagerName3" class="input" maxlength="160" placeholder="Например: Олег, отдел продаж"></div><div class="grid two-col"><div class="field"><label for="contactPhone3">Телефон</label><input id="contactPhone3" class="input" maxlength="80" placeholder="+34 ..."><span class="hint">Можно указать несколько номеров</span></div><div class="field"><label for="contactWhatsapp3">WhatsApp</label><input id="contactWhatsapp3" class="input" maxlength="500" placeholder="+34 ... или https://wa.me/..."><span class="hint">Если оставить пустым, используется первый телефон</span><label class="small"><input id="contactWhatsappEnabled3" type="checkbox" checked> Показывать кнопку WhatsApp</label></div><div class="field"><label for="contactTelegram3">Telegram</label><input id="contactTelegram3" class="input" maxlength="500" placeholder="@username или https://t.me/..."></div><div class="field"><label for="contactEmail3">E-mail</label><input id="contactEmail3" class="input" type="email" maxlength="254" placeholder="sales@example.com"></div><div class="field"><label for="contactWebsite3">Сайт</label><input id="contactWebsite3" class="input" type="url" placeholder="https://..."></div><div class="field"><label for="contactMap3">Адрес на карте</label><input id="contactMap3" class="input" type="url" placeholder="https://maps.google.com/..."></div></div></div><div class="card"><h3>Поясняющий текст</h3><div class="card-note">Коротко подскажите, когда менеджер отвечает и чем может помочь.</div><div class="field"><label for="contactTextRu3">Русский</label><textarea id="contactTextRu3" class="textarea" maxlength="2000"></textarea></div><div class="field"><label for="contactTextEn3">English</label><textarea id="contactTextEn3" class="textarea" maxlength="2000"></textarea></div><div class="field"><label for="contactTextEs3">Español</label><textarea id="contactTextEs3" class="textarea" maxlength="2000"></textarea></div><button class="btn" type="submit">Сохранить контакты менеджера</button></div></div><aside class="card contact-preview"><h3>Так увидит пользователь</h3><div class="card-note">Предпросмотр русской версии обновляется во время ввода</div><div id="contactsPreview3" style="margin-top:16px"></div></aside></div></form>
        </section>

        <section id="view-inquiries" class="view">
          <div class="page-head"><div><h1>Обращения</h1><p class="page-copy">Заявки на просмотр, интерес к объектам и вопросы пользователей. Отвечайте клиенту прямо из панели.</p></div></div>
          <div class="grid inquiry-layout"><div><div class="toolbar"><input id="inquirySearch3" class="input" placeholder="Имя, объект или текст обращения"><select id="inquiryStatusFilter3" class="select"><option value="">Все статусы</option><option value="new">Новые</option><option value="in_progress">В работе</option><option value="closed">Закрытые</option></select><select id="inquiryTypeFilter3" class="select"><option value="">Все типы</option><option value="selection">Подбор недвижимости</option><option value="viewing">Запись на просмотр</option><option value="lead">Заявка на звонок</option><option value="question">Вопрос по объекту</option><option value="interest">Интерес к объекту</option><option value="general">Общий вопрос</option></select><span id="inquiryResultCount3" class="badge">0</span></div><div id="inquiryList3" class="list"></div></div><aside id="inquiryDetail3" class="card inquiry-detail"><div class="empty"><strong>Обращение не выбрано</strong>Нажмите на заявку слева, чтобы открыть детали.</div></aside></div>
        </section>

        <section id="view-replies" class="view">
          <div class="page-head"><div><h1>Автоответы</h1><p class="page-copy">Бот проверяет активные правила сверху вниз и использует первое совпадение.</p></div><button id="newReplyBtn3" class="btn">＋ Добавить ответ</button></div>
          <div class="grid reply-layout"><div><div class="toolbar"><input id="replySearch3" class="input" placeholder="Поиск по фразе или ответу"><select id="replyLanguageFilter3" class="select"><option value="">Все языки</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="all">Все языки</option></select><span id="replyResultCount3" class="badge">0 правил</span></div><div id="replyList3" class="list"></div></div><aside class="card"><h3>Проверить сообщение</h3><div class="card-note">Узнайте, какой ответ сработает первым</div><form id="replyTestForm3"><div class="field"><label for="replyTestText3">Сообщение пользователя</label><input id="replyTestText3" class="input" required placeholder="Например: какая цена?"></div><div class="field"><label for="replyTestLanguage3">Язык</label><select id="replyTestLanguage3" class="select"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div><button class="btn secondary wide" type="submit">Проверить</button><div id="replyTestResult3"></div></form></aside></div>
        </section>

        <section id="view-campaigns" class="view">
          <div class="page-head"><div><h1>Рассылки</h1><p class="page-copy">Сообщение для выбранных языков и тегов — сейчас, по расписанию или как черновик.</p></div></div>
          <div class="grid campaign-layout"><form id="campaignForm3" class="card" data-saveable><input id="campaignId3" type="hidden"><div class="card-head"><div><h3 id="campaignFormTitle3">Новая рассылка</h3><div class="card-note">Подготовьте все языковые версии перед отправкой</div></div><span id="campaignEstimate3" class="badge brand">0 получателей</span></div><div class="field"><span class="field-label">Языки аудитории</span><div class="audience-checks"><label><input class="campaign-language3" type="checkbox" value="ru" checked> Русский</label><label><input class="campaign-language3" type="checkbox" value="en" checked> English</label><label><input class="campaign-language3" type="checkbox" value="es" checked> Español</label></div></div><div class="field"><label for="campaignTags3">Теги аудитории</label><input id="campaignTags3" class="input" placeholder="vip, investor"><span class="hint">Пустое поле — все пользователи выбранных языков.</span></div><div id="campaignLang3" class="lang-switch" role="tablist"><button class="active" data-lang="ru" type="button" role="tab" aria-selected="true">RU</button><button data-lang="en" type="button" role="tab">EN</button><button data-lang="es" type="button" role="tab">ES</button></div><div id="campaignTextPanes3"></div><div class="field"><label for="campaignImage3">Изображение</label><input id="campaignImage3" class="input" type="file" accept="image/jpeg,image/png"></div><label class="small"><input id="campaignRemoveImage3" type="checkbox"> Удалить текущее изображение</label><div class="field"><label for="campaignButtonUrl3">Ссылка кнопки</label><input id="campaignButtonUrl3" class="input" type="url" placeholder="https://..."></div><div class="grid three-col"><div class="field"><label for="campaignButtonRu3">Кнопка RU</label><input id="campaignButtonRu3" class="input" maxlength="80"></div><div class="field"><label for="campaignButtonEn3">Button EN</label><input id="campaignButtonEn3" class="input" maxlength="80"></div><div class="field"><label for="campaignButtonEs3">Botón ES</label><input id="campaignButtonEs3" class="input" maxlength="80"></div></div><div class="grid two-col"><div class="field"><label for="campaignSchedule3">Дата отправки</label><input id="campaignSchedule3" class="input" type="datetime-local"></div><div class="field"><label for="campaignTestUser3">Получатель теста</label><select id="campaignTestUser3" class="select"><option value="">Выберите пользователя</option></select></div></div><div class="actions campaign-actions"><button class="btn secondary" data-mode="draft" type="submit">Сохранить черновик</button><button class="btn soft" data-mode="test" type="submit">Отправить тест</button><button class="btn soft" data-mode="schedule" type="submit">Запланировать</button><button id="campaignSendBtn3" class="btn" data-mode="send" type="submit">Отправить сейчас</button></div></form><aside><div class="card campaign-preview"><div class="card-head"><div><h3>Предпросмотр</h3><div class="card-note">Пример сообщения для пользователя</div></div><select id="campaignPreviewLanguage3" class="select" style="width:auto"><option value="ru">RU</option><option value="en">EN</option><option value="es">ES</option></select></div><div class="preview-shell"><div id="campaignPreview3" class="preview-message">Введите текст сообщения</div></div></div></aside></div>
          <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>История и черновики</h3><div class="card-note">Последние подготовленные и отправленные сообщения</div></div></div><div id="campaignHistory3" class="grid two-col"></div></div>
        </section>

        <section id="view-audience" class="view">
          <div class="page-head"><div><h1>Пользователи</h1><p class="page-copy">Язык, теги, заметки, история общения и реакции каждого человека.</p></div></div>
          <div class="grid audience-layout"><div><div class="toolbar"><input id="userSearch3" class="input" placeholder="Имя, username, ID или тег"><select id="userLanguageFilter3" class="select"><option value="">Все языки</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="unknown">Не выбран</option></select><span id="userResultCount3" class="badge">0</span></div><div id="userGrid3" class="grid user-grid"></div></div><aside id="userDetail3" class="card user-detail"><div class="empty"><strong>Пользователь не выбран</strong>Нажмите на карточку слева, чтобы открыть детали.</div></aside></div>
        </section>

        <section id="view-settings" class="view">
          <div class="page-head"><div><h1>Настройки</h1><p class="page-copy">Подключение к Telegram, доступ к панели и резервное копирование.</p></div></div>
          <div class="grid settings-layout"><form id="technicalForm3" class="card" data-saveable><h3>Telegram и безопасность</h3><div class="switch-row"><div><strong>Бот включён</strong><div class="card-note">Обрабатывает новые сообщения и запланированные рассылки</div></div><input id="settingActive3" class="toggle" type="checkbox" aria-label="Бот включён"></div><div class="form-section"><div class="form-section-title">Токен бота</div><div class="card-note">Текущий токен скрыт. Введите новый только для замены.</div><div class="field"><label for="settingToken3">Новый токен</label><input id="settingToken3" class="input" autocomplete="off" placeholder="Оставьте пустым, чтобы не менять"></div><button id="tokenTestBtn3" class="btn secondary small" type="button">Проверить токен</button></div><div class="form-section"><div class="form-section-title">Пароль администратора</div><div class="grid two-col"><div class="field"><label for="settingPassword3">Новый пароль</label><input id="settingPassword3" class="input" type="password" minlength="8" autocomplete="new-password"></div><div class="field"><label for="settingPasswordConfirm3">Повторите пароль</label><input id="settingPasswordConfirm3" class="input" type="password" minlength="8" autocomplete="new-password"></div></div></div><button class="btn" type="submit">Сохранить настройки</button></form><div class="section-stack"><div class="card"><h3>Резервная копия</h3><p class="card-note">Содержит настройки, фотографии, контент и пользователей. Копия скачивается в сжатом формате .json.gz.</p><div class="actions" style="margin-top:14px"><a class="btn secondary" href="/api/backup">Скачать копию</a><label class="btn soft">Восстановить<input id="restoreFile3" type="file" accept=".gz,.json,application/gzip,application/json" hidden></label></div></div><div class="card"><h3>Данные</h3><div class="data-row"><span>Пользователи</span><strong id="dataUsers3">0</strong></div><div class="data-row"><span>Объекты</span><strong id="dataProperties3">0</strong></div><div class="data-row"><span>Акции</span><strong id="dataOffers3">0</strong></div><div class="data-row"><span>Автоответы</span><strong id="dataReplies3">0</strong></div></div></div></div>
          <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Статистика и история активности</h3><div class="card-note">Пользователи, их языки, теги, заметки и обращения при очистке сохраняются</div></div></div><div class="grid two-col"><div class="data-action"><div><strong>Обнулить статистику</strong><div class="card-note">Сбросить сообщения, график и показатели эффективности объектов</div></div><button id="resetStatisticsBtn3" class="btn danger small" type="button">Обнулить</button></div><div class="data-action"><div><strong>Очистить историю активности</strong><div class="card-note">Удалить историю сообщений и даты последних посещений, не удаляя пользователей</div></div><button id="clearActivityBtn3" class="btn danger small" type="button">Очистить историю</button></div></div></div>
        </section>
      </div>
    </main>
  </div>

  <dialog id="propertyDialog3"><form id="propertyForm3" class="drawer" data-saveable><div class="drawer-head"><div><div class="dialog-title" id="propertyDialogTitle3">Новый объект</div><div class="card-note">Полная карточка недвижимости для Telegram</div></div><button class="close-btn" data-close="propertyDialog3" type="button" aria-label="Закрыть">×</button></div><div class="drawer-body"><input id="propertyId3" type="hidden"><div class="grid two-col"><div class="field"><label for="propertyStatus3">Статус</label><select id="propertyStatus3" class="select"><option value="active">Показывать</option><option value="reserved">Забронирован</option><option value="hidden">Скрыть</option><option value="sold">Продан</option></select></div><div class="field"><label for="propertyDealType3">Тип сделки</label><select id="propertyDealType3" class="select"><option value="sale">Продажа</option><option value="rent">Аренда</option></select></div><div class="field"><label for="propertyType3">Тип недвижимости</label><select id="propertyType3" class="select"><option value="apartment">Квартира</option><option value="house">Дом</option><option value="villa">Вилла</option><option value="townhouse">Таунхаус</option><option value="newbuild">Новостройка</option><option value="land">Участок</option><option value="commercial">Коммерческая</option><option value="other">Другое</option></select></div><div class="field"><label for="propertyReference3">Номер объекта</label><input id="propertyReference3" class="input" maxlength="80" placeholder="REF-1024"></div><div class="field"><label for="propertyCity3">Город</label><input id="propertyCity3" class="input" maxlength="160"></div><div class="field"><label for="propertyDistrict3">Район</label><input id="propertyDistrict3" class="input" maxlength="160"></div></div><div id="propertyLang3" class="lang-switch" role="tablist"><button class="active" data-lang="ru" type="button">RU</button><button data-lang="en" type="button">EN</button><button data-lang="es" type="button">ES</button></div><div id="propertyPanes3"></div><div class="form-section"><div class="form-section-title">Цена</div><div class="grid three-col"><div class="field"><label for="propertyPriceValue3">Стоимость</label><input id="propertyPriceValue3" class="input" type="number" min="0" step="0.01" placeholder="245000"></div><div class="field"><label for="propertyCurrency3">Валюта</label><select id="propertyCurrency3" class="select"><option>EUR</option><option>USD</option><option>GBP</option><option>UAH</option><option>RUB</option></select></div><div class="field"><label for="propertyPricePeriod3">Период</label><select id="propertyPricePeriod3" class="select"><option value="total">Полная цена</option><option value="month">В месяц</option><option value="week">В неделю</option></select></div></div><div class="field"><label for="propertyPrice3">Нестандартная подпись к цене</label><input id="propertyPrice3" class="input" maxlength="120" placeholder="Например: цена по запросу"></div></div><div class="form-section"><div class="form-section-title">Характеристики</div><div class="grid three-col"><div class="field"><label for="propertyBedrooms3">Спальни</label><input id="propertyBedrooms3" class="input" type="number" min="0" step="1"></div><div class="field"><label for="propertyBathrooms3">Санузлы</label><input id="propertyBathrooms3" class="input" type="number" min="0" step="1"></div><div class="field"><label for="propertyArea3">Площадь, м²</label><input id="propertyArea3" class="input" type="number" min="0" step="0.1"></div><div class="field"><label for="propertyPlotArea3">Участок, м²</label><input id="propertyPlotArea3" class="input" type="number" min="0" step="0.1"></div><div class="field"><label for="propertyFloor3">Этаж</label><input id="propertyFloor3" class="input" maxlength="20"></div><div class="field"><label for="propertyFloors3">Этажей в здании</label><input id="propertyFloors3" class="input" maxlength="20"></div><div class="field"><label for="propertyDistanceSea3">До моря, м</label><input id="propertyDistanceSea3" class="input" type="number" min="0" step="1"></div><div class="field"><label for="propertyCondition3">Состояние</label><select id="propertyCondition3" class="select"><option value="">Не указано</option><option value="new">Новое</option><option value="renovated">После ремонта</option><option value="needs_renovation">Требует ремонта</option><option value="under_construction">Строится</option></select></div></div></div><div class="form-section"><div class="form-section-title">Метки объекта</div><div class="audience-checks"><label><input class="property-badge3" type="checkbox" value="new"> Новинка</label><label><input class="property-badge3" type="checkbox" value="recommended"> Рекомендуем</label><label><input class="property-badge3" type="checkbox" value="exclusive"> Эксклюзив</label><label><input class="property-badge3" type="checkbox" value="price_reduced"> Цена снижена</label></div></div><div class="grid two-col"><div class="field"><label for="propertyUrl3">Ссылка «Подробнее»</label><input id="propertyUrl3" class="input" type="url" placeholder="https://..."></div><div class="field"><label for="propertyMapUrl3">Ссылка на карту</label><input id="propertyMapUrl3" class="input" type="url" placeholder="https://maps.google.com/..."></div></div><div class="form-section"><div class="form-section-title">Фотографии</div><div class="card-note">До 10 изображений. Первая фотография показывается в каталоге.</div><div id="propertyGallery3" class="admin-gallery"></div><div class="field"><label for="propertyImage3">Добавить фотографии</label><input id="propertyImage3" class="input" type="file" multiple accept="image/jpeg,image/png"><span id="propertyImageNote3" class="hint">JPG или PNG до 5 МБ каждое</span></div><label class="small"><input id="propertyRemoveImage3" type="checkbox"> Удалить все текущие фотографии</label></div></div><div class="drawer-footer"><button class="btn secondary" data-close="propertyDialog3" type="button">Отмена</button><button class="btn" type="submit">Сохранить объект</button></div></form></dialog>
  <dialog id="offerDialog3"><form id="offerForm3" class="drawer" data-saveable><div class="drawer-head"><div><div class="dialog-title" id="offerDialogTitle3">Новая акция</div><div class="card-note">Предложение для пользователей</div></div><button class="close-btn" data-close="offerDialog3" type="button" aria-label="Закрыть">×</button></div><div class="drawer-body"><input id="offerId3" type="hidden"><label class="switch-row"><div><strong>Акция включена</strong><div class="card-note">Показывать в указанный период</div></div><input id="offerEnabled3" class="toggle" type="checkbox" checked></label><div id="offerLang3" class="lang-switch" role="tablist" style="margin-top:16px"><button class="active" data-lang="ru" type="button">RU</button><button data-lang="en" type="button">EN</button><button data-lang="es" type="button">ES</button></div><div id="offerPanes3"></div><div class="grid two-col"><div class="field"><label for="offerStart3">Начало</label><input id="offerStart3" class="input" type="datetime-local"></div><div class="field"><label for="offerEnd3">Окончание</label><input id="offerEnd3" class="input" type="datetime-local"></div></div><div class="field"><label for="offerUrl3">Ссылка «Подробнее»</label><input id="offerUrl3" class="input" type="url" placeholder="https://..."></div><div class="field"><label for="offerImage3">Изображение</label><input id="offerImage3" class="input" type="file" accept="image/jpeg,image/png"><span id="offerImageNote3" class="hint">JPG или PNG до 5 МБ</span></div><label class="small"><input id="offerRemoveImage3" type="checkbox"> Удалить текущее изображение</label></div><div class="drawer-footer"><button class="btn secondary" data-close="offerDialog3" type="button">Отмена</button><button class="btn" type="submit">Сохранить акцию</button></div></form></dialog>
  <dialog id="replyDialog3"><form id="replyForm3" class="drawer" data-saveable><div class="drawer-head"><div><div class="dialog-title" id="replyDialogTitle3">Новый автоответ</div><div class="card-note">Условие и текст ответа</div></div><button class="close-btn" data-close="replyDialog3" type="button" aria-label="Закрыть">×</button></div><div class="drawer-body"><input id="replyId3" type="hidden"><div class="field"><label for="replyTrigger3">Фраза пользователя</label><input id="replyTrigger3" class="input" maxlength="200" required placeholder="Например: стоимость"></div><div class="grid two-col"><div class="field"><label for="replyType3">Условие</label><select id="replyType3" class="select"><option value="contains">Содержит</option><option value="exact">Точное совпадение</option><option value="starts">Начинается с</option></select></div><div class="field"><label for="replyLanguage3">Язык</label><select id="replyLanguage3" class="select"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="all">Все языки</option></select></div></div><div class="field"><label for="replyAnswer3">Ответ бота</label><textarea id="replyAnswer3" class="textarea" maxlength="4000" required></textarea></div></div><div class="drawer-footer"><button class="btn secondary" data-close="replyDialog3" type="button">Отмена</button><button class="btn" type="submit">Сохранить ответ</button></div></form></dialog>

  <div id="unsavedBar3" class="global-unsaved hidden"><span>Есть несохранённые изменения</span><button id="discardBtn3" class="btn secondary small">Отменить</button></div><div id="toast3" class="toast hidden" role="status" aria-live="polite"></div>
  <script>
  (function(){
    "use strict";
    var state=null,csrf="",view="home",refreshTimer=null,selectedUser="",selectedInquiry="",dirty=new Set(),welcomeRemove={ru:false,en:false,es:false},propertyRemovedImages={ru:[],en:[],es:[]},propertyEditingImages={ru:[],en:[],es:[]},propertyNewImages={ru:[],en:[],es:[]},propertyImageOrder={ru:[],en:[],es:[]},propertyPreviewUrls=new WeakMap(),offerEditingImages={ru:null,en:null,es:null},offerNewImages={ru:null,en:null,es:null},offerPreviewUrls={ru:"",en:"",es:""},languages=["ru","en","es"];
    var meta={home:["Обзор","Главная"],welcome:["Контент","Приветствие"],interface:["Контент","Тексты интерфейса"],properties:["Контент","Объекты"],offers:["Контент","Акции"],about:["Контент","О нас"],contacts:["Контент","Контакты менеджера"],inquiries:["Коммуникации","Обращения"],replies:["Коммуникации","Автоответы"],campaigns:["Коммуникации","Рассылки"],audience:["Аудитория","Пользователи"],settings:["Система","Настройки"]};
    var interfaceGroups=[
      {key:"menuLabels",title:"Кнопки главного меню",note:"Названия основных разделов и действий"},
      {key:"mainMenu",title:"Главное меню",note:"Заголовок над клавиатурой"},
      {key:"menuHints",title:"Подсказка после приветствия",note:"Короткая фраза перед первым меню"},
      {key:"languageSelected",title:"Выбор языка",note:"Подтверждение выбранного языка"},
      {key:"languagePicker",title:"Экран выбора языка",note:"Фраза над кнопками языка при первом запуске"},
      {key:"commandDescriptions",title:"Команды Telegram",note:"Подписи команд в системном меню Telegram"},
      {key:"managerContact",title:"Связь с менеджером",note:"Кнопки и ответы в разделе контактов"},
      {key:"navigation",title:"Навигация",note:"Возврат, закрытие и переходы между разделами"},
      {key:"emptyStates",title:"Пустые разделы",note:"Сообщения, когда объектов, акций или избранного пока нет"},
      {key:"propertyActions",title:"Карточка объекта",note:"Кнопки, подтверждения и действия с недвижимостью"},
      {key:"propertyTypes",title:"Типы недвижимости",note:"Названия типов в карточке объекта"},
      {key:"propertyBadges",title:"Метки объектов",note:"Новинка, рекомендация и другие отметки"},
      {key:"propertyConditions",title:"Состояние объекта",note:"Названия состояния недвижимости"},
      {key:"callbackForm",title:"Форма заказа звонка",note:"Все шаги, варианты и сообщения формы"},
      {key:"viewingForm",title:"Форма записи на просмотр",note:"Дата, время и подтверждение просмотра"},
      {key:"selectionForm",title:"Форма подбора объекта",note:"Вопросы о цели, районе, бюджете и спальнях"},
      {key:"interaction",title:"Состояния и незавершённые формы",note:"Ошибки, продолжение и возврат пользователя"},
      {key:"commands",title:"Команды",note:"Отмена и ответ на неизвестную команду"}
    ];
    var interfaceLabels={text:"Основной текст",objects:"Кнопка «Наши объекты»",selection:"Кнопка «Помочь подобрать»",promotions:"Кнопка «Акции»",favorites:"Кнопка «Избранное»",contacts:"Кнопка «Связаться с менеджером»",more:"Кнопка «Ещё»",request:"Кнопка заказа звонка",about:"Кнопка «О компании»",help:"Кнопка «Помощь»",language:"Кнопка смены языка",intro:"Вступление",call:"Позвонить",whatsapp:"WhatsApp",telegram:"Telegram",website:"Сайт",map:"Карта",question:"Кнопка вопроса",askQuestion:"Приглашение написать вопрос",received:"Подтверждение получения",replyHeader:"Заголовок ответа менеджера",cancel:"Кнопка отмены",mainMenu:"Главное меню",backToCard:"Вернуться к карточке",close:"Закрыть",browse:"Посмотреть объекты",failed:"Не удалось выполнить действие",duplicate:"Просьба подождать",stale:"Устаревшее действие",unfinished:"Незавершённая форма",continueForm:"Продолжить форму",discardForm:"Закрыть форму",expired:"Срок формы истёк",resume:"Начать заново",backToMenu:"Вернуться в меню",hideGallery:"Скрыть фотографии",cancelled:"Действие отменено",nothingToCancel:"Нечего отменять",unknown:"Неизвестная команда",catalog:"Пустой каталог",details:"Подробнее",contactManager:"Связаться с менеджером",share:"Поделиться",interest:"Заказать звонок",viewing:"Записаться на просмотр",availability:"Уточнить доступность",similar:"Похожие объекты",gallery:"Все фотографии",favoriteButton:"Добавить в избранное",favoriteRemoveButton:"Убрать из избранного",favoriteAdd:"Добавлено в избранное",favoriteRemove:"Удалено из избранного",emptyFavorites:"Пустое избранное",askName:"Запрос имени",askPhone:"Запрос телефона",askTime:"Запрос времени",phoneButton:"Отправить свой номер",invalidName:"Ошибка в имени",invalidPhone:"Ошибка в телефоне",invalidTime:"Ошибка во времени",timeOptions:"Варианты времени",review:"Проверка данных",confirm:"Кнопка подтверждения",edit:"Изменить данные",editName:"Изменить имя",editPhone:"Изменить телефон",editTime:"Изменить время",savedName:"Использовать сохранённое имя",savedPhone:"Использовать сохранённый номер",success:"Успешная отправка",askDate:"Запрос даты",dateOptions:"Варианты даты",askCustom:"Своя дата и время",askCustomTime:"Своё время",restart:"Заполнить заново",editDate:"Изменить дату",invalid:"Некорректный ответ",askDeal:"Покупка или аренда",dealOptions:"Варианты сделки",askLocation:"Запрос района",anyLocation:"Район не важен",askBudget:"Запрос бюджета",noBudget:"Бюджет не определён",askBedrooms:"Запрос количества спален",bedroomOptions:"Варианты количества спален",labels:"Подписи в итогах",editDeal:"Изменить цель",editLocation:"Изменить район",editBudget:"Изменить бюджет",editBedrooms:"Изменить спальни",apartment:"Квартира",house:"Дом",villa:"Вилла",townhouse:"Таунхаус",land:"Участок",commercial:"Коммерческая недвижимость",newbuild:"Новостройка",other:"Другое",new:"Новое / новинка",recommended:"Рекомендуем",exclusive:"Эксклюзив",price_reduced:"Цена снижена",renovated:"После ремонта",needs_renovation:"Требует ремонта",under_construction:"Строится"};
    Object.assign(interfaceLabels,{placeholder:"Подсказка в строке ввода",tapPhone:"Подсказка для звонка",readMore:"Читать подробнее",sharePrefix:"Текст при отправке другу",viewWebsite:"Открыть сайт",openMap:"Открыть карту",forRent:"Аренда",forSale:"Продажа",reserved:"Забронирован",available:"Доступен",priceMonth:"Цена за месяц",priceWeek:"Цена за неделю",priceOnRequest:"Цена по запросу",floor:"Этаж",reference:"Номер объекта",updated:"Дата обновления",propertyUnavailable:"Объект недоступен",propertyHeading:"Заголовок объекта",requestViewingPrefix:"Заголовок заявки на просмотр",questionPrefix:"Заголовок вопроса",interestPrefix:"Заголовок интереса",noSimilar:"Похожие объекты не найдены",similarHeading:"Заголовок похожего объекта",managerPrompt:"Вопрос о помощи менеджера",photosUnavailable:"Фотографии недоступны",nextProperty:"Следующий объект",nextPrompt:"Действия после просмотра",reviewLabels:"Подписи в итогах",unavailable:"Объект недоступен для просмотра",asSpecified:"Время указано в сообщении",summaryTitle:"Заголовок итогов",start:"Запуск бота",menu:"Главное меню",myId:"Ответ на команду /myid"});
    function el(id){return document.getElementById(id)}
    function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
    function fmtNumber(value){return new Intl.NumberFormat("ru-RU").format(Number(value||0))}
    function pluralRu(value,one,few,many){var n=Math.abs(Number(value||0))%100,last=n%10;return n>10&&n<20?many:last===1?one:last>=2&&last<=4?few:many}
    function countRu(value,one,few,many){return fmtNumber(value)+" "+pluralRu(value,one,few,many)}
    function fmtDate(value){if(!value)return "—";try{return new Intl.DateTimeFormat("ru-RU",{dateStyle:"short",timeStyle:"short"}).format(new Date(value))}catch(e){return "—"}}
    function localDate(value){if(!value)return "";var d=new Date(value);if(!Number.isFinite(d.getTime()))return "";return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
    function api(url,options){options=options||{};options.headers=Object.assign({"content-type":"application/json"},options.headers||{});if(options.method&&options.method!=="GET")options.headers["x-csrf-token"]=csrf;return fetch(url,options).then(async function(response){var body={};try{body=await response.json()}catch(e){}if(!response.ok){var error=new Error(body.error||"Ошибка запроса");error.status=response.status;throw error}return body})}
    function toast(text){var box=el("toast3");box.textContent=text;box.classList.remove("hidden");clearTimeout(box._timer);box._timer=setTimeout(function(){box.classList.add("hidden")},3500)}
    function confirmAction(title,text,confirmText){var dialog=el("confirmDialog3");if(!dialog){dialog=document.createElement("dialog");dialog.id="confirmDialog3";document.body.appendChild(dialog)}dialog.innerHTML='<form method="dialog" class="confirm-panel"><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p><div class="actions"><button class="btn secondary" value="cancel">Отмена</button><button class="btn danger" value="confirm">'+esc(confirmText||"Подтвердить")+'</button></div></form>';dialog.returnValue="";dialog.showModal();return new Promise(function(resolve){dialog.addEventListener("close",function(){resolve(dialog.returnValue==="confirm")},{once:true})})}
    function message(target,text,ok){target.innerHTML='<div class="'+(ok?"form-success":"form-error")+'">'+esc(text)+"</div>"}
    function showScreen(name){["setupScreen3","loginScreen3","app3"].forEach(function(id){el(id).classList.toggle("hidden",id!==name)});if(name==="loginScreen3")setLoginPasswordVisible(false)}
    function setLoginPasswordVisible(visible){var input=el("loginPassword3"),button=el("loginPasswordToggle3");if(!input||!button)return;input.type=visible?"text":"password";button.setAttribute("aria-pressed",visible?"true":"false");button.setAttribute("aria-label",visible?"Скрыть пароль":"Показать пароль")}
    function localized(value,language){return value&&typeof value==="object"?(value[language]||value.ru||value.en||value.es||""):""}
    function exactLocalized(value,language){return value&&typeof value==="object"?String(value[language]||"").trim():""}
    function propertyLanguageHealth(item,language){var missing=[];if(!exactLocalized(item.title,language))missing.push("название");if(!exactLocalized(item.address,language))missing.push("адрес");if(!exactLocalized(item.description,language))missing.push("описание");var byLanguage=item.imagesByLanguage||{ru:item.images||[],en:[],es:[]};if(!(byLanguage[language]||[]).length)missing.push("фото");return{complete:!missing.length,missing:missing}}
    function userName(user){return [user.firstName,user.lastName].filter(Boolean).join(" ")||"Без имени"}
    function initials(user){return ([user.firstName,user.lastName].filter(Boolean).map(function(x){return x[0]}).join("").slice(0,2)||"?").toUpperCase()}
    function languageName(language){return {ru:"Русский",en:"English",es:"Español",all:"Все языки"}[language]||"Не выбран"}
    function statusName(status){return {online:"На связи",connecting:"Подключение",reconnecting:"Восстанавливаем связь",stopped:"Остановлен",error:"Ошибка подключения"}[status]||status}
    function fileData(file){return new Promise(function(resolve,reject){if(!file)return resolve("");if(file.size>5*1024*1024)return reject(new Error("Изображение больше 5 МБ"));var reader=new FileReader();reader.onload=function(){resolve(reader.result)};reader.onerror=function(){reject(new Error("Не удалось прочитать изображение"))};reader.readAsDataURL(file)})}
    function refreshDirtyNotice(){var show=Array.from(dirty).some(function(form){return form&&form.id!=="welcomeForm3"});el("unsavedBar3").classList.toggle("hidden",!show)}
    function markDirty(form){if(!form)return;dirty.add(form);refreshDirtyNotice()}
    function clearDirty(form){dirty.delete(form);refreshDirtyNotice()}
    function clearAllDirty(){dirty.clear();welcomeRemove={ru:false,en:false,es:false};el("unsavedBar3").classList.add("hidden")}
    function discardChanges(){clearAllDirty();resetProperty();resetOffer();resetReply();resetCampaign();el("settingToken3").value="";el("settingPassword3").value="";el("settingPasswordConfirm3").value="";document.querySelectorAll("dialog[open]").forEach(function(dialog){dialog.close()});if(state){renderWelcome();renderInterfaceText();renderMenuSections();renderContacts();renderSettings();if(selectedInquiry)renderInquiryDetail(selectedInquiry);if(selectedUser)renderUserDetail(selectedUser)}}
    function canLeave(){if(!dirty.size)return true;if(!confirm("Отменить несохранённые изменения и перейти в другой раздел?"))return false;discardChanges();return true}
    function closeSidebar(){el("sidebar3").classList.remove("open");el("sidebarOverlay3").classList.add("hidden");el("mobileMenuBtn3").setAttribute("aria-expanded","false");document.querySelectorAll("#nav3 details[open]").forEach(function(group){group.removeAttribute("open")})}
    function openView(name){if(name===view){closeSidebar();return}if(!canLeave())return;view=name;el("app3").classList.toggle("dashboard-home",name==="home");document.querySelectorAll(".view").forEach(function(node){node.classList.toggle("active",node.id==="view-"+name)});document.querySelectorAll("#nav3 .nav-item").forEach(function(node){node.classList.toggle("active",node.dataset.view===name)});el("breadcrumb3").textContent=meta[name][0];el("topTitle3").textContent=meta[name][1];el("mobileTitle3").textContent=meta[name][1];closeSidebar();window.scrollTo({top:0,behavior:"smooth"});renderView(name)}
    async function boot(){try{var status=await api("/api/status");if(!status.configured){showScreen("setupScreen3");return}try{await loadState();showScreen("app3");startRefresh()}catch(e){showScreen("loginScreen3")}}catch(e){showScreen("loginScreen3");message(el("loginMessage3"),"Не удалось связаться с панелью",false)}}
    function startRefresh(){clearInterval(refreshTimer);refreshTimer=setInterval(function(){loadState(true)},8000)}
    async function loadState(silent){try{state=await api("/api/state");csrf=state.csrf;renderAll();return state}catch(e){if(e.status===401){clearInterval(refreshTimer);showScreen("loginScreen3");if(!silent)throw e}else if(!silent)throw e}}
    function renderAll(){if(!state)return;renderShell();renderHome();renderRecentReactions();renderConnectionPresentation();renderErrorContext();renderSalesHome();renderInquiryAttention();renderAdminNotificationAttention();renderTranslationAttention();renderBrandDashboard();renderWelcome();renderInterfaceText();renderMenuSections();renderProperties();renderOffers();renderContacts();renderInquiries();renderReplies();renderCampaigns();renderAudience();renderSettings();addCounters()}
    function renderView(name){if(!state)return;({home:function(){renderHome();renderRecentReactions();renderConnectionPresentation();renderErrorContext();renderSalesHome();renderInquiryAttention();renderAdminNotificationAttention();renderTranslationAttention();renderBrandDashboard()},welcome:renderWelcome,interface:renderInterfaceText,properties:function(){renderMenuSections();renderProperties()},offers:function(){renderMenuSections();renderOffers()},about:renderMenuSections,contacts:renderContacts,inquiries:renderInquiries,replies:renderReplies,campaigns:renderCampaigns,audience:renderAudience,settings:renderSettings}[name]||function(){})()}
    function renderShell(){var status=state.runtime.status,activeObjects=state.objects.filter(function(item){return item.status==="active"}).length,activeOffers=state.promotions.filter(function(item){return item.enabled}).length,newInquiries=state.newInquiryCount||0,topCount=el("topInquiryCount3");el("botUsername3").textContent=state.bot.username?"@"+state.bot.username:(state.bot.firstName||"Telegram");el("sideStatus3").textContent=statusName(status);el("sideStatusNote3").textContent=status==="online"?"Бот принимает сообщения":status==="stopped"?"Выключен в настройках":"Проверьте подключение";el("sideDot3").className="status-dot "+status;el("navPropertyCount").textContent=activeObjects+"/"+state.objects.length;el("navOfferCount").textContent=activeOffers+"/"+state.promotions.length;el("navInquiryCount").textContent=newInquiries;el("navReplyCount").textContent=state.rules.length;el("navUserCount").textContent=state.userCount;topCount.textContent=newInquiries;topCount.classList.toggle("hidden",!newInquiries)}
    function connectionNote(){var runtime=state.runtime||{},status=runtime.status;if(status==="online")return runtime.lastSuccessfulContactAt?"Telegram на связи · проверено "+fmtDate(runtime.lastSuccessfulContactAt):"Telegram подключён. Бот принимает сообщения.";if(status==="stopped")return "Бот выключен в настройках.";if(status==="connecting")return "Проверяем подключение к Telegram…";var retry="";if(runtime.nextRetryAt){var seconds=Math.max(1,Math.ceil((Date.parse(runtime.nextRetryAt)-Date.now())/1000));retry=" Повтор через "+seconds+" сек."}return (runtime.lastError||"Временно нет связи с Telegram.")+retry}
    function renderConnectionPresentation(){var runtime=state.runtime||{},note=connectionNote(),online=runtime.status==="online";el("sideStatusNote3").textContent=online?"Бот принимает сообщения":runtime.status==="stopped"?"Выключен в настройках":"Связь восстанавливается";el("healthNote3").textContent=note;if(online){var list=el("attentionList3");Array.from(list.querySelectorAll(".attention-item")).forEach(function(item){var title=item.querySelector("strong");if(title&&title.textContent==="Журнал ошибок")item.remove()});if(!list.children.length)list.innerHTML='<div class="form-success">Всё основное заполнено</div>';if(state.errors.length)el("errorList3").insertAdjacentHTML("afterbegin",'<div class="form-success" style="margin-bottom:10px">Текущая связь исправна. Ниже сохранена история прошлых ошибок.</div>')}}
    function renderErrorContext(){var card=el("errorList3").closest(".card"),note=card&&card.querySelector(".card-note");if(!note)return;note.textContent=state.runtime.status==="online"?"История прошлых проблем — текущее подключение исправно":"Сначала показана текущая проблема, затем история событий"}
    function renderHome(){var status=state.runtime.status;el("healthTitle3").textContent=statusName(status);el("healthNote3").textContent=status==="online"?"Telegram подключён. Новые сообщения обрабатываются автоматически.":status==="stopped"?"Бот выключен. Включите его в настройках, когда будете готовы.":state.runtime.lastError||"Проверяем соединение с Telegram.";el("healthNumber3").textContent=fmtNumber(state.activeUserCount);el("metricUsers3").textContent=fmtNumber(state.userCount);el("metricUsersNote3").textContent=countRu(state.activeUserCount,"доступен","доступны","доступны");el("metricReceived3").textContent=fmtNumber(state.stats.messagesReceived);el("metricSent3").textContent=fmtNumber(state.stats.messagesSent);var activeRules=state.rules.filter(function(r){return r.enabled}).length;el("metricReplies3").textContent=fmtNumber(activeRules);el("metricRepliesNote3").textContent=fmtNumber(state.rules.length)+" всего";var attention=[];var imageCount=["ru","en","es"].filter(function(l){return state.welcomeImages[l]&&state.welcomeImages[l].exists}).length;if(imageCount<3)attention.push(["✦","Приветственные изображения",imageCount+" из 3 языков заполнено","welcome"]);var activeObjects=state.objects.filter(function(x){return x.status==="active"}).length;if(!activeObjects)attention.push(["⌑","Каталог объектов","Нет активных карточек","properties"]);if(!state.contacts.phone&&!state.contacts.whatsapp&&!state.contacts.telegram&&!state.contacts.email&&!state.contacts.website)attention.push(["☎","Контакты менеджера","Не указан ни один канал связи","contacts"]);if(state.errors.length)attention.push(["!","Журнал ошибок",countRu(state.errors.length,"запись требует","записи требуют","записей требуют")+" просмотра","home"]);el("attentionList3").innerHTML=attention.length?attention.slice(0,4).map(function(a){return '<button class="attention-item quick-nav" data-view="'+a[3]+'"><span class="attention-icon">'+a[0]+'</span><span class="attention-main"><strong>'+esc(a[1])+'</strong><span>'+esc(a[2])+'</span></span><span>›</span></button>'}).join(""):'<div class="form-success">Всё основное заполнено</div>';bindQuick(el("attentionList3"));var points=[],max=1,total=0;for(var i=13;i>=0;i--){var date=new Date();date.setUTCDate(date.getUTCDate()-i);var key=date.toISOString().slice(0,10),d=state.analytics.daily[key]||{},value=Number(d.received||0)+Number(d.sent||0);total+=value;max=Math.max(max,value);points.push({key:key,value:value})}el("chartTotal3").textContent=countRu(total,"сообщение","сообщения","сообщений");el("activityChart3").innerHTML=points.map(function(p){return '<div class="chart-column" title="'+esc(p.key+": "+p.value)+'"><div class="chart-bar" style="height:'+Math.max(4,Math.round(p.value/max*100))+'%"></div><span class="chart-label">'+esc(p.key.slice(5))+"</span></div>"}).join("");var users=state.users.filter(function(u){return Boolean(u.lastSeenAt)}).slice(0,5);el("recentUsers3").innerHTML=users.length?users.map(function(u){return '<div class="list-item"><div class="avatar">'+esc(initials(u))+'</div><div class="list-main"><strong>'+esc(userName(u))+'</strong><span>'+countRu(u.messages,"сообщение","сообщения","сообщений")+" · "+esc(fmtDate(u.lastSeenAt))+'</span></div><span class="badge">'+esc(languageName(u.preferredLanguage))+"</span></div>"}).join(""):'<div class="empty">История активности пуста</div>';el("errorList3").innerHTML=state.errors.length?state.errors.slice(0,8).map(function(item){return '<div class="error-item"><strong>'+esc(item.area||"Ошибка")+'</strong><div class="danger-text">'+esc(item.message)+'</div><div class="muted">'+esc(fmtDate(item.createdAt))+"</div></div>"}).join(""):'<div class="empty"><strong>Ошибок нет</strong>Последние операции прошли без проблем.</div>';el("clearErrorsBtn3").disabled=!state.errors.length}
    function renderRecentReactions(){var events=[];(state.users||[]).forEach(function(user){(user.activity||[]).forEach(function(item){if(item.kind==="reaction")events.push({user:user,item:item})})});events.sort(function(a,b){return Date.parse(b.item.createdAt||0)-Date.parse(a.item.createdAt||0)});el("reactionTotal3").textContent=fmtNumber(state.stats.reactionsReceived||0);el("recentReactions3").innerHTML=events.length?events.slice(0,6).map(function(row){var emoji=(row.item.text.match(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u)||[])[0]||"♡";return '<button class="reaction-row reaction-open-user3" data-user="'+esc(row.user.id)+'"><span class="reaction-emoji">'+esc(emoji)+'</span><span class="list-main"><strong>'+esc(userName(row.user))+'</strong><span>'+esc(row.item.text)+" · "+esc(fmtDate(row.item.createdAt))+'</span></span></button>'}).join(""):'<div class="empty"><strong>Реакций пока нет</strong>Здесь появятся эмодзи, поставленные клиентами сообщениям бота.</div>';document.querySelectorAll(".reaction-open-user3").forEach(function(button){button.addEventListener("click",function(){selectedUser=button.dataset.user;openView("audience")})})}
    function renderSalesHome(){var activeObjects=state.objects.filter(function(item){return item.status==="active"}).length,newInquiries=state.newInquiryCount||0,analytics=state.analytics&&state.analytics.properties||{},totalInterest=Object.values(analytics).reduce(function(sum,item){return sum+Number(item.interests||0)+Number(item.viewings||0)+Number(item.questions||0)+Number(item.favorites||0)},0);el("metricReceived3").textContent=fmtNumber(activeObjects);el("metricSent3").textContent=fmtNumber(newInquiries);el("metricReplies3").textContent=fmtNumber(totalInterest);el("metricRepliesNote3").textContent=totalInterest?"целевых действий":"пока нет действий";var rows=state.objects.map(function(item){var value=analytics[item.id]||{},contacts=Number(value.interests||0)+Number(value.viewings||0)+Number(value.questions||0)+Number(value.availability||0),engagement=Number(value.details||0)+Number(value.galleries||0)+Number(value.managerContacts||0)+Number(value.similar||0)+Number(value.favorites||0),impressions=Number(value.impressions||0),conversion=impressions?Math.round(contacts/impressions*100):0;return{item:item,value:value,contacts:contacts,engagement:engagement,conversion:conversion,score:contacts*30+engagement*8+impressions}}).sort(function(a,b){return b.score-a.score});el("propertyPerformance3").innerHTML=rows.length?rows.slice(0,6).map(function(row){var title=localized(row.item.title,"ru")||"Без названия",subtitle=[row.item.reference,propertyPriceLabel(row.item)].filter(Boolean).join(" · ");return '<button class="performance-row edit-property3" data-id="'+esc(row.item.id)+'" aria-label="Открыть статистику и карточку '+esc(title)+'"><span class="performance-name"><strong>'+esc(title)+'</strong><span>'+esc(subtitle||"Карточка объекта")+'</span></span><span class="performance-value"><strong>'+fmtNumber(row.value.impressions||0)+'</strong><span>показы</span></span><span class="performance-value"><strong>'+fmtNumber(row.value.details||0)+'</strong><span>подробнее</span></span><span class="performance-value"><strong>'+fmtNumber(row.value.galleries||0)+'</strong><span>галерея</span></span><span class="performance-value"><strong>'+fmtNumber(row.contacts)+'</strong><span>обращения · '+row.conversion+'%</span></span></button>'}).join(""):'<div class="empty"><strong>Пока нет объектов</strong>После добавления карточек здесь появится их эффективность.</div>';document.querySelectorAll("#propertyPerformance3 .edit-property3").forEach(function(button){button.addEventListener("click",function(){openView("properties");editProperty(button.dataset.id)})})}
    function renderInquiryAttention(){if(!state.newInquiryCount)return;var list=el("attentionList3");list.insertAdjacentHTML("afterbegin",'<button class="attention-item quick-nav" data-view="inquiries"><span class="attention-icon">✉</span><span class="attention-main"><strong>Новые обращения</strong><span>'+esc(countRu(state.newInquiryCount,"вопрос ждёт","вопроса ждут","вопросов ждут")+' ответа')+'</span></span><span>›</span></button>');bindQuick(list)}
    function renderAdminNotificationAttention(){var configured=Boolean(state.config.adminChatId),verified=Boolean(configured&&state.config.adminNotificationVerifiedAt);if(verified)return;var list=el("attentionList3"),success=list.querySelector(".form-success");if(success)success.remove();var title=configured?"Проверьте Chat ID":"Уведомления не подключены",note=configured?"Telegram ещё не подтвердил доставку":"Укажите Chat ID администратора";list.insertAdjacentHTML("afterbegin",'<button class="attention-item quick-nav" data-view="settings"><span class="attention-icon">✉</span><span class="attention-main"><strong>'+esc(title)+'</strong><span>'+esc(note)+'</span></span><span>›</span></button>');bindQuick(list)}
    function renderTranslationAttention(){var incomplete=state.objects.filter(function(item){return item.status==="active"&&languages.some(function(language){return !propertyLanguageHealth(item,language).complete})}),missingContacts=languages.filter(function(language){return !exactLocalized(state.contacts.text,language)});if(!incomplete.length&&!missingContacts.length)return;var list=el("attentionList3"),success=list.querySelector(".form-success");if(success)success.remove();if(incomplete.length)list.insertAdjacentHTML("beforeend",'<button class="attention-item quick-nav" data-view="properties"><span class="attention-icon">A</span><span class="attention-main"><strong>Переводы объектов</strong><span>'+esc(countRu(incomplete.length,"активная карточка заполнена","активные карточки заполнены","активных карточек заполнены")+' не полностью')+'</span></span><span>›</span></button>');if(missingContacts.length)list.insertAdjacentHTML("beforeend",'<button class="attention-item quick-nav" data-view="contacts"><span class="attention-icon">☎</span><span class="attention-main"><strong>Текст контактов</strong><span>Не заполнено: '+esc(missingContacts.map(function(language){return language.toUpperCase()}).join(", "))+'</span></span><span>›</span></button>');bindQuick(list)}
    function renderBrandDashboard(){var points=[],max=1,total=0;for(var i=13;i>=0;i--){var date=new Date();date.setUTCDate(date.getUTCDate()-i);var key=date.toISOString().slice(0,10),daily=state.analytics.daily[key]||{},received=Number(daily.received||0),sent=Number(daily.sent||0);total+=received+sent;max=Math.max(max,received,sent);points.push({key:key,received:received,sent:sent})}el("chartTotal3").textContent=countRu(total,"сообщение","сообщения","сообщений");el("activityChart3").innerHTML=points.map(function(point){return '<div class="chart-column" title="'+esc(point.key+': входящие '+point.received+', ответы '+point.sent)+'"><div class="chart-bars"><div class="chart-bar" style="height:'+Math.max(4,Math.round(point.received/max*100))+'%"></div><div class="chart-bar sent" style="height:'+Math.max(4,Math.round(point.sent/max*100))+'%"></div></div><span class="chart-label">'+esc(point.key.slice(5))+'</span></div>'}).join("");var inquiries=(state.inquiries||[]).slice().sort(function(a,b){return Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0)}).slice(0,4);el("recentInquiries3").innerHTML=inquiries.length?inquiries.map(function(item){var user=state.users.find(function(record){return record.id===item.userId})||{},property=inquiryProperty(item),context=property?(localized(property.title,"ru")||property.reference||"Объект"):inquiryTypeName(item.type);return '<div class="list-item"><span class="inquiry-mini-status '+esc(item.status)+'"></span><div class="list-main"><strong>'+esc(userName(user))+'</strong><span>'+esc(context)+' · '+esc(fmtDate(item.createdAt))+'</span></div><span class="badge '+inquiryStatusBadge(item.status)+'">'+esc(inquiryStatusName(item.status))+'</span></div>'}).join(""):'<div class="empty"><strong>Новых обращений нет</strong>Запросы клиентов появятся здесь.</div>'}
    function welcomePane(language){var s=language[0].toUpperCase()+language.slice(1),active=language==="ru"?" active":"";return '<div class="lang-pane'+active+'" data-welcome-pane="'+language+'"><div class="grid welcome-layout"><aside class="card"><div class="phone"><div class="phone-top">'+(language==="ru"?"Ваш бот":language==="en"?"Your bot":"Tu bot")+'</div><div class="chat-bubble"><div id="welcomePreview'+s+'3" class="chat-photo">Изображение не загружено</div><div id="welcomeTextPreview'+s+'3" class="chat-text"></div></div><div class="chat-keyboard"><span>'+(language==="ru"?"🏘 Объекты":language==="en"?"🏘 Properties":"🏘 Inmuebles")+'</span><span class="menu-wide">'+(language==="ru"?"✨ Подобрать объект":language==="en"?"✨ Find a property":"✨ Elegir inmueble")+'</span><span>'+(language==="ru"?"❤️ Избранное":language==="en"?"❤️ Favorites":"❤️ Favoritos")+'</span><span>'+(language==="ru"?"🔥 Акции":language==="en"?"🔥 Offers":"🔥 Promociones")+'</span><span>'+(language==="ru"?"💬 Менеджер":language==="en"?"💬 Manager":"💬 Gestor")+'</span><span>'+(language==="ru"?"☰ Ещё":language==="en"?"☰ More":"☰ Más")+'</span><span class="menu-wide">'+(language==="ru"?"🌐 Сменить язык":language==="en"?"🌐 Change language":"🌐 Cambiar idioma")+'</span></div></div><div class="field"><label for="welcomeFile'+s+'3">Приветственное изображение</label><input id="welcomeFile'+s+'3" class="input welcome-file3" data-lang="'+language+'" type="file" accept="image/jpeg,image/png"><button class="btn danger small welcome-remove3" data-lang="'+language+'" type="button">Удалить изображение</button></div></aside><div class="section-stack"><div class="card"><h3>Тексты сообщений</h3><div class="field"><label for="greeting'+s+'3">Приветствие</label><textarea id="greeting'+s+'3" class="textarea welcome-live3" data-lang="'+language+'" maxlength="4000" required></textarea></div><div class="field"><label for="help'+s+'3">Помощь (/help)</label><textarea id="help'+s+'3" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="fallback'+s+'3">Если автоответ не найден</label><textarea id="fallback'+s+'3" class="textarea" maxlength="4000"></textarea></div><div class="hint">Можно использовать {first_name}, {last_name}, {username}</div></div><details class="card"><summary><strong>Запасные тексты разделов</strong> <span class="card-note">используются, если карточки не добавлены</span></summary><div class="field"><label for="menuObjects'+s+'3">Наши объекты</label><textarea id="menuObjects'+s+'3" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuOffers'+s+'3">Акции</label><textarea id="menuOffers'+s+'3" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuContacts'+s+'3">Контакты</label><textarea id="menuContacts'+s+'3" class="textarea" maxlength="4000" required></textarea></div><div class="field"><label for="menuAbout'+s+'3">О нас</label><textarea id="menuAbout'+s+'3" class="textarea" maxlength="4000" required></textarea></div></details></div></div></div>'}
    function buildWelcome(){if(el("welcomePanes3").children.length)return;el("welcomePanes3").innerHTML=languages.map(welcomePane).join("");document.querySelectorAll("#welcomePanes3 details").forEach(function(details){details.remove()});document.querySelectorAll(".welcome-file3").forEach(function(input){input.addEventListener("change",function(){var file=input.files[0];if(!file)return;var lang=input.dataset.lang,s=lang[0].toUpperCase()+lang.slice(1);welcomeRemove[lang]=false;el("welcomePreview"+s+"3").innerHTML='<img src="'+URL.createObjectURL(file)+'" alt="Предпросмотр">';document.querySelector('.welcome-remove3[data-lang="'+lang+'"]').disabled=false})});document.querySelectorAll(".welcome-remove3").forEach(function(button){button.addEventListener("click",function(){var lang=button.dataset.lang,s=lang[0].toUpperCase()+lang.slice(1);welcomeRemove[lang]=true;el("welcomeFile"+s+"3").value="";el("welcomePreview"+s+"3").textContent="Изображение будет удалено";button.disabled=true;markDirty(el("welcomeForm3"))})})}
    function renderWelcome(){buildWelcome();if(dirty.has(el("welcomeForm3")))return;languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1),messages=state.config.messages[language];el("greeting"+s+"3").value=messages.greeting;el("help"+s+"3").value=messages.help;el("fallback"+s+"3").value=messages.fallback;el("welcomeTextPreview"+s+"3").textContent=messages.greeting.replaceAll("{first_name}","Анна").replaceAll("{last_name}","").replaceAll("{username}","@anna");var image=state.welcomeImages[language];el("welcomePreview"+s+"3").innerHTML=image&&image.exists?'<img src="/api/images/'+language+'/welcome?rev='+encodeURIComponent(image.updatedAt||"")+'" alt="Приветственное изображение">':"Изображение не загружено";var labels=state.interfaceText&&state.interfaceText.menuLabels&&state.interfaceText.menuLabels[language]||{},keyboard=el("welcomePreview"+s+"3").closest(".phone").querySelector(".chat-keyboard");keyboard.innerHTML='<span>'+esc(labels.objects||"")+'</span><span class="menu-wide">'+esc(labels.selection||"")+'</span><span>'+esc(labels.favorites||"")+'</span><span>'+esc(labels.promotions||"")+'</span><span>'+esc(labels.contacts||"")+'</span><span>'+esc(labels.more||"")+'</span><span class="menu-wide">'+esc(labels.language||"")+'</span>';document.querySelector('.welcome-remove3[data-lang="'+language+'"]').disabled=!(image&&image.exists);welcomeRemove[language]=false})}
    function interfaceFieldHtml(group,language,key,value){var id="interface-"+group+"-"+language+"-"+key,isList=Array.isArray(value),text=isList?value.join("\n"):String(value||""),long=isList||text.includes("\n")||text.length>90||/^(ask|invalid|success|received|unknown|catalog|favorites|promotions|expired|unfinished)/.test(key),label=interfaceLabels[key]||key;return '<div class="field '+(long?"interface-wide":"")+'"><label for="'+id+'">'+esc(label)+'</label>'+(long?'<textarea id="'+id+'" class="textarea interface-input3" data-group="'+group+'" data-lang="'+language+'" data-key="'+key+'" data-list="'+(isList?"1":"0")+'" maxlength="4000" required>'+esc(text)+'</textarea>':'<input id="'+id+'" class="input interface-input3" data-group="'+group+'" data-lang="'+language+'" data-key="'+key+'" data-list="0" maxlength="80" required value="'+esc(text)+'">')+(isList?'<span class="interface-list-note">Каждый вариант — с новой строки. Количество строк сохраняйте.</span>':"")+"</div>"}
    function interfacePaneHtml(language){var blocks=interfaceGroups.map(function(group,index){var values=state.interfaceText&&state.interfaceText[group.key]&&state.interfaceText[group.key][language]||{};return '<details class="card interface-group" '+(index===0?"open":"")+'><summary><span class="interface-group-title"><strong>'+esc(group.title)+'</strong><span>'+esc(group.note)+'</span></span></summary><div class="interface-grid">'+Object.keys(values).map(function(key){return interfaceFieldHtml(group.key,language,key,values[key])}).join("")+"</div></details>"}).join("");return '<div class="lang-pane '+(language==="ru"?"active":"")+'" data-interface-pane="'+language+'"><div class="interface-groups">'+blocks+"</div></div>"}
    function buildInterfaceText(){if(el("interfacePanes3").children.length)return;el("interfacePanes3").innerHTML=languages.map(interfacePaneHtml).join("")}
    function renderInterfaceText(){buildInterfaceText();var form=el("interfaceForm3");if(dirty.has(form))return;document.querySelectorAll(".interface-input3").forEach(function(input){var source=state.interfaceText&&state.interfaceText[input.dataset.group]&&state.interfaceText[input.dataset.group][input.dataset.lang]||{},value=source[input.dataset.key];input.value=Array.isArray(value)?value.join("\n"):String(value||"")})}
    function renderMenuSections(){[["propertySectionForm3","Objects","objects"],["offerSectionForm3","Promotions","promotions"],["aboutForm3","About","about"]].forEach(function(item){var form=el(item[0]);if(!form||dirty.has(form))return;languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("section"+item[1]+s+"3").value=state.config.menu[language][item[2]]||""})})}
    function propertyPane(language){var s=language[0].toUpperCase()+language.slice(1),name={ru:"русского языка",en:"английского языка",es:"испанского языка"}[language];return '<div class="lang-pane '+(language==="ru"?"active":"")+'" data-property-pane="'+language+'"><div class="field"><label for="propertyTitle'+s+'3">Название</label><input id="propertyTitle'+s+'3" class="input" maxlength="160"></div><div class="grid two-col"><div class="field"><label for="propertyCity'+s+'3">Город</label><input id="propertyCity'+s+'3" class="input" maxlength="160"></div><div class="field"><label for="propertyDistrict'+s+'3">Район</label><input id="propertyDistrict'+s+'3" class="input" maxlength="160"></div></div><div class="field"><label for="propertyAddress'+s+'3">Адрес</label><input id="propertyAddress'+s+'3" class="input" maxlength="500"></div><div class="field"><label for="propertyPrice'+s+'3">Нестандартная подпись к цене</label><input id="propertyPrice'+s+'3" class="input" maxlength="120" placeholder="Например: цена по запросу"></div><div class="field"><label for="propertyDescription'+s+'3">Описание</label><textarea id="propertyDescription'+s+'3" class="textarea" maxlength="3000"></textarea></div><div class="form-section language-gallery"><div class="form-section-title">Фотографии для '+name+'</div><div class="card-note">Эти изображения увидят только пользователи, выбравшие '+(language==="ru"?"русский":language==="en"?"English":"Español")+'. Первая фотография станет обложкой.</div><div id="propertyGallery'+s+'3" class="admin-gallery property-gallery3" data-lang="'+language+'"></div><div class="field"><label for="propertyImage'+s+'3">Добавить фотографии</label><input id="propertyImage'+s+'3" class="input property-image3" data-lang="'+language+'" type="file" multiple accept="image/jpeg,image/png"><span id="propertyImageNote'+s+'3" class="hint">До 10 JPG или PNG, каждое до 5 МБ</span></div><label class="small"><input id="propertyRemoveImages'+s+'3" class="property-remove-images3" data-lang="'+language+'" type="checkbox"> Удалить все фотографии только для этого языка</label></div></div>'}
    function offerPane(language){var s=language[0].toUpperCase()+language.slice(1),name={ru:"русского языка",en:"английского языка",es:"испанского языка"}[language];return '<div class="lang-pane '+(language==="ru"?"active":"")+'" data-offer-pane="'+language+'"><div class="field"><label for="offerTitle'+s+'3">Название</label><input id="offerTitle'+s+'3" class="input" maxlength="160"></div><div class="field"><label for="offerText'+s+'3">Описание</label><textarea id="offerText'+s+'3" class="textarea" maxlength="3000"></textarea></div><div class="form-section language-gallery"><div class="form-section-title">Изображение для '+name+'</div><div class="card-note">Пользователь увидит только изображение выбранного им языка.</div><div id="offerGallery'+s+'3" class="admin-gallery offer-gallery3" data-lang="'+language+'"></div><div class="field"><label for="offerImage'+s+'3">Загрузить или заменить изображение</label><input id="offerImage'+s+'3" class="input offer-image3" data-lang="'+language+'" type="file" accept="image/jpeg,image/png"><span id="offerImageNote'+s+'3" class="hint">JPG или PNG до 5 МБ</span></div><label class="small"><input id="offerRemoveImage'+s+'3" class="offer-remove-image3" data-lang="'+language+'" type="checkbox"> Удалить изображение только для этого языка</label></div></div>'}
    function enhancePropertyEditor(){if(el("propertyEditorNav3"))return;var body=el("propertyId3").parentElement,base=el("propertyId3").nextElementSibling,sections=Array.from(body.children).filter(function(node){return node.classList&&node.classList.contains("form-section")}),price=sections.find(function(node){return node.textContent.trim().startsWith("Цена")}),features=sections.find(function(node){return node.textContent.trim().startsWith("Характеристики")}),badges=sections.find(function(node){return node.textContent.trim().startsWith("Метки объекта")}),links=el("propertyUrl3")&&el("propertyUrl3").closest(".grid");if(base){base.id="propertyMainBlock3";base.classList.add("property-editor-block")}el("propertyLang3").classList.add("property-editor-block");el("propertyPanes3").classList.add("property-editor-block");if(price){price.id="propertyPriceBlock3";price.classList.add("property-editor-block")}if(features){features.id="propertyFeaturesBlock3";features.classList.add("property-editor-block")}if(badges)badges.classList.add("property-editor-block");if(links){links.id="propertyLinksBlock3";links.classList.add("property-editor-block")}var nav=document.createElement("nav");nav.id="propertyEditorNav3";nav.className="editor-step-nav";nav.setAttribute("aria-label","Разделы карточки объекта");nav.innerHTML='<button type="button" data-target="propertyMainBlock3">1. Основное</button><button type="button" data-target="propertyLang3">2. Языки и фото</button><button type="button" data-target="propertyPriceBlock3">3. Цена</button><button type="button" data-target="propertyFeaturesBlock3">4. Характеристики</button><button type="button" data-target="propertyLinksBlock3">5. Ссылки</button>';el("propertyId3").insertAdjacentElement("afterend",nav);var preview=document.createElement("div");preview.id="propertyCardPreview3";preview.className="property-card-preview";el("propertyTranslationSummary3").insertAdjacentElement("afterend",preview);nav.addEventListener("click",function(event){var button=event.target.closest("[data-target]");if(!button)return;var target=el(button.dataset.target);if(target)target.scrollIntoView({behavior:"smooth",block:"start"})})}
    function buildDrawers(){if(!el("propertyPanes3").children.length){el("propertyPanes3").innerHTML=languages.map(propertyPane).join("");var summary=document.createElement("div");summary.id="propertyTranslationSummary3";summary.className="translation-summary";summary.textContent="Заполните языковые версии объекта";el("propertyLang3").insertAdjacentElement("afterend",summary);["propertyCity3","propertyDistrict3","propertyPrice3"].forEach(function(id){var node=el(id);if(node&&node.closest(".field"))node.closest(".field").remove()});var legacyGallery=el("propertyGallery3");if(legacyGallery&&legacyGallery.closest(".form-section"))legacyGallery.closest(".form-section").remove()}enhancePropertyEditor();if(!el("offerPanes3").children.length){el("offerPanes3").innerHTML=languages.map(offerPane).join("");var legacyOfferImage=el("offerImage3");if(legacyOfferImage&&legacyOfferImage.closest(".field"))legacyOfferImage.closest(".field").remove();var legacyOfferRemove=el("offerRemoveImage3");if(legacyOfferRemove&&legacyOfferRemove.closest("label"))legacyOfferRemove.closest("label").remove()}}
    function mediaThumb(collection,item){return item.image&&item.image.exists?'<img src="/api/media/'+collection+"/"+encodeURIComponent(item.id)+"?rev="+encodeURIComponent(item.image.updatedAt||"")+'" alt="">':"<span>Нет изображения</span>"}
    function propertyPriceLabel(item){if(Number(item.priceValue)>0){var value=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(item.priceValue)),period=item.pricePeriod==="month"?"/ месяц":item.pricePeriod==="week"?"/ неделю":"";return [value,item.currency||"EUR",period].filter(Boolean).join(" ")}return localized(item.price,"ru")||""}
    function propertyFilePreview(file){if(!propertyPreviewUrls.has(file))propertyPreviewUrls.set(file,URL.createObjectURL(file));return propertyPreviewUrls.get(file)}
    function propertyOrderedEntries(language){var s=language[0].toUpperCase()+language.slice(1),removeAll=el("propertyRemoveImages"+s+"3").checked,removed=propertyRemovedImages[language]||[],existing=(removeAll?[]:propertyEditingImages[language]||[]).filter(function(image){return !removed.includes(image.id)}).map(function(image){return{token:String(image.id),kind:"existing",image:image}}),fresh=(propertyNewImages[language]||[]).map(function(item){return{token:item.id,kind:"new",file:item.file}}),available=new Map(existing.concat(fresh).map(function(entry){return[entry.token,entry]})),ordered=[];(propertyImageOrder[language]||[]).forEach(function(token){var entry=available.get(token);if(entry&&!ordered.includes(entry))ordered.push(entry)});existing.concat(fresh).forEach(function(entry){if(!ordered.includes(entry))ordered.push(entry)});propertyImageOrder[language]=ordered.map(function(entry){return entry.token});return ordered}
    function propertyFormHealth(language){var s=language[0].toUpperCase()+language.slice(1),missing=[],publicationMissing=[];if(!el("propertyTitle"+s+"3").value.trim()){missing.push("название");publicationMissing.push("название")}if(!el("propertyAddress"+s+"3").value.trim())missing.push("адрес");if(!el("propertyDescription"+s+"3").value.trim())missing.push("описание");if(!propertyOrderedEntries(language).length){missing.push("фото");publicationMissing.push("фото")}return{complete:!missing.length,ready:!publicationMissing.length,missing:missing,publicationMissing:publicationMissing}}
    function renderPropertyPreview(){var root=el("propertyCardPreview3");if(!root)return;var button=el("propertyLang3").querySelector("button.active"),language=button?button.dataset.lang:"ru",s=language[0].toUpperCase()+language.slice(1),entries=propertyOrderedEntries(language),first=entries[0],source="";if(first)source=first.kind==="new"?propertyFilePreview(first.file):"/api/media/objects/"+encodeURIComponent(el("propertyId3").value)+"?imageId="+encodeURIComponent(first.image.id)+"&rev="+encodeURIComponent(first.image.updatedAt||"");var title=el("propertyTitle"+s+"3").value.trim()||"Название объекта",location=[el("propertyCity"+s+"3").value.trim(),el("propertyDistrict"+s+"3").value.trim(),el("propertyAddress"+s+"3").value.trim()].filter(Boolean).join(", ")||"Адрес и район",customPrice=el("propertyPrice"+s+"3").value.trim(),numeric=Number(el("propertyPriceValue3").value),price=customPrice||(numeric>0?new Intl.NumberFormat(language==="en"?"en-US":language==="es"?"es-ES":"ru-RU",{maximumFractionDigits:2}).format(numeric)+" "+el("propertyCurrency3").value:"Цена по запросу"),description=el("propertyDescription"+s+"3").value.trim()||"Короткое описание появится здесь";if(description.length>135)description=description.slice(0,132).trimEnd()+"…";root.innerHTML='<div class="property-preview-head"><strong>Предпросмотр карточки · '+language.toUpperCase()+'</strong><span class="badge">как в Telegram</span></div><div class="property-preview-shell"><div class="property-preview-image">'+(source?'<img src="'+esc(source)+'" alt="Обложка объекта">':"Нет фото")+'</div><div class="property-preview-copy"><strong>'+esc(title)+'</strong><span class="property-preview-price">💰 '+esc(price)+'</span><span>📍 '+esc(location)+'</span><span>'+esc(description)+'</span></div></div>'}
    function renderPropertyTranslationSummary(){var summary=el("propertyTranslationSummary3");if(!summary)return;var parts=languages.map(function(language){var health=propertyFormHealth(language),button=el("propertyLang3").querySelector('[data-lang="'+language+'"]');button.textContent=language.toUpperCase()+(health.complete?" ✓":" · "+health.missing.length);var label=health.complete?"готово":health.ready?"показывается · дополнить: "+health.missing.join(", "):"не показывается · нужно: "+health.publicationMissing.join(", ");return '<span class="badge '+(health.complete?"good":"warn")+'" title="'+esc(label)+'">'+language.toUpperCase()+' '+label+'</span>'});summary.innerHTML='<strong>Доступность карточки по языкам</strong><div class="language-health">'+parts.join("")+'</div><span class="summary-note">Для показа в каталоге обязательны название и фотография. Адрес и описание отмечаются как рекомендации к заполнению.</span>';renderPropertyPreview()}
    function renderPropertyGallery(language){if(!language){languages.forEach(renderPropertyGallery);renderPropertyTranslationSummary();return}var s=language[0].toUpperCase()+language.slice(1),root=el("propertyGallery"+s+"3");if(!root)return;var id=el("propertyId3").value,entries=propertyOrderedEntries(language),cards=entries.map(function(entry,index){var source=entry.kind==="new"?propertyFilePreview(entry.file):"/api/media/objects/"+encodeURIComponent(id)+"?imageId="+encodeURIComponent(entry.image.id)+"&rev="+encodeURIComponent(entry.image.updatedAt||"");return '<div class="gallery-item"><img src="'+esc(source)+'" alt="Фото объекта"><span class="gallery-number">'+(index+1)+'</span><span class="gallery-actions"><button class="gallery-move3" data-lang="'+language+'" data-token="'+esc(entry.token)+'" data-step="-1" type="button" aria-label="Переместить влево">‹</button><button class="gallery-move3" data-lang="'+language+'" data-token="'+esc(entry.token)+'" data-step="1" type="button" aria-label="Переместить вправо">›</button><button class="gallery-remove3" data-lang="'+language+'" data-token="'+esc(entry.token)+'" data-kind="'+entry.kind+'" type="button" aria-label="Удалить фотографию">×</button></span></div>'}).join("");root.innerHTML=cards||'<div class="gallery-empty">Для этого языка фотографий пока нет</div>';var totalBytes=(propertyNewImages[language]||[]).reduce(function(sum,item){return sum+Number(item.file.size||0)},0),sizeText=totalBytes?" · новые файлы "+(totalBytes/1024/1024).toFixed(1)+" МБ":"";el("propertyImageNote"+s+"3").textContent=entries.length+" из 10 фотографий для "+language.toUpperCase()+sizeText;renderPropertyTranslationSummary()}
    function filteredProperties(){var q=el("propertySearch3").value.toLocaleLowerCase("ru-RU").trim(),status=el("propertyStatusFilter3").value;return state.objects.filter(function(item){var hay=[localized(item.title,"ru"),localized(item.title,"en"),localized(item.title,"es"),localized(item.address,"ru"),localized(item.address,"en"),localized(item.address,"es"),localized(item.city,"ru"),localized(item.city,"en"),localized(item.city,"es"),localized(item.district,"ru"),localized(item.district,"en"),localized(item.district,"es"),localized(item.price,"ru"),localized(item.price,"en"),localized(item.price,"es"),item.reference,item.priceValue].join(" ").toLocaleLowerCase("ru-RU");return (!status||item.status===status)&&(!q||hay.includes(q))})}
    function renderProperties(){buildDrawers();var items=filteredProperties();el("propertyResultCount3").textContent=countRu(items.length,"объект","объекта","объектов");el("propertyGrid3").innerHTML=items.length?items.map(function(item){var status={active:["Показывается","good"],reserved:["Забронирован","brand"],hidden:["Скрыт","warn"],sold:["Продан","bad"]}[item.status]||[item.status,""],price=propertyPriceLabel(item),byLanguage=item.imagesByLanguage||{ru:item.images||[],en:[],es:[]},counts={ru:(byLanguage.ru||[]).length,en:(byLanguage.en||[]).length,es:(byLanguage.es||[]).length},photos=counts.ru+counts.en+counts.es,health=languages.map(function(language){return[language,propertyLanguageHealth(item,language)]}),healthHtml=health.map(function(row){var language=row[0],result=row[1],title=result.complete?"Заполнено полностью":"Нет: "+result.missing.join(", ");return '<span class="badge '+(result.complete?"good":"warn")+'" title="'+esc(title)+'">'+language.toUpperCase()+' '+(result.complete?"✓":"· "+result.missing.length)+'</span>'}).join("");return '<article class="card content-card"><div class="content-cover">'+mediaThumb("objects",item)+(photos?'<span class="content-photo-count">📷 '+photos+'</span>':"")+'</div><div class="content-body"><div class="row-between"><div class="content-title">'+esc(localized(item.title,"ru")||"Без названия")+'</div><span class="badge '+status[1]+'">'+esc(status[0])+'</span></div><div class="content-meta">'+esc([item.reference,localized(item.city,"ru")||localized(item.address,"ru"),price].filter(Boolean).join(" · ")||"Данные не указаны")+'</div><div class="language-health">'+healthHtml+'</div><div class="tiny muted" style="margin-top:7px">Фото: RU '+counts.ru+' · EN '+counts.en+' · ES '+counts.es+'</div><div class="content-actions"><button class="btn secondary small edit-property3" data-id="'+esc(item.id)+'">Изменить</button><button class="btn danger small delete-property3" data-id="'+esc(item.id)+'">Удалить</button></div></div></article>'}).join(""):'<div class="empty" style="grid-column:1/-1"><strong>Объекты не найдены</strong>Добавьте первую карточку или измените параметры поиска.</div>'}
    function resetProperty(){languages.forEach(function(language){(propertyNewImages[language]||[]).forEach(function(item){var url=propertyPreviewUrls.get(item.file);if(url)URL.revokeObjectURL(url)})});el("propertyForm3").reset();el("propertyId3").value="";el("propertyDialogTitle3").textContent="Новый объект";el("propertyCurrency3").value="EUR";el("propertyPricePeriod3").value="total";el("propertyDealType3").value="sale";el("propertyType3").value="apartment";propertyRemovedImages={ru:[],en:[],es:[]};propertyEditingImages={ru:[],en:[],es:[]};propertyNewImages={ru:[],en:[],es:[]};propertyImageOrder={ru:[],en:[],es:[]};propertyPreviewUrls=new WeakMap();languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("propertyTitle"+s+"3").value="";el("propertyCity"+s+"3").value="";el("propertyDistrict"+s+"3").value="";el("propertyAddress"+s+"3").value="";el("propertyPrice"+s+"3").value="";el("propertyDescription"+s+"3").value=""});renderPropertyGallery();clearDirty(el("propertyForm3"))}
    function editProperty(id){var item=state.objects.find(function(x){return x.id===id});if(!item)return;resetProperty();el("propertyId3").value=id;el("propertyDialogTitle3").textContent="Редактирование объекта";el("propertyStatus3").value=item.status||"active";el("propertyDealType3").value=item.dealType||"sale";el("propertyType3").value=item.propertyType||"apartment";el("propertyReference3").value=item.reference||"";el("propertyPriceValue3").value=item.priceValue==null?"":item.priceValue;el("propertyCurrency3").value=item.currency||"EUR";el("propertyPricePeriod3").value=item.pricePeriod||"total";el("propertyBedrooms3").value=item.bedrooms==null?"":item.bedrooms;el("propertyBathrooms3").value=item.bathrooms==null?"":item.bathrooms;el("propertyArea3").value=item.area==null?"":item.area;el("propertyPlotArea3").value=item.plotArea==null?"":item.plotArea;el("propertyFloor3").value=item.floor||"";el("propertyFloors3").value=item.floors||"";el("propertyDistanceSea3").value=item.distanceSea==null?"":item.distanceSea;el("propertyCondition3").value=item.condition||"";el("propertyUrl3").value=item.url||"";el("propertyMapUrl3").value=item.mapUrl||"";document.querySelectorAll(".property-badge3").forEach(function(box){box.checked=(item.badges||[]).includes(box.value)});var byLanguage=item.imagesByLanguage||{ru:item.images||[],en:[],es:[]};propertyEditingImages={ru:(byLanguage.ru||[]).slice(),en:(byLanguage.en||[]).slice(),es:(byLanguage.es||[]).slice()};propertyImageOrder={ru:propertyEditingImages.ru.map(function(image){return String(image.id)}),en:propertyEditingImages.en.map(function(image){return String(image.id)}),es:propertyEditingImages.es.map(function(image){return String(image.id)})};renderPropertyGallery();languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("propertyTitle"+s+"3").value=item.title&&item.title[language]||"";el("propertyCity"+s+"3").value=exactLocalized(item.city,language);el("propertyDistrict"+s+"3").value=exactLocalized(item.district,language);el("propertyAddress"+s+"3").value=item.address&&item.address[language]||"";el("propertyPrice"+s+"3").value=exactLocalized(item.price,language);el("propertyDescription"+s+"3").value=item.description&&item.description[language]||""});renderPropertyTranslationSummary();addCounters(el("propertyForm3"));el("propertyDialog3").showModal()}
    function offerState(item){if(!item.enabled)return ["Выключена","disabled","bad"];var now=Date.now(),start=item.startAt?Date.parse(item.startAt):NaN,end=item.endAt?Date.parse(item.endAt):NaN;if(Number.isFinite(start)&&start>now)return ["Запланирована","scheduled","brand"];if(Number.isFinite(end)&&end<now)return ["Завершена","expired","warn"];return ["Активна","active","good"]}
    function renderOfferGallery(language){if(!language){languages.forEach(renderOfferGallery);return}var s=language[0].toUpperCase()+language.slice(1),root=el("offerGallery"+s+"3");if(!root)return;var file=offerNewImages[language],image=offerEditingImages[language],source="",name="";if(file){if(!offerPreviewUrls[language])offerPreviewUrls[language]=URL.createObjectURL(file);source=offerPreviewUrls[language];name=file.name}else if(image&&image.exists){source="/api/media/promotions/"+encodeURIComponent(el("offerId3").value)+"?imageId="+encodeURIComponent(image.id)+"&rev="+encodeURIComponent(image.updatedAt||"");name=image.name||"Текущее изображение"}root.innerHTML=source?'<div class="gallery-item"><img src="'+esc(source)+'" alt="Изображение акции"><span class="gallery-number">'+language.toUpperCase()+'</span></div>':'<div class="gallery-empty">Для этого языка изображения пока нет</div>';el("offerImageNote"+s+"3").textContent=name||"JPG или PNG до 5 МБ"}
    function filteredOffers(){var q=el("offerSearch3").value.toLocaleLowerCase("ru-RU").trim(),filter=el("offerStatusFilter3").value;return state.promotions.filter(function(item){var st=offerState(item),hay=languages.map(function(language){return localized(item.title,language)+" "+localized(item.text,language)}).join(" ").toLocaleLowerCase("ru-RU");return (!filter||st[1]===filter)&&(!q||hay.includes(q))})}
    function renderOffers(){buildDrawers();var items=filteredOffers();el("offerResultCount3").textContent=countRu(items.length,"акция","акции","акций");el("offerGrid3").innerHTML=items.length?items.map(function(item){var st=offerState(item),byLanguage=item.imagesByLanguage||{ru:item.images||[],en:[],es:[]},imageHealth=languages.map(function(language){return '<span class="badge '+((byLanguage[language]||[]).length?"good":"warn")+'">'+language.toUpperCase()+' '+((byLanguage[language]||[]).length?"✓":"без фото")+'</span>'}).join("");return '<article class="card content-card"><div class="content-cover">'+mediaThumb("promotions",item)+'</div><div class="content-body"><div class="row-between"><div class="content-title">'+esc(localized(item.title,"ru")||"Без названия")+'</div><span class="badge '+st[2]+'">'+st[0]+'</span></div><div class="content-meta">'+(item.endAt?"До "+esc(fmtDate(item.endAt)):"Без даты окончания")+'</div><div class="language-health">'+imageHealth+'</div><div class="content-actions"><button class="btn secondary small edit-offer3" data-id="'+esc(item.id)+'">Изменить</button><button class="btn danger small delete-offer3" data-id="'+esc(item.id)+'">Удалить</button></div></div></article>'}).join(""):'<div class="empty" style="grid-column:1/-1"><strong>Акции не найдены</strong>Добавьте предложение или измените параметры поиска.</div>'}
    function resetOffer(){languages.forEach(function(language){if(offerPreviewUrls[language])URL.revokeObjectURL(offerPreviewUrls[language])});offerEditingImages={ru:null,en:null,es:null};offerNewImages={ru:null,en:null,es:null};offerPreviewUrls={ru:"",en:"",es:""};el("offerForm3").reset();el("offerId3").value="";el("offerEnabled3").checked=true;el("offerDialogTitle3").textContent="Новая акция";languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);el("offerTitle"+s+"3").value="";el("offerText"+s+"3").value=""});renderOfferGallery();clearDirty(el("offerForm3"))}
    function editOffer(id){var item=state.promotions.find(function(x){return x.id===id});if(!item)return;resetOffer();el("offerId3").value=id;el("offerDialogTitle3").textContent="Редактирование акции";el("offerEnabled3").checked=item.enabled!==false;el("offerStart3").value=localDate(item.startAt);el("offerEnd3").value=localDate(item.endAt);el("offerUrl3").value=item.url||"";var byLanguage=item.imagesByLanguage||{ru:item.images||[],en:[],es:[]};languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);offerEditingImages[language]=(byLanguage[language]||[])[0]||null;el("offerTitle"+s+"3").value=item.title&&item.title[language]||"";el("offerText"+s+"3").value=item.text&&item.text[language]||item.description&&item.description[language]||""});renderOfferGallery();addCounters(el("offerForm3"));el("offerDialog3").showModal()}
    function renderContacts(){if(!dirty.has(el("contactsForm3"))){el("contactManagerName3").value=state.contacts.managerName||"";el("contactPhone3").value=state.contacts.phone||"";el("contactWhatsapp3").value=state.contacts.whatsapp||"";el("contactWhatsappEnabled3").checked=state.contacts.whatsappEnabled!==false;el("contactTelegram3").value=state.contacts.telegram||"";el("contactEmail3").value=state.contacts.email||"";el("contactWebsite3").value=state.contacts.website||"";el("contactMap3").value=state.contacts.mapUrl||"";languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);el("contactText"+s+"3").value=state.contacts.text[l]||""})}updateContactsPreview()}
    function updateContactsPreview(){var name=el("contactManagerName3").value,phone=el("contactPhone3").value,whatsapp=el("contactWhatsappEnabled3").checked?(el("contactWhatsapp3").value||phone.split(",")[0]):"",rows=[["☎",phone],["WA",whatsapp],["TG",el("contactTelegram3").value],["@",el("contactEmail3").value],["↗",el("contactWebsite3").value],["⌖",el("contactMap3").value]].filter(function(r){return Boolean(r[1])});el("contactsPreview3").innerHTML='<p class="muted">'+esc(el("contactTextRu3").value||"Выберите удобный способ связи с менеджером.")+"</p>"+(name?'<div class="contact-channel"><span class="channel-icon">👤</span><strong class="truncate">'+esc(name)+"</strong></div>":"")+(rows.length?rows.map(function(r){return '<div class="contact-channel"><span class="channel-icon">'+r[0]+'</span><span class="truncate">'+esc(r[1])+"</span></div>"}).join(""):'<div class="empty">Добавьте хотя бы один канал связи</div>')}
    function inquiryStatusName(status){return {new:"Новое",in_progress:"В работе",closed:"Закрыто"}[status]||status}
    function inquiryStatusBadge(status){return status==="new"?"brand":status==="closed"?"good":"warn"}
    function inquiryTypeName(type){return {interest:"Интерес к объекту",selection:"Подбор недвижимости",viewing:"Запись на просмотр",question:"Вопрос по объекту",lead:"Заявка на звонок",general:"Общий вопрос"}[type]||"Общий вопрос"}
    function leadInquiryBlock(item){var lead=item&&item.lead||{};if(item.type!=="lead")return"";return '<div class="lead-summary"><div class="lead-summary-title">Контактные данные</div><div class="lead-summary-row"><span>Имя</span><strong>'+esc(lead.name||"Не указано")+'</strong></div><div class="lead-summary-row"><span>Телефон</span><strong>'+esc(lead.phone||"Не указан")+'</strong></div><div class="lead-summary-row"><span>Удобное время</span><strong>'+esc(lead.preferredTime||"Не указано")+'</strong></div></div>'}
    function selectionInquiryBlock(item){var selection=item&&item.selection||{};if(item.type!=="selection")return"";return '<div class="lead-summary"><div class="lead-summary-title">Параметры подбора</div><div class="lead-summary-row"><span>Цель</span><strong>'+esc(selection.deal||"Не указана")+'</strong></div><div class="lead-summary-row"><span>Район</span><strong>'+esc(selection.location||"Не указан")+'</strong></div><div class="lead-summary-row"><span>Бюджет</span><strong>'+esc(selection.budget||"Не указан")+'</strong></div><div class="lead-summary-row"><span>Спальни</span><strong>'+esc(selection.bedrooms||"Не указано")+'</strong></div></div>'}
    function userLeadBlock(user){if(!user.phone&&!user.contactName&&!user.preferredContactTime)return"";return '<div class="lead-summary"><div class="lead-summary-title">Контакт для звонка</div><div class="lead-summary-row"><span>Имя</span><strong>'+esc(user.contactName||userName(user))+'</strong></div><div class="lead-summary-row"><span>Телефон</span><strong>'+esc(user.phone||"Не указан")+'</strong></div><div class="lead-summary-row"><span>Время</span><strong>'+esc(user.preferredContactTime||"Не указано")+'</strong></div></div>'}
    function inquiryProperty(item){return item&&item.propertyId?state.objects.find(function(record){return record.id===item.propertyId}):null}
    function filteredInquiries(){var q=el("inquirySearch3").value.toLocaleLowerCase("ru-RU").trim(),status=el("inquiryStatusFilter3").value,type=el("inquiryTypeFilter3").value,priority={new:0,in_progress:1,closed:2};return state.inquiries.filter(function(item){var user=state.users.find(function(u){return u.id===item.userId})||{},property=inquiryProperty(item)||{},lead=item.lead||{},selection=item.selection||{},hay=[userName(user),user.username||"",item.text,lead.name||"",lead.phone||"",lead.preferredTime||"",selection.deal||"",selection.location||"",selection.budget||"",selection.bedrooms||"",localized(property.title,"ru"),localized(property.title,"en"),localized(property.title,"es"),property.reference||""].join(" ").toLocaleLowerCase("ru-RU");return (!status||item.status===status)&&(!type||item.type===type)&&(!q||hay.includes(q))}).sort(function(a,b){var statusDifference=(priority[a.status]??3)-(priority[b.status]??3);return statusDifference||Date.parse(b.updatedAt||b.createdAt||0)-Date.parse(a.updatedAt||a.createdAt||0)})}
    function renderInquiries(){var items=filteredInquiries();el("inquiryResultCount3").textContent=countRu(items.length,"обращение","обращения","обращений");el("inquiryList3").innerHTML=items.length?items.map(function(item){var user=state.users.find(function(u){return u.id===item.userId})||{},property=inquiryProperty(item),propertyName=property?(localized(property.title,"ru")||property.reference||"Объект"):"";return '<button class="inquiry-card '+(item.status==="new"?"new ":"")+(selectedInquiry===item.id?"active":"")+'" data-inquiry="'+esc(item.id)+'"><div class="row-between"><strong class="truncate">'+esc(userName(user))+'</strong><span class="badge '+inquiryStatusBadge(item.status)+'">'+esc(inquiryStatusName(item.status))+'</span></div><div class="inquiry-meta">'+esc(inquiryTypeName(item.type))+(propertyName?" · "+esc(propertyName):"")+'</div><div class="inquiry-text">'+esc(item.text)+'</div><div class="inquiry-meta">'+esc(languageName(item.language))+" · "+esc(fmtDate(item.updatedAt||item.createdAt))+"</div></button>"}).join(""):'<div class="empty"><strong>Обращений не найдено</strong>Новые вопросы без автоответа появятся здесь.</div>';if(selectedInquiry)renderInquiryDetail(selectedInquiry)}
    function renderInquiryDetail(id){var statusForm=el("inquiryStateForm3"),replyForm=el("inquiryReplyForm3");if(selectedInquiry===id&&((statusForm&&dirty.has(statusForm))||(replyForm&&dirty.has(replyForm))))return;var item=state.inquiries.find(function(x){return x.id===id});if(!item){selectedInquiry="";el("inquiryDetail3").innerHTML='<div class="empty">Обращение не найдено</div>';return}var user=state.users.find(function(u){return u.id===item.userId})||{},property=inquiryProperty(item);var replies=(item.replies||[]).slice().reverse();el("inquiryDetail3").innerHTML='<div class="row-between"><div><h3>'+esc(userName(user))+'</h3><div class="small muted">'+(user.username?"@"+esc(user.username)+" · ":"")+"ID "+esc(item.userId)+" · "+esc(languageName(item.language))+'</div></div><span class="badge '+inquiryStatusBadge(item.status)+'">'+esc(inquiryStatusName(item.status))+'</span></div>'+(property?'<div class="property-context"><strong>'+esc(localized(property.title,"ru")||"Объект")+'</strong><span>'+esc([property.reference,localized(property.address,"ru"),propertyPriceLabel(property)].filter(Boolean).join(" · "))+'</span><button class="btn ghost small open-inquiry-property3" data-id="'+esc(property.id)+'" type="button">Открыть объект</button></div>':"")+'<div class="form-section"><div class="form-section-title">'+esc(inquiryTypeName(item.type))+'</div><div class="timeline-item"><div class="tiny muted">'+esc(fmtDate(item.createdAt))+'</div><div class="timeline-text">'+esc(item.text)+'</div></div></div><form id="inquiryStateForm3" data-saveable><div class="grid two-col"><div class="field"><label for="inquiryStatus3">Статус</label><select id="inquiryStatus3" class="select"><option value="new">Новое</option><option value="in_progress">В работе</option><option value="closed">Закрыто</option></select></div><div class="field"><label for="inquiryNote3">Заметка администратора</label><textarea id="inquiryNote3" class="textarea" maxlength="2000"></textarea></div></div><button class="btn secondary" type="submit">Сохранить статус и заметку</button></form><div class="form-section"><div class="form-section-title">Ответить пользователю</div><form id="inquiryReplyForm3" data-saveable><div class="field"><label for="inquiryReply3">Текст ответа</label><textarea id="inquiryReply3" class="textarea" maxlength="4000" required></textarea></div><label class="small"><input id="inquiryKeepOpen3" type="checkbox" checked> Оставить обращение в работе после ответа <span class="muted">(рекомендуется)</span></label><button class="btn wide" type="submit" style="margin-top:12px">Отправить ответ</button></form></div><div class="form-section"><h3>История ответов</h3><div class="timeline" style="margin-top:10px">'+(replies.length?replies.map(function(reply){var channel=reply.source==="telegram"?" · Telegram":"",delivery=reply.source==="panel"?'<span class="delivery-state">✓ Доставлено</span>':"";return '<div class="timeline-item out"><div class="tiny muted">Администратор'+channel+' · '+esc(fmtDate(reply.createdAt))+delivery+'</div><div class="timeline-text">'+esc(reply.text)+"</div></div>"}).join(""):'<div class="empty">Ответов пока нет</div>')+'</div></div>';el("inquiryStatus3").value=item.status;el("inquiryNote3").value=item.note||"";el("inquiryStateForm3").addEventListener("submit",saveInquiryState);el("inquiryReplyForm3").addEventListener("submit",replyToInquiry);var openProperty=el("inquiryDetail3").querySelector(".open-inquiry-property3");if(openProperty)openProperty.addEventListener("click",function(){openView("properties");editProperty(openProperty.dataset.id)});addCounters(el("inquiryDetail3"))}
    var renderInquiryDetailCore=renderInquiryDetail;
    renderInquiryDetail=function(id){renderInquiryDetailCore(id);var item=state.inquiries.find(function(record){return record.id===id}),detail=el("inquiryDetail3"),summary=item&&item.type==="lead"?leadInquiryBlock(item):item&&item.type==="selection"?selectionInquiryBlock(item):"";if(summary&&detail&&!detail.querySelector(".lead-summary")){var header=detail.firstElementChild;if(header)header.insertAdjacentHTML("afterend",summary)}}
    async function saveInquiryState(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{await api("/api/inquiries/"+encodeURIComponent(selectedInquiry),{method:"PATCH",body:JSON.stringify({status:el("inquiryStatus3").value,note:el("inquiryNote3").value})});clearDirty(el("inquiryStateForm3"));await loadState();toast("Обращение обновлено")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function replyToInquiry(e){e.preventDefault();var button=e.submitter,form=e.currentTarget;button.disabled=true;try{await api("/api/inquiries/"+encodeURIComponent(selectedInquiry)+"/reply",{method:"POST",body:JSON.stringify({text:el("inquiryReply3").value,keepOpen:el("inquiryKeepOpen3").checked})});clearDirty(form);await loadState();toast("Ответ отправлен пользователю")}catch(error){toast(error.message)}finally{button.disabled=false}}
    function typeName(type){return {contains:"содержит",exact:"точно",starts:"начинается"}[type]||type}
    function filteredReplies(){var q=el("replySearch3").value.toLocaleLowerCase("ru-RU").trim(),lang=el("replyLanguageFilter3").value;return state.rules.slice().sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}).filter(function(r){return (!lang||r.language===lang)&&(!q||(r.trigger+" "+r.answer).toLocaleLowerCase("ru-RU").includes(q))})}
    function renderReplies(){var items=filteredReplies();el("replyResultCount3").textContent=countRu(items.length,"правило","правила","правил");el("replyList3").innerHTML=items.length?items.map(function(r){return '<div class="reply-row '+(r.enabled?"":"off")+'"><input class="toggle reply-toggle3" data-id="'+esc(r.id)+'" type="checkbox" '+(r.enabled?"checked":"")+' aria-label="Автоответ включён"><div><div class="reply-trigger">'+esc(r.trigger)+'</div><span class="badge">'+esc(typeName(r.type)+" · "+languageName(r.language))+'</span></div><div class="reply-answer" title="'+esc(r.answer)+'">'+esc(r.answer)+'</div><div class="actions"><span class="order-buttons"><button class="btn ghost small move-reply3" data-id="'+esc(r.id)+'" data-step="-1" aria-label="Поднять">↑</button><button class="btn ghost small move-reply3" data-id="'+esc(r.id)+'" data-step="1" aria-label="Опустить">↓</button></span><button class="btn secondary small edit-reply3" data-id="'+esc(r.id)+'">Изменить</button><button class="btn ghost small copy-reply3" data-id="'+esc(r.id)+'">Копия</button><button class="btn danger small delete-reply3" data-id="'+esc(r.id)+'">Удалить</button></div></div>'}).join(""):'<div class="empty"><strong>Автоответы не найдены</strong>Добавьте новое правило или измените поиск.</div>'}
    function resetReply(){el("replyForm3").reset();el("replyId3").value="";el("replyDialogTitle3").textContent="Новый автоответ";clearDirty(el("replyForm3"))}
    function editReply(id,copy){var r=state.rules.find(function(x){return x.id===id});if(!r)return;resetReply();el("replyId3").value=copy?"":id;el("replyDialogTitle3").textContent=copy?"Копия автоответа":"Редактирование автоответа";el("replyTrigger3").value=r.trigger;el("replyType3").value=r.type;el("replyLanguage3").value=r.language;el("replyAnswer3").value=r.answer;addCounters(el("replyForm3"));if(copy)markDirty(el("replyForm3"));el("replyDialog3").showModal()}
    function campaignPane(language){var s=language[0].toUpperCase()+language.slice(1);return '<div class="lang-pane '+(language==="ru"?"active":"")+'" data-campaign-pane="'+language+'"><div class="field"><label for="campaignText'+s+'3">Текст сообщения</label><textarea id="campaignText'+s+'3" class="textarea campaign-live3" maxlength="4000" placeholder="{first_name}, ..."></textarea></div></div>'}
    function buildCampaign(){el("campaignFormTitle3").nextElementSibling.textContent="Черновик можно сохранить незавершённым. Перед отправкой заполните выбранные языки.";el("campaignTags3").nextElementSibling.textContent="Пустое поле — все пользователи выбранных языков. Несколько тегов выбирают пользователей хотя бы с одним из них.";if(!el("campaignTextPanes3").children.length)el("campaignTextPanes3").innerHTML=languages.map(campaignPane).join("");if(!el("campaignReadiness3")){var readiness=document.createElement("div");readiness.id="campaignReadiness3";readiness.className="campaign-readiness";el("campaignLang3").insertAdjacentElement("afterend",readiness)}if(!el("campaignTimezone3")){var timezone=document.createElement("span");timezone.id="campaignTimezone3";timezone.className="hint";el("campaignSchedule3").insertAdjacentElement("afterend",timezone)}if(!el("campaignSafety3")){var safety=document.createElement("div");safety.id="campaignSafety3";safety.className="campaign-safety";el("campaignForm3").querySelector(".campaign-actions").insertAdjacentElement("beforebegin",safety)}}
    function campaignStatus(status){return {draft:"Черновик",scheduled:"Запланирована",queued:"В очереди",running:"Выполняется",done:"Завершена",failed:"Ошибка"}[status]||status}
    function renderCampaigns(){buildCampaign();var list=state.broadcasts;el("campaignHistory3").innerHTML=list.length?list.slice(0,20).map(function(item){var text=localized(item.messages,"ru"),progress=item.total?Math.round((Number(item.sent||0)+Number(item.failed||0))/item.total*100):0,badge=item.status==="done"?"good":item.status==="failed"?"bad":item.status==="scheduled"?"brand":"";return '<div class="history-item"><div class="row-between"><strong class="truncate">'+esc(text||campaignStatus(item.status))+'</strong><span class="badge '+badge+'">'+esc(campaignStatus(item.status))+'</span></div><div class="small muted">'+esc(fmtDate(item.scheduledAt||item.createdAt))+" · "+fmtNumber(item.sent)+" из "+fmtNumber(item.total)+(item.failed?" · ошибок "+fmtNumber(item.failed):"")+'</div><div class="progress"><span style="width:'+progress+'%"></span></div><div class="actions history-actions"><button class="btn ghost small copy-campaign3" data-id="'+esc(item.id)+'">Создать копию</button>'+(['draft','scheduled'].includes(item.status)?'<button class="btn secondary small edit-campaign3" data-id="'+esc(item.id)+'">Изменить</button><button class="btn danger small delete-campaign3" data-id="'+esc(item.id)+'">Удалить</button>':"")+"</div></div>"}).join(""):'<div class="empty" style="grid-column:1/-1"><strong>Рассылок пока нет</strong>Подготовьте первое сообщение выше.</div>';var select=el("campaignTestUser3"),selected=select.value;select.innerHTML='<option value="">Выберите пользователя</option>'+state.users.filter(function(u){return !u.blocked&&u.chatId}).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(userName(u))+" · "+esc(languageName(u.preferredLanguage))+"</option>"}).join("");select.value=selected;updateCampaignPreview();updateCampaignEstimate()}
    function campaignReadiness(){var selected=Array.from(document.querySelectorAll(".campaign-language3:checked")).map(function(x){return x.value}),missing=selected.filter(function(language){var s=language[0].toUpperCase()+language.slice(1);return !el("campaignText"+s+"3").value.trim()}),buttonUrl=el("campaignButtonUrl3").value.trim(),missingButtons=buttonUrl?selected.filter(function(language){var s=language[0].toUpperCase()+language.slice(1);return !el("campaignButton"+s+"3").value.trim()}):[];return{selected:selected,missing:missing,missingButtons:missingButtons,valid:Boolean(selected.length&&!missing.length&&!missingButtons.length)}}
    function updateCampaignSafety(){if(!el("campaignSafety3"))return;var readiness=campaignReadiness(),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||"локальное время",schedule=el("campaignSchedule3").value,total=Number(el("campaignEstimate3").dataset.total||0),rows=languages.map(function(language){var selected=readiness.selected.includes(language),s=language[0].toUpperCase()+language.slice(1),ready=Boolean(el("campaignText"+s+"3").value.trim());return '<div class="campaign-ready-row"><strong>'+language.toUpperCase()+'</strong><span>'+(selected?(ready?'✓ текст готов':'нужен текст'):'не выбран')+'</span></div>'});el("campaignReadiness3").innerHTML=rows.join("");el("campaignTimezone3").textContent="Время панели: "+timezone+(schedule?" · будет отправлено "+new Date(schedule).toLocaleString("ru-RU"):"");var warnings=[];if(!readiness.selected.length)warnings.push("Выберите хотя бы один язык");if(readiness.missing.length)warnings.push("Нет текста: "+readiness.missing.map(function(x){return x.toUpperCase()}).join(", "));if(readiness.missingButtons.length)warnings.push("Для ссылки нужна подпись кнопки: "+readiness.missingButtons.map(function(x){return x.toUpperCase()}).join(", "));if(!total)warnings.push("По текущему фильтру нет получателей");var safety=el("campaignSafety3");safety.className="campaign-safety "+(warnings.length?"warn":"good");safety.innerHTML='<strong>'+(warnings.length?"Проверьте перед отправкой":"Рассылка готова")+'</strong><div class="campaign-safety-list">'+(warnings.length?warnings.map(function(item){return '<span class="badge warn">'+esc(item)+'</span>'}).join(""):'<span class="badge good">'+esc(countRu(total,"получатель","получателя","получателей"))+'</span><span class="badge good">'+readiness.selected.map(function(x){return x.toUpperCase()}).join(", ")+'</span>')+'</div>';var running=Boolean(state&&state.runtime&&state.runtime.broadcastRunning),form=el("campaignForm3");form.querySelector('[data-mode="send"]').disabled=running||!readiness.valid||!total;form.querySelector('[data-mode="schedule"]').disabled=running||!readiness.valid||!total||!schedule;form.querySelector('[data-mode="test"]').disabled=!readiness.valid||!el("campaignTestUser3").value}
    function updateCampaignEstimate(){if(!state)return;var langs=Array.from(document.querySelectorAll(".campaign-language3:checked")).map(function(x){return x.value}),tags=el("campaignTags3").value.split(",").map(function(x){return x.trim().toLocaleLowerCase("ru-RU")}).filter(Boolean),total=state.users.filter(function(u){if(u.blocked||!u.chatId)return false;if(langs.length&&!langs.includes(u.preferredLanguage||"ru"))return false;if(tags.length){var own=(u.tags||[]).map(function(x){return String(x).toLocaleLowerCase("ru-RU")});if(!tags.some(function(tag){return own.includes(tag)}))return false}return true}).length;el("campaignEstimate3").textContent=countRu(total,"получатель","получателя","получателей");el("campaignEstimate3").dataset.total=String(total);updateCampaignSafety()}
    function updateCampaignPreview(){var lang=el("campaignPreviewLanguage3").value,s=lang[0].toUpperCase()+lang.slice(1),text=el("campaignText"+s+"3")?el("campaignText"+s+"3").value:"",button=el("campaignButton"+s+"3").value;text=text.replaceAll("{first_name}","Анна").replaceAll("{last_name}","Иванова").replaceAll("{username}","@anna");el("campaignPreview3").innerHTML=esc(text||"Введите текст сообщения")+(button?'<div class="preview-button">'+esc(button)+"</div>":"");updateCampaignSafety()}
    function resetCampaign(){el("campaignForm3").reset();el("campaignId3").value="";el("campaignFormTitle3").textContent="Новая рассылка";document.querySelectorAll(".campaign-language3").forEach(function(x){x.checked=true});languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);el("campaignText"+s+"3").value="";el("campaignButton"+s+"3").value=""});clearDirty(el("campaignForm3"));updateCampaignPreview();updateCampaignEstimate()}
    function editCampaign(id,copy){var item=state.broadcasts.find(function(x){return x.id===id});if(!item)return;resetCampaign();el("campaignId3").value=copy?"":id;el("campaignFormTitle3").textContent=copy?"Копия рассылки":"Редактирование рассылки";el("campaignTags3").value=(item.tags||[]).join(", ");el("campaignButtonUrl3").value=item.buttonUrl||"";el("campaignSchedule3").value=localDate(item.scheduledAt);document.querySelectorAll(".campaign-language3").forEach(function(x){x.checked=!(item.languages||[]).length||(item.languages||[]).includes(x.value)});languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);el("campaignText"+s+"3").value=item.messages&&item.messages[l]||"";el("campaignButton"+s+"3").value=item.buttonText&&item.buttonText[l]||""});addCounters(el("campaignForm3"));if(copy)markDirty(el("campaignForm3"));updateCampaignPreview();updateCampaignEstimate();el("campaignForm3").scrollIntoView({behavior:"smooth"})}
    function filteredUsers(){var q=el("userSearch3").value.toLocaleLowerCase("ru-RU").trim(),lang=el("userLanguageFilter3").value;return state.users.filter(function(u){var actual=u.preferredLanguage||"unknown",hay=(userName(u)+" "+u.username+" "+u.id+" "+(u.contactName||"")+" "+(u.phone||"")+" "+(u.preferredContactTime||"")+" "+(u.tags||[]).join(" ")).toLocaleLowerCase("ru-RU");return (!lang||lang===actual)&&(!q||hay.includes(q))})}
    function renderAudience(){var users=filteredUsers();el("userResultCount3").textContent=countRu(users.length,"пользователь","пользователя","пользователей");el("userGrid3").innerHTML=users.length?users.map(function(u){return '<button class="user-card '+(selectedUser===u.id?"active":"")+'" data-user="'+esc(u.id)+'"><div class="row-between"><div class="avatar">'+esc(initials(u))+'</div><span class="badge">'+esc(languageName(u.preferredLanguage))+'</span></div><div style="margin-top:10px"><strong>'+esc(userName(u))+'</strong><div class="small muted">'+(u.username?"@"+esc(u.username)+" · ":"")+"ID "+esc(u.id)+'</div><div class="small muted">'+countRu(u.messages,"сообщение","сообщения","сообщений")+" · "+esc(fmtDate(u.lastSeenAt))+'</div></div><div class="tags">'+(u.tags||[]).map(function(tag){return '<span class="tag">'+esc(tag)+"</span>"}).join("")+"</div></button>"}).join(""):'<div class="empty" style="grid-column:1/-1"><strong>Пользователи не найдены</strong>Измените поиск или фильтр.</div>';if(selectedUser)renderUserDetail(selectedUser)}
    function renderUserDetail(id){
      var existing=el("userForm3"),direct=el("directMessageForm3");
      if(selectedUser===id&&((existing&&dirty.has(existing))||(direct&&dirty.has(direct))))return;
      var u=state.users.find(function(x){return x.id===id});
      if(!u){el("userDetail3").innerHTML='<div class="empty">Пользователь не найден</div>';return}
      el("userDetail3").innerHTML='<div class="row-between"><div><h3>'+esc(userName(u))+'</h3><div class="small muted">'+(u.username?"@"+esc(u.username)+" · ":"")+"ID "+esc(u.id)+'</div></div><div class="avatar">'+esc(initials(u))+'</div></div><form id="userForm3" data-saveable><div class="field"><label for="userLanguage3">Язык</label><select id="userLanguage3" class="select"><option value="">Не выбран</option><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div><div class="field"><label for="userTags3">Теги через запятую</label><input id="userTags3" class="input" maxlength="500" value="'+esc((u.tags||[]).join(", "))+'"></div><div class="field"><label for="userNote3">Заметка администратора</label><textarea id="userNote3" class="textarea" maxlength="2000">'+esc(u.note||"")+'</textarea></div><button class="btn" type="submit">Сохранить карточку</button></form><div class="form-section direct-message-composer"><div class="row-between"><div><h3>Написать пользователю</h3><div class="card-note">Личное сообщение от имени бота — только этому человеку</div></div><span class="badge '+(u.blocked?"bad":"good")+'">'+(u.blocked?"Недоступен":"Доступен")+'</span></div><form id="directMessageForm3" data-saveable><div class="field"><label for="directMessageText3">Сообщение</label><textarea id="directMessageText3" class="textarea" maxlength="4000" placeholder="Введите текст сообщения"></textarea></div><div class="field"><label for="directMessageImage3">Изображение</label><input id="directMessageImage3" class="input" type="file" accept="image/jpeg,image/png"><span class="hint">Необязательно. JPG или PNG до 5 МБ.</span></div><div class="grid two-col"><div class="field"><label for="directMessageButtonText3">Название кнопки</label><input id="directMessageButtonText3" class="input" maxlength="80" placeholder="Например: Открыть объект"></div><div class="field"><label for="directMessageButtonUrl3">Ссылка кнопки</label><input id="directMessageButtonUrl3" class="input" type="url" maxlength="500" placeholder="https://..."></div></div><button class="btn wide" type="submit" '+(u.blocked?"disabled":"")+'>Отправить пользователю</button></form></div><div class="form-section"><h3>История общения и реакции</h3><div class="timeline" style="margin-top:10px">'+((u.activity||[]).length?(u.activity||[]).slice().reverse().slice(0,20).map(function(a){var reactions=(a.reactions||[]).map(function(reaction){return '<span class="reaction-chip">'+esc(reaction)+"</span>"}).join(""),target=a.kind==="reaction"&&a.targetText?'<div class="tiny muted reaction-target">На сообщение: '+esc(a.targetText)+"</div>":"",who=a.kind==="reaction"?"Реакция":a.direction==="in"?"Пользователь":"Бот";return '<div class="timeline-item '+esc(a.kind==="reaction"?"reaction":a.direction)+'"><div class="tiny muted">'+who+" · "+esc(fmtDate(a.createdAt))+'</div><div class="timeline-text">'+esc(a.text)+"</div>"+target+(reactions?'<div class="timeline-reactions">'+reactions+"</div>":"")+"</div>"}).join(""):'<div class="empty">История пока пуста</div>')+"</div></div>";
      var composer=el("userDetail3").querySelector(".direct-message-composer"),composerHead=composer&&composer.querySelector(".row-between");if(composer&&composerHead){composer.classList.add("composer-collapsed");var toggle=document.createElement("button");toggle.className="btn secondary small composer-toggle";toggle.type="button";toggle.textContent="Написать";toggle.addEventListener("click",function(){var collapsed=composer.classList.toggle("composer-collapsed");toggle.textContent=collapsed?"Написать":"Свернуть"});composerHead.appendChild(toggle)}
      var contactBlock=userLeadBlock(u);if(contactBlock)el("userForm3").insertAdjacentHTML("beforebegin",contactBlock);
      el("userLanguage3").value=u.preferredLanguage||"";
      el("userForm3").addEventListener("submit",saveUser);
      el("directMessageForm3").addEventListener("submit",function(e){sendDirectMessage(e,u.id)});
      addCounters(el("userDetail3"));
    }
    function ensureNotificationSettings(){if(el("notificationForm3"))return;var stack=document.querySelector("#view-settings .section-stack"),form=document.createElement("form");form.id="notificationForm3";form.className="card";form.dataset.saveable="";form.innerHTML='<div class="card-head"><div><h3>Уведомления администратору</h3><div class="card-note">Все сообщения и действия пользователей будут приходить в Telegram</div></div><span id="notificationState3" class="badge">Не настроено</span></div><div class="callout notification-help"><strong>Как подключить:</strong><span>1. Откройте этого бота в Telegram и отправьте команду <code>/myid</code>.</span><span>2. Скопируйте полученный номер в поле ниже и сохраните.</span><span>3. Нажмите «Отправить тест».</span></div><div class="field"><label for="adminChatId3">Telegram Chat ID администратора</label><input id="adminChatId3" class="input" inputmode="numeric" maxlength="20" placeholder="Например: 123456789"><span class="hint">Используйте личный Chat ID. Ответ на уведомление будет отправлен пользователю от имени бота.</span></div><div class="actions"><button class="btn" type="submit">Сохранить</button><button id="testAdminNotificationBtn3" class="btn secondary" type="button">Отправить тест</button></div>';stack.prepend(form);form.addEventListener("submit",saveNotificationSettings);el("testAdminNotificationBtn3").addEventListener("click",testAdminNotification);var backup=Array.from(document.querySelectorAll("#view-settings .card")).find(function(card){return card.querySelector("h3")&&card.querySelector("h3").textContent==="Резервная копия"});if(backup){var note=backup.querySelector(".card-note");if(note)note.textContent="Сжатая копия .json.gz содержит фотографии, токен бота, настройки входа, контент и данные пользователей. Храните файл как конфиденциальный."}}
    function ensureConnectionCard(){if(el("connectionCard3"))return;var stack=document.querySelector("#view-settings .section-stack"),card=document.createElement("div");card.id="connectionCard3";card.className="card";card.innerHTML='<div class="card-head"><div><h3>Состояние подключения</h3><div id="connectionSummary3" class="card-note">Проверяем Telegram…</div></div><span id="connectionBadge3" class="badge">Проверка</span></div><div class="data-row"><span>Последняя успешная проверка</span><strong id="connectionSuccess3">—</strong></div><div class="data-row"><span>Последняя проблема</span><strong id="connectionErrorAt3">—</strong></div><div id="connectionError3" class="hint" style="margin-top:10px"></div>';stack.prepend(card)}
    function renderSettings(){ensureNotificationSettings();ensureConnectionCard();if(!dirty.has(el("technicalForm3")))el("settingActive3").checked=state.config.active;if(!dirty.has(el("notificationForm3")))el("adminChatId3").value=state.config.adminChatId||"";var notificationBadge=el("notificationState3"),configured=Boolean(state.config.adminChatId),verified=Boolean(configured&&state.config.adminNotificationVerifiedAt);notificationBadge.textContent=!configured?"Не настроено":verified?"Проверено":"Нужно проверить";notificationBadge.className="badge "+(verified?"good":"warn");var runtime=state.runtime||{},status=runtime.status,badge=el("connectionBadge3");badge.textContent=statusName(status);badge.className="badge "+(status==="online"?"good":status==="stopped"?"":"warn");el("connectionSummary3").textContent=connectionNote();el("connectionSuccess3").textContent=runtime.lastSuccessfulContactAt?fmtDate(runtime.lastSuccessfulContactAt):"Ещё не было";el("connectionErrorAt3").textContent=runtime.lastErrorAt?fmtDate(runtime.lastErrorAt):"Нет";el("connectionError3").textContent=runtime.lastError||"Ошибок текущего подключения нет.";el("dataUsers3").textContent=fmtNumber(state.userCount);el("dataProperties3").textContent=fmtNumber(state.objects.length);el("dataOffers3").textContent=fmtNumber(state.promotions.length);el("dataReplies3").textContent=fmtNumber(state.rules.length)}
    function addCounters(root){(root||document).querySelectorAll("textarea[maxlength],input[maxlength]").forEach(function(node){var c=node.nextElementSibling&&node.nextElementSibling.classList.contains("counter")?node.nextElementSibling:null;if(!c){c=document.createElement("span");c.className="counter";node.insertAdjacentElement("afterend",c);node.addEventListener("input",function(){c.textContent=node.value.length+" / "+node.maxLength})}c.textContent=node.value.length+" / "+node.maxLength})}
    function bindQuick(root){(root||document).querySelectorAll(".quick-nav").forEach(function(button){if(button._bound)return;button._bound=true;button.addEventListener("click",function(){openView(button.dataset.view)})})}
    function bindLanguageSwitch(container,prefix){container.addEventListener("click",function(e){var button=e.target.closest("[data-lang]");if(!button)return;var lang=button.dataset.lang;container.querySelectorAll("[data-lang]").forEach(function(x){var active=x===button;x.classList.toggle("active",active);x.setAttribute("aria-selected",active?"true":"false")});document.querySelectorAll("[data-"+prefix+"-pane]").forEach(function(pane){pane.classList.toggle("active",pane.dataset[prefix+"Pane"]===lang)});if(prefix==="property")renderPropertyTranslationSummary()})}
    async function saveWelcome(e){e.preventDefault();var button=e.submitter||el("saveWelcomeTop3");button.disabled=true;try{var messages={},menu=state.config.menu,images={};languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);messages[l]={greeting:el("greeting"+s+"3").value,help:el("help"+s+"3").value,fallback:el("fallback"+s+"3").value}});for(var i=0;i<languages.length;i++){var l=languages[i],s=l[0].toUpperCase()+l.slice(1),file=el("welcomeFile"+s+"3").files[0];if(file)images[l]={dataUrl:await fileData(file),name:file.name};else if(welcomeRemove[l])images[l]={remove:true}}await api("/api/welcome",{method:"PUT",body:JSON.stringify({messages:messages,menu:menu,images:images})});clearDirty(el("welcomeForm3"));await loadState();toast("Приветствие сохранено")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveInterfaceText(e){e.preventDefault();var button=e.submitter||el("saveInterfaceTop3"),next=JSON.parse(JSON.stringify(state.interfaceText||{}));button.disabled=true;try{document.querySelectorAll(".interface-input3").forEach(function(input){var group=input.dataset.group,language=input.dataset.lang,key=input.dataset.key;if(!next[group])next[group]={};if(!next[group][language])next[group][language]={};next[group][language][key]=input.dataset.list==="1"?input.value.split(/\r?\n/).map(function(value){return value.trim()}).filter(Boolean):input.value});await api("/api/interface-text",{method:"PUT",body:JSON.stringify({interfaceText:next})});clearDirty(el("interfaceForm3"));await loadState();toast("Тексты интерфейса сохранены")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveMenuSection(e,key,prefix,label){e.preventDefault();var button=e.submitter;button.disabled=true;try{var menu=JSON.parse(JSON.stringify(state.config.menu));languages.forEach(function(language){var s=language[0].toUpperCase()+language.slice(1);menu[language][key]=el("section"+prefix+s+"3").value});await api("/api/menu",{method:"PUT",body:JSON.stringify({menu:menu})});clearDirty(e.currentTarget);await loadState();toast(label+" сохранён")}catch(error){toast(error.message)}finally{button.disabled=false}}
    function translations(prefix,fields){var out={};fields.forEach(function(field){out[field]={};languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);out[field][l]=el(prefix+field[0].toUpperCase()+field.slice(1)+s+"3").value})});return out}
    async function confirmPropertyPublication(){if(el("propertyStatus3").value!=="active"&&el("propertyStatus3").value!=="reserved")return true;var missing=languages.filter(function(language){return !propertyFormHealth(language).ready});if(!missing.length)return true;return confirmAction("Не все языки опубликованы","Карточка не появится в каталоге без названия и фотографии для языков "+missing.map(function(language){return language.toUpperCase()}).join(", ")+". Сохранить объект в текущем виде?","Сохранить")}
    async function saveProperty(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{if(!await confirmPropertyPublication())return;var t=translations("property",["title","city","district","address","price","description"]),imageDataUrlsByLanguage={ru:[],en:[],es:[]},removeImagesByLanguage={},removeImageIdsByLanguage={},imageOrderByLanguage={},imageSequenceByLanguage={},totalNewBytes=languages.reduce(function(total,language){return total+(propertyNewImages[language]||[]).reduce(function(sum,item){return sum+Number(item.file.size||0)},0)},0);if(totalNewBytes>45*1024*1024)throw new Error("Новые фотографии занимают больше 45 МБ. Сохраните их в два этапа.");for(var languageIndex=0;languageIndex<languages.length;languageIndex++){var language=languages[languageIndex],s=language[0].toUpperCase()+language.slice(1),fresh=propertyNewImages[language]||[],removed=propertyRemovedImages[language]||[],entries=propertyOrderedEntries(language),removeAll=el("propertyRemoveImages"+s+"3").checked;if(entries.length>10)throw new Error("Для "+language.toUpperCase()+" можно загрузить не более 10 фотографий");removeImagesByLanguage[language]=removeAll;removeImageIdsByLanguage[language]=removed;imageOrderByLanguage[language]=entries.filter(function(entry){return entry.kind==="existing"}).map(function(entry){return entry.token});imageSequenceByLanguage[language]=entries.map(function(entry){return entry.token});for(var fileIndex=0;fileIndex<fresh.length;fileIndex++)imageDataUrlsByLanguage[language].push({clientId:fresh[fileIndex].id,dataUrl:await fileData(fresh[fileIndex].file),name:fresh[fileIndex].file.name})}var body={title:t.title,city:t.city,district:t.district,address:t.address,price:t.price,description:t.description,priceValue:el("propertyPriceValue3").value,currency:el("propertyCurrency3").value,pricePeriod:el("propertyPricePeriod3").value,dealType:el("propertyDealType3").value,propertyType:el("propertyType3").value,reference:el("propertyReference3").value,bedrooms:el("propertyBedrooms3").value,bathrooms:el("propertyBathrooms3").value,area:el("propertyArea3").value,plotArea:el("propertyPlotArea3").value,floor:el("propertyFloor3").value,floors:el("propertyFloors3").value,distanceSea:el("propertyDistanceSea3").value,condition:el("propertyCondition3").value,url:el("propertyUrl3").value,mapUrl:el("propertyMapUrl3").value,badges:Array.from(document.querySelectorAll(".property-badge3:checked")).map(function(box){return box.value}),status:el("propertyStatus3").value,removeImagesByLanguage:removeImagesByLanguage,removeImageIdsByLanguage:removeImageIdsByLanguage,imageOrderByLanguage:imageOrderByLanguage,imageSequenceByLanguage:imageSequenceByLanguage,imageDataUrlsByLanguage:imageDataUrlsByLanguage};var id=el("propertyId3").value;await api(id?"/api/objects/"+encodeURIComponent(id):"/api/objects",{method:id?"PATCH":"POST",body:JSON.stringify(body)});clearDirty(el("propertyForm3"));el("propertyDialog3").close();await loadState();toast("Объект сохранён")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveOffer(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{var t=translations("offer",["title","text"]),imageDataUrlsByLanguage={ru:[],en:[],es:[]},removeImagesByLanguage={};for(var index=0;index<languages.length;index++){var language=languages[index],s=language[0].toUpperCase()+language.slice(1),file=offerNewImages[language];removeImagesByLanguage[language]=el("offerRemoveImage"+s+"3").checked||Boolean(file);if(file)imageDataUrlsByLanguage[language]=[{dataUrl:await fileData(file),name:file.name}]}var body={title:t.title,text:t.text,url:el("offerUrl3").value,startAt:el("offerStart3").value?new Date(el("offerStart3").value).toISOString():"",endAt:el("offerEnd3").value?new Date(el("offerEnd3").value).toISOString():"",enabled:el("offerEnabled3").checked,removeImagesByLanguage:removeImagesByLanguage,imageDataUrlsByLanguage:imageDataUrlsByLanguage};var id=el("offerId3").value;await api(id?"/api/promotions/"+encodeURIComponent(id):"/api/promotions",{method:id?"PATCH":"POST",body:JSON.stringify(body)});clearDirty(el("offerForm3"));el("offerDialog3").close();await loadState();toast("Акция сохранена")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveContacts(e){e.preventDefault();var button=e.submitter||el("saveContactsTop3");button.disabled=true;try{var text={};languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);text[l]=el("contactText"+s+"3").value});await api("/api/contacts",{method:"PUT",body:JSON.stringify({managerName:el("contactManagerName3").value,phone:el("contactPhone3").value,whatsapp:el("contactWhatsapp3").value,whatsappEnabled:el("contactWhatsappEnabled3").checked,telegram:el("contactTelegram3").value,email:el("contactEmail3").value,website:el("contactWebsite3").value,mapUrl:el("contactMap3").value,text:text})});clearDirty(el("contactsForm3"));await loadState();toast("Контакты менеджера сохранены")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveReply(e){e.preventDefault();var button=e.submitter,id=el("replyId3").value;button.disabled=true;try{var result=await api(id?"/api/rules/"+encodeURIComponent(id):"/api/rules",{method:id?"PATCH":"POST",body:JSON.stringify({trigger:el("replyTrigger3").value,type:el("replyType3").value,language:el("replyLanguage3").value,answer:el("replyAnswer3").value})});clearDirty(el("replyForm3"));el("replyDialog3").close();await loadState();toast(result.conflicts&&result.conflicts.length?"Сохранено. Найден похожий автоответ":"Автоответ сохранён")}catch(error){toast(error.message)}finally{button.disabled=false}}
    function collectCampaign(){return (async function(){var messages={},buttonText={};languages.forEach(function(l){var s=l[0].toUpperCase()+l.slice(1);messages[l]=el("campaignText"+s+"3").value;buttonText[l]=el("campaignButton"+s+"3").value});var file=el("campaignImage3").files[0],body={messages:messages,languages:Array.from(document.querySelectorAll(".campaign-language3:checked")).map(function(x){return x.value}),tags:el("campaignTags3").value.split(",").map(function(x){return x.trim()}).filter(Boolean),buttonText:buttonText,buttonUrl:el("campaignButtonUrl3").value,scheduledAt:el("campaignSchedule3").value?new Date(el("campaignSchedule3").value).toISOString():"",removeImage:el("campaignRemoveImage3").checked};if(file){body.imageDataUrl=await fileData(file);body.imageName=file.name}return body})()}
    async function submitCampaign(e){e.preventDefault();var button=e.submitter,mode=button.dataset.mode||"draft";button.disabled=true;try{var body=await collectCampaign();body.mode=mode;if(mode!=="draft"){var readiness=campaignReadiness();if(!readiness.valid)throw new Error("Заполните текст и кнопки для всех выбранных языков");if(!body.languages.length)throw new Error("Выберите хотя бы один язык аудитории")}if(mode==="test"){body.userId=el("campaignTestUser3").value;if(!body.userId)throw new Error("Выберите получателя тестового сообщения");await api("/api/broadcast/test",{method:"POST",body:JSON.stringify(body)});toast("Тестовое сообщение отправлено");return}var languagesText=body.languages.map(function(language){return language.toUpperCase()}).join(", "),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||"локальное время";if(mode==="send"&&!await confirmAction("Начать рассылку","Получатели: "+el("campaignEstimate3").textContent+". Языки: "+languagesText+". Отменить отправку после запуска нельзя.","Отправить"))return;if(mode==="schedule"&&!await confirmAction("Запланировать рассылку","Отправка: "+new Date(body.scheduledAt).toLocaleString("ru-RU")+" ("+timezone+"). Получатели: "+el("campaignEstimate3").textContent+". Языки: "+languagesText+".","Запланировать"))return;var id=el("campaignId3").value,url=id&&mode!=="send"?"/api/broadcasts/"+encodeURIComponent(id):"/api/broadcasts";await api(url,{method:id&&mode!=="send"?"PATCH":"POST",body:JSON.stringify(body)});if(id&&mode==="send")await api("/api/broadcasts/"+encodeURIComponent(id),{method:"DELETE",body:"{}"});clearDirty(el("campaignForm3"));resetCampaign();await loadState();toast(mode==="send"?"Рассылка началась":mode==="schedule"?"Рассылка запланирована":"Черновик сохранён")}catch(error){toast(error.message)}finally{button.disabled=false;updateCampaignSafety()}}
    async function saveUser(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{await api("/api/users/"+encodeURIComponent(selectedUser),{method:"PATCH",body:JSON.stringify({preferredLanguage:el("userLanguage3").value,tags:el("userTags3").value.split(",").map(function(x){return x.trim()}).filter(Boolean),note:el("userNote3").value})});clearDirty(el("userForm3"));await loadState();toast("Карточка пользователя сохранена")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function sendDirectMessage(e,userId){e.preventDefault();var form=e.currentTarget,button=e.submitter,file=el("directMessageImage3").files[0];button.disabled=true;try{var body={text:el("directMessageText3").value,buttonText:el("directMessageButtonText3").value,buttonUrl:el("directMessageButtonUrl3").value};if(file){body.imageDataUrl=await fileData(file);body.imageName=file.name}await api("/api/users/"+encodeURIComponent(userId)+"/message",{method:"POST",body:JSON.stringify(body)});clearDirty(form);form.reset();await loadState();toast("Личное сообщение отправлено")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveSettings(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{await api("/api/settings",{method:"PUT",body:JSON.stringify({messages:state.config.messages,active:el("settingActive3").checked,adminChatId:el("adminChatId3")?el("adminChatId3").value:state.config.adminChatId,token:el("settingToken3").value,password:el("settingPassword3").value,passwordConfirm:el("settingPasswordConfirm3").value})});el("settingToken3").value="";el("settingPassword3").value="";el("settingPasswordConfirm3").value="";clearDirty(el("technicalForm3"));await loadState();toast("Настройки сохранены")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveNotificationSettings(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{await api("/api/settings",{method:"PUT",body:JSON.stringify({messages:state.config.messages,active:state.config.active,adminChatId:el("adminChatId3").value,token:"",password:"",passwordConfirm:""})});clearDirty(el("notificationForm3"));await loadState();toast("Chat ID сохранён. Теперь отправьте тест") }catch(error){toast(error.message)}finally{button.disabled=false}}
    async function testAdminNotification(){var button=el("testAdminNotificationBtn3");if(dirty.has(el("notificationForm3")))return toast("Сначала сохраните Chat ID");button.disabled=true;try{await api("/api/admin-notification/test",{method:"POST",body:"{}"});await loadState();toast("Тестовое уведомление отправлено в Telegram")}catch(error){await loadState().catch(function(){});toast(error.message)}finally{button.disabled=false}}
    el("setupForm3").addEventListener("submit",async function(e){e.preventDefault();var b=e.submitter;b.disabled=true;try{var result=await api("/api/setup",{method:"POST",body:JSON.stringify({token:el("setupToken3").value,password:el("setupPassword3").value})});csrf=result.csrf;await loadState();showScreen("app3");startRefresh();toast("Бот подключён")}catch(error){message(el("setupMessage3"),error.message,false)}finally{b.disabled=false}});
    el("loginForm3").addEventListener("submit",async function(e){e.preventDefault();var b=e.submitter;b.disabled=true;try{var result=await api("/api/login",{method:"POST",body:JSON.stringify({password:el("loginPassword3").value})});csrf=result.csrf;el("loginPassword3").value="";await loadState();showScreen("app3");startRefresh()}catch(error){message(el("loginMessage3"),error.message,false)}finally{b.disabled=false}});
    el("loginPasswordToggle3").addEventListener("click",function(){setLoginPasswordVisible(el("loginPassword3").type==="password")});
    el("logoutBtn3").addEventListener("click",async function(){if(!canLeave())return;try{await api("/api/logout",{method:"POST",body:"{}"})}catch(e){}csrf="";state=null;clearInterval(refreshTimer);showScreen("loginScreen3")});el("refreshBtn3").addEventListener("click",function(){if(dirty.size)return toast("Сначала сохраните или отмените изменения");loadState().then(function(){toast("Данные обновлены")})});
    el("nav3").addEventListener("click",function(e){var button=e.target.closest("[data-view]");if(button)openView(button.dataset.view)});document.querySelectorAll("#nav3 details").forEach(function(group){group.addEventListener("toggle",function(){if(!group.open)return;document.querySelectorAll("#nav3 details[open]").forEach(function(other){if(other!==group)other.removeAttribute("open")})})});el("mobileMenuBtn3").addEventListener("click",function(){var open=el("sidebar3").classList.toggle("open");el("sidebarOverlay3").classList.toggle("hidden",!open);this.setAttribute("aria-expanded",open?"true":"false")});el("sidebarOverlay3").addEventListener("click",closeSidebar);document.addEventListener("click",function(e){if(!e.target.closest("#sidebar3")&&(el("sidebar3").classList.contains("open")||document.querySelector("#nav3 details[open]")))closeSidebar()});bindQuick(document);
    bindLanguageSwitch(el("welcomeLang3"),"welcome");bindLanguageSwitch(el("interfaceLang3"),"interface");bindLanguageSwitch(el("propertyLang3"),"property");bindLanguageSwitch(el("offerLang3"),"offer");bindLanguageSwitch(el("campaignLang3"),"campaign");
    document.addEventListener("input",function(e){var form=e.target.closest("form[data-saveable]");if(form)markDirty(form);if(e.target.closest("#propertyForm3"))renderPropertyTranslationSummary();if(e.target.closest("#contactsForm3"))updateContactsPreview();if(e.target.closest("#campaignForm3")){updateCampaignPreview();updateCampaignEstimate()}if(e.target.classList.contains("welcome-live3")){var l=e.target.dataset.lang,s=l[0].toUpperCase()+l.slice(1);el("welcomeTextPreview"+s+"3").textContent=e.target.value.replaceAll("{first_name}","Анна").replaceAll("{last_name}","").replaceAll("{username}","@anna")}});
    document.addEventListener("change",function(e){var form=e.target.closest("form[data-saveable]");if(form)markDirty(form);if(e.target.closest("#propertyForm3"))renderPropertyTranslationSummary();if(e.target.closest("#contactsForm3"))updateContactsPreview();if(e.target.closest("#campaignForm3")){updateCampaignPreview();updateCampaignEstimate()}});
    document.querySelectorAll("[data-close]").forEach(function(button){button.addEventListener("click",function(){var form=button.closest("dialog").querySelector("form");if(dirty.has(form)&&!confirm("Закрыть без сохранения изменений?"))return;clearDirty(form);el(button.dataset.close).close()})});
    document.querySelectorAll("dialog").forEach(function(dialog){dialog.addEventListener("cancel",function(e){var form=dialog.querySelector("form");if(form&&dirty.has(form)){if(!confirm("Закрыть без сохранения изменений?")){e.preventDefault();return}clearDirty(form)}})});
    el("saveWelcomeTop3").addEventListener("click",function(){el("welcomeForm3").requestSubmit()});el("saveInterfaceTop3").addEventListener("click",function(){el("interfaceForm3").requestSubmit()});el("saveContactsTop3").addEventListener("click",function(){el("contactsForm3").requestSubmit()});el("welcomeForm3").addEventListener("submit",saveWelcome);el("interfaceForm3").addEventListener("submit",saveInterfaceText);el("propertySectionForm3").addEventListener("submit",function(e){saveMenuSection(e,"objects","Objects","Текст раздела «Объекты»")});el("offerSectionForm3").addEventListener("submit",function(e){saveMenuSection(e,"promotions","Promotions","Текст раздела «Акции»")});el("aboutForm3").addEventListener("submit",function(e){saveMenuSection(e,"about","About","Раздел «О нас»")});el("propertyForm3").addEventListener("submit",saveProperty);el("offerForm3").addEventListener("submit",saveOffer);el("contactsForm3").addEventListener("submit",saveContacts);el("replyForm3").addEventListener("submit",saveReply);el("campaignForm3").addEventListener("submit",submitCampaign);el("technicalForm3").addEventListener("submit",saveSettings);
    el("newPropertyBtn3").addEventListener("click",function(){resetProperty();el("propertyDialog3").showModal()});el("propertySearch3").addEventListener("input",renderProperties);el("propertyStatusFilter3").addEventListener("change",renderProperties);el("propertyGrid3").addEventListener("click",async function(e){var edit=e.target.closest(".edit-property3"),del=e.target.closest(".delete-property3");if(edit){editProperty(edit.dataset.id);renderPropertyTranslationSummary();return}if(del&&await confirmAction("Удалить объект","Карточка и её фотографии будут удалены из каталога. Это действие нельзя отменить.","Удалить"))try{await api("/api/objects/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Объект удалён")}catch(error){toast(error.message)}});
    el("newOfferBtn3").addEventListener("click",function(){resetOffer();el("offerDialog3").showModal()});el("offerSearch3").addEventListener("input",renderOffers);el("offerStatusFilter3").addEventListener("change",renderOffers);el("offerGrid3").addEventListener("click",async function(e){var edit=e.target.closest(".edit-offer3"),del=e.target.closest(".delete-offer3");if(edit)return editOffer(edit.dataset.id);if(del&&await confirmAction("Удалить акцию","Предложение больше не будет доступно пользователям.","Удалить"))try{await api("/api/promotions/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Акция удалена")}catch(error){toast(error.message)}});
    el("newReplyBtn3").addEventListener("click",function(){resetReply();el("replyDialog3").showModal()});el("replySearch3").addEventListener("input",renderReplies);el("replyLanguageFilter3").addEventListener("change",renderReplies);el("replyList3").addEventListener("change",async function(e){if(!e.target.classList.contains("reply-toggle3"))return;try{await api("/api/rules/"+encodeURIComponent(e.target.dataset.id),{method:"PATCH",body:JSON.stringify({enabled:e.target.checked})});await loadState(true)}catch(error){toast(error.message);await loadState(true)}});
    el("replyList3").addEventListener("click",async function(e){var edit=e.target.closest(".edit-reply3"),copy=e.target.closest(".copy-reply3"),del=e.target.closest(".delete-reply3"),move=e.target.closest(".move-reply3");if(edit)return editReply(edit.dataset.id,false);if(copy)return editReply(copy.dataset.id,true);if(del&&await confirmAction("Удалить автоответ","После удаления бот перестанет использовать это правило.","Удалить")){try{await api("/api/rules/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Автоответ удалён")}catch(error){toast(error.message)}return}if(move){var ordered=state.rules.slice().sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}),index=ordered.findIndex(function(x){return x.id===move.dataset.id}),next=index+Number(move.dataset.step);if(next<0||next>=ordered.length)return;var tmp=ordered[index];ordered[index]=ordered[next];ordered[next]=tmp;try{await api("/api/rules/reorder",{method:"POST",body:JSON.stringify({ids:ordered.map(function(x){return x.id})})});await loadState();toast("Порядок изменён")}catch(error){toast(error.message)}}});
    el("replyTestForm3").addEventListener("submit",async function(e){e.preventDefault();try{var result=await api("/api/rules/test",{method:"POST",body:JSON.stringify({text:el("replyTestText3").value,language:el("replyTestLanguage3").value})});message(el("replyTestResult3"),result.matched?"Сработает «"+result.matched.trigger+"»: "+result.matched.answer:"Ни один автоответ не сработает",Boolean(result.matched))}catch(error){message(el("replyTestResult3"),error.message,false)}});
    el("campaignPreviewLanguage3").addEventListener("change",updateCampaignPreview);el("campaignHistory3").addEventListener("click",async function(e){var edit=e.target.closest(".edit-campaign3"),copy=e.target.closest(".copy-campaign3"),del=e.target.closest(".delete-campaign3");if(edit)return editCampaign(edit.dataset.id,false);if(copy)return editCampaign(copy.dataset.id,true);if(del&&await confirmAction("Удалить рассылку","Черновик или запись о рассылке будет удалена.","Удалить"))try{await api("/api/broadcasts/"+encodeURIComponent(del.dataset.id),{method:"DELETE",body:"{}"});await loadState();toast("Рассылка удалена")}catch(error){toast(error.message)}});
    el("inquirySearch3").addEventListener("input",renderInquiries);el("inquiryStatusFilter3").addEventListener("change",renderInquiries);el("inquiryTypeFilter3").addEventListener("change",renderInquiries);el("inquiryList3").addEventListener("click",function(e){var card=e.target.closest("[data-inquiry]");if(!card)return;var stateForm=el("inquiryStateForm3"),replyForm=el("inquiryReplyForm3");if(card.dataset.inquiry!==selectedInquiry&&((stateForm&&dirty.has(stateForm))||(replyForm&&dirty.has(replyForm)))&&!confirm("Отменить несохранённые изменения в обращении?"))return;if(stateForm)clearDirty(stateForm);if(replyForm)clearDirty(replyForm);selectedInquiry=card.dataset.inquiry;renderInquiries()});
    el("userSearch3").addEventListener("input",renderAudience);el("userLanguageFilter3").addEventListener("change",renderAudience);el("userGrid3").addEventListener("click",function(e){var card=e.target.closest("[data-user]");if(!card)return;var form=el("userForm3"),direct=el("directMessageForm3"),hasChanges=(form&&dirty.has(form))||(direct&&dirty.has(direct));if(hasChanges&&card.dataset.user!==selectedUser&&!confirm("Отменить изменения в карточке пользователя?"))return;if(form)clearDirty(form);if(direct)clearDirty(direct);selectedUser=card.dataset.user;renderAudience()});
    el("tokenTestBtn3").addEventListener("click",async function(){var b=this;b.disabled=true;try{var result=await api("/api/token-test",{method:"POST",body:JSON.stringify({token:el("settingToken3").value})});toast("Токен работает: "+(result.username?"@"+result.username:result.firstName))}catch(error){toast(error.message)}finally{b.disabled=false}});
    el("clearErrorsBtn3").addEventListener("click",async function(){if(!await confirmAction("Очистить журнал","История прошлых ошибок будет удалена. Текущее состояние подключения сохранится.","Очистить"))return;try{await api("/api/errors",{method:"DELETE",body:"{}"});await loadState();toast("Журнал очищен")}catch(error){toast(error.message)}});
    el("resetStatisticsBtn3").addEventListener("click",async function(){if(!await confirmAction("Обнулить статистику","Будут сброшены сообщения, график и показатели объектов. Пользователи и обращения сохранятся.","Обнулить"))return;var button=this;button.disabled=true;try{await api("/api/statistics/reset",{method:"POST",body:"{}"});await loadState();toast("Статистика обнулена")}catch(error){toast(error.message)}finally{button.disabled=false}});
    el("clearActivityBtn3").addEventListener("click",async function(){if(!await confirmAction("Очистить историю активности","История сообщений и даты посещений будут удалены. Пользователи, языки, теги, заметки и обращения сохранятся.","Очистить"))return;var button=this;button.disabled=true;try{await api("/api/activity",{method:"DELETE",body:"{}"});await loadState();toast("История активности очищена")}catch(error){toast(error.message)}finally{button.disabled=false}});
    el("restoreFile3").addEventListener("change",async function(){var file=this.files[0];if(!file)return;if(!await confirmAction("Восстановить резервную копию","Текущие настройки, контент и данные будут заменены содержимым файла.","Восстановить")){this.value="";return}try{var response=await fetch("/api/restore",{method:"POST",headers:{"content-type":file.name.toLowerCase().endsWith(".gz")?"application/gzip":"application/json","x-csrf-token":csrf},body:await file.arrayBuffer()}),result={};try{result=await response.json()}catch(e){}if(!response.ok)throw new Error(result.error||"Не удалось восстановить резервную копию");csrf=result.csrf||csrf;clearAllDirty();await loadState();toast("Резервная копия восстановлена")}catch(error){toast(error.message)}finally{this.value=""}});
    el("discardBtn3").addEventListener("click",async function(){if(!await confirmAction("Отменить изменения","Все несохранённые изменения на странице будут потеряны.","Отменить изменения"))return;discardChanges();loadState()});
    el("propertyPanes3").addEventListener("change",function(e){var input=e.target.closest(".property-image3, .property-remove-images3");if(!input)return;var language=input.dataset.lang;if(input.classList.contains("property-image3")){var files=Array.from(input.files||[]),current=propertyOrderedEntries(language);if(current.length+files.length>10){toast("Для "+language.toUpperCase()+" можно загрузить не более 10 фотографий");input.value="";return}var additions=files.map(function(file,index){return{id:"new-"+Date.now()+"-"+index+"-"+Math.random().toString(36).slice(2,8),file:file}});propertyNewImages[language]=(propertyNewImages[language]||[]).concat(additions);propertyImageOrder[language]=current.map(function(entry){return entry.token}).concat(additions.map(function(item){return item.id}));input.value=""}markDirty(el("propertyForm3"));renderPropertyGallery(language)});el("propertyPanes3").addEventListener("click",function(e){var remove=e.target.closest(".gallery-remove3"),move=e.target.closest(".gallery-move3"),control=remove||move;if(!control)return;var language=control.dataset.lang,token=control.dataset.token,ordered=propertyOrderedEntries(language).map(function(entry){return entry.token});if(remove){if(remove.dataset.kind==="new")propertyNewImages[language]=(propertyNewImages[language]||[]).filter(function(item){return item.id!==token});else if(!(propertyRemovedImages[language]||[]).includes(token))propertyRemovedImages[language].push(token);propertyImageOrder[language]=ordered.filter(function(item){return item!==token});markDirty(el("propertyForm3"));renderPropertyGallery(language);return}var index=ordered.indexOf(token),next=index+Number(move.dataset.step);if(index<0||next<0||next>=ordered.length)return;var temp=ordered[index];ordered[index]=ordered[next];ordered[next]=temp;propertyImageOrder[language]=ordered;markDirty(el("propertyForm3"));renderPropertyGallery(language)});el("offerPanes3").addEventListener("change",function(e){var input=e.target.closest(".offer-image3, .offer-remove-image3");if(!input)return;var language=input.dataset.lang;if(input.classList.contains("offer-image3")){if(offerPreviewUrls[language])URL.revokeObjectURL(offerPreviewUrls[language]);offerPreviewUrls[language]="";offerNewImages[language]=input.files[0]||null;if(offerNewImages[language]){var s=language[0].toUpperCase()+language.slice(1);el("offerRemoveImage"+s+"3").checked=false}}markDirty(el("offerForm3"));renderOfferGallery(language)});
    function prepareDashboardLayout(){var home=el("view-home"),metrics=home&&home.querySelector(".metric-grid"),hero=home&&home.querySelector(".home-hero");if(home&&metrics&&hero){home.insertBefore(metrics,hero);if(!home.querySelector(".dashboard-priority-note")){var note=document.createElement("div");note.className="dashboard-priority-note";note.textContent="Сначала — показатели и задачи, требующие вашего внимания";home.insertBefore(note,metrics)}}}
    function prepareAccessibility(){var labels={propertySearch3:"Поиск объектов",offerSearch3:"Поиск акций",inquirySearch3:"Поиск обращений",replySearch3:"Поиск автоответов",userSearch3:"Поиск пользователей",campaignPreviewLanguage3:"Язык предпросмотра рассылки"};Object.keys(labels).forEach(function(id){if(el(id))el(id).setAttribute("aria-label",labels[id])});document.querySelectorAll("#nav3 .nav-item").forEach(function(button){button.setAttribute("type","button");button.setAttribute("aria-label",button.textContent.trim().replace(/\s+/g," "))});document.querySelectorAll("#nav3 .nav-dropdown").forEach(function(menu){menu.setAttribute("role","menu");menu.querySelectorAll(".nav-item").forEach(function(button){button.setAttribute("role","menuitem")})});document.querySelectorAll("#nav3 .nav-group-toggle").forEach(function(summary){summary.setAttribute("aria-label",summary.textContent.trim().replace(/\s+/g," "))})}
    document.addEventListener("keydown",function(event){if(event.key!=="Escape")return;var openMenus=document.querySelectorAll("#nav3 details[open]");if(openMenus.length||el("sidebar3").classList.contains("open")){openMenus.forEach(function(group){group.removeAttribute("open")});closeSidebar();event.preventDefault()}});
    window.addEventListener("beforeunload",function(e){if(!dirty.size)return;e.preventDefault();e.returnValue=""});prepareDashboardLayout();buildWelcome();buildDrawers();buildCampaign();prepareAccessibility();boot();
  })();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname === '/login-assets/background.png' && req.method === 'GET') return binaryLoginAsset(req, res, LOGIN_ASSETS.background);
    if (url.pathname === '/login-assets/logo.png' && req.method === 'GET') return binaryLoginAsset(req, res, LOGIN_ASSETS.logo);
    if (url.pathname === '/admin-assets/header.webp' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.header);
    if (url.pathname === '/admin-assets/header-mobile.webp' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.headerMobile);
    if (url.pathname === '/admin-assets/sidebar-logo.png' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.sidebarLogo);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/' && req.method === 'GET') return html(res, ADMIN_HTML_V3);
    securityHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  } catch (error) {
    console.error('Ошибка веб-панели:', error.message);
    if (!res.headersSent) json(res, 500, { error: 'Внутренняя ошибка' });
    else res.end();
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('Порт ' + PORT + ' уже занят. Запустите с другим портом: PORT=3001 node bot.js');
  } else {
    console.error('Не удалось запустить веб-панель:', error.message);
  }
  process.exit(1);
});

const broadcastScheduleTimer = setInterval(() => {
  void runDueBroadcasts();
}, 30000);
broadcastScheduleTimer.unref();

server.listen(PORT, HOST, () => {
  const visibleHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  const adminUrl = 'http://' + visibleHost + ':' + PORT;
  console.log('');
  console.log('  Пульт Telegram-бота запущен');
  console.log('  Откройте: ' + adminUrl);
  console.log(!configured()
    ? '  Требуется первичная настройка в браузере.'
    : data.config.active
      ? '  Бот подключается к Telegram…'
      : '  Бот остановлен в настройках панели.');
  console.log('  Для остановки нажмите Ctrl+C.');
  console.log('');
  restartPolling();
  if (process.platform === 'win32' && process.env.NO_AUTO_OPEN !== '1') {
    setTimeout(() => {
      try {
        const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', adminUrl], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        opener.unref();
      } catch {
        // The URL remains visible in the console if automatic opening is unavailable.
      }
    }, 500).unref();
  }
});

function shutdown() {
  console.log('\nЗавершение работы…');
  runtime.generation += 1;
  if (runtime.abortController) runtime.abortController.abort();
  clearTimeout(saveTimer);
  try { saveDataNow(); } catch (error) { console.error('Не удалось сохранить данные:', error.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => console.error('Необработанная ошибка:', error));
process.on('unhandledRejection', (error) => console.error('Необработанная ошибка:', error));
