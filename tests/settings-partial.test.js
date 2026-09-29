'use strict';

// Настройки сохраняются по полям: каждая правка присылает только то, что человек
// изменил. Раньше любая правка (например, переключатель «Бот включён») слала
// полный набор настроек вместе с приветствием из состояния, которое в открытой
// вкладке могло быть старше на 45 секунд, — и молча перезаписывала приветствие,
// изменённое в другой вкладке. А запрос без поля active выключал бота.

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

async function login() {
  const data = bot.getData();
  const password = bot.hashPassword('partial-test-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'partial-test-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
}

const put = (body) => realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify(body) });

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.config.notifyMode = 'all';
    data.config.reminderHours = 4;
    data.config.statusNotices = false;
    data.config.messages.ru.greeting = 'Приветствие, изменённое в другой вкладке';
  });
  await login();
});

test('переключатель «Бот включён» присылает только active и ничего больше не трогает', async () => {
  const before = JSON.stringify(bot.getData().config.messages);
  assert.equal((await put({ active: false })).status, 200);
  const config = bot.getData().config;
  assert.equal(config.active, false);
  assert.equal(JSON.stringify(config.messages), before, 'приветствие не перезаписано');
  assert.equal(config.notifyMode, 'all');
  assert.equal(config.reminderHours, 4);
  assert.equal(config.statusNotices, false);

  // Включение здесь не проверяем: оно запускает опрос Telegram, а в тестах его нет.
});

test('запрос без поля active бота не выключает', async () => {
  assert.equal((await put({ reminderHours: 8 })).status, 200);
  const config = bot.getData().config;
  assert.equal(config.reminderHours, 8);
  assert.equal(config.active, true, 'бот остался включённым');
  assert.equal(config.messages.ru.greeting, 'Приветствие, изменённое в другой вкладке');
});

test('приветствие меняется, только когда его прислали; неполное по-прежнему отклоняется', async () => {
  const messages = JSON.parse(JSON.stringify(bot.getData().config.messages));
  messages.ru.greeting = 'Новое приветствие';
  assert.equal((await put({ messages })).status, 200);
  assert.equal(bot.getData().config.messages.ru.greeting, 'Новое приветствие');
  assert.equal(bot.getData().config.active, true, 'и active при этом не тронут');

  const broken = JSON.parse(JSON.stringify(messages));
  broken.en.help = '';
  const answer = await put({ messages: broken });
  assert.equal(answer.status, 400);
  assert.equal(bot.getData().config.messages.ru.greeting, 'Новое приветствие', 'отклонённый запрос ничего не сохранил');
});

test('уведомления и режим правятся по одному полю', async () => {
  assert.equal((await put({ notifyMode: 'inquiries' })).status, 200);
  assert.equal(bot.getData().config.notifyMode, 'inquiries');
  assert.equal(bot.getData().config.statusNotices, false, 'соседние поля не изменились');
  assert.equal((await put({ statusNotices: true })).status, 200);
  assert.equal(bot.getData().config.statusNotices, true);
  assert.equal(bot.getData().config.notifyMode, 'inquiries');
});
