'use strict';

// Этап 47: менеджер в Telegram — не терять клиента и не отвечать дважды. Три чата: главный администратор Олег и менеджеры
// Мария и Пётр. Состояние заявки — строкой внизу карточки, одинаково у всех; «В работу» не отбирает заявку молча; ответ
// одного виден остальным; напоминание — о каждом, кто ждёт.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, ADMIN_CHAT, createChat, adminPress, resetData, cleanup, settle } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const MARIA = '8880001';
const PETER = '8880002';
const HOUR = 60 * 60 * 1000;

test.beforeEach(() => resetData((data) => {
  data.config.adminName = 'Олег';
  data.config.reminderHours = 2;
  data.config.managers = [
    { id: 'm1', name: 'Мария', chatId: MARIA, verifiedAt: '' },
    { id: 'm2', name: 'Пётр', chatId: PETER, verifiedAt: '' },
  ];
}));
test.after(cleanup);

const edits = () => telegram.calls.filter((call) => call.method === 'editMessageText');
const lastLineOf = (text) => String(text).split('\n').filter(Boolean).pop();

function cardMessageId(chatId, inquiryId) {
  const entries = Object.entries(bot.getData().adminReplyTargets).filter(([key, target]) => target.inquiryId === inquiryId && target.card
    && (String(chatId) === ADMIN_CHAT ? !key.includes(':') : key.startsWith(chatId + ':')));
  return Number(entries[0][0].split(':').pop());
}

function managerPress(chatId, data, messageId = 5) {
  return bot.handleUpdate({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'cb' + Math.random(), from: { id: Number(chatId), first_name: 'M' }, data, message: { message_id: messageId, chat: { id: Number(chatId) } } } }, TOKEN);
}

function managerReply(chatId, name, text, replyTo) {
  return bot.handleUpdate({
    update_id: Math.floor(Math.random() * 1e9),
    message: { message_id: 900 + Math.floor(Math.random() * 1000), date: Math.floor(Date.now() / 1000), from: { id: Number(chatId), first_name: name }, chat: { id: Number(chatId), type: 'private' }, text,
      reply_to_message: { message_id: replyTo, from: { id: 5550001 }, date: Math.floor(Date.now() / 1000), text: '📩 …' } },
  }, TOKEN);
}

async function newInquiry(text = 'Можно посмотреть виллу в субботу?') {
  const chat = createChat();
  await chat.say(text);
  return { chat, inquiry: chat.inquiries[0] };
}

test('карточка с первой секунды несёт состояние внизу, а текст карточки запомнен у каждого из трёх чатов', async () => {
  const { inquiry } = await newInquiry();
  for (const chatId of [ADMIN_CHAT, MARIA, PETER]) {
    const target = Object.entries(bot.getData().adminReplyTargets).find(([key, item]) => item.inquiryId === inquiry.id && item.card && (chatId === ADMIN_CHAT ? !key.includes(':') : key.startsWith(chatId + ':')));
    assert.ok(target, chatId + ': карточка запомнена');
    assert.ok(!/🆕 Ждёт ответа/.test(target[1].card), 'состояние в запомненный текст не входит: оно считается заново');
  }
  const sent = telegram.calls.filter((call) => call.method === 'sendMessage' && [ADMIN_CHAT, MARIA, PETER].includes(String(call.body.chat_id)) && /^📩/.test(call.body.text));
  assert.equal(sent.length, 3);
  assert.ok(sent.every((call) => lastLineOf(call.body.text) === '🆕 Ждёт ответа'), 'у всех — «Ждёт ответа»');
});

test('«В работу» у Марии: во всех трёх чатах одна и та же строка «Ведёт: Мария»', async () => {
  const { inquiry } = await newInquiry();
  telegram.calls = [];
  await managerPress(MARIA, 'inq:in_progress:' + inquiry.id, cardMessageId(MARIA, inquiry.id));
  await settle();
  const updated = edits();
  assert.deepEqual(updated.map((call) => String(call.body.chat_id)).sort(), [ADMIN_CHAT, MARIA, PETER].sort(), 'карточка обновилась у всех');
  const lines = new Set(updated.map((call) => lastLineOf(call.body.text)));
  assert.equal(lines.size, 1, 'одна строка у всех: ' + [...lines].join(' | '));
  assert.match([...lines][0], /^⏳ Ведёт: Мария, с \d{2}:\d{2} — клиент ждёт ответа$/);
  assert.ok(updated.every((call) => call.body.text.startsWith('📩')), 'остальной текст карточки сохранён');
  assert.ok(updated.every((call) => call.body.reply_markup), 'кнопки на месте');
});

test('Мария ответила из Telegram — у Олега и Петра карточка показывает «Ответ: Мария», заявка её, если была ничья', async () => {
  const { inquiry } = await newInquiry();
  telegram.calls = [];
  await managerReply(MARIA, 'Мария', 'Да, в субботу в 11:00 удобно?', cardMessageId(MARIA, inquiry.id));
  await settle();
  assert.equal(inquiry.assignee, 'Мария');
  assert.ok(inquiry.takenAt);
  const toOthers = edits().filter((call) => [ADMIN_CHAT, PETER].includes(String(call.body.chat_id)));
  assert.equal(toOthers.length, 2, 'карточки у Олега и Петра обновлены');
  for (const call of toOthers) assert.match(lastLineOf(call.body.text), /^💬 Ответ: Мария, \d{2}:\d{2}$/);
});

test('перехват: «В работу» у Петра, когда заявку ведёт Мария, ничего не отбирает, а спрашивает; «Забрать себе» — отбирает и сообщает Марии', async () => {
  const { inquiry } = await newInquiry();
  await managerPress(MARIA, 'inq:in_progress:' + inquiry.id, cardMessageId(MARIA, inquiry.id));
  telegram.calls = [];
  await managerPress(PETER, 'inq:in_progress:' + inquiry.id, cardMessageId(PETER, inquiry.id));
  await settle();
  assert.equal(inquiry.assignee, 'Мария', 'молча не перехвачено');
  const popup = telegram.calls.filter((call) => call.method === 'answerCallbackQuery').pop();
  assert.equal(popup.body.text, 'Заявку ведёт Мария');
  const prompt = telegram.calls.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === PETER);
  assert.match(prompt.body.text, /Заявку ведёт Мария\. Забрать себе\?/);
  assert.deepEqual(prompt.body.reply_markup.inline_keyboard[0].map((button) => button.text), ['Забрать себе', 'Оставить']);

  telegram.calls = [];
  await managerPress(PETER, 'inq:keep:' + inquiry.id, 77);
  assert.equal(inquiry.assignee, 'Мария');
  assert.ok(telegram.calls.some((call) => call.method === 'deleteMessage' && String(call.body.chat_id) === PETER), 'вопрос убран');

  telegram.calls = [];
  await managerPress(PETER, 'inq:take:' + inquiry.id, 78);
  await settle();
  assert.equal(inquiry.assignee, 'Пётр');
  const toMaria = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === MARIA);
  assert.match(toMaria[0].body.text, /Пётр забрал\(а\) заявку/, 'Мария узнала');
  assert.ok(edits().every((call) => /Ведёт: Пётр/.test(lastLineOf(call.body.text))), 'у всех теперь «Ведёт: Пётр»');
});

test('«В работу» на ничьей заявке и на своей собственной проходит как раньше', async () => {
  const { inquiry } = await newInquiry();
  await managerPress(MARIA, 'inq:in_progress:' + inquiry.id);
  assert.equal(inquiry.assignee, 'Мария');
  telegram.calls = [];
  await managerPress(MARIA, 'inq:in_progress:' + inquiry.id);
  assert.equal(telegram.calls.some((call) => call.method === 'sendMessage' && /Забрать себе/.test(call.body.text || '')), false, 'у своей заявки вопроса нет');
});

test('закрытие: «✔️ Закрыта» у всех; подтверждение просмотра назначает того, кто подтвердил', async () => {
  const { inquiry } = await newInquiry();
  telegram.calls = [];
  await managerPress(PETER, 'inq:closed:' + inquiry.id, cardMessageId(PETER, inquiry.id));
  await settle();
  assert.ok(edits().length >= 3 && edits().every((call) => lastLineOf(call.body.text) === '✔️ Закрыта'));

  const second = createChat();
  await second.press('property:viewing:' + 'none').catch(() => {});
  const viewing = { id: 'v1', userId: String(second.id), chatId: String(second.id), type: 'viewing', status: 'new', text: 'Запись на просмотр', language: 'ru', replies: [], messages: [],
    viewing: { date: '2099-10-10', time: '10:00', requestedAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(), assignee: '' };
  bot.getData().inquiries.push(viewing);
  await managerPress(MARIA, 'inq:confirm:' + viewing.id).catch(() => {});
  assert.equal(viewing.assignee, 'Мария', 'кто подтвердил — тот и ведёт');
});

test('/inbox: один клиент — одна строка; менеджеру без своих заявок — «у коллег ждут: N»; /stats считает клиентов', async () => {
  const { chat, inquiry } = await newInquiry('Первый вопрос');
  // у того же клиента вторая ждущая заявка
  const second = { ...JSON.parse(JSON.stringify(inquiry)), id: 'second-inquiry', type: 'lead', text: 'Позвоните мне', createdAt: new Date(Date.now() + 1000).toISOString(), clientMessageAt: new Date(Date.now() + 1000).toISOString() };
  bot.getData().inquiries.push(second);
  const { inboxFor, statsText } = await import('../src/admin-commands.mjs');
  const main = { chatId: ADMIN_CHAT, name: 'Олег', main: true };
  assert.equal(inboxFor(main).length, 1, 'у клиента две заявки — в списке одна');
  assert.match(statsText(), /📥 Ждут ответа: 1 — \/inbox/, 'клиентов, а не заявок');

  inquiry.assignee = 'Пётр';
  second.assignee = 'Пётр';
  telegram.calls = [];
  await bot.handleUpdate({ update_id: 424242, message: { message_id: 3, date: Math.floor(Date.now() / 1000), from: { id: Number(MARIA), first_name: 'Мария' }, chat: { id: Number(MARIA), type: 'private' }, text: '/inbox' } }, TOKEN);
  await settle();
  const answer = telegram.calls.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === MARIA);
  assert.match(answer.body.text, /^📥 У вас нет заявок без ответа; у коллег ждут: 1\./);
  assert.ok(chat);
});

test('копия фото в тихие часы приходит без звука', async () => {
  bot.getData().config.notifyPrefs = { kinds: {}, quiet: { enabled: true, from: '00:00', to: '23:59' } };
  const client = createChat();
  telegram.calls = [];
  await bot.processUpdates([{ update_id: 990777, message: { message_id: 55, date: Math.floor(Date.now() / 1000), from: { id: client.id, first_name: 'Анна' }, chat: { id: client.id, type: 'private' }, photo: [{ file_id: 'P1', file_unique_id: 'u1', width: 10, height: 10 }], caption: 'Планировка' } }], TOKEN);
  await settle();
  const copies = telegram.calls.filter((call) => call.method === 'copyMessage');
  assert.ok(copies.length >= 3, 'копии ушли всем трём чатам');
  assert.ok(copies.every((call) => call.body.disable_notification === true), 'и все без звука');
});

test('«Напоминания: не присылать» не отмечает заявку напомненной, а после включения напоминание приходит', async () => {
  const { inquiry } = await newInquiry('Нужна консультация');
  inquiry.createdAt = new Date(Date.now() - 5 * HOUR).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  bot.getData().config.notifyPrefs = { kinds: { reminder: 'off' }, quiet: {} };
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  inquiry.createdAt = new Date(noon.getTime() - 5 * HOUR).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  assert.deepEqual(await bot.runInquiryReminders(noon), []);
  assert.equal(inquiry.remindedSince || '', '');
  bot.getData().config.notifyPrefs = { kinds: {}, quiet: {} };
  assert.deepEqual(await bot.runInquiryReminders(noon), [inquiry.id]);
});

test('заявка с менеджером: напоминание уходит тому, кто её ведёт, а не всем', async () => {
  const { inquiry } = await newInquiry('Вопрос про ипотеку');
  inquiry.assignee = 'Пётр';
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  inquiry.createdAt = new Date(noon.getTime() - 5 * HOUR).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  telegram.calls = [];
  assert.deepEqual(await bot.runInquiryReminders(noon), [inquiry.id]);
  const reminders = telegram.calls.filter((call) => call.method === 'sendMessage' && /^⏰/.test(call.body.text || ''));
  assert.deepEqual(reminders.map((call) => String(call.body.chat_id)), [PETER]);
  assert.match(lastLineOf(reminders[0].body.text), /^⏳ Ведёт: Пётр/);
});
