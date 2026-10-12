'use strict';

// Код из Telegram при входе из интернета — настройка панели. По умолчанию выключен: вход по паролю.
// Включается одним нажатием; выключить можно только с текущим паролем. Без подтверждённого админ-чата
// включить нельзя: код некуда прислать, и вход закрылся бы наглухо.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-77';
let base = '';
let headers = {};

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.config.adminChatId = '9990001';
    data.config.adminNotificationVerifiedAt = new Date().toISOString();
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf, 'content-type': 'application/json' };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

function remoteLogin(password) {
  return realFetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', host: 'panel.example.com' },
    body: JSON.stringify({ password }),
  });
}

function setCode(required, password) {
  return realFetch(base + '/api/login-code', {
    method: 'PUT',
    headers: { ...headers, ...(password ? { 'x-current-password': Buffer.from(password).toString('base64') } : {}) },
    body: JSON.stringify({ required }),
  });
}

test('по умолчанию из интернета входят по паролю, без кода', async () => {
  const { loginAttempts } = await import('../src/admin-http.mjs');
  loginAttempts.clear();
  assert.equal(bot.getData().config.loginCodeRequired, false);
  const right = await remoteLogin(PASSWORD);
  const body = await right.json();
  assert.equal(right.status, 200);
  assert.equal(body.ok, true);
  assert.ok(!body.twoFactor, 'код не спрашивается');
  assert.ok(right.headers.get('set-cookie'), 'сеанс выдан');
  const wrong = await remoteLogin('не-тот-пароль');
  assert.equal(wrong.status, 401, 'неверный пароль отклоняется сразу');
});

test('включённый код снова спрашивается; выключить можно только с паролем', async () => {
  const { loginAttempts } = await import('../src/admin-http.mjs');
  loginAttempts.clear();
  const enabled = await setCode(true);
  assert.equal(enabled.status, 200);
  assert.equal(bot.getData().config.loginCodeRequired, true);
  const challenged = await (await remoteLogin(PASSWORD)).json();
  assert.equal(challenged.twoFactor, true, 'после пароля просят код');
  assert.ok(challenged.challenge);

  const noPassword = await setCode(false);
  assert.notEqual(noPassword.status, 200, 'без пароля код не отключить');
  assert.equal(bot.getData().config.loginCodeRequired, true);
  const wrongPassword = await setCode(false, 'неверный-пароль');
  assert.notEqual(wrongPassword.status, 200);
  assert.equal(bot.getData().config.loginCodeRequired, true);
  const disabled = await setCode(false, PASSWORD);
  assert.equal(disabled.status, 200);
  assert.equal(bot.getData().config.loginCodeRequired, false);
  loginAttempts.clear();
  const again = await (await remoteLogin(PASSWORD)).json();
  assert.ok(again.ok && !again.twoFactor);
});

test('без подтверждённого админ-чата код включить нельзя: прислать его некуда', async () => {
  const config = bot.getData().config;
  const was = config.adminNotificationVerifiedAt;
  config.adminNotificationVerifiedAt = '';
  const refused = await setCode(true);
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /админ-чат/);
  assert.equal(config.loginCodeRequired, false);
  config.adminNotificationVerifiedAt = was;
});

test('настройка видна панели', async () => {
  const response = await realFetch(base + '/api/state', { headers });
  const state = await response.json();
  assert.equal(state.config.loginCodeRequired, false);
});
