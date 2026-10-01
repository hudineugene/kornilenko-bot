'use strict';

// Объявление об объекте в группы и каналы: один красиво оформленный пост (описание раскрывающейся цитатой) или фото и
// отдельное сообщение с полным текстом; публикация сразу в несколько групп, отказ там, где бот не администратор,
// отложенная отправка и запись о том, что уже опубликовано.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
// Ответы Telegram на проверку прав: по умолчанию заглушка отвечает «сообщение», и права обнулились бы.
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
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('listing test')]).toString('base64');
const IMAGES = [1, 2, 3].map((n) => ({ id: 'img-' + n, mimeType: 'image/png', dataBase64: PNG + n }));
let base = '';
let headers = {};

const LONG = 'Новый комплекс из 14 апартаментов в Финестрате.\n\n• 14 апартаментов на двух этажах\n• Бассейн и парковка\n\nКак купить: резервирование, затем договор.\n\nСроки: стройка — 12–18 месяцев.';

function listingObject(extra = {}) {
  return property('listing-object-1', 'Riviera <1> & Co', 'active', {
    reference: 'RIV-1',
    priceValue: 147312,
    priceFrom: true,
    area: 53,
    bedrooms: 2,
    bathrooms: 1,
    condition: 'new',
    mapUrl: 'https://maps.google.com/?q=Finestrat',
    videoUrl: 'https://youtu.be/tour123',
    description: { ru: LONG, en: 'English text.\n\nHow to buy: reservation.', es: '' },
    city: { ru: 'Финестрат', en: 'Finestrat', es: 'Finestrat' },
    district: { ru: 'Эль Мускарет', en: 'El Muscaret', es: '' },
    address: { ru: '', en: '', es: '' },
    imagesByLanguage: { ru: IMAGES, en: IMAGES.slice(0, 1), es: [] },
    ...extra,
  });
}

function admin(id, title, extra = {}) {
  return { id, title, type: 'supergroup', username: '', status: 'administrator', rights: { can_post_messages: false, can_pin_messages: true }, isForum: false, topics: [], messages: [], joinRequests: [], ...extra };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects = [listingObject()];
    data.bot = { id: 5550001, username: 'kornilenko_bot', firstName: 'Bot' };
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

const post = (path, body) => realFetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
const objectById = () => bot.getData().objects.find((item) => item.id === 'listing-object-1');
const sentCalls = () => telegram.calls.filter((call) => ['sendMediaGroup', 'sendPhoto', 'sendMessage'].includes(call.method));

function setGroups(groups) {
  const data = bot.getData();
  data.groups = groups;
  // Свежая проверка прав перед отправкой: отвечаем так же, как записано в группе.
  replies.set('getChat', (init) => {
    const id = JSON.parse(init.body).chat_id;
    const group = data.groups.find((item) => item.id === String(id));
    return { id: Number(id), type: group.type, title: group.title, username: group.username || undefined, is_forum: group.isForum };
  });
  replies.set('getChatMemberCount', 100);
  replies.set('getChatMember', (init) => {
    const group = data.groups.find((item) => item.id === String(JSON.parse(init.body).chat_id));
    return { status: group.status, ...group.rights };
  });
}

const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('«один пост»: всё в подписи к альбому — название, цена, геолокация с картой, характеристики, описание раскрывающейся цитатой, ссылка на бота, хештеги', () => {
  const built = bot.buildListing(objectById(), 'ru', { source: 'group' });
  assert.equal(built.layout, 'single');
  assert.equal(built.text, '', 'второго сообщения нет');
  assert.equal(built.images.length, 3);
  assert.equal(built.album, true);
  const caption = built.caption;
  assert.match(caption, /^🏡 <b>Riviera &lt;1&gt; &amp; Co<\/b>\n<i>Квартира · Продажа<\/i>\n💶 <b>от\s147\s312\s€[^\n]*\n📍 Финестрат, Эль Мускарет · 🗺 <a href="https:\/\/maps\.google\.com\/\?q=Finestrat">Карта<\/a>\n\n/, 'название жирным, знаки < и & не ломают разметку; геолокация со ссылкой на карту');
  assert.match(caption, /\n\n🧾 <b>Характеристики<\/b>\n<blockquote>🛏 Спальни: <b>2<\/b>\n🚿 Санузлы: <b>1<\/b>\n📐 Площадь: <b>53 м²<\/b>\n🛠 Состояние: <b>Новое<\/b>\n🏷 № объекта: <b>RIV-1<\/b><\/blockquote>\n\n/, 'характеристики — отдельным блоком');
  assert.match(caption, /\n\n📝 <b>Описание<\/b>\n<blockquote expandable>Новый комплекс из 14 апартаментов в Финестрате\.\n\n▫️ 14 апартаментов на двух этажах\n▫️ Бассейн и парковка\n\n<b>💳 Как купить<\/b>\nРезервирование, затем договор\.\n\n<b>⏳ Сроки<\/b>\nСтройка — 12–18 месяцев\.<\/blockquote>/, 'описание свёрнуто в раскрывающуюся цитату; абзацы с заголовками и значками');
  assert.match(caption, /🤖 <a href="https:\/\/t\.me\/kornilenko_bot\?start=property_listing-object-1__src_group">Смотреть в боте<\/a>/, 'у альбома кнопки нет — ссылка на бота строкой');
  assert.match(caption, /🎥 <a href="https:\/\/youtu\.be\/tour123">Видео-тур<\/a>/);
  assert.match(caption, /#продажа #квартира #Финестрат #ЭльМускарет$/);
  assert.ok(plain(caption).length <= 1024, 'подпись не длиннее 1024 знаков: ' + plain(caption).length);
  assert.equal(built.truncated, false, 'короткое описание поместилось целиком');
  // Порядок: название → цена → место → характеристики → описание → ссылки.
  const order = ['🏡', '💶', '📍', '🧾', '📝', '🤖', '🎥', '#продажа'].map((mark) => caption.indexOf(mark));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('«один пост»: длинное описание сокращается до того, что помещается в 1024 знака, и честно говорит об этом', () => {
  const paragraphs = Array.from({ length: 12 }, (_, index) => 'Абзац номер ' + (index + 1) + ': ' + 'очень подробное описание '.repeat(10));
  const record = listingObject({ description: { ru: paragraphs.join('\n\n'), en: '', es: '' } });
  const built = bot.buildListing(record, 'ru', { reserve: 200 });
  assert.equal(built.truncated, true);
  assert.ok(plain(built.caption).length <= 1024 - 200, 'вместе с подписью канала (200 знаков) — в пределах лимита: ' + plain(built.caption).length);
  assert.match(built.caption, /Описание сокращено — полностью и с фото в боте/);
  assert.match(built.caption, /Абзац номер 1:/);
  assert.ok(!/Абзац номер 12/.test(built.caption));
  assert.match(built.caption, /<blockquote expandable>[^]*<\/blockquote>/);
  // Список длиннее остатка — берутся целые строки, сколько влезет, а не весь список и не ничего.
  const bullets = listingObject({ description: { ru: 'Вступление.\n\n' + Array.from({ length: 30 }, (_, index) => '• Пункт списка номер ' + (index + 1)).join('\n'), en: '', es: '' } });
  const list = bot.buildListing(bullets, 'ru');
  assert.equal(list.truncated, true);
  assert.match(list.caption, /▫️ Пункт списка номер 1\n/);
  assert.ok(!/Пункт списка номер 30/.test(list.caption));
  assert.ok(plain(list.caption).length <= 1024);
});

test('«один пост» с одной фотографией: кнопка «Смотреть в боте» под постом, ссылки строкой нет; без фотографий — текстовый пост с описанием до 4096', () => {
  const one = bot.buildListing(listingObject({ imagesByLanguage: { ru: IMAGES.slice(0, 1), en: [], es: [] } }), 'ru');
  assert.equal(one.album, false);
  assert.ok(!/🤖/.test(one.caption), 'у одного фото есть кнопка — отдельная строка не нужна');
  assert.equal(one.text, '');

  const long = Array.from({ length: 30 }, (_, index) => 'Абзац ' + (index + 1) + ': ' + 'подробное описание '.repeat(10)).join('\n\n');
  const bare = bot.buildListing(listingObject({ imagesByLanguage: { ru: [], en: [], es: [] }, description: { ru: long, en: '', es: '' } }), 'ru');
  assert.equal(bare.caption === bare.title ? '' : bare.caption.length > 0, true, 'у текстового поста подпись — только «шапка» для альбома, которого нет');
  assert.equal(bare.images.length, 0);
  assert.match(bare.text, /^🏡 <b>Riviera &lt;1&gt; &amp; Co<\/b>\n<i>Квартира · Продажа<\/i>\n💶 [^]*\n\n🧾 <b>Характеристики<\/b>/);
  assert.ok(bare.plainLength > 1024 && bare.plainLength <= 4096, 'без фото описание помещается в 4096: ' + bare.plainLength);
});

test('«split»: подпись к альбому — начало, второе сообщение начинается с характеристик и ничего не повторяет; описание — раскрывающейся цитатой', () => {
  const built = bot.buildListing(objectById(), 'ru', { source: 'group', layout: 'split' });
  assert.equal(built.layout, 'split');
  assert.match(built.caption, /^🏡 <b>Riviera &lt;1&gt; &amp; Co<\/b>\n<i>Квартира · Продажа<\/i>\n💶 <b>от\s147\s312\s€[^\n]*\n📍 Финестрат, Эль Мускарет · 🗺 <a href="https:\/\/maps\.google\.com\/\?q=Finestrat">Карта<\/a>$/);
  assert.ok(!/🛏|🚿|📐/.test(built.caption));
  const text = built.text;
  assert.match(text, /^🧾 <b>Характеристики<\/b>\n<blockquote>🛏 Спальни: <b>2<\/b>/);
  assert.ok(!/Riviera|💶|📍|🗺/.test(text), 'ничего из подписи во втором сообщении не повторяется');
  assert.match(text, /📝 <b>Описание<\/b>\n<blockquote expandable>Новый комплекс/);
  assert.match(text, /🎥 <a href="https:\/\/youtu\.be\/tour123">Видео-тур<\/a>\n\n#продажа/);
  assert.ok(!/🤖/.test(text), 'в split кнопка под текстом, строки-ссылки нет');
  const long = bot.buildListing(listingObject({ description: { ru: Array.from({ length: 40 }, (_, index) => 'Абзац номер ' + (index + 1) + ': ' + 'очень подробное описание '.repeat(12)).join('\n\n'), en: '', es: '' } }), 'ru', { layout: 'split', reserve: 300 });
  assert.equal(long.truncated, true);
  assert.ok(long.plainLength <= 4096 - 300, 'вместе с подписью канала — в пределах 4096: ' + long.plainLength);
});

test('на английском и испанском — свои подписи; нет перевода — русский текст с честной пометкой', () => {
  const en = bot.buildListing(objectById(), 'en');
  assert.match(en.caption, /For sale/);
  assert.match(en.caption, /🧾 <b>Key details<\/b>/);
  assert.match(en.caption, /📝 <b>About the property<\/b>\n<blockquote expandable>English text\./);
  assert.match(en.caption, /<b>💳 How to buy<\/b>\nReservation\./);
  assert.match(en.caption, /#forsale/);
  assert.equal(en.buttonText, '🤖 View in the bot');
  assert.equal(en.album, false, 'на английском фотография одна');

  const es = bot.buildListing(objectById(), 'es');
  assert.match(es.caption, /Venta/);
  assert.match(es.caption, /Texto en ruso/, 'испанского описания нет — русский текст с пометкой');
  assert.match(es.caption, /Как купить/);
});

test('предпросмотр: то же, что уйдёт в группу, с подписью канала; у альбома кнопки нет, у «split» есть', async () => {
  const data = bot.getData();
  data.config.publishing = { ...data.config.publishing, signature: 'Конструкции Корниленко', signatureEnabled: true, signatureWrap: 'keep' };
  const single = await (await realFetch(base + '/api/objects/listing-object-1/listing-preview?language=ru', { headers })).json();
  assert.equal(single.layout, 'single');
  assert.equal(single.photoCount, 3);
  assert.equal(single.html, '', 'второго сообщения нет');
  assert.match(single.caption, /Конструкции Корниленко$/, 'подпись — в конце подписи к альбому');
  assert.equal(single.hasButton, false, 'у альбома кнопок не бывает');
  assert.equal(single.album, true);
  const split = await (await realFetch(base + '/api/objects/listing-object-1/listing-preview?language=ru&layout=split', { headers })).json();
  assert.match(split.html, /Конструкции Корниленко$/);
  assert.equal(split.hasButton, true);
  const bare = await (await realFetch(base + '/api/objects/listing-object-1/listing-preview?language=ru&signature=0', { headers })).json();
  assert.ok(!/Конструкции Корниленко/.test(bare.caption));
  data.config.publishing = { ...data.config.publishing, signature: '', signatureEnabled: false };
});

test('публикация в три группы одним постом: канал и группа с темами; в группе, где бот не администратор, — отказ', async () => {
  const data = bot.getData();
  setGroups([
    admin('-1001000000001', 'Канал застройщика', { type: 'channel', username: 'kornilenko1', rights: { can_post_messages: true } }),
    admin('-1001000000002', 'Клуб покупателей', { isForum: true, topics: [{ id: 7, name: 'Объявления', closed: false, manual: false, lastMessageAt: '' }] }),
    admin('-1001000000003', 'Чужая группа', { status: 'member', rights: {} }),
  ]);
  telegram.calls = [];
  const response = await post('/api/objects/listing-object-1/listing-publish', {
    targets: [
      { groupId: '-1001000000001', language: 'ru' },
      { groupId: '-1001000000002', threadId: 7, language: 'en' },
      { groupId: '-1001000000003', language: 'ru' },
    ],
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.results.map((row) => row.ok), [true, true, false]);
  assert.match(body.results[2].error, /не администратор/);
  assert.match(body.results[0].link, /^https:\/\/t\.me\/kornilenko1\/\d+$/, 'у публичного канала ссылка по имени');
  assert.match(body.results[1].link, /^https:\/\/t\.me\/c\/1000000002\/7\/\d+$/, 'у закрытой группы — t.me/c/…, с номером темы');

  // Один пост: в канал ушёл один альбом с подписью, без второго сообщения и без кнопок.
  const channelCalls = sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000001');
  assert.deepEqual(channelCalls.map((call) => call.method), ['sendMediaGroup'], 'одно объявление — один пост');
  const album = JSON.parse(channelCalls[0].body.media);
  assert.equal(album.length, 3);
  assert.equal(album[0].parse_mode, 'HTML');
  assert.match(album[0].caption, /Riviera &lt;1&gt;/);
  assert.match(album[0].caption, /<blockquote expandable>/);
  assert.equal(album[1].caption, undefined, 'подпись только под первой фотографией');
  assert.equal(channelCalls[0].body.reply_markup, undefined);

  // На английском фотография одна: фото с подписью и кнопкой, в выбранную тему.
  const topicCalls = sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000002');
  assert.deepEqual(topicCalls.map((call) => call.method), ['sendPhoto']);
  assert.equal(String(topicCalls[0].body.message_thread_id), '7');
  assert.equal(topicCalls[0].body.parse_mode, 'HTML');
  assert.equal(topicCalls[0].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/kornilenko_bot?start=property_listing-object-1__src_group');

  assert.equal(sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000003').length, 0, 'в чужую группу ничего не ушло');

  const publications = objectById().publications;
  assert.equal(publications.length, 2);
  assert.equal(publications[0].groupId, '-1001000000002');
  assert.equal(publications[0].language, 'en');
  assert.equal(publications[1].title, 'Канал застройщика');
  assert.equal(data.groups[1].listingLanguage, 'en', 'язык запоминается за группой');
});

test('«split» через API: альбом, затем полный текст; в группе — ответом на альбом, в канале — без ответа', async () => {
  setGroups([
    admin('-1001000000011', 'Канал', { type: 'channel', rights: { can_post_messages: true } }),
    admin('-1001000000012', 'Группа'),
  ]);
  telegram.calls = [];
  const response = await post('/api/objects/listing-object-1/listing-publish', { layout: 'split', targets: [{ groupId: '-1001000000011' }, { groupId: '-1001000000012' }] });
  assert.equal((await response.json()).ok, true);
  const channel = sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000011');
  assert.deepEqual(channel.map((call) => call.method), ['sendMediaGroup', 'sendMessage']);
  assert.equal(channel[1].body.reply_parameters, undefined, 'в канале текст не ответ на альбом');
  assert.equal(channel[1].body.parse_mode, 'HTML');
  assert.match(channel[1].body.text, /^🧾 <b>Характеристики<\/b>/);
  assert.equal(channel[1].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/kornilenko_bot?start=property_listing-object-1__src_channel');
  const group = sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000012');
  assert.deepEqual(group.map((call) => call.method), ['sendMediaGroup', 'sendMessage']);
  assert.equal(group[1].body.reply_parameters.message_id > 0, true, 'в группе текст — ответ на альбом');
});

test('канал без права публикации, скрытый или проданный объект и пустой выбор — понятный отказ, в Telegram ничего', async () => {
  setGroups([admin('-1001000000004', 'Канал без прав', { type: 'channel', rights: { can_post_messages: false } })]);
  telegram.calls = [];
  const noRights = await (await post('/api/objects/listing-object-1/listing-publish', { targets: [{ groupId: '-1001000000004' }] })).json();
  assert.equal(noRights.ok, false);
  assert.match(noRights.results[0].error, /нет права публиковать/);

  assert.equal((await post('/api/objects/listing-object-1/listing-publish', { targets: [] })).status, 400);
  assert.equal((await post('/api/objects/no-such/listing-publish', { targets: [{ groupId: '-1001000000004' }] })).status, 404);
  objectById().status = 'sold';
  const sold = await post('/api/objects/listing-object-1/listing-publish', { targets: [{ groupId: '-1001000000004' }] });
  assert.equal(sold.status, 400);
  assert.match((await sold.json()).error, /скрыт или продан/);
  objectById().status = 'active';
  assert.equal(sentCalls().length, 0);
});

test('отложенная публикация: пост хранит «что, на каком языке и в каком виде» и уходит в своё время свежим текстом', async () => {
  const data = bot.getData();
  setGroups([admin('-1001000000005', 'Группа для отложенного', { rights: {} })]);
  const queued = (data.groupPosts || []).length;
  telegram.calls = [];
  const when = new Date(Date.now() + 3600e3).toISOString();
  const response = await post('/api/objects/listing-object-1/listing-publish', { targets: [{ groupId: '-1001000000005', language: 'ru' }], sendAt: when });
  const queuedBody = await response.json();
  assert.equal(response.status, 200, JSON.stringify(queuedBody));
  assert.equal(queuedBody.results[0].scheduled, true);
  assert.equal(sentCalls().length, 0, 'сейчас не отправляли');
  const saved = data.groupPosts[queued];
  assert.deepEqual(saved.listing, { objectId: 'listing-object-1', language: 'ru', layout: 'single' });
  assert.equal(saved.status, 'scheduled');

  // Пока пост ждал, владелец поправил цену: уйдёт новая.
  objectById().priceValue = 150000;
  await bot.runDueGroupPosts(new Date(Date.parse(when) + 1000));
  const album = sentCalls().find((call) => call.method === 'sendMediaGroup');
  assert.match(JSON.parse(album.body.media)[0].caption, /150\s000\s€/);
  assert.equal(data.groupPosts[queued].status, 'sent');
  assert.equal(objectById().publications[0].groupId, '-1001000000005');
});

test('в сохранённых данных остаются «listing» (с видом поста) у отложенных постов и «publications» у объекта', () => {
  const normalized = bot.normalizeLoadedData({
    version: 52,
    groupPosts: [
      { id: 'p-1', groupId: '-1001', listing: { objectId: 'o-1', language: 'es', layout: 'split' }, status: 'scheduled' },
      { id: 'p-2', groupId: '-1001', listing: { objectId: 'o-2', language: 'xx', layout: 'weird' }, status: 'scheduled' },
      { id: 'p-3', groupId: '-1001', status: 'scheduled' },
    ],
    objects: [{ id: 'o-1', publications: [{ groupId: '-1001', title: 'Канал', language: 'xx', at: '2026-10-01T10:00:00.000Z', messageId: 5, link: 'https://t.me/c/1/5' }, { title: 'без группы' }] }],
  });
  assert.deepEqual(normalized.groupPosts[0].listing, { objectId: 'o-1', language: 'es', layout: 'split' });
  assert.deepEqual(normalized.groupPosts[1].listing, { objectId: 'o-2', language: 'ru', layout: 'single' }, 'чужие значения заменены');
  assert.equal(normalized.groupPosts[2].listing, null);
  assert.equal(normalized.objects[0].publications.length, 1, 'запись без группы отброшена');
  assert.equal(normalized.objects[0].publications[0].language, 'ru', 'чужой язык заменён');
});

test('панель: диалог предлагает только группы, где бот администратор, вид поста, предпросмотр и итог по каждой группе', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-catalog.mjs'), 'utf8');
  assert.match(source, /var LISTING_ADMIN = \["administrator", "creator"\]/);
  assert.match(source, /\/listing-preview\?language=/);
  assert.match(source, /\/listing-publish/);
  assert.match(source, /name="listingLayout"/, 'выбор вида поста: один пост или фото и отдельный текст');
  assert.match(source, /layout: box\.querySelector\('input\[name="listingLayout"\]:checked'\)\.value/);
  assert.match(source, /Ещё ' \+ counted\(hiddenCount/, 'про группы без прав сказано, а не молча спрятано');
  assert.match(source, /row\.ok \? "✓ " : "✕ "/, 'в итоге — строка на каждую группу с причиной отказа');
  assert.ok(!/Опубликовать в канал/.test(source), 'прежней кнопки «в канал» нет: публикация теперь — в группы и каналы');
});
