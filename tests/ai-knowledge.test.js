'use strict';

// База знаний ИИ-консультанта собирается из данных бота и отправляется в GenAgent только при изменениях.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, property, resetData, cleanup } = require('./helpers/chat');
const { buildKnowledge, resetKnowledgeSync, syncKnowledge } = require('../src/ai-knowledge.mjs');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const pushes = [];
let failNext = false;
const telegramStub = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) !== AGENT_URL + '/knowledge') return telegramStub(url, init);
  if (failNext) {
    failNext = false;
    return new Response('{}', { status: 502 });
  }
  pushes.push({ headers: init.headers, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

test.beforeEach(() => {
  pushes.length = 0;
  resetKnowledgeSync();
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: 'ga_test' };
    data.objects = [
      property('villa-01', 'Вилла с бассейном', 'active', { priceValue: 550000, currency: 'EUR', priceFrom: true, bedrooms: 3, distanceSea: 4800 }),
      property('flat-02', 'Квартира в резерве', 'reserved', { priceValue: 200000, currency: 'EUR' }),
      property('draft-03', 'Черновик', 'draft', { priceValue: 100000, currency: 'EUR' }),
    ];
    data.contacts = { ...(data.contacts || {}), managerName: 'Евгений', phone: '+34 600 000 000', mapUrl: 'https://www.google.com/maps/place/Carrer+Benifato,+10,+03509+Finestrat/@38.5,-0.17,17z' };
  });
});
test.after(cleanup);

test('собирается из данных бота: объекты в продаже и в резерве, без черновиков; контакты с адресом офиса', () => {
  const sources = buildKnowledge();
  assert.deepEqual(sources.map((s) => s.key), ['objects', 'company', 'guides', 'costs']);
  const objects = sources[0].content;
  assert.match(objects, /Вилла с бассейном/);
  assert.match(objects, /Цена: от 550 000 €/);
  assert.match(objects, /До моря: ~4,8 км/);
  assert.match(objects, /Квартира в резерве[\s\S]*Статус: забронирован/);
  assert.doesNotMatch(objects, /Черновик/);
  assert.match(sources[1].content, /Офис: Carrer Benifato, 10, 03509 Finestrat/);
  // Ничего о клиентах и заявках.
  assert.doesNotMatch(JSON.stringify(sources), /inquir|chatId|botToken/i);
});

test('отправляется с ключом; без изменений — не повторяется; изменили цену — уходит снова', async () => {
  await syncKnowledge();
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].headers.Authorization, 'Bearer ga_test');
  assert.equal(pushes[0].body.sources.length, 4);

  await syncKnowledge();
  assert.equal(pushes.length, 1, 'без изменений не отправляем');

  bot.getData().objects[0].priceValue = 560000;
  await syncKnowledge();
  assert.equal(pushes.length, 2);
  assert.match(pushes[1].body.sources[0].content, /560 000 €/);
});

test('объект сняли с продажи — пропадает из базы при следующей отправке', async () => {
  await syncKnowledge();
  bot.getData().objects[0].status = 'sold';
  await syncKnowledge();
  assert.equal(pushes.length, 2);
  assert.doesNotMatch(pushes[1].body.sources[0].content, /Вилла с бассейном/);
});

test('сбой отправки — повторяется при следующей проверке; консультант выключен — не отправляем', async () => {
  failNext = true;
  const failed = await syncKnowledge();
  assert.ok(failed.error);
  await syncKnowledge();
  assert.equal(pushes.length, 1, 'после сбоя отправили снова');

  resetKnowledgeSync();
  bot.getData().config.aiAgent = { enabled: false, url: AGENT_URL, key: 'ga_test' };
  await syncKnowledge();
  assert.equal(pushes.length, 1);
});
