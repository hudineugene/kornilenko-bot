'use strict';

// Откуда пришёл клиент: какая группа и какой раздел (панель и бот). Ссылка «Смотреть в боте» из поста несёт метку «g<номер
// группы>» или «g<номер>t<раздел>»; бот считает, сколько раз по ней открыли бота (в том числе знакомые клиенты), новому
// клиенту записывает метку источником, а панель, уведомления и отчёты показывают название группы и раздела.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, createChat, property, resetData, cleanup } = require('./helpers/chat');

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
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('source test')]).toString('base64');
let base = '';
let headers = {};

function group(id, title, extra = {}) {
  return { id, title, type: 'supergroup', username: '', status: 'administrator', rights: {}, isForum: false, topics: [], messages: [], joinRequests: [], ...extra };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    data.bot = { id: 5550001, username: 'kornilenko_bot', firstName: 'Bot' };
    data.objects = [property('source-object-1', 'Вилла для метки', 'active', { imagesByLanguage: { ru: [{ id: 's1', mimeType: 'image/png', dataBase64: PNG }], en: [], es: [] } })];
    data.groups = [
      group('-1001000000031', 'Канал застройщика', { type: 'channel', rights: { can_post_messages: true } }),
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
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const publish = (targets) => realFetch(base + '/api/objects/source-object-1/listing-publish', { method: 'POST', headers, body: JSON.stringify({ targets }) }).then((response) => response.json());
const buttonUrls = () => telegram.calls.filter((call) => ['sendPhoto', 'sendMessage'].includes(call.method)).map((call) => call.body.reply_markup && call.body.reply_markup.inline_keyboard && call.body.reply_markup.inline_keyboard[0][0].url).filter(Boolean);

test('ссылки из поста помнят группу и раздел: g1, g2t47; номер группы выдаётся один раз и не меняется', async () => {
  telegram.calls = [];
  const first = await publish([{ groupId: '-1001000000031' }, { groupId: '-1003934963994', threadId: 47 }, { groupId: '-1003934963994', threadId: 0 }]);
  assert.deepEqual(first.results.map((row) => row.ok), [true, true, true]);
  const urls = buttonUrls();
  assert.deepEqual(urls.map((url) => url.split('__src_')[1]), ['g1', 'g2t47', 'g2'], 'канал — g1; раздел 47 группы — g2t47; общий раздел той же группы — g2');
  const data = bot.getData();
  assert.equal(data.groups[0].sourceCode, '1');
  assert.equal(data.groups[1].sourceCode, '2');
  telegram.calls = [];
  await publish([{ groupId: '-1003934963994', threadId: 47 }]);
  assert.equal(buttonUrls()[0].split('__src_')[1], 'g2t47', 'повторная публикация — та же метка');
});

test('новичок по ссылке из группы получает метку источником; знакомый клиент источник не меняет, но переход считается', async () => {
  const data = bot.getData();
  const fresh = createChat({ firstName: 'Новичок' });
  await fresh.say('/start property_source-object-1__src_g2t47');
  assert.equal(fresh.user.source, 'g2t47');
  assert.equal(data.analytics.sourceOpens.g2t47, 1);

  const known = createChat({ firstName: 'Знакомая' });
  known.user.source = 'instagram';
  await known.say('/start property_source-object-1__src_g1');
  assert.equal(known.user.source, 'instagram', 'первый источник клиента остаётся');
  assert.equal(data.analytics.sourceOpens.g1, 1, 'но переход по ссылке из канала посчитан');
});

test('панель: строки «Откуда клиенты» — название группы и раздела, переходы; метка, по которой знакомые только открывали бота, — тоже строка', async () => {
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const byLabel = Object.fromEntries(state.sources.map((row) => [row.source, row]));
  assert.equal(byLabel.g2t47.title, 'Стройка без фильтров · Сегодня в продаже');
  assert.equal(byLabel.g2t47.opens, 1);
  assert.equal(byLabel.g2t47.users, 1);
  assert.equal(byLabel.g1.title, 'Канал застройщика');
  assert.equal(byLabel.g1.users, 0, 'новых клиентов нет — были только переходы');
  assert.equal(byLabel.g1.opens, 1);
  assert.equal(byLabel.instagram.title, '', 'обычная метка названия не получает');
  assert.ok(state.groups.every((item) => item.sourceCode), 'номера групп видны панели');
});

test('уведомление менеджеру: «📣 Стройка без фильтров · Сегодня в продаже», а не «g2t47»', async () => {
  const chat = createChat({ firstName: 'Клиент из группы' });
  await chat.say('/start property_source-object-1__src_g2t47');
  telegram.calls = [];
  await chat.say('Подскажите, квартира ещё свободна?');
  const toAdmin = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).map((call) => call.body.text).join('\n');
  assert.match(toAdmin, /📣 Стройка без фильтров · Сегодня в продаже/);
  assert.ok(!/g2t47/.test(toAdmin));
});

test('в сохранённых данных остаются номер группы и счётчик переходов; чужое отбрасывается', () => {
  const normalized = bot.normalizeLoadedData({
    version: 52,
    groups: [{ id: '-1001', title: 'Г', sourceCode: '7' }, { id: '-1002', title: 'Д', sourceCode: 'xx' }],
    analytics: { daily: {}, properties: {}, sourceOpens: { g7: 5, 'плохо': -3, '': 9 } },
  });
  assert.equal(normalized.groups[0].sourceCode, '7');
  assert.equal(normalized.groups[1].sourceCode, '');
  assert.equal(normalized.analytics.sourceOpens.g7, 5);
  assert.equal(normalized.analytics.sourceOpens['плохо'], 0);
  assert.ok(!('' in normalized.analytics.sourceOpens));
  assert.equal(bot.normalizeLoadedData({ version: 52 }).analytics.sourceOpens, undefined, 'пока открытий не было, поля нет — формат не меняется');
});
