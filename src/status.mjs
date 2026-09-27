// Сообщения администратору о работе самого бота: запущен, остановлен (и
// почему), включён или выключен в панели, пропадала связь с Telegram,
// случилась внутренняя ошибка. Отключаются в панели («Уведомления
// администратору»). Приходят только главному администратору.

import { cleanText, dayKey, delay } from './util.mjs';
import { data, runtime, scheduleSave } from './store.mjs';
import { sendMessage } from './telegram.mjs';

// A shorter break in the connection is not worth a message.
const OUTAGE_NOTICE_MS = 3 * 60 * 1000;
const ERROR_NOTICE_INTERVAL_MS = 60 * 60 * 1000;
const START_NOTICE_RETRIES = 5;
const START_NOTICE_RETRY_MS = 15000;

// Windows не присылает SIGTERM: и закрытие окна, и выход из учётной записи, и
// выключение компьютера приходят одним и тем же сигналом SIGHUP. Поэтому в
// причине честно перечислено всё, что за ним стоит, — раньше при выключении
// компьютера бот уверенно сообщал «закрыли окно бота».
const STOP_REASONS = {
  SIGINT: 'нажали Ctrl+C в окне бота',
  SIGHUP: 'закрыли окно бота или выключили компьютер',
  SIGBREAK: 'нажали Ctrl+Break в окне бота',
  SIGTERM: 'процесс завершён (диспетчер задач или служба)',
};

function statusNoticesOn() {
  return data.config.statusNotices !== false && Boolean(cleanText(data.config.adminChatId, 40) && data.config.botToken);
}

function clock(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const today = dayKey(new Date()) === dayKey(date);
  return (today ? '' : pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + ' ') + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function duration(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return minutes + ' мин';
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + ' ч' + (minutes % 60 ? ' ' + (minutes % 60) + ' мин' : '');
  return Math.floor(hours / 24) + ' дн';
}

async function sendStatusNotice(text, retries = 0) {
  if (!statusNoticesOn()) return false;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await sendMessage(cleanText(data.config.adminChatId, 40), text, data.config.botToken, { track: false });
      return true;
    } catch {
      if (attempt < retries) await delay(START_NOTICE_RETRY_MS);
    }
  }
  return false;
}

// --- Stop and start ---------------------------------------------------------

function stopNoticeText(signal, now = new Date()) {
  return '🔴 Бот остановлен в ' + clock(now) + ': ' + (STOP_REASONS[signal] || 'остановка') + '.\nКлиенты не получат ответов, пока бот не запущен снова (start-bot.ps1).';
}

// Kept in the data so the next start can tell how long the bot was off.
function rememberShutdown(signal, now = new Date()) {
  data.lastShutdown = { at: now.toISOString(), reason: STOP_REASONS[signal] ? signal : '' };
}

function startNoticeText(now = new Date()) {
  const lines = ['🟢 Бот запущен в ' + clock(now) + '.'];
  const last = data.lastShutdown && Date.parse(data.lastShutdown.at);
  if (Number.isFinite(last) && last <= now.getTime()) {
    const reason = STOP_REASONS[data.lastShutdown.reason];
    lines.push('Перед этим был остановлен в ' + clock(new Date(last)) + (reason ? ' (' + reason + ')' : '') + ', перерыв ' + duration(now.getTime() - last) + '.');
    if (now.getTime() - last >= 24 * 60 * 60 * 1000) lines.push('Telegram хранит сообщения клиентов только сутки — часть из них могла потеряться.');
  }
  if (!data.config.active) lines.push('⏸ В настройках панели бот выключен: сообщения клиентов не обрабатываются, пока его не включат.');
  return lines.join('\n');
}

// Sent once the bot has reached Telegram (see telegramContactRestored), or
// right away with a few retries when it is switched off in the panel and
// does not poll.
function announceStart(now = new Date()) {
  const text = startNoticeText(now);
  if (data.config.active) runtime.pendingStartNotice = text;
  else void sendStatusNotice(text, START_NOTICE_RETRIES);
}

// --- While running ------------------------------------------------------------

function activeChangedNoticeText(active) {
  return active
    ? '▶️ Бот включён в панели и снова отвечает клиентам.'
    : '⏸ Бот выключен в панели: сообщения клиентов не обрабатываются, пока его не включат.';
}

function announceActiveChange(active) {
  void sendStatusNotice(activeChangedNoticeText(active));
}

// Called on every successful contact with Telegram. Sends the pending start
// message, and tells about a longer break in the connection once it is over.
function telegramContactRestored(now = new Date()) {
  if (runtime.pendingStartNotice) {
    const text = runtime.pendingStartNotice;
    runtime.pendingStartNotice = '';
    runtime.outageSince = null;
    void sendStatusNotice(text);
    return 'start';
  }
  const since = runtime.outageSince ? Date.parse(runtime.outageSince) : NaN;
  runtime.outageSince = null;
  if (!Number.isFinite(since) || now.getTime() - since < OUTAGE_NOTICE_MS) return '';
  void sendStatusNotice('📶 Связь с Telegram восстановлена. Её не было с ' + clock(new Date(since)) + ' до ' + clock(now) + ' (' + duration(now.getTime() - since) + '). Сообщения клиентов за это время бот получил и обрабатывает сейчас.');
  return 'outage';
}

function telegramContactLost(now = new Date()) {
  if (!runtime.outageSince) runtime.outageSince = now.toISOString();
}

// An unexpected error: the bot keeps running, the admin hears about it at
// most once an hour.
function announceError(area, error, now = new Date()) {
  const last = Date.parse(data.lastErrorNoticeAt || '');
  if (Number.isFinite(last) && now.getTime() - last < ERROR_NOTICE_INTERVAL_MS) return false;
  data.lastErrorNoticeAt = now.toISOString();
  scheduleSave();
  const message = cleanText(error && error.message ? error.message : error, 300) || 'неизвестная ошибка';
  void sendStatusNotice('❗ Внутренняя ошибка бота (' + area + '): ' + message + '\nБот продолжает работать. Подробности — в панели, журнал ошибок на главной.');
  return true;
}

export {
  OUTAGE_NOTICE_MS,
  STOP_REASONS,
  activeChangedNoticeText,
  announceActiveChange,
  announceError,
  announceStart,
  rememberShutdown,
  sendStatusNotice,
  startNoticeText,
  statusNoticesOn,
  stopNoticeText,
  telegramContactLost,
  telegramContactRestored,
};
