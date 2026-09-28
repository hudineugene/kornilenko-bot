'use strict';

// Карточку каталога должно быть можно поправить в любой момент. Объекты из
// выгрузки приходят со статусом «Активен», но без номера, площади и переводов:
// раньше панель и сервер отказывались сохранять такую карточку целиком, и
// владелец не мог даже переименовать город — кнопка «Сохранить» ничего не
// делала, а при закрытии карточки предлагалось «закрыть без сохранения».

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, property, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-77';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('card save test')]).toString('base64');
let base = '';
let headers = {};

// Так выглядит объект после загрузки выгрузки с сайта: показывается клиентам,
// но заполнен только по-русски и без номера объекта.
function imported() {
  return {
    id: 'from-feed',
    status: 'active',
    reference: '',
    dealType: 'sale',
    propertyType: 'apartment',
    title: { ru: 'Apartments', en: '', es: '' },
    description: { ru: 'Описание из выгрузки.', en: '', es: '' },
    city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
    area: null,
    bedrooms: null,
    bathrooms: null,
    imagesByLanguage: { ru: [{ id: 'feed-ru', mimeType: 'image/png', dataBase64: PNG }], en: [], es: [] },
  };
}

// Что отправляет карточка панели при нажатии «Сохранить».
function cardPayload(record, patch = {}) {
  return {
    title: record.title,
    url: '',
    imageDataUrlsByLanguage: { ru: [], en: [], es: [] },
    removeImageIdsByLanguage: { ru: [], en: [], es: [] },
    propertyType: record.propertyType,
    dealType: record.dealType,
    status: record.status,
    priceValue: record.priceValue || '',
    currency: 'EUR',
    pricePeriod: 'total',
    bedrooms: record.bedrooms == null ? '' : record.bedrooms,
    bathrooms: record.bathrooms == null ? '' : record.bathrooms,
    area: record.area == null ? '' : record.area,
    plotArea: '',
    floor: '',
    floors: '',
    distanceSea: '',
    condition: '',
    reference: record.reference || '',
    mapUrl: '',
    city: record.city,
    district: { ru: '', en: '', es: '' },
    address: { ru: '', en: '', es: '' },
    price: { ru: '', en: '', es: '' },
    description: record.description,
    badges: [],
    ...patch,
  };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.objects = [imported(), property('ready', 'Вилла', 'active', { imagesByLanguage: {
      ru: [{ id: 'r-ru', mimeType: 'image/png', dataBase64: PNG }],
      en: [{ id: 'r-en', mimeType: 'image/png', dataBase64: PNG }],
      es: [{ id: 'r-es', mimeType: 'image/png', dataBase64: PNG }],
    } })];
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': (await login.json()).csrf,
  };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const patch = (id, body) => realFetch(base + '/api/objects/' + id, { method: 'PATCH', headers, body: JSON.stringify(body) });
const objectById = (id) => bot.getData().objects.find((item) => item.id === id);

test('город в недозаполненной карточке сохраняется', async () => {
  const record = objectById('from-feed');
  const response = await patch('from-feed', cardPayload(record, { city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' } }));
  assert.equal(response.status, 200, await response.text());
  assert.equal(objectById('from-feed').city.ru, 'Альтеа');
  assert.equal(objectById('from-feed').status, 'active', 'статус менять за владельца не нужно');
});

test('клиенту недозаполненный объект всё равно не показывается', () => {
  const record = objectById('from-feed');
  assert.equal(bot.propertyReadyForLanguage(record, 'ru'), false, 'без номера и площади карточка не готова');
  const shown = bot.catalogRecords('ru').map((item) => item.id);
  assert.deepEqual(shown, ['ready'], 'в каталоге остаётся только готовая карточка');
});

test('фотографии загружаются один раз на все языки', async () => {
  const record = objectById('from-feed');
  // У объекта фотографии только в русском наборе.
  assert.equal(record.imagesByLanguage.en.length, 0);
  assert.equal(record.imagesByLanguage.es.length, 0);
  assert.equal(bot.recordImages(record, 'en').length, 1, 'английская карточка берёт общие фотографии');
  assert.equal(bot.recordImages(record, 'es')[0].id, 'feed-ru', 'и это тот же файл, второй раз его не грузили');

  // Свой набор для языка остаётся возможным и важнее общего.
  const own = objectById('ready');
  assert.equal(bot.recordImages(own, 'en')[0].id, 'r-en', 'если набор для языка есть — показываем его');

  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /Эти фотографии видят клиенты на всех языках/, 'в панели сказано, что набор общий');
  assert.match(PANEL_HTML, /Свои фотографии для языка/, 'отдельный набор — по желанию');
  assert.ok(!/Для каждого языка загружается свой набор/.test(PANEL_HTML), 'прежняя подсказка убрана');
});

test('панель говорит, чего не хватает, а не отказывает', async () => {
  const response = await realFetch(base + '/api/state', { headers });
  const state = await response.json();
  const record = state.objects.find((item) => item.id === 'from-feed');
  // Фотографии общие: русского набора хватает и английской карточке.
  assert.deepEqual(record.publicationIssues.en, ['название', 'описание', 'номер объекта', 'площадь', 'спальни', 'санузлы']);
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.doesNotMatch(PANEL_HTML, /Заполните обязательные поля или сохраните объект как скрытый/, 'кнопка «Сохранить» больше не отказывает');
  assert.match(PANEL_HTML, /Клиенты пока не видят карточку на /, 'вместо отказа — понятное предупреждение');
});

test('заполненная карточка сохраняется и остаётся в каталоге', async () => {
  const record = objectById('ready');
  const response = await patch('ready', cardPayload(record, { city: { ru: 'Кальпе', en: 'Calpe', es: 'Calpe' } }));
  assert.equal(response.status, 200, await response.text());
  assert.equal(objectById('ready').city.es, 'Calpe');
  assert.deepEqual(bot.catalogRecords('es').map((item) => item.id), ['ready']);
});
