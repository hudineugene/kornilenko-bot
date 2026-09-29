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
import { waitingConversationCount } from './admin-notifications.mjs';
import { temporaryDeliveryError } from './broadcasts.mjs';
import { adminMessagesAllowed, adminMorningHour } from './hours.mjs';
import { runFormReminders } from './forms.mjs';
import { runTelegramBackup } from './offsite.mjs';
import { runDailyFeedImport } from './feed-import.mjs';
import { runDueGroupPosts } from './groups.mjs';
import { runRetentionCleanup } from './retention.mjs';

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
  const key = localDayKey(yesterday);
  if (data.lastDigestFor === key) return '';
  const text = activityDigest(key);
  const markedBefore = data.lastDigestFor;
  data.lastDigestFor = key;
  scheduleSave();
  if (text) {
    try {
      await sendMessage(adminChatId, text, data.config.botToken, { track: false });
    } catch (error) {
      // Обрыв связи не должен стоить владельцу сводки: пробуем ещё раз.
      if (temporaryDeliveryError(error)) {
        data.lastDigestFor = markedBefore;
        saveDataNow();
      }
      throw error;
    }
  }
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
  if (inquiry.status !== 'new' || inquiry.remindedAt || inquiry.searchLead) return false;
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

// Цифры недели одним объектом: из него собираются и сообщение в Telegram, и
// страница отчёта в панели — чтобы числа в них не расходились. which: 'last' —
// прошлая неделя целиком (её и присылает бот по понедельникам), 'current' — эта,
// пока идёт; её сравнивают с тем же отрезком прошлой недели.
function dealWon(inquiry) {
  return inquiry.pipelineStage === 'won';
}

function dealTime(inquiry) {
  return inquiry.wonAt || inquiry.updatedAt || inquiry.createdAt;
}

// Воронка бота для новых клиентов недели: сколько дошли до каждого шага. Каталог
// и «Подробнее» — по отметкам на клиенте (они собираются с того дня, как появились:
// trackedFrom), заявки, записи и подтверждения — по самим заявкам.
const FUNNEL_KEYS = ['joined', 'catalog', 'details', 'inquiry', 'viewing', 'confirmed'];

function funnelRow(users, byUser) {
  const row = Object.fromEntries(FUNNEL_KEYS.map((key) => [key, 0]));
  for (const user of users) {
    const own = byUser.get(String(user.id)) || [];
    row.joined += 1;
    if (user.funnel && user.funnel.catalog) row.catalog += 1;
    if (user.funnel && user.funnel.details) row.details += 1;
    if (own.length) row.inquiry += 1;
    if (own.some((inquiry) => inquiry.type === 'viewing')) row.viewing += 1;
    if (own.some((inquiry) => inquiry.type === 'viewing' && inquiry.viewing && inquiry.viewing.confirmedAt && !inquiry.viewing.cancelledAt)) row.confirmed += 1;
  }
  return row;
}

function botFunnel(users, start) {
  const byUser = new Map();
  for (const inquiry of data.inquiries) {
    if (inquiry.searchLead) continue;
    const key = String(inquiry.userId);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(inquiry);
  }
  const groups = (keyOf) => {
    const map = new Map();
    for (const user of users) {
      const key = keyOf(user);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(user);
    }
    return Array.from(map).map(([key, list]) => ({ key, ...funnelRow(list, byUser) })).sort((a, b) => b.joined - a.joined || String(a.key).localeCompare(String(b.key)));
  };
  // С какого дня бот вообще помечает каталог и «Подробнее»: раньше отметок нет, и
  // клиент, пришедший до этого дня, мог открыть каталог, не оставив следа.
  let earliest = '';
  for (const user of Object.values(data.users)) {
    for (const stamp of [user.funnel && user.funnel.catalog, user.funnel && user.funnel.details]) {
      if (stamp && (!earliest || stamp < earliest)) earliest = stamp;
    }
  }
  const pad = (value) => String(value).padStart(2, '0');
  const trackedFrom = earliest ? pad(new Date(earliest).getDate()) + '.' + pad(new Date(earliest).getMonth() + 1) : '';
  // Цели, которые выбрали новые клиенты недели. Если «пока смотрят» выбирает
  // большинство (при достаточном числе ответов), сегментация почти не помогает.
  const goals = { live: 0, invest: 0, browse: 0 };
  for (const user of users) if (Object.hasOwn(goals, user.goal)) goals[user.goal] += 1;
  const answered = goals.live + goals.invest + goals.browse;
  return {
    ...funnelRow(users, byUser),
    goals: { ...goals, answered, mostlyBrowsing: answered >= 5 && goals.browse * 2 > answered },
    trackedFrom,
    partial: Boolean(earliest) && new Date(earliest) > start,
    byLanguage: groups((user) => ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'unknown'),
    bySource: groups((user) => user.source || 'без метки').slice(0, 5),
  };
}

function weeklyReportData(now = new Date(), which = 'last') {
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const current = which === 'current';
  const start = current ? thisMonday : new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const end = current ? new Date(now.getTime() + 1) : thisMonday;
  const previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
  const previousEnd = current ? new Date(previousStart.getTime() + (end.getTime() - start.getTime())) : start;
  const week = weekFigures(start, end);
  const previous = weekFigures(previousStart, previousEnd);
  const pad = (value) => String(value).padStart(2, '0');
  const label = (date) => pad(date.getDate()) + '.' + pad(date.getMonth() + 1);
  const lastDay = current ? now : new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
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
  const deals = data.inquiries.filter((inquiry) => dealWon(inquiry) && inWeek(dealTime(inquiry), start, end)).length;
  const previousDeals = data.inquiries.filter((inquiry) => dealWon(inquiry) && inWeek(dealTime(inquiry), previousStart, previousEnd)).length;
  const byProperty = new Map();
  for (const inquiry of week.inquiries) if (inquiry.propertyId) byProperty.set(inquiry.propertyId, (byProperty.get(inquiry.propertyId) || 0) + 1);
  const topProperties = Array.from(byProperty).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, count]) => {
    const property = data.objects.find((item) => item.id === id);
    return { name: property ? localized(property.title, 'ru') || property.reference || id : 'удалённый объект', count };
  });
  const bySource = new Map();
  for (const user of week.users) bySource.set(user.source || 'без метки', (bySource.get(user.source || 'без метки') || 0) + 1);
  const broadcasts = data.broadcasts.filter((entry) => inWeek(entry.startedAt, start, end) && Number(entry.sent));
  return {
    which: current ? 'current' : 'last',
    label: label(start) + '–' + label(lastDay),
    users: { count: week.users.length, previous: previous.users.length },
    inquiries: {
      count: week.inquiries.length,
      previous: previous.inquiries.length,
      byType: Array.from(byType).sort((a, b) => b[1] - a[1]),
    },
    viewings: { booked: bookedViewings, held: heldViewings },
    deals: { count: deals, previous: previousDeals },
    // Клиентов, а не обращений: как на «Сегодня» и в «Клиентах» (у одного клиента их может быть несколько).
    waiting: waitingConversationCount(),
    topProperties,
    sources: Array.from(bySource).sort((a, b) => b[1] - a[1]),
    funnel: botFunnel(week.users, start),
    broadcasts: {
      count: broadcasts.length,
      sent: broadcasts.reduce((sum, entry) => sum + Number(entry.sent || 0), 0),
      responded: broadcasts.reduce((sum, entry) => sum + (Array.isArray(entry.respondedUserIds) ? entry.respondedUserIds.length : 0), 0),
    },
  };
}

// Строка воронки: шаги каталога показываем, только если бот их уже считает.
function funnelTextLines(funnel) {
  if (!funnel || !funnel.joined) return [];
  const tracked = Boolean(funnel.trackedFrom);
  const steps = [
    'зашли ' + funnel.joined,
    ...(tracked ? ['каталог ' + funnel.catalog, '«Подробнее» ' + funnel.details] : []),
    'заявка ' + funnel.inquiry,
    'запись ' + funnel.viewing,
    'подтверждено ' + funnel.confirmed,
  ];
  const goals = funnel.goals || { answered: 0 };
  return [
    '🔻 Воронка новых клиентов: ' + steps.join(' → '),
    ...(goals.answered ? ['🎯 Цели новых клиентов: для жизни ' + goals.live + ', инвестиция и аренда ' + goals.invest + ', пока смотрят ' + goals.browse] : []),
    ...(goals.mostlyBrowsing ? ['   ⚠ большинство выбирает «Пока смотрю» — деление по целям почти не помогает'] : []),
    ...(tracked && funnel.partial ? ['   каталог и «Подробнее» — с ' + funnel.trackedFrom + ': у пришедших раньше цифры неполные'] : []),
  ];
}

function weeklyReportText(report) {
  return [
    (report.which === 'current' ? '📈 Эта неделя, ' : '📈 Итоги недели ') + report.label,
    '',
    '👥 Новых клиентов: ' + report.users.count + comparison(report.users.count, report.users.previous),
    '📩 Обращений: ' + report.inquiries.count + comparison(report.inquiries.count, report.inquiries.previous),
    ...(report.inquiries.byType.length ? ['   ' + report.inquiries.byType.map(([name, count]) => name + ' — ' + count).join(', ')] : []),
    '📅 Просмотров: записались ' + report.viewings.booked + ', прошло ' + report.viewings.held,
    // Строка про сделки появляется, когда они были на этой или прошлой неделе:
    // «Сделок: 0» каждую неделю только мозолит глаза.
    ...(report.deals.count || report.deals.previous ? ['🤝 Сделок: ' + report.deals.count + comparison(report.deals.count, report.deals.previous)] : []),
    '⏳ Сейчас без ответа: ' + report.waiting,
    ...(report.topProperties.length ? ['🏠 Больше всего обращений: ' + report.topProperties.map((item) => item.name + ' — ' + item.count).join(', ')] : []),
    ...(report.sources.length ? ['📣 Откуда пришли: ' + report.sources.map(([name, count]) => name + ' — ' + count).join(', ')] : []),
    ...funnelTextLines(report.funnel),
    ...(report.broadcasts.count ? ['✉️ Рассылок: ' + report.broadcasts.count + ', получили ' + report.broadcasts.sent + ', откликнулись ' + report.broadcasts.responded] : []),
  ].join('\n');
}

function weeklyReport(now = new Date()) {
  return weeklyReportText(weeklyReportData(now, 'last'));
}

async function runWeeklyReport(now = new Date()) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken || now.getDay() !== WEEKLY_REPORT_DAY || now.getHours() < adminMorningHour(DIGEST_HOUR)) return '';
  const today = localDayKey(now);
  if (data.lastWeeklyReportFor === today) return '';
  const markedBefore = data.lastWeeklyReportFor;
  data.lastWeeklyReportFor = today;
  scheduleSave();
  const text = weeklyReport(now);
  try {
    await sendMessage(adminChatId, text, data.config.botToken, { track: false });
  } catch (error) {
    if (temporaryDeliveryError(error)) {
      data.lastWeeklyReportFor = markedBefore;
      saveDataNow();
    }
    throw error;
  }
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
  runDueGroupPosts().catch((error) => recordError('Отложенная публикация в группу', error));
  runRetentionCleanup().catch((error) => recordError('Срок хранения данных', error));
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
  weeklyReportData,
  weeklyReportText,
};
