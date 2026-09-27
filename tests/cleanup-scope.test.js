'use strict';

// «Очистить → Закрытые и отвеченные» удаляла всё, что не «новое»: вместе с
// закрытыми уходили дела в работе и переписки, где клиент ждёт ответа. Кнопка
// стоит рядом со списком обращений, отменить удаление нельзя.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-21';
const long = 200 * 864e5;
let base = '';
let headers = {};

// Все обращения старые: проверяем именно выбор «какие удалять», а не возраст.
function inquiry(id, extra) {
  const at = new Date(Date.now() - long).toISOString();
  return {
    id,
    userId: '5001',
    chatId: '5001',
    language: 'ru',
    type: 'general',
    text: id,
    status: 'new',
    replies: [],
    messages: [],
    createdAt: at,
    updatedAt: at,
    clientMessageAt: at,
    ...extra,
  };
}

function reply(minutesAgo) {
  return [{ id: 'r-' + minutesAgo, text: 'Ответили', source: 'panel', createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString() }];
}

function seed() {
  const data = bot.getData();
  const at = new Date(Date.now() - long).toISOString();
  data.inquiries = [
    inquiry('closed', { status: 'closed' }),
    // Ответ отправлен позже сообщения клиента, обращение никто не взял в работу.
    inquiry('answered', { replies: reply(1), clientMessageAt: at }),
    // Живая работа: менеджер взял обращение себе.
    inquiry('in-progress', { status: 'in_progress', replies: reply(1), assignee: 'Мария' }),
    // Клиент написал после ответа — ждёт.
    inquiry('waiting', { replies: reply(120), clientMessageAt: new Date(Date.now() - 60 * 60000).toISOString() }),
    // Новое, без единого ответа.
    inquiry('new'),
  ];
  return data;
}

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
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

const clean = (scope) => realFetch(base + '/api/inquiries/cleanup', {
  method: 'POST',
  headers,
  body: JSON.stringify({ scope, olderThanDays: 0 }),
});

test('«закрытые и отвеченные» не трогают работу и тех, кто ждёт ответа', async () => {
  const data = seed();
  const result = await (await clean('answered')).json();
  assert.equal(result.removed, 2, 'удалены только закрытое и отвеченное');
  assert.deepEqual(data.inquiries.map((item) => item.id), ['in-progress', 'waiting', 'new']);
});

test('«только закрытые» удаляют именно закрытые', async () => {
  const data = seed();
  const result = await (await clean('closed')).json();
  assert.equal(result.removed, 1);
  assert.deepEqual(data.inquiries.map((item) => item.id), ['answered', 'in-progress', 'waiting', 'new']);
});

test('«все» — это по-прежнему все', async () => {
  const data = seed();
  const result = await (await clean('all')).json();
  assert.equal(result.removed, 5);
  assert.deepEqual(data.inquiries, []);
});

test('возраст по-прежнему учитывается', async () => {
  const data = seed();
  data.inquiries.push(inquiry('closed-fresh', { status: 'closed', updatedAt: new Date().toISOString() }));
  const result = await (await realFetch(base + '/api/inquiries/cleanup', {
    method: 'POST', headers, body: JSON.stringify({ scope: 'closed', olderThanDays: 90 }),
  })).json();
  assert.equal(result.removed, 1, 'свежее закрытое остаётся');
  assert.ok(data.inquiries.some((item) => item.id === 'closed-fresh'));
});

test('панель считает так же, как бот, и говорит, чего не тронет', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function cleanupMatches\(item, scope\)/, 'в панели те же правила');
  assert.doesNotMatch(PANEL_HTML, /item\.status !== "new" : /, 'старое правило «всё, что не новое» убрано');
  assert.match(PANEL_HTML, /не трогают обращения в работе/, 'в диалоге сказано, что останется');
});
