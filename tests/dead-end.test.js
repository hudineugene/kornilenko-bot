'use strict';

// «Нет тупика». Клиент нажал «Похожие», а похожих нет: раньше — фраза «сейчас
// похожих нет» и две кнопки (менеджеру и назад). Теперь ему предлагают
// «🔔 Сообщить, когда появится похожий» одним нажатием — сохранённый поиск с
// параметрами этой карточки — и «💶 Показать ближайшее по бюджету», если в
// каталоге есть хоть что-то рядом по цене.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const VILLA = 'villa-marbella-01';
const LAND = 'land-other-02';

test.beforeEach(() => resetData((data) => {
  data.objects.push(property(VILLA, 'Вилла в Марбелье', 'active', {
    propertyType: 'villa', priceValue: 900000, currency: 'EUR', bedrooms: 4,
    city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
  }));
}));
test.after(cleanup);

async function openSimilar(chat) {
  return chat.press('property:similar:' + VILLA);
}

function addUnrelatedObject(extra = {}) {
  // Участок к вилле «похожим» не считается — но цена рядом.
  bot.getData().objects.push(property(LAND, 'Участок у моря', 'active', { propertyType: 'land', plotArea: 1000, area: null, bedrooms: null, bathrooms: null, priceValue: 850000, currency: 'EUR', ...extra }));
}

test('похожих нет: кнопка «Сообщить, когда появится похожий»; «по бюджету» нет, пока не с чем сравнить', async () => {
  const chat = createChat();
  const step = await openSimilar(chat);
  assert.match(step.last.text, /похожих объектов нет/);
  const callbacks = callbacksOf(step.last.markup);
  assert.ok(callbacks.includes('saved:similar:' + VILLA), 'подписка на похожие');
  assert.ok(!callbacks.some((item) => item.startsWith('property:nearprice:')), 'сравнивать не с чем — кнопки нет');
  assert.ok(callbacks.includes('contact:question') && callbacks.includes('property:return:' + VILLA), 'прежние кнопки на месте');
  const notify = step.last.markup.inline_keyboard.flat().find((button) => button.callback_data === 'saved:similar:' + VILLA);
  assert.equal(notify.text, '🔔 Сообщить о похожих');
});

test('одно нажатие сохраняет поиск по параметрам карточки: сделка, тип, город, бюджет с запасом', async () => {
  const chat = createChat();
  await openSimilar(chat);
  const step = await chat.press('saved:similar:' + VILLA);
  const saved = chat.user.savedSearch;
  assert.ok(saved, 'поиск сохранён');
  assert.equal(saved.enabled, true, 'и включён');
  assert.deepEqual([saved.filter.deal, saved.filter.type, saved.filter.city], ['sale', 'villa', 'Марбелья']);
  assert.equal(saved.filter.maxPrice, 1100000, '900 000 + 20 % и округление вверх до 100 000');
  assert.equal(saved.filter.minPrice, 0);
  assert.equal(chat.user.propertyAlerts, true, 'уведомления о новых объектах включены');
  assert.match(step.text, /Сохранённый поиск/, 'клиент видит, что именно сохранено');

  // И правда сработает: новая вилла в Марбелье до 1,1 млн подходит, чужая — нет.
  const search = await import('../src/saved-search.mjs');
  const fits = property('new-villa', 'Новая вилла', 'active', { propertyType: 'villa', priceValue: 1000000, currency: 'EUR', city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } });
  const tooPricey = { ...fits, id: 'pricey', priceValue: 2500000 };
  assert.equal(search.savedSearchMatches(chat.user, fits), true);
  assert.equal(search.savedSearchMatches(chat.user, tooPricey), false);
});

test('повторное нажатие не плодит поиски: он один, обновляется', async () => {
  const chat = createChat();
  await openSimilar(chat);
  await chat.press('saved:similar:' + VILLA);
  const first = chat.user.savedSearch.createdAt;
  await chat.press('saved:similar:' + VILLA);
  assert.equal(chat.user.savedSearch.createdAt, first, 'дата создания прежняя');
});

test('«Ближайшее по бюджету»: показывает объекты рядом по цене, самые близкие первыми', async () => {
  addUnrelatedObject();
  bot.getData().objects.push(property('flat-cheap', 'Квартира недорогая', 'active', { propertyType: 'commercial', priceValue: 300000, currency: 'EUR' }));
  bot.getData().objects.push(property('flat-close', 'Офис почти по цене', 'active', { propertyType: 'commercial', priceValue: 880000, currency: 'EUR' }));
  const chat = createChat();
  const step = await openSimilar(chat);
  assert.match(step.last.text, /похожих объектов нет/, 'предпосылка: похожих нет');
  const budget = 'property:nearprice:' + VILLA;
  assert.ok(callbacksOf(step.last.markup).includes(budget));

  const shown = await chat.press(budget);
  assert.deepEqual(chat.user.similarPropertyIds.slice(0, 3), ['flat-close', LAND, 'flat-cheap'], 'по близости цены: 880 000, 850 000, 300 000');
  assert.equal(chat.user.similarPropertySourceId, VILLA, 'из списка можно вернуться к карточке');
  const photo = shown.calls.find((call) => ['sendPhoto', 'sendMessage'].includes(call.method));
  assert.ok(photo, 'клиент получил карточку');
  assert.match(String(photo.body.caption || photo.body.text), /Офис почти по цене/, 'первой — самая близкая по цене');
});

test('другая валюта и другая сделка «ближайшими по бюджету» не считаются', async () => {
  addUnrelatedObject({ currency: 'USD' });
  bot.getData().objects.push(property('rent-1', 'Аренда', 'active', { dealType: 'rent', propertyType: 'commercial', priceValue: 900000, currency: 'EUR' }));
  const chat = createChat();
  const step = await openSimilar(chat);
  assert.ok(!callbacksOf(step.last.markup).some((item) => item.startsWith('property:nearprice:')), 'сравнивать нечего: цены в другой валюте, аренда — другая сделка');
});

test('объект убрали, пока клиент читал: нажатие не ломается', async () => {
  const chat = createChat();
  await openSimilar(chat);
  bot.getData().objects.find((item) => item.id === VILLA).status = 'sold';
  const step = await chat.press('saved:similar:' + VILLA);
  assert.ok(!chat.user.savedSearch, 'поиск по проданному не сохраняется');
  assert.ok(step.popups.length, 'клиенту сказано, что кнопка устарела');
  const budget = await chat.press('property:nearprice:' + VILLA);
  assert.ok(budget.popups.length);
});
