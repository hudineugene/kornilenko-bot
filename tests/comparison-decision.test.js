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

// Блок одного объекта: строки от «1️⃣ Название» до пустой строки. Сравнение — по блоку на объект, а не по столбику
// на критерий: три объекта по десять критериев были шестьюдесятью строками.
function blockOf(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^[123]️⃣ /.test(line) && line.includes(title));
  assert.ok(start >= 0, 'нет блока: ' + title);
  const end = lines.findIndex((line, index) => index > start && line === '');
  return lines.slice(start, end < 0 ? lines.length : end);
}

test('«цена за м²» и «расходы при покупке» — в блоке объекта; лучшее значение помечено ★', async () => {
  const step = await compare(createChat(), [VILLA, FLAT]);
  const text = step.last.text;
  const villa = blockOf(text, 'Вилла у моря');
  const flat = blockOf(text, 'Квартира в центре');

  assert.match(villa.join('\n'), /650\s000 € · 3\s611 €\/м²/, 'вилла: 650 000 / 180 ≈ 3 611');
  assert.match(flat.join('\n'), /320\s000 € ★ · 3\s478 €\/м² ★/, 'квартира дешевле и за всё, и за метр: 320 000 / 92 ≈ 3 478');
  assert.ok(!/650\s000 € ★/.test(villa.join('\n')), 'у виллы цена не лучшая');
  assert.ok(villa.some((line) => line.includes('📐') && line.includes('★')), 'больше площадь — у виллы');
  assert.ok(!flat.some((line) => line.includes('📐') && line.includes('★')));
  assert.ok(villa.some((line) => /^🧾 ≈ /.test(line) && !line.includes('★')));
  assert.ok(flat.some((line) => /^🧾 ≈ /.test(line) && line.includes('★')), 'расходы ниже у более дешёвого объекта');

  assert.match(text, /★ — лучшее из сравниваемых/, 'внизу — что означает звёздочка');
  assert.ok(text.split('\n').length <= 30, 'сравнение помещается в 30 строк: ' + text.split('\n').length);
});

test('одно значение сравнивать не с чем: звёздочки нет (расстояние до моря указано только у виллы)', async () => {
  const step = await compare(createChat(), [VILLA, FLAT]);
  const sea = blockOf(step.last.text, 'Вилла у моря').filter((line) => line.includes('🌊'));
  assert.ok(sea.length === 1 && !sea[0].includes('★'), sea.join(' | '));
});

test('один объект — без звёздочек и без легенды', async () => {
  const step = await compare(createChat(), [VILLA]);
  assert.ok(!step.last.text.includes('★'), 'выбирать не из чего');
});

test('поровну — тоже не «лучше»', async () => {
  bot.getData().objects.find((item) => item.id === FLAT).area = 180;
  bot.getData().objects.find((item) => item.id === FLAT).priceValue = 650000;
  const step = await compare(createChat(), [VILLA, FLAT]);
  assert.ok(!step.last.text.includes('★'), 'все значения равны');
});

test('цены в разных валютах и аренда рядом с продажей не сравниваются: без звёздочек на деньгах', async () => {
  bot.getData().objects.find((item) => item.id === FLAT).currency = 'USD';
  let step = await compare(createChat(), [VILLA, FLAT]);
  const priceLines = ['Вилла у моря', 'Квартира в центре'].map((title) => blockOf(step.last.text, title)[1]);
  assert.ok(priceLines.every((line) => !line.includes('★')), 'валюты разные: ' + priceLines.join(' | '));
  assert.ok(!/€\/м².*\n[\s\S]*\$\/м²/.test(step.last.text) && !/3\s478/.test(step.last.text), 'и цена за метр не считается');

  bot.getData().objects.find((item) => item.id === FLAT).currency = 'EUR';
  bot.getData().objects.find((item) => item.id === FLAT).dealType = 'rent';
  step = await compare(createChat(), [VILLA, FLAT]);
  assert.ok(!/3\s478/.test(step.last.text), 'аренда и продажа — разные вещи');
});

test('калькулятор выключен — строки «расходов» нет', async () => {
  bot.getData().config.calculator.enabled = false;
  const step = await compare(createChat(), [VILLA, FLAT]);
  assert.ok(!step.last.text.includes('🧾'));
});

test('на английском и испанском — своя легенда и свои единицы', async () => {
  const en = await compare(createChat({ language: 'en' }), [VILLA, FLAT]);
  assert.match(en.last.text, /€3,478\/m²/);
  assert.match(en.last.text, /★ — best of the compared/);
  assert.match(en.last.text, /Villa · For sale/);
  const es = await compare(createChat({ language: 'es' }), [VILLA, FLAT]);
  assert.match(es.last.text, /3\.478 €\/m²/);
  assert.match(es.last.text, /★ — el mejor de los comparados/);
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
