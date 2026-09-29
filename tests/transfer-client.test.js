'use strict';

// Передача клиента другому менеджеру. Ответственный хранится именем, поэтому
// раньше переименование менеджера оставляло его клиентов «без хозяина»: в «Мои»
// они не попадали. Теперь имя в заявках следует за переименованием, а передача —
// отдельное действие: сменить ответственного и сказать об этом новому менеджеру
// в Telegram (одного клиента — целым уведомлением, чтобы на него можно было
// ответить; всех клиентов человека, например перед отпуском, — одной сводкой).

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const MANAGER_CHAT = '8880001';
let base = '';
let headers = {};

const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();

function inquiry(id, userId, extra = {}) {
  return {
    id, userId, chatId: userId, language: 'ru', type: 'question', text: 'Вопрос ' + id, status: 'new', pipelineStage: 'new',
    replies: [], messages: [], createdAt: minutesAgo(30), updatedAt: minutesAgo(20), clientMessageAt: minutesAgo(20), ...extra,
  };
}

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.config.adminName = 'Олег';
    data.config.managers = [{ id: 'm1', name: 'Мария', chatId: MANAGER_CHAT, verifiedAt: '' }];
    data.users['1'] = { id: '1', chatId: 1, firstName: 'Анна', activity: [] };
    data.users['2'] = { id: '2', chatId: 2, firstName: 'Борис', activity: [] };
    data.users['3'] = { id: '3', chatId: 3, firstName: 'Вера', activity: [] };
    data.inquiries.push(
      inquiry('a', '1', { assignee: 'Олег' }),
      inquiry('b', '2', { assignee: 'Олег' }),
      inquiry('closed', '2', { assignee: 'Олег', status: 'closed' }),
      inquiry('maria', '3', { assignee: 'Мария' }),
      inquiry('nobody', '3'),
    );
    const password = bot.hashPassword('transfer-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'transfer-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
  telegram.calls = [];
});

const post = (path, body) => realFetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
const assigneeOf = (id) => bot.getData().inquiries.find((item) => item.id === id).assignee;
const sentTo = (chatId) => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chatId));

test('переименование менеджера не теряет его клиентов: имя в заявках следует за ним', async () => {
  const save = (body) => realFetch(base + '/api/managers', { method: 'PUT', headers, body: JSON.stringify({ currentPassword: 'transfer-password', ...body }) });
  assert.equal((await save({ adminName: 'Олег К.', managers: [{ name: 'Мария Л.', chatId: MANAGER_CHAT }] })).status, 200);
  assert.equal(assigneeOf('maria'), 'Мария Л.', 'клиент Марии остался у неё');
  assert.equal(assigneeOf('a'), 'Олег К.', 'и клиенты администратора — у администратора под новым именем');
  assert.equal(assigneeOf('nobody'), undefined, 'ничьих не трогаем');
  assert.equal(assigneeOf('closed'), 'Олег К.', 'закрытые заявки тоже переименованы: история не расходится');

  // Обычное сохранение без переименования ничего не меняет.
  assert.equal((await save({ adminName: 'Олег К.', managers: [{ name: 'Мария Л.', chatId: MANAGER_CHAT }] })).status, 200);
  assert.equal(assigneeOf('maria'), 'Мария Л.');
});

test('передать одного клиента: ответственный сменился, новому менеджеру ушло уведомление, на которое можно ответить', async () => {
  const answer = await post('/api/inquiries/a/transfer', { to: 'Мария' });
  assert.equal(answer.status, 200);
  const body = await answer.json();
  assert.equal(body.notified, true);
  assert.equal(assigneeOf('a'), 'Мария');
  const messages = sentTo(MANAGER_CHAT);
  assert.equal(messages.length, 1);
  assert.match(messages[0].body.text, /Вам передан клиент/);
  assert.match(messages[0].body.text, /Анна/);
  assert.match(messages[0].body.text, /Передал\(а\): Олег/);
  assert.ok(Object.values(bot.getData().adminReplyTargets).some((target) => target.inquiryId === 'a'), 'ответ на уведомление уйдёт клиенту');
  assert.equal(sentTo(ADMIN_CHAT).length, 0, 'администратору ничего не пришло');
});

test('передача: неизвестное имя — отказ; тому же — без уведомления', async () => {
  const unknown = await post('/api/inquiries/a/transfer', { to: 'Никто' });
  assert.equal(unknown.status, 400);
  assert.equal(assigneeOf('a'), 'Олег');
  assert.equal((await post('/api/inquiries/a/transfer', { to: '' })).status, 400, 'передать «никому» нельзя — для этого есть «Не назначен»');
  assert.equal((await post('/api/inquiries/нет/transfer', { to: 'Мария' })).status, 404);

  const same = await (await post('/api/inquiries/a/transfer', { to: 'Олег' })).json();
  assert.equal(same.moved, 0);
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage').length, 0);
});

test('передать всех клиентов человека (отпуск): переходят открытые заявки, одна сводка новому менеджеру', async () => {
  const answer = await post('/api/inquiries/transfer', { from: 'Олег', to: 'Мария' });
  assert.equal(answer.status, 200);
  const body = await answer.json();
  assert.equal(body.moved, 2, 'две открытые заявки Олега');
  assert.equal(assigneeOf('a'), 'Мария');
  assert.equal(assigneeOf('b'), 'Мария');
  assert.equal(assigneeOf('closed'), 'Олег', 'закрытая остаётся: это уже история');
  assert.equal(assigneeOf('nobody'), undefined);
  const messages = sentTo(MANAGER_CHAT);
  assert.equal(messages.length, 1, 'одна сводка, а не по сообщению на клиента');
  assert.match(messages[0].body.text, /Вам передано клиентов: 2/);
  assert.match(messages[0].body.text, /Анна/);
  assert.match(messages[0].body.text, /Борис/);
});

test('передать всё, что ни за кем не закреплено', async () => {
  const body = await (await post('/api/inquiries/transfer', { from: '', to: 'Мария' })).json();
  assert.equal(body.moved, 1);
  assert.equal(assigneeOf('nobody'), 'Мария');
});

test('передача всех: то же имя и неизвестное имя — отказ', async () => {
  assert.equal((await post('/api/inquiries/transfer', { from: 'Олег', to: 'Олег' })).status, 400);
  assert.equal((await post('/api/inquiries/transfer', { from: 'Олег', to: 'Призрак' })).status, 400);
  assert.equal((await post('/api/inquiries/transfer', { from: 'Призрак', to: 'Мария' })).status, 400);
  assert.equal(assigneeOf('a'), 'Олег');
});

test('передача не проходит без входа и без токена защиты', async () => {
  const noLogin = await realFetch(base + '/api/inquiries/a/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'Мария' }) });
  assert.equal(noLogin.status, 401);
  const wrongToken = await realFetch(base + '/api/inquiries/a/transfer', { method: 'POST', headers: { ...headers, 'x-csrf-token': 'wrong' }, body: JSON.stringify({ to: 'Мария' }) });
  assert.equal(wrongToken.status, 403);
  assert.equal(assigneeOf('a'), 'Олег');
});
