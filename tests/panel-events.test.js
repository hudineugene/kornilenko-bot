'use strict';

// Мгновенные обновления панели: /api/events — поток «данные изменились». Панель, получив сигнал, сразу спрашивает новое
// (а не ждёт таймера в 45 секунд). Поток только для вошедших; сигналы склеиваются; закрытая вкладка снимает поток.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const realFetch = global.fetch;
const { bot, createChat, resetData, settle, cleanup } = require('./helpers/chat');

const PASSWORD = 'admin-password-77';
let port = 0;
let cookie = '';

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  port = bot.server.address().port;
  const login = await realFetch('http://127.0.0.1:' + port + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

// Открывает поток и копит всё, что в нём пришло.
function openStream(headers = { cookie }) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/events', headers }, (response) => {
      const stream = { response, text: '', request };
      response.setEncoding('utf8');
      response.on('data', (chunk) => { stream.text += chunk; });
      resolve(stream);
    });
    request.on('error', reject);
  });
}
const events = (stream) => (stream.text.match(/event: changed/g) || []).length;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('без входа потока нет', async () => {
  const stream = await openStream({});
  assert.equal(stream.response.statusCode, 401);
  stream.request.destroy();
});

test('вошедшая панель получает поток; новое сообщение клиента даёт сигнал «changed» меньше чем за секунду', async () => {
  const stream = await openStream();
  assert.equal(stream.response.statusCode, 200);
  assert.match(stream.response.headers['content-type'], /text\/event-stream/);
  assert.equal(stream.response.headers['cache-control'], 'no-store');
  await pause(60);
  assert.match(stream.text, /retry: 5000/);
  assert.equal(events(stream), 0, 'пока ничего не менялось — тихо');

  await createChat({ firstName: 'Анна' }).say('Здравствуйте, нужна помощь с выбором');
  await pause(700);
  stream.request.destroy();
  assert.ok(events(stream) >= 1, 'сигнал пришёл: ' + JSON.stringify(stream.text));
});

test('частые изменения склеиваются: десять сообщений подряд — не десять сигналов', async () => {
  const stream = await openStream();
  await pause(60);
  const chat = createChat({ firstName: 'Борис' });
  for (let index = 0; index < 10; index += 1) await chat.say('Сообщение ' + index);
  await pause(900);
  const count = events(stream);
  stream.request.destroy();
  assert.ok(count >= 1 && count <= 4, 'сигналов: ' + count);
});

test('закрытая вкладка снимает поток', async () => {
  const { eventStreamCount } = await import('../src/panel-events.mjs');
  await pause(150); // потоки прежних проверок ещё закрываются
  const before = eventStreamCount();
  const stream = await openStream();
  try {
    await pause(60);
    assert.equal(eventStreamCount(), before + 1);
  } finally {
    stream.request.destroy();
  }
  await pause(150);
  assert.equal(eventStreamCount(), before, 'поток снят');
  await settle();
});

test('панель: подключается к /api/events, перечитывает данные по сигналу одним запросом за раз и закрывает поток при выходе', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'runtime.mjs'), 'utf8');
  assert.match(source, /new window\.EventSource\("\/api\/events"\)/);
  assert.match(source, /addEventListener\("changed"/);
  assert.match(source, /eventAgain/, 'сигнал во время запроса — один повтор, а не очередь');
  assert.match(source, /if \(eventSource\) \{ eventSource\.close\(\); eventSource = null; \}/, 'при выходе поток закрывается');
  assert.match(source, /refreshTimer = setInterval/, 'таймер остался запасным путём');
});
