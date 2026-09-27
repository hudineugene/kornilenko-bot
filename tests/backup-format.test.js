'use strict';

// Копия данных из панели раньше везла фотографии внутри JSON в base64: 52 МБ
// снимков превращались в 70 МБ текста, а чтобы собрать файл, бот держал в
// памяти и снимки, и строку JSON, и её байты. Теперь копия — контейнер:
// сжатые данные и следом фотографии как есть, по одной.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const realFetch = global.fetch;
const { bot, dataFile, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-84';
const mediaDirectory = path.join(path.dirname(dataFile), 'bot-media');
// Настоящий PNG: маленький, но с верной сигнатурой — проверки копии его примут.
const png = (mark) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('photo bytes for backup test ' + mark)]);
const PNG = png('one');
const PNG_TWO = png('two');
let base = '';
let headers = {};
// Бот переименовывает файлы по содержимому при сохранении, поэтому настоящие
// имена узнаём уже из данных.
let firstFile = '';
let secondFile = '';

function storedPhoto(name, bytes) {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  fs.writeFileSync(path.join(mediaDirectory, name), bytes);
  return { id: name.replace(/\W/g, ''), storageFile: name, mimeType: 'image/png', size: bytes.length };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    data.config.telegramBackup = { enabled: true, key: 'секретный-ключ-копии', salt: 'соль' };
    data.objects.push({
      id: 'with-photos',
      status: 'hidden',
      reference: 'REF-1',
      title: { ru: 'Объект с фотографиями', en: '', es: '' },
      imagesByLanguage: { ru: [storedPhoto('backup-one.png', PNG)], en: [storedPhoto('backup-two.png', PNG_TWO)], es: [] },
    });
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  bot.saveDataNow();
  const seeded = bot.getData().objects.find((item) => item.id === 'with-photos');
  firstFile = seeded.imagesByLanguage.ru[0].storageFile;
  secondFile = seeded.imagesByLanguage.en[0].storageFile;
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

async function downloadBackup() {
  const ticket = await (await realFetch(base + '/api/backup/ticket', {
    method: 'POST', headers, body: JSON.stringify({ currentPassword: PASSWORD }),
  })).json();
  const response = await realFetch(base + '/api/backup?ticket=' + ticket.ticket, { headers });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}

test('в копии фотографии лежат как есть, а не текстом', async () => {
  const file = await downloadBackup();
  const { readBackupContainer } = await import('../src/backup-file.mjs');
  const { payload, media } = readBackupContainer(file);
  assert.equal(media.length, 2, 'обе фотографии в копии');
  assert.ok(media.some((item) => item.bytes.equals(PNG)) && media.some((item) => item.bytes.equals(PNG_TWO)), 'байты те же, без перекодирования');
  assert.ok(file.includes(PNG), 'снимок лежит в файле как есть');
  const record = payload.objects.find((item) => item.id === 'with-photos');
  assert.equal(record.imagesByLanguage.ru[0].storageFile, firstFile, 'в данных осталась ссылка на файл');
  assert.equal(record.imagesByLanguage.ru[0].dataBase64, undefined, 'base64 внутри данных больше нет');
  assert.deepEqual(payload.config.telegramBackup, { enabled: false }, 'ключ копии в Telegram с собой не уезжает');
  // Копия примерно равна сумме данных и снимков: без трети сверху на base64.
  assert.ok(file.length < PNG.length * 2 + 200 * 1024, 'файл не раздут, его размер ' + file.length);
});

test('копия восстанавливается и возвращает фотографии на диск', async () => {
  const file = await downloadBackup();
  for (const name of [firstFile, secondFile, 'backup-one.png', 'backup-two.png']) {
    fs.rmSync(path.join(mediaDirectory, name), { force: true });
  }
  bot.getData().objects.length = 0;

  const response = await realFetch(base + '/api/restore', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      cookie: headers.cookie,
      'x-csrf-token': headers['x-csrf-token'],
      'x-current-password': Buffer.from(PASSWORD).toString('base64'),
    },
    body: file,
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.missingPhotos, 0, 'ничего не потерялось');
  const record = bot.getData().objects.find((item) => item.id === 'with-photos');
  assert.ok(record, 'объект вернулся');
  assert.equal(record.imagesByLanguage.ru.length, 1, 'фотография на месте');
  assert.ok(fs.existsSync(path.join(mediaDirectory, firstFile)), 'файл снимка записан на диск');
  assert.ok(fs.readFileSync(path.join(mediaDirectory, secondFile)).equals(PNG_TWO), 'и второй тоже, байт в байт');
});

test('старые копии (.json.gz и .json) читаются по-прежнему', async () => {
  const { readBackup } = await import('../src/admin-http.mjs');
  const plain = { version: 28, config: { passwordHash: 'x'.repeat(20), passwordSalt: 'y'.repeat(20) }, objects: [] };
  const asStream = (bytes) => {
    const chunks = [bytes];
    return {
      headers: {},
      on(event, handler) {
        if (event === 'data') chunks.splice(0).forEach(handler);
        if (event === 'end') handler();
        return this;
      },
      resume() {},
    };
  };
  const gz = await readBackup(asStream(zlib.gzipSync(Buffer.from(JSON.stringify(plain), 'utf8'))));
  assert.equal(gz.version, 28, 'старый .json.gz понятен');
  const raw = await readBackup(asStream(Buffer.from(JSON.stringify(plain), 'utf8')));
  assert.equal(raw.version, 28, 'обычный .json тоже');
});

test('испорченный контейнер отклоняется с понятной ошибкой', async () => {
  const { backupChunks, readBackupContainer, BACKUP_MAGIC } = await import('../src/backup-file.mjs');
  // Собираем копию на месте: предыдущая проверка восстановления закрыла сессию,
  // да и проверять разбор файла удобнее без сервера.
  const file = Buffer.concat([...backupChunks({ version: 28, objects: [] }, [{ name: 'one.png', read: () => PNG }])]);
  assert.deepEqual(readBackupContainer(file).payload.objects, [], 'целый файл читается');
  assert.throws(() => readBackupContainer(file.subarray(0, file.length - 5)), /обрыв|повреж/i);
  assert.throws(() => readBackupContainer(Buffer.concat([BACKUP_MAGIC, Buffer.from('мусор')])), /повреж|не файл|нет данных/i);
  assert.throws(() => readBackupContainer(Buffer.from('совсем не копия')), /не файл резервной копии/i);
});
