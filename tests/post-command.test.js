'use strict';

// /post: публикация объекта в группы из Telegram (чат владельца). Диалог одним сообщением: объект → куда (группы и разделы
// флажками, язык, вид) → «Опубликовать» → итог со ссылками. Публикует тот же код, что и панель. Только владелец.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, ADMIN_CHAT, property, resetData, settle, cleanup } = require('./helpers/chat');

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

const MANAGER = '8880001';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('post command')]).toString('base64');
const photo = (id) => ({ ru: [{ id, mimeType: 'image/png', dataBase64: PNG + id }], en: [], es: [] });

function group(id, title, extra = {}) {
  return { id, title, type: 'supergroup', username: '', status: 'administrator', rights: {}, isForum: false, topics: [], messages: [], joinRequests: [], ...extra };
}

test.beforeEach(() => {
  resetData((data) => {
    data.config.active = true;
    data.config.managers = [{ id: 'm1', name: 'Мария', chatId: MANAGER, verifiedAt: '' }];
    data.bot = { id: 5550001, username: 'kornilenko_bot', firstName: 'Bot' };
    data.objects = [
      property('post-object-001', 'Первая вилла', 'active', { priceValue: 400000, imagesByLanguage: photo('a') }),
      property('post-object-002', 'Вторая квартира', 'reserved', { priceValue: 150000, imagesByLanguage: photo('b') }),
      property('post-object-003', 'Скрытый дом', 'hidden', { priceValue: 90000, imagesByLanguage: photo('c') }),
    ];
    data.groups = [
      group('-1001000000051', 'Канал застройщика', { type: 'channel', username: 'kornilenko1', rights: { can_post_messages: true } }),
      group('-1003934963994', 'Стройка без фильтров', { isForum: true, listingLanguage: 'en', topics: [{ id: 47, name: 'Сегодня в продаже', closed: false, manual: false, lastMessageAt: '' }] }),
      group('-1001000000053', 'Чужая группа', { status: 'member' }),
    ];
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
});
test.after(cleanup);

let counter = 700;
async function says(chatId, text) {
  const before = telegram.calls.length;
  counter += 1;
  const chat = { id: Number(chatId), type: 'private' };
  await bot.processUpdates([{ update_id: 970000 + counter, message: { message_id: counter, date: Math.floor(Date.now() / 1000), from: { id: Number(chatId), first_name: 'Staff', language_code: 'ru' }, chat, text } }], TOKEN);
  await settle();
  return telegram.calls.slice(before);
}
async function presses(chatId, data, messageId) {
  const before = telegram.calls.length;
  counter += 1;
  await bot.processUpdates([{ update_id: 980000 + counter, callback_query: { id: 'p' + counter, from: { id: Number(chatId), first_name: 'Staff' }, data, message: { message_id: messageId, chat: { id: Number(chatId), type: 'private' }, date: 1 } } }], TOKEN);
  await settle();
  return telegram.calls.slice(before);
}
const buttons = (markup) => markup.inline_keyboard.flat();
const lastEdit = (calls) => calls.filter((call) => call.method === 'editMessageText').pop().body;

test('/post: список объектов, которые видят клиенты (скрытый — нет); нажатие открывает экран «куда»', async () => {
  const calls = await says(ADMIN_CHAT, '/post');
  const screen = calls.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).body;
  assert.match(screen.text, /Какой объект публикуем/);
  const labels = buttons(screen.reply_markup).map((button) => button.text);
  assert.ok(labels.some((text) => /Первая вилла · .*400/.test(text)));
  assert.ok(labels.some((text) => /Вторая квартира/.test(text)), 'забронированный — виден клиентам');
  assert.ok(!labels.some((text) => /Скрытый дом/.test(text)), 'скрытый не предлагается');

  const next = await presses(ADMIN_CHAT, 'post:s:post-object-001', 900);
  const targets = lastEdit(next);
  assert.match(targets.text, /Первая вилла/);
  const rows = buttons(targets.reply_markup).map((button) => button.text);
  assert.deepEqual(rows.filter((text) => /^☐/.test(text)), ['☐ Канал застройщика', '☐ Стройка без фильтров · Общий раздел', '☐ Стройка без фильтров · Сегодня в продаже'], 'канал, общий раздел и раздел группы с темами; группа без прав не показана');
});

test('экран «куда»: флажки, язык и вид переключаются на месте; «Опубликовать» без выбора — подсказка', async () => {
  await says(ADMIN_CHAT, '/post');
  await presses(ADMIN_CHAT, 'post:s:post-object-001', 900);
  let step = await presses(ADMIN_CHAT, 'post:t:0', 900);
  assert.ok(buttons(lastEdit(step).reply_markup).some((button) => button.text === '☑ Канал застройщика'));
  assert.match(lastEdit(step).text, /выбрано: 1/);
  step = await presses(ADMIN_CHAT, 'post:t:0', 900);
  assert.match(lastEdit(step).text, /выбрано: 0/, 'второе нажатие снимает отметку');

  step = await presses(ADMIN_CHAT, 'post:l:es', 900);
  assert.ok(buttons(lastEdit(step).reply_markup).some((button) => button.text === '✓ ES'));
  step = await presses(ADMIN_CHAT, 'post:v:split', 900);
  assert.ok(buttons(lastEdit(step).reply_markup).some((button) => button.text === '✓ Фото + текст'));

  const none = await presses(ADMIN_CHAT, 'post:go', 900);
  assert.match(none.find((call) => call.method === 'answerCallbackQuery').body.text, /Сначала отметьте/);
  assert.equal(none.filter((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method)).length, 0);
});

test('«Опубликовать»: посты уходят в выбранные места, в раздел — с номером; язык «как в группе» берётся у каждой группы; итог со ссылками', async () => {
  await says(ADMIN_CHAT, '/post');
  await presses(ADMIN_CHAT, 'post:s:post-object-001', 900);
  await presses(ADMIN_CHAT, 'post:t:0', 900);
  await presses(ADMIN_CHAT, 'post:t:2', 900);
  telegram.calls = [];
  const done = await presses(ADMIN_CHAT, 'post:go', 900);
  const posts = telegram.calls.filter((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method));
  assert.equal(posts.length, 2, 'по посту в канал и в раздел');
  const channel = posts.find((call) => String(call.body.chat_id) === '-1001000000051');
  const topic = posts.find((call) => String(call.body.chat_id) === '-1003934963994');
  assert.match(String(channel.body.caption || JSON.stringify(channel.body)), /Первая вилла/);
  assert.equal(String(topic.body.message_thread_id), '47');
  assert.match(String(topic.body.caption), /For sale/, 'в группе, где последний язык английский, пост английский');
  const summary = lastEdit(done).text;
  assert.match(summary, /^✅ Опубликовано: 2 из 2/);
  assert.match(summary, /✓ Канал застройщика — https:\/\/t\.me\/kornilenko1\/\d+/);
  assert.match(summary, /✓ Стройка без фильтров — https:\/\/t\.me\/c\/3934963994\/47\/\d+/);
  const record = bot.getData().objects[0];
  assert.equal(record.publications.length, 2, 'как и из панели, на объекте записаны публикации');

  // Повторное нажатие на старый экран — «устарело», ничего не уходит.
  telegram.calls = [];
  const again = await presses(ADMIN_CHAT, 'post:go', 900);
  assert.match(again.find((call) => call.method === 'answerCallbackQuery').body.text, /устарел/);
  assert.equal(telegram.calls.filter((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method)).length, 0);
});

test('менеджер публиковать не может: ни команда, ни кнопки; нет групп — подсказка про панель', async () => {
  const forManager = await says(MANAGER, '/post');
  assert.match(forManager.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === MANAGER).body.text, /только у владельца/);
  const press = await presses(MANAGER, 'post:s:post-object-001', 901);
  assert.match(press.find((call) => call.method === 'answerCallbackQuery').body.text, /только у владельца/);
  assert.equal(telegram.calls.filter((call) => ['sendPhoto', 'sendMediaGroup'].includes(call.method)).length, 0);

  bot.getData().groups = [];
  const empty = await says(ADMIN_CHAT, '/post');
  assert.match(empty.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).body.text, /Публикации → Каналы и группы/);
});

test('/post есть в меню команд владельца и в подсказке рабочей группы', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'admin-commands.mjs'), 'utf8');
  assert.match(source, /post: 'Опубликовать объект в группы'/, 'в меню команд');
  assert.ok(source.includes('/post — опубликовать объект в группы'), 'в подсказке рабочей группы');
  assert.ok(source.includes("'/stats', '/post'"), 'в группе на /post отвечаем подсказкой, а не молчим');
});
