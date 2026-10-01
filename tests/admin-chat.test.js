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
  assert.match(reply.body.text, /^ℹ️ Сообщение никому не отправлено/);
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

test('в группе-админчате /start участника не заводит клиента с номером группы', async () => {
  // Раньше любая команда, кроме /inbox, /viewings и /stats, проваливалась в
  // клиентский сценарий: бот заводил «клиента» с ID группы, присылал туда
  // клиентское меню, а ответ менеджера этому «клиенту» ушёл бы в ту же группу.
  bot.getData().config.adminChatId = '-100777888';
  const calls = await adminSays('/start', { chatId: '-100777888', type: 'supergroup', fromId: 4242 });
  const answers = sentTo(calls, '-100777888');
  assert.equal(answers.length, 1, 'бот ответил один раз');
  assert.match(answers[0].body.text, /^ℹ️ Это рабочий чат/, 'подсказкой для сотрудников');
  assert.ok(!answers[0].body.reply_markup, 'без клиентского меню');
  assert.equal(bot.getData().users['-100777888'], undefined, '«клиента» с номером группы нет');
  assert.equal(Object.keys(bot.getData().users).length, 0, 'вообще никого не завели');
  assert.equal(bot.getData().inquiries.length, 0, 'и обращений тоже');
});

test('в группе-админчате команды сотрудников работают как раньше', async () => {
  bot.getData().config.adminChatId = '-100777888';
  const calls = await adminSays('/stats', { chatId: '-100777888', type: 'supergroup', fromId: 4242 });
  const answers = sentTo(calls, '-100777888');
  assert.equal(answers.length, 1);
  assert.match(answers[0].body.text, /Сегодня/, 'пришли цифры, а не подсказка');
});

test('в группе-админчате /myid отвечает номером чата, не заводя клиента', async () => {
  bot.getData().config.adminChatId = '-100777888';
  const calls = await adminSays('/myid', { chatId: '-100777888', type: 'supergroup', fromId: 4242 });
  const answers = sentTo(calls, '-100777888');
  assert.equal(answers.length, 1);
  assert.match(answers[0].body.text, /Telegram-чат \(номер для панели\): -100777888/);
  assert.equal(Object.keys(bot.getData().users).length, 0, 'клиента не завели');
});

test('команда другого бота в рабочем чате остаётся без ответа', async () => {
  bot.getData().config.adminChatId = '-100777888';
  bot.getData().bot = { ...bot.getData().bot, username: 'kornilenko_bot' };
  const calls = await adminSays('/start@other_agency_bot', { chatId: '-100777888', type: 'supergroup', fromId: 4242 });
  assert.equal(calls.filter((call) => call.method.startsWith('send')).length, 0, 'бот промолчал');
  assert.equal(Object.keys(bot.getData().users).length, 0);
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
  inquiry.acknowledgedAt = inquiry.updatedAt;
  const answer = await client.say('Да, давайте завтра');
  assert.equal(client.inquiries.length, 1, 'one conversation, one inquiry');
  assert.match(client.inquiries[0].text, /рассрочка[\s\S]*давайте завтра/);
  assert.match(sentTo(answer.calls, ADMIN_CHAT)[0].body.text, /^💬 Анна: Да, давайте завтра/, 'повторное сообщение — коротко, без заголовка и кнопок');
  assert.equal(sentTo(answer.calls, ADMIN_CHAT)[0].body.reply_markup, undefined);
  assert.ok(sentTo(answer.calls, ADMIN_CHAT)[0].body.reply_parameters, 'и ответом на первую карточку');
  assert.equal(answer.replies.length, 1, 'after a pause the client hears the message was received');
  assert.equal(bot.awaitingReply(client.inquiries[0]), true, 'the client wrote after the answer');
  // Лента: вопрос клиента, заготовка бота, ответ менеджера, ответ клиента и
  // подтверждение бота. Менеджер видит весь разговор, а не только клиента.
  assert.deepEqual(client.inquiries[0].messages.map((message) => message.direction), ['in', 'out', 'out', 'in', 'out'], 'the panel gets one chronological dialogue');
  assert.deepEqual(client.inquiries[0].messages.filter((message) => message.source === 'bot').map((message) => message.by), ['бот', 'бот'], 'ответы бота подписаны');
});

test('reactions to a manager reply are visible in the conversation history', async () => {
  const client = createChat();
  await client.say('Пришлите, пожалуйста, детали');
  await adminSays('Конечно, отправляю презентацию.', { replyTo: notificationFor(client.id) });
  const inquiry = client.inquiries[0];
  const answer = inquiry.messages.find((message) => message.direction === 'out');
  assert.ok(answer.telegramMessageId);
  await bot.processUpdates([{ update_id: 990010, message_reaction: {
    chat: { id: client.id, type: 'private' }, message_id: answer.telegramMessageId, date: Math.floor(Date.now() / 1000),
    user: { id: client.id, first_name: 'Анна' }, old_reaction: [], new_reaction: [{ type: 'emoji', emoji: '👍' }],
  } }], TOKEN);
  await settle();
  assert.deepEqual(answer.reactions, ['👍']);
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
  assert.equal(sentTo(again, ADMIN_CHAT)[0].body.text, '✅ Все заявки отвечены.');
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
  assert.match(text, /\n📞 \+34 600 111 222\n🗂 Заявок раньше: 1\n/);
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
  const stored = client.inquiries[0].messages[0];
  assert.equal(stored.kind, 'photo');
  assert.equal(stored.fileId, 'P1');
  assert.equal(stored.text, 'Планировка');
});

test('a direct message from the client card is stored in the unified conversation', async () => {
  const client = createChat({ firstName: 'Елена' });
  await client.say('Ищу квартиру для семьи, нужна помощь с выбором');
  const inquiry = client.inquiries[0];
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.adminName = 'Олег';
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const before = telegram.calls.length;
    const response = await realFetch(base + '/api/users/' + client.id + '/message', {
      method: 'POST', headers, body: JSON.stringify({ text: 'Подобрал для вас подходящий вариант' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inquiryId, inquiry.id);
    assert.ok(sentTo(telegram.calls.slice(before), client.id).some((call) => call.body.text.includes('Подобрал для вас подходящий вариант')));
    // Вопрос клиента, заготовка бота и личное сообщение менеджера.
    assert.deepEqual(inquiry.messages.map((message) => message.direction), ['in', 'out', 'out']);
    assert.equal(inquiry.messages.at(-1).text, 'Подобрал для вас подходящий вариант');
    assert.equal(inquiry.replies.at(-1).source, 'panel');
    assert.equal(inquiry.replies.at(-1).by, 'Олег');
    assert.equal(inquiry.status, 'in_progress');
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('the one reply form can attach a link button', async () => {
  const client = createChat({ firstName: 'Марина' });
  await client.say('Пришлите ссылку на объект');
  const inquiry = client.inquiries[0];
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.adminName = 'Олег';
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };

    const wrong = await realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', {
      method: 'POST', headers,
      body: JSON.stringify({ text: 'Вот объект', buttonText: 'Смотреть', clientRequestId: 'link-button-0001' }),
    });
    assert.equal(wrong.status, 400, 'кнопка без ссылки не уходит');

    const before = telegram.calls.length;
    const response = await realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', {
      method: 'POST', headers,
      body: JSON.stringify({ text: 'Вот объект', buttonText: 'Смотреть', buttonUrl: 'https://example.com/villa', clientRequestId: 'link-button-0002' }),
    });
    assert.equal(response.status, 200);
    const sent = sentTo(telegram.calls.slice(before), client.id)[0];
    assert.deepEqual(sent.body.reply_markup.inline_keyboard, [[{ text: 'Смотреть', url: 'https://example.com/villa' }]]);
    assert.match(inquiry.replies.at(-1).text, /🔗 Смотреть/, 'в истории видно, что была кнопка');
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('an answer leaves the inquiry open and moves the funnel by itself', async () => {
  const client = createChat({ firstName: 'Павел' });
  await client.say('Сколько стоит содержание виллы?');
  const inquiry = client.inquiries[0];
  assert.equal(inquiry.status, 'new');
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.adminName = 'Олег';
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const response = await realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Около 4 000 € в год', clientRequestId: 'plain-answer-0001' }),
    });
    assert.equal(response.status, 200);
    assert.equal(inquiry.status, 'in_progress', 'ответ не закрывает переписку');
    assert.equal(inquiry.pipelineStage, 'contact', 'первый ответ сам сдвигает воронку с «Новый»');
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('the conversation sends photos and documents, quotes a client message and deduplicates retries', async () => {
  const client = createChat({ firstName: 'Ирина' });
  await client.say('Покажите, пожалуйста, план и презентацию');
  const inquiry = client.inquiries[0];
  const sourceMessageId = inquiry.messages[0].telegramMessageId;
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.adminName = 'Олег';
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const imageDataUrl = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('panel photo')]).toString('base64');
    const photoPayload = { text: 'Вот планировка', imageDataUrl, imageName: 'plan.png', replyToMessageId: sourceMessageId, clientRequestId: 'photo-request-12345' };
    const beforePhoto = telegram.calls.length;
    const photoResponse = await realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', { method: 'POST', headers, body: JSON.stringify(photoPayload) });
    assert.equal(photoResponse.status, 200);
    const photoCall = telegram.calls.slice(beforePhoto).find((call) => call.method === 'sendPhoto');
    assert.ok(photoCall, 'photo reached Telegram');
    assert.equal(photoCall.body.reply_parameters.message_id, sourceMessageId);
    const storedPhoto = inquiry.messages.at(-1);
    assert.equal(storedPhoto.kind, 'photo');
    assert.equal(storedPhoto.fileName, 'plan.png');
    assert.equal(storedPhoto.replyToTelegramMessageId, sourceMessageId);
    assert.equal(storedPhoto.replyToText, 'Покажите, пожалуйста, план и презентацию');
    assert.equal(storedPhoto.deliveryStatus, 'delivered');
    assert.equal(storedPhoto.clientRequestId, photoPayload.clientRequestId);

    const beforeRetry = telegram.calls.length;
    const retry = await realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', { method: 'POST', headers, body: JSON.stringify(photoPayload) });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(telegram.calls.length, beforeRetry, 'a browser retry does not send a duplicate');

    const documentDataUrl = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64');
    const beforeDocument = telegram.calls.length;
    const documentResponse = await realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', {
      method: 'POST', headers, body: JSON.stringify({ text: 'И презентация', documentDataUrl, documentName: 'offer.pdf', clientRequestId: 'document-request-12345' }),
    });
    assert.equal(documentResponse.status, 200);
    assert.ok(telegram.calls.slice(beforeDocument).some((call) => call.method === 'sendDocument'), 'document reached Telegram');
    const storedDocument = inquiry.messages.at(-1);
    assert.equal(storedDocument.kind, 'document');
    assert.equal(storedDocument.fileName, 'offer.pdf');
    assert.match(storedDocument.fileId, /^document-/);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
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

test.describe('«В работу» — это «взял», а не «ответил»', () => {
  const { adminPress } = require('./helpers/chat');

  test('без ответа клиент остаётся среди ждущих, даже когда дело взяли в работу', async () => {
    const chat = createChat();
    // Не «купить дом»: такая фраза теперь понятна боту как поиск и менеджеру не нужна.
    await chat.say('Подскажите по оформлению ипотеки');
    const inquiry = chat.inquiries[0];
    assert.equal(bot.awaitingReply(inquiry), true);

    await adminPress('inq:in_progress:' + inquiry.id, 777);
    assert.equal(inquiry.status, 'in_progress');
    assert.equal(bot.awaitingReply(inquiry), true, 'взял, но не ответил — клиент всё ещё ждёт');
  });

  test('запись в свободное окно подтверждена сразу — ответа не ждут', () => {
    const inquiry = { status: 'in_progress', type: 'viewing', viewing: { confirmedAt: new Date().toISOString() }, replies: [], messages: [{ direction: 'in' }] };
    assert.equal(bot.awaitingReply(inquiry), false);
  });

  test('обращение, начатое самим менеджером, ответа не ждёт', () => {
    const inquiry = { status: 'in_progress', replies: [], messages: [{ direction: 'out' }] };
    assert.equal(bot.awaitingReply(inquiry), false);
  });

  test('ответ менеджера из Telegram двигает этап «Новая» → «Связались»', async () => {
    const chat = createChat();
    await chat.say('Есть ли парковка?');
    const inquiry = chat.inquiries[0];
    assert.equal(inquiry.pipelineStage, 'new');
    await adminSays('Да, парковка есть', { replyTo: notificationFor(chat.id) });
    assert.equal(inquiry.pipelineStage, 'contact');
    assert.equal(bot.awaitingReply(inquiry), false, 'после ответа клиент не ждёт');

    // Этап дальше «Связались» ответ не трогает.
    inquiry.pipelineStage = 'negotiation';
    await chat.say('А цена?');
    await adminSays('Цена в карточке', { replyTo: notificationFor(chat.id) });
    assert.equal(inquiry.pipelineStage, 'negotiation');
  });

  test('«Открыть снова» снимает «Выиграно» и «Проиграно»', async () => {
    const chat = createChat();
    await chat.say('Хочу купить дом');
    const inquiry = chat.inquiries[0];
    inquiry.pipelineStage = 'won';
    inquiry.status = 'closed';
    await adminPress('inq:new:' + inquiry.id, 777);
    assert.deepEqual([inquiry.status, inquiry.pipelineStage], ['new', 'new']);

    inquiry.pipelineStage = 'lost';
    inquiry.status = 'closed';
    await adminPress('inq:in_progress:' + inquiry.id, 777);
    assert.deepEqual([inquiry.status, inquiry.pipelineStage], ['in_progress', 'contact']);
  });
});
