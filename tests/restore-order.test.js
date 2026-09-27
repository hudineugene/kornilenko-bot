'use strict';

// Восстановление копии — самое опасное действие в панели: оно заменяет все
// данные бота. Проверяем, что прежние данные перед заменой складываются рядом
// файлом, что фотографии сначала возвращаются из папки backups/media и только
// потом отбрасываются те, которых нет нигде, и что негодный файл отклоняется
// до того, как что-то изменилось.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const realFetch = global.fetch;
const { bot, resetData, cleanup, dataFile } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-31';
const workDirectory = path.dirname(dataFile);
const mediaDirectory = path.join(workDirectory, 'bot-media');
const backupDirectory = path.join(workDirectory, 'backups');
const mediaBackupDirectory = path.join(backupDirectory, 'media');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('restore order test')]);

let base = '';
let headers = {};

function object(id, title, storageFile) {
  return {
    id,
    status: 'hidden',
    reference: id.toUpperCase(),
    dealType: 'sale',
    propertyType: 'apartment',
    title: { ru: title, en: title, es: title },
    description: { ru: 'Описание.', en: 'Description.', es: 'Descripción.' },
    city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
    area: 80,
    bedrooms: 2,
    bathrooms: 1,
    imagesByLanguage: {
      ru: storageFile ? [{ id: id + '-photo', mimeType: 'image/png', storageFile }] : [],
      en: [],
      es: [],
    },
  };
}

// Копия — это те же данные бота: берём текущие и меняем то, что нужно проверке.
function backupOf(objects) {
  const copy = JSON.parse(JSON.stringify(bot.getData()));
  copy.config.active = false;
  copy.objects = objects;
  return copy;
}

function snapshots() {
  return fs.existsSync(backupDirectory)
    ? fs.readdirSync(backupDirectory).filter((name) => name.startsWith('pre-restore-'))
    : [];
}

async function restore(backup) {
  const response = await realFetch(base + '/api/restore', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: headers.cookie,
      'x-csrf-token': headers['x-csrf-token'],
      'x-current-password': Buffer.from(PASSWORD).toString('base64'),
    },
    body: JSON.stringify(backup),
  });
  const body = await response.json();
  // Восстановление закрывает прежние сессии и выдаёт новую.
  const cookie = response.headers.get('set-cookie');
  if (cookie) headers.cookie = cookie.split(';')[0];
  if (body.csrf) headers['x-csrf-token'] = body.csrf;
  return { status: response.status, body };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.objects = [object('before', 'До восстановления', '')];
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  bot.saveDataNow();
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = {
    cookie: login.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': (await login.json()).csrf,
  };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

test('прежние данные складываются рядом файлом перед заменой', async () => {
  const before = snapshots().length;
  const result = await restore(backupOf([object('from-copy', 'Из копии', '')]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.body.snapshot || '', /^pre-restore-.+\.json$/, 'в ответе есть имя файла со снимком');
  assert.equal(snapshots().length, before + 1, 'файл появился в папке backups');
  const saved = JSON.parse(fs.readFileSync(path.join(backupDirectory, result.body.snapshot), 'utf8'));
  assert.deepEqual(saved.objects.map((item) => item.id), ['before'], 'в снимке — данные, которые были до восстановления');
  assert.deepEqual(bot.getData().objects.map((item) => item.id), ['from-copy'], 'данные заменены');
});

test('фотографии возвращаются из копии медиа, а не выбрасываются', async () => {
  fs.mkdirSync(mediaBackupDirectory, { recursive: true });
  fs.writeFileSync(path.join(mediaBackupDirectory, 'photo-kept.png'), PNG);
  fs.rmSync(path.join(mediaDirectory, 'photo-kept.png'), { force: true });
  const result = await restore(backupOf([object('with-photo', 'С фотографией', 'photo-kept.png')]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.restoredPhotos, 1, 'фотография вернулась из backups/media');
  assert.equal(result.body.missingPhotos, 0, 'и не была отброшена');
  const record = bot.getData().objects.find((item) => item.id === 'with-photo');
  assert.equal(record.imagesByLanguage.ru.length, 1, 'ссылка на фотографию осталась в карточке');
  const storedName = record.imagesByLanguage.ru[0].storageFile;
  assert.ok(storedName && fs.existsSync(path.join(mediaDirectory, storedName)), 'файл лежит в bot-media: ' + storedName + ' | ' + fs.readdirSync(mediaDirectory).join(', '));
});

test('фотографии, которых нет нигде, отбрасываются и попадают в отчёт', async () => {
  const result = await restore(backupOf([object('no-photo', 'Без фотографии', 'photo-lost.png')]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.missingPhotos, 1);
  assert.equal(result.body.restoredPhotos, 0);
  const record = bot.getData().objects.find((item) => item.id === 'no-photo');
  assert.deepEqual(record.imagesByLanguage.ru, [], 'карточка сохранилась без фотографии');
  assert.equal(record.title.ru, 'Без фотографии', 'остальные данные восстановились');
});

test('негодный файл отклоняется до того, как что-то изменилось', async () => {
  const before = snapshots().length;
  const wrong = backupOf([object('ignored', 'Не должен появиться', '')]);
  delete wrong.config;
  const result = await restore(wrong);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /настройки/i);
  assert.equal(snapshots().length, before, 'лишнего снимка не появилось');
  assert.deepEqual(bot.getData().objects.map((item) => item.id), ['no-photo'], 'данные не тронуты');
});

test('снимков хранится не больше десяти', async () => {
  const { snapshotBeforeRestore } = await import('../src/store.mjs');
  for (let index = 0; index < 14; index += 1) snapshotBeforeRestore(new Date(2026, 0, 1, 12, index, index));
  assert.ok(snapshots().length <= 10, 'старые снимки убираются, осталось ' + snapshots().length);
});
