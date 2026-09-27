'use strict';

// Рассылки только по явному согласию (испанский LSSI, ст. 21) и срок хранения
// данных клиента (RGPD): данные не держат дольше, чем нужно.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, adminMessages, callbacksOf, cleanup } = require('./helpers/chat');

const broadcast = { messages: { ru: 'Новые виллы', en: 'New villas', es: 'Villas nuevas' }, languages: [], tags: [] };
const audience = () => bot.broadcastUsers(broadcast).map((user) => String(user.id));

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = '9990001';
  data.objects.push(property('flat-01', 'Квартира у моря', 'active', { priceValue: 250000, currency: 'EUR' }));
}));
test.after(cleanup);

test.describe('рассылки по явному согласию', () => {
  test('новый клиент не получает рассылок, пока сам не согласится', async () => {
    const chat = createChat();
    chat.user.newsConsentAt = '';
    await chat.say('/start');
    assert.equal(audience().includes(String(chat.id)), false, 'без согласия рассылка не уходит');

    const panel = await chat.press('subs:menu');
    assert.match(panel.last.text, /только с вашего согласия/i, 'клиенту объяснили, что нужно согласие');
    assert.ok(panel.last.buttons.some((label) => label.startsWith('⬜')), 'новости выключены');

    await chat.press('subs:news:on');
    assert.ok(chat.user.newsConsentAt, 'время согласия сохранено как доказательство');
    const after = bot.subscriptionPanel(chat.user);
    assert.ok(after.markup.inline_keyboard[0][0].text.startsWith('✅'), 'теперь включено');
    assert.doesNotMatch(after.text, /только с вашего согласия/i, 'подсказка про согласие больше не нужна');
    assert.equal(audience().includes(String(chat.id)), true, 'после согласия клиент в рассылке');
    // Доказательство согласия — время в данных клиента; в панели видно, сколько
    // клиентов согласились.
    const { safeState } = await import('../src/admin-http.mjs');
    assert.equal(safeState({ csrf: 'x' }).newsConsentCount, 1, 'панель считает согласившихся');
  });

  test('отказ снимает согласие, и повторное включение записывает новое время', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.press('subs:news:on');
    const firstConsent = chat.user.newsConsentAt;

    await chat.press('subs:news:off');
    assert.equal(chat.user.newsConsentAt, '', 'согласие снято');
    assert.equal(audience().includes(String(chat.id)), false);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await chat.press('subs:news:on');
    assert.ok(chat.user.newsConsentAt && chat.user.newsConsentAt !== firstConsent, 'новое согласие — новое время');
  });

  test('данные прежних версий не считаются согласием', () => {
    const restored = bot.normalizeLoadedData({
      version: 27,
      users: {
        '5001': { id: '5001', chatId: 5001, preferredLanguage: 'ru', broadcastsOptOut: false },
        '5002': { id: '5002', chatId: 5002, preferredLanguage: 'ru', newsConsentAt: '2026-09-01T10:00:00.000Z' },
      },
    });
    bot.setData(restored);
    restored.config.active = true;
    assert.deepEqual(audience(), ['5002'], 'рассылку получит только тот, кто согласился явно');
  });

  test('отписка кнопкой под рассылкой тоже снимает согласие', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.press('subs:news:on');
    const step = await chat.press('subs:news:off:bc');
    assert.match(step.last.text, /отписались/i);
    assert.equal(chat.user.newsConsentAt, '');
    assert.equal(audience().includes(String(chat.id)), false);
  });
});

test.describe('срок хранения данных', () => {
  const months = (count) => new Date(Date.now() - count * 30 * 24 * 60 * 60 * 1000).toISOString();

  function sleeper(id, monthsAgo, extra = {}) {
    const data = bot.getData();
    data.users[String(id)] = {
      id: String(id), chatId: id, firstName: 'Клиент ' + id, preferredLanguage: 'ru',
      firstSeenAt: months(monthsAgo + 2), lastSeenAt: months(monthsAgo), activity: [], ...extra,
    };
    return data.users[String(id)];
  }

  function oldInquiry(userId, monthsAgo, patch = {}) {
    const inquiry = {
      id: 'inq-' + userId + '-' + monthsAgo, userId: String(userId), chatId: String(userId), language: 'ru',
      type: 'general', text: 'Старое обращение', status: 'closed', pipelineStage: 'won', replies: [], messages: [],
      createdAt: months(monthsAgo), updatedAt: months(monthsAgo), clientMessageAt: months(monthsAgo), ...patch,
    };
    bot.getData().inquiries.push(inquiry);
    return inquiry;
  }

  test('без настроенного срока ничего не удаляется', async () => {
    sleeper(7001, 60);
    bot.getData().config.retentionMonths = 0;
    const result = await bot.runRetentionCleanup(new Date());
    assert.equal(result.users, 0);
    assert.ok(bot.getData().users['7001'], 'клиент на месте');
  });

  test('данные давно молчащего клиента удаляются, свежие остаются', async () => {
    bot.getData().config.retentionMonths = 24;
    sleeper(7002, 30);
    oldInquiry(7002, 30);
    sleeper(7003, 3);
    oldInquiry(7003, 3);

    const result = await bot.runRetentionCleanup(new Date());
    assert.equal(result.users, 1, 'удалён один клиент');
    assert.equal(bot.getData().users['7002'], undefined, 'данные молчащего клиента удалены');
    assert.deepEqual(bot.getData().inquiries.filter((item) => item.userId === '7002'), [], 'его обращения тоже');
    assert.ok(bot.getData().users['7003'], 'недавний клиент не тронут');
    assert.ok(adminMessages().some((message) => /Срок хранения данных/.test(message.text)), 'администратору сообщили');
  });

  test('открытое дело и предстоящий просмотр держат данные', async () => {
    bot.getData().config.retentionMonths = 12;
    sleeper(7004, 40);
    oldInquiry(7004, 40, { status: 'new' });
    sleeper(7005, 40);
    const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    oldInquiry(7005, 40, { type: 'viewing', viewing: { confirmedDate: future, confirmedAt: months(40), confirmedTime: '12:00', cancelledAt: '' } });

    await bot.runRetentionCleanup(new Date());
    assert.ok(bot.getData().users['7004'], 'клиент с неотвеченным обращением остаётся');
    assert.ok(bot.getData().users['7005'], 'клиент с предстоящим просмотром остаётся');
  });

  test('за сутки уборка идёт один раз', async () => {
    bot.getData().config.retentionMonths = 24;
    sleeper(7006, 40);
    const first = await bot.runRetentionCleanup(new Date());
    assert.equal(first.users, 1);
    sleeper(7007, 40);
    const second = await bot.runRetentionCleanup(new Date());
    assert.equal(second.skipped, true, 'второй запуск в тот же день ничего не делает');
    assert.ok(bot.getData().users['7007'], 'до следующего дня данные ждут');
  });

  test('план уборки виден заранее и не меняет данные', () => {
    bot.getData().config.retentionMonths = 24;
    sleeper(7008, 40);
    const plan = bot.retentionPlan(new Date());
    assert.equal(plan.months, 24);
    assert.deepEqual(plan.users.map((user) => user.id), ['7008']);
    assert.ok(bot.getData().users['7008'], 'только план, ничего не удалено');
  });

  test('самопроверка напоминает, что срок не задан', () => {
    bot.getData().config.retentionMonths = 0;
    const check = bot.runSelfCheck().checks.find((entry) => entry.id === 'privacy');
    assert.equal(check.status, 'warn');
  });
});
