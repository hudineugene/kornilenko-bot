'use strict';

// Счётчик попыток входа защищает от перебора, но не должен запирать владельца.
// Раньше он рос на каждом запросе — в том числе на удачных и на локальных: 61
// запрос из интернета закрывал вход и на этом компьютере, а вместе с ним
// смену пароля, копию данных и восстановление.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-73';
let base = '';
let loginAttempts = null;
let limits = null;

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.config.adminChatId = '9990001';
    data.config.adminNotificationVerifiedAt = new Date().toISOString();
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  ({ loginAttempts } = await import('../src/admin-http.mjs'));
  limits = await import('../src/admin-input.mjs');
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

// Запрос «снаружи» отличается от локального теми же признаками, что и у бота.
const outside = { 'x-forwarded-proto': 'https', host: 'panel.example.com', 'cf-connecting-ip': '203.0.113.7' };

function login(password, headers = {}) {
  return realFetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ password }),
  });
}

test('перебор из интернета не запирает вход на этом компьютере', async () => {
  loginAttempts.clear();
  // Перебор снаружи: больше общего лимита неудачных попыток с разных адресов.
  // Считаем их напрямую — иначе проверка ждала бы минуту на одних задержках.
  for (let attempt = 0; attempt < limits.LOGIN_LIMIT_TOTAL + 5; attempt += 1) {
    limits.rememberFailedLogin('203.0.113.' + (attempt % 200));
  }
  assert.equal(limits.loginAllowed('198.51.100.7'), false, 'снаружи вход закрыт');

  const owner = await login(PASSWORD);
  assert.equal(owner.status, 200, 'владелец спокойно входит со своего компьютера');
  // И опасные действия тоже остаются доступны.
  assert.equal(limits.loginAllowed('127.0.0.1', { local: true }), true);
});

test('удачные входы не тратят лимит', async () => {
  loginAttempts.clear();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await login(PASSWORD);
    assert.equal(response.status, 200, 'вход ' + attempt);
  }
  assert.equal(loginAttempts.size, 0, 'счётчик пуст: считать нечего');
});

test('подсеть IPv6 считается одинаково, как бы её ни записали', () => {
  const { attemptKey, expandIpv6 } = limits;
  assert.equal(attemptKey('2001:db8:abcd::1'), attemptKey('2001:db8:abcd:0:1::9'), 'одна подсеть /64');
  assert.equal(attemptKey('[2001:db8:abcd::1]'), attemptKey('2001:db8:abcd::1'), 'скобки не мешают');
  assert.notEqual(attemptKey('2001:db8:abcd::1'), attemptKey('2001:db8:ffff::1'), 'разные подсети');
  assert.deepEqual(expandIpv6('2001:db8::1').slice(0, 4), ['2001', 'db8', '0', '0']);
  assert.equal(attemptKey('::ffff:192.168.1.5'), '192.168.1.5', 'адрес IPv4 в обёртке IPv6');
});

test('повторный пароль считается тем же счётчиком и не останавливает бота', async () => {
  loginAttempts.clear();
  const login200 = await login(PASSWORD);
  const cookie = login200.headers.get('set-cookie').split(';')[0];
  const csrf = (await login200.json()).csrf;
  const ticket = (wrong) => realFetch(base + '/api/backup/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: JSON.stringify({ currentPassword: wrong ? 'не тот пароль' : PASSWORD }),
  });

  const refused = await ticket(true);
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /Неверный пароль/);
  assert.ok(loginAttempts.size > 0, 'неудачная попытка засчитана');

  const accepted = await ticket(false);
  assert.equal(accepted.status, 200, 'с верным паролем пропуск выдаётся');
  assert.equal(loginAttempts.size, 0, 'и счётчик очищен');
});

test('ответ на вход из интернета одинаков и для верного, и для неверного пароля', async () => {
  loginAttempts.clear();
  const measure = async (password) => {
    const started = Date.now();
    const response = await login(password, outside);
    const body = await response.json();
    return { status: response.status, body, spent: Date.now() - started };
  };
  const wrong = await measure('точно не тот пароль');
  const right = await measure(PASSWORD);

  assert.equal(wrong.status, right.status, 'код ответа одинаковый');
  assert.deepEqual(Object.keys(wrong.body).sort(), Object.keys(right.body).sort(), 'состав ответа одинаковый');
  assert.equal(right.body.twoFactor, true);
  // И по времени: раньше верный пароль выдавал себя задержкой на отправку кода.
  assert.ok(Math.abs(wrong.spent - right.spent) < 400, 'время ответа близко: ' + wrong.spent + ' и ' + right.spent + ' мс');
});
