'use strict';

// Автопубликация (по умолчанию выключена): новые объекты → отложенные посты в выбранные места; свежие посты → правка уже
// опубликованных на месте. Работает через те же функции, что и ручная публикация.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, property, resetData, settle, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
const replies = new Map();
global.fetch = (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  const method = String(url).split('/').pop();
  if (replies.has(method)) {
    const value = replies.get(method);
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: typeof value === 'function' ? value(init) : value }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return telegramStub(url, init);
};

const PASSWORD = 'admin-password-77';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('auto publish')]).toString('base64');
const photo = (id) => ({ ru: [{ id, mimeType: 'image/png', dataBase64: PNG + id }], en: [{ id: id + 'e', mimeType: 'image/png', dataBase64: PNG + id + 'e' }], es: [] });
let base = '';
let headers = {};

function group(id, title, extra = {}) {
  return { id, title, type: 'supergroup', username: '', status: 'administrator', rights: {}, isForum: false, topics: [], messages: [], joinRequests: [], ...extra };
}

function newObject(id, title, extra = {}) {
  return property(id, title, 'hidden', { priceValue: 250000, imagesByLanguage: photo(id.slice(-3)), reference: id.toUpperCase(), ...extra });
}

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.bot = { id: 5550001, username: 'kornilenko_bot', firstName: 'Bot' };
    data.groups = [
      group('-1001000000061', 'Канал застройщика', { type: 'channel', rights: { can_post_messages: true } }),
      group('-1003934963994', 'Стройка без фильтров', { isForum: true, topics: [{ id: 47, name: 'Сегодня в продаже', closed: false, manual: false, lastMessageAt: '' }] }),
    ];
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  replies.set('getChat', (init) => {
    const found = bot.getData().groups.find((item) => item.id === String(JSON.parse(init.body).chat_id));
    return { id: Number(found.id), type: found.type, title: found.title, is_forum: found.isForum };
  });
  replies.set('getChatMemberCount', 10);
  replies.set('getChatMember', (init) => {
    const found = bot.getData().groups.find((item) => item.id === String(JSON.parse(init.body).chat_id));
    return { status: found.status, ...found.rights };
  });
  if (!bot.server.listening) await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  if (bot.server.listening) await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const put = (body) => realFetch(base + '/api/auto-publish', { method: 'PUT', headers, body: JSON.stringify(body) });
const adminTexts = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).map((call) => call.body.text).join('\n---\n');
const goesLive = (record, before = null) => {
  bot.getData().objects.push(record);
  return bot.queuePropertyAlerts(record, before);
};

test('по умолчанию выключено: новый объект ничего не ставит в очередь, посты не правятся', () => {
  const record = newObject('auto-default-01', 'Объект без автопубликации');
  record.status = 'active';
  goesLive(record, null);
  assert.deepEqual(bot.getData().groupPosts, []);
  assert.equal(record.autoPublishedAt, undefined);
});

test('настройки: без места назначения включить нельзя; мусор в значениях заменяется безопасными; панель их видит', async () => {
  const refuse = await put({ newObjects: { enabled: true, targets: [] }, keepFresh: false });
  assert.equal(refuse.status, 400);
  assert.match((await refuse.json()).error, /хотя бы одну группу/);

  const response = await put({
    newObjects: { enabled: true, targets: [{ groupId: '-1001000000061', language: 'xx' }, { groupId: '-1003934963994', threadId: 47, language: 'es' }, { groupId: '-1009999999999' }], layout: 'weird', delayMinutes: 99999 },
    keepFresh: true,
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.autoPublish.newObjects.targets, [
    { groupId: '-1001000000061', threadId: 0, language: 'ru' },
    { groupId: '-1003934963994', threadId: 47, language: 'es' },
  ], 'несуществующая группа отброшена, чужой язык заменён');
  assert.equal(body.autoPublish.newObjects.layout, 'single');
  assert.equal(body.autoPublish.newObjects.delayMinutes, 1440, 'пауза не больше суток');
  assert.equal(body.autoPublish.keepFresh, true);
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  assert.equal(state.config.autoPublish.newObjects.enabled, true);
});

test('новый объект стал виден клиентам — отложенные посты в выбранные места (через 30 минут), один раз; админу сообщено', async () => {
  await put({ newObjects: { enabled: true, targets: [{ groupId: '-1001000000061', language: 'ru' }, { groupId: '-1003934963994', threadId: 47, language: 'en' }], delayMinutes: 30 } });
  const record = newObject('auto-new-object-01', 'Новая вилла');
  record.status = 'active';
  telegram.calls = [];
  const before = Date.now();
  goesLive(record, null);
  await settle();

  const queued = bot.getData().groupPosts.filter((item) => item.status === 'scheduled');
  assert.equal(queued.length, 2);
  assert.deepEqual(queued.map((item) => [item.groupId, item.threadId, item.listing.language, item.listing.layout]), [['-1001000000061', 0, 'ru', 'single'], ['-1003934963994', 47, 'en', 'single']]);
  const delay = Date.parse(queued[0].sendAt) - before;
  assert.ok(delay > 29 * 60e3 && delay < 31 * 60e3, 'через ~30 минут: ' + delay);
  assert.ok(record.autoPublishedAt, 'метка «уже публиковали автоматически»');
  assert.match(adminTexts(), /🚀 Новый объект «Новая вилла»: пост поставлен в очередь \(Канал застройщика, Стройка без фильтров · раздел 47\)/);
  assert.match(adminTexts(), /через 30 мин/);
  assert.equal(telegram.calls.filter((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method)).length, 0, 'сейчас в группы ничего не ушло');

  // Повторное сохранение не создаёт новых постов.
  const copy = { ...record };
  bot.queuePropertyAlerts(record, copy);
  assert.equal(bot.getData().groupPosts.filter((item) => item.status === 'scheduled').length, 2);

  // В своё время посты уходят обычной отправкой.
  telegram.calls = [];
  await bot.runDueGroupPosts(new Date(Date.now() + 31 * 60e3));
  const posts = telegram.calls.filter((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method));
  assert.equal(posts.length, 2);
  assert.equal(String(posts.find((call) => String(call.body.chat_id) === '-1003934963994').body.message_thread_id), '47');
});

test('черновик не публикуется; перевод из черновика в «Активен» — публикуется; недозаполненный язык и пропавшая группа — в «Не поставлено»', async () => {
  await put({ newObjects: { enabled: true, targets: [{ groupId: '-1001000000061', language: 'ru' }, { groupId: '-1003934963994', language: 'es' }], delayMinutes: 0 } });
  const draft = newObject('auto-draft-0001', 'Черновик', { title: { ru: 'Черновик', en: 'Draft', es: '' } });
  goesLive(draft, null);
  assert.deepEqual(bot.getData().groupPosts, [], 'скрытый объект клиенты не видят — публиковать нечего');

  const before = { ...draft };
  draft.status = 'active';
  telegram.calls = [];
  bot.queuePropertyAlerts(draft, before);
  await settle();
  const queued = bot.getData().groupPosts.filter((item) => item.status === 'scheduled');
  assert.equal(queued.length, 1, 'на испанском карточка не заполнена — в эту группу не поставлено');
  assert.match(adminTexts(), /Не поставлено: Стройка без фильтров — карточка не заполнена на языке ES/);
  assert.match(adminTexts(), /сейчас/);
});

test('свежие посты: после смены цены уже опубликованный пост правится на месте; без этого правила — нет', async () => {
  const record = newObject('auto-fresh-obj-01', 'Вилла для обновления');
  record.status = 'active';
  bot.getData().objects.push(record);
  const published = await (await realFetch(base + '/api/objects/auto-fresh-obj-01/listing-publish', { method: 'POST', headers, body: JSON.stringify({ targets: [{ groupId: '-1001000000061', language: 'ru' }] }) })).json();
  assert.equal(published.ok, true, JSON.stringify(published));

  // Правило выключено — ничего не происходит.
  let before = { ...record };
  record.priceValue = 230000;
  telegram.calls = [];
  bot.queuePropertyAlerts(record, before);
  await settle();
  assert.equal(telegram.calls.filter((call) => call.method.startsWith('edit')).length, 0);

  await put({ newObjects: { enabled: false, targets: [] }, keepFresh: true });
  before = { ...record };
  record.priceValue = 199000;
  telegram.calls = [];
  bot.queuePropertyAlerts(record, before);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const edits = telegram.calls.filter((call) => call.method === 'editMessageCaption');
  assert.equal(edits.length, 1);
  assert.match(edits[0].body.caption, /199\s000\s€/);
  assert.match(adminTexts(), /♻️ «Вилла для обновления»: обновил посты в группах — 1/);

  // Правки, которых в посте не видно (например, номер объекта), посты не трогают.
  before = { ...record };
  record.reference = 'ДРУГОЙ';
  telegram.calls = [];
  bot.queuePropertyAlerts(record, before);
  await settle();
  assert.equal(telegram.calls.filter((call) => call.method.startsWith('edit')).length, 0);

  // Проданный объект — пост с пометкой.
  before = { ...record };
  record.status = 'sold';
  telegram.calls = [];
  bot.queuePropertyAlerts(record, before);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(telegram.calls.find((call) => call.method === 'editMessageCaption').body.caption, /🔴 Продан/);
});

test('цена снижена: правило включено — в места публикации ставится НОВЫЙ отложенный пост с пометкой и зачёркнутой прежней ценой, не чаще раза в три дня; выключено или цена выросла — ничего', async () => {
  const record = newObject('auto-drop-obj-01', 'Вилла со скидкой');
  record.status = 'active';
  record.priceValue = 250000;
  bot.getData().objects.push(record);
  const published = await (await realFetch(base + '/api/objects/auto-drop-obj-01/listing-publish', { method: 'POST', headers, body: JSON.stringify({ targets: [{ groupId: '-1001000000061', language: 'ru' }] }) })).json();
  assert.equal(published.ok, true, JSON.stringify(published));

  // Правило выключено — снижение новых постов не создаёт.
  let before = { ...record };
  record.priceValue = 240000;
  bot.queuePropertyAlerts(record, before);
  await settle();
  assert.deepEqual(bot.getData().groupPosts, []);

  await put({ newObjects: { enabled: false, targets: [] }, keepFresh: false, priceDrop: true });
  // Цена выросла — не снижение.
  before = { ...record };
  record.priceValue = 245000;
  bot.queuePropertyAlerts(record, before);
  assert.deepEqual(bot.getData().groupPosts, [], 'рост цены поста не даёт');

  before = { ...record };
  record.priceValue = 199000;
  telegram.calls = [];
  const asked = Date.now();
  bot.queuePropertyAlerts(record, before);
  await settle();
  const queued = bot.getData().groupPosts.filter((item) => item.status === 'scheduled');
  assert.equal(queued.length, 1);
  assert.deepEqual([queued[0].groupId, queued[0].listing.language, queued[0].listing.layout, queued[0].listing.priceDrop], ['-1001000000061', 'ru', 'single', true]);
  const delay = Date.parse(queued[0].sendAt) - asked;
  assert.ok(delay > 14 * 60e3 && delay < 16 * 60e3, 'через ~15 минут: ' + delay);
  assert.match(adminTexts(), /🔻 Цена снижена — «Вилла со скидкой»: новый пост поставлен в очередь \(Канал застройщика\)/);

  // Ещё одно снижение сразу после первого — второго поста нет.
  before = { ...record };
  record.priceValue = 190000;
  bot.queuePropertyAlerts(record, before);
  assert.equal(bot.getData().groupPosts.filter((item) => item.status === 'scheduled').length, 1);

  // В своё время пост уходит обычной отправкой: пометка сверху, прежняя цена зачёркнута.
  telegram.calls = [];
  await bot.runDueGroupPosts(new Date(Date.now() + 16 * 60e3));
  const sent = telegram.calls.find((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method));
  assert.ok(sent, 'пост ушёл в группу');
  const caption = sent.body.caption || (Array.isArray(sent.body.media) ? sent.body.media[0].caption : '');
  assert.match(caption, /^🔻 <b>Цена снижена<\/b>\n🏡/, 'пометка первой строкой');
  assert.match(caption, /<s>[^<]*199\s000[^<]*<\/s>/, 'зачёркнута цена перед последним снижением');
});

test('панель: «🚀 Автопубликация» на экране «Каналы и группы», окно с местами, паузой, видом поста и правилом свежих постов', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const catalog = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-catalog.mjs'), 'utf8');
  const reach = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-reach.mjs'), 'utf8');
  assert.match(reach, /pageAction\("🚀 Автопубликация", openAutoPublish/);
  assert.match(catalog, /function openAutoPublish/);
  assert.match(catalog, /\/api\/auto-publish/);
  assert.match(catalog, /id="apDelay"/);
  assert.match(catalog, /id="apFresh"/);
  assert.match(catalog, /!\(state\.config && state\.config\.autoPublish && state\.config\.autoPublish\.keepFresh\)/, 'когда бот обновляет посты сам, предложение «обновить» не нужно');
});
