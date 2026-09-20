'use strict';

// Группы, где состоит бот: учёт по обновлениям Telegram, публикации из
// панели, закрепление, заявки на вступление и отложенные посты.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, resetData, settle, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
// Ответы Telegram, которые нужны именно этим тестам (getChat и соседи).
const replies = new Map();
global.fetch = (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  const method = String(url).split('/').pop();
  if (replies.has(method)) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: replies.get(method) }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return telegramStub(url, init);
};

const GROUP = '-1001234567890';
let updateId = 5000;

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

function chat(extra = {}) {
  return { id: Number(GROUP), type: 'supergroup', title: 'Клуб покупателей', ...extra };
}

async function deliver(update) {
  await bot.processUpdates([{ update_id: updateId++, ...update }], TOKEN);
  await settle();
}

async function addBotAsAdmin(rights = { can_delete_messages: true, can_pin_messages: true, can_change_info: true, can_invite_users: true }) {
  await deliver({
    my_chat_member: {
      chat: chat(),
      from: { id: 42, first_name: 'Владелец' },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: 'left', user: { id: bot.getData().bot.id, is_bot: true } },
      new_chat_member: { status: 'administrator', user: { id: bot.getData().bot.id, is_bot: true }, ...rights },
    },
  });
  return bot.getData().groups[0];
}

test('the bot added to a group remembers it with its rights', async () => {
  const group = await addBotAsAdmin();
  assert.equal(group.id, GROUP);
  assert.equal(group.title, 'Клуб покупателей');
  assert.equal(group.status, 'administrator');
  assert.equal(group.rights.can_delete_messages, true);
  assert.equal(group.rights.can_promote_members, false);

  await deliver({ my_chat_member: { chat: chat(), from: { id: 42 }, date: 1, old_chat_member: {}, new_chat_member: { status: 'left', user: { id: bot.getData().bot.id } } } });
  assert.equal(bot.getData().groups[0].status, 'left', 'the bot was removed');
  assert.equal(bot.getData().groups.length, 1, 'the same group, not a second entry');
});

test('a message in the group is remembered, not turned into an inquiry', async () => {
  await addBotAsAdmin();
  await deliver({
    message: {
      message_id: 77, date: Math.floor(Date.now() / 1000), chat: chat(),
      from: { id: 555, first_name: 'Ирина', username: 'irina' },
      text: 'А есть что-то у моря?',
    },
  });
  const group = bot.getData().groups[0];
  assert.equal(group.messages.length, 1);
  assert.deepEqual([group.messages[0].messageId, group.messages[0].name, group.messages[0].text], [77, 'Ирина', 'А есть что-то у моря?']);
  assert.equal(bot.getData().inquiries.length, 0, 'group chat is not a client inquiry');
});

test('a join request is kept until it is answered', async () => {
  await addBotAsAdmin();
  await deliver({ chat_join_request: { chat: chat(), from: { id: 99, first_name: 'Марина', username: 'marina' }, date: 1, user_chat_id: 99 } });
  assert.deepEqual(bot.getData().groups[0].joinRequests.map((request) => request.name), ['Марина']);
});

test('a post from the panel reaches the group and can be pinned', async () => {
  const group = await addBotAsAdmin();
  telegram.calls = [];
  const messageId = await bot.postToGroup(group, { text: 'Новые квартиры в Бенидорме', buttonText: 'Смотреть', buttonUrl: 'https://example.com/flats', pin: true }, TOKEN);
  const sent = telegram.calls.find((call) => call.method === 'sendMessage');
  assert.equal(String(sent.body.chat_id), GROUP);
  assert.equal(sent.body.text, 'Новые квартиры в Бенидорме');
  assert.deepEqual(sent.body.reply_markup.inline_keyboard[0][0], { text: 'Смотреть', url: 'https://example.com/flats' });
  const pin = telegram.calls.find((call) => call.method === 'pinChatMessage');
  assert.equal(Number(pin.body.message_id), messageId);
  assert.equal(group.pinnedMessageId, messageId);
  assert.equal(group.messages[group.messages.length - 1].fromBot, true);
});

test('a post without text and without a photo is refused', async () => {
  const group = await addBotAsAdmin();
  await assert.rejects(() => bot.postToGroup(group, { text: '   ' }, TOKEN), /пуст/i);
});

test('a scheduled post is sent when its time comes', async () => {
  const group = await addBotAsAdmin();
  const data = bot.getData();
  data.groupPosts = [
    { id: 'p1', groupId: group.id, text: 'Через минуту', status: 'scheduled', sendAt: new Date(Date.now() - 1000).toISOString(), notify: true },
    { id: 'p2', groupId: group.id, text: 'Завтра', status: 'scheduled', sendAt: new Date(Date.now() + 864e5).toISOString(), notify: true },
  ];
  telegram.calls = [];
  const sent = await bot.runDueGroupPosts(new Date(), TOKEN);
  assert.deepEqual(sent, ['p1']);
  assert.equal(data.groupPosts[0].status, 'sent');
  assert.equal(data.groupPosts[1].status, 'scheduled', 'the future one waits');
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage').length, 1);
});

test('the panel publishes, pins, deletes and answers join requests', async () => {
  const group = await addBotAsAdmin();
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.groups[0].joinRequests = [{ userId: '99', name: 'Марина', username: 'marina', at: new Date().toISOString() }];
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const call = (path, method, body) => realFetch(base + '/api/groups/' + GROUP + path, { method: method, headers, body: JSON.stringify(body || {}) });

    telegram.calls = [];
    const posted = await call('/post', 'POST', { text: 'Привет, группа' });
    assert.equal(posted.status, 200);
    const messageId = (await posted.json()).messageId;
    assert.ok(messageId);

    assert.equal((await call('/pin', 'POST', { messageId })).status, 200);
    assert.equal(data.groups[0].pinnedMessageId, messageId);

    assert.equal((await realFetch(base + '/api/groups/' + GROUP + '/messages/' + messageId, { method: 'DELETE', headers })).status, 200);
    assert.ok(!data.groups[0].messages.some((message) => message.messageId === messageId), 'deleted from the log too');
    assert.ok(telegram.calls.some((entry) => entry.method === 'deleteMessage'));

    assert.equal((await call('/join-requests/99', 'POST', { approve: true })).status, 200);
    assert.equal(data.groups[0].joinRequests.length, 0);
    assert.ok(telegram.calls.some((entry) => entry.method === 'approveChatJoinRequest'));

    const scheduled = await call('/post', 'POST', { text: 'Позже', sendAt: new Date(Date.now() + 36e5).toISOString() });
    assert.equal(scheduled.status, 200);
    assert.equal(data.groupPosts.filter((post) => post.status === 'scheduled').length, 1);

    const late = await call('/post', 'POST', { text: 'Вчера', sendAt: new Date(Date.now() - 864e5).toISOString() });
    assert.equal(late.status, 400, 'a past date is refused');

    assert.equal((await realFetch(base + '/api/groups/000/post', { method: 'POST', headers, body: '{}' })).status, 404);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('a channel where the bot already is can be connected by its id', async () => {
    const data = bot.getData();
    const password = bot.hashPassword('correct-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    replies.set('getChat', { id: Number(GROUP), type: 'channel', title: 'Застройщик в Испании', username: 'kornilenko1' });
    replies.set('getChatMemberCount', 59);
    replies.set('getChatMember', { status: 'administrator', can_post_messages: true, can_delete_messages: true, can_invite_users: true });
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    try {
      const base = 'http://127.0.0.1:' + bot.server.address().port;
      const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
      const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };

      const bad = await realFetch(base + '/api/groups', { method: 'POST', headers, body: JSON.stringify({ chatId: 'клуб' }) });
      assert.equal(bad.status, 400);

      const response = await realFetch(base + '/api/groups', { method: 'POST', headers, body: JSON.stringify({ chatId: GROUP }) });
      assert.equal(response.status, 200);
      const group = data.groups[0];
      assert.deepEqual([group.title, group.type, group.status, group.memberCount], ['Застройщик в Испании', 'channel', 'administrator', 59]);
      assert.equal(group.rights.can_post_messages, true);
      assert.equal(group.rights.can_pin_messages, false, 'право, которого нет, не выдумывается');
    } finally {
      replies.clear();
      await new Promise((resolve) => bot.server.close(resolve));
    }
  });

test('a post in a channel is remembered as the channel, not a person', async () => {
  await addBotAsAdmin();
  await deliver({
    channel_post: {
      message_id: 501, date: Math.floor(Date.now() / 1000),
      chat: chat({ type: 'channel', title: 'Застройщик в Испании' }),
      sender_chat: { id: Number(GROUP), title: 'Застройщик в Испании', type: 'channel' },
      text: 'Новый дом в Бенидорме',
    },
  });
  const group = bot.getData().groups[0];
  assert.equal(group.messages.length, 1);
  assert.equal(group.messages[0].name, 'Застройщик в Испании');
  assert.equal(group.messages[0].fromBot, true);
  assert.equal(bot.getData().inquiries.length, 0);
});

test('the panel state carries the groups', async () => {
  await addBotAsAdmin();
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
    const state = await (await realFetch(base + '/api/state', { headers })).json();
    assert.equal(state.groups.length, 1);
    assert.equal(state.groups[0].title, 'Клуб покупателей');
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('подпись и плашка рубрики добавляются к посту', async () => {
  const group = await addBotAsAdmin();
  const data = bot.getData();
  const plate = { id: 'plate-1', name: 'plate.png', mimeType: 'image/png', size: 10, dataBase64: 'iVBORw0KGgo=' };
  data.config.publishing = {
    signature: 'Construcciones Kornilenko\n+34 664 17 96 37',
    signatureEnabled: true,
    rubrics: [
      { id: 'r-bottom', name: 'Новостройки', placement: 'bottom', image: plate },
      { id: 'r-top', name: 'Советы', placement: 'top', image: plate },
    ],
  };

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Новый дом в Бенидорме', rubricId: 'r-bottom' }, TOKEN);
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage').length, 0, 'пост уходит одним сообщением');
  const inside = telegram.calls.find((call) => call.method === 'sendPhoto');
  assert.match(inside.body.caption, /^Новый дом в Бенидорме\n\nConstrucciones Kornilenko/, 'текст с подписью');
  assert.equal(String(inside.body.show_caption_above_media), 'true', 'текст над плашкой, плашка внизу сообщения');

  // Длинный текст в подпись не помещается: плашка уходит следом.
  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Д'.repeat(1100), rubricId: 'r-bottom' }, TOKEN);
  const long = telegram.calls.find((call) => call.method === 'sendMessage');
  const plateCall = telegram.calls.find((call) => call.method === 'sendPhoto');
  assert.ok(long && plateCall, 'текст и плашка отдельными сообщениями');
  assert.ok(telegram.calls.indexOf(plateCall) > telegram.calls.indexOf(long), 'плашка после текста');
  assert.equal(plateCall.body.caption || '', '', 'на плашке нет подписи');

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Как выбрать квартиру', rubricId: 'r-top' }, TOKEN);
  const top = telegram.calls.find((call) => call.method === 'sendPhoto');
  assert.match(top.body.caption, /^Как выбрать квартиру/, 'плашка сверху, текст подписью к ней');
  assert.equal(telegram.calls.filter((call) => call.method === 'sendPhoto').length, 1, 'плашка одна');

  // Своё фото поста остаётся главным, плашка идёт следом.
  telegram.calls = [];
  await bot.postToGroup(group, { text: 'С фотографией', rubricId: 'r-bottom', image: plate }, TOKEN);
  assert.equal(telegram.calls.filter((call) => call.method === 'sendPhoto').length, 2, 'фото поста и плашка');
  assert.match(telegram.calls.find((call) => call.method === 'sendPhoto').body.caption, /^С фотографией/);

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Без подписи', withoutSignature: true }, TOKEN);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.text, 'Без подписи');

  data.config.publishing.signatureEnabled = false;
  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Подпись выключена' }, TOKEN);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.text, 'Подпись выключена');
});

test('панель сохраняет подпись и рубрики', async () => {
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('plate')]).toString('base64');
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const save = (body) => realFetch(base + '/api/publishing', { method: 'PUT', headers, body: JSON.stringify(body) });

    assert.equal((await save({ signature: 'Подпись', rubrics: [{ name: 'Без картинки' }] })).status, 400, 'рубрика без плашки не сохраняется');

    const ok = await save({ signature: 'Подпись\nсайт: example.com', rubrics: [{ name: 'Новостройки', placement: 'bottom', imageDataUrl: png }] });
    assert.equal(ok.status, 200);
    const saved = data.config.publishing;
    assert.equal(saved.signature, 'Подпись\nсайт: example.com');
    assert.equal(saved.rubrics.length, 1);
    assert.ok(saved.rubrics[0].id, 'рубрике выдан идентификатор');

    // Повторное сохранение без файла оставляет прежнюю плашку.
    const again = await save({ signature: 'Подпись', rubrics: [{ id: saved.rubrics[0].id, name: 'Новостройки', placement: 'top' }] });
    assert.equal(again.status, 200);
    assert.equal(data.config.publishing.rubrics[0].placement, 'top');
    assert.ok(data.config.publishing.rubrics[0].image, 'плашка сохранилась');

    const state = await (await realFetch(base + '/api/state', { headers: { cookie: headers.cookie } })).json();
    assert.equal(state.publishing.rubrics[0].name, 'Новостройки');
    assert.equal(state.publishing.rubrics[0].image.exists, true);
    assert.equal(state.publishing.rubrics[0].image.dataBase64, undefined, 'файл в состояние не попадает');

    const picture = await realFetch(base + '/api/media/rubrics/' + saved.rubrics[0].id, { headers: { cookie: headers.cookie } });
    assert.equal(picture.status, 200);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});
