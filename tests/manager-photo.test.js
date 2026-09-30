'use strict';

// Лицо агента в «Связаться»: покупателю из-за границы важно увидеть, с кем он
// говорит. Владелец загружает фото менеджера в «Тексты бота → Контакты»; клиент
// видит его с именем над экраном связи. Фото — картинка в настройках, а не в
// коллекции: её нельзя терять при сохранении контактов, при уборке файлов и
// при восстановлении копии.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, createChat, callbacksOf, resetData, cleanup } = require('./helpers/chat');
const { menu: MENU } = bot.text;

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('manager face')]);
const DATA_URL = 'data:image/png;base64,' + PNG.toString('base64');
const PASSWORD = 'photo-test-password';
let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

async function login() {
  const data = bot.getData();
  const password = bot.hashPassword(PASSWORD);
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
}

const putContacts = (body) => realFetch(base + '/api/contacts', { method: 'PUT', headers, body: JSON.stringify({ managerName: 'Ольга Корниленко', phone: '+34 600 111 222', ...body }) });

test.beforeEach(() => resetData((data) => { data.config.active = true; }));

test.describe('в панели', () => {
  test('фото загружается, отдаётся панели и не показывает внутренностей в состоянии', async () => {
    await login();
    assert.equal((await putContacts({ photo: { dataUrl: DATA_URL, name: 'olga.png' } })).status, 200);
    assert.ok(bot.getData().contacts.photo, 'фото сохранено');

    const image = await realFetch(base + '/api/images/contacts/photo', { headers });
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG, 'панель получает те же байты');

    const state = await (await realFetch(base + '/api/state', { headers })).json();
    assert.equal(state.contacts.photo.exists, true);
    assert.equal(state.contacts.photo.name, 'olga.png');
    assert.ok(!('dataBase64' in state.contacts.photo) && !('storageFile' in state.contacts.photo), 'в состояние попадает описание, а не содержимое и не путь к файлу');
  });

  test('сохранение контактов без нового фото фото не стирает; «убрать» — убирает', async () => {
    await login();
    await putContacts({ photo: { dataUrl: DATA_URL, name: 'olga.png' } });
    const before = bot.getData().contacts.photo.id;
    assert.equal((await putContacts({ managerName: 'Другое имя' })).status, 200);
    assert.equal(bot.getData().contacts.photo.id, before, 'фото осталось прежним');
    assert.equal(bot.getData().contacts.managerName, 'Другое имя');

    assert.equal((await putContacts({ photo: { remove: true } })).status, 200);
    assert.equal(bot.getData().contacts.photo, null);
    assert.equal((await realFetch(base + '/api/images/contacts/photo', { headers })).status, 404, 'после удаления отдавать нечего');
  });

  test('не картинка и подделка формата отклоняются, прежнее фото остаётся', async () => {
    await login();
    await putContacts({ photo: { dataUrl: DATA_URL, name: 'olga.png' } });
    const before = bot.getData().contacts.photo.id;
    const notImage = await putContacts({ photo: { dataUrl: 'data:text/html;base64,PGI+PC9iPg==', name: 'x.html' } });
    assert.equal(notImage.status, 400);
    const fake = await putContacts({ photo: { dataUrl: 'data:image/png;base64,' + Buffer.from('это не картинка').toString('base64'), name: 'x.png' } });
    assert.equal(fake.status, 400);
    assert.equal(bot.getData().contacts.photo.id, before);
  });

  test('без входа фото не отдаётся', async () => {
    await login();
    await putContacts({ photo: { dataUrl: DATA_URL, name: 'olga.png' } });
    assert.equal((await realFetch(base + '/api/images/contacts/photo')).status, 401);
  });
});

test('уборка ничейных файлов и восстановление копии учитывают фото менеджера', async () => {
  const media = await import('../src/media.mjs');
  const referenced = media.referencedImageFiles({ contacts: { photo: { storageFile: 'manager.jpg' } } });
  assert.ok(referenced.has('manager.jpg'), 'файл фото считается используемым: иначе его удалила бы уборка');

  // Копия без файлов фото: ссылка убирается, остальное восстанавливается.
  const root = { contacts: { managerName: 'Ольга', photo: { id: 'p', storageFile: 'gone.jpg', mimeType: 'image/jpeg' } } };
  const missing = media.dropMissingImages(root);
  assert.equal(missing, 1);
  assert.equal(root.contacts.photo, null);
  assert.equal(root.contacts.managerName, 'Ольга');
});

test.describe('у клиента', () => {
  function withPhoto(name = 'Ольга Корниленко') {
    const data = bot.getData();
    data.contacts.managerName = name;
    data.contacts.phone = '+34 600 111 222';
    data.contacts.photo = { id: 'mgr', mimeType: 'image/png', name: 'olga.png', size: PNG.length, dataBase64: PNG.toString('base64'), updatedAt: new Date().toISOString() };
  }

  test('над экраном связи стоит фото с именем, а имя в тексте не повторяется', async () => {
    withPhoto();
    const chat = createChat();
    telegram.calls = [];
    const screen = await chat.say(MENU.ru.contacts);
    const photo = telegram.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(photo, 'фото ушло');
    assert.equal(photo.body.caption, '👨‍💼 Ольга Корниленко');
    const order = telegram.calls.map((call) => call.method).filter((method) => ['sendPhoto', 'sendMessage'].includes(method));
    assert.deepEqual(order, ['sendPhoto', 'sendMessage'], 'фото — раньше текста');
    assert.ok(!screen.last.text.includes('Ольга Корниленко'), 'имя стоит под фото, в тексте его нет');
    assert.match(screen.last.text, /\+34 600 11 12 22/, 'телефон на месте, в едином виде');
    assert.ok(callbacksOf(screen.last.markup).includes('contact:lead'), 'кнопки экрана те же');
    assert.equal(chat.user.uiMessageIds.length, 2, 'бот помнит оба сообщения, чтобы убрать вместе');
  });

  test('фото убирается вместе с экраном и не копится при повторном открытии', async () => {
    withPhoto();
    const chat = createChat();
    await chat.say(MENU.ru.contacts);
    const first = chat.user.uiMessageIds.slice();
    telegram.calls = [];
    await chat.say(MENU.ru.contacts);
    const deleted = telegram.calls.filter((call) => call.method === 'deleteMessage').map((call) => Number(call.body.message_id));
    for (const id of first) assert.ok(deleted.includes(id), 'прежнее сообщение ' + id + ' удалено');
    assert.equal(chat.user.uiMessageIds.length, 2);
    const shown = chat.user.uiMessageIds.slice();
    telegram.calls = [];
    await chat.press('nav:menu');
    const gone = telegram.calls.filter((call) => call.method === 'deleteMessage').map((call) => Number(call.body.message_id));
    for (const id of shown) assert.ok(gone.includes(id), 'при возврате в меню сообщение ' + id + ' убрано');
  });

  test('без фото экран прежний: имя строкой в тексте, лишних сообщений нет', async () => {
    const data = bot.getData();
    data.contacts.managerName = 'Ольга Корниленко';
    const chat = createChat();
    telegram.calls = [];
    const screen = await chat.say(MENU.ru.contacts);
    assert.ok(!telegram.calls.some((call) => call.method === 'sendPhoto'));
    assert.match(screen.last.text, /Ольга Корниленко/);
    assert.equal(chat.user.uiMessageIds.length, 1);
  });

  test('Telegram не принял фото — экран связи всё равно показан, с именем в тексте', async () => {
    withPhoto();
    const chat = createChat();
    const original = global.fetch;
    global.fetch = (url, init) => (String(url).endsWith('sendPhoto')
      ? Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: wrong file' }), { status: 400, headers: { 'content-type': 'application/json' } }))
      : original(url, init));
    try {
      const screen = await chat.say(MENU.ru.contacts);
      assert.match(screen.last.text, /Ольга Корниленко/, 'без фото имя вернулось в текст');
      assert.ok(callbacksOf(screen.last.markup).includes('contact:lead'));
      assert.equal(chat.user.uiMessageIds.length, 1);
    } finally {
      global.fetch = original;
    }
  });
});
