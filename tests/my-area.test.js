'use strict';

// Похожие объекты, история просмотров и центр уведомлений в панели — то, что
// появилось последним и до сих пор проверялось только глазами.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, cleanup } = require('./helpers/chat');

// Центр уведомлений живёт своим модулем; он работает с теми же данными, что бот.
const centre = () => import('../src/admin-notifications.mjs');

const captions = () => telegram.calls
  .filter((call) => ['sendPhoto', 'sendMessage'].includes(call.method))
  .map((call) => call.body.caption || call.body.text || '');

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('flat-benidorm-01', 'Квартира в Бенидорме', 'active', {
    dealType: 'sale', propertyType: 'apartment', bedrooms: 2, bathrooms: 1, area: 70, priceValue: 250000, currency: 'EUR',
  }));
  data.objects.push(property('flat-benidorm-02', 'Похожая квартира рядом', 'active', {
    dealType: 'sale', propertyType: 'apartment', bedrooms: 2, bathrooms: 1, area: 75, priceValue: 265000, currency: 'EUR',
  }));
  data.objects.push(property('villa-altea-03', 'Вилла в Альтее', 'active', {
    dealType: 'sale', propertyType: 'villa', bedrooms: 5, bathrooms: 4, area: 320, priceValue: 1400000, currency: 'EUR',
    city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' },
  }));
  data.objects.push(property('flat-rent-04', 'Квартира в аренду', 'active', {
    dealType: 'rent', propertyType: 'apartment', bedrooms: 2, bathrooms: 1, area: 70, priceValue: 1200, pricePeriod: 'month', currency: 'EUR',
  }));
  data.objects.push(property('flat-hidden-05', 'Снятая с продажи', 'hidden', { dealType: 'sale', propertyType: 'apartment' }));
  data.objects.push(property('flat-benidorm-06', 'Ещё одна похожая квартира', 'active', {
    dealType: 'sale', propertyType: 'apartment', bedrooms: 2, bathrooms: 1, area: 68, priceValue: 240000, currency: 'EUR',
  }));
}));
test.after(cleanup);

test.describe('similar properties', () => {
  test('the closest property comes first, a different deal type and hidden ones never show', () => {
    const data = bot.getData();
    const source = data.objects[0];
    const ranking = bot.similarPropertyRanking(source, data.objects, 'ru');
    const ids = ranking.map((item) => item.record.id);
    assert.equal(ids[0], 'flat-benidorm-02', 'ближе всего похожая квартира рядом');
    assert.ok(!ids.includes('flat-rent-04'), 'аренду не показываем рядом с продажей');
    assert.ok(!ids.includes('flat-hidden-05'), 'скрытый объект клиенту не виден');
    assert.ok(!ids.includes(source.id), 'сам объект в похожие не попадает');
  });

  test('the client gets a mini-catalog of similar properties that can be paged', async () => {
    const chat = createChat();
    await chat.say('/start');
    telegram.calls = [];
    const shown = await chat.press('property:similar:flat-benidorm-01');
    const card = captions().join('\n');
    assert.match(card, /Похожая квартира рядом/);
    assert.equal(chat.user.similarPropertySourceId, 'flat-benidorm-01');
    assert.ok((chat.user.similarPropertyIds || []).length >= 1);
    assert.equal(chat.user.catalogContext.mode, 'similar');
    const buttons = (shown.calls.filter((call) => call.method === 'sendPhoto').pop() || { body: {} }).body.reply_markup;
    const callbacks = (buttons && buttons.inline_keyboard || []).flat().map((button) => button.callback_data).filter(Boolean);
    assert.ok(callbacks.some((value) => value.startsWith('catalog:similar:')), 'есть перелистывание внутри похожих');
    assert.ok(callbacks.some((value) => value.startsWith('property:details:')), 'из похожего можно открыть подробности');
  });

  test('a property that disappeared from the catalog does not break the mini-catalog', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.press('property:similar:flat-benidorm-01');
    const data = bot.getData();
    data.objects = data.objects.filter((record) => record.id !== 'flat-benidorm-02');
    telegram.calls = [];
    const again = await chat.press('catalog:similar:0');
    assert.ok(again.calls.length, 'бот отвечает, а не молчит');
    assert.ok(!captions().join('\n').includes('Похожая квартира рядом'));
  });
});

test.describe('the client history of viewed properties', () => {
  test('opening cards fills the history, newest first, without repeats', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('🏘 Объекты');
    await chat.press('catalog:all:2');
    await chat.press('catalog:all:0');
    assert.deepEqual(chat.user.recentlyViewed, ['flat-benidorm-01', 'villa-altea-03'], 'последний просмотр впереди, повторов нет');

    telegram.calls = [];
    await chat.press('catalog:recent:0');
    const text = captions().join('\n');
    assert.match(text, /Недавно просмотренные/);
    assert.match(text, /Квартира в Бенидорме/);
    assert.equal(chat.user.catalogContext.mode, 'recent');
  });

  test('the history holds at most twenty properties and skips ones that are gone', async () => {
    const chat = createChat();
    await chat.say('/start');
    chat.user.recentlyViewed = ['no-such-object'].concat(Array.from({ length: 25 }, (item, index) => 'ghost-' + index));
    const records = bot.catalogRecords(chat.user, 'recent');
    assert.deepEqual(records, [], 'исчезнувшие объекты в списке не показываются');
    await chat.say('🏘 Объекты');
    assert.equal(chat.user.recentlyViewed.length, 20, 'история не растёт бесконечно');
    assert.equal(chat.user.recentlyViewed[0], 'flat-benidorm-01');
  });

  test('a page of the history does not count as a new view', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('🏘 Объекты');
    await chat.press('catalog:all:2');
    const order = chat.user.recentlyViewed.slice();
    await chat.press('catalog:recent:1');
    assert.deepEqual(chat.user.recentlyViewed, order, 'просмотр истории её не переставляет');
  });
});

test.describe('the notification centre in the panel', () => {
  test('an inquiry without an answer becomes a notification and can be marked read', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('Здравствуйте! Есть ли парковка?');

    const { adminNotifications, updateAdminNotification } = await centre();
    const list = adminNotifications();
    assert.ok(list.length, 'в центре уведомлений есть запись');
    const item = list[0];
    assert.equal(item.active, true);
    assert.equal(item.readAt, '');
    assert.ok(item.id, 'у записи есть устойчивый номер');

    updateAdminNotification(item.id, 'read');
    const afterRead = adminNotifications().find((entry) => entry.id === item.id);
    assert.ok(afterRead.readAt, 'отметка «прочитано» сохраняется');
    assert.equal(afterRead.handledAt, '', 'прочитано — ещё не сделано');
  });

  test('a handled notification stays in the list even when the reason is gone', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('Пришлите, пожалуйста, подборку');
    const { adminNotifications, updateAdminNotification } = await centre();
    const item = adminNotifications()[0];
    updateAdminNotification(item.id, 'handle');

    const data = bot.getData();
    data.inquiries = [];
    const kept = adminNotifications().find((entry) => entry.id === item.id);
    assert.ok(kept, 'сделанное уведомление остаётся историей');
    assert.equal(kept.active, false);
    assert.ok(kept.handledAt);
  });

  test('marking everything read does not hide what still needs doing', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('Первый вопрос про ипотеку');
    const { adminNotifications, readAllAdminNotifications } = await centre();
    const before = adminNotifications();
    assert.ok(before.some((entry) => !entry.readAt));

    readAllAdminNotifications();
    const after = adminNotifications();
    assert.ok(after.every((entry) => entry.readAt), 'непрочитанных не осталось');
    assert.ok(after.some((entry) => entry.active && !entry.handledAt), 'но дело всё ещё в списке');
  });
});
