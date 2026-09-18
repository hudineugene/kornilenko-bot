'use strict';

// "Notifications": the client chooses what to receive, and every broadcast
// has an unsubscribe button.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, callbacksOf, createChat, resetData, adminMessages, cleanup } = require('./helpers/chat');

const broadcast = { messages: { ru: 'Новые виллы в Марбелье!', en: 'New villas!', es: '¡Villas nuevas!' }, languages: [], tags: [], buttonText: { ru: 'Смотреть', en: 'See', es: 'Ver' }, buttonUrl: 'https://example.com/villas' };

test.beforeEach(() => resetData((data) => {
  data.config.notifyMode = 'all';
}));
test.after(cleanup);

test('"More" opens the settings, and each item turns on and off', async () => {
  const chat = createChat();
  const more = await chat.say(bot.text.menu.ru.more);
  assert.ok(callbacksOf(more.last.markup).includes('subs:menu'));

  let step = await chat.press('subs:menu');
  assert.match(step.last.text, /^🔔 Какие сообщения присылать\?/);
  assert.deepEqual(step.last.buttons, ['✅ Новости и акции', '✅ Объекты: снижение цены и новые по вашему запросу', '🏠 Главное меню']);
  assert.deepEqual(callbacksOf(step.last.markup), ['subs:news:off', 'subs:alerts:off', 'nav:menu']);

  step = await chat.press('subs:news:off');
  assert.equal(chat.user.broadcastsOptOut, true);
  let edit = step.calls.find((call) => call.method === 'editMessageText');
  assert.deepEqual(callbacksOf(edit.body.reply_markup), ['subs:news:on', 'subs:alerts:off', 'nav:menu']);
  assert.equal(edit.body.reply_markup.inline_keyboard[0][0].text, '⬜ Новости и акции');

  step = await chat.press('subs:alerts:off');
  assert.equal(chat.user.propertyAlerts, false);
  step = await chat.press('subs:alerts:on');
  assert.equal(chat.user.propertyAlerts, true);
  step = await chat.press('subs:news:on');
  assert.equal(chat.user.broadcastsOptOut, false);
  edit = step.calls.find((call) => call.method === 'editMessageText');
  assert.deepEqual(callbacksOf(edit.body.reply_markup), ['subs:news:off', 'subs:alerts:off', 'nav:menu']);
  assert.ok(adminMessages().some((message) => message.text.startsWith('👀 Отписался от рассылок')));
});

test('every broadcast has an unsubscribe button; unsubscribed clients get no more', async () => {
  const reader = createChat();
  const leaving = createChat();
  telegram.calls = [];
  await bot.deliverBroadcast(leaving.user, broadcast);
  const sent = telegram.calls.find((call) => call.method === 'sendMessage');
  assert.deepEqual(sent.body.reply_markup.inline_keyboard.flat().map((button) => button.url || button.callback_data), ['https://example.com/villas', 'subs:news:off:bc']);
  assert.equal(sent.body.reply_markup.inline_keyboard[1][0].text, '🔕 Отписаться от рассылок');

  const step = await leaving.press('subs:news:off:bc');
  assert.match(step.last.text, /^Вы отписались от рассылок/);
  assert.deepEqual(callbacksOf(step.last.markup), ['subs:news:on:undo']);
  assert.ok(!step.calls.some((call) => call.method === 'editMessageText'), 'the broadcast itself is left as it was');
  assert.deepEqual(bot.broadcastUsers({ languages: [], tags: [] }).map((user) => user.id), [String(reader.id)]);

  const undo = await leaving.press('subs:news:on:undo');
  assert.deepEqual(undo.popups, ['Рассылки снова включены.']);
  assert.equal(leaving.user.broadcastsOptOut, false);
  assert.equal(bot.broadcastUsers({ languages: [], tags: [] }).length, 2);
});

test('a broadcast counts who responded, sent a request or unsubscribed within three days', async () => {
  const interested = createChat();
  const leaving = createChat();
  const silent = createChat();
  const entry = { id: 'bc-news-1', ...broadcast, status: 'queued', createdAt: new Date().toISOString() };
  bot.getData().broadcasts.unshift(entry);
  await bot.runBroadcast(entry);
  assert.equal(entry.sent, 3);
  assert.equal(interested.user.lastBroadcast.id, 'bc-news-1');

  await interested.say('Расскажите подробнее про виллы');
  await interested.say('И про цены');
  await leaving.press('subs:news:off:bc');
  assert.deepEqual(entry.respondedUserIds, [String(interested.id)], 'each person once; unsubscribing is not a response');
  assert.deepEqual(entry.inquiryUserIds, [String(interested.id)]);
  assert.deepEqual(entry.unsubscribedUserIds, [String(leaving.id)]);

  silent.user.lastBroadcast.at = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  await silent.say('Добрый день');
  assert.ok(!entry.respondedUserIds.includes(String(silent.id)), 'too late to count');

  const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
  assert.deepEqual(reloaded.broadcasts[0].respondedUserIds, [String(interested.id)], 'kept after a restart');
});

test('the setting survives a restart', () => {
  const chat = createChat();
  chat.user.broadcastsOptOut = true;
  const saved = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
  bot.setData(saved);
  assert.equal(bot.userById(String(chat.id)).broadcastsOptOut, true);
});
