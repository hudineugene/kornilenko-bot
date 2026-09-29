'use strict';

// Карточка встречи. Покупатель из-за границы едет на просмотр в чужую страну, и
// самый большой его страх — приехать и никого не найти. Поэтому подтверждение
// просмотра — не сухое «просмотр подтверждён», а карточка: кто встретит (имя и
// фото), куда ехать (карта), по какому телефону связаться, что взять с собой и
// что делать, если задерживаешься. Онлайн-показ этого не касается: приезжать
// не нужно.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, adminPress, createChat, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const { viewing: VIEWING } = bot.text;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('manager face')]);

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('villa-marbella-01', 'Вилла в Марбелье', 'active', {
    address: { ru: 'Calle del Mar, 5', en: 'Calle del Mar, 5', es: '' },
    city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
    mapUrl: 'https://maps.example.com/villa',
    dealType: 'sale', propertyType: 'villa', priceValue: 900000,
  }));
}));
test.after(cleanup);

function withAgent() {
  const data = bot.getData();
  data.contacts.managerName = 'Ольга Корниленко';
  data.contacts.phone = '+34 600 111 222';
  data.contacts.photo = { id: 'mgr', mimeType: 'image/png', name: 'olga.png', size: PNG.length, dataBase64: PNG.toString('base64'), updatedAt: new Date().toISOString() };
}

async function confirmedCard(language = 'ru', { online = false } = {}) {
  const copy = VIEWING[language];
  const chat = createChat({ language });
  await chat.press('property:viewing:villa-marbella-01');
  if (online) {
    await chat.say(copy.online);
    await chat.say('в субботу после 16:00');
  } else {
    await chat.say(copy.dateOptions[1]);
    await chat.say(copy.timeOptions[1]);
  }
  await chat.say(copy.confirm);
  const inquiry = chat.inquiries[chat.inquiries.length - 1];
  telegram.calls = [];
  await adminPress('inq:confirm:' + inquiry.id, 321);
  const messages = telegram.calls.filter((call) => ['sendMessage', 'sendPhoto'].includes(call.method) && String(call.body.chat_id) === String(chat.id));
  return { messages, text: (messages.find((call) => call.method === 'sendMessage') || { body: { text: '' } }).body.text, markup: (messages.find((call) => call.method === 'sendMessage') || { body: {} }).body.reply_markup };
}

test('подтверждение просмотра — карточка: имя, телефон, что взять и что делать при опоздании', async () => {
  withAgent();
  const { text } = await confirmedCard('ru');
  const lines = text.split('\n');
  assert.equal(lines[0], '✅ Просмотр подтверждён');
  assert.ok(lines.includes('👨‍💼 Вас встретит: Ольга Корниленко'), text);
  assert.ok(lines.includes('☎️ Телефон: +34 600 111 222'), text);
  assert.ok(lines.includes('🪪 Возьмите с собой документ, удостоверяющий личность.'), text);
  assert.ok(lines.some((line) => /^⏳ Задерживаетесь\?/.test(line)), 'что делать при опоздании');
  // Порядок: сначала где и когда, потом встреча, в конце — «если планы изменятся».
  assert.ok(text.indexOf('📍 Адрес') < text.indexOf('Вас встретит'), 'адрес раньше строки о встрече');
  assert.ok(text.indexOf('🪪') < text.indexOf('Если планы изменятся'), 'подсказки раньше финальной строки');
});

test('фото агента уходит перед карточкой, с именем в подписи', async () => {
  withAgent();
  const { messages } = await confirmedCard('ru');
  assert.deepEqual(messages.map((call) => call.method), ['sendPhoto', 'sendMessage'], 'фото — раньше текста');
  assert.equal(messages[0].body.caption, '👨‍💼 Ольга Корниленко');
});

test('карта — кнопкой «Как добраться», рядом «Мои заявки»', async () => {
  withAgent();
  const { markup } = await confirmedCard('ru');
  assert.deepEqual(markup.inline_keyboard.flat().map((button) => button.url || button.callback_data), ['https://maps.example.com/villa', 'myreq:list']);
});

test('без имени, телефона и фото — только общие подсказки, фото не шлётся', async () => {
  const { messages, text } = await confirmedCard('ru');
  assert.deepEqual(messages.map((call) => call.method), ['sendMessage']);
  assert.ok(!/Вас встретит|Телефон:/.test(text), 'незаполненного нет: ' + text);
  assert.match(text, /🪪 Возьмите с собой документ/);
  assert.match(text, /⏳ Задерживаетесь\?/);
});

test('на английском и испанском — те же строки на языке клиента', async () => {
  withAgent();
  const en = (await confirmedCard('en')).text;
  assert.match(en, /👨‍💼 Meeting you: Ольга Корниленко/);
  assert.match(en, /☎️ Phone: \+34 600 111 222/);
  assert.match(en, /🪪 Bring a photo ID with you\./);
  assert.match(en, /⏳ Running late\?/);
  const es = (await confirmedCard('es')).text;
  assert.match(es, /👨‍💼 Te recibe: Ольга Корниленко/);
  assert.match(es, /☎️ Teléfono: \+34 600 111 222/);
  assert.match(es, /🪪 Lleva un documento de identidad\./);
  assert.match(es, /⏳ ¿Llegas tarde\?/);
});

test('онлайн-показ: приезжать не нужно — ни паспорта, ни «опаздываете», ни фото', async () => {
  withAgent();
  const { messages, text } = await confirmedCard('ru', { online: true });
  assert.deepEqual(messages.map((call) => call.method), ['sendMessage'], 'фото не шлём');
  assert.match(text, /Онлайн-показ по видеосвязи/);
  assert.ok(!/🪪|⏳|Вас встретит/.test(text), text);
});

test('не вышло отправить фото — карточка всё равно приходит', async () => {
  withAgent();
  const original = global.fetch;
  global.fetch = (url, init) => (String(url).endsWith('/sendPhoto') ? Promise.reject(new Error('Telegram не принял фото')) : original(url, init));
  try {
    const { messages, text } = await confirmedCard('ru');
    assert.ok(messages.some((call) => call.method === 'sendMessage'), 'карточка пришла');
    assert.match(text, /Вас встретит/);
  } finally {
    global.fetch = original;
  }
});
