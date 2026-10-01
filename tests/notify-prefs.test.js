'use strict';

// Уведомления администратору в Telegram: по видам — со звуком, без звука или совсем не присылать, и тихие часы.
// В тихие часы сообщение приходит, но без звука (disable_notification); заявки клиентов отключить нельзя.

const realFetch = global.fetch; // до helpers: они подменяют fetch на заглушку Telegram
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, ADMIN_CHAT, createChat, resetData, telegram, cleanup,
} = require('./helpers/chat');

const HOUR = 60 * 60 * 1000;
const NOON = new Date(2026, 8, 18, 12, 0);
const NIGHT = new Date(2026, 8, 18, 23, 30);
const EARLY = new Date(2026, 8, 19, 6, 15);

test.beforeEach(() => resetData((data) => { data.config.reminderHours = 2; }));
test.after(cleanup);

async function panelSession() {
  await new Promise((resolve) => { if (bot.server.listening) resolve(); else bot.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + bot.server.address().port;
  const data = bot.getData();
  const password = bot.hashPassword('notify-prefs-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'notify-prefs-password' }) });
  const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
  return { base, headers };
}


function adminCalls() {
  return telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT);
}

async function plan() {
  return (await import('../src/notify-plan.mjs')).adminSendPlan;
}

test('по умолчанию всё со звуком; «без звука» и «не присылать» работают по видам', async () => {
  const adminSendPlan = await plan();
  assert.deepEqual(adminSendPlan('digest', NOON), { send: true, options: {} });
  bot.getData().config.notifyPrefs = { kinds: { digest: 'silent', reminder: 'off', inquiry: 'off' }, quiet: {} };
  assert.deepEqual(adminSendPlan('digest', NOON), { send: true, options: { disable_notification: true } });
  assert.equal(adminSendPlan('reminder', NOON).send, false);
  assert.equal(adminSendPlan('inquiry', NOON).send, true, 'заявки клиентов отключить нельзя');
});

test('тихие часы: через полночь и в пределах суток; вне них — со звуком', async () => {
  const adminSendPlan = await plan();
  bot.getData().config.notifyPrefs = { kinds: {}, quiet: { enabled: true, from: '22:00', to: '08:00' } };
  assert.equal(adminSendPlan('inquiry', NIGHT).options.disable_notification, true);
  assert.equal(adminSendPlan('inquiry', EARLY).options.disable_notification, true);
  assert.deepEqual(adminSendPlan('inquiry', NOON).options, {});
  bot.getData().config.notifyPrefs = { kinds: {}, quiet: { enabled: true, from: '13:00', to: '15:00' } };
  assert.deepEqual(adminSendPlan('inquiry', NOON).options, {});
  assert.equal(adminSendPlan('inquiry', new Date(2026, 8, 18, 14, 0)).options.disable_notification, true);
});

test('напоминание о заявке без ответа: отключено — не приходит и не повторяется; без звука — приходит с disable_notification', async () => {
  const chat = createChat();
  await chat.say('Есть ли квартиры у моря?');
  const inquiry = chat.inquiries[chat.inquiries.length - 1];
  inquiry.createdAt = new Date(NOON.getTime() - 3 * HOUR).toISOString();
  inquiry.clientMessageAt = inquiry.createdAt;
  inquiry.updatedAt = inquiry.createdAt;

  bot.getData().config.notifyPrefs = { kinds: { reminder: 'off' }, quiet: {} };
  telegram.calls = [];
  assert.deepEqual(await bot.runInquiryReminders(NOON), [], 'ничего не ушло — заявку нельзя считать напомненной');
  assert.equal(adminCalls().length, 0, 'в Telegram ничего не ушло');
  assert.ok(!inquiry.remindedAt && !inquiry.remindedSince, 'после включения о ней напомнят');

  bot.getData().config.notifyPrefs = { kinds: { reminder: 'silent' }, quiet: {} };
  telegram.calls = [];
  await bot.runInquiryReminders(NOON);
  assert.equal(adminCalls().length, 1);
  assert.equal(adminCalls()[0].body.disable_notification, true);
});

test('новая заявка клиента в тихие часы приходит без звука, днём — со звуком', async () => {
  bot.getData().config.notifyPrefs = { kinds: {}, quiet: { enabled: true, from: '00:00', to: '23:59' } };
  const chat = createChat();
  telegram.calls = [];
  await chat.say('Хочу посмотреть виллу');
  const call = adminCalls().find((item) => /Хочу посмотреть виллу/.test(item.body.text));
  assert.ok(call, 'заявка дошла администратору');
  assert.equal(call.body.disable_notification, true);
});

test('настройки нормализуются: неизвестные значения — «со звуком», совпадающие начало и конец — тихие часы выключены', async () => {
  const { normalizeNotifyPrefs } = await import('../src/data-format.mjs');
  const prefs = normalizeNotifyPrefs({ kinds: { inquiry: 'off', digest: 'странное', viewing: 'silent' }, quiet: { enabled: true, from: '09:00', to: '09:00' } });
  assert.equal(prefs.kinds.inquiry, 'sound');
  assert.equal(prefs.kinds.digest, 'sound');
  assert.equal(prefs.kinds.viewing, 'silent');
  assert.equal(prefs.quiet.enabled, false);
  assert.deepEqual(normalizeNotifyPrefs(null).quiet, { enabled: false, from: '22:00', to: '08:00' });
});

test('панель сохраняет настройки уведомлений и отдаёт их в состоянии; неверные тихие часы — отказ', async () => {
  const { base, headers } = await panelSession();
  const save = (notifyPrefs) => realFetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ notifyPrefs }) });
  const bad = await save({ kinds: {}, quiet: { enabled: true, from: '22:00', to: '22:00' } });
  assert.equal(bad.status, 400);
  const good = await save({ kinds: { digest: 'off', reminder: 'silent', inquiry: 'off' }, quiet: { enabled: true, from: '21:30', to: '07:00' } });
  assert.equal(good.status, 200, await good.clone().text());
  const state = await (await realFetch(base + '/api/state', { headers })).json();
  assert.deepEqual(state.config.notifyPrefs.quiet, { enabled: true, from: '21:30', to: '07:00' });
  assert.equal(state.config.notifyPrefs.kinds.digest, 'off');
  assert.equal(state.config.notifyPrefs.kinds.reminder, 'silent');
  assert.equal(state.config.notifyPrefs.kinds.inquiry, 'sound');
});
