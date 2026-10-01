'use strict';

// Этап 48, часть 3: одно утреннее сообщение вместо пачки. Кто ждёт ответа, просмотры сегодня, «пора связаться» и вчерашние
// цифры — одним сообщением; то, что вошло в него, отдельно уже не напоминается; пустого сообщения не бывает.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, ADMIN_CHAT, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = ADMIN_CHAT;
  data.config.reminderHours = 2;
}));

const MORNING = new Date(2026, 8, 21, 10, 0);
const toAdmin = () => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT).map((call) => call.body);

async function waitingClient(name, hoursAgo) {
  const chat = createChat({ firstName: name });
  await chat.say('Нужна консультация');
  const inquiry = chat.inquiries[chat.inquiries.length - 1];
  inquiry.createdAt = new Date(MORNING.getTime() - hoursAgo * 3600 * 1000).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  return inquiry;
}

test('утром — одно сообщение: ждущие ответа первой строкой, каждый клиент одной строкой', async () => {
  await waitingClient('Анна', 30);
  await waitingClient('Борис', 5);
  telegram.calls = [];
  const text = await bot.runMorningBrief(MORNING);
  const sent = toAdmin();
  assert.equal(sent.length, 1, 'одно сообщение');
  assert.equal(sent[0].text, text);
  assert.match(text, /^☀️ Утро, /);
  assert.match(text, /⏳ Ждут ответа: 2\n• Анна — .*\n• Борис — /, 'дольше всех ждёт — выше всех');
  assert.doesNotMatch(text, /↩️ Ответьте|Новая заявка/);
});

test('то, что вошло в утреннее сообщение, отдельным напоминанием не приходит; второго утреннего в тот же день нет', async () => {
  await waitingClient('Анна', 30);
  await bot.runMorningBrief(MORNING);
  telegram.calls = [];
  await bot.runInquiryReminders(MORNING);
  assert.equal(toAdmin().length, 0, 'напоминания по тому же клиенту нет');
  assert.equal(await bot.runMorningBrief(MORNING), '', 'второго утреннего нет');
  assert.equal(toAdmin().length, 0);
});

test('пока рано — ничего; нечего сказать — тоже ничего, но день отмечается', async () => {
  assert.equal(await bot.runMorningBrief(new Date(2026, 8, 21, 6, 0)), '', 'до рабочего утра не шлём');
  telegram.calls = [];
  assert.equal(await bot.runMorningBrief(MORNING), '', 'пустое сообщение не отправляется');
  assert.equal(toAdmin().length, 0);
});

test('больше пяти ждущих — пять строк и «и ещё N — /inbox»', async () => {
  for (let index = 0; index < 7; index += 1) await waitingClient('Клиент' + index, 3 + index);
  const text = await bot.runMorningBrief(MORNING);
  assert.match(text, /⏳ Ждут ответа: 7/);
  assert.equal(text.split('\n').filter((line) => line.startsWith('• Клиент')).length, 5);
  assert.match(text, /• и ещё 2 — \/inbox/);
});

test('планировщик в понедельник утром: одно утреннее и итоги недели — не больше трёх сообщений', async () => {
  const monday = new Date(2026, 8, 21, 10, 0);
  await waitingClient('Анна', 30);
  await waitingClient('Борис', 5);
  telegram.calls = [];
  await bot.runMorningBrief(monday);
  await bot.runInquiryReminders(monday);
  await bot.runViewingNotices(monday);
  await bot.runFollowUpReminders(monday);
  await bot.runWeeklyReport(monday);
  assert.ok(toAdmin().length <= 3, 'сообщений: ' + toAdmin().length);
});

test('временный сбой Telegram: утреннее сообщение не теряется, ждущий остаётся ждущим и сообщение уйдёт при следующей проверке', async () => {
  const inquiry = await waitingClient('Анна', 30);
  const before = bot.getData().lastDigestFor;
  const working = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ ok: false, error_code: 502, description: 'Bad Gateway' }), { status: 502, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => bot.runMorningBrief(MORNING));
  } finally {
    global.fetch = working;
  }
  assert.equal(bot.getData().lastDigestFor, before, 'день не отмечен');
  assert.ok(!inquiry.remindedSince, 'ждущий не помечен как «уже сообщили»');
  telegram.calls = [];
  const text = await bot.runMorningBrief(MORNING);
  assert.match(text, /Ждут ответа: 1/);
  assert.equal(toAdmin().length, 1);
});

test('«В работу» — только когда есть с кем делить: у одиночки кнопки нет, при двух чатах есть', async () => {
  const lone = await waitingClient('Анна', 1);
  assert.ok(!callbackData(bot.inquiryStatusMarkup(lone)).includes('inq:in_progress:' + lone.id));
  bot.getData().config.managers = [{ id: 'm1', name: 'Мария', chatId: '8880001', verifiedAt: '' }];
  assert.ok(callbackData(bot.inquiryStatusMarkup(lone)).includes('inq:in_progress:' + lone.id));
});

function callbackData(markup) {
  return markup.inline_keyboard.flat().map((button) => button.callback_data);
}

test('значки: «искал объекты сам» — 🔎 и без подсказки «ответьте»; обычная заявка — 📩 с подсказкой', async () => {
  const searcher = createChat({ firstName: 'Сергей' });
  telegram.calls = [];
  await searcher.say('Квартира в Малаге до 300 тысяч, 2 спальни');
  const search = toAdmin().find((body) => /искал объекты сам/.test(body.text));
  if (search) {
    assert.match(search.text, /^🔎 /);
    assert.doesNotMatch(search.text, /↩️ Ответьте/);
  }
  const asker = createChat({ firstName: 'Анна' });
  telegram.calls = [];
  await asker.say('Нужна консультация по ВНЖ');
  const card = toAdmin().find((body) => /Новая заявка/.test(body.text));
  assert.match(card.text, /^📩 /);
  assert.match(card.text, /↩️ Ответьте/);
});

// --- /viewings с кнопками подтверждения; слова клиента — по-русски
async function adminSays(text) {
  const before = telegram.calls.length;
  const chat = { id: Number(ADMIN_CHAT), type: 'private' };
  const message = { message_id: 4100 + before, date: Math.floor(Date.now() / 1000), from: { id: Number(ADMIN_CHAT), first_name: 'Админ', language_code: 'ru' }, chat, text };
  await bot.processUpdates([{ update_id: 950000 + before, message }], 'test-token');
  await new Promise((resolve) => setTimeout(resolve, 20));
  return telegram.calls.slice(before);
}

test('/viewings: у ждущего подтверждения — кнопка «Подтвердить» со временем по-русски; нажатие подтверждает и обновляет обзор', async () => {
  bot.getData().objects.push(property('villa-sol', 'Вилла Сол', 'active'));
  const client = createChat({ language: 'es', firstName: 'Карлос' });
  const step = await client.press('property:viewing:villa-sol');
  const day = await client.say(step.last.buttons[1]);
  await client.say(day.last.buttons.find((label) => /tarde/.test(label)));
  await client.say(bot.text.viewing.es.confirm);
  const inquiry = client.inquiries.find((item) => item.type === 'viewing');
  assert.ok(inquiry, 'запись создана');
  const [reply] = (await adminSays('/viewings')).filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT);
  assert.doesNotMatch(reply.body.text, /tarde|Mañana/, 'слова клиента по-русски: ' + reply.body.text);
  const [button] = reply.body.reply_markup.inline_keyboard.flat();
  assert.match(button.text, /^✅ .*Днём.* · Карлос$/);
  assert.equal(button.callback_data, 'inq:confirm:' + inquiry.id);
  telegram.calls = [];
  await bot.processUpdates([{ update_id: 960001, callback_query: { id: 'c1', from: { id: Number(ADMIN_CHAT) }, data: button.callback_data, message: { message_id: 55, chat: { id: Number(ADMIN_CHAT), type: 'private' }, text: reply.body.text } } }], 'test-token');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(bot.getData().inquiries.find((item) => item.id === inquiry.id).viewing.confirmedAt, 'просмотр подтверждён');
  const edit = telegram.calls.find((call) => call.method === 'editMessageText' && call.body.message_id === 55);
  assert.ok(edit, 'обзор обновлён');
  assert.deepEqual(edit.body.reply_markup, { inline_keyboard: [] }, 'кнопки подтверждения убраны');
});
