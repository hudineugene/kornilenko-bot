'use strict';

// Фотографии для каталога бот скачивает по ссылкам из выгрузки — то есть по
// адресам, которые пишет чужая сторона. Раньше проверялся только адрес из
// файла: ссылка на обычный сайт могла перенаправить бота на 127.0.0.1 или в
// домашнюю сеть, а обычное имя — указывать на внутренний адрес.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, resetData, cleanup } = require('./helpers/chat');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('feed photo bytes')]);
let downloadImage = null;
let privateIp = null;

// Имена «разрешаем» сами: тесту не нужна ни сеть, ни настоящий DNS.
const lookupAs = (address) => async () => [{ address, family: address.includes(':') ? 6 : 4 }];
const outside = lookupAs('93.184.216.34');

function photoAnswer() {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => PNG,
  };
}

function redirectTo(location) {
  return {
    ok: false,
    status: 302,
    headers: { get: (name) => (name === 'location' ? location : null) },
    arrayBuffer: async () => Buffer.alloc(0),
  };
}

test.before(async () => {
  ({ downloadImage, privateIp } = await import('../src/feed-import.mjs'));
});
test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('обычная ссылка скачивается', async () => {
  const image = await downloadImage('https://img.example.com/a.png', async () => photoAnswer(), outside);
  assert.equal(image.mimeType, 'image/png');
  assert.ok(image.dataBase64 || image.storageFile, 'фотография получена');
});

test('перенаправление во внутреннюю сеть не проходит', async () => {
  const visited = [];
  const fetcher = async (address) => {
    visited.push(address);
    return address.includes('img.example.com') ? redirectTo('http://127.0.0.1:3000/api/state') : photoAnswer();
  };
  await assert.rejects(
    () => downloadImage('https://img.example.com/a.png', fetcher, outside),
    /адрес фото недоступен/,
  );
  assert.deepEqual(visited, ['https://img.example.com/a.png'], 'по внутреннему адресу бот не пошёл');
});

test('перенаправление на другой внешний адрес — можно', async () => {
  const fetcher = async (address) => (address.includes('start') ? redirectTo('https://cdn.example.net/photo.png') : photoAnswer());
  const image = await downloadImage('https://img.example.com/start.png', fetcher, outside);
  assert.equal(image.mimeType, 'image/png');
});

test('бесконечная карусель перенаправлений обрывается', async () => {
  let hops = 0;
  const fetcher = async () => {
    hops += 1;
    return redirectTo('https://img.example.com/next-' + hops + '.png');
  };
  await assert.rejects(
    () => downloadImage('https://img.example.com/a.png', fetcher, outside),
    /слишком много перенаправлений/,
  );
  assert.ok(hops <= 6, 'бот сделал не больше шести шагов, сделал ' + hops);
});

test('имя, которое указывает на домашний адрес, отклоняется', async () => {
  await assert.rejects(
    () => downloadImage('https://photos.example.com/a.png', async () => photoAnswer(), lookupAs('192.168.1.10')),
    /внутреннюю сеть/,
  );
});

test('если имя не разрешается, загрузка идёт как обычно', async () => {
  const failing = async () => { throw new Error('ENOTFOUND'); };
  const image = await downloadImage('https://img.example.com/a.png', async () => photoAnswer(), failing);
  assert.equal(image.mimeType, 'image/png', 'проверка не мешает работе, когда DNS молчит');
});

test('адреса внутренней сети распознаются во всех видах', () => {
  for (const address of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(privateIp(address), true, address + ' должен считаться внутренним');
  }
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2a02:26f0::1']) {
    assert.equal(privateIp(address), false, address + ' — обычный внешний адрес');
  }
});

test('числовая запись домашнего адреса тоже не проходит', () => {
  // http://2130706433/ — это 127.0.0.1 числом.
  assert.equal(bot.publicAddress('http://2130706433/a.jpg'), false);
  assert.equal(bot.publicAddress('http://0177.0.0.1/a.jpg'), false);
  assert.equal(bot.publicAddress('http://[::ffff:127.0.0.1]/a.jpg'), false);
  assert.equal(bot.publicAddress('http://router.local/a.jpg'), false);
  assert.equal(bot.publicAddress('https://img.example.com/a.jpg'), true);
});
