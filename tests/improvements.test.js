'use strict';

// Language from Telegram, translation hints, persistent panel sessions,
// unclean-shutdown notice, favourite and selection alerts, lead sources and
// catalog filters.

const test = require('node:test');
const assert = require('node:assert/strict');

// A stand-in for cloudflared.exe: the tunnel code only checks that it exists;
// the process itself is replaced by a fake in the tests.
const fakeCloudflared = require('node:path').join(require('node:os').tmpdir(), 'fake-cloudflared-' + process.pid + '.exe');
require('node:fs').writeFileSync(fakeCloudflared, 'not a real program');
process.env.CLOUDFLARED_PATH = fakeCloudflared;

const {
  bot, telegram, TOKEN, dataFile, callbacksOf, buttonsOf, createChat, property, resetData, adminMessages, settle, cleanup,
} = require('./helpers/chat');

const { menu: MENU } = bot.text;

test.after(cleanup);

// A client who has never written to the bot.
let nextNewcomer = 81000001;
function newcomer(languageCode, firstName = 'Новый') {
  const id = nextNewcomer++;
  const from = { id, first_name: firstName, language_code: languageCode };
  let messageId = 1;
  return {
    id,
    get user() {
      return bot.userById(String(id));
    },
    async say(text) {
      telegram.calls = [];
      messageId += 1;
      await bot.processUpdates([{ update_id: id * 100 + messageId, message: { message_id: messageId, date: Math.floor(Date.now() / 1000), from, chat: { id, type: 'private' }, text } }], TOKEN);
      await settle();
      return telegram.calls.filter((call) => ['sendMessage', 'sendPhoto'].includes(call.method) && String(call.body.chat_id) === String(id));
    },
  };
}

test.describe('language from Telegram', () => {
  test.beforeEach(() => resetData());

  test('a Russian Telegram gets the Russian welcome right away', async () => {
    const client = newcomer('ru');
    const sent = await client.say('/start');
    assert.equal(client.user.preferredLanguage, 'ru');
    assert.equal(sent.length, 2, 'приветствие и вопрос о цели');
    assert.match(sent[0].body.text, /^Здравствуйте, Новый!/);
    assert.ok(buttonsOf(sent[0].body.reply_markup).includes(MENU.ru.more), 'the language can still be changed in «My space»');
  });

  test('regional codes such as en-US count as English', async () => {
    const client = newcomer('en-US', 'John');
    const sent = await client.say('/start');
    assert.equal(client.user.preferredLanguage, 'en');
    assert.match(sent[0].body.text, /^Hello, John!/);
  });

  test('a neighbouring language gets the Russian welcome, not a language screen', async () => {
    const client = newcomer('uk');
    const sent = await client.say('/start');
    assert.equal(client.user.preferredLanguage, 'ru', 'украинскому Telegram русский ближе английского');
    assert.match(sent[0].body.text, /^Здравствуйте/);
    assert.ok(buttonsOf(sent[0].body.reply_markup).includes(MENU.ru.language), 'язык угадан — кнопка «🌐» сразу в приветствии');
  });

  test('any other language gets the English welcome with a language button', async () => {
    const client = newcomer('de', 'Hans');
    const sent = await client.say('/start');
    assert.equal(client.user.preferredLanguage, 'en');
    assert.match(sent[0].body.text, /^Hello, Hans!/);
    assert.ok(buttonsOf(sent[0].body.reply_markup).includes(MENU.en.language));
    // И передумать можно словом, не только кнопкой.
    const switched = await client.say('Español');
    assert.equal(client.user.preferredLanguage, 'es');
    assert.match(switched[switched.length - 1].body.text, /^¡Hola/);
  });

  test('a first message that is a question is greeted and answered', async () => {
    const client = newcomer('es', 'Lucía');
    const sent = await client.say('¿Tienen pisos en Benidorm?');
    assert.equal(client.user.preferredLanguage, 'es');
    assert.match(sent[0].body.text, /^¡Hola, Lucía!/);
    assert.equal(bot.getData().inquiries.filter((item) => item.userId === String(client.id)).length, 1);
  });

  test('/language on the first contact shows the picker', async () => {
    const client = newcomer('ru');
    const sent = await client.say('/language');
    assert.deepEqual(callbacksOf(sent[0].body.reply_markup), ['language:ru', 'language:en', 'language:es']);
  });
});

test.describe('panel sessions', () => {
  const http = require('node:http');
  const fs = require('node:fs');
  const path = require('node:path');
  const sessionsFile = path.join(path.dirname(dataFile), 'bot-sessions.json');
  let baseUrl;

  function local(method, url, { cookie = '', csrf = '', body } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(baseUrl + url, { method, headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject);
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  }

  // What a restart does to the sessions: memory is empty, the file is read back.
  function restart() {
    Map.prototype.clear.call(bot.sessions);
    bot.sessions.load();
  }

  test.before(async () => {
    resetData((data) => {
      const password = bot.hashPassword('correct-password');
      data.config.passwordSalt = password.salt;
      data.config.passwordHash = password.hash;
    });
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + bot.server.address().port;
  });
  test.after(() => bot.server.close());

  test('a login survives a restart, and the file holds no usable cookie', async () => {
    const login = await local('POST', '/api/login', { body: { password: 'correct-password' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    assert.ok(!fs.readFileSync(sessionsFile, 'utf8').includes(cookie.split('=')[1]), 'the raw cookie is not stored');

    restart();
    const state = await local('GET', '/api/state', { cookie });
    assert.equal(state.status, 200);

    const { csrf } = JSON.parse(state.body);
    assert.equal((await local('POST', '/api/logout', { cookie, csrf })).status, 200);
    restart();
    assert.equal((await local('GET', '/api/state', { cookie })).status, 401, 'logging out is remembered too');
  });

  test('expired sessions are not restored', () => {
    fs.writeFileSync(sessionsFile, JSON.stringify({
      ['a'.repeat(64)]: { csrf: 'x', expiresAt: Date.now() - 1000 },
      ['b'.repeat(64)]: { csrf: 'y', expiresAt: Date.now() + 60000 },
    }));
    restart();
    assert.deepEqual(Array.from(bot.sessions.keys()), ['b'.repeat(64)]);
  });
});

test.describe('abrupt stop notice', () => {
  test.beforeEach(() => resetData());

  test('the marker of a run that did not shut down is found at the next start', () => {
    bot.writeRunMarker(new Date(Date.now() - 30 * 60 * 1000), new Date(Date.now() - 5 * 60 * 1000));
    const previous = bot.previousRunEndedAbruptly();
    assert.ok(previous && previous.lastAliveAt instanceof Date);
    bot.clearRunMarker();
    assert.equal(bot.previousRunEndedAbruptly(), null);
  });

  test('the notice gives the stop time and whether messages were kept', () => {
    const now = new Date(2026, 8, 18, 9, 28);
    const short = bot.abruptStopNotice({ lastAliveAt: new Date(2026, 8, 18, 9, 22) }, now);
    assert.match(short, /около (\d\d\.\d\d )?09:22/);
    assert.match(short, /Снова работает с (\d\d\.\d\d )?09:28/);
    assert.match(short, /Telegram сохранил/);
    assert.match(bot.abruptStopNotice({ lastAliveAt: new Date(2026, 8, 16, 9, 0) }, now), /больше суток/);
  });

  test('the admin gets the notice and it is kept in the error log', async () => {
    await bot.reportAbruptStop({ lastAliveAt: new Date(Date.now() - 10 * 60 * 1000) }, TOKEN);
    assert.match(adminMessages()[0].text, /^⚠️ Бот был остановлен нештатно/);
    assert.equal(bot.getData().errors[0].area, 'Нештатная остановка');
  });
});

test.describe('property alerts', () => {
  const ALERTS = bot.text.propertyAlerts;
  const SELECTION = bot.text.selection.ru;

  test.beforeEach(() => resetData((data) => {
    const password = bot.hashPassword('x');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.config.active = true;
    data.objects.push(property('villa-a', 'Вилла в Финестрате', 'active', {
      dealType: 'sale', bedrooms: 3, priceValue: 500000, currency: 'EUR',
      city: { ru: 'Финестрат', en: 'Finestrat', es: 'Finestrat' },
    }));
  }));

  function user(id, extra = {}) {
    const record = { id: String(id), chatId: id, firstName: 'U' + id, preferredLanguage: 'ru', favorites: [], activity: [], ...extra };
    bot.getData().users[String(id)] = record;
    return record;
  }

  function selection(userId, values, createdAt = new Date().toISOString()) {
    bot.getData().inquiries.push({ id: 'sel-' + userId, userId: String(userId), chatId: String(userId), language: 'ru', type: 'selection', status: 'new', text: 'Подбор', selection: values, replies: [], createdAt, updatedAt: createdAt });
  }

  function wishes(values) {
    return { deal: SELECTION.dealOptions[0], location: SELECTION.anyLocation, budget: SELECTION.noBudget, bedrooms: SELECTION.bedroomOptions[4], ...values };
  }

  test('a price drop reaches the clients who keep the property in favourites', async () => {
    const fan = user(9101, { favorites: ['villa-a'] });
    user(9102, { favorites: ['villa-a'], propertyAlerts: false });
    user(9103, { favorites: ['villa-a'], blocked: true });
    // У объекта нет своих испанских фотографий — но они общие, поэтому
    // испанская карточка готова и клиент получает уведомление.
    const spanish = user(9104, { favorites: ['villa-a'], preferredLanguage: 'es' });
    user(9105);
    const record = bot.getData().objects[0];
    record.priceValue = 450000;
    const deliveries = bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 500000 });
    assert.deepEqual(deliveries.map((delivery) => delivery.user.id), [fan.id, spanish.id], 'opted out and blocked clients are skipped');
    assert.match(deliveries[0].heading, new RegExp('^' + ALERTS.ru.priceDrop));
    assert.equal(deliveries[0].heading, ALERTS.ru.priceDrop, 'прежняя цена — на карточке зачёркнутой, в заголовке её нет');

    telegram.calls = [];
    assert.equal(await bot.deliverPropertyAlerts(deliveries, TOKEN), 2);
    const [card] = telegram.calls.filter((call) => call.method === 'sendPhoto');
    assert.equal(String(card.body.chat_id), fan.id);
    assert.ok(card.body.caption.startsWith('<i>' + ALERTS.ru.priceDrop));
    assert.equal(card.body.parse_mode, 'HTML');
    assert.ok(callbacksOf(card.body.reply_markup).includes('alerts:off'));
    assert.deepEqual(bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 500000 }), [], 'the same drop is not announced twice');
  });

  test('a client whose language has no card text is still skipped', async () => {
    const fan = user(9111, { favorites: ['villa-a'] });
    const spanish = user(9112, { favorites: ['villa-a'], preferredLanguage: 'es' });
    const record = bot.getData().objects[0];
    // Фотографии общие, а текста на испанском нет — такую карточку не шлём.
    record.description = { ...record.description, es: '' };
    record.priceValue = 450000;
    const deliveries = bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 500000 });
    assert.deepEqual(deliveries.map((delivery) => delivery.user.id), [fan.id], 'клиент без описания на своём языке пропущен');
    assert.ok(!deliveries.some((delivery) => delivery.user.id === spanish.id));
  });

  test('a higher or unchanged price sends nothing', () => {
    user(9111, { favorites: ['villa-a'] });
    const record = bot.getData().objects[0];
    assert.deepEqual(bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 400000 }), []);
    assert.deepEqual(bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 500000 }), []);
  });

  test('a favourite that is available again is announced', () => {
    user(9121, { favorites: ['villa-a'] });
    const [delivery] = bot.propertyAlertDeliveries(bot.getData().objects[0], { status: 'reserved', priceValue: 500000 });
    assert.equal(delivery.heading, ALERTS.ru.backAvailable);
  });

  test('a new property reaches clients whose selection request it matches', () => {
    user(9131); selection(9131, wishes({ location: 'Финестрат, у моря', budget: 'до 600 000 €', bedrooms: SELECTION.bedroomOptions[2] }));
    user(9132); selection(9132, wishes({}));
    user(9133); selection(9133, wishes({ deal: SELECTION.dealOptions[1] }));
    user(9134); selection(9134, wishes({ budget: 'до 300 000 €' }));
    user(9135); selection(9135, wishes({ location: 'Марбелья' }));
    user(9136); selection(9136, wishes({ bedrooms: SELECTION.bedroomOptions[3] }));
    user(9137); selection(9137, wishes({ deal: SELECTION.dealOptions[2] }), new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString());
    const deliveries = bot.propertyAlertDeliveries(bot.getData().objects[0], null);
    assert.deepEqual(deliveries.map((delivery) => delivery.user.id).sort(), ['9131', '9132']);
    assert.equal(deliveries[0].heading, ALERTS.ru.newMatch);
  });

  test('an incomplete residential card is not advertised', () => {
    user(9141); selection(9141, wishes({ budget: 'до 200 000', bedrooms: SELECTION.bedroomOptions[3] }));
    const record = bot.getData().objects[0];
    record.priceValue = null;
    record.bedrooms = null;
    assert.equal(bot.propertyAlertDeliveries(record, null).length, 0);
  });

  test('a client with both a favourite and a matching request gets one alert', () => {
    user(9151, { favorites: ['villa-a'] });
    selection(9151, wishes({}));
    const deliveries = bot.propertyAlertDeliveries(bot.getData().objects[0], { status: 'hidden', priceValue: 500000 });
    assert.deepEqual(deliveries.map((delivery) => delivery.heading), [ALERTS.ru.backAvailable]);
  });

  test('alerts are not queued while the bot is switched off', () => {
    user(9161, { favorites: ['villa-a'] });
    bot.getData().config.active = false;
    assert.equal(bot.queuePropertyAlerts(bot.getData().objects[0], { status: 'reserved', priceValue: 1 }), 0);
  });

  test('"stop these notifications" is remembered across later messages', async () => {
    const chat = createChat();
    chat.user.favorites = ['villa-a'];
    const off = await chat.press('alerts:off');
    assert.equal(off.last.text, ALERTS.ru.turnedOff);
    assert.deepEqual(callbacksOf(off.last.markup), ['alerts:on']);
    await chat.say('Добрый день');
    assert.equal(chat.user.propertyAlerts, false);
    assert.deepEqual(bot.propertyAlertDeliveries(bot.getData().objects[0], { status: 'reserved', priceValue: 1 }), []);
    const on = await chat.press('alerts:on');
    assert.equal(on.last.text, ALERTS.ru.turnedOn);
    assert.equal(chat.user.propertyAlerts, true);
  });

  test('budget amounts are read in the usual ways of writing them', () => {
    assert.equal(bot.budgetLimit('до 600 000 €'), 600000);
    assert.equal(bot.budgetLimit('1,2 млн'), 1200000);
    assert.equal(bot.budgetLimit('600k'), 600000);
    assert.equal(bot.budgetLimit('600 mil'), 600000);
    assert.equal(bot.budgetLimit('2 millones'), 2000000);
    assert.equal(bot.budgetLimit('от 300 до 450 тыс'), 450000);
    assert.equal(bot.budgetLimit('Бюджет пока не определён'), 0);
  });

  test('price ranges are read in Russian, English and Spanish without mistaking dates for money', () => {
    assert.deepEqual(bot.parsePriceRange('от 300 до 500 тыс. €'), { minPrice: 300000, maxPrice: 500000 });
    assert.deepEqual(bot.parsePriceRange('€300k–€500k'), { minPrice: 300000, maxPrice: 500000 });
    assert.deepEqual(bot.parsePriceRange('between 0.3 and 0.5 million euros'), { minPrice: 300000, maxPrice: 500000 });
    assert.deepEqual(bot.parsePriceRange('entre 300 y 500 mil euros'), { minPrice: 300000, maxPrice: 500000 });
    assert.deepEqual(bot.parsePriceRange('300 000-500 000'), { minPrice: 300000, maxPrice: 500000 });
    assert.equal(bot.parseMinPrice('цена от 350 тыс.'), 350000);
    assert.equal(bot.parseMaxPrice('budget from 300k'), 0, 'a lower boundary is not silently turned into a maximum');
    assert.equal(bot.parsePriceRange('с 2026–2027 года'), null);
    assert.equal(bot.parseMinPrice('от 3 спален'), 0);
  });

  test('selection results distinguish exact, close and useful alternatives', () => {
    const baseSelection = {
      deal: SELECTION.dealOptions[0],
      type: SELECTION.typeOptions[1],
      location: 'Марбелья',
      budget: 'до 600 000 €',
      bedrooms: SELECTION.bedroomOptions[2],
    };
    const request = { language: 'ru', selection: baseSelection };
    const exact = property('exact-villa', 'Точная вилла', 'active', {
      dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: 550000, currency: 'EUR',
      city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
    });
    assert.deepEqual(bot.selectionEvaluation(request, exact), {
      tier: 'exact', score: 100,
      reasons: ['deal', 'type', 'location', 'budget', 'bedrooms'], warnings: [],
    });

    const missingPrice = { ...exact, id: 'missing-price', priceValue: null };
    const close = bot.selectionEvaluation(request, missingPrice);
    assert.equal(close.tier, 'close');
    assert.ok(close.warnings.includes('priceMissing'));
    assert.equal(bot.selectionMatches(request, missingPrice), false, 'an incomplete card is not pushed as an exact alert');

    const otherCurrency = { ...exact, id: 'other-currency', currency: 'USD' };
    assert.equal(bot.selectionEvaluation(request, otherCurrency).tier, 'close');
    assert.ok(bot.selectionEvaluation(request, otherCurrency).warnings.includes('currency'));

    const otherArea = { ...exact, id: 'other-area', city: { ru: 'Эстепона', en: 'Estepona', es: 'Estepona' } };
    assert.equal(bot.selectionEvaluation(request, otherArea).tier, 'close');
    assert.ok(bot.selectionEvaluation(request, otherArea).warnings.includes('location'));

    const tooExpensive = { ...exact, id: 'too-expensive', priceValue: 900000 };
    assert.equal(bot.selectionEvaluation(request, tooExpensive), null);

    const rentRequest = { language: 'ru', selection: {
      deal: SELECTION.dealOptions[1], type: SELECTION.typeOptions[1], location: SELECTION.anyLocation,
      budget: 'до 5 000 € в месяц', bedrooms: SELECTION.bedroomOptions[4],
    } };
    const weeklyRent = { ...exact, id: 'weekly-rent', dealType: 'rent', priceValue: 1000, pricePeriod: 'week' };
    const converted = bot.selectionEvaluation(rentRequest, weeklyRent);
    assert.equal(converted.tier, 'exact');
    assert.ok(converted.warnings.includes('periodConverted'), 'a weekly rent is compared with the monthly budget after conversion');
  });

  test('location matching ignores accents and ranking always puts exact results first', () => {
    assert.equal(bot.locationMatches('Malaga centro', property('accented', 'Apartamento', 'active', {
      city: { ru: 'Малага', en: 'Málaga', es: 'Málaga' },
    })), true);

    const data = bot.getData();
    data.objects = [
      property('nearby-first', 'Почти подходит', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: null, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }),
      property('exact-second', 'Подходит точно', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: 500000, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }),
    ];
    const ranking = bot.currentSelectionRanking({ preferredLanguage: 'ru' }, {
      deal: SELECTION.dealOptions[0], type: SELECTION.typeOptions[1], location: 'Марбелья', budget: '600 000 €', bedrooms: SELECTION.bedroomOptions[2],
    });
    assert.deepEqual(ranking.map((item) => [item.record.id, item.tier]), [['exact-second', 'exact'], ['nearby-first', 'close']]);
  });
});

test.describe('search in client messages', () => {
  const benidorm = { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' };
  test.beforeEach(() => resetData((data) => {
    data.objects.push(property('flat-benidorm-01', 'Квартира у пляжа', 'active', { reference: 'REF-1024', city: benidorm }));
    data.objects.push(property('villa-malaga-02', 'Вилла в Малаге', 'active', { reference: 'REF-2048', city: { ru: 'Малага', en: 'Málaga', es: 'Málaga' } }));
    data.objects.push(property('hidden-03', 'Скрытый объект', 'hidden', { reference: 'REF-4096', city: benidorm }));
  }));

  function shownCard() {
    const card = telegram.calls.filter((call) => call.method === 'sendPhoto').pop();
    return card && card.body.caption;
  }

  test('a property number opens its card instead of going to the manager', async () => {
    const chat = createChat();
    telegram.calls = [];
    await chat.say('ref 1024');
    assert.match(shownCard(), /^<i>🔖 Объект<\/i>\n\n<b>Квартира у пляжа<\/b>/);
    assert.equal(chat.inquiries.length, 0);
    telegram.calls = [];
    await chat.say('REF-4096');
    assert.equal(shownCard(), undefined, 'a hidden property is not found');
    assert.equal(chat.inquiries.length, 1, 'and the message goes to the manager as before');
  });

  test('a question that names a property is linked to it for the manager', async () => {
    const chat = createChat();
    const step = await chat.say('Сколько стоит обслуживание REF-2048 в год?');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'question');
    assert.equal(inquiry.propertyId, 'villa-malaga-02');
    assert.match(step.last.text, /Вилла в Малаге$/);
    assert.ok(adminMessages().some((message) => message.text.includes('вопрос по объекту') && message.text.includes('🔖 Вилла в Малаге')));
  });

  test('a city name shows the catalog in that city, in any language and spelling', async () => {
    const chat = createChat();
    await chat.say('benidorm');
    assert.deepEqual(chat.user.catalogFilter, { deal: '', type: '', bedrooms: 0, city: 'Бенидорм', district: '', minPrice: 0, maxPrice: 0, sort: '' });
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['flat-benidorm-01']);
    assert.equal(chat.inquiries.length, 0);

    const english = createChat({ language: 'en' });
    await english.say('Malaga');
    assert.equal(english.user.catalogFilter.city, 'Málaga', 'the city as the client\'s language writes it');
  });

  test('a natural request becomes an exact catalog filter in all three languages', async () => {
    resetData((data) => {
      const marbella = { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' };
      const malaga = { ru: 'Малага', en: 'Málaga', es: 'Málaga' };
      const sierraBlanca = { ru: 'Сьерра-Бланка', en: 'Sierra Blanca', es: 'Sierra Blanca' };
      data.objects.push(property('natural-flat-01', 'Квартира по запросу', 'active', { dealType: 'sale', propertyType: 'apartment', bedrooms: 2, priceValue: 470000, city: marbella }));
      data.objects.push(property('natural-flat-02', 'Слишком дорогая квартира', 'active', { dealType: 'sale', propertyType: 'apartment', bedrooms: 3, priceValue: 620000, city: marbella }));
      data.objects.push(property('natural-villa-03', 'Villa for search', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: 1100000, city: marbella, district: sierraBlanca }));
      data.objects.push(property('natural-rent-04', 'Piso de alquiler', 'active', { dealType: 'rent', propertyType: 'apartment', bedrooms: 2, priceValue: 1600, pricePeriod: 'month', city: malaga }));
      for (const record of data.objects) record.imagesByLanguage.es = record.imagesByLanguage.ru.slice();
    });

    const russian = createChat();
    await russian.say('Ищу купить квартиру в Марбелье до 500 000 €, 2 спальни');
    assert.deepEqual(russian.user.catalogFilter, { deal: 'sale', type: 'apartment', bedrooms: 2, city: 'Марбелья', district: '', minPrice: 0, maxPrice: 500000, sort: '' });
    assert.deepEqual(bot.catalogRecords(russian.user).map((record) => record.id), ['natural-flat-01']);
    // A request in the client's own words is a lead: the manager sees it in
    // the panel, but the client already got the catalog, so nobody waits.
    assert.equal(russian.inquiries.length, 1);
    assert.equal(russian.inquiries[0].searchLead, true);
    assert.equal(bot.awaitingReply(russian.inquiries[0]), false);
    const filterPanel = await russian.press('cfilter:open');
    const priceButton = filterPanel.last.markup.inline_keyboard.flat().find((button) => button.callback_data === 'cfilter:prices:0');
    assert.match(priceButton.text.replace(/[   ]/g, ' '), /500 000 €/, 'a price typed by the client stays visible in the filter');
    const customPricePanel = await russian.press('cfilter:prices:0');
    const customPriceButton = customPricePanel.calls.filter((call) => ['sendMessage', 'editMessageText'].includes(call.method)).pop()
      .body.reply_markup.inline_keyboard.flat().find((button) => button.callback_data === 'cfilter:price:500000');
    assert.ok(customPriceButton && customPriceButton.text.startsWith('✓ '), 'and stays chosen on the price screen');

    const english = createChat({ language: 'en' });
    await english.say('Looking to buy a villa in Marbella under 1.2 million, 3 bedrooms');
    assert.deepEqual(english.user.catalogFilter, { deal: 'sale', type: 'villa', bedrooms: 3, city: 'Marbella', district: '', minPrice: 0, maxPrice: 1200000, sort: '' });
    assert.deepEqual(bot.catalogRecords(english.user).map((record) => record.id), ['natural-villa-03']);

    const byDistrict = createChat();
    await byDistrict.say('Ищу купить виллу в Сьерра-Бланке до 1 200 000 €, 3 спальни');
    assert.deepEqual(byDistrict.user.catalogFilter, { deal: 'sale', type: 'villa', bedrooms: 3, city: 'Марбелья', district: 'Сьерра-Бланка', minPrice: 0, maxPrice: 1200000, sort: '' });
    assert.deepEqual(bot.catalogRecords(byDistrict.user).map((record) => record.id), ['natural-villa-03']);

    const spanish = createChat({ language: 'es' });
    await spanish.say('Busco apartamento de alquiler en Málaga hasta 1.800 €, 2 dormitorios');
    assert.deepEqual(spanish.user.catalogFilter, { deal: 'rent', type: 'apartment', bedrooms: 2, city: 'Málaga', district: '', minPrice: 0, maxPrice: 1800, sort: '' });
    assert.deepEqual(bot.catalogRecords(spanish.user).map((record) => record.id), ['natural-rent-04']);
  });

  test('a price range in an ordinary message becomes the same catalog filter in all three languages', async () => {
    resetData((data) => {
      const marbella = { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' };
      data.objects.push(property('range-low-01', 'Дешевле диапазона', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 250000, city: marbella }));
      data.objects.push(property('range-fit-02', 'В диапазоне', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 420000, city: marbella }));
      data.objects.push(property('range-high-03', 'Дороже диапазона', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 650000, city: marbella }));
      for (const record of data.objects) record.imagesByLanguage.es = record.imagesByLanguage.ru.slice();
    });

    const cases = [
      { language: 'ru', message: 'Ищу квартиру в Марбелье от 300 до 500 тыс. €', city: 'Марбелья' },
      { language: 'en', message: 'Looking for an apartment in Marbella from 300k to 500k', city: 'Marbella' },
      { language: 'es', message: 'Busco apartamento en Marbella entre 300 y 500 mil euros', city: 'Marbella' },
    ];
    for (const item of cases) {
      const chat = createChat({ language: item.language });
      await chat.say(item.message);
      assert.equal(chat.user.catalogFilter.minPrice, 300000);
      assert.equal(chat.user.catalogFilter.maxPrice, 500000);
      assert.equal(chat.user.catalogFilter.city, item.city);
      assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['range-fit-02']);
      assert.equal(chat.inquiries[0].searchLead, true, 'запрос словами виден менеджеру как лид');
      assert.equal(bot.awaitingReply(chat.inquiries[0]), false);
    }
  });

  test('a filtered catalog can send the same criteria to a manager with one tap', async () => {
    resetData((data) => {
      data.objects.push(property('manager-search-01', 'Квартира для заявки', 'active', {
        dealType: 'sale', propertyType: 'apartment', bedrooms: 2, priceValue: 480000,
        city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
        district: { ru: 'Нагуэлес', en: 'Nagueles', es: 'Nagüeles' },
      }));
    });
    const chat = createChat();
    const search = await chat.say('Ищу купить квартиру в Нагуэлесе до 500 000 €, 2 спальни');
    const card = search.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(callbacksOf(card.body.reply_markup).includes('cfilter:manager'));

    const sent = await chat.press('cfilter:manager');
    assert.deepEqual(sent.popups, [bot.text.catalogFilter.ru.sentToManager]);
    const inquiry = chat.inquiries[0];
    assert.equal(inquiry.type, 'selection');
    assert.match(inquiry.text, /Продажа, Квартира, Марбелья, Нагуэлес, 2\+ спален, до 500\s?000 €/);
    assert.equal(inquiry.selection.location, 'Марбелья, Нагуэлес');
    assert.deepEqual(inquiry.matching.results.map((item) => item.id), ['manager-search-01']);
    assert.deepEqual(chat.user.selectionMatchIds, ['manager-search-01']);
  });

  test('longer messages and unknown places still go to the manager', async () => {
    const chat = createChat();
    await chat.say('Ищу что-нибудь в Бенидорме или Финестрате');
    await chat.say('Торревьеха');
    await chat.say('Ищу виллу в Торревьехе до 500 000 €');
    await chat.say('Ищу дом или виллу в Малаге');
    assert.equal(chat.inquiries.length, 1, 'all ambiguous messages end up in one conversation');
    assert.equal(chat.user.catalogFilter, null);
  });
});

test.describe('каталог списком', () => {
  const FILTER = bot.text.catalogFilter.ru;

  test.beforeEach(() => resetData((data) => {
    const city = (ru) => ({ ru, en: ru, es: ru });
    for (let index = 1; index <= 12; index += 1) {
      data.objects.push(property('list-' + index, 'Объект ' + index, 'active', {
        dealType: 'sale', propertyType: 'apartment', priceValue: 200000 + index * 10000,
        bedrooms: (index % 3) + 1, city: city(index % 2 ? 'Бенидорм' : 'Альтеа'),
      }));
    }
  }));

  test('десяток объектов показывается одним сообщением со строками и номерами', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    // На карточке есть переход в список, потому что объектов больше восьми.
    const card = (await chat.press('catalog:all:0')).calls.find((call) => ['sendPhoto', 'editMessageMedia'].includes(call.method));
    assert.ok(callbacksOf(card.body.reply_markup).some((value) => value.startsWith('clist:')), 'кнопка «Списком» на карточке');

    const list = await chat.press('clist:all:0');
    const body = list.calls.filter((call) => ['sendMessage', 'editMessageText'].includes(call.method)).pop().body;
    assert.match(body.text, new RegExp(FILTER.listTitle + ' · 12'), 'видно, сколько всего объектов');
    const lines = body.text.split('\n').filter((line) => /^\d+\. /.test(line));
    assert.equal(lines.length, 8, 'восемь строк на странице');
    assert.match(lines[0].replace(/[   ]/g, ' '), /^1\. Квартира · Бенидорм · 210 000 €$/, 'строка коротко описывает объект: спальни отпали, чтобы уложиться в 34 знака');
    assert.ok(lines.every((line) => Array.from(line).length <= 34), 'ни одна строка списка не длиннее 34 знаков (иначе на телефоне переносится)');

    const callbacks = callbacksOf(body.reply_markup);
    assert.ok(callbacks.includes('catalog:all:0'), 'номер открывает карточку');
    assert.ok(callbacks.includes('clist:all:1'), 'есть вторая страница списка');

    // Номер открывает карточку этого объекта.
    const opened = await chat.press('catalog:all:2');
    const openedCard = opened.calls.find((call) => ['sendPhoto', 'editMessageMedia'].includes(call.method));
    assert.ok(openedCard, 'карточка показана');
  });

  test('вторая страница списка меняет то же сообщение', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    await chat.press('clist:all:0');
    const next = await chat.press('clist:all:1');
    assert.ok(next.calls.some((call) => call.method === 'editMessageText'), 'список меняется на месте');
    const body = next.calls.filter((call) => call.method === 'editMessageText').pop().body;
    const lines = body.text.split('\n').filter((line) => /^\d+\. /.test(line));
    assert.equal(lines.length, 4, 'на второй странице остаток');
    assert.match(lines[0], /^9\. /, 'нумерация продолжается');
  });

  test('«Списком» при пустом каталоге и после того, как объекты сняли, не ломается', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    // Клиент открыл список, а объекты за это время скрыли: устаревшая кнопка отвечает, а не молчит.
    bot.getData().objects.forEach((record) => { record.status = 'hidden'; });
    const empty = await chat.press('clist:all:0');
    assert.ok(empty.calls.some((call) => ['sendMessage', 'editMessageText', 'answerCallbackQuery'].includes(call.method)), 'бот ответил');
    // И страница, которой уже нет (список стал короче), не роняет бот.
    bot.getData().objects.forEach((record) => { record.status = 'active'; });
    bot.getData().objects.splice(3);
    const gone = await chat.press('clist:all:5');
    assert.ok(gone.calls.some((call) => ['sendMessage', 'editMessageText', 'answerCallbackQuery'].includes(call.method)), 'бот ответил и на несуществующую страницу');
  });
});

test.describe('мастер подбора', () => {
  const SELECTION = bot.text.selection.ru;

  test.beforeEach(() => resetData((data) => {
    const city = (ru) => ({ ru, en: ru, es: ru });
    data.objects.push(property('wiz-1', 'Квартира в Альтеа', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 240000, bedrooms: 2, city: city('Альтеа') }));
    data.objects.push(property('wiz-2', 'Вилла в Кальпе', 'active', { dealType: 'sale', propertyType: 'villa', priceValue: 890000, bedrooms: 4, city: city('Кальпе') }));
    data.objects.push(property('wiz-3', 'Квартира в аренду', 'active', { dealType: 'rent', propertyType: 'apartment', priceValue: 1200, bedrooms: 1, city: city('Альтеа') }));
  }));

  test('подбор идёт одним сообщением и считает подходящие объекты', async () => {
    const chat = createChat();
    const start = await chat.say(MENU.ru.selection);
    assert.match(start.last.text, new RegExp('^' + SELECTION.wizardTitle.replace(/[✨]/g, '.')), 'мастер начинается заголовком');
    assert.match(start.last.text, /Подходит: 3/, 'видно, сколько всего подходит');
    assert.match(start.last.text, new RegExp(SELECTION.wizardDeal), 'и первый вопрос');
    assert.equal(start.replies.length, 1, 'одно сообщение, а не пять');

    // Дальше сообщение меняется на месте.
    const deal = await chat.press('sel:deal:sale');
    assert.ok(deal.calls.some((call) => call.method === 'editMessageText'), 'то же сообщение, а не новое');
    const dealText = deal.calls.filter((call) => call.method === 'editMessageText').pop().body.text;
    assert.match(dealText, /Подходит: 2/, 'счётчик пересчитался под покупку');
    assert.match(dealText, new RegExp(SELECTION.wizardType));

    await chat.press('sel:type:apartment');
    const city = await chat.press('sel:city:' + encodeURIComponent('альтеа'));
    const cityText = city.calls.filter((call) => call.method === 'editMessageText').pop().body.text;
    assert.match(cityText, /Подходит: 1/, 'квартира в Альтеа — одна');

    await chat.press('sel:skip:bedrooms');
    const done = await chat.press('sel:skip:done');
    const doneBody = done.calls.filter((call) => call.method === 'editMessageText').pop().body;
    const callbacks = callbacksOf(doneBody.reply_markup);
    assert.ok(callbacks.some((value) => value === 'sel:show'), 'кнопка «Показать N»');
    assert.ok(callbacks.includes('saved:save'), 'кнопка «Сообщать о новых»');
    assert.ok(callbacks.includes('cfilter:manager'), 'кнопка «Передать менеджеру»');
    assert.match(doneBody.reply_markup.inline_keyboard.flat()[0].text, /Показать 1/);

    // «Показать» открывает каталог с этими условиями.
    const shown = await chat.press('sel:show');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['wiz-1']);
    assert.ok(shown.calls.some((call) => ['sendPhoto', 'editMessageMedia'].includes(call.method)), 'карточка показана');
  });

  test('шаг назад возвращает к предыдущему вопросу', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.press('sel:deal:rent');
    const back = await chat.press('sel:back:deal');
    const text = back.calls.filter((call) => call.method === 'editMessageText').pop().body.text;
    assert.match(text, new RegExp(SELECTION.wizardDeal), 'снова первый вопрос');
  });
});

test.describe('catalog filter', () => {
  const FILTER = bot.text.catalogFilter.ru;
  const catalog = [
    ['sale-villa-3', 'sale', 'villa', 3],
    ['sale-villa-4', 'sale', 'villa', 4],
    ['sale-flat-2', 'sale', 'apartment', 2],
    ['sale-flat-x', 'sale', 'apartment', 0],
    ['rent-flat-1', 'rent', 'apartment', 1],
    ['rent-flat-2', 'rent', 'apartment', 2],
    ['rent-house-5', 'rent', 'house', 5],
  ];

  function withCatalog(entries) {
    resetData((data) => {
      for (const [id, dealType, propertyType, bedrooms] of entries) {
        data.objects.push(property(id, 'Объект ' + id, 'active', { dealType, propertyType, bedrooms }));
      }
    });
  }

  function cardMarkup() {
    const cards = telegram.calls.filter((call) => ['sendPhoto', 'editMessageMedia'].includes(call.method));
    return cards[cards.length - 1].body.reply_markup;
  }

  function withoutCount(label) {
    return String(label).replace(/ · \d+$/, '');
  }

  test('the filter is always available, including in a small catalog', async () => {
    withCatalog(catalog.slice(0, 4));
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    assert.ok(callbacksOf(cardMarkup()).includes('cfilter:open'));
  });

  test('the filter narrows the catalog and is remembered', async () => {
    withCatalog(catalog);
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    assert.ok(callbacksOf(cardMarkup()).includes('cfilter:open'));

    const panel = await chat.press('cfilter:open');
    assert.ok(panel.last.text.startsWith(FILTER.button + String.fromCharCode(10)), 'заголовок — состояние: «Фильтр», сколько подходит и условия');
    assert.ok(panel.last.buttons.some((label) => withoutCount(label) === '✓ ' + FILTER.anyDeal));
    assert.ok(panel.last.buttons.includes(FILTER.show + ' 7'));
    assert.ok(panel.last.buttons.some((label) => withoutCount(label) === 'Вилла')
      && panel.last.buttons.some((label) => withoutCount(label) === 'Дом')
      && !panel.last.buttons.some((label) => withoutCount(label) === 'Участок'), 'only types present in the catalog are offered');

    const rent = await chat.press('cfilter:deal:rent');
    const edited = rent.calls.find((call) => call.method === 'editMessageText');
    assert.ok(edited.body.reply_markup.inline_keyboard.flat().some((button) => withoutCount(button.text) === '✓ Аренда'));
    assert.ok(edited.body.reply_markup.inline_keyboard.flat().some((button) => button.text === FILTER.show + ' 3'));
    assert.ok(!edited.body.reply_markup.inline_keyboard.flat().some((button) => withoutCount(button.text) === 'Вилла'), 'an impossible type is not offered');
    assert.ok(edited.body.reply_markup.inline_keyboard.flat().some((button) => button.text === 'Квартира'), 'available choices — без счётчика на кнопке: число подходящих — на «Показать» и в заголовке');
    await chat.press('cfilter:bed:2');
    assert.deepEqual(chat.user.catalogFilter, { deal: 'rent', type: '', bedrooms: 2, city: '', district: '', minPrice: 0, maxPrice: 0, sort: '' });

    await chat.press('cfilter:show');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['rent-flat-2', 'rent-house-5']);
    const filterButton = cardMarkup().inline_keyboard.flat().find((button) => button.callback_data === 'cfilter:open');
    assert.equal(filterButton.text, FILTER.button + ' ✓');

    await chat.say('Добрый день');
    assert.deepEqual(chat.user.catalogFilter, { deal: 'rent', type: '', bedrooms: 2, city: '', district: '', minPrice: 0, maxPrice: 0, sort: '' }, 'kept after other messages');
  });

  test('an empty result offers to reset the filter or leave wishes', async () => {
    withCatalog(catalog);
    const chat = createChat();
    await chat.press('cfilter:type:house');
    await chat.press('cfilter:deal:sale');
    const shown = await chat.press('cfilter:show');
    assert.ok(shown.last.text.startsWith(FILTER.empty));
    // Пустой ответ не тупик: есть «ближайшие» (без типа), слежение за новыми и менеджер.
    // Четыре действия: ближайшее, следить за новыми, менеджеру, сбросить; «Фильтр», «Подбор» и меню — на клавиатуре.
    assert.deepEqual(callbacksOf(shown.last.markup), ['cfilter:nearby', 'saved:save', 'cfilter:manager', 'cfilter:reset']);
    assert.equal(shown.last.markup.inline_keyboard.length, 4, 'четыре ряда');
    assert.match(shown.last.text, /Ближайшие варианты: \d+ — /);
    await chat.press('cfilter:reset');
    assert.equal(chat.user.catalogFilter, null);
    assert.equal(bot.catalogRecords(chat.user).length, 7);
  });

  test('cities, price limits and sorting by price', async () => {
    resetData((data) => {
      const city = (ru, en) => ({ ru, en, es: en });
      data.objects.push(property('sale-marbella-1', 'Вилла 1', 'active', { dealType: 'sale', propertyType: 'villa', priceValue: 900000, city: city('Марбелья', 'Marbella'), district: city('Сьерра-Бланка', 'Sierra Blanca') }));
      data.objects.push(property('sale-marbella-2', 'Квартира 2', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 240000, city: city('марбелья', 'Marbella'), district: city('Нагуэлес', 'Nagueles') }));
      data.objects.push(property('sale-estepona-3', 'Квартира 3', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 380000, city: city('Эстепона', 'Estepona'), district: city('Аталайя', 'Atalaya') }));
      data.objects.push(property('sale-estepona-4', 'Дом 4', 'active', { dealType: 'sale', propertyType: 'house', city: city('Эстепона', 'Estepona'), district: city('Центр', 'Centro') }));
      data.objects.push(property('rent-malaga-5', 'Квартира 5', 'active', { dealType: 'rent', propertyType: 'apartment', priceValue: 1100, city: city('Малага', 'Malaga') }));
      data.objects.push(property('rent-malaga-6', 'Квартира 6', 'active', { dealType: 'rent', propertyType: 'apartment', priceValue: 1900, city: city('Малага', 'Malaga') }));
    });
    const chat = createChat();
    let panel = await chat.press('cfilter:open');
    const buttons = () => panel.calls.filter((call) => ['sendMessage', 'editMessageText'].includes(call.method)).pop().body.reply_markup.inline_keyboard.flat();
    assert.ok(!buttons().some((button) => button.callback_data.startsWith('cfilter:price:')), 'no price scale while sale and rent are mixed');

    // Города живут за одной кнопкой-списком, чтобы фильтр не разрастался.
    panel = await chat.press('cfilter:cities:0');
    assert.deepEqual(buttons().filter((button) => button.callback_data.startsWith('cfilter:city:')).map((button) => withoutCount(button.text)), ['✓ ' + FILTER.anyCity, 'Малага', 'Марбелья', 'Эстепона'], 'each city once, whatever the case');

    const marbella = buttons().find((button) => withoutCount(button.text) === 'Марбелья');
    panel = await chat.press(marbella.callback_data);
    assert.equal(chat.user.catalogFilter.city, 'Марбелья');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-marbella-1', 'sale-marbella-2']);
    panel = await chat.press('cfilter:districts:0');
    assert.deepEqual(buttons().filter((button) => button.callback_data.startsWith('cfilter:district:')).map((button) => withoutCount(button.text)), ['✓ ' + FILTER.anyDistrict, 'Нагуэлес', 'Сьерра-Бланка']);

    const sierra = buttons().find((button) => withoutCount(button.text) === 'Сьерра-Бланка');
    panel = await chat.press(sierra.callback_data);
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-marbella-1']);
    assert.equal(chat.user.catalogFilter.city + ', ' + chat.user.catalogFilter.district, 'Марбелья, Сьерра-Бланка');

    panel = await chat.press('cfilter:cities:0');
    const estepona = buttons().find((button) => withoutCount(button.text) === 'Эстепона');
    panel = await chat.press(estepona.callback_data);
    assert.equal(chat.user.catalogFilter.district, '', 'a district from another city is cleared');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-estepona-3', 'sale-estepona-4']);

    panel = await chat.press('cfilter:city:any');
    await chat.press('cfilter:deal:sale');
    // Пороги цены живут на своём экране, на фильтре цена — одной кнопкой.
    panel = await chat.press('cfilter:prices:0');
    assert.deepEqual(buttons().filter((button) => button.callback_data.startsWith('cfilter:price:')).map((button) => withoutCount(button.text).replace(/[  ]/g, ' ')), ['✓ ' + FILTER.anyPrice, 'до 250 000 €', 'до 400 000 €', 'до 600 000 €', 'до 1 000 000 €', '✎ ' + FILTER.customPrice]);
    await chat.press('cfilter:price:400000');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-marbella-2', 'sale-estepona-3'], 'a price on request is left out');

    await chat.press('cfilter:price:0');
    await chat.press('cfilter:sort:desc');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-marbella-1', 'sale-estepona-3', 'sale-marbella-2', 'sale-estepona-4'], 'price on request last');
    await chat.press('cfilter:sort:asc');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-marbella-2', 'sale-estepona-3', 'sale-marbella-1', 'sale-estepona-4']);

    await chat.press('cfilter:price:250000');
    await chat.press('cfilter:deal:rent');
    assert.equal(chat.user.catalogFilter.maxPrice, 0, 'a purchase limit does not carry over to rent');
    panel = await chat.press('cfilter:prices:0');
    assert.deepEqual(buttons().filter((button) => button.callback_data.startsWith('cfilter:price:')).map((button) => withoutCount(button.text).replace(/[  ]/g, ' ')), ['✓ ' + FILTER.anyPrice, 'до 1 200 €', 'до 2 000 €', 'до 3 000 €', '✎ ' + FILTER.customPrice]);
    await chat.press('cfilter:show');
    const filterButton = cardMarkup().inline_keyboard.flat().find((button) => button.callback_data === 'cfilter:open');
    assert.equal(filterButton.text, FILTER.button + ' ✓');

    const english = createChat({ language: 'en' });
    english.user.catalogFilter = { city: 'Marbella' };
    assert.deepEqual(bot.catalogRecords(english.user).map((record) => record.id), ['sale-marbella-1', 'sale-marbella-2'], 'the city in the client\'s language');
  });

  test('the filter fits on one screen and hides rare options behind "more"', async () => {
    // Богатый каталог: все типы, много городов и районов, обе сделки.
    resetData((data) => {
      const place = (value) => ({ ru: value, en: value, es: value });
      const types = ['apartment', 'villa', 'house', 'townhouse', 'plot', 'commercial'];
      types.forEach((propertyType, index) => {
        for (let city = 1; city <= 5; city += 1) {
          data.objects.push(property('rich-' + propertyType + '-' + city, 'Объект ' + propertyType + ' ' + city, 'active', {
            dealType: index % 2 ? 'rent' : 'sale',
            propertyType,
            bedrooms: (index % 4) + 1,
            priceValue: index % 2 ? 900 + city * 200 : 200000 + city * 90000,
            city: place('Город ' + city),
            district: place('Район ' + city),
          }));
        }
      });
    });
    const chat = createChat();
    const keyboard = (step) => step.calls.filter((call) => ['sendMessage', 'editMessageText'].includes(call.method)).pop().body.reply_markup.inline_keyboard;

    let step = await chat.press('cfilter:open');
    assert.ok(keyboard(step).length <= 8, 'the filter is at most eight rows, even in a rich catalog');
    step = await chat.press('cfilter:deal:sale');
    assert.ok(keyboard(step).length <= 8, 'choosing a deal adds a price button, not price rows');
    step = await chat.press('cfilter:bed:2');
    assert.ok(keyboard(step).length <= 8);
    const filterCallbacks = callbacksOf({ inline_keyboard: keyboard(step) });
    assert.ok(filterCallbacks.includes('cfilter:cities:0'), 'cities live behind a list button');
    assert.ok(filterCallbacks.includes('cfilter:prices:0'), 'prices live behind a list button');
    assert.ok(filterCallbacks.includes('cfilter:more'), 'the rest is behind "more"');
    for (const rare of ['cfilter:sort:asc', 'cfilter:sort:desc', 'cfilter:price:custom', 'cfilter:minprice:custom', 'cfilter:reset']) {
      assert.ok(!filterCallbacks.includes(rare), rare + ' does not take a row on the main screen');
    }

    // «Ещё»: сортировка, сохранённый поиск, сброс и возврат к фильтру.
    step = await chat.press('cfilter:more');
    const moreCallbacks = callbacksOf({ inline_keyboard: keyboard(step) });
    assert.ok(moreCallbacks.includes('cfilter:sort:asc') && moreCallbacks.includes('cfilter:sort:desc'));
    assert.ok(moreCallbacks.includes('saved:save'), 'the current search can be saved from here');
    assert.ok(moreCallbacks.includes('cfilter:reset'));
    assert.ok(moreCallbacks.includes('cfilter:open'), 'and there is a way back to the filter');

    // Экран цены: пороги, своя цена и нижняя граница.
    step = await chat.press('cfilter:prices:0');
    const priceCallbacks = callbacksOf({ inline_keyboard: keyboard(step) });
    assert.ok(priceCallbacks.includes('cfilter:price:0') && priceCallbacks.includes('cfilter:price:custom'));
    assert.ok(priceCallbacks.includes('cfilter:minprice:custom'));
    assert.ok(priceCallbacks.includes('cfilter:open'));

    // Выбранное видно на кнопке фильтра, экран не разрастается.
    step = await chat.press('cfilter:price:400000');
    assert.ok(keyboard(step).length <= 8, 'a chosen price still fits');
    const priceButton = keyboard(step).flat().find((button) => button.callback_data === 'cfilter:prices:0');
    assert.match(priceButton.text.replace(/[   ]/g, ' '), /400 000 €/, 'the chosen price is visible without opening the screen');
  });

  test('long city and district lists use compact paginated pickers', async () => {
    resetData((data) => {
      const place = (value) => ({ ru: value, en: value, es: value });
      for (let city = 1; city <= 8; city += 1) {
        const districtTotal = city === 1 ? 7 : 1;
        for (let district = 1; district <= districtTotal; district += 1) {
          data.objects.push(property('place-' + city + '-' + district, 'Объект ' + city + '-' + district, 'active', {
            dealType: 'sale',
            priceValue: 200000 + city * 10000 + district,
            city: place('Город ' + city),
            district: place('Район ' + district),
          }));
        }
      }
    });
    const chat = createChat();
    const latest = (step) => step.calls.filter((call) => ['sendMessage', 'editMessageText'].includes(call.method)).pop().body;

    let step = await chat.press('cfilter:open');
    let markup = latest(step).reply_markup;
    assert.ok(callbacksOf(markup).includes('cfilter:cities:0'));
    assert.equal(callbacksOf(markup).filter((callback) => callback.startsWith('cfilter:city:')).length, 0, 'cities do not stretch the main filter');

    step = await chat.press('cfilter:cities:0');
    let body = latest(step);
    assert.equal(body.text, FILTER.cityPickerTitle);
    assert.equal(callbacksOf(body.reply_markup).filter((callback) => callback.startsWith('cfilter:city:')).length, 7, 'any city plus six choices fit on one page');
    assert.ok(callbacksOf(body.reply_markup).includes('cfilter:cities:1'));
    const firstCity = body.reply_markup.inline_keyboard.flat().find((button) => withoutCount(button.text) === 'Город 1');

    step = await chat.press(firstCity.callback_data);
    body = latest(step);
    assert.equal(chat.user.catalogFilter.city, 'Город 1');
    assert.equal(body.text, FILTER.districtPickerTitle.replace('{city}', 'Город 1'));
    assert.ok(callbacksOf(body.reply_markup).includes('cfilter:districts:1'));

    step = await chat.press('cfilter:districts:1');
    body = latest(step);
    const seventhDistrict = body.reply_markup.inline_keyboard.flat().find((button) => withoutCount(button.text) === 'Район 7');
    assert.ok(seventhDistrict);
    step = await chat.press(seventhDistrict.callback_data);
    body = latest(step);
    assert.equal(chat.user.catalogFilter.district, 'Район 7');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['place-1-7']);
    assert.ok(callbacksOf(body.reply_markup).includes('cfilter:cities:0'));
    assert.ok(callbacksOf(body.reply_markup).includes('cfilter:districts:0'));
  });

  test('a client can set an exact price range inside the filter', async () => {
    resetData((data) => {
      data.objects.push(property('custom-price-low', 'Дешевле диапазона', 'active', { dealType: 'sale', priceValue: 280000 }));
      data.objects.push(property('custom-price-fit', 'Подходит по цене', 'active', { dealType: 'sale', priceValue: 510000 }));
      data.objects.push(property('custom-price-high', 'Дороже бюджета', 'active', { dealType: 'sale', priceValue: 700000 }));
    });
    const chat = createChat();
    await chat.press('cfilter:deal:sale');
    const prompt = await chat.press('cfilter:price:custom');
    assert.equal(chat.user.pendingAction.type, 'catalog_filter_price');
    assert.equal(prompt.last.text, FILTER.askCustomPrice);
    assert.deepEqual(prompt.last.buttons, [FILTER.cancelCustomPrice]);

    const invalid = await chat.say('примерно средний бюджет');
    assert.equal(invalid.last.text, FILTER.invalidCustomPrice);
    assert.equal(chat.user.pendingAction.type, 'catalog_filter_price', 'an invalid amount keeps the input open');

    const applied = await chat.say('525 тыс. €');
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.user.catalogFilter.maxPrice, 525000);
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['custom-price-low', 'custom-price-fit']);
    assert.equal(chat.inquiries.length, 0, 'a budget is filter input, not a manager message');
    assert.ok(applied.replies.some((reply) => reply.text.includes('525') && reply.text.includes('€')));
    const priceScreen = await chat.press('cfilter:prices:0');
    const selected = priceScreen.calls.filter((call) => ['sendMessage', 'editMessageText'].includes(call.method)).pop().body.reply_markup.inline_keyboard.flat()
      .find((button) => button.callback_data === 'cfilter:price:525000');
    assert.ok(selected && selected.text.startsWith('✓ '));

    const minimumPrompt = await chat.press('cfilter:minprice:custom');
    assert.equal(chat.user.pendingAction.priceBound, 'min');
    assert.equal(minimumPrompt.last.text, FILTER.askMinimumPrice);

    const conflict = await chat.say('600 000 €');
    assert.equal(chat.user.pendingAction.priceBound, 'min', 'a conflicting boundary keeps the input open');
    assert.match(conflict.last.text, /600/);
    assert.match(conflict.last.text, /525/);

    const minimumApplied = await chat.say('500 тыс. €');
    assert.equal(chat.user.catalogFilter.minPrice, 500000);
    assert.equal(chat.user.catalogFilter.maxPrice, 525000);
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['custom-price-fit']);
    const filterAfterMinimum = minimumApplied.calls.filter((call) => call.method === 'sendMessage').pop().body.reply_markup.inline_keyboard.flat()
      .find((button) => button.callback_data === 'cfilter:prices:0');
    assert.ok(filterAfterMinimum, 'the filter keeps a single price button');
    assert.match(filterAfterMinimum.text.replace(/[   ]/g, ' '), /от 500 000 €/, 'the chosen range is visible on the filter');

    await chat.press('cfilter:price:custom');
    const cancelled = await chat.say(FILTER.cancelCustomPrice);
    assert.equal(chat.user.catalogFilter.maxPrice, 525000, 'cancel keeps the previous price');
    assert.equal(chat.user.catalogFilter.minPrice, 500000, 'cancel also keeps the lower boundary');
    assert.ok(cancelled.replies.some((reply) => reply.text === FILTER.customPriceCancelled));

    await chat.press('cfilter:price:0');
    assert.equal(chat.user.catalogFilter.minPrice, 0, '“any price” clears the entire range');
    assert.equal(chat.user.catalogFilter.maxPrice, 0);
  });

  test('a bedroom filter leaves out properties without a bedroom count', () => {
    withCatalog(catalog);
    const chat = createChat();
    chat.user.catalogFilter = { deal: 'sale', type: 'apartment', bedrooms: 1 };
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['sale-flat-2']);
  });

  test('with an active filter the button stays even in a small catalog', async () => {
    withCatalog(catalog.slice(0, 4));
    const chat = createChat();
    chat.user.catalogFilter = { deal: 'sale', type: '', bedrooms: 0 };
    await chat.say(MENU.ru.objects);
    assert.ok(callbacksOf(cardMarkup()).includes('cfilter:open'));
  });

  test('the exact property, filter and sort survive details, reordering and reopening', async () => {
    withCatalog(catalog.slice(0, 3));
    const chat = createChat();
    chat.user.catalogFilter = { deal: 'sale', type: '', bedrooms: 0, city: '', maxPrice: 0, sort: 'desc' };
    await chat.press('catalog:all:0');
    await chat.press('catalog:all:1');
    const targetId = chat.user.catalogContext.propertyId;
    const target = bot.getData().objects.find((record) => record.id === targetId);
    assert.ok(targetId && target);

    const details = await chat.press('property:details:' + targetId);
    assert.ok(callbacksOf(details.last.markup).includes('property:return:' + targetId));

    bot.getData().objects.unshift(property('new-first-00', 'Новый первый', 'active', { priceValue: 990000 }));
    const returned = await chat.press('property:return:' + targetId);
    const returnedCard = returned.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(returnedCard.body.caption.includes('<b>' + target.title.ru + '</b>'));
    assert.equal(chat.user.catalogContext.propertyId, targetId);

    const targetIndex = bot.getData().objects.findIndex((record) => record.id === targetId);
    bot.getData().objects.push(bot.getData().objects.splice(targetIndex, 1)[0]);
    const reopened = await chat.say(MENU.ru.objects);
    const reopenedCard = reopened.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(reopenedCard.body.caption.includes('<b>' + target.title.ru + '</b>'), 'the object id, not an obsolete page number, anchors the catalog');
    assert.equal(chat.user.catalogFilter, null, '«Объекты» из меню открывает весь каталог: фильтр сброшен');
  });

  test('My space combines personal sections and keeps a clean recent history', async () => {
    resetData((data) => {
      data.objects.push(property('recent-one', 'Первый просмотренный', 'active'));
      data.objects.push(property('recent-two', 'Второй просмотренный', 'active'));
      data.objects.push(property('recent-hidden', 'Скрытый объект', 'draft'));
    });
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    await chat.press('catalog:all:1');
    assert.deepEqual(chat.user.recentlyViewed, ['recent-two', 'recent-one']);

    chat.user.favorites = ['recent-one'];
    chat.user.recentlyViewed.unshift('recent-hidden');
    chat.user.catalogFilter = { deal: 'rent', type: '', bedrooms: 0, city: '', maxPrice: 0, sort: '' };
    const personal = await chat.say(MENU.ru.more);
    assert.equal(personal.last.text, bot.text.myArea.ru.title + '\n\n' + bot.text.myArea.ru.intro);
    // Шесть строк: избранное, сравнение, заявки, подписки, мои данные и
    // служебный ряд. Сохранённый поиск живёт в «Подписках», список
    // просмотренных больше не занимает строку.
    assert.deepEqual(callbacksOf(personal.last.markup), [
      'catalog:favorites:0', 'compare:view', 'myreq:list', 'subs:menu',
      'plan:open', 'goal:menu', 'privacy:open', 'nav:help', 'nav:language', 'nav:menu',
    ]);
    assert.ok(personal.last.buttons.includes(MENU.ru.favorites + ' · 1'));
    assert.ok(personal.last.buttons.includes(bot.text.comparison.ru.menuButton + ' · 0'));
    assert.ok(personal.last.buttons.some((label) => label.endsWith(' · 0')), 'the request counter is visible even when empty');

    const recent = await chat.press('catalog:recent:0');
    const recentCard = recent.calls.find((call) => ['editMessageMedia', 'sendPhoto'].includes(call.method));
    const recentMedia = typeof recentCard.body.media === 'string' ? JSON.parse(recentCard.body.media) : recentCard.body.media;
    const recentCaption = recentCard.body.caption || (recentMedia && recentMedia.caption) || '';
    assert.ok(recentCaption.includes('<b>Второй просмотренный</b>'));
    assert.ok(recentCaption.startsWith('<i>' + bot.text.myArea.ru.recentHeading + '</i>'));
    assert.ok(callbacksOf(recentCard.body.reply_markup).includes('nav:my'));
    assert.deepEqual(bot.catalogRecords(chat.user, 'recent').map((record) => record.id), ['recent-two', 'recent-one'], 'filters and hidden properties do not affect the history');

    const historyBeforePaging = [...chat.user.recentlyViewed];
    await chat.press('catalog:recent:1');
    assert.deepEqual(chat.user.recentlyViewed, historyBeforePaging, 'paging through history does not reorder it');

    chat.user.catalogFilter = null;
    await chat.press('catalog:all:0');
    assert.equal(chat.user.recentlyViewed[0], 'recent-one');
    assert.equal(chat.user.recentlyViewed.filter((id) => id === 'recent-one').length, 1, 'opening the same card moves it instead of duplicating it');
  });

  test('a gallery returns to the same property and the city filter follows the language', async () => {
    resetData((data) => {
      const home = property('gallery-home-01', 'Дом с галереей', 'active', {
        city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
        district: { ru: 'Золотая Миля', en: 'Golden Mile', es: 'Milla de Oro' },
      });
      home.imagesByLanguage.ru.push({ ...home.imagesByLanguage.ru[0], id: 'gallery-home-01-extra' });
      data.objects.push(home);
      data.objects.push(property('other-home-02', 'Другой дом', 'active', { city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' } }));
    });
    const chat = createChat();
    chat.user.catalogFilter = { deal: 'sale', type: '', bedrooms: 0, city: 'Марбелья', district: 'Золотая Миля', maxPrice: 0, sort: 'asc' };
    await chat.press('catalog:all:0');
    // Фотографии листаются в самой карточке: отдельного альбома и сообщения
    // «Что вы хотите сделать дальше?» больше нет.
    const gallery = await chat.press('property:gallery:gallery-home-01', { card: true });
    const edited = gallery.calls.filter((call) => call.method === 'editMessageMedia');
    assert.equal(edited.length, 1, 'карточка изменилась на месте, а не прислала альбом');
    assert.equal(gallery.calls.some((call) => call.method === 'sendMediaGroup'), false, 'альбома больше нет');
    const photoButtons = (edited[0].body.reply_markup.inline_keyboard || []).flat().map((button) => button.callback_data);
    assert.ok(photoButtons.some((data) => data === 'property:photo:1:gallery-home-01'), 'есть переход к следующей фотографии');
    assert.ok(photoButtons.includes('property:card:gallery-home-01'), 'и возврат к карточке');

    await chat.press('property:photo:1:gallery-home-01', { card: true });
    await chat.press('property:card:gallery-home-01', { card: true });
    await chat.press('property:return:gallery-home-01');
    assert.equal(chat.user.catalogContext.propertyId, 'gallery-home-01');

    await chat.press('language:en');
    assert.deepEqual(chat.user.catalogFilter, { deal: 'sale', type: '', bedrooms: 0, city: 'Marbella', district: 'Golden Mile', minPrice: 0, maxPrice: 0, sort: 'asc' });
  });

  test('typing a city keeps the other catalog choices while they still find something', async () => {
    withCatalog(catalog);
    const chat = createChat();
    chat.user.catalogFilter = { deal: 'sale', type: 'apartment', bedrooms: 2, city: '', sort: 'desc' };
    await chat.say('Бенидорм');
    assert.deepEqual(chat.user.catalogFilter, { deal: 'sale', type: 'apartment', bedrooms: 2, city: 'Бенидорм', district: '', minPrice: 0, maxPrice: 0, sort: 'desc' });
  });

  test('a city typed after a search that finds nothing in it starts a new search: the city alone, not «no properties match»', async () => {
    withCatalog(catalog);
    const chat = createChat();
    // «Продажа, дом» — в каталоге таких нет: вместе с любым городом выдача пуста.
    chat.user.catalogFilter = { deal: 'sale', type: 'house', bedrooms: 0, city: 'Финестрат' };
    await chat.say('Бенидорм');
    assert.deepEqual(chat.user.catalogFilter, { deal: '', type: '', bedrooms: 0, city: 'Бенидорм', district: '', minPrice: 0, maxPrice: 0, sort: '' }, 'фильтр заменён городом');
    assert.ok(bot.catalogRecords(chat.user, 'all').length > 0, 'и клиент видит объекты Бенидорма');
  });

  test('favourites are never filtered', () => {
    withCatalog(catalog);
    const chat = createChat();
    chat.user.favorites = ['rent-house-5', 'sale-villa-3'];
    chat.user.catalogFilter = { deal: 'sale', type: '', bedrooms: 0 };
    assert.equal(bot.catalogRecords(chat.user, 'favorites').length, 2);
  });
});

test.describe('access from the internet', () => {
  const http = require('node:http');
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  let baseUrl;

  function local(method, url, { headers = {}, cookie = '', csrf = '', body } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(baseUrl + url, { method, headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...headers } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
      });
      request.on('error', reject);
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  }

  // What cloudflared looks like to the bot: a process that prints its address.
  function fakeTunnelProcess() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    return child;
  }

  const THROUGH_TUNNEL = { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-proto': 'https' };

  test.before(async () => {
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + bot.server.address().port;
  });
  test.after(() => {
    bot.stopTunnel();
    bot.server.close();
    require('node:fs').rmSync(fakeCloudflared, { force: true });
  });
  test.beforeEach(() => resetData((data) => {
    const password = bot.hashPassword('correct-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.config.adminNotificationVerifiedAt = new Date().toISOString();
  }));

  test('requests through a proxy or to a public name are remote', () => {
    const request = (address, headers) => ({ socket: { remoteAddress: address }, headers });
    assert.equal(bot.requestIsRemote(request('127.0.0.1', { host: '127.0.0.1:3000' })), false);
    assert.equal(bot.requestIsRemote(request('::1', { host: 'localhost:3000' })), false);
    assert.equal(bot.requestIsRemote(request('127.0.0.1', { host: '127.0.0.1:3000', 'cf-connecting-ip': '1.2.3.4' })), true);
    assert.equal(bot.requestIsRemote(request('127.0.0.1', { host: 'abc.trycloudflare.com' })), true);
    assert.equal(bot.requestIsRemote(request('192.168.1.20', { host: '192.168.1.5:3000' })), true);
  });

  test('a remote login needs the code sent to the admin chat', async () => {
    const start = await local('POST', '/api/login', { headers: THROUGH_TUNNEL, body: { password: 'correct-password' } });
    assert.equal(start.status, 200);
    assert.equal(start.json.twoFactor, true);
    assert.equal(start.headers['set-cookie'], undefined, 'no session before the code');
    const [notice] = adminMessages();
    const code = notice.text.match(/Код для входа в панель: (\d{6})/)[1];
    assert.match(notice.text, /203\.0\.113\.7/);

    const wrong = await local('POST', '/api/login/verify', { headers: THROUGH_TUNNEL, body: { challenge: start.json.challenge, code: code === '000000' ? '111111' : '000000' } });
    assert.equal(wrong.status, 401);
    const right = await local('POST', '/api/login/verify', { headers: THROUGH_TUNNEL, body: { challenge: start.json.challenge, code } });
    assert.equal(right.status, 200);
    assert.match(String(right.headers['set-cookie']), /; Secure/);
    const reused = await local('POST', '/api/login/verify', { headers: THROUGH_TUNNEL, body: { challenge: start.json.challenge, code } });
    assert.equal(reused.status, 401, 'a code works once');
  });

  test('a code stops working after five wrong tries', async () => {
    const start = await local('POST', '/api/login', { headers: THROUGH_TUNNEL, body: { password: 'correct-password' } });
    const code = adminMessages()[0].text.match(/(\d{6})/)[1];
    const other = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) await local('POST', '/api/login/verify', { headers: { ...THROUGH_TUNNEL, 'cf-connecting-ip': '203.0.113.' + (20 + attempt) }, body: { challenge: start.json.challenge, code: other } });
    const late = await local('POST', '/api/login/verify', { headers: { ...THROUGH_TUNNEL, 'cf-connecting-ip': '203.0.113.99' }, body: { challenge: start.json.challenge, code } });
    assert.equal(late.status, 401);
    assert.equal(late.json.expired, true);
  });

  test('without a verified admin chat a remote login goes nowhere', async () => {
    bot.getData().config.adminNotificationVerifiedAt = '';
    const start = await local('POST', '/api/login', { headers: { ...THROUGH_TUNNEL, 'cf-connecting-ip': '203.0.113.50' }, body: { password: 'correct-password' } });
    // Ответ такой же, как на неверный пароль: снаружи не видно, угадан ли он.
    // Кода при этом никто не получает, а владелец видит причину в журнале.
    assert.equal(start.status, 200);
    assert.equal(start.json.twoFactor, true);
    const verify = await local('POST', '/api/login/verify', {
      headers: { ...THROUGH_TUNNEL, 'cf-connecting-ip': '203.0.113.50' },
      body: { challenge: start.json.challenge, code: '000000' },
    });
    assert.equal(verify.status, 401, 'войти всё равно нельзя');
    assert.ok(bot.getData().errors.some((item) => item.area === 'Код для входа'), 'причина записана в журнал');
  });

  test('a login on this computer still needs only the password', async () => {
    const login = await local('POST', '/api/login', { body: { password: 'correct-password' } });
    assert.equal(login.status, 200);
    assert.ok(login.json.csrf);
    assert.doesNotMatch(String(login.headers['set-cookie']), /Secure/);
  });

  test('the tunnel address is picked up, allowed and sent to the admin', () => {
    bot.getData().config.remoteAccess = true;
    const child = fakeTunnelProcess();
    bot.startTunnel(() => child);
    child.stderr.write('2026-09-18T10:00:00Z INF |  https://quiet-river-1234.trycloudflare.com                  |\n');
    const tunnel = bot.getData() && require('../bot.js').runtime.tunnel;
    assert.deepEqual([tunnel.status, tunnel.url], ['online', 'https://quiet-river-1234.trycloudflare.com']);
    assert.equal(bot.hostAllowed({ headers: { host: 'quiet-river-1234.trycloudflare.com' } }), true);
    assert.equal(bot.hostAllowed({ headers: { host: 'other.trycloudflare.com' } }), false, 'only this tunnel');
    bot.stopTunnel();
    assert.equal(child.killed, true);
    assert.equal(bot.hostAllowed({ headers: { host: 'quiet-river-1234.trycloudflare.com' } }), false, 'not after it is stopped');
  });

  // Доступ из интернета и туннель — по текущему паролю: украденной сессии
  // мало, чтобы подставить свой туннель и открыть дорогу в домашнюю сеть.
  const withPassword = (password = 'correct-password') => ({ 'x-current-password': Buffer.from(password).toString('base64') });

  test('turning the access on requires a verified admin chat', async () => {
    const login = await local('POST', '/api/login', { body: { password: 'correct-password' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    bot.getData().config.adminNotificationVerifiedAt = '';
    const refused = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, headers: withPassword(), body: { enabled: true } });
    assert.equal(refused.status, 400);
    assert.equal(bot.getData().config.remoteAccess, false);
    const off = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, headers: withPassword(), body: { enabled: false } });
    assert.equal(off.status, 200);
  });

  test('доступ из интернета и туннель меняются только по текущему паролю', async () => {
    const login = await local('POST', '/api/login', { body: { password: 'correct-password' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const token = 'eyJhIjoiOTk5IiwidCI6Ijg4OCIsInMiOiJjaHV6aG9qLXR1bm5lbC12YWx1ZS10ZXN0In0=';

    const noPassword = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, body: { enabled: false, tunnelToken: token } });
    assert.equal(noPassword.status, 403, 'без пароля туннель не подменить');
    assert.notEqual(bot.getData().config.tunnelToken, token);

    const wrongPassword = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, headers: withPassword('не тот пароль'), body: { enabled: false, tunnelToken: token } });
    assert.equal(wrongPassword.status, 403);
    assert.notEqual(bot.getData().config.tunnelToken, token);

    const ok = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, headers: withPassword(), body: { enabled: false, tunnelToken: token } });
    assert.equal(ok.status, 200, 'с паролем — можно');
    assert.equal(bot.getData().config.tunnelToken, token);
  });

  test('cloudflared URLs are read from its log lines', () => {
    assert.equal(bot.tunnelUrlFrom('INF |  https://Big-Cat-9.trycloudflare.com  |'), 'https://big-cat-9.trycloudflare.com');
    assert.equal(bot.tunnelUrlFrom('INF Requesting new quick Tunnel on trycloudflare.com...'), '');
  });

  // Seen on this computer's network: the quick-tunnel API is blocked.
  const BLOCKED = 'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded (Client.Timeout exceeded while awaiting headers)';

  test('the address of cloudflared\'s own API is never taken for the panel address', () => {
    assert.equal(bot.tunnelUrlFrom(BLOCKED), '');
    assert.equal(bot.tunnelUrlFrom('INF calling https://api.trycloudflare.com/tunnel'), '');
  });

  test('a blocked quick-tunnel service is explained, and retries slow down', () => {
    bot.getData().config.remoteAccess = true;
    const first = fakeTunnelProcess();
    bot.startTunnel(() => first);
    first.stderr.write(BLOCKED + '\n');
    first.emit('exit', 1);
    const { runtime } = require('../bot.js');
    assert.equal(runtime.tunnel.status, 'error');
    assert.match(runtime.tunnel.error, /недоступен из этой сети/);
    assert.match(runtime.tunnel.error, /через 30 с/);
    assert.equal(runtime.tunnel.url, '');
    assert.equal(bot.getData().errors.filter((item) => item.area === 'Доступ из интернета').length, 1);
    bot.stopTunnel();
  });

  test('a named tunnel runs with the token in the environment and the configured address', () => {
    const data = bot.getData();
    data.config.remoteAccess = true;
    data.config.tunnelToken = 'eyJhIjoiMTIzIiwidCI6IjQ1NiIsInMiOiJzZWNyZXQtdmFsdWUtZm9yLXRlc3RzIn0=';
    data.config.tunnelHostname = 'panel.example.com';
    let launched;
    const child = fakeTunnelProcess();
    bot.startTunnel((command, args, options) => { launched = { args, options }; return child; });
    assert.deepEqual(launched.args, ['tunnel', '--no-autoupdate', 'run']);
    assert.ok(!launched.args.join(' ').includes(data.config.tunnelToken), 'the token is not on the command line');
    assert.equal(launched.options.env.TUNNEL_TOKEN, data.config.tunnelToken);
    child.stderr.write('INF Registered tunnel connection connIndex=0 location=mad01\n');
    const { runtime } = require('../bot.js');
    assert.deepEqual([runtime.tunnel.status, runtime.tunnel.url], ['online', 'https://panel.example.com']);
    assert.equal(bot.hostAllowed({ headers: { host: 'panel.example.com' } }), true);
    bot.stopTunnel();
  });

  test('the token is saved but never sent back to the browser', async () => {
    const login = await local('POST', '/api/login', { body: { password: 'correct-password' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const token = 'eyJhIjoiMTIzIiwidCI6IjQ1NiIsInMiOiJzZWNyZXQtdmFsdWUtZm9yLXRlc3RzIn0=';
    const bad = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, headers: withPassword(), body: { enabled: false, tunnelHostname: 'not a host' } });
    assert.equal(bad.status, 400);
    const saved = await local('PUT', '/api/remote-access', { cookie, csrf: login.json.csrf, headers: withPassword(), body: { enabled: false, tunnelHostname: 'https://Panel.Example.com/', tunnelToken: token } });
    assert.equal(saved.status, 200);
    assert.equal(bot.getData().config.tunnelHostname, 'panel.example.com');
    const state = await local('GET', '/api/state', { cookie });
    assert.equal(state.json.config.tunnelTokenSet, true);
    assert.ok(!JSON.stringify(state.json).includes(token));
  });
});

test.describe('lead source', () => {
  test.beforeEach(() => resetData());

  test('a start link with src_ remembers where the client came from', async () => {
    const client = newcomer('ru');
    const sent = await client.say('/start src_Instagram');
    assert.equal(client.user.source, 'instagram');
    assert.match(sent[0].body.text, /^Здравствуйте/, 'the client is greeted as usual');
    assert.equal(client.user.pendingStartPayload, '', 'the label is not treated as a property link');
    await client.say('/start src_facebook');
    assert.equal(client.user.source, 'instagram', 'the first source is kept');
    await client.say('Хочу виллу');
    assert.equal(client.user.source, 'instagram', 'later messages keep the source');
  });

  test('the source is shown in the inquiry notification', async () => {
    const client = newcomer('ru', 'Марина');
    await client.say('/start src_google');
    await client.say('Нужна квартира в Бенидорме');
    assert.ok(adminMessages().some((message) => message.text.includes('👤 Марина · RU · 📣 google')));
  });

  test('only valid labels are accepted', () => {
    assert.equal(bot.leadSourceFromPayload('src_insta-2026_q3'), 'insta-2026_q3');
    assert.equal(bot.leadSourceFromPayload('src_'), '');
    assert.equal(bot.leadSourceFromPayload('src_bad label'), '');
    assert.equal(bot.leadSourceFromPayload('property_abc12345'), '');
  });

  test('the daily digest splits new users by source', async () => {
    const data = bot.getData();
    data.config.notifyMode = 'inquiries';
    const yesterday = new Date(2026, 8, 17, 12, 0).toISOString().slice(0, 10);
    data.analytics.daily[yesterday] = { received: 3, sent: 3, reactions: 0, inquiries: 1, menu: {} };
    for (const [id, source] of [['1', 'instagram'], ['2', 'instagram'], ['3', '']]) {
      data.users['77' + id] = { id: '77' + id, chatId: Number('77' + id), firstName: 'U', firstSeenAt: yesterday + 'T10:00:00.000Z', source, activity: [] };
    }
    const digest = await bot.runDailyDigest(new Date(2026, 8, 18, 10, 0));
    assert.match(digest, /Новых пользователей: 3 \(instagram — 2, без метки — 1\)/);
  });
});

test('фотографии листаются в карточке, а чат не растёт', async () => {
  // Раньше «Все фотографии» присылали альбом из отдельных сообщений и следом
  // вопрос «Что вы хотите сделать дальше?» с третьим набором кнопок. Клиент
  // терял карточку объекта из виду, а чат зарастал.
  resetData((data) => {
    const home = property('flip-01', 'Дом с тремя фото', 'active');
    home.imagesByLanguage.ru.push({ ...home.imagesByLanguage.ru[0], id: 'flip-01-b' });
    home.imagesByLanguage.ru.push({ ...home.imagesByLanguage.ru[0], id: 'flip-01-c' });
    data.objects.push(home);
  });
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);

  // Фотография уходит вложением, поэтому поле media приходит строкой.
  const mediaOf = (call) => (typeof call.body.media === 'string' ? JSON.parse(call.body.media) : call.body.media);
  const opened = await chat.press('property:gallery:flip-01', { card: true });
  const firstEdit = opened.calls.filter((call) => call.method === 'editMessageMedia');
  assert.equal(firstEdit.length, 1, 'открылась первая фотография прямо в карточке');
  assert.ok(!/1 \/ 3/.test(mediaOf(firstEdit[0]).caption), 'номер фотографии — на кнопке между стрелками, в подписи его нет');
  assert.ok(opened.calls.some((call) => JSON.stringify(call.body.reply_markup || '').includes('1 / 3')), 'на кнопке видно, какая это фотография из скольких');
  assert.equal(opened.calls.some((call) => call.method === 'sendPhoto' || call.method === 'sendMediaGroup'), false, 'новых сообщений в чате не появилось');

  const next = await chat.press('property:photo:1:flip-01', { card: true });
  const secondEdit = next.calls.filter((call) => call.method === 'editMessageMedia');
  assert.equal(secondEdit.length, 1, 'следующая фотография тоже меняется на месте');
  assert.ok(JSON.stringify(secondEdit[0].body.reply_markup).includes('2 / 3'), 'номер — на кнопке');
  const buttons = secondEdit[0].body.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(buttons.includes('property:photo:0:flip-01'), 'есть шаг назад');
  assert.ok(buttons.includes('property:photo:2:flip-01'), 'и шаг вперёд');
  assert.ok(buttons.includes('property:viewing:flip-01'), 'записаться на просмотр можно прямо из фотографий');
  assert.ok(buttons.includes('property:card:flip-01'), 'и вернуться к карточке');

  // Последняя фотография ведёт на первую: листать можно по кругу.
  const wrapped = await chat.press('property:photo:3:flip-01', { card: true });
  assert.ok(JSON.stringify(wrapped.calls.filter((call) => call.method === 'editMessageMedia')[0].body.reply_markup).includes('1 / 3'), 'по кругу: снова первая, номер — на кнопке');

  const back = await chat.press('property:card:flip-01', { card: true });
  const restored = back.calls.filter((call) => call.method === 'editMessageMedia');
  assert.equal(restored.length, 1, 'карточка возвращается тем же сообщением');
  const cardButtons = restored[0].body.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(cardButtons.includes('property:gallery:flip-01'), 'на карточке снова кнопка «Фото»');
  assert.ok(cardButtons.includes('property:details:flip-01'), 'и «Подробнее»');
});

test('снижение цены видно на карточке, а не только в уведомлении', async () => {
  // Раньше прежняя цена существовала лишь мгновение — в уведомлении тем, у
  // кого объект в избранном. Все остальные видели просто цену и не понимали,
  // что объект подешевел; плашку «Цена снижена» владелец ставил руками.
  resetData((data) => {
    data.objects.push(property('price-01', 'Квартира с историей цены', 'active', { priceValue: 270000, currency: 'EUR', area: 90 }));
  });
  const record = bot.getData().objects.find((item) => item.id === 'price-01');

  // Цена снизилась — так это делает и панель, и загрузка с сайта.
  const before = { status: record.status, priceValue: record.priceValue };
  record.priceValue = 250000;
  bot.queuePropertyAlerts(record, before);
  assert.equal(record.previousPriceValue, 270000, 'прежняя цена сохранена');
  assert.ok(record.priceChangedAt, 'и время изменения');

  const caption = bot.objectCaptionHtml(record, 'ru');
  assert.match(caption, /<s>270\s000 €<\/s> 250\s000 €/, 'на карточке видно, что было и стало');

  // Цена вернулась обратно — зачёркивать больше нечего.
  bot.queuePropertyAlerts(record, { status: 'active', priceValue: 250000 });
  record.priceValue = 280000;
  bot.queuePropertyAlerts(record, { status: 'active', priceValue: 250000 });
  assert.equal(record.previousPriceValue, 0, 'пометка снята');
  assert.doesNotMatch(bot.objectCaptionHtml(record, 'ru'), /<s>/);
});

test('сохранение объекта без правки цены не стирает зачёркнутую старую цену', async () => {
  resetData((data) => {
    data.objects.push(property('price-03', 'Объект со снижением', 'active', { priceValue: 270000, currency: 'EUR', area: 90 }));
  });
  const record = bot.getData().objects.find((item) => item.id === 'price-03');
  record.priceValue = 250000;
  bot.queuePropertyAlerts(record, { status: 'active', priceValue: 270000 });
  assert.equal(record.previousPriceValue, 270000);

  // Владелец поправил описание и сохранил: цена та же.
  bot.queuePropertyAlerts(record, { status: 'active', priceValue: 250000 });
  bot.queuePropertyAlerts(record, { status: 'active', priceValue: 250000 });
  assert.equal(record.previousPriceValue, 270000, 'снижение осталось на карточке');
  assert.match(bot.objectCaptionHtml(record, 'ru'), /<s>270\s000 €<\/s>/);
});

test('старое снижение цены перестаёт показываться через месяц', async () => {
  resetData((data) => {
    data.objects.push(property('price-02', 'Давно подешевевшая', 'active', { priceValue: 200000, currency: 'EUR' }));
  });
  const record = bot.getData().objects.find((item) => item.id === 'price-02');
  record.previousPriceValue = 240000;
  record.priceChangedAt = new Date(Date.now() - 40 * 864e5).toISOString();
  assert.doesNotMatch(bot.objectCaptionHtml(record, 'ru'), /<s>/, 'снижение сорокадневной давности — уже не новость');

  record.priceChangedAt = new Date(Date.now() - 3 * 864e5).toISOString();
  assert.match(bot.objectCaptionHtml(record, 'ru'), /<s>240\s000 €<\/s>/, 'свежее — показываем');
});

test('«Подробнее» раскрывается в самой карточке, без второго набора кнопок', async () => {
  // Раньше «Подробнее» присылало отдельное сообщение и в нём ещё раз всё:
  // фотографии, связаться, похожие, назад. В чате оказывалось два набора
  // кнопок к одному объекту, и было неясно, какой из них «главный».
  resetData((data) => {
    data.objects.push(property('details-01', 'Квартира с описанием', 'active', {
      priceValue: 210000, currency: 'EUR', area: 75, url: 'https://example.com/flat', mapUrl: 'https://maps.google.com/?q=Benidorm',
    }));
  });
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);

  const opened = await chat.press('property:details:details-01', { card: true });
  const edited = opened.calls.filter((call) => call.method === 'editMessageCaption');
  assert.equal(edited.length, 1, 'описание раскрылось в той же карточке');
  assert.equal(opened.calls.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id)), false, 'второго сообщения нет');
  assert.match(edited[0].body.caption, /<b>Характеристики<\/b>/, 'показаны характеристики');
  const buttons = edited[0].body.reply_markup.inline_keyboard.flat().map((button) => button.callback_data || button.url);
  assert.ok(buttons.includes('property:card:details-01'), 'есть «Свернуть»');
  assert.ok(buttons.includes('property:similar:details-01'), 'похожие объекты — только здесь');
  assert.ok(buttons.includes('https://example.com/flat'), 'и ссылка на сайт');
  assert.equal(buttons.filter((data) => data === 'property:details:details-01').length, 0, '«Подробнее» само себя не повторяет');
});

test('длинное описание приходит отдельным сообщением, но без повтора кнопок', async () => {
  resetData((data) => {
    data.objects.push(property('details-02', 'Объект с длинным текстом', 'active', {
      priceValue: 300000, currency: 'EUR', area: 120,
      description: { ru: 'Очень подробное описание. '.repeat(60), en: 'Long text. '.repeat(60), es: 'Texto largo. '.repeat(60) },
    }));
  });
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);

  const opened = await chat.press('property:details:details-02', { card: true });
  assert.equal(opened.calls.filter((call) => call.method === 'editMessageCaption').length, 0, 'в подпись такой текст не помещается');
  const sent = opened.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
  assert.equal(sent.length, 1, 'пришло отдельное сообщение');
  const buttons = sent[0].body.reply_markup.inline_keyboard.flat().map((button) => button.callback_data || button.url);
  assert.ok(buttons.includes('property:return:details-02'), 'есть возврат к карточке');
  assert.equal(buttons.includes('property:manager:details-02'), false, 'кнопки карточки не повторяются');
  assert.equal(buttons.includes('property:viewing:details-02'), false, 'и запись на просмотр тоже');
});

test.describe('возврат к карточке не теряет навигацию', () => {
  const callbacksIn = (calls) => calls
    .filter((call) => ['editMessageCaption', 'editMessageMedia', 'editMessageReplyMarkup'].includes(call.method))
    .flatMap((call) => (call.body.reply_markup ? call.body.reply_markup.inline_keyboard.flat() : []))
    .map((button) => button.callback_data || button.url);
  const texts = () => resetData((data) => {
    for (const [index, name] of ['Первый', 'Второй', 'Третий'].entries()) {
      data.objects.push(property('nav-0' + (index + 1), name + ' дом', 'active', { priceValue: 200000 + index * 1000, currency: 'EUR', area: 80 }));
    }
  });

  test('после «Подробнее → Свернуть» остаются стрелки, номер и «Списком»', async () => {
    texts();
    const chat = createChat();
    await chat.say(bot.text.menuLabels.ru.objects);
    await chat.press('catalog:all:1', { card: true });

    await chat.press('property:details:nav-02', { card: true });
    const back = await chat.press('property:card:nav-02', { card: true });
    const buttons = callbacksIn(back.calls);
    assert.ok(buttons.includes('catalog:all:0') && buttons.includes('catalog:all:2'), 'стрелки к соседним объектам на месте');
    assert.ok(buttons.includes('catalog:none:0'), 'номер «2 / 3» на месте');
  });

  test('после «Фото → к карточке» тоже, и режим «избранное» не забывается', async () => {
    texts();
    const chat = createChat();
    chat.user.favorites = ['nav-01', 'nav-03'];
    await chat.say(bot.text.menuLabels.ru.objects);
    await chat.press('catalog:favorites:1', { card: true });

    await chat.press('property:gallery:nav-03', { card: true });
    const back = await chat.press('property:card:nav-03', { card: true });
    const buttons = callbacksIn(back.calls);
    assert.ok(buttons.some((data) => /^catalog:favorites:/.test(data)), 'листание идёт по избранному, а не по всему каталогу');
    assert.ok(!buttons.some((data) => /^catalog:all:/.test(data)), 'в общий каталог клиента не выбрасывает');
  });
});

test('«💬 Менеджер» со старой клавиатуры открывает контакты, а не создаёт заявку', async () => {
  resetData();
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);
  const before = bot.getData().inquiries.length;
  const step = await chat.say('💬 Менеджер');
  assert.equal(bot.getData().inquiries.length, before, 'заявка не создана');
  const replies = step.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
  assert.ok(replies.length > 0, 'клиенту ответили');
  assert.ok(!/получен/i.test(replies.map((call) => call.body.text).join(' ')), 'ответ не «ваше сообщение получено»');
});

test('слово «Испания» или «es» не меняет язык клиента', async () => {
  resetData();
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);
  assert.equal(chat.user.preferredLanguage, 'ru');
  for (const word of ['Испания', 'es', 'en']) {
    await chat.say(word);
    assert.equal(chat.user.preferredLanguage, 'ru', word + ' — не выбор языка');
  }
});

test('нажатие на текущий номер «n / m» в галерее не шлёт дубль и не сбрасывает file_id', async () => {
  resetData((data) => {
    const home = property('gal-same-01', 'Дом с фото', 'active', {});
    home.imagesByLanguage.ru.push({ ...home.imagesByLanguage.ru[0], id: 'gal-same-01-extra' });
    data.objects.push(home);
  });
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);
  await chat.press('property:gallery:gal-same-01', { card: true });
  const record = bot.getData().objects.find((item) => item.id === 'gal-same-01');
  const image = record.imagesByLanguage.ru[0];
  image.telegramFileId = 'known-file-id';

  const working = global.fetch;
  // Telegram отвечает на правку, которая ничего не меняет: «message is not modified».
  global.fetch = async (url, init) => {
    if (/\/editMessage/.test(String(url))) {
      telegram.calls.push({ method: String(url).split('/').pop(), body: init && typeof init.body === 'string' ? JSON.parse(init.body) : {} });
      return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message' }), { status: 400 });
    }
    return working(url, init);
  };
  try {
    const before = telegram.calls.length;
    await chat.press('property:photo:0:gal-same-01', { card: true });
    const calls = telegram.calls.slice(before);
    assert.equal(calls.some((call) => ['sendPhoto', 'sendMessage', 'sendMediaGroup'].includes(call.method) && String(call.body.chat_id) === String(chat.id)), false, 'дубль карточки не пришёл');
    assert.equal(image.telegramFileId, 'known-file-id', 'кэш file_id не сброшен');
  } finally {
    global.fetch = working;
  }
});

test('«message is not modified» — не сбой для любой правки сообщения, но другие ошибки остаются ошибками', async () => {
  const working = global.fetch;
  const answer = (description) => async () => new Response(JSON.stringify({ ok: false, error_code: 400, description }), { status: 400 });
  try {
    global.fetch = answer('Bad Request: message is not modified: exactly the same');
    for (const method of ['editMessageText', 'editMessageCaption', 'editMessageReplyMarkup', 'editMessageMedia']) {
      assert.equal(await bot.telegramRequest(TOKEN, method, { chat_id: 1, message_id: 2 }), true, method + ' — уже в нужном виде');
    }
    // Отправка нового сообщения с таким текстом ошибки — по-прежнему ошибка.
    await assert.rejects(bot.telegramRequest(TOKEN, 'sendMessage', { chat_id: 1, text: 'x' }));
    // И другая ошибка правки — тоже: сообщение удалено или слишком старое.
    global.fetch = answer('Bad Request: message to edit not found');
    await assert.rejects(bot.telegramRequest(TOKEN, 'editMessageText', { chat_id: 1, message_id: 2, text: 'x' }));
  } finally {
    global.fetch = working;
  }
});

test('клиент, застрявший в старой форме подбора, больше не получает «объект недоступен»', async () => {
  resetData();
  const chat = createChat();
  await chat.say(bot.text.menuLabels.ru.objects);
  chat.user.pendingAction = { type: 'property_selection', step: 'budget', createdAt: new Date().toISOString() };
  const step = await chat.say('Здравствуйте, есть ли парковка?');
  assert.equal(chat.user.pendingAction, null, 'висящее действие снято');
  const texts = step.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id)).map((call) => call.body.text).join(' ');
  assert.ok(!/уже недоступен/.test(texts), 'вопрос не принят за ответ старой формы');
});

test('«Объекты» из меню открывает весь каталог, а «ближайшие» смягчают условия', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('near-villa', 'Вилла у моря', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: 450000, currency: 'EUR', city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' } }));
    data.objects.push(property('near-flat', 'Квартира', 'active', { dealType: 'sale', propertyType: 'apartment', bedrooms: 2, priceValue: 200000, currency: 'EUR', city: { ru: 'Кальпе', en: 'Calpe', es: 'Calpe' } }));
  });
  const chat = createChat();

  // Прилипший фильтр (например, от мастера подбора) не должен прятать каталог.
  chat.user.catalogFilter = { deal: 'rent', type: '', bedrooms: 0, city: '', maxPrice: 0 };
  const opened = await chat.say(bot.text.menuLabels.ru.objects);
  assert.equal(chat.user.catalogFilter, null, 'фильтр сброшен');
  assert.ok(opened.calls.some((call) => call.method === 'sendPhoto'), 'клиент видит карточку, а не «ничего не найдено»');

  // Бюджет чуть ниже цены виллы: ничего нет, но при бюджете +20 % вилла находится.
  chat.user.catalogFilter = { deal: 'sale', type: '', bedrooms: 0, city: 'Альтеа', maxPrice: 400000 };
  const empty = await chat.press('catalog:all:0');
  assert.match(empty.last.text, /Ближайшие варианты: 1 — /, 'видно, что найдётся при небольшом смягчении');
  assert.ok(callbacksOf(empty.last.markup).includes('cfilter:nearby'));
  assert.ok(callbacksOf(empty.last.markup).includes('saved:save'), '«Сообщать о новых»');
  assert.ok(callbacksOf(empty.last.markup).includes('cfilter:manager'), '«Передать менеджеру»');

  const shown = await chat.press('cfilter:nearby');
  assert.ok(shown.calls.some((call) => call.method === 'sendPhoto'), 'показана ближайшая карточка');
  assert.equal(chat.user.catalogFilter.maxPrice, 480000, 'бюджет +20 % округлён вверх до тысячи');
  assert.equal(chat.user.catalogFilter.city, 'Альтеа', 'город остался');
});

test('пример в приветствии берётся из настоящего каталога и находит объект', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('example-villa', 'Вилла в Альтее', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: 320000, currency: 'EUR', city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' } }));
  });
  // Новый клиент видит приветствие с примером из каталога.
  const newcomer = createChat();
  newcomer.user.preferredLanguage = '';
  const welcome = await newcomer.say('/start');
  const text = String(welcome.replies[0].text || welcome.replies[0].caption || '').replace(/ /g, ' ');
  assert.ok(text.includes('«Альтеа, 3 спальни, до 350 000 €»'), 'пример собран из каталога: ' + text);

  // Английский пример из того же каталога, написанный слово в слово, находит объект.
  const english = createChat({ language: 'en' });
  const found = await english.say('3 bedrooms in Altea under €350,000');
  assert.ok(found.calls.some((call) => call.method === 'sendPhoto'), 'запрос из примера находит объект');
});
