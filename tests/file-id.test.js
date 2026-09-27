'use strict';

// Фотографию бот отправляет по сохранённому file_id: файл уже лежит в Telegram,
// и грузить его заново не нужно. Раньше любая неудача на этом пути стирала
// идентификатор — даже когда дело было вовсе не в файле (клиент заблокировал
// бота, не было связи). После первого же такого клиента рассылка начинала
// грузить одну и ту же фотографию заново каждому получателю.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, resetData, cleanup } = require('./helpers/chat');

let sendPhotoMessage;
test.before(async () => {
  ({ sendPhotoMessage } = await import('../src/telegram.mjs'));
});

const TOKEN = '12345:ABCDEFGHIJKLMNOPQRSTUV';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('file id test')]).toString('base64');
const telegramStub = global.fetch;

function image() {
  return { id: 'img-1', mimeType: 'image/png', dataBase64: PNG, telegramFileId: 'stored-file-id' };
}

// Загрузка файла идёт multipart: в заглушке у такого запроса поле photo не
// строка, поэтому в записанном вызове его нет вовсе.
const uploads = () => telegram.calls.filter((call) => call.method === 'sendPhoto' && call.body.photo === undefined);
const byFileId = () => telegram.calls.filter((call) => call.method === 'sendPhoto' && typeof call.body.photo === 'string');

function failSendWith(status, description) {
  global.fetch = (url, init) => {
    if (String(url).endsWith('/sendPhoto') && init && typeof init.body === 'string' && JSON.parse(init.body).photo) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: status, description }), {
        status,
        headers: { 'content-type': 'application/json' },
      }));
    }
    return telegramStub(url, init);
  };
}

test.beforeEach(() => {
  resetData((data) => { data.config.active = true; });
  telegram.calls = [];
  global.fetch = telegramStub;
});
test.after(() => {
  global.fetch = telegramStub;
  cleanup();
});

test('клиент заблокировал бота — сохранённый file_id остаётся', async () => {
  const photo = image();
  failSendWith(403, 'Forbidden: bot was blocked by the user');
  await assert.rejects(() => sendPhotoMessage(700100, photo, 'Подпись', TOKEN));
  assert.equal(photo.telegramFileId, 'stored-file-id', 'идентификатор не стёрт');
  assert.equal(uploads().length, 0, 'файл заблокировавшему не грузим — это впустую');
});

test('нет связи — file_id тоже остаётся', async () => {
  const photo = image();
  global.fetch = (url, init) => {
    if (String(url).endsWith('/sendPhoto')) return Promise.reject(new TypeError('fetch failed'));
    return telegramStub(url, init);
  };
  await assert.rejects(() => sendPhotoMessage(700101, photo, '', TOKEN));
  assert.equal(photo.telegramFileId, 'stored-file-id');
  assert.equal(uploads().length, 0);
});

test('устаревший file_id забывается, и фотография грузится заново', async () => {
  const photo = image();
  failSendWith(400, 'Bad Request: wrong file identifier/HTTP URL specified');
  const result = await sendPhotoMessage(700102, photo, 'Подпись', TOKEN);
  assert.ok(result && result.message_id, 'сообщение всё-таки отправлено');
  assert.equal(uploads().length, 1, 'файл загружен заново');
  assert.ok(photo.telegramFileId && photo.telegramFileId !== 'stored-file-id', 'запомнен новый идентификатор');
});

test('обычная отправка по file_id ничего не грузит', async () => {
  const photo = image();
  await sendPhotoMessage(700103, photo, 'Подпись', TOKEN);
  assert.equal(byFileId().length, 1);
  assert.equal(uploads().length, 0);
  assert.equal(photo.telegramFileId, 'stored-file-id');
});

test('признак «ошибка про сам файл» различает причины', async () => {
  const { staleFileIdError } = await import('../src/telegram.mjs');
  assert.equal(staleFileIdError({ telegramCode: 400, message: 'Bad Request: wrong file identifier/HTTP URL specified' }), true);
  assert.equal(staleFileIdError({ telegramCode: 400, message: 'Bad Request: failed to get HTTP URL content' }), false, 'про файл ничего не сказано');
  assert.equal(staleFileIdError({ telegramCode: 403, message: 'Forbidden: bot was blocked by the user' }), false);
  assert.equal(staleFileIdError({ telegramCode: 429, message: 'Too Many Requests: retry after 5' }), false);
  assert.equal(staleFileIdError({ message: 'fetch failed' }), false);
});
