// Панель: сессии, заголовки безопасности, чтение запросов, состояние для панели.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import zlib from 'node:zlib';
import { ADMIN_ALLOWED_HOSTS, DATA_FILE, MAX_BACKUP_BODY_BYTES, MAX_BACKUP_OUTPUT_BYTES, MAX_BODY_BYTES, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, SESSION_TTL_MS } from './config.mjs';
import { cleanText } from './util.mjs';
import { normalizeCalculator, normalizePublishing, normalizeTelegramBackup, normalizeTimeZone, normalizeViewingSlots, normalizeWorkingHours } from './data-format.mjs';
import { decryptBackup, isEncryptedBackup } from './offsite.mjs';
import { imageBytes, imageExists } from './media.mjs';
import { data, runtime, verifyPassword } from './store.mjs';
import { publicRuntime } from './menus.mjs';
import { propertyPublicationReadiness, recordImages } from './catalog.mjs';
import { adminNotifications } from './admin-notifications.mjs';

const SESSIONS_FILE = path.join(path.dirname(DATA_FILE), 'bot-sessions.json');
const SESSION_PERSIST_STEP_MS = 10 * 60 * 1000;

function sessionKey(cookieValue) {
  return crypto.createHash('sha256').update(String(cookieValue)).digest('hex');
}

// Panel sessions, kept on disk so that restarting the bot (for example after
// an update) does not log the administrator out. The file holds only SHA-256
// hashes of the session cookies, so reading it does not give access to the
// panel. Every change to the map is written straight away.
class PersistentSessionStore extends Map {
  set(key, value) {
    super.set(key, value);
    this.persist();
    return this;
  }

  delete(key) {
    const removed = super.delete(key);
    if (removed) this.persist();
    return removed;
  }

  clear() {
    super.clear();
    this.persist();
  }

  persist() {
    const now = Date.now();
    const stored = {};
    for (const [key, session] of this) {
      if (session.expiresAt > now) stored[key] = { csrf: session.csrf, expiresAt: session.expiresAt };
    }
    try {
      const temporary = SESSIONS_FILE + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, SESSIONS_FILE);
    } catch (error) {
      console.error('Не удалось сохранить сессии панели:', error.message);
    }
  }

  load() {
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch {
      return;
    }
    const now = Date.now();
    for (const [key, value] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
      if (!/^[0-9a-f]{64}$/.test(key) || !value || typeof value.csrf !== 'string' || !(Number(value.expiresAt) > now)) continue;
      super.set(key, { id: key, csrf: value.csrf, expiresAt: Number(value.expiresAt), persistedExpiresAt: Number(value.expiresAt) });
    }
  }
}

const sessions = new PersistentSessionStore();
sessions.load();
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
  const cookie = parseCookies(req.headers.cookie).admin_session;
  const key = cookie && sessionKey(cookie);
  const session = key && sessions.get(key);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(key);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  // The sliding expiry is written to disk in steps, not on every request.
  if (session.expiresAt - (session.persistedExpiresAt || 0) > SESSION_PERSIST_STEP_MS) {
    session.persistedExpiresAt = session.expiresAt;
    sessions.persist();
  }
  return session;
}

function createSession(res, req = null) {
  const cookie = crypto.randomBytes(32).toString('hex');
  const key = sessionKey(cookie);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const session = {
    id: key,
    csrf: crypto.randomBytes(24).toString('hex'),
    expiresAt,
    persistedExpiresAt: expiresAt,
  };
  sessions.set(key, session);
  res.setHeader('set-cookie', 'admin_session=' + cookie + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + (req && secureRequest(req) ? '; Secure' : ''));
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
  return hostname === 'localhost' || net.isIP(hostname) !== 0 || ADMIN_ALLOWED_HOSTS.has(hostname)
    || Boolean(runtime.tunnel.host && hostname === runtime.tunnel.host);
}

function loopbackSocket(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// The tunnel connects to the panel from this computer, so a loopback socket
// alone does not mean the person is here. Requests carrying proxy headers or
// addressed to a public name are remote.
function requestIsRemote(req) {
  const headers = req.headers || {};
  if (headers['cf-connecting-ip'] || headers['cf-ray'] || headers['x-forwarded-for'] || headers['x-forwarded-host'] || headers['x-forwarded-proto']) return true;
  if (!loopbackSocket(req)) return true;
  let hostname = '';
  try {
    hostname = new URL('http://' + String(headers.host || '')).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  return !['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function isLocalRequest(req) {
  return !requestIsRemote(req);
}

// The visitor's address for rate limiting; behind the tunnel it comes from
// Cloudflare's header, otherwise every remote login would share one bucket.
function clientAddress(req) {
  const forwarded = cleanText(req.headers && req.headers['cf-connecting-ip'], 64);
  if (forwarded && loopbackSocket(req)) return forwarded;
  return req.socket.remoteAddress || 'unknown';
}

function secureRequest(req) {
  const headers = (req && req.headers) || {};
  return String(headers['x-forwarded-proto'] || '').toLowerCase() === 'https' || /"scheme":"https"/.test(String(headers['cf-visitor'] || ''));
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

// Страница панели одна и та же до следующей сборки, поэтому отдаём её с
// отпечатком (ETag): браузер спрашивает «не изменилось ли», получает 304 и не
// качает 340 КБ заново. Разрешение на встроенный скрипт — по его хешу, а не по
// одноразовому номеру: иначе страница была бы разной при каждой загрузке.
const pageCache = new Map();

function pageMeta(content) {
  const cached = pageCache.get(content);
  if (cached) return cached;
  const scripts = Array.from(String(content).matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
  const hashes = scripts.map((code) => "'sha256-" + crypto.createHash('sha256').update(code, 'utf8').digest('base64') + "'");
  const body = Buffer.from(content, 'utf8');
  const meta = {
    body,
    etag: '"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 32) + '"',
    csp: "default-src 'self'; script-src " + (hashes.join(' ') || "'none'")
      + "; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
  pageCache.set(content, meta);
  return meta;
}

function html(res, content, req = null) {
  const meta = pageMeta(content);
  securityHeaders(res);
  res.setHeader('content-security-policy', meta.csp);
  res.setHeader('etag', meta.etag);
  // no-cache — не «не кешировать», а «спроси перед использованием».
  res.setHeader('cache-control', 'no-cache');
  if (req && req.headers['if-none-match'] === meta.etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': meta.body.length });
  return res.end(meta.body);
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

function parseUploadedDocument(dataUrl, originalName) {
  const name = path.basename(cleanText(originalName, 180));
  const extension = path.extname(name).toLowerCase();
  const allowed = {
    '.pdf': ['application/pdf', 'application/octet-stream'],
    '.txt': ['text/plain', 'application/octet-stream'],
    '.doc': ['application/msword', 'application/octet-stream'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
    '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  };
  const match = String(dataUrl || '').match(/^data:([^;,]{0,120});base64,([A-Za-z0-9+/=]+)$/);
  const suppliedMime = match && match[1] ? match[1].toLowerCase() : 'application/octet-stream';
  if (!name || !allowed[extension] || !match || !allowed[extension].includes(suppliedMime)) {
    throw new Error('Поддерживаются документы PDF, TXT, DOC, DOCX, XLS и XLSX');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('Документ пустой');
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('Размер документа не должен превышать 10 МБ');
  const pdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08));
  const ole = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (extension === '.pdf' && !pdf) throw new Error('Содержимое файла не соответствует формату PDF');
  if (['.docx', '.xlsx'].includes(extension) && !zip) throw new Error('Содержимое файла не соответствует формату Office');
  if (['.doc', '.xls'].includes(extension) && !ole) throw new Error('Содержимое файла не соответствует формату Office');
  if (extension === '.txt' && bytes.includes(0)) throw new Error('TXT-файл содержит недопустимые двоичные данные');
  return { id: crypto.randomUUID(), mimeType: match[1] || allowed[extension][0], dataBase64: bytes.toString('base64'), name, size: bytes.length, updatedAt: new Date().toISOString() };
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

// A panel backup (.json.gz / .json) or the encrypted weekly copy from
// Telegram (.kbk), whose password comes in a header as base64 of UTF-8.
async function readBackup(req) {
  let bytes = await readBody(req, MAX_BACKUP_BODY_BYTES);
  if (isEncryptedBackup(bytes)) {
    const header = String(req.headers['x-backup-password'] || '');
    const password = header ? Buffer.from(header, 'base64').toString('utf8') : '';
    if (!password) throw new Error('Это зашифрованная копия из Telegram — введите её пароль');
    bytes = decryptBackup(bytes, password);
  }
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

// Опасные действия просят текущий пароль отдельно от входа: украденной сессии
// недостаточно, чтобы увести бота или выкачать данные с токенами.
// Тот же счётчик попыток, что и у входа (loginAttempts объявлен здесь же),
// проверяется на месте: admin-input импортировать нельзя — будет круг.
function attemptAllowed(ip) {
  const now = Date.now();
  let item = loginAttempts.get(ip);
  if (!item || item.resetAt < now) item = { count: 0, resetAt: now + 15 * 60 * 1000 };
  item.count += 1;
  loginAttempts.set(ip, item);
  return item.count <= 10;
}

function passwordAccepted(req, res, supplied) {
  const ip = clientAddress(req);
  if (!attemptAllowed(ip)) {
    json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    return false;
  }
  if (!verifyPassword(String(supplied || ''))) {
    json(res, 403, { error: 'Введите текущий пароль панели' });
    return false;
  }
  loginAttempts.delete(ip);
  return true;
}

// Пароль в заголовке — для запросов, где тело занято файлом.
function headerPassword(req) {
  const header = String(req.headers['x-current-password'] || '');
  if (!header) return '';
  try {
    return Buffer.from(header, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// Скачивание копии открывается ссылкой, а в ссылку пароль не положить: панель
// сначала берёт одноразовый пропуск на две минуты.
const DOWNLOAD_TICKET_MS = 2 * 60 * 1000;
const downloadTickets = new Map();

function issueDownloadTicket() {
  const ticket = crypto.randomBytes(24).toString('hex');
  for (const [key, expiresAt] of downloadTickets) if (expiresAt < Date.now()) downloadTickets.delete(key);
  downloadTickets.set(ticket, Date.now() + DOWNLOAD_TICKET_MS);
  return ticket;
}

function useDownloadTicket(ticket) {
  const key = String(ticket || '');
  const expiresAt = downloadTickets.get(key);
  downloadTickets.delete(key);
  return Boolean(expiresAt && expiresAt >= Date.now());
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

// В списках панели от фотографии нужен только её номер: миниатюру она берёт по
// адресу /api/media/..., а имя файла и размер там не показываются.
function imageRef(image) {
  return imageExists(image) ? { exists: true, id: image.id || '' } : { exists: false };
}

function publicRecord(record, collection) {
  const { image, images, imagesByLanguage, ...publicFields } = record;
  if (collection === 'objects' || collection === 'promotions') {
    const publicImagesByLanguage = Object.fromEntries(['ru', 'en', 'es'].map((language) => [
      language,
      recordImages(record, language).map(imageRef),
    ]));
    const cover = recordImages(record)[0];
    return {
      ...publicFields,
      image: imageMeta(cover),
      imagesByLanguage: publicImagesByLanguage,
      publicationIssues: collection === 'objects' ? propertyPublicationReadiness(record) : undefined,
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

// Where clients came from (the src_ label of the link they opened) and how
// many of them sent a request. Counted over all users, not only the ones the
// panel lists.
const SOURCE_RECENT_DAYS = 30;

function sourceReport(now = Date.now()) {
  const withRequests = new Set(data.inquiries.map((item) => String(item.userId)));
  const recentSince = now - SOURCE_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const rows = new Map();
  for (const user of Object.values(data.users)) {
    const source = cleanText(user.source, 40);
    const row = rows.get(source) || { source, users: 0, recent: 0, withRequests: 0 };
    row.users += 1;
    if (Date.parse(user.firstSeenAt || user.sourceAt || '') >= recentSince) row.recent += 1;
    if (withRequests.has(String(user.id))) row.withRequests += 1;
    rows.set(source, row);
  }
  return Array.from(rows.values()).sort((a, b) => (a.source ? 0 : 1) - (b.source ? 0 : 1) || b.users - a.users || a.source.localeCompare(b.source));
}

function inquiryUnread(inquiry) {
  if (!inquiry) return false;
  const lastIncoming = Math.max(
    Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0,
    ...(Array.isArray(inquiry.messages) ? inquiry.messages.filter((message) => message.direction === 'in').map((message) => Date.parse(message.createdAt) || 0) : [0]),
  );
  return lastIncoming > (Date.parse(inquiry.readAt || '') || 0);
}

function safeState(session) {
  const users = Object.values(data.users)
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(0, 500);
  const unreadUsers = new Set(data.inquiries.filter(inquiryUnread).map((item) => String(item.userId)));
  const notifications = adminNotifications();
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
      notifyMode: data.config.notifyMode || 'inquiries',
      remoteAccess: Boolean(data.config.remoteAccess),
      // The tunnel token is a secret: the panel only learns whether it is set.
      tunnelTokenSet: Boolean(data.config.tunnelToken),
      tunnelHostname: data.config.tunnelHostname || '',
      reminderHours: Number.isFinite(Number(data.config.reminderHours)) ? Number(data.config.reminderHours) : 2,
      retentionMonths: Number(data.config.retentionMonths) || 0,
      timeZone: normalizeTimeZone(data.config.timeZone),
      workingHours: normalizeWorkingHours(data.config.workingHours),
      statusNotices: data.config.statusNotices !== false,
      calculator: normalizeCalculator(data.config.calculator),
      viewingSlots: normalizeViewingSlots(data.config.viewingSlots),
      adminName: data.config.adminName || '',
      feedImport: data.config.feedImport && typeof data.config.feedImport === 'object' ? data.config.feedImport : {},
      managers: Array.isArray(data.config.managers) ? data.config.managers : [],
      // The key stays on this computer; the panel only learns the state.
      telegramBackup: (({ enabled, key, lastSentAt, lastError }) => ({ enabled, passwordSet: Boolean(key), lastSentAt, lastError }))(normalizeTelegramBackup(data.config.telegramBackup)),
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
    errors: data.errors,
    notifications,
    notificationUnreadCount: notifications.filter((item) => item.active && !item.readAt && !item.handledAt).length,
    notificationActiveCount: notifications.filter((item) => item.active && !item.handledAt).length,
    languageCounts: languageCounts(),
    // Recipient ids stay on the server; the panel gets the counts.
    broadcasts: data.broadcasts.map(({ processedUserIds, respondedUserIds, inquiryUserIds, unsubscribedUserIds, ...entry }) => ({
      ...entry,
      image: imageMeta(entry.image),
      responses: Array.isArray(respondedUserIds) ? respondedUserIds.length : 0,
      inquiriesAfter: Array.isArray(inquiryUserIds) ? inquiryUserIds.length : 0,
      unsubscribes: Array.isArray(unsubscribedUserIds) ? unsubscribedUserIds.length : 0,
    })),
    inquiries: data.inquiries,
    replyTemplates: data.replyTemplates || [],
    newInquiryCount: data.inquiries.filter((item) => item.status === 'new').length,
    unreadConversationCount: unreadUsers.size,
    broadcastOptOutCount: Object.values(data.users).filter((user) => user.broadcastsOptOut && !user.blocked && user.chatId).length,
    // Рассылка уходит только согласившимся: панель показывает, сколько их.
    newsConsentCount: Object.values(data.users).filter((user) => user.newsConsentAt && !user.broadcastsOptOut && !user.blocked && user.chatId).length,
    sources: sourceReport(),
    publishing: (({ signature, signatureEnabled, signatureWrap, signatureQuote, signatureDivider, buttons, buttonsPerRow, rubrics }) => ({
      signature,
      signatureEnabled,
      signatureWrap,
      signatureQuote,
      signatureDivider,
      buttons,
      buttonsPerRow,
      rubrics: rubrics.map((rubric) => ({ id: rubric.id, name: rubric.name, placement: rubric.placement, image: imageMeta(rubric.image) })),
    }))(normalizePublishing(data.config.publishing)),
    groups: Array.isArray(data.groups) ? data.groups : [],
    groupPosts: Array.isArray(data.groupPosts) ? data.groupPosts.filter((post) => post.status === 'scheduled') : [],
  };
}

export {
  DOWNLOAD_TICKET_MS,
  headerPassword,
  issueDownloadTicket,
  passwordAccepted,
  useDownloadTicket,
  BOT_TOKEN_PATTERN,
  MAX_UNAUTHENTICATED_BODY_BYTES,
  PersistentSessionStore,
  SESSIONS_FILE,
  SESSION_PERSIST_STEP_MS,
  binaryImage,
  binaryLoginAsset,
  clientAddress,
  createSession,
  getSession,
  hostAllowed,
  html,
  imageMeta,
  isLocalRequest,
  json,
  languageCounts,
  loginAttempts,
  loopbackSocket,
  parseCookies,
  parseUploadedImage,
  parseUploadedDocument,
  publicRecord,
  readBackup,
  readBody,
  readJson,
  requestIsRemote,
  requireAuth,
  safeState,
  secureRequest,
  securityHeaders,
  sessionKey,
  sessions,
  sourceReport,
};
