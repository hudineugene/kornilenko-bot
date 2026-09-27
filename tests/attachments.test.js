'use strict';

// Вложение прислал клиент, а открывает его панель на своём адресе. Страница
// text/html или SVG могла бы показать поддельную форму входа, поэтому встроенно
// отдаются только картинки, аудио и видео, остальное — скачиванием.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;

const PASSWORD = 'admin-password-77';
let base = '';
let headers = {};

// Telegram отдаёт файл в два шага: getFile, затем сам файл по ссылке.
global.fetch = (url, init) => {
  const address = String(url);
  if (address.startsWith('http://127.0.0.1')) return realFetch(url, init);
  if (address.includes('/file/bot')) {
    return Promise.resolve(new Response(Buffer.from('<html><body>поддельная форма</body></html>'), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
  }
  if (address.endsWith('/getFile')) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { file_path: 'documents/file_1.bin' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }
  return telegramStub(url, init);
};

function attachmentMessage(id, mimeType, fileName) {
  return {
    id, direction: 'in', kind: 'document', text: '', fileId: 'file-' + id, fileName,
    mimeType, telegramMessageId: 1, replyToTelegramMessageId: null, replyToText: '',
    deliveryStatus: '', clientRequestId: '', source: 'telegram', by: '', reactions: [], reactionUpdatedAt: '',
    createdAt: new Date().toISOString(),
  };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = false;
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.inquiries.push({
      id: 'inq-1', userId: '700001', chatId: '700001', language: 'ru', type: 'general', text: 'Смотрите файл',
      status: 'new', pipelineStage: 'new', replies: [],
      messages: [
        attachmentMessage('att-html', 'text/html', 'документ.html'),
        attachmentMessage('att-svg', 'image/svg+xml', 'картинка.svg'),
        attachmentMessage('att-photo', 'image/jpeg', 'фото.jpg'),
        attachmentMessage('att-video', 'video/mp4', 'видео.mp4'),
        attachmentMessage('att-pdf', 'application/pdf', 'договор.pdf'),
        attachmentMessage('att-unknown', '', 'без-типа'),
      ],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(),
    });
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const open = (id) => realFetch(base + '/api/conversation-media/' + id, { headers });

test('страница от клиента приходит скачиванием, а не открывается', async () => {
  const response = await open('att-html');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /^attachment/, 'браузер предложит сохранить файл');
  assert.equal(response.headers.get('content-type'), 'application/octet-stream', 'не text/html');
  assert.match(response.headers.get('content-security-policy'), /sandbox/, 'страница ничего не сможет сделать');
});

test('SVG тоже скачивается: в нём бывает сценарий', async () => {
  const response = await open('att-svg');
  assert.match(response.headers.get('content-disposition'), /^attachment/);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
});

test('фото и видео по-прежнему открываются в панели', async () => {
  const photo = await open('att-photo');
  assert.match(photo.headers.get('content-disposition'), /^inline/);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');

  const video = await open('att-video');
  assert.match(video.headers.get('content-disposition'), /^inline/);
  assert.equal(video.headers.get('content-type'), 'video/mp4');
});

test('остальное — скачиванием: договор в PDF и файл без типа', async () => {
  const pdf = await open('att-pdf');
  assert.match(pdf.headers.get('content-disposition'), /^attachment/);
  const unknown = await open('att-unknown');
  assert.match(unknown.headers.get('content-disposition'), /^attachment/);
  assert.equal(unknown.headers.get('content-type'), 'application/octet-stream');
});

test('имя файла сохраняется, а вложения без входа не отдаются', async () => {
  const response = await open('att-photo');
  assert.match(decodeURIComponent(response.headers.get('content-disposition')), /фото\.jpg/);
  const anonymous = await realFetch(base + '/api/conversation-media/att-photo');
  assert.equal(anonymous.status, 401, 'без входа вложение не открыть');
});
