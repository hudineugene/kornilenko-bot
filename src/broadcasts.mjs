// Рассылки.

import { cleanText, delay, fillTemplate } from './util.mjs';
import { PIPELINE_STAGES, normalizePipelineStage } from './data-format.mjs';
import { imageExists } from './media.mjs';
import { SUBSCRIPTION_TEXT } from './texts.mjs';
import { configured, data, runtime, saveDataNow, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { markUnavailable } from './users.mjs';
import { sendMessage, sendPhotoMessage } from './telegram.mjs';
import { localized, validHttpUrl } from './catalog.mjs';

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
    if (user.blocked || !user.chatId || user.broadcastsOptOut) return false;
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

async function deliverBroadcast(user, entry, token = data.config.botToken) {
  const language = user.preferredLanguage || 'ru';
  const text = fillTemplate(localized(entry.messages, language), user);
  const url = validHttpUrl(entry.buttonUrl);
  const buttonText = localized(entry.buttonText, language);
  // Every broadcast can be unsubscribed from with one tap.
  const unsubscribe = { text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).unsubscribe, callback_data: 'subs:news:off:bc' };
  const markup = { inline_keyboard: [...(url && buttonText ? [[{ text: buttonText, url }]] : []), [unsubscribe]] };
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
  saveDataNow();
  let lastProgressSaveAt = Date.now();

  try {
    for (const user of users) {
      if (processed.has(String(user.id))) continue;
      try {
        await deliverBroadcast(user, entry);
        entry.sent += 1;
        rememberBroadcastDelivery(user, entry);
      } catch (error) {
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

export {
  BROADCAST_RESPONSE_FIELDS,
  BROADCAST_RESPONSE_WINDOW_MS,
  broadcastUsers,
  deliverBroadcast,
  recordBroadcastResponse,
  rememberBroadcastDelivery,
  runBroadcast,
  runDueBroadcasts,
  userUnavailableError,
};
