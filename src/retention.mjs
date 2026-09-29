// Срок хранения данных клиента: RGPD не разрешает держать персональные данные
// дольше, чем нужно. Раз в сутки бот удаляет данные клиентов, от которых давно
// ничего не было. Незаконченные дела не трогаются — что это значит, см. ниже
// у inquiryStillOpen.

import { cleanText, localDayKey } from './util.mjs';
import { PLACES } from './places.mjs';
import { data, saveDataNow } from './store.mjs';
import { eraseUserData } from './users.mjs';
import { awaitingReply } from './inquiries.mjs';
import { sendMessage } from './telegram.mjs';
import { recordError } from './analytics.mjs';

const RETENTION_OPTIONS = [0, 12, 18, 24, 36, 48];
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function retentionMonths() {
  const value = Number(data.config.retentionMonths);
  return RETENTION_OPTIONS.includes(value) ? value : 0;
}

// Когда клиент последний раз о себе напоминал: сообщение, заявка или ответ.
function lastTouchAt(user, inquiries) {
  const times = [Date.parse(user.lastSeenAt || ''), Date.parse(user.firstSeenAt || '')];
  for (const inquiry of inquiries) {
    times.push(Date.parse(inquiry.updatedAt || inquiry.createdAt || ''));
    for (const reply of Array.isArray(inquiry.replies) ? inquiry.replies : []) times.push(Date.parse(reply.createdAt || ''));
  }
  return Math.max(...times.filter(Number.isFinite), 0);
}

function dayStillAhead(day, now) {
  const end = Date.parse(cleanText(day, 10) + 'T23:59:59');
  return Number.isFinite(end) && end > now.getTime();
}

// Что значит «дело ещё не закончено». Раньше сюда попадало всё, у чего статус
// не `closed`, — а закрывают обращения редко: «искал сам», «в работе» и просто
// брошенные так и остаются открытыми. Из-за этого срок хранения почти никогда
// не срабатывал: данные клиента, от которого три года ни слова, держались
// вечно из-за одного незакрытого обращения. Теперь дело держит данные, только
// если кто-то действительно чего-то ждёт:
//   — клиент ждёт ответа менеджера;
//   — просмотр назначен на будущее;
//   — менеджер сам поставил напоминание на будущую дату.
// Свежие дела и так не удаляются: отсчёт идёт от последнего события, а правка
// обращения в панели обновляет его время.
function inquiryStillOpen(inquiry, now) {
  if (awaitingReply(inquiry)) return true;
  const viewing = inquiry.viewing;
  if (viewing && viewing.confirmedDate && !viewing.cancelledAt && dayStillAhead(viewing.confirmedDate, now)) return true;
  if (dayStillAhead(inquiry.followUpDate, now)) return true;
  return false;
}

function hasOpenBusiness(inquiries, now) {
  return inquiries.some((inquiry) => inquiryStillOpen(inquiry, now));
}

function retentionPlan(now = new Date()) {
  const months = retentionMonths();
  if (!months) return { months: 0, users: [], inquiries: [] };
  const cutoff = now.getTime() - months * MONTH_MS;
  const users = [];
  for (const user of Object.values(data.users)) {
    const inquiries = data.inquiries.filter((item) => String(item.userId) === String(user.id));
    if (hasOpenBusiness(inquiries, now)) continue;
    if (lastTouchAt(user, inquiries) > cutoff) continue;
    users.push(user);
  }
  const userIds = new Set(users.map((user) => String(user.id)));
  // Обращения клиентов, которых в базе уже нет: они тоже персональные данные.
  const inquiries = data.inquiries.filter((item) => {
    if (userIds.has(String(item.userId))) return false;
    if (data.users[String(item.userId)]) return false;
    if (inquiryStillOpen(item, now)) return false;
    const at = Date.parse(item.updatedAt || item.createdAt || '');
    return Number.isFinite(at) && at <= cutoff;
  });
  return { months, users, inquiries };
}

// Возвращает, что удалено. Пишет администратору только когда что-то удалено.
async function runRetentionCleanup(now = new Date(), token = data.config.botToken) {
  const months = retentionMonths();
  if (!months) return { months: 0, users: 0, inquiries: 0 };
  const today = localDayKey(now);
  if (data.lastRetentionRunFor === today) return { months, users: 0, inquiries: 0, skipped: true };
  data.lastRetentionRunFor = today;

  const plan = retentionPlan(now);
  for (const user of plan.users) {
    try {
      eraseUserData(user);
    } catch (error) {
      recordError('Срок хранения данных', error);
    }
  }
  const removeIds = new Set(plan.inquiries.map((item) => item.id));
  if (removeIds.size) data.inquiries = data.inquiries.filter((item) => !removeIds.has(item.id));
  saveDataNow();

  const removed = { months, users: plan.users.length, inquiries: plan.inquiries.length + plan.users.length };
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (adminChatId && token && (plan.users.length || removeIds.size)) {
    const lines = ['🗂 Срок хранения данных (' + months + ' мес.): удалены данные, от которых давно ничего не было.'];
    if (plan.users.length) lines.push('Клиентов: ' + plan.users.length);
    if (removeIds.size) lines.push('Отдельных обращений: ' + removeIds.size);
    lines.push('Не удаляются те, кто ждёт ответа, с предстоящим просмотром или напоминанием. Срок меняется в панели: ' + PLACES.retention + '.');
    await sendMessage(adminChatId, lines.join('\n'), token, { track: false }).catch((error) => recordError('Срок хранения данных', error));
  }
  return removed;
}

export {
  RETENTION_OPTIONS,
  retentionMonths,
  retentionPlan,
  runRetentionCleanup,
};
