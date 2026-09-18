// Панель: сессии, заголовки безопасности, чтение запросов, состояние для панели.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import zlib from 'node:zlib';
import { ADMIN_ALLOWED_HOSTS, DATA_FILE, MAX_BACKUP_BODY_BYTES, MAX_BACKUP_OUTPUT_BYTES, MAX_BODY_BYTES, MAX_IMAGE_BYTES, SESSION_TTL_MS } from './config.mjs';
import { cleanText } from './util.mjs';
import { imageBytes, imageExists } from './media.mjs';
import { normalizedInterfaceText } from './texts.mjs';
import { data, runtime } from './store.mjs';
import { publicRuntime } from './menus.mjs';
import { recordImages } from './catalog.mjs';

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
      notifyMode: data.config.notifyMode || 'inquiries',
      remoteAccess: Boolean(data.config.remoteAccess),
      // The tunnel token is a secret: the panel only learns whether it is set.
      tunnelTokenSet: Boolean(data.config.tunnelToken),
      tunnelHostname: data.config.tunnelHostname || '',
      reminderHours: Number.isFinite(Number(data.config.reminderHours)) ? Number(data.config.reminderHours) : 2,
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
    replyTemplates: data.replyTemplates || [],
    newInquiryCount: data.inquiries.filter((item) => item.status === 'new').length,
  };
}

export {
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
};
