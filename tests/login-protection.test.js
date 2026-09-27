'use strict';

// Вход из интернета: проверка пароля не должна останавливать бота, перебор —
// упираться в общий лимит и в лимит по подсети, а ответ снаружи не должен
// выдавать, что пароль угадан.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-99';
let base = '';

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
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

// Запрос «из интернета»: по тем же признакам, что их различает сам бот.
function login(password, remote) {
  return realFetch(base + '/api/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(remote ? { 'x-forwarded-proto': 'https', host: 'panel.example.com' } : {}),
    },
    body: JSON.stringify({ password }),
  });
}

test('проверка пароля не останавливает бота', async () => {
  const { loginAttempts } = await import('../src/admin-http.mjs');
  loginAttempts.clear();
  // Пока считаются пароли, бот обязан отвечать на другие запросы. Восемь
  // проверок подряд синхронным способом заняли бы почти секунду, и всё это
  // время клиенты не получали бы ответов.
  // Стоимость одной проверки измеряем здесь же: на разных машинах и под
  // нагрузкой она разная, а жёсткий порог ложно падал бы на полном прогоне тестов.
  const oneCheckStarted = Date.now();
  bot.hashPassword('сколько стоит одна проверка');
  const oneCheck = Math.max(Date.now() - oneCheckStarted, 1);
  const flood = [];
  for (let attempt = 0; attempt < 8; attempt += 1) flood.push(login('неверный-поток-' + attempt, false));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const started = Date.now();
  const status = await realFetch(base + '/api/status');
  const waited = Date.now() - started;
  assert.equal(status.status, 200, 'бот отвечает, пока проверяются пароли');
  // Синхронная проверка задержала бы ответ на все восемь проверок.
  assert.ok(waited < Math.max(150, oneCheck * 3), 'ответ пришёл сразу, а не после всех проверок: ' + waited + ' мс при стоимости проверки ' + oneCheck + ' мс');
  const answers = await Promise.all(flood);
  assert.ok(answers.every((response) => [401, 429].includes(response.status)), 'все попытки отклонены');
});

test.describe('лимит попыток', () => {
  test('адреса из одной подсети IPv6 считаются вместе', async () => {
    const { attemptKey } = await import('../src/admin-input.mjs');
    assert.equal(attemptKey('2a02:9000:1234:5600:1:2:3:4'), attemptKey('2a02:9000:1234:5600:aaaa:bbbb:cccc:dddd'));
    assert.notEqual(attemptKey('2a02:9000:1234:5600::1'), attemptKey('2a02:9000:1234:ffff::1'));
    assert.equal(attemptKey('::ffff:192.168.1.5'), '192.168.1.5', 'адрес IPv4 в обёртке IPv6 считается как IPv4');
  });

  test('после десяти попыток с одного адреса вход закрывается', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    let blocked = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await login('неверный-' + attempt, false);
      if (response.status === 429) blocked += 1;
    }
    assert.ok(blocked >= 2, 'лишние попытки получают отказ, было отказов: ' + blocked);
  });

  test('общий лимит закрывает перебор с разных адресов', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    const { LOGIN_LIMIT_TOTAL, loginAllowed, rememberFailedLogin } = await import('../src/admin-input.mjs');
    loginAttempts.clear();
    let allowed = 0;
    for (let index = 0; index < LOGIN_LIMIT_TOTAL + 10; index += 1) {
      const address = '10.0.' + Math.floor(index / 250) + '.' + (index % 250);
      // Считаются только неудачные попытки — как при настоящем переборе.
      if (loginAllowed(address)) {
        allowed += 1;
        rememberFailedLogin(address);
      }
    }
    assert.equal(allowed, LOGIN_LIMIT_TOTAL, 'сверх общего лимита попытки не проходят, даже с новых адресов');
    // Владельцу на его же компьютере перебор снаружи вход не запирает.
    assert.equal(loginAllowed('127.0.0.1', { local: true }), true, 'локальный вход остаётся открыт');
  });

  test('карта попыток не растёт без предела', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    const { loginAllowed } = await import('../src/admin-input.mjs');
    loginAttempts.clear();
    for (let index = 0; index < 5200; index += 1) loginAllowed('172.16.' + Math.floor(index / 250) + '.' + (index % 250));
    assert.ok(loginAttempts.size <= 5001, 'записей не больше предела, их ' + loginAttempts.size);
    // Устаревшие записи уходят сами.
    for (const [, item] of loginAttempts) item.resetAt = Date.now() - 1000;
    loginAllowed('192.0.2.1');
    assert.ok(loginAttempts.size <= 3, 'старые записи убраны, осталось ' + loginAttempts.size);
  });
});

test.describe('вход из интернета', () => {
  test('ответ одинаковый и на верный, и на неверный пароль', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    const wrong = await login('точно не тот пароль', true);
    const right = await login(PASSWORD, true);
    assert.equal(wrong.status, right.status, 'код ответа не выдаёт пароль');
    const wrongBody = await wrong.json();
    const rightBody = await right.json();
    assert.equal(wrongBody.twoFactor, true, 'снаружи всегда просят код из Telegram');
    assert.equal(rightBody.twoFactor, true);
    assert.equal(Object.keys(wrongBody).sort().join(','), Object.keys(rightBody).sort().join(','), 'состав ответа совпадает');
    assert.notEqual(wrongBody.challenge, rightBody.challenge);
  });

  test('подставной вход не пускает ни с каким кодом', async () => {
    const { loginAttempts } = await import('../src/admin-http.mjs');
    loginAttempts.clear();
    const wrong = await (await login('снова не тот пароль', true)).json();
    for (const code of ['000000', '123456', '999999']) {
      const response = await realFetch(base + '/api/login/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge: wrong.challenge, code }),
      });
      assert.equal(response.status, 401, 'код к подставному входу не подходит');
    }
  });
});
