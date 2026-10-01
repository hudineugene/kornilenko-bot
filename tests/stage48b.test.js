'use strict';

// Этап 48, часть 2: один сборщик карточки заявки. Язык клиента — отдельной строкой; подписи полей и название объекта по-русски;
// имя, телефон и объект не повторяются; подсказка — только на первой карточке; повторные сообщения клиента — коротко ответом на неё.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, ADMIN_CHAT, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = ADMIN_CHAT;
  data.objects.push(property('villa-sol', 'Вилла Сол', 'active', { priceValue: 400000, currency: 'EUR' }));
}));

const adminCards = (calls = telegram.calls) => calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).map((call) => call.body);
const countOf = (text, part) => String(text).split(part).length - 1;

test('вопрос по объекту: объект один раз и по-русски, язык — отдельной строкой, а не «· ES»', async () => {
  const chat = createChat({ language: 'es' });
  telegram.calls = [];
  await chat.press('property:price:villa-sol');
  const [card] = adminCards();
  assert.match(card.text, /^📩 Новая заявка: вопрос по объекту\n/);
  assert.match(card.text, /\n🌐 Клиент пишет по-испански\n/);
  assert.doesNotMatch(card.text, /· ES/);
  assert.equal(countOf(card.text, 'Вилла Сол'), 1, 'объект назван один раз: ' + card.text);
  assert.match(card.text, /🔖 Вилла Сол\nУзнать цену/, 'и «Узнать цену» по-русски, а не «Ask for the price» на языке клиента');
  assert.doesNotMatch(card.text, /Pregunta|precio\?|Ask for/i);
  assert.match(card.text, /↩️ Ответьте на это сообщение/, 'первая карточка — с подсказкой');
});

test('запись на просмотр от испанца: «Дата», «Время» по-русски (слова клиента — как он их выбрал)', async () => {
  const chat = createChat({ language: 'es' });
  const step = await chat.press('property:viewing:villa-sol');
  const day = step.last.buttons[1];
  const time = await chat.say(day);
  await chat.say(time.last.buttons.find((label) => !label.startsWith('✕')));
  await chat.say(bot.text.viewing.es.confirm);
  const inquiry = chat.inquiries.find((item) => item.type === 'viewing');
  assert.ok(inquiry, 'запись создана');
  assert.match(inquiry.text, /Дата: /);
  assert.match(inquiry.text, /Время: /);
  assert.doesNotMatch(inquiry.text, /Fecha|Hora/);
  const [card] = adminCards().filter((body) => /запись на просмотр/.test(body.text));
  assert.ok(card && !/Fecha|Hora/.test(card.text));
});

test('анкета звонка: имя и телефон один раз — в шапке, а не ещё раз в теле', async () => {
  const chat = createChat();
  telegram.calls = [];
  await chat.press('lead:call');
  await chat.say('+34 600 111 222');
  await chat.say('Сегодня после 18:00');
  const card = adminCards().find((body) => /заявка на звонок/.test(body.text));
  assert.ok(card, 'карточка звонка есть');
  assert.equal(countOf(card.text, '+34 600 111 222'), 1, 'телефон один раз: ' + card.text);
  assert.equal(countOf(card.text, 'Анна'), 1, 'имя один раз: ' + card.text);
  assert.match(card.text, /Способ связи: /);
});

test('три сообщения подряд: одна полная карточка и два коротких ответа на неё — без заголовка и кнопок', async () => {
  const chat = createChat();
  telegram.calls = [];
  await chat.say('Здравствуйте, есть вилла у моря?');
  await chat.say('И бассейн нужен');
  await chat.say('Бюджет до 500 тысяч');
  const cards = adminCards();
  assert.equal(cards.length, 3);
  assert.match(cards[0].text, /^📩 Новая заявка/);
  assert.ok(cards[0].reply_markup, 'у первой — кнопки');
  for (const compact of cards.slice(1)) {
    assert.match(compact.text, /^💬 Анна: /);
    assert.doesNotMatch(compact.text, /Новое сообщение|↩️/);
    assert.equal(compact.reply_markup, undefined, 'кнопок нет');
    assert.ok(compact.reply_parameters && compact.reply_parameters.message_id, 'ответом на первую карточку');
  }
  assert.ok(cards.slice(1).every((body) => body.text.split('\n').length <= 3), 'коротко');
});

test('подсказка «Ответьте на это сообщение» — только на первой карточке: в напоминании её нет', async () => {
  const chat = createChat();
  await chat.say('Нужна консультация');
  const inquiry = chat.inquiries[0];
  inquiry.clientMessageAt = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  inquiry.createdAt = inquiry.clientMessageAt;
  bot.getData().config.reminderHours = 2;
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  inquiry.createdAt = new Date(noon.getTime() - 5 * 3600 * 1000).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  telegram.calls = [];
  await bot.runInquiryReminders(noon);
  const [reminder] = adminCards();
  assert.match(reminder.text, /^⏰ Ждёт ответа/);
  assert.doesNotMatch(reminder.text, /↩️ Ответьте на это сообщение/);
});
