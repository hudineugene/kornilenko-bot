'use strict';

// Опасные действия в панели просят текущий пароль: одной открытой (или
// украденной) сессии недостаточно, чтобы выкачать данные с токенами, заменить
// их или отдать заявки клиентов другому чату.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-42';
let base = '';
let headers = {};

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.config.adminChatId = '9990001';
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': (await login.json()).csrf,
  };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const post = (url, body) => realFetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) });

test.describe('скачивание копии данных', () => {
  test('без пропуска копию не отдают', async () => {
    const response = await realFetch(base + '/api/backup', { headers });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Ссылка на копию устарела|пароль/i);
  });

  test('пропуск выдаётся по паролю и работает один раз', async () => {
    assert.equal((await post('/api/backup/ticket', { currentPassword: 'не тот пароль' })).status, 403);
    const issued = await post('/api/backup/ticket', { currentPassword: PASSWORD });
    assert.equal(issued.status, 200);
    const { ticket } = await issued.json();
    assert.ok(ticket);

    const first = await realFetch(base + '/api/backup?ticket=' + ticket, { headers });
    assert.equal(first.status, 200);
    const backup = JSON.parse(zlib.gunzipSync(Buffer.from(await first.arrayBuffer())).toString('utf8'));
    assert.ok(backup.config, 'копия пришла целиком');

    const second = await realFetch(base + '/api/backup?ticket=' + ticket, { headers });
    assert.equal(second.status, 403, 'второй раз по тому же пропуску нельзя');
  });
});

test('восстановление копии требует пароль в заголовке', async () => {
  // Настоящая копия: иначе проверка содержимого отклонит её ещё до пароля.
  // Бот в копии выключен, иначе восстановление запустит опрос Telegram и тест
  // не закончится.
  const snapshot = JSON.parse(JSON.stringify(bot.getData()));
  snapshot.config.active = false;
  const file = zlib.gzipSync(Buffer.from(JSON.stringify({ backup: snapshot }), 'utf8'));
  const restore = (password) => realFetch(base + '/api/restore', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream', cookie: headers.cookie, 'x-csrf-token': headers['x-csrf-token'],
      ...(password ? { 'x-current-password': Buffer.from(password, 'utf8').toString('base64') } : {}),
    },
    body: file,
  });
  assert.equal((await restore('')).status, 403, 'без пароля данные не заменить');
  assert.equal((await restore('совсем не тот')).status, 403);
  const ok = await restore(PASSWORD);
  assert.equal(ok.status, 200);
  // Восстановление сбрасывает сессии: возвращаем свою для остальных проверок.
  headers.cookie = ok.headers.get('set-cookie').split(';')[0];
  headers['x-csrf-token'] = (await ok.json()).csrf;
  const password = bot.hashPassword(PASSWORD);
  bot.getData().config.passwordSalt = password.salt;
  bot.getData().config.passwordHash = password.hash;
  bot.getData().config.messages = bot.getData().config.messages || {};
});

test.describe('смена чата администратора и менеджеров', () => {
  test('чат администратора не сменить без пароля', async () => {
    const data = bot.getData();
    const body = { messages: data.config.messages, active: false, adminChatId: '7770001' };
    const without = await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify(body) });
    assert.equal(without.status, 403);
    assert.equal(String(data.config.adminChatId), '9990001', 'чат остался прежним');

    const withPassword = await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ ...body, currentPassword: PASSWORD }) });
    assert.equal(withPassword.status, 200);
    assert.equal(String(bot.getData().config.adminChatId), '7770001');
  });

  test('остальные настройки сохраняются как раньше, без пароля', async () => {
    const data = bot.getData();
    const response = await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({
      messages: data.config.messages, active: false, adminChatId: String(data.config.adminChatId), notifyMode: 'all',
    }) });
    assert.equal(response.status, 200, 'смена режима уведомлений пароля не требует');
    assert.equal(bot.getData().config.notifyMode, 'all');
  });

  test('список менеджеров меняется только с паролем', async () => {
    const put = (body) => realFetch(base + '/api/managers', { method: 'PUT', headers, body: JSON.stringify(body) });
    const without = await put({ managers: [{ name: 'Мария', chatId: '5550001' }] });
    assert.equal(without.status, 403);
    assert.deepEqual(bot.getData().config.managers, [], 'список не изменился');

    const withPassword = await put({ managers: [{ name: 'Мария', chatId: '5550001' }], currentPassword: PASSWORD });
    assert.equal(withPassword.status, 200);
    assert.deepEqual(bot.getData().config.managers.map((manager) => manager.name), ['Мария']);

    // Сохранение без изменений пароля не требует: имя администратора можно
    // поправить, не вводя пароль заново.
    const sameList = await put({ adminName: 'Олег', managers: [{ name: 'Мария', chatId: '5550001' }] });
    assert.equal(sameList.status, 200);
    assert.equal(bot.getData().config.adminName, 'Олег');
  });
});
