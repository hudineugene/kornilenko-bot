// Сервер Mini App. Отдельный от панели: панель слушает только сам компьютер и не должна быть видна из интернета, а приложение
// открывают клиенты, поэтому его адрес публичный (через обратный прокси с HTTPS). Здесь только открытый каталог для чтения и
// действия клиента, подписанные Telegram; ничего из панели через этот порт не достаётся.

import http from 'node:http';
import crypto from 'node:crypto';
import { cleanText } from '../util.mjs';
import { data } from '../store.mjs';
import { ADMIN_ALLOWED_HOSTS, ADMIN_ASSETS, FONT_ASSETS } from '../config.mjs';
import { markFunnel, recordPropertyEvent } from '../analytics.mjs';
import { imageBytes, imageExists } from '../media.mjs';
import { validateInitData } from './auth.mjs';
import {
  appLanguage, bootstrapOf, detailOf, findImage, findRecord,
} from './data.mjs';
import {
  AppError, askQuestion, requestCall, requestViewing, toggleCompare, toggleFavorite, userFor, viewingOptions,
} from './actions.mjs';
import { userById } from '../users.mjs';
import { APP_CSS, APP_HTML, APP_JS } from './assets.mjs';
import { miniAppSettings } from './settings.mjs';

const MAX_BODY = 16 * 1024;
// Заявки (запись, звонок, вопрос) — строго; сердечки, сравнение и счётчики — свободнее: листая каталог, их ставят десятками.
const REQUEST_LIMIT = { count: 12, windowMs: 10 * 60 * 1000 };
const TOGGLE_LIMIT = { count: 150, windowMs: 10 * 60 * 1000 };
const READ_LIMIT = { count: 240, windowMs: 60 * 1000 };
const FILE_LIMIT = { count: 600, windowMs: 60 * 1000 };
const TRACK_EVENTS = ['galleries', 'calculator'];
const etags = new Map();
const hits = new Map();

function rateLimited(key, limit) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((time) => now - time < limit.windowMs);
  if (list.length >= limit.count) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20000) hits.delete(hits.keys().next().value);
  return false;
}

// За обратным прокси адрес клиента лежит в заголовках. Верим им только когда запрос пришёл с этого же компьютера, и берём
// последний адрес в цепочке: его дописал наш прокси, а начало цепочки клиент мог придумать сам.
function clientAddress(req) {
  const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!loopback) return remote;
  const cloudflare = String(req.headers['cf-connecting-ip'] || '').trim();
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(Boolean);
  const forwarded = cloudflare || chain[chain.length - 1] || '';
  return forwarded ? forwarded.slice(0, 64) : remote;
}

// Страницы приложения встраиваются в Telegram, поэтому frame-ancestors не ограничиваем; скрипты — только свои и telegram.org.
function securityHeaders(res, extra = {}) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '));
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
}

function sendJson(res, status, body) {
  securityHeaders(res);
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendText(res, status, type, text, cache = 'no-cache') {
  securityHeaders(res);
  const etag = '"' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 20) + '"';
  res.setHeader('etag', etag);
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text), 'cache-control': cache });
  res.end(text);
}

// Метка файла считается один раз; повторный запрос с той же меткой отвечает «не менялось», не читая файл.
function sendBinary(req, res, load, mimeType, cache, key = '') {
  securityHeaders(res);
  const known = key ? etags.get(key) : '';
  if (known && req.headers['if-none-match'] === known) {
    res.writeHead(304, { etag: known, 'cache-control': cache });
    return res.end();
  }
  const bytes = typeof load === 'function' ? load() : load;
  const etag = '"' + crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 20) + '"';
  if (key) {
    if (etags.size > 2000) etags.delete(etags.keys().next().value);
    etags.set(key, etag);
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': cache });
    return res.end();
  }
  res.writeHead(200, { 'content-type': mimeType, 'content-length': bytes.length, etag, 'cache-control': cache });
  res.end(bytes);
}

function sendAsset(req, res, asset) {
  if (!asset) {
    securityHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  return sendBinary(req, res, asset.bytes, asset.mimeType, 'public, max-age=604800', 'asset:' + asset.mimeType + ':' + asset.bytes.length);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError('Слишком большой запрос', 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new AppError('Некорректный запрос');
  }
}

// Кто открыл приложение: подписанные Telegram данные → клиент; иначе гость (только чтение).
function identify(req) {
  // Только для проверки на своём компьютере: включается переменной окружения и не работает за обратным прокси.
  const local = req.socket && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ''));
  if (process.env.MINIAPP_DEV === '1' && local && localHost && !req.headers['x-forwarded-for'] && /^\d{3,15}$/.test(String(req.headers['x-dev-user'] || ''))) {
    return { guest: false, tgUser: { id: Number(req.headers['x-dev-user']), first_name: 'Dev', last_name: '', username: '', language_code: 'ru' }, startParam: '' };
  }
  const token = data.config && data.config.botToken;
  const checked = validateInitData(req.headers['x-tg-init-data'], token);
  if (!checked.ok) return { guest: true, reason: checked.reason };
  return { guest: false, tgUser: checked.user, startParam: checked.startParam };
}

async function handleApi(req, res, url) {
  const address = clientAddress(req);
  if (rateLimited('read:' + address, READ_LIMIT)) return sendJson(res, 429, { error: 'Слишком часто' });
  const who = identify(req);
  const route = url.pathname.replace(/^\/api\/app/, '');
  const token = data.config.botToken;

  if (req.method === 'GET') {
    if (route === '/health') return sendJson(res, 200, { ok: true });
    const existing = who.guest ? null : userById(String(who.tgUser.id));
    const language = appLanguage(url.searchParams.get('lang'), existing, who.guest ? '' : who.tgUser.language_code);
    if (route === '/bootstrap') {
      const body = bootstrapOf(language, existing);
      body.guest = who.guest;
      body.user = who.guest ? null : { name: [who.tgUser.first_name, who.tgUser.last_name].filter(Boolean).join(' '), phone: existing ? existing.phone || '' : '', contactName: existing ? existing.contactName || '' : '' };
      body.startParam = who.guest ? '' : who.startParam;
      return sendJson(res, 200, body);
    }
    const propertyMatch = route.match(/^\/property\/([^/]+)$/);
    if (propertyMatch) {
      const record = findRecord(safeDecode(propertyMatch[1]), language);
      if (!record) return sendJson(res, 404, { error: 'Объект недоступен', code: 'unavailable' });
      // Открытие карточки считается так же, как «Подробнее» в боте: в воронке и в отчёте по объекту.
      if (!who.guest) {
        recordPropertyEvent(record.id, 'details');
        if (existing) markFunnel(existing, 'catalog');
        if (existing) markFunnel(existing, 'details');
      }
      return sendJson(res, 200, detailOf(record, language));
    }
    if (route === '/viewing-options') return sendJson(res, 200, viewingOptions(language));
    return sendJson(res, 404, { error: 'Не найдено' });
  }

  if (req.method === 'POST') {
    if (who.guest) return sendJson(res, 401, { error: 'Откройте приложение из Telegram, чтобы записаться или сохранить', reason: who.reason });
    const lightRoute = ['/favorite', '/compare', '/track'].includes(route);
    const bucket = lightRoute ? TOGGLE_LIMIT : REQUEST_LIMIT;
    if (rateLimited((lightRoute ? 'light:' : 'write:') + who.tgUser.id, bucket)) return sendJson(res, 429, { error: 'Слишком много действий подряд. Попробуйте через несколько минут.', code: 'too-many' });
    const body = await readJson(req);
    const user = userFor(who.tgUser);
    const language = ['ru', 'en', 'es'].includes(body.lang) ? body.lang : appLanguage('', user, who.tgUser.language_code);
    try {
      if (route === '/favorite') return sendJson(res, 200, toggleFavorite(user, cleanText(body.id, 100), body.on, token, language));
      if (route === '/compare') return sendJson(res, 200, toggleCompare(user, cleanText(body.id, 100), body.on, language));
      if (route === '/viewing') return sendJson(res, 200, await requestViewing(user, body, token, language));
      if (route === '/call') return sendJson(res, 200, await requestCall(user, body, token, language));
      if (route === '/question') return sendJson(res, 200, await askQuestion(user, body, token, language));
      if (route === '/track') {
        const id = cleanText(body.id, 100);
        if (TRACK_EVENTS.includes(body.event) && findRecord(id, language)) recordPropertyEvent(id, body.event);
        return sendJson(res, 200, { ok: true });
      }
    } catch (error) {
      if (error instanceof AppError) return sendJson(res, error.status, { error: error.message, code: error.code });
      throw error;
    }
    return sendJson(res, 404, { error: 'Не найдено' });
  }
  return sendJson(res, 405, { error: 'Метод не поддерживается' });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

async function handleMiniAppRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/app/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      securityHeaders(res);
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Method not allowed');
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return sendText(res, 200, 'text/html; charset=utf-8', APP_HTML, 'no-cache');
    if (url.pathname === '/app.css') return sendText(res, 200, 'text/css; charset=utf-8', APP_CSS, 'no-cache');
    if (url.pathname === '/app.js') return sendText(res, 200, 'text/javascript; charset=utf-8', APP_JS, 'no-cache');
    if (url.pathname === '/fonts/inter-latin.woff2') return sendAsset(req, res, FONT_ASSETS.interLatin);
    if (url.pathname === '/fonts/inter-cyrillic.woff2') return sendAsset(req, res, FONT_ASSETS.interCyrillic);
    if (url.pathname === '/logo.png') return sendAsset(req, res, ADMIN_ASSETS.sidebarLogo);
    if (url.pathname === '/icon.png') return sendAsset(req, res, ADMIN_ASSETS.appIcon192);
    const photo = url.pathname.match(/^\/m\/([^/]+)\/([^/]+)$/);
    if (photo) {
      if (rateLimited('file:' + clientAddress(req), FILE_LIMIT)) return sendJson(res, 429, { error: 'Слишком часто' });
      const recordId = safeDecode(photo[1]);
      const imageId = safeDecode(photo[2]);
      const image = recordId && imageId ? findImage(recordId, imageId) : null;
      if (!image) return sendAsset(req, res, null);
      return sendBinary(req, res, () => imageBytes(image), image.mimeType || 'image/jpeg', 'public, max-age=86400', 'photo:' + recordId + ':' + imageId);
    }
    if (url.pathname === '/c/photo') {
      const contact = data.contacts || {};
      if (!contact.photo || !imageExists(contact.photo)) return sendAsset(req, res, null);
      return sendBinary(req, res, () => imageBytes(contact.photo), contact.photo.mimeType || 'image/jpeg', 'public, max-age=3600');
    }
    securityHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    if (!res.headersSent) {
      if (error && error.status && error.status < 500) return sendJson(res, error.status, { error: error.message, code: error.code || '' });
      console.error('Ошибка Mini App:', error && error.message);
      sendJson(res, 500, { error: 'Внутренняя ошибка' });
    }
  }
}

function createMiniAppServer() {
  return http.createServer(handleMiniAppRequest);
}

// Запрос пришёл на адрес приложения (а не панели)? Приложение и панель могут жить на одном порту: вход в панель закрыт для
// сети, поэтому адрес приложения отдаёт только приложение и больше ничего.
function miniAppHostMatches(req) {
  const settings = miniAppSettings();
  if (!settings.enabled) return false;
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  // Адрес панели приложению не отдаём ни при каких настройках: лучше приложение не откроется, чем пропадёт панель.
  if (ADMIN_ALLOWED_HOSTS.has(host) || host === String(data.config.tunnelHostname || '').trim().toLowerCase()) return false;
  try {
    return host !== '' && host === new URL(settings.url).hostname.toLowerCase();
  } catch {
    return false;
  }
}

let server = null;

function startMiniApp() {
  if (server) return server;
  const port = Number(process.env.MINIAPP_PORT || 3001);
  const host = process.env.MINIAPP_HOST || '127.0.0.1';
  server = createMiniAppServer();
  server.on('error', (error) => {
    console.error('Mini App не запущен:', error.message);
    server = null;
  });
  server.listen(port, host, () => console.log('  Mini App: http://' + host + ':' + port + ' (за обратным прокси с HTTPS)'));
  return server;
}

function stopMiniApp() {
  if (!server) return;
  const closing = server;
  server = null;
  try {
    closing.close();
    closing.closeAllConnections && closing.closeAllConnections();
  } catch {
    // уже закрыт
  }
}

// Привести запущенный сервер в соответствие с настройками: включён и есть адрес — слушаем, иначе закрыт.
// Отдельный порт нужен только если он задан явно (MINIAPP_PORT); обычно приложение отвечает на порту панели по своему адресу.
function syncMiniApp() {
  const settings = miniAppSettings();
  if (settings.enabled && process.env.MINIAPP_PORT) startMiniApp();
  else stopMiniApp();
}

export { createMiniAppServer, handleMiniAppRequest, miniAppHostMatches, miniAppSettings, startMiniApp, stopMiniApp, syncMiniApp };
