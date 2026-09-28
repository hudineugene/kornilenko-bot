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

test('журнал, который держит другая программа, не плодит записи о переносе', () => {
  // Раньше при неудачном переносе бот пробовал снова на каждой строке и каждый
  // раз дописывал «Журнал вырос…» — 763 таких записи на 760 строк, а файл всё
  // равно рос. И прежняя копия удалялась до переименования, то есть зря.
  fs.writeFileSync(logFile + '.1', 'прежний журнал');
  // В журнале уже есть одна такая запись — от удачного переноса выше.
  const noticesBefore = (fs.readFileSync(logFile, 'utf8').match(/Журнал вырос/g) || []).length;
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(from) === logFile) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return realRename(from, to);
  };
  try {
    const line = 'занятый журнал: ' + 'ж'.repeat(400) + '\n';
    const times = Math.ceil(logs.LOG_MAX_BYTES / Buffer.byteLength(line, 'utf8')) + 40;
    for (let index = 0; index < times; index += 1) logs.writeToLog(line);
  } finally {
    fs.renameSync = realRename;
  }
  const current = fs.readFileSync(logFile, 'utf8');
  assert.equal((current.match(/Журнал вырос/g) || []).length, noticesBefore, 'переноса не было — и новых записей о нём нет');
  assert.equal(fs.readFileSync(logFile + '.1', 'utf8'), 'прежний журнал', 'прежняя копия осталась на месте');
  assert.match(current, /занятый журнал/, 'бот продолжает писать в тот же файл');
  assert.ok(!fs.existsSync(logFile + '.1.old'), 'лишних файлов рядом не осталось');
});

test('когда файл освобождается, перенос удаётся со следующей попыткой', () => {
  const realNow = Date.now;
  const later = realNow() + 11 * 60 * 1000;
  Date.now = () => later;
  try {
    logs.writeToLog('[попытка после ожидания]\n');
  } finally {
    Date.now = realNow;
  }
  assert.ok(fs.statSync(logFile + '.1').size > logs.LOG_MAX_BYTES, 'разросшийся журнал ушёл в bot.log.1');
  assert.match(fs.readFileSync(logFile, 'utf8'), /Журнал вырос до \d+ МБ/, 'а в новом сказано, что случилось');
});

test('после ошибки записи журнал не выключается до перезапуска', () => {
  // Раньше одна неудачная запись (файл занят антивирусом, открыт редактором)
  // молча выключала журнал до следующего запуска бота.
  const realWrite = fs.writeSync;
  const realNow = Date.now;
  let broken = true;
  fs.writeSync = (...args) => {
    if (broken) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return realWrite(...args);
  };
  try {
    for (let index = 0; index < 4; index += 1) logs.writeToLog('[запись не дошла]\n');
    broken = false;
    // Через шесть минут — перерыв закончился, переносить пока нечего.
    const later = realNow() + 6 * 60 * 1000;
    Date.now = () => later;
    logs.writeToLog('[журнал снова пишет]\n');
  } finally {
    fs.writeSync = realWrite;
    Date.now = realNow;
  }
  assert.match(fs.readFileSync(logFile, 'utf8'), /журнал снова пишет/, 'журнал вернулся к работе сам');
});
