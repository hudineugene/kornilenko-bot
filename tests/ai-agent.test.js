'use strict';

// ИИ-консультант (GenAgent): вопрос, написанный текстом, сначала уходит агенту.
// Менеджер получает заявку, только если агент передал клиента; при сбое агента — всё как раньше.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup } = require('./helpers/chat');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const KEY = 'ga_test-key';

const agent = { calls: [], respond: () => ({ status: 200, body: { reply: 'Ответ консультанта', handoff: false } }) };
const telegramStub = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) !== AGENT_URL) return telegramStub(url, init);
  agent.calls.push({ headers: init.headers, body: JSON.parse(init.body) });
  const { status, body } = agent.respond();
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};

const QUESTION = 'Здравствуйте! Подскажите, пожалуйста, как с вами лучше работать?';

test.beforeEach(() => {
  agent.calls = [];
  agent.respond = () => ({ status: 200, body: { reply: 'Ответ консультанта', handoff: false } });
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY };
  });
});
test.after(cleanup);

test('агент отвечает на вопрос текстом — без заявки менеджеру', async () => {
  const chat = createChat({ language: 'es', firstName: 'Pedro' });
  const step = await chat.say(QUESTION);
  assert.equal(agent.calls.length, 1);
  const call = agent.calls[0];
  assert.equal(call.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(call.body.text, QUESTION);
  assert.equal(call.body.language, 'es');
  assert.equal(call.body.user.id, String(chat.id));
  assert.equal(call.body.user.name, 'Pedro');
  assert.match(step.text, /Ответ консультанта/);
  assert.equal(chat.inquiries.length, 0);
});

test('агент передаёт клиента — менеджер получает заявку, клиент — ответ агента', async () => {
  agent.respond = () => ({ status: 200, body: { reply: 'Передаю менеджеру', handoff: true } });
  const chat = createChat();
  const step = await chat.say('Хочу посмотреть виллу в субботу');
  assert.match(step.text, /Передаю менеджеру/);
  assert.equal(chat.inquiries.length, 1);
  assert.match(chat.inquiries[0].text, /посмотреть виллу/);
});

test('при передаче в заявке — выжимка консультанта над сообщением клиента', async () => {
  agent.respond = () => ({ status: 200, body: { reply: 'Передаю менеджеру', handoff: true, summary: 'Ищет виллу до 600 тыс. €, спрашивал про рассрочку. Хочет просмотр в субботу.' } });
  const chat = createChat();
  await chat.say('Хочу посмотреть виллу в субботу');
  const text = chat.inquiries[0].text;
  assert.match(text, /^🤖 Консультант: Ищет виллу до 600 тыс\. €/);
  assert.match(text, /💬 Клиент: Хочу посмотреть виллу в субботу/);
});

test('агент не ответил — всё как раньше: заявка и обычный ответ', async () => {
  agent.respond = () => ({ status: 500, body: { error: 'boom' } });
  const chat = createChat();
  const step = await chat.say(QUESTION);
  assert.equal(agent.calls.length, 1);
  assert.equal(chat.inquiries.length, 1);
  assert.doesNotMatch(step.text, /Ответ консультанта/);
  assert.ok(step.text.length > 0, 'клиент получил обычный ответ');
});

test('пустой ответ агента (reply = null) — тоже обычный путь', async () => {
  agent.respond = () => ({ status: 200, body: { reply: null, handoff: false, reason: 'budget_exceeded' } });
  const chat = createChat();
  await chat.say(QUESTION);
  assert.equal(chat.inquiries.length, 1);
});

test('менеджер уже ответил (обращение «в работе») — агент молчит, сообщение идёт менеджеру', async () => {
  agent.respond = () => ({ status: 200, body: { reply: 'Передаю менеджеру', handoff: true } });
  const chat = createChat();
  await chat.say('Позовите менеджера, пожалуйста');
  assert.equal(agent.calls.length, 1);
  chat.inquiries[0].status = 'in_progress'; // так бот помечает обращение, когда менеджер ответил
  const step = await chat.say('И ещё вопрос про парковку');
  assert.equal(agent.calls.length, 1, 'второй раз агента не спрашивали');
  assert.equal(chat.inquiries.length, 1);
  assert.match(chat.inquiries[0].text, /парковку/);
  assert.doesNotMatch(step.text, /Передаю менеджеру/);
});

test('обращение открыто, но менеджер ещё не ответил — агент отвечает, сообщение дописано в обращение', async () => {
  // Первое сообщение пришло, когда консультант был выключен: бот по-старому создал заявку.
  bot.getData().config.aiAgent = { enabled: false, url: AGENT_URL, key: KEY };
  const chat = createChat();
  await chat.say('А помощь где?');
  assert.equal(chat.inquiries.length, 1);
  assert.equal(chat.inquiries[0].status, 'new');

  bot.getData().config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY };
  const step = await chat.say('Что у вас есть до 150 тысяч?');
  assert.equal(agent.calls.length, 1);
  assert.match(step.text, /Ответ консультанта/);
  assert.equal(chat.inquiries.length, 1, 'новая заявка не создана');
  assert.match(chat.inquiries[0].text, /до 150 тысяч/, 'менеджер видит сообщение в той же заявке');
});

test('консультант выключен — агента не спрашивают', async () => {
  bot.getData().config.aiAgent = { enabled: false, url: AGENT_URL, key: KEY };
  const chat = createChat();
  await chat.say(QUESTION);
  assert.equal(agent.calls.length, 0);
  assert.equal(chat.inquiries.length, 1);
});

test('язык: выбранный в боте, иначе — по Telegram (немецкий телефон → английский)', async () => {
  const chat = createChat({ language: 'de' });
  chat.user.preferredLanguage = '';
  chat.user.languageCode = 'de';
  await chat.say(QUESTION);
  assert.equal(agent.calls[0].body.language, 'en');

  const uk = createChat({ language: 'uk' });
  await uk.say(QUESTION);
  assert.equal(agent.calls[1].body.language, 'uk');
});

test('настройки: адрес не из GenAgent и включение без ключа не сохраняются', () => {
  const { normalizeAiAgent } = require('../src/data-format.mjs');
  assert.deepEqual(normalizeAiAgent({ enabled: true, url: 'http://evil.example/x', key: 'k' }), { enabled: false, url: '', key: 'k', autoReturnHours: 2 });
  assert.deepEqual(normalizeAiAgent({ enabled: true, url: AGENT_URL, key: '' }), { enabled: false, url: AGENT_URL, key: '', autoReturnHours: 2 });
  assert.deepEqual(normalizeAiAgent({ enabled: true, url: AGENT_URL, key: KEY }), { enabled: true, url: AGENT_URL, key: KEY, autoReturnHours: 2 });
  assert.equal(normalizeAiAgent({ autoReturnHours: 0 }).autoReturnHours, 0);
  assert.equal(normalizeAiAgent({ autoReturnHours: 500 }).autoReturnHours, 72);
});

test('режим «только приложение»: агент отвечает, под ответом — кнопка приложения, заявки нет', async () => {
  bot.getData().config.miniApp = { enabled: true, url: 'https://app.example.com', appOnly: true };
  const chat = createChat();
  const step = await chat.say('Побазарим? Что есть до 150 тысяч?');
  assert.equal(agent.calls.length, 1);
  assert.match(agent.calls[0].body.context, /только приложение/);
  assert.match(step.text, /Ответ консультанта/);
  const keyboard = step.last.markup && step.last.markup.keyboard;
  assert.ok(keyboard && keyboard[0][0].web_app, 'кнопка приложения под ответом');
  assert.equal(chat.inquiries.length, 0);
});

test('режим «только приложение»: агент передал менеджеру — заявка есть; агент недоступен — как раньше', async () => {
  bot.getData().config.miniApp = { enabled: true, url: 'https://app.example.com', appOnly: true };
  agent.respond = () => ({ status: 200, body: { reply: 'Передаю менеджеру', handoff: true } });
  const chat = createChat();
  await chat.say('Хочу на просмотр');
  assert.equal(chat.inquiries.length, 1);

  agent.respond = () => ({ status: 500, body: {} });
  const other = createChat();
  const step = await other.say('Здравствуйте');
  assert.equal(other.inquiries.length, 1);
  assert.doesNotMatch(step.text, /Передаю менеджеру/);
});

test('профиль для агента: у записи на просмотр — дата просмотра, а не дата заявки', async () => {
  const chat = createChat();
  const data = bot.getData();
  data.inquiries.unshift(
    { id: 'v1', userId: chat.id, type: 'viewing', status: 'new', createdAt: '2026-10-15T08:29:00.000Z', viewing: { date: '2026-10-17', timeText: 'Днём' } },
    { id: 'v2', userId: chat.id, type: 'viewing', status: 'in_progress', createdAt: '2026-10-14T10:00:00.000Z', viewing: { date: '2026-10-20', confirmedDate: '2026-10-21', confirmedTime: '11:30', online: true } },
  );
  await chat.say(QUESTION);
  const context = agent.calls[0].body.context;
  assert.match(context, /клиент выбрал сб, 17\.10\.2026, Днём, менеджер ещё не подтвердил, оставлено 2026-10-15/);
  assert.match(context, /просмотр подтверждён на ср, 21\.10\.2026 11:30 \(по видеосвязи\)/);
});
