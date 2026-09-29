'use strict';

// Воронка бота в недельном отчёте: из новых клиентов недели — сколько открыли
// каталог, нажали «Подробнее», оставили заявку, записались на просмотр и получили
// подтверждение; отдельно по языкам и по меткам ссылок (src_). Без неё решения о
// том, что улучшать в боте, принимаются наугад. Что клиент открыл каталог и
// «Подробнее», бот запоминает по одной отметке на клиента (первый раз); заявки,
// записи и подтверждения берутся из самих заявок.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;

// Среда, 23.09.2026, полдень. Прошлая неделя — 14.09–20.09.
const NOW = new Date(2026, 8, 23, 12, 0);
const at = (day, hour = 12) => new Date(2026, 8, day, hour).toISOString();

let weeklyReportText;
test.before(async () => {
  ({ weeklyReportText } = await import('../src/notices.mjs'));
});
test.beforeEach(() => resetData());
test.after(cleanup);

test.describe('отметки на клиенте', () => {
  test.beforeEach(() => resetData((data) => {
    data.objects.push(property('funnel-villa', 'Вилла', 'active', { propertyType: 'villa', priceValue: 500000 }));
  }));

  test('каталог и «Подробнее» отмечаются один раз, при повторе время не сдвигается', async () => {
    const chat = createChat();
    assert.ok(!(chat.user.funnel && chat.user.funnel.catalog), 'вначале отметок нет');
    await chat.say(MENU.ru.objects);
    const first = chat.user.funnel.catalog;
    assert.match(first, /^\d{4}-\d\d-\d\dT/, 'отметка — время');
    assert.ok(!chat.user.funnel.details, '«Подробнее» ещё не нажимали');

    await chat.press('property:details:funnel-villa');
    assert.match(chat.user.funnel.details, /^\d{4}-\d\d-\d\dT/);
    const detailsAt = chat.user.funnel.details;

    await new Promise((resolve) => setTimeout(resolve, 15));
    await chat.say(MENU.ru.objects);
    await chat.press('property:details:funnel-villa');
    assert.equal(chat.user.funnel.catalog, first, 'каталог: время первого раза');
    assert.equal(chat.user.funnel.details, detailsAt, '«Подробнее»: время первого раза');
  });

  test('«Избранное» и «Сравнение» каталогом не считаются: открыт не общий каталог', async () => {
    const chat = createChat();
    await chat.press('catalog:favorites:0');
    assert.ok(!(chat.user.funnel && chat.user.funnel.catalog));
  });

  test('отметки переживают перезапуск и новые сообщения клиента', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    const saved = chat.user.funnel.catalog;
    await chat.say('Здравствуйте!');
    assert.equal(chat.user.funnel.catalog, saved, 'ещё одно сообщение отметку не стирает');
    const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
    assert.equal(reloaded.users[String(chat.id)].funnel.catalog, saved, 'и запись на диск её сохраняет');
  });
});

function seed() {
  resetData((data) => {
    const user = (id, extra) => ({ id, chatId: Number(id.charCodeAt(0)), firstName: id, activity: [], preferredLanguage: 'ru', ...extra });
    data.users.a = user('a', { source: 'instagram', firstSeenAt: at(15), funnel: { catalog: at(15), details: at(15, 13) } });
    data.users.b = user('b', { preferredLanguage: 'en', firstSeenAt: at(16), funnel: { catalog: at(16) } });
    data.users.c = user('c', { source: 'instagram', firstSeenAt: at(17) });
    // Клиент прошлой недели: в отчёт не входит, но задаёт, с какого дня отметки собираются.
    data.users.d = user('d', { firstSeenAt: at(10), funnel: { catalog: at(10), details: at(10) } });
    const inquiry = (id, userId, extra) => ({ id, userId, type: 'question', status: 'new', text: '', replies: [], createdAt: at(16), updatedAt: at(16), ...extra });
    data.inquiries.push(
      inquiry('q1', 'a', {}),
      inquiry('q2', 'a', { type: 'viewing', viewing: { confirmedAt: at(17), confirmedDate: '2026-09-18' } }),
      inquiry('q3', 'b', { type: 'lead' }),
      // «Искал сам и получил каталог» заявкой не считается.
      inquiry('q4', 'c', { searchLead: true }),
    );
  });
}

test.describe('цифры недели', () => {
  test('воронка новых клиентов: зашли → каталог → «Подробнее» → заявка → запись → подтверждено', () => {
    seed();
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    assert.deepEqual(
      [funnel.joined, funnel.catalog, funnel.details, funnel.inquiry, funnel.viewing, funnel.confirmed],
      [3, 2, 1, 2, 1, 1],
    );
    assert.equal(funnel.trackedFrom, '10.09', 'отметки собираются с 10.09');
    assert.equal(funnel.partial, false, 'и они охватывают всю неделю');
  });

  test('по языкам и по меткам — те же шаги', () => {
    seed();
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    const row = (list, key) => list.find((item) => item.key === key);
    const pick = (item) => [item.joined, item.catalog, item.details, item.inquiry, item.viewing, item.confirmed];
    assert.deepEqual(pick(row(funnel.byLanguage, 'ru')), [2, 1, 1, 1, 1, 1]);
    assert.deepEqual(pick(row(funnel.byLanguage, 'en')), [1, 1, 0, 1, 0, 0]);
    assert.equal(row(funnel.byLanguage, 'es'), undefined, 'языка без клиентов в списке нет');
    assert.deepEqual(pick(row(funnel.bySource, 'instagram')), [2, 1, 1, 1, 1, 1]);
    assert.deepEqual(pick(row(funnel.bySource, 'без метки')), [1, 1, 0, 1, 0, 0]);
  });

  test('отметки начались позже начала недели: цифры каталога и «Подробнее» помечены как неполные', () => {
    seed();
    delete bot.getData().users.d.funnel;
    bot.getData().users.a.funnel = { catalog: at(16), details: at(16, 13) };
    bot.getData().users.b.funnel = { catalog: at(17) };
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    assert.equal(funnel.trackedFrom, '16.09');
    assert.equal(funnel.partial, true, 'клиент из 15.09 мог открыть каталог до начала подсчёта');
  });

  test('отметок пока нет ни у кого: шаги каталога не выдумываются', () => {
    seed();
    for (const user of Object.values(bot.getData().users)) delete user.funnel;
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    assert.equal(funnel.trackedFrom, '');
    assert.equal(weeklyReportText(bot.weeklyReportData(NOW, 'last')).includes('каталог'), false, 'в сообщении про каталог ни слова');
  });

  test('в сообщении для Telegram — одна строка воронки', () => {
    seed();
    const text = weeklyReportText(bot.weeklyReportData(NOW, 'last'));
    assert.match(text, /🔻 Воронка новых клиентов: зашли 3 → каталог 2 → «Подробнее» 1 → заявка 2 → запись 1 → подтверждено 1/);
    assert.ok(!/собирается с/.test(text), 'неполноты нет — пометки нет');

    bot.getData().users.a.funnel = { catalog: at(16), details: at(16, 13) };
    delete bot.getData().users.d.funnel;
    const partial = weeklyReportText(bot.weeklyReportData(NOW, 'last'));
    assert.match(partial, /каталог и «Подробнее» — с 16\.09/, 'сказано, с какого дня цифры каталога полные');
  });

  test('без новых клиентов воронки нет', () => {
    resetData();
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    assert.equal(funnel.joined, 0);
    assert.ok(!weeklyReportText(bot.weeklyReportData(NOW, 'last')).includes('Воронка'));
  });
});

test.describe('цели клиентов', () => {
  const goalUsers = (goals) => resetData((data) => {
    goals.forEach((goal, index) => {
      data.users['g' + index] = { id: 'g' + index, chatId: 500 + index, firstName: 'G' + index, activity: [], preferredLanguage: 'ru', firstSeenAt: at(15), goal };
    });
  });

  test('в отчёте — сколько выбрали каждую цель; пока ответов мало, предупреждения нет', () => {
    goalUsers(['live', 'invest', 'browse', '']);
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    assert.deepEqual([funnel.goals.live, funnel.goals.invest, funnel.goals.browse, funnel.goals.answered], [1, 1, 1, 3]);
    assert.equal(funnel.goals.mostlyBrowsing, false, 'ответов меньше пяти — выводов не делаем');
    const text = weeklyReportText(bot.weeklyReportData(NOW, 'last'));
    assert.match(text, /🎯 Цели новых клиентов: для жизни 1, инвестиция и аренда 1, пока смотрят 1/);
    assert.ok(!/большинство выбирает/.test(text));
  });

  test('«Пока смотрю» у большинства (от пяти ответов) — отчёт говорит, что деление по целям не работает', () => {
    goalUsers(['browse', 'browse', 'browse', 'live', 'invest']);
    const { funnel } = bot.weeklyReportData(NOW, 'last');
    assert.equal(funnel.goals.mostlyBrowsing, true);
    assert.match(weeklyReportText(bot.weeklyReportData(NOW, 'last')), /большинство выбирает «Пока смотрю»/);
    goalUsers(['browse', 'browse', 'live', 'live', 'invest']);
    assert.equal(bot.weeklyReportData(NOW, 'last').funnel.goals.mostlyBrowsing, false, 'меньше половины — не считается');
  });

  test('никто не отвечал — строки про цели нет', () => {
    goalUsers(['', '']);
    assert.ok(!weeklyReportText(bot.weeklyReportData(NOW, 'last')).includes('Цели новых клиентов'));
  });
});
