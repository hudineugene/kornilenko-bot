'use strict';

// Ручной режим с GenAgent: менеджер отвечает клиенту из «Диалогов» GenAgent (бот отправляет своим именем),
// возвращает клиента ИИ кнопкой («🤖 Вернуть ИИ» здесь или «Вернуть агенту» там) или сам — по таймеру;
// переписка с менеджером видна и в GenAgent.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup, telegram, adminPress, settle, property } = require('./helpers/chat');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const KEY = 'ga_test-key';

const agent = { asks: [], logs: [], acks: [], outbox: [], events: [] };
const telegramStub = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith(AGENT_URL)) return telegramStub(url, init);
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u === AGENT_URL) {
    const body = JSON.parse(init.body);
    agent.asks.push(body);
    const viewing = /просмотр/i.test(body.text) ? [{ type: 'viewing', value: agent.viewingRef || 'нет такого' }] : [];
    return json({ reply: 'Ответ консультанта', handoff: /менеджер/i.test(body.text), summary: 'Ищет виллу', actions: viewing });
  }
  if (u === AGENT_URL + '/extract') {
    agent.extracts = (agent.extracts || 0) + 1;
    return json({ values: { budget: 'до 600 000 €', goal: 'жить', bedrooms: '3', location: null, timeline: 'весной', payment: null, contact: 'WhatsApp вечером' } });
  }
  if (u === AGENT_URL + '/event') {
    agent.events.push(JSON.parse(init.body));
    return json({ ok: true });
  }
  if (u === AGENT_URL + '/log') {
    agent.logs.push(JSON.parse(init.body));
    return json({ ok: true });
  }
  if (u.startsWith(AGENT_URL + '/outbox')) {
    if (init.method === 'POST') {
      agent.acks.push(JSON.parse(init.body));
      return json({ ok: true });
    }
    const items = agent.outbox;
    agent.outbox = [];
    return json({ items });
  }
  return new Response('{}', { status: 404 });
};

const outbox = () => import('../src/ai-outbox.mjs');
const MANAGER = { direction: 'out', source: 'telegram', by: 'Администратор', kind: 'text', text: 'Здравствуйте, это менеджер' };

// Клиент поговорил с консультантом, тот передал его менеджеру, менеджер ответил в боте.
async function handedToManager({ managerAgoMs = 60 * 1000 } = {}) {
  const chat = createChat();
  await chat.say('Позовите менеджера, пожалуйста');
  const inquiry = chat.inquiries[0];
  inquiry.status = 'in_progress';
  inquiry.messages.push({ ...MANAGER, id: 'm1', createdAt: new Date(Date.now() - managerAgoMs).toISOString() });
  return chat;
}

test.beforeEach(() => {
  agent.asks = [];
  agent.logs = [];
  agent.acks = [];
  agent.outbox = [];
  agent.events = [];
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY, autoReturnHours: 2 };
  });
});
test.after(cleanup);

test('разговор у менеджера: агента не спрашивают, сообщение клиента видно в GenAgent', async () => {
  const chat = await handedToManager();
  agent.asks = [];
  await chat.say('А что с парковкой?');
  await settle();
  assert.equal(agent.asks.length, 0);
  const log = agent.logs.find((item) => item.role === 'user');
  assert.ok(log, 'клиентское сообщение ушло в /log');
  assert.equal(log.text, 'А что с парковкой?');
  assert.equal(log.user.id, String(chat.id));
});

test('ответ менеджера из GenAgent: бот отправляет клиенту, пишет в заявку и подтверждает', async () => {
  const chat = await handedToManager();
  agent.outbox = [{ id: '7d0f2c1e-0000-4000-8000-000000000001', kind: 'dm', userId: String(chat.id), text: 'Парковка есть, бесплатная' }];
  const before = telegram.calls.length;
  await (await outbox()).pollAgentOutbox();
  const sent = telegram.calls.slice(before).find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
  assert.ok(sent, 'клиенту отправлено');
  assert.equal(sent.body.text, 'Парковка есть, бесплатная');
  const last = chat.inquiries[0].messages.at(-1);
  assert.equal(last.direction, 'out');
  assert.equal(last.source, 'genagent');
  assert.equal(chat.inquiries[0].status, 'in_progress');
  assert.equal(agent.acks[0].id, '7d0f2c1e-0000-4000-8000-000000000001');
  assert.ok(agent.acks[0].done);
  assert.equal(agent.logs.filter((item) => item.role === 'operator').length, 0, 'ответ из GenAgent обратно не дублируется');
});

test('«Вернуть агенту» в GenAgent: консультант снова отвечает клиенту', async () => {
  const chat = await handedToManager();
  agent.outbox = [{ id: '7d0f2c1e-0000-4000-8000-000000000002', kind: 'resume', userId: String(chat.id) }];
  await (await outbox()).pollAgentOutbox();
  agent.asks = [];
  const step = await chat.say('Ещё вопрос про ипотеку');
  assert.equal(agent.asks.length, 1);
  assert.match(step.text, /Ответ консультанта/);
});

test('автовозврат: менеджер молчит дольше заданного — отвечает консультант', async () => {
  const chat = await handedToManager({ managerAgoMs: 3 * 60 * 60 * 1000 });
  agent.asks = [];
  await chat.say('Вы здесь?');
  assert.equal(agent.asks.length, 1);
});

test('автовозврат выключен (0) — только кнопкой', async () => {
  bot.getData().config.aiAgent.autoReturnHours = 0;
  const chat = await handedToManager({ managerAgoMs: 30 * 60 * 60 * 1000 });
  agent.asks = [];
  await chat.say('Вы здесь?');
  assert.equal(agent.asks.length, 0);
});

test('кнопка «🤖 Вернуть ИИ» под заявкой: консультант отвечает, GenAgent узнаёт', async () => {
  const chat = await handedToManager();
  const inquiry = chat.inquiries[0];
  await adminPress('inq:ai:' + inquiry.id);
  await settle();
  assert.ok(inquiry.aiResumedAt);
  assert.ok(agent.logs.some((item) => item.role === 'returned' && item.user.id === String(chat.id)));
  agent.asks = [];
  await chat.say('А рассрочка есть?');
  assert.equal(agent.asks.length, 1);
});

test('ответ менеджера в боте — виден в GenAgent', async () => {
  const chat = await handedToManager();
  const { appendInquiryMessage, inquiryTimelineMessage } = await import('../src/inquiries.mjs');
  appendInquiryMessage(chat.inquiries[0], inquiryTimelineMessage(null, 'out', { text: 'Перезвоню через час', source: 'panel', by: 'Администратор', kind: 'text' }));
  await settle();
  assert.ok(agent.logs.some((item) => item.role === 'operator' && item.text === 'Перезвоню через час'));
});

test('менеджер пишет из GenAgent клиенту без заявки — заводится заявка со служебной строкой, не «от клиента»', async () => {
  const chat = createChat();
  agent.outbox = [{ id: '7d0f2c1e-0000-4000-8000-000000000003', kind: 'dm', userId: String(chat.id), text: 'Здравствуйте, это менеджер' }];
  await (await outbox()).pollAgentOutbox();
  assert.equal(chat.inquiries.length, 1);
  const [first, reply] = chat.inquiries[0].messages;
  assert.equal(first.source, 'system');
  assert.match(first.text, /Служебная запись/);
  assert.equal(reply.direction, 'out');
  assert.equal(reply.source, 'genagent');
  assert.equal(chat.inquiries[0].clientMessageAt, '');
});


test('воронка: заявка после консультанта уходит событием в GenAgent', async () => {
  const chat = createChat();
  await chat.say('Позовите менеджера, пожалуйста');
  await settle();
  const event = agent.events.find((item) => item.type === 'inquiry');
  assert.ok(event, 'событие заявки');
  assert.equal(event.user.id, String(chat.id));
});

test('оценка ответа консультанта: под ответом 👍/👎, нажатие уходит в GenAgent', async () => {
  const chat = createChat();
  const step = await chat.say('Сколько стоит вилла?');
  assert.match(JSON.stringify(step.markup || step.reply_markup || telegram.calls.at(-1).body.reply_markup), /air:up/);
  await chat.press('air:down');
  await settle();
  assert.ok(agent.events.some((item) => item.type === 'rating_down' && item.user.id === String(chat.id)));
});


test('передача менеджеру: в заявке — что известно о клиенте (бюджет, цель, спальни, сроки, связь)', async () => {
  const chat = createChat();
  await chat.say('Позовите менеджера, хочу купить');
  const text = chat.inquiries[0].text;
  assert.match(text, /🎯 Что известно о клиенте/);
  assert.match(text, /Бюджет: до 600 000 €/);
  assert.match(text, /Цель: жить/);
  assert.match(text, /Связь: WhatsApp вечером/);
  assert.doesNotMatch(text, /Где:/, 'неизвестное не пишем');
});

test('консультант зовёт на просмотр объекта — под ответом кнопка записи на него', async () => {
  const data = bot.getData();
  const record = property('villa-sun', 'Вилла Солнце', 'active');
  data.objects = [...(data.objects || []), record];
  agent.viewingRef = 'Вилла Солнце'; // консультант называет проект по названию
  const chat = createChat();
  await chat.say('Хочу на просмотр');
  const call = telegram.calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(chat.id)).at(-1);
  const buttons = JSON.stringify(call.body.reply_markup);
  assert.ok(buttons.includes('property:viewing:' + record.id) || buttons.includes('?p=' + record.id), buttons);
  assert.match(buttons, /air:up/);
  agent.viewingRef = '';
});

test('напоминание из GenAgent: клиенту без обращения — отправляем; с открытым обращением — нет', async () => {
  const fresh = createChat();
  const busy = await handedToManager();
  agent.outbox = [
    { id: '7d0f2c1e-0000-4000-8000-000000000010', kind: 'followup', userId: String(fresh.id), text: 'Вчера вы смотрели виллы — подобрать варианты?' },
    { id: '7d0f2c1e-0000-4000-8000-000000000011', kind: 'followup', userId: String(busy.id), text: 'Напоминание' },
  ];
  const before = telegram.calls.length;
  await (await outbox()).pollAgentOutbox();
  const sent = telegram.calls.slice(before).filter((call) => call.method === 'sendMessage');
  assert.equal(sent.length, 1);
  assert.equal(String(sent[0].body.chat_id), String(fresh.id));
  assert.match(JSON.stringify(sent[0].body.reply_markup), /air:up/);
  const ackFresh = agent.acks.find((a) => a.id.endsWith('10'));
  const ackBusy = agent.acks.find((a) => a.id.endsWith('11'));
  assert.ok(ackFresh.messageId);
  assert.match(ackBusy.error, /обращение/);
});

test('подсказки консультанта: кнопки под ответом, нажатие — как вопрос клиента', async () => {
  const chat = createChat();
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    if (String(url) === AGENT_URL) {
      const body = JSON.parse(init.body);
      agent.asks.push(body);
      return new Response(JSON.stringify({ reply: 'Ответ на: ' + body.text, handoff: false, actions: [{ type: 'suggest', value: 'А есть рассрочка?' }, { type: 'button', value: 'catalog' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(url, init);
  };
  try {
    await chat.say('Сколько стоит Riviera 1?');
    const markup = JSON.stringify(telegram.calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(chat.id)).at(-1).body.reply_markup);
    assert.match(markup, /sq:0/);
    assert.match(markup, /каталог/i);
    agent.asks = [];
    await chat.press('sq:0');
    assert.equal(agent.asks.length, 1);
    assert.equal(agent.asks[0].text, 'А есть рассрочка?');
  } finally {
    global.fetch = original;
  }
});

test('профиль клиента: избранное, просмотры и фильтр уходят консультанту, телефон — нет', async () => {
  const data = bot.getData();
  data.objects = [...(data.objects || []), property('vista-mar', 'Виста Мар', 'active', { priceValue: 250000, currency: 'EUR' }), property('casa-sol', 'Каса Соль', 'active')];
  const chat = createChat();
  chat.user.favorites = ['vista-mar'];
  chat.user.recentlyViewed = ['casa-sol', 'vista-mar'];
  chat.user.catalogFilter = { deal: 'sale', type: 'villa', bedrooms: 3, city: 'Финестрат', district: '', minPrice: 0, maxPrice: 600000, sort: '' };
  chat.user.phone = '+34600000000';
  await chat.say('Что посоветуете?');
  const context = agent.asks.at(-1).context;
  assert.match(context, /В избранном: Виста Мар \(Бенидорм\), 250 000 €/);
  assert.match(context, /Недавно смотрел: Каса Соль/);
  assert.match(context, /Искал в каталоге: покупка, вилла, 3\+ спальни, Финестрат, бюджет до 600 000 €/);
  assert.match(context, /телефон уже оставлял/);
  assert.doesNotMatch(context, /34600000000/);
});
