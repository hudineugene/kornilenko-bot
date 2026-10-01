// Просмотры: дата из формы, подтверждение клиенту, напоминание накануне,
// вопрос «как прошёл просмотр» и список просмотров на день для администратора.

import crypto from 'node:crypto';
import { cleanText, dateFromDayKey, delay, displayPhone, localDayKey, managerNameFor } from './util.mjs';
import { CLOCK_TIME_PATTERN, DAY_KEY_PATTERN, PIPELINE_STAGES, normalizeViewing } from './data-format.mjs';
import { INTERACTION_TEXT, MY_REQUESTS_TEXT, PROPERTY_ACTION_TEXT, VIEWING_FORM_TEXT, VIEWING_NOTICE_TEXT, russianViewingText } from './texts.mjs';
import { data, saveDataNow, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { markUnavailable, normalizeUser, userByChatId, userById } from './users.mjs';
import { sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { imageExists } from './media.mjs';
import { menuKeyboard } from './menus.mjs';
import { adminCallbackAllowed, adminChatFor, createInquiry, inquiryStatusMarkup, notifyAdministratorAction, refreshInquiryCards } from './inquiries.mjs';
import { localized, localizedExact, validHttpUrl } from './catalog.mjs';
import { acknowledgeCallback, propertyRequestText, sendSimilarProperty } from './sections.mjs';
import { temporaryDeliveryError, userUnavailableError } from './broadcasts.mjs';
import { adminMorningHour } from './hours.mjs';
import { adminSendPlan } from './notify-plan.mjs';

const LOCALES = { ru: 'ru-RU', en: 'en-GB', es: 'es-ES' };
const VIEWING_REMINDER_HOUR = 18;
const VIEWING_FEEDBACK_HOUR = 10;
const CLIENT_QUIET_HOUR = 21;
const VIEWING_AGENDA_HOUR = 8;
const FEEDBACK_WINDOW_DAYS = 3;
const VIEWING_NOTICES_PER_RUN = 20;

// --- Dates -------------------------------------------------------------------

// "Today" and "tomorrow" in the form become a calendar date; "at the weekend"
// is two days, so it stays open until the manager confirms one.
function viewingDayForOption(optionIndex, now = new Date()) {
  if (optionIndex !== 0 && optionIndex !== 1) return '';
  const date = new Date(now);
  date.setDate(date.getDate() + optionIndex);
  return localDayKey(date);
}

// Russian months by their stem ("сентября", "сент."); English and Spanish
// only as whole words or abbreviations, so that "martes" (Tuesday) is not
// taken for March.
const RUSSIAN_MONTHS = [/^янв/, /^фев/, /^март/, /^апр/, /^ма[йя]$/, /^июн/, /^июл/, /^авг/, /^сент?/, /^окт/, /^ноя/, /^дек/];
const LATIN_MONTHS = [
  ['january', 'jan', 'enero', 'ene'], ['february', 'feb', 'febrero'], ['march', 'mar', 'marzo'], ['april', 'apr', 'abril', 'abr'],
  ['may', 'mayo'], ['june', 'jun', 'junio'], ['july', 'jul', 'julio'], ['august', 'aug', 'agosto', 'ago'],
  ['september', 'sep', 'sept', 'septiembre', 'setiembre', 'set'], ['october', 'oct', 'octubre'], ['november', 'nov', 'noviembre'], ['december', 'dec', 'diciembre', 'dic'],
];

function monthFromWord(word) {
  const lower = String(word || '').toLowerCase().replace(/\.$/, '');
  const russian = RUSSIAN_MONTHS.findIndex((pattern) => pattern.test(lower));
  if (russian >= 0 && /[а-яё]/.test(lower)) return russian + 1;
  const latin = LATIN_MONTHS.findIndex((names) => names.includes(lower));
  return latin >= 0 ? latin + 1 : 0;
}

// A calendar date from a free-text answer: "25.09", "25/09/2026",
// "25 сентября", "September 25", "25 de septiembre", "завтра".
// Only dates from today up to a year ahead count; otherwise ''.
// Слово, которое уже называет день: «завтра», «в пятницу», «el martes». Если
// день назван словом, числа рядом — это время.
const NAMED_DAY = /сегодня|завтра|послезавтра|понедельник|вторник|сред[уа]|четверг|пятниц|суббот|воскресен|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hoy|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo/;
// Предлог перед числами: «в 9.10», «с 10», «at 5», «a las 17».
const TIME_BEFORE = /(?:^|[^a-zа-яё])(?:в|с|до|к|at|from|to|a\s+las|de)\s*$/u;
// Отметка времени сразу после чисел: «10-11am», «9.10 ч», «17.00 часов».
const TIME_AFTER = /^\s*(?:am|pm|a\.m|p\.m|h\b|ч\b|час)/u;

function looksLikeTime(value, index, whole, first, separator, second) {
  const hour = Number(first);
  const minute = Number(second);
  if (hour > 24 || minute > 59) return false;
  const before = value.slice(0, index);
  const after = value.slice(index + whole.length);
  if (TIME_AFTER.test(after)) return true;
  // День уже назван словом — значит числа про время.
  if (NAMED_DAY.test(value)) return true;
  if (TIME_BEFORE.test(before)) return true;
  // «10-12» без года: часы через дефис пишут куда чаще, чем дату.
  return separator === '-';
}

function parseViewingDate(text, now = new Date()) {
  const value = String(text || '').toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(today);
  limit.setFullYear(limit.getFullYear() + 1);
  const calendarDay = (day, month, year) => {
    if (!day || !month) return '';
    let fullYear = year;
    if (!fullYear) {
      fullYear = today.getFullYear();
      // "05.01" written in December means next January.
      if (new Date(fullYear, month - 1, day) < today) fullYear += 1;
    }
    const date = new Date(fullYear, month - 1, day);
    if (date.getFullYear() !== fullYear || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return date < today || date > limit ? '' : localDayKey(date);
  };
  // Два числа через точку или дефис — это не обязательно дата. «с 10-12»,
  // «10-11am», «в 9.10» люди пишут про время, и бот принимал их за 10 декабря,
  // 10 ноября и 9 октября: клиент видел в сводке свой же текст и ошибки не
  // замечал, а менеджеру уходила чужая дата.
  for (const match of value.matchAll(/(?<!\d)(\d{1,2})([./-])(\d{1,2})(?:[./-](\d{4}|\d{2}))?(?!\d)/g)) {
    const [whole, first, separator, second, yearText] = match;
    const year = yearText ? Number(yearText.length === 2 ? '20' + yearText : yearText) : 0;
    if (!year && looksLikeTime(value, match.index, whole, first, separator, second)) continue;
    const found = calendarDay(Number(first), Number(second), year);
    // "16.00" is a time, not a date: keep looking.
    if (found) return found;
  }
  const dayFirst = value.match(/(?<!\d)(\d{1,2})\s*(?:de\s+)?([a-zа-яё]{3,})/u);
  if (dayFirst && monthFromWord(dayFirst[2])) {
    const found = calendarDay(Number(dayFirst[1]), monthFromWord(dayFirst[2]), 0);
    if (found) return found;
  }
  const monthFirst = value.match(/([a-z]{3,})\s+(\d{1,2})(?!\d)/);
  if (monthFirst && monthFromWord(monthFirst[1])) {
    const found = calendarDay(Number(monthFirst[2]), monthFromWord(monthFirst[1]), 0);
    if (found) return found;
  }
  const relative = [
    [/(послезавтра|pasado mañana|day after tomorrow)/, 2],
    // "por la mañana" is "in the morning", not "tomorrow".
    [/(завтра|tomorrow|(?<!la\s)mañana)/, 1],
    [/(сегодня|today|hoy)/, 0],
  ].find(([pattern]) => pattern.test(value));
  if (!relative) return '';
  const date = new Date(today);
  date.setDate(date.getDate() + relative[1]);
  return localDayKey(date);
}

function viewingDateLabel(key, language) {
  if (!DAY_KEY_PATTERN.test(String(key || ''))) return '';
  // Для русского «Чт 01.10» однозначно; в английском и испанском «01/10» читают то как день и месяц, то наоборот — пишем месяц словом.
  const style = language === 'ru' || !LOCALES[language] ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short' };
  const formatted = new Intl.DateTimeFormat(LOCALES[language] || LOCALES.ru, style).format(dateFromDayKey(key));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// The date and time to show: what the manager confirmed, otherwise what the
// client asked for.
function viewingWhen(inquiry, language) {
  const viewing = inquiry.viewing || {};
  const confirmed = Boolean(viewing.confirmedAt);
  const confirmedDate = confirmed ? viewingDateLabel(viewing.confirmedDate, language) : '';
  // "Another date" is one free-text answer ("25 September after 4 pm"): the
  // time is part of it, and the form stored "As specified" as the time.
  const freeText = ['ru', 'en', 'es'].some((code) => VIEWING_FORM_TEXT[code] && VIEWING_FORM_TEXT[code].asSpecified === viewing.timeText);
  // Менеджеру слова клиента («Por la tarde») — по-русски; самому клиенту — как он их выбрал.
  const words = language === 'ru' ? russianViewingText : (text) => text;
  if (freeText) {
    return {
      date: confirmedDate || words(viewing.dateText),
      time: (confirmed && viewing.confirmedTime) || (confirmedDate ? words(viewing.dateText) : ''),
    };
  }
  return {
    date: confirmedDate || words(viewing.dateText) || viewingDateLabel(viewing.date, language),
    time: (confirmed && viewing.confirmedTime) || words(viewing.timeText),
  };
}

// Where the viewing takes place, from the property card.
function viewingPlaceLines(property, language, copy) {
  if (!property) return [];
  const title = localizedExact(property.title, language) || localized(property.title, language) || property.reference || '';
  const address = [localizedExact(property.city, language, 160), localizedExact(property.district, language, 160), localizedExact(property.address, language, 500)].filter(Boolean).join(', ');
  return [title ? '🔖 ' + title : '', address ? '📍 ' + copy.address + ': ' + address : ''].filter(Boolean);
}

// Карточка встречи: кто встретит, по какому телефону связаться, что взять с собой
// и что делать, если задерживаешься. Самый большой страх приезжего — приехать и
// никого не найти. Строки про имя и телефон — только если владелец их заполнил.
function meetingLines(language, copy) {
  const contacts = data.contacts || {};
  const name = managerNameFor(contacts, language);
  const phone = (String(contacts.phone || '').match(/\+?\d[\d\s().-]{5,}\d/g) || [])[0];
  return [
    name ? copy.meets + name : '',
    phone ? copy.phone + displayPhone(phone) : '',
    copy.bringId,
    copy.runningLate,
  ].filter(Boolean);
}

function viewingDetailsText(inquiry, property, language, heading, footer, extraLines = []) {
  const copy = VIEWING_NOTICE_TEXT[language] || VIEWING_NOTICE_TEXT.ru;
  const when = viewingWhen(inquiry, language);
  const [titleLine, ...addressLines] = viewingPlaceLines(property, language, copy);
  // Онлайн-показ проходит по видеосвязи: адрес и «как добраться» клиенту не
  // нужны, а вот формат надо назвать — иначе он поедет на объект.
  const online = Boolean(inquiry.viewing && inquiry.viewing.online);
  const placeLines = online ? [copy.online] : addressLines;
  return [
    heading,
    '',
    titleLine || '',
    when.date ? '📅 ' + copy.date + ': ' + when.date : '',
    when.time ? '🕒 ' + copy.time + ': ' + when.time : '',
    ...placeLines,
    ...(extraLines.length ? ['', ...extraLines] : []),
    '',
    footer,
  ].filter((line, index, lines) => line !== '' || (lines[index - 1] !== '' && index > 0)).join('\n').trim();
}

function viewingProperty(inquiry) {
  return inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) || null : null;
}

// --- Confirmation ------------------------------------------------------------

// The client's message: property, date, time, address, a map and a way to
// "My requests".
async function sendViewingConfirmation(inquiry, user, token = data.config.botToken, options = {}) {
  const language = user.preferredLanguage || inquiry.language || 'ru';
  const copy = VIEWING_NOTICE_TEXT[language] || VIEWING_NOTICE_TEXT.ru;
  const property = viewingProperty(inquiry);
  // На онлайн-показ карта не нужна.
  const map = property && !(inquiry.viewing && inquiry.viewing.online) ? validHttpUrl(property.mapUrl) : '';
  // Онлайн-показ проходит по видеосвязи — приезжать не нужно, карточка встречи ни к чему.
  const online = Boolean(inquiry.viewing && inquiry.viewing.online);
  const text = viewingDetailsText(inquiry, property, language, options.heading || copy.confirmed, copy.confirmedFooter, online ? [] : meetingLines(language, copy));
  // Фото агента идёт отдельным сообщением перед карточкой. Не вышло — карточка всё
  // равно приходит. Если итог заменяет вопрос записи, фото не шлём: оно встало бы
  // ниже заменённого сообщения.
  const contacts = data.contacts || {};
  if (!online && !options.editMessageId && imageExists(contacts.photo)) {
    const name = managerNameFor(contacts, language);
    try {
      await sendPhotoMessage(user.chatId, contacts.photo, name ? '👨‍💼 ' + name : '', token, null);
    } catch (error) {
      recordError('Фото агента в подтверждении просмотра', error);
    }
  }
  // Запись кнопками шла в одном сообщении — итог заменяет его же, а не
  // добавляется четвёртым. Если изменить не получилось, шлём новым.
  if (options.editMessageId) {
    const rows = [];
    if (map) rows.push([{ text: copy.openMap, url: map }]);
    rows.push([{ text: (MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru).menuButton, callback_data: 'myreq:list' }]);
    try {
      await telegramRequest(token, 'editMessageText', { chat_id: user.chatId, message_id: options.editMessageId, text, reply_markup: { inline_keyboard: rows } });
      return { message_id: options.editMessageId };
    } catch {
      // ниже отправим обычным сообщением
    }
  }
  // Сразу после записи клиенту важнее вернуть главное меню, чем показать две
  // кнопки: карта уходит ссылкой в текст, «Мои заявки» названы в подписи.
  if (options.keyboard) {
    const withMap = map ? [text, copy.openMap + ': ' + map].join('\n\n') : text;
    return sendMessage(user.chatId, withMap, token, { reply_markup: options.keyboard });
  }
  const rows = [];
  if (map) rows.push([{ text: copy.openMap, url: map }]);
  rows.push([{ text: (MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru).menuButton, callback_data: 'myreq:list' }]);
  return sendMessage(user.chatId, text, token, { reply_markup: { inline_keyboard: rows } });
}

// The manager confirms a viewing from the admin chat (the client's own date)
// or from the panel (an exact date and time). The client gets a message with
// the details; reminders and the follow-up question are planned from it.
// Пока подтверждение в пути, второе нажатие на ту же запись не принимается.
// Между проверкой «уже подтверждён» и записью есть ожидание отправки, и два
// менеджера, нажавшие кнопку одновременно, отправляли клиенту два одинаковых
// подтверждения. С тех пор как чаты обрабатываются параллельно, это стало
// делом одной секунды.
const confirmingViewings = new Set();

async function confirmViewing(inquiry, options = {}, token = data.config.botToken) {
  if (!inquiry || inquiry.type !== 'viewing') throw new Error('Это не запись на просмотр');
  if (confirmingViewings.has(inquiry.id)) throw new Error('Просмотр уже подтверждается — подождите секунду');
  confirmingViewings.add(inquiry.id);
  try {
    return await confirmViewingOnce(inquiry, options, token);
  } finally {
    confirmingViewings.delete(inquiry.id);
  }
}

async function confirmViewingOnce(inquiry, options, token) {
  const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
  if (!user || !user.chatId) throw new Error('У клиента нет доступного чата');
  const viewing = normalizeViewing(inquiry.viewing || {});
  const date = options.date != null ? String(options.date) : viewing.date;
  const time = options.time != null ? String(options.time) : '';
  if (date && !DAY_KEY_PATTERN.test(date)) throw new Error('Некорректная дата просмотра');
  if (time && !CLOCK_TIME_PATTERN.test(time)) throw new Error('Время укажите в формате ЧЧ:ММ');
  if (date && date < localDayKey()) throw new Error('Дата просмотра уже прошла');
  if (viewing.cancelledAt && inquiry.status === 'closed') throw new Error('Клиент отменил этот просмотр');
  if (date !== viewing.confirmedDate || time !== viewing.confirmedTime) {
    viewing.remindedAt = '';
    viewing.feedbackAskedAt = '';
  }
  const wasConfirmed = Boolean(viewing.confirmedAt);
  viewing.confirmedDate = date;
  viewing.confirmedTime = time;
  viewing.confirmedAt = new Date().toISOString();
  viewing.cancelledAt = '';
  // Saved only once the client has the message: a failed send must not
  // leave a "confirmed" viewing the client knows nothing about.
  const message = await sendViewingConfirmation({ ...inquiry, viewing }, user, token);
  inquiry.viewing = viewing;
  const when = viewingWhen(inquiry, 'ru');
  inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
  inquiry.replies.push({
    id: crypto.randomUUID(),
    text: (wasConfirmed ? 'Просмотр перенесён: ' : 'Просмотр подтверждён: ') + [when.date, when.time].filter(Boolean).join(', '),
    source: options.source === 'panel' ? 'panel' : 'telegram',
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    telegramMessageId: message && message.message_id ? Number(message.message_id) : null,
  });
  inquiry.replies = inquiry.replies.slice(-50);
  if (inquiry.status !== 'in_progress') inquiry.status = 'in_progress';
  // Кто подтвердил просмотр — тот и ведёт заявку, если она ничья.
  if (options.by && !inquiry.assignee) {
    inquiry.assignee = options.by;
    inquiry.takenAt = new Date().toISOString();
  }
  // Подтверждённый просмотр сам двигает воронку: менеджеру не надо помнить
  // про отдельный выпадающий список. Но только вперёд: если менеджер уже
  // поставил «Переговоры», подтверждение или перенос просмотра этап не
  // откатывает. А закрытое дело («Выиграно»/«Проиграно») новый просмотр
  // оживляет — этап становится «Просмотр».
  const stageIndex = PIPELINE_STAGES.indexOf(inquiry.pipelineStage);
  if (stageIndex < PIPELINE_STAGES.indexOf('viewing') || stageIndex > PIPELINE_STAGES.indexOf('negotiation')) inquiry.pipelineStage = 'viewing';
  inquiry.updatedAt = new Date().toISOString();
  saveDataNow();
  return inquiry;
}

async function handleViewingConfirmCallback(query, token) {
  if (!adminCallbackAllowed(query)) {
    await acknowledgeCallback(query, token, INTERACTION_TEXT.ru.stale);
    return;
  }
  const id = String(query.data || '').split(':').slice(2).join(':');
  const inquiry = data.inquiries.find((item) => item.id === id);
  if (!inquiry || inquiry.type !== 'viewing') {
    await acknowledgeCallback(query, token, 'Заявка не найдена — возможно, она удалена.');
    return;
  }
  // An old button (another manager's chat, or a notification sent before the
  // panel confirmed or the client cancelled) must not change the viewing.
  const viewing = inquiry.viewing || {};
  const stale = inquiry.status === 'closed' ? 'Заявка закрыта' + (viewing.cancelledAt ? ': клиент отменил просмотр' : '')
    : viewing.confirmedAt ? 'Просмотр уже подтверждён' + (viewing.confirmedDate ? ' на ' + [viewingDateLabel(viewing.confirmedDate, 'ru'), viewing.confirmedTime].filter(Boolean).join(', ') : '') + '. Изменить дату можно в панели.'
      : '';
  if (stale) {
    await acknowledgeCallback(query, token, stale);
    telegramRequest(token, 'editMessageReplyMarkup', { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: inquiryStatusMarkup(inquiry) }).catch(() => {});
    return;
  }
  try {
    const pressed = adminChatFor(query.message.chat.id);
    await confirmViewing(inquiry, { source: 'telegram', by: pressed ? pressed.name : '' }, token);
  } catch (error) {
    await acknowledgeCallback(query, token, 'Не удалось подтвердить: ' + error.message);
    return;
  }
  await acknowledgeCallback(query, token, 'Просмотр подтверждён — клиент получил сообщение');
  await refreshInquiryCards(inquiry, token);
  try {
    // Под обзором /viewings кнопки свои: обновляем сам обзор, а не заменяем его кнопки на кнопки карточки.
    if (String((query.message && query.message.text) || '').startsWith('📅 Сегодня')) {
      const reply = viewingsReply();
      await telegramRequest(token, 'editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: reply.text, reply_markup: reply.markup || { inline_keyboard: [] } });
      return;
    }
    await telegramRequest(token, 'editMessageReplyMarkup', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: inquiryStatusMarkup(inquiry),
    });
  } catch {
    // The confirmation is saved even if the old buttons can no longer change.
  }
}

// --- Cancellation by the client ------------------------------------------------

function viewingIsUpcoming(inquiry, now = new Date()) {
  if (inquiry.type !== 'viewing' || inquiry.status === 'closed') return false;
  const viewing = inquiry.viewing || {};
  if (viewing.cancelledAt) return false;
  const date = viewing.confirmedAt ? viewing.confirmedDate : viewing.date;
  return !date || date >= localDayKey(now);
}

async function cancelViewing(inquiry, user) {
  inquiry.viewing = normalizeViewing(inquiry.viewing || {});
  inquiry.viewing.cancelledAt = new Date().toISOString();
  inquiry.status = 'closed';
  inquiry.updatedAt = new Date().toISOString();
  saveDataNow();
  const property = viewingProperty(inquiry);
  const when = viewingWhen(inquiry, 'ru');
  await notifyAdministratorAction(user, 'Клиент отменил просмотр', [
    property ? '🔖 ' + (localized(property.title, 'ru') || property.reference || property.id) : '',
    [when.date, when.time].filter(Boolean).join(', '),
  ].filter(Boolean).join('\n'), inquiry.id, null, { important: true, icon: '🚫' });
}

// --- Reminders, feedback and the day's list ------------------------------------

function inquiryUser(inquiry) {
  const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
  return user && user.chatId && !user.blocked ? user : null;
}

function viewingReminderDue(inquiry, now) {
  const viewing = inquiry.viewing;
  if (!viewing || !viewing.confirmedAt || !viewing.confirmedDate || viewing.remindedAt || viewing.cancelledAt || inquiry.status === 'closed') return false;
  const dueAt = dateFromDayKey(viewing.confirmedDate, -1);
  dueAt.setHours(VIEWING_REMINDER_HOUR, 0, 0, 0);
  const dayStart = dateFromDayKey(viewing.confirmedDate);
  // Confirmed in the evening before or later: the confirmation itself is fresh.
  return now >= dueAt && now < dayStart && now.getHours() < CLIENT_QUIET_HOUR && Date.parse(viewing.confirmedAt) < dueAt.getTime();
}

function viewingFeedbackDue(inquiry, now) {
  const viewing = inquiry.viewing;
  if (!viewing || !viewing.confirmedAt || !viewing.confirmedDate || viewing.feedbackAskedAt || viewing.cancelledAt || viewing.feedback) return false;
  const dayStart = dateFromDayKey(viewing.confirmedDate);
  // Closed before the day of the viewing means it did not take place.
  if (inquiry.status === 'closed' && !(Date.parse(inquiry.updatedAt) >= dayStart.getTime())) return false;
  const askAt = dateFromDayKey(viewing.confirmedDate, 1);
  askAt.setHours(VIEWING_FEEDBACK_HOUR, 0, 0, 0);
  const lastDay = dateFromDayKey(viewing.confirmedDate, 1 + FEEDBACK_WINDOW_DAYS);
  return now >= askAt && now < lastDay && now.getHours() < CLIENT_QUIET_HOUR - 1;
}

async function sendViewingReminder(inquiry, user, token) {
  const language = user.preferredLanguage || inquiry.language || 'ru';
  const copy = VIEWING_NOTICE_TEXT[language] || VIEWING_NOTICE_TEXT.ru;
  const property = viewingProperty(inquiry);
  const rows = [];
  const map = property && !(inquiry.viewing && inquiry.viewing.online) ? validHttpUrl(property.mapUrl) : '';
  if (map) rows.push([{ text: copy.openMap, url: map }]);
  rows.push([{ text: (MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru).cancelViewing, callback_data: 'myreq:cancel:' + inquiry.id }]);
  await sendMessage(user.chatId, viewingDetailsText(inquiry, property, language, copy.reminder, copy.reminderFooter), token, { reply_markup: { inline_keyboard: rows } });
}

async function sendViewingFeedbackRequest(inquiry, user, token) {
  const language = user.preferredLanguage || inquiry.language || 'ru';
  const copy = VIEWING_NOTICE_TEXT[language] || VIEWING_NOTICE_TEXT.ru;
  const property = viewingProperty(inquiry);
  const title = property ? localizedExact(property.title, language) || localized(property.title, language) || property.reference || '' : '';
  await sendMessage(user.chatId, [title ? '🔖 ' + title : '', copy.feedbackQuestion].filter(Boolean).join('\n\n'), token, {
    reply_markup: { inline_keyboard: [
      [{ text: copy.liked, callback_data: 'vfb:liked:' + inquiry.id }],
      [{ text: copy.questions, callback_data: 'vfb:questions:' + inquiry.id }],
      [{ text: copy.disliked, callback_data: 'vfb:disliked:' + inquiry.id }],
    ] },
  });
}

function agendaLine(inquiry, when) {
  const user = userById(inquiry.userId) || {};
  const property = viewingProperty(inquiry);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';
  return '• ' + [
    when,
    property ? localized(property.title, 'ru') || property.reference || '' : '',
    name + (user.username ? ' (@' + user.username + ')' : '') + (user.phone ? ', ' + user.phone : ''),
    inquiry.viewing && inquiry.viewing.online ? '📹 онлайн' : '',
  ].filter(Boolean).join(' — ');
}

// /viewings in the admin chat: today, tomorrow and the requests that still
// wait for the manager to confirm a date.
function viewingsOverview(now = new Date()) {
  const today = localDayKey(now);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  const tomorrow = localDayKey(next);
  let unconfirmed = 0;
  const day = (key, title) => {
    const { confirmed, waiting } = dayViewings(key);
    unconfirmed += waiting.length;
    const lines = [
      ...confirmed.map((inquiry) => agendaLine(inquiry, inquiry.viewing.confirmedTime || russianViewingText(inquiry.viewing.timeText))),
      ...waiting.map((inquiry) => agendaLine(inquiry, '⏳ ' + (russianViewingText(inquiry.viewing.timeText) || ''))),
    ];
    return [title + ', ' + viewingDateLabel(key, 'ru'), ...(lines.length ? lines : ['• нет'])].join('\n');
  };
  const sections = [day(today, '📅 Сегодня'), day(tomorrow, '📅 Завтра')];
  const later = openViewings()
    .filter((inquiry) => !inquiry.viewing.confirmedAt && ![today, tomorrow].includes(inquiry.viewing.date) && (!inquiry.viewing.date || inquiry.viewing.date > today))
    .sort((a, b) => String(a.viewing.date || '9999').localeCompare(String(b.viewing.date || '9999')));
  unconfirmed += later.length;
  if (later.length) {
    sections.push(['⏳ Ждут подтверждения на другие дни:', ...later.slice(0, 10).map((inquiry) => agendaLine(inquiry, [viewingDateLabel(inquiry.viewing.date, 'ru') || russianViewingText(inquiry.viewing.dateText), russianViewingText(inquiry.viewing.timeText)].filter(Boolean).join(', ')))].join('\n'));
  }
  const laterConfirmed = openViewings().filter((inquiry) => inquiry.viewing.confirmedAt && inquiry.viewing.confirmedDate > tomorrow).length;
  if (laterConfirmed) sections.push('✅ Подтверждено на следующие дни: ' + laterConfirmed);
  if (unconfirmed) sections.push('⏳ — ещё не подтверждён: кнопка «✅ Подтвердить просмотр» под уведомлением о записи.');
  return sections.join('\n\n');
}

// Запросы на просмотр, которые ещё ждут подтверждения менеджера (сегодняшние и будущие), — по дате.
function viewingsToConfirm(now = new Date()) {
  const today = localDayKey(now);
  return openViewings()
    .filter((inquiry) => !inquiry.viewing.confirmedAt && (!inquiry.viewing.date || inquiry.viewing.date >= today))
    .sort((a, b) => String(a.viewing.date || '9999').localeCompare(String(b.viewing.date || '9999')));
}

const VIEWING_BUTTONS_SHOWN = 6;

// /viewings: обзор и под ним по кнопке на каждый ещё не подтверждённый просмотр — «Подтвердить: Пт 02.10, утром».
function viewingsReply(now = new Date()) {
  const waiting = viewingsToConfirm(now);
  let text = viewingsOverview(now);
  if (waiting.length) text = text.replace(/\n\n⏳ — ещё не подтверждён: [^\n]*$/, '') + '\n\n⏳ — ещё не подтверждён: кнопки ниже подтверждают дату и время, выбранные клиентом.';
  const rows = waiting.slice(0, VIEWING_BUTTONS_SHOWN).map((inquiry) => {
    const when = viewingWhen(inquiry, 'ru');
    const user = userById(inquiry.userId) || {};
    const label = '✅ ' + [[when.date, when.time].filter(Boolean).join(', ') || 'Подтвердить', user.firstName].filter(Boolean).join(' · ') + (inquiry.viewing.online ? ' 📹' : '');
    return [{ text: label.length > 60 ? label.slice(0, 59) + '…' : label, callback_data: 'inq:confirm:' + inquiry.id }];
  });
  return { text, markup: rows.length ? { inline_keyboard: rows } : null };
}

// Today's viewings for the admin, once a day in the morning.
function openViewings() {
  return data.inquiries.filter((inquiry) => inquiry.type === 'viewing' && inquiry.viewing && inquiry.status !== 'closed' && !inquiry.viewing.cancelledAt);
}

// Viewings of one day: confirmed ones by time, and the requests for that day
// the manager has not confirmed yet.
function dayViewings(key) {
  const open = openViewings();
  const confirmed = open
    .filter((inquiry) => inquiry.viewing.confirmedAt && inquiry.viewing.confirmedDate === key)
    .sort((a, b) => String(a.viewing.confirmedTime || '99').localeCompare(String(b.viewing.confirmedTime || '99')));
  const waiting = open.filter((inquiry) => !inquiry.viewing.confirmedAt && inquiry.viewing.date === key);
  return { confirmed, waiting };
}

function viewingAgenda(now = new Date()) {
  const today = localDayKey(now);
  const { confirmed, waiting } = dayViewings(today);
  if (!confirmed.length && !waiting.length) return '';
  return [
    '📅 Просмотры сегодня, ' + viewingDateLabel(today, 'ru'),
    ...confirmed.map((inquiry) => agendaLine(inquiry, inquiry.viewing.confirmedTime || russianViewingText(inquiry.viewing.timeText))),
    ...(waiting.length ? ['', '⏳ Ждут подтверждения:', ...waiting.map((inquiry) => agendaLine(inquiry, russianViewingText(inquiry.viewing.timeText)))] : []),
  ].join('\n');
}

async function runViewingNotices(now = new Date(), token = data.config.botToken) {
  const result = { reminders: [], feedback: [], agenda: '' };
  if (!token) return result;
  let budget = VIEWING_NOTICES_PER_RUN;
  for (const inquiry of data.inquiries) {
    if (budget <= 0) break;
    if (inquiry.type !== 'viewing' || !inquiry.viewing) continue;
    const reminder = viewingReminderDue(inquiry, now);
    const feedback = !reminder && viewingFeedbackDue(inquiry, now);
    if (!reminder && !feedback) continue;
    const user = inquiryUser(inquiry);
    // Sent at most once, even if Telegram refuses: no retries every 15 minutes.
    const markedBefore = reminder ? inquiry.viewing.remindedAt : inquiry.viewing.feedbackAskedAt;
    if (reminder) inquiry.viewing.remindedAt = now.toISOString();
    else inquiry.viewing.feedbackAskedAt = now.toISOString();
    scheduleSave();
    if (!user) continue;
    budget -= 1;
    try {
      if (reminder) {
        await sendViewingReminder(inquiry, user, token);
        result.reminders.push(inquiry.id);
      } else {
        await sendViewingFeedbackRequest(inquiry, user, token);
        result.feedback.push(inquiry.id);
      }
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(user);
      else if (temporaryDeliveryError(error)) {
        // Связь пропала не по вине клиента: снимаем отметку, чтобы следующая
        // проверка (через 15 минут) попробовала снова. Окно напоминания
        // ограничено — устаревшее напоминание всё равно не уйдёт.
        if (reminder) inquiry.viewing.remindedAt = markedBefore || '';
        else inquiry.viewing.feedbackAskedAt = markedBefore || '';
        scheduleSave();
      } else recordError(reminder ? 'Напоминание о просмотре' : 'Вопрос после просмотра', error);
    }
    await delay(40);
  }
  const adminChatId = cleanText(data.config.adminChatId, 40);
  const today = localDayKey(now);
  if (adminChatId && now.getHours() >= adminMorningHour(VIEWING_AGENDA_HOUR) && data.lastViewingAgendaFor !== today) {
    const agendaMarkedBefore = data.lastViewingAgendaFor;
    data.lastViewingAgendaFor = today;
    const agenda = viewingAgenda(now);
    if (agenda) {
      try {
        const plan = adminSendPlan('viewing');
        if (plan.send) await sendMessage(adminChatId, agenda, token, { track: false, ...plan.options });
        result.agenda = plan.send ? agenda : '';
      } catch (error) {
        // Список дел на день нужен утром: при обрыве связи отметка снимается,
        // и список уйдёт со следующей проверкой.
        if (temporaryDeliveryError(error)) data.lastViewingAgendaFor = agendaMarkedBefore;
        saveDataNow();
        throw error;
      }
    }
  }
  saveDataNow();
  return result;
}

// --- The client's answer after the viewing -------------------------------------

async function handleViewingFeedbackCallback(query, token) {
  const [, kind, ...rest] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = VIEWING_NOTICE_TEXT[language] || VIEWING_NOTICE_TEXT.ru;
  const inquiry = data.inquiries.find((item) => item.id === rest.join(':'));
  // Only the client the question was sent to can answer it, and only once.
  if (!inquiry || inquiry.userId !== String(user.id) || !inquiry.viewing || inquiry.viewing.feedback || !['liked', 'questions', 'disliked'].includes(kind)) {
    await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
    return;
  }
  inquiry.viewing.feedback = kind;
  inquiry.viewing.feedbackAt = new Date().toISOString();
  scheduleSave();
  await acknowledgeCallback(query, token);
  if (query.message && query.message.message_id) {
    telegramRequest(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  const property = viewingProperty(inquiry);
  const record = property && ['active', 'reserved'].includes(property.status) ? property : null;
  const title = property ? localized(property.title, 'ru') || property.reference || property.id : '';
  if (kind === 'liked') {
    createInquiry(user, [
      record ? propertyRequestText(record, 'ru', 'interest') : '',
      'После просмотра: понравилось, хочет обсудить следующие шаги',
    ].filter(Boolean).join('\n\n'), { type: record ? 'interest' : 'general', propertyId: record ? record.id : '' });
    saveDataNow();
    await sendMessage(chatId, copy.likedReply, token, { reply_markup: menuKeyboard(language) });
    return;
  }
  if (kind === 'questions') {
    user.pendingAction = record
      ? { type: 'question', propertyId: record.id, createdAt: new Date().toISOString() }
      : { type: 'manager_question', createdAt: new Date().toISOString() };
    saveDataNow();
    const cancel = (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).cancel;
    await sendMessage(chatId, copy.questionsReply, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + cancel, callback_data: record ? 'property:cancel:' + record.id : 'contact:cancel' }]] },
    });
    return;
  }
  saveDataNow();
  void notifyAdministratorAction(user, 'Отзыв после просмотра: не подошло', title ? '🔖 ' + title : '', inquiry.id, null, { important: true, icon: '💬' });
  if (record) await sendSimilarProperty(chatId, user, record, token, { intro: copy.dislikedReply, noSimilarText: copy.dislikedNoSimilar });
  else await sendMessage(chatId, copy.dislikedNoSimilar, token, { reply_markup: menuKeyboard(language) });
}

export {
  CLIENT_QUIET_HOUR,
  VIEWING_AGENDA_HOUR,
  VIEWING_FEEDBACK_HOUR,
  VIEWING_REMINDER_HOUR,
  cancelViewing,
  confirmViewing,
  handleViewingConfirmCallback,
  handleViewingFeedbackCallback,
  parseViewingDate,
  runViewingNotices,
  sendViewingConfirmation,
  viewingAgenda,
  viewingDateLabel,
  viewingDayForOption,
  viewingFeedbackDue,
  viewingIsUpcoming,
  viewingReminderDue,
  viewingWhen,
  viewingsOverview,
  viewingsReply,
};
