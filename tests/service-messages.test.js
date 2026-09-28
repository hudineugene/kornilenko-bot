'use strict';

// Telegram присылает служебные события как сообщения в чате: клиент закрепил
// сообщение, включил таймер автоудаления, поделился контактом через кнопку.
// Раньше бот заводил из такого обращение «Нетекстовое сообщение» — менеджер
// получал уведомление о том, чего клиент не писал, и отвечал в пустоту.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, TOKEN, ADMIN_CHAT, createChat, property, resetData, settle, cleanup } = require('./helpers/chat');

let serviceMessageId = 500;

// Служебное событие в личной переписке с клиентом.
async function clientService(chat, extra) {
  serviceMessageId += 1;
  const before = telegram.calls.length;
  await bot.processUpdates([{
    update_id: 800000 + serviceMessageId,
    message: {
      message_id: serviceMessageId,
      date: Math.floor(Date.now() / 1000),
      from: { id: chat.id, first_name: 'Клиент', language_code: 'ru' },
      chat: { id: chat.id, type: 'private' },
      ...extra,
    },
  }], TOKEN);
  await settle();
  return telegram.calls.slice(before);
}

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = ADMIN_CHAT;
  data.objects.push(property('villa-01', 'Вилла', 'active'));
}));
test.after(cleanup);

test('закреплённое сообщение не становится обращением', async () => {
  const chat = createChat();
  await chat.say('/start');
  const inquiriesBefore = bot.getData().inquiries.length;
  const receivedBefore = bot.getData().stats.messagesReceived;

  const calls = await clientService(chat, {
    pinned_message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: chat.id, type: 'private' }, text: 'Каталог' },
  });

  assert.equal(calls.filter((call) => call.method.startsWith('send')).length, 0, 'бот ничего не отправил');
  assert.equal(bot.getData().inquiries.length, inquiriesBefore, 'обращения не появилось');
  assert.equal(bot.getData().stats.messagesReceived, receivedBefore, 'и в счётчик сообщений это не попало');
});

test('другие служебные события в личке тоже не тревожат менеджера', async () => {
  const chat = createChat();
  await chat.say('/start');
  const inquiriesBefore = bot.getData().inquiries.length;

  for (const extra of [
    { message_auto_delete_timer_changed: { message_auto_delete_time: 86400 } },
    { write_access_allowed: { web_app_name: 'calculator' } },
    { users_shared: { request_id: 1, users: [{ user_id: 777 }] } },
    { boost_added: { boost_count: 1 } },
  ]) {
    const calls = await clientService(chat, extra);
    assert.equal(calls.filter((call) => call.method.startsWith('send')).length, 0, Object.keys(extra)[0] + ': бот промолчал');
  }
  assert.equal(bot.getData().inquiries.length, inquiriesBefore, 'ни одного обращения не завелось');
});

test('настоящее вложение по-прежнему доходит до менеджера', async () => {
  // Обратная сторона: новый вид вложения лучше показать менеджеру как
  // «нетекстовое сообщение», чем молча выбросить.
  const chat = createChat();
  await chat.say('/start');

  const calls = await clientService(chat, { sticker: { file_id: 'sticker-1', file_unique_id: 'u1', width: 512, height: 512, is_animated: false, is_video: false } });
  const toAdmin = calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT);
  assert.equal(toAdmin.length, 1, 'менеджер узнал о сообщении клиента');
  assert.equal(bot.getData().inquiries.length, 1, 'и обращение появилось');
  assert.match(bot.getData().inquiries[0].text, /Стикер/);
});
