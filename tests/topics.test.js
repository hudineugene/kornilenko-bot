'use strict';

// Тема обращения по словам клиента: метка «🏷 Тема: …» на карточке в Telegram и в диалоге панели — там, где сообщение длинное
// или вопросов несколько; короткие сообщения и стандартные кнопки меток не получают.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, ADMIN_CHAT, telegram, createChat, resetData, cleanup } = require('./helpers/chat');

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

const adminCards = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).map((call) => call.body.text);

const LONG = 'Здравствуйте, интересуют апартаменты в Финестрате. Подскажите цену и условия рассрочки, какие нужны документы и когда сдача?';

test('длинное первое сообщение: на карточке «🏷 Тема» из первых трёх тем; тема записана в заявку', async () => {
  const chat = createChat();
  telegram.calls = [];
  await chat.say(LONG);
  assert.deepEqual(chat.inquiries[0].topics, ['цена', 'рассрочка и оплата', 'документы']);
  assert.ok(adminCards().some((text) => text.includes('🏷 Тема: цена, рассрочка и оплата, документы')));
});

test('короткое сообщение и стандартные кнопки меток не получают', async () => {
  const chat = createChat();
  telegram.calls = [];
  await chat.say('Нужна консультация по ВНЖ');
  assert.equal('topics' in chat.inquiries[0], false);
  assert.ok(!adminCards().some((text) => text.includes('🏷 Тема')));
});

test('следующие сообщения в той же заявке дополняют темы; запись на просмотр и звонок меток не имеют', async () => {
  const chat = createChat();
  await chat.say('Здравствуйте! Хотим купить квартиру для себя, расскажите, пожалуйста, подробнее про варианты и про сам проект.');
  assert.equal('topics' in chat.inquiries[0], false, 'про что именно — не ясно');
  await chat.say('Когда сдача и есть ли рассрочка?');
  assert.deepEqual(chat.inquiries[0].topics, ['рассрочка и оплата', 'сроки сдачи']);
});

test('метка переживает загрузку данных: до трёх слов, мусор отбрасывается', () => {
  const data = bot.normalizeLoadedData({
    version: 52,
    inquiries: [
      { id: 'a', userId: '1', chatId: '1', text: 'x', topics: ['цена', 'ипотека', 'документы', 'лишняя', ''] },
      { id: 'b', userId: '1', chatId: '1', text: 'x', topics: 'не список' },
    ],
  });
  const byId = Object.fromEntries(data.inquiries.map((item) => [item.id, item]));
  assert.deepEqual(byId.a.topics, ['цена', 'ипотека', 'документы']);
  assert.equal('topics' in byId.b, false);
});

test('в панели метка стоит в строке диалога рядом с объектом', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-inquiries.mjs', ''), 'utf8');
  assert.match(view, /class="conversation-topics"/);
  assert.match(view, /item\.topics\.join/);
});
