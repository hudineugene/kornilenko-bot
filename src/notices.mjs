// Ежедневная сводка и напоминания администратору о заявках без ответа.

import { cleanText, dayKey } from './util.mjs';
import { MENU_LABELS } from './texts.mjs';
import { data, saveDataNow, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { userByChatId, userById } from './users.mjs';
import { sendMessage } from './telegram.mjs';
import { inquiryStatusMarkup, inquiryTypeLabel, rememberAdminReplyTarget } from './inquiries.mjs';
import { localized, shortenedText } from './catalog.mjs';
import { runViewingNotices } from './viewings.mjs';
import { adminMessagesAllowed, adminMorningHour } from './hours.mjs';

const DIGEST_HOUR = 9;

// In "only inquiries" mode the admin gets yesterday's activity once a day,
// after DIGEST_HOUR local time, instead of a message per click.
function activityDigest(dayKeyValue) {
  const daily = data.analytics.daily[dayKeyValue] || {};
  const newcomers = Object.values(data.users).filter((user) => String(user.firstSeenAt || '').slice(0, 10) === dayKeyValue);
  const newUsers = newcomers.length;
  const bySource = new Map();
  for (const user of newcomers) bySource.set(user.source || 'без метки', (bySource.get(user.source || 'без метки') || 0) + 1);
  const sources = bySource.size > 1 || !bySource.has('без метки')
    ? Array.from(bySource).sort((a, b) => b[1] - a[1]).map(([name, count]) => name + ' — ' + count).join(', ')
    : '';
  const sections = Object.entries(daily.menu || {})
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => String(MENU_LABELS.ru[key] || key).replace(/^[^\p{L}\p{N}]+/u, '') + ' — ' + count);
  const received = Number(daily.received || 0);
  const inquiries = Number(daily.inquiries || 0);
  if (!newUsers && !received && !inquiries && !sections.length) return '';
  const [year, month, day] = dayKeyValue.split('-');
  return [
    '📊 Активность за ' + day + '.' + month + '.' + year,
    '',
    'Новых пользователей: ' + newUsers + (sources ? ' (' + sources + ')' : ''),
    'Сообщений от клиентов: ' + received,
    'Новых обращений: ' + inquiries,
    ...(sections.length ? ['', 'Открывали разделы:', ...sections.map((line) => '• ' + line)] : []),
  ].join('\n');
}

async function runDailyDigest(now = new Date()) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (data.config.notifyMode !== 'inquiries' || !adminChatId || !data.config.botToken || now.getHours() < adminMorningHour(DIGEST_HOUR)) return '';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = dayKey(yesterday);
  if (data.lastDigestFor === key) return '';
  const text = activityDigest(key);
  data.lastDigestFor = key;
  scheduleSave();
  if (text) await sendMessage(adminChatId, text, data.config.botToken, { track: false });
  return text;
}

function runDailyDigestSafely() {
  runDailyDigest().catch((error) => recordError('Сводка активности', error));
}

const REMINDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REMINDERS_PER_RUN = 5;

function hoursAgoText(milliseconds) {
  const hours = Math.floor(milliseconds / (60 * 60 * 1000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return days + ' ' + (days % 10 === 1 && days % 100 !== 11 ? 'день' : [2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100) ? 'дня' : 'дней');
  }
  return hours + ' ч';
}

// An inquiry nobody has taken yet: still "new", no reply from the panel or
// Telegram. Once reminded, it is not reminded again.
function inquiryNeedsReminder(inquiry, now, thresholdMs) {
  if (inquiry.status !== 'new' || inquiry.remindedAt) return false;
  if (Array.isArray(inquiry.replies) && inquiry.replies.length) return false;
  const age = now - Date.parse(inquiry.createdAt);
  return Number.isFinite(age) && age >= thresholdMs && age <= REMINDER_MAX_AGE_MS;
}

// Checked every 15 minutes; sends nothing outside office hours (or at night,
// when no hours are set), so an inquiry that went unanswered overnight is
// reminded about in the morning. Each reminder is a separate message: the
// admin can reply to it or press a status button.
async function runInquiryReminders(now = new Date()) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  const hours = Number(data.config.reminderHours);
  if (!hours || !adminChatId || !data.config.botToken) return [];
  if (!adminMessagesAllowed(now)) return [];
  const due = data.inquiries
    .filter((inquiry) => inquiryNeedsReminder(inquiry, now.getTime(), hours * 60 * 60 * 1000))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (!due.length) return [];
  const sent = [];
  for (const inquiry of due.slice(0, REMINDERS_PER_RUN)) {
    const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
    const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени' : 'Пользователь удалён';
    const username = user && user.username ? ' (@' + user.username + ')' : '';
    const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
    const text = [
      '⏰ Нет ответа ' + hoursAgoText(now.getTime() - Date.parse(inquiry.createdAt)) + ': ' + inquiryTypeLabel(inquiry),
      '👤 ' + name + username + (inquiry.language ? ' · ' + inquiry.language.toUpperCase() : ''),
      '',
      ...(property ? ['🏠 ' + (localized(property.title, inquiry.language) || property.reference || property.id)] : []),
      shortenedText(inquiry.text, 500),
      ...(user ? ['', '↩️ Ответьте на это сообщение — ответ получит клиент.'] : []),
    ].join('\n');
    const messageIds = [];
    await sendMessage(adminChatId, text, data.config.botToken, { track: false, messageIds, reply_markup: inquiryStatusMarkup(inquiry) });
    if (user) rememberAdminReplyTarget(messageIds, { chatId: user.chatId, inquiryId: inquiry.id, sourceMessageId: inquiry.sourceMessageId });
    inquiry.remindedAt = now.toISOString();
    sent.push(inquiry.id);
  }
  const rest = due.length - sent.length;
  if (rest > 0) {
    await sendMessage(adminChatId, '⏰ И ещё ' + rest + ' без ответа — они в панели, раздел «Обращения».', data.config.botToken, { track: false });
    for (const inquiry of due.slice(REMINDERS_PER_RUN)) inquiry.remindedAt = now.toISOString();
  }
  saveDataNow();
  return sent;
}

function runScheduledNotices() {
  runDailyDigest().catch((error) => recordError('Сводка активности', error));
  runInquiryReminders().catch((error) => recordError('Напоминание об обращениях', error));
  runViewingNotices().catch((error) => recordError('Уведомления о просмотрах', error));
}

export {
  DIGEST_HOUR,
  REMINDERS_PER_RUN,
  REMINDER_MAX_AGE_MS,
  activityDigest,
  hoursAgoText,
  inquiryNeedsReminder,
  runDailyDigest,
  runDailyDigestSafely,
  runInquiryReminders,
  runScheduledNotices,
};
