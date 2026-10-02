'use strict';

// Файл календаря (.ics) к подтверждённому просмотру: кнопка «В календарь» под подтверждением, файл с точным временем,
// переносом той же встречи и напоминанием; чужому клиенту и отменённому просмотру файл не выдаётся.

const realFetch = global.fetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, telegram, callbacksOf, createChat, property, resetData, cleanup,
} = require('./helpers/chat');

const { viewing: VIEWING } = bot.text;
const ru = VIEWING.ru;

function dayKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}

const utc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function sentTo(chat) {
  return telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
}

async function requestViewing(chat) {
  await chat.press('property:viewing:villa-marbella-01');
  await chat.say(ru.dateOptions[1]);
  await chat.say(ru.timeOptions[1]);
  await chat.say(ru.confirm);
  return chat.inquiries[chat.inquiries.length - 1];
}

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('villa-marbella-01', 'Вилла в Марбелье', 'active', {
    address: { ru: 'Calle del Mar, 5', en: 'Calle del Mar, 5', es: '' },
    city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
    mapUrl: 'https://maps.example.com/villa',
    dealType: 'sale',
    propertyType: 'villa',
    priceValue: 900000,
  }));
}));
test.after(cleanup);

test('подтверждение просмотра несёт кнопку «В календарь»; по нажатию уходит файл с точным временем, адресом и напоминанием', async () => {
  const chat = createChat();
  const inquiry = await requestViewing(chat);
  const day = dayKey(daysFromNow(3));
  telegram.calls = [];
  await bot.confirmViewing(inquiry, { date: day, time: '17:30', source: 'panel' });
  const confirmation = sentTo(chat).find((call) => /подтверждён/.test(call.body.text));
  assert.ok(confirmation, 'клиенту ушло подтверждение');
  assert.ok(callbacksOf(confirmation.body.reply_markup).includes('vcal:' + inquiry.id), 'под ним кнопка календаря');

  telegram.calls = [];
  telegram.uploaded = null;
  await chat.press('vcal:' + inquiry.id);
  const sent = telegram.calls.find((call) => call.method === 'sendDocument');
  assert.ok(sent, 'файл отправлен');
  assert.equal(String(sent.body.chat_id), String(chat.id));
  assert.equal(telegram.uploaded.name, 'viewing-' + day + '.ics');
  const ics = telegram.uploaded.text;
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'строки закончены CRLF');
  assert.match(ics, new RegExp('DTSTART:' + utc(new Date(year, month - 1, dayOfMonth, 17, 30))));
  assert.match(ics, new RegExp('DTEND:' + utc(new Date(year, month - 1, dayOfMonth, 18, 30))), 'встреча на час');
  assert.match(ics, new RegExp('UID:viewing-' + inquiry.id + '@kornilenko'));
  assert.match(ics, /SUMMARY:Просмотр: Вилла в Марбелье/);
  assert.match(ics, /LOCATION:Марбелья\\, Calle del Mar\\, 5/, 'запятые в адресе экранированы');
  assert.match(ics, /URL:https:\/\/maps\.example\.com\/villa/);
  assert.match(ics, /TRIGGER:-PT120M/, 'напоминание за два часа');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'строка длиннее 75 октетов: ' + line);
});

test('перенос просмотра выходит с тем же UID и большим номером: календарь обновляет встречу, а не заводит вторую', async () => {
  const chat = createChat();
  const inquiry = await requestViewing(chat);
  await bot.confirmViewing(inquiry, { date: dayKey(daysFromNow(3)), time: '10:00', source: 'panel' });
  const first = bot.viewingCalendarFile(inquiry, 'ru').content;
  const moved = { ...inquiry, viewing: { ...inquiry.viewing, confirmedTime: '12:00', confirmedAt: new Date(Date.parse(inquiry.viewing.confirmedAt) + 5000).toISOString() } };
  const second = bot.viewingCalendarFile(moved, 'ru').content;
  const field = (text, name) => text.match(new RegExp('^' + name + ':(.*)$', 'm'))[1];
  assert.equal(field(first, 'UID'), field(second, 'UID'));
  assert.ok(Number(field(second, 'SEQUENCE')) > Number(field(first, 'SEQUENCE')));
  assert.notEqual(field(first, 'DTSTART'), field(second, 'DTSTART'));
});

test('файл календаря получает только тот клиент, чей это просмотр; отменённому и неподтверждённому просмотру файла нет', async () => {
  const chat = createChat();
  const inquiry = await requestViewing(chat);
  assert.equal(bot.viewingCalendarFile(inquiry, 'ru'), null, 'пока не подтверждён — файла нет');
  await bot.confirmViewing(inquiry, { date: dayKey(daysFromNow(3)), time: '17:30', source: 'panel' });

  const stranger = createChat();
  telegram.calls = [];
  const refused = await stranger.press('vcal:' + inquiry.id);
  assert.ok(!telegram.calls.some((call) => call.method === 'sendDocument'), 'чужому файл не уходит');
  assert.equal(refused.popups.length, 1);

  await chat.press('myreq:yes:' + inquiry.id);
  telegram.calls = [];
  const gone = await chat.press('vcal:' + inquiry.id);
  assert.ok(!telegram.calls.some((call) => call.method === 'sendDocument'), 'после отмены файла нет');
  assert.match(gone.popups[0], /отменён или не подтверждён/);
});

test('сборка файла: длинные строки переносятся по правилам формата, спецсимволы экранируются, кириллица не рвётся посреди символа', async () => {
  const { buildIcs, foldLine } = await import('../src/calendar-file.mjs');
  const long = 'Описание ' + 'очень длинное слово, '.repeat(12);
  const folded = foldLine('DESCRIPTION:' + long);
  for (const part of folded.split('\r\n')) assert.ok(Buffer.byteLength(part, 'utf8') <= 75);
  assert.equal(folded.split('\r\n').map((part, index) => (index ? part.slice(1) : part)).join(''), 'DESCRIPTION:' + long, 'после склейки ничего не потеряно');

  const text = buildIcs({ uid: 'x@y', start: new Date(Date.UTC(2026, 9, 5, 15, 0)), summary: 'A; B, C\\D\nE', alarmMinutes: 0 });
  assert.match(text, /SUMMARY:A\\; B\\, C\\\\D\\nE\r\n/);
  assert.ok(!/VALARM/.test(text), 'без напоминания блока нет');
  assert.match(text, /DTSTART:20261005T150000Z/);
  assert.throws(() => buildIcs({ uid: 'x', start: 'not a date', summary: 's' }));
});

test('панель отдаёт файл календаря подтверждённого просмотра; без подтверждения и без входа — отказ', async () => {
  const chat = createChat();
  const inquiry = await requestViewing(chat);
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  const stub = global.fetch;
  global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : stub(url, init));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const file = () => realFetch(base + '/api/inquiries/' + inquiry.id + '/viewing.ics', { headers: { cookie } });

    assert.equal((await file()).status, 409, 'пока не подтверждён');
    await bot.confirmViewing(inquiry, { date: dayKey(daysFromNow(3)), time: '17:30', source: 'panel' });
    const response = await file();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/calendar/);
    assert.match(response.headers.get('content-disposition'), /viewing-\d{4}-\d{2}-\d{2}\.ics/);
    assert.match(await response.text(), /BEGIN:VEVENT[\s\S]*SUMMARY:Просмотр: Вилла в Марбелье/);
    assert.equal((await realFetch(base + '/api/inquiries/' + inquiry.id + '/viewing.ics')).status, 401, 'без входа файл не отдаётся');
  } finally {
    global.fetch = stub;
    await new Promise((resolve) => bot.server.close(resolve));
  }
});
