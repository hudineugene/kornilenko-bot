'use strict';

// Этап 46: короткие правки, видимые сразу. Каждая — про то, что клиент или владелец замечает с первого взгляда.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = '999';
  data.objects.push(property('p1', 'Вилла', 'active', { priceValue: 400000, currency: 'EUR' }));
}));

const callsOf = (step) => step.calls.filter((call) => call.body && (call.body.text || call.body.caption));
const lastBody = (step) => [...callsOf(step)].reverse()[0].body;
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('«Мои заявки»: несколько просьб о помощи по плану — одна строка заявки, без служебного текста, коротко', async () => {
  const expected = { ru: /📋 План · шаги 1, 2, 3/, en: /📋 Plan · steps 1, 2, 3/, es: /📋 Plan · pasos 1, 2, 3/ };
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    for (const step of [0, 1, 2]) await chat.press('plan:help:' + step);
    const body = lastBody(await chat.press('myreq:list'));
    assert.match(body.text, expected[language], language + ': ' + body.text);
    assert.doesNotMatch(body.text, /Клиент просит|The client asks|El cliente pide/, 'служебного текста для менеджера нет');
    assert.ok(body.text.split('\n').length <= 12, language + ': строк ' + body.text.split('\n').length);
    assert.equal(chat.inquiries.length, 1, 'просьбы собираются в одну заявку');
  }
});

test('«Мои заявки»: одна просьба по плану — «План · шаг N: название»', async () => {
  const chat = createChat();
  await chat.press('plan:help:1');
  const body = lastBody(await chat.press('myreq:list'));
  assert.match(body.text, /📋 План · шаг 2: Банковский счёт в Испании/);
});

test('своя цена в фильтре: после ввода и после отмены клавиатура главного меню на месте', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    await chat.say(MENU[language].objects);
    await chat.press('cfilter:prices:0');
    await chat.press('cfilter:price:custom');
    const done = await chat.say('500000');
    const keyboards = callsOf(done).map((call) => call.body.reply_markup).filter(Boolean);
    assert.ok(keyboards.some((markup) => markup.keyboard && !markup.remove_keyboard), language + ': меню вернулось');
    assert.ok(!keyboards.some((markup) => markup.remove_keyboard), language + ': клавиатура не убирается');

    await chat.press('cfilter:prices:0');
    await chat.press('cfilter:price:custom');
    const cancel = bot.text.catalogFilter[language].cancelCustomPrice;
    const cancelled = await chat.say(cancel);
    const afterCancel = callsOf(cancelled).map((call) => call.body.reply_markup).filter(Boolean);
    assert.ok(afterCancel.some((markup) => markup.keyboard), language + ': после отмены меню на месте');
    assert.ok(!afterCancel.some((markup) => markup.remove_keyboard));
  }
});

test('пустое избранное зовёт нажать 🤍, пустое сравнение — ⚖️: такие кнопки есть на карточке', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    const favourites = lastBody(await chat.press('catalog:favorites:0')).text;
    assert.ok(favourites.includes('🤍') && !favourites.includes('❤️'), language + ': ' + favourites);
    const comparison = lastBody(await chat.press('compare:view')).text;
    assert.ok(comparison.includes('⚖️'), language + ': ' + comparison);
    assert.doesNotMatch(comparison, /Добавить к сравнению|Add to comparison|Añadir a la comparación/);
  }
});

test('шапка панели: название агентства есть на каждой ширине (полное на широком, «Kornilenko» на ноутбуке и телефоне)', () => {
  const runtime = read('src', 'panel', 'runtime.mjs');
  assert.match(runtime, /<span class="brand-full">Construcciones Kornilenko<\/span><span class="brand-short">Kornilenko<\/span>/);
  const styles = read('src', 'panel', 'styles.mjs');
  assert.doesNotMatch(styles, /\.app-brand b\{display:none\}/, 'название целиком не прячется');
  assert.match(styles, /\.app-brand \.brand-full,\.app-brand \.brand-sub\{display:none\}\r?\n\s+\.app-brand \.brand-short\{display:inline\}/, 'на ноутбуке — короткое имя');
});

test('«База клиентов»: список этапов не растянут на всю ширину', () => {
  const styles = read('src', 'panel', 'styles.mjs');
  assert.match(styles, /\.toolbar select\{width:auto;min-width:200px;max-width:320px\}/);
  assert.match(styles, /\.toolbar select\{width:100%;max-width:none\}/, 'на телефоне — во всю ширину');
});

test('сообщения менеджеру ссылаются на разделы, которые есть в панели', () => {
  for (const file of ['admin-commands.mjs', 'notices.mjs', 'status.mjs']) {
    const source = read('src', file);
    assert.doesNotMatch(source, /раздел «Обращения»/, file);
    assert.doesNotMatch(source, /журнал ошибок на главной/, file);
  }
  assert.match(read('src', 'admin-commands.mjs'), /PLACES\.dialogs/);
  assert.match(read('src', 'status.mjs'), /PLACES\.dataCopies/);
  assert.match(read('src', 'places.mjs'), /dialogs: 'Клиенты → Диалоги'/);
});

test('жирный заголовок карточки — и в чате главного администратора, не только у менеджеров', async () => {
  const { screenTitleEntities } = await import('../src/telegram.mjs');
  const payload = { text: '📩 Новая заявка: вопрос по объекту\n👤 Мария · ES', reply_markup: { inline_keyboard: [[{ text: 'В работу', callback_data: 'x' }]] } };
  assert.deepEqual(screenTitleEntities({ ...payload, chat_id: 999 }), [{ type: 'bold', offset: 0, length: '📩 Новая заявка: вопрос по объекту'.length }]);
  assert.deepEqual(screenTitleEntities({ ...payload, chat_id: 123 }), screenTitleEntities({ ...payload, chat_id: 999 }), 'у менеджера так же');
});

test('экран политики: внизу возврат на «Ваши данные», а не кнопка «Как мы обращаемся с данными» на себя', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    const step = await chat.press('privacy:policy');
    const markup = lastBody(step).reply_markup;
    const callbacks = markup.inline_keyboard.flat().map((button) => button.callback_data);
    assert.ok(!callbacks.includes('privacy:policy'), language);
    assert.ok(callbacks.includes('privacy:open') && callbacks.includes('privacy:erase') && callbacks.includes('nav:my'), language + ': ' + callbacks.join(','));
  }
});
