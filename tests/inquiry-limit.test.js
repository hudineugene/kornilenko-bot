'use strict';

// Обращений бот хранит не больше пяти тысяч. Раньше при переполнении старые
// удалялись молча — включая те, где клиент ждёт ответа: карточка исчезала из
// панели, а человек в Telegram продолжал ждать.

const test = require('node:test');
const assert = require('node:assert/strict');
// Запросы к панели идут по-настоящему, ответы Telegram — через заглушку.
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'panel-password-42';
let MAX = 0;
let base = '';

function fill({ open, closed }) {
  const data = bot.getData();
  const at = (index) => new Date(Date.now() - index * 60000).toISOString();
  const item = (id, status, index) => ({
    id, userId: '5' + index, chatId: '5' + index, language: 'ru', type: 'general',
    text: 'Обращение ' + id, status, replies: [], messages: [],
    createdAt: at(index), updatedAt: at(index), clientMessageAt: at(index),
  });
  // Новые в начале списка, как их складывает сам бот.
  data.inquiries = [];
  for (let index = 0; index < open; index += 1) data.inquiries.push(item('open-' + index, 'new', index));
  for (let index = 0; index < closed; index += 1) data.inquiries.push(item('closed-' + index, 'closed', open + index));
  return data;
}

test.before(async () => {
  ({ MAX_INQUIRIES: MAX } = await import('../src/inquiries.mjs'));
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = ADMIN_CHAT;
  data.config.statusNotices = true;
}));
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

// Вход в панель: пароль задаём после resetData, он стирает настройки.
async function panelHeaders() {
  const data = bot.getData();
  const password = bot.hashPassword(PASSWORD);
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const login = await realFetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(login.status, 200, 'вход в панель удался');
  return {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': (await login.json()).csrf,
  };
}

// Список на пределе, где в конце — открытые обращения: раньше исходящее
// сообщение из панели отрезало именно их.
function fillOldestOpen({ closed }) {
  const data = bot.getData();
  const at = (index) => new Date(Date.now() - index * 60000).toISOString();
  data.inquiries = [];
  for (let index = 0; index < closed; index += 1) {
    data.inquiries.push({
      id: 'closed-' + index, userId: '6' + index, chatId: '6' + index, language: 'ru', type: 'general',
      text: 'Закрыто', status: 'closed', replies: [], messages: [], createdAt: at(index), updatedAt: at(index), clientMessageAt: at(index),
    });
  }
  for (let index = 0; index < MAX - closed; index += 1) {
    data.inquiries.push({
      id: 'open-' + index, userId: '7' + index, chatId: '7' + index, language: 'ru', type: 'general',
      text: 'Клиент ждёт ответа', status: 'new', replies: [], messages: [], createdAt: at(closed + index), updatedAt: at(closed + index), clientMessageAt: at(closed + index),
    });
  }
  data.users['8001'] = { id: '8001', chatId: 8001, firstName: 'Новый клиент', preferredLanguage: 'ru', activity: [], favouriteIds: [], comparisonIds: [] };
  return data;
}

const sendFromPanel = (headers) => realFetch(base + '/api/users/8001/message', {
  method: 'POST', headers, body: JSON.stringify({ text: 'Здравствуйте, я ваш менеджер' }),
});

test('исходящее сообщение из панели не срезает открытые обращения молча', async () => {
  const data = fillOldestOpen({ closed: 10 });
  const headers = await panelHeaders();
  const openBefore = data.inquiries.filter((item) => item.status !== 'closed').map((item) => item.id);
  telegram.calls = [];

  const response = await sendFromPanel(headers);
  assert.equal(response.status, 200, await response.text());

  assert.equal(data.inquiries.length, MAX, 'список остался на пределе');
  const openAfter = data.inquiries.filter((item) => item.status !== 'closed' && item.userId !== '8001').map((item) => item.id);
  assert.deepEqual(openAfter, openBefore, 'ни одно обращение, где клиент ждёт ответа, не пропало');
  assert.equal(data.inquiries.filter((item) => item.status === 'closed').length, 9, 'место освободило закрытое обращение');
  assert.ok(data.inquiries.some((item) => item.userId === '8001'), 'новое обращение на месте');
});

test('если закрытых нет, владелец узнаёт и об этом случае', async () => {
  const data = fillOldestOpen({ closed: 0 });
  const headers = await panelHeaders();
  telegram.calls = [];

  const response = await sendFromPanel(headers);
  assert.equal(response.status, 200, await response.text());

  assert.equal(data.inquiries.length, MAX);
  assert.equal(data.errors[0] && data.errors[0].area, 'Предел обращений', 'в журнале панели есть запись');
  const notice = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT);
  assert.equal(notice.length, 1, 'администратор получил предупреждение');
  assert.match(notice[0].body.text, /Обращений стало больше/);
});

test('сначала уходят закрытые, живые остаются', async () => {
  const { trimInquiries } = await import('../src/inquiries.mjs');
  const data = fill({ open: MAX - 100, closed: 300 });
  telegram.calls = [];
  const result = trimInquiries();
  assert.equal(result.removed, 200, 'лишние удалены');
  assert.equal(result.open, 0, 'ни одного живого обращения не тронули');
  assert.equal(data.inquiries.length, MAX);
  assert.equal(data.inquiries.filter((item) => item.status !== 'closed').length, MAX - 100, 'все живые на месте');
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage').length, 0, 'беспокоить не о чем');
});

test('если закрытых не хватило — владелец узнаёт в тот же день', async () => {
  const { trimInquiries } = await import('../src/inquiries.mjs');
  const data = fill({ open: MAX + 50, closed: 0 });
  telegram.calls = [];
  const result = trimInquiries();
  assert.equal(result.open, 50, 'пришлось удалить живые обращения');
  assert.equal(data.inquiries.length, MAX);
  assert.ok(data.inquiries.some((item) => item.id === 'open-0'), 'свежие остались');
  assert.ok(!data.inquiries.some((item) => item.id === 'open-' + (MAX + 49)), 'ушли самые старые');

  const notice = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT);
  assert.equal(notice.length, 1, 'администратор получил сообщение');
  assert.match(notice[0].body.text, /Обращений стало больше/);
  assert.match(notice[0].body.text, /50/, 'сказано, сколько удалено');
  assert.match(notice[0].body.text, /Очистить|Excel/, 'и что с этим делать');
  assert.equal(data.errors[0].area, 'Предел обращений', 'в журнале панели тоже осталась запись');

  // Второй раз за сутки не повторяем: поток обращений не должен стать потоком
  // предупреждений.
  fill({ open: MAX + 10, closed: 0 });
  telegram.calls = [];
  trimInquiries();
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage').length, 0);
});

test('поток обращений не вытесняет из журнала настоящие сбои', async () => {
  // Журнал ошибок хранит 100 последних записей. Раньше каждое обращение сверх
  // предела добавляло свою запись: за сотню обращений из журнала исчезало всё
  // остальное, включая «Сохранение данных» — единственный след того, что бот не
  // может писать на диск.
  const { trimInquiries } = await import('../src/inquiries.mjs');
  const { recordError } = await import('../src/analytics.mjs');
  const data = fill({ open: MAX + 1, closed: 0 });
  recordError('Сохранение данных', new Error('Файл не сохранён: файл занят'));

  for (let index = 0; index < 150; index += 1) {
    data.inquiries.push({
      id: 'extra-' + index, userId: '9' + index, chatId: '9' + index, language: 'ru', type: 'general',
      text: 'Ещё одно', status: 'new', replies: [], messages: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(),
    });
    trimInquiries();
  }

  const overflow = data.errors.filter((entry) => entry.area === 'Предел обращений');
  assert.equal(overflow.length, 1, 'о переполнении сказано один раз за сутки, а не 150');
  assert.ok(data.errors.some((entry) => entry.area === 'Сохранение данных'), 'запись о сбое записи на диск на месте');
  assert.equal(data.inquiries.length, MAX, 'предел соблюдён');
});

test('после удачного сохранения метка повторной записи снимается', async () => {
  const store = await import('../src/store.mjs');
  store.runtime.nextSaveRetryAt = new Date().toISOString();
  store.runtime.lastSaveError = 'файл занят';
  store.saveDataNow();
  assert.equal(store.runtime.nextSaveRetryAt, null, 'повтор больше не назначен');
  assert.equal(store.runtime.lastSaveError, '', 'и сбой снят');
});

test('при загрузке данных живые обращения тоже в приоритете', () => {
  const at = (index) => new Date(Date.now() - index * 60000).toISOString();
  const raw = [];
  // Свежие закрытые и старые живые: раньше выживали первые 5000 подряд.
  for (let index = 0; index < 4990; index += 1) raw.push({ id: 'c' + index, userId: '1', chatId: '1', type: 'general', text: 'закрыто', status: 'closed', createdAt: at(index), updatedAt: at(index) });
  for (let index = 0; index < 100; index += 1) raw.push({ id: 'o' + index, userId: '2', chatId: '2', type: 'general', text: 'в работе', status: 'in_progress', createdAt: at(5000 + index), updatedAt: at(5000 + index) });
  const restored = bot.normalizeLoadedData({ version: 14, inquiries: raw });
  assert.equal(restored.inquiries.length, 5000);
  assert.equal(restored.inquiries.filter((item) => item.status !== 'closed').length, 100, 'все обращения в работе сохранены');
});
