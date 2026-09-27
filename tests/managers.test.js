'use strict';

// Several managers: inquiries reach every manager's chat, any of them can
// answer, "in progress" takes the inquiry.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, ADMIN_CHAT, createChat, adminPress, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const MANAGER_CHAT = '8880001';

test.beforeEach(() => resetData((data) => {
  data.config.adminName = 'Олег';
  data.config.managers = [{ id: 'm1', name: 'Мария', chatId: MANAGER_CHAT, verifiedAt: '' }];
}));
test.after(cleanup);

function sentTo(chatId) {
  return telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chatId));
}

function managerNotificationId(inquiryId) {
  const entry = Object.entries(bot.getData().adminReplyTargets).find(([key, target]) => key.startsWith(MANAGER_CHAT + ':') && target.inquiryId === inquiryId);
  return Number(entry[0].split(':')[1]);
}

function managerMessage(text, replyTo) {
  return bot.handleUpdate({
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 900 + Math.floor(Math.random() * 1000),
      date: Math.floor(Date.now() / 1000),
      from: { id: Number(MANAGER_CHAT), first_name: 'Мария' },
      chat: { id: Number(MANAGER_CHAT), type: 'private' },
      text,
      ...(replyTo ? { reply_to_message: { message_id: replyTo, from: { id: 5550001 }, date: Math.floor(Date.now() / 1000), text: '📩 …' } } : {}),
    },
  }, TOKEN);
}

test('a client inquiry reaches the admin and every manager', async () => {
  const chat = createChat();
  await chat.say('Есть ли квартиры в Бенидорме?');
  const inquiry = chat.inquiries[0];
  assert.equal(sentTo(ADMIN_CHAT).filter((call) => call.body.text.startsWith('📩')).length, 1);
  const [toManager] = sentTo(MANAGER_CHAT);
  assert.match(toManager.body.text, /^📩 Новое обращение/);
  assert.ok(Object.keys(bot.getData().adminReplyTargets).some((key) => !key.includes(':')), 'the main admin keeps plain keys');
  assert.ok(managerNotificationId(inquiry.id) > 0);
  assert.equal(bot.getData().config.managers[0].verifiedAt !== '', true, 'a delivered message proves the chat works');
});

test('a manager answers from their chat; the inquiry is theirs', async () => {
  const chat = createChat();
  await chat.say('Можно посмотреть виллу в субботу?');
  const inquiry = chat.inquiries[0];
  telegram.calls = [];
  await managerMessage('Да, в субботу в 11:00 удобно?', managerNotificationId(inquiry.id));
  const [toClient] = sentTo(chat.id);
  assert.match(toClient.body.text, /Да, в субботу в 11:00 удобно\?/);
  assert.match(sentTo(MANAGER_CHAT)[0].body.text, /^✅ Сообщение отправлено/);
  assert.equal(sentTo(ADMIN_CHAT).length, 0, 'the confirmation goes to the one who answered');
  assert.equal(inquiry.replies[0].by, 'Мария');
  assert.equal(inquiry.assignee, 'Мария');
  assert.equal(inquiry.status, 'in_progress');
});

test('"in progress" from a manager\'s chat takes the inquiry; other chats cannot act', async () => {
  const chat = createChat();
  await chat.say('Вопрос по ипотеке');
  const inquiry = chat.inquiries[0];
  const pressed = await bot.handleUpdate({ update_id: 777001, callback_query: { id: 'mgr1', from: { id: Number(MANAGER_CHAT) }, data: 'inq:in_progress:' + inquiry.id, message: { message_id: 5, chat: { id: Number(MANAGER_CHAT) } } } }, TOKEN);
  assert.equal(pressed, undefined);
  assert.equal(inquiry.assignee, 'Мария');
  const popup = telegram.calls.filter((call) => call.method === 'answerCallbackQuery').pop();
  assert.equal(popup.body.text, 'Статус: в работе · взял(а): Мария');

  await adminPress('inq:in_progress:' + inquiry.id);
  assert.equal(inquiry.assignee, 'Олег', 'the admin can take it over');

  await chat.press('inq:closed:' + inquiry.id);
  assert.equal(inquiry.status, 'in_progress', 'a client cannot change statuses');
});

test('navigation notices and planned follow-ups do not flood the managers', async () => {
  bot.getData().config.notifyMode = 'all';
  const chat = createChat();
  await chat.say(bot.text.menu.ru.promotions);
  assert.equal(sentTo(MANAGER_CHAT).length, 0, 'browsing is only for the main admin');

  await chat.say('Перезвоните мне завтра');
  const inquiry = chat.inquiries[0];
  inquiry.assignee = 'Мария';
  inquiry.followUpDate = '2026-09-18';
  telegram.calls = [];
  await bot.runFollowUpReminders(new Date(2026, 8, 18, 10, 0));
  assert.equal(sentTo(MANAGER_CHAT).length, 1);
  assert.equal(sentTo(ADMIN_CHAT).length, 0, 'the follow-up goes to the one who took it');
});

test('a follow-up the manager could not get goes to the others', async () => {
  const chat = createChat();
  await chat.say('Перезвоните мне');
  const inquiry = chat.inquiries[0];
  inquiry.assignee = 'Мария';
  inquiry.followUpDate = '2026-09-18';
  const working = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/sendMessage') && String(JSON.parse(init.body).chat_id) === MANAGER_CHAT) {
      return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
    }
    return working(url, init);
  };
  telegram.calls = [];
  try {
    assert.deepEqual(await bot.runFollowUpReminders(new Date(2026, 8, 18, 10, 0)), [inquiry.id]);
  } finally {
    global.fetch = working;
  }
  assert.equal(sentTo(ADMIN_CHAT).length, 1, 'the admin got it instead');
  assert.ok(inquiry.followUpNotifiedAt);
});

test('changing the main admin chat forgets the old chat\'s reply routes', async () => {
  const chat = createChat();
  await chat.say('Вопрос');
  const data = bot.getData();
  assert.ok(Object.keys(data.adminReplyTargets).some((key) => !key.includes(':')));
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    // Смена чата администратора требует текущий пароль панели.
    const without = await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ messages: data.config.messages, active: false, adminChatId: MANAGER_CHAT }) });
    assert.equal(without.status, 403, 'без пароля чат администратора не сменить');
    const response = await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ messages: data.config.messages, active: false, adminChatId: MANAGER_CHAT, currentPassword: 'correct-password' }) });
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
  assert.ok(Object.keys(data.adminReplyTargets).every((key) => key.includes(':')), 'no plain keys of the old chat');
  assert.deepEqual(data.config.managers, [], 'the manager became the main admin');
});

test('the panel saves the managers and checks their chats', async () => {
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    // Список менеджеров меняется только с текущим паролем панели.
    const save = (body) => realFetch(base + '/api/managers', { method: 'PUT', headers, body: JSON.stringify({ currentPassword: 'correct-password', ...body }) });
    assert.equal((await realFetch(base + '/api/managers', { method: 'PUT', headers, body: JSON.stringify({ managers: [{ name: 'Иван', chatId: '12345' }] }) })).status, 403, 'без пароля список не меняется');

    assert.equal((await save({ managers: [{ name: '', chatId: '12345' }] })).status, 400, 'a name is needed');
    assert.equal((await save({ managers: [{ name: 'Иван', chatId: 'abc' }] })).status, 400);
    assert.equal((await save({ managers: [{ name: 'Иван', chatId: ADMIN_CHAT }] })).status, 400, 'not the admin chat');
    assert.equal((await save({ managers: [{ name: 'Иван', chatId: '12345' }, { name: 'Пётр', chatId: '12345' }] })).status, 400, 'no duplicates');

    data.config.managers[0].verifiedAt = '2026-09-18T10:00:00.000Z';
    assert.equal((await save({ adminName: 'Олег', managers: [{ name: 'Мария Л.', chatId: MANAGER_CHAT }, { name: 'Иван', chatId: '12345' }] })).status, 200);
    assert.deepEqual(data.config.managers.map((manager) => [manager.name, manager.chatId, Boolean(manager.verifiedAt)]), [['Мария Л.', MANAGER_CHAT, true], ['Иван', '12345', false]]);

    telegram.calls = [];
    const ivan = data.config.managers[1];
    assert.equal((await realFetch(base + '/api/managers/' + ivan.id + '/test', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.match(sentTo('12345')[0].body.text, /^✅ Иван, уведомления работают/);
    assert.ok(ivan.verifiedAt);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});
