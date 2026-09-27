'use strict';

// The weekly encrypted copy of the data in the admin chat, and restoring it.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const realFetch = global.fetch;
const { bot, telegram, resetData, cleanup } = require('./helpers/chat');

// Telegram stub that also keeps the documents the bot sends.
const telegramStub = global.fetch;
const documents = [];
global.fetch = async (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  if (String(url).endsWith('/sendDocument') && init && init.body instanceof FormData) {
    const file = init.body.get('document');
    documents.push({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()), caption: init.body.get('caption') });
  }
  return telegramStub(url, init);
};

let base;
let headers;

test.before(async () => {
  resetData();
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.beforeEach(async () => {
  resetData((data) => {
    const password = bot.hashPassword('admin-password-1');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.users['42'] = { id: '42', chatId: 42, firstName: 'Клиент из копии', activity: [] };
  });
  documents.length = 0;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin-password-1' }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  cleanup();
});

const put = (body) => realFetch(base + '/api/telegram-backup', { method: 'PUT', headers, body: JSON.stringify(body) });
const ENABLE = { enabled: true, password: 'copy-password-2026', passwordConfirm: 'copy-password-2026', currentPassword: 'admin-password-1' };

test('the copy is encrypted: only its password opens it', () => {
  const plain = Buffer.from('секретные данные');
  const data = bot.getData();
  bot.setBackupPassword('copy-password-2026');
  const { key, salt } = data.config.telegramBackup;
  const file = bot.encryptBackup(plain, key, salt);
  assert.ok(!file.includes(plain), 'no plain text inside');
  assert.deepEqual(bot.decryptBackup(file, 'copy-password-2026'), plain);
  assert.throws(() => bot.decryptBackup(file, 'wrong-password'), /Неверный пароль копии/);
});

test('turning the copy on needs the admin password and a sound copy password', async () => {
  assert.equal((await put({ ...ENABLE, currentPassword: 'nope' })).status, 403);
  assert.equal((await put({ ...ENABLE, password: 'short', passwordConfirm: 'short' })).status, 400);
  assert.equal((await put({ ...ENABLE, passwordConfirm: 'something-else' })).status, 400);
  assert.equal((await put({ ...ENABLE, password: 'admin-password-1', passwordConfirm: 'admin-password-1' })).status, 400, 'not the panel password');
  assert.equal((await put(ENABLE)).status, 200);
  const stateText = await (await realFetch(base + '/api/state', { headers })).text();
  const state = JSON.parse(stateText);
  assert.deepEqual(state.config.telegramBackup, { enabled: true, passwordSet: true, lastSentAt: '', lastError: '' });
  assert.ok(!stateText.includes(bot.getData().config.telegramBackup.key), 'the key never reaches the browser');
  assert.equal((await put({ enabled: false })).status, 200, 'turning it off needs no password');
  assert.equal(bot.getData().config.telegramBackup.enabled, false);
});

test('the file goes to the admin chat and restores the data with its password', async () => {
  assert.equal((await put(ENABLE)).status, 200);
  const sent = await realFetch(base + '/api/telegram-backup/send', { method: 'POST', headers, body: '{}' });
  assert.equal(sent.status, 200);
  assert.equal(documents.length, 1);
  const [document] = documents;
  assert.match(document.name, /^kornilenko-backup-\d{4}-\d{2}-\d{2}\.kbk$/);
  assert.match(document.caption, /без фотографий/);
  const inside = JSON.parse(zlib.gunzipSync(bot.decryptBackup(document.bytes, 'copy-password-2026')).toString('utf8'));
  assert.equal(inside.users['42'].firstName, 'Клиент из копии');
  assert.equal(inside.config.telegramBackup.key, undefined, 'the key is not in the file');

  delete bot.getData().users['42'];
  // Восстановление просит и текущий пароль панели, и пароль самой копии.
  const adminPass = Buffer.from('admin-password-1', 'utf8').toString('base64');
  const restore = (password) => realFetch(base + '/api/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', cookie: headers.cookie, 'x-csrf-token': headers['x-csrf-token'], 'x-current-password': adminPass, ...(password ? { 'x-backup-password': Buffer.from(password, 'utf8').toString('base64') } : {}) },
    body: document.bytes,
  });
  let response = await restore('');
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /введите её пароль/);
  assert.equal((await restore('wrong-password-1')).status, 400);
  response = await restore('copy-password-2026');
  assert.equal(response.status, 200);
  assert.equal(bot.getData().users['42'].firstName, 'Клиент из копии');
  assert.equal(bot.getData().config.telegramBackup.enabled, false, 'after a restore the copy is set up again');
});

test('on a new computer the copy restores without the photos, and the panel says how many are missing', async () => {
  assert.equal((await put(ENABLE)).status, 200);
  bot.getData().objects.push({ id: 'villa', status: 'active', reference: 'V1', title: { ru: 'Вилла', en: '', es: '' }, imagesByLanguage: { ru: [{ id: 'p1', storageFile: 'not-on-this-computer.jpg', mimeType: 'image/jpeg' }], en: [], es: [] } });
  await realFetch(base + '/api/telegram-backup/send', { method: 'POST', headers, body: '{}' });
  const response = await realFetch(base + '/api/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', cookie: headers.cookie, 'x-csrf-token': headers['x-csrf-token'], 'x-current-password': Buffer.from('admin-password-1').toString('base64'), 'x-backup-password': Buffer.from('copy-password-2026').toString('base64') },
    body: documents[0].bytes,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).missingPhotos, 1);
  const villa = bot.getData().objects.find((item) => item.id === 'villa');
  assert.deepEqual(villa.imagesByLanguage.ru, []);
  assert.equal(villa.title.ru, 'Вилла');
});

test('the panel backup file does not carry the key of the Telegram copy', async () => {
  assert.equal((await put(ENABLE)).status, 200);
  // Скачивание копии открывается по одноразовому пропуску, выданному по паролю.
  const ticket = await (await realFetch(base + '/api/backup/ticket', {
    method: 'POST', headers, body: JSON.stringify({ currentPassword: 'admin-password-1' }),
  })).json();
  const response = await realFetch(base + '/api/backup?ticket=' + ticket.ticket, { headers });
  const backup = JSON.parse(zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
  assert.deepEqual(backup.config.telegramBackup, { enabled: false });
  assert.ok(bot.getData().config.telegramBackup.key, 'the bot itself keeps it');
});

test('the copy is sent once a week, during the admin\'s hours', async () => {
  assert.equal((await put(ENABLE)).status, 200);
  const data = bot.getData();
  const monday = new Date(2026, 8, 21, 11, 0);
  data.config.telegramBackup.lastSentAt = new Date(2026, 8, 17, 11, 0).toISOString();
  assert.equal(await bot.runTelegramBackup(monday), false, 'four days ago');
  data.config.telegramBackup.lastSentAt = new Date(2026, 8, 13, 11, 0).toISOString();
  assert.equal(await bot.runTelegramBackup(new Date(2026, 8, 21, 23, 0)), false, 'not at night');
  assert.equal(await bot.runTelegramBackup(monday), true);
  assert.equal(documents.length, 1);
  assert.equal(data.config.telegramBackup.lastSentAt, monday.toISOString());
  assert.ok(telegram.calls.some((call) => call.method === 'sendDocument'));
});
