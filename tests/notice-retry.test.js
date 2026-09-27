'use strict';

// Разовые уведомления бот помечает отправленными до отправки — чтобы не слать
// одно и то же каждые 15 минут. Но если в этот момент пропала связь, отметка
// оставалась, и напоминание не уходило никогда. Временная ошибка (обрыв связи,
// 429, 5xx) должна отметку снимать, а отказ самого клиента — нет.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, ADMIN_CHAT, createChat, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
const { viewing: VIEWING } = bot.text;
const ru = VIEWING.ru;

function dayKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function daysFromNow(days, hour = 12) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}
function at(key, addDays, hour, minute = 0) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day + addDays, hour, minute);
}

// Связь с Telegram пропала: fetch не доходит до сервера. Такая ошибка приходит
// без кода — именно её бот считает временной.
function connectionLost(url) {
  if (String(url).includes('/sendMessage')) return Promise.reject(new TypeError('fetch failed'));
  return telegramStub(url);
}
// Клиент заблокировал бота: отказ навсегда, повторять нечего.
function clientBlocked(url, init) {
  if (String(url).includes('/sendMessage')) {
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));
  }
  return telegramStub(url, init);
}

async function withTelegram(behaviour, run) {
  global.fetch = behaviour;
  try {
    return await run();
  } finally {
    global.fetch = telegramStub;
  }
}

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('villa-retry-01', 'Вилла для проверки', 'active', { priceValue: 500000 }));
}));
test.after(cleanup);

async function confirmedViewing(chat, days = 2) {
  await chat.press('property:viewing:villa-retry-01');
  await chat.say(ru.dateOptions[1]);
  await chat.say(ru.timeOptions[1]);
  await chat.say(ru.confirm);
  const inquiry = chat.inquiries[chat.inquiries.length - 1];
  inquiry.viewing.confirmedAt = daysFromNow(-1).toISOString();
  inquiry.viewing.confirmedDate = dayKey(daysFromNow(days));
  inquiry.viewing.confirmedTime = '11:00';
  inquiry.status = 'in_progress';
  return inquiry;
}

test.describe('напоминание о просмотре', () => {
  test('обрыв связи — напоминание уходит со следующей проверкой', async () => {
    const chat = createChat();
    const inquiry = await confirmedViewing(chat);
    const date = inquiry.viewing.confirmedDate;

    const lost = await withTelegram(connectionLost, () => bot.runViewingNotices(at(date, -1, 18, 15)));
    assert.deepEqual(lost.reminders, [], 'сейчас отправить не вышло');
    assert.ok(!inquiry.viewing.remindedAt, 'отметка снята — напоминание ещё должно уйти');

    telegram.calls = [];
    const again = await bot.runViewingNotices(at(date, -1, 18, 30));
    assert.deepEqual(again.reminders, [inquiry.id], 'связь вернулась — напоминание ушло');
    assert.ok(inquiry.viewing.remindedAt, 'теперь отмечено отправленным');
    assert.deepEqual((await bot.runViewingNotices(at(date, -1, 19))).reminders, [], 'и второй раз не уходит');
  });

  test('клиент заблокировал бота — повторять нечего', async () => {
    const chat = createChat();
    const inquiry = await confirmedViewing(chat);
    const date = inquiry.viewing.confirmedDate;

    const result = await withTelegram(clientBlocked, () => bot.runViewingNotices(at(date, -1, 18, 15)));
    assert.deepEqual(result.reminders, []);
    assert.ok(inquiry.viewing.remindedAt, 'отметка остаётся: слать этому клиенту больше некуда');
    assert.deepEqual((await bot.runViewingNotices(at(date, -1, 19))).reminders, [], 'бот не долбится каждые 15 минут');
  });

  test('вопрос после просмотра тоже повторяется после обрыва', async () => {
    const chat = createChat();
    const inquiry = await confirmedViewing(chat);
    inquiry.viewing.remindedAt = new Date().toISOString();
    const date = inquiry.viewing.confirmedDate;

    const lost = await withTelegram(connectionLost, () => bot.runViewingNotices(at(date, 1, 10, 30)));
    assert.deepEqual(lost.feedback, []);
    assert.ok(!inquiry.viewing.feedbackAskedAt, 'отметка снята');
    assert.deepEqual((await bot.runViewingNotices(at(date, 1, 11))).feedback, [inquiry.id], 'вопрос ушёл позже');
  });
});

test.describe('напоминание о незаконченной форме', () => {
  // Днём, через три часа после того, как клиент замолчал посреди формы.
  const daytime = new Date();
  daytime.setHours(12, 0, 0, 0);

  async function startedForm(chat) {
    await chat.press('property:viewing:villa-retry-01');
    const user = bot.getData().users[String(chat.id)];
    user.pendingAction.createdAt = new Date(daytime.getTime() - 3 * 60 * 60 * 1000).toISOString();
    user.lastSeenAt = user.pendingAction.createdAt;
    return user;
  }

  test('обрыв связи — напомним при следующей проверке', async () => {
    const user = await startedForm(createChat());

    const lost = await withTelegram(connectionLost, () => bot.runFormReminders(daytime));
    assert.deepEqual(lost, [], 'сейчас не отправилось');
    assert.ok(!user.pendingAction.remindedAt, 'отметка снята');
    assert.deepEqual(await bot.runFormReminders(daytime), [user.id], 'напоминание ушло позже');
    assert.deepEqual(await bot.runFormReminders(daytime), [], 'и только один раз');
  });

  test('клиент заблокировал бота — второй попытки нет', async () => {
    const user = await startedForm(createChat());
    await withTelegram(clientBlocked, () => bot.runFormReminders(daytime));
    assert.ok(user.pendingAction.remindedAt, 'отметка остаётся');
    assert.deepEqual(await bot.runFormReminders(daytime), []);
  });
});

test.describe('сообщения владельцу', () => {
  test('сводка за день повторяется, если связи не было', async () => {
    const data = bot.getData();
    data.config.notifyMode = 'inquiries';
    data.config.adminChatId = ADMIN_CHAT;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    data.analytics.daily[dayKey(yesterday)] = { received: 3, inquiries: 1, menu: {} };
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);

    await withTelegram(connectionLost, async () => {
      await assert.rejects(() => bot.runDailyDigest(morning), /fetch failed|Telegram/i);
    });
    assert.notEqual(data.lastDigestFor, dayKey(yesterday), 'отметка снята — сводка ещё не доставлена');

    telegram.calls = [];
    const text = await bot.runDailyDigest(morning);
    assert.match(text, /Активность за/);
    assert.equal(data.lastDigestFor, dayKey(yesterday), 'теперь отмечено');
    assert.equal(await bot.runDailyDigest(morning), '', 'дважды не уходит');
  });

  test('итоги недели повторяются, если связи не было', async () => {
    const data = bot.getData();
    data.config.adminChatId = ADMIN_CHAT;
    // Понедельник, утро: время еженедельного отчёта.
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(10, 0, 0, 0);

    await withTelegram(connectionLost, async () => {
      await assert.rejects(() => bot.runWeeklyReport(monday), /fetch failed|Telegram/i);
    });
    assert.notEqual(data.lastWeeklyReportFor, dayKey(monday), 'отметка снята');
    assert.match(await bot.runWeeklyReport(monday), /Итоги недели/, 'отчёт ушёл со следующей проверкой');
    assert.equal(await bot.runWeeklyReport(monday), '', 'и только один раз');
  });
});
