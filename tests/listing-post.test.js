'use strict';

// Объявление об объекте в группы и каналы: красиво оформленный пост с полным описанием, публикация сразу в несколько
// групп, отказ там, где бот не администратор, отложенная отправка и запись о том, что уже опубликовано.

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

test('пост устроен как карточка в боте: фото с подписью, отдельно характеристики, ниже описание с заголовками', () => {
  const built = bot.buildListing(objectById(), 'ru', { source: 'group' });
  // Подпись под альбомом: название, тип и сделка, цена, город и район — и больше ничего.
  assert.match(built.caption, /^🏡 <b>Riviera &lt;1&gt; &amp; Co<\/b>\n<i>Квартира · Продажа<\/i>\n💶 <b>от\s147\s312\s€[^\n]*\n📍 Финестрат, Эль Мускарет · 🗺 <a href="https:\/\/maps\.google\.com\/\?q=Finestrat">Карта<\/a>$/, 'геолокация со ссылкой на карту — в подписи; название жирным, знаки < и & не ломают разметку');
  assert.ok(!/🛏|🚿|📐/.test(built.caption), 'характеристик в подписи нет: они ниже, отдельным блоком');
  assert.ok(built.caption.length <= 1024, 'подпись к фото — не длиннее 1024 знаков');

  const text = built.text;
  // Ничего из подписи во втором сообщении не повторяется: ни название, ни цена, ни город с районом.
  assert.ok(!/Riviera/.test(text), 'название уже в подписи альбома');
  assert.ok(!/💶/.test(text), 'цена уже в подписи альбома');
  assert.ok(!/📍 Финестрат/.test(text), 'город и район уже в подписи альбома');
  assert.match(text, /^🧾 <b>Характеристики<\/b>\n<blockquote>🛏 Спальни: <b>2<\/b>\n🚿 Санузлы: <b>1<\/b>\n📐 Площадь: <b>53 м²<\/b>/, 'сообщение начинается с блока «Характеристики» цитатой, значения жирным');
  assert.match(text, /🛠 Состояние: <b>Новое<\/b>/);
  assert.match(text, /🏷 № объекта: <b>RIV-1<\/b><\/blockquote>/);
  assert.ok(text.indexOf('🧾') < text.indexOf('📝 <b>Описание</b>'), 'характеристики выше описания');
  assert.match(text, /📝 <b>Описание<\/b>\nНовый комплекс из 14 апартаментов в Финестрате\./, 'вступление — под заголовком, без выделения');
  assert.match(text, /▫️ 14 апартаментов на двух этажах\n▫️ Бассейн и парковка/, 'маркеры списка — одного вида');
  assert.match(text, /<b>💳 Как купить<\/b>\nРезервирование, затем договор\./, 'метка абзаца — заголовком со значком, текст под ним с большой буквы');
  assert.match(text, /<b>⏳ Сроки<\/b>\nСтройка/);
  assert.ok(!/🗺|📍/.test(text), 'геолокация и карта — в подписи альбома, во втором сообщении их нет');
  assert.match(text, /🎥 <a href="https:\/\/youtu\.be\/tour123">Видео-тур<\/a>/);
  assert.match(text, /#продажа #квартира #Финестрат #ЭльМускарет/, 'хештеги из сделки, типа, города и района');
  assert.equal(built.buttonUrl, 'https://t.me/kornilenko_bot?start=property_listing-object-1__src_group');
  assert.equal(built.images.length, 3);
  assert.equal(built.truncated, false);

  // Адрес — в подписи альбома, вместе с городом и картой; второе сообщение начинается с характеристик.
  const withAddress = bot.buildListing(listingObject({ address: { ru: 'Calle Alcudia 1', en: '', es: '' } }), 'ru');
  assert.match(withAddress.caption, /\n📍 Финестрат, Эль Мускарет, Calle Alcudia 1 · 🗺 /);
  assert.ok(!/Calle Alcudia/.test(withAddress.text));
  assert.match(withAddress.text, /^🧾 /);

  // Без фотографий альбома нет — всё одним сообщением: название, цена, место, характеристики.
  const bare = bot.buildListing(listingObject({ imagesByLanguage: { ru: [], en: [], es: [] } }), 'ru');
  assert.match(bare.text, /^🏡 <b>Riviera &lt;1&gt; &amp; Co<\/b>\n<i>Квартира · Продажа<\/i>\n\n💶 <b>от\s147\s312[^\n]*\n📍 Финестрат, Эль Мускарет · 🗺 [^\n]*\n\n🧾 /);
  assert.equal(bare.images.length, 0);
});

test('на английском — свой текст и свои подписи; нет перевода — русский с честной пометкой', () => {
  const en = bot.buildListing(objectById(), 'en');
  assert.match(en.caption, /For sale/);
  assert.match(en.text, /🧾 <b>Key details<\/b>/);
  assert.match(en.text, /📝 <b>About the property<\/b>\nEnglish text\./);
  assert.match(en.text, /<b>💳 How to buy<\/b>\nReservation\./);
  assert.match(en.text, /#forsale/);
  assert.equal(en.buttonText, '🤖 View in the bot');

  const es = bot.buildListing(objectById(), 'es');
  assert.match(es.caption, /Venta/);
  assert.match(es.text, /Texto en ruso/, 'испанского описания нет — русский текст с пометкой');
  assert.match(es.text, /Как купить/);
});

test('слишком длинное описание сокращается по абзацам и всё сообщение укладывается в лимит Telegram', () => {
  const paragraphs = Array.from({ length: 40 }, (_, index) => 'Абзац номер ' + (index + 1) + ': ' + 'очень подробное описание '.repeat(12));
  const record = listingObject({ description: { ru: paragraphs.join('\n\n'), en: '', es: '' } });
  const built = bot.buildListing(record, 'ru', { reserve: 300 });
  assert.equal(built.truncated, true);
  assert.ok(built.plainLength <= 4096 - 300, 'вместе с подписью канала (300 знаков) — в пределах лимита: ' + built.plainLength);
  assert.match(built.text, /Описание сокращено/);
  assert.match(built.text, /Абзац номер 1:/);
  assert.ok(!/Абзац номер 40/.test(built.text));
  // Одно описание без пустых строк длиннее лимита — режется по предложению, а не пропадает.
  const solid = bot.buildListing(listingObject({ description: { ru: 'Предложение номер раз. '.repeat(400), en: '', es: '' } }), 'ru');
  assert.ok(solid.plainLength <= 4096);
  assert.match(solid.text, /Предложение номер раз\./);
});

test('предпросмотр: то же, что уйдёт в группу, с подписью канала и числом фотографий', async () => {
  const data = bot.getData();
  data.config.publishing = { ...data.config.publishing, signature: 'Конструкции Корниленко', signatureEnabled: true, signatureWrap: 'keep' };
  const response = await realFetch(base + '/api/objects/listing-object-1/listing-preview?language=ru', { headers });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.photoCount, 3);
  assert.match(preview.html, /Конструкции Корниленко$/, 'подпись — в конце текста');
  assert.equal(preview.hasButton, true);
  const bare = await (await realFetch(base + '/api/objects/listing-object-1/listing-preview?language=ru&signature=0', { headers })).json();
  assert.ok(!/Конструкции Корниленко/.test(bare.html));
  data.config.publishing = { ...data.config.publishing, signature: '', signatureEnabled: false };
});

test('публикация в три группы: канал, группа с темами и группа, где бот не администратор', async () => {
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

  const channelCalls = sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000001');
  assert.deepEqual(channelCalls.map((call) => call.method), ['sendMediaGroup', 'sendMessage'], 'альбом, затем полный текст');
  assert.equal(channelCalls[1].body.parse_mode, 'HTML');
  assert.equal(channelCalls[1].body.reply_parameters, undefined, 'в канале текст не ответ на альбом');
  assert.equal(channelCalls[1].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/kornilenko_bot?start=property_listing-object-1__src_channel');
  const album = JSON.parse(channelCalls[0].body.media);
  assert.equal(album.length, 3);
  assert.equal(album[0].parse_mode, 'HTML');
  assert.match(album[0].caption, /Riviera &lt;1&gt;/);
  assert.equal(album[1].caption, undefined, 'подпись только под первой фотографией');

  const topicCalls = sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000002');
  assert.deepEqual(topicCalls.map((call) => call.method), ['sendPhoto', 'sendMessage'], 'на английском фотография одна — обычное фото, не альбом');
  for (const call of topicCalls) assert.equal(String(call.body.message_thread_id), '7', 'всё — в выбранную тему');
  assert.equal(topicCalls.find((call) => call.method === 'sendMessage').body.reply_parameters.message_id > 0, true, 'в группе текст — ответ на альбом');

  assert.equal(sentCalls().filter((call) => String(call.body.chat_id) === '-1001000000003').length, 0, 'в чужую группу ничего не ушло');

  // Запись об опубликованном — на объекте, для предупреждения «здесь уже было».
  const publications = objectById().publications;
  assert.equal(publications.length, 2);
  assert.equal(publications[0].groupId, '-1001000000002');
  assert.equal(publications[0].language, 'en');
  assert.equal(publications[1].title, 'Канал застройщика');
  assert.equal(data.groups[1].listingLanguage, 'en', 'язык запоминается за группой');
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

test('отложенная публикация: пост хранит только «что и на каком языке» и уходит в своё время свежим текстом', async () => {
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
  assert.deepEqual(saved.listing, { objectId: 'listing-object-1', language: 'ru' });
  assert.equal(saved.status, 'scheduled');

  // Пока пост ждал, владелец поправил цену: уйдёт новая.
  objectById().priceValue = 150000;
  await bot.runDueGroupPosts(new Date(Date.parse(when) + 1000));
  // Цена — в подписи альбома (во втором сообщении её нет, чтобы не повторяться).
  const album = sentCalls().find((call) => call.method === 'sendMediaGroup');
  assert.match(JSON.parse(album.body.media)[0].caption, /150\s000\s€/);
  assert.equal(data.groupPosts[queued].status, 'sent');
  assert.equal(objectById().publications[0].groupId, '-1001000000005');
});

test('в сохранённых данных остаются «listing» у отложенных постов и «publications» у объекта', () => {
  const normalized = bot.normalizeLoadedData({
    version: 52,
    groupPosts: [{ id: 'p-1', groupId: '-1001', listing: { objectId: 'o-1', language: 'es' }, status: 'scheduled' }, { id: 'p-2', groupId: '-1001', status: 'scheduled' }],
    objects: [{ id: 'o-1', publications: [{ groupId: '-1001', title: 'Канал', language: 'xx', at: '2026-10-01T10:00:00.000Z', messageId: 5, link: 'https://t.me/c/1/5' }, { title: 'без группы' }] }],
  });
  assert.deepEqual(normalized.groupPosts[0].listing, { objectId: 'o-1', language: 'es' });
  assert.equal(normalized.groupPosts[1].listing, null);
  assert.equal(normalized.objects[0].publications.length, 1, 'запись без группы отброшена');
  assert.equal(normalized.objects[0].publications[0].language, 'ru', 'чужой язык заменён');
});

test('панель: диалог предлагает только группы, где бот администратор, показывает предпросмотр и итог по каждой группе', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-catalog.mjs'), 'utf8');
  assert.match(source, /var LISTING_ADMIN = \["administrator", "creator"\]/);
  assert.match(source, /\/listing-preview\?language=/);
  assert.match(source, /\/listing-publish/);
  assert.match(source, /Ещё ' \+ counted\(hiddenCount/, 'про группы без прав сказано, а не молча спрятано');
  assert.match(source, /row\.ok \? "✓ " : "✕ "/, 'в итоге — строка на каждую группу с причиной отказа');
  assert.ok(!/Опубликовать в канал/.test(source), 'прежней кнопки «в канал» нет: публикация теперь — в группы и каналы');
});
