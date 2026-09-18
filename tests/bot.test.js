'use strict';

// Run with: npm test  (or: node --test tests/*.test.js)
// The bot is loaded with BOT_NO_START=1 against a temporary data folder, so
// the tests never touch bot-data.json and never contact Telegram.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-'));
const dataFile = path.join(workDirectory, 'bot-data.json');
const mediaDirectory = path.join(workDirectory, 'bot-media');
process.env.BOT_NO_START = '1';
process.env.BOT_DATA_FILE = dataFile;
process.env.BOT_MEDIA_DIRECTORY = mediaDirectory;
process.env.NO_AUTO_OPEN = '1';

const bot = require('../bot.js');

const PNG_BYTES = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('test image payload')]);

test.after(() => {
  bot.server.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

function withFetch(stub, callback) {
  const original = global.fetch;
  global.fetch = stub;
  return Promise.resolve().then(callback).finally(() => {
    global.fetch = original;
  });
}

function telegramResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('admin edits of Russian texts survive a restart', () => {
  const saved = bot.normalizeLoadedData({
    version: 13,
    config: {
      greeting: 'Старое приветствие',
      help: 'Отправьте сообщение, и я постараюсь подобрать ответ.',
      fallback: 'Спасибо за сообщение! Я передал его администратору.',
      messages: {
        ru: { greeting: 'Моё приветствие', help: 'Моя справка', fallback: 'Мой ответ' },
      },
    },
  });
  assert.equal(saved.config.messages.ru.greeting, 'Моё приветствие');
  assert.equal(saved.config.messages.ru.help, 'Моя справка');
  assert.equal(saved.config.messages.ru.fallback, 'Мой ответ');
  assert.equal(saved.version, 15);
  for (const key of ['greeting', 'help', 'fallback']) assert.equal(key in saved.config, false);

  const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reloaded.config.messages, saved.config.messages);
});

test('one-language files are still migrated into Russian texts', () => {
  const migrated = bot.normalizeLoadedData({ config: { greeting: 'Привет из старой версии' } });
  assert.equal(migrated.config.messages.ru.greeting, 'Привет из старой версии');
  assert.equal('greeting' in migrated.config, false);
});

test('text migrations run once, not on every load', () => {
  const custom = { ru: { greeting: 'Наш агент на связи', help: 'Справка', fallback: 'Ответ' } };
  const legacy = bot.normalizeLoadedData({ version: 13, config: { messages: custom } });
  assert.equal(legacy.config.messages.ru.greeting, 'Наш менеджер на связи');
  const words = bot.normalizeLoadedData({
    version: 13,
    config: { messages: { ru: { greeting: 'Позвоните агенту, агентство и субагент', help: 'Справка', fallback: 'Ответ' } } },
  });
  assert.equal(words.config.messages.ru.greeting, 'Позвоните менеджеру, агентство и субагент');
  const current = bot.normalizeLoadedData({ version: 14, config: { messages: custom } });
  assert.equal(current.config.messages.ru.greeting, 'Наш агент на связи');
});

test('analytics of deleted properties are dropped on load', () => {
  const loaded = bot.normalizeLoadedData({
    version: 14,
    objects: [{ id: 'kept' }],
    analytics: { daily: {}, properties: { kept: { details: 1 }, removed: { details: 5 } } },
  });
  assert.deepEqual(Object.keys(loaded.analytics.properties), ['kept']);
});

test('a failing update does not block the offset or other chats', async () => {
  bot.runtime.offset = 0;
  const handled = [];
  const updates = [
    { update_id: 10, message: { chat: { id: 1 }, text: 'a' } },
    { update_id: 11, message: { chat: { id: 2 }, text: 'boom' } },
    { update_id: 12, message: { chat: { id: 1 }, text: 'b' } },
  ];
  await bot.processUpdates(updates, 'token', async (update) => {
    if (update.message.text === 'boom') throw new Error('Forbidden: bot was blocked by the user');
    handled.push(update.update_id);
  });
  assert.equal(bot.runtime.offset, 13);
  assert.equal(bot.getData().telegramOffset, 13);
  assert.deepEqual(handled, [10, 12]);
  assert.ok(bot.getData().errors.some((item) => item.message.includes('blocked')));
});

test('Telegram 429 is retried after retry_after', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return calls === 1
      ? telegramResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } })
      : telegramResponse(200, { ok: true, result: { message_id: 7 } });
  }, async () => {
    const result = await bot.telegramRequest('1:token', 'sendMessage', { chat_id: 1, text: 'hi' });
    assert.equal(result.message_id, 7);
  });
  assert.equal(calls, 2);
});

test('an unreasonable retry_after is reported instead of waited for', async () => {
  await withFetch(async () => telegramResponse(429, {
    ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3600 },
  }), async () => {
    await assert.rejects(bot.telegramRequest('1:token', 'sendMessage', {}), (error) => error.telegramCode === 429);
  });
});

test('identical images share one file on disk', () => {
  const first = { id: 'a', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') };
  const second = { id: 'b', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') };
  bot.persistImage(first);
  bot.persistImage(second);
  assert.equal(first.storageFile, second.storageFile);
  assert.match(first.storageFile, /^[0-9a-f]{64}\.png$/);
  assert.notEqual(first.id, second.id);
});

test('images from older versions move to content-addressed names', () => {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  fs.writeFileSync(path.join(mediaDirectory, 'old-upload-1.png'), PNG_BYTES);
  fs.writeFileSync(path.join(mediaDirectory, 'old-upload-2.png'), PNG_BYTES);
  const root = {
    objects: [{
      imagesByLanguage: {
        ru: [{ id: 'x', mimeType: 'image/png', storageFile: 'old-upload-1.png' }],
        en: [{ id: 'y', mimeType: 'image/png', storageFile: 'old-upload-2.png' }],
        es: [],
      },
    }],
  };
  bot.contentAddressImages(root);
  const [ru] = root.objects[0].imagesByLanguage.ru;
  const [en] = root.objects[0].imagesByLanguage.en;
  assert.equal(ru.storageFile, en.storageFile);
  assert.deepEqual(fs.readFileSync(path.join(mediaDirectory, ru.storageFile)), PNG_BYTES);
  assert.equal(bot.referencedImageFiles(root).size, 1);
});

test('user lookups ignore prototype keys', () => {
  assert.equal(bot.userById('__proto__'), undefined);
  assert.equal(bot.userById('constructor'), undefined);
});

test('the chat index follows user updates', () => {
  bot.normalizeUser({ id: 501, first_name: 'Анна' }, 9001);
  assert.equal(bot.userByChatId(9001).firstName, 'Анна');
  bot.normalizeUser({ id: 501, first_name: 'Анна-Мария' }, 9001);
  assert.equal(bot.userByChatId('9001').firstName, 'Анна-Мария');
  assert.equal(bot.userByChatId(424242), undefined);
});

test('the panel rejects foreign host names', () => {
  const request = (host) => ({ headers: { host } });
  assert.equal(bot.hostAllowed(request('127.0.0.1:3000')), true);
  assert.equal(bot.hostAllowed(request('localhost:3000')), true);
  assert.equal(bot.hostAllowed(request('[::1]:3000')), true);
  assert.equal(bot.hostAllowed(request('192.168.1.20:3000')), true);
  assert.equal(bot.hostAllowed(request('attacker.example:3000')), false);
});

test('a corrupt data file is recovered from the .bak copy', () => {
  const good = bot.normalizeLoadedData({ version: 14, config: { adminChatId: '123456' } });
  fs.writeFileSync(dataFile + '.bak', JSON.stringify(good));
  fs.writeFileSync(dataFile, '{"config": ');
  const originalError = console.error;
  console.error = () => {};
  let recovered;
  try {
    recovered = bot.loadData();
  } finally {
    console.error = originalError;
  }
  assert.equal(recovered.config.adminChatId, '123456');
  assert.equal(recovered.errors[0].area, 'Загрузка данных');
  assert.ok(fs.readdirSync(workDirectory).some((name) => name.startsWith('bot-data.json.corrupt-')));
});

test.describe('admin API', () => {
  let baseUrl;
  let cookie;
  let csrf;

  test.before(async () => {
    const data = bot.normalizeLoadedData({ version: 14 });
    const password = bot.hashPassword('correct-password');
    data.config.botToken = '12345:ABCDEFGHIJKLMNOPQRSTUV';
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.config.active = false;
    data.users['700'] = { id: '700', chatId: 700, firstName: 'Тест', activity: [] };
    bot.setData(data);
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + bot.server.address().port;
    const response = await fetch(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' }),
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrf;
  });

  function call(method, url, body) {
    return fetch(baseUrl + url, {
      method,
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  test('PATCH /api/users/__proto__ cannot pollute Object.prototype', async () => {
    const response = await call('PATCH', '/api/users/__proto__', { blocked: true, note: 'x' });
    assert.equal(response.status, 404);
    assert.equal({}.blocked, undefined);
  });

  test('changing the password requires the current password', async () => {
    const messages = bot.getData().config.messages;
    const change = { messages, active: false, password: 'new-password-1', passwordConfirm: 'new-password-1' };
    assert.equal((await call('PUT', '/api/settings', change)).status, 403);
    assert.equal((await call('PUT', '/api/settings', { ...change, currentPassword: 'wrong-password' })).status, 403);
    assert.equal((await call('PUT', '/api/settings', { ...change, currentPassword: 'correct-password' })).status, 200);
    const login = await fetch(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'new-password-1' }),
    });
    assert.equal(login.status, 200);
  });

  test('saving other settings needs no password', async () => {
    const messages = bot.getData().config.messages;
    assert.equal((await call('PUT', '/api/settings', { messages, active: false })).status, 200);
  });

  test('/api/state answers "unchanged" for the version the panel already has', async () => {
    const full = await (await call('GET', '/api/state')).json();
    assert.ok(full.stateVersion);
    assert.ok(Array.isArray(full.users));
    const repeat = await (await call('GET', '/api/state?since=' + full.stateVersion)).json();
    assert.deepEqual(repeat, { unchanged: true, stateVersion: full.stateVersion });
  });

  test('a downloaded backup restores with its photos', async () => {
    const data = bot.getData();
    data.objects.push({
      id: 'backup-object',
      imagesByLanguage: {
        ru: [{ id: 'p1', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
        en: [{ id: 'p2', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
        es: [],
      },
    });
    bot.saveDataNow();
    const backup = Buffer.from(await (await call('GET', '/api/backup')).arrayBuffer());
    data.objects = [];
    bot.saveDataNow();
    const response = await fetch(baseUrl + '/api/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/gzip', cookie, 'x-csrf-token': csrf },
      body: backup,
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrf;
    const restored = bot.getData().objects.find((item) => item.id === 'backup-object');
    const [ru] = restored.imagesByLanguage.ru;
    const [en] = restored.imagesByLanguage.en;
    assert.equal(ru.storageFile, en.storageFile);
    assert.deepEqual(fs.readFileSync(path.join(mediaDirectory, ru.storageFile)), PNG_BYTES);
  });

  test('requests with a foreign Host header are refused', async () => {
    const http = require('node:http');
    const status = await new Promise((resolve, reject) => {
      const request = http.request(baseUrl + '/api/status', { headers: { host: 'attacker.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 421);
  });
});
