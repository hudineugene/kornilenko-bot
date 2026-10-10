// Действия клиента из приложения. Заявки заводятся теми же функциями, что и в боте, поэтому менеджер видит их так же: карточка в
// Telegram, диалог в панели, отчёты, напоминания. Клиент получает подтверждение в чате с ботом.

import { cleanText, dateFromDayKey, localDayKey } from '../util.mjs';
import { DAY_KEY_PATTERN, normalizeViewing } from '../data-format.mjs';
import { data, saveDataNow, scheduleSave } from '../store.mjs';
import { VIEWING_FORM_TEXT, PROPERTY_ACTION_TEXT } from '../texts.mjs';
import { normalizeUser, userById } from '../users.mjs';
import { createInquiry } from '../inquiries.mjs';
import { recordPropertyEvent } from '../analytics.mjs';
import { localized, localizedExact, notifySharedListOwner } from '../catalog.mjs';
import { propertyRequestText } from '../sections.mjs';
import { sendViewingConfirmation, viewingDateLabel } from '../viewings.mjs';
import { availableSlotDays, slotFree, slotsEnabled } from '../slots.mjs';

import { validLeadPhone } from '../forms.mjs';
import { sendMessage } from '../telegram.mjs';
import { menuKeyboard } from '../menus.mjs';
import { withOffHoursNote } from '../hours.mjs';
import { findRecord } from './data.mjs';

const COMPARISON_LIMIT = 3;
const MAX_FAVORITES = 500;
const TIME_BUCKETS = ['morning', 'afternoon', 'evening'];
const MAX_NOTE = 600;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

// code — короткое имя причины: приложение показывает по нему текст на языке клиента, а message остаётся для журнала и гостей API.
class AppError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Клиент по подписанным данным Telegram: берём существующего или заводим, как бот при первом сообщении.
function userFor(tgUser) {
  const id = String(tgUser.id);
  const existing = userById(id);
  const user = existing || normalizeUser(tgUser, tgUser.id, false);
  if (!user.chatId) user.chatId = tgUser.id;
  // Источник «приложение» — только у тех, кто пришёл в бот через него; тот, кто уже писал боту, остаётся как был.
  if (!existing && !user.source) {
    user.source = 'app';
    user.sourceAt = new Date().toISOString();
    scheduleSave();
  }
  return user;
}

// Только те объекты из списка, которые клиент сейчас видит: скрытые и проданные не считаются ни в лимите, ни в счётчиках.
function visibleOnly(list, language) {
  return (Array.isArray(list) ? list : []).map(String).filter((value, index, all) => value && all.indexOf(value) === index && findRecord(value, language));
}

function actionLanguage(user, language) {
  return ['ru', 'en', 'es'].includes(language) ? language : user.preferredLanguage || 'ru';
}

function toggleFavorite(user, id, on, token, appLanguage = '') {
  const list = Array.isArray(user.favorites) ? user.favorites : [];
  const language = actionLanguage(user, appLanguage);
  const record = findRecord(id, language);
  if (!record) throw new AppError('Объект недоступен', 404, 'unavailable');
  const set = new Set(list);
  const want = on === undefined ? !set.has(id) : Boolean(on);
  if (want && !set.has(id)) {
    set.add(id);
    recordPropertyEvent(id, 'favorites');
    void notifySharedListOwner(user, record, token).catch(() => {});
  }
  if (!want) set.delete(id);
  user.favorites = Array.from(set).slice(0, MAX_FAVORITES);
  scheduleSave();
  return { favorites: visibleOnly(user.favorites, language) };
}

function toggleCompare(user, id, on, appLanguage = '') {
  const language = actionLanguage(user, appLanguage);
  if (!findRecord(id, language)) throw new AppError('Объект недоступен', 404, 'unavailable');
  const list = visibleOnly(user.comparisonIds, language);
  const has = list.includes(id);
  const want = on === undefined ? !has : Boolean(on);
  let next = list.filter((value) => value !== id);
  if (want) {
    if (next.length >= COMPARISON_LIMIT) throw new AppError('limit', 409, 'limit');
    next = [...next, id];
  }
  user.comparisonIds = next;
  scheduleSave();
  return { compare: visibleOnly(user.comparisonIds, language) };
}

// Свободное время для записи: те же правила, что в боте (окна из настроек), либо «любой из ближайших дней».
function viewingOptions(language, now = new Date()) {
  // Как в боте: окна — только когда они включены и хотя бы одно свободно; иначе клиент выбирает день и время суток.
  const slotDays = slotsEnabled() ? availableSlotDays(language, now) : [];
  if (slotDays.length) {
    return { mode: 'slots', days: slotDays.map((day) => ({ key: day.key, label: day.label, times: day.times })) };
  }
  const days = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = localDayKey(date);
    days.push({ key, label: viewingDateLabel(key, language), times: [] });
  }
  return { mode: 'free', days, buckets: TIME_BUCKETS };
}

function cleanPhone(value) {
  const text = cleanText(value, 40);
  return text ? validLeadPhone(text) || '' : '';
}

// Как в боте: то, что клиент только что ввёл, и есть его актуальные имя и телефон.
function rememberContact(user, name, phone) {
  const cleanName = cleanText(name, 120);
  if (cleanName) user.contactName = cleanName;
  if (phone) user.phone = phone;
}

async function requestViewing(user, body, token, appLanguage = '') {
  const language = actionLanguage(user, appLanguage);
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  const ru = VIEWING_FORM_TEXT.ru;
  const record = findRecord(cleanText(body.propertyId, 100), language);
  if (!record) throw new AppError('Объект недоступен', 404, 'unavailable');
  if (record.status === 'reserved') throw new AppError('Объект забронирован', 409, 'reserved');
  const day = cleanText(body.day, 10);
  if (!DAY_KEY_PATTERN.test(day)) throw new AppError('Выберите день', 400, 'pick-day');
  const today = dateFromDayKey(localDayKey());
  const target = dateFromDayKey(day);
  // 2026-02-31 проходит по шаблону, но превращается в 3 марта: такую дату не принимаем.
  if (localDayKey(target) !== day || target < today || target - today > 90 * 86400000) throw new AppError('Выберите день из ближайших', 400, 'pick-day');
  const online = body.online === true;
  const phone = cleanPhone(body.phone);
  const name = cleanText(body.name, 120);
  if (!phone && !user.phone && !online) throw new AppError('Оставьте телефон: менеджер подтвердит время', 400, 'phone-required');
  let timeText;
  let slotBooking = false;
  const time = cleanText(body.time, 20);
  const slotDays = slotsEnabled() ? availableSlotDays(language) : [];
  if (slotDays.length) {
    const slotDay = slotDays.find((item) => item.key === day);
    if (!CLOCK.test(time) || !slotDay || !slotDay.times.includes(time) || !slotFree(day, time)) throw new AppError('Это время только что заняли', 409, 'slot-taken');
    timeText = time;
    slotBooking = true;
  } else if (TIME_BUCKETS.includes(time)) {
    timeText = copy.timeOptions[TIME_BUCKETS.indexOf(time)];
  } else if (CLOCK.test(time)) {
    timeText = time;
  } else {
    throw new AppError('Выберите время', 400, 'pick-time');
  }
  rememberContact(user, name, phone);
  const dateText = viewingDateLabel(day, 'ru');
  const note = cleanText(body.note, MAX_NOTE);
  const details = [
    propertyRequestText(record, 'ru', 'viewing'),
    ru.reviewLabels[1] + ': ' + dateText,
    ru.reviewLabels[2] + ': ' + (TIME_BUCKETS.includes(time) ? ru.timeOptions[TIME_BUCKETS.indexOf(time)] : timeText),
    ...(online ? ['📹 ' + ru.onlineLabel] : []),
    ...(phone ? ['📞 ' + phone] : []),
    ...(note ? ['💬 ' + note] : []),
    '📱 Из приложения',
    ...(slotBooking ? ['', '✅ Время из свободных окон — просмотр подтверждён автоматически'] : []),
  ].join('\n');
  const viewing = { date: day, dateText, timeText: TIME_BUCKETS.includes(time) ? ru.timeOptions[TIME_BUCKETS.indexOf(time)] : timeText, online };
  if (slotBooking) Object.assign(viewing, { confirmedDate: day, confirmedTime: time, confirmedAt: new Date().toISOString() });
  const inquiry = createInquiry(user, details, {
    type: 'viewing',
    propertyId: record.id,
    viewing: normalizeViewing(viewing),
    status: slotBooking ? 'in_progress' : 'new',
  });
  recordPropertyEvent(record.id, 'viewings');
  saveDataNow();
  const title = localizedExact(record.title, language) || record.reference || '';
  // Лимит заявок может вернуть прежнюю заявку вместо новой: тогда слот за клиентом не закреплён, и подтверждать нечего.
  const booked = slotBooking && Boolean(inquiry.viewing && inquiry.viewing.confirmedDate === day && inquiry.viewing.confirmedTime === time);
  try {
    if (booked) {
      await sendViewingConfirmation(inquiry, user, token, { heading: copy.slotBooked, keyboard: menuKeyboard(language) });
    } else {
      await sendMessage(user.chatId, withOffHoursNote([copy.success, title ? '🔖 ' + title : ''].filter(Boolean).join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
    }
  } catch {
    // Заявка уже записана и видна менеджеру; подтверждение в чат можно не получить, если клиент заблокировал бота.
  }
  return { ok: true, confirmed: booked, inquiryId: inquiry.id, day, time: timeText, title };
}

async function requestCall(user, body, token, appLanguage = '') {
  const language = actionLanguage(user, appLanguage);
  const record = body.propertyId ? findRecord(cleanText(body.propertyId, 100), language) : null;
  const method = ['call', 'whatsapp', 'telegram'].includes(body.method) ? body.method : 'call';
  const phone = cleanPhone(body.phone) || (method === 'telegram' ? '' : user.phone || '');
  const name = cleanText(body.name, 120) || user.contactName || user.firstName || '';
  if (method !== 'telegram' && !phone) throw new AppError('Оставьте телефон', 400, 'phone-required');
  const preferredTime = cleanText(body.time, 160);
  rememberContact(user, name, phone);
  if (preferredTime) user.preferredContactTime = preferredTime;
  const labels = { call: 'Позвонить', whatsapp: 'Написать в WhatsApp', telegram: 'Написать в Telegram' };
  const inquiry = createInquiry(user, [
    'Имя: ' + name,
    'Способ связи: ' + labels[method],
    phone ? 'Телефон: ' + phone : '',
    preferredTime ? 'Удобное время: ' + preferredTime : '',
    '📱 Из приложения',
  ].filter(Boolean).join('\n'), { type: 'lead', propertyId: record ? record.id : '', lead: { name, phone, preferredTime, method } });
  saveDataNow();
  const title = record ? localizedExact(record.title, language) || record.reference || '' : '';
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  try {
    await sendMessage(user.chatId, withOffHoursNote([copy.received, title ? '🔖 ' + title : ''].filter(Boolean).join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
  } catch {
    // см. выше
  }
  return { ok: true, inquiryId: inquiry.id };
}

async function askQuestion(user, body, token, appLanguage = '') {
  const language = actionLanguage(user, appLanguage);
  const text = cleanText(body.text, 1000);
  if (text.length < 2) throw new AppError('Напишите вопрос', 400, 'question-short');
  const record = body.propertyId ? findRecord(cleanText(body.propertyId, 100), language) : null;
  const inquiry = record
    ? createInquiry(user, propertyRequestText(record, 'ru', 'question') + '\n\n' + text, { type: 'question', propertyId: record.id })
    : createInquiry(user, text, { type: 'general' });
  if (record) recordPropertyEvent(record.id, 'questions');
  saveDataNow();
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const title = record ? localizedExact(record.title, language) || localized(record.title, 'ru') || '' : '';
  try {
    await sendMessage(user.chatId, withOffHoursNote([copy.received, title ? '🔖 ' + title : ''].filter(Boolean).join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
  } catch {
    // см. выше
  }
  return { ok: true, inquiryId: inquiry.id };
}

export { AppError, askQuestion, requestCall, requestViewing, toggleCompare, toggleFavorite, userFor, viewingOptions };
