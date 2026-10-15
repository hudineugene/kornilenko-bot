'use strict';

// Журнал переписки для «Диалогов» GenAgent: всё, что клиент прислал (текст, стикер, кнопки, реакции), и всё, что
// бот отправил (меню, ответ консультанта, ответ менеджера), уходит в GenAgent с номерами — и досылается после сбоя.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup, telegram, settle, TOKEN } = require('./helpers/chat');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const KEY = 'ga_test-key';

const agent = { asks: [], synced: [], failSync: 0, outbox: [] };
const telegramStub = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  // Файлы из Telegram (фото клиента, превью): путь к файлу и сам файл
  if (u.endsWith('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_id: 'f', file_path: 'photos/p.jpg' } }), { status: 200 });
  if (u.includes('/file/bot')) return new Response(Buffer.from('ffd8ffe000104a464946', 'hex'), { status: 200 });
  if (!u.startsWith(AGENT_URL)) return telegramStub(url, init);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u === AGENT_URL) {
    const body = JSON.parse(init.body);
    agent.asks.push(body);
    if (body.image) return json({ reply: 'На фото участок у моря — у нас есть похожие в Финестрате.', handoff: false, actions: [] });
    return json({ reply: 'Виллы у моря есть в Финестрате от 550 000 €.', handoff: false, actions: [] });
  }
  if (u === AGENT_URL + '/sync') {
    if (agent.failSync > 0) {
      agent.failSync -= 1;
      throw new TypeError('fetch failed');
    }
    agent.synced.push(JSON.parse(init.body));
    return json({ ok: true });
  }
  if (u.startsWith(AGENT_URL + '/outbox')) {
    if (init.method === 'POST') return json({ ok: true });
    const items = agent.outbox;
    agent.outbox = [];
    return json({ items });
  }
  return json({ ok: true });
};

const journal = () => import('../src/agent-journal.mjs');
let messageId = 500;
async function send(chat, extra) {
  messageId += 1;
  await bot.processUpdates([{ update_id: 800000 + messageId, message: { message_id: messageId, date: Math.floor(Date.now() / 1000), from: { id: chat.id, first_name: 'Анна', language_code: 'ru' }, chat: { id: chat.id, type: 'private' }, ...extra } }], TOKEN);
  await settle();
  return messageId;
}

async function flushAll() {
  const { flushJournal } = await journal();
  // повтор после паузы — пока очередь не опустеет
  for (let i = 0; i < 5 && bot.getData().agentJournal.length; i += 1) {
    await flushJournal();
    if (bot.getData().agentJournal.length) {
      const until = Date.now() + 9000;
      while (Date.now() < until && bot.getData().agentJournal.length) await new Promise((r) => setTimeout(r, 200)).then(flushJournal);
    }
  }
}

test.beforeEach(() => {
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY };
    data.agentJournalBackfilled = 'test';
  });
  agent.asks = [];
  agent.synced = [];
  agent.failSync = 0;
});
test.after(cleanup);

test('переписка целиком: вопрос и ответ консультанта, меню, стикер, кнопка, реакция', async () => {
  const chat = createChat();
  await send(chat, { text: '/start' });
  const question = await send(chat, { text: 'Есть виллы у моря?' });
  await send(chat, { sticker: { file_id: 'st', emoji: '😍' } });
  await bot.processUpdates([{ update_id: 899001, message_reaction: { chat: { id: chat.id, type: 'private' }, message_id: question, user: { id: chat.id, first_name: 'Анна' }, date: Math.floor(Date.now() / 1000), new_reaction: [{ type: 'emoji', emoji: '👍' }] } }], TOKEN);
  await bot.processUpdates([{ update_id: 899002, callback_query: { id: 'cbq-1', from: { id: chat.id, first_name: 'Анна' }, data: 'air:up', message: { message_id: 42, chat: { id: chat.id, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '👍', callback_data: 'air:up' }, { text: '👎', callback_data: 'air:down' }]] } } } }], TOKEN);
  await settle();

  agent.failSync = 1; // первая отправка — обрыв связи: очередь сохраняется и уходит повтором
  await flushAll();
  const items = agent.synced.flatMap((b) => b.items);
  const find = (f) => items.find(f);

  assert.equal(agent.asks[0].messageId, 'in:' + question, 'консультант получил номер сообщения из журнала');
  assert.ok(find((i) => i.id === 'in:' + question && i.text === 'Есть виллы у моря?'));
  assert.ok(find((i) => i.dir === 'out' && i.by === 'agent' && i.text.includes('Финестрате')), 'ответ консультанта подписан как агент');
  assert.ok(find((i) => i.dir === 'out' && !i.by), 'меню/приветствие бота — без подписи (бот)');
  assert.ok(find((i) => i.kind === 'sticker' && i.text === '😍'), 'стикер со смайликом');
  assert.ok(find((i) => i.kind === 'reaction' && i.text === '👍'), 'реакция');
  assert.ok(find((i) => i.kind === 'button' && i.text === '👍'), 'нажатая кнопка с подписью');
  assert.equal(bot.getData().agentJournal.length, 0, 'после повтора очередь пуста');
  assert.ok(agent.synced.every((b) => b.user.id === String(chat.id)));
});

test('ответ менеджера из GenAgent — в журнале как от менеджера', async () => {
  const chat = createChat();
  await send(chat, { text: 'Хочу поговорить с менеджером' });
  agent.outbox = [{ id: '11111111-1111-4111-8111-111111111111', kind: 'dm', userId: String(chat.id), text: 'Здравствуйте, это Олег.' }];
  await (await import('../src/ai-outbox.mjs')).pollAgentOutbox();
  await flushAll();
  const items = agent.synced.flatMap((b) => b.items);
  assert.ok(items.find((i) => i.by === 'manager' && i.text === 'Здравствуйте, это Олег.'));
});

test('без подключения к GenAgent журнал не копится', async () => {
  bot.getData().config.aiAgent.enabled = false;
  const chat = createChat();
  await send(chat, { text: 'Привет' });
  assert.equal((bot.getData().agentJournal || []).length, 0);
  assert.ok(telegram.calls.length > 0);
});

test('фото клиента: консультант смотрит на фото и отвечает, в журнале — превью', async () => {
  const chat = createChat();
  const id = await send(chat, { caption: 'Такой участок есть?', photo: [{ file_id: 'p-small', width: 90, height: 90 }, { file_id: 'p-mid', width: 320, height: 320 }, { file_id: 'p-big', width: 1280, height: 1280 }] });
  await flushAll();
  const ask = agent.asks.find((a) => a.image);
  assert.ok(ask, 'фото ушло консультанту');
  assert.equal(ask.text, 'Такой участок есть?');
  assert.equal(ask.messageId, 'in:' + id);
  const items = agent.synced.flatMap((b) => b.items);
  assert.ok(items.find((i) => i.by === 'agent' && i.text.includes('участок у моря')), 'ответ консультанта на фото');
  const photo = items.find((i) => i.id === 'in:' + id);
  assert.equal(photo.kind, 'photo');
  assert.equal(photo.thumbType, 'image/jpeg');
  assert.ok(photo.thumb && !('thumbFile' in photo));
});
