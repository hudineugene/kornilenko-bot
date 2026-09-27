'use strict';

// Расстояние и площадь бот принимал за цену. «до 300 м от моря» становилось
// «до 300 €», «до 150 кв.м» — «до 150 000 €», «до 2 км» — «до 2000 €», а
// «up to 300 m» — «до 300 миллионов». Тем же разборщиком читается бюджет в
// подборе, поэтому клиент получал пустой каталог и не понимал почему.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const FILTER = bot.text.catalogFilter.ru;

let largestMoneyAmount = null;
let parseMaxPrice = null;
let parsePriceRange = null;
test.before(async () => {
  ({ largestMoneyAmount } = await import('../src/util.mjs'));
  ({ parseMaxPrice, parsePriceRange } = await import('../src/search.mjs'));
});

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('flat-measure-01', 'Квартира у моря', 'active', { priceValue: 250000, currency: 'EUR', area: 90, distanceSea: 300 }));
}));
test.after(cleanup);

test('метры и километры не становятся ценой', () => {
  for (const phrase of ['до 300 м от моря', 'не дальше 500 м от пляжа', 'до 2 км до центра', 'up to 300 m from the beach', 'a 300 m de la playa']) {
    assert.equal(largestMoneyAmount(phrase), 0, phrase);
    assert.equal(parseMaxPrice(phrase), 0, phrase);
  }
});

test('площадь не становится ценой', () => {
  for (const phrase of ['до 150 кв.м', 'от 100 кв м', 'квартира 80 м²', 'house up to 200 m2', 'участок 800 соток']) {
    assert.equal(largestMoneyAmount(phrase), 0, phrase);
  }
});

test('настоящие суммы читаются как раньше', () => {
  assert.equal(largestMoneyAmount('до 600 000 €'), 600000);
  assert.equal(largestMoneyAmount('1,2 млн'), 1200000);
  assert.equal(largestMoneyAmount('300к'), 300000);
  assert.equal(largestMoneyAmount('€350,000'), 350000);
  assert.equal(largestMoneyAmount('аренда до 800'), 800);
  assert.equal(parseMaxPrice('квартира до 250к'), 250000);
  assert.equal(parseMaxPrice('бюджет до 400 тыс'), 400000);
  assert.deepEqual(parsePriceRange('от 300к до 500к'), { minPrice: 300000, maxPrice: 500000 });
  assert.deepEqual(parsePriceRange('от 300 до 500 тыс'), { minPrice: 300000, maxPrice: 500000 });
});

test('поиск фразой про расстояние не сужает каталог по цене', async () => {
  const chat = createChat();
  const step = await chat.say('квартира не дальше 300 м от моря');
  // Раньше фраза превращалась в «цена до 300 €», и каталог оказывался пустым.
  assert.ok(!/300\s*€/.test(step.text), 'бот не выдумывает цену 300 €: ' + step.text);
});

test('«своя цена» в фильтре не принимает метры и опечатки', async () => {
  const chat = createChat();
  await chat.press('cfilter:deal:sale');
  await chat.press('cfilter:price:custom');
  const measured = await chat.say('300 м');
  assert.equal(measured.last.text, FILTER.invalidCustomPrice, 'метры — не цена');
  const typo = await chat.say('5');
  assert.equal(typo.last.text, FILTER.invalidCustomPrice, 'пять евро — не цена объекта');
  const real = await chat.say('250 000 €');
  assert.equal(chat.user.catalogFilter.maxPrice, 250000, 'настоящая цена принимается');
});
