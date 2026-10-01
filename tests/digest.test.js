'use strict';

// Недельный дайджест и мягкий возврат. Оба выключены, пока владелец не включит;
// оба — только согласившимся на «Новости и акции», только когда есть что показать,
// с ограничением частоты и выключаются одной кнопкой.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

// Среда, 30.09.2026, полдень.
const NOW = new Date(2026, 8, 30, 12, 0);
const ago = (days, hours = 0) => new Date(NOW.getTime() - days * 86400000 - hours * 3600000).toISOString();
const DAY = 86400000;

let digest;
let base = '';
let headers = {};

test.before(async () => {
  digest = await import('../src/digest.mjs');
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

function fresh(id, title, extra = {}) {
  return property(id, title, 'active', { publishedAt: ago(2), priceValue: 300000, currency: 'EUR', ...extra });
}

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.engagement = { digest: true, comeback: true };
}));

const sentTo = (chat) => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));

test.describe('дайджест', () => {
  test('выключен по умолчанию: ничего не уходит, даже когда есть что показывать', async () => {
    bot.getData().objects.push(fresh('new-1', 'Новая вилла'));
    bot.getData().config.engagement = bot.normalizeLoadedData({}).config.engagement;
    assert.deepEqual(bot.getData().config.engagement, { digest: false, comeback: false, planReminder: false });
    const chat = createChat();
    telegram.calls = [];
    assert.deepEqual(await digest.runWeeklyDigest(NOW, bot.getData().config.botToken), []);
    assert.equal(sentTo(chat).length, 0);
  });

  test('новые объекты: заголовок, счётчик, до четырёх строк, кнопки «Показать новые» и «Не присылать»', async () => {
    const data = bot.getData();
    for (let index = 1; index <= 6; index += 1) data.objects.push(fresh('new-' + index, 'Новая ' + index, { city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' } }));
    data.objects.push(property('old-1', 'Старая', 'active', { publishedAt: ago(30) }));
    const chat = createChat();
    telegram.calls = [];
    assert.deepEqual(await digest.runWeeklyDigest(NOW, data.config.botToken), [String(chat.id)]);
    const [message] = sentTo(chat);
    assert.match(message.body.text, /^🗞 Что нового за неделю/);
    assert.match(message.body.text, /🏘 Новые: 6/);
    assert.equal((message.body.text.match(/^• /gm) || []).length, 4, 'в тексте не больше четырёх карточек');
    assert.ok(!message.body.text.includes('Старая'), 'старый объект не «новый»');
    assert.deepEqual(callbacksOf(message.body.reply_markup), ['digest:new', 'digest:off']);
    assert.equal(chat.user.digestAt, NOW.toISOString());
    assert.equal(chat.user.digestNewIds.length, 6);
  });

  test('подешевевшие: строка со старой и новой ценой и кнопка «Показать снижения»', async () => {
    bot.getData().objects.push(property('drop-1', 'Виллa со скидкой', 'active', { publishedAt: ago(90), priceValue: 270000, previousPriceValue: 300000, priceChangedAt: ago(1), currency: 'EUR' }));
    const chat = createChat();
    telegram.calls = [];
    await digest.runWeeklyDigest(NOW, bot.getData().config.botToken);
    const [message] = sentTo(chat);
    assert.match(message.body.text, /📉 Подешевели: 1/);
    assert.match(message.body.text, /💰 .*300.*→.*270/);
    assert.deepEqual(callbacksOf(message.body.reply_markup), ['digest:drops', 'digest:off']);
  });

  test('под сохранённый поиск клиента — первыми и с пометкой', async () => {
    const data = bot.getData();
    data.objects.push(fresh('flat-1', 'Квартира', { propertyType: 'apartment' }));
    data.objects.push(fresh('villa-1', 'Вилла под поиск', { propertyType: 'villa' }));
    const chat = createChat();
    chat.user.savedSearch = { filter: { deal: 'sale', type: 'villa', bedrooms: 0, city: '', district: '', minPrice: 0, maxPrice: 0, sort: '' }, enabled: true, createdAt: ago(5), updatedAt: ago(5) };
    telegram.calls = [];
    await digest.runWeeklyDigest(NOW, data.config.botToken);
    const lines = sentTo(chat)[0].body.text.split('\n').filter((line) => line.startsWith('• '));
    assert.match(lines[0], /Вилла под поиск.*🔔 под ваш поиск/);
    assert.ok(!/Квартира.*под ваш/.test(lines[1]));
  });

  test('пустой дайджест не уходит и «неделя» не тратится: как появится новое — уйдёт', async () => {
    const chat = createChat();
    telegram.calls = [];
    assert.deepEqual(await digest.runWeeklyDigest(NOW, bot.getData().config.botToken), []);
    assert.ok(!chat.user.digestAt, 'дата не проставлена');
    bot.getData().objects.push(fresh('later-1', 'Появилась позже'));
    assert.deepEqual(await digest.runWeeklyDigest(new Date(NOW.getTime() + 3600000), bot.getData().config.botToken), [String(chat.id)]);
  });

  test('не чаще раза в неделю', async () => {
    bot.getData().objects.push(fresh('new-1', 'Новая'));
    const chat = createChat();
    const token = bot.getData().config.botToken;
    assert.equal((await digest.runWeeklyDigest(NOW, token)).length, 1);
    bot.getData().objects.push(fresh('new-2', 'Ещё новая', { publishedAt: new Date(NOW.getTime() + 3600000).toISOString() }));
    assert.equal((await digest.runWeeklyDigest(new Date(NOW.getTime() + DAY), token)).length, 0, 'на следующий день — нет');
    assert.equal((await digest.runWeeklyDigest(new Date(NOW.getTime() + 6 * DAY), token)).length, 0, 'через шесть дней — нет');
    telegram.calls = [];
    assert.equal((await digest.runWeeklyDigest(new Date(NOW.getTime() + 7 * DAY + 3600000), token)).length, 1, 'через неделю — да');
    assert.match(sentTo(chat)[0].body.text, /Ещё новая/, 'и только то, что появилось после прошлого дайджеста');
    assert.ok(!sentTo(chat)[0].body.text.includes('• Новая'), 'прежняя новинка уже была в прошлом дайджесте');
  });

  test('только согласившимся: без согласия, отписанным, заблокированным и без языка — ничего', async () => {
    bot.getData().objects.push(fresh('new-1', 'Новая'));
    const quiet = [createChat(), createChat(), createChat(), createChat(), createChat()];
    quiet[0].user.newsConsentAt = '';
    quiet[1].user.broadcastsOptOut = true;
    quiet[2].user.blocked = true;
    quiet[3].user.preferredLanguage = '';
    quiet[4].user.digestOptOut = true;
    telegram.calls = [];
    assert.deepEqual(await digest.runWeeklyDigest(NOW, bot.getData().config.botToken), []);
  });

  test('ночью не отправляется', async () => {
    bot.getData().objects.push(fresh('new-1', 'Новая'));
    createChat();
    assert.deepEqual(await digest.runWeeklyDigest(new Date(2026, 8, 30, 3, 0), bot.getData().config.botToken), []);
    assert.deepEqual(await digest.runWeeklyDigest(new Date(2026, 8, 30, 21, 30), bot.getData().config.botToken), []);
  });

  test('«Показать новые» открывает список из дайджеста, «Не присылать» выключает, «Включить снова» возвращает', async () => {
    bot.getData().objects.push(fresh('new-1', 'Первая новая'), fresh('new-2', 'Вторая новая'));
    const chat = createChat();
    await digest.runWeeklyDigest(NOW, bot.getData().config.botToken);
    const shown = await chat.press('digest:new');
    const card = shown.calls.find((call) => ['sendPhoto', 'sendMessage'].includes(call.method));
    assert.match(String(card.body.caption || card.body.text), /Что нового/, 'заголовок списка');
    assert.equal(bot.catalogRecords(chat.user, 'digest').length, 2);

    const off = await chat.press('digest:off');
    assert.equal(chat.user.digestOptOut, true);
    assert.ok(callbacksOf(off.last.markup).includes('digest:on'), 'можно включить обратно');
    bot.getData().objects.push(fresh('new-3', 'Третья', { publishedAt: new Date(NOW.getTime() + 8 * DAY).toISOString() }));
    assert.deepEqual(await digest.runWeeklyDigest(new Date(NOW.getTime() + 9 * DAY), bot.getData().config.botToken), [], 'после отказа — тишина');

    await chat.press('digest:on');
    assert.equal(chat.user.digestOptOut, false);
    assert.equal((await digest.runWeeklyDigest(new Date(NOW.getTime() + 9 * DAY), bot.getData().config.botToken)).length, 1, 'снова включили — приходит');
  });

  test('объекты ушли из каталога, пока клиент читал: «показать нечего», без ошибки', async () => {
    bot.getData().objects.push(fresh('new-1', 'Новая'));
    const chat = createChat();
    await digest.runWeeklyDigest(NOW, bot.getData().config.botToken);
    bot.getData().objects.find((record) => record.id === 'new-1').status = 'sold';
    const step = await chat.press('digest:new');
    assert.match(step.last.text, /показать нечего/);
  });

  test('чужие и неизвестные кнопки не ломают: «устарела»', async () => {
    const chat = createChat();
    const step = await chat.press('digest:hack');
    assert.ok(step.popups.length);
  });
});

test.describe('мягкий возврат', () => {
  function quietViewer({ silentDays = 6, viewed = 'seen-villa' } = {}) {
    const data = bot.getData();
    data.objects.push(property('seen-villa', 'Просмотренная вилла', 'active', { propertyType: 'villa', priceValue: 300000, currency: 'EUR', publishedAt: ago(60), city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' } }));
    const chat = createChat();
    chat.user.recentlyViewed = viewed ? [viewed] : [];
    chat.user.lastSeenAt = ago(silentDays);
    return chat;
  }
  function similarNew(extra = {}) {
    bot.getData().objects.push(fresh('similar-new', 'Похожая вилла', { propertyType: 'villa', city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' }, ...extra }));
  }

  test('смотрел, молчит шесть дней, появилось похожее — одно сообщение со счётчиком и двумя кнопками', async () => {
    const chat = quietViewer();
    similarNew();
    telegram.calls = [];
    assert.deepEqual(await digest.runComeback(NOW, bot.getData().config.botToken), [String(chat.id)]);
    const [message] = sentTo(chat);
    assert.match(message.body.text, /За неделю появилось 1 подходящий объект\. Показать\?/);
    assert.deepEqual(callbacksOf(message.body.reply_markup), ['digest:back', 'digest:coff']);
    assert.equal(chat.user.comebackAt, NOW.toISOString());
    assert.deepEqual(chat.user.comebackIds, ['similar-new']);
  });

  test('нечего показать — не отправляется', async () => {
    const chat = quietViewer();
    bot.getData().objects.push(fresh('other-type', 'Участок', { propertyType: 'land', plotArea: 500, area: null, bedrooms: null, bathrooms: null }));
    telegram.calls = [];
    assert.deepEqual(await digest.runComeback(NOW, bot.getData().config.botToken), [], 'участок к вилле не подходит');
    assert.ok(!chat.user.comebackAt);
  });

  test('сроки молчания: два дня — рано, двенадцать — поздно', async () => {
    similarNew();
    const early = quietViewer({ silentDays: 2 });
    assert.deepEqual(await digest.runComeback(NOW, bot.getData().config.botToken), []);
    early.user.lastSeenAt = ago(12);
    assert.deepEqual(await digest.runComeback(NOW, bot.getData().config.botToken), []);
    early.user.lastSeenAt = ago(5, 1);
    assert.equal((await digest.runComeback(NOW, bot.getData().config.botToken)).length, 1, 'пять дней с небольшим — самое время');
  });

  test('не чаще раза в три недели', async () => {
    const chat = quietViewer();
    similarNew();
    const token = bot.getData().config.botToken;
    await digest.runComeback(NOW, token);
    chat.user.lastSeenAt = ago(-14);
    assert.equal((await digest.runComeback(new Date(NOW.getTime() + 20 * DAY), token)).length, 0);
    chat.user.lastSeenAt = new Date(NOW.getTime() + 15 * DAY).toISOString();
    bot.getData().objects.push(fresh('similar-new-2', 'Ещё вилла', { propertyType: 'villa', city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' }, publishedAt: new Date(NOW.getTime() + 16 * DAY).toISOString() }));
    assert.equal((await digest.runComeback(new Date(NOW.getTime() + 21 * DAY + 3600000), token)).length, 1, 'через три недели можно снова');
  });

  test('тот, кто ничего не смотрел и не сохранял, возврата не получает', async () => {
    quietViewer({ viewed: '' });
    similarNew();
    assert.deepEqual(await digest.runComeback(NOW, bot.getData().config.botToken), []);
  });

  test('выключен, без согласия и отписавшимся — не приходит', async () => {
    const chat = quietViewer();
    similarNew();
    const token = bot.getData().config.botToken;
    bot.getData().config.engagement.comeback = false;
    assert.deepEqual(await digest.runComeback(NOW, token), []);
    bot.getData().config.engagement.comeback = true;
    chat.user.newsConsentAt = '';
    assert.deepEqual(await digest.runComeback(NOW, token), []);
    chat.user.newsConsentAt = ago(30);
    chat.user.comebackOptOut = true;
    assert.deepEqual(await digest.runComeback(NOW, token), []);
  });

  test('не в один день с дайджестом: после дайджеста три дня тишины', async () => {
    const chat = quietViewer();
    similarNew();
    chat.user.digestAt = ago(1);
    assert.deepEqual(await digest.runComeback(NOW, bot.getData().config.botToken), []);
    chat.user.digestAt = ago(4);
    assert.equal((await digest.runComeback(NOW, bot.getData().config.botToken)).length, 1);
  });

  test('«Показать» открывает подходящие; «Не напоминать» выключает возврат', async () => {
    const chat = quietViewer();
    similarNew();
    await digest.runComeback(NOW, bot.getData().config.botToken);
    const shown = await chat.press('digest:back');
    assert.equal(bot.catalogRecords(chat.user, 'digest').length, 1);
    assert.ok(shown.calls.some((call) => ['sendPhoto', 'sendMessage'].includes(call.method)));
    const off = await chat.press('digest:coff');
    assert.equal(chat.user.comebackOptOut, true);
    assert.match(off.last.text, /больше не напоминаю/);
  });
});

test.describe('панель и данные', () => {
  async function login() {
    const data = bot.getData();
    const password = bot.hashPassword('digest-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'digest-password' }) });
    headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
  }

  test('переключатели сохраняются; состояние знает, сколько клиентов получат и сколько объектов в продаже', async () => {
    await login();
    bot.getData().config.engagement = { digest: false, comeback: false, planReminder: false };
    bot.getData().objects.push(fresh('a', 'A'), fresh('b', 'B'));
    createChat();
    createChat().user.newsConsentAt = '';
    assert.equal((await realFetch(base + '/api/engagement', { method: 'PUT', headers, body: JSON.stringify({ digest: true }) })).status, 200);
    assert.deepEqual(bot.getData().config.engagement, { digest: true, comeback: false, planReminder: false }, 'второй переключатель не тронут');
    const state = await (await realFetch(base + '/api/state', { headers })).json();
    assert.equal(state.engagement.digest, true);
    assert.equal(state.engagement.audience, 1, 'один согласился на новости');
    assert.equal(state.engagement.activeObjects, 2);
    assert.equal((await realFetch(base + '/api/engagement', { method: 'PUT', headers: { ...headers, 'x-csrf-token': 'bad' }, body: JSON.stringify({ digest: false }) })).status, 403);
    assert.equal((await realFetch(base + '/api/engagement', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest: false }) })).status, 401);
  });

  test('данные прежних версий получают оба переключателя выключенными; посторонние значения — не «включено»', () => {
    assert.deepEqual(bot.normalizeLoadedData({ version: 44 }).config.engagement, { digest: false, comeback: false, planReminder: false });
    assert.deepEqual(bot.normalizeLoadedData({ config: { engagement: { digest: 'true', comeback: 1 } } }).config.engagement, { digest: false, comeback: false, planReminder: false });
    assert.deepEqual(bot.normalizeLoadedData({ config: { engagement: { digest: true } } }).config.engagement, { digest: true, comeback: false, planReminder: false });
  });

  test('дата публикации ставится один раз, когда объект впервые становится доступен клиентам', async () => {
    const { queuePropertyAlerts } = await import('../src/alerts.mjs');
    const record = property('pub-1', 'Публикуемый', 'draft');
    bot.getData().objects.push(record);
    queuePropertyAlerts(record, null);
    assert.ok(!record.publishedAt, 'черновик клиентам не виден — даты нет');
    record.status = 'active';
    queuePropertyAlerts(record, { status: 'draft', priceValue: 0 });
    const first = record.publishedAt;
    assert.match(first, /^\d{4}-\d\d-\d\dT/);
    await new Promise((resolve) => setTimeout(resolve, 15));
    record.status = 'reserved';
    queuePropertyAlerts(record, { status: 'active', priceValue: 0 });
    record.status = 'active';
    queuePropertyAlerts(record, { status: 'reserved', priceValue: 0 });
    assert.equal(record.publishedAt, first, 'вернулся из брони — не «новый»');
  });

  test('поля клиента переживают перезапуск и новые сообщения', async () => {
    const chat = createChat();
    Object.assign(chat.user, { digestAt: ago(3), digestNewIds: ['a'], digestOptOut: true, comebackAt: ago(9), comebackOptOut: true });
    await chat.say('Здравствуйте');
    assert.equal(chat.user.digestOptOut, true);
    assert.deepEqual(chat.user.digestNewIds, ['a']);
    const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
    assert.equal(reloaded.users[String(chat.id)].comebackOptOut, true);
    assert.equal(reloaded.users[String(chat.id)].digestAt, chat.user.digestAt);
  });
});
