'use strict';

// Предпросмотр карточки в редакторе объекта («Как увидит клиент») собирается сервером тем же кодом, что и карточка в
// боте. Раньше панель держала вторую копию правил и показывала «🟢 Доступен» и характеристики по строке, когда бот
// уже писал иначе. Тест сверяет предпросмотр с настоящей карточкой из чата символ в символ.

const realFetch = global.fetch; // до helpers: они подменяют fetch на заглушку Telegram
const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-a', 'Вилла у моря', 'active', {
      propertyType: 'villa', priceValue: 650000, currency: 'EUR', area: 180, plotArea: 500, bedrooms: 4, bathrooms: 3,
      badges: ['new'], distanceSea: 150, floor: '', floors: '', district: { ru: 'Золотая Миля', en: 'Golden Mile', es: 'Milla de Oro' },
      imagesByLanguage: { ru: [{ id: 'a-ru', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }], en: [{ id: 'a-en', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }], es: [{ id: 'a-es', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }] },
    }));
    const password = bot.hashPassword('preview-card-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'preview-card-password' }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});

// Поля так, как их шлёт редактор (recordFields в панели).
function fieldsOf(record, language) {
  const keys = ['title', 'url', 'propertyType', 'dealType', 'status', 'priceValue', 'currency', 'pricePeriod', 'bedrooms', 'bathrooms', 'area', 'plotArea', 'floor', 'floors', 'distanceSea', 'condition', 'reference', 'mapUrl', 'videoUrl', 'city', 'district', 'address', 'price', 'description', 'badges'];
  return { language, ...Object.fromEntries(keys.map((key) => [key, record[key]])) };
}

for (const language of ['ru', 'en', 'es']) {
  test(language + ': предпросмотр = подпись и кнопки настоящей карточки в боте', async () => {
    const record = bot.getData().objects[0];
    const chat = createChat({ language });
    const step = await chat.say(MENU[language].objects);
    const card = step.calls.find((call) => call.method === 'sendPhoto').body;
    const answer = await (await realFetch(base + '/api/preview/object', { method: 'POST', headers, body: JSON.stringify(fieldsOf(record, language)) })).json();
    assert.equal(answer.caption, card.caption, 'подпись совпадает символ в символ');
    const botRows = card.reply_markup.inline_keyboard.slice(0, 3).map((row) => row.map((button) => button.text));
    assert.deepEqual(answer.rows.slice(0, 3), botRows, 'первые три ряда кнопок совпадают');
    assert.ok(!/Доступен|Available|Disponible/.test(answer.caption), 'старой строки «Доступен» нет');
  });
}

test('название ещё пусто — карточка без него, не ошибка; чужой метод и без входа — отказ', async () => {
  const record = bot.getData().objects[0];
  const fields = { ...fieldsOf(record, 'ru'), title: { ru: '', en: '', es: '' } };
  const answer = await realFetch(base + '/api/preview/object', { method: 'POST', headers, body: JSON.stringify(fields) });
  assert.equal(answer.status, 200);
  assert.ok(!(await answer.json()).caption.includes('Вилла у моря'));
  assert.equal((await realFetch(base + '/api/preview/object', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.notEqual((await realFetch(base + '/api/preview/object', { headers })).status, 200);
});

test('рассылка карточкой: предпросмотр = вступление + карточка ровно как уйдёт клиенту (подпись и кнопки)', async () => {
  const record = bot.getData().objects[0];
  const answer = await (await realFetch(base + '/api/preview/broadcast', { method: 'POST', headers, body: JSON.stringify({ propertyId: record.id, language: 'ru', message: 'Новинка недели!' }) })).json();
  assert.ok(answer.caption.startsWith('Новинка недели!\n\n<b>Вилла у моря</b>'), 'вступление, затем карточка: ' + answer.caption.slice(0, 60));
  assert.deepEqual(answer.rows.slice(0, 2), [['📅 Записаться на просмотр'], ['📋 Подробнее']]);
  assert.match(answer.rows[2][0], /Отписаться/);
  assert.equal((await realFetch(base + '/api/preview/broadcast', { method: 'POST', headers, body: JSON.stringify({ propertyId: 'нет' }) })).status, 404);
});
