'use strict';

// Журнал logs/bot.log обрезался только при перезапуске бота: тот, кто работает
// месяцами, писал в него без предела. Обрезать файл на ходу было нельзя —
// его держало открытым окно запуска, и Windows не давала ни переименовать, ни
// укоротить. Поэтому журнал теперь ведёт сам бот.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-log-test-'));
const logFile = path.join(box, 'logs', 'bot.log');
process.env.BOT_LOG_FILE = logFile;

let logs = null;

test.before(async () => {
  logs = await import('../src/logfile.mjs');
});
test.after(() => {
  fs.rmSync(box, { recursive: true, force: true });
  delete process.env.BOT_LOG_FILE;
});

test('бот заводит журнал сам, даже если папки ещё нет', () => {
  assert.ok(!fs.existsSync(logFile), 'журнала пока нет');
  logs.writeToLog('[первая строка]\n');
  assert.ok(fs.existsSync(logFile), 'файл создан вместе с папкой');
});

test('разросшийся журнал переносится в bot.log.1, работа продолжается', () => {
  const line = 'запись журнала: ' + 'ж'.repeat(400) + '\n';
  // Пишем больше предела в 5 МБ.
  const times = Math.ceil((logs.LOG_MAX_BYTES / Buffer.byteLength(line, 'utf8')) + 10);
  for (let index = 0; index < times; index += 1) logs.writeToLog(line);

  assert.ok(fs.existsSync(logFile + '.1'), 'прежний журнал сохранён рядом');
  assert.ok(fs.statSync(logFile + '.1').size > logs.LOG_MAX_BYTES, 'в нём всё, что было');
  const current = fs.readFileSync(logFile, 'utf8');
  assert.ok(fs.statSync(logFile).size < logs.LOG_MAX_BYTES, 'новый журнал начался с нуля');
  assert.match(current, /Журнал вырос до \d+ МБ/, 'в новом сказано, что случилось');

  logs.writeToLog('[после переноса]\n');
  assert.match(fs.readFileSync(logFile, 'utf8'), /после переноса/, 'бот продолжает писать');
});

test('журнал забирает вывод бота на экран', () => {
  const written = [];
  const original = process.stdout.write.bind(process.stdout);
  // Настоящий вывод в тесте не нужен — важно, что строка попала в журнал.
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    logs.startLogFile();
    console.log('сообщение бота для журнала');
  } finally {
    process.stdout.write = original;
  }
  assert.ok(written.some((line) => line.includes('сообщение бота')), 'на экран сообщение тоже попало');
  assert.match(fs.readFileSync(logFile, 'utf8'), /сообщение бота для журнала/, 'и в журнал');
});

test('окно запуска больше не перенаправляет вывод в файл', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'start-bot.ps1'), 'utf8');
  assert.doesNotMatch(script, /cmd\.exe \/c \(\$command \+ ' >> /, 'перенаправления нет — файл ведёт сам бот');
  assert.match(script, /cmd\.exe \/c \$command/);
});
