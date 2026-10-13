'use strict';

// Пачка запросов входа, пришедшая разом, не должна проходить лимит попыток целиком: проверка пароля асинхронная,
// и раньше счётчик неудач рос только после неё — каждый запрос видел нулевой счётчик и проверял пароль.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

let base = '';
test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    const password = bot.hashPassword('burst-password-1');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

test('сорок одновременных неверных паролей: проверяются не больше десяти, остальные получают отказ по лимиту', async () => {
  const { loginAttempts } = await import('../src/admin-http.mjs');
  loginAttempts.clear();
  const flood = [];
  for (let index = 0; index < 40; index += 1) {
    flood.push(realFetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', host: 'panel.example.com', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ password: 'неверный-' + index }),
    }));
  }
  const answers = await Promise.all(flood);
  const statuses = answers.map((response) => response.status);
  const checked = statuses.filter((status) => status === 401).length;
  const refused = statuses.filter((status) => status === 429).length;
  assert.ok(checked <= 10, 'паролей проверено не больше лимита на адрес: ' + checked);
  assert.ok(refused >= 30, 'остальные отклонены сразу: ' + refused);
  assert.equal(checked + refused, 40);
});
