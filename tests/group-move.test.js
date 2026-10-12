'use strict';

// Перенос сообщений между темами форума: вручную из панели и автоматически из «Основной ленты».
// Telegram «переместить» не умеет: бот пересылает (копирует) сообщение в тему и удаляет оригинал.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, resetData, settle, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
const replies = new Map();
global.fetch = (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  const method = String(url).split('/').pop();
  if (replies.has(method)) {
    const reply = replies.get(method);
    let body = {};
    if (init && typeof init.body === 'string') body = JSON.parse(init.body);
    telegram.calls.push({ method, body });
    const result = typeof reply === 'function' ? reply(body) : reply;
    if (result instanceof Error) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: result.message }), { status: 400, headers: { 'content-type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return telegramStub(url, init);
};

const GROUP = '-1003934963994';
let updateId = 9500;
let nextId = 5000;
const now = () => Math.floor(Date.now() / 1000);
const chat = () => ({ id: Number(GROUP), type: 'supergroup', title: 'Стройка без фильтров', is_forum: true });

test.beforeEach(() => {
  replies.clear();
  nextId = 5000;
  replies.set('forwardMessage', () => ({ message_id: ++nextId }));
  replies.set('copyMessage', () => ({ message_id: ++nextId }));
  replies.set('forwardMessages', (body) => body.message_ids.map(() => ({ message_id: ++nextId })));
  replies.set('copyMessages', (body) => body.message_ids.map(() => ({ message_id: ++nextId })));
  replies.set('deleteMessages', true);
  replies.set('getChatAdministrators', [
    { status: 'creator', user: { id: 42, first_name: 'Владелец' } },
    { status: 'administrator', user: { id: 5550001, is_bot: true, first_name: 'Бот' }, can_delete_messages: true },
  ]);
  resetData((data) => {
    data.config.active = true;
    data.groups = [{
      id: GROUP, title: 'Стройка без фильтров', type: 'supergroup', status: 'administrator', isForum: true,
      rights: { can_delete_messages: true, can_manage_topics: true },
      topics: [{ id: 1, name: '', closed: false }, { id: 7, name: 'Слово за слово', closed: false }, { id: 9, name: 'Закрытая', closed: true }],
      messages: [], joinRequests: [],
    }];
  });
});
test.after(() => { replies.clear(); cleanup(); });

async function deliver(update) {
  await bot.processUpdates([{ update_id: updateId++, ...update }], TOKEN);
  await settle();
}

const group = () => bot.getData().groups[0];
const callsOf = (method) => telegram.calls.filter((call) => call.method === method && String(call.body.chat_id) === GROUP);

function general(id, text, extra = {}) {
  return { message: { message_id: id, date: now(), chat: chat(), from: { id: 555, first_name: 'Ирина' }, text, ...extra } };
}

async function moveModule() {
  return import('../src/group-move.mjs');
}

test('вручную: сообщение пересылается в тему, оригинал удаляется, лента обновляется', async () => {
  await deliver(general(100, 'Подскажите по участку'));
  assert.ok(group().messages.some((item) => item.messageId === 100));
  const { moveGroupMessages } = await moveModule();
  const result = await moveGroupMessages(group(), [100], 7, { token: TOKEN });
  assert.equal(result.moved, 1);
  assert.deepEqual(result.failed, []);
  const forwarded = callsOf('forwardMessage');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].body.message_thread_id, 7);
  assert.equal(forwarded[0].body.message_id, 100);
  assert.equal(callsOf('deleteMessages').length, 1);
  assert.ok(!group().messages.some((item) => item.messageId === 100), 'оригинала в ленте нет');
  const copy = group().messages.find((item) => item.messageId === result.newIds[0]);
  assert.ok(copy && copy.threadId === 7 && copy.name === 'Ирина', 'копия в ленте — в новой теме, автор виден');
});

test('копирование без автора; перенос в основную ленту идёт без номера темы', async () => {
  await deliver({ message: { message_id: 110, date: now(), chat: chat(), from: { id: 555, first_name: 'Ирина' }, message_thread_id: 7, is_topic_message: true, text: 'Из темы' } });
  const { moveGroupMessages } = await moveModule();
  const result = await moveGroupMessages(group(), [110], 1, { mode: 'copy', token: TOKEN });
  assert.equal(result.moved, 1);
  const copied = callsOf('copyMessage');
  assert.equal(copied.length, 1);
  assert.ok(!('message_thread_id' in copied[0].body), 'в «Основную ленту» — без message_thread_id');
  assert.equal(group().messages.find((item) => item.messageId === result.newIds[0]).fromBot, true);
});

test('без права «Удаление сообщений» перенос не начинается: копий в двух темах не будет', async () => {
  group().rights.can_delete_messages = false;
  const { moveGroupMessages } = await moveModule();
  await assert.rejects(() => moveGroupMessages(group(), [100], 7, { token: TOKEN }), /нет права удалять/);
  assert.equal(callsOf('forwardMessage').length, 0);
});

test('если пересылка не удалась, оригинал остаётся', async () => {
  await deliver(general(120, 'Сообщение'));
  replies.set('forwardMessage', () => new Error('Bad Request: CHAT_FORWARDS_RESTRICTED'));
  const { moveGroupMessages } = await moveModule();
  const result = await moveGroupMessages(group(), [120], 7, { token: TOKEN });
  assert.equal(result.moved, 0);
  assert.match(result.failed[0].error, /защищённый контент/);
  assert.equal(callsOf('deleteMessages').length + callsOf('deleteMessage').length, 0, 'оригинал не удаляли');
  assert.ok(group().messages.some((item) => item.messageId === 120));
});

test('альбом переносится целиком одним запросом', async () => {
  await deliver(general(130, '', { photo: [{ file_id: 'a' }], media_group_id: 'album-1', caption: 'Фото' }));
  await deliver(general(131, '', { photo: [{ file_id: 'b' }], media_group_id: 'album-1' }));
  const { moveGroupMessages } = await moveModule();
  const result = await moveGroupMessages(group(), [130], 7, { token: TOKEN });
  assert.equal(result.moved, 2, 'ушли обе фотографии альбома');
  const batch = callsOf('forwardMessages');
  assert.equal(batch.length, 1);
  assert.deepEqual(batch[0].body.message_ids, [130, 131]);
});

test('автоперенос: сообщение участника из основной ленты уходит в тему, администратора и ответы не трогаем', async () => {
  const { saveAutoMove } = await moveModule();
  saveAutoMove(group(), { enabled: true, toThreadId: 7, notify: false });
  await deliver(general(200, 'Вопрос по ипотеке'));
  assert.equal(callsOf('forwardMessage').length, 1);
  assert.equal(callsOf('forwardMessage')[0].body.message_thread_id, 7);
  // администратор
  await deliver({ message: { message_id: 201, date: now(), chat: chat(), from: { id: 42, first_name: 'Владелец' }, text: 'Объявление' } });
  // ответ участника на чужое сообщение
  await deliver(general(202, 'Согласен', { reply_to_message: { message_id: 201 } }));
  // сообщение в теме
  await deliver({ message: { message_id: 203, date: now(), chat: chat(), from: { id: 555, first_name: 'Ирина' }, message_thread_id: 7, is_topic_message: true, text: 'В теме' } });
  // служебная запись: вступил участник
  await deliver({ message: { message_id: 204, date: now(), chat: chat(), from: { id: 556, first_name: 'Пётр' }, new_chat_members: [{ id: 556, first_name: 'Пётр' }] } });
  assert.equal(callsOf('forwardMessage').length, 1, 'больше ничего не переносилось');
});

test('автоперенос выключен по умолчанию и без права удаления не работает', async () => {
  await deliver(general(210, 'Сообщение'));
  assert.equal(callsOf('forwardMessage').length, 0, 'правило выключено — ничего не происходит');
  const { saveAutoMove } = await moveModule();
  saveAutoMove(group(), { enabled: true, toThreadId: 7 });
  group().rights.can_delete_messages = false;
  await deliver(general(211, 'Ещё одно'));
  assert.equal(callsOf('forwardMessage').length, 0, 'нет права удалять — не переносим');
  assert.throws(() => saveAutoMove(group(), { enabled: true, toThreadId: 7 }), /нет права удалять/);
});

test('правило нельзя включить на закрытую тему или на основную ленту', async () => {
  const { saveAutoMove } = await moveModule();
  assert.throws(() => saveAutoMove(group(), { enabled: true, toThreadId: 9 }), /закрыта/);
  assert.throws(() => saveAutoMove(group(), { enabled: true, toThreadId: 1 }), /Выберите тему/);
  assert.throws(() => saveAutoMove(group(), { enabled: true, toThreadId: 77 }), /Выберите тему/);
  const saved = saveAutoMove(group(), { enabled: false, toThreadId: 7 });
  assert.equal(saved.enabled, false);
});

test('автоперенос с уведомлением пишет участнику, куда ушло сообщение', async () => {
  const { saveAutoMove } = await moveModule();
  saveAutoMove(group(), { enabled: true, toThreadId: 7, notify: true });
  await deliver(general(220, 'Привет всем'));
  const notice = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === GROUP).pop();
  assert.ok(notice, 'уведомление ушло');
  assert.match(notice.body.text, /Ирина, ваше сообщение перенесено в тему «Слово за слово»/);
});
