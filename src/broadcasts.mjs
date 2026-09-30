// Рассылки.

import { cleanText, delay, fillTemplate } from './util.mjs';
import { PIPELINE_STAGES, normalizePipelineStage } from './data-format.mjs';
import { imageExists } from './media.mjs';
import { PROPERTY_ACTION_TEXT, SUBSCRIPTION_TEXT } from './texts.mjs';
import { configured, data, runtime, saveDataNow, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { markUnavailable } from './users.mjs';
import { sendMessage, sendPhotoMessage } from './telegram.mjs';
import { escapeTelegramHtml, localized, objectCaptionHtml, propertyReadyForLanguage, recordImages, validHttpUrl } from './catalog.mjs';

function broadcastUsers(entry) {
  const languages = Array.isArray(entry.languages) ? entry.languages.filter((language) => ['ru', 'en', 'es'].includes(language)) : [];
  const requiredTags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).toLocaleLowerCase('ru-RU')) : [];
  const pipelineStages = Array.isArray(entry.pipelineStages) ? entry.pipelineStages.filter((stage) => PIPELINE_STAGES.includes(stage)) : [];
  const sources = Array.isArray(entry.sources) ? entry.sources.map((source) => String(source).toLocaleLowerCase('ru-RU')) : [];
  const propertyId = String(entry.propertyId || '');
  const propertySignal = ['favorite', 'comparison', 'viewed', 'match', 'inquiry'].includes(entry.propertySignal) ? entry.propertySignal : 'any';
  const latestByUser = new Map();
  const propertyInquiryUsers = new Set();
  if (pipelineStages.length || propertyId) {
    for (const inquiry of data.inquiries) {
      const userId = String(inquiry.userId || '');
      if (propertyId && String(inquiry.propertyId || '') === propertyId) propertyInquiryUsers.add(userId);
      if (!pipelineStages.length || !userId) continue;
      const previous = latestByUser.get(userId);
      if (!previous || (Date.parse(inquiry.updatedAt || inquiry.createdAt) || 0) > (Date.parse(previous.updatedAt || previous.createdAt) || 0)) latestByUser.set(userId, inquiry);
    }
  }
  function includesProperty(values) {
    return Array.isArray(values) && values.some((value) => String(value) === propertyId);
  }
  function propertySignals(user) {
    const signals = [];
    if (includesProperty(user.favorites)) signals.push('favorite');
    if (includesProperty(user.comparisonIds)) signals.push('comparison');
    if (includesProperty(user.recentlyViewed)) signals.push('viewed');
    if (includesProperty(user.selectionMatchIds)) signals.push('match');
    if (propertyInquiryUsers.has(String(user.id))) signals.push('inquiry');
    return signals;
  }
  return Object.values(data.users).filter((user) => {
    // Рассылка уходит только тем, кто сам включил «Новости и акции».
    if (user.blocked || !user.chatId || user.broadcastsOptOut || !user.newsConsentAt) return false;
    if (languages.length && !languages.includes(user.preferredLanguage || 'ru')) return false;
    if (requiredTags.length) {
      const userTags = (user.tags || []).map((tag) => String(tag).toLocaleLowerCase('ru-RU'));
      if (!requiredTags.some((tag) => userTags.includes(tag))) return false;
    }
    if (sources.length && !sources.includes(String(user.source || '').toLocaleLowerCase('ru-RU'))) return false;
    if (pipelineStages.length) {
      const latest = latestByUser.get(String(user.id));
      if (!latest || !pipelineStages.includes(normalizePipelineStage(latest.pipelineStage, latest))) return false;
    }
    if (propertyId) {
      const signals = propertySignals(user);
      if (!signals.length || (propertySignal !== 'any' && !signals.includes(propertySignal))) return false;
    }
    return true;
  });
}

// Длинный текст с фотографией уходит двумя сообщениями. Если связь оборвалась
// между ними, рассылка продолжится с этого же получателя — и фотография ушла бы
// ему второй раз. Поэтому запоминаем тех, кому снимок уже доставлен, а текст
// ещё нет. Список короткий: запись живёт от одного сообщения до другого.
function photoAheadOfText(entry) {
  entry.photoOnlyUserIds = Array.isArray(entry.photoOnlyUserIds) ? entry.photoOnlyUserIds.map(String) : [];
  return entry.photoOnlyUserIds;
}

function rememberPhotoSent(entry, user) {
  const waiting = photoAheadOfText(entry);
  const id = String(user.id);
  if (!waiting.includes(id)) waiting.push(id);
}

function forgetPhotoSent(entry, user) {
  const waiting = photoAheadOfText(entry);
  const index = waiting.indexOf(String(user.id));
  if (index >= 0) waiting.splice(index, 1);
}

// Карточка объекта в рассылке: та же фотография и те же кнопки, что в
// каталоге, — клиент может посмотреть подробности и записаться, не уходя из
// сообщения. Текст рассылки идёт первой строкой подписи.
// Подпись к фото ограничена 1024 знаками. Резать по «голому» индексу нельзя:
// эмодзи в Telegram занимает два знака (суррогатную пару), и разрезанная
// пополам пара превращается в «�». Режем по границе слова и не оставляем
// висящих «клеящих» символов.
const CAPTION_LIMIT = 1024;
function fitCaption(text, limit = CAPTION_LIMIT) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  let end = limit - 1;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
  let slice = value.slice(0, end);
  const boundary = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
  if (boundary > end - 200) slice = slice.slice(0, boundary);
  return slice.replace(/[\s‍️]+$/u, '') + '…';
}

// Подпись и кнопки карточки в рассылке. Отдельной функцией, чтобы предпросмотр в панели показывал ровно то же.
function broadcastCardContent(record, language, intro) {
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  // Если всё не помещается, сокращаем вступление рассылки, а не описание объекта.
  // Тот же вид, что у карточки в каталоге: заголовок жирным, тип курсивом, цена жирной. Длину считаем по
  // простому тексту, вступление экранируем — разметка не должна порваться на обрезке.
  // Берём длину с разметкой (она больше): так подпись укладывается в лимит при любом способе счёта.
  const card = objectCaptionHtml(record, language);
  const introRoom = CAPTION_LIMIT - card.length - 2;
  const introText = introRoom >= 20 ? fitCaption(intro, introRoom) : '';
  const caption = [introText ? escapeTelegramHtml(introText) : '', card].filter(Boolean).join('\n\n');
  const unsubscribe = { text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).unsubscribe, callback_data: 'subs:news:off:bc' };
  const rows = [];
  if (record.status === 'active') rows.push([{ text: '📅 ' + copy.viewing, callback_data: 'property:viewing:' + record.id }]);
  rows.push([{ text: 'ℹ️ ' + copy.details, callback_data: 'property:card:' + record.id }]);
  rows.push([unsubscribe]);
  return { caption, markup: { inline_keyboard: rows } };
}

async function deliverPropertyCard(user, entry, record, token) {
  const language = user.preferredLanguage || 'ru';
  const intro = fillTemplate(localized(entry.messages, language), user);
  const { caption, markup } = broadcastCardContent(record, language, intro);
  const images = recordImages(record, language);
  if (images.length) return sendPhotoMessage(user.chatId, images[0], caption, token, markup, { parseMode: 'HTML' });
  return sendMessage(user.chatId, caption, token, { reply_markup: markup, parse_mode: 'HTML' });
}

async function deliverBroadcast(user, entry, token = data.config.botToken) {
  const language = user.preferredLanguage || 'ru';
  // Карточкой шлём только тем, у кого объект готов на их языке: иначе клиент
  // получит пустую карточку.
  if (entry.sendAsCard && entry.propertyId) {
    const record = data.objects.find((item) => item.id === entry.propertyId);
    // Скрытый, проданный или снятый объект карточкой не рассылаем: картинка
    // ушла бы, а «Подробнее» ответило бы «устарело». Уходит обычный текст.
    if (record && ['active', 'reserved'].includes(record.status) && propertyReadyForLanguage(record, language)) return deliverPropertyCard(user, entry, record, token);
  }
  const text = fillTemplate(localized(entry.messages, language), user);
  const url = validHttpUrl(entry.buttonUrl);
  const buttonText = localized(entry.buttonText, language);
  // Every broadcast can be unsubscribed from with one tap.
  const unsubscribe = { text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).unsubscribe, callback_data: 'subs:news:off:bc' };
  const markup = { inline_keyboard: [...(url && buttonText ? [[{ text: buttonText, url }]] : []), [unsubscribe]] };
  if (imageExists(entry.image)) {
    if (text.length <= 1000) await sendPhotoMessage(user.chatId, entry.image, text, token, markup);
    else {
      if (!photoAheadOfText(entry).includes(String(user.id))) {
        await sendPhotoMessage(user.chatId, entry.image, '', token, null);
        rememberPhotoSent(entry, user);
      }
      await sendMessage(user.chatId, text, token, markup ? { reply_markup: markup } : {});
      forgetPhotoSent(entry, user);
    }
  } else {
    await sendMessage(user.chatId, text, token, markup ? { reply_markup: markup } : {});
  }
}

// Telegram does not tell the bot when a link button is pressed, so a
// broadcast is measured by what recipients did within three days: wrote or
// pressed something in the bot, sent a request, unsubscribed. Each person
// counts once per broadcast.
const BROADCAST_RESPONSE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const BROADCAST_RESPONSE_FIELDS = { response: 'respondedUserIds', inquiry: 'inquiryUserIds', unsubscribe: 'unsubscribedUserIds' };

function rememberBroadcastDelivery(user, entry, now = new Date()) {
  user.lastBroadcast = { id: String(entry.id), at: now.toISOString() };
}

function recordBroadcastResponse(user, kind, now = Date.now()) {
  const last = user && user.lastBroadcast;
  const field = BROADCAST_RESPONSE_FIELDS[kind];
  if (!field || !last || !last.id || !(now - Date.parse(last.at) <= BROADCAST_RESPONSE_WINDOW_MS)) return false;
  const entry = data.broadcasts.find((item) => item.id === last.id);
  if (!entry) return false;
  entry[field] = Array.isArray(entry[field]) ? entry[field] : [];
  const id = String(user.id);
  if (entry[field].includes(id)) return false;
  entry[field].push(id);
  scheduleSave();
  return true;
}

function userUnavailableError(error) {
  if (error && error.telegramCode === 403) return true;
  if (!error || error.telegramCode !== 400) return false;
  const message = String(error.message || '').toLocaleLowerCase('en-US');
  return message.includes('chat not found') || message.includes('user is deactivated');
}

// Связь пропала, Telegram ответил 5xx или попросил подождать: получатель не
// виноват, отправлять ему заново можно. Рассылка встаёт в очередь и продолжится
// сама, когда связь вернётся (runDueBroadcasts проверяет каждые 30 секунд).
function temporaryDeliveryError(error) {
  if (!error) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const code = Number(error.telegramCode);
  const status = Number(error.status);
  if (code === 429 || status === 429) return true;
  if (status >= 500 || code >= 500) return true;
  // Сетевые ошибки приходят без кода Telegram: сюда попадают обрывы связи.
  return !Number.isFinite(code) && !Number.isFinite(status);
}

// Сохранение хода рассылки не должно её обрывать: если диск занят, бот уже
// записал это в журнал и назначил повтор, а рассылка идёт дальше. Раньше
// сбой записи выбрасывал ошибку из цикла, рассылка получала статус «не
// удалось», и остальные получатели не получали ничего.
function saveBroadcastProgress() {
  try {
    saveDataNow();
    return true;
  } catch {
    return false;
  }
}

async function runBroadcast(entry) {
  if (runtime.broadcastRunning) throw new Error('Рассылка уже выполняется');
  runtime.broadcastRunning = true;
  entry.status = 'running';
  entry.startedAt = entry.startedAt || new Date().toISOString();
  // Broadcasts sent by older versions have no response counts.
  entry.tracksResponses = true;
  entry.sent = Number(entry.sent || 0);
  entry.failed = Number(entry.failed || 0);
  entry.processedUserIds = Array.isArray(entry.processedUserIds) ? entry.processedUserIds.map(String) : [];
  entry.failures = Array.isArray(entry.failures) ? entry.failures : [];
  const processed = new Set(entry.processedUserIds);
  const users = broadcastUsers(entry);
  entry.total = Math.max(Number(entry.total || 0), users.length);
  saveBroadcastProgress();
  let lastProgressSaveAt = Date.now();

  try {
    for (const user of users) {
      if (processed.has(String(user.id))) continue;
      try {
        await deliverBroadcast(user, entry);
        entry.sent += 1;
        rememberBroadcastDelivery(user, entry);
      } catch (error) {
        if (temporaryDeliveryError(error)) {
          // Не считаем неудачей и не помечаем получателя обработанным:
          // рассылка продолжится с него же.
          entry.status = 'queued';
          entry.pausedAt = new Date().toISOString();
          entry.error = cleanText('Связь с Telegram потеряна, рассылка продолжится сама: ' + error.message, 400);
          recordError('Рассылка приостановлена', error);
          saveBroadcastProgress();
          return;
        }
        entry.failed += 1;
        if (userUnavailableError(error)) markUnavailable(user);
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
        saveBroadcastProgress();
        lastProgressSaveAt = Date.now();
      }
      await delay(45);
    }
    entry.status = 'done';
    entry.error = '';
    entry.pausedAt = '';
    entry.finishedAt = new Date().toISOString();
  } finally {
    runtime.broadcastRunning = false;
    saveBroadcastProgress();
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

export {
  broadcastCardContent,
  BROADCAST_RESPONSE_FIELDS,
  BROADCAST_RESPONSE_WINDOW_MS,
  broadcastUsers,
  deliverBroadcast,
  recordBroadcastResponse,
  rememberBroadcastDelivery,
  runBroadcast,
  runDueBroadcasts,
  temporaryDeliveryError,
  userUnavailableError,
};
