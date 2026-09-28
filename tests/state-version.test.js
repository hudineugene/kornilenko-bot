'use strict';

// Панель раз в 45 секунд спрашивает состояние и передаёт версию того, что у неё
// уже есть: совпала — экран не трогаем. Пока бот онлайн, это не срабатывало
// никогда: в версию входило время последнего ответа Telegram, а оно меняется
// после каждого опроса. Панель перерисовывалась целиком, переписка грузилась
// заново, прокрутка улетала наверх, а при наборе всплывало «Появились новые
// данные». Прежние тесты этого не замечали — в них бот выключен.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, property, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'state-version-pass';
let base = '';
let headers = {};

// Бот работает и только что получил ответ от Telegram.
function online(secondsAgo = 0) {
  bot.runtime.status = 'online';
  bot.runtime.consecutiveFailures = 0;
  bot.runtime.lastSuccessfulContactAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
}

async function stateVersion(since = '') {
  const response = await realFetch(base + '/api/state' + (since ? '?since=' + since : ''), { headers });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-01', 'Вилла', 'active'));
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  global.fetch = telegramStub;
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

test('пока бот онлайн, опросы Telegram не меняют версию состояния', async () => {
  online();
  const first = await stateVersion();
  assert.ok(first.stateVersion, 'версия пришла');

  // Прошло несколько опросов Telegram: время последнего ответа другое.
  online(3);
  const again = await stateVersion(first.stateVersion);
  assert.equal(again.unchanged, true, 'панель узнала, что перерисовывать нечего');
  assert.equal(again.stateVersion, first.stateVersion, 'версия та же');

  online(30);
  assert.equal((await stateVersion(first.stateVersion)).unchanged, true, 'и через полминуты тоже');
});

test('настоящее изменение версию меняет', async () => {
  online();
  const before = await stateVersion();
  bot.getData().objects[0].city = { ru: 'Кальпе', en: 'Calpe', es: 'Calpe' };
  const after = await stateVersion(before.stateVersion);
  assert.notEqual(after.unchanged, true, 'состояние прислано целиком');
  assert.notEqual(after.stateVersion, before.stateVersion, 'версия другая');
});

test('пропавшая связь меняет версию сразу', async () => {
  online();
  const working = await stateVersion();

  // Ответов нет дольше двух минут — это уже не «всё в порядке».
  online(5 * 60);
  const stale = await stateVersion(working.stateVersion);
  assert.notEqual(stale.unchanged, true, 'панель получила новое состояние');
  assert.notEqual(stale.stateVersion, working.stateVersion, 'версия изменилась');

  // И ошибка связи тоже.
  online();
  const ok = await stateVersion();
  bot.runtime.status = 'error';
  bot.runtime.lastError = 'Telegram не ответил вовремя';
  const failed = await stateVersion(ok.stateVersion);
  assert.notEqual(failed.unchanged, true);
  bot.runtime.status = 'online';
  bot.runtime.lastError = '';
});

test('в обзоре время последнего ответа показывается только когда связь пропала', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /stale \? ", последний ответ "/, 'возраст ответа — только при проблеме');
  assert.match(PANEL_HTML, /Date\.now\(\) - contact > 120000/, 'порог — две минуты, как и в отпечатке состояния');
});
