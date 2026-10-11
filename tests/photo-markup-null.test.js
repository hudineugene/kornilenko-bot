'use strict';

// Фото, которое бот уже загружал, уходит по file_id JSON-запросом. Пустые кнопки в нём не должны попадать как
// «reply_markup»: null — Telegram отвечает «object expected as reply markup» (так падала публикация в канал
// сразу после проверки себе).

const test = require('node:test');
const assert = require('node:assert/strict');
const { telegram, TOKEN, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

test('пустые кнопки не отправляются в Telegram: ни null, ни false', async () => {
  resetData();
  const { telegramRequest } = await import('../src/telegram.mjs');
  for (const empty of [null, false, undefined, '']) {
    const before = telegram.calls.length;
    await telegramRequest(TOKEN, 'sendPhoto', { chat_id: 1, photo: 'AgACAgIAAxkBAAI', reply_markup: empty });
    const call = telegram.calls.slice(before).find((item) => item.method === 'sendPhoto');
    assert.ok(call, 'запрос ушёл');
    assert.ok(!('reply_markup' in call.body), 'поля reply_markup нет при значении ' + String(empty));
  }
  const before = telegram.calls.length;
  const markup = { inline_keyboard: [[{ text: 'Открыть', url: 'https://example.com' }]] };
  await telegramRequest(TOKEN, 'sendPhoto', { chat_id: 1, photo: 'AgACAgIAAxkBAAI', reply_markup: markup });
  const kept = telegram.calls.slice(before).find((item) => item.method === 'sendPhoto');
  assert.deepEqual(kept.body.reply_markup, markup, 'настоящие кнопки на месте');
});
