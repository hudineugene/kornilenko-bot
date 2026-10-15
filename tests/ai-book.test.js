'use strict';

// Запись на просмотр от консультанта: он видит свободные окна, клиент соглашается на время —
// под ответом кнопка «Записаться» на это время; нажатие записывает тем же путём, что в приложении.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup, telegram, property } = require('./helpers/chat');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const KEY = 'ga_test-key';

const agent = { actions: [], asks: [] };
const telegramStub = global.fetch;
global.fetch = async (url, init) => {
  if (!String(url).startsWith(AGENT_URL)) return telegramStub(url, init);
  if (String(url) === AGENT_URL) agent.asks.push(JSON.parse(init.body));
  const body = { reply: 'Записать вас на это время?', handoff: false, actions: agent.actions };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

let firstSlot;
test.before(async () => {
  resetData((data) => {
    data.config.viewingSlots = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], times: ['11:00', '13:00'], daysAhead: 7, perSlot: 1 };
  });
  const { availableSlotDays } = await import('../src/slots.mjs');
  const day = availableSlotDays('ru')[1];
  firstSlot = { day: day.key, time: day.times[0] };
});

test.beforeEach(() => {
  agent.actions = [];
  agent.asks = [];
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY };
    data.config.viewingSlots = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], times: ['11:00', '13:00'], daysAhead: 7, perSlot: 1 };
    data.objects = [property('vista-mar', 'Виста Мар', 'active')];
  });
});
test.after(cleanup);

const bookButton = (step) => (step.last.markup && step.last.markup.inline_keyboard || []).flat().find((b) => String(b.callback_data || '').startsWith('aibk:'));

test('консультант видит свободные окна, клиент выбрал время — кнопка «Записаться», запись подтверждена', async () => {
  agent.actions = [{ type: 'book', value: `VISTA-MAR | ${firstSlot.day} ${firstSlot.time}` }];
  const chat = createChat();
  chat.user.phone = '+34600111222';
  const step = await chat.say('Давайте в это время');
  assert.match(agent.asks[0].context, /Свободное время для просмотров/);
  const button = bookButton(step);
  assert.ok(button, 'кнопка записи под ответом');
  assert.match(button.text, /Записаться: Виста Мар/);
  await chat.press(button.callback_data);
  const viewing = chat.inquiries.find((item) => item.type === 'viewing');
  assert.ok(viewing, 'заявка на просмотр');
  assert.equal(viewing.viewing.confirmedDate, firstSlot.day);
  assert.equal(viewing.viewing.confirmedTime, firstSlot.time);
});

test('время уже занято — под ответом ближайшие свободные окна', async () => {
  const first = createChat();
  first.user.phone = '+34600111223';
  agent.actions = [{ type: 'book', value: `VISTA-MAR | ${firstSlot.day} ${firstSlot.time}` }];
  const step1 = await first.say('Хочу на просмотр');
  await first.press(bookButton(step1).callback_data);
  const second = createChat();
  const step2 = await second.say('И я в это же время');
  const buttons = (step2.last.markup.inline_keyboard || []).flat().filter((b) => String(b.callback_data || '').startsWith('aibk:'));
  assert.ok(buttons.length >= 1 && buttons.length <= 3);
  assert.ok(buttons.every((b) => !b.callback_data.endsWith(`${firstSlot.day}:${firstSlot.time.replace(':', '')}`)), 'занятое время не предлагается');
});

test('без телефона — запись на объект, где его спросят', async () => {
  agent.actions = [{ type: 'book', value: `Виста Мар | ${firstSlot.day} ${firstSlot.time}` }];
  const chat = createChat();
  const step = await chat.say('Запишите меня');
  const after = await chat.press(bookButton(step).callback_data);
  assert.equal(chat.inquiries.filter((item) => item.type === 'viewing').length, 0);
  assert.match(after.text, /нужен телефон/);
  assert.ok(after.calls.some((call) => JSON.stringify(call.body.reply_markup || {}).includes('property:viewing:vista-mar')));
});
