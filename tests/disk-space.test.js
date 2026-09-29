'use strict';

// 27 сентября диск заполнился до нуля: бот не мог сохранить данные и узнал бы
// об этом только в момент записи. Запас места должен быть виден в самопроверке,
// а когда его мало — бот предупреждает администратора заранее.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { bot, resetData, cleanup } = require('./helpers/chat');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const realStatfs = fs.statfsSync;
const checkOf = (report, id) => report.checks.find((check) => check.id === id);

// Заглушка диска: bavail × bsize — это и есть свободное место.
function freeSpace(bytes) {
  fs.statfsSync = () => ({ bsize: 4096, bfree: bytes / 4096, bavail: bytes / 4096, blocks: (200 * GB) / 4096 });
}

test.beforeEach(() => {
  resetData((data) => {
    data.config.active = true;
    data.config.adminChatId = '9990001';
  });
  fs.statfsSync = realStatfs;
});
test.after(() => {
  fs.statfsSync = realStatfs;
  cleanup();
});

test('самопроверка показывает запас места', () => {
  freeSpace(60 * GB);
  const check = checkOf(bot.runSelfCheck(), 'disk');
  assert.ok(check, 'проверка свободного места есть в отчёте');
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /свободно 60,0 ГБ/);
  assert.match(check.detail, /папка бота занимает/);
});

test('меньше гигабайта — предупреждение, меньше 300 МБ — тревога', () => {
  freeSpace(700 * MB);
  assert.equal(checkOf(bot.runSelfCheck(), 'disk').status, 'warn');
  freeSpace(120 * MB);
  const bad = checkOf(bot.runSelfCheck(), 'disk');
  assert.equal(bad.status, 'bad');
  assert.match(bad.detail, /данные могут не сохраниться/);
});

test('когда места мало, администратор узнаёт об этом раз в сутки', async () => {
  const { diskSpaceNotice } = await import('../src/selfcheck.mjs');
  freeSpace(150 * MB);
  const notice = diskSpaceNotice();
  assert.match(notice, /почти не осталось места/);
  assert.match(notice, /Свободно: 150 МБ/);
  assert.equal(diskSpaceNotice(), '', 'второй раз за сутки не повторяем');
  // Назавтра предупреждение уместно снова.
  const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
  assert.match(diskSpaceNotice(tomorrow), /почти не осталось места/);
});

test('пока места достаточно, никто никого не беспокоит', async () => {
  const { diskSpaceNotice } = await import('../src/selfcheck.mjs');
  freeSpace(40 * GB);
  assert.equal(diskSpaceNotice(), '');
});

test('если размер диска узнать не удалось, бот не падает', async () => {
  const { diskReport } = await import('../src/selfcheck.mjs');
  fs.statfsSync = () => { throw new Error('нет доступа'); };
  assert.equal(diskReport(), null);
  const check = checkOf(bot.runSelfCheck(), 'disk');
  assert.equal(check.status, 'warn');
  assert.match(check.detail, /не удалось узнать/);
});

test('отметка о предупреждении переживает перезапуск', () => {
  const restored = bot.normalizeLoadedData({ version: 14, lastDiskWarningFor: '2026-09-27' });
  assert.equal(restored.lastDiskWarningFor, '2026-09-27');
});

test('размер папки бота считается не чаще раза в минуту: «Сегодня» спрашивает самопроверку каждые 20 секунд', async () => {
  const { diskReport } = await import('../src/selfcheck.mjs');
  freeSpace(40 * GB);
  diskReport(); // первый раз — обход папки
  const realStat = fs.statSync;
  let calls = 0;
  fs.statSync = (...args) => { calls += 1; return realStat(...args); };
  try {
    const again = diskReport();
    diskReport();
    assert.ok(again && again.used >= 0, 'отчёт есть');
    assert.equal(calls, 0, 'повторный отчёт не обходит папку заново');
  } finally {
    fs.statSync = realStat;
  }
});
