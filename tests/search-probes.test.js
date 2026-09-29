'use strict';

// Свободный поиск: клиент пишет своими словами, а не нажимает кнопки. Обещание «просто
// напишите, что ищете» держится только если реалистичные фразы разбираются. Здесь —
// набор таких фраз на трёх языках с ожидаемым фильтром. Цель этапа 34: русский ≥ 9 из 11,
// английский и испанский ≥ 7 из 10; фразы, которые разбирать нельзя (вопросы, нет
// признаков), по-прежнему уходят менеджеру.

const test = require('node:test');
const assert = require('node:assert/strict');
// Сначала помощник: он направляет данные во временную папку. Импорт src/*.mjs без него читает живой bot-data.json.
const { callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

const city = (ru, en, es) => ({ ru, en: en || ru, es: es || en || ru });
const records = ['Бенидорм|Benidorm', 'Альтея|Altea', 'Финестрат|Finestrat', 'Кальпе|Calpe'].map((name, index) => {
  const [ru, en] = name.split('|');
  return { id: 'r' + index, city: city(ru, en, en), district: { ru: '', en: '', es: '' } };
});

// [фраза, ожидаемые поля фильтра] — null значит «должна уйти менеджеру».
const PROBES = {
  ru: [
    ['хочу купить квартиру в Бенидорме', { deal: 'sale', type: 'apartment', city: 'Бенидорм' }],
    ['ищу виллу до 500 тысяч', { type: 'villa', maxPrice: 500000 }],
    ['аренда квартиры в Альтее', { deal: 'rent', type: 'apartment', city: 'Альтея' }],
    ['две спальни в Кальпе', { bedrooms: 2, city: 'Кальпе' }],
    ['снять дом у моря', { deal: 'rent', type: 'house' }],
    ['квартира с двумя спальнями в Бенидорме до 300 000', { type: 'apartment', bedrooms: 2, city: 'Бенидорм', maxPrice: 300000 }],
    ['вилла с бассейном в Финестрате', { type: 'villa', city: 'Финестрат' }],
    ['3 спальни Альтея до 400к', { bedrooms: 3, city: 'Альтея', maxPrice: 400000 }],
    ['участок в Кальпе', { type: 'land', city: 'Кальпе' }],
    ['виллу с тремя спальнями рядом с морем', { type: 'villa', bedrooms: 3 }],
    ['есть ли у вас что-нибудь недорогое?', null],
  ],
  en: [
    ['I want to rent in Finestrat', { deal: 'rent', city: 'Finestrat' }],
    ['two bedroom apartment in Benidorm', { type: 'apartment', bedrooms: 2, city: 'Benidorm' }],
    ['3 bed villa near the beach', { type: 'villa', bedrooms: 3 }],
    ['apartments for rent', { deal: 'rent', type: 'apartment' }],
    ['buy a house in Calpe under 300k', { deal: 'sale', type: 'house', city: 'Calpe', maxPrice: 300000 }],
    ['looking for a 2 bed flat to rent in Altea', { deal: 'rent', type: 'apartment', bedrooms: 2, city: 'Altea' }],
    ['plot of land in Calpe', { type: 'land', city: 'Calpe' }],
    ['houses for sale up to 500,000 euros', { deal: 'sale', type: 'house', maxPrice: 500000 }],
    ['I need a three bedroom villa', { type: 'villa', bedrooms: 3 }],
    ['is there anything cheap?', null],
  ],
  es: [
    ['quiero comprar un piso en Benidorm', { deal: 'sale', type: 'apartment', city: 'Benidorm' }],
    ['alquilar apartamento en Altea', { deal: 'rent', type: 'apartment', city: 'Altea' }],
    ['dos dormitorios en Calpe', { bedrooms: 2, city: 'Calpe' }],
    ['villa cerca de la playa en Finestrat', { type: 'villa', city: 'Finestrat' }],
    ['casa hasta 400.000 euros', { type: 'house', maxPrice: 400000 }],
    ['busco un adosado en Altea', { type: 'townhouse', city: 'Altea' }],
    ['piso con dos habitaciones cerca de la playa en Altea', { type: 'apartment', bedrooms: 2, city: 'Altea' }],
    ['piso de 3 dormitorios para alquilar', { type: 'apartment', bedrooms: 3, deal: 'rent' }],
    ['apartamento de tres habitaciones en Altea', { type: 'apartment', bedrooms: 3, city: 'Altea' }],
    ['¿tenéis algo barato?', null],
  ],
};
const GOALS = { ru: 9, en: 7, es: 7 };

async function parse(message, language) {
  const { naturalCatalogFilter } = await import('../src/search.mjs');
  return naturalCatalogFilter(message, records, language);
}

function matches(filter, expected) {
  if (!expected) return filter === null;
  if (!filter) return false;
  return Object.entries(expected).every(([key, value]) => filter[key] === value);
}

for (const language of Object.keys(PROBES)) {
  test('свободный поиск на языке «' + language + '»: разобрано не меньше ' + GOALS[language] + ' из ' + PROBES[language].length, async () => {
    const failed = [];
    let passed = 0;
    for (const [message, expected] of PROBES[language]) {
      const filter = await parse(message, language);
      if (matches(filter, expected)) passed += 1;
      else failed.push(message + ' → ' + JSON.stringify(filter));
    }
    assert.ok(passed >= GOALS[language], passed + ' из ' + PROBES[language].length + '; не разобраны: ' + failed.join(' | '));
  });
}

test('вопросы и «ничего не понятно» по-прежнему уходят менеджеру, а не превращаются в фильтр', async () => {
  for (const [language, list] of Object.entries(PROBES)) {
    for (const [message, expected] of list) {
      if (expected !== null) continue;
      assert.equal(await parse(message, language), null, message);
    }
  }
});

test('«у моря / near the beach / cerca de la playa» — не неизвестное место: фраза не уходит менеджеру из-за него', async () => {
  const filter = await parse('3 bed villa near the beach', 'en');
  assert.ok(filter && filter.type === 'villa' && filter.bedrooms === 3, JSON.stringify(filter));
  assert.equal(filter.city, '', 'пляж — не город: фильтр без города');
  // А настоящее незнакомое место по-прежнему не угадывается.
  assert.equal(await parse('3 bed villa near Madrid', 'en'), null, 'незнакомый город — менеджеру');
});

test('клиент с открытой заявкой перечислил условия, а фраза не разобралась: короткий ответ с «✨ Подбор», а не только 👀', async () => {
  resetData((data) => { data.config.active = true; });
  const chat = createChat();
  await chat.say('Есть ли парковка у виллы?'); // открытая заявка
  const step = await chat.say('ищу дом в Мадриде до 300 тысяч');
  assert.match(step.last.text, /Не совсем понял условия/);
  assert.ok(callbacksOf(step.last.markup).includes('selection:start'), 'кнопка мастера подбора');
  // Обычная реплика без признаков поиска — по-прежнему тихая реакция, без ответа.
  const quiet = await chat.say('Спасибо, жду звонка');
  assert.ok(!/Не совсем понял/.test((quiet.last && quiet.last.text) || ''), 'обычные реплики не задеваем');
});

test('бюджет можно задать первым, до «Продажа / Аренда»: в смешанном каталоге кнопка цены есть, выбор цены сам ставит «Продажа»', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('sale-villa', 'Вилла на продажу', 'active', { dealType: 'sale', propertyType: 'villa', priceValue: 350000, currency: 'EUR', bedrooms: 3 }));
    data.objects.push(property('rent-flat', 'Квартира в аренду', 'active', { dealType: 'rent', propertyType: 'apartment', priceValue: 1200, pricePeriod: 'month', currency: 'EUR', bedrooms: 2 }));
  });
  const chat = createChat();
  const panel = await chat.press('cfilter:open');
  const buttons = panel.last.markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === 'cfilter:prices:0'), 'кнопка бюджета есть без выбора сделки');
  assert.equal(chat.user.catalogFilter && chat.user.catalogFilter.deal || '', '', 'сделка пока не выбрана');
  await chat.press('cfilter:prices:0');
  await chat.press('cfilter:price:400000');
  assert.equal(chat.user.catalogFilter.deal, 'sale', 'выбор бюджета ставит «Продажа»');
  assert.equal(chat.user.catalogFilter.maxPrice, 400000);
});

test('карточка участка и коммерции без спален, санузлов и этажа, даже если в данных стоит 0; у жилья они на месте', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('land-1', 'Участок под виллу', 'active', { propertyType: 'land', plotArea: 1000, area: null, bedrooms: 0, bathrooms: 0, floor: '2', distanceSea: 200, priceValue: 200000, currency: 'EUR' }));
    data.objects.push(property('villa-1', 'Вилла с бассейном', 'active', { propertyType: 'villa', area: 180, bedrooms: 3, bathrooms: 2, floor: '2', priceValue: 500000, currency: 'EUR' }));
  });
  const chat = createChat();
  const land = await chat.press('property:details:land-1');
  const landText = land.text;
  assert.ok(landText.length > 0, 'карточка участка открылась');
  assert.ok(!/Спальн|Bedrooms|Dormitorios|🛏|🚿|🏢/.test(landText), 'у участка нет жилых строк: ' + landText);
  const villa = await chat.press('property:details:villa-1');
  const villaText = villa.text;
  assert.match(villaText, /Спальн[а-я]*: 3/, 'у виллы спальни на месте');
});

test('«Подробнее», открытое не с карточки (после расчёта, похожих, по ссылке), приходит с рядом «Записаться / Связаться»', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('details-x', 'Вилла с описанием', 'active', { priceValue: 300000, currency: 'EUR', area: 120 }));
  });
  const chat = createChat();
  const step = await chat.press('property:details:details-x'); // нажато не под карточкой с фото
  const sent = step.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
  assert.equal(sent.length, 1);
  const buttons = sent[0].body.reply_markup.inline_keyboard.flat().map((button) => button.callback_data || button.url);
  assert.ok(buttons.includes('property:viewing:details-x') && buttons.includes('property:manager:details-x'), 'есть «Записаться» и «Связаться»: ' + buttons.join(', '));
  assert.ok(buttons.includes('property:return:details-x'), 'и возврат к карточке');
});
