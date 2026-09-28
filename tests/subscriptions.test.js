'use strict';

// "Notifications": the client chooses what to receive, and every broadcast
// has an unsubscribe button.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, callbacksOf, createChat, property, resetData, adminMessages, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const broadcast = { messages: { ru: 'Новые виллы в Марбелье!', en: 'New villas!', es: '¡Villas nuevas!' }, languages: [], tags: [], buttonText: { ru: 'Смотреть', en: 'See', es: 'Ver' }, buttonUrl: 'https://example.com/villas' };

test.beforeEach(() => resetData((data) => {
  data.config.notifyMode = 'all';
}));
test.after(cleanup);

test('"My space" opens the settings, and each item turns on and off', async () => {
  const chat = createChat();
  const more = await chat.say(bot.text.menu.ru.more);
  assert.ok(callbacksOf(more.last.markup).includes('subs:menu'));

  let step = await chat.press('subs:menu');
  assert.match(step.last.text, /^🔔 Какие сообщения присылать\?/);
  // Сохранённый поиск теперь здесь же: это тоже «что мне присылать».
  assert.deepEqual(step.last.buttons, ['✅ Новости и акции', '✅ Объекты: снижение цены и новые по вашему запросу', '🔔 Сохранённый поиск', '⬅️ 👤 Моё']);
  assert.deepEqual(callbacksOf(step.last.markup), ['subs:news:off', 'subs:alerts:off', 'saved:view', 'nav:my']);

  step = await chat.press('subs:news:off');
  assert.equal(chat.user.broadcastsOptOut, true);
  let edit = step.calls.find((call) => call.method === 'editMessageText');
  assert.deepEqual(callbacksOf(edit.body.reply_markup), ['subs:news:on', 'subs:alerts:off', 'saved:view', 'nav:my']);
  assert.equal(edit.body.reply_markup.inline_keyboard[0][0].text, '⬜ Новости и акции');

  step = await chat.press('subs:alerts:off');
  assert.equal(chat.user.propertyAlerts, false);
  step = await chat.press('subs:alerts:on');
  assert.equal(chat.user.propertyAlerts, true);
  step = await chat.press('subs:news:on');
  assert.equal(chat.user.broadcastsOptOut, false);
  edit = step.calls.find((call) => call.method === 'editMessageText');
  assert.deepEqual(callbacksOf(edit.body.reply_markup), ['subs:news:off', 'subs:alerts:off', 'saved:view', 'nav:my']);
  assert.ok(adminMessages().some((message) => message.text.startsWith('👀 Отписался от рассылок')));
});

test('every broadcast has an unsubscribe button; unsubscribed clients get no more', async () => {
  const reader = createChat();
  const leaving = createChat();
  telegram.calls = [];
  await bot.deliverBroadcast(leaving.user, broadcast);
  const sent = telegram.calls.find((call) => call.method === 'sendMessage');
  assert.deepEqual(sent.body.reply_markup.inline_keyboard.flat().map((button) => button.url || button.callback_data), ['https://example.com/villas', 'subs:news:off:bc']);
  assert.equal(sent.body.reply_markup.inline_keyboard[1][0].text, '🔕 Отписаться от рассылок');

  const step = await leaving.press('subs:news:off:bc');
  assert.match(step.last.text, /^Вы отписались от рассылок/);
  assert.deepEqual(callbacksOf(step.last.markup), ['subs:news:on:undo']);
  assert.ok(!step.calls.some((call) => call.method === 'editMessageText'), 'the broadcast itself is left as it was');
  assert.deepEqual(bot.broadcastUsers({ languages: [], tags: [] }).map((user) => user.id), [String(reader.id)]);

  const undo = await leaving.press('subs:news:on:undo');
  assert.deepEqual(undo.popups, ['Рассылки снова включены.']);
  assert.equal(leaving.user.broadcastsOptOut, false);
  assert.equal(bot.broadcastUsers({ languages: [], tags: [] }).length, 2);
});

test('a broadcast counts who responded, sent a request or unsubscribed within three days', async () => {
  const interested = createChat();
  const leaving = createChat();
  const silent = createChat();
  const entry = { id: 'bc-news-1', ...broadcast, status: 'queued', createdAt: new Date().toISOString() };
  bot.getData().broadcasts.unshift(entry);
  await bot.runBroadcast(entry);
  assert.equal(entry.sent, 3);
  assert.equal(interested.user.lastBroadcast.id, 'bc-news-1');

  await interested.say('Расскажите подробнее про виллы');
  await interested.say('И про цены');
  await leaving.press('subs:news:off:bc');
  assert.deepEqual(entry.respondedUserIds, [String(interested.id)], 'each person once; unsubscribing is not a response');
  assert.deepEqual(entry.inquiryUserIds, [String(interested.id)]);
  assert.deepEqual(entry.unsubscribedUserIds, [String(leaving.id)]);

  silent.user.lastBroadcast.at = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  await silent.say('Добрый день');
  assert.ok(!entry.respondedUserIds.includes(String(silent.id)), 'too late to count');

  const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
  assert.deepEqual(reloaded.broadcasts[0].respondedUserIds, [String(interested.id)], 'kept after a restart');
});

test('a campaign can target a funnel stage, source and property interest together', () => {
  const data = bot.getData();
  data.objects.push(property('villa-target', 'Вилла для рассылки'));
  const matching = createChat({ firstName: 'Мария' });
  matching.user.source = 'instagram';
  matching.user.preferredLanguage = 'es';
  matching.user.favorites = ['villa-target'];
  const other = createChat({ firstName: 'Пётр' });
  other.user.source = 'website';
  other.user.favorites = ['villa-target'];
  data.inquiries.push(
    { id: 'segment-1', userId: String(matching.id), type: 'selection', status: 'in_progress', pipelineStage: 'selection', propertyId: '', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z' },
    { id: 'segment-2', userId: String(other.id), type: 'lead', status: 'in_progress', pipelineStage: 'contact', propertyId: '', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z' },
  );
  const recipients = bot.broadcastUsers({ languages: ['es'], tags: [], pipelineStages: ['selection'], sources: ['instagram'], propertyId: 'villa-target', propertySignal: 'favorite' });
  assert.deepEqual(recipients.map((user) => user.id), [String(matching.id)]);
});

test('a saved draft can be sent from the panel and keeps its audience segment', async () => {
  const data = bot.getData();
  data.config.active = true;
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.objects.push(property('villa-draft', 'Вилла из черновика'));
  const recipient = createChat({ firstName: 'Анна' });
  recipient.user.source = 'instagram';
  recipient.user.favorites = ['villa-draft'];
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const body = { mode: 'draft', messages: { ru: 'Персональная подборка', en: '', es: '' }, languages: ['ru'], tags: [], pipelineStages: [], sources: ['instagram'], propertyId: 'villa-draft', propertySignal: 'favorite', buttonText: { ru: '', en: '', es: '' }, buttonUrl: '' };
    const created = await realFetch(base + '/api/broadcast', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const estimate = await realFetch(base + '/api/broadcast/estimate', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.deepEqual(await estimate.json(), { total: 1, byLanguage: { ru: 1, en: 0, es: 0 }, sample: ['Анна'] });
    const sent = await realFetch(base + '/api/broadcasts/' + id, { method: 'PATCH', headers, body: JSON.stringify({ ...body, mode: 'send' }) });
    assert.equal(sent.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const entry = data.broadcasts.find((item) => item.id === id);
    assert.equal(entry.status, 'done');
    assert.deepEqual([entry.sources, entry.propertyId, entry.propertySignal], [['instagram'], 'villa-draft', 'favorite']);
    const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(data))).broadcasts.find((item) => item.id === id);
    assert.deepEqual([reloaded.sources, reloaded.propertyId, reloaded.propertySignal], [['instagram'], 'villa-draft', 'favorite']);
    assert.ok(telegram.calls.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(recipient.id) && call.body.text === 'Персональная подборка'));
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});

test('the setting survives a restart', () => {
  const chat = createChat();
  chat.user.broadcastsOptOut = true;
  const saved = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
  bot.setData(saved);
  assert.equal(bot.userById(String(chat.id)).broadcastsOptOut, true);
});

// --- Рассылка и обрывы связи -------------------------------------------------

test('рассылка уходит карточкой объекта: фото и кнопки, а не текст со ссылкой', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-card', 'Вилла с видом', 'active'));
    data.users['830001'] = {
      id: '830001', chatId: 830001, firstName: 'Ольга', preferredLanguage: 'ru',
      activity: [], favorites: ['villa-card'], newsConsentAt: new Date().toISOString(),
    };
    data.broadcasts.push({
      id: 'bc-card', status: 'queued', messages: { ru: 'Появился объект для вас', en: '', es: '' },
      languages: [], tags: [], pipelineStages: [], sources: [],
      propertyId: 'villa-card', propertySignal: 'favorite', sendAsCard: true,
      buttonText: { ru: '', en: '', es: '' }, buttonUrl: '', image: null,
      processedUserIds: [], respondedUserIds: [], inquiryUserIds: [], unsubscribedUserIds: [], photoOnlyUserIds: [],
      failures: [], sent: 0, failed: 0, total: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  });

  telegram.calls = [];
  await bot.runBroadcast(bot.getData().broadcasts.find((item) => item.id === 'bc-card'));
  const card = telegram.calls.find((call) => call.method === 'sendPhoto');
  assert.ok(card, 'ушла карточка с фотографией, а не текст');
  assert.equal(String(card.body.chat_id), '830001');
  assert.match(card.body.caption, /^Появился объект для вас/, 'текст рассылки идёт первой строкой');
  assert.match(card.body.caption, /Вилла с видом/, 'и подпись карточки объекта');
  const callbacks = card.body.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes('property:viewing:villa-card'), 'кнопка «Записаться»');
  assert.ok(callbacks.includes('property:card:villa-card'), 'кнопка «Подробнее»');
  assert.ok(callbacks.includes('subs:news:off:bc'), 'и отписка на месте');
});

test.describe('рассылка при сбое связи', () => {
  // Подменяем Telegram: первые получатели проходят, затем связь «падает».
  function failAfter(count, error) {
    let seen = 0;
    const original = global.fetch;
    global.fetch = (url, init) => {
      if (String(url).includes('api.telegram.org') && String(url).endsWith('sendMessage')) {
        seen += 1;
        if (seen > count) return Promise.reject(error());
      }
      return original(url, init);
    };
    return () => { global.fetch = original; };
  }

  test('обрыв связи ставит рассылку в очередь, а не сжигает получателей', async () => {
    const first = createChat();
    const second = createChat();
    const third = createChat();
    const entry = { ...broadcast, id: 'bc-outage', languages: [], tags: [], status: 'queued', processedUserIds: [] };
    bot.getData().broadcasts.unshift(entry);

    const restore = failAfter(1, () => Object.assign(new Error('fetch failed'), { name: 'TypeError' }));
    try {
      await bot.runBroadcast(entry);
    } finally {
      restore();
    }

    assert.equal(entry.status, 'queued', 'рассылка ждёт связи, а не «выполнена»');
    assert.equal(entry.sent, 1, 'успевшие получить — засчитаны');
    assert.equal(entry.failed, 0, 'остальные не записаны как неудача');
    assert.equal(entry.processedUserIds.length, 1, 'необработанные получатели останутся в очереди');
    assert.ok(entry.pausedAt, 'видно, что была пауза');
    assert.match(entry.error, /Связь с Telegram/);
    assert.ok([second.id, third.id].every((id) => !entry.processedUserIds.includes(String(id))));
  });

  test('после возвращения связи рассылка продолжается с того же места', async () => {
    const first = createChat();
    const second = createChat();
    const entry = { ...broadcast, id: 'bc-resume', languages: [], tags: [], status: 'queued', processedUserIds: [] };
    bot.getData().broadcasts.unshift(entry);

    const restore = failAfter(1, () => Object.assign(new Error('Bad Gateway'), { status: 502, telegramCode: 502 }));
    try { await bot.runBroadcast(entry); } finally { restore(); }
    assert.equal(entry.status, 'queued');
    const delivered = entry.processedUserIds.slice();

    telegram.calls = [];
    await bot.runBroadcast(entry);
    assert.equal(entry.status, 'done', 'со второго прохода рассылка завершается');
    assert.equal(entry.sent, 2, 'каждый получил один раз');
    assert.equal(entry.error, '', 'сообщение о паузе снимается');
    const receivers = telegram.calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.body.chat_id));
    assert.ok(!receivers.includes(delivered[0]), 'уже получивший второй раз не получает');
  });

  test('клиент, заблокировавший бота, остаётся неудачей и не останавливает рассылку', async () => {
    const blocking = createChat();
    const other = createChat();
    const entry = { ...broadcast, id: 'bc-blocked', languages: [], tags: [], status: 'queued', processedUserIds: [] };
    bot.getData().broadcasts.unshift(entry);

    const original = global.fetch;
    global.fetch = (url, init) => {
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
      if (String(url).endsWith('sendMessage') && String(body.chat_id) === String(blocking.id)) {
        return Promise.reject(Object.assign(new Error('Forbidden: bot was blocked by the user'), { telegramCode: 403, status: 403 }));
      }
      return original(url, init);
    };
    try { await bot.runBroadcast(entry); } finally { global.fetch = original; }

    assert.equal(entry.status, 'done', 'отказ одного клиента не останавливает рассылку');
    assert.equal(entry.failed, 1);
    assert.equal(entry.sent, 1);
    assert.equal(blocking.user.blocked, true, 'клиент помечен недоступным');
    assert.equal(blocking.user.blockedBy, 'telegram');
  });

  test('файл данных при рассылке пишется не чаще раза в 5 секунд', async () => {
    const readers = Array.from({ length: 12 }, () => createChat());
    const entry = { ...broadcast, id: 'bc-writes', languages: [], tags: [], status: 'queued', processedUserIds: [] };
    bot.getData().broadcasts.unshift(entry);
    const fs = require('node:fs');
    const writes = [];
    const realWrite = fs.writeFileSync;
    fs.writeFileSync = function (file, ...rest) {
      if (String(file).includes('bot-data')) writes.push(Date.now());
      return realWrite.call(fs, file, ...rest);
    };
    try {
      await bot.runBroadcast(entry);
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      fs.writeFileSync = realWrite;
    }
    assert.equal(entry.sent, readers.length);
    // Рассылка короче пяти секунд: только старт и завершение, без записи на
    // каждого получателя.
    assert.ok(writes.length <= 3, 'записей файла должно быть немного, а не по одной на получателя: ' + writes.length);
  });
});
