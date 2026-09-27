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
  const match = text.match(/(\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+(?:[.,]\d+)?)\s*(millones|millón|millions|million|млн|тысяч|тыс|mil|k|к|m)?/iu);
  if (!match) return 0;
  const suffix = String(match[2] || '').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
  const compact = match[1].replace(/[\s\u00a0\u202f]/g, '');
  const million = /^(?:млн|million|millions|millon|millones|m)$/u.test(suffix);
  const thousand = /^(?:тыс|тысяч|k|к|mil)$/u.test(suffix);
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

// Наибольшая сумма в свободном тексте: «до 600 000 €», «1,2 млн», «300к»,
// «€350,000», «до 800» для аренды. Разбор один и тот же и для поиска фразой,
// и для бюджета в подборе.
function largestMoneyAmount(value, minimum = 100) {
  const source = cleanText(value, 400);
  if (!source) return 0;
  let best = 0;
  for (const candidate of source.matchAll(/\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+(?:[.,]\d+)?/gu)) {
    const after = source.slice(candidate.index + candidate[0].length);
    const amount = parseMoneyAmount(candidate[0] + ' ' + after.slice(0, 12).trim());
    if (amount >= minimum) best = Math.max(best, amount);
  }
  return best;
}

function fillTemplate(template, user) {
  return String(template)
    .replaceAll('{first_name}', user.firstName || 'друг')
    .replaceAll('{last_name}', user.lastName || '')
    .replaceAll('{username}', user.username ? '@' + user.username : '');
}

// Дата по Гринвичу. В самом боте она больше не используется: сутки статистики,
// ежедневная копия и «раз в сутки» считаются по времени бота — иначе летом всё,
// что происходит с полуночи до двух ночи, попадало во вчерашний день.
function dayKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

// Календарная дата по часовому поясу бота (он задаётся в настройках и
// выставляется процессу при запуске): просмотры, сутки статистики, «сегодня».
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
  largestMoneyAmount,
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
