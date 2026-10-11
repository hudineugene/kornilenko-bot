'use strict';

// Украинские слова в сообщении клиента понимаются теми же разборщиками, что и русские: свободный поиск (сделка, тип, спальни,
// признаки, цена словами), тема обращения для менеджера, подсказки к частым вопросам и смена языка словом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, property, resetData, cleanup } = require('./helpers/chat');

let naturalCatalogFilter;
let topicsOf;
let intentOf;

test.before(async () => {
  ({ naturalCatalogFilter } = await import('../src/search.mjs'));
  ({ topicsOf } = await import('../src/topics.mjs'));
  ({ intentOf } = await import('../src/faq-hints.mjs'));
});
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('flat-benidorm', 'Квартира в Бенидорме', 'active', {
    propertyType: 'apartment', dealType: 'sale', bedrooms: 2, priceValue: 250000, currency: 'EUR',
    city: { ru: 'Бенидорм', uk: 'Бенідорм', en: 'Benidorm', es: 'Benidorm' },
  }));
  data.objects.push(property('villa-marbella', 'Вилла в Марбелье', 'active', {
    propertyType: 'villa', dealType: 'sale', bedrooms: 4, priceValue: 590000, currency: 'EUR',
    city: { ru: 'Марбелья', uk: 'Марбелья', en: 'Marbella', es: 'Marbella' },
  }));
}));
test.after(cleanup);

const filterOf = (message, language = 'uk') => naturalCatalogFilter(message, bot.getData().objects, language);

test('«Хочу купити віллу з басейном біля моря до 600 тисяч євро» разбирается как русский аналог', () => {
  const ukrainian = filterOf('Хочу купити віллу з басейном біля моря до 600 тисяч євро');
  const russian = filterOf('Хочу купить виллу с бассейном у моря до 600 тысяч евро', 'ru');
  assert.ok(ukrainian, 'фильтр построен');
  assert.deepEqual(ukrainian, russian);
  assert.equal(ukrainian.deal, 'sale');
  assert.equal(ukrainian.type, 'villa');
  assert.equal(ukrainian.maxPrice, 600000);
  assert.deepEqual(ukrainian.features, ['sea', 'pool']);
});

test('аренда, тип и спальни: «Орендувати квартиру, 2 спальні»', () => {
  const ukrainian = filterOf('Орендувати квартиру, 2 спальні');
  assert.deepEqual(ukrainian, filterOf('Снять квартиру, 2 спальни', 'ru'));
  assert.equal(ukrainian.deal, 'rent');
  assert.equal(ukrainian.type, 'apartment');
  assert.equal(ukrainian.bedrooms, 2);
  assert.equal(bot.parseBedrooms('квартира в оренду, 2 спальні'), 2);
});

test('числа словами перед «спальні» и «від … до …» с «тис.» и «млн»', () => {
  assert.equal(bot.parseBedrooms('дві спальні'), 2);
  assert.equal(bot.parseBedrooms('три спальні'), 3);
  assert.equal(bot.parseBedrooms('п’ять спалень'), 4, 'больше четырёх — «4+», как и по-русски');
  assert.deepEqual(bot.parsePriceRange('квартира від 300 до 500 тис. євро'), { minPrice: 300000, maxPrice: 500000 });
  assert.equal(bot.parseMaxPrice('не дорожче 1,2 млн євро'), 1200000);
  assert.equal(bot.parseMinPrice('не дешевше 200 тисяч'), 200000);
  assert.equal(bot.parseMaxPrice('бюджет до 450 000 €'), 450000);
  assert.equal(bot.parseMaxPrice('біля моря до 150 м, ціна договірна'), 0, 'метры до моря — не цена');
});

test('«у Бенідормі»: украинский предлог и падеж названия города', () => {
  const filter = filterOf('Квартира у Бенідормі до 300 тисяч');
  assert.ok(filter);
  assert.equal(filter.city, 'Бенідорм');
  assert.equal(filter.type, 'apartment');
  assert.equal(filter.maxPrice, 300000);
  // Незнакомое место по-украински («у Валенсії») — не фильтр, а вопрос менеджеру, как «в Валенсии» по-русски.
  assert.equal(filterOf('Квартира у Валенсії, 2 спальні до 300 тисяч'), null);
  assert.equal(filterOf('Квартира в Валенсии, 2 спальни до 300 тысяч', 'ru'), null);
});

test('вопросы «чи є…» и «скільки коштує…» остаются вопросом менеджеру, как «есть ли» и «сколько»', () => {
  assert.equal(filterOf('Чи є вілла з басейном до 600 тисяч євро?'), null);
  assert.equal(filterOf('Скільки коштує вілла з басейном біля моря'), null);
  assert.equal(filterOf('Квартира в Бенідормі чи Марбельї до 300 тисяч'), null, 'два варианта места');
});

test('тема обращения по украинским словам; метки остаются русскими', () => {
  assert.deepEqual(topicsOf('Скільки коштує розстрочка'), ['цена', 'рассрочка и оплата']);
  assert.deepEqual(topicsOf('Яка ціна та який перший внесок? Чи можна іпотеку і які податки?'), ['цена', 'рассрочка и оплата', 'ипотека']);
  assert.deepEqual(topicsOf('Хочу подивитися, коли можна приїхати на огляд, і потрібні документи та договір'), ['просмотр', 'документы']);
  assert.deepEqual(topicsOf('Надішліть планування і відео. Коли здача?'), ['планировка и фото', 'сроки сдачи']);
  assert.deepEqual(topicsOf('Який дохід від оренди і чи є посвідка на проживання?'), ['аренда и доход', 'ВНЖ и виза']);
  assert.deepEqual(topicsOf('Хто ви такі, ви забудовник? Дайте телефон'), ['о компании', 'контакты']);
});

test('подсказки к частым вопросам: контакты, налоги, «кто вы», планировка, цена', () => {
  assert.equal(intentOf('Де ваш офіс?'), 'contacts');
  assert.equal(intentOf('Які податки при купівлі?'), 'costs');
  assert.equal(intentOf('Хто ви такі?'), 'about');
  assert.equal(intentOf('Як купити нерухомість?'), 'howto');
  assert.equal(intentOf('Надішліть планування'), 'photos');
  assert.equal(intentOf('Скільки коштує двокімнатна квартира?'), 'price');
  assert.equal(intentOf('Скільки коштує утримання квартири?'), '', 'это не про цену объекта');
});

test('язык словом: «українською», «Ukrainian», «ua»; «uk» внутри фразы язык не меняет', () => {
  assert.equal(bot.languageFromText('Українська'), 'uk');
  assert.equal(bot.languageFromText('українською'), 'uk');
  assert.equal(bot.languageFromText('украинский'), 'uk');
  assert.equal(bot.languageFromText('Ukrainian'), 'uk');
  assert.equal(bot.languageFromText('ucraniano'), 'uk');
  assert.equal(bot.languageFromText('ua'), 'uk');
  assert.equal(bot.languageFromText('UK'), 'uk');
  assert.equal(bot.languageFromText('from the uk'), '');
  assert.equal(bot.languageFromText('є українська'), 'uk');
  assert.equal(bot.languageFromText('є українська', { exact: true }), '', 'у клиента с выбранным языком только точное название');
  assert.equal(bot.languageFromText('Русский'), 'ru');
  assert.equal(bot.languageFromText('English'), 'en');
  assert.equal(bot.languageFromText('Español'), 'es');
});
