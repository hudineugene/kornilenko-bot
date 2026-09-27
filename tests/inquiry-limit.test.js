'use strict';

// Обращений бот хранит не больше пяти тысяч. Раньше при переполнении старые
// удалялись молча — включая те, где клиент ждёт ответа: карточка исчезала из
// панели, а человек в Telegram продолжал ждать.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, ADMIN_CHAT, resetData, cleanup } = require('./helpers/chat');

let MAX = 0;

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
});
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = ADMIN_CHAT;
  data.config.statusNotices = true;
}));
test.after(cleanup);

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
