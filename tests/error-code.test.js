'use strict';

// Ошибки бот пишет с коротким техническим кодом: по нему панель YABOT различает причины обрывов связи
// с Telegram (не ответил вовремя, сеть, ошибка на стороне Telegram). Текст ошибки — прежний.

const test = require('node:test');
const assert = require('node:assert/strict');

test('код ошибки: тайм-аут, сеть, ответ Telegram; без кода — без поля', async () => {
  const { errorCode } = await import('../src/analytics.mjs');
  const { normalizeTelegramError } = await import('../src/telegram.mjs').catch(() => ({}));
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError', code: 23 });
  assert.equal(errorCode(timeout), 'TIMEOUT');
  const wrapped = new Error('Telegram не ответил вовремя', { cause: timeout });
  wrapped.code = '23';
  assert.equal(errorCode(wrapped), 'TIMEOUT', 'обёртка бота: числовой код DOMException не показываем');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'UND_ERR_CONNECT_TIMEOUT' })), 'UND_ERR_CONNECT_TIMEOUT');
  assert.equal(errorCode(Object.assign(new Error('x'), { status: 502 })), 'HTTP_502');
  assert.equal(errorCode(Object.assign(new Error('x'), { status: 429, telegramCode: 429 })), 'TG_429');
  assert.equal(errorCode(new Error('просто ошибка')), '');
  assert.equal(errorCode('строка'), '');
  if (normalizeTelegramError) assert.equal(errorCode(normalizeTelegramError(timeout)), 'TIMEOUT');
});

test('запись ошибки: код сохраняется рядом с текстом', async () => {
  const { recordError } = await import('../src/analytics.mjs');
  const { data } = await import('../src/store.mjs');
  data.errors = [];
  recordError('Связь с Telegram', Object.assign(new Error('Соединение с Telegram было прервано.'), { code: 'ECONNRESET' }));
  recordError('Сохранение данных', new Error('Файл занят'));
  assert.equal(data.errors[1].code, 'ECONNRESET');
  assert.equal(data.errors[1].message, 'Соединение с Telegram было прервано.');
  assert.equal('code' in data.errors[0], false);
});
