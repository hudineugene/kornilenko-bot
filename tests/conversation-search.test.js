'use strict';

// Поиск в разделе «Переписка» обещает «Поиск по клиентам и сообщениям», но
// перестал видеть переписку: сами сообщения в панель больше не уезжают (они
// тяжёлые и нужны только для открытой беседы), а искать по ним панель
// пыталась у себя. Теперь по переписке ищет бот.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PASSWORD = 'search-pass-55';
let base = '';
let headers = {};

const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();

function conversation(id, userId, messages, patch = {}) {
  return {
    id, userId: String(userId), chatId: String(userId), language: 'ru', type: 'general',
    text: messages[0].text, status: 'in_progress', pipelineStage: 'contact', replies: [], messages,
    createdAt: messages[0].createdAt, updatedAt: messages[messages.length - 1].createdAt,
    clientMessageAt: messages[messages.length - 1].createdAt, ...patch,
  };
}

test.before(async () => {
  resetData((data) => {
    data.config.active = true;
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.users['710001'] = { id: '710001', chatId: 710001, firstName: 'Ирина', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(3) };
    data.users['710002'] = { id: '710002', chatId: 710002, firstName: 'Сергей', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(5) };
    data.inquiries.push(conversation('conv-1', '710001', [
      { id: 'a1', direction: 'in', kind: 'text', text: 'Здравствуйте, интересует вилла', createdAt: minutesAgo(60) },
      { id: 'a2', direction: 'out', kind: 'text', text: 'Подберу варианты', createdAt: minutesAgo(50) },
      { id: 'a3', direction: 'in', kind: 'text', text: 'Важно, чтобы был подземный паркинг', createdAt: minutesAgo(40) },
    ]));
    data.inquiries.push(conversation('conv-2', '710002', [
      { id: 'b1', direction: 'in', kind: 'text', text: 'Сколько стоит содержание?', createdAt: minutesAgo(30) },
      { id: 'b2', direction: 'in', kind: 'document', text: '', fileName: 'выписка-банка.pdf', createdAt: minutesAgo(25) },
    ]));
  });
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  global.fetch = telegramStub;
  await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const search = async (query, options = {}) => {
  const response = await realFetch(base + '/api/conversations/search?q=' + encodeURIComponent(query), { headers: options.headers === undefined ? headers : options.headers });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
};

test('слово из середины переписки находит беседу', async () => {
  const found = await search('паркинг');
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.inquiryIds, ['conv-1'], 'нашлась беседа, где это слово сказали третьим сообщением');
});

test('регистр и имя файла тоже ищутся', async () => {
  assert.deepEqual((await search('ПАРКИНГ')).body.inquiryIds, ['conv-1'], 'регистр не важен');
  assert.deepEqual((await search('выписка')).body.inquiryIds, ['conv-2'], 'вложение находится по имени файла');
});

test('слишком короткий запрос ничего не перебирает', async () => {
  const found = await search('п');
  assert.deepEqual(found.body.inquiryIds, [], 'по одной букве не ищем');
});

test('чего в переписке нет — не находится', async () => {
  assert.deepEqual((await search('ипотека')).body.inquiryIds, []);
});

test('без входа в панель поиск не работает', async () => {
  const found = await search('паркинг', { headers: {} });
  assert.equal(found.status, 401, 'посторонним переписка недоступна');
});

test('панель спрашивает поиск у бота и показывает последнее сообщение', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /\/api\/conversations\/search\?q=/, 'панель обращается к боту за поиском');
  assert.match(PANEL_HTML, /var lastMessage = item\.lastMessage;/, 'превью берётся из последнего сообщения');
  assert.doesNotMatch(PANEL_HTML, /\(item\.messages \|\| \[\]\)\[item\.messages/, 'прежний поиск последнего сообщения в панели убран');
});
