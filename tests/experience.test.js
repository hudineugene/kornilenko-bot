'use strict';

// Client and admin experience: promotion and price requests in one tap, one
// acknowledgement per open inquiry, compact admin notifications with status
// buttons, "only inquiries" mode with a daily activity digest.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, telegram, callbacksOf, createChat, adminPress, property, resetData, adminMessages, cleanup,
} = require('./helpers/chat');

const { menu: MENU, propertyActions: PROPERTY, interaction: INTERACTION } = bot.text;

function promotion(id, title, extra = {}) {
  return { id, enabled: true, title: { ru: title, en: '', es: '' }, text: { ru: 'Условия акции', en: '', es: '' }, imagesByLanguage: { ru: [], en: [], es: [] }, ...extra };
}

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('villa-no-price', 'Вилла без цены', 'active'));
  data.objects.push(property('flat-priced', 'Квартира с ценой', 'active', { priceValue: 250000, currency: 'EUR' }));
  data.promotions.push(promotion('promo-summer', 'Летняя скидка'));
}));
test.after(cleanup);

test.describe('client', () => {
  test('a promotion can be answered with one tap and shows no page counter for a single offer', async () => {
    const chat = createChat();
    const shown = await chat.say(MENU.ru.promotions);
    assert.equal(shown.last.text, '🔥 Летняя скидка\n\nУсловия акции');
    assert.deepEqual(callbacksOf(shown.last.markup), ['promotions:ask:promo-summer']);

    const answered = await chat.press('promotions:ask:promo-summer');
    assert.equal(answered.last.text, PROPERTY.ru.received + '\n\n🔥 Летняя скидка');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'question');
    assert.match(inquiry.text, /Акция «Летняя скидка»/);
    assert.ok(adminMessages().some((message) => message.text.startsWith('📩 Новое обращение: вопрос менеджеру') && message.text.includes('Летняя скидка')));
  });

  test('an ended promotion cannot be answered any more', async () => {
    const chat = createChat();
    bot.getData().promotions[0].endAt = new Date(Date.now() - 60000).toISOString();
    const answered = await chat.press('promotions:ask:promo-summer');
    assert.deepEqual(answered.popups, [INTERACTION.ru.stale]);
    assert.equal(chat.inquiries.length, 0);
  });

  test('"ask for the price" appears only on cards without a price', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    const cards = telegram.calls.filter((call) => call.method === 'sendPhoto');
    const noPrice = cards.find((call) => call.body.caption.includes('Вилла без цены'));
    assert.ok(callbacksOf(noPrice.body.reply_markup).includes('property:price:villa-no-price'));
    await chat.press('catalog:all:1');
    const priced = telegram.calls.filter((call) => call.method === 'sendPhoto').find((call) => call.body.caption.includes('Квартира с ценой'));
    assert.ok(!callbacksOf(priced.body.reply_markup).some((data) => data.startsWith('property:price:')));
  });

  test('"ask for the price" creates a request about the property', async () => {
    const chat = createChat();
    const answered = await chat.press('property:price:villa-no-price');
    assert.equal(answered.last.text, PROPERTY.ru.received + '\n\n🏠 Вилла без цены');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.propertyId, 'villa-no-price');
    assert.match(inquiry.text, new RegExp(PROPERTY.ru.askPrice));
    const notification = adminMessages().find((message) => message.text.startsWith('📩'));
    assert.equal(notification.text, [
      '📩 Новое обращение: вопрос по объекту',
      '👤 Анна · RU',
      '',
      '🏠 Вилла без цены',
      PROPERTY.ru.askPrice,
      '',
      '↩️ Ответьте на это сообщение — ответ получит клиент.',
    ].join('\n'));
  });

  test('messages sent in a row are acknowledged once', async () => {
    const chat = createChat();
    const first = await chat.say('Здравствуйте, есть квартиры у моря?');
    assert.equal(first.replies.length, 1);
    const second = await chat.say('И можно ли в ипотеку?');
    assert.equal(second.replies.length, 0, 'no second "message received"');
    assert.equal(chat.inquiries.length, 1);
    assert.match(chat.inquiries[0].text, /ипотеку/);
    // After a pause the client is told again that the message was received.
    chat.inquiries[0].updatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const later = await chat.say('Добрый вечер, есть новости?');
    assert.equal(later.replies.length, 1);
  });
});

test('a follow-up after "ask a question" joins the same inquiry', async () => {
  const chat = createChat();
  await chat.press('contact:question');
  const question = await chat.say('Есть ли квартиры до 200 000 €?');
  assert.equal(question.replies.length, 1);
  const followUp = await chat.say('И можно ли оформить ипотеку?');
  assert.equal(followUp.replies.length, 0);
  assert.equal(chat.inquiries.length, 1);
  assert.equal(chat.inquiries[0].text, 'Есть ли квартиры до 200 000 €?\n\nИ можно ли оформить ипотеку?');
});

test.describe('admin chat copies', () => {
  async function deliver(update) {
    telegram.calls = [];
    await bot.processUpdates([update], '12345:ABCDEFGHIJKLMNOPQRSTUV');
    await new Promise((resolve) => setTimeout(resolve, 15));
    return telegram.calls;
  }

  test('"check availability" under a property card does not copy the bot\'s own card', async () => {
    const chat = createChat();
    const calls = await deliver({
      update_id: 880001,
      callback_query: {
        id: 'cb-availability',
        from: { id: chat.id, first_name: 'Анна' },
        data: 'property:availability:villa-no-price',
        // Telegram sends the message the button belongs to: the bot's photo card.
        message: { message_id: 4321, date: 0, from: { id: 5550001, is_bot: true, first_name: 'Bot' }, chat: { id: chat.id, type: 'private' }, photo: [{ file_id: 'card' }], caption: 'Вилла без цены' },
      },
    });
    assert.equal(calls.filter((call) => call.method === 'copyMessage').length, 0);
    assert.ok(adminMessages().some((message) => message.text.startsWith('📩 Новое обращение: вопрос по объекту')));
    assert.equal(chat.inquiries[0].sourceMessageId, 4321, 'the admin\'s reply still quotes the card in the client\'s chat');
  });

  test('a voice message from the client is still copied to the admin chat', async () => {
    const chat = createChat();
    const calls = await deliver({
      update_id: 880002,
      message: { message_id: 77, date: Math.floor(Date.now() / 1000), from: { id: chat.id, first_name: 'Анна' }, chat: { id: chat.id, type: 'private' }, voice: { file_id: 'v', duration: 5 } },
    });
    const copies = calls.filter((call) => call.method === 'copyMessage');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].body.message_id, 77);
  });
});

test.describe('admin', () => {
  test('an inquiry notification is short and has status buttons', async () => {
    const chat = createChat();
    await chat.press('contact:question');
    await chat.say('Нужна консультация по ВНЖ');
    const [notification] = adminMessages();
    assert.equal(notification.text, [
      '📩 Новое обращение: вопрос менеджеру',
      '👤 Анна · RU',
      '',
      'Нужна консультация по ВНЖ',
      '',
      '↩️ Ответьте на это сообщение — ответ получит клиент.',
    ].join('\n'));
    const id = chat.inquiries[0].id;
    assert.deepEqual(callbacksOf(notification.markup), ['inq:in_progress:' + id, 'inq:closed:' + id]);
  });

  test('status buttons change the inquiry and the buttons', async () => {
    const chat = createChat();
    await chat.say('Хочу купить дом');
    const inquiry = chat.inquiries[0];

    let pressed = await adminPress('inq:in_progress:' + inquiry.id, 777);
    assert.equal(inquiry.status, 'in_progress');
    assert.deepEqual(pressed.popups, ['Статус: в работе']);
    let edit = pressed.calls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.equal(edit.body.message_id, 777);
    assert.deepEqual(callbacksOf(edit.body.reply_markup), ['inq:closed:' + inquiry.id]);

    pressed = await adminPress('inq:closed:' + inquiry.id, 777);
    assert.equal(inquiry.status, 'closed');
    edit = pressed.calls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.deepEqual(callbacksOf(edit.body.reply_markup), ['inq:new:' + inquiry.id]);

    await adminPress('inq:new:' + inquiry.id, 777);
    assert.equal(inquiry.status, 'new');
  });

  test('status buttons pressed outside the admin chat change nothing', async () => {
    const chat = createChat();
    await chat.say('Хочу купить дом');
    const inquiry = chat.inquiries[0];
    const pressed = await chat.press('inq:closed:' + inquiry.id);
    assert.equal(inquiry.status, 'new');
    assert.deepEqual(pressed.popups, [INTERACTION.ru.stale]);
    assert.equal(bot.userById('9990001'), undefined, 'the admin is not registered as a client');
  });

  test('navigation notices are one short block without repeated details', async () => {
    bot.getData().config.notifyMode = 'all';
    const chat = createChat();
    await chat.say(MENU.ru.promotions);
    assert.deepEqual(adminMessages().map((message) => message.text), ['👀 Открыл раздел «Акции»\n👤 Анна · RU']);
  });

  test('"only inquiries" becomes the mode once for existing installations', () => {
    assert.equal(bot.normalizeLoadedData({ version: 14, config: { notifyMode: 'all' } }).config.notifyMode, 'inquiries');
    assert.equal(bot.normalizeLoadedData({ version: 15, config: { notifyMode: 'all' } }).config.notifyMode, 'all');
    assert.equal(bot.normalizeLoadedData({}).config.notifyMode, 'inquiries');
  });

  test('the daily digest summarises yesterday once, after 9:00', async () => {
    const data = bot.getData();
    const now = new Date(2026, 8, 18, 10, 0);
    const yesterday = new Date(2026, 8, 17, 10, 0).toISOString().slice(0, 10);
    data.analytics.daily[yesterday] = { received: 7, sent: 9, reactions: 0, inquiries: 2, menu: { objects: 4, promotions: 1 } };
    const chat = createChat();
    chat.user.firstSeenAt = yesterday + 'T12:00:00.000Z';

    assert.equal(await bot.runDailyDigest(new Date(2026, 8, 18, 8, 30)), '', 'not before 9:00');
    const digest = await bot.runDailyDigest(now);
    assert.equal(digest, [
      '📊 Активность за 17.09.2026',
      '',
      'Новых пользователей: 1',
      'Сообщений от клиентов: 7',
      'Новых обращений: 2',
      '',
      'Открывали разделы:',
      '• Наши объекты — 4',
      '• Акции — 1',
    ].join('\n'));
    assert.deepEqual(adminMessages().map((message) => message.text), [digest]);
    assert.equal(await bot.runDailyDigest(new Date(2026, 8, 18, 15, 0)), '', 'only once a day');
  });

  test('no digest in "all actions" mode or for a quiet day', async () => {
    const data = bot.getData();
    data.config.notifyMode = 'all';
    assert.equal(await bot.runDailyDigest(new Date(2026, 8, 18, 10, 0)), '');
    data.config.notifyMode = 'inquiries';
    assert.equal(await bot.runDailyDigest(new Date(2026, 8, 18, 10, 0)), '');
    assert.equal(adminMessages().length, 0);
  });
});
