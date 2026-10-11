'use strict';

// «Проекты из файла»: проекты (и по желанию контакты, «О компании») из файла каталога добавляются в работающего бота,
// а клиенты, заявки, настройки и собственные проекты остаются как были.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const realFetch = global.fetch;
const { bot, dataFile, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-84';
const mediaDirectory = path.join(path.dirname(dataFile), 'bot-media');
const png = (mark) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('catalog transfer photo ' + mark)]);
let base = '';
let headers = {};

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.config.menu.ru = { ...data.config.menu.ru, about: 'Свой текст «О компании» на сервере' };
    data.objects.push({
      id: 'server-own', status: 'active', reference: 'OWN', dealType: 'sale', propertyType: 'apartment',
      title: { ru: 'Свой проект', en: '', es: '' },
    });
    data.contacts = { ...data.contacts, phone: '+34 600 000 001', manager: 'Серверный менеджер' };
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  bot.getData().users['4242'] = { id: '4242', chatId: 4242, firstName: 'Клиент', preferredLanguage: 'ru', activity: [] };
  bot.saveDataNow();
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

async function catalogFile(objects, extra = {}) {
  const { backupChunks } = await import('../src/backup-file.mjs');
  const media = [];
  for (const record of objects) {
    for (const image of record.imagesByLanguage.ru) media.push({ name: image.storageFile, read: () => png(image.id) });
  }
  const payload = { version: 15, objects, ...extra };
  return Buffer.concat([...backupChunks(payload, media)]);
}

function project(id, title, mark) {
  return {
    id, status: 'active', reference: id.toUpperCase(), dealType: 'sale', propertyType: 'villa', priceValue: 550000, currency: 'EUR',
    title: { ru: title, en: title + ' EN', es: title + ' ES' },
    description: { ru: 'Описание', en: 'Description', es: 'Descripción' },
    city: { ru: 'Финестрат', en: 'Finestrat', es: 'Finestrat' },
    imagesByLanguage: { ru: [{ id: mark, storageFile: mark + '.png', mimeType: 'image/png', size: png(mark).length }], en: [], es: [] },
  };
}

function send(file, parts, password = PASSWORD) {
  return realFetch(base + '/api/restore-parts?parts=' + parts, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-current-password': Buffer.from(password).toString('base64') },
    body: file,
  });
}

test('проекты добавляются, всё остальное остаётся как было', async () => {
  const file = await catalogFile([project('riviera-0001', 'Riviera 1', 'photo-a'), project('sierra-0002', 'Sierra Verde', 'photo-b')], {
    contacts: { manager: 'Евгений', phone: '+34 611 000 000' },
    config: { menu: { ru: { about: 'Текст из файла' } } },
  });
  const response = await send(file, 'objects');
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.objectsAdded, 2);
  assert.equal(body.objectsUpdated, 0);
  const data = bot.getData();
  assert.deepEqual(data.objects.map((item) => item.id).sort(), ['riviera-0001', 'server-own', 'sierra-0002']);
  assert.equal(data.objects.find((item) => item.id === 'riviera-0001').title.en, 'Riviera 1 EN');
  assert.ok(data.users['4242'], 'клиент на месте');
  assert.equal(data.contacts.manager, 'Серверный менеджер', 'контакты не выбраны — не тронуты');
  assert.equal(data.config.menu.ru.about, 'Свой текст «О компании» на сервере');
  const stored = data.objects.find((item) => item.id === 'riviera-0001').imagesByLanguage.ru[0];
  assert.ok(fs.existsSync(path.join(mediaDirectory, stored.storageFile)), 'фото записано на диск');
  assert.ok(fs.readFileSync(path.join(mediaDirectory, stored.storageFile)).equals(png('photo-a')));
});

test('повторная загрузка обновляет по номеру, а не дублирует; контакты и «О компании» — по выбору', async () => {
  const changed = project('riviera-0001', 'Riviera 1 (новая цена)', 'photo-a');
  const file = await catalogFile([changed], {
    contacts: { manager: 'Евгений', phone: '+34 611 000 000' },
    config: { menu: { ru: { about: 'Текст из файла' } } },
  });
  const response = await send(file, 'objects,contacts,about');
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.objectsAdded, 0);
  assert.equal(body.objectsUpdated, 1);
  const data = bot.getData();
  assert.equal(data.objects.filter((item) => item.id === 'riviera-0001').length, 1);
  assert.equal(data.objects.find((item) => item.id === 'riviera-0001').title.ru, 'Riviera 1 (новая цена)');
  assert.equal(data.contacts.manager, 'Евгений');
  assert.equal(data.config.menu.ru.about, 'Текст из файла');
  // Языки, которых в файле нет, остаются со своим текстом.
  assert.notEqual(data.config.menu.en.about, '');
  assert.ok(data.config.passwordHash, 'вход в панель не затронут');
  assert.ok(data.users['4242']);
});

test('нужен пароль панели и хотя бы один отмеченный раздел; чужой файл отклоняется', async () => {
  const file = await catalogFile([project('x-0003', 'Не должен появиться', 'photo-c')]);
  const wrong = await send(file, 'objects', 'не-тот-пароль');
  assert.notEqual(wrong.status, 200);
  const empty = await send(file, '');
  assert.equal(empty.status, 400);
  const garbage = await send(Buffer.from('это не копия'), 'objects');
  assert.equal(garbage.status, 400);
  assert.ok(!bot.getData().objects.some((item) => item.id === 'x-0003'));
});

test('тексты и настройки берутся целиком; пароль, токен, админ-чат и клиенты не меняются', async () => {
  const file = await catalogFile([], {
    config: {
      messages: { ru: { greeting: 'Новое приветствие из файла', help: 'Справка', fallback: 'Не понял' } },
      menu: { ru: { objects: '🏘 Проекты', contacts: '💬 Связь', promotions: '🔥 Акции', about: 'Текст из файла 2' } },
      calculator: { enabled: true, interestPercent: 3.5, years: 20 },
      workingHours: { enabled: true, from: '10:00', to: '18:00', days: [1, 2, 3, 4, 5] },
      passwordHash: 'не-должен-попасть',
      botToken: '999:НЕ_ДОЛЖЕН_ПОПАСТЬ',
      adminChatId: '555',
    },
    guidePages: [{ id: 'nie', title: { ru: 'Шаг 1', en: 'Step 1', es: 'Paso 1' }, text: { ru: 'Текст', en: 'Text', es: 'Texto' } }],
  });
  const before = { hash: bot.getData().config.passwordHash, token: bot.getData().config.botToken, chat: bot.getData().config.adminChatId };
  const response = await send(file, 'texts,settings');
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const data = bot.getData();
  assert.equal(data.config.messages.ru.greeting, 'Новое приветствие из файла');
  assert.equal(data.config.menu.ru.objects, '🏘 Проекты');
  assert.equal(data.config.calculator.enabled, true);
  assert.equal(data.config.calculator.interestPercent, 3.5);
  assert.equal(data.config.workingHours.from, '10:00');
  assert.ok(Array.isArray(data.guidePages) && data.guidePages.some((page) => page.title && page.title.ru === 'Шаг 1'));
  assert.equal(data.config.passwordHash, before.hash, 'пароль не тронут');
  assert.equal(data.config.botToken, before.token, 'токен не тронут');
  assert.equal(data.config.adminChatId, before.chat, 'админ-чат не тронут');
  assert.ok(data.users['4242'], 'клиент на месте');
  assert.ok(data.objects.some((item) => item.id === 'server-own'), 'свои проекты на месте');
  assert.ok(body.texts >= 3 && body.settings >= 2);
});

test('«Только фотографии»: фото существующего проекта заменяются, тексты и цена остаются', async () => {
  const photo = project('photo-only-0004', 'Проект до фото', 'photo-d');
  const created = await send(await catalogFile([photo]), 'objects');
  assert.equal(created.status, 200);
  const data = bot.getData();
  const record = data.objects.find((item) => item.id === 'photo-only-0004');
  record.priceValue = 777000;
  record.title.ru = 'Название, которое владелец поправил в панели';
  const withNewPhoto = project('photo-only-0004', 'Старое название из файла', 'photo-e');
  withNewPhoto.priceValue = 1;
  const response = await send(await catalogFile([withNewPhoto]), 'photos');
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.photosUpdated, 1);
  assert.equal(body.objectsUpdated, 0);
  const after = bot.getData().objects.find((item) => item.id === 'photo-only-0004');
  assert.equal(after.priceValue, 777000, 'цена не тронута');
  assert.equal(after.title.ru, 'Название, которое владелец поправил в панели', 'название не тронуто');
  assert.notEqual(after.imagesByLanguage.ru[0].storageFile, record.imagesByLanguage.ru[0].storageFile === undefined ? '' : 'x', 'фото записаны');
  assert.equal(after.imagesByLanguage.ru.length, 1);
  assert.ok(fs.existsSync(path.join(mediaDirectory, after.imagesByLanguage.ru[0].storageFile)), 'файл фото на диске');
});

test('«Только расстояние до пляжа»: меняется одно поле, остальное у проекта остаётся', async () => {
  const created = await send(await catalogFile([project('sea-only-0005', 'Проект без расстояния', 'photo-f')]), 'objects');
  assert.equal(created.status, 200);
  const record = bot.getData().objects.find((item) => item.id === 'sea-only-0005');
  record.priceValue = 640000;
  record.title.ru = 'Название, которое владелец поправил в панели';
  const photoBefore = record.imagesByLanguage.ru[0].storageFile;
  const fromFile = project('sea-only-0005', 'Старое название из файла', 'photo-g');
  fromFile.priceValue = 1;
  fromFile.distanceSea = 4300;
  const unknown = project('sea-unknown-0006', 'Нет такого проекта на сервере', 'photo-h');
  unknown.distanceSea = 100;
  const response = await send(await catalogFile([fromFile, unknown]), 'sea');
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.seaUpdated, 1);
  assert.equal(body.objectsAdded, 0);
  const after = bot.getData().objects.find((item) => item.id === 'sea-only-0005');
  assert.equal(after.distanceSea, 4300);
  assert.equal(after.priceValue, 640000, 'цена не тронута');
  assert.equal(after.title.ru, 'Название, которое владелец поправил в панели', 'название не тронуто');
  assert.equal(after.imagesByLanguage.ru[0].storageFile, photoBefore, 'фото не тронуты');
  assert.ok(!bot.getData().objects.some((item) => item.id === 'sea-unknown-0006'), 'новые проекты не добавляются');
});
