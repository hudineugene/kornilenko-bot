'use strict';

// Разовые копии в backups/ — это те же персональные данные клиентов: телефоны,
// переписка, заявки. Копия перед обновлением формата, копия перед
// восстановлением и повреждённый файл данных лежали там без срока: удалённый
// клиент оставался в этих файлах навсегда, хотя комментарий в users.mjs
// уверял, что копии ротируются.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bot, dataFile, cleanup } = require('./helpers/chat');

const workDirectory = path.dirname(dataFile);
const backupDirectory = path.join(workDirectory, 'backups');
const DAY_MS = 24 * 60 * 60 * 1000;

// Файл с нужным возрастом: время изменения — то, по которому бот и решает.
function makeFile(file, daysAgo, content = '{"version":28}') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const when = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(file, when, when);
  return file;
}

test.beforeEach(() => {
  fs.rmSync(backupDirectory, { recursive: true, force: true });
  for (const name of fs.readdirSync(workDirectory)) {
    if (name.startsWith(path.basename(dataFile) + '.corrupt-')) fs.rmSync(path.join(workDirectory, name), { force: true });
  }
});
test.after(cleanup);

test('разовые копии старше трёх месяцев убираются', () => {
  const old = [
    makeFile(path.join(backupDirectory, 'pre-upgrade-v27-to-v28-20250101-120000.json'), 200),
    makeFile(path.join(backupDirectory, 'pre-media-migration-20250101-120000.json'), 120),
    makeFile(path.join(backupDirectory, 'pre-restore-20250101-120000.json'), 91),
    makeFile(path.join(workDirectory, path.basename(dataFile) + '.corrupt-20250101-120000'), 100),
  ];

  const removed = bot.pruneOldSnapshots();
  assert.equal(removed, old.length, 'убраны все четыре');
  for (const file of old) assert.ok(!fs.existsSync(file), path.basename(file) + ' удалён');
});

test('свежие копии остаются: ими ещё можно воспользоваться', () => {
  const fresh = [
    makeFile(path.join(backupDirectory, 'pre-upgrade-v27-to-v28-20260901-120000.json'), 20),
    makeFile(path.join(backupDirectory, 'pre-restore-20260925-120000.json'), 3),
    makeFile(path.join(workDirectory, path.basename(dataFile) + '.corrupt-20260927-120000'), 1),
  ];

  assert.equal(bot.pruneOldSnapshots(), 0, 'ничего не убрано');
  for (const file of fresh) assert.ok(fs.existsSync(file), path.basename(file) + ' на месте');
});

test('чужие файлы в backups бот не трогает', () => {
  // Копии bot.exe, копии данных, сделанные владельцем руками, и ежедневные
  // снимки живут по своим правилам — уборка разовых копий их не касается.
  const mine = [
    makeFile(path.join(backupDirectory, 'bot-before-6-3.exe'), 300, 'exe'),
    makeFile(path.join(backupDirectory, 'bot-data-before-whatsapp-2026-09-27.json'), 300),
    makeFile(path.join(backupDirectory, 'daily', 'bot-data-2025-01-01.json'), 300),
    makeFile(path.join(backupDirectory, 'media', 'abc123.jpg'), 300, 'jpeg'),
  ];

  assert.equal(bot.pruneOldSnapshots(), 0, 'ни один чужой файл не убран');
  for (const file of mine) assert.ok(fs.existsSync(file), path.basename(file) + ' на месте');
});

test('отсчёт идёт от переданного времени, папки может и не быть', () => {
  const file = makeFile(path.join(backupDirectory, 'pre-restore-20260925-120000.json'), 3);
  // Через полгода эта же копия считается старой.
  assert.equal(bot.pruneOldSnapshots(new Date(Date.now() + 180 * DAY_MS)), 1);
  assert.ok(!fs.existsSync(file));

  fs.rmSync(backupDirectory, { recursive: true, force: true });
  assert.equal(bot.pruneOldSnapshots(), 0, 'без папки backups уборка просто ничего не находит');
});

test('уборка идёт сама, вместе с ежедневной копией', async () => {
  // Проверка, что уборка действительно подключена к часовому распорядку бота,
  // а не просто существует.
  const old = makeFile(path.join(backupDirectory, 'pre-upgrade-v20-to-v28-20240101-120000.json'), 200);
  const store = await import('../src/store.mjs');
  const quiet = console.log;
  console.log = () => {};
  try {
    store.runDailyBackupSafely();
  } finally {
    console.log = quiet;
  }
  assert.ok(!fs.existsSync(old), 'старая копия убрана заодно с созданием ежедневной');
});
