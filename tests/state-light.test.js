'use strict';

// Состояние панели уходит каждым обновлением экрана, поэтому тяжёлое из него вынесено: лента группы
// (до 200 сообщений) и заявки на вступление приходят отдельным запросом, когда группу открыли.

const realFetch = global.fetch; // до helpers: они подменяют fetch на заглушку Telegram
const test = require('node:test');
const assert = require('node:assert/strict');
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
    data.groups.push({
      id: '-100777', title: 'Стройка', type: 'supergroup', status: 'administrator', memberCount: 40, isForum: false, topics: [], pinnedMessageId: 5,
      messages: Array.from({ length: 200 }, (_, index) => ({ messageId: index + 1, name: 'Ирина', text: 'сообщение ' + index, kind: 'text', threadId: 0, date: '2026-09-30T10:00:00.000Z' })),
      joinRequests: [{ userId: '1', name: 'Пётр', username: 'petr', at: '2026-09-30T10:00:00.000Z' }],
    });
    const password = bot.hashPassword('state-light-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'state-light-password' }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});

test('в состоянии панели группа без ленты и заявок, но со счётчиками', async () => {
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const [group] = state.groups;
  assert.equal(group.title, 'Стройка');
  assert.equal(group.messages, undefined, 'ленты в состоянии нет');
  assert.equal(group.joinRequests, undefined, 'заявок на вступление тоже');
  assert.equal(group.messageCount, 200);
  assert.equal(group.lastMessageId, 200);
  assert.equal(group.joinRequestCount, 1);
  assert.equal(group.pinnedMessageId, 5, 'остальные поля на месте');
  assert.ok(JSON.stringify(state).length < 30000, 'состояние не тащит двести сообщений');
});

test('GET /api/groups/:id отдаёт группу целиком; неизвестная — 404; нужен вход', async () => {
  const full = await (await realFetch(base + '/api/groups/-100777', { headers })).json();
  assert.equal(full.group.messages.length, 200);
  assert.equal(full.group.joinRequests[0].name, 'Пётр');
  assert.equal((await realFetch(base + '/api/groups/-100999', { headers })).status, 404);
  assert.equal((await realFetch(base + '/api/groups/-100777')).status, 401);
});
