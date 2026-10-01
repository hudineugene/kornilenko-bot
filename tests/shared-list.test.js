'use strict';

// «Поделиться подборкой»: избранное одной ссылкой. Получатель открывает её в боте, листает карточки и может поставить своё ❤️.
// Подборки живут 90 дней, у одного клиента не больше пяти, уходят вместе с его данными.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

const PNG = { id: 'x', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };
const images = { imagesByLanguage: { ru: [PNG], en: [PNG], es: [PNG] } };

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  for (const [id, title] of [['one', 'Первая квартира'], ['two', 'Вторая вилла'], ['three', 'Третий дом'], ['four', 'Четвёртый участок'], ['five', 'Пятая квартира'], ['six', 'Шестая вилла']]) {
    data.objects.push(property(id, title, 'active', { priceValue: 200000, currency: 'EUR', ...images }));
  }
}));

const callsOf = (step) => step.calls.filter((call) => call.body && (call.body.text || call.body.caption));
const lastCard = (step) => [...callsOf(step)].reverse()[0].body;
const buttonsOf = (body) => ((body.reply_markup || {}).inline_keyboard || []).flat();

async function favourite(chat, ...ids) {
  for (const id of ids) await chat.press('property:favorite:' + id);
}

async function share(chat) {
  const step = await chat.press('shared:create');
  const message = callsOf(step).map((call) => call.body).find((body) => /start=list_/.test(body.text || ''));
  const code = message ? /start=list_([A-Za-z0-9_-]+)/.exec(message.text)[1] : '';
  return { step, message, code };
}

test('под карточкой избранного — «Поделиться подборкой» (три языка)', async () => {
  for (const [language, label] of [['ru', '📤 Поделиться подборкой'], ['en', '📤 Share the shortlist'], ['es', '📤 Compartir la selección']]) {
    const chat = createChat({ language });
    await favourite(chat, 'one', 'two');
    const step = await chat.press('catalog:favorites:0');
    assert.ok(buttonsOf(lastCard(step)).some((button) => button.text === label && button.callback_data === 'shared:create'), language + ': ' + buttonsOf(lastCard(step)).map((button) => button.text).join(' | '));
  }
  const all = await createChat().press('catalog:all:0');
  assert.ok(!buttonsOf(lastCard(all)).some((button) => button.callback_data === 'shared:create'), 'в общем каталоге такой кнопки нет');
});

test('«Поделиться»: ссылка на подборку, кнопка «Отправить», та же ссылка при повторе; другая подборка — другая ссылка', async () => {
  const chat = createChat();
  await favourite(chat, 'one', 'two');
  const first = await share(chat);
  assert.match(first.message.text, /Подборка готова — объектов: 2/);
  assert.match(first.message.text, /https:\/\/t\.me\/test_bot\?start=list_[A-Za-z0-9_-]{8,}/);
  const send = buttonsOf(first.message).find((button) => button.url);
  assert.ok(send.url.startsWith('https://t.me/share/url?url=' + encodeURIComponent('https://t.me/test_bot?start=list_' + first.code)), send.url);
  assert.equal(send.text, '📤 Отправить');
  assert.deepEqual(bot.getData().sharedLists[first.code].ids, ['one', 'two']);
  assert.equal(bot.getData().sharedLists[first.code].owner, String(chat.id));

  const again = await share(chat);
  assert.equal(again.code, first.code, 'тот же набор — та же ссылка');
  assert.equal(Object.keys(bot.getData().sharedLists).length, 1);

  await chat.press('property:favorite:three');
  const changed = await share(chat);
  assert.notEqual(changed.code, first.code, 'другой набор — другая ссылка');
  assert.match(changed.message.text, /объектов: 3/);
});

test('пустое избранное делиться нечем: подсказка, подборка не создаётся', async () => {
  const chat = createChat();
  const step = await chat.press('shared:create');
  assert.ok(step.popups.includes('Сначала добавьте объекты в избранное'), step.popups.join('|'));
  assert.deepEqual(bot.getData().sharedLists, {});
});

test('получатель открывает ссылку: подборка карточками, заголовок, счётчик, «весь каталог», источник «podborka»', async () => {
  const owner = createChat();
  await favourite(owner, 'one', 'two', 'three');
  const { code } = await share(owner);

  const guest = createChat({ language: 'ru' });
  guest.user.preferredLanguage = 'ru';
  const step = await guest.say('/start list_' + code);
  const card = lastCard(step);
  assert.match(card.caption || card.text, /📤 Вам прислали подборку · объектов: 3/);
  assert.match(card.caption || card.text, /Первая квартира/);
  const buttons = buttonsOf(card);
  assert.ok(buttons.some((button) => button.text === '1 / 3'), buttons.map((button) => button.text).join(' | '));
  assert.ok(buttons.some((button) => button.callback_data === 'catalog:shared:1'), 'листание остаётся в подборке');
  assert.ok(buttons.some((button) => button.callback_data === 'catalog:all:0'), 'и есть путь в весь каталог');
  assert.equal(guest.user.sharedListCode, code);
  assert.equal(guest.user.source, 'podborka');
  assert.equal(bot.getData().sharedLists[code].opens, 1);

  const next = await guest.press('catalog:shared:1');
  assert.match(callsOf(next).map((call) => call.body.caption || call.body.text).join('\n'), /Вторая вилла/);
  const heart = await guest.press('property:favorite:two');
  assert.ok(heart.popups.length || callsOf(heart).length);
  assert.ok(guest.user.favorites.includes('two'), 'своё ❤️ — в свои избранные, а не в чужие');
  assert.deepEqual(owner.user.favorites.sort(), ['one', 'three', 'two'], 'избранное хозяина не тронуто');
});

test('подборка на английском и испанском; объект, который ушёл из каталога, из подборки пропадает', async () => {
  const owner = createChat();
  await favourite(owner, 'one', 'two');
  const { code } = await share(owner);
  bot.getData().objects.find((item) => item.id === 'two').status = 'draft';

  const en = createChat({ language: 'en' });
  const step = await en.say('/start list_' + code);
  assert.match(lastCard(step).caption || lastCard(step).text, /You were sent a shortlist · properties: 1/);
  assert.match(lastCard(step).caption || lastCard(step).text, /Demo|Первая квартира/);
  assert.ok(!buttonsOf(lastCard(step)).some((button) => /^\d+ \/ \d+$/.test(button.text)), 'остался один объект — листать нечего');
  const es = createChat({ language: 'es' });
  assert.match(lastCard(await es.say('/start list_' + code)).caption || '', /Te han enviado una selección · inmuebles: 1/);
});

test('нет такой подборки, она устарела или в ней ничего не осталось — честное «недоступна»', async () => {
  const owner = createChat();
  await favourite(owner, 'one');
  const { code } = await share(owner);

  const stranger = await createChat().say('/start list_nosuchcode123');
  assert.match(callsOf(stranger).map((call) => call.body.text).join('\n'), /больше недоступна/);

  bot.getData().sharedLists[code].createdAt = new Date(Date.now() - 91 * 24 * 3600 * 1000).toISOString();
  const old = await createChat().say('/start list_' + code);
  assert.match(callsOf(old).map((call) => call.body.text).join('\n'), /больше недоступна/);

  bot.getData().sharedLists[code].createdAt = new Date().toISOString();
  bot.getData().objects.find((item) => item.id === 'one').status = 'draft';
  const empty = await createChat().say('/start list_' + code);
  assert.match(callsOf(empty).map((call) => call.body.text).join('\n'), /больше недоступна/);
});

test('у одного клиента не больше пяти подборок: самые старые уходят', async () => {
  const chat = createChat();
  const codes = [];
  for (const id of ['one', 'two', 'three', 'four', 'five', 'six']) {
    await favourite(chat, id);
    const { code } = await share(chat);
    bot.getData().sharedLists[code].createdAt = new Date(Date.now() - (10 - codes.length) * 1000).toISOString();
    codes.push(code);
  }
  const left = Object.keys(bot.getData().sharedLists);
  assert.equal(left.length, 5, left.join(','));
  assert.ok(!left.includes(codes[0]), 'самая старая ушла');
  assert.ok(left.includes(codes[5]));
});

test('данные клиента: подборки видны в выгрузке и уходят вместе с ним; чужие остаются', async () => {
  const owner = createChat();
  const other = createChat();
  await favourite(owner, 'one');
  await favourite(other, 'two');
  const mine = (await share(owner)).code;
  const theirs = (await share(other)).code;
  assert.deepEqual(bot.userDataExport(owner.user).sharedLists.map((list) => list.code), [mine]);
  bot.eraseUserData(owner.user);
  assert.ok(!bot.getData().sharedLists[mine], 'подборки хозяина удалены');
  assert.ok(bot.getData().sharedLists[theirs], 'чужая осталась');
});

test('формат данных: годные подборки читаются, мусор отбрасывается', async () => {
  const { normalizeLoadedData } = await import('../src/data-format.mjs');
  const loaded = normalizeLoadedData({ sharedLists: {
    goodcode1: { ids: ['a', 'b'], owner: '5', createdAt: '2026-10-01T00:00:00.000Z', opens: 3 },
    'bad code!': { ids: ['a'] },
    emptyone1: { ids: [] },
    notobject: 'x',
  } });
  assert.deepEqual(Object.keys(loaded.sharedLists), ['goodcode1']);
  assert.equal(loaded.sharedLists.goodcode1.opens, 3);
  assert.deepEqual(normalizeLoadedData({}).sharedLists, {});
});

test('«Мои данные» называют подборки, которыми клиент поделился', async () => {
  const chat = createChat();
  await favourite(chat, 'one');
  await share(chat);
  const step = await chat.press('privacy:open');
  const text = callsOf(step).map((call) => call.body.text).join('\n');
  assert.match(text, /подборки, которыми вы поделились: 1/);
});

test('недельный отчёт считает, сколько раз поделились и сколько раз открыли подборку; без этого строки нет', async () => {
  const { weeklyReportData, weeklyReportText } = await import('../src/notices.mjs');
  const quiet = weeklyReportData(new Date(), 'current');
  assert.deepEqual(quiet.sharedLists, { shared: 0, opened: 0, previousOpened: 0 });
  assert.ok(!weeklyReportText(quiet).includes('Подборки'), 'тихая неделя — строки нет');

  const owner = createChat();
  await favourite(owner, 'one', 'two');
  const { code } = await share(owner);
  await share(owner);
  await createChat().say('/start list_' + code);
  await createChat({ language: 'en' }).say('/start list_' + code);
  await createChat().say('/start list_nosuchcode123');

  const report = weeklyReportData(new Date(), 'current');
  assert.deepEqual({ shared: report.sharedLists.shared, opened: report.sharedLists.opened }, { shared: 2, opened: 2 }, 'открытие мёртвой ссылки не считается');
  assert.match(weeklyReportText(report), /📤 Подборки: поделились 2, открыли по ссылке 2/);
});

test('отправитель узнаёт, что получатель отметил объект: один раз на объект; в «Моё» у получателя — путь назад к подборке', async () => {
  const owner = createChat();
  await favourite(owner, 'one', 'two');
  const { code } = await share(owner);
  const guest = createChat();
  await guest.say('/start list_' + code);
  const { telegram } = require('./helpers/chat');
  telegram.calls = [];
  await guest.press('property:favorite:one');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const told = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(owner.id));
  assert.equal(told.length, 1, 'отправитель получил сообщение');
  assert.match(told[0].body.text, /По вашей подборке отметили: «Первая квартира»/);
  // снял и поставил снова — повторно не сообщаем
  await guest.press('property:favorite:one');
  telegram.calls = [];
  await guest.press('property:favorite:one');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(owner.id)).length, 0);
  // свой список хозяина сам себе не пишет
  await owner.say('/start list_' + code);
  telegram.calls = [];
  await owner.press('property:favorite:two');
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(owner.id)).length, 0);
  // «Моё»: строка «📤 Подборка 2» ведёт обратно
  const mine = await guest.say(bot.text.menu.ru.more);
  const row = buttonsOf(lastCard(mine)).find((button) => button.callback_data === 'catalog:shared:0');
  assert.ok(row && /^📤 Подборка 2$/.test(row.text), row && row.text);
});

test('новичок по ссылке: короткое приветствие без фото и вопроса о цели, затем подборка с объяснением', async () => {
  const owner = createChat();
  await favourite(owner, 'one', 'two');
  const { code } = await share(owner);
  const { telegram } = require('./helpers/chat');
  const fresh = createChat();
  delete fresh.user.preferredLanguage;
  fresh.user.languageCode = 'ru';
  telegram.calls = [];
  await fresh.say('/start list_' + code);
  const toGuest = telegram.calls.filter((call) => String(call.body.chat_id) === String(fresh.id) && ['sendMessage', 'sendPhoto'].includes(call.method));
  assert.ok(toGuest.length <= 2, 'приветствие и подборка — не больше двух сообщений: ' + toGuest.length);
  assert.ok(!toGuest.some((call) => /Что вам ближе/.test(String(call.body.text))), 'вопроса о цели нет');
  assert.match(String(toGuest[toGuest.length - 1].body.caption || toGuest[toGuest.length - 1].body.text), /Вам прислали подборку/);
});
