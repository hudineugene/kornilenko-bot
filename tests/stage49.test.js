'use strict';

// Этап 49: правила длины и вида выполняются на трёх языках и во всех режимах. Карточка: до 10 строк телефона в каталоге и до 12
// в остальных режимах; подписи кнопок — в бюджете ряда; у каждого экрана с кнопками — жирный заголовок; «назад» — одно слово.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
const length = (text) => Array.from(String(text).replaceAll('️', '')).length;
// Сколько строк займёт текст на экране телефона: в пузыре Telegram помещается около 38 знаков.
const phoneLines = (text) => String(text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / 38)), 0);
const plain = (html) => String(html).replace(/<[^>]*>/g, '');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const photos = (id, count) => Array.from({ length: count }, (_, index) => ({ id: id + '-' + index, mimeType: 'image/png', dataBase64: PNG }));
const threePhotos = (id) => ({ ru: photos(id + 'ru', 3), en: photos(id + 'en', 3), es: photos(id + 'es', 3) });

test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('villa-a', 'Вилла у моря', 'active', {
    propertyType: 'villa', priceValue: 650000, currency: 'EUR', area: 180, plotArea: 500, bedrooms: 4, bathrooms: 3, distanceSea: 150,
    badges: ['new'], imagesByLanguage: threePhotos('villa-a'),
    // Длинное первое предложение: на карточке остаётся не больше двух строк телефона.
    description: {
      ru: 'Просторная вилла в первой линии с частным бассейном, садом и видом на море, всего в двух шагах от пляжа и ресторанов. Второй абзац.',
      en: 'A spacious first-line villa with a private pool, a garden and sea views, just steps from the beach and restaurants. Second paragraph.',
      es: 'Amplia villa en primera línea con piscina privada, jardín y vistas al mar, a pocos pasos de la playa y los restaurantes. Segundo párrafo.',
    },
  }));
  data.objects.push(property('flat-ask', 'Квартира без цены', 'active', { priceValue: null, imagesByLanguage: threePhotos('flat-ask'), propertyType: 'apartment' }));
  data.objects.push(property('flat-c', 'Квартира в центре', 'active', { priceValue: 320000, currency: 'EUR', imagesByLanguage: threePhotos('flat-c') }));
}));

// Бюджет подписи по ширине кнопки в Telegram: две в ряду ≈ 13 знаков под фото (15 под текстом), три ≈ 10, полный ряд ≈ 32.
function budgetProblems(rows, label, photo) {
  const problems = [];
  for (const row of rows) {
    const texts = row.map((button) => button.text);
    const budget = row.length >= 4 ? 8 : row.length === 3 ? 10 : row.length === 2 ? (photo ? 13 : 15) : 32;
    if (texts.every((text) => length(text) <= 5)) continue;
    for (const text of texts) if (length(text) > budget) problems.push(label + ': «' + text + '» (' + length(text) + ') не помещается в ряд из ' + row.length);
  }
  return problems;
}

const keyboardOf = (calls) => calls.flatMap((call) => (call.body && call.body.reply_markup && call.body.reply_markup.inline_keyboard) || []);

for (const language of ['ru', 'en', 'es']) {
  test(language + ': карточка с тремя фото и карточка «цена по запросу» — кнопки в бюджете, в каталоге до 10 строк, тизер до двух', async () => {
    const chat = createChat({ language });
    let step = await chat.say(MENU[language].objects);
    const seen = [];
    for (let page = 0; page < 3; page += 1) {
      const card = step.calls.find((call) => call.method === 'sendPhoto' || call.method === 'editMessageMedia');
      assert.ok(card, language + ': карточка ' + page);
      const rows = card.body.reply_markup.inline_keyboard;
      const caption = plain(card.body.caption || (card.body.media && card.body.media.caption));
      seen.push(caption);
      assert.deepEqual(budgetProblems(rows, language + ' стр.' + page, true), []);
      assert.ok(rows.length <= 5, 'не больше пяти рядов (' + rows.length + ')');
      assert.ok(rows.flat().some((button) => button.callback_data && button.callback_data.startsWith('property:gallery:')), 'кнопка «Фото» есть: фото больше одного');
      assert.ok(phoneLines(caption) <= 10, language + ': в каталоге до 10 строк телефона, а тут ' + phoneLines(caption) + '\n' + caption);
      const next = rows.flat().find((button) => button.text === '▶️');
      if (!next) break;
      step = await chat.press(next.callback_data, { card: true });
    }
    assert.equal(seen.length, 3, 'прошли все три объекта');
    const villa = seen.find((caption) => /Вилла|villa/i.test(caption));
    const lines = villa.split('\n');
    const teaser = lines[lines.length - 1];
    assert.ok(phoneLines(teaser) <= 2, language + ': тизер в ' + phoneLines(teaser) + ' строк: ' + teaser);
  });
}

test('избранное: карточка не длиннее 12 строк телефона', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    for (const id of ['villa-a', 'flat-c']) await chat.press('property:favorite:' + id);
    const step = await chat.press('catalog:favorites:0');
    const card = step.calls.find((call) => call.method === 'sendPhoto' || call.method === 'editMessageMedia');
    const caption = plain(card.body.caption || (card.body.media && card.body.media.caption));
    assert.ok(phoneLines(caption) <= 12, language + ': избранное в ' + phoneLines(caption) + ' строк\n' + caption);
  }
});

test('у каждого экрана с кнопками жирный заголовок: прогон по разделам на трёх языках', async () => {
  const missing = [];
  const check = (calls, label) => {
    for (const call of calls) {
      const body = call.body;
      if (!['sendMessage', 'editMessageText'].includes(call.method) || !body.reply_markup || !body.reply_markup.inline_keyboard) continue;
      const bold = (Array.isArray(body.entities) && body.entities.some((item) => item.type === 'bold' && item.offset === 0)) || (body.parse_mode === 'HTML' && String(body.text).startsWith('<b>'));
      if (!bold) missing.push(label + ': «' + String(body.text).split('\n')[0].slice(0, 50) + '»');
    }
  };
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    const m = MENU[language];
    for (const entry of [m.objects, m.selection, m.promotions, m.favorites, m.contacts, m.more].filter(Boolean)) check((await chat.say(entry)).calls, language + ' ' + entry);
    for (const callback of ['catalog:favorites:0', 'compare:view', 'cfilter:open', 'cfilter:more', 'cfilter:cities:0', 'cfilter:prices:0', 'myreq:list', 'nav:my', 'privacy:open', 'subs:menu', 'nav:help', 'nav:about', 'nav:contact']) {
      check((await chat.press(callback)).calls, language + ' ' + callback);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('«назад» — ⬅️ и слово; листание — ◀️ ▶️; «заново» — ↺; «главное меню» — одной подписью на трёх языках', async () => {
  const labels = [];
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    const m = MENU[language];
    for (const entry of [m.objects, m.favorites, m.contacts, m.more].filter(Boolean)) labels.push(...keyboardOf((await chat.say(entry)).calls).flat().map((button) => button.text));
    for (const callback of ['compare:view', 'cfilter:open', 'cfilter:more', 'myreq:list', 'nav:my', 'privacy:open', 'nav:menu']) {
      labels.push(...keyboardOf((await chat.press(callback)).calls).flat().map((button) => button.text));
    }
  }
  const text = [...new Set(labels)];
  assert.ok(text.length > 20, 'кнопок для проверки достаточно: ' + text.length);
  assert.deepEqual(text.filter((label) => /^(↩|←|🔼|⬆️|🔙)/u.test(label) && !/^↩️ (Ещё не сделано|Not done yet|Aún no)$/.test(label)), [], 'других «назад» нет');
  assert.deepEqual(text.filter((label) => /^[➡▶]️? ?\S/u.test(label) && label !== '▶️'), [], '➡️ с подписью на листании нет');
  assert.deepEqual(text.filter((label) => /^🔄 /.test(label) && !/(Обновить|Update|Actualizar)/.test(label)), [], '🔄 — только «Обновить»');
  assert.deepEqual(text.filter((label) => /^🏠 /.test(label)).map((label) => label.replace(/^🏠\s*/u, '')).filter((label) => !['Главное меню', 'Main menu', 'Menú inicial'].includes(label)), [], 'главное меню — одна подпись');
});

test('фильтр при пяти типах объектов — не больше шести рядов, подписи в бюджете', async () => {
  resetData((data) => {
    data.config.active = true;
    for (const [index, type] of ['apartment', 'house', 'villa', 'townhouse', 'land'].entries()) {
      data.objects.push(property('t' + index, 'Объект ' + type, 'active', { propertyType: type, priceValue: 100000 * (index + 1), currency: 'EUR', plotArea: type === 'land' ? 800 : null }));
      data.objects[index].city = { ru: 'Город' + (index % 2), en: 'City' + (index % 2), es: 'Ciudad' + (index % 2) };
    }
  });
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    const step = await chat.press('cfilter:open');
    const rows = keyboardOf(step.calls);
    assert.ok(rows.length <= 6, language + ': рядов ' + rows.length + ' — ' + rows.map((row) => row.map((button) => button.text).join(' ')).join(' / '));
    assert.deepEqual(budgetProblems(rows, language, false), []);
  }
});
