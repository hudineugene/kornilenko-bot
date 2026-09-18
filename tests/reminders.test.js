'use strict';

// Reminders about inquiries nobody has answered.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, ADMIN_CHAT, callbacksOf, createChat, adminPress, resetData, adminMessages, telegram, cleanup,
} = require('./helpers/chat');

const HOUR = 60 * 60 * 1000;
// A weekday morning inside the 9:00–21:00 reminder window.
const MORNING = new Date(2026, 8, 18, 10, 0);

function ago(hours, from = MORNING) {
  return new Date(from.getTime() - hours * HOUR).toISOString();
}

// A client message, then its inquiry is moved back in time.
async function inquiryFrom(chat, text, hoursAgo) {
  await chat.say(text);
  const inquiry = chat.inquiries[chat.inquiries.length - 1];
  inquiry.createdAt = ago(hoursAgo);
  inquiry.updatedAt = inquiry.createdAt;
  return inquiry;
}

test.beforeEach(() => resetData((data) => {
  data.config.reminderHours = 2;
}));
test.after(cleanup);

test('an inquiry left unanswered past the threshold is reminded about once', async () => {
  const chat = createChat();
  const inquiry = await inquiryFrom(chat, 'Есть ли квартиры у моря?', 3);
  telegram.calls = [];

  assert.deepEqual(await bot.runInquiryReminders(MORNING), [inquiry.id]);
  const [reminder] = adminMessages();
  assert.equal(reminder.text, [
    '⏰ Нет ответа 3 ч: сообщение',
    '👤 Анна · RU',
    '',
    'Есть ли квартиры у моря?',
    '',
    '↩️ Ответьте на это сообщение — ответ получит клиент.',
  ].join('\n'));
  assert.deepEqual(callbacksOf(reminder.markup), ['inq:in_progress:' + inquiry.id, 'inq:closed:' + inquiry.id]);

  assert.deepEqual(await bot.runInquiryReminders(new Date(MORNING.getTime() + 3 * HOUR)), [], 'not reminded twice');
});

test('fresh, taken, answered and closed inquiries are not reminded about', async () => {
  const fresh = await inquiryFrom(createChat(), 'Только что написал', 1);
  const taken = await inquiryFrom(createChat(), 'Взяли в работу', 5);
  taken.status = 'in_progress';
  const answered = await inquiryFrom(createChat(), 'Уже ответили', 5);
  answered.replies = [{ id: 'r', text: 'Ответ', source: 'panel', createdAt: ago(4) }];
  const closed = await inquiryFrom(createChat(), 'Закрыто', 5);
  closed.status = 'closed';
  const ancient = await inquiryFrom(createChat(), 'Очень старое', 24 * 8);
  assert.deepEqual(await bot.runInquiryReminders(MORNING), []);
  assert.ok(fresh && ancient);
});

test('no reminders at night; the morning check picks them up', async () => {
  const chat = createChat();
  const inquiry = await inquiryFrom(chat, 'Написал вечером', 0);
  inquiry.createdAt = new Date(2026, 8, 17, 22, 30).toISOString();
  assert.deepEqual(await bot.runInquiryReminders(new Date(2026, 8, 18, 3, 0)), []);
  assert.deepEqual(await bot.runInquiryReminders(new Date(2026, 8, 18, 9, 0)), [inquiry.id]);
  assert.match(adminMessages().pop().text, /^⏰ Нет ответа 10 ч/);
});

test('reminders can be turned off', async () => {
  bot.getData().config.reminderHours = 0;
  await inquiryFrom(createChat(), 'Вопрос', 30);
  assert.deepEqual(await bot.runInquiryReminders(MORNING), []);
});

test('a burst is capped: five reminders and one summary', async () => {
  for (let index = 0; index < 8; index += 1) await inquiryFrom(createChat(), 'Вопрос ' + index, 3 + index);
  telegram.calls = [];
  const sent = await bot.runInquiryReminders(MORNING);
  assert.equal(sent.length, 5);
  const texts = adminMessages().map((message) => message.text);
  assert.equal(texts.length, 6);
  assert.equal(texts[5], '⏰ И ещё 3 без ответа — они в панели, раздел «Обращения».');
  assert.match(texts[0], /Вопрос 7/, 'the oldest first');
  assert.deepEqual(await bot.runInquiryReminders(new Date(MORNING.getTime() + HOUR)), [], 'the rest are not repeated');
});

test('replying to a reminder reaches the client', async () => {
  const chat = createChat();
  const inquiry = await inquiryFrom(chat, 'Когда можно посмотреть виллу?', 3);
  telegram.calls = [];
  await bot.runInquiryReminders(MORNING);
  const reminderId = Number(Object.entries(bot.getData().adminReplyTargets).find(([, target]) => target.inquiryId === inquiry.id)[0]);
  telegram.calls = [];
  await bot.handleUpdate({
    update_id: 999001,
    message: {
      message_id: 42,
      date: Math.floor(Date.now() / 1000),
      from: { id: Number(ADMIN_CHAT) },
      chat: { id: Number(ADMIN_CHAT) },
      text: 'Завтра в 11:00 подойдёт?',
      reply_to_message: { message_id: reminderId, from: { id: 5550001 }, date: Math.floor(Date.now() / 1000), text: '⏰ …' },
    },
  }, '12345:ABCDEFGHIJKLMNOPQRSTUV');
  const toClient = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
  assert.equal(toClient.length, 1);
  assert.match(toClient[0].body.text, /Завтра в 11:00/);
  assert.equal(inquiry.status, 'in_progress');
});

test('the status buttons under a reminder work', async () => {
  const chat = createChat();
  const inquiry = await inquiryFrom(chat, 'Вопрос', 3);
  await bot.runInquiryReminders(MORNING);
  await adminPress('inq:closed:' + inquiry.id);
  assert.equal(inquiry.status, 'closed');
});

test('the reminder setting is validated and saved', async () => {
  const data = bot.normalizeLoadedData({ version: 15, config: { reminderHours: 5 } });
  assert.equal(data.config.reminderHours, 2, 'unknown values fall back to 2 hours');
  assert.equal(bot.normalizeLoadedData({ version: 15, config: { reminderHours: 0 } }).config.reminderHours, 0);
  assert.equal(bot.normalizeLoadedData({ version: 15 }).config.reminderHours, 2);
});
