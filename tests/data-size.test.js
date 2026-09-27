'use strict';

// Файл данных пишется при каждом изменении. Отступы в JSON и длинная история
// действий каждого клиента почти не видны на пяти клиентах, но на пяти тысячах
// это десятки мегабайт: сохранение начинает занимать заметное время, а панель
// тянет всё это с собой при каждом обновлении экрана.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { bot, dataFile, resetData, cleanup } = require('./helpers/chat');

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('файл данных пишется без отступов', () => {
  bot.saveDataNow();
  const raw = fs.readFileSync(dataFile, 'utf8');
  assert.doesNotMatch(raw.slice(0, 400), /\n\s+"/, 'в файле нет переносов с отступами');
  assert.equal(JSON.parse(raw).version, bot.DATA_VERSION || JSON.parse(raw).version, 'файл остаётся читаемым для программы');
});

test('без отступов файл заметно меньше', () => {
  const data = bot.getData();
  // Тысяча клиентов с историей — такой файл и начинает тормозить сохранение.
  for (let index = 0; index < 1000; index += 1) {
    data.users['9' + index] = {
      id: '9' + index,
      chatId: '9' + index,
      firstName: 'Клиент ' + index,
      preferredLanguage: 'ru',
      lastSeenAt: new Date().toISOString(),
      activity: [{ id: 'a' + index, direction: 'in', kind: 'message', text: 'Здравствуйте, интересует объект', createdAt: new Date().toISOString() }],
    };
  }
  const compact = Buffer.byteLength(JSON.stringify(data));
  const pretty = Buffer.byteLength(JSON.stringify(data, null, 2));
  assert.ok(compact < pretty * 0.75, 'экономия больше четверти: ' + Math.round((1 - compact / pretty) * 100) + '%');
});

test('история действий клиента не растёт без предела', async () => {
  const { ACTIVITY_KEPT, recordActivity } = await import('../src/analytics.mjs');
  const data = bot.getData();
  data.users['700500'] = { id: '700500', chatId: '700500', firstName: 'Анна', preferredLanguage: 'ru', activity: [] };
  const user = data.users['700500'];
  for (let index = 0; index < 60; index += 1) {
    recordActivity(user, 'in', 'Сообщение номер ' + index, 'message');
  }
  assert.equal(user.activity.length, ACTIVITY_KEPT, 'хранится последние ' + ACTIVITY_KEPT);
  assert.match(user.activity[user.activity.length - 1].text, /59/, 'последние записи на месте');

  const long = recordActivity(user, 'in', 'а'.repeat(900), 'message');
  assert.ok(long.text.length <= 200, 'длинный текст обрезается, его длина ' + long.text.length);
});

test('загрузка старых данных тоже подрезает историю', () => {
  const restored = bot.normalizeLoadedData({
    version: 14,
    users: { 5: { id: '5', chatId: '5', activity: Array.from({ length: 50 }, (unused, index) => ({ id: 'a' + index, direction: 'in', kind: 'message', text: 'старая запись', createdAt: new Date().toISOString() })) } },
  });
  assert.equal(restored.users['5'].activity.length, 20);
});

test('в панель уходят только реакции, а не вся история', async () => {
  const { safeState } = await import('../src/admin-http.mjs');
  const data = bot.getData();
  data.users['700600'] = {
    id: '700600', chatId: '700600', firstName: 'Борис', preferredLanguage: 'ru', lastSeenAt: new Date().toISOString(),
    activity: [
      { id: 'm1', direction: 'in', kind: 'message', text: 'Обычное сообщение', createdAt: new Date().toISOString() },
      { id: 'r1', direction: 'in', kind: 'reaction', text: '❤️', createdAt: new Date().toISOString() },
    ],
  };
  const state = safeState({ csrf: 'test' });
  const sent = state.users.find((user) => user.id === '700600');
  assert.deepEqual(sent.activity.map((item) => item.kind), ['reaction'], 'обычные сообщения в панель не уезжают');
  assert.equal(data.users['700600'].activity.length, 2, 'у самого бота история цела');
});
