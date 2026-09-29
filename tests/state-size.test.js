'use strict';

// Панель обновляет состояние раз в 45 секунд. Раньше в каждом таком ответе
// ехала вся переписка всех обращений — на тысяче бесед это десятки мегабайт
// по кругу. Переписка нужна только для беседы, которую открыли.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-37';
let base = '';
let headers = {};

function message(id, index) {
  return {
    id: id + '-m' + index,
    direction: index % 2 ? 'out' : 'in',
    kind: 'text',
    text: 'Сообщение номер ' + index + ' в беседе, с описанием объекта и условиями просмотра.',
    createdAt: new Date(Date.now() - (100 - index) * 60000).toISOString(),
  };
}

function seedConversations(count, perConversation) {
  const data = bot.getData();
  data.users = {};
  data.inquiries = [];
  for (let index = 0; index < count; index += 1) {
    const id = 'u' + index;
    data.users[id] = {
      id, chatId: id, firstName: 'Клиент ' + index, preferredLanguage: 'ru',
      phone: '+3460000' + index, activity: [],
      // Давний клиент: в 500 последних он не попадёт.
      lastSeenAt: new Date(Date.now() - index * 3600000).toISOString(),
    };
    data.inquiries.push({
      id: 'inq-' + index, userId: id, chatId: id, language: 'ru', type: 'general',
      text: 'Вопрос по объекту', status: 'new', replies: [], readAt: '',
      messages: Array.from({ length: perConversation }, (unused, number) => message('inq-' + index, number)),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(),
    });
  }
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

test('в состоянии панели нет переписки, но видно, что она есть', async () => {
  seedConversations(50, 20);
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const inquiry = state.inquiries.find((item) => item.id === 'inq-0');
  assert.equal(inquiry.messages, undefined, 'переписка в общем состоянии не едет');
  assert.equal(inquiry.messageCount, 20, 'но видно, сколько в ней сообщений');
  assert.ok(inquiry.lastMessageAt, 'и когда было последнее');
  assert.equal(inquiry.text, 'Вопрос по объекту', 'остальное на месте');
});

test('состояние без переписки заметно легче', async () => {
  seedConversations(300, 20);
  const withoutMessages = Buffer.byteLength(await (await realFetch(base + '/api/state', { headers })).text());
  const full = Buffer.byteLength(JSON.stringify(bot.getData().inquiries));
  assert.ok(withoutMessages < full / 2, 'ответ панели меньше половины от одной только переписки: '
    + Math.round(withoutMessages / 1024) + ' КБ против ' + Math.round(full / 1024) + ' КБ');
});

test('переписка открытой беседы приходит по отдельному запросу', async () => {
  seedConversations(5, 8);
  const response = await realFetch(base + '/api/conversations/u2/timeline', { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.userId, 'u2');
  assert.equal(body.messages.length, 8);
  assert.equal(body.messages[0].inquiryId, 'inq-2', 'видно, к какому обращению относится сообщение');
  // Сообщения по возрастанию времени: панель показывает их сверху вниз.
  const times = body.messages.map((item) => Date.parse(item.createdAt));
  assert.deepEqual(times, times.slice().sort((a, b) => a - b));
});

test('клиент, который давно не писал, не остаётся безымянным', async () => {
  // Больше пятисот клиентов: старые в список последних не попадают.
  const data = seedConversations(520, 2);
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  assert.ok(state.users.length > 500, 'к пятистам последним добавлены те, у кого есть обращения');
  const old = state.users.find((user) => user.id === 'u515');
  assert.ok(old, 'клиент из давних нашёлся');
  assert.equal(old.firstName, 'Клиент 515');
  assert.equal(old.phone, data.users.u515.phone, 'телефон на месте — по нему и звонят');
  assert.equal(old.partial, true, 'карточка помечена как краткая');
});

test('панель грузит переписку сама и показывает список клиентов порциями', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /\/timeline/, 'панель просит переписку отдельно');
  assert.match(PANEL_HTML, /Загружаем сообщения…/, 'и показывает, что она грузится');
  assert.match(PANEL_HTML, /Показать ещё /, 'список клиентов продолжается по кнопке');
  assert.doesNotMatch(PANEL_HTML, /rows\.slice\(0, 300\)/, 'молчаливого обрыва на 300 строках больше нет');
});
