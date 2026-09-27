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

// Parse the usual ways clients write a budget: 525000, 525 000,
// 525k, 1.2 million, 1,2 млн. A decimal without a scale is rejected unless
// it is an unambiguous thousands separator such as 1.800.
function parseMoneyAmount(value) {
  const text = cleanText(value, 100);
  if (!text || /^\s*-/u.test(text)) return 0;
  const match = text.match(/(\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+(?:[.,]\d+)?)\s*(millones|millón|millions|million|млн|тысяч|тыс|mil|k|m)?/iu);
  if (!match) return 0;
  const suffix = String(match[2] || '').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
  const compact = match[1].replace(/[\s\u00a0\u202f]/g, '');
  const million = /^(?:млн|million|millions|millon|millones|m)$/u.test(suffix);
  const thousand = /^(?:тыс|тысяч|k|mil)$/u.test(suffix);
  let amount;
  if (million && /^\d+[.,]\d{1,2}$/u.test(compact)) amount = Number(compact.replace(',', '.'));
  else if (!million && /[.,]/u.test(compact) && !/^\d{1,3}(?:[.,]\d{3})+$/u.test(compact)) return 0;
  else amount = Number(compact.replace(/[^\d]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (million) amount *= 1000000;
  if (thousand) amount *= 1000;
  amount = Math.round(amount);
  return amount <= 1000000000 ? amount : 0;
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
  parseMoneyAmount,
  delay,
  fillTemplate,
  hashPassword,
};
