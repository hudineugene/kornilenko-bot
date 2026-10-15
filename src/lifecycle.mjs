// Запуск, остановка и отметка о работе бота.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_FILE, HOST, PORT } from './config.mjs';
import { cleanText, delay, localDayKey } from './util.mjs';
import { cancelScheduledSave, configured, data, runDailyBackupSafely, runtime, saveDataNow } from './store.mjs';
import { runScheduledNotices } from './notices.mjs';
import { recordError } from './analytics.mjs';
import { sendMessage } from './telegram.mjs';
import { restartPolling } from './updates.mjs';
import { startTunnel, stopTunnel } from './remote.mjs';
import { server } from './server.mjs';
import { announceError, announceStart, rememberShutdown, sendStatusNotice, statusNoticesOn, stopNoticeText } from './status.mjs';
import { diskSpaceNotice, runSelfCheck, selfCheckLines, selfCheckNotice } from './selfcheck.mjs';
import { startLogFile } from './logfile.mjs';
import { adminSendPlan } from './notify-plan.mjs';
import { miniAppSettings } from './miniapp/settings.mjs';
import { stopMiniApp, syncMiniApp } from './miniapp/server.mjs';
import { configureMiniAppButton } from './miniapp/menu-button.mjs';
import { startKnowledgeSync } from './ai-knowledge.mjs';
import { startAgentOutbox } from './ai-outbox.mjs';
import { startAgentJournal } from './agent-journal.mjs';

const RUN_MARKER_FILE = path.join(path.dirname(DATA_FILE), 'bot-running.json');
const RUN_HEARTBEAT_MS = 60 * 1000;
// Метку обновляет живой бот раз в минуту: с запасом считаем её своей, если ей
// меньше трёх минут.
const RUN_MARKER_STALE_MS = 3 * RUN_HEARTBEAT_MS;

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

function readRunMarker() {
  try {
    return JSON.parse(fs.readFileSync(RUN_MARKER_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function processAlive(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0 || id === process.pid) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    // EPERM: процесс есть, но принадлежит другому пользователю.
    return error && error.code === 'EPERM';
  }
}

// Вторая копия на тех же данных: та же метка, живой процесс и свежий отпечаток
// времени. Две копии с одним токеном мешают друг другу — Telegram отдаёт
// сообщения только одной, и часть ответов теряется.
function runningCopy(now = new Date()) {
  const marker = readRunMarker();
  if (!marker || !processAlive(marker.pid)) return null;
  const lastAliveAt = Date.parse(marker.lastAliveAt || '');
  if (!Number.isFinite(lastAliveAt) || now.getTime() - lastAliveAt > RUN_MARKER_STALE_MS) return null;
  return { pid: Number(marker.pid), lastAliveAt: new Date(lastAliveAt) };
}

function secondCopyNotice(copy) {
  return [
    '  Бот уже запущен на этих данных (процесс ' + copy.pid + ', отметка ' + clockTime(copy.lastAliveAt) + ').',
    '  Вторая копия не запущена: с одним токеном они мешают друг другу и часть ответов клиентам теряется.',
    '  Нажмите Ctrl+C в окне работающего бота, если хотите запустить заново.',
  ].join('\n');
}

// Returns { lastAliveAt } of an abruptly ended previous run, or null.
function previousRunEndedAbruptly() {
  const marker = readRunMarker();
  if (!marker) return null;
  const lastAliveAt = new Date(marker.lastAliveAt);
  return Number.isFinite(lastAliveAt.getTime()) ? { lastAliveAt } : { lastAliveAt: null };
}

function clockTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const today = localDayKey(new Date()) === localDayKey(date);
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
      await sendMessage(adminChatId, text, token, { track: false, ...adminSendPlan('system').options });
      return text;
    } catch {
      await delay(15000);
    }
  }
  return text;
}

// Проверка при запуске ждёт, пока установится связь с Telegram.
const FIRST_SCHEDULE_CHECK_MS = 30 * 1000;
const SELF_CHECK_DELAY_MS = 20 * 1000;

function watchDiskSpace() {
  try {
    const notice = diskSpaceNotice();
    if (!notice) return;
    console.log(notice);
    recordError('Свободное место', new Error(notice.split('\n')[0]));
    void sendStatusNotice(notice).catch(() => {});
  } catch (error) {
    console.error('Не удалось проверить свободное место:', error.message);
  }
}

function reportSelfCheck() {
  try {
    const report = runSelfCheck();
    console.log('');
    console.log('  Проверка при запуске:');
    for (const line of selfCheckLines(report)) console.log('  ' + line);
    console.log('');
    const notice = selfCheckNotice(report);
    if (notice) void sendStatusNotice(notice).catch(() => {});
    return report;
  } catch (error) {
    console.error('Не удалось выполнить проверку при запуске:', error.message);
    return null;
  }
}

let shuttingDown = false;

// Закрытие окна, выход из учётной записи и выключение Windows приходят как
// SIGHUP, и времени у процесса немного: система ждёт несколько секунд и гасит
// его принудительно. Поэтому данные сохраняются первым делом, а на сообщение
// администратору отводится короткий срок — не успело уйти, значит не успело.
const WINDOW_CLOSED_NOTICE_TIMEOUT_MS = 2500;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nЗавершение работы…');
  runtime.generation += 1;
  if (runtime.abortController) runtime.abortController.abort();
  cancelScheduledSave();
  rememberShutdown(signal);
  try { saveDataNow(); } catch (error) { console.error('Не удалось сохранить данные:', error.message); }
  clearRunMarker();
  stopTunnel();
  stopMiniApp();
  const notice = statusNoticesOn()
    ? Promise.race([sendStatusNotice(stopNoticeText(signal)), delay(WINDOW_CLOSED_NOTICE_TIMEOUT_MS)])
    : Promise.resolve();
  // Прощание занимает до нескольких секунд, и за это время данные ещё
  // меняются: ответ дошёл до клиента, альбом собрался, просмотр подтвердился.
  // Поэтому перед самым выходом сохраняем ещё раз.
  const finish = () => {
    cancelScheduledSave();
    try {
      saveDataNow();
    } catch (error) {
      console.error('Не удалось сохранить данные:', error.message);
    }
    process.exit(0);
  };
  notice.finally(() => {
    server.close(finish);
    setTimeout(finish, 2000).unref();
  });
}

function start() {
  // Журнал ведёт сам бот: всё, что он выводит на экран, попадает в
  // logs/bot.log, а разросшийся файл переносится в bot.log.1.
  startLogFile();
  const running = runningCopy();
  if (running && process.env.BOT_ALLOW_SECOND_COPY !== '1') {
    console.log('');
    console.log(secondCopyNotice(running));
    console.log('');
    process.exit(1);
  }
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
    // Короткая проверка «всё ли на месте»: в окне видно всегда, в Telegram
    // уходит только то, что клиенты или администратор почувствуют. Ждём, пока
    // станет известно состояние связи, иначе проверка сообщит о ней зря.
    if (configured()) setTimeout(reportSelfCheck, SELF_CHECK_DELAY_MS).unref();
    if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
      console.log('');
      console.log('  ВНИМАНИЕ: панель доступна из сети (' + HOST + ') по HTTP без шифрования.');
      console.log('  Пароль передаётся открытым текстом. Используйте только в доверенной сети.');
    }
    console.log('');
    // The start message waits for Telegram; after a crash the admin gets the
    // crash notice instead, which already says the bot is running again.
    if (!previousRun) announceStart();
    restartPolling();
    // Приложение в Telegram: слушает только этот компьютер, наружу его выводит обратный прокси с HTTPS.
    syncMiniApp();
    if (miniAppSettings().enabled) void configureMiniAppButton(data.config.botToken).catch(() => {});
    if (previousRun) void reportAbruptStop(previousRun).catch(() => {});
    if (data.config.remoteAccess) startTunnel();
    runDailyBackupSafely();
    setInterval(runDailyBackupSafely, 60 * 60 * 1000).unref();
    // Запас места смотрим раз в час: предупредить нужно до того, как данные
    // не сохранятся, а не после.
    watchDiskSpace();
    setInterval(watchDiskSpace, 60 * 60 * 1000).unref();
    // База знаний ИИ-консультанта: отправляется сама, когда меняются объекты и тексты.
    startKnowledgeSync();
    // Ответы менеджера и «Вернуть агенту» из «Диалогов» GenAgent — бот выполняет их своим именем.
    startAgentOutbox();
    startAgentJournal();

    // Первая проверка — вскоре после запуска, а не через 15 минут: пост,
    // время которого пришло, пока бот был выключен, не должен ждать четверть
    // часа. Небольшая задержка нужна, чтобы связь с Telegram успела ожить.
    setTimeout(runScheduledNotices, FIRST_SCHEDULE_CHECK_MS).unref();
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
  // Ctrl+Break в окне бота: без этого обработчика окно просто гасло.
  process.on('SIGBREAK', shutdown);
  // Последняя попытка сохранить данные, если выход произошёл другим путём:
  // необработанная ошибка, process.exit из другого места, закрытие потока.
  process.on('exit', () => {
    if (shuttingDown) return;
    try {
      cancelScheduledSave();
      saveDataNow();
      rememberShutdown('');
      saveDataNow();
      clearRunMarker();
    } catch {
      // Выход уже идёт — сделать больше нечего.
    }
  });
  // The app usually runs without a supervisor that would restart it, so it
  // keeps running: the error is shown in the panel and the Telegram
  // connection, the part most likely left in a broken state, is restarted.
  process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
    try {
      recordError('Необработанная ошибка', error);
      announceError('необработанная ошибка', error);
      if (!shuttingDown) restartPolling();
    } catch {
      // Nothing more can be done safely here.
    }
  });
  process.on('unhandledRejection', (error) => {
    console.error('Необработанная ошибка:', error);
    try {
      recordError('Необработанная ошибка', error);
      announceError('необработанная ошибка', error);
    } catch {
      // Nothing more can be done safely here.
    }
  });
}

export {
  RUN_HEARTBEAT_MS,
  RUN_MARKER_STALE_MS,
  SELF_CHECK_DELAY_MS,
  RUN_MARKER_FILE,
  WINDOW_CLOSED_NOTICE_TIMEOUT_MS,
  abruptStopNotice,
  runningCopy,
  secondCopyNotice,
  clearRunMarker,
  clockTime,
  previousRunEndedAbruptly,
  reportAbruptStop,
  shutdown,
  shuttingDown,
  start,
  writeRunMarker,
};
