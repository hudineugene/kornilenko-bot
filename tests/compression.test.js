'use strict';

// Сжатие ответов панели: страница (~500 КБ) и крупные ответы бота отдаются gzip,
// если браузер его принимает. Это важно при работе через интернет-доступ: страница
// уходит в четыре раза меньше. Токен защиты (csrf) вместе с текстами клиентов не
// сжимается: сжатие вместе с чужим текстом позволяет угадывать секрет по размеру
// ответа (BREACH). Панель токен помнит и без него в сжатом ответе.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');

let port = 0;
let cookie = '';
let csrf = '';

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  port = bot.server.address().port;
});
test.after(cleanup);

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    for (let index = 1; index <= 120; index += 1) {
      data.users['u' + index] = { id: 'u' + index, chatId: 1000 + index, firstName: 'Клиент ' + index, lastName: 'Иванов', note: 'Заметка о клиенте номер ' + index, activity: [], lastSeenAt: new Date().toISOString() };
    }
    const password = bot.hashPassword('gzip-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const response = await realFetch('http://127.0.0.1:' + port + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'gzip-password' }) });
  cookie = response.headers.get('set-cookie').split(';')[0];
  csrf = (await response.json()).csrf;
});

// Сырой запрос: fetch сам распаковывает и прячет заголовки.
function raw(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { cookie, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test.describe('страница панели', () => {
  test('gzip, если браузер его принимает; содержимое то же, размер — в разы меньше', async () => {
    const plain = await raw('/', { 'accept-encoding': 'identity' });
    const zipped = await raw('/', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(plain.status, 200);
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.match(String(zipped.headers.vary), /accept-encoding/i, 'кэши различают сжатый и обычный ответ');
    assert.equal(zlib.gunzipSync(zipped.body).toString('utf8'), plain.body.toString('utf8'), 'после распаковки — та же страница');
    assert.ok(zipped.body.length * 3 < plain.body.length, 'сжатая заметно меньше: ' + zipped.body.length + ' против ' + plain.body.length);
    assert.equal(Number(zipped.headers['content-length']), zipped.body.length);
    assert.ok(!plain.headers['content-encoding'], 'без поддержки gzip — обычный ответ');
  });

  test('«не изменилось» (304) работает и для сжатой версии', async () => {
    const first = await raw('/', { 'accept-encoding': 'gzip' });
    const again = await raw('/', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    const plain = await raw('/', { 'accept-encoding': 'identity' });
    assert.notEqual(plain.headers.etag, first.headers.etag, 'у сжатой и обычной версий разные отпечатки');
    const crossed = await raw('/', { 'accept-encoding': 'identity', 'if-none-match': first.headers.etag });
    assert.equal(crossed.status, 200, 'отпечаток сжатой версии не подтверждает обычную');
  });
});

test.describe('ответы бота', () => {
  test('крупный ответ сжимается; токен защиты в сжатый ответ не попадает', async () => {
    const plain = await raw('/api/state', { 'accept-encoding': 'identity' });
    const zipped = await raw('/api/state', { 'accept-encoding': 'gzip' });
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    const plainJson = JSON.parse(plain.body.toString('utf8'));
    const zippedJson = JSON.parse(zlib.gunzipSync(zipped.body).toString('utf8'));
    assert.equal(plainJson.csrf, csrf, 'обычный ответ токен содержит');
    assert.equal(zippedJson.csrf, '', 'сжатый — нет: сжатие вместе с чужим текстом выдаёт секрет по размеру');
    assert.equal(zippedJson.users.length, plainJson.users.length, 'остальное — то же');
    assert.ok(zipped.body.length * 4 < plain.body.length, 'выигрыш заметный');
    assert.ok(!zlib.gunzipSync(zipped.body).toString('utf8').includes(csrf), 'токена в тексте нет');
  });

  test('короткие ответы не сжимаются: смысла нет', async () => {
    const answer = await raw('/api/status', { 'accept-encoding': 'gzip' });
    assert.equal(answer.status, 200);
    assert.ok(!answer.headers['content-encoding']);
  });

  test('без gzip в запросе — обычный ответ с токеном', async () => {
    const plain = await raw('/api/state', {});
    assert.ok(!plain.headers['content-encoding']);
    assert.equal(JSON.parse(plain.body.toString('utf8')).csrf, csrf);
  });
});

test.describe('токен защиты отдельно', () => {
  test('его отдаёт короткий запрос — с ним панель, открытая заново, может сохранять', async () => {
    const answer = await raw('/api/csrf', { 'accept-encoding': 'gzip' });
    assert.equal(answer.status, 200);
    assert.ok(!answer.headers['content-encoding'], 'короткий ответ не сжимается');
    assert.equal(JSON.parse(answer.body.toString('utf8')).csrf, csrf);
    const withToken = await realFetch('http://127.0.0.1:' + port + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': JSON.parse(answer.body.toString('utf8')).csrf }, body: '{}' });
    assert.equal(withToken.status, 200, 'запись с этим токеном проходит');
    const withoutToken = await realFetch('http://127.0.0.1:' + port + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
    assert.equal(withoutToken.status, 403, 'а без токена — нет');
  });

  test('без входа токен не выдаётся', async () => {
    const response = await realFetch('http://127.0.0.1:' + port + '/api/csrf');
    assert.equal(response.status, 401);
  });
});
