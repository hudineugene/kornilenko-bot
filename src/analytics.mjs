// Статистика, журнал ошибок и история действий пользователей.

import crypto from 'node:crypto';
import { cleanText, localDayKey } from './util.mjs';
import { data, scheduleSave } from './store.mjs';

// Сутки считаются по времени бота (часовой пояс из настроек), а не по
// Гринвичу: иначе летом всё, что происходит с полуночи до двух ночи, попадает
// во вчерашний день — и /stats, и «Обзор» показывают вчерашние цифры.
function recordDaily(kind, detail = '', amount = 1) {
  const key = localDayKey();
  const daily = data.analytics.daily[key] || { received: 0, sent: 0, reactions: 0, inquiries: 0, menu: {} };
  if (kind === 'received' || kind === 'sent') daily[kind] = Number(daily[kind] || 0) + 1;
  if (kind === 'reaction') daily.reactions = Number(daily.reactions || 0) + Math.max(1, Number(amount) || 1);
  if (kind === 'inquiry') daily.inquiries = Number(daily.inquiries || 0) + 1;
  if (kind === 'menu' && detail) daily.menu[detail] = Number(daily.menu[detail] || 0) + 1;
  data.analytics.daily[key] = daily;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);
  for (const storedKey of Object.keys(data.analytics.daily)) {
    if (storedKey < localDayKey(cutoff)) delete data.analytics.daily[storedKey];
  }
}

function propertyAnalytics(propertyId) {
  const id = String(propertyId || '');
  if (!id) return null;
  const current = data.analytics.properties[id] || {};
  const bucket = {
    impressions: Number(current.impressions || 0),
    details: Number(current.details || 0),
    galleries: Number(current.galleries || 0),
    managerContacts: Number(current.managerContacts || 0),
    similar: Number(current.similar || 0),
    availability: Number(current.availability || 0),
    interests: Number(current.interests || 0),
    viewings: Number(current.viewings || 0),
    questions: Number(current.questions || 0),
    favorites: Number(current.favorites || 0),
    calculator: Number(current.calculator || 0),
    updatedAt: current.updatedAt || '',
  };
  data.analytics.properties[id] = bucket;
  return bucket;
}

function recordPropertyEvent(propertyId, kind) {
  const bucket = propertyAnalytics(propertyId);
  if (!bucket || !Object.hasOwn(bucket, kind)) return;
  bucket[kind] += 1;
  bucket.updatedAt = new Date().toISOString();
  scheduleSave();
}

// Воронка бота: на клиенте помечается, когда он впервые открыл каталог и впервые
// нажал «Подробнее». Заявки, записи и подтверждения берутся из самих заявок, а не
// дублируются здесь. Отметка одна на шаг и не двигается при повторе.
const FUNNEL_STEPS = ['catalog', 'details'];

function markFunnel(user, step) {
  if (!user || !FUNNEL_STEPS.includes(step)) return;
  const funnel = user.funnel && typeof user.funnel === 'object' ? user.funnel : {};
  if (funnel[step]) return;
  user.funnel = { ...funnel, [step]: new Date().toISOString() };
  scheduleSave();
}

function recordError(area, error) {
  const message = cleanText(error && error.message ? error.message : error, 600) || 'Неизвестная ошибка';
  data.errors.unshift({ id: crypto.randomUUID(), area: cleanText(area, 80), message, createdAt: new Date().toISOString() });
  data.errors = data.errors.slice(0, 100);
  scheduleSave();
}

// История действий клиента нужна для недавних сопоставлений (ответ менеджера,
// реакция на сообщение) и ленты реакций в «Обзоре». Хранить её длинной незачем:
// 50 записей по 500 знаков на клиента — это десятки мегабайт при тысячах
// клиентов, и всё это ещё и уезжает в панель при каждом обновлении экрана.
const ACTIVITY_KEPT = 20;
const ACTIVITY_TEXT_LIMIT = 200;

function recordActivity(user, direction, text, kind = 'message', metadata = {}) {
  if (!user) return null;
  user.activity = Array.isArray(user.activity) ? user.activity : [];
  const entry = {
    id: crypto.randomUUID(),
    direction,
    kind,
    text: cleanText(text, ACTIVITY_TEXT_LIMIT),
    createdAt: new Date().toISOString(),
  };
  if (Number.isFinite(Number(metadata.messageId))) entry.messageId = Number(metadata.messageId);
  if (Array.isArray(metadata.messageIds)) {
    entry.messageIds = metadata.messageIds
      .map((messageId) => Number(messageId))
      .filter(Number.isFinite)
      .slice(0, 20);
  }
  if (Number.isFinite(Number(metadata.targetMessageId))) entry.targetMessageId = Number(metadata.targetMessageId);
  if (Array.isArray(metadata.reactions)) entry.reactions = metadata.reactions.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20);
  if (metadata.reactionAction) entry.reactionAction = cleanText(metadata.reactionAction, 20);
  if (metadata.targetText) entry.targetText = cleanText(metadata.targetText, ACTIVITY_TEXT_LIMIT);
  user.activity.push(entry);
  user.activity = user.activity.slice(-ACTIVITY_KEPT);
  return entry;
}

export {
  ACTIVITY_KEPT,
  FUNNEL_STEPS,
  markFunnel,
  propertyAnalytics,
  recordActivity,
  recordDaily,
  recordError,
  recordPropertyEvent,
};
