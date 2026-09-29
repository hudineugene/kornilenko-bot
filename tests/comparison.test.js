'use strict';

// A mobile-friendly shortlist: add from a property card, compare the same
// criteria in one message, open a selected property and remove it again.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU, comparison: COMPARE } = bot.text;

function comparisonCatalog(data) {
  data.objects.push(property('compare-villa-a', 'Вилла у моря', 'active', {
    propertyType: 'villa',
    priceValue: 650000,
    currency: 'EUR',
    area: 180,
    plotArea: 500,
    bedrooms: 4,
    bathrooms: 3,
    condition: 'renovated',
    district: { ru: 'Золотая Миля', en: 'Golden Mile', es: 'Milla de Oro' },
    distanceSea: 350,
  }));
  data.objects.push(property('compare-flat-b', 'Квартира в центре', 'active', {
    propertyType: 'apartment',
    priceValue: 320000,
    currency: 'EUR',
    area: 92,
    bedrooms: 2,
    bathrooms: 2,
    condition: 'new',
    floor: '3',
  }));
  data.objects.push(property('compare-house-c', 'Дом с садом', 'active', {
    propertyType: 'house', priceValue: 470000, area: 140, plotArea: 250, bedrooms: 3, bathrooms: 2,
  }));
  data.objects.push(property('compare-flat-d', 'Ещё одна квартира', 'active', {
    priceValue: 280000, area: 75, bedrooms: 2, bathrooms: 1,
  }));
}

test.beforeEach(() => resetData(comparisonCatalog));
test.after(cleanup);

test('properties are added from the card and compared by consistent criteria', async () => {
  const chat = createChat();
  const catalog = await chat.say(MENU.ru.objects);
  const firstCard = catalog.calls.find((call) => call.method === 'sendPhoto');
  assert.ok(callbacksOf(firstCard.body.reply_markup).includes('property:compare:compare-villa-a'));
  assert.ok(firstCard.body.reply_markup.inline_keyboard.flat().some((button) => button.text === '⚖️'), 'на карточке значок сравнения');

  let step = await chat.press('property:compare:compare-villa-a');
  assert.deepEqual(chat.user.comparisonIds, ['compare-villa-a']);
  assert.deepEqual(step.popups, ['Добавлено к сравнению: 1 из 3']);
  const changedCard = step.calls.find((call) => call.method === 'editMessageReplyMarkup');
  assert.ok(changedCard.body.reply_markup.inline_keyboard.flat().some((button) => button.text === '⚖️ · 1'), 'выбранный объект показан счётчиком');
  assert.ok(callbacksOf(changedCard.body.reply_markup).includes('compare:view'), 'the selected button opens comparison without a second toggle');

  step = await chat.press('property:compare:compare-villa-a');
  assert.match(step.last.text, /^⚖️ Сравнение объектов\nВыбрано: 1 из 3/);
  assert.ok(step.last.text.includes(COMPARE.ru.needMore));
  assert.ok(callbacksOf(step.last.markup).includes('catalog:comparison:0'));
  assert.ok(callbacksOf(step.last.markup).includes('compare:remove:compare-villa-a'));

  await chat.press('property:compare:compare-flat-b');
  step = await chat.press('compare:view');
  assert.match(step.last.text, /^⚖️ Сравнение объектов\nВыбрано: 2 из 3/);
  assert.ok(step.last.text.includes('1️⃣ Вилла у моря'));
  assert.ok(step.last.text.includes('2️⃣ Квартира в центре'));
  assert.match(step.last.text, /💰 Цена\n1️⃣ 650\s000 €\n2️⃣ ✅ 320\s000 €/, 'лучшая (меньшая) цена помечена ✅');
  assert.match(step.last.text, /📐 Площадь\n1️⃣ ✅ 180 м²\n2️⃣ 92 м²/);
  assert.match(step.last.text, /🔑 Состояние\n1️⃣ После ремонта\n2️⃣ Новое/);

  const opened = await chat.press('catalog:comparison:1');
  const openedCard = opened.calls.find((call) => ['editMessageMedia', 'sendPhoto'].includes(call.method));
  const media = typeof openedCard.body.media === 'string' ? JSON.parse(openedCard.body.media) : openedCard.body.media;
  const caption = openedCard.body.caption || (media && media.caption) || '';
  assert.ok(caption.startsWith('<i>' + COMPARE.ru.title + '</i>'));
  assert.ok(caption.includes('<b>Квартира в центре</b>'));
  assert.ok(callbacksOf(openedCard.body.reply_markup).includes('compare:view'));
});

test('the list is unique, limited to three and forgets unavailable properties', async () => {
  const chat = createChat();
  await chat.press('property:compare:compare-villa-a');
  await chat.press('property:compare:compare-flat-b');
  await chat.press('property:compare:compare-house-c');
  const limited = await chat.press('property:compare:compare-flat-d');
  assert.deepEqual(limited.popups, [COMPARE.ru.limit]);
  assert.deepEqual(chat.user.comparisonIds, ['compare-villa-a', 'compare-flat-b', 'compare-house-c']);

  bot.getData().objects.find((record) => record.id === 'compare-house-c').status = 'hidden';
  let step = await chat.press('compare:view');
  assert.deepEqual(chat.user.comparisonIds, ['compare-villa-a', 'compare-flat-b']);
  assert.ok(!step.last.text.includes('Дом с садом'));

  step = await chat.press('compare:remove:compare-flat-b');
  assert.deepEqual(step.popups, [COMPARE.ru.removed]);
  assert.deepEqual(chat.user.comparisonIds, ['compare-villa-a']);
  assert.ok(!step.last.text.includes('Квартира в центре'));

  step = await chat.press('compare:clear');
  assert.deepEqual(step.popups, [COMPARE.ru.cleared]);
  assert.deepEqual(chat.user.comparisonIds, []);
  assert.ok(step.last.text.includes(COMPARE.ru.empty));
  assert.deepEqual(callbacksOf(step.last.markup), ['catalog:all:0', 'nav:my']);
});

test('My space shows the comparison count and the result follows the client language', async () => {
  const chat = createChat({ language: 'en' });
  await chat.press('property:compare:compare-villa-a');
  await chat.press('property:compare:compare-flat-b');
  let step = await chat.say(MENU.en.more);
  assert.ok(step.last.buttons.includes(COMPARE.en.menuButton + ' · 2'));
  step = await chat.press('compare:view');
  assert.match(step.last.text, /^⚖️ Property comparison\nSelected: 2 of 3/);
  assert.ok(step.last.text.includes('🏠 Type and deal'));
  assert.ok(step.last.text.includes('Villa · For sale'));
});

test('saved comparison ids are deduplicated and capped on load', () => {
  const loaded = bot.normalizeLoadedData({
    version: 19,
    users: { one: { id: 'one', comparisonIds: ['a', 'a', 'b', 'c', 'd'] } },
  });
  assert.deepEqual(loaded.users.one.comparisonIds, ['a', 'b', 'c']);
});

test('сравнение компактное: до 520 знаков (было ~710) и не больше шести рядов кнопок, без строк «Доступность» и «Номер объекта»', async () => {
  const chat = createChat();
  await chat.say(MENU.ru.objects);
  await chat.press('property:compare:compare-villa-a');
  await chat.press('property:compare:compare-flat-b');
  const step = await chat.press('compare:view');
  const text = step.last.text;
  assert.ok(!text.includes(COMPARE.ru.reference) && !text.includes(COMPARE.ru.status), 'строк «Доступность» и «Номер объекта» нет: ' + text);
  assert.ok(!text.includes(COMPARE.ru.intro), 'очевидная вводная фраза убрана');
  const rows = step.last.markup.inline_keyboard;
  assert.ok(rows.length <= 6, 'рядов кнопок: ' + rows.length);
  assert.ok(text.length <= 520, 'знаков: ' + text.length + '\n' + text);
  // По одному ряду на объект: «Открыть» и «Убрать» рядом.
  assert.deepEqual(rows[0].map((button) => button.callback_data), ['catalog:comparison:0', 'compare:remove:compare-villa-a']);
  assert.equal(rows[rows.length - 1][0].text, '⬅️ ' + COMPARE.ru.back, 'возврат называется «Назад», а не «Моё»');
});
