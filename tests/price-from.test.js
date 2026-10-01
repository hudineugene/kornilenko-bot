'use strict';

// Цена «от»: у комплекса из нескольких квартир на карточке цена самого дешёвого варианта — со словом «от».

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('complex', 'Комплекс', 'active', { priceValue: 147312, currency: 'EUR', priceFrom: true }));
  data.objects.push(property('flat', 'Квартира', 'active', { priceValue: 200000, currency: 'EUR' }));
}));

test('карточка и «Подробнее» на трёх языках: со словом «от» только у комплекса', async () => {
  for (const [language, from] of [['ru', 'от'], ['en', 'from'], ['es', 'desde']]) {
    const chat = createChat({ language });
    telegram.calls = [];
    await chat.say(bot.text.menu[language].objects);
    const shown = telegram.calls.map((call) => call.body.caption || call.body.text || '').filter((text) => /147/.test(text)).join(' | ');
    assert.ok(shown.includes(from + ' '), language + ': ' + shown);
    const flat = bot.getData().objects.find((item) => item.id === 'flat');
    assert.equal(bot.objectPriceText(flat, language).includes(from + ' '), false, 'у обычной квартиры слова «' + from + '» нет');
  }
});

test('поле сохраняется, читается из панели и по умолчанию выключено', () => {
  const body = { title: { ru: 'Комплекс' }, priceValue: '95000', currency: 'EUR', priceFrom: true, propertyType: 'apartment' };
  assert.equal(bot.parseContentRecord(body, 'objects').priceFrom, true);
  assert.equal(bot.parseContentRecord({ ...body, priceFrom: 'true' }, 'objects').priceFrom, false, 'только настоящее «да»');
  assert.equal(bot.parseContentRecord({ ...body, priceFrom: undefined }, 'objects').priceFrom, false);
  const loaded = bot.normalizeLoadedData({ objects: [{ id: 'x', title: { ru: 'x' }, priceFrom: true }, { id: 'y', title: { ru: 'y' } }] });
  assert.equal(loaded.objects[0].priceFrom, true);
  assert.equal(loaded.objects[1].priceFrom, false);
});

test('цена по запросу и текстовая цена слова «от» не получают', () => {
  const noPrice = { priceFrom: true, priceValue: null, price: { ru: '', en: '', es: '' }, currency: 'EUR' };
  assert.equal(bot.objectPriceText(noPrice, 'ru'), 'Цена по запросу');
});
