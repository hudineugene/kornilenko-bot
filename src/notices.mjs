// Ежедневная сводка и напоминания администратору о заявках без ответа.

import { cleanText, dayKey, localDayKey } from './util.mjs';
import { MENU_LABELS } from './texts.mjs';
import { data, saveDataNow, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { userByChatId, userById } from './users.mjs';
import { sendMessage } from './telegram.mjs';
import { awaitingReply, inquiryChats, inquiryStatusMarkup, inquiryTypeLabel, rememberAdminReplyTarget } from './inquiries.mjs';
import { localized, shortenedText } from './catalog.mjs';
import { runViewingNotices } from './viewings.mjs';
import { adminMessagesAllowed, adminMorningHour } from './hours.mjs';
import { runFormReminders } from './forms.mjs';
import { runTelegramBackup } from './offsite.mjs';
import { runDailyFeedImport } from './feed-import.mjs';

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
  if (hours < 1) return Math.max(1, Math.floor(milliseconds / 60000)) + ' мин';
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

// An inquiry brought back to the admin chat (a reminder, a planned follow-up):
// the admin can reply to it or press a status button, as under the first
// notification.
async function sendInquiryToAdministrator(inquiry, heading, extraLines = [], options = {}) {
  const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени' : 'Пользователь удалён';
  const username = user && user.username ? ' (@' + user.username + ')' : '';
  const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  const text = [
    heading,
    '👤 ' + name + username + (inquiry.language ? ' · ' + inquiry.language.toUpperCase() : '') + (user && user.phone ? ' · ' + user.phone : ''),
    '',
    ...(property ? ['🏠 ' + (localized(property.title, inquiry.language) || property.reference || property.id)] : []),
    shortenedText(inquiry.text, 500),
    ...extraLines,
    ...(user ? ['', '↩️ Ответьте на это сообщение — ответ получит клиент.'] : []),
  ].join('\n');
  // The main admin and every manager: whoever is free can answer. A planned
  // follow-up goes to the one who took the inquiry.
  // Returns how many chats got it: a reminder nobody received is tried again.
  const sendTo = async (chats) => {
    let delivered = 0;
    for (const chat of chats) {
      const messageIds = [];
      try {
        await sendMessage(chat.chatId, text, data.config.botToken, { track: false, messageIds, reply_markup: inquiryStatusMarkup(inquiry) });
      } catch (error) {
        recordError(chat.main ? 'Напоминание администратору' : 'Напоминание менеджеру ' + chat.name, error);
        continue;
      }
      delivered += 1;
      if (user) rememberAdminReplyTarget(messageIds, { chatId: user.chatId, inquiryId: inquiry.id, sourceMessageId: inquiry.sourceMessageId }, chat.chatId);
    }
    return delivered;
  };
  const assigned = options.onlyAssignee && inquiry.assignee ? inquiryChats().filter((chat) => chat.name === inquiry.assignee) : [];
  // /inbox: only the chat that asked.
  if (options.chats) return sendTo(options.chats);
  let delivered = await sendTo(assigned.length ? assigned : inquiryChats());
  // The one who took the inquiry did not get it: the others hear about it.
  if (!delivered && assigned.length) delivered = await sendTo(inquiryChats().filter((chat) => !assigned.includes(chat)));
  return delivered;
}

// A follow-up is due on its day: at the time the admin chose, otherwise at
// the start of the working day.
function followUpDue(inquiry, now) {
  if (!inquiry.followUpDate || inquiry.followUpNotifiedAt || inquiry.status === 'closed') return false;
  const today = localDayKey(now);
  if (inquiry.followUpDate > today) return false;
  if (inquiry.followUpTime) {
    if (inquiry.followUpDate < today) return true;
    const [hours, minutes] = inquiry.followUpTime.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
  }
  return adminMessagesAllowed(now);
}

async function runFollowUpReminders(now = new Date()) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken) return [];
  const due = data.inquiries.filter((inquiry) => followUpDue(inquiry, now)).slice(0, REMINDERS_PER_RUN);
  const sent = [];
  for (const inquiry of due) {
    const planned = inquiry.followUpDate.split('-').reverse().slice(0, 2).join('.') + (inquiry.followUpTime ? ' ' + inquiry.followUpTime : '');
    const delivered = await sendInquiryToAdministrator(inquiry, '📌 Пора связаться с клиентом (' + planned + '): ' + inquiryTypeLabel(inquiry), inquiry.note ? ['', '📝 ' + shortenedText(inquiry.note, 300)] : [], { onlyAssignee: true });
    if (!delivered) continue;
    inquiry.followUpNotifiedAt = now.toISOString();
    sent.push(inquiry.id);
  }
  if (sent.length) saveDataNow();
  return sent;
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
    const delivered = await sendInquiryToAdministrator(inquiry, '⏰ Нет ответа ' + hoursAgoText(now.getTime() - Date.parse(inquiry.createdAt)) + ': ' + inquiryTypeLabel(inquiry));
    if (!delivered) continue;
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

// --- Weekly report ---------------------------------------------------------------
// On Monday morning the admin gets the previous week (Monday to Sunday) in
// one message, compared with the week before.

const WEEKLY_REPORT_DAY = 1;

function inWeek(value, start, end) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function weekFigures(start, end) {
  const users = Object.values(data.users).filter((user) => inWeek(user.firstSeenAt, start, end));
  const inquiries = data.inquiries.filter((inquiry) => inWeek(inquiry.createdAt, start, end));
  return { users, inquiries };
}

function comparison(current, previous) {
  if (current === previous) return ' (как на прошлой неделе)';
  return ' (' + (current > previous ? '↑' : '↓') + ' было ' + previous + ')';
}

function weeklyReport(now = new Date()) {
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
  const week = weekFigures(start, thisMonday);
  const previous = weekFigures(previousStart, start);
  const pad = (value) => String(value).padStart(2, '0');
  const label = (date) => pad(date.getDate()) + '.' + pad(date.getMonth() + 1);
  const lastDay = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
  const byType = new Map();
  for (const inquiry of week.inquiries) {
    const name = inquiryTypeLabel(inquiry);
    byType.set(name, (byType.get(name) || 0) + 1);
  }
  const startKey = localDayKey(start);
  const endKey = localDayKey(lastDay);
  const viewings = data.inquiries.filter((inquiry) => inquiry.type === 'viewing' && inquiry.viewing && inquiry.viewing.confirmedAt && !inquiry.viewing.cancelledAt);
  const heldViewings = viewings.filter((inquiry) => inquiry.viewing.confirmedDate >= startKey && inquiry.viewing.confirmedDate <= endKey).length;
  const bookedViewings = week.inquiries.filter((inquiry) => inquiry.type === 'viewing').length;
  const waiting = data.inquiries.filter(awaitingReply).length;
  const byProperty = new Map();
  for (const inquiry of week.inquiries) if (inquiry.propertyId) byProperty.set(inquiry.propertyId, (byProperty.get(inquiry.propertyId) || 0) + 1);
  const topProperties = Array.from(byProperty).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, count]) => {
    const property = data.objects.find((item) => item.id === id);
    return (property ? localized(property.title, 'ru') || property.reference || id : 'удалённый объект') + ' — ' + count;
  });
  const bySource = new Map();
  for (const user of week.users) bySource.set(user.source || 'без метки', (bySource.get(user.source || 'без метки') || 0) + 1);
  const sources = Array.from(bySource).sort((a, b) => b[1] - a[1]).map(([name, count]) => name + ' — ' + count);
  const broadcasts = data.broadcasts.filter((entry) => inWeek(entry.startedAt, start, thisMonday) && Number(entry.sent));
  const sent = broadcasts.reduce((sum, entry) => sum + Number(entry.sent || 0), 0);
  const responded = broadcasts.reduce((sum, entry) => sum + (Array.isArray(entry.respondedUserIds) ? entry.respondedUserIds.length : 0), 0);
  return [
    '📈 Итоги недели ' + label(start) + '–' + label(lastDay),
    '',
    '👥 Новых клиентов: ' + week.users.length + comparison(week.users.length, previous.users.length),
    '📩 Обращений: ' + week.inquiries.length + comparison(week.inquiries.length, previous.inquiries.length),
    ...(byType.size ? ['   ' + Array.from(byType).sort((a, b) => b[1] - a[1]).map(([name, count]) => name + ' — ' + count).join(', ')] : []),
    '📅 Просмотров: записались ' + bookedViewings + ', прошло ' + heldViewings,
    '⏳ Сейчас без ответа: ' + waiting,
    ...(topProperties.length ? ['🏠 Больше всего обращений: ' + topProperties.join(', ')] : []),
    ...(sources.length ? ['📣 Откуда пришли: ' + sources.join(', ')] : []),
    ...(broadcasts.length ? ['✉️ Рассылок: ' + broadcasts.length + ', получили ' + sent + ', откликнулись ' + responded] : []),
  ].join('\n');
}

async function runWeeklyReport(now = new Date()) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken || now.getDay() !== WEEKLY_REPORT_DAY || now.getHours() < adminMorningHour(DIGEST_HOUR)) return '';
  const today = localDayKey(now);
  if (data.lastWeeklyReportFor === today) return '';
  data.lastWeeklyReportFor = today;
  scheduleSave();
  const text = weeklyReport(now);
  await sendMessage(adminChatId, text, data.config.botToken, { track: false });
  return text;
}

function runScheduledNotices() {
  runDailyDigest().catch((error) => recordError('Сводка активности', error));
  runInquiryReminders().catch((error) => recordError('Напоминание об обращениях', error));
  runViewingNotices().catch((error) => recordError('Уведомления о просмотрах', error));
  runFollowUpReminders().catch((error) => recordError('Напоминание связаться с клиентом', error));
  runFormReminders().catch((error) => recordError('Напоминание о незаконченной форме', error));
  runWeeklyReport().catch((error) => recordError('Итоги недели', error));
  runTelegramBackup().catch((error) => recordError('Копия данных в Telegram', error));
  runDailyFeedImport().catch((error) => recordError('Загрузка объектов с сайта', error));
}

export {
  DIGEST_HOUR,
  REMINDERS_PER_RUN,
  REMINDER_MAX_AGE_MS,
  activityDigest,
  followUpDue,
  hoursAgoText,
  inquiryNeedsReminder,
  runDailyDigest,
  runDailyDigestSafely,
  runFollowUpReminders,
  runInquiryReminders,
  runScheduledNotices,
  runWeeklyReport,
  sendInquiryToAdministrator,
  weekFigures,
  weeklyReport,
};
