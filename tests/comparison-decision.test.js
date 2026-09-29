'use strict';

// Сравнение превращается из справки в решение: к цене и площади добавляются «цена за
// м²» и «расходы при покупке», лучшее значение помечено ✅, а внизу — кнопка
// «Обсудить эти объекты», которая передаёт менеджеру, что именно клиент сравнивал.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, callbacksOf, createChat, property, resetData, adminMessages, cleanup } = require('./helpers/chat');

const VILLA = 'cmp-villa';
const FLAT = 'cmp-flat';

test.beforeEach(() => resetData((data) => {
  data.config.calculator = { ...(data.config.calculator || {}), enabled: true };
  data.objects.push(property(VILLA, 'Вилла у моря', 'active', { propertyType: 'villa', priceValue: 650000, currency: 'EUR', area: 180, distanceSea: 350, bedrooms: 4, bathrooms: 3 }));
  data.objects.push(property(FLAT, 'Квартира в центре', 'active', { propertyType: 'apartment', priceValue: 320000, currency: 'EUR', area: 92, bedrooms: 2, bathrooms: 2 }));
}));
test.after(cleanup);

async function compare(chat, ids) {
  for (const id of ids) await chat.press('property:compare:' + id);
  return chat.press('compare:view');
}

// Строки под заголовком критерия: «1️⃣ …», «2️⃣ …».
function rowValues(text, label) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === label);
  assert.ok(start >= 0, 'нет критерия: ' + label);
  return lines.slice(start + 1, start + 3);
}

test('«цена за м²» и «расходы при покупке» — новые строки; лучшее значение помечено ✅', async () => {
  const step = await compare(createChat(), [VILLA, FLAT]);
  const text = step.last.text;

  const perM2 = rowValues(text, '💶 Цена за м²');
  assert.match(perM2[0], /^1️⃣ 3\s611/, 'вилла: 650 000 / 180 ≈ 3 611');
  assert.match(perM2[1], /^2️⃣ ✅ 3\s478/, 'квартира дешевле за метр — она лучшая: 320 000 / 92 ≈ 3 478');

  const price = rowValues(text, '💰 Цена');
  assert.ok(!price[0].includes('✅') && price[1].includes('✅'), 'дешевле — квартира');

  const area = rowValues(text, '📐 Площадь');
  assert.ok(area[0].includes('✅') && !area[1].includes('✅'), 'больше площадь — у виллы');

  const costs = rowValues(text, '🧾 Расходы при покупке');
  assert.match(costs[0], /^1️⃣ ≈ /);
  assert.ok(costs[1].includes('✅'), 'расходы ниже у более дешёвого объекта');

  assert.match(text, /✅ — лучшее значение/, 'внизу — что означает галочка');
});

test('одно значение сравнивать не с чем: галочки нет (расстояние до моря указано только у виллы)', async () => {
  const step = await compare(createChat(), [VILLA, FLAT]);
  const sea = rowValues(step.last.text, '🌊 До моря');
  assert.ok(sea.every((line) => !line.includes('✅')), sea.join(' | '));
});

test('один объект — без галочек и без легенды', async () => {
  const step = await compare(createChat(), [VILLA]);
  assert.ok(!step.last.text.includes('✅'), 'выбирать не из чего');
});

test('поровну — тоже не «лучше»', async () => {
  bot.getData().objects.find((item) => item.id === FLAT).area = 180;
  bot.getData().objects.find((item) => item.id === FLAT).priceValue = 650000;
  const step = await compare(createChat(), [VILLA, FLAT]);
  assert.ok(!step.last.text.includes('✅'), 'все значения равны');
});

test('цены в разных валютах и аренда рядом с продажей не сравниваются: без галочек на деньгах', async () => {
  bot.getData().objects.find((item) => item.id === FLAT).currency = 'USD';
  let step = await compare(createChat(), [VILLA, FLAT]);
  const price = rowValues(step.last.text, '💰 Цена');
  assert.ok(price.every((line) => !line.includes('✅')), 'валюты разные');
  assert.ok(!step.last.text.includes('💶 Цена за м²'), 'и цена за метр не считается');

  bot.getData().objects.find((item) => item.id === FLAT).currency = 'EUR';
  bot.getData().objects.find((item) => item.id === FLAT).dealType = 'rent';
  step = await compare(createChat(), [VILLA, FLAT]);
  assert.ok(!step.last.text.includes('💶 Цена за м²'), 'аренда и продажа — разные вещи');
});

test('калькулятор выключен — строки «расходов» нет', async () => {
  bot.getData().config.calculator.enabled = false;
  const step = await compare(createChat(), [VILLA, FLAT]);
  assert.ok(!step.last.text.includes('Расходы при покупке'));
});

test('на английском и испанском строки называются по-своему', async () => {
  const en = await compare(createChat({ language: 'en' }), [VILLA, FLAT]);
  assert.match(en.last.text, /💶 Price per m²/);
  assert.match(en.last.text, /🧾 Purchase costs/);
  assert.match(en.last.text, /✅ — best value/);
  const es = await compare(createChat({ language: 'es' }), [VILLA, FLAT]);
  assert.match(es.last.text, /💶 Precio por m²/);
  assert.match(es.last.text, /🧾 Gastos de compra/);
});

test('«Обсудить эти объекты» передаёт менеджеру, что сравнивалось, и подтверждает клиенту', async () => {
  const chat = createChat();
  const step = await compare(chat, [VILLA, FLAT]);
  assert.ok(callbacksOf(step.last.markup).includes('compare:discuss'));

  const sent = await chat.press('compare:discuss');
  const [inquiry] = chat.inquiries;
  assert.ok(inquiry, 'заявка создана');
  assert.equal(inquiry.type, 'question');
  assert.match(inquiry.text, /Вилла у моря/);
  assert.match(inquiry.text, /Квартира в центре/);
  assert.match(sent.last.text, /передан/i, 'клиент видит подтверждение');
  assert.ok(adminMessages().some((message) => message.text.includes('Квартира в центре')), 'менеджеру ушло уведомление с названиями');
});

test('без выбранных объектов «Обсудить» не предлагается', async () => {
  const step = await createChat().press('compare:view');
  assert.ok(!callbacksOf(step.last.markup).includes('compare:discuss'));
});
