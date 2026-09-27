'use strict';

// Чужая страница в браузере не должна ни настраивать бота, ни трогать вход:
// иначе сайт, открытый в соседней вкладке, мог бы настроить бота на свой токен
// или забить счётчик попыток и запереть вход владельцу.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-55';
let base = '';
let host = '';

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  host = '127.0.0.1:' + bot.server.address().port;
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

function post(path, body, extra = {}) {
  return realFetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body || {}),
  });
}

test.describe('вход', () => {
  test('запрос с чужого сайта отклоняется', async () => {
    const response = await post('/api/login', { password: PASSWORD }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /сторонн/i);
  });

  test('одного признака достаточно, чтобы отказать', async () => {
    const byOrigin = await post('/api/login', { password: PASSWORD }, { origin: 'https://evil.example' });
    assert.equal(byOrigin.status, 403, 'чужой Origin');
    const bySite = await post('/api/login', { password: PASSWORD }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(bySite.status, 403, 'чужой Sec-Fetch-Site');
  });

  test('чужая страница не может запереть вход владельцу', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await post('/api/login', { password: 'подбор-' + attempt }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    }
    assert.equal(loginAttempts.size, 0, 'попытки с чужого сайта даже не считаются');
    const owner = await post('/api/login', { password: PASSWORD }, { origin: 'http://' + host, 'sec-fetch-site': 'same-origin' });
    assert.equal(owner.status, 200, 'владелец спокойно входит');
  });

  test('своя страница панели входит как раньше', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    const response = await post('/api/login', { password: PASSWORD }, { origin: 'http://' + host, 'sec-fetch-site': 'same-origin' });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).csrf);
  });

  test('команда из терминала работает: заголовков браузера там нет', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    const response = await post('/api/login', { password: PASSWORD });
    assert.equal(response.status, 200, 'без Origin и Sec-Fetch-Site запрос проходит');
  });

  test('переход по ссылке (Sec-Fetch-Site: none) не считается чужим', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    const response = await post('/api/login', { password: PASSWORD }, { 'sec-fetch-site': 'none' });
    assert.equal(response.status, 200);
  });
});

test.describe('первичная настройка', () => {
  test('чужая страница не может настроить бота на свой токен', async () => {
    const data = bot.getData();
    const saved = { hash: data.config.passwordHash, salt: data.config.passwordSalt, token: data.config.botToken };
    data.config.passwordHash = '';
    data.config.passwordSalt = '';
    data.config.botToken = '';
    try {
      const response = await post('/api/setup', { token: '123456789:AAHevilTokenAAAAAAAAAAAAAAAAAAAAAAA', password: 'evil-password' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
      assert.equal(response.status, 403);
      assert.equal(bot.getData().config.botToken, '', 'токен не подменён');
    } finally {
      data.config.passwordHash = saved.hash;
      data.config.passwordSalt = saved.salt;
      data.config.botToken = saved.token;
    }
  });
});

test('проверка источника разбирает заголовки без ошибок', async () => {
  const { ownPageRequest } = await import('../src/admin-http.mjs');
  const request = (headers) => ({ headers: { host: 'panel.local', ...headers } });
  assert.equal(ownPageRequest(request({})), true, 'без заголовков — свой');
  assert.equal(ownPageRequest(request({ origin: 'http://panel.local' })), true);
  assert.equal(ownPageRequest(request({ origin: 'https://panel.local' })), true, 'схема не важна, важен адрес');
  assert.equal(ownPageRequest(request({ origin: 'null' })), true, 'страница без адреса (файл) не считается чужой');
  assert.equal(ownPageRequest(request({ origin: 'не ссылка' })), false, 'непонятный Origin — отказ');
  assert.equal(ownPageRequest(request({ origin: 'http://other.host' })), false);
  assert.equal(ownPageRequest(request({ 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(ownPageRequest(request({ 'sec-fetch-site': 'cross-site' })), false);
});
