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
// Единица измерения сразу после числа: это расстояние или площадь, а не цена.
// «до 300 м от моря» — метры, «до 150 кв.м» — площадь, «до 2 км» — километры.
const MEASURE_UNIT = /^\s*(?:кв\.?\s*м|м²|м2|метр\w*|м(?![а-яё])|км|га|соток|сотк\w*|sq\.?\s*m|m²|m2|met(?:er|re)s?|m(?![a-z])|km|ha)/iu;
// Масштаб числа: «300к», «1,5 млн», «500 тысяч». Одиночная буква считается
// масштабом только вплотную к числу: «300к» — тысячи, «300 к» и «300 m» —
// скорее единица измерения.
const MONEY_SCALE = /^(\s*)(millones|millón|millions|million|млн|тысяч|тыс|mil|k|к|m)(?![\p{L}])/iu;

function parseMoneyAmount(value) {
  const text = cleanText(value, 100);
  if (!text || /^\s*-/u.test(text)) return 0;
  const number = text.match(/\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+(?:[.,]\d+)?/u);
  if (!number) return 0;
  const after = text.slice(number.index + number[0].length);
  const scaleMatch = after.match(MONEY_SCALE);
  const scaleWord = scaleMatch && (!scaleMatch[1] || scaleMatch[2].length > 1) ? scaleMatch[2] : '';
  const tail = scaleWord ? after.slice(scaleMatch[0].length) : after;
  // Число с единицей измерения — не цена.
  if (MEASURE_UNIT.test(tail)) return 0;
  const match = [text, number[0], scaleWord];
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
    // Кусок исходной строки как есть: важно, вплотную ли стоит буква
    // («300к» — тысячи, «300 м» — метры) и что идёт следом.
    const amount = parseMoneyAmount(source.slice(candidate.index, candidate.index + 40));
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
// «09.09» / «09/09»: день и месяц с ведущими нулями на всех языках. Intl для es-ES отдаёт «9/9»
// (в отличие от ru и en-GB), из-за чего в одном ответе даты выглядели по-разному.
function formatDayMonth(value, language = 'ru') {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return pad(date.getDate()) + (language === 'ru' ? '.' : '/') + pad(date.getMonth() + 1);
}

function localDayKey(value = new Date()) {
  const date = new Date(value);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Local midnight of a YYYY-MM-DD key, moved by a number of days.
function dateFromDayKey(key, addDays = 0) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day + addDays);
}


// Числа и деньги для клиента — по одному правилу на всех экранах. Английский
// «€250,000» (символ впереди), испанский «250.000 €» и русский «250 000 €» (символ
// после). Группировка всегда включена: испанский по умолчанию не отделяет
// тысячи у четырёхзначных чисел, и «3571 €/m²» стояло рядом с «250.000 €».
const NUMBER_LOCALES = { ru: 'ru-RU', en: 'en-GB', es: 'es-ES' };

function formatNumber(value, language = 'ru', maximumFractionDigits = 2) {
  return new Intl.NumberFormat(NUMBER_LOCALES[language] || NUMBER_LOCALES.ru, { maximumFractionDigits, useGrouping: 'always' }).format(value);
}

function formatMoney(value, symbol, language = 'ru', maximumFractionDigits = 0) {
  const amount = formatNumber(value, language, maximumFractionDigits);
  const sign = String(symbol || '€');
  if (language === 'en') return /^[A-Za-z]/.test(sign) ? sign + ' ' + amount : sign + amount;
  return amount + ' ' + sign;
}

export {
  formatMoney,
  formatNumber,
  largestMoneyAmount,
  cleanText,
  clone,
  dateFromDayKey,
  dayKey,
  formatDayMonth,
  localDayKey,
  parseMoneyAmount,
  delay,
  fillTemplate,
  hashPassword,
};
