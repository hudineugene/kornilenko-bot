// Запросы к Telegram Bot API и отправка сообщений и фото.

import { TELEGRAM_MESSAGE_LIMIT } from './config.mjs';
import { cleanText, delay } from './util.mjs';
import { forEachStoredImage, imageBytes, imageExists, storedImageFile } from './media.mjs';
import { data, runtime, scheduleSave } from './store.mjs';
import { recordActivity, recordDaily } from './analytics.mjs';
import { userByChatId } from './users.mjs';

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
    // «message is not modified»: сообщение уже выглядит так, как мы просим
    // (нажали на текущий номер «2 / 5», повторно на ту же кнопку). Это не сбой:
    // раньше ошибка сбрасывала кэш file_id и заставляла присылать дубль карточки.
    if (String(method).startsWith('editMessage') && /message is not modified/i.test(String(body && body.description || ''))) return true;
    throw normalizeTelegramError(
      new Error((body && body.description) || 'Telegram API error'),
      response.status,
      body && body.error_code
    );
  }
}

// Экран бота с кнопками: первая строка — «значок Название» — выделяется жирным. Разметку (parse_mode) не включаем: тексты
// экранов приходят простыми, и любой знак «<» в них сломал бы отправку; жирность даёт entity, текст не меняется.
// Заголовок — короткая первая строка со значка, без точки на конце (иначе это уже инструкция), за ней ещё текст.
function screenTitleEntities(payload) {
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  if (!text || payload.parse_mode || !payload.reply_markup || !Array.isArray(payload.reply_markup.inline_keyboard)) return null;
  const end = text.indexOf('\n');
  if (end < 2 || end > 60) return null;
  const line = text.slice(0, end);
  if (!/^(\p{Extended_Pictographic}|⋯)/u.test(line) || /[.:!…»]$/.test(line.trimEnd())) return null;
  // Ссылки-подписи (карты, WhatsApp) уже лежат в entities: заголовок добавляем к ним, если они его не задевают.
  const existing = Array.isArray(payload.entities) ? payload.entities : [];
  if (existing.some((item) => item.offset < line.length)) return null;
  return [{ type: 'bold', offset: 0, length: line.length }, ...existing];
}

// Строка «Открыть карту: https://…» и «Быстрее — в WhatsApp: https://wa.me/…» показывает клиенту голый адрес в пол-экрана.
// Заменяем её словами-ссылкой: текст остаётся подписью, адрес уходит в entity text_link. Только известные адреса карт и
// WhatsApp; смещения уже стоящих entities сдвигаем. Разметку (parse_mode) не трогаем.
const LABELLED_LINK = /^(.{2,60}?):[ \t]+(https:\/\/(?:wa\.me|api\.whatsapp\.com|www\.google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps|www\.openstreetmap\.org)[^\s]*)$/;
function labelledLinks(payload) {
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  if (!text || payload.parse_mode || !/https:\/\//.test(text)) return null;
  const links = [];
  const cuts = [];
  let read = 0;
  let written = 0;
  const out = text.split('\n').map((line) => {
    const found = LABELLED_LINK.exec(line);
    const kept = found ? found[1] : line;
    if (found) {
      links.push({ type: 'text_link', offset: written, length: kept.length, url: found[2] });
      cuts.push({ end: read + line.length, cut: line.length - kept.length });
    }
    read += line.length + 1;
    written += kept.length + 1;
    return kept;
  });
  if (!links.length) return null;
  const shift = (position) => cuts.reduce((sum, item) => (item.end <= position ? sum + item.cut : sum), 0);
  const moved = (payload.entities || []).map((entity) => ({ ...entity, offset: entity.offset - shift(entity.offset) }));
  return { text: out.join('\n'), entities: [...moved, ...links] };
}

async function telegramRequest(token, method, payload, signal) {
  // Пустые кнопки (null, false) в запрос не кладём: «reply_markup»: null Telegram считает не объектом и отвечает
  // «object expected as reply markup». Фото по file_id уходит JSON-запросом, поэтому ошибка появлялась только
  // при повторной отправке уже загруженной картинки — например, в канал сразу после проверки себе.
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'reply_markup') && !payload.reply_markup) {
    const { reply_markup: ignored, ...rest } = payload;
    payload = rest;
  }
  if (payload && (method === 'sendMessage' || method === 'editMessageText')) {
    const linked = labelledLinks(payload);
    if (linked) payload = { ...payload, ...linked };
    const entities = screenTitleEntities(payload);
    if (entities) payload = { ...payload, entities };
  }
  // Long polling holds the request open for payload.timeout seconds.
  const timeoutMs = TELEGRAM_REQUEST_TIMEOUT_MS + (Number(payload && payload.timeout) || 0) * 1000;
  const result = await telegramCall(token, method, () => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }), { signal, timeoutMs });
  notifySent(method, payload, result);
  return result;
}

// Журнал переписки (agent-journal.mjs): что бот отправил клиенту. Хук ставит сам журнал — здесь без импорта.
let sentHook = null;
function setSentHook(hook) {
  sentHook = hook;
}
function notifySent(method, payload, result) {
  if (!sentHook) return;
  try { sentHook(method, payload, result); } catch { /* журнал не мешает отправке */ }
}

async function telegramMultipartRequest(token, method, fields) {
  const result = await telegramCall(token, method, () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value == null || value === '' || (key === 'reply_markup' && !value)) continue;
      if (value && typeof value === 'object' && value.upload instanceof Blob) form.append(key, value.upload, value.fileName || 'file');
      else form.append(key, typeof value === 'string' || value instanceof Blob ? value : JSON.stringify(value));
    }
    return { body: form };
  }, { timeoutMs: TELEGRAM_UPLOAD_TIMEOUT_MS });
  notifySent(method, fields, result);
  return result;
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

// Ошибка именно про сохранённый file_id: он устарел, принадлежит другому боту
// или файла в Telegram больше нет — тогда идентификатор надо забыть и загрузить
// файл заново. Всё остальное (клиент заблокировал бота, чат не найден, нет
// связи) к file_id отношения не имеет: если забывать его и там, рассылка после
// первого же заблокировавшего клиента начнёт грузить фотографию заново каждому
// получателю — это мегабайты и минуты на ровном месте.
function staleFileIdError(error) {
  const telegramCode = Number(error && error.telegramCode);
  const status = Number(error && error.status);
  if (telegramCode !== 400 && status !== 400) return false;
  const message = String((error && error.message) || '').toLocaleLowerCase('en-US');
  return ['file', 'media', 'photo', 'thumb'].some((word) => message.includes(word));
}

// options.captionAbove ставит подпись над фотографией: так картинка-плашка
// оказывается внизу сообщения (Telegram Bot API, show_caption_above_media).
async function sendPhotoMessage(chatId, image, caption, token, replyMarkup, options = {}) {
  let result;
  const captionAbove = options.captionAbove ? true : undefined;
  const parseMode = options.parseMode || undefined;
  const fileId = knownFileId(image);
  if (fileId) {
    try {
      result = await telegramRequest(token, 'sendPhoto', {
        chat_id: chatId,
        photo: fileId,
        caption: caption || undefined,
        parse_mode: parseMode,
        show_caption_above_media: captionAbove,
        message_thread_id: options.threadId || undefined,
        reply_parameters: options.replyParameters || undefined,
        reply_markup: replyMarkup,
      });
    } catch (error) {
      if (!staleFileIdError(error)) throw error;
      rememberFileId(image, '');
    }
  }
  if (!result) {
    const bytes = imageBytes(image);
    result = await telegramMultipartRequest(token, 'sendPhoto', {
      chat_id: String(chatId),
      photo: new Blob([bytes], { type: image.mimeType }),
      caption: caption || undefined,
      parse_mode: parseMode,
      show_caption_above_media: captionAbove,
      message_thread_id: options.threadId ? String(options.threadId) : undefined,
      reply_parameters: options.replyParameters || undefined,
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

// Альбом из 2–10 фотографий одним сообщением; подпись — под первой. Уже загруженные фотографии идут по file_id,
// остальные — файлами. Если Telegram не принял чей-то file_id, весь альбом уходит заново файлами.
async function sendPhotoAlbum(chatId, images, caption, token, options = {}) {
  const list = (Array.isArray(images) ? images : []).slice(0, 10);
  if (list.length < 2) throw new Error('В альбоме нужно хотя бы две фотографии');
  async function attempt(useFileIds) {
    const files = {};
    const media = list.map((image, index) => {
      const fileId = useFileIds ? knownFileId(image) : '';
      const item = { type: 'photo', media: fileId || 'attach://photo' + index };
      if (!fileId) files['photo' + index] = { upload: new Blob([imageBytes(image)], { type: image.mimeType }), fileName: String(image.name || 'photo' + index + '.jpg') };
      if (index === 0 && caption) {
        item.caption = caption;
        if (options.parseMode) item.parse_mode = options.parseMode;
      }
      return item;
    });
    return telegramMultipartRequest(token, 'sendMediaGroup', {
      chat_id: String(chatId),
      media: JSON.stringify(media),
      message_thread_id: options.threadId ? String(options.threadId) : undefined,
      reply_parameters: options.replyParameters || undefined,
      ...files,
    });
  }
  let result;
  try {
    result = await attempt(true);
  } catch (error) {
    if (!staleFileIdError(error)) throw error;
    for (const image of list) rememberFileId(image, '');
    result = await attempt(false);
  }
  (Array.isArray(result) ? result : []).forEach((message, index) => {
    if (message && Array.isArray(message.photo) && message.photo.length && list[index]) rememberFileId(list[index], message.photo[message.photo.length - 1].file_id);
  });
  data.stats.messagesSent += list.length;
  recordDaily('sent');
  scheduleSave();
  return Array.isArray(result) ? result : [];
}

// PNG с прозрачностью Telegram сохраняет только как файл (документ).
// Голосовое (OGG/Opus) — ответ консультанта на голосовое клиента; подпись — тот же текст.
async function sendVoiceMessage(chatId, audio, token = data.config.botToken, options = {}) {
  const result = await telegramMultipartRequest(token, 'sendVoice', {
    chat_id: String(chatId),
    voice: { upload: new Blob([audio], { type: 'audio/ogg' }), fileName: 'reply.ogg' },
    caption: options.caption || undefined,
    reply_markup: options.reply_markup,
  });
  data.stats.messagesSent += 1;
  recordDaily('sent');
  return result;
}

async function sendDocumentMessage(chatId, image, caption, token, replyMarkup, options = {}) {
  const bytes = imageBytes(image);
  const name = String(image.name || 'document').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'document';
  const result = await telegramMultipartRequest(token, 'sendDocument', {
    chat_id: String(chatId),
    document: { upload: new Blob([bytes], { type: image.mimeType || 'application/octet-stream' }), fileName: name },
    caption: caption || undefined,
    parse_mode: options.parseMode || undefined,
    message_thread_id: options.threadId ? String(options.threadId) : undefined,
    reply_parameters: options.replyParameters || undefined,
    reply_markup: replyMarkup,
  });
  data.stats.messagesSent += 1;
  recordDaily('sent');
  recordActivity(userByChatId(chatId), 'out', caption || '[Файл]', 'document', { messageId: result && result.message_id });
  scheduleSave();
  return result;
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

export {
  labelledLinks,
  setSentHook,
  screenTitleEntities,
  staleFileIdError,
  TELEGRAM_MAX_RETRY_AFTER_SECONDS,
  TELEGRAM_RATE_LIMIT_RETRIES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TELEGRAM_UPLOAD_TIMEOUT_MS,
  forgetTelegramFileIds,
  knownFileId,
  markTelegramFailure,
  markTelegramSuccess,
  normalizeTelegramError,
  rememberFileId,
  sendMessage,
  sendDocumentMessage,
  sendVoiceMessage,
  sendPhotoAlbum,
  sendPhotoMessage,
  splitTelegramText,
  telegramCall,
  telegramErrorCode,
  telegramErrorMessage,
  telegramFileIds,
  telegramMultipartRequest,
  telegramRequest,
};
