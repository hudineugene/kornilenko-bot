'use strict';

// «Что дальше» после заявки. Клиент, отправивший заявку, видит не только «менеджер
// свяжется», но и кто на связи, в какие часы работают, за сколько обычно отвечают
// и где можно написать быстрее (WhatsApp). Всё берётся из настроек владельца: пока
// они пусты (по умолчанию), к тексту ничего не добавляется — выдуманных обещаний
// бот не даёт.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, createChat, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const WEEKDAYS = { days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00' };
// 2026-09-18 — пятница, 21 — понедельник.
const FRIDAY_EVENING = new Date(2026, 8, 18, 20, 0);
const MONDAY_LUNCH = new Date(2026, 8, 21, 13, 0);

let withOffHoursNote;

test.before(async () => {
  ({ withOffHoursNote } = await import('../src/hours.mjs'));
});
test.beforeEach(() => resetData());
test.after(cleanup);

function configure({ hours, managerName, whatsapp, whatsappEnabled } = {}) {
  const data = bot.getData();
  if (hours) data.config.workingHours = { enabled: true, ...hours };
  if (managerName !== undefined) data.contacts.managerName = managerName;
  if (whatsapp !== undefined) data.contacts.whatsapp = whatsapp;
  if (whatsappEnabled !== undefined) data.contacts.whatsappEnabled = whatsappEnabled;
}

test('пока владелец ничего не заполнил, к тексту ничего не добавляется', () => {
  for (const language of ['ru', 'en', 'es']) {
    assert.equal(withOffHoursNote('Спасибо!', language, MONDAY_LUNCH), 'Спасибо!');
  }
});

test('в рабочее время: кто на связи, часы работы, срок ответа — сроком в конце', () => {
  configure({ hours: { ...WEEKDAYS, replyMinutes: 30 }, managerName: 'Мария' });
  const ru = withOffHoursNote('Спасибо!', 'ru', MONDAY_LUNCH);
  assert.match(ru, /👨‍💼 На связи: Мария/);
  assert.match(ru, /🕘 Часы работы: пн–пт 9:00–19:00/);
  assert.ok(ru.endsWith('⏱ Обычно отвечаем за 30 минут.'), ru);

  const en = withOffHoursNote('Thanks!', 'en', MONDAY_LUNCH);
  assert.match(en, /Your contact: Мария/);
  assert.match(en, /Working hours: Mon–Fri 9:00–19:00/);
  assert.ok(en.endsWith('We usually reply within 30 minutes.'), en);

  const es = withOffHoursNote('¡Gracias!', 'es', MONDAY_LUNCH);
  assert.match(es, /Tu contacto: Мария/);
  assert.match(es, /Horario: lun–vie 9:00–19:00/);
});

test('дни не подряд перечисляются, а не сливаются в «пн–пт»', () => {
  configure({ hours: { days: [1, 3, 5], from: '10:00', to: '14:00' } });
  assert.match(withOffHoursNote('Спасибо!', 'ru', new Date(2026, 8, 21, 11, 0)), /Часы работы: пн, ср, пт 10:00–14:00/);
  configure({ hours: { days: [6, 0], from: '10:00', to: '14:00' } });
  assert.match(withOffHoursNote('Спасибо!', 'ru', new Date(2026, 8, 20, 11, 0)), /Часы работы: сб, вс 10:00–14:00/);
});

test('вне рабочего времени: когда ответят и те же часы, но обещания «за 30 минут» нет', () => {
  configure({ hours: { ...WEEKDAYS, replyMinutes: 30 }, managerName: 'Мария' });
  const text = withOffHoursNote('Спасибо!', 'ru', FRIDAY_EVENING);
  assert.match(text, /На связи: Мария/);
  assert.match(text, /Часы работы: пн–пт 9:00–19:00/);
  assert.match(text, /🌙 Сейчас нерабочее время — менеджер ответит в понедельник с 9:00/);
  assert.ok(!/⏱/.test(text), 'вне часов срок не обещаем');
});

test('WhatsApp — ссылкой в тексте, когда он включён и номер указан; иначе строки нет', () => {
  configure({ whatsapp: '+34 600 111 222', whatsappEnabled: true });
  assert.match(withOffHoursNote('Спасибо!', 'ru', MONDAY_LUNCH), /Быстрее — в WhatsApp: https:\/\/wa\.me\/34600111222/);
  assert.match(withOffHoursNote('Thanks!', 'en', MONDAY_LUNCH), /Faster on WhatsApp: https:\/\/wa\.me\/34600111222/);
  assert.match(withOffHoursNote('¡Gracias!', 'es', MONDAY_LUNCH), /Más rápido por WhatsApp: https:\/\/wa\.me\/34600111222/);

  configure({ whatsappEnabled: false });
  assert.equal(withOffHoursNote('Спасибо!', 'ru', MONDAY_LUNCH), 'Спасибо!', 'выключен в «Контактах» — не предлагаем');
  configure({ whatsapp: '', whatsappEnabled: true });
  assert.equal(withOffHoursNote('Спасибо!', 'ru', MONDAY_LUNCH), 'Спасибо!', 'номера нет — предлагать нечего');
});

test('сообщение клиенту после заявки на звонок содержит блок «что дальше»', async () => {
  const today = new Date().getDay();
  configure({ hours: { days: [today], from: '00:00', to: '23:59', replyMinutes: 15 }, managerName: 'Мария' });
  const chat = createChat();
  await chat.press('contact:lead');
  await chat.press('lead:call');
  await chat.say('+34 600 000 000');
  const sent = await chat.say(bot.text.lead.ru.timeOptions[2]);
  assert.match(sent.last.text, /👨‍💼 На связи: Мария/);
  assert.match(sent.last.text, /🕘 Часы работы:/);
  assert.ok(sent.last.text.endsWith('⏱ Обычно отвечаем за 15 минут.'), sent.last.text);
});

test('блок «Что дальше» — полностью один раз в сутки на клиента, дальше только срок ответа; на следующий день снова полностью', () => {
  configure({ hours: { ...WEEKDAYS, replyMinutes: 30 }, managerName: 'Ольга', whatsapp: '+34 600 111 222' });
  const user = { id: 'u1' };
  const first = withOffHoursNote('Спасибо!', 'ru', { now: MONDAY_LUNCH, user });
  assert.match(first, /На связи: Ольга/);
  assert.match(first, /WhatsApp/);
  assert.match(first, /Обычно отвечаем за 30 минут/);
  assert.equal(user.whatNextDay, '2026-09-21');
  // Второе и третье подтверждение в тот же день — без повторения блока.
  for (let time = 0; time < 2; time += 1) {
    const again = withOffHoursNote('Заявка принята', 'ru', { now: new Date(2026, 8, 21, 15, 0), user });
    assert.ok(!/На связи|WhatsApp|Часы работы/.test(again), 'блок не повторяется: ' + again);
    assert.match(again, /Обычно отвечаем за 30 минут/, 'срок ответа остаётся');
  }
  // Вне рабочих часов пометка о часах тоже остаётся.
  const night = withOffHoursNote('Ещё вопрос', 'ru', { now: FRIDAY_EVENING, user: { id: 'u2', whatNextDay: '2026-09-18' } });
  assert.ok(!/На связи/.test(night));
  assert.match(night, /🌙/);
  // Наутро — снова полностью.
  const nextDay = withOffHoursNote('Спасибо!', 'ru', { now: new Date(2026, 8, 22, 11, 0), user });
  assert.match(nextDay, /На связи: Ольга/);
  // Без клиента (старый вызов с датой) — как раньше, полностью.
  assert.match(withOffHoursNote('Спасибо!', 'ru', MONDAY_LUNCH), /На связи: Ольга/);
});

test('в заявках у клиента с пустыми настройками день не отмечается: нечего было показывать', () => {
  const user = { id: 'u3' };
  assert.equal(withOffHoursNote('Спасибо!', 'ru', { now: MONDAY_LUNCH, user }), 'Спасибо!');
  assert.ok(!user.whatNextDay);
});
