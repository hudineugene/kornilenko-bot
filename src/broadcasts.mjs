// Рассылки.

import { cleanText, delay, fillTemplate } from './util.mjs';
import { imageExists } from './media.mjs';
import { configured, data, runtime, saveDataNow, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { sendMessage, sendPhotoMessage } from './telegram.mjs';
import { localized, validHttpUrl } from './catalog.mjs';

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

export {
  broadcastUsers,
  deliverBroadcast,
  runBroadcast,
  runDueBroadcasts,
  userUnavailableError,
};
