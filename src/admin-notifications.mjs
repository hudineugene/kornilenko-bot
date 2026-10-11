// Единый центр рабочих уведомлений панели. События строятся из фактического
// состояния бота, а прочтение и обработка сохраняются отдельно.

import { userById } from './users.mjs';
import { cleanText, localDayKey } from './util.mjs';
import { data, runtime, saveDataNow } from './store.mjs';
import { propertyReadyForLanguage } from './catalog.mjs';
import { awaitingReply } from './inquiries.mjs';
import { LANGUAGES } from './languages.mjs';

const MAX_NOTIFICATION_STATES = 1000;

function incomingMoment(inquiry) {
  const messages = Array.isArray(inquiry.messages) ? inquiry.messages : [];
  const incoming = messages
    .filter((message) => message.direction === 'in')
    .map((message) => Date.parse(message.createdAt || '') || 0);
  return Math.max(Date.parse(inquiry.clientMessageAt || inquiry.createdAt || '') || 0, ...incoming, 0);
}

function unreadInquiry(inquiry) {
  return inquiry && inquiry.status !== 'closed' && incomingMoment(inquiry) > (Date.parse(inquiry.readAt || '') || 0);
}

function userName(user) {
  return [user && user.firstName, user && user.lastName].filter(Boolean).join(' ') || 'Клиент';
}

function propertyName(propertyId) {
  const property = data.objects.find((record) => String(record.id) === String(propertyId));
  if (!property) return propertyId ? 'объект удалён' : 'объект не указан';
  const title = property.title && typeof property.title === 'object' ? property.title.ru || property.title.en || property.title.es : property.title;
  return cleanText(title || property.reference || property.id, 180);
}

// «2026-10-01» в списке дел читается как машинная запись; человеку — «1 окт», «завтра».
const SHORT_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function dayLabel(value, today = localDayKey()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return String(value || '');
  const key = match[0];
  if (key === today) return 'сегодня';
  const shift = (days) => { const date = new Date(today + 'T12:00:00'); date.setDate(date.getDate() + days); return localDayKey(date); };
  if (key === shift(1)) return 'завтра';
  if (key === shift(-1)) return 'вчера';
  return Number(match[3]) + ' ' + (SHORT_MONTHS[Number(match[2]) - 1] || match[2]);
}

function route(view, tab = '', inquiryId = '') {
  return { view, tab, inquiryId: cleanText(inquiryId, 100) };
}

function currentAdminNotifications() {
  const items = [];
  const today = localDayKey();
  const unreadByUser = new Map();

  // Дело «клиент написал» держится, пока клиент ждёт ответа, а не пока
  // сообщение не прочитано. Раньше оно исчезало, как только менеджер открыл
  // диалог: прочитал, но не ответил — и дело пропало из списка, а клиент так и
  // остался без ответа.
  for (const inquiry of data.inquiries) {
    if (!awaitingReply(inquiry)) continue;
    const userId = String(inquiry.userId || '');
    const previous = unreadByUser.get(userId);
    if (!previous || incomingMoment(inquiry) > incomingMoment(previous)) unreadByUser.set(userId, inquiry);
  }
  for (const inquiry of unreadByUser.values()) {
    const user = userById(inquiry.userId) || {};
    const moment = incomingMoment(inquiry);
    const latest = (Array.isArray(inquiry.messages) ? inquiry.messages : [])
      .filter((message) => message.direction === 'in')
      .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))[0];
    items.push({
      id: 'message:' + String(inquiry.userId) + ':' + moment,
      kind: 'message', severity: 'bad', title: 'Новое сообщение от ' + userName(user),
      text: cleanText(latest && latest.text || inquiry.text || 'Клиент ждёт ответа', 300),
      createdAt: new Date(moment || Date.now()).toISOString(),
      route: route('clients', 'inbox', inquiry.id),
    });
  }

  for (const inquiry of data.inquiries) {
    if (inquiry.status === 'closed' || !inquiry.followUpDate || inquiry.followUpDate > today) continue;
    const user = userById(inquiry.userId) || {};
    const overdue = inquiry.followUpDate < today;
    items.push({
      id: 'task:' + inquiry.id + ':' + inquiry.followUpDate + ':' + (inquiry.followUpTime || ''),
      kind: 'task', severity: overdue ? 'bad' : 'warn',
      title: overdue ? 'Просрочен контакт с клиентом' : 'Контакт с клиентом сегодня',
      text: userName(user) + ' · ' + dayLabel(inquiry.followUpDate, today) + (inquiry.followUpTime ? ' в ' + inquiry.followUpTime : '') + (inquiry.assignee ? ' · ' + inquiry.assignee : ''),
      createdAt: inquiry.updatedAt || inquiry.createdAt || new Date().toISOString(),
      route: route('clients', 'inbox', inquiry.id),
    });
  }

  for (const inquiry of data.inquiries) {
    const viewing = inquiry.viewing;
    if (inquiry.type !== 'viewing' || !viewing || inquiry.status === 'closed' || viewing.cancelledAt || viewing.confirmedAt) continue;
    const user = userById(inquiry.userId) || {};
    const requested = [dayLabel(viewing.date, today) || viewing.dateText, viewing.timeText].filter(Boolean).join(' · ') || 'дата и время требуют уточнения';
    items.push({
      id: 'viewing:' + inquiry.id + ':' + cleanText(requested, 180),
      kind: 'viewing', severity: 'warn', title: 'Просмотр ждёт подтверждения',
      text: userName(user) + ' · ' + propertyName(inquiry.propertyId) + ' · ' + requested,
      createdAt: inquiry.updatedAt || inquiry.createdAt || new Date().toISOString(),
      route: route('viewings', '', inquiry.id),
    });
  }

  for (const broadcast of data.broadcasts) {
    const failures = Number(broadcast.failed || 0);
    if (broadcast.status !== 'failed' && failures <= 0) continue;
    const sample = Array.isArray(broadcast.failures) && broadcast.failures.length ? broadcast.failures[broadcast.failures.length - 1].message : broadcast.error;
    items.push({
      id: 'broadcast:' + broadcast.id + ':' + broadcast.status + ':' + failures,
      kind: 'broadcast', severity: broadcast.status === 'failed' ? 'bad' : 'warn',
      title: broadcast.status === 'failed' ? 'Рассылка не выполнена' : 'Рассылка завершена с ошибками',
      text: failures + ' не доставлено' + (sample ? ' · ' + cleanText(sample, 220) : ''),
      createdAt: broadcast.finishedAt || broadcast.startedAt || broadcast.scheduledAt || broadcast.createdAt || new Date().toISOString(),
      route: route('posts', 'broadcast'),
    });
  }

  // Каталог, которого клиент не видит: объект «активен», но без обязательных
  // полей карточка не попадает в выдачу ни на одном языке. Это главная
  // клиентская беда, и раньше о ней знал только Обзор — считая у себя в
  // браузере, поэтому в центр уведомлений и на телефон она не попадала.
  const active = data.objects.filter((record) => record.status === 'active');
  const invisible = active.filter((record) => !LANGUAGES.some((language) => propertyReadyForLanguage(record, language)));
  if (!active.length) {
    items.push({
      id: 'catalog:empty', kind: 'catalog', severity: 'warn', title: 'В каталоге нет активных объектов',
      text: data.objects.length ? 'Все объекты скрыты — клиент видит пустой каталог.' : 'Добавьте первый объект, иначе боту нечего показывать.',
      createdAt: data.stats.lastUpdateAt || data.stats.startedAt || '', route: route('objects', 'list'),
    });
  } else if (invisible.length >= active.length) {
    items.push({
      id: 'catalog:invisible:all:' + active.length, kind: 'catalog', severity: 'bad', title: 'Клиенты не видят ни одного объекта',
      text: 'В карточках не хватает обязательных полей, поэтому каталог у клиента пустой.',
      createdAt: data.stats.lastUpdateAt || data.stats.startedAt || '', route: route('objects', 'list'),
    });
  } else if (invisible.length) {
    items.push({
      id: 'catalog:invisible:' + invisible.length + ':' + active.length, kind: 'catalog', severity: 'warn',
      title: invisible.length + ' из ' + active.length + ' объектов не показываются клиентам',
      text: 'В карточках не хватает обязательных полей — клиент их не найдёт.',
      createdAt: data.stats.lastUpdateAt || data.stats.startedAt || '', route: route('objects', 'list'),
    });
  }

  const joinRequests = (Array.isArray(data.groups) ? data.groups : [])
    .reduce((total, group) => total + ((Array.isArray(group.joinRequests) ? group.joinRequests : []).length), 0);
  if (joinRequests) {
    items.push({
      id: 'group:requests:' + joinRequests, kind: 'group', severity: 'warn',
      title: joinRequests + ' заявок на вступление в группу',
      text: 'Люди ждут одобрения — пока их не пустили, они не видят постов.',
      createdAt: data.stats.lastUpdateAt || data.stats.startedAt || '', route: route('posts', 'channels'),
    });
  }

  if (!data.config.active) {
    items.push({ id: 'system:bot-disabled', kind: 'system', severity: 'bad', title: 'Бот выключен', text: 'Клиенты не получают автоматические ответы.', createdAt: data.stats.startedAt || data.stats.lastUpdateAt || '', route: route('settings', 'telegram') });
  } else if (!data.config.adminNotificationVerifiedAt) {
    items.push({ id: 'system:admin-chat', kind: 'system', severity: 'warn', title: 'Админ-чат не проверен', text: 'Уведомления о клиентах могут не приходить в Telegram.', createdAt: data.stats.startedAt || data.stats.lastUpdateAt || '', route: route('settings', 'team') });
  }
  const connectionShown = data.config.active && (runtime.status === 'error' || runtime.consecutiveFailures > 0);
  if (connectionShown) {
    items.push({
      id: 'system:connection:' + cleanText(runtime.lastError || 'telegram', 120),
      kind: 'system', severity: 'bad', title: 'Нет стабильной связи с Telegram',
      text: cleanText(runtime.lastError || 'Бот пытается восстановить подключение.', 300),
      createdAt: runtime.lastErrorAt || new Date().toISOString(), route: route('settings', 'telegram'),
    });
  }
  const latestError = Array.isArray(data.errors) ? data.errors[0] : null;
  // Пока висит «Нет стабильной связи с Telegram», та же ошибка из журнала второй
  // строкой не нужна: это одно и то же событие, а не два.
  const sameAsConnection = connectionShown && latestError && (
    /^(Связь с Telegram|Подключение к Telegram)$/.test(String(latestError.area || ''))
    || (runtime.lastError && cleanText(latestError.message, 300) === cleanText(runtime.lastError, 300)));
  if (latestError && !sameAsConnection) {
    items.push({
      id: 'error:' + (latestError.id || latestError.createdAt), kind: 'error', severity: 'warn', title: 'Техническая ошибка: ' + cleanText(latestError.area, 100),
      text: cleanText(latestError.message, 300) + (data.errors.length > 1 ? ' · Ещё записей в журнале: ' + (data.errors.length - 1) : ''),
      createdAt: latestError.createdAt || new Date().toISOString(), route: route('settings', 'data'),
    });
  }
  return items;
}

// Сколько клиентов ждут ответа. Считается здесь, чтобы у панели не было своего
// мнения: раньше Обзор считал заявки, «Переписка» — диалоги, а значок в меню
// показывал непрочитанные, и три числа на одном экране не сходились.
function waitingConversationCount() {
  const waiting = new Set();
  for (const inquiry of data.inquiries) {
    if (awaitingReply(inquiry)) waiting.add(String(inquiry.userId));
  }
  return waiting.size;
}

// Все «числа ожидания» шапки и меню — из одного места. waitingClients — сколько клиентов
// ждут ответа; lateClients — из них дольше срока напоминания (по умолчанию два часа);
// deeds — дел в списке «Сегодня» (то же число у колокольчика и у значка «Сегодня»).
function attentionCounts(notifications = adminNotifications(), now = Date.now()) {
  const hours = Number(data.config.reminderHours);
  const limit = (hours > 0 ? hours : 2) * 3600000;
  const waiting = new Set();
  const late = new Set();
  for (const inquiry of data.inquiries) {
    if (!awaitingReply(inquiry)) continue;
    const userId = String(inquiry.userId);
    waiting.add(userId);
    const since = Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0;
    if (since && now - since >= limit) late.add(userId);
  }
  // Сбой связи с Telegram — не дело менеджера: он виден в «Состоянии бота» и точкой в шапке.
  const deeds = notifications.filter((item) => item.active && !item.handledAt && !String(item.id).startsWith('system:connection:')).length;
  return { waitingClients: waiting.size, lateClients: late.size, deeds };
}

function notificationSnapshot(item) {
  return {
    id: cleanText(item.id, 240), kind: cleanText(item.kind, 30), severity: cleanText(item.severity, 20),
    title: cleanText(item.title, 180), text: cleanText(item.text, 500), createdAt: cleanText(item.createdAt, 40),
    route: route(item.route && item.route.view, item.route && item.route.tab, item.route && item.route.inquiryId),
  };
}

function adminNotifications() {
  const states = data.adminNotificationStates || {};
  const current = currentAdminNotifications();
  const currentIds = new Set(current.map((item) => item.id));
  const items = current.map((item) => {
    const stored = states[item.id] || {};
    return { ...item, active: true, readAt: stored.readAt || '', handledAt: stored.handledAt || '' };
  });
  for (const [id, stored] of Object.entries(states)) {
    if (currentIds.has(id) || !stored.handledAt || !stored.snapshot) continue;
    items.push({ ...stored.snapshot, id, active: false, readAt: stored.readAt || '', handledAt: stored.handledAt });
  }
  return items
    .sort((a, b) => (Date.parse(b.createdAt || b.handledAt) || 0) - (Date.parse(a.createdAt || a.handledAt) || 0))
    .slice(0, 250);
}

function pruneNotificationStates() {
  const states = data.adminNotificationStates || {};
  const kept = Object.entries(states)
    .sort((a, b) => (Date.parse(b[1].handledAt || b[1].readAt || '') || 0) - (Date.parse(a[1].handledAt || a[1].readAt || '') || 0))
    .slice(0, MAX_NOTIFICATION_STATES);
  data.adminNotificationStates = Object.fromEntries(kept);
}

function updateAdminNotification(id, action) {
  const current = currentAdminNotifications().find((item) => item.id === id);
  const previous = data.adminNotificationStates && data.adminNotificationStates[id];
  if (!current && !previous) return null;
  data.adminNotificationStates = data.adminNotificationStates || {};
  const now = new Date().toISOString();
  const stored = { ...(previous || {}), snapshot: notificationSnapshot(current || previous.snapshot) };
  if (action === 'read') stored.readAt = stored.readAt || now;
  else if (action === 'unread') { stored.readAt = ''; stored.handledAt = ''; }
  else if (action === 'handle') { stored.readAt = stored.readAt || now; stored.handledAt = now; }
  else if (action === 'reopen') stored.handledAt = '';
  else return null;
  data.adminNotificationStates[id] = stored;
  pruneNotificationStates();
  saveDataNow();
  return stored;
}

// Менеджер открыл диалог клиента: его сообщения прочитаны и в уведомлениях тоже.
// Дело «клиент написал» при этом остаётся в списке (клиент ждёт ответа), но больше
// не считается непрочитанным — иначе «Непрочитанные» в «Клиентах» и в уведомлениях
// расходились: в одном месте прочитано, в другом висит.
function markMessageNotificationsRead(userId) {
  const prefix = 'message:' + String(userId) + ':';
  const now = new Date().toISOString();
  let changed = false;
  for (const item of currentAdminNotifications()) {
    if (!item.id.startsWith(prefix)) continue;
    const stored = (data.adminNotificationStates || {})[item.id] || {};
    if (stored.readAt) continue;
    data.adminNotificationStates = data.adminNotificationStates || {};
    data.adminNotificationStates[item.id] = { ...stored, readAt: now, snapshot: notificationSnapshot(item) };
    changed = true;
  }
  if (changed) pruneNotificationStates();
  return changed;
}

function readAllAdminNotifications() {
  const now = new Date().toISOString();
  data.adminNotificationStates = data.adminNotificationStates || {};
  for (const item of currentAdminNotifications()) {
    const stored = data.adminNotificationStates[item.id] || {};
    data.adminNotificationStates[item.id] = { ...stored, readAt: stored.readAt || now, snapshot: notificationSnapshot(item) };
  }
  pruneNotificationStates();
  saveDataNow();
}

export { adminNotifications, attentionCounts, dayLabel, currentAdminNotifications, markMessageNotificationsRead, readAllAdminNotifications, updateAdminNotification, waitingConversationCount };
