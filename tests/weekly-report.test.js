'use strict';

// Неделя одной страницей. Цифры недели собираются в одном месте: из них же
// бот пишет владельцу по понедельникам и рисует страницу отчёта в панели, так
// что числа в Telegram и на экране совпадают. К прежним пунктам (клиенты,
// обращения, просмотры, источники) добавлены сделки — им нужна дата, когда
// обращение стало «Сделкой» (wonAt).

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');

// Среда, 23.09.2026, полдень. Прошлая неделя — 14.09–20.09, позапрошлая — 07.09–13.09.
const NOW = new Date(2026, 8, 23, 12, 0);
const at = (day, hour = 12, month = 8) => new Date(2026, month, day, hour).toISOString();

let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

async function login() {
  const data = bot.getData();
  const password = bot.hashPassword('weekly-test-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'weekly-test-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
}

function seed() {
  resetData((data) => {
    data.config.active = true;
    data.users.a = { id: 'a', chatId: 11, firstName: 'A', source: 'instagram', firstSeenAt: at(15), activity: [] };
    data.users.b = { id: 'b', chatId: 12, firstName: 'B', firstSeenAt: at(16), activity: [] };
    data.users.c = { id: 'c', chatId: 13, firstName: 'C', firstSeenAt: at(10), activity: [] };
    data.users.d = { id: 'd', chatId: 14, firstName: 'D', source: 'site', firstSeenAt: at(22), activity: [] };
    data.objects.push({ id: 'villa', status: 'active', title: { ru: 'Вилла', en: '', es: '' } });
    const inquiry = (id, userId, extra) => ({ id, userId, type: 'question', status: 'closed', text: '', replies: [], createdAt: at(15), updatedAt: at(15), pipelineStage: 'contact', ...extra });
    data.inquiries.push(
      inquiry('q1', 'a', { propertyId: 'villa', createdAt: at(15) }),
      inquiry('q2', 'b', { type: 'viewing', propertyId: 'villa', createdAt: at(16), viewing: { confirmedAt: at(16), confirmedDate: '2026-09-18' } }),
      // Сделка прошлой недели: обращение старое, но «Сделкой» стало 17-го.
      inquiry('q3', 'a', { createdAt: at(3), updatedAt: at(19), pipelineStage: 'won', wonAt: at(17) }),
      // Сделка позапрошлой недели.
      inquiry('q4', 'c', { createdAt: at(2), updatedAt: at(9), pipelineStage: 'won', wonAt: at(9) }),
      // Сделка без даты (записана прежней версией): считается по последней правке.
      inquiry('q5', 'b', { createdAt: at(1), updatedAt: at(18), pipelineStage: 'won' }),
      // Эта неделя (пн 21.09, вт 22.09).
      inquiry('q6', 'd', { type: 'lead', status: 'new', createdAt: at(22, 9), updatedAt: at(22, 9), clientMessageAt: at(22, 9) }),
      inquiry('q7', 'd', { status: 'closed', pipelineStage: 'won', createdAt: at(21, 9), updatedAt: at(22, 10), wonAt: at(22, 10) }),
    );
  });
}

test.beforeEach(seed);

test.describe('цифры недели', () => {
  test('прошлая неделя: клиенты, обращения по видам, просмотры, сделки, источники — со сравнением', async () => {
    const report = bot.weeklyReportData(NOW, 'last');
    assert.equal(report.which, 'last');
    assert.equal(report.label, '14.09–20.09');
    assert.deepEqual(report.users, { count: 2, previous: 1 });
    assert.equal(report.inquiries.count, 2, 'обращений, созданных на этой неделе');
    assert.deepEqual(report.inquiries.byType.map(([name]) => name).sort(), ['вопрос по объекту', 'запись на просмотр']);
    assert.deepEqual(report.viewings, { booked: 1, held: 1 });
    assert.deepEqual(report.deals, { count: 2, previous: 1 }, 'две сделки: с датой wonAt и без неё (по последней правке); одна — на неделю раньше');
    assert.deepEqual(report.sources.map(([name]) => name).sort(), ['instagram', 'без метки']);
    assert.deepEqual(report.topProperties, [{ name: 'Вилла', count: 2 }]);
    assert.equal(report.waiting, 1, 'без ответа — одно: лид Д. с этой недели');
  });

  test('эта неделя идёт: сравнение — с тем же отрезком прошлой, а не со всей неделей', async () => {
    const report = bot.weeklyReportData(NOW, 'current');
    assert.equal(report.which, 'current');
    assert.equal(report.label, '21.09–23.09');
    assert.deepEqual(report.users, { count: 1, previous: 2 }, 'пн–ср этой недели против пн–ср прошлой');
    assert.equal(report.deals.count, 1, 'сделка Д. во вторник');
    assert.equal(report.inquiries.count, 2);
  });

  test('текст для Telegram: строка про сделки — только когда они были', async () => {
    const withDeals = bot.weeklyReport(NOW);
    assert.match(withDeals, /🤝 Сделок: 2 \(↑ было 1\)/);
    assert.ok(withDeals.split('\n')[0].startsWith('📈 Итоги недели 14.09–20.09'));

    // Сделок нет ни на этой, ни на прошлой неделе — строки нет.
    bot.getData().inquiries.forEach((item) => { item.pipelineStage = 'contact'; item.wonAt = ''; });
    assert.ok(!bot.weeklyReport(NOW).includes('Сделок'));
  });
});

test.describe('дата сделки', () => {
  test('ставится, когда обращение стало «Сделкой», не сдвигается при повторе и снимается, если его вернули в работу', async () => {
    await login();
    const patch = (body) => realFetch(base + '/api/inquiries/q6', { method: 'PATCH', headers, body: JSON.stringify(body) });
    const inquiry = () => bot.getData().inquiries.find((item) => item.id === 'q6');

    assert.equal((await patch({ pipelineStage: 'won' })).status, 200);
    const first = inquiry().wonAt;
    assert.ok(first, 'дата сделки записана');
    assert.equal(inquiry().status, 'closed');

    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal((await patch({ note: 'Подписали договор' })).status, 200);
    assert.equal(inquiry().wonAt, first, 'правка заметки дату сделки не двигает');

    assert.equal((await patch({ pipelineStage: 'negotiation' })).status, 200);
    assert.equal(inquiry().wonAt, '', 'вернули в работу — сделки нет');
  });

  test('переживает перезапуск', () => {
    const saved = bot.normalizeLoadedData({ version: 42, inquiries: [{ id: 'x', userId: '1', type: 'lead', pipelineStage: 'won', wonAt: '2026-09-17T10:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z' }] });
    assert.equal(saved.inquiries[0].wonAt, '2026-09-17T10:00:00.000Z');
  });
});

test.describe('страница отчёта в панели', () => {
  test('API отдаёт те же цифры и готовый текст; неверный параметр — прошлая неделя', async () => {
    await login();
    const ask = async (query) => (await realFetch(base + '/api/weekly-report' + query, { headers })).json();
    const last = await ask('');
    assert.equal(last.report.which, 'last');
    assert.equal(last.text.split('\n')[0], '📈 Итоги недели ' + last.report.label);
    assert.equal((await ask('?week=current')).report.which, 'current');
    assert.equal((await ask('?week=что-угодно')).report.which, 'last');
  });

  test('без входа отчёт не отдаётся', async () => {
    assert.equal((await realFetch(base + '/api/weekly-report')).status, 401);
  });
});
