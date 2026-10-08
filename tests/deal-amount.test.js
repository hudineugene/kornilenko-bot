'use strict';

// Сумма сделки: вписывается у заявки на этапе «Сделка», живёт только у сделки, попадает в недельный отчёт, в Telegram-сводку и в таблицу
// источников; «Вернуть» возвращает и её; неверное значение отклоняется.

const realFetch = global.fetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup } = require('./helpers/chat');

const PASSWORD = 'deal-password-9';
let base = '';
let headers = {};

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  if (!bot.server.listening) await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  if (bot.server.listening) await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const patch = (inquiry, body) => realFetch(base + '/api/inquiries/' + inquiry.id, { method: 'PATCH', headers, body: JSON.stringify(body) });

async function inquiryFrom(source = 'instagram') {
  const chat = createChat();
  chat.user.source = source;
  await chat.say('Подскажите по оформлению ипотеки');
  return chat.inquiries[0];
}

test('сумма сделки сохраняется вместе с этапом «Сделка», принимает пробелы и запятую, снимается пустым значением и при возврате в работу', async () => {
  const inquiry = await inquiryFrom();
  let response = await patch(inquiry, { pipelineStage: 'won', dealAmount: '147 312' });
  assert.equal(response.status, 200);
  assert.equal(inquiry.dealAmount, 147312);
  assert.equal(inquiry.pipelineStage, 'won');

  response = await patch(inquiry, { dealAmount: '150000,5' });
  assert.equal(inquiry.dealAmount, 150001, 'округляется до евро');
  response = await patch(inquiry, { dealAmount: '' });
  assert.equal('dealAmount' in inquiry, false, 'пусто — «не указана»');

  await patch(inquiry, { dealAmount: 99000 });
  assert.equal(inquiry.dealAmount, 99000);
  await patch(inquiry, { pipelineStage: 'contact', status: 'in_progress' });
  assert.equal('dealAmount' in inquiry, false, 'вернули в работу — сумма снята');
});

test('неверная сумма отклоняется, заявка не меняется', async () => {
  const inquiry = await inquiryFrom();
  for (const bad of ['abc', '-5', '1e12']) {
    const response = await patch(inquiry, { pipelineStage: 'won', dealAmount: bad });
    assert.equal(response.status, 400, bad);
  }
  assert.notEqual(inquiry.pipelineStage, 'won');
});

test('в недельном отчёте и в сводке Telegram — сумма сделок; в таблице источников — сумма по метке; без суммы всё как прежде', async () => {
  const withAmount = await inquiryFrom('instagram');
  const without = await inquiryFrom('site');
  await patch(withAmount, { pipelineStage: 'won', dealAmount: 147312 });
  await patch(without, { pipelineStage: 'won' });

  const report = bot.weeklyReportData(new Date(), 'current');
  assert.equal(report.deals.count, 2);
  assert.equal(report.deals.amount, 147312);
  const text = await (await realFetch(base + '/api/weekly-report?week=current', { headers })).json();
  assert.match(text.text, /🤝 Сделок: 2.* на 147\s312\s€/);

  const state = await (await realFetch(base + '/api/state', { headers })).json();
  const instagram = state.sources.find((row) => row.source === 'instagram');
  const site = state.sources.find((row) => row.source === 'site');
  assert.equal(instagram.deals, 1);
  assert.equal(instagram.dealAmount, 147312);
  assert.equal('dealAmount' in site, false, 'у метки без суммы поля нет');
});

test('сумма переживает загрузку данных; неверная и нулевая отбрасываются', () => {
  const data = bot.normalizeLoadedData({
    version: 52,
    inquiries: [
      { id: 'a', userId: '1', chatId: '1', text: 'x', pipelineStage: 'won', dealAmount: 250000.4 },
      { id: 'b', userId: '1', chatId: '1', text: 'x', pipelineStage: 'won', dealAmount: -1 },
      { id: 'c', userId: '1', chatId: '1', text: 'x', pipelineStage: 'won', dealAmount: 0 },
      { id: 'd', userId: '1', chatId: '1', text: 'x', pipelineStage: 'won', dealAmount: 'много' },
    ],
  });
  const byId = Object.fromEntries(data.inquiries.map((item) => [item.id, item]));
  assert.equal(byId.a.dealAmount, 250000);
  for (const id of ['b', 'c', 'd']) assert.equal('dealAmount' in byId[id], false, id);
});

test('в панели: поле «Сумма сделки» появляется при этапе «Сделка»; «Вернуть» возвращает и сумму', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-inquiries.mjs'), 'utf8');
  assert.match(view, /id="inqDealAmount"/);
  assert.match(view, /dealAmountField/);
  assert.match(view, /dealAmount: item\.dealAmount \|\| 0/);
  assert.match(view, /if \(before\.dealAmount\) body\.dealAmount = before\.dealAmount/);
  const overview = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-overview.mjs'), 'utf8');
  assert.match(overview, /report\.deals\.amount/);
  assert.match(overview, /row\.dealAmount/);
});
