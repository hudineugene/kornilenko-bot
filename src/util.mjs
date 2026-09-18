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

export {
  cleanText,
  clone,
  dayKey,
  delay,
  fillTemplate,
  hashPassword,
};
