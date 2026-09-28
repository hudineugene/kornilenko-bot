'use strict';

// Клиент пишет запрос словами. Раньше «до» находилось внутри «дом» и «надо»,
// поэтому «Дом в Бенидорме, 3 спальни» превращалось в фильтр «до 3 €» и
// каталог отвечал «объектов нет». Бюджет в подборе разбирался третьим кодом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('house-benidorm-01', 'Дом в Бенидорме', 'active', {
    propertyType: 'house', dealType: 'sale', bedrooms: 3, bathrooms: 2, area: 160, priceValue: 420000, currency: 'EUR',
  }));
  data.objects.push(property('flat-benidorm-02', 'Квартира в Бенидорме', 'active', {
    propertyType: 'apartment', dealType: 'sale', bedrooms: 2, bathrooms: 1, area: 70, priceValue: 250000, currency: 'EUR',
  }));
  data.objects.push(property('flat-rent-03', 'Квартира в аренду', 'active', {
    propertyType: 'apartment', dealType: 'rent', bedrooms: 1, bathrooms: 1, area: 55, priceValue: 750, pricePeriod: 'month', currency: 'EUR',
  }));
}));
test.after(cleanup);

test.describe('цена в запросе словами', () => {
  test('«до» внутри слова не становится ценой', () => {
    assert.equal(bot.parseMaxPrice('Дом в Бенидорме, 3 спальни'), 0);
    assert.equal(bot.parseMaxPrice('Надо что-то у моря, 2 спальни'), 0);
    assert.equal(bot.parseMaxPrice('Подойдёт 3 спальни'), 0);
  });

  test('настоящая граница цены читается в любом написании', () => {
    assert.equal(bot.parseMaxPrice('Надо что-то до 300 000 €'), 300000);
    assert.equal(bot.parseMaxPrice('квартира до 300к'), 300000);
    assert.equal(bot.parseMaxPrice('квартира до 300k'), 300000);
    assert.equal(bot.parseMaxPrice('не дороже чем 300 000'), 300000);
    assert.equal(bot.parseMaxPrice('budget up to 1.2 million'), 1200000);
    assert.equal(bot.parseMinPrice('от 200 тыс'), 200000);
  });

  test('«до моря 150 м» и «3 спальни» ценой не считаются', () => {
    assert.equal(bot.parseMaxPrice('до моря 150 м, цена по запросу'), 0);
    assert.equal(bot.parseMaxPrice('до 5 минут от пляжа'), 0);
    assert.equal(bot.parseMaxPrice('до 3'), 0, 'без валюты и масштаба это не цена');
  });

  test('аренда с небольшой суммой сохраняется', () => {
    assert.equal(bot.parseMaxPrice('аренда до 800'), 800);
    assert.equal(bot.parseMaxPrice('alquiler hasta 800 €'), 800);
  });

  test('запрос «Дом в Бенидорме, 3 спальни» находит дом, а не пустоту', async () => {
    const chat = createChat();
    await chat.say('/start');
    telegram.calls = [];
    await chat.say('Дом в Бенидорме, 3 спальни');
    assert.deepEqual(chat.user.catalogFilter, {
      deal: '', type: 'house', bedrooms: 3, city: 'Бенидорм', district: '', minPrice: 0, maxPrice: 0, sort: '',
    });
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['house-benidorm-01']);
    const cards = telegram.calls.filter((call) => call.method === 'sendPhoto');
    assert.equal(cards.length, 1, 'клиент видит карточку, а не «объектов нет»');
    assert.match(cards[0].body.caption, /Дом в Бенидорме/);
  });
});

test.describe('бюджет в подборе разбирается тем же способом', () => {
  const limit = (text) => bot.budgetLimit(text);

  test('привычные написания суммы понимаются', () => {
    assert.equal(limit('до 600 000 €'), 600000);
    assert.equal(limit('1,2 млн'), 1200000);
    assert.equal(limit('600k'), 600000);
    assert.equal(limit('300к'), 300000, 'русская «к» — тоже тысячи');
    assert.equal(limit('€350,000'), 350000, 'запятая как разделитель тысяч');
    assert.equal(limit('до 800'), 800, 'аренда: небольшая сумма не отбрасывается');
  });

  test('слова без суммы не дают границы', () => {
    assert.equal(limit('Бюджет пока не определён'), 0);
    assert.equal(limit(''), 0);
    assert.equal(limit('2 спальни'), 0);
  });

  test('бюджет «300к» в обычном сообщении становится границей поиска', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('Ищу квартиру в Бенидорме до 300к');
    assert.equal(chat.user.catalogFilter.maxPrice, 300000, 'бюджет понят как 300 000');
    assert.equal(chat.user.catalogFilter.type, 'apartment');
    const shown = bot.catalogRecords(chat.user).map((record) => record.id);
    assert.ok(shown.length >= 1, 'квартира за 250 000 попадает в бюджет');
  });
});
