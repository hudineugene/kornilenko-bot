'use strict';

// «Рынок» в «Подробнее»: цена за м² объекта против обычной по району — по нашему каталогу, не меньше пяти объектов в
// группе, медиана, без сравнения валют и аренды с продажей.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChat, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

const PNG = { id: 'x', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };
const withEs = { imagesByLanguage: { ru: [PNG], en: [PNG], es: [PNG] } };
const where = (district, city = 'Бенидорм') => ({
  city: { ru: city, en: city, es: city },
  district: district ? { ru: district, en: district, es: district } : undefined,
});

// Пять объектов в «Центре»: 3 000, 3 200, 3 400, 3 600, 4 000 €/м² (площадь 100) → медиана 3 400.
function fillCentre(extra = {}) {
  resetData((data) => {
    data.config.active = true;
    [300000, 320000, 340000, 360000, 400000].forEach((price, index) => {
      data.objects.push(property('c' + index, 'Квартира ' + index, 'active', { priceValue: price, area: 100, currency: 'EUR', ...withEs, ...where('Центр'), ...extra }));
    });
  });
}

const detailsText = async (language, id) => {
  const chat = createChat({ language });
  const step = await chat.press('property:details:' + id);
  const call = [...step.calls].reverse().find((item) => item.body && (item.body.text || item.body.caption));
  return String(call.body.text || call.body.caption).replace(/ /g, ' ');
};

test('пять объектов в районе — «Рынок» с обычной ценой и сравнением; по-русски, по-английски и по-испански', async () => {
  fillCentre();
  const cheapest = await detailsText('ru', 'c0');
  assert.match(cheapest, /<b>📊 Рынок<\/b>/);
  assert.match(cheapest, /Центр, Бенидорм: по нашему каталогу обычно ≈ 3 400 €\/м² \(объектов: 5\)/);
  assert.match(cheapest, /Этот объект — на 12% дешевле/, '3 000 против 3 400');

  const dearest = await detailsText('ru', 'c4');
  assert.match(dearest, /на 18% дороже/, '4 000 против 3 400');
  assert.match(await detailsText('ru', 'c2'), /примерно на этом уровне/, 'ровно медиана');

  const en = await detailsText('en', 'c4');
  assert.match(en, /<b>📊 Market<\/b>/);
  assert.match(en, /typically ≈ €3,400\/m² \(5 properties\)/);
  assert.match(en, /This property is 18% more expensive/);
  const es = await detailsText('es', 'c0');
  assert.match(es, /<b>📊 Mercado<\/b>/);
  assert.match(es, /suele rondar 3\.400 €\/m² \(5 inmuebles\)/);
  assert.match(es, /un 12% más barato/);
});

test('меньше пяти объектов — сравнения нет (честнее промолчать)', async () => {
  resetData((data) => {
    data.config.active = true;
    [300000, 320000, 340000, 360000].forEach((price, index) => data.objects.push(property('d' + index, 'Квартира ' + index, 'active', { priceValue: price, area: 100, currency: 'EUR', ...where('Центр') })));
  });
  assert.doesNotMatch(await detailsText('ru', 'd0'), /Рынок/);
});

test('аренда не сравнивается; другая валюта и чужой город в группу не попадают', async () => {
  fillCentre();
  resetData((data) => {
    data.config.active = true;
    [300000, 320000, 340000, 360000].forEach((price, index) => data.objects.push(property('e' + index, 'Квартира ' + index, 'active', { priceValue: price, area: 100, currency: 'EUR', ...where('Центр') })));
    data.objects.push(property('rent', 'Аренда', 'active', { dealType: 'rent', priceValue: 1500, area: 100, currency: 'EUR', ...where('Центр') }));
    data.objects.push(property('usd', 'Доллары', 'active', { priceValue: 500000, area: 100, currency: 'USD', ...where('Центр') }));
    data.objects.push(property('far', 'Другой город', 'active', { priceValue: 900000, area: 100, currency: 'EUR', ...where('Центр', 'Альтеа') }));
  });
  assert.doesNotMatch(await detailsText('ru', 'e0'), /Рынок/, 'их четыре: аренда, доллар и Альтеа в счёт не идут');
  assert.doesNotMatch(await detailsText('ru', 'rent'), /Рынок/, 'для самой аренды сравнения нет');
});

test('мало объектов в районе — берём весь город, и в строке нет района', async () => {
  resetData((data) => {
    data.config.active = true;
    ['Центр', 'Центр', 'Порт', 'Порт', 'Лева'].forEach((district, index) => data.objects.push(property('g' + index, 'Квартира ' + index, 'active', { priceValue: 300000 + index * 20000, area: 100, currency: 'EUR', ...where(district) })));
  });
  const text = await detailsText('ru', 'g0');
  assert.match(text, /Бенидорм: по нашему каталогу обычно ≈ 3 400 €\/м² \(объектов: 5\)/);
  assert.ok(!/Центр, Бенидорм/.test(text.split('Рынок')[1]), 'район не назван: в нём меньше пяти');
});

test('нет площади или цены у самого объекта — сравнения нет', async () => {
  fillCentre();
  resetData((data) => {
    data.config.active = true;
    [300000, 320000, 340000, 360000, 400000].forEach((price, index) => data.objects.push(property('h' + index, 'Квартира ' + index, 'active', { priceValue: price, area: 100, currency: 'EUR', ...where('Центр') })));
    data.objects.push(property('noarea', 'Без площади', 'active', { priceValue: 350000, area: 0, currency: 'EUR', ...where('Центр') }));
  });
  assert.doesNotMatch(await detailsText('ru', 'noarea'), /Рынок/);
});
