'use strict';

// ИИ-консультант в приложении: тот же агент, что в чате бота; приложение передаёт свой язык и открытую карточку,
// заявка менеджеру — только при передаче, при открытом разговоре с менеджером или если агент недоступен.

const realFetch = global.fetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, TOKEN, property, resetData, cleanup } = require('./helpers/chat');
const { signInitData } = require('../src/miniapp/auth.mjs');
const { createMiniAppServer } = require('../src/miniapp/server.mjs');
const { APP_JS } = require('../src/miniapp/assets.mjs');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const agent = { calls: [], respond: () => ({ status: 200, body: { reply: 'Ответ консультанта', handoff: false } }) };
const telegramStub = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) !== AGENT_URL) return telegramStub(url, init);
  agent.calls.push(JSON.parse(init.body));
  const { status, body } = agent.respond();
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};

let server;
let base;
const NOW = Math.floor(Date.now() / 1000);
const initDataFor = (id) => signInitData({ auth_date: String(NOW), query_id: 'AAH-test', user: { id, first_name: 'Мария', language_code: 'ru' } }, TOKEN);

async function call(path, { method = 'GET', body, initData } = {}) {
  const response = await realFetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(initData ? { 'x-tg-init-data': initData } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

test.before(async () => {
  server = createMiniAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.beforeEach(() => {
  agent.calls = [];
  agent.respond = () => ({ status: 200, body: { reply: 'Ответ консультанта', handoff: false } });
  resetData((data) => {
    data.objects = [property('villa-01', 'Вилла с бассейном', 'active', { priceValue: 550000, currency: 'EUR' })];
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: 'ga_test' };
  });
});
test.after(() => {
  server.close();
  server.closeAllConnections && server.closeAllConnections();
  cleanup();
});

const inquiriesOf = (id) => bot.getData().inquiries.filter((item) => item.userId === String(id));

test('приложение знает, что консультант включён', async () => {
  assert.equal((await call('/api/app/bootstrap?lang=ru')).json.assistant, true);
  bot.getData().config.aiAgent = { enabled: false, url: AGENT_URL, key: 'ga_test' };
  assert.equal((await call('/api/app/bootstrap?lang=ru')).json.assistant, false);
});

test('вопрос из карточки: ответ агента, язык приложения и объект в контексте, без заявки', async () => {
  const res = await call('/api/app/assistant', { method: 'POST', initData: initDataFor(7001), body: { text: 'Есть рассрочка?', propertyId: 'villa-01', lang: 'es' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.reply, 'Ответ консультанта');
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].language, 'es');
  assert.equal(agent.calls[0].user.id, '7001');
  assert.match(agent.calls[0].context, /приложения/);
  assert.match(agent.calls[0].context, /VILLA-01/);
  assert.equal(inquiriesOf(7001).length, 0);
});

test('агент передал менеджеру — заявка с объектом', async () => {
  agent.respond = () => ({ status: 200, body: { reply: 'Передаю менеджеру', handoff: true, summary: 'Хочет просмотр виллы в субботу.' } });
  const res = await call('/api/app/assistant', { method: 'POST', initData: initDataFor(7002), body: { text: 'Хочу посмотреть в субботу', propertyId: 'villa-01' } });
  assert.equal(res.json.handoff, true);
  const list = inquiriesOf(7002);
  assert.equal(list.length, 1);
  assert.equal(list[0].propertyId, 'villa-01');
  assert.match(list[0].text, /🤖 Консультант: Хочет просмотр виллы в субботу/);
  assert.match(list[0].text, /💬 Клиент: Хочу посмотреть в субботу/);
});

test('агент недоступен — вопрос уходит менеджеру, как форма «Задать вопрос»', async () => {
  agent.respond = () => ({ status: 503, body: {} });
  const res = await call('/api/app/assistant', { method: 'POST', initData: initDataFor(7003), body: { text: 'Есть рассрочка?' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.reply, null);
  assert.equal(res.json.forwarded, true);
  assert.equal(inquiriesOf(7003).length, 1);
});

test('менеджер уже ведёт разговор — агента не спрашивают', async () => {
  agent.respond = () => ({ status: 200, body: { reply: 'Передаю менеджеру', handoff: true } });
  await call('/api/app/assistant', { method: 'POST', initData: initDataFor(7004), body: { text: 'Позовите менеджера' } });
  inquiriesOf(7004)[0].status = 'in_progress';
  const res = await call('/api/app/assistant', { method: 'POST', initData: initDataFor(7004), body: { text: 'А парковка есть?' } });
  assert.equal(agent.calls.length, 1);
  assert.equal(res.json.forwarded, true);
  assert.match(inquiriesOf(7004)[0].text, /парковка/);
});

test('гостю (без входа из Telegram) чат недоступен; короткий вопрос — ошибка', async () => {
  assert.equal((await call('/api/app/assistant', { method: 'POST', body: { text: 'Привет' } })).status, 401);
  const short = await call('/api/app/assistant', { method: 'POST', initData: initDataFor(7005), body: { text: ' ' } });
  assert.equal(short.json.code, 'question-short');
});

test('страница: окно консультанта и кнопка есть, «Задать вопрос» ведёт в чат при включённом консультанте', () => {
  assert.match(APP_JS, /function openAssistant\(/);
  assert.match(APP_JS, /S\.boot\.assistant && !isGuest\(\)\) return openAssistant/);
  assert.match(APP_JS, /'\/assistant'/);
  assert.match(APP_JS, /ai-fab/);
});
