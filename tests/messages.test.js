'use strict';

// Free messages from a client: when the bot confirms that the message reached
// the manager, what happens to a request written in the client's own words,
// and a language typed instead of tapped.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, adminNotifications, cleanup } = require('./helpers/chat');

const { lead: LEAD } = bot.text;

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('flat-benidorm-01', 'Квартира в Бенидорме', 'active', { priceValue: 250000, currency: 'EUR' }));
  data.objects.push(property('villa-altea-02', 'Вилла в Альтее', 'active', { priceValue: 690000, currency: 'EUR', propertyType: 'villa', bedrooms: 4, bathrooms: 3, area: 220 }));
}));
test.after(cleanup);

const fallback = () => bot.getData().config.messages.ru.fallback;

test.describe('confirming a message reached the manager', () => {
  test('a question right after a submitted form is answered, not silently merged', async () => {
    const chat = createChat();
    const ru = LEAD.ru;
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.say('+34 600 111 222');
    const submitted = await chat.say(ru.timeOptions[0]);
    assert.equal(submitted.last.text, ru.success);

    const asked = await chat.say('А есть что-то с видом на море?');
    assert.ok(asked.last.text.includes(fallback()), 'клиент должен услышать, что сообщение получено');
    const [inquiry] = chat.inquiries;
    assert.equal(chat.inquiries.length, 1, 'сообщение подклеивается к заявке, а не создаёт вторую');
    assert.match(inquiry.text, /вид[а-я]* на море/i);
    assert.ok(inquiry.acknowledgedAt, 'время подтверждения запоминается');
  });

  test('messages in a row are confirmed once, a later one again', async () => {
    const chat = createChat();
    const first = await chat.say('Здравствуйте!');
    assert.ok(first.last.text.includes(fallback()));

    const second = await chat.say('Подскажите по ипотеке');
    assert.deepEqual(second.replies, [], 'второе сообщение подряд не подтверждается повторно');

    const [inquiry] = chat.inquiries;
    inquiry.acknowledgedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const later = await chat.say('Всё ещё жду ответа');
    assert.ok(later.last.text.includes(fallback()), 'после паузы бот снова подтверждает получение');
  });
});

test.describe('a request written in the client own words', () => {
  test('the catalog answers at once and the manager sees the request', async () => {
    const chat = createChat();
    const found = await chat.say('Куплю квартиру в Бенидорме до 300 000 €');
    assert.ok(found.calls.some((call) => call.method === 'sendPhoto'), 'клиент сразу видит подходящие объекты');
    assert.deepEqual(found.replies, [], 'лишнего текста клиенту не приходит');

    const [inquiry] = chat.inquiries;
    assert.equal(chat.inquiries.length, 1);
    assert.equal(inquiry.searchLead, true);
    assert.match(inquiry.text, /Куплю квартиру в Бенидорме/);
    assert.equal(bot.awaitingReply(inquiry), false, 'клиент получил каталог — ответа никто не ждёт');
    assert.ok(adminNotifications().some((text) => text.includes('искал объекты сам')), 'менеджер видит запрос');
  });

  test('a search lead is not counted as waiting and gets no reminder', async () => {
    const chat = createChat();
    await chat.say('Куплю квартиру в Бенидорме до 300 000 €');
    const [inquiry] = chat.inquiries;
    inquiry.createdAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    bot.getData().config.reminderHours = 2;
    const reminded = await bot.runInquiryReminders(new Date(new Date().setHours(11, 0, 0, 0)));
    assert.deepEqual(reminded, [], 'по самостоятельному поиску напоминания не нужны');
  });

  test('a real question after a search turns it into a conversation that waits', async () => {
    const chat = createChat();
    await chat.say('Куплю квартиру в Бенидорме до 300 000 €');
    const asked = await chat.say('А когда можно посмотреть?');
    assert.ok(asked.last.text.includes(fallback()));
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.searchLead, false);
    assert.equal(bot.awaitingReply(inquiry), true);
  });
});

test.describe('a language typed instead of tapped', () => {
  test('a newcomer who writes the language name gets the menu, not the picker', async () => {
    const chat = createChat({ language: '' });
    chat.user.preferredLanguage = '';
    const greeted = await chat.say('Привет');
    assert.equal(chat.user.preferredLanguage, 'en', 'язык Telegram неизвестен — говорим по-английски');
    assert.deepEqual(greeted.calls.filter((call) => String(call.body.text || '').includes('Выберите язык')), [], 'экрана выбора нет');

    const chosen = await chat.say('Русский');
    assert.equal(chat.user.preferredLanguage, 'ru');
    assert.ok(chosen.calls.some((call) => ['sendMessage', 'sendPhoto'].includes(call.method)), 'клиент получает приветствие');
  });

  test('English and Spanish names work too', async () => {
    const english = createChat({ language: '' });
    english.user.preferredLanguage = '';
    await english.say('English');
    assert.equal(english.user.preferredLanguage, 'en');

    const spanish = createChat({ language: '' });
    spanish.user.preferredLanguage = '';
    await spanish.say('Español');
    assert.equal(spanish.user.preferredLanguage, 'es');
  });

  test('an unrelated message is answered instead of asking about the language', async () => {
    const chat = createChat({ language: '' });
    chat.user.preferredLanguage = '';
    const step = await chat.say('Сколько стоит вилла?');
    assert.deepEqual(step.calls.filter((call) => String(call.body.text || '').includes('Выберите язык')), []);
    assert.equal(chat.user.preferredLanguage, 'en');
    assert.equal(chat.inquiries.length, 1, 'вопрос дошёл до менеджера');
  });
});
