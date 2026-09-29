'use strict';

// Одно число — одно определение. Панель показывала «Без ответа 6» в отчёте и
// «5 клиентов ждут ответа» на «Сегодня»; самопроверка писала «клиенты видят
// все 4 объекта» при пяти в таблице (один «Забронирован»); у клиента стояло
// «Сообщений 0» при живой переписке. Каждое такое расхождение — повод не верить
// остальным цифрам, поэтому сверяем экраны между собой.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, property, resetData, cleanup } = require('./helpers/chat');

let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

async function login() {
  const data = bot.getData();
  const password = bot.hashPassword('numbers-agree-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'numbers-agree-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
}

const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();

function waitingInquiry(id, userId) {
  return {
    id, userId, chatId: userId, language: 'ru', type: 'general', text: 'Вопрос', status: 'new', pipelineStage: 'new', replies: [],
    messages: [
      { id: id + '-1', direction: 'in', kind: 'text', text: 'Вопрос', createdAt: minutesAgo(30) },
      { id: id + '-2', direction: 'in', kind: 'text', text: 'Ещё вопрос', createdAt: minutesAgo(10) },
    ],
    createdAt: minutesAgo(30), updatedAt: minutesAgo(10), clientMessageAt: minutesAgo(10),
  };
}

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.users['1'] = { id: '1', chatId: 1, firstName: 'Ольга', activity: [], lastSeenAt: minutesAgo(5) };
    data.users['2'] = { id: '2', chatId: 2, firstName: 'Николай', activity: [], lastSeenAt: minutesAgo(6) };
    data.users['3'] = { id: '3', chatId: 3, firstName: 'Тихий', activity: [], lastSeenAt: minutesAgo(7) };
    // У Ольги два обращения, оба без ответа; у Николая одно.
    data.inquiries.push(waitingInquiry('a1', '1'), waitingInquiry('a2', '1'), waitingInquiry('b1', '2'));
  });
  await login();
});

test('«без ответа» — одно число: в недельном отчёте, на «Сегодня» и в состоянии панели считаются клиенты, а не обращения', async () => {
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  assert.equal(state.waitingConversationCount, 2, 'на «Сегодня»: два клиента ждут ответа');
  const report = bot.weeklyReportData(new Date(), 'current');
  assert.equal(report.waiting, state.waitingConversationCount, 'в отчёте то же число, а не три обращения');
  const text = bot.weeklyReport(new Date());
  assert.match(text, /Сейчас без ответа: 2/);
});

test('самопроверка: «Забронирован» клиенты тоже видят — он считается в каталоге', async () => {
  const data = bot.getData();
  data.objects.push(property('on-sale', 'В продаже', 'active'), property('booked', 'Забронированный', 'reserved'), property('sold', 'Проданный', 'sold'));
  const { runSelfCheck } = await import('../src/selfcheck.mjs');
  const catalog = runSelfCheck().checks.find((item) => item.id === 'catalog');
  assert.equal(catalog.status, 'ok', catalog.detail);
  assert.match(catalog.detail, /клиенты видят все 2 объекта/, 'два объекта: в продаже и забронированный; проданный в каталог не входит');
});

test('состояние панели: у каждого обращения есть число сообщений клиента, у клиента вне последних 500 — своё число сообщений', async () => {
  const data = bot.getData();
  data.users['1'].messages = 0;
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const inquiry = state.inquiries.find((item) => item.id === 'a1');
  assert.equal(inquiry.clientMessageCount, 2, 'два сообщения клиента в переписке');
  assert.equal(inquiry.messageCount, 2);

  // Клиент, давно не писавший, приходит в панель «неполным» — вместе со счётчиком сообщений.
  for (let index = 100; index < 620; index += 1) data.users[String(index)] = { id: String(index), chatId: index, firstName: 'Клиент ' + index, activity: [], lastSeenAt: minutesAgo(1) };
  data.users['1'].lastSeenAt = '2020-01-01T00:00:00.000Z';
  data.users['1'].messages = 7;
  const later = await (await realFetch(base + '/api/state', { headers })).json();
  const partial = later.users.find((user) => user.id === '1');
  assert.equal(partial.partial, true);
  assert.equal(partial.messages, 7, 'у неполной карточки число сообщений не теряется');
});

test('прочитанный диалог перестаёт быть непрочитанным и в уведомлениях: счётчики «Непрочитанные» не расходятся', async () => {
  const state = () => realFetch(base + '/api/state', { headers }).then((response) => response.json());
  // Уведомлений другого рода (ошибки, задачи) в песочнице может быть сколько угодно — считаем «клиент написал».
  const unreadMessages = (snapshot) => snapshot.notifications.filter((item) => item.id.startsWith('message:') && item.active && !item.readAt && !item.handledAt).length;
  const unreadNotices = (snapshot) => snapshot.notifications.filter((item) => item.active && !item.readAt && !item.handledAt).length;
  // Непрочитанный диалог — тот, где клиент написал позже, чем менеджер открыл переписку.
  const unreadClients = (snapshot) => new Set(snapshot.inquiries.filter((item) => (Date.parse(item.clientMessageAt || item.createdAt) || 0) > (Date.parse(item.readAt || '') || 0)).map((item) => String(item.userId))).size;
  const before = await state();
  assert.equal(unreadClients(before), 2, 'два диалога не прочитаны');
  assert.equal(unreadMessages(before), 2, 'и два уведомления «клиент написал» не прочитаны');
  const otherUnread = unreadNotices(before) - 2;

  // Менеджер открыл диалог Ольги (панель отмечает его прочитанным).
  assert.equal((await realFetch(base + '/api/conversations/1/read', { method: 'POST', headers, body: '{}' })).status, 200);
  const after = await state();
  assert.equal(unreadClients(after), 1, 'в «Клиентах» непрочитан один диалог');
  assert.equal(unreadMessages(after), 1, 'в уведомлениях — тоже одно, а не два');
  assert.equal(unreadNotices(after), otherUnread + 1, 'общий счётчик уведомлений убавился на одно');

  // Дело при этом остаётся: клиент прочитан, но ещё ждёт ответа.
  const olga = after.notifications.find((item) => item.id.startsWith('message:1:'));
  assert.ok(olga, 'уведомление про Ольгу на месте');
  assert.equal(olga.active, true, 'дело не закрыто: ответа нет');
  assert.ok(olga.readAt, 'но отмечено прочитанным');
  assert.equal(after.waitingConversationCount, 2, 'оба клиента по-прежнему ждут ответа');

  // Новое сообщение от Ольги снова делает уведомление непрочитанным (новый номер события).
  const inquiry = bot.getData().inquiries.find((item) => item.id === 'a1');
  inquiry.messages.push({ id: 'a1-3', direction: 'in', kind: 'text', text: 'Алло?', createdAt: new Date().toISOString() });
  inquiry.clientMessageAt = new Date().toISOString();
  inquiry.updatedAt = inquiry.clientMessageAt;
  const again = await state();
  assert.equal(unreadMessages(again), 2, 'новое сообщение — снова непрочитанное');
});

test('«ожидание» в шапке, меню и колокольчике — одна сводка от бота: клиенты, из них просроченные, дела', async () => {
  const data = bot.getData();
  data.config.reminderHours = 4;
  // Николай ждёт пять часов — дольше срока в четыре; Ольга — десять минут.
  data.inquiries.find((item) => item.id === 'b1').clientMessageAt = minutesAgo(5 * 60);
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  assert.deepEqual({ waitingClients: state.attention.waitingClients, lateClients: state.attention.lateClients }, { waitingClients: 2, lateClients: 1 });
  const deeds = state.notifications.filter((item) => item.active && !item.handledAt).length;
  assert.equal(state.attention.deeds, deeds, 'число дел — то же, что в списке «Сегодня»');
  assert.ok(deeds >= 2, 'два клиента — как минимум два дела');
  assert.equal(state.newInquiryCount, undefined, 'отдельного счётчика «новых» больше нет');
  // Срок «не напоминать» (0) не значит «никогда»: берём два часа.
  data.config.reminderHours = 0;
  const fallback = await (await realFetch(base + '/api/state', { headers })).json();
  assert.equal(fallback.attention.lateClients, 1);
});

test('«ждёт ответа» решает бот и присылает признаком: взятая в работу без ответа заявка ждёт, хотя её сообщений в состоянии нет', async () => {
  const data = bot.getData();
  const taken = data.inquiries.find((item) => item.id === 'b1');
  taken.status = 'in_progress';
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const sent = state.inquiries.find((item) => item.id === 'b1');
  assert.equal(sent.messages, undefined, 'самих сообщений в состоянии нет');
  assert.equal(sent.awaitsReply, true, 'но признак есть: клиент ещё ждёт');
  taken.replies = [{ createdAt: new Date().toISOString(), text: 'Ответ' }];
  const answered = await (await realFetch(base + '/api/state', { headers })).json();
  assert.equal(answered.inquiries.find((item) => item.id === 'b1').awaitsReply, false);
  assert.equal(answered.attention.waitingClients, 1, 'остался один ждущий клиент — Ольга');
});
