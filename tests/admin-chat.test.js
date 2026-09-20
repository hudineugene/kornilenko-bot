'use strict';

// The admin's side in Telegram: the admin's own text is not an inquiry, a
// dialogue stays one inquiry, /inbox, /viewings and /stats, and what the
// notification card shows.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, ADMIN_CHAT, createChat, property, resetData, settle, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('villa-sol-01', 'Вилла Сол', 'active'));
}));
test.after(cleanup);

let adminMessageId = 700;
async function adminSays(text, { replyTo = null, chatId = ADMIN_CHAT, type = 'private', fromId = Number(ADMIN_CHAT) } = {}) {
  const before = telegram.calls.length;
  adminMessageId += 1;
  const chat = { id: Number(chatId), type };
  const message = { message_id: adminMessageId, date: Math.floor(Date.now() / 1000), from: { id: fromId, first_name: 'Админ', language_code: 'ru' }, chat, text };
  if (replyTo) message.reply_to_message = { message_id: replyTo, date: message.date, from: { id: bot.getData().bot.id, is_bot: true }, chat, text: '…' };
  await bot.processUpdates([{ update_id: 900000 + adminMessageId, message }], TOKEN);
  await settle();
  return telegram.calls.slice(before);
}

// The admin chat message that routes replies to this client, newest first.
const notificationFor = (clientId) => Object.entries(bot.getData().adminReplyTargets)
  .filter(([key, target]) => target.chatId === String(clientId) && !key.includes(':'))
  .map(([key]) => Number(key)).sort((a, b) => b - a)[0];
const sentTo = (calls, chatId, method = 'sendMessage') => calls.filter((call) => call.method === method && String(call.body.chat_id) === String(chatId));

test('text the admin types in their own chat is not an inquiry', async () => {
  const calls = await adminSays('Проверка, как это работает');
  const reply = sentTo(calls, ADMIN_CHAT).pop();
  assert.match(reply.body.text, /^ℹ️ Это чат администратора/);
  assert.match(reply.body.text, /\/inbox/);
  assert.equal(bot.getData().inquiries.length, 0);
});

test('the admin can still try the bot as a client', async () => {
  const calls = await adminSays('/start');
  const [menu] = sentTo(calls, ADMIN_CHAT);
  assert.ok(menu.body.reply_markup.keyboard, 'the client menu');
});

test('in a manager group the staff talk to each other without the bot answering', async () => {
  bot.getData().config.managers = [{ id: 'm1', name: 'Мария', chatId: '-100500600', verifiedAt: '' }];
  const calls = await adminSays('Кто возьмёт клиента из Мадрида?', { chatId: '-100500600', type: 'supergroup', fromId: 4242 });
  assert.equal(calls.filter((call) => call.method.startsWith('send')).length, 0);
  assert.equal(bot.getData().inquiries.length, 0);
});

test('the client answering the manager continues the same inquiry', async () => {
  const client = createChat();
  const first = await client.say('Есть ли рассрочка?');
  assert.equal(sentTo(first.calls, ADMIN_CHAT).length, 1);
  const notificationId = notificationFor(client.id);
  assert.ok(notificationId);
  const reply = await adminSays('Да, до двух лет. Удобно созвониться?', { replyTo: notificationId });
  assert.equal(sentTo(reply, client.id).length, 1, 'the answer reached the client');
  const [inquiry] = client.inquiries;
  assert.equal(inquiry.status, 'in_progress');
  assert.equal(bot.awaitingReply(inquiry), false, 'answered');

  // The client answers an hour later.
  inquiry.updatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const answer = await client.say('Да, давайте завтра');
  assert.equal(client.inquiries.length, 1, 'one conversation, one inquiry');
  assert.match(client.inquiries[0].text, /рассрочка[\s\S]*давайте завтра/);
  assert.match(sentTo(answer.calls, ADMIN_CHAT)[0].body.text, /^📩 Новое сообщение в обращении/);
  assert.equal(answer.replies.length, 1, 'after a pause the client hears the message was received');
  assert.equal(bot.awaitingReply(client.inquiries[0]), true, 'the client wrote after the answer');
});

test('a closed inquiry is not continued', async () => {
  const client = createChat();
  await client.say('Вопрос про виллу');
  client.inquiries[0].status = 'closed';
  await client.say('Новый вопрос');
  assert.equal(client.inquiries.length, 2);
});

test('/inbox brings back what waits for an answer, and the admin can reply to it', async () => {
  const waiting = createChat({ firstName: 'Ольга' });
  await waiting.say('Сколько стоит вилла?');
  const answered = createChat({ firstName: 'Пётр' });
  await answered.say('Добрый день');
  answered.inquiries[0].replies.push({ id: 'r1', text: 'Здравствуйте', source: 'panel', createdAt: new Date(Date.now() + 1000).toISOString() });
  answered.inquiries[0].status = 'in_progress';

  const calls = await adminSays('/inbox');
  const messages = sentTo(calls, ADMIN_CHAT);
  assert.equal(messages[0].body.text, '📥 Ждут ответа: 1');
  assert.equal(messages.length, 2);
  assert.match(messages[1].body.text, /^📥 Ждёт ответа \d+ мин: сообщение\n👤 Ольга/);
  assert.match(messages[1].body.text, /Сколько стоит вилла\?/);
  assert.ok(messages[1].body.reply_markup.inline_keyboard.flat().some((button) => button.callback_data.startsWith('inq:closed:')));

  const reply = await adminSays('Цена 850 000 €', { replyTo: notificationFor(waiting.id) });
  assert.equal(sentTo(reply, waiting.id).length, 1);
  const again = await adminSays('/inbox');
  assert.equal(sentTo(again, ADMIN_CHAT)[0].body.text, '✅ Все обращения отвечены.');
});

test('/viewings shows today and tomorrow, /stats the day and the week', async () => {
  const client = createChat();
  await client.press('property:viewing:villa-sol-01');
  await client.say(bot.text.viewing.ru.dateOptions[1]);
  await client.say(bot.text.viewing.ru.timeOptions[0]);
  await client.say(bot.text.viewing.ru.confirm);

  const viewings = sentTo(await adminSays('/viewings'), ADMIN_CHAT)[0].body.text;
  assert.match(viewings, /^📅 Сегодня, .+\n• нет\n\n📅 Завтра, .+\n• ⏳ .+ — Вилла Сол — Анна/);

  const stats = sentTo(await adminSays('/stats'), ADMIN_CHAT)[0].body.text;
  assert.match(stats, /^📊 Сегодня, /);
  assert.match(stats, /📥 Ждут ответа: 1 — \/inbox/);
  assert.match(stats, /Записей на просмотр: 1/);
});

test('the notification shows the phone and earlier inquiries', async () => {
  const client = createChat();
  client.user.phone = '+34 600 111 222';
  await client.say('Первый вопрос');
  client.inquiries[0].status = 'closed';
  const second = await client.say('Второй вопрос');
  const text = sentTo(second.calls, ADMIN_CHAT)[0].body.text;
  assert.match(text, /\n📞 \+34 600 111 222\n🗂 Обращений раньше: 1\n/);
});

test('the notification about a photo is a reply to the copied photo', async () => {
  const client = createChat();
  const before = telegram.calls.length;
  await bot.processUpdates([{ update_id: 990001, message: { message_id: 55, date: Math.floor(Date.now() / 1000), from: { id: client.id, first_name: 'Анна' }, chat: { id: client.id, type: 'private' }, photo: [{ file_id: 'P1', file_unique_id: 'u1', width: 10, height: 10 }], caption: 'Планировка' } }], TOKEN);
  await settle();
  const calls = telegram.calls.slice(before);
  const copyIndex = calls.findIndex((call) => call.method === 'copyMessage' && String(call.body.chat_id) === ADMIN_CHAT);
  assert.ok(copyIndex >= 0);
  const notification = sentTo(calls, ADMIN_CHAT)[0];
  assert.ok(notification.body.reply_parameters, 'linked to the photo');
  assert.equal(typeof notification.body.reply_parameters.message_id, 'number');
});

test('the panel deletes one inquiry and clears old ones', async () => {
  const data = bot.getData();
  const old = new Date(Date.now() - 200 * 864e5).toISOString();
  data.inquiries = [
    { id: 'i1', userId: '1', chatId: '1', type: 'general', text: 'новое', status: 'new', replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'i2', userId: '1', chatId: '1', type: 'general', text: 'закрытое старое', status: 'closed', replies: [], createdAt: old, updatedAt: old },
    { id: 'i3', userId: '1', chatId: '1', type: 'general', text: 'закрытое свежее', status: 'closed', replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };

    const cleanup = await realFetch(base + '/api/inquiries/cleanup', { method: 'POST', headers, body: JSON.stringify({ scope: 'closed', olderThanDays: 90 }) });
    assert.equal((await cleanup.json()).removed, 1, 'только закрытое и старое');
    assert.deepEqual(data.inquiries.map((item) => item.id), ['i1', 'i3']);

    const dropped = await realFetch(base + '/api/inquiries/i3', { method: 'DELETE', headers });
    assert.equal(dropped.status, 200);
    assert.deepEqual(data.inquiries.map((item) => item.id), ['i1']);
    assert.equal((await realFetch(base + '/api/inquiries/i3', { method: 'DELETE', headers })).status, 404);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('the admin chat gets its own command menu', async () => {
  bot.getData().config.managers = [{ id: 'm1', name: 'Мария', chatId: '-100500600', verifiedAt: '' }];
  const before = telegram.calls.length;
  await bot.configureBotCommands(TOKEN);
  const scoped = telegram.calls.slice(before).filter((call) => call.method === 'setMyCommands' && call.body.scope);
  assert.deepEqual(scoped.map((call) => call.body.scope.chat_id), [ADMIN_CHAT, '-100500600']);
  assert.deepEqual(scoped[0].body.commands.slice(0, 3).map((command) => command.command), ['inbox', 'viewings', 'stats']);
});
