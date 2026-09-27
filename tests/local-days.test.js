'use strict';

// Сутки статистики бот считал по Гринвичу. В Испании летом это +2 часа: всё,
// что происходило с полуночи до двух ночи, попадало во вчерашний день. Ночью
// команда /stats показывала вчерашние цифры, а «Обзор» в панели — свои,
// потому что панель считает дни по местному времени.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, resetData, cleanup } = require('./helpers/chat');

// Ночь по Мадриду, когда по Гринвичу ещё вчера.
const NIGHT = new Date(2026, 6, 15, 0, 30);
const localKey = (date) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('события ночью попадают в сегодняшний день, а не во вчерашний', async () => {
  const { recordDaily } = await import('../src/analytics.mjs');
  const data = bot.getData();
  data.analytics.daily = {};
  const realNow = Date.now;
  Date.now = () => NIGHT.getTime();
  const RealDate = Date;
  // Подменяем «сейчас» на половину первого ночи по местному времени.
  global.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [NIGHT.getTime()]));
    }
    static now() { return NIGHT.getTime(); }
  };
  try {
    recordDaily('received');
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
  const keys = Object.keys(data.analytics.daily);
  assert.deepEqual(keys, [localKey(NIGHT)], 'запись легла в местные сутки, а не в гринвичские');
});

test('/stats и сводка спрашивают статистику по местным суткам', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  assert.match(read('analytics.mjs'), /const key = localDayKey\(\);/, 'копилка статистики — по местным суткам');
  assert.match(read('admin-commands.mjs'), /activityDigest\(localDayKey\(now\)\)/, '/stats — по местным');
  assert.match(read('notices.mjs'), /const key = localDayKey\(yesterday\);/, 'сводка за вчера — тоже');
  // Гринвичская дата в самом боте больше не используется.
  const sources = ['analytics.mjs', 'admin-commands.mjs', 'notices.mjs', 'alerts.mjs', 'store.mjs', 'retention.mjs', 'status.mjs', 'lifecycle.mjs', 'admin-api.mjs', 'admin-api-clients.mjs'];
  for (const file of sources) {
    assert.doesNotMatch(read(file), /(?<![A-Za-z])dayKey\(/, file + ' ещё считает сутки по Гринвичу');
  }
});

test('панель и бот теперь называют один и тот же день одинаково', async () => {
  const { localDayKey } = await import('../src/util.mjs');
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Панель строит ключ дня по местному времени браузера — так же, как бот.
  assert.match(PANEL_HTML, /function dayKeyOf\(date\) \{\s*return date\.getFullYear\(\)/, 'панель считает день по местному времени');
  assert.equal(localDayKey(NIGHT), localKey(NIGHT), 'бот считает так же');
});

test('ежедневная копия и «раз в сутки» тоже считаются по времени бота', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.mjs'), 'utf8');
  assert.match(store, /'bot-data-' \+ localDayKey\(now\)/, 'имя ежедневной копии — по местной дате');
  const retention = fs.readFileSync(path.join(__dirname, '..', 'src', 'retention.mjs'), 'utf8');
  assert.match(retention, /const today = localDayKey\(now\);/);
});
