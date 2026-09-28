'use strict';

// Двойное нажатие не должно делать работу дважды. У ответа в переписке давно
// есть идентификатор отправки; личное сообщение клиенту его не имело — два
// нажатия подряд (или повтор после обрыва) отправляли клиенту два сообщения.
// В самой панели кнопка теперь не нажимается, пока идёт запрос.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, createChat, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-64';
let base = '';
let headers = {};
let userId = '';

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    data.config.adminChatId = '9990001';
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const chat = createChat();
  await chat.say('Здравствуйте');
  userId = String(chat.id);
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': (await login.json()).csrf,
  };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const sendMessage = (body) => realFetch(base + '/api/users/' + encodeURIComponent(userId) + '/message', {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});
const outgoing = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === userId);

test('одно и то же сообщение с одним идентификатором уходит один раз', async () => {
  telegram.calls = [];
  const payload = { text: 'Добрый день! Подобрали для вас варианты.', clientRequestId: 'panel-message-0001' };
  const first = await sendMessage(payload);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.ok(!firstBody.duplicate);
  assert.equal(outgoing().length, 1, 'клиент получил сообщение');

  const second = await sendMessage(payload);
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.duplicate, true, 'повтор распознан');
  assert.equal(secondBody.inquiryId, firstBody.inquiryId, 'то же обращение, а не новое');
  assert.equal(outgoing().length, 1, 'второго сообщения клиент не получил');
});

test('следующее сообщение со своим идентификатором уходит как обычно', async () => {
  telegram.calls = [];
  const response = await sendMessage({ text: 'И ещё одно', clientRequestId: 'panel-message-0002' });
  assert.equal(response.status, 200);
  assert.ok(!(await response.json()).duplicate);
  assert.equal(outgoing().length, 1);
});

test('сообщение без идентификатора работает как раньше', async () => {
  telegram.calls = [];
  const response = await sendMessage({ text: 'Из старой вкладки панели' });
  assert.equal(response.status, 200);
  assert.equal(outgoing().length, 1);
});

test('подделанный идентификатор отклоняется', async () => {
  const response = await sendMessage({ text: 'Проверка', clientRequestId: 'коротко' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /идентификатор/i);
});

test('панель блокирует кнопку на время запроса и шлёт идентификатор', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function guardDoubleClicks\(\)/, 'защита от двойного нажатия есть');
  assert.match(PANEL_HTML, /guardDoubleClicks\(\);/, 'и она включена при запуске панели');
  assert.match(PANEL_HTML, /pendingChanges \+= 1/, 'считаются только запросы, которые что-то меняют');
  assert.match(PANEL_HTML, /clientRequestId: requestId\(\)/, 'сообщение клиенту шлёт идентификатор отправки');
  // Блокировка ставится не в момент нажатия: иначе форма входа не отправилась бы.
  const guard = PANEL_HTML.match(/function guardDoubleClicks\(\) \{([\s\S]*?)\n\}/);
  assert.ok(guard && /setTimeout\(/.test(guard[1]), 'кнопка блокируется сразу после нажатия, а не во время');
});
