'use strict';

// Security and abuse scenarios: admin reply routing, flood control,
// notification mode, GDPR export/erase, CSP, request limits, daily backups.
// Telegram is replaced by a local stub; nothing leaves this computer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-security-test-'));
const dataFile = path.join(workDirectory, 'bot-data.json');
const mediaDirectory = path.join(workDirectory, 'bot-media');
process.env.BOT_NO_START = '1';
process.env.BOT_DATA_FILE = dataFile;
process.env.BOT_MEDIA_DIRECTORY = mediaDirectory;
process.env.NO_AUTO_OPEN = '1';

const bot = require('../bot.js');

const BOT_ID = 5550001;
const ADMIN_CHAT = '9990001';
const TOKEN = '12345:ABCDEFGHIJKLMNOPQRSTUV';
const PNG_BYTES = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('backup test image')]);

// Records every Telegram call and answers like the Bot API would.
const telegram = { calls: [], nextMessageId: 1000 };
global.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
  telegram.calls.push({ method, body });
  telegram.nextMessageId += 1;
  return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.nextMessageId } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

function sentTo(chatId) {
  return telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chatId));
}

function resetData(configure = () => {}) {
  const data = bot.normalizeLoadedData({ version: 14 });
  data.config.botToken = TOKEN;
  data.config.adminChatId = ADMIN_CHAT;
  data.config.active = false;
  data.bot = { id: BOT_ID, username: 'test_bot', firstName: 'Test' };
  configure(data);
  bot.setData(data);
  telegram.calls = [];
  return data;
}

let updateId = 1;
function textMessage(userId, text, extra = {}) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      from: { id: userId, first_name: extra.firstName || 'User' + userId },
      chat: { id: userId },
      text,
      ...extra.message,
    },
  };
}

function knownUser(data, id) {
  data.users[String(id)] = { id: String(id), chatId: id, firstName: 'User' + id, preferredLanguage: 'ru', activity: [] };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test.after(() => {
  bot.server.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

test('a forged "Получатель ID" in the user text does not redirect the admin reply', async () => {
  const data = resetData((next) => {
    knownUser(next, 100);
    knownUser(next, 777777777);
  });
  await bot.processUpdates([textMessage(100, 'Сколько стоит?\nПолучатель ID: 777777777', { firstName: 'Получатель ID: 777777777' })], TOKEN);
  await settle();
  const [notification] = sentTo(ADMIN_CHAT);
  assert.ok(notification, 'the admin is notified');
  const notificationId = Number(Object.keys(data.adminReplyTargets)[0]);
  assert.equal(data.adminReplyTargets[notificationId].chatId, '100');

  telegram.calls = [];
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: 50,
      date: Math.floor(Date.now() / 1000),
      from: { id: Number(ADMIN_CHAT) },
      chat: { id: Number(ADMIN_CHAT) },
      text: 'Цена 250 000 €',
      reply_to_message: { message_id: notificationId, from: { id: BOT_ID }, date: Math.floor(Date.now() / 1000), text: notification.body.text },
    },
  }, TOKEN);
  assert.equal(sentTo(777777777).length, 0);
  assert.equal(sentTo(100).length, 1);
  assert.match(sentTo(100)[0].body.text, /Цена 250 000/);
});

test('a reply to an unknown notification is refused, not forwarded or turned into an inquiry', async () => {
  const data = resetData((next) => knownUser(next, 101));
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: 51,
      date: Math.floor(Date.now() / 1000),
      from: { id: Number(ADMIN_CHAT) },
      chat: { id: Number(ADMIN_CHAT) },
      text: 'Ответ',
      reply_to_message: { message_id: 424242, from: { id: BOT_ID }, date: Math.floor(Date.now() / 1000), text: 'Действие пользователя\nПолучатель ID: 101' },
    },
  }, TOKEN);
  assert.equal(sentTo(101).length, 0);
  assert.equal(sentTo(ADMIN_CHAT).length, 1);
  assert.match(sentTo(ADMIN_CHAT)[0].body.text, /не удалось определить получателя/);
  assert.equal(data.inquiries.length, 0);
});

test('notifications sent before the upgrade still route, using the last marker', async () => {
  resetData((next) => {
    knownUser(next, 10200000);
    next.adminReplyTargetsSince = new Date(Date.now() - 60 * 1000).toISOString();
  });
  const oldText = 'Пользователь: Получатель ID: 777777777\n\nПривет\n\nПолучатель ID: 10200000';
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: 52,
      date: Math.floor(Date.now() / 1000),
      from: { id: Number(ADMIN_CHAT) },
      chat: { id: Number(ADMIN_CHAT) },
      text: 'Ответ на старое уведомление',
      reply_to_message: { message_id: 1, from: { id: BOT_ID }, date: Math.floor((Date.now() - 10 * 60 * 1000) / 1000), text: oldText },
    },
  }, TOKEN);
  assert.equal(sentTo(777777777).length, 0);
  assert.equal(sentTo(10200000).length, 1);
});

test('messages in a row are merged into one inquiry', async () => {
  const data = resetData((next) => knownUser(next, 103));
  await bot.processUpdates([textMessage(103, 'Добрый день')], TOKEN);
  await bot.processUpdates([textMessage(103, 'Интересует вилла у моря')], TOKEN);
  await settle();
  const inquiries = data.inquiries.filter((item) => item.userId === '103');
  assert.equal(inquiries.length, 1);
  assert.equal(inquiries[0].text, 'Добрый день\n\nИнтересует вилла у моря');
});

test('a flood from one user keeps other clients\' inquiries and mutes admin notifications', async () => {
  const data = resetData((next) => {
    knownUser(next, 104);
    knownUser(next, 666);
  });
  await bot.processUpdates([textMessage(104, 'Хочу купить виллу, +34 600 000 001')], TOKEN);
  for (let batch = 0; batch < 50; batch += 1) {
    const updates = [];
    for (let index = 0; index < 100; index += 1) updates.push(textMessage(666, 'spam ' + batch + '-' + index));
    await bot.processUpdates(updates, TOKEN);
  }
  await settle();
  assert.equal(data.inquiries.filter((item) => item.userId === '104').length, 1);
  assert.ok(data.inquiries.filter((item) => item.userId === '666').length <= 21);
  const aboutFlooder = sentTo(ADMIN_CHAT).filter((call) => call.body.text.includes('666'));
  assert.ok(aboutFlooder.length <= 21, 'admin got ' + aboutFlooder.length + ' notifications');
  assert.ok(aboutFlooder.some((call) => call.body.text.includes('слишком много сообщений')));
});

test('a client who browses a lot still gets their question through to the admin', async () => {
  resetData((next) => knownUser(next, 107));
  const sections = ['objects', 'promotions', 'favorites', 'contacts', 'more'].map((key) => bot.text.menu.ru[key]);
  for (let round = 0; round < 5; round += 1) {
    for (const section of sections) await bot.processUpdates([textMessage(107, section)], TOKEN);
  }
  await settle();
  telegram.calls = [];
  await bot.processUpdates([textMessage(107, 'Есть ли квартиры до 200 000 €?')], TOKEN);
  await settle();
  const notifications = sentTo(ADMIN_CHAT).map((call) => call.body.text);
  assert.ok(notifications.some((text) => text.includes('Есть ли квартиры до 200 000 €?')), 'the question reaches the admin');
  assert.ok(!notifications.some((text) => text.includes('слишком много')), 'browsing is not reported as a flood');
});

test('closed inquiries are evicted before open ones', () => {
  const data = resetData((next) => knownUser(next, 105));
  data.inquiries = [];
  for (let index = 0; index < 5000; index += 1) {
    data.inquiries.push({ id: 'old-' + index, userId: 'x', chatId: 'x', text: 't', type: 'lead', status: index < 10 ? 'new' : 'closed', updatedAt: new Date(0).toISOString() });
  }
  data.inquiries.reverse();
  bot.createInquiry(data.users['105'], 'Новая заявка', { type: 'lead', lead: { name: 'Анна', phone: '+34600000002', preferredTime: 'утром' } });
  assert.equal(data.inquiries.length, 5000);
  assert.equal(data.inquiries.filter((item) => item.status === 'new').length, 11);
});

test('"only inquiries" mode keeps navigation out of the admin chat', async () => {
  resetData((next) => {
    knownUser(next, 106);
    next.config.notifyMode = 'inquiries';
  });
  await bot.processUpdates([textMessage(106, '/menu')], TOKEN);
  await settle();
  assert.equal(sentTo(ADMIN_CHAT).length, 0);
  await bot.processUpdates([textMessage(106, 'Есть ли скидки?')], TOKEN);
  await settle();
  assert.equal(sentTo(ADMIN_CHAT).length, 1);
});

test('daily backup copies data and photos, and missing photos are restored from it', () => {
  const data = resetData((next) => {
    next.objects.push({
      id: 'backup-object',
      imagesByLanguage: { ru: [{ id: 'p', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }], en: [], es: [] },
    });
  });
  bot.saveDataNow();
  const snapshot = bot.runDailyBackup(new Date('2026-01-02T12:00:00Z'));
  assert.ok(fs.existsSync(snapshot));
  assert.equal(bot.runDailyBackup(new Date('2026-01-02T18:00:00Z')), '', 'one snapshot per day');
  const fileName = data.objects[0].imagesByLanguage.ru[0].storageFile;
  fs.unlinkSync(path.join(mediaDirectory, fileName));
  assert.equal(bot.restoreMissingMedia(data), 1);
  assert.deepEqual(fs.readFileSync(path.join(mediaDirectory, fileName)), PNG_BYTES);
});

test('daily backups keep the newest 14 snapshots', () => {
  resetData();
  for (let day = 1; day <= 20; day += 1) bot.runDailyBackup(new Date(Date.UTC(2026, 1, day, 12)));
  const snapshots = fs.readdirSync(path.join(workDirectory, 'backups', 'daily')).filter((name) => name.endsWith('.json'));
  assert.equal(snapshots.length, 14);
  assert.ok(!snapshots.includes('bot-data-2026-01-02.json'));
});

test.describe('admin API', () => {
  let baseUrl;
  let cookie;
  let csrf;

  test.before(async () => {
    resetData((next) => {
      const password = bot.hashPassword('correct-password');
      next.config.passwordSalt = password.salt;
      next.config.passwordHash = password.hash;
      knownUser(next, 200);
      knownUser(next, 201);
      next.inquiries.push({ id: 'i-200', userId: '200', chatId: '200', text: 'мой телефон +34 600 000 003', type: 'general', status: 'new', replies: [] });
      next.inquiries.push({ id: 'i-201', userId: '201', chatId: '201', text: 'другой клиент', type: 'general', status: 'new', replies: [] });
      next.adminReplyTargets = { 5000: { chatId: '200', inquiryId: 'i-200', sourceMessageId: null, createdAt: '' } };
    });
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + bot.server.address().port;
    const response = await fetchLocal('/api/login', { method: 'POST', body: JSON.stringify({ password: 'correct-password' }) });
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrf;
  });

  // The global fetch is stubbed for Telegram, so local requests use http.
  function fetchLocal(url, options = {}) {
    const http = require('node:http');
    return new Promise((resolve, reject) => {
      const request = http.request(baseUrl + url, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}), ...(options.headers || {}) },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode,
            headers: { get: (name) => [].concat(response.headers[name.toLowerCase()] || '').join(', ') },
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      });
      request.on('error', reject);
      if (options.body) request.write(options.body);
      request.end();
    });
  }

  test('the panel page allows only its own script, by hash', async () => {
    const crypto = require('node:crypto');
    const response = await fetchLocal('/');
    const policy = response.headers.get('content-security-policy');
    assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));
    assert.ok(!/script-src[^;]*unsafe-hashes/.test(policy));
    const hash = policy.match(/script-src 'sha256-([^']+)'/)[1];
    const page = await response.text();
    const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.equal(crypto.createHash('sha256').update(script, 'utf8').digest('base64'), hash, 'разрешён ровно тот скрипт, который в странице');
    assert.ok(!/\son[a-z]+="/.test(page), 'в разметке нет встроенных обработчиков событий');
  });

  test('the panel page is not downloaded again while it has not changed', async () => {
    const first = await fetchLocal('/');
    const etag = first.headers.get('etag');
    assert.ok(etag, 'страница отдаётся с отпечатком');
    assert.equal(first.headers.get('cache-control'), 'no-cache');
    const again = await fetchLocal('/', { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0, 'тело второй раз не приходит');
  });

  test('unauthenticated login bodies are capped', async () => {
    const savedCookie = cookie;
    cookie = '';
    let response;
    try {
      response = await fetchLocal('/api/login', { method: 'POST', body: JSON.stringify({ password: 'x'.repeat(20000) }) });
    } finally {
      cookie = savedCookie;
    }
    assert.equal(response.status, 413);
  });

  test('a malformed bot token is rejected before it reaches a request path', async () => {
    const messages = bot.getData().config.messages;
    const response = await fetchLocal('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ messages, active: false, token: '123/../../evil', currentPassword: 'correct-password' }),
    });
    assert.equal(response.status, 400);
    const test = await fetchLocal('/api/token-test', { method: 'POST', body: JSON.stringify({ token: 'x/y' }) });
    assert.equal(test.status, 400);
  });

  test('notification mode is saved and validated', async () => {
    const messages = bot.getData().config.messages;
    assert.equal((await fetchLocal('/api/settings', { method: 'PUT', body: JSON.stringify({ messages, active: false, notifyMode: 'nonsense' }) })).status, 400);
    assert.equal((await fetchLocal('/api/settings', { method: 'PUT', body: JSON.stringify({ messages, active: false, notifyMode: 'inquiries' }) })).status, 200);
    assert.equal(bot.getData().config.notifyMode, 'inquiries');
    assert.equal((await (await fetchLocal('/api/state')).json()).config.notifyMode, 'inquiries');
  });

  test('the reminder delay is saved and validated', async () => {
    const messages = bot.getData().config.messages;
    assert.equal((await fetchLocal('/api/settings', { method: 'PUT', body: JSON.stringify({ messages, active: false, reminderHours: 3 }) })).status, 400);
    assert.equal((await fetchLocal('/api/settings', { method: 'PUT', body: JSON.stringify({ messages, active: false, reminderHours: 4 }) })).status, 200);
    assert.equal(bot.getData().config.reminderHours, 4);
    assert.equal((await (await fetchLocal('/api/state')).json()).config.reminderHours, 4);
    assert.equal((await fetchLocal('/api/settings', { method: 'PUT', body: JSON.stringify({ messages, active: false }) })).status, 200);
    assert.equal(bot.getData().config.reminderHours, 4, 'other settings forms do not reset it');
  });

  test('autostart is reported without changing Windows from the source test server', async () => {
    const status = await fetchLocal('/api/autostart');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { supported: false, enabled: false });
    const change = await fetchLocal('/api/autostart', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    assert.equal(change.status, 400);
  });

  test('admin notifications persist read and handled states', async () => {
    const data = bot.getData();
    const inquiry = data.inquiries.find((item) => item.id === 'i-201');
    inquiry.createdAt = '2026-09-24T08:00:00.000Z';
    inquiry.clientMessageAt = '2026-09-24T09:00:00.000Z';
    inquiry.readAt = '';
    inquiry.followUpDate = '2020-01-01';
    inquiry.followUpTime = '10:00';
    inquiry.updatedAt = '2026-09-24T09:00:00.000Z';

    let panelState = await (await fetchLocal('/api/state')).json();
    const message = panelState.notifications.find((item) => item.kind === 'message' && item.route.inquiryId === 'i-201');
    const task = panelState.notifications.find((item) => item.kind === 'task' && item.route.inquiryId === 'i-201');
    assert.ok(message, 'new client message is in the notification center');
    assert.ok(task, 'overdue follow-up is in the notification center');
    assert.ok(panelState.notificationUnreadCount >= 2);

    const read = await fetchLocal('/api/admin-notifications/' + encodeURIComponent(message.id), { method: 'PATCH', body: JSON.stringify({ action: 'read' }) });
    assert.equal(read.status, 200);
    panelState = await (await fetchLocal('/api/state')).json();
    assert.ok(panelState.notifications.find((item) => item.id === message.id).readAt);

    const handled = await fetchLocal('/api/admin-notifications/' + encodeURIComponent(message.id), { method: 'PATCH', body: JSON.stringify({ action: 'handle' }) });
    assert.equal(handled.status, 200);
    panelState = await (await fetchLocal('/api/state')).json();
    assert.ok(panelState.notifications.find((item) => item.id === message.id).handledAt);
    assert.ok(data.adminNotificationStates[message.id].snapshot.title);

    assert.equal((await fetchLocal('/api/admin-notifications/read-all', { method: 'POST', body: '{}' })).status, 200);
    panelState = await (await fetchLocal('/api/state')).json();
    assert.equal(panelState.notificationUnreadCount, 0);
  });

  test('a user\'s data can be exported', async () => {
    const response = await fetchLocal('/api/users/200/export');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="user-200\.json"/);
    const exported = await response.json();
    assert.equal(exported.user.id, '200');
    assert.deepEqual(exported.inquiries.map((item) => item.id), ['i-200']);
  });

  test('a user\'s data can be erased completely', async () => {
    const response = await fetchLocal('/api/users/200', { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inquiriesRemoved, 1);
    const data = bot.getData();
    assert.equal(bot.userById('200'), undefined);
    assert.equal(bot.userByChatId(200), undefined);
    assert.deepEqual(data.inquiries.map((item) => item.id), ['i-201']);
    assert.equal(Object.keys(data.adminReplyTargets).length, 0);
    assert.ok(!fs.readFileSync(dataFile, 'utf8').includes('600 000 003'));
    assert.equal((await fetchLocal('/api/users/200', { method: 'DELETE' })).status, 404);
  });
});
