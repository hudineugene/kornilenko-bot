'use strict';

// Подборка клиенту из панели: менеджер выбирает объекты в диалоге, ответ уходит с кнопкой «Смотреть подборку», по которой
// карточки открываются в чате. Скрытые объекты и объекты без карточки на языке клиента не отправляются.

const realFetch = global.fetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'offer-password-5';
let base = '';
let headers = {};

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-a-01', 'Вилла Альфа', 'active'));
    data.objects.push(property('villa-b-02', 'Вилла Бета', 'active'));
    data.objects.push(property('villa-h-03', 'Вилла Скрытая', 'hidden'));
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  if (!bot.server.listening) await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  if (bot.server.listening) await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

async function clientWithInquiry() {
  const chat = createChat();
  await chat.say('Подскажите по оформлению ипотеки');
  return { chat, inquiry: chat.inquiries[0] };
}

const reply = (inquiry, body) => realFetch(base + '/api/inquiries/' + inquiry.id + '/reply', { method: 'POST', headers, body: JSON.stringify(body) });
const sentTo = (chat) => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));

test('подборка уходит с кнопкой «Смотреть подборку · N»; скрытый объект отброшен; в переписке видны названия', async () => {
  const { chat, inquiry } = await clientWithInquiry();
  telegram.calls = [];
  const response = await reply(inquiry, { text: '', offerIds: ['villa-a-01', 'villa-b-02', 'villa-h-03'] });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.offered, 2);
  assert.equal(body.skipped, 1);

  const [message] = sentTo(chat);
  assert.match(message.body.text, /Мы подобрали для вас объекты/, 'без своего текста — стандартная фраза');
  const button = message.body.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, '🏘 Смотреть список · 2');
  assert.equal(button.callback_data, 'catalog:shared:0');

  const last = inquiry.replies[inquiry.replies.length - 1];
  assert.match(last.text, /🏘 Подборка \(2\): Вилла Альфа, Вилла Бета/);
  assert.equal(inquiry.status, 'in_progress');
  const code = chat.user.sharedListCode;
  assert.ok(code, 'список назначен клиенту текущим');
  assert.deepEqual(bot.getData().sharedLists[code].ids, ['villa-a-01', 'villa-b-02']);

  assert.equal(bot.getData().sharedLists[code].owner, 'offer:' + chat.user.id, 'хозяин подборки менеджера — отдельный, ссылки клиента из избранного она не вытесняет');

  // Кнопка открывает карточки в чате.
  telegram.calls = [];
  await chat.press('catalog:shared:0');
  const shown = telegram.calls.map((call) => String(call.body.caption || call.body.text || '')).join('\n');
  assert.match(shown, /Вилла Альфа/);
});

test('подборки менеджера не вытесняют ссылку, которой клиент поделился из избранного, даже когда их больше пяти', async () => {
  const { chat, inquiry } = await clientWithInquiry();
  const data = bot.getData();
  data.sharedLists = { ownshare1: { ids: ['villa-a-01'], owner: String(chat.user.id), createdAt: new Date().toISOString(), opens: 0 } };
  for (let index = 0; index < 7; index += 1) {
    const response = await reply(inquiry, { text: 'Вариант ' + index, offerIds: ['villa-a-01', 'villa-b-02'] });
    assert.equal(response.status, 200);
  }
  assert.ok(data.sharedLists.ownshare1, 'ссылка клиента из избранного на месте');
  assert.equal(Object.values(data.sharedLists).filter((list) => list.owner === 'offer:' + chat.user.id).length, 5, 'подборок менеджера не больше пяти');
});

test('свой текст и кнопка-ссылка идут вместе с подборкой; без текста, файла и объектов — отказ; только скрытые — отказ', async () => {
  const { chat, inquiry } = await clientWithInquiry();
  telegram.calls = [];
  const response = await reply(inquiry, { text: 'Посмотрите эти варианты', offerIds: ['villa-a-01'], buttonText: 'Наш сайт', buttonUrl: 'https://example.com/' });
  assert.equal(response.status, 200);
  const [message] = sentTo(chat);
  assert.match(message.body.text, /Посмотрите эти варианты/);
  assert.ok(!/Мы подобрали для вас/.test(message.body.text));
  assert.deepEqual(message.body.reply_markup.inline_keyboard.map((row) => row[0].text), ['🏘 Смотреть список · 1', 'Наш сайт']);

  assert.equal((await reply(inquiry, { text: '' })).status, 400, 'пустое сообщение');
  const hidden = await reply(inquiry, { text: 'Вот', offerIds: ['villa-h-03'] });
  assert.equal(hidden.status, 400);
  assert.match((await hidden.json()).error, /не видны клиентам/);
});

test('подборка клиенту на испанском: текст и кнопка на его языке; объект без испанской карточки не отправляется', async () => {
  const chat = createChat({ language: 'es' });
  await chat.say('Hola, tengo una pregunta sobre hipotecas');
  const inquiry = chat.inquiries[0];
  bot.getData().objects.push(property('villa-n-04', 'Вилла без испанского', 'active', { title: { ru: 'Вилла без испанского', en: '', es: '' } }));
  telegram.calls = [];
  const response = await reply(inquiry, { text: '', offerIds: ['villa-a-01', 'villa-n-04'] });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.offered, 1);
  assert.equal(body.skipped, 1);
  const [message] = sentTo(chat);
  assert.match(message.body.text, /Hemos elegido inmuebles/);
  assert.equal(message.body.reply_markup.inline_keyboard[0][0].text, '🏘 Ver la lista · 1');
});

test('в панели есть кнопка «Предложить объекты» и окно выбора с поиском', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-inquiries.mjs'), 'utf8');
  assert.match(view, /id="offerPick"/);
  assert.match(view, /function openOfferPicker\(/);
  assert.match(view, /payload\.offerIds = offerIds/);
  assert.ok(callbacksOf, 'helper доступен');
});
