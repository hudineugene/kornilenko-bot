'use strict';

// «Что требует внимания» собирает бот — один список на всю панель: его
// показывают Обзор, колокольчик и Центр уведомлений. Раньше Обзор считал своё
// в браузере, поэтому часть поводов (пустой для клиента каталог, заявки в
// группу) не доходила ни до колокольчика, ни до телефона. И число «ждут
// ответа» каждый экран считал по-своему.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, property, resetData, cleanup } = require('./helpers/chat');

let attention = null;
let waitingConversationCount = null;

const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();

// Объект «активен», но без обязательных полей: клиент его не увидит.
function incomplete(id) {
  return {
    id, status: 'active', reference: '', dealType: 'sale', propertyType: 'apartment',
    title: { ru: 'Без номера', en: '', es: '' }, description: { ru: 'Описание', en: '', es: '' },
    city: { ru: 'Бенидорм', en: '', es: '' }, area: null, bedrooms: null, bathrooms: null,
    imagesByLanguage: { ru: [], en: [], es: [] },
  };
}

function waitingClient(id, inquiryIds) {
  const data = bot.getData();
  data.users[id] = { id, chatId: Number(id), firstName: 'Клиент ' + id, preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(5) };
  for (const inquiryId of inquiryIds) {
    data.inquiries.push({
      id: inquiryId, userId: id, chatId: id, language: 'ru', type: 'general', text: 'Вопрос',
      status: 'new', pipelineStage: 'new', replies: [], messages: [], readAt: '',
      createdAt: minutesAgo(30), updatedAt: minutesAgo(5), clientMessageAt: minutesAgo(5),
    });
  }
}

const titles = () => attention().map((item) => item.title);

test.before(async () => {
  const module = await import('../src/admin-notifications.mjs');
  attention = module.currentAdminNotifications;
  ({ waitingConversationCount } = module);
});
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminNotificationVerifiedAt = new Date().toISOString();
}));
test.after(cleanup);

test('каталог, которого клиент не видит, попадает в список дел', () => {
  const data = bot.getData();
  data.objects = [incomplete('a'), incomplete('b')];
  const all = attention().find((item) => item.kind === 'catalog');
  assert.ok(all, 'повод найден');
  assert.equal(all.severity, 'bad', 'это серьёзно: каталог у клиента пустой');
  assert.match(all.title, /не видят ни одного объекта/);
  assert.equal(all.route.view, 'catalog', 'ведёт в каталог');

  // Один из трёх заполнен — тогда это предупреждение с числами.
  data.objects.push(property('good-1', 'Вилла у моря', 'active'));
  const some = attention().find((item) => item.kind === 'catalog');
  assert.equal(some.severity, 'warn');
  assert.match(some.title, /2 из 3 объектов не показываются клиентам/);

  // Всё заполнено — повода нет.
  data.objects = [property('good-2', 'Квартира', 'active')];
  assert.equal(attention().some((item) => item.kind === 'catalog'), false, 'когда всё видно, не напоминаем');
});

test('одна ошибка связи — одна строка в ленте: «нет связи» и «техническая ошибка» с тем же текстом не дублируются', async () => {
  const { runtime } = await import('../src/store.mjs');
  const saved = { status: runtime.status, failures: runtime.consecutiveFailures, error: runtime.lastError };
  try {
    const message = 'Telegram отклонил токен бота. Проверьте токен в настройках.';
    runtime.status = 'error';
    runtime.consecutiveFailures = 3;
    runtime.lastError = message;
    bot.getData().errors = [{ id: 'e1', area: 'Связь с Telegram', message, createdAt: minutesAgo(1) }];
    const both = attention();
    assert.equal(both.filter((item) => item.kind === 'system' && /связи с Telegram/.test(item.title)).length, 1, 'строка про связь есть');
    assert.equal(both.filter((item) => item.kind === 'error').length, 0, 'та же ошибка второй строкой не повторяется');

    // Другая, настоящая техническая ошибка остаётся.
    bot.getData().errors = [{ id: 'e2', area: 'Копия данных в Telegram', message: 'Файл слишком большой', createdAt: minutesAgo(1) }];
    assert.equal(attention().filter((item) => item.kind === 'error').length, 1);

    // Связь вернулась — ошибка про Telegram остаётся в журнале и показывается как раньше.
    runtime.status = 'online';
    runtime.consecutiveFailures = 0;
    runtime.lastError = '';
    bot.getData().errors = [{ id: 'e3', area: 'Связь с Telegram', message, createdAt: minutesAgo(1) }];
    assert.equal(attention().filter((item) => item.kind === 'error').length, 1);
  } finally {
    Object.assign(runtime, { status: saved.status, consecutiveFailures: saved.failures, lastError: saved.error });
  }
});

test('пустой каталог тоже повод', () => {
  bot.getData().objects = [];
  const item = attention().find((entry) => entry.kind === 'catalog');
  assert.match(item.title, /нет активных объектов/);
});

test('заявки на вступление в группу видны в списке дел', () => {
  const data = bot.getData();
  data.objects = [property('good-3', 'Квартира', 'active')];
  assert.equal(attention().some((item) => item.kind === 'group'), false, 'пока заявок нет — молчим');

  data.groups = [{
    id: '-100500', chatId: '-100500', title: 'Канал', type: 'channel', status: 'member',
    messages: [], joinRequests: [{ userId: '9001', name: 'Гость', createdAt: minutesAgo(10) }, { userId: '9002', name: 'Гость 2', createdAt: minutesAgo(5) }],
  }];
  const item = attention().find((entry) => entry.kind === 'group');
  assert.ok(item, 'повод появился');
  assert.match(item.title, /2 заявок на вступление/);
  assert.equal(item.route.view, 'reach');
});

test('«ждут ответа» считается по клиентам, а не по заявкам', () => {
  const data = bot.getData();
  data.objects = [property('good-4', 'Квартира', 'active')];
  assert.equal(waitingConversationCount(), 0, 'пока никто не писал');

  waitingClient('880001', ['q-1', 'q-2']);
  waitingClient('880002', ['q-3']);
  assert.equal(waitingConversationCount(), 2, 'две заявки одного клиента — это один ждущий клиент');

  // Ответили одному из них — остаётся один.
  const answered = data.inquiries.filter((item) => item.userId === '880001');
  for (const item of answered) {
    item.status = 'in_progress';
    item.replies = [{ id: 'r-' + item.id, text: 'Ответили', source: 'panel', createdAt: new Date().toISOString() }];
  }
  assert.equal(waitingConversationCount(), 1);
});

test('дело «клиент написал» остаётся, пока клиенту не ответили', () => {
  const data = bot.getData();
  data.objects = [property('good-6', 'Квартира', 'active')];
  waitingClient('880010', ['q-10']);
  const messages = () => attention().filter((item) => item.kind === 'message');
  assert.equal(messages().length, 1, 'клиент написал — есть дело');

  // Менеджер открыл диалог и прочитал, но не ответил: дело остаётся.
  const inquiry = data.inquiries.find((item) => item.id === 'q-10');
  inquiry.readAt = new Date().toISOString();
  assert.equal(messages().length, 1, 'прочитано — не значит «ответили»');
  assert.equal(bot.waitingConversationCount ? bot.waitingConversationCount() : waitingConversationCount(), 1, 'и «ждут ответа» то же');

  // Ответил — дело уходит само.
  inquiry.status = 'in_progress';
  inquiry.replies = [{ id: 'r-10', text: 'Здравствуйте', source: 'panel', createdAt: new Date().toISOString() }];
  assert.equal(messages().length, 0, 'ответили — дела нет');
});

test('дело «клиент написал» уходит и при закрытии заявки', () => {
  const data = bot.getData();
  data.objects = [property('good-7', 'Квартира', 'active')];
  waitingClient('880011', ['q-11']);
  assert.equal(attention().filter((item) => item.kind === 'message').length, 1);
  data.inquiries.find((item) => item.id === 'q-11').status = 'closed';
  assert.equal(attention().filter((item) => item.kind === 'message').length, 0, 'закрытая заявка не ждёт ответа');
});

test('состояние отдаёт то же число, что и список дел', async () => {
  const { safeState } = await import('../src/admin-http.mjs');
  bot.getData().objects = [property('good-5', 'Квартира', 'active')];
  waitingClient('880003', ['q-4']);
  waitingClient('880004', ['q-5']);

  const state = safeState({ csrf: 'x' });
  assert.equal(state.waitingConversationCount, 2, 'панель получает число от бота');
  const messages = attention().filter((item) => item.kind === 'message');
  assert.equal(messages.length, 2, 'и столько же поводов «новое сообщение»');
});
