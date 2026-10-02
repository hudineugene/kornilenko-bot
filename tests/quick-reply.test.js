'use strict';

// Ответ шаблоном прямо из Telegram и кнопка WhatsApp на карточке заявки: список шаблонов, предпросмотр на языке клиента
// с подстановкой имени, отправка только после «Отправить», один раз; клиенту кнопки не подчиняются.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, telegram, ADMIN_CHAT, adminPress, adminMessages, createChat, resetData, cleanup,
} = require('./helpers/chat');

const TEMPLATES = [
  { id: 't1', title: 'Приветствие', text: { ru: 'Здравствуйте, {имя}! Давайте уточним детали.', en: 'Hello {name}, let us check the details.', es: '' }, updatedAt: new Date().toISOString() },
  { id: 't2', title: 'Только английский', text: { ru: '', en: 'Only English text', es: '' }, updatedAt: new Date().toISOString() },
];

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.replyTemplates = TEMPLATES.map((template) => ({ ...template, text: { ...template.text } }));
}));
test.after(cleanup);

const callbacks = (markup) => ((markup && markup.inline_keyboard) || []).flat().map((button) => button.callback_data).filter(Boolean);
const lastAdminMessage = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).pop();

async function inquiryWithCard(chat) {
  await chat.say('Подскажите по оформлению ипотеки');
  const inquiry = chat.inquiries[0];
  const targets = bot.getData().adminReplyTargets || {};
  const cardId = Number(Object.keys(targets).find((key) => targets[key].inquiryId === inquiry.id));
  assert.ok(cardId, 'карточка заявки у менеджера есть');
  return { inquiry, cardId };
}

test('на карточке есть «📝 Шаблон», когда шаблоны заведены; без них кнопки нет', async () => {
  const chat = createChat();
  await chat.say('Подскажите по оформлению ипотеки');
  const card = adminMessages().find((message) => /ипотек/.test(message.text));
  assert.ok(callbacks(card.markup).includes('inq:tpl:' + chat.inquiries[0].id));

  resetData((data) => { data.config.active = true; });
  const other = createChat();
  await other.say('Подскажите по оформлению ипотеки');
  const plain = adminMessages().find((message) => /ипотек/.test(message.text));
  assert.ok(!callbacks(plain.markup).some((data) => data.startsWith('inq:tpl:')), 'шаблонов нет — кнопки нет');
});

test('кнопка WhatsApp появляется, когда известен телефон клиента, и ведёт на чат с этим номером', async () => {
  const chat = createChat();
  chat.user.phone = '+34 600 111 222';
  await chat.say('Подскажите по оформлению ипотеки');
  const card = adminMessages().find((message) => /ипотек/.test(message.text));
  const button = card.markup.inline_keyboard.flat().find((item) => item.url);
  assert.equal(button.url, 'https://wa.me/34600111222');
  assert.match(button.text, /WhatsApp/);

  resetData((data) => { data.config.active = true; });
  const other = createChat();
  await other.say('Подскажите по оформлению ипотеки');
  const plain = adminMessages().find((message) => /ипотек/.test(message.text));
  assert.ok(!plain.markup.inline_keyboard.flat().some((item) => item.url && /wa\.me/.test(item.url)), 'без телефона WhatsApp не предлагается');
});

test('шаблон: список → предпросмотр на языке клиента с подстановкой → «Отправить» уходит клиенту как ответ менеджера, один раз', async () => {
  const chat = createChat();
  const { inquiry, cardId } = await inquiryWithCard(chat);

  telegram.calls = [];
  await adminPress('inq:tpl:' + inquiry.id, cardId);
  const list = lastAdminMessage();
  assert.ok(list, 'список пришёл отдельным сообщением');
  assert.deepEqual(callbacks(list.body.reply_markup), ['tpl:pick:0', 'tpl:pick:1', 'tpl:x']);
  assert.equal(list.body.reply_parameters.message_id, cardId, 'под карточкой');
  const listId = telegram.nextMessageId;

  telegram.calls = [];
  await adminPress('tpl:pick:0', listId);
  const preview = telegram.calls.find((call) => call.method === 'editMessageText');
  assert.match(preview.body.text, /Здравствуйте, [^!]+! Давайте уточним детали\./, 'имя подставлено');
  assert.ok(!/\{имя\}/.test(preview.body.text));
  assert.deepEqual(callbacks(preview.body.reply_markup), ['tpl:send:0', 'tpl:back']);
  assert.ok(!telegram.calls.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id)), 'до «Отправить» клиент ничего не получил');

  telegram.calls = [];
  await adminPress('tpl:send:0', listId);
  const toClient = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
  assert.equal(toClient.length, 1);
  assert.match(toClient[0].body.text, /Здравствуйте, .+! Давайте уточним детали\./);
  assert.equal(inquiry.replies.length, 1);
  assert.equal(inquiry.replies[0].source, 'telegram');
  assert.equal(inquiry.status, 'in_progress');
  const done = telegram.calls.filter((call) => call.method === 'editMessageText').pop();
  assert.match(done.body.text, /^✅ Отправлено: Приветствие/);

  telegram.calls = [];
  const again = await adminPress('tpl:send:0', listId);
  assert.ok(!telegram.calls.some((call) => String(call.body.chat_id) === String(chat.id) && call.method === 'sendMessage'), 'повторное нажатие ничего не шлёт');
  assert.equal(inquiry.replies.length, 1);
  assert.equal(again.popups.length, 1, '«устарело»');
});

test('клиент на английском получает английский текст; если шаблона на его языке нет, менеджер предупреждён, что уйдёт русский', async () => {
  const chat = createChat();
  chat.user.preferredLanguage = 'en';
  const { inquiry, cardId } = await inquiryWithCard(chat);
  await adminPress('inq:tpl:' + inquiry.id, cardId);
  const listId = telegram.nextMessageId;

  telegram.calls = [];
  await adminPress('tpl:pick:0', listId);
  assert.match(telegram.calls.find((call) => call.method === 'editMessageText').body.text, /Hello .+, let us check the details\./);

  // У испаноязычного клиента нет текста на его языке: уйдёт русский, и менеджер об этом предупреждён до отправки.
  const spanish = createChat();
  spanish.user.preferredLanguage = 'es';
  const second = await inquiryWithCard(spanish);
  await adminPress('inq:tpl:' + second.inquiry.id, second.cardId);
  const secondList = telegram.nextMessageId;
  telegram.calls = [];
  await adminPress('tpl:pick:0', secondList);
  const warned = telegram.calls.find((call) => call.method === 'editMessageText').body.text;
  assert.match(warned, /⚠️ Шаблона на языке клиента \(ES\) нет — уйдёт русский текст\./);
  assert.match(warned, /Здравствуйте/);
});

test('кнопки шаблонов подчиняются только менеджеру; «Закрыть» убирает список; устаревший список не отправляет ничего', async () => {
  const chat = createChat();
  const { inquiry, cardId } = await inquiryWithCard(chat);
  await adminPress('inq:tpl:' + inquiry.id, cardId);
  const listId = telegram.nextMessageId;

  telegram.calls = [];
  await chat.press('tpl:send:0', { messageId: listId });
  assert.ok(!telegram.calls.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id) && /Здравствуйте/.test(call.body.text)), 'клиент не отправит шаблон сам');
  assert.equal(inquiry.replies.length, 0);

  telegram.calls = [];
  await adminPress('tpl:x', listId);
  assert.ok(telegram.calls.some((call) => call.method === 'deleteMessage'), 'список убран');

  telegram.calls = [];
  const stale = await adminPress('tpl:send:0', 987654);
  assert.equal(stale.popups.length, 1);
  assert.equal(inquiry.replies.length, 0, 'неизвестный список ничего не отправляет');
});
