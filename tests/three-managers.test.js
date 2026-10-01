'use strict';

// Проба «три менеджера» из аудита 01.10 (этап 52): одна заявка приходит сразу в три чата — владельцу и двум менеджерам.
// Что бы ни нажал любой из них, карточка в КАЖДОМ из трёх чатов должна показывать одну и ту же строку состояния:
// иначе один думает, что клиента ведёт Мария, а другой — что он «ждёт ответа».

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, TOKEN, ADMIN_CHAT, createChat, resetData, settle, cleanup } = require('./helpers/chat');

const MARIA = '8880001';
const IVAN = '8880002';
const CHATS = [ADMIN_CHAT, MARIA, IVAN];
let counter = 700;

test.before(() => resetData((data) => {
  data.config.adminName = 'Олег';
  data.config.managers = [
    { id: 'm1', name: 'Мария', chatId: MARIA, verifiedAt: '' },
    { id: 'm2', name: 'Иван', chatId: IVAN, verifiedAt: '' },
  ];
}));
test.after(cleanup);

async function press(chatId, data, messageId) {
  counter += 1;
  await bot.processUpdates([{ update_id: 950000 + counter, callback_query: { id: 'cb' + counter, from: { id: Number(chatId), first_name: 'Staff' }, data, message: { message_id: messageId, chat: { id: Number(chatId), type: 'private' }, date: 1 } } }], TOKEN);
  await settle();
}

// Менеджер отвечает клиенту ответом на карточку — так бот понимает, кому адресован текст.
async function reply(chatId, text, messageId) {
  counter += 1;
  const chat = { id: Number(chatId), type: 'private' };
  const date = Math.floor(Date.now() / 1000);
  await bot.processUpdates([{ update_id: 960000 + counter, message: { message_id: 5000 + counter, date, from: { id: Number(chatId), first_name: 'Staff', language_code: 'ru' }, chat, text, reply_to_message: { message_id: messageId, date, from: { id: bot.getData().bot.id, is_bot: true }, chat, text: '…' } } }], TOKEN);
  await settle();
}

// Номер сообщения-карточки в чате сотрудника: на нём стоит ответ и кнопки.
function cardOf(chatId, inquiryId) {
  const targets = Object.entries(bot.getData().adminReplyTargets).filter(([, target]) => target.inquiryId === inquiryId);
  const own = targets.find(([key]) => (String(chatId) === ADMIN_CHAT ? !key.includes(':') : key.startsWith(chatId + ':')));
  return Number(own[0].split(':').pop());
}

// Последний текст карточки в каждом чате — по правкам и по первой отправке.
function lastTexts(since) {
  const out = {};
  for (const call of telegram.calls.slice(since)) {
    if (call.method !== 'editMessageText' && call.method !== 'sendMessage') continue;
    const chat = String(call.body.chat_id);
    if (CHATS.includes(chat)) out[chat] = call.body.text;
  }
  return out;
}
const stateLine = (text) => String(text).trim().split('\n').pop();

test('заявка приходит во все три чата одним и тем же текстом и с теми же кнопками', async () => {
  const anna = createChat({ firstName: 'Анна' });
  const before = telegram.calls.length;
  await anna.say('Подскажите по оформлению ипотеки');
  const sent = telegram.calls.slice(before).filter((call) => call.method === 'sendMessage' && CHATS.includes(String(call.body.chat_id)));
  assert.deepEqual(sent.map((call) => String(call.body.chat_id)).sort(), [...CHATS].sort(), 'по одному сообщению в каждый из трёх чатов');
  assert.equal(new Set(sent.map((call) => call.body.text)).size, 1, 'текст один и тот же');
  assert.equal(new Set(sent.map((call) => JSON.stringify(call.body.reply_markup))).size, 1, 'кнопки одни и те же');
});

test('Мария взяла заявку «В работу» — в трёх чатах одна строка «Ведёт: Мария»', async () => {
  const inquiry = bot.getData().inquiries[0];
  const before = telegram.calls.length;
  await press(MARIA, 'inq:in_progress:' + inquiry.id, cardOf(MARIA, inquiry.id));
  const texts = lastTexts(before);
  assert.deepEqual(Object.keys(texts).sort(), [...CHATS].sort(), 'карточка обновилась у всех троих, а не только у нажавшей');
  const lines = new Set(Object.values(texts).map(stateLine));
  assert.equal(lines.size, 1, 'строка состояния одинакова: ' + [...lines].join(' | '));
  assert.match([...lines][0], /Ведёт: Мария/);
  assert.equal(new Set(Object.values(texts)).size, 1, 'и весь текст карточки тоже');
});

test('Мария ответила клиенту — во всех трёх чатах одна и та же строка состояния', async () => {
  const inquiry = bot.getData().inquiries[0];
  const before = telegram.calls.length;
  await reply(MARIA, 'Здравствуйте! Какой бюджет рассматриваете?', cardOf(MARIA, inquiry.id));
  const texts = lastTexts(before);
  assert.ok(Object.keys(texts).length >= 1, 'карточка обновилась');
  const lines = new Set(Object.values(texts).map(stateLine));
  assert.equal(lines.size, 1, 'строка состояния одинакова во всех обновлённых чатах: ' + [...lines].join(' | '));
  assert.equal(Object.keys(texts).length, CHATS.length, 'обновились все три чата');
});

test('Иван закрыл заявку своей кнопкой — у всех троих «Закрыта», и у Марии не остаётся «Ведёт: Мария»', async () => {
  const inquiry = bot.getData().inquiries[0];
  const before = telegram.calls.length;
  await press(IVAN, 'inq:closed:' + inquiry.id, cardOf(IVAN, inquiry.id));
  const texts = lastTexts(before);
  assert.deepEqual(Object.keys(texts).sort(), [...CHATS].sort());
  const lines = new Set(Object.values(texts).map(stateLine));
  assert.equal(lines.size, 1, 'строка состояния одинакова: ' + [...lines].join(' | '));
  assert.match([...lines][0], /Закрыта/);
  for (const text of Object.values(texts)) assert.ok(!/Ведёт: Мария/.test(text));
});

test('без правок «чужие» карточки не расходятся: у каждого чата в записи ответов есть своя карточка с номером сообщения', () => {
  const inquiry = bot.getData().inquiries[0];
  for (const chat of CHATS) assert.ok(cardOf(chat, inquiry.id) > 0, 'у чата ' + chat + ' нет записи карточки');
});
