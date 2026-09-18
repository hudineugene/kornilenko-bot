'use strict';

// The purchase calculator under a property for sale.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const RATES = { enabled: true, resaleTaxPercent: 10, newBuildTaxPercent: 10, stampDutyPercent: 1.5, otherCostsPercent: 1.5, downPaymentPercent: 30, interestPercent: 4, years: 25 };

test.beforeEach(() => resetData((data) => {
  data.config.calculator = { ...RATES };
  data.objects.push(property('resale-01', 'Квартира в Бенидорме', 'active', { dealType: 'sale', propertyType: 'apartment', priceValue: 200000, currency: 'EUR' }));
  data.objects.push(property('newbuild-02', 'Новостройка в Финестрате', 'active', { dealType: 'sale', propertyType: 'newbuild', priceValue: 300000, currency: 'EUR' }));
  data.objects.push(property('rent-03', 'Аренда у моря', 'active', { dealType: 'rent', propertyType: 'apartment', priceValue: 1200, pricePeriod: 'month' }));
  data.objects.push(property('on-request-04', 'Вилла, цена по запросу', 'active', { dealType: 'sale', propertyType: 'villa' }));
}));
test.after(cleanup);

function detailsButtons(chat, id) {
  return chat.press('property:details:' + id).then((step) => callbacksOf(step.last.markup));
}

test('a resale pays the transfer tax; the mortgage payment is an annuity', async () => {
  const data = bot.getData();
  const estimate = bot.purchaseEstimate(data.objects.find((item) => item.id === 'resale-01'));
  assert.deepEqual(estimate.costs.map((item) => [item.key, item.amount]), [['resaleTax', 20000], ['otherCosts', 3000]]);
  assert.equal(estimate.total, 223000);
  assert.equal(estimate.downPayment, 60000);
  assert.equal(estimate.loan, 140000);
  assert.equal(Math.round(estimate.monthly), 739);
  assert.equal(estimate.upfront, 83000);
  assert.equal(bot.monthlyPayment(120000, 0, 10), 1000, 'no interest: an equal split');
});

test('a new build pays VAT and stamp duty instead', () => {
  const estimate = bot.purchaseEstimate(bot.getData().objects.find((item) => item.id === 'newbuild-02'));
  assert.deepEqual(estimate.costs.map((item) => [item.key, item.amount]), [['newBuildTax', 30000], ['stampDuty', 4500], ['otherCosts', 4500]]);
});

test('the client sees the estimate from "Details" of a property for sale with a price', async () => {
  const chat = createChat();
  assert.ok((await detailsButtons(chat, 'resale-01')).includes('calc:resale-01'));
  assert.ok(!(await detailsButtons(chat, 'rent-03')).includes('calc:rent-03'), 'not for rent');
  assert.ok(!(await detailsButtons(chat, 'on-request-04')).includes('calc:on-request-04'), 'not without a price');

  const step = await chat.press('calc:resale-01');
  const lines = step.last.text.replace(/[  ]/g, ' ').split('\n');
  assert.equal(lines[0], '🧮 Примерный расчёт покупки');
  assert.ok(lines.includes('💰 Цена: 200 000 €'));
  assert.ok(lines.includes('🧾 Налоги и расходы: ≈ 23 000 €'));
  assert.ok(lines.includes('   • Налог на передачу собственности (ITP) 10%: 20 000 €'));
  assert.ok(lines.includes('📌 Итого с расходами: ≈ 223 000 €'));
  assert.ok(lines.some((line) => line.startsWith('🏦 Ипотека: первый взнос 30% — 60 000 €, кредит 140 000 €, 25 лет, 4%: ≈ 739 € в месяц')));
  assert.ok(lines.includes('💼 Нужно на старте (взнос и расходы): ≈ 83 000 €'));
  assert.match(lines[lines.length - 1], /^Расчёт примерный/);
  assert.deepEqual(callbacksOf(step.last.markup), ['property:manager:resale-01', 'nav:close']);
  assert.equal(bot.getData().analytics.properties['resale-01'].calculator, 1);
});

test('while the calculator is off there is no button and old buttons do nothing', async () => {
  bot.getData().config.calculator.enabled = false;
  const chat = createChat();
  assert.ok(!(await detailsButtons(chat, 'resale-01')).includes('calc:resale-01'));
  telegram.calls = [];
  const step = await chat.press('calc:resale-01');
  assert.equal(step.popups.length, 1);
  assert.equal(step.replies.length, 0);
});

test('the panel saves the rates and checks them', async () => {
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.calculator.enabled = false;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const save = (body) => fetch(base + '/api/calculator', { method: 'PUT', headers, body: JSON.stringify(body) });

    let response = await save({ ...RATES, interestPercent: 35 });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Ставка по ипотеке/);
    assert.equal((await save({ ...RATES, years: '' })).status, 400);
    response = await save({ ...RATES, resaleTaxPercent: 9, enabled: true });
    assert.equal(response.status, 200);
    assert.equal(data.config.calculator.resaleTaxPercent, 9);
    assert.equal(data.config.calculator.enabled, true);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
});
