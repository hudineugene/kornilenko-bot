// Запуск, остановка и отметка о работе бота.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_FILE, HOST, PORT } from './config.mjs';
import { cleanText, dayKey, delay } from './util.mjs';
import { configured, data, runDailyBackupSafely, runtime, saveDataNow, saveTimer } from './store.mjs';
import { runScheduledNotices } from './notices.mjs';
import { recordError } from './analytics.mjs';
import { sendMessage } from './telegram.mjs';
import { restartPolling } from './updates.mjs';
import { startTunnel, stopTunnel } from './remote.mjs';
import { server } from './server.mjs';

const RUN_MARKER_FILE = path.join(path.dirname(DATA_FILE), 'bot-running.json');
const RUN_HEARTBEAT_MS = 60 * 1000;

// While the bot runs, a small marker file holds the time it was last seen
// alive. A normal shutdown removes it. If the marker is still there at the
// next start, the previous run ended abruptly: the process crashed or was
// killed, or the computer was turned off. (Closing the window is handled as a
// normal shutdown, see shutdown().)
function writeRunMarker(startedAt, now = new Date()) {
  try {
    const temporary = RUN_MARKER_FILE + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString(), lastAliveAt: now.toISOString() }), 'utf8');
    fs.renameSync(temporary, RUN_MARKER_FILE);
  } catch (error) {
    console.error('Не удалось обновить отметку работы бота:', error.message);
  }
}

function clearRunMarker() {
  try {
    fs.rmSync(RUN_MARKER_FILE, { force: true });
  } catch {
    // Nothing to clean up.
  }
}

// Returns { lastAliveAt } of an abruptly ended previous run, or null.
function previousRunEndedAbruptly() {
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(RUN_MARKER_FILE, 'utf8'));
  } catch {
    return null;
  }
  const lastAliveAt = new Date(marker && marker.lastAliveAt);
  return Number.isFinite(lastAliveAt.getTime()) ? { lastAliveAt } : { lastAliveAt: null };
}

function clockTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const today = dayKey(new Date()) === dayKey(date);
  return (today ? '' : pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + ' ') + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function abruptStopNotice(previous, now = new Date()) {
  const stoppedAt = previous.lastAliveAt ? 'около ' + clockTime(previous.lastAliveAt) : 'в неизвестное время';
  const lines = [
    '⚠️ Бот был остановлен нештатно ' + stoppedAt + ' (сбой, выключение компьютера или принудительное завершение процесса). Снова работает с ' + clockTime(now) + '.',
  ];
  const downtime = previous.lastAliveAt ? now - previous.lastAliveAt : 0;
  lines.push(downtime < 24 * 60 * 60 * 1000
    ? 'Сообщения клиентов за это время Telegram сохранил — бот ответит на них сейчас.'
    : 'Бот не работал больше суток: Telegram хранит сообщения только 24 часа, часть из них могла потеряться.');
  lines.push('Чтобы остановить бота штатно, нажмите Ctrl+C в его окне.');
  return lines.join('\n');
}

async function reportAbruptStop(previous, token = data.config.botToken) {
  const text = abruptStopNotice(previous);
  recordError('Нештатная остановка', text.split('\n')[0]);
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !token) return text;
  // The connection may still be coming up right after the start.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await sendMessage(adminChatId, text, token, { track: false });
      return text;
    } catch {
      await delay(15000);
    }
  }
  return text;
}

let shuttingDown = false;

// Closing the console window (SIGHUP on Windows) gives the process about ten
// seconds: enough to save, and to tell the admin that the bot is no longer
// running, since nobody may notice otherwise.
const WINDOW_CLOSED_NOTICE_TIMEOUT_MS = 4000;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nЗавершение работы…');
  runtime.generation += 1;
  if (runtime.abortController) runtime.abortController.abort();
  clearTimeout(saveTimer);
  try { saveDataNow(); } catch (error) { console.error('Не удалось сохранить данные:', error.message); }
  clearRunMarker();
  stopTunnel();
  const adminChatId = cleanText(data.config.adminChatId, 40);
  const notice = signal === 'SIGHUP' && adminChatId && data.config.botToken
    ? Promise.race([
      sendMessage(adminChatId, '⚠️ Окно бота закрыто — бот остановлен в ' + clockTime(new Date()) + '. Клиенты не получат ответов, пока бот не запущен снова (start-bot.ps1).', data.config.botToken, { track: false }).catch(() => {}),
      delay(WINDOW_CLOSED_NOTICE_TIMEOUT_MS),
    ])
    : Promise.resolve();
  notice.finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

function start() {
  const previousRun = previousRunEndedAbruptly();
  server.listen(PORT, HOST, () => {
    // Only a started instance owns the marker: a second copy that fails on a
    // busy port must not overwrite the marker of the running one.
    const startedAt = new Date();
    writeRunMarker(startedAt);
    setInterval(() => writeRunMarker(startedAt), RUN_HEARTBEAT_MS).unref();
    const visibleHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
    const adminUrl = 'http://' + visibleHost + ':' + PORT;
    console.log('');
    console.log('  Пульт Telegram-бота запущен');
    console.log('  Откройте: ' + adminUrl);
    console.log(!configured()
      ? '  Требуется первичная настройка в браузере.'
      : data.config.active
        ? '  Бот подключается к Telegram…'
        : '  Бот остановлен в настройках панели.');
    console.log('  Для остановки нажмите Ctrl+C.');
    if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
      console.log('');
      console.log('  ВНИМАНИЕ: панель доступна из сети (' + HOST + ') по HTTP без шифрования.');
      console.log('  Пароль передаётся открытым текстом. Используйте только в доверенной сети.');
    }
    console.log('');
    restartPolling();
    if (previousRun) void reportAbruptStop(previousRun).catch(() => {});
    if (data.config.remoteAccess) startTunnel();
    runDailyBackupSafely();
    setInterval(runDailyBackupSafely, 60 * 60 * 1000).unref();
    setInterval(runScheduledNotices, 15 * 60 * 1000).unref();
    if (process.platform === 'win32' && process.env.NO_AUTO_OPEN !== '1') {
      setTimeout(() => {
        try {
          const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', adminUrl], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          opener.unref();
        } catch {
          // The URL remains visible in the console if automatic opening is unavailable.
        }
      }, 500).unref();
    }
  });

  process.on('SIGINT', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('SIGTERM', shutdown);
  // The app usually runs without a supervisor that would restart it, so it
  // keeps running: the error is shown in the panel and the Telegram
  // connection, the part most likely left in a broken state, is restarted.
  process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
    try {
      recordError('Необработанная ошибка', error);
      if (!shuttingDown) restartPolling();
    } catch {
      // Nothing more can be done safely here.
    }
  });
  process.on('unhandledRejection', (error) => {
    console.error('Необработанная ошибка:', error);
    try {
      recordError('Необработанная ошибка', error);
    } catch {
      // Nothing more can be done safely here.
    }
  });
}

export {
  RUN_HEARTBEAT_MS,
  RUN_MARKER_FILE,
  WINDOW_CLOSED_NOTICE_TIMEOUT_MS,
  abruptStopNotice,
  clearRunMarker,
  clockTime,
  previousRunEndedAbruptly,
  reportAbruptStop,
  shutdown,
  shuttingDown,
  start,
  writeRunMarker,
};
