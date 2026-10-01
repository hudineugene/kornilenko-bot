'use strict';

// Office hours: the client hears when the manager will answer, admin
// reminders wait for office hours, the digest comes at the start of the day.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, createChat, resetData, adminMessages, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const WEEKDAYS = { days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00' };
// 2026-09-18 is a Friday.
const FRIDAY_EVENING = new Date(2026, 8, 18, 20, 0);
const MONDAY_EARLY = new Date(2026, 8, 21, 8, 0);
const TUESDAY_NIGHT = new Date(2026, 8, 22, 22, 30);
const MONDAY_LUNCH = new Date(2026, 8, 21, 13, 0);

function setHours(hours) {
  bot.getData().config.workingHours = { enabled: true, ...hours };
}

test.beforeEach(() => resetData());
test.after(cleanup);

test('the next opening is said in the client\'s language', () => {
  setHours(WEEKDAYS);
  assert.equal(bot.offHoursNote('ru', FRIDAY_EVENING), 'Сейчас нерабочее время — менеджер ответит в понедельник с 9:00. Ваше сообщение сохранено.');
  assert.equal(bot.offHoursNote('ru', MONDAY_EARLY), 'Сейчас нерабочее время — менеджер ответит сегодня с 9:00. Ваше сообщение сохранено.');
  assert.equal(bot.offHoursNote('en', TUESDAY_NIGHT), 'Our office is closed now — a manager will reply tomorrow from 9:00. Your message is saved.');
  assert.equal(bot.offHoursNote('es', FRIDAY_EVENING), 'Ahora estamos fuera de horario: un gestor responderá el lunes a partir de las 9:00. Tu mensaje está guardado.');
  assert.equal(bot.offHoursNote('ru', MONDAY_LUNCH), '', 'nothing during office hours');
  bot.getData().config.workingHours.enabled = false;
  assert.equal(bot.offHoursNote('ru', FRIDAY_EVENING), '', 'nothing while office hours are off');
});

test('the promised reply time is said in the client\'s language and only in office hours', () => {
  setHours({ ...WEEKDAYS, replyMinutes: 15 });
  assert.equal(bot.replyPromise('ru', MONDAY_LUNCH), 'Обычно отвечаем за 15 минут.');
  assert.equal(bot.replyPromise('en', MONDAY_LUNCH), 'We usually reply within 15 minutes.');
  assert.equal(bot.replyPromise('es', MONDAY_LUNCH), 'Solemos responder en 15 minutos.');
  assert.equal(bot.replyPromise('ru', FRIDAY_EVENING), '', 'вне рабочего времени обещать нечего');

  setHours({ ...WEEKDAYS, replyMinutes: 60 });
  assert.equal(bot.replyPromise('ru', MONDAY_LUNCH), 'Обычно отвечаем в течение часа.');
  setHours({ ...WEEKDAYS, replyMinutes: 120 });
  assert.equal(bot.replyPromise('ru', MONDAY_LUNCH), 'Обычно отвечаем в течение 2 часов.');
  setHours({ ...WEEKDAYS, replyMinutes: 0 });
  assert.equal(bot.replyPromise('ru', MONDAY_LUNCH), '', 'по умолчанию ничего не обещаем');

  // Без рабочих часов обещание действует всегда.
  bot.getData().config.workingHours = { enabled: false, replyMinutes: 30 };
  assert.equal(bot.replyPromise('ru', FRIDAY_EVENING), 'Обычно отвечаем за 30 минут.');
});

test('the client sees the promise after a request and on the contact screen', async () => {
  const today = new Date().getDay();
  setHours({ days: [today], from: '00:00', to: '23:59', replyMinutes: 15 });
  const chat = createChat();
  await chat.press('contact:lead');
  await chat.press('lead:call');
  await chat.say('+34 600 000 000');
  const sent = await chat.say(bot.text.lead.ru.timeOptions[2]);
  assert.ok(sent.last.text.endsWith('⏱ Обычно отвечаем за 15 минут.'), sent.last.text);

  const contacts = await chat.say(bot.text.menuLabels.ru.contacts);
  assert.match(contacts.last.text, /⏱ Обычно отвечаем за 15 минут\./);
});

test('a client writing outside office hours is told when to expect an answer', async () => {
  const tomorrow = (new Date().getDay() + 1) % 7;
  setHours({ days: [tomorrow], from: '09:00', to: '19:00' });
  const chat = createChat();
  let step = await chat.say('Здравствуйте, есть ли квартиры в Малаге?');
  assert.match(step.last.text, /\n\n🌙 Сейчас нерабочее время — менеджер ответит завтра с 9:00\. Ваше сообщение сохранено\.$/);

  await chat.press('contact:lead');

  step = await chat.press('lead:call');
  await chat.say('+34 600 000 000');
  step = await chat.say(bot.text.lead.ru.timeOptions[2]);
  assert.ok(step.last.text.startsWith(bot.text.lead.ru.success + '\n\n'));
  assert.match(step.last.text, /\n\n🌙 /, 'после «спасибо» — часы работы и пометка о нерабочем времени');
});

test('during office hours the answer is as before', async () => {
  setHours({ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' });
  const now = new Date();
  if (now.getHours() === 23 && now.getMinutes() === 59) return;
  const step = await createChat().say('Добрый день');
  assert.ok(!step.last.text.includes('🌙'));
});

test('admin reminders wait for office hours; the digest comes at opening time', async () => {
  resetData((data) => {
    data.config.reminderHours = 1;
    data.config.workingHours = { enabled: true, days: [1, 2, 3, 4, 5], from: '10:00', to: '18:00' };
  });
  const chat = createChat();
  await chat.say('Вопрос в пятницу вечером');
  const inquiry = chat.inquiries[0];
  inquiry.createdAt = new Date(2026, 8, 18, 19, 0).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  const saturdayNoon = new Date(2026, 8, 19, 12, 0);
  assert.deepEqual(await bot.runInquiryReminders(saturdayNoon), [], 'the office is closed on Saturday');
  assert.deepEqual(await bot.runInquiryReminders(new Date(2026, 8, 21, 9, 30)), [], 'Monday before opening');
  assert.deepEqual(await bot.runInquiryReminders(new Date(2026, 8, 21, 10, 5)), [inquiry.id]);

  const data = bot.getData();
  data.analytics.daily['2026-09-20'] = { received: 3 };
  telegram.calls = [];
  assert.equal(await bot.runDailyDigest(new Date(2026, 8, 21, 9, 30)), '', 'not before opening');
  assert.match(await bot.runDailyDigest(new Date(2026, 8, 21, 10, 5)), /^📊 Активность за 20\.09\.2026/);
  assert.equal(adminMessages().length, 1);
});

test('the panel saves office hours and checks them', async () => {
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const save = (body) => fetch(base + '/api/working-hours', { method: 'PUT', headers, body: JSON.stringify(body) });

    assert.equal((await save({ enabled: true, days: [1], from: '19:00', to: '09:00' })).status, 400, 'the end before the start');
    assert.equal((await save({ enabled: true, days: [], from: '09:00', to: '19:00' })).status, 400, 'no working days');
    assert.equal((await save({ enabled: true, days: [1], from: '9:00', to: '19:00' })).status, 400, 'not HH:MM');
    assert.equal((await save({ enabled: true, days: [1], from: '09:00', to: '19:00', note: { ru: 'Мы закрыты' } })).status, 400, 'the text needs {next}');
    assert.equal((await save({ enabled: true, days: [1], from: '09:00', to: '19:00', timeZone: 'Wrong/Zone' })).status, 400, 'unknown time zone');

    const response = await save({ enabled: true, days: [1, 2, 3, 4, 5, 9], from: '09:30', to: '18:00', timeZone: 'Atlantic/Canary', note: { ru: 'Ответим {next}.', en: '', es: '' } });
    assert.equal(response.status, 200);
    const state = await (await fetch(base + '/api/state', { headers })).json();
    assert.deepEqual(state.config.workingHours.days, [1, 2, 3, 4, 5], 'unknown days are dropped');
    assert.equal(state.config.workingHours.note.ru, 'Ответим {next}.');
    assert.match(state.config.workingHours.note.en, /\{next\}/, 'an empty text falls back to the default');
    assert.equal(state.config.timeZone, 'Atlantic/Canary');
    assert.equal(process.env.TZ, 'Atlantic/Canary', 'the scheduler switches immediately to the company time zone');
    assert.equal(bot.offHoursNote('ru', FRIDAY_EVENING), 'Ответим в понедельник с 9:30.');

    const slots = (body) => fetch(base + '/api/viewing-slots', { method: 'PUT', headers, body: JSON.stringify(body) });
    assert.equal((await slots({ enabled: true, days: [1], times: '10:00, 9:00', daysAhead: 7, perSlot: 1 })).status, 400, 'a wrong time');
    assert.equal((await slots({ enabled: true, days: [], times: '10:00', daysAhead: 7, perSlot: 1 })).status, 400, 'no days');
    assert.equal((await slots({ enabled: true, days: [1], times: '10:00', daysAhead: 60, perSlot: 1 })).status, 400, 'too far ahead');
    assert.equal((await slots({ enabled: true, days: [1, 3], times: '16:00, 10:00 12:00', daysAhead: 14, perSlot: 2 })).status, 200);
    assert.deepEqual(bot.getData().config.viewingSlots, { enabled: true, days: [1, 3], times: ['10:00', '12:00', '16:00'], daysAhead: 14, perSlot: 2 });
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});
