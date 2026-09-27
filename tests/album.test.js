'use strict';

// Альбом Telegram присылает отдельными сообщениями. Раньше каждое фото
// проходило весь путь: своё уведомление менеджеру и свой ответ клиенту.
// Альбом из десяти снимков — больше двадцати сообщений подряд, и Telegram
// начинал их отбрасывать: клиент переставал получать ответы вовсе.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, ADMIN_CHAT, createChat, resetData, cleanup } = require('./helpers/chat');

const TOKEN = '12345:ABCDEFGHIJKLMNOPQRSTUV';
let updateId = 90000;
let messageId = 900;

function photo(chat, extra = {}) {
  messageId += 1;
  return {
    update_id: updateId += 1,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      from: { id: chat.id, first_name: 'Анна', language_code: 'ru' },
      chat: { id: chat.id, type: 'private' },
      photo: [{ file_id: 'photo-' + messageId, file_unique_id: 'u' + messageId, width: 1280, height: 960 }],
      ...extra,
    },
  };
}

// Альбом собирается по паузе между частями, поэтому ждём чуть дольше окна.
const albumSettled = () => new Promise((resolve) => setTimeout(resolve, 3000));

const toClient = (chat) => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
const toAdmin = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(ADMIN_CHAT));

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = ADMIN_CHAT;
}));
test.after(cleanup);

test('альбом из пяти фотографий — одно обращение и одно уведомление', async () => {
  const chat = createChat();
  telegram.calls = [];
  const group = 'album-1';
  await bot.processUpdates([photo(chat, { media_group_id: group, caption: 'Вот наш дом' })], TOKEN);
  for (let index = 0; index < 4; index += 1) {
    await bot.processUpdates([photo(chat, { media_group_id: group })], TOKEN);
  }
  assert.equal(chat.inquiries.length, 0, 'пока части летят, бот ничего не делает');
  await albumSettled();

  assert.equal(chat.inquiries.length, 1, 'альбом — одно обращение');
  const inquiry = chat.inquiries[0];
  assert.match(inquiry.text, /Альбом, фотографий: 5/);
  assert.match(inquiry.text, /Вот наш дом/, 'подпись из альбома сохранена');
  assert.equal(toClient(chat).length, 1, 'клиент получил один ответ, а не пять');
  assert.equal(toAdmin().length, 1, 'менеджеру ушло одно уведомление');

  const copies = telegram.calls.filter((call) => call.method === 'copyMessages');
  assert.equal(copies.length, 1, 'фотографии скопированы одним запросом');
  const copiedIds = Array.isArray(copies[0].body.message_ids) ? copies[0].body.message_ids : JSON.parse(copies[0].body.message_ids);
  assert.equal(copiedIds.length, 5, 'скопированы все пять');
  assert.equal(telegram.calls.filter((call) => call.method === 'copyMessage').length, 0, 'по одной больше не копируем');
});

test('одиночное фото работает как раньше', async () => {
  const chat = createChat();
  telegram.calls = [];
  await bot.processUpdates([photo(chat, { caption: 'Одно фото' })], TOKEN);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(chat.inquiries.length, 1);
  assert.equal(chat.inquiries[0].text, 'Одно фото');
  assert.equal(telegram.calls.filter((call) => call.method === 'copyMessage').length, 1, 'копируется обычным способом');
  assert.equal(telegram.calls.filter((call) => call.method === 'copyMessages').length, 0);
});

test('два альбома подряд остаются двумя сообщениями, а не двадцатью', async () => {
  const chat = createChat();
  telegram.calls = [];
  for (const group of ['album-2', 'album-3']) {
    for (let index = 0; index < 10; index += 1) {
      await bot.processUpdates([photo(chat, { media_group_id: group, caption: index ? '' : 'Альбом ' + group })], TOKEN);
    }
    await albumSettled();
  }
  assert.equal(chat.inquiries.length, 1, 'сообщения подряд собираются в одно обращение');
  assert.equal(toClient(chat).length, 1, 'клиент услышал ответ один раз: второе сообщение подряд не подтверждается заново');
  assert.equal(toAdmin().length, 2, 'менеджеру — по уведомлению на альбом');
  assert.equal(telegram.calls.filter((call) => call.method === 'copyMessages').length, 2, 'по одному запросу на альбом');
});
