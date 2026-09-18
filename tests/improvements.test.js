'use strict';

// Language from Telegram, translation hints, persistent panel sessions,
// unclean-shutdown notice, favourite and selection alerts, lead sources and
// catalog filters.

const test = require('node:test');
const assert = require('node:assert/strict');
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
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.text, /^Здравствуйте, Новый!/);
    assert.ok(buttonsOf(sent[0].body.reply_markup).includes(MENU.ru.language), 'the language can still be changed');
  });

  test('regional codes such as en-US count as English', async () => {
    const client = newcomer('en-US', 'John');
    const sent = await client.say('/start');
    assert.equal(client.user.preferredLanguage, 'en');
    assert.match(sent[0].body.text, /^Hello, John!/);
  });

  test('a language the bot does not speak still gets the picker', async () => {
    const client = newcomer('uk');
    const sent = await client.say('/start');
    assert.equal(client.user.preferredLanguage, '');
    assert.deepEqual(callbacksOf(sent[0].body.reply_markup), ['language:ru', 'language:en', 'language:es']);
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
    user(9104, { favorites: ['villa-a'], preferredLanguage: 'es' });
    user(9105);
    const record = bot.getData().objects[0];
    record.priceValue = 450000;
    const deliveries = bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 500000 });
    assert.deepEqual(deliveries.map((delivery) => delivery.user.id), [fan.id], 'opted out, blocked and clients without a card in their language are skipped');
    assert.match(deliveries[0].heading, new RegExp('^' + ALERTS.ru.priceDrop));
    assert.match(deliveries[0].heading, /500\s000 EUR → 450\s000 EUR/);

    telegram.calls = [];
    assert.equal(await bot.deliverPropertyAlerts(deliveries, TOKEN), 1);
    const [card] = telegram.calls.filter((call) => call.method === 'sendPhoto');
    assert.equal(String(card.body.chat_id), fan.id);
    assert.ok(card.body.caption.startsWith(ALERTS.ru.priceDrop));
    assert.ok(callbacksOf(card.body.reply_markup).includes('alerts:off'));
    assert.deepEqual(bot.propertyAlertDeliveries(record, { status: 'active', priceValue: 500000 }), [], 'the same drop is not announced twice');
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

  test('an unknown price or bedroom count does not exclude a property', () => {
    user(9141); selection(9141, wishes({ budget: 'до 200 000', bedrooms: SELECTION.bedroomOptions[3] }));
    const record = bot.getData().objects[0];
    record.priceValue = null;
    record.bedrooms = null;
    assert.equal(bot.propertyAlertDeliveries(record, null).length, 1);
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
});

test.describe('catalog filter', () => {
  const FILTER = bot.text.catalogFilter.ru;
  const catalog = [
    ['sale-villa-3', 'sale', 'villa', 3],
    ['sale-villa-4', 'sale', 'villa', 4],
    ['sale-flat-2', 'sale', 'apartment', 2],
    ['sale-flat-x', 'sale', 'apartment', null],
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

  test('a small catalog has no filter button', async () => {
    withCatalog(catalog.slice(0, 4));
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    assert.ok(!callbacksOf(cardMarkup()).includes('cfilter:open'));
  });

  test('the filter narrows the catalog and is remembered', async () => {
    withCatalog(catalog);
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    assert.ok(callbacksOf(cardMarkup()).includes('cfilter:open'));

    const panel = await chat.press('cfilter:open');
    assert.equal(panel.last.text, FILTER.title);
    assert.ok(panel.last.buttons.includes('✓ ' + FILTER.anyDeal));
    assert.ok(panel.last.buttons.includes(FILTER.show + ': 7'));
    assert.ok(panel.last.buttons.includes('Вилла') && panel.last.buttons.includes('Дом') && !panel.last.buttons.includes('Участок'), 'only types present in the catalog are offered');

    const rent = await chat.press('cfilter:deal:rent');
    const edited = rent.calls.find((call) => call.method === 'editMessageText');
    assert.ok(edited.body.reply_markup.inline_keyboard.flat().some((button) => button.text === '✓ Аренда'));
    assert.ok(edited.body.reply_markup.inline_keyboard.flat().some((button) => button.text === FILTER.show + ': 3'));
    await chat.press('cfilter:bed:2');
    assert.deepEqual(chat.user.catalogFilter, { deal: 'rent', type: '', bedrooms: 2 });

    await chat.press('cfilter:show');
    assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['rent-flat-2', 'rent-house-5']);
    const filterButton = cardMarkup().inline_keyboard.flat().find((button) => button.callback_data === 'cfilter:open');
    assert.equal(filterButton.text, FILTER.button + ': Аренда, 2+ спален');

    await chat.say('Добрый день');
    assert.deepEqual(chat.user.catalogFilter, { deal: 'rent', type: '', bedrooms: 2 }, 'kept after other messages');
  });

  test('an empty result offers to reset the filter or leave wishes', async () => {
    withCatalog(catalog);
    const chat = createChat();
    await chat.press('cfilter:type:house');
    await chat.press('cfilter:deal:sale');
    const shown = await chat.press('cfilter:show');
    assert.ok(shown.last.text.startsWith(FILTER.empty));
    assert.deepEqual(callbacksOf(shown.last.markup), ['cfilter:reset', 'selection:start', 'nav:menu']);
    await chat.press('cfilter:reset');
    assert.equal(chat.user.catalogFilter, null);
    assert.equal(bot.catalogRecords(chat.user).length, 7);
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

  test('favourites are never filtered', () => {
    withCatalog(catalog);
    const chat = createChat();
    chat.user.favorites = ['rent-house-5', 'sale-villa-3'];
    chat.user.catalogFilter = { deal: 'sale', type: '', bedrooms: 0 };
    assert.equal(bot.catalogRecords(chat.user, 'favorites').length, 2);
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
