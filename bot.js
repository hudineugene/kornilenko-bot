#!/usr/bin/env node
'use strict';

/**
 * Telegram bot + web admin panel in one file.
 * Requirements: Node.js 20.3+ (no npm packages are needed).
 * Start: node bot.js    Tests: npm test    Build bot.exe: npm run build
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
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
// Extra host names the panel may be opened by (comma-separated), for example
// when ADMIN_HOST=0.0.0.0 and the computer is reached by its network name.
const ADMIN_ALLOWED_HOSTS = new Set(String(process.env.ADMIN_ALLOWED_HOSTS || '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean));

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

const DATA_VERSION = 14;

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
    notifyMode: 'all',
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
  adminReplyTargets: {},
  adminReplyTargetsSince: '',
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

// Files are named by the SHA-256 of their bytes, so the same photo uploaded
// for several languages (or several records) is stored on disk only once.
function contentAddressedName(bytes, mimeType) {
  return crypto.createHash('sha256').update(bytes).digest('hex') + '.' + (mimeType === 'image/png' ? 'png' : 'jpg');
}

function writeMediaFile(fileName, bytes) {
  const target = path.join(MEDIA_DIRECTORY, fileName);
  if (fs.existsSync(target)) return;
  const temporary = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.mkdirSync(MEDIA_DIRECTORY, { recursive: true });
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function persistImage(image) {
  if (!image || typeof image !== 'object' || typeof image.dataBase64 !== 'string' || !image.dataBase64.length) return;
  const bytes = Buffer.from(image.dataBase64, 'base64');
  const safeId = String(image.id || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID();
  const fileName = contentAddressedName(bytes, image.mimeType);
  writeMediaFile(fileName, bytes);
  image.id = safeId;
  image.storageFile = fileName;
  image.size = bytes.length;
  delete image.dataBase64;
}

const CONTENT_ADDRESSED_FILE = /^[0-9a-f]{64}\.(?:jpg|png)$/;

function needsContentAddressing(root) {
  let found = false;
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName && !CONTENT_ADDRESSED_FILE.test(fileName)) found = true;
  });
  return found;
}

// Moves images saved by older versions (one file per upload) to
// content-addressed names. Duplicates collapse into one file; the old files
// become unreferenced and are removed by cleanupOrphanImages.
function contentAddressImages(root) {
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (!fileName || CONTENT_ADDRESSED_FILE.test(fileName)) return;
    const source = path.join(MEDIA_DIRECTORY, fileName);
    if (!fs.existsSync(source)) return;
    const bytes = fs.readFileSync(source);
    const nextName = contentAddressedName(bytes, image.mimeType);
    writeMediaFile(nextName, bytes);
    image.storageFile = nextName;
  });
}

function externalizeImages(root) {
  forEachStoredImage(root, persistImage);
}

function referencedImageFiles(root) {
  const referenced = new Set();
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName) referenced.add(fileName.toLocaleLowerCase('en-US'));
  });
  return referenced;
}

function cleanupOrphanImages(root, referenced = referencedImageFiles(root)) {
  if (!fs.existsSync(MEDIA_DIRECTORY)) return;
  for (const entry of fs.readdirSync(MEDIA_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.(?:jpg|png)$/i.test(entry.name)) continue;
    if (!referenced.has(entry.name.toLocaleLowerCase('en-US'))) fs.unlinkSync(path.join(MEDIA_DIRECTORY, entry.name));
  }
}

function ensureMigrationBackup(prefix = 'pre-media-migration') {
  if (!fs.existsSync(DATA_FILE)) return '';
  const backupDirectory = path.join(path.dirname(DATA_FILE), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const existing = fs.readdirSync(backupDirectory).find((name) => name.startsWith(prefix + '-') && name.endsWith('.json'));
  if (existing) return path.join(backupDirectory, existing);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const target = path.join(backupDirectory, prefix + '-' + stamp + '.json');
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
    if (!/^\d{1,20}$/.test(messageId) || !target || typeof target !== 'object') continue;
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
    const legacyFormat = !(Number(parsed.version) >= DATA_VERSION);
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
    normalized.config.notifyMode = ['all', 'inquiries'].includes(normalized.config.notifyMode) ? normalized.config.notifyMode : 'all';
    pruneOrphanPropertyAnalytics(normalized);
    return normalized;
}

const DATA_BACKUP_FILE = DATA_FILE + '.bak';
const DATA_BACKUP_INTERVAL_MS = 60 * 60 * 1000;

function fileStamp(value = new Date()) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function readDataFile(filePath) {
  return normalizeLoadedData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

const BACKUP_DIRECTORY = path.join(path.dirname(DATA_FILE), 'backups');
const DAILY_BACKUP_DIRECTORY = path.join(BACKUP_DIRECTORY, 'daily');
const MEDIA_BACKUP_DIRECTORY = path.join(BACKUP_DIRECTORY, 'media');
const DAILY_BACKUPS_KEPT = 14;

function jsonFilesIn(directory) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

// The hourly .bak copy first, then the snapshots in backups/ and
// backups/daily/, newest first.
function recoveryCandidates() {
  const snapshots = jsonFilesIn(BACKUP_DIRECTORY).concat(jsonFilesIn(DAILY_BACKUP_DIRECTORY))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return [DATA_BACKUP_FILE, ...snapshots].filter((candidate) => fs.existsSync(candidate));
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return clone(defaultData);
  try {
    return readDataFile(DATA_FILE);
  } catch (error) {
    console.error('Не удалось прочитать файл данных:', error.message);
  }
  for (const candidate of recoveryCandidates()) {
    let recovered;
    try {
      recovered = readDataFile(candidate);
    } catch {
      continue;
    }
    const corruptCopy = DATA_FILE + '.corrupt-' + fileStamp();
    fs.copyFileSync(DATA_FILE, corruptCopy);
    console.error('Данные восстановлены из копии:', candidate);
    console.error('Повреждённый файл сохранён как:', corruptCopy);
    recovered.errors.unshift({
      id: crypto.randomUUID(),
      area: 'Загрузка данных',
      message: 'Файл данных был повреждён. Данные восстановлены из копии ' + path.basename(candidate) + ', последние изменения могли потеряться. Повреждённый файл: ' + path.basename(corruptCopy),
      createdAt: new Date().toISOString(),
    });
    return recovered;
  }
  console.error('Подходящая резервная копия не найдена. Исправьте или удалите файл:', DATA_FILE);
  process.exit(1);
}

let data = loadData();
let saveTimer = null;
let lastReferencedImages = null;
let lastDataBackupAt = 0;

// Keeps a known-good copy of the data file that loadData can fall back to.
function rotateDataBackup() {
  if (Date.now() - lastDataBackupAt < DATA_BACKUP_INTERVAL_MS || !fs.existsSync(DATA_FILE)) return;
  try {
    JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return;
  }
  fs.copyFileSync(DATA_FILE, DATA_BACKUP_FILE);
  lastDataBackupAt = Date.now();
}

function saveDataNow() {
  const directory = path.dirname(DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  if (containsEmbeddedImages(data)) {
    ensureMigrationBackup();
    externalizeImages(data);
  }
  if (needsContentAddressing(data)) contentAddressImages(data);
  rotateDataBackup();
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
  // Scanning the media folder is only needed when the set of referenced files changed.
  const referenced = referencedImageFiles(data);
  const signature = Array.from(referenced).sort().join('|');
  if (signature !== lastReferencedImages) {
    cleanupOrphanImages(data, referenced);
    lastReferencedImages = signature;
  }
}

// Throttled rather than debounced: a steady stream of updates must not
// postpone the write indefinitely.
function scheduleSave() {
  if (saveTimer) return;
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

if (needsContentAddressing(data)) {
  try {
    ensureMigrationBackup('pre-media-dedupe');
    saveDataNow();
    console.log('Одинаковые фотографии объединены в хранилище:', MEDIA_DIRECTORY);
  } catch (error) {
    console.error('Не удалось объединить одинаковые фотографии:', error.message);
  }
}

function storedImageNames(root) {
  const names = new Set();
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName) names.add(fileName);
  });
  return names;
}

// Brings back photos that are referenced by the data but missing from
// bot-media, using the copies made by the daily backup.
function restoreMissingMedia(root) {
  let restored = 0;
  for (const fileName of storedImageNames(root)) {
    const target = path.join(MEDIA_DIRECTORY, fileName);
    const copy = path.join(MEDIA_BACKUP_DIRECTORY, fileName);
    if (fs.existsSync(target) || !fs.existsSync(copy)) continue;
    fs.mkdirSync(MEDIA_DIRECTORY, { recursive: true });
    fs.copyFileSync(copy, target);
    restored += 1;
  }
  return restored;
}

// Once a day: a copy of bot-data.json in backups/daily/ and a copy of every
// photo it references in backups/media/. Photo files are named by their
// content, so each one is copied only once no matter how many snapshots use
// it. Only the newest DAILY_BACKUPS_KEPT snapshots are kept, and photos that
// none of them references any more are removed.
function runDailyBackup(now = new Date()) {
  const target = path.join(DAILY_BACKUP_DIRECTORY, 'bot-data-' + dayKey(now) + '.json');
  if (fs.existsSync(target)) return '';
  saveDataNow();
  fs.mkdirSync(DAILY_BACKUP_DIRECTORY, { recursive: true });
  fs.mkdirSync(MEDIA_BACKUP_DIRECTORY, { recursive: true });
  for (const fileName of storedImageNames(data)) {
    const source = path.join(MEDIA_DIRECTORY, fileName);
    const copy = path.join(MEDIA_BACKUP_DIRECTORY, fileName);
    if (!fs.existsSync(copy) && fs.existsSync(source)) fs.copyFileSync(source, copy);
  }
  const temporary = target + '.tmp';
  fs.copyFileSync(DATA_FILE, temporary);
  fs.renameSync(temporary, target);

  const snapshots = jsonFilesIn(DAILY_BACKUP_DIRECTORY).sort().reverse();
  for (const old of snapshots.slice(DAILY_BACKUPS_KEPT)) fs.unlinkSync(old);
  const needed = storedImageNames(data);
  for (const snapshot of snapshots.slice(0, DAILY_BACKUPS_KEPT)) {
    try {
      for (const fileName of storedImageNames(JSON.parse(fs.readFileSync(snapshot, 'utf8')))) needed.add(fileName);
    } catch {
      // A damaged snapshot must not cause photos to be deleted: keep everything.
      return target;
    }
  }
  for (const fileName of fs.readdirSync(MEDIA_BACKUP_DIRECTORY)) {
    if (!needed.has(fileName)) fs.unlinkSync(path.join(MEDIA_BACKUP_DIRECTORY, fileName));
  }
  return target;
}

function runDailyBackupSafely() {
  try {
    const created = runDailyBackup();
    if (created) console.log('Создана ежедневная резервная копия:', created);
  } catch (error) {
    recordError('Ежедневная резервная копия', error);
    console.error('Не удалось создать ежедневную резервную копию:', error.message);
  }
}

try {
  const restoredMedia = restoreMissingMedia(data);
  if (restoredMedia) console.log('Восстановлено фотографий из резервной копии:', restoredMedia);
} catch (error) {
  console.error('Не удалось восстановить фотографии из резервной копии:', error.message);
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

// data.users is a plain object, so ids such as "__proto__" must not reach it
// directly: that would return Object.prototype and let a PATCH pollute it.
function userById(id) {
  const key = String(id);
  return Object.hasOwn(data.users, key) ? data.users[key] : undefined;
}

// userByChatId runs for every outgoing message, so it uses an index instead
// of scanning all users. normalizeUser keeps the index current.
const usersByChatId = new Map();

function indexUser(user) {
  if (user && user.chatId != null && user.chatId !== '') usersByChatId.set(String(user.chatId), user);
}

function rebuildUserIndex() {
  usersByChatId.clear();
  for (const user of Object.values(data.users)) indexUser(user);
}

function userByChatId(chatId) {
  const key = String(chatId);
  const indexed = usersByChatId.get(key);
  if (indexed && userById(indexed.id) === indexed && String(indexed.chatId) === key) return indexed;
  const found = Object.values(data.users).find((user) => String(user.chatId) === key);
  if (found) indexUser(found);
  return found;
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
  if (error && error.name === 'TimeoutError') return 'Telegram не ответил вовремя. Бот повторит подключение автоматически.';
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

const TELEGRAM_REQUEST_TIMEOUT_MS = 30 * 1000;
const TELEGRAM_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const TELEGRAM_RATE_LIMIT_RETRIES = 3;
const TELEGRAM_MAX_RETRY_AFTER_SECONDS = 60;

// Every call gets its own timeout, so one hung request cannot stall the bot.
// A 429 answer is retried after the pause Telegram asks for (retry_after).
async function telegramCall(token, method, init, { signal, timeoutMs }) {
  for (let attempt = 0; ; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        ...init(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
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
    if (response.ok && body && body.ok) return body.result;
    const rateLimited = response.status === 429 || (body && body.error_code === 429);
    const retryAfter = Number(body && body.parameters && body.parameters.retry_after);
    if (rateLimited && attempt < TELEGRAM_RATE_LIMIT_RETRIES && retryAfter > 0 && retryAfter <= TELEGRAM_MAX_RETRY_AFTER_SECONDS) {
      await delay(retryAfter * 1000 + 250);
      if (signal && signal.aborted) throw signal.reason;
      continue;
    }
    throw normalizeTelegramError(
      new Error((body && body.description) || 'Telegram API error'),
      response.status,
      body && body.error_code
    );
  }
}

async function telegramRequest(token, method, payload, signal) {
  // Long polling holds the request open for payload.timeout seconds.
  const timeoutMs = TELEGRAM_REQUEST_TIMEOUT_MS + (Number(payload && payload.timeout) || 0) * 1000;
  return telegramCall(token, method, () => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }), { signal, timeoutMs });
}

async function telegramMultipartRequest(token, method, fields) {
  return telegramCall(token, method, () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value == null || value === '') continue;
      form.append(key, typeof value === 'string' || value instanceof Blob ? value : JSON.stringify(value));
    }
    return { body: form };
  }, { timeoutMs: TELEGRAM_UPLOAD_TIMEOUT_MS });
}

// Telegram file_id values are bound to the bot token. Images that share a
// stored file (the same photo in several languages) share one upload.
const telegramFileIds = new Map();

function knownFileId(image) {
  return image.telegramFileId || telegramFileIds.get(storedImageFile(image)) || '';
}

function rememberFileId(image, fileId) {
  image.telegramFileId = fileId || '';
  const fileName = storedImageFile(image);
  if (!fileName) return;
  if (fileId) telegramFileIds.set(fileName, fileId);
  else telegramFileIds.delete(fileName);
}

function forgetTelegramFileIds(root) {
  telegramFileIds.clear();
  forEachStoredImage(root, (image) => {
    if (image) image.telegramFileId = '';
  });
}

async function sendPhotoMessage(chatId, image, caption, token, replyMarkup) {
  let result;
  const fileId = knownFileId(image);
  if (fileId) {
    try {
      result = await telegramRequest(token, 'sendPhoto', {
        chat_id: chatId,
        photo: fileId,
        caption: caption || undefined,
        reply_markup: replyMarkup,
      });
    } catch {
      rememberFileId(image, '');
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
      rememberFileId(image, result.photo[result.photo.length - 1].file_id);
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
  if (album.every((image) => knownFileId(image))) {
    try {
      result = await telegramRequest(token, 'sendMediaGroup', {
        chat_id: chatId,
        media: album.map((image, index) => ({
          type: 'photo',
          media: knownFileId(image),
          ...(index === 0 && firstCaption ? { caption: firstCaption } : {}),
        })),
      });
    } catch {
      for (const image of album) rememberFileId(image, '');
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
          rememberFileId(album[index], message.photo[message.photo.length - 1].file_id);
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
  const { track = true, messageIds = null, ...telegramOptions } = options || {};
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
    if (messageIds && result && Number.isFinite(Number(result.message_id))) messageIds.push(Number(result.message_id));
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

function preferredTimeWithDate(value, language, answeredAt) {
  const text = cleanText(value, 160);
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const optionIndex = copy.timeOptions.indexOf(text);
  if (optionIndex !== 0 && optionIndex !== 1) return text;
  const date = new Date(answeredAt || Date.now());
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
  // "Today" / "tomorrow" are resolved at the moment of the answer: the form
  // may have been opened the day before.
  const preferredTime = preferredTimeWithDate(text, language, Date.now());
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
  const previous = userById(id) || {};
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
  indexUser(user);
  return user;
}

const MAX_INQUIRIES = 5000;
const INQUIRY_MERGE_WINDOW_MS = 10 * 60 * 1000;
const INQUIRY_RATE_LIMIT = { count: 20, windowMs: 60 * 60 * 1000 };
const ADMIN_NOTIFY_LIMIT = { count: 15, windowMs: 10 * 60 * 1000 };
const MERGEABLE_INQUIRY_TYPES = ['general', 'question'];
const inquiryTimes = new Map();
const adminNotifyTimes = new Map();
const adminMuteNotices = new Map();

// Sliding-window counter per key; returns false once the limit is reached.
function withinRateLimit(store, key, limit, now = Date.now()) {
  const times = (store.get(key) || []).filter((time) => now - time < limit.windowMs);
  const allowed = times.length < limit.count;
  if (allowed) times.push(now);
  store.set(key, times);
  return allowed;
}

// Closed inquiries are dropped first, so a flood of new messages cannot push
// out open requests from other clients.
function trimInquiries() {
  let excess = data.inquiries.length - MAX_INQUIRIES;
  if (excess <= 0) return;
  const kept = [];
  for (let index = data.inquiries.length - 1; index >= 0; index -= 1) {
    const item = data.inquiries[index];
    if (excess > 0 && item.status === 'closed') {
      excess -= 1;
      continue;
    }
    kept.push(item);
  }
  kept.reverse();
  if (excess > 0) kept.length -= excess;
  data.inquiries = kept;
}

// Messages sent in a row go into the client's latest open inquiry instead of
// creating a new card each time. Past the rate limit every further message is
// merged, so one person cannot flood the inquiry list.
function mergeIntoLatestInquiry(user, text, type, context) {
  const latest = data.inquiries.find((item) => item.userId === String(user.id));
  if (!latest) return null;
  const combined = latest.text + '\n\n' + text;
  const continuation = MERGEABLE_INQUIRY_TYPES.includes(type)
    && !context.propertyId && !context.lead && !context.selection
    && latest.type === type && !latest.propertyId && latest.status === 'new'
    && Date.now() - Date.parse(latest.updatedAt) < INQUIRY_MERGE_WINDOW_MS
    && combined.length <= 4000;
  // Only new inquiries count towards the limit.
  if (!continuation && withinRateLimit(inquiryTimes, String(user.id), INQUIRY_RATE_LIMIT)) return null;
  // Past the limit the text is kept only while it fits; every message is
  // still in the user's activity history.
  if (combined.length <= 4000) latest.text = combined;
  latest.updatedAt = new Date().toISOString();
  if (latest.status === 'closed') latest.status = 'new';
  return latest;
}

function createInquiry(user, text, context = {}) {
  const type = ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(context.type) ? context.type : 'general';
  const merged = mergeIntoLatestInquiry(user, cleanText(text, 4000), type, context);
  if (merged) {
    scheduleSave();
    const notify = () => notifyAdministrator(merged, user, { text: cleanText(text, 4000), title: 'Новое сообщение в обращении' });
    if (context.sourceMessage && !context.sourceMessage.text) {
      void copyUserMessageToAdministrator(context.sourceMessage, data.config.botToken, merged)
        .then(notify)
        .catch((error) => recordError('Уведомление администратору', error));
    } else {
      void notify();
    }
    return merged;
  }
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
  trimInquiries();
  recordDaily('inquiry');
  scheduleSave();
  if (context.sourceMessage && !context.sourceMessage.text) {
    void copyUserMessageToAdministrator(context.sourceMessage, data.config.botToken, inquiry)
      .then(() => notifyAdministrator(inquiry, user))
      .catch((error) => recordError('Уведомление администратору', error));
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

// 'send', a one-time 'notice' that the user is muted, or 'drop'.
function adminNotificationDecision(user) {
  const key = String(user.id);
  if (withinRateLimit(adminNotifyTimes, key, ADMIN_NOTIFY_LIMIT)) return 'send';
  const noticeSentAt = adminMuteNotices.get(key) || 0;
  if (Date.now() - noticeSentAt < ADMIN_NOTIFY_LIMIT.windowMs) return 'drop';
  adminMuteNotices.set(key, Date.now());
  return 'notice';
}

async function notifyAdministratorAction(user, title, details = '', inquiryId = '', sourceMessageId = null, options = {}) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken || !user || !user.chatId || String(user.chatId) === adminChatId) return false;
  if (data.config.notifyMode === 'inquiries' && !options.important) return false;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';
  const username = user.username ? ' (@' + user.username + ')' : '';
  const decision = adminNotificationDecision(user);
  if (decision === 'drop') return false;
  if (decision === 'notice') {
    await sendMessage(adminChatId, '⚠️ ' + name + username + ' (ID ' + user.id + ') пишет слишком часто. Уведомления о нём приостановлены на ' + Math.round(ADMIN_NOTIFY_LIMIT.windowMs / 60000) + ' минут. Все сообщения сохраняются в панели.', data.config.botToken, { track: false }).catch((error) => recordError('Уведомление администратору', error));
    return false;
  }
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
    const messageIds = [];
    await sendMessage(adminChatId, notification.join('\n'), data.config.botToken, { track: false, messageIds });
    rememberAdminReplyTarget(messageIds, { chatId: user.chatId, inquiryId, sourceMessageId });
    if (!data.config.adminNotificationVerifiedAt) {
      data.config.adminNotificationVerifiedAt = new Date().toISOString();
      scheduleSave();
    }
    return true;
  } catch (error) {
    // Only a refusal from Telegram (wrong chat, bot blocked) means the admin
    // chat is misconfigured; a network hiccup says nothing about it.
    if ([400, 403].includes(Number(error && error.telegramCode))) data.config.adminNotificationVerifiedAt = '';
    recordError('Уведомление администратору', error);
    return false;
  }
}

async function notifyAdministrator(inquiry, user, options = {}) {
  const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  const propertyLine = property
    ? 'Объект: ' + (localized(property.title, inquiry.language) || property.reference || property.id)
    : '';
  return notifyAdministratorAction(user, options.title || 'Новое обращение', [
    'Тип: ' + ({ question: 'вопрос по объекту', interest: 'интерес к объекту', selection: 'подбор недвижимости', viewing: 'запись на просмотр', lead: 'заявка на звонок', general: 'сообщение' }[inquiry.type] || 'сообщение'),
    propertyLine,
    options.text || inquiry.text,
  ].filter(Boolean).join('\n'), inquiry.id, inquiry.sourceMessageId, { important: true });
}

async function copyUserMessageToAdministrator(message, token, inquiry = null) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !message || !message.chat || String(message.chat.id) === adminChatId) return false;
  try {
    const copied = await telegramRequest(token, 'copyMessage', {
      chat_id: adminChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
    // Replying directly to the copied photo or voice message works too.
    if (copied && Number.isFinite(Number(copied.message_id))) {
      rememberAdminReplyTarget([Number(copied.message_id)], {
        chatId: message.chat.id,
        inquiryId: inquiry ? inquiry.id : '',
        sourceMessageId: message.message_id,
      });
    }
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

const ADMIN_REPLY_TARGET_LIMIT = 3000;
const LEGACY_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Every message the bot puts into the admin chat on behalf of a user is
// recorded here: admin chat message id -> the user it belongs to. Replies are
// routed only by this map, never by the message text, because the text
// contains the user's own name and message and can be forged.
function rememberAdminReplyTarget(messageIds, target) {
  if (!target || target.chatId == null || !messageIds.length) return;
  if (!data.adminReplyTargets || typeof data.adminReplyTargets !== 'object') data.adminReplyTargets = {};
  for (const messageId of messageIds) {
    data.adminReplyTargets[String(messageId)] = {
      chatId: String(target.chatId),
      inquiryId: cleanText(target.inquiryId, 100),
      sourceMessageId: Number.isFinite(Number(target.sourceMessageId)) && target.sourceMessageId != null ? Number(target.sourceMessageId) : null,
      createdAt: new Date().toISOString(),
    };
  }
  const keys = Object.keys(data.adminReplyTargets);
  if (keys.length > ADMIN_REPLY_TARGET_LIMIT) {
    keys.sort((a, b) => Number(a) - Number(b));
    for (const key of keys.slice(0, keys.length - ADMIN_REPLY_TARGET_LIMIT)) delete data.adminReplyTargets[key];
  }
  scheduleSave();
}

// Notifications sent by older versions are not in the map. For a short
// transition period they are still parsed, taking the last marker, which the
// bot itself appends after the user's text.
function legacyAdministratorReplyTarget(replied) {
  const since = Date.parse(data.adminReplyTargetsSince || '');
  const sentAt = Number(replied.date) * 1000;
  if (!Number.isFinite(since) || !(sentAt < since) || Date.now() - since > LEGACY_REPLY_WINDOW_MS) return null;
  const source = String(replied.text || replied.caption || '');
  const last = (pattern) => {
    const matches = Array.from(source.matchAll(pattern));
    return matches.length ? matches[matches.length - 1][1] : '';
  };
  const chatId = last(/Получатель ID:\s*(-?\d{4,20})/g);
  if (!chatId) return null;
  const sourceMessageId = last(/Сообщение пользователя ID:\s*(\d{1,20})/g);
  return {
    chatId,
    inquiryId: last(/Обращение ID:\s*([A-Za-z0-9-]{8,100})/g),
    sourceMessageId: sourceMessageId ? Number(sourceMessageId) : null,
  };
}

function administratorReplyTarget(message) {
  const replied = message && message.reply_to_message;
  if (!replied) return null;
  if (data.bot.id && replied.from && Number(replied.from.id) !== Number(data.bot.id)) return null;
  const key = String(replied.message_id);
  const targets = data.adminReplyTargets || {};
  if (Object.hasOwn(targets, key)) {
    const stored = targets[key];
    return { chatId: stored.chatId, inquiryId: stored.inquiryId || '', sourceMessageId: stored.sourceMessageId };
  }
  return legacyAdministratorReplyTarget(replied);
}

function looksLikeUserNotification(message) {
  const replied = message && message.reply_to_message;
  return Boolean(replied && /Получатель ID:/.test(String(replied.text || replied.caption || '')));
}

async function handleAdministratorReply(message, token) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !message || !message.chat || String(message.chat.id) !== adminChatId) return false;
  const target = administratorReplyTarget(message);
  if (!target) {
    // A reply to an old notification must not fall through and be treated
    // as a message from a client.
    if (!looksLikeUserNotification(message)) return false;
    await sendMessage(adminChatId, '⚠️ Сообщение не отправлено: не удалось определить получателя этого уведомления. Ответьте пользователю из панели управления.', token, { track: false }).catch(() => {});
    return true;
  }
  const user = userByChatId(target.chatId);
  try {
    const language = user && user.preferredLanguage || 'ru';
    const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
    const replyParameters = target.sourceMessageId != null && Number.isFinite(Number(target.sourceMessageId))
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
      const fileId = knownFileId(image);
      if (fileId) {
        try {
          result = await telegramRequest(token, 'editMessageMedia', {
            chat_id: chatId,
            message_id: messageId,
            media: { type: 'photo', media: fileId, caption },
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
          media: { type: 'photo', media: 'attach://photo', caption },
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

function updateChatKey(update) {
  const source = update.message || update.message_reaction || (update.callback_query && update.callback_query.message);
  if (source && source.chat) return 'chat:' + source.chat.id;
  if (update.callback_query && update.callback_query.from) return 'chat:' + update.callback_query.from.id;
  return 'update:' + update.update_id;
}

// Updates from one chat are handled in order; different chats run in
// parallel, so one slow conversation does not hold up everyone else.
// A failing update is logged and skipped: the offset always moves past it,
// otherwise Telegram would return the same update forever.
async function processUpdates(updates, token, handler = handleUpdate) {
  const generation = runtime.generation;
  const queues = new Map();
  for (const update of updates) {
    const key = updateChatKey(update);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(update);
  }
  await Promise.all(Array.from(queues.values(), async (queue) => {
    for (const update of queue) {
      try {
        await handler(update, token);
      } catch (error) {
        runtime.lastError = error.message;
        recordError('Обработка сообщения', error);
        console.error('Не удалось обработать обновление ' + update.update_id + ':', error.message);
      }
    }
  }));
  // After a token change or restart the offset belongs to the new session.
  if (generation !== runtime.generation) return;
  for (const update of updates) {
    runtime.offset = Math.max(runtime.offset, Number(update.update_id) + 1);
  }
  data.telegramOffset = runtime.offset;
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
      await processUpdates(updates, token);
      if (generation !== runtime.generation) break;
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
  let lastProgressSaveAt = Date.now();

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
      entry.processedUserIds.push(String(user.id));
      // Progress is written at most every few seconds; the full file write is
      // too expensive to repeat for every recipient of a large broadcast.
      if (Date.now() - lastProgressSaveAt >= 5000) {
        saveDataNow();
        lastProgressSaveAt = Date.now();
      } else {
        scheduleSave();
      }
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

// Blocks DNS rebinding: a foreign site's domain that resolves to this
// computer must not be able to talk to the panel from the user's browser.
function hostAllowed(req) {
  let hostname;
  try {
    hostname = new URL('http://' + String(req.headers.host || '')).hostname.toLowerCase();
  } catch {
    return false;
  }
  hostname = hostname.replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || net.isIP(hostname) !== 0 || ADMIN_ALLOWED_HOSTS.has(hostname);
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
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
}

function json(res, status, payload) {
  securityHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

// The panel has a single inline <script>; a per-response nonce lets only that
// script run, so an injected <script> or event handler would be blocked even
// if some value were rendered without escaping.
function html(res, content) {
  securityHeaders(res);
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'nonce-" + nonce + "'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(content.replaceAll('<script>', '<script nonce="' + nonce + '">'));
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
    const tooLarge = () => {
      const error = new Error('Слишком большой запрос');
      error.statusCode = 413;
      return error;
    };
    // The rest of an oversized body is read and thrown away instead of
    // resetting the socket, so the client still receives the 413 answer.
    if (Number(req.headers['content-length']) > maximumBytes) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > maximumBytes) {
        overflow = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!overflow) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

const MAX_UNAUTHENTICATED_BODY_BYTES = 16 * 1024;
// The token is put into the request path, so nothing but the documented
// format is accepted.
const BOT_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

async function readJson(req, maximumBytes = MAX_BODY_BYTES) {
  const bytes = await readBody(req, maximumBytes);
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
      notifyMode: data.config.notifyMode || 'all',
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

// Everything the bot stores about one person, for a data access request.
function userDataExport(user) {
  const id = String(user.id);
  const chatId = String(user.chatId);
  return {
    exportedAt: new Date().toISOString(),
    user: clone(user),
    inquiries: data.inquiries.filter((item) => item.userId === id || String(item.chatId) === chatId).map(clone),
  };
}

// Right to erasure: removes the user's card, history, favourites, inquiries
// and every reference to them. Snapshots in backups/ keep the data until they
// are rotated out.
function eraseUserData(user) {
  const id = String(user.id);
  const chatId = String(user.chatId);
  delete data.users[id];
  usersByChatId.delete(chatId);
  inquiryTimes.delete(id);
  adminNotifyTimes.delete(id);
  adminMuteNotices.delete(id);
  const inquiriesBefore = data.inquiries.length;
  data.inquiries = data.inquiries.filter((item) => item.userId !== id && String(item.chatId) !== chatId);
  for (const entry of data.broadcasts) {
    if (Array.isArray(entry.processedUserIds)) entry.processedUserIds = entry.processedUserIds.filter((value) => String(value) !== id);
    if (Array.isArray(entry.failures)) entry.failures = entry.failures.filter((failure) => String(failure.userId) !== id);
  }
  for (const [messageId, target] of Object.entries(data.adminReplyTargets || {})) {
    if (String(target.chatId) === chatId) delete data.adminReplyTargets[messageId];
  }
  return { inquiriesRemoved: inquiriesBefore - data.inquiries.length };
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
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
    const token = cleanText(body.token, 256);
    const password = String(body.password || '');
    if (!BOT_TOKEN_PATTERN.test(token)) {
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
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
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
    // The panel polls every few seconds. When nothing changed since the
    // version it already has, answer with a tiny body and let it skip
    // re-rendering.
    const serialized = JSON.stringify(safeState(session));
    const stateVersion = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 24);
    if (url.searchParams.get('since') === stateVersion) return json(res, 200, { unchanged: true, stateVersion });
    securityHeaders(res);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(serialized.slice(0, -1) + ',"stateVersion":"' + stateVersion + '"}');
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
      rebuildUserIndex();
      telegramFileIds.clear();
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
    if (!BOT_TOKEN_PATTERN.test(token)) return json(res, 400, { error: 'Токен выглядит некорректно' });
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
    pruneOrphanPropertyAnalytics(data);
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
    const user = userById(decodeURIComponent(directMessageMatch[1]));
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

  const userExportMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/export$/);
  if (userExportMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = userById(decodeURIComponent(userExportMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    const payload = JSON.stringify(userDataExport(user), null, 2);
    securityHeaders(res);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="user-' + String(user.id).replace(/[^0-9A-Za-z_-]/g, '') + '.json"',
    });
    return res.end(payload);
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = userById(decodeURIComponent(userMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    const result = eraseUserData(user);
    saveDataNow();
    return json(res, 200, { ok: true, ...result });
  }
  if (userMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = userById(decodeURIComponent(userMatch[1]));
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
    const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
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
    const newPassword = String(body.password || '');
    // A session alone must not be enough to take over the panel or the bot.
    if (newToken || newPassword) {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!loginAllowed(ip)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
      if (!verifyPassword(String(body.currentPassword || ''))) {
        await delay(250);
        return json(res, 403, { error: 'Для смены пароля или токена введите текущий пароль' });
      }
      loginAttempts.delete(ip);
    }
    if (newToken) {
      if (!BOT_TOKEN_PATTERN.test(newToken)) return json(res, 400, { error: 'Токен выглядит некорректно' });
      try {
        const me = await telegramRequest(newToken, 'getMe', {});
        nextBot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
      } catch (error) {
        return json(res, 400, { error: 'Telegram не принял новый токен: ' + error.message });
      }
      tokenChanged = true;
    }

    let passwordData = null;
    if (newPassword) {
      if (newPassword.length < 8) return json(res, 400, { error: 'Новый пароль должен содержать минимум 8 символов' });
      if (newPassword !== String(body.passwordConfirm || '')) return json(res, 400, { error: 'Пароли не совпадают' });
      passwordData = hashPassword(newPassword);
    }
    const previousAdminChatId = String(data.config.adminChatId || '');
    const adminChatId = body.adminChatId == null ? previousAdminChatId : cleanText(body.adminChatId, 40);
    if (adminChatId && !/^-?\d{4,20}$/.test(adminChatId)) return json(res, 400, { error: 'Chat ID должен состоять из цифр' });
    if (body.notifyMode != null && !['all', 'inquiries'].includes(body.notifyMode)) return json(res, 400, { error: 'Некорректный режим уведомлений' });

    if (tokenChanged) {
      data.bot = nextBot;
      data.config.botToken = newToken;
      data.telegramOffset = 0;
      forgetTelegramFileIds(data);
    }
    if (passwordData) {
      data.config.passwordSalt = passwordData.salt;
      data.config.passwordHash = passwordData.hash;
    }
    data.config.adminChatId = adminChatId;
    if (body.notifyMode != null) data.config.notifyMode = body.notifyMode;
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
    const user = body.userId ? userById(body.userId) : null;
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
          <div class="grid settings-layout"><form id="technicalForm3" class="card" data-saveable><h3>Telegram и безопасность</h3><div class="switch-row"><div><strong>Бот включён</strong><div class="card-note">Обрабатывает новые сообщения и запланированные рассылки</div></div><input id="settingActive3" class="toggle" type="checkbox" aria-label="Бот включён"></div><div class="form-section"><div class="form-section-title">Токен бота</div><div class="card-note">Текущий токен скрыт. Введите новый только для замены.</div><div class="field"><label for="settingToken3">Новый токен</label><input id="settingToken3" class="input" autocomplete="off" placeholder="Оставьте пустым, чтобы не менять"></div><button id="tokenTestBtn3" class="btn secondary small" type="button">Проверить токен</button></div><div class="form-section"><div class="form-section-title">Пароль администратора</div><div class="field"><label for="settingCurrentPassword3">Текущий пароль</label><input id="settingCurrentPassword3" class="input" type="password" autocomplete="current-password"><span class="hint">Нужен для смены пароля или токена бота.</span></div><div class="grid two-col"><div class="field"><label for="settingPassword3">Новый пароль</label><input id="settingPassword3" class="input" type="password" minlength="8" autocomplete="new-password"></div><div class="field"><label for="settingPasswordConfirm3">Повторите пароль</label><input id="settingPasswordConfirm3" class="input" type="password" minlength="8" autocomplete="new-password"></div></div></div><button class="btn" type="submit">Сохранить настройки</button></form><div class="section-stack"><div class="card"><h3>Резервная копия</h3><p class="card-note">Содержит настройки, фотографии, контент и пользователей. Копия скачивается в сжатом формате .json.gz.</p><div class="actions" style="margin-top:14px"><a class="btn secondary" href="/api/backup">Скачать копию</a><label class="btn soft">Восстановить<input id="restoreFile3" type="file" accept=".gz,.json,application/gzip,application/json" hidden></label></div></div><div class="card"><h3>Данные</h3><div class="data-row"><span>Пользователи</span><strong id="dataUsers3">0</strong></div><div class="data-row"><span>Объекты</span><strong id="dataProperties3">0</strong></div><div class="data-row"><span>Акции</span><strong id="dataOffers3">0</strong></div><div class="data-row"><span>Автоответы</span><strong id="dataReplies3">0</strong></div></div></div></div>
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
    function discardChanges(){clearAllDirty();resetProperty();resetOffer();resetReply();resetCampaign();el("settingToken3").value="";el("settingPassword3").value="";el("settingPasswordConfirm3").value="";el("settingCurrentPassword3").value="";document.querySelectorAll("dialog[open]").forEach(function(dialog){dialog.close()});if(state){renderWelcome();renderInterfaceText();renderMenuSections();renderContacts();renderSettings();if(selectedInquiry)renderInquiryDetail(selectedInquiry);if(selectedUser)renderUserDetail(selectedUser)}}
    function canLeave(){if(!dirty.size)return true;if(!confirm("Отменить несохранённые изменения и перейти в другой раздел?"))return false;discardChanges();return true}
    function closeSidebar(){el("sidebar3").classList.remove("open");el("sidebarOverlay3").classList.add("hidden");el("mobileMenuBtn3").setAttribute("aria-expanded","false");document.querySelectorAll("#nav3 details[open]").forEach(function(group){group.removeAttribute("open")})}
    function openView(name){if(name===view){closeSidebar();return}if(!canLeave())return;view=name;el("app3").classList.toggle("dashboard-home",name==="home");document.querySelectorAll(".view").forEach(function(node){node.classList.toggle("active",node.id==="view-"+name)});document.querySelectorAll("#nav3 .nav-item").forEach(function(node){node.classList.toggle("active",node.dataset.view===name)});el("breadcrumb3").textContent=meta[name][0];el("topTitle3").textContent=meta[name][1];el("mobileTitle3").textContent=meta[name][1];closeSidebar();window.scrollTo({top:0,behavior:"smooth"});renderView(name)}
    async function boot(){try{var status=await api("/api/status");if(!status.configured){showScreen("setupScreen3");return}try{await loadState();showScreen("app3");startRefresh()}catch(e){showScreen("loginScreen3")}}catch(e){showScreen("loginScreen3");message(el("loginMessage3"),"Не удалось связаться с панелью",false)}}
    function startRefresh(){clearInterval(refreshTimer);refreshTimer=setInterval(function(){if(!document.hidden)loadState(true)},8000)}document.addEventListener("visibilitychange",function(){if(!document.hidden&&state)loadState(true)});
    async function loadState(silent){try{var next=await api("/api/state"+(silent&&state&&state.stateVersion?"?since="+encodeURIComponent(state.stateVersion):""));if(next.unchanged)return state;state=next;csrf=state.csrf;renderAll();return state}catch(e){if(e.status===401){clearInterval(refreshTimer);showScreen("loginScreen3");if(!silent)throw e}else if(!silent)throw e}}
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
      var privacy=document.createElement("div");privacy.className="form-section";privacy.innerHTML='<h3>Персональные данные</h3><div class="card-note">По запросу человека можно выгрузить или удалить всё, что бот о нём хранит: карточку, историю переписки, избранное и обращения.</div><div class="actions"><button id="exportUser3" class="btn secondary" type="button">Выгрузить данные</button><button id="deleteUser3" class="btn danger" type="button">Удалить все данные</button></div>';el("userDetail3").appendChild(privacy);
      el("exportUser3").addEventListener("click",function(){exportUserData(u.id)});el("deleteUser3").addEventListener("click",function(){deleteUserData(u.id,userName(u))});
      addCounters(el("userDetail3"));
    }
    function ensureNotificationSettings(){if(el("notificationForm3"))return;var stack=document.querySelector("#view-settings .section-stack"),form=document.createElement("form");form.id="notificationForm3";form.className="card";form.dataset.saveable="";form.innerHTML='<div class="card-head"><div><h3>Уведомления администратору</h3><div class="card-note">Сообщения и действия пользователей приходят в Telegram</div></div><span id="notificationState3" class="badge">Не настроено</span></div><div class="callout notification-help"><strong>Как подключить:</strong><span>1. Откройте этого бота в Telegram и отправьте команду <code>/myid</code>.</span><span>2. Скопируйте полученный номер в поле ниже и сохраните.</span><span>3. Нажмите «Отправить тест».</span></div><div class="field"><label for="adminChatId3">Telegram Chat ID администратора</label><input id="adminChatId3" class="input" inputmode="numeric" maxlength="20" placeholder="Например: 123456789"><span class="hint">Используйте личный Chat ID. Ответ на уведомление будет отправлен пользователю от имени бота.</span></div><div class="field"><label for="notifyMode3">Что присылать</label><select id="notifyMode3" class="select"><option value="all">Все действия пользователей</option><option value="inquiries">Только обращения и заявки</option></select><span class="hint">Если пользователь пишет слишком часто, уведомления о нём приостанавливаются на 10 минут. Все сообщения при этом сохраняются в панели.</span></div><div class="actions"><button class="btn" type="submit">Сохранить</button><button id="testAdminNotificationBtn3" class="btn secondary" type="button">Отправить тест</button></div>';stack.prepend(form);form.addEventListener("submit",saveNotificationSettings);el("testAdminNotificationBtn3").addEventListener("click",testAdminNotification);var backup=Array.from(document.querySelectorAll("#view-settings .card")).find(function(card){return card.querySelector("h3")&&card.querySelector("h3").textContent==="Резервная копия"});if(backup){var note=backup.querySelector(".card-note");if(note)note.textContent="Сжатая копия .json.gz содержит фотографии, токен бота, настройки входа, контент и данные пользователей. Храните файл как конфиденциальный."}}
    function ensureConnectionCard(){if(el("connectionCard3"))return;var stack=document.querySelector("#view-settings .section-stack"),card=document.createElement("div");card.id="connectionCard3";card.className="card";card.innerHTML='<div class="card-head"><div><h3>Состояние подключения</h3><div id="connectionSummary3" class="card-note">Проверяем Telegram…</div></div><span id="connectionBadge3" class="badge">Проверка</span></div><div class="data-row"><span>Последняя успешная проверка</span><strong id="connectionSuccess3">—</strong></div><div class="data-row"><span>Последняя проблема</span><strong id="connectionErrorAt3">—</strong></div><div id="connectionError3" class="hint" style="margin-top:10px"></div>';stack.prepend(card)}
    function renderSettings(){ensureNotificationSettings();ensureConnectionCard();if(!dirty.has(el("technicalForm3")))el("settingActive3").checked=state.config.active;if(!dirty.has(el("notificationForm3")))el("adminChatId3").value=state.config.adminChatId||"";if(el("notifyMode3"))el("notifyMode3").value=state.config.notifyMode||"all";var notificationBadge=el("notificationState3"),configured=Boolean(state.config.adminChatId),verified=Boolean(configured&&state.config.adminNotificationVerifiedAt);notificationBadge.textContent=!configured?"Не настроено":verified?"Проверено":"Нужно проверить";notificationBadge.className="badge "+(verified?"good":"warn");var runtime=state.runtime||{},status=runtime.status,badge=el("connectionBadge3");badge.textContent=statusName(status);badge.className="badge "+(status==="online"?"good":status==="stopped"?"":"warn");el("connectionSummary3").textContent=connectionNote();el("connectionSuccess3").textContent=runtime.lastSuccessfulContactAt?fmtDate(runtime.lastSuccessfulContactAt):"Ещё не было";el("connectionErrorAt3").textContent=runtime.lastErrorAt?fmtDate(runtime.lastErrorAt):"Нет";el("connectionError3").textContent=runtime.lastError||"Ошибок текущего подключения нет.";el("dataUsers3").textContent=fmtNumber(state.userCount);el("dataProperties3").textContent=fmtNumber(state.objects.length);el("dataOffers3").textContent=fmtNumber(state.promotions.length);el("dataReplies3").textContent=fmtNumber(state.rules.length)}
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
    async function exportUserData(id){try{var response=await fetch("/api/users/"+encodeURIComponent(id)+"/export");if(!response.ok){var body={};try{body=await response.json()}catch(e){}throw new Error(body.error||"Не удалось выгрузить данные")}var link=document.createElement("a");link.href=URL.createObjectURL(await response.blob());link.download="user-"+id+".json";document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(link.href)},1000)}catch(error){toast(error.message)}}
    async function deleteUserData(id,name){if(!(await confirmAction("Удалить данные пользователя?","Будут удалены карточка «"+name+"», история переписки, избранное и все обращения. Отменить это нельзя. В ежедневных резервных копиях данные останутся до их автоматического удаления через 14 дней. Если человек снова напишет боту, он появится как новый пользователь.","Удалить")))return;try{var result=await api("/api/users/"+encodeURIComponent(id),{method:"DELETE"});selectedUser=null;await loadState();el("userDetail3").innerHTML='<div class="empty"><strong>Пользователь не выбран</strong>Нажмите на карточку слева, чтобы открыть детали.</div>';toast("Данные удалены, обращений: "+result.inquiriesRemoved)}catch(error){toast(error.message)}}
    async function sendDirectMessage(e,userId){e.preventDefault();var form=e.currentTarget,button=e.submitter,file=el("directMessageImage3").files[0];button.disabled=true;try{var body={text:el("directMessageText3").value,buttonText:el("directMessageButtonText3").value,buttonUrl:el("directMessageButtonUrl3").value};if(file){body.imageDataUrl=await fileData(file);body.imageName=file.name}await api("/api/users/"+encodeURIComponent(userId)+"/message",{method:"POST",body:JSON.stringify(body)});clearDirty(form);form.reset();await loadState();toast("Личное сообщение отправлено")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveSettings(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{await api("/api/settings",{method:"PUT",body:JSON.stringify({messages:state.config.messages,active:el("settingActive3").checked,adminChatId:el("adminChatId3")?el("adminChatId3").value:state.config.adminChatId,token:el("settingToken3").value,password:el("settingPassword3").value,passwordConfirm:el("settingPasswordConfirm3").value,currentPassword:el("settingCurrentPassword3").value})});el("settingToken3").value="";el("settingPassword3").value="";el("settingPasswordConfirm3").value="";el("settingCurrentPassword3").value="";clearDirty(el("technicalForm3"));await loadState();toast("Настройки сохранены")}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function saveNotificationSettings(e){e.preventDefault();var button=e.submitter;button.disabled=true;try{await api("/api/settings",{method:"PUT",body:JSON.stringify({messages:state.config.messages,active:state.config.active,adminChatId:el("adminChatId3").value,notifyMode:el("notifyMode3").value,token:"",password:"",passwordConfirm:""})});clearDirty(el("notificationForm3"));await loadState();toast(el("adminChatId3").value&&!state.config.adminNotificationVerifiedAt?"Сохранено. Теперь отправьте тест":"Настройки уведомлений сохранены") }catch(error){toast(error.message)}finally{button.disabled=false}}
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
    if (!hostAllowed(req)) {
      securityHeaders(res);
      res.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Недопустимый адрес панели');
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/login-assets/background.png' && req.method === 'GET') return binaryLoginAsset(req, res, LOGIN_ASSETS.background);
    if (url.pathname === '/login-assets/logo.png' && req.method === 'GET') return binaryLoginAsset(req, res, LOGIN_ASSETS.logo);
    if (url.pathname === '/admin-assets/header.webp' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.header);
    if (url.pathname === '/admin-assets/header-mobile.webp' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.headerMobile);
    if (url.pathname === '/admin-assets/sidebar-logo.png' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.sidebarLogo);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/' && req.method === 'GET') return html(res, ADMIN_HTML);
    securityHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  } catch (error) {
    if (error.statusCode === 413) {
      res.setHeader('connection', 'close');
      if (!res.headersSent) json(res, 413, { error: error.message });
      return;
    }
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

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nЗавершение работы…');
  runtime.generation += 1;
  if (runtime.abortController) runtime.abortController.abort();
  clearTimeout(saveTimer);
  try { saveDataNow(); } catch (error) { console.error('Не удалось сохранить данные:', error.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

function start() {
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
    if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
      console.log('');
      console.log('  ВНИМАНИЕ: панель доступна из сети (' + HOST + ') по HTTP без шифрования.');
      console.log('  Пароль передаётся открытым текстом. Используйте только в доверенной сети.');
    }
    console.log('');
    restartPolling();
    runDailyBackupSafely();
    setInterval(runDailyBackupSafely, 60 * 60 * 1000).unref();
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

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // The app usually runs without a supervisor that would restart it, so it
  // keeps running: the error is shown in the panel and the Telegram
  // connection, the part most likely left in a broken state, is restarted.
  process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
    try {
      recordError('Необработанная ошибка', error);
      if (!shuttingDown) restartPolling();
    } catch {
      // Nothing more can be done safely here.
    }
  });
  process.on('unhandledRejection', (error) => {
    console.error('Необработанная ошибка:', error);
    try {
      recordError('Необработанная ошибка', error);
    } catch {
      // Nothing more can be done safely here.
    }
  });
}

// Tests load this file with BOT_NO_START=1 to reach the functions below
// without opening the panel port or connecting to Telegram.
if (process.env.BOT_NO_START !== '1') start();

module.exports = {
  getData: () => data,
  setData: (next) => { data = next; rebuildUserIndex(); },
  normalizeLoadedData,
  loadData,
  saveDataNow,
  persistImage,
  contentAddressImages,
  referencedImageFiles,
  telegramRequest,
  processUpdates,
  runtime,
  userById,
  userByChatId,
  normalizeUser,
  hostAllowed,
  hashPassword,
  handleApi,
  server,
  sessions,
  loginAttempts,
  splitTelegramText,
  handleUpdate,
  createInquiry,
  runDailyBackup,
  restoreMissingMedia,
  text: {
    lead: LEAD_FORM_TEXT,
    viewing: VIEWING_FORM_TEXT,
    selection: SELECTION_FORM_TEXT,
    menu: MENU_LABELS,
    interaction: INTERACTION_TEXT,
    commands: COMMAND_TEXT,
    propertyActions: PROPERTY_ACTION_TEXT,
  },
};
