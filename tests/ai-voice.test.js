'use strict';

// Голосовые клиента: GenAgent расшифровывает их на своём сервере, консультант отвечает как на текст,
// клиент видит, что бот услышал. Не расшифровалось — голосовое, как раньше, уходит менеджеру.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup, telegram, settle, TOKEN } = require('./helpers/chat');

const AGENT_URL = 'https://agents.example.com/api/agent/21f9043a-23cd-4ae6-a75e-ba46b34f5ed2';
const KEY = 'ga_test-key';

const agent = { asks: [], transcribes: [], logs: [], heard: 'Есть ли виллы у моря?' };
const telegramStub = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/getFile')) return json({ ok: true, result: { file_id: 'voice-1', file_path: 'voice/file_1.oga' } });
  if (u.startsWith('https://api.telegram.org/file/bot')) return new Response(Buffer.from('OggS fake opus audio'), { status: 200 });
  if (!u.startsWith(AGENT_URL)) return telegramStub(url, init);
  if (u === AGENT_URL + '/transcribe') {
    agent.transcribes.push(JSON.parse(init.body));
    return json(agent.heard ? { text: agent.heard, seconds: 3 } : { text: null, seconds: 3 });
  }
  if (u === AGENT_URL + '/log') {
    agent.logs.push(JSON.parse(init.body));
    return json({ ok: true });
  }
  if (u === AGENT_URL) {
    agent.asks.push(JSON.parse(init.body));
    return json({ reply: 'Да, у моря есть виллы в Бенидорме.', handoff: false, actions: [] });
  }
  return json({ ok: true });
};

let messageId = 100;
async function sendVoice(chat, duration = 4) {
  messageId += 1;
  const before = telegram.calls.length;
  await bot.processUpdates([{ update_id: 900000 + messageId, message: { message_id: messageId, date: Math.floor(Date.now() / 1000), from: { id: chat.id, first_name: 'Анна', language_code: 'ru' }, chat: { id: chat.id, type: 'private' }, voice: { file_id: 'voice-1', duration, mime_type: 'audio/ogg' } } }], TOKEN);
  await settle();
  return telegram.calls.slice(before).filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id)).map((call) => call.body.text);
}

test.beforeEach(() => {
  resetData((data) => {
    data.config.aiAgent = { enabled: true, url: AGENT_URL, key: KEY };
  });
  agent.asks = [];
  agent.transcribes = [];
  agent.logs = [];
  agent.heard = 'Есть ли виллы у моря?';
});
test.after(cleanup);

test('голосовое расшифровано: клиент видит текст, консультант отвечает на него', async () => {
  const chat = createChat();
  const replies = await sendVoice(chat);
  assert.equal(agent.transcribes.length, 1);
  assert.equal(agent.transcribes[0].format, 'ogg');
  assert.equal(agent.transcribes[0].language, 'ru'); // язык клиента в боте — подсказка для спорных случаев
  assert.equal(Buffer.from(agent.transcribes[0].audio, 'base64').toString(), 'OggS fake opus audio');
  assert.equal(agent.asks.length, 1);
  assert.equal(agent.asks[0].text, 'Есть ли виллы у моря?');
  assert.equal(replies[0], '🎙 Есть ли виллы у моря?');
  assert.ok(replies.some((text) => text.includes('у моря есть виллы')));
});

test('слов не разобрать — голосовое уходит менеджеру, как раньше', async () => {
  agent.heard = '';
  const chat = createChat();
  const replies = await sendVoice(chat);
  assert.equal(agent.transcribes.length, 1);
  assert.equal(agent.asks.length, 0);
  assert.ok(!replies.some((text) => String(text).startsWith('🎙')));
  assert.equal(chat.inquiries.length, 1);
});

test('голосовое длиннее 2 минут не отправляется на расшифровку', async () => {
  const chat = createChat();
  await sendVoice(chat, 300);
  assert.equal(agent.transcribes.length, 0);
  assert.equal(chat.inquiries.length, 1);
});

test('консультант выключен — расшифровки нет', async () => {
  bot.getData().config.aiAgent.enabled = false;
  const chat = createChat();
  await sendVoice(chat);
  assert.equal(agent.transcribes.length, 0);
});

async function sendSticker(chat) {
  messageId += 1;
  await bot.processUpdates([{ update_id: 900000 + messageId, message: { message_id: messageId, date: Math.floor(Date.now() / 1000), from: { id: chat.id, first_name: 'Анна', language_code: 'ru' }, chat: { id: chat.id, type: 'private' }, sticker: { file_id: 'st-1', emoji: '👍' } } }], TOKEN);
  await settle();
}

test('стикер при консультанте — в «Диалоги» GenAgent пометка, консультанту не отправляется', async () => {
  const chat = createChat();
  await sendSticker(chat);
  assert.equal(agent.asks.length, 0);
  assert.deepEqual(agent.logs.map((l) => [l.role, l.text]), [['media', 'Стикер']]);
});

test('голосовое: расшифрованное пометкой не дублируется, нерасшифрованное — помечается', async () => {
  const chat = createChat();
  await sendVoice(chat);
  assert.equal(agent.logs.filter((l) => l.role === 'media').length, 0);
  agent.heard = '';
  await sendVoice(chat);
  assert.deepEqual(agent.logs.filter((l) => l.role === 'media').map((l) => l.text), ['Голосовое сообщение']);
});
