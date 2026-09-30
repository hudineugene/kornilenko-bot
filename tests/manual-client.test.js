'use strict';

// Клиент, которого нет в боте: позвонил по телефону или написал в WhatsApp. Его заводят руками —
// имя, телефон, язык, источник, заметка — и назначают ему просмотр. Чата в Telegram у него нет:
// писать из панели ему нельзя, рассылки его не касаются, но он есть в базе, календаре и сводке.

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

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-1', 'Вилла у моря', 'active'));
  });
  const data = bot.getData();
  const password = bot.hashPassword('manual-client-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'manual-client-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
});

const post = (path, body) => realFetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };

test('«＋ Клиент»: заводится по имени и телефону, без чата в Telegram; язык, источник и заметка сохраняются', async () => {
  const response = await post('/api/users', { name: 'Джон Смит', phone: '+34 600 111 222', language: 'en', source: 'звонок', note: 'Звонил по объявлению' });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.match(id, /^manual-/);
  const user = bot.getData().users[id];
  assert.equal(user.contactName, 'Джон Смит');
  assert.equal(user.firstName, 'Джон Смит');
  assert.equal(user.phone, '+34 600 111 222');
  assert.equal(user.preferredLanguage, 'en');
  assert.equal(user.source, 'звонок');
  assert.equal(user.note, 'Звонил по объявлению');
  assert.ok(!user.chatId, 'чата в Telegram нет');
  assert.ok(Array.isArray(user.favorites) && Array.isArray(user.tags), 'карточка полная, как у любого клиента');
  // Клиент виден в состоянии панели и не считается доступным для рассылок.
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const shown = state.users.find((item) => item.id === id);
  assert.ok(shown, 'в панели он есть');
  assert.equal(state.activeUserCount, 0, 'писать ему в Telegram нельзя — в «им можно писать» не входит');
});

test('«＋ Клиент»: без имени, с неверным телефоном или языком — отказ', async () => {
  assert.equal((await post('/api/users', { name: '' })).status, 400);
  assert.equal((await post('/api/users', { name: 'Иван', phone: 'abc' })).status, 400);
  assert.equal((await post('/api/users', { name: 'Иван', language: 'fr' })).status, 400);
  assert.equal((await post('/api/users', { name: 'Иван' })).status, 201, 'одно имя — достаточно');
  const created = Object.values(bot.getData().users).find((user) => user.contactName === 'Иван');
  assert.equal(created.source, 'вручную', 'источник по умолчанию — «вручную»');
  // Без входа — нельзя.
  assert.equal((await realFetch(base + '/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Х"}' })).status, 401);
});

test('клиент, заведённый руками, переживает перезагрузку данных', async () => {
  const { id } = await (await post('/api/users', { name: 'Мария', phone: '600 123 456', language: 'es' })).json();
  const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
  assert.equal(reloaded.users[id].contactName, 'Мария');
  assert.equal(reloaded.users[id].preferredLanguage, 'es');
  assert.ok(!reloaded.users[id].chatId);
});

test('«＋ Просмотр»: встреча назначена по телефону — подтверждена сразу, виден этап «Просмотр», клиенту ничего не отправляется', async () => {
  const { id } = await (await post('/api/users', { name: 'Джон Смит', phone: '+34 600 111 222' })).json();
  const day = tomorrow();
  const response = await post('/api/viewings', { userId: id, propertyId: 'villa-1', date: day, time: '11:30', note: 'Договорились по телефону' });
  assert.equal(response.status, 201);
  const inquiry = bot.getData().inquiries.find((item) => item.userId === id);
  assert.equal(inquiry.type, 'viewing');
  assert.equal(inquiry.propertyId, 'villa-1');
  assert.equal(inquiry.viewing.confirmedDate, day);
  assert.equal(inquiry.viewing.confirmedTime, '11:30');
  assert.ok(inquiry.viewing.confirmedAt, 'подтверждён сразу');
  assert.equal(inquiry.pipelineStage, 'viewing');
  assert.equal(inquiry.status, 'in_progress');
  assert.equal(bot.awaitingReply(inquiry) === true, false, 'клиент ответа не ждёт: разговор был по телефону');
  // Проверки: дата обязательна, в прошлом нельзя, время — ЧЧ:ММ, объект должен существовать, клиент — тоже.
  assert.equal((await post('/api/viewings', { userId: id, date: '' })).status, 400);
  assert.equal((await post('/api/viewings', { userId: id, date: '2020-01-01' })).status, 400);
  assert.equal((await post('/api/viewings', { userId: id, date: day, time: '25:99' })).status, 400);
  assert.equal((await post('/api/viewings', { userId: id, date: day, propertyId: 'нет-такого' })).status, 400);
  assert.equal((await post('/api/viewings', { userId: 'нет', date: day })).status, 404);
});

test('следующий шаг у клиента без заявок: заводится заявка-«шаг» с датой; при открытой заявке дата ставится на неё', async () => {
  const { id } = await (await post('/api/users', { name: 'Джон Смит', phone: '+34 600 111 222' })).json();
  const day = tomorrow();
  const created = await post('/api/users/' + id + '/step', { date: day, time: '10:00', note: 'Позвонить в четверг' });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).created, true);
  const step = bot.getData().inquiries.find((item) => item.userId === id);
  assert.equal(step.followUpDate, day);
  assert.equal(step.followUpTime, '10:00');
  assert.equal(step.text, 'Позвонить в четверг');
  assert.equal(step.status, 'in_progress');
  assert.equal(bot.awaitingReply(step), false, 'ответа никто не ждёт');
  // Повторно — дата ставится на ту же открытую заявку, вторая не создаётся.
  const again = await post('/api/users/' + id + '/step', { date: day, time: '15:30' });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).created, false);
  assert.equal(bot.getData().inquiries.filter((item) => item.userId === id).length, 1);
  assert.equal(step.followUpTime, '15:30');
  // Проверки.
  assert.equal((await post('/api/users/' + id + '/step', { date: '' })).status, 400);
  assert.equal((await post('/api/users/' + id + '/step', { date: day, time: '99:99' })).status, 400);
  assert.equal((await post('/api/users/нет/step', { date: day })).status, 404);
  // Шаг виден в списке дел: «контакт сегодня/просрочен» строится по followUpDate заявки.
  step.followUpDate = '2020-01-01';
  const { currentAdminNotifications } = await import('../src/admin-notifications.mjs');
  assert.ok(currentAdminNotifications().some((item) => item.kind === 'task' && item.id.includes(step.id)), 'просроченный шаг попал в дела');
});

test('объединение дублей: карточка без чата вливается в основную, заявки и заметки переходят, «Вернуть» всё возвращает', async () => {
  const data = bot.getData();
  const { id: manualId } = await (await post('/api/users', { name: 'Анна Соколова', phone: '+34 600 111 222', source: 'звонок', note: 'Просила перезвонить' })).json();
  data.users['777'] = { id: '777', chatId: 777, firstName: 'Анна', lastName: '', phone: '', contactName: '', preferredLanguage: '', source: '', note: 'Ищет виллу', tags: ['горячий'], favorites: ['villa-1'], firstSeenAt: '2026-09-01T10:00:00.000Z', messages: 3 };
  await post('/api/users/' + manualId + '/step', { date: tomorrow(), note: 'Позвонить' });
  const stepId = data.inquiries.find((item) => item.userId === manualId).id;

  // Нельзя: влить карточку с чатом, склеить с самим собой, неизвестного.
  assert.equal((await post('/api/users/merge', { keepId: manualId, mergeId: '777' })).status, 400);
  assert.equal((await post('/api/users/merge', { keepId: '777', mergeId: '777' })).status, 400);
  assert.equal((await post('/api/users/merge', { keepId: '777', mergeId: 'нет' })).status, 404);

  const merged = await post('/api/users/merge', { keepId: '777', mergeId: manualId });
  assert.equal(merged.status, 200);
  const result = await merged.json();
  assert.equal(result.moved, 1);
  assert.equal(data.users[manualId], undefined, 'лишней карточки больше нет');
  const keep = data.users['777'];
  assert.equal(keep.phone, '+34 600 111 222', 'телефон дополнен');
  assert.equal(keep.source, 'звонок');
  assert.match(keep.note, /Ищет виллу\nПросила перезвонить/);
  assert.equal(data.inquiries.find((item) => item.id === stepId).userId, '777');
  assert.equal(data.inquiries.find((item) => item.id === stepId).chatId, '777', 'ответить теперь можно в чат');

  const undone = await post('/api/users/unmerge', { token: result.undoToken });
  assert.equal(undone.status, 200);
  assert.equal(data.users[manualId].phone, '+34 600 111 222');
  assert.equal(data.users[manualId].chatId == null || data.users[manualId].chatId === '' || data.users[manualId].chatId === 0, true);
  assert.equal(data.inquiries.find((item) => item.id === stepId).userId, manualId);
  assert.equal(data.inquiries.find((item) => item.id === stepId).chatId, '');
  assert.equal(data.users['777'].phone, '');
  assert.equal(data.users['777'].note, 'Ищет виллу');
  assert.equal(data.users['777'].messages, 3);
  assert.equal((await post('/api/users/unmerge', { token: result.undoToken })).status, 404, 'второй раз — уже нечего возвращать');
});
