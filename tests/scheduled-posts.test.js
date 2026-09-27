'use strict';

// Отложенная публикация в группу или канал. Раньше любая заминка хоронила пост
// навсегда: обрыв связи на минуту — и пост помечался «не удалось», хотя
// достаточно было попробовать ещё раз. А первая проверка очереди случалась
// только через 15 минут после запуска бота, и пост, время которого пришло,
// пока бот был выключен, всё это время ждал.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const realFetch = global.fetch;
const { bot, telegram, TOKEN, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
const replies = new Map();
global.fetch = (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  const method = String(url).split('/').pop();
  if (replies.has(method)) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: replies.get(method) }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return telegramStub(url, init);
};
const stubFetch = global.fetch;

const GROUP = '-1001234567890';

// Связь пропала: запрос не доходит. Такая ошибка приходит без кода Telegram.
function connectionLost(url, init) {
  if (String(url).includes('/sendMessage')) return Promise.reject(new TypeError('fetch failed'));
  return stubFetch(url, init);
}
// Бота выгнали из группы: повторять бессмысленно.
function kickedOut(url, init) {
  if (String(url).includes('/sendMessage')) {
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));
  }
  return stubFetch(url, init);
}

async function withTelegram(behaviour, run) {
  global.fetch = behaviour;
  try {
    return await run();
  } finally {
    global.fetch = stubFetch;
  }
}

function addGroup() {
  const data = bot.getData();
  data.groups = [{
    id: GROUP,
    type: 'supergroup',
    title: 'Клуб покупателей',
    status: 'administrator',
    rights: { can_pin_messages: true, can_delete_messages: true },
    messages: [],
    joinRequests: [],
  }];
  return data.groups[0];
}

function duePost(extra = {}) {
  const data = bot.getData();
  data.groupPosts = [{
    id: 'post-1',
    groupId: GROUP,
    text: 'Новая подборка объектов',
    status: 'scheduled',
    sendAt: new Date(Date.now() - 60 * 1000).toISOString(),
    notify: true,
    ...extra,
  }];
  return data.groupPosts[0];
}

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('обрыв связи не хоронит публикацию — она уходит со следующей проверкой', async () => {
  addGroup();
  const post = duePost();
  const lost = await withTelegram(connectionLost, () => bot.runDueGroupPosts(new Date(), TOKEN));
  assert.deepEqual(lost, [], 'сейчас не ушло');
  assert.equal(post.status, 'scheduled', 'публикация осталась в очереди');
  assert.equal(post.attempts, 1, 'попытка засчитана');

  telegram.calls = [];
  assert.deepEqual(await bot.runDueGroupPosts(new Date(), TOKEN), ['post-1'], 'связь вернулась — пост ушёл');
  assert.equal(post.status, 'sent');
  assert.equal(telegram.calls.filter((call) => call.method === 'sendMessage').length, 1, 'ровно один раз');
});

test('после нескольких неудач подряд публикация признаётся несостоявшейся', async () => {
  addGroup();
  const post = duePost();
  const { GROUP_POST_ATTEMPTS } = await import('../src/groups.mjs');
  await withTelegram(connectionLost, async () => {
    for (let attempt = 0; attempt < GROUP_POST_ATTEMPTS; attempt += 1) await bot.runDueGroupPosts(new Date(), TOKEN);
  });
  assert.equal(post.status, 'failed', 'вечно в очереди пост не висит');
  assert.equal(post.attempts, GROUP_POST_ATTEMPTS);
  assert.match(post.error, /fetch failed|Telegram|связ/i);
});

test('отказ Telegram повторять незачем — сразу «не удалось»', async () => {
  addGroup();
  const post = duePost();
  await withTelegram(kickedOut, () => bot.runDueGroupPosts(new Date(), TOKEN));
  assert.equal(post.status, 'failed', 'бота выгнали — повторять нечего');
  assert.equal(post.attempts, 1);
});

test('счётчик попыток переживает перезапуск бота', () => {
  const restored = bot.normalizeLoadedData({
    version: 14,
    groupPosts: [{ id: 'p', groupId: GROUP, text: 'Пост', status: 'scheduled', sendAt: new Date().toISOString(), attempts: 3 }],
  });
  assert.equal(restored.groupPosts[0].attempts, 3);
});

test('очередь проверяется вскоре после запуска, а не через 15 минут', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lifecycle.mjs'), 'utf8');
  assert.match(source, /setTimeout\(runScheduledNotices, FIRST_SCHEDULE_CHECK_MS\)/, 'первая проверка идёт по таймеру после запуска');
  const delay = Number((source.match(/FIRST_SCHEDULE_CHECK_MS = ([^;]+);/) || [])[1].split('*').reduce((total, part) => total * Number(part.trim()), 1));
  assert.ok(delay > 0 && delay < 15 * 60 * 1000, 'первая проверка раньше обычного интервала, она через ' + delay + ' мс');
});

test('панель видит и ожидающие, и несостоявшиеся публикации', async () => {
  addGroup();
  const data = bot.getData();
  data.groupPosts = [
    { id: 'waiting', groupId: GROUP, text: 'Ждёт', status: 'scheduled', sendAt: new Date(Date.now() + 36e5).toISOString() },
    { id: 'broken', groupId: GROUP, text: 'Не ушла', status: 'failed', sendAt: new Date(Date.now() - 36e5).toISOString(), error: 'Связи нет' },
    { id: 'done', groupId: GROUP, text: 'Ушла', status: 'sent', sendAt: new Date(Date.now() - 72e5).toISOString() },
  ];
  const { safeState } = await import('../src/admin-http.mjs');
  const state = safeState({ csrf: 'test' });
  assert.deepEqual(state.groupPosts.map((post) => post.id), ['waiting', 'broken'], 'отправленные в списке не нужны');
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /Отложенные публикации/, 'в карточке группы есть список');
  assert.match(PANEL_HTML, /data-cancel-post=/, 'публикацию можно убрать');
  assert.match(PANEL_HTML, /\/api\/group-posts\//, 'кнопка зовёт отмену публикации');
});
