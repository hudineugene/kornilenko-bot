'use strict';

// Этап 50: клиент понимает, что бот понял, и не теряет введённое.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
const plain = (html) => String(html).replace(/<[^>]*>/g, '');
// Экран бота после нажатия: бот правит сообщение на месте, поэтому смотрим на последний sendMessage/editMessageText.
const panelOf = (step) => {
  const call = [...step.calls].reverse().find((item) => ['sendMessage', 'editMessageText'].includes(item.method) && item.body.reply_markup);
  return { text: String(call.body.text), buttons: call.body.reply_markup.inline_keyboard.flat().map((button) => button.text), markup: call.body.reply_markup };
};
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

test('«Уведомления»: выключатели письма-подборки, «вернуться» и напоминаний о плане — на одном экране, обратимые; выключенных владельцем функций на экране нет', async () => {
  const chat = createChat();
  const off = await chat.press('subs:menu');
  const offLabels = panelOf(off).buttons.join(' | ');
  assert.doesNotMatch(offLabels, /Новинки раз в неделю|Напомнить вернуться|Напоминания о плане/, 'функции выключены в настройках бота: кнопок нет');
  bot.getData().config.engagement = { digest: true, comeback: true, planReminder: true };
  const on = await chat.press('subs:menu');
  for (const label of ['Новинки раз в неделю', 'Напомнить вернуться', 'Напоминания о плане']) assert.ok(panelOf(on).buttons.includes('✅ ' + label), label + ': ' + panelOf(on).buttons.join(' | '));
  await chat.press('subs:digest:off');
  await chat.press('subs:comeback:off');
  const shown = await chat.press('subs:plan:off');
  assert.equal(chat.user.digestOptOut, true);
  assert.equal(chat.user.comebackOptOut, true);
  assert.equal(chat.user.plan.remindOptOut, true);
  assert.ok(panelOf(shown).buttons.includes('⬜ Напоминания о плане'));
  await chat.press('subs:digest:on');
  await chat.press('subs:plan:on');
  assert.equal(chat.user.digestOptOut, false, 'включить обратно можно');
  assert.equal(chat.user.plan.remindOptOut, false);
});

test('мастер подбора: «Купить / Снять», «Назад» на первый шаг снимает прежний выбор и счётчик', async () => {
  const chat = createChat();
  const first = await chat.press('sel:restart:deal');
  assert.deepEqual(panelOf(first).buttons.slice(0, 2), ['Купить', 'Снять']);
  await chat.press('sel:deal:sale');
  const typed = await chat.press('sel:type:villa');
  assert.match(panelOf(typed).text, /Вилла/);
  const back = await chat.press('sel:back:deal');
  assert.doesNotMatch(panelOf(back).text, /Продажа|Вилла/, 'условия сняты: ' + panelOf(back).text);
  assert.match(panelOf(back).text, /Подходит: 2/, 'счётчик показывает весь каталог');
});

test('«Списком»: цена, спальни, площадь и город — а не пять одинаковых «Квартира · Бенидорм»', () => {
  const lines = bot.getData().objects.map((record, index) => bot.catalogListLine(record, 'ru', index + 1));
  for (const line of lines) assert.ok(Array.from(line).length <= 38, line);
  assert.match(lines[1], /^2\. .*€/, lines[1]);
});

test('пустой результат: рядом со сбросом есть «Фильтр», а смягчение названо словами', async () => {
  const chat = createChat();
  await chat.press('cfilter:open');
  chat.user.catalogFilter = { deal: 'sale', type: 'land', bedrooms: 0, city: '', district: '', minPrice: 0, maxPrice: 0, sort: '' };
  const step = await chat.press('catalog:all:0');
  const callbacks = callbacksOf(step.last.markup);
  assert.ok(callbacks.includes('cfilter:open') && callbacks.includes('cfilter:reset'), callbacks.join(' | '));
  assert.match(step.last.text, /Без типа «Участок» — найдено: \d/, step.last.text);
});
