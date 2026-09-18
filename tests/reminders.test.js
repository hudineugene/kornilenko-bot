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
  assert.deepEqual(callbacksOf(reminder.markup), ['inq:in_progress:' + inquiry.id, 'inq:closed:' + inquiry.id, 'inq:follow:' + inquiry.id]);

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

test.describe('follow-ups', () => {
  function dayKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  test('"remind me tomorrow" in the admin chat plans a follow-up', async () => {
    const chat = createChat();
    const inquiry = await inquiryFrom(chat, 'Перезвоните мне', 1);
    const pressed = await adminPress('inq:follow:' + inquiry.id, 555);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(inquiry.followUpDate, dayKey(tomorrow));
    assert.equal(inquiry.status, 'in_progress');
    assert.match(pressed.popups[0], /^Напомню \d\d\.\d\d\.\d{4} в начале рабочего дня$/);
    const edit = pressed.calls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.equal(edit.body.reply_markup.inline_keyboard[1][0].text, '📌 Напомню (' + dayKey(tomorrow).split('-').reverse().slice(0, 2).join('.') + ')');
  });

  test('with office hours set, "tomorrow" is the next working day', async () => {
    bot.getData().config.workingHours = { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
    const inquiry = await inquiryFrom(createChat(), 'Вопрос', 1);
    await adminPress('inq:follow:' + inquiry.id);
    const day = new Date(inquiry.followUpDate + 'T12:00:00');
    assert.ok([1, 2, 3, 4, 5].includes(day.getDay()));
  });

  test('the reminder comes on the day, at the chosen time, once', async () => {
    const chat = createChat();
    chat.user.phone = '+34 600 123 123';
    const inquiry = await inquiryFrom(chat, 'Хочу обсудить ипотеку', 30);
    inquiry.status = 'in_progress';
    inquiry.note = 'Обещал прислать расчёт';
    inquiry.followUpDate = '2026-09-18';
    telegram.calls = [];
    assert.deepEqual(await bot.runFollowUpReminders(new Date(2026, 8, 17, 12, 0)), [], 'not the day before');
    assert.deepEqual(await bot.runFollowUpReminders(new Date(2026, 8, 18, 7, 0)), [], 'not at night');
    assert.deepEqual(await bot.runFollowUpReminders(MORNING), [inquiry.id]);
    const [message] = adminMessages();
    assert.equal(message.text, [
      '📌 Пора связаться с клиентом (18.09): сообщение',
      '👤 Анна · RU · +34 600 123 123',
      '',
      'Хочу обсудить ипотеку',
      '',
      '📝 Обещал прислать расчёт',
      '',
      '↩️ Ответьте на это сообщение — ответ получит клиент.',
    ].join('\n'));
    assert.deepEqual(await bot.runFollowUpReminders(new Date(MORNING.getTime() + HOUR)), [], 'once');

    const timed = await inquiryFrom(createChat(), 'Позвоните после обеда', 30);
    timed.followUpDate = '2026-09-18';
    timed.followUpTime = '15:00';
    assert.deepEqual(await bot.runFollowUpReminders(new Date(2026, 8, 18, 14, 45)), []);
    assert.deepEqual(await bot.runFollowUpReminders(new Date(2026, 8, 18, 15, 0)), [timed.id]);

    const closed = await inquiryFrom(createChat(), 'Уже решили', 30);
    closed.followUpDate = '2026-09-18';
    closed.status = 'closed';
    assert.deepEqual(await bot.runFollowUpReminders(MORNING), []);
  });
});

test('the reminder setting is validated and saved', async () => {
  const data = bot.normalizeLoadedData({ version: 15, config: { reminderHours: 5 } });
  assert.equal(data.config.reminderHours, 2, 'unknown values fall back to 2 hours');
  assert.equal(bot.normalizeLoadedData({ version: 15, config: { reminderHours: 0 } }).config.reminderHours, 0);
  assert.equal(bot.normalizeLoadedData({ version: 15 }).config.reminderHours, 2);
});
