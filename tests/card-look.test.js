'use strict';

// Вид карточки объекта в боте (этап 44): помещается на экран телефона, подписи кнопок не обрезаются, значки не
// путаются. Бюджеты — по ширине кнопки в Telegram: две в ряду ≈ 13 знаков, три ≈ 10, полный ряд ≈ 32.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
const length = (text) => Array.from(String(text).replaceAll('️', '')).length;

test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('villa-a', 'Вилла у моря', 'active', {
    propertyType: 'villa', priceValue: 650000, currency: 'EUR', area: 180, plotArea: 500, bedrooms: 4, bathrooms: 3,
    badges: ['new'], distanceSea: 150, url: 'https://example.com/villa', mapUrl: 'https://maps.example.com/villa',
    district: { ru: 'Золотая Миля', en: 'Golden Mile', es: 'Milla de Oro' },
  }));
  data.objects.push(property('flat-b', 'Квартира в центре', 'active', { priceValue: 320000, currency: 'EUR', area: 70, bedrooms: 2, floor: '2', floors: '8', distanceSea: 150 }));
}));

function budgetProblems(rows, label) {
  const problems = [];
  for (const row of rows) {
    const texts = row.map((button) => button.text);
    const budget = row.length >= 3 ? 10 : row.length === 2 ? 13 : 32;
    // Ряд значков (сердце, сравнение, стрелки, «1 / 2») — не подписи.
    if (texts.every((text) => length(text) <= 5)) continue;
    for (const text of texts) if (length(text) > budget) problems.push(label + ': «' + text + '» (' + length(text) + ') не помещается в ряд из ' + row.length);
  }
  return problems;
}

for (const language of ['ru', 'en', 'es']) {
  test(language + ': карточка каталога — не больше 10 строк, заголовок жирным, без 💰 и без «🏘 Объекты», кнопки в бюджете', async () => {
    const chat = createChat({ language });
    const step = await chat.say(MENU[language].objects);
    const card = step.calls.find((call) => call.method === 'sendPhoto');
    const caption = card.body.caption;
    assert.ok(caption.split('\n').length <= 10, language + ': строк ' + caption.split('\n').length);
    assert.ok(caption.startsWith('<b>'), 'первая строка — заголовок жирным');
    assert.ok(!caption.includes('💰') && !caption.includes('🏘'), 'ни 💰, ни строки-«крошки»');
    const facts = caption.split('\n').filter((line) => /^(🛏|🚿|📐|🌿|🏢|🌊)/u.test(line));
    assert.ok(facts.every((line) => length(line) <= 30), 'характеристики короткими строками: ' + facts.join(' | '));
    const rows = card.body.reply_markup.inline_keyboard;
    assert.ok(rows.length <= 5, 'не больше пяти рядов кнопок: ' + rows.length);
    assert.deepEqual(budgetProblems(rows, language), []);
    assert.equal(rows.flat()[rows.flat().findIndex((button) => button.callback_data && button.callback_data.startsWith('property:favorite:'))].text, '🤍');
  });

  test(language + ': «Подробнее» — подписи ссылок и расчёта в бюджете, по одному факту в строке', async () => {
    const chat = createChat({ language });
    const first = await chat.say(MENU[language].objects);
    const more = callbacksOf(first.calls.find((call) => call.method === 'sendPhoto').body.reply_markup).find((value) => value.startsWith('property:details:'));
    const step = await chat.press(more, { card: true });
    const call = step.calls.find((item) => item.body && item.body.reply_markup);
    const rows = call.body.reply_markup.inline_keyboard;
    assert.deepEqual(budgetProblems(rows, language), []);
    const caption = String(call.body.caption || call.body.text);
    const factLines = caption.split('\n').filter((line) => /^(🛏|🚿|📐|🌿|🏢|🌊)/u.test(line));
    assert.ok(factLines.every((line) => !line.includes('   ·   ')), 'один факт на строку, без пар через пробелы');
  });
}

test('листание — всегда ◀️ ▶️, а ⬅️ только «назад»', async () => {
  const chat = createChat();
  const step = await chat.say(MENU.ru.objects);
  const rows = step.calls.find((call) => call.method === 'sendPhoto').body.reply_markup.inline_keyboard.flat();
  assert.ok(rows.some((button) => button.text === '◀️') && rows.some((button) => button.text === '▶️'), 'стрелки листания');
  assert.ok(!rows.some((button) => button.text === '⬅️' || button.text === '➡️'), '⬅️ ➡️ на листании нет');
});
