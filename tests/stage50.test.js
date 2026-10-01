'use strict';

// Этап 50: клиент понимает, что бот понял, и не теряет введённое.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
const plain = (html) => String(html).replace(/<[^>]*>/g, '');
const captionOf = (calls) => {
  const card = calls.find((call) => call.method === 'sendPhoto' || call.method === 'editMessageMedia');
  return card ? plain(card.body.caption || (card.body.media && card.body.media.caption)) : '';
};

test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('villa-sea', 'Вилла у моря с бассейном', 'active', {
    propertyType: 'villa', priceValue: 650000, currency: 'EUR', area: 180, bedrooms: 4, bathrooms: 3,
    description: { ru: 'Вилла у моря с бассейном.', en: 'A villa by the sea with a pool.', es: 'Villa junto al mar con piscina.' },
  }));
  data.objects.push(property('flat-1', 'Квартира в центре', 'active', { priceValue: 220000, currency: 'EUR', area: 70 }));
}));

test('что понял бот: после свободного запроса над карточкой — строка условий и число подходящих', async () => {
  const chat = createChat();
  telegram.calls = [];
  await chat.say('вилла у моря с бассейном');
  const caption = captionOf(telegram.calls);
  assert.match(caption, /^🔎 .*(Вилла).*(у моря).*(бассейн).* — Подходит: 1\n/, caption);
  const paged = await chat.press('catalog:all:0', { card: true });
  assert.match(captionOf(paged.calls), /^🔎 /, 'строка остаётся при листании');
});

test('без условий над карточкой ничего лишнего: строки «что понял» нет', async () => {
  const chat = createChat();
  const step = await chat.say(MENU.ru.objects);
  assert.doesNotMatch(captionOf(step.calls), /🔎/);
});

test('пример запроса в приветствии — с признаком, если он есть у объекта в каталоге', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('v1', 'Вилла с бассейном', 'active', {
      propertyType: 'villa', priceValue: 650000, currency: 'EUR', area: 180, bedrooms: 3, bathrooms: 2, features: ['pool'],
    }));
  });
  const example = bot.searchExampleText({ preferredLanguage: 'ru' }, 'ru');
  assert.match(example, /с бассейном/, example);
  const chat = createChat();
  telegram.calls = [];
  await chat.say(example);
  assert.match(captionOf(telegram.calls), /Вилла с бассейном/, 'пример из приветствия находит этот объект');
});

test('запись на просмотр: дата, написанная словами, ведёт к вопросу о времени; время со слов — не спрашивается', async () => {
  for (const [typed, asks] of [['25 октября', true], ['25 октября после 16:00', false]]) {
    const chat = createChat();
    await chat.press('property:viewing:villa-sea');
    const step = await chat.say(typed);
    if (asks) {
      assert.match(plain(step.last.text), /Время/, 'спрашиваем время: ' + step.last.text);
      assert.deepEqual(step.last.buttons.slice(0, 3), bot.text.viewing.ru.timeOptions.slice(0, 3), 'с вариантами времени');
      const review = await chat.say('17:00');
      assert.match(review.text, /Время: 17:00/, 'написанное время принято: ' + review.text);
      assert.doesNotMatch(review.text, /Как указано/);
    } else {
      assert.match(step.text, /Как указано|после 16:00/, step.text);
    }
  }
});

test('время, набранное на шаге проверки, не теряется', async () => {
  const chat = createChat();
  await chat.press('property:viewing:villa-sea');
  await chat.say(bot.text.viewing.ru.dateOptions[1]);
  await chat.say(bot.text.viewing.ru.timeOptions[0]);
  const edited = await chat.say('в 18:30');
  assert.match(edited.text, /18:30/, 'проверка показывает новое время: ' + edited.text);
});

test('после записи без телефона — фраза «Оставьте номер…», а на кнопке — «Отправить мой номер»', () => {
  const copy = bot.text.viewing.ru;
  assert.match(copy.phoneAsk, /Оставьте номер/);
  assert.equal(copy.sharePhoneForViewing, '📱 Отправить мой номер');
  assert.notEqual(copy.phoneAsk, copy.sharePhoneForViewing, 'текст сообщения не равен подписи кнопки');
});

void callbacksOf;
