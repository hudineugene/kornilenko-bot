'use strict';

// Карточка комплекса из нескольких вариантов: «1–2 спальни», «37–60 м²», «6 км» вместо «6 000 м»; фильтр «2+» находит комплекс,
// у которого есть двухспальные варианты; верхняя граница хранится только когда она больше нижней.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const MENU = bot.text.menu;
const shown = (step) => step.calls.map((call) => String(call.body.caption || call.body.text || '')).join('\n');

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('complex-01', 'Комплекс', 'active', {
    bedrooms: 1, bedroomsMax: 2, area: 37, areaMax: 60, bathrooms: 1, priceValue: 147312, priceFrom: true, distanceSea: 6000,
  }));
  data.objects.push(property('single-02', 'Квартира', 'active', { bedrooms: 1, area: 50, priceValue: 200000, distanceSea: 1500 }));
}));
test.after(cleanup);

test('карточка комплекса показывает диапазон спален и площади; расстояние от километра — в километрах', async () => {
  const chat = createChat();
  const step = await chat.say(MENU.ru.objects);
  const card = shown(step);
  assert.match(card, /🛏 1–2/, 'спальни диапазоном');
  assert.match(card, /📐 37–60 м²/, 'площадь диапазоном');
  assert.match(card, /🌊 6 км/, 'шесть километров, а не «6 000 м»');
});

test('обычный объект без верхней границы показан как прежде; полтора километра — с запятой, в «Подробнее» с подписями', async () => {
  const chat = createChat();
  await chat.say(MENU.ru.objects);
  const next = await chat.press('catalog:all:1');
  const card = next.calls.map((call) => String(call.body.caption || call.body.text || '')).join('\n');
  assert.match(card, /🛏 1 /);
  assert.ok(!/🛏 1–/.test(card));
  assert.match(card, /📐 50 м²/);
  assert.match(card, /🌊 1,5 км/);
  const details = await chat.press('property:details:complex-01');
  const text = details.calls.map((call) => String(call.body.caption || call.body.text || '')).join('\n');
  assert.match(text, /Спальни: 1–2/);
  assert.match(text, /Площадь: 37–60 м²/);
  assert.match(text, /До пляжа: 6 км/);
});

test('на английском и испанском — своё слово и формат числа: «6 km», «1,5 km»', async () => {
  const english = createChat({ language: 'en' });
  const en = await english.say(bot.text.menu.en.objects);
  assert.match(shown(en), /🌊 6 km/);
  assert.match(shown(en), /📐 37–60 m²/);
  const spanish = createChat({ language: 'es' });
  await spanish.say(bot.text.menu.es.objects);
  const es = await spanish.press('catalog:all:1');
  assert.match(es.calls.map((call) => String(call.body.caption || call.body.text || '')).join('\n'), /🌊 1,5 km/);
});

test('фильтр «2+ спальни» находит комплекс с двухспальными вариантами, «3+» — нет', async () => {
  const chat = createChat();
  await chat.say(MENU.ru.objects);
  await chat.press('cfilter:open');
  const two = await chat.press('cfilter:bed:2');
  assert.match(shown(two), /Подходит: 1/, 'остаётся комплекс');
  const three = await chat.press('cfilter:bed:3');
  assert.match(shown(three), /Подходит: 0|Ничего не найдено/);
});

test('сохранение: верхняя граница хранится, только когда больше нижней; в панели — поля «Спален до» и «Площадь до»', () => {
  const data = bot.normalizeLoadedData({
    version: 52,
    objects: [
      { id: 'a', status: 'active', bedrooms: 1, bedroomsMax: 2, area: 37, areaMax: 60, title: { ru: 'A' } },
      { id: 'b', status: 'active', bedrooms: 2, bedroomsMax: 1, area: 50, areaMax: 50, title: { ru: 'B' } },
    ],
  });
  const [a, b] = data.objects;
  assert.equal(a.bedroomsMax, 2);
  assert.equal(a.areaMax, 60);
  assert.ok(!('bedroomsMax' in b) && !('areaMax' in b), 'граница не больше нижней — не хранится');

  const fs = require('node:fs');
  const path = require('node:path');
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-catalog.mjs'), 'utf8');
  assert.match(view, /id="fBedroomsMax"/);
  assert.match(view, /id="fAreaMax"/);
  assert.match(view, /bedroomsMax: dialog\.querySelector\("#fBedroomsMax"\)\.value/);
});
