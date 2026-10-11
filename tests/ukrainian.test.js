'use strict';

// Украинский язык: каждая русская строка таблиц текстов имеет перевод, таблицы устроены так же, как русские, словарь не
// портит подстановки, меню и приложение переведены, а русский текст объекта показывается, пока украинского нет.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  bot, createChat, property, resetData, cleanup,
} = require('./helpers/chat');

test.after(cleanup);

test('у каждой русской строки в таблицах текстов есть украинский перевод', async () => {
  const { ukrainianStringsMissing } = await import('../src/languages.mjs');
  const missing = ukrainianStringsMissing();
  assert.deepEqual(missing, [], 'нет перевода для ' + missing.length + ' строк, например: ' + missing.slice(0, 3).join(' | '));
});

test('украинские таблицы устроены как русские: те же ключи и вложенность', async () => {
  const texts = await import('../src/texts.mjs');
  const problems = [];
  function shape(value) {
    if (Array.isArray(value)) return value.map(shape);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
    return typeof value;
  }
  for (const [name, table] of Object.entries(texts)) {
    if (!table || typeof table !== 'object' || !('ru' in table) || !('en' in table)) continue;
    if (!('uk' in table)) { problems.push(name + ': нет uk'); continue; }
    assert.deepEqual(shape(table.uk), shape(table.ru), name + ': uk устроен иначе, чем ru');
  }
  assert.deepEqual(problems, []);
});

test('словарь: подстановки и переводы строк сохранены, русских букв и прямого апострофа нет', () => {
  const dictionary = require('../src/uk-dictionary.json');
  const placeholders = (text) => (String(text).match(/\{[^{}]*\}/g) || []).sort();
  const alias = { '{имя}': '{name}', '{объект}': '{property}' };
  const problems = [];
  for (const [ru, uk] of Object.entries(dictionary)) {
    const expected = placeholders(ru).map((item) => alias[item] || item).sort();
    const got = placeholders(uk).map((item) => alias[item] || item).sort();
    // «{имя}, добрый день!» у клиента без обращения по имени: подстановки может не быть вовсе.
    const nameDropped = expected.length > got.length && got.every((item) => expected.includes(item));
    if (!nameDropped && JSON.stringify(expected) !== JSON.stringify(got)) problems.push('подстановки: ' + ru.slice(0, 60));
    if (ru.split('\n').length !== uk.split('\n').length) problems.push('переводы строк: ' + ru.slice(0, 60));
    const withoutPlaceholders = uk.replace(/\{[^{}]*\}/g, '');
    if (/[ыэъЫЭЪ]/.test(withoutPlaceholders)) problems.push('русская буква: ' + uk.slice(0, 60));
    if (/\p{L}'\p{L}/u.test(uk)) problems.push('прямой апостроф: ' + uk.slice(0, 60));
  }
  assert.deepEqual(problems, []);
});

test('меню, приветствие и команды на украинском', async () => {
  resetData();
  const chat = createChat({ language: 'uk', firstName: 'Олена' });
  const result = await chat.say('/menu');
  assert.ok(result.replies.length >= 1);
  const texts = require('node:util').inspect(result.replies, { depth: 6 });
  assert.ok(!/Объекты|Подбор|Связаться|Избранное/.test(texts), 'в меню нет русских подписей');
  assert.match(texts, /Об’єкти/);
  const { BOT_COMMAND_DESCRIPTIONS } = await import('../src/texts.mjs');
  assert.ok(BOT_COMMAND_DESCRIPTIONS.uk.start && !/[ыэъ]/.test(JSON.stringify(BOT_COMMAND_DESCRIPTIONS.uk)));
});

test('объект без украинского текста показывается русским, с украинским — украинским', async () => {
  resetData((data) => {
    data.objects = [
      property('villa-uk-0001', 'Вилла у моря', 'active', { priceValue: 450000, currency: 'EUR' }),
      property('villa-uk-0002', 'Вилла с садом', 'active', { priceValue: 300000, currency: 'EUR', title: { ru: 'Вилла с садом', uk: 'Вілла з садом', en: 'Villa with garden', es: 'Villa con jardín' } }),
    ];
  });
  const { propertyReadyForLanguage, localizedExact } = await import('../src/catalog.mjs');
  const records = bot.getData().objects;
  assert.ok(records.every((record) => propertyReadyForLanguage(record, 'uk')), 'оба объекта видны украинскому клиенту');
  assert.equal(localizedExact(records[0].title, 'uk'), 'Вилла у моря');
  assert.equal(localizedExact(records[1].title, 'uk'), 'Вілла з садом');
  assert.equal(localizedExact(records[1].title, 'ru'), 'Вилла с садом');
});

test('приложение: словарь украинского полон, язык переключается, подтверждение записи на украинском', async () => {
  const { APP_JS } = await import('../src/miniapp/assets.mjs');
  const start = APP_JS.indexOf('  var T = {');
  const marker = "typeGeneral: 'Solicitud' });";
  const end = APP_JS.indexOf('\n', APP_JS.indexOf(marker)) + 1;
  const code = APP_JS.slice(start, end).replace(/^\s*var T = /, 'T = ');
  const sandbox = { T: null };
  vm.createContext(sandbox);
  vm.runInContext(code + "\nObject.assign(T, {});", sandbox);
  // Блок украинского дописывается следом за испанским.
  const ukBlock = APP_JS.slice(end, APP_JS.indexOf('\n', end + 1));
  vm.runInContext(ukBlock.replace(/^\s*Object\.assign\(T, /, 'Object.assign(T, '), sandbox);
  const T = sandbox.T;
  assert.ok(T.uk, 'таблица украинского есть');
  const absent = Object.keys(T.ru).filter((key) => !(key in T.uk));
  assert.deepEqual(absent, [], 'нет перевода ключей приложения');
  assert.ok(Object.values(T.uk).every((value) => !/[ыэъ]/i.test(value)), 'русских букв в интерфейсе нет');
  assert.match(APP_JS, /\['ru', 'uk', 'en', 'es'\]/, 'переключатель языка знает украинский');
});

test('имя менеджера для украинского клиента — в украинской форме', async () => {
  const { managerNameFor } = await import('../src/util.mjs');
  assert.equal(managerNameFor({ managerName: 'Евгений' }, 'uk'), 'Євген');
  assert.equal(managerNameFor({ managerName: 'Елена Петрова' }, 'uk'), 'Олена Петрова');
  assert.equal(managerNameFor({ managerName: 'Евгений' }, 'ru'), 'Евгений');
  assert.equal(managerNameFor({ managerName: 'Евгений' }, 'en'), 'Evgeniy');
});
