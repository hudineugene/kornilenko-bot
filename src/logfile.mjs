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
import { APP_DIRECTORY } from './config.mjs';

const LOG_FILE = process.env.BOT_LOG_FILE || path.join(APP_DIRECTORY, 'logs', 'bot.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;

let handle = null;
let written = 0;
let failed = false;
let capturing = false;

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
function rotateLogFile() {
  if (handle === null) return false;
  try {
    fs.closeSync(handle);
  } catch {
    // Уже закрыт — не беда.
  }
  handle = null;
  try {
    fs.rmSync(LOG_FILE + '.1', { force: true });
    fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {
    // Файл кто-то держит: продолжим писать в него же и попробуем позже.
  }
  openLogFile();
  return true;
}

function writeToLog(text) {
  if (failed) return;
  try {
    if (handle === null) openLogFile();
    fs.writeSync(handle, text);
    written += Buffer.byteLength(text, 'utf8');
    if (written <= LOG_MAX_BYTES) return;
    const size = written;
    rotateLogFile();
    const notice = '[' + new Date().toISOString().slice(0, 19) + '] Журнал вырос до '
      + Math.round(size / (1024 * 1024)) + ' МБ, прежний перенесён в bot.log.1\n';
    fs.writeSync(handle, notice);
    written += Buffer.byteLength(notice, 'utf8');
  } catch {
    // Окно бота важнее журнала: если писать не выходит, просто перестаём.
    failed = true;
    handle = null;
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
