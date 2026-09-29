'use strict';

// Поиск по клиентам на сервере. В панель попадают 500 последних клиентов, и
// клиент старше 500-го без заявок в общем поиске не находился вовсе. Теперь поиск
// клиентов идёт по всей базе на стороне бота (имя, ник, телефон, номер, заметка), а
// полную карточку найденного клиента панель запрашивает отдельно.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');

let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    // 600 клиентов: в панель попадают только 500 последних по активности.
    for (let index = 1; index <= 600; index += 1) {
      data.users['u' + index] = { id: 'u' + index, chatId: 1000 + index, firstName: 'Клиент' + index, lastName: '', activity: [], lastSeenAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString() };
    }
    Object.assign(data.users.u1, { firstName: 'Ирина', lastName: 'Соколова', username: 'irina_sk', phone: '+34 600 111 222', note: 'Ищет дом в Кальпе', lastSeenAt: '2020-01-01T00:00:00.000Z' });
    data.users.u2 = { ...data.users.u2, contactName: 'Пабло Гарсия', lastSeenAt: '2020-01-02T00:00:00.000Z' };
    const password = bot.hashPassword('search-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'search-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
});

const search = async (query) => (await realFetch(base + '/api/conversations/search?q=' + encodeURIComponent(query), { headers })).json();

test('клиент старше 500-го без заявок находится поиском', async () => {
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  assert.ok(!state.users.some((user) => user.id === 'u1' && !user.partial), 'предпосылка: Ирины в панели нет');
  const found = await search('соколова');
  assert.deepEqual(found.clients.map((client) => client.id), ['u1']);
  assert.equal(found.clients[0].name, 'Ирина Соколова');
  assert.equal(found.clients[0].username, 'irina_sk');
});

test('по нику (с @ и без), телефону в любом написании, номеру, имени для связи и заметке', async () => {
  for (const query of ['irina_sk', '@irina_sk', '600111222', '+34 600 111', 'u1', 'кальпе']) {
    assert.deepEqual((await search(query)).clients.map((client) => client.id).filter((id) => id === 'u1'), ['u1'], 'запрос: ' + query);
  }
  assert.deepEqual((await search('гарсия')).clients.map((client) => client.id), ['u2'], 'имя для связи');
});

test('не больше восьми, неподходящие не попадают, короткий запрос — пусто', async () => {
  const many = await search('Клиент');
  assert.equal(many.clients.length, 8);
  assert.deepEqual((await search('несуществующий')).clients, []);
  assert.deepEqual((await search('к')).clients, []);
});

test('поиск требует входа', async () => {
  const response = await realFetch(base + '/api/conversations/search?q=клиент');
  assert.equal(response.status, 401);
});

test.describe('полная карточка клиента', () => {
  test('отдаётся по номеру; чужие реакции в переписке не приезжают целиком', async () => {
    bot.getData().users.u1.activity = Array.from({ length: 15 }, (_, index) => ({ id: 'r' + index, kind: 'reaction', text: 'Реакция ' + index, createdAt: new Date(2026, 0, index + 1).toISOString() })).concat([{ id: 'm', kind: 'message', direction: 'in', text: 'Секретное сообщение', createdAt: '2026-01-01T00:00:00.000Z' }]);
    const answer = await realFetch(base + '/api/users/u1', { headers });
    assert.equal(answer.status, 200);
    const { user } = await answer.json();
    assert.equal(user.id, 'u1');
    assert.equal(user.firstName, 'Ирина');
    assert.equal(user.note, 'Ищет дом в Кальпе');
    assert.equal(user.activity.length, 10, 'как и в общем состоянии — только последние реакции');
    assert.ok(user.activity.every((item) => item.kind === 'reaction'));
  });

  test('неизвестный клиент — 404, без входа — 401', async () => {
    assert.equal((await realFetch(base + '/api/users/нет-такого', { headers })).status, 404);
    assert.equal((await realFetch(base + '/api/users/u1')).status, 401);
  });
});
