'use strict';

// Подгруппы — «темы» форума в группе Telegram. Список тем Telegram боту не
// отдаёт: бот узнаёт их из сообщений и служебных событий, умеет создавать новые,
// принимать известные по ссылке и писать в нужную. Раньше о темах бот не знал
// вовсе: всё, что он публиковал, уходило в «Общую», а сообщения из тем сливались
// в одну ленту.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, resetData, settle, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
// Ответы Telegram, нужные именно этим тестам; вызовы всё равно записываются.
const replies = new Map();
global.fetch = (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  const method = String(url).split('/').pop();
  if (replies.has(method)) {
    const reply = replies.get(method);
    let body = {};
    if (init && typeof init.body === 'string') body = JSON.parse(init.body);
    telegram.calls.push({ method, body });
    if (reply instanceof Error) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: reply.message }), { status: 400, headers: { 'content-type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: reply }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return telegramStub(url, init);
};

const GROUP = '-1003934963994';
let updateId = 9000;

test.beforeEach(() => {
  replies.clear();
  resetData((data) => { data.config.active = true; });
});
test.after(() => { replies.clear(); cleanup(); });

function chat(extra = {}) {
  return { id: Number(GROUP), type: 'supergroup', title: 'Стройка без фильтров', username: 'stroykabezfiltrov', ...extra };
}

async function deliver(update) {
  await bot.processUpdates([{ update_id: updateId++, ...update }], TOKEN);
  await settle();
}

async function addBotAsAdmin(rights = { can_delete_messages: true, can_pin_messages: true, can_manage_topics: true }) {
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

const now = () => Math.floor(Date.now() / 1000);

function topicMessage(id, threadId, text, extra = {}) {
  return {
    message: {
      message_id: id, date: now(), chat: chat(), from: { id: 555, first_name: 'Ирина' },
      message_thread_id: threadId, is_topic_message: true, text, ...extra,
    },
  };
}

test('бот узнаёт тему по служебному событию и не кладёт его в ленту сообщений', async () => {
  await addBotAsAdmin();
  await deliver({
    message: {
      message_id: 12, date: now(), chat: chat(), from: { id: 42, first_name: 'Владелец' },
      message_thread_id: 12, is_topic_message: true,
      forum_topic_created: { name: 'Новостройки', icon_color: 7322096 },
    },
  });
  const group = bot.getData().groups[0];
  assert.equal(group.isForum, true, 'группа с темами — форум');
  assert.deepEqual(group.topics.map((topic) => [topic.id, topic.name, topic.closed]), [[12, 'Новостройки', false]]);
  assert.equal(group.messages.length, 0, 'служебное событие — не сообщение участника');
  assert.equal(bot.getData().inquiries.length, 0);
});

test('название темы берётся из первого сообщения в ней, если создание бот пропустил', async () => {
  await addBotAsAdmin();
  await deliver(topicMessage(40, 33, 'Есть что-то в Кальпе?', {
    reply_to_message: { message_id: 33, date: now(), chat: chat(), message_thread_id: 33, is_topic_message: true, forum_topic_created: { name: 'Кальпе' } },
  }));
  const group = bot.getData().groups[0];
  assert.deepEqual(group.topics.map((topic) => [topic.id, topic.name]), [[33, 'Кальпе']]);
  assert.equal(group.messages[0].threadId, 33, 'сообщение помнит свою тему');
});

test('сообщение без номера темы в форуме — из «Общей», а ответ в обычной группе темой не считается', async () => {
  await addBotAsAdmin();
  await deliver(topicMessage(50, 7, 'в теме'));
  await deliver({ message: { message_id: 51, date: now(), chat: chat(), from: { id: 555, first_name: 'Ирина' }, text: 'в общей' } });
  const group = bot.getData().groups[0];
  assert.deepEqual(group.messages.map((message) => message.threadId), [7, 1]);
  assert.ok(group.topics.some((topic) => topic.id === 7));

  // Группа без тем: Telegram ставит message_thread_id у ответов, но это не тема.
  resetData((data) => { data.config.active = true; });
  await addBotAsAdmin();
  await deliver({ message: { message_id: 60, date: now(), chat: chat(), from: { id: 555, first_name: 'Ирина' }, message_thread_id: 59, text: 'ответ на сообщение' } });
  const plain = bot.getData().groups[0];
  assert.equal(plain.isForum, false);
  assert.deepEqual(plain.topics, []);
  assert.equal(plain.messages[0].threadId, 0);
});

test('переименование, закрытие и открытие темы отражаются в списке', async () => {
  await addBotAsAdmin();
  const event = (id, field, value) => deliver({ message: { message_id: id, date: now(), chat: chat(), from: { id: 42 }, message_thread_id: 12, is_topic_message: true, [field]: value } });
  await event(12, 'forum_topic_created', { name: 'Новостройки' });
  await event(13, 'forum_topic_edited', { name: 'Новостройки 2026' });
  assert.equal(bot.getData().groups[0].topics[0].name, 'Новостройки 2026');
  await event(14, 'forum_topic_closed', {});
  assert.equal(bot.getData().groups[0].topics[0].closed, true);
  await event(15, 'forum_topic_reopened', {});
  assert.equal(bot.getData().groups[0].topics[0].closed, false);
});

test('обновление группы узнаёт, что в ней включены темы, и добавляет «Общую»', async () => {
  const group = await addBotAsAdmin();
  replies.set('getChat', chat({ is_forum: true }));
  replies.set('getChatMemberCount', 24);
  await bot.refreshGroup(group, TOKEN);
  assert.equal(group.isForum, true);
  assert.deepEqual(group.topics.map((topic) => topic.id), [1]);
  assert.equal(bot.topicTitle(group, 1), 'Общая');
  assert.equal(bot.topicTitle(group, 99), 'Тема №99', 'у темы без названия — её номер');
});

test('пост уходит в выбранную тему; в «Общую» и в группу без тем — без номера темы', async () => {
  const group = await addBotAsAdmin();
  await deliver(topicMessage(70, 12, 'привет'));
  assert.equal(group.isForum, true);

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'В тему', threadId: 12 }, TOKEN);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.message_thread_id, 12);
  assert.equal(group.messages[group.messages.length - 1].threadId, 12, 'своё сообщение помнит тему');

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'В общую', threadId: 1 }, TOKEN);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.message_thread_id, undefined);

  group.isForum = false;
  telegram.calls = [];
  await bot.postToGroup(group, { text: 'В группу без тем', threadId: 12 }, TOKEN);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.message_thread_id, undefined, 'Telegram отверг бы чужой номер темы');
});

test('фото, длинный текст под ним и плашка рубрики тоже уходят в тему', async () => {
  const group = await addBotAsAdmin();
  await deliver(topicMessage(71, 12, 'привет'));
  const photo = { id: 'topic-photo', name: 'f.jpg', mimeType: 'image/jpeg', size: 10, dataBase64: Buffer.from('fake').toString('base64') };
  // PNG с альфа-каналом (цветовой тип 6 в заголовке): Telegram примет его только файлом.
  const header = Buffer.alloc(26);
  header.writeUInt32BE(0x89504e47, 0);
  header.write('IHDR', 12);
  header.writeUInt32BE(1280, 16);
  header.writeUInt32BE(320, 20);
  header[24] = 8;
  header[25] = 6;
  const plate = { id: 'topic-plate', name: 'plate.png', mimeType: 'image/png', size: header.length, dataBase64: header.toString('base64') };
  bot.getData().config.publishing = { signature: '', signatureEnabled: true, rubrics: [{ id: 'r1', name: 'Прозрачная', placement: 'bottom', image: plate }], buttons: [] };

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Подпись', image: photo, threadId: 12 }, TOKEN);
  assert.equal(String(telegram.calls.find((call) => call.method === 'sendPhoto').body.message_thread_id), '12', 'фото с подписью');

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'д'.repeat(1500), image: photo, threadId: 12 }, TOKEN);
  assert.equal(String(telegram.calls.find((call) => call.method === 'sendPhoto').body.message_thread_id), '12', 'фото без подписи');
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.message_thread_id, 12, 'длинный текст под фото — в ту же тему');

  telegram.calls = [];
  await bot.postToGroup(group, { text: 'Пост', rubricId: 'r1', threadId: 12 }, TOKEN);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.message_thread_id, 12);
  assert.equal(String(telegram.calls.find((call) => call.method === 'sendDocument').body.message_thread_id), '12', 'плашка — в ту же тему');
});

test('отложенная публикация помнит тему', async () => {
  const group = await addBotAsAdmin();
  await deliver(topicMessage(72, 12, 'привет'));
  const post = bot.newGroupPost({ groupId: group.id, threadId: 12, text: 'Через минуту', sendAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(post.threadId, 12);
  bot.getData().groupPosts = [post];
  telegram.calls = [];
  assert.deepEqual(await bot.runDueGroupPosts(new Date(), TOKEN), [post.id]);
  assert.equal(telegram.calls.find((call) => call.method === 'sendMessage').body.message_thread_id, 12);
  const reloaded = bot.normalizeLoadedData({ version: 40, groupPosts: [post], groups: [group] });
  assert.equal(reloaded.groupPosts[0].threadId, 12, 'тема переживает перезапуск');
  assert.deepEqual(reloaded.groups[0].topics.map((topic) => topic.id), [12]);
  assert.equal(reloaded.groups[0].isForum, true);
});

test('закрытая или удалённая тема — понятная ошибка, а не ответ Telegram как есть', async () => {
  const group = await addBotAsAdmin();
  await deliver({ message: { message_id: 12, date: now(), chat: chat(), from: { id: 42 }, message_thread_id: 12, is_topic_message: true, forum_topic_created: { name: 'Акции' } } });
  replies.set('sendMessage', new Error('Bad Request: TOPIC_CLOSED'));
  await assert.rejects(() => bot.postToGroup(group, { text: 'x', threadId: 12 }, TOKEN), /Тема «Акции» закрыта/);
  replies.set('sendMessage', new Error('Bad Request: message thread not found'));
  await assert.rejects(() => bot.postToGroup(group, { text: 'x', threadId: 12 }, TOKEN), /Темы «Акции» нет/);
});

test.describe('панель', () => {
  let base;
  let headers;

  test.before(async () => {
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + bot.server.address().port;
  });
  test.after(() => bot.server.close());

  async function login() {
    const data = bot.getData();
    const password = bot.hashPassword('correct-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
  }

  const call = (path, method, body) => realFetch(base + '/api/groups/' + GROUP + path, { method, headers, body: JSON.stringify(body || {}) });

  test('новую тему можно создать из панели', async () => {
    await addBotAsAdmin();
    await deliver(topicMessage(80, 12, 'привет'));
    await login();
    replies.set('createForumTopic', { message_thread_id: 55, name: 'Аренда' });
    telegram.calls = [];
    const response = await call('/topics', 'POST', { name: '  Аренда  ' });
    assert.equal(response.status, 200);
    assert.deepEqual(telegram.calls.find((item) => item.method === 'createForumTopic').body, { chat_id: GROUP, name: 'Аренда' });
    const topics = bot.getData().groups[0].topics;
    assert.ok(topics.some((topic) => topic.id === 55 && topic.name === 'Аренда'));
  });

  test('без тем в группе и без названия тему не создают; без права — понятная подсказка', async () => {
    await addBotAsAdmin();
    await login();
    assert.match((await (await call('/topics', 'POST', { name: 'Аренда' })).json()).error, /не включены темы/);
    await deliver(topicMessage(81, 12, 'привет'));
    assert.match((await (await call('/topics', 'POST', { name: '   ' })).json()).error, /Назовите тему/);
    replies.set('createForumTopic', new Error('Bad Request: not enough rights to create a topic'));
    assert.match((await (await call('/topics', 'POST', { name: 'Аренда' })).json()).error, /Управление темами/);
  });

  test('известную тему добавляют по ссылке или номеру; чужую ссылку отвергают', async () => {
    await addBotAsAdmin();
    await deliver(topicMessage(82, 12, 'привет'));
    await login();
    const add = async (link, name) => call('/topics/add', 'POST', { link, name });

    assert.equal((await add('https://t.me/c/3934963994/44/120', 'Курорты')).status, 200, 'ссылка на сообщение в теме');
    assert.equal((await add('77')).status, 200, 'просто номер');
    assert.equal((await add('https://t.me/stroykabezfiltrov/90')).status, 200, 'ссылка публичной группы');
    const topics = bot.getData().groups[0].topics;
    assert.deepEqual(topics.filter((topic) => topic.manual).map((topic) => [topic.id, topic.name]), [[44, 'Курорты'], [77, ''], [90, '']]);
    assert.equal(bot.topicTitle(bot.getData().groups[0], 77), 'Тема №77');

    assert.match((await (await add('https://t.me/c/1111111111/5')).json()).error, /другую группу/);
    assert.match((await (await add('https://t.me/otherclub/5')).json()).error, /другую группу/);
    assert.match((await (await add('привет')).json()).error, /номер темы или ссылку/);
    assert.match((await (await add('1')).json()).error, /«Общая»/);
  });

  test('тему убирают из списка; «Общую» убрать нельзя', async () => {
    const group = await addBotAsAdmin();
    replies.set('getChat', chat({ is_forum: true }));
    replies.set('getChatMemberCount', 5);
    await bot.refreshGroup(group, TOKEN);
    await deliver(topicMessage(83, 12, 'привет'));
    await login();
    assert.equal((await call('/topics/12', 'DELETE')).status, 200);
    assert.deepEqual(bot.getData().groups[0].topics.map((topic) => topic.id), [1]);
    assert.equal((await call('/topics/1', 'DELETE')).status, 400);
  });

  test('пост из панели уходит в тему; проверка «себе» — без темы, в админ-чат', async () => {
    await addBotAsAdmin();
    await deliver(topicMessage(84, 12, 'привет'));
    bot.getData().config.adminChatId = '424242';
    await login();

    telegram.calls = [];
    assert.equal((await call('/post', 'POST', { text: 'В тему', threadId: 12 })).status, 200);
    const sent = telegram.calls.find((item) => item.method === 'sendMessage');
    assert.equal(String(sent.body.chat_id), GROUP);
    assert.equal(sent.body.message_thread_id, 12);

    telegram.calls = [];
    assert.equal((await call('/post', 'POST', { text: 'Проверка', threadId: 12, preview: true })).status, 200);
    const preview = telegram.calls.find((item) => item.method === 'sendMessage');
    assert.equal(String(preview.body.chat_id), '424242');
    assert.equal(preview.body.message_thread_id, undefined, 'в админ-чате тем нет');

    const later = await (await call('/post', 'POST', { text: 'Позже', threadId: 12, sendAt: new Date(Date.now() + 3600e3).toISOString() })).json();
    assert.equal(later.post.threadId, 12, 'отложенный пост помнит тему');
  });

  test('панель получает темы в составе групп', async () => {
    await addBotAsAdmin();
    await deliver(topicMessage(85, 12, 'привет', {
      reply_to_message: { message_id: 12, date: now(), chat: chat(), message_thread_id: 12, is_topic_message: true, forum_topic_created: { name: 'Новостройки' } },
    }));
    await login();
    replies.set('getChat', chat({ is_forum: true }));
    replies.set('getChatMemberCount', 5);
    const state = await (await realFetch(base + '/api/groups', { headers })).json();
    assert.equal(state.groups[0].isForum, true);
    assert.deepEqual(state.groups[0].topics.map((topic) => topic.name).sort(), ['', 'Новостройки'], 'своя тема и «Общая»');
  });
});
