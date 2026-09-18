// Рабочее время: когда менеджер на месте. Вне рабочего времени клиент сразу
// узнаёт, когда ему ответят; напоминания администратору приходят только в
// рабочие часы, сводка — к началу рабочего дня. Время — по часам этого
// компьютера.

import { data } from './store.mjs';
import { normalizeWorkingHours } from './data-format.mjs';

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

function withOffHoursNote(text, language, now = new Date()) {
  const note = offHoursNote(language, now);
  return text && note ? text + '\n\n🌙 ' + note : text;
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
  openingPhrase,
  withOffHoursNote,
  workingHours,
};
