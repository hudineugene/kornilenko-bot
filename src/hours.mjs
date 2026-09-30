// Рабочее время: когда менеджер на месте. Вне рабочего времени клиент сразу
// узнаёт, когда ему ответят; напоминания администратору приходят только в
// рабочие часы, сводка — к началу рабочего дня. Время — по часам этого
// компьютера.

import { data, scheduleSave } from './store.mjs';
import { normalizeWorkingHours } from './data-format.mjs';
import { whatsappContactUrl } from './catalog.mjs';
import { cleanText, localDayKey, managerNameFor } from './util.mjs';

const LOCALES = { ru: 'ru-RU', en: 'en-GB', es: 'es-ES' };
// Without office hours set, admin messages keep the old daytime window.
const DEFAULT_ADMIN_WINDOW = { from: 9, to: 21 };

function workingHours() {
  return normalizeWorkingHours(data.config && data.config.workingHours);
}

function minutesOf(clock) {
  const [hours, minutes] = String(clock).split(':').map(Number);
  return hours * 60 + minutes;
}

function isWorkingTime(now = new Date(), hours = workingHours()) {
  if (!hours.enabled) return true;
  const minute = now.getHours() * 60 + now.getMinutes();
  return hours.days.includes(now.getDay()) && minute >= minutesOf(hours.from) && minute < minutesOf(hours.to);
}

// The next moment the office opens, looking up to a week ahead.
function nextOpening(now = new Date(), hours = workingHours()) {
  if (!hours.enabled) return null;
  const [openHour, openMinute] = hours.from.split(':').map(Number);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, openHour, openMinute);
    if (hours.days.includes(day.getDay()) && day > now) return day;
  }
  return null;
}

// "today from 09:00", "tomorrow from 09:00", "on Monday from 09:00".
function openingPhrase(opening, language, now = new Date()) {
  const time = opening.getHours() + ':' + String(opening.getMinutes()).padStart(2, '0');
  const days = Math.round((new Date(opening.getFullYear(), opening.getMonth(), opening.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const weekday = new Intl.DateTimeFormat(LOCALES[language] || LOCALES.ru, { weekday: 'long' }).format(opening);
  if (language === 'en') return (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'on ' + weekday) + ' from ' + time;
  if (language === 'es') return (days === 0 ? 'hoy' : days === 1 ? 'mañana' : 'el ' + weekday) + ' a partir de las ' + time;
  const russianDay = { понедельник: 'в понедельник', вторник: 'во вторник', среда: 'в среду', четверг: 'в четверг', пятница: 'в пятницу', суббота: 'в субботу', воскресенье: 'в воскресенье' }[weekday] || weekday;
  return (days === 0 ? 'сегодня' : days === 1 ? 'завтра' : russianDay) + ' с ' + time;
}

// A line for the client after they send something outside office hours;
// '' during office hours or when no hours are set.
function offHoursNote(language, now = new Date()) {
  const hours = workingHours();
  if (!hours.enabled || isWorkingTime(now, hours)) return '';
  const opening = nextOpening(now, hours);
  if (!opening) return '';
  const lang = ['ru', 'en', 'es'].includes(language) ? language : 'ru';
  return String(hours.note[lang] || hours.note.ru).replaceAll('{next}', openingPhrase(opening, lang, now));
}

// Русские окончания: 1 минуту, 2 минуты, 5 минут.
function plural(count, one, few, many) {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = count % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

// «Обычно отвечаем за 15 минут» — клиенту важно знать, ждать ему минуту или
// до завтра. Вне рабочего времени вместо обещания идёт приписка о часах.
function replyPromise(language, now = new Date()) {
  const hours = workingHours();
  const minutes = Number(hours.replyMinutes) || 0;
  if (!minutes) return '';
  if (hours.enabled && !isWorkingTime(now, hours)) return '';
  const lang = ['ru', 'en', 'es'].includes(language) ? language : 'ru';
  if (minutes < 60) {
    if (lang === 'en') return 'We usually reply within ' + minutes + ' minutes.';
    if (lang === 'es') return 'Solemos responder en ' + minutes + ' minutos.';
    return 'Обычно отвечаем за ' + minutes + ' ' + plural(minutes, 'минуту', 'минуты', 'минут') + '.';
  }
  const inHours = Math.round(minutes / 60);
  if (lang === 'en') return 'We usually reply within ' + (inHours === 1 ? 'an hour' : inHours + ' hours') + '.';
  if (lang === 'es') return 'Solemos responder en ' + (inHours === 1 ? 'una hora' : inHours + ' horas') + '.';
  return 'Обычно отвечаем в течение ' + (inHours === 1 ? 'часа' : inHours + ' ' + plural(inHours, 'часа', 'часов', 'часов')) + '.';
}

// «пн–пт», «пн, ср, пт»: подряд идущие дни — диапазоном, остальные списком.
function workingDaysLabel(days, language) {
  const locale = LOCALES[language] || LOCALES.ru;
  // Порядок недели с понедельника: пн … сб, вс.
  const order = [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day));
  const name = (day) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 0, 4 + day)).replace(/\.$/, '');
  const runs = [];
  for (const day of order) {
    const last = runs[runs.length - 1];
    const position = (value) => [1, 2, 3, 4, 5, 6, 0].indexOf(value);
    if (last && position(day) === position(last[last.length - 1]) + 1) last.push(day);
    else runs.push([day]);
  }
  return runs.map((run) => (run.length >= 3 ? name(run[0]) + '–' + name(run[run.length - 1]) : run.map(name).join(', '))).join(', ');
}

const WHAT_NEXT_TEXT = {
  ru: { contact: '👨‍💼 На связи: ', hours: '🕘 Часы работы: ', whatsapp: '🟢 Быстрее — в WhatsApp: ' },
  en: { contact: '👨‍💼 Your contact: ', hours: '🕘 Working hours: ', whatsapp: '🟢 Faster on WhatsApp: ' },
  es: { contact: '👨‍💼 Tu contacto: ', hours: '🕘 Horario: ', whatsapp: '🟢 Más rápido por WhatsApp: ' },
};

// Что клиент видит после заявки помимо «спасибо»: кто на связи, в какие часы
// работают и где можно написать быстрее. Берётся из настроек владельца; что не
// заполнено — строки нет (выдуманных обещаний бот не даёт).
function whatNextLines(language, now = new Date()) {
  const lang = ['ru', 'en', 'es'].includes(language) ? language : 'ru';
  const copy = WHAT_NEXT_TEXT[lang];
  const contacts = data.contacts || {};
  const hours = workingHours();
  const lines = [];
  const manager = managerNameFor(contacts, lang);
  if (manager) lines.push(copy.contact + manager);
  if (hours.enabled) lines.push(copy.hours + workingDaysLabel(hours.days, lang) + ' ' + hours.from.replace(/^0/, '') + '–' + hours.to.replace(/^0/, ''));
  const chat = contacts.whatsappEnabled === false ? '' : whatsappContactUrl(contacts.whatsapp);
  const details = lines.join('\n');
  return { details, whatsapp: chat ? copy.whatsapp + chat : '' };
}

// Третий аргумент — либо «сейчас» (Date), либо { now, user }. С клиентом блок «Что дальше» (на связи,
// часы, WhatsApp) показывается полностью один раз в сутки: приклеенный к каждому подтверждению, он
// за одну сессию повторялся пять раз. В остальные разы — только срок ответа или пометка о часах.
function withOffHoursNote(text, language, options = {}) {
  if (!text) return text;
  const settings = options instanceof Date ? { now: options } : options || {};
  const now = settings.now || new Date();
  const user = settings.user || null;
  const note = offHoursNote(language, now);
  const today = localDayKey(now);
  const full = !user || user.whatNextDay !== today;
  const next = full ? whatNextLines(language, now) : { details: '', whatsapp: '' };
  if (user && full && (next.details || next.whatsapp)) {
    user.whatNextDay = today;
    scheduleSave();
  }
  const promise = note ? '' : replyPromise(language, now);
  const parts = [text, next.details, next.whatsapp, note ? '🌙 ' + note : '', promise ? '⏱ ' + promise : ''].filter(Boolean);
  return parts.join('\n\n');
}

// When admin reminders may be sent: office hours if set, otherwise daytime.
function adminMessagesAllowed(now = new Date()) {
  const hours = workingHours();
  if (hours.enabled) return isWorkingTime(now, hours);
  return now.getHours() >= DEFAULT_ADMIN_WINDOW.from && now.getHours() < DEFAULT_ADMIN_WINDOW.to;
}

// The hour the admin's morning messages (digest, today's viewings) go out.
function adminMorningHour(fallback) {
  const hours = workingHours();
  return hours.enabled ? Number(hours.from.split(':')[0]) : fallback;
}

export {
  DEFAULT_ADMIN_WINDOW,
  adminMessagesAllowed,
  adminMorningHour,
  isWorkingTime,
  nextOpening,
  offHoursNote,
  replyPromise,
  openingPhrase,
  withOffHoursNote,
  workingHours,
};
