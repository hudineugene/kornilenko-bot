// Мелкие общие функции без состояния.

import crypto from 'node:crypto';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function fillTemplate(template, user) {
  return String(template)
    .replaceAll('{first_name}', user.firstName || 'друг')
    .replaceAll('{last_name}', user.lastName || '')
    .replaceAll('{username}', user.username ? '@' + user.username : '');
}

function dayKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

// The calendar date on this computer, for things planned in local days
// (viewings, follow-ups). dayKey() above is the UTC date used by statistics.
function localDayKey(value = new Date()) {
  const date = new Date(value);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Local midnight of a YYYY-MM-DD key, moved by a number of days.
function dateFromDayKey(key, addDays = 0) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day + addDays);
}

export {
  cleanText,
  clone,
  dateFromDayKey,
  dayKey,
  localDayKey,
  delay,
  fillTemplate,
  hashPassword,
};
