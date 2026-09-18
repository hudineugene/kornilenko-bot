'use strict';

// Messages to the admin about the bot itself: started, stopped and why,
// switched on or off in the panel, Telegram connection lost, internal error.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, resetData, adminMessages, settle, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

test.beforeEach(() => resetData());
test.after(cleanup);

test('the stop message says why the bot stopped', () => {
  const at = new Date(2026, 8, 18, 14, 19);
  assert.match(bot.stopNoticeText('SIGINT', at), /^🔴 Бот остановлен в (\d\d\.\d\d )?14:19: нажали Ctrl\+C в окне бота\./);
  assert.match(bot.stopNoticeText('SIGHUP', at), /закрыли окно бота/);
  assert.match(bot.stopNoticeText('SIGTERM', at), /выключение Windows/);
  assert.match(bot.stopNoticeText('SIGINT', at), /Клиенты не получат ответов, пока бот не запущен снова/);
});

test('the start message tells how long the bot was off', () => {
  const data = bot.getData();
  const now = new Date(2026, 8, 18, 14, 31);
  data.config.active = true;
  data.lastShutdown = { at: new Date(2026, 8, 18, 14, 19).toISOString(), reason: 'SIGINT' };
  assert.match(bot.startNoticeText(now), /^🟢 Бот запущен в (\d\d\.\d\d )?14:31\.\nПеред этим был остановлен в (\d\d\.\d\d )?14:19 \(нажали Ctrl\+C в окне бота\), перерыв 12 мин\.$/);
  data.lastShutdown = { at: new Date(2026, 8, 16, 10, 0).toISOString(), reason: 'SIGHUP' };
  assert.match(bot.startNoticeText(now), /перерыв 2 дн\.\nTelegram хранит сообщения клиентов только сутки/);
  data.config.active = false;
  assert.match(bot.startNoticeText(now), /⏸ В настройках панели бот выключен/);
});

test('the start message is sent once Telegram answers', async () => {
  const data = bot.getData();
  data.config.active = true;
  bot.announceStart(new Date());
  assert.equal(adminMessages().length, 0, 'not before the connection');
  assert.equal(bot.telegramContactRestored(), 'start');
  await settle();
  assert.match(adminMessages()[0].text, /^🟢 Бот запущен/);
  assert.equal(bot.telegramContactRestored(), '', 'only once');
});

test('a longer break in the connection is reported when it is over', async () => {
  const lost = new Date(2026, 8, 18, 14, 20);
  bot.telegramContactLost(lost);
  bot.telegramContactLost(new Date(2026, 8, 18, 14, 25));
  assert.equal(bot.telegramContactRestored(new Date(2026, 8, 18, 14, 31)), 'outage');
  await settle();
  assert.match(adminMessages()[0].text, /^📶 Связь с Telegram восстановлена\. Её не было с (\d\d\.\d\d )?14:20 до (\d\d\.\d\d )?14:31 \(11 мин\)/);

  bot.telegramContactLost(new Date(2026, 8, 18, 15, 0));
  assert.equal(bot.telegramContactRestored(new Date(2026, 8, 18, 15, 1)), '', 'a minute is not worth a message');
});

test('internal errors are reported at most once an hour', async () => {
  const now = new Date(2026, 8, 18, 12, 0);
  assert.equal(bot.announceError('тест', new Error('что-то сломалось'), now), true);
  assert.equal(bot.announceError('тест', new Error('ещё раз'), new Date(now.getTime() + 10 * 60000)), false);
  assert.equal(bot.announceError('тест', new Error('через час'), new Date(now.getTime() + 61 * 60000)), true);
  await settle();
  const texts = adminMessages().map((message) => message.text);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /^❗ Внутренняя ошибка бота \(тест\): что-то сломалось/);
});

test('switching the bot off in the panel is reported; the messages can be turned off', async () => {
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.active = true;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    telegram.calls = [];
    assert.equal((await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ messages: data.config.messages, active: false }) })).status, 200);
    await settle();
    assert.match(adminMessages()[0].text, /^⏸ Бот выключен в панели/);

    assert.equal((await realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ messages: data.config.messages, active: false, statusNotices: false }) })).status, 200);
    assert.equal(data.config.statusNotices, false);
    const state = await (await realFetch(base + '/api/state', { headers })).json();
    assert.equal(state.config.statusNotices, false);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
  telegram.calls = [];
  assert.equal(await bot.sendStatusNotice('проверка'), false, 'switched off: nothing is sent');
  assert.equal(adminMessages().length, 0);
  assert.equal(bot.normalizeLoadedData({ version: 16 }).config.statusNotices, true, 'on by default');
});
