'use strict';

// Этап 48, часть 1: ответ менеджера из Telegram — реакция вместо сообщения, альбом одним ответом, правка доходит до клиента,
// ошибки человеческим языком, ответ в закрытую заявку открывает её; словарь как в панели.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bot, telegram, TOKEN, ADMIN_CHAT, createChat, resetData, cleanup, settle } = require('./helpers/chat');

test.after(cleanup);
test.beforeEach(() => resetData((data) => { data.config.adminName = 'Олег'; }));

const sentTo = (chatId) => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chatId));
const adminCardId = (inquiryId) => Number(Object.entries(bot.getData().adminReplyTargets).find(([key, target]) => !key.includes(':') && target.inquiryId === inquiryId)[0]);

function adminMessage(extra, replyTo, id = 700 + Math.floor(Math.random() * 1000)) {
  return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: id, date: Math.floor(Date.now() / 1000), from: { id: Number(ADMIN_CHAT), first_name: 'Олег' }, chat: { id: Number(ADMIN_CHAT), type: 'private' },
    ...(replyTo ? { reply_to_message: { message_id: replyTo, from: { id: 5550001 }, date: Math.floor(Date.now() / 1000), text: '📩 …' } } : {}), ...extra } };
}

async function waiting() {
  const chat = createChat();
  await chat.say('Можно посмотреть виллу в субботу?');
  return { chat, inquiry: chat.inquiries[0] };
}

test('ответ менеджера подтверждается реакцией 👌 на его сообщение, а не отдельным «✅ Сообщение отправлено»', async () => {
  const { inquiry } = await waiting();
  telegram.calls = [];
  const id = 7001;
  await bot.handleUpdate(adminMessage({ text: 'Да, в субботу в 11:00 удобно?' }, adminCardId(inquiry.id), id), TOKEN);
  await settle();
  const reaction = telegram.calls.find((call) => call.method === 'setMessageReaction');
  assert.ok(reaction);
  assert.deepEqual({ chat: String(reaction.body.chat_id), message: reaction.body.message_id, emoji: reaction.body.reaction[0].emoji }, { chat: ADMIN_CHAT, message: id, emoji: '👌' });
  assert.equal(sentTo(ADMIN_CHAT).length, 0, 'в чате менеджера лишнего сообщения нет');
});

test('альбом из трёх фото — одна шапка «Ответ менеджера» и три снимка, а не три шапки', async () => {
  const { chat, inquiry } = await waiting();
  telegram.calls = [];
  const cardId = adminCardId(inquiry.id);
  const part = (id) => adminMessage({ photo: [{ file_id: 'F' + id, file_unique_id: 'u' + id, width: 10, height: 10 }], media_group_id: 'album-1', caption: id === 7101 ? 'Планировки' : undefined }, cardId, id);
  await bot.processUpdates([part(7101), part(7102), part(7103)], TOKEN);
  await new Promise((resolve) => setTimeout(resolve, 2800));
  await settle();
  const toClient = sentTo(chat.id).filter((call) => /Ответ менеджера|Manager reply|Respuesta/i.test(call.body.text || ''));
  assert.equal(toClient.length, 1, 'одна шапка: ' + toClient.length);
  const copied = telegram.calls.filter((call) => (call.method === 'copyMessages' || call.method === 'copyMessage') && String(call.body.chat_id) === String(chat.id));
  const photos = copied.reduce((sum, call) => sum + (call.method === 'copyMessages' ? call.body.message_ids.length : 1), 0);
  assert.equal(photos, 3, 'все три снимка дошли');
  assert.equal(inquiry.replies.length, 1, 'это один ответ в заявке');
});

test('правка отправленного ответа доходит до клиента (текст правится у него же)', async () => {
  const { chat, inquiry } = await waiting();
  const id = 7201;
  await bot.handleUpdate(adminMessage({ text: 'Приходите в 11:00' }, adminCardId(inquiry.id), id), TOKEN);
  const reply = inquiry.replies[inquiry.replies.length - 1];
  assert.equal(reply.adminMessageId, id);
  telegram.calls = [];
  await bot.handleUpdate({ update_id: 5555001, edited_message: { message_id: id, date: Math.floor(Date.now() / 1000), edit_date: Math.floor(Date.now() / 1000), from: { id: Number(ADMIN_CHAT), first_name: 'Олег' }, chat: { id: Number(ADMIN_CHAT), type: 'private' }, text: 'Приходите в 12:00' } }, TOKEN);
  await settle();
  const edit = telegram.calls.find((call) => call.method === 'editMessageText' && String(call.body.chat_id) === String(chat.id));
  assert.ok(edit, 'сообщение у клиента исправлено');
  assert.match(edit.body.text, /Приходите в 12:00/);
  assert.equal(edit.body.message_id, reply.telegramMessageId);
  assert.equal(reply.text, 'Приходите в 12:00', 'и в заявке');
  assert.ok(telegram.calls.some((call) => call.method === 'setMessageReaction'), 'менеджеру — реакция');
});

test('клиент заблокировал бота: «Клиент заблокировал бота — не доставлено. Позвоните: +34…», а не сырая ошибка', async () => {
  const { chat, inquiry } = await waiting();
  chat.user.phone = '+34 600 111 222';
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    if (String(url).endsWith('/sendMessage') && String(body.chat_id) === String(chat.id)) {
      return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    return previousFetch(url, init);
  };
  try {
    telegram.calls = [];
    await bot.handleUpdate(adminMessage({ text: 'Здравствуйте!' }, adminCardId(inquiry.id)), TOKEN);
    await settle();
  } finally {
    global.fetch = previousFetch;
  }
  const answer = sentTo(ADMIN_CHAT).pop();
  assert.match(answer.body.text, /^❌ Клиент заблокировал бота — сообщение не доставлено\. Позвоните: \+34 600 111 222/);
  assert.doesNotMatch(answer.body.text, /Forbidden|bot was blocked/);
});

test('ответ в закрытую заявку открывает её и возвращает этап «Контакт»', async () => {
  const { inquiry } = await waiting();
  inquiry.status = 'closed';
  inquiry.pipelineStage = 'lost';
  await bot.handleUpdate(adminMessage({ text: 'Мы вернулись к вашему вопросу' }, adminCardId(inquiry.id)), TOKEN);
  assert.equal(inquiry.status, 'in_progress');
  assert.equal(inquiry.pipelineStage, 'contact');
});

test('словарь менеджерского Telegram — как в панели: «заявка» и «клиент», без «обращение» и «пользователь»', () => {
  const allowed = [/Сообщение пользователя ID/, /Обращение ID/, /пользовательский эмодзи/];
  const offenders = [];
  for (const file of ['inquiries', 'admin-commands', 'notices', 'viewings', 'status', 'retention', 'excel']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file + '.mjs'), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/^\s*\/\//.test(line)) return;
      const match = /'[^']*(?:бращени|ользовател)[^']*'/i.exec(line);
      if (match && !allowed.some((pattern) => pattern.test(line))) offenders.push(file + ':' + (index + 1) + ' ' + match[0].slice(0, 60));
    });
  }
  assert.deepEqual(offenders, []);
});
