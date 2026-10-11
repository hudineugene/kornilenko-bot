'use strict';

// Свободный поиск понимает признаки: «у моря», «с бассейном», «с террасой», «с парковкой», «с садом». «У моря» — это
// расстояние до моря до 500 м или слова в карточке; остальное — слова в карточке, которую написал владелец. Признак в
// фильтре виден в заголовке, переключается в «Ещё» и запоминается в сохранённом поиске.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
let naturalCatalogFilter;
let recordHasFeature;

const PNG = { id: 'x', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };
const images = { imagesByLanguage: { ru: [PNG], en: [PNG], es: [PNG] } };
const describeAs = (ru, en, es) => ({ description: { ru, en, es } });

test.before(async () => {
  ({ naturalCatalogFilter } = await import('../src/search.mjs'));
  ({ recordHasFeature } = await import('../src/catalog.mjs'));
});
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('sea-flat', 'Квартира на берегу', 'active', { propertyType: 'apartment', priceValue: 250000, currency: 'EUR', distanceSea: 150, ...images, ...describeAs('Светлая квартира.', 'A bright flat.', 'Un piso luminoso.') }));
  data.objects.push(property('pool-villa', 'Вилла в глубине', 'active', { propertyType: 'villa', priceValue: 600000, currency: 'EUR', distanceSea: 4000, ...images, ...describeAs('Вилла с бассейном и садом, гараж на две машины.', 'Villa with a pool and a garden, double garage.', 'Villa con piscina y jardín, garaje doble.') }));
  data.objects.push(property('plain-flat', 'Обычная квартира', 'active', { propertyType: 'apartment', priceValue: 180000, currency: 'EUR', distanceSea: 3000, ...images, ...describeAs('Квартира в городе.', 'A flat in town.', 'Un piso en la ciudad.') }));
}));
test.after(cleanup);

// Карточка уходит фото-сообщением: собираем и тексты, и подписи.
const shown = (step) => step.calls.filter((call) => call.body && (call.body.text || call.body.caption)).map((call) => call.body.text || call.body.caption).join(String.fromCharCode(10));
// Экран фильтра правится на месте (editMessageText): берём последний вызов с кнопками.
const panelOf = (step) => {
  const call = [...step.calls].reverse().find((item) => item.body && item.body.reply_markup && item.body.reply_markup.inline_keyboard);
  return { text: call.body.text || call.body.caption || '', buttons: call.body.reply_markup.inline_keyboard.flat().map((button) => button.text) };
};
const filterOf = (message, language = 'ru') => naturalCatalogFilter(message, bot.getData().objects, language);

test('фразы на трёх языках превращаются в признаки фильтра', () => {
  assert.deepEqual(filterOf('Квартира у моря').features, ['sea']);
  assert.equal(filterOf('Квартира у моря').type, 'apartment');
  assert.deepEqual(filterOf('вилла с бассейном').features, ['pool']);
  assert.deepEqual(filterOf('villa with pool', 'en').features, ['pool']);
  assert.deepEqual(filterOf('house near the beach', 'en').features, ['sea']);
  assert.deepEqual(filterOf('casa con piscina', 'es').features, ['pool']);
  assert.deepEqual(filterOf('piso cerca de la playa', 'es').features, ['sea']);
  assert.deepEqual(filterOf('Вилла с бассейном, садом и парковкой до 700 тысяч').features, ['pool', 'parking', 'garden']);
  assert.equal(filterOf('Вилла с бассейном, садом и парковкой до 700 тысяч').maxPrice, 700000);
  assert.deepEqual(filterOf('с бассейном').features, ['pool'], 'один признак короткой фразой — тоже запрос');
});

test('без признаков фильтр выглядит как раньше (поля features нет)', () => {
  const filter = filterOf('Квартира в Бенидорме до 300 тысяч');
  assert.ok(filter);
  assert.equal('features' in filter, false);
});

test('длинная болтовня с «у моря» остаётся вопросом менеджеру', () => {
  assert.equal(filterOf('Здравствуйте, мы думаем о переезде всей семьёй, подскажите, пожалуйста, что нас ждёт, нам нравится у моря'), null);
  assert.equal(filterOf('Есть ли у вас что-нибудь у моря?'), null, 'вопрос');
});

test('«у моря» — до 500 м или слова в карточке; остальное — слова в карточке на любом из трёх языков', () => {
  const [seaFlat, poolVilla, plainFlat] = bot.getData().objects;
  assert.equal(recordHasFeature(seaFlat, 'sea'), true);
  assert.equal(recordHasFeature(poolVilla, 'sea'), false, '4 км — не у моря');
  assert.equal(recordHasFeature(plainFlat, 'sea'), false);
  for (const key of ['pool', 'garden', 'parking']) assert.equal(recordHasFeature(poolVilla, key), true, key);
  assert.equal(recordHasFeature(poolVilla, 'terrace'), false);
  assert.equal(recordHasFeature({ ...plainFlat, description: { ru: '', en: 'Has a swimming pool', es: '' } }, 'pool'), true, 'достаточно любого языка');
  assert.equal(recordHasFeature({ ...plainFlat, description: { ru: 'Сад', en: '', es: '' } }, 'garden'), true);
  assert.equal(recordHasFeature({ ...plainFlat, description: { ru: 'Западный район и посад', en: '', es: '' } }, 'garden'), false, '«сад» внутри слова — не сад');
});

test('клиент пишет «у моря» — видит только подходящие, а признак назван в заголовке фильтра', async () => {
  const chat = createChat();
  const step = await chat.say('Квартира у моря');
  const text = shown(step);
  assert.match(text, /Квартира на берегу/);
  assert.doesNotMatch(text, /Вилла в глубине|Обычная квартира/);
  const panel = await chat.press('cfilter:open');
  assert.match(panelOf(panel).text, /Квартира, у моря/, panelOf(panel).text);
});

test('«с бассейном» находит виллу; на английском и испанском то же', async () => {
  for (const [language, phrase, title] of [['ru', 'С бассейном', 'Вилла в глубине'], ['en', 'villa with pool', 'Вилла в глубине (EN)'], ['es', 'villa con piscina', 'Вилла в глубине (ES)']]) {
    const step = await createChat({ language }).say(phrase);
    const text = shown(step);
    assert.ok(text.includes(title), language + ': ' + text);
    assert.ok(!/Квартира на берегу|Обычная квартира/.test(text), language);
  }
});

test('нет подходящих — честное «ничего нет», а не чужие объекты', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('only', 'Обычная квартира', 'active', { propertyType: 'apartment', priceValue: 180000, currency: 'EUR', distanceSea: 3000, ...images, ...describeAs('Квартира в городе.', '', '') }));
  });
  const step = await createChat().say('Квартира с бассейном');
  const text = shown(step);
  assert.doesNotMatch(text, /Обычная квартира/);
});

test('«Ещё»: переключатели только тех признаков, что есть в каталоге; нажатие включает и выключает', async () => {
  const chat = createChat();
  await chat.say(MENU.ru.objects);
  const more = await chat.press('cfilter:more');
  const labels = panelOf(more).buttons;
  assert.ok(labels.some((label) => /У моря/.test(label)), labels.join(' | '));
  assert.ok(labels.some((label) => /Бассейн/.test(label)));
  assert.ok(labels.some((label) => /Сад/.test(label)));
  assert.ok(!labels.some((label) => /Терраса/.test(label)), 'в каталоге ни у кого нет террасы — кнопки нет');

  // Признак переключается на месте: экран «Ещё» остаётся, галочка меняется; условия — на главном экране фильтра.
  const on = await chat.press('cfilter:feat:pool');
  assert.ok(panelOf(on).buttons.some((label) => /^✓ 🏊 Бассейн/.test(label)), panelOf(on).buttons.join(' | '));
  const main = await chat.press('cfilter:open');
  assert.match(panelOf(main).text, /бассейн/);
  assert.match(panelOf(main).text, /Подходит: 1/, panelOf(main).text);
  assert.ok(panelOf(main).buttons.some((label) => label === '⋯ Ещё · 1'), 'на «Ещё» — число выбранного: ' + panelOf(main).buttons.join(' | '));
  await chat.press('cfilter:more');
  const off = await chat.press('cfilter:feat:pool');
  assert.ok(!panelOf(off).buttons.some((label) => /^✓ 🏊/.test(label)));
  const mainOff = await chat.press('cfilter:open');
  assert.doesNotMatch(panelOf(mainOff).text, /бассейн/);
  assert.match(panelOf(mainOff).text, /Подходит: 3/);
});

test('сохранённый поиск помнит признак; формат данных 52 читает и старый сохранённый поиск без признаков', async () => {
  const { DATA_VERSION, normalizeLoadedData } = await import('../src/data-format.mjs');
  assert.equal(DATA_VERSION, 53);
  const withFeatures = normalizeLoadedData({ users: { 1: { id: '1', chatId: 1, savedSearch: { filter: { deal: 'sale', features: ['pool', 'sea', 'nonsense'] }, enabled: true } } } });
  assert.deepEqual(withFeatures.users['1'].savedSearch.filter.features, ['sea', 'pool'], 'известные — в каноническом порядке, лишнее выброшено');
  const onlyFeature = normalizeLoadedData({ users: { 2: { id: '2', chatId: 2, savedSearch: { filter: { features: ['pool'] } } } } });
  assert.ok(onlyFeature.users['2'].savedSearch, 'поиск, где есть только признак, не пропадает');
  const old = normalizeLoadedData({ users: { 3: { id: '3', chatId: 3, savedSearch: { filter: { deal: 'rent', maxPrice: 900 } } } } });
  assert.equal('features' in old.users['3'].savedSearch.filter, false);

  const chat = createChat();
  await chat.say('Вилла с бассейном');
  const saved = await chat.press('saved:save');
  assert.ok(saved.text.includes('Бассейн') || saved.text.includes('бассейн') || chat.user.savedSearch.filter.features.includes('pool'));
  assert.deepEqual(chat.user.savedSearch.filter.features, ['pool']);
});
