'use strict';

// Консультант предлагает объекты ([[ACTION show: код или название]]) — бот показывает их карточки:
// фото, описание и кнопку. В режиме «только приложение» кнопка открывает объект в приложении.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup, telegram, property } = require('./helpers/chat');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const KEY = 'ga_test-key';

const agent = { actions: [], extra: {} };
const telegramStub = global.fetch;
global.fetch = async (url, init) => {
  if (!String(url).startsWith(AGENT_URL)) return telegramStub(url, init);
  const body = { reply: 'Подойдут два проекта у моря.', handoff: false, actions: agent.actions, ...agent.extra };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

test.beforeEach(() => {
  agent.actions = [];
  agent.extra = {};
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY };
    data.objects = [
      property('vista-mar', 'Виста Мар', 'active', { priceValue: 250000, currency: 'EUR' }),
      property('casa-sol', 'Каса Соль', 'active'),
      property('old-one', 'Старый дом', 'sold'),
    ];
  });
});
test.after(cleanup);

const cardsTo = (chat, before) => telegram.calls.slice(before).filter((call) => call.method === 'sendPhoto' && String(call.body.chat_id) === String(chat.id));

test('консультант назвал объекты — карточки после ответа, без повторов и проданных', async () => {
  agent.actions = [
    { type: 'show', value: 'VISTA-MAR' },
    { type: 'show', value: 'Виста Мар' },
    { type: 'show', value: 'Каса Соль' },
    { type: 'show', value: 'Старый дом' },
  ];
  const chat = createChat();
  const before = telegram.calls.length;
  const step = await chat.say('Что есть у моря до 300 тысяч?');
  assert.match(step.text, /два проекта у моря/);
  const cards = cardsTo(chat, before);
  assert.equal(cards.length, 2);
  assert.match(cards[0].body.caption, /Виста Мар/);
  assert.match(cards[1].body.caption, /Каса Соль/);
  assert.ok(JSON.stringify(cards[0].body.reply_markup).includes('property:'), 'кнопки карточки каталога');
});

test('режим «только приложение»: кнопка карточки открывает объект в приложении', async () => {
  bot.getData().config.miniApp = { enabled: true, url: 'https://app.example.com', appOnly: true };
  agent.actions = [{ type: 'show', value: 'Каса Соль' }];
  const chat = createChat();
  chat.user.appNudgeAt = new Date().toISOString();
  const before = telegram.calls.length;
  await chat.say('Покажите что-нибудь');
  const cards = cardsTo(chat, before);
  assert.equal(cards.length, 1);
  const button = cards[0].body.reply_markup.inline_keyboard[0][0];
  assert.equal(button.web_app.url, 'https://app.example.com?p=casa-sol');
});

test('без меток show карточек нет', async () => {
  const chat = createChat();
  const before = telegram.calls.length;
  await chat.say('Как с вами работать?');
  assert.equal(cardsTo(chat, before).length, 0);
});

test('консультант передал недовольного клиента — заявка менеджеру с пометкой «срочно»', async () => {
  agent.extra = { handoff: true, upset: true, summary: 'Третий раз спрашивает про сроки' };
  const chat = createChat();
  await chat.say('Вы мне уже третий раз не отвечаете!');
  assert.equal(chat.inquiries.length, 1);
  const first = chat.inquiries[0].text || (chat.inquiries[0].messages && chat.inquiries[0].messages[0] && chat.inquiries[0].messages[0].text) || '';
  assert.match(first, /^🔴 Клиент недоволен/);
});
