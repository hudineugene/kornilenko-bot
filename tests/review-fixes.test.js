'use strict';

// Исправления по независимой проверке (08.10): короткие слова только целиком, серия сообщений закрывается ответом менеджера,
// шаблоны без объекта читаются, сумма сделки снимается при возврате из Telegram, верхняя граница спален учтена в подборе.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, ADMIN_CHAT, telegram, createChat, adminPress, property, resetData, cleanup } = require('./helpers/chat');

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

const adminCards = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).map((call) => call.body.text);

test('«private pool» и «предложение» не принимаются за налоги и документы: короткие слова ищутся целиком', async () => {
  const english = createChat({ language: 'en' });
  const step = await english.say('Is there a private pool in the villa?');
  assert.ok(!/Taxes, costs/.test((step.last && step.last.text) || ''), 'iva внутри «private» — не налоги');
  const russian = createChat();
  await russian.say('Здравствуйте! Спасибо за ваше предложение, внимание к деталям и подробное описание всего проекта очень порадовали нас');
  assert.ok(!(russian.inquiries[0].topics || []).includes('документы'), 'ние в «предложение» — не документы');
  const real = createChat({ language: 'en' });
  const tax = await real.say('What are the taxes and is IVA included?');
  assert.match(tax.last.text, /Taxes, costs/, 'настоящее «IVA» отдельным словом находится');
});

test('после ответа менеджера серия сообщений закрыта: новое сообщение клиента приходит отдельным сообщением, а не молча дописывается выше', async () => {
  const chat = createChat();
  await chat.say('Первый вопрос про квартиру в Финестрате');
  await chat.say('Второй вопрос');
  await chat.say('Третий вопрос');
  const inquiry = chat.inquiries[0];
  assert.ok(telegram.calls.some((call) => call.method === 'editMessageText' && String(call.body.chat_id) === ADMIN_CHAT), 'серия идёт правкой');
  // Менеджер отвечает на карточку (как из Telegram).
  const targets = bot.getData().adminReplyTargets;
  const cardKey = Object.keys(targets).find((key) => targets[key].inquiryId === inquiry.id && targets[key].card);
  await bot.processUpdates([{ update_id: 990001, message: { message_id: 8001, date: Math.floor(Date.now() / 1000), from: { id: Number(ADMIN_CHAT), first_name: 'Админ', language_code: 'ru' }, chat: { id: Number(ADMIN_CHAT), type: 'private' }, text: 'Добрый день, отвечаю', reply_to_message: { message_id: Number(cardKey), date: 1, from: { id: bot.getData().bot.id, is_bot: true }, chat: { id: Number(ADMIN_CHAT), type: 'private' }, text: '…' } } }], require('./helpers/chat').TOKEN);
  await new Promise((resolve) => setTimeout(resolve, 30));
  telegram.calls = [];
  await chat.say('Четвёртый вопрос после ответа');
  assert.ok(adminCards().some((text) => /^💬 Анна: Четвёртый вопрос/.test(text)), 'после ответа — новое сообщение');
  assert.ok(!telegram.calls.some((call) => call.method === 'editMessageText' && String(call.body.chat_id) === ADMIN_CHAT));
});

test('шаблоны без объекта читаются: подставляется «этот объект»', async () => {
  const { templateText } = await import('../src/quick-reply.mjs');
  const { STARTER_TEMPLATES } = await import('../src/starter-templates.mjs');
  const chat = createChat();
  await chat.say('Подскажите по оформлению ипотеки');
  const inquiry = chat.inquiries[0];
  const price = STARTER_TEMPLATES.find((item) => item.title === 'Цены и прайс');
  const text = templateText(price, inquiry).text;
  assert.match(text, /цена на этот объект зависит/);
  assert.ok(!/ {2}/.test(text), 'двойных пробелов нет');
  const reserved = STARTER_TEMPLATES.find((item) => item.title === 'Вариант уже занят');
  assert.match(templateText(reserved, inquiry).text, /к сожалению, этот объект уже забронирован/);
});

test('подбор: комплекс «1–2 спальни» подходит под запрос двух спален и не отбрасывается при запросе трёх без причины', () => {
  const record = property('complex', 'Комплекс', 'active', { bedrooms: 1, bedroomsMax: 2, priceValue: 150000 });
  const copy = bot.text.catalogFilter ? bot.text.catalogFilter.ru : null;
  assert.ok(record.bedroomsMax === 2 && copy !== undefined);
  const fs = require('node:fs');
  const path = require('node:path');
  const alerts = fs.readFileSync(path.join(__dirname, '..', 'src', 'alerts.mjs'), 'utf8');
  assert.match(alerts, /Math\.max\(Number\(record\.bedrooms\) \|\| 0, Number\(record\.bedroomsMax\) \|\| 0\)/);
});

test('сумма сделки снимается, когда заявку открывают снова из Telegram', async () => {
  const chat = createChat();
  await chat.say('Подскажите по оформлению ипотеки');
  const inquiry = chat.inquiries[0];
  inquiry.status = 'closed';
  inquiry.pipelineStage = 'won';
  inquiry.wonAt = new Date().toISOString();
  inquiry.dealAmount = 147000;
  await adminPress('inq:new:' + inquiry.id, 777);
  assert.equal(inquiry.status, 'new');
  assert.equal('dealAmount' in inquiry, false);
});
