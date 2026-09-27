'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const SEARCH = bot.text.savedSearch;
const MENU = bot.text.menu;

function savedSearchCatalog(data) {
  data.objects.push(property('saved-villa-fit', 'Подходящая вилла', 'active', {
    dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: 500000,
    city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
    district: { ru: 'Ринкон-де-Лойкс', en: 'Rincon de Loix', es: 'Rincón de Loix' },
  }));
  data.objects.push(property('saved-flat-no', 'Другая квартира', 'active', {
    dealType: 'sale', propertyType: 'apartment', bedrooms: 2, priceValue: 220000,
    city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
  }));
  data.objects.push(property('saved-rent-no', 'Вилла в аренду', 'active', {
    dealType: 'rent', propertyType: 'villa', bedrooms: 4, priceValue: 2500,
    city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
  }));
}

test.beforeEach(() => resetData(savedSearchCatalog));
test.after(cleanup);

test('the current catalog filter becomes a clear saved search in My space', async () => {
  const chat = createChat();
  await chat.press('cfilter:deal:sale');
  const panel = await chat.press('cfilter:type:villa');
  const markup = panel.calls.filter((call) => call.method === 'editMessageText').pop().body.reply_markup;
  assert.ok(callbacksOf(markup).includes('saved:save'));

  const saved = await chat.press('saved:save');
  assert.deepEqual(chat.user.savedSearch.filter, {
    deal: 'sale', type: 'villa', bedrooms: 0, city: '', district: '', minPrice: 0, maxPrice: 0, sort: '',
  });
  assert.equal(chat.user.savedSearch.enabled, true);
  assert.equal(chat.user.propertyAlerts, true);
  assert.deepEqual(saved.popups, [SEARCH.ru.saved]);
  assert.match(saved.last.text, /^🔔 Сохранённый поиск/);
  assert.match(saved.last.text, /Продажа, Вилла/);
  assert.match(saved.last.text, /Сейчас подходит объектов: 1/);

  const personal = await chat.say(MENU.ru.more);
  assert.ok(personal.last.buttons.includes(SEARCH.ru.menuButton + ' · ' + SEARCH.ru.onShort));
  assert.ok(callbacksOf(personal.last.markup).includes('saved:view'));

  await chat.press('saved:results');
  assert.deepEqual(bot.catalogRecords(chat.user).map((record) => record.id), ['saved-villa-fit']);
  const edit = await chat.press('saved:edit');
  assert.ok(callbacksOf(edit.last.markup).includes('saved:view'), 'unchanged criteria open the saved search instead of saving a duplicate');
});

test('a client can pause, resume and delete the saved search', async () => {
  const chat = createChat();
  chat.user.catalogFilter = { deal: 'sale', type: 'villa', bedrooms: 0, city: '', maxPrice: 0, sort: 'desc' };
  await chat.press('saved:save');

  let step = await chat.press('saved:toggle');
  assert.equal(chat.user.savedSearch.enabled, false);
  assert.deepEqual(step.popups, [SEARCH.ru.pausedNotice]);
  assert.match(step.last.text, new RegExp(SEARCH.ru.paused.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  step = await chat.press('saved:toggle');
  assert.equal(chat.user.savedSearch.enabled, true);
  assert.equal(chat.user.propertyAlerts, true);
  assert.deepEqual(step.popups, [SEARCH.ru.resumedNotice]);

  step = await chat.press('saved:delete');
  assert.equal(chat.user.savedSearch, null);
  assert.deepEqual(step.popups, [SEARCH.ru.removed]);
  assert.match(step.last.text, new RegExp(SEARCH.ru.empty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('new properties are matched against the explicit saved criteria once', () => {
  const data = bot.getData();
  const matching = data.objects[0];
  const user = {
    id: 'saved-client', chatId: 81001, firstName: 'Ирина', preferredLanguage: 'ru', activity: [],
    propertyAlerts: true,
    savedSearch: {
      filter: { deal: 'sale', type: 'villa', bedrooms: 3, city: 'Бенидорм', minPrice: 450000, maxPrice: 600000, sort: '' },
      enabled: true,
    },
  };
  data.users[user.id] = user;
  const deliveries = bot.propertyAlertDeliveries(matching, null);
  assert.deepEqual(deliveries.map((delivery) => delivery.user.id), [user.id]);
  assert.equal(deliveries[0].heading, SEARCH.ru.newMatch);
  assert.match(deliveries[0].key, /^saved-match:/);

  user.savedSearch.enabled = false;
  assert.deepEqual(bot.propertyAlertDeliveries(matching, null), []);
  user.savedSearch.enabled = true;
  user.savedSearch.filter.minPrice = 550000;
  assert.deepEqual(bot.propertyAlertDeliveries(matching, null), []);
  user.savedSearch.filter.minPrice = 450000;
  user.savedSearch.filter.maxPrice = 400000;
  assert.deepEqual(bot.propertyAlertDeliveries(matching, null), []);
});

test('the saved city follows a language change and persisted data is normalized', async () => {
  const chat = createChat();
  chat.user.catalogFilter = { city: 'Бенидорм', district: 'Ринкон-де-Лойкс' };
  await chat.press('saved:save');
  await chat.press('language:en');
  assert.equal(chat.user.savedSearch.filter.city, 'Benidorm');
  assert.equal(chat.user.savedSearch.filter.district, 'Rincon de Loix');
  assert.equal(bot.savedSearchResults(chat.user)[0].id, 'saved-villa-fit');

  const loaded = bot.normalizeLoadedData({
    version: 20,
    users: { one: { id: 'one', savedSearch: { filter: { deal: 'sale', type: 'villa', sort: 'desc' }, enabled: false } } },
  });
  assert.deepEqual(loaded.users.one.savedSearch.filter, {
    deal: 'sale', type: 'villa', bedrooms: 0, city: '', district: '', minPrice: 0, maxPrice: 0, sort: '',
  });
  assert.equal(loaded.users.one.savedSearch.enabled, false);
});
