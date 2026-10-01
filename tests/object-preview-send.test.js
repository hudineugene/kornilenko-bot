'use strict';

// «Прислать мне в Telegram»: карточка объекта владельцу — как её увидит клиент (этап взаимодействия панели и бота).
// Карточка и «Подробнее» собираются теми же функциями, что у клиента; ничего не меняется: ни клиент, ни счётчики показов;
// кнопки с действиями неактивны.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, property, resetData, adminPress, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'admin-password-77';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('preview send')]).toString('base64');
let base = '';
let headers = {};

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    data.bot = { id: 5550001, username: 'kornilenko_bot', firstName: 'Bot' };
    data.objects = [property('preview-object-01', 'Вилла для проверки', 'active', {
      priceValue: 321000,
      imagesByLanguage: { ru: [{ id: 'p1', mimeType: 'image/png', dataBase64: PNG }], en: [], es: [] },
    })];
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
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const send = (id, body) => realFetch(base + '/api/objects/' + id + '/preview-send', { method: 'POST', headers, body: JSON.stringify(body) });

test('владельцу приходит карточка с фото, подписью и кнопками, затем «Подробнее» — на выбранном языке', async () => {
  telegram.calls = [];
  const response = await send('preview-object-01', { language: 'ru' });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const calls = telegram.calls.filter((call) => ['sendPhoto', 'sendMessage'].includes(call.method) && String(call.body.chat_id) === ADMIN_CHAT);
  assert.deepEqual(calls.map((call) => call.method), ['sendPhoto', 'sendMessage']);
  assert.match(calls[0].body.caption, /<b>Вилла для проверки<\/b>/);
  assert.match(calls[0].body.caption, /321\s000\s€/);
  const buttons = calls[0].body.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.length >= 3, 'кнопки карточки на месте');
  assert.ok(buttons.every((button) => button.url || button.callback_data === 'preview:demo'), 'кнопки с действиями неактивны');
  assert.match(calls[1].body.text, /^<i>Подробнее<\/i>\n\n/);
  assert.match(calls[1].body.text, /Характеристики/);

  telegram.calls = [];
  await send('preview-object-01', { language: 'es' });
  const es = telegram.calls.find((call) => call.method === 'sendPhoto');
  assert.match(es.body.caption, /Vendo|Venta|desde|€/, 'карточка на испанском');
});

test('ничего не меняется: клиент не заводится, показы не считаются; нажатие на кнопку примера отвечает «это пример»', async () => {
  const data = bot.getData();
  const usersBefore = Object.keys(data.users).length;
  const impressions = () => (data.analytics.properties['preview-object-01'] || {}).impressions || 0;
  const before = impressions();
  await send('preview-object-01', { language: 'ru' });
  assert.equal(Object.keys(data.users).length, usersBefore, 'клиент не заведён');
  assert.equal(impressions(), before, 'показ не посчитан');
  assert.equal(data.inquiries.length, 0);

  telegram.calls = [];
  await adminPress('preview:demo');
  const answer = telegram.calls.find((call) => call.method === 'answerCallbackQuery');
  assert.match(answer.body.text, /пример карточки/);
  assert.equal(Object.keys(data.users).length, usersBefore, 'и нажатие клиента не заводит');
  assert.equal(data.inquiries.length, 0, 'заявки от самого себя нет');
});

test('нет объекта или чата администратора — понятный отказ', async () => {
  assert.equal((await send('no-such-object', { language: 'ru' })).status, 404);
  const data = bot.getData();
  const saved = data.config.adminChatId;
  data.config.adminChatId = '';
  try {
    const response = await send('preview-object-01', { language: 'ru' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Настройки → Команда/);
  } finally {
    data.config.adminChatId = saved;
  }
});

test('панель: «Прислать мне в Telegram» — в окне «Ещё действия» (три языка) и под предпросмотром в редакторе', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-catalog.mjs'), 'utf8');
  assert.match(source, /data-preview-send=/);
  assert.match(source, /\/preview-send/);
  assert.match(source, /id="recordPreviewSend"/);
});
