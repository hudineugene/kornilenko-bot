// Журнал работы бота (logs/bot.log).
//
// Раньше журнал вело окно запуска: start-bot.ps1 перенаправлял в файл весь
// вывод бота и обрезал файл только при перезапуске. У бота, который работает
// месяцами, журнал рос без предела — а обрезать его на ходу нельзя: пока окно
// держит файл открытым, Windows не даёт его ни переименовать, ни укоротить
// (проверено: EBUSY).
//
// Поэтому журнал ведёт сам бот. Он пишет в файл всё, что выводит на экран,
// и, когда файл перерастает предел, переносит прежний в bot.log.1 и начинает
// новый. Заодно журнал появляется и у бота, запущенного двойным щелчком по
// bot.exe, — раньше в этом случае его не было вовсе.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_FILE } from './config.mjs';

// Журнал лежит рядом с файлом данных, как и файлы картинок: у настоящего бота
// это папка программы, у песочницы и тестов — их собственная папка. Раньше он
// всегда лежал рядом с программой, и песочница писала в живой журнал: там
// накопились сотни ложных «Telegram отклонил токен» от выдуманного токена, а
// такую тревогу легко принять за настоящую.
const LOG_FILE = process.env.BOT_LOG_FILE || path.join(path.dirname(DATA_FILE), 'logs', 'bot.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;

let handle = null;
let written = 0;
let failed = false;
let capturing = false;
// Если перенести журнал не дали (файл открыт в другой программе), пробовать
// на каждой строке бессмысленно: ждём и пишем дальше в тот же файл.
let rotateBlockedUntil = 0;
let writeFailures = 0;
let pausedUntil = 0;
const ROTATE_RETRY_MS = 10 * 60 * 1000;
const WRITE_PAUSE_MS = 5 * 60 * 1000;
const WRITE_FAILURES_BEFORE_PAUSE = 3;

function logFileSize(file = LOG_FILE) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// Пишем синхронно: строк немного, зато в журнал попадает и последняя запись
// перед сбоем — ровно та, ради которой в него и заглядывают.
function openLogFile() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  written = logFileSize();
  handle = fs.openSync(LOG_FILE, 'a');
}

// Предыдущий журнал остаётся рядом как bot.log.1 — по нему видно, что было до.
// Прежнюю копию убираем только после удачного переноса: если перенести не
// вышло, она должна остаться на месте.
function rotateLogFile() {
  if (handle === null) return false;
  const previous = LOG_FILE + '.1';
  const spare = LOG_FILE + '.1.old';
  try {
    fs.closeSync(handle);
  } catch {
    // Уже закрыт — не беда.
  }
  handle = null;
  let moved = false;
  try {
    if (fs.existsSync(previous)) fs.renameSync(previous, spare);
    fs.renameSync(LOG_FILE, previous);
    moved = true;
    rotateBlockedUntil = 0;
  } catch {
    // Файл держит другая программа. Возвращаем прежнюю копию на место и
    // ждём: пробовать на каждой строке — только плодить записи.
    rotateBlockedUntil = Date.now() + ROTATE_RETRY_MS;
  }
  try {
    if (fs.existsSync(spare)) {
      if (moved) fs.rmSync(spare, { force: true });
      else if (!fs.existsSync(previous)) fs.renameSync(spare, previous);
    }
  } catch {
    // Лишняя копия рядом не мешает работе.
  }
  openLogFile();
  return moved;
}

function writeToLog(text) {
  // Записывать не вышло — делаем перерыв, а не выключаем журнал навсегда:
  // файл мог быть занят на минуту антивирусом или открытым редактором.
  if (failed && Date.now() < pausedUntil) return;
  failed = false;
  try {
    if (handle === null) openLogFile();
    fs.writeSync(handle, text);
    writeFailures = 0;
    written += Buffer.byteLength(text, 'utf8');
    if (written <= LOG_MAX_BYTES || Date.now() < rotateBlockedUntil) return;
    const size = written;
    if (!rotateLogFile()) return;
    const notice = '[' + new Date().toISOString().slice(0, 19) + '] Журнал вырос до '
      + Math.round(size / (1024 * 1024)) + ' МБ, прежний перенесён в bot.log.1\n';
    fs.writeSync(handle, notice);
    written += Buffer.byteLength(notice, 'utf8');
  } catch {
    // Окно бота важнее журнала: пробуем открыть файл заново, а после
    // нескольких неудач подряд молчим пять минут и пробуем снова.
    handle = null;
    writeFailures += 1;
    if (writeFailures >= WRITE_FAILURES_BEFORE_PAUSE) {
      failed = true;
      pausedUntil = Date.now() + WRITE_PAUSE_MS;
      writeFailures = 0;
    }
  }
}

// Всё, что бот выводит на экран, попадает и в журнал: и обычные сообщения, и
// сбой, который Node печатает перед завершением.
function startLogFile() {
  if (capturing || failed) return false;
  try {
    if (handle === null) openLogFile();
  } catch {
    failed = true;
    return false;
  }
  capturing = true;
  for (const target of [process.stdout, process.stderr]) {
    const original = target.write.bind(target);
    target.write = (chunk, encoding, callback) => {
      try {
        writeToLog(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      } catch {
        failed = true;
      }
      return original(chunk, encoding, callback);
    };
  }
  return true;
}

export {
  LOG_FILE,
  LOG_MAX_BYTES,
  logFileSize,
  rotateLogFile,
  startLogFile,
  writeToLog,
};
