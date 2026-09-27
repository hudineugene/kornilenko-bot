// Доступ к панели из интернета: туннель Cloudflare и вход с кодом из Telegram.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { APP_DIRECTORY, PORT } from './config.mjs';
import { cleanText } from './util.mjs';
import { data, runtime } from './store.mjs';
import { recordError } from './analytics.mjs';
import { sendMessage } from './telegram.mjs';
import { json } from './admin-http.mjs';
import { shuttingDown } from './lifecycle.mjs';

// --- Access from the internet --------------------------------------------------
// A Cloudflare quick tunnel (cloudflared.exe next to the bot) gives the panel a
// random https://….trycloudflare.com address. A remote login needs the
// password and a one-time code the bot sends to the admin chat in Telegram.

const REMOTE_LOGIN_CODE_TTL_MS = 5 * 60 * 1000;
const REMOTE_LOGIN_CODE_ATTEMPTS = 5;
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const TUNNEL_RESTART_DELAY_MS = 30 * 1000;
const CLOUDFLARED_PATH = process.env.CLOUDFLARED_PATH || path.join(APP_DIRECTORY, 'cloudflared.exe');
const pendingRemoteLogins = new Map();
let tunnelProcess = null;
let tunnelRestartTimer = null;

function remoteLoginCodeHash(code, challenge) {
  return crypto.createHash('sha256').update(challenge + ':' + code).digest('hex');
}

async function startRemoteLogin(res, ip) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.adminNotificationVerifiedAt || !data.config.botToken) {
    return json(res, 403, { error: 'Вход из интернета возможен только с подтверждённым админ-чатом в Telegram: туда приходит код для входа.' });
  }
  const now = Date.now();
  for (const [key, pending] of pendingRemoteLogins) if (pending.expiresAt < now) pendingRemoteLogins.delete(key);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const challenge = crypto.randomBytes(24).toString('hex');
  try {
    await sendMessage(adminChatId, '🔐 Код для входа в панель: ' + code + '\n\nДействует 5 минут. Вход из интернета, адрес ' + ip + '.\nЕсли это не вы — никому не сообщайте код и смените пароль в настройках панели.', data.config.botToken, { track: false });
  } catch (error) {
    recordError('Код для входа', error);
    return json(res, 502, { error: 'Не удалось отправить код в Telegram. Попробуйте ещё раз.' });
  }
  pendingRemoteLogins.set(challenge, { codeHash: remoteLoginCodeHash(code, challenge), expiresAt: now + REMOTE_LOGIN_CODE_TTL_MS, attempts: 0 });
  return json(res, 200, { twoFactor: true, challenge });
}

// Неверный пароль из интернета получает такой же ответ, как верный: мы просим
// код, которого никто не получал. Так перебор не узнаёт пароль.
function startDecoyRemoteLogin(res) {
  const now = Date.now();
  for (const [key, pending] of pendingRemoteLogins) if (pending.expiresAt < now) pendingRemoteLogins.delete(key);
  const challenge = crypto.randomBytes(24).toString('hex');
  pendingRemoteLogins.set(challenge, {
    codeHash: crypto.randomBytes(32).toString('hex'),
    expiresAt: now + REMOTE_LOGIN_CODE_TTL_MS,
    attempts: 0,
    decoy: true,
  });
  return json(res, 200, { twoFactor: true, challenge });
}

function tunnelInstalled() {
  return fs.existsSync(CLOUDFLARED_PATH);
}

// cloudflared also mentions its own API (https://api.trycloudflare.com) in
// log and error lines; only the assigned quick-tunnel address counts.
function tunnelUrlFrom(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    if (/failed|error|\bERR\b/i.test(line)) continue;
    for (const match of line.matchAll(new RegExp(TUNNEL_URL_PATTERN.source, 'gi'))) {
      const url = match[0].toLowerCase();
      if (url !== 'https://api.trycloudflare.com') return url;
    }
  }
  return '';
}

function tunnelErrorFrom(output) {
  const lines = String(output || '').split(/\r?\n/).filter((line) => /failed|error|\bERR\b/i.test(line));
  return lines.length ? cleanText(lines[lines.length - 1], 300) : '';
}

// What to tell the admin when cloudflared stops, based on its last error.
function tunnelFailureText(lastError, named) {
  if (/api\.trycloudflare\.com/i.test(lastError) && /deadline|timeout|refused|unreachable/i.test(lastError)) {
    return 'Сервис временных туннелей Cloudflare (api.trycloudflare.com) недоступен из этой сети — похоже, его блокирует провайдер, роутер или антивирус. Используйте постоянный туннель: токен и адрес из вашей учётной записи Cloudflare.';
  }
  if (named && /unauthorized|invalid.*token|token.*invalid/i.test(lastError)) {
    return 'Cloudflare не принял токен туннеля. Проверьте токен в настройках.';
  }
  return 'Туннель остановился' + (lastError ? ': ' + lastError : '') + '.';
}

const TUNNEL_MAX_RESTART_DELAY_MS = 10 * 60 * 1000;
let tunnelRestartDelay = TUNNEL_RESTART_DELAY_MS;

function tunnelMode() {
  return data.config.tunnelToken && data.config.tunnelHostname ? 'named' : 'quick';
}

async function announceTunnel(url) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken) return;
  await sendMessage(adminChatId, '🌐 Панель доступна из интернета:\n' + url + '\n\nВход: пароль администратора и код, который придёт сюда. Адрес меняется при каждом перезапуске бота — новый придёт в этот чат.', data.config.botToken, { track: false })
    .catch((error) => recordError('Доступ из интернета', error));
}

function startTunnel(spawnProcess = spawn) {
  if (tunnelProcess || !data.config.remoteAccess || shuttingDown) return;
  clearTimeout(tunnelRestartTimer);
  if (!tunnelInstalled()) {
    runtime.tunnel = { status: 'missing', url: '', host: '', error: 'Рядом с ботом нет cloudflared.exe' };
    return;
  }
  runtime.tunnel = { status: 'starting', url: '', host: '', error: '' };
  const named = tunnelMode() === 'named';
  // A named tunnel's public hostname and target are set in the Cloudflare
  // dashboard; the token goes through the environment, not the command line.
  const child = named
    ? spawnProcess(CLOUDFLARED_PATH, ['tunnel', '--no-autoupdate', 'run'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TUNNEL_TOKEN: data.config.tunnelToken } })
    : spawnProcess(CLOUDFLARED_PATH, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + PORT], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  tunnelProcess = child;
  let lastError = '';
  const goOnline = (url) => {
    tunnelRestartDelay = TUNNEL_RESTART_DELAY_MS;
    runtime.tunnel = { status: 'online', url, host: new URL(url).hostname, error: '' };
    console.log('  Панель доступна из интернета: ' + url);
    void announceTunnel(url);
  };
  const onOutput = (chunk) => {
    if (tunnelProcess !== child) return;
    lastError = tunnelErrorFrom(chunk) || lastError;
    if (named) {
      if (runtime.tunnel.status !== 'online' && /Registered tunnel connection/i.test(String(chunk))) goOnline('https://' + data.config.tunnelHostname);
      return;
    }
    const url = tunnelUrlFrom(chunk);
    if (url && url !== runtime.tunnel.url) goOnline(url);
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);
  child.on('error', (error) => {
    runtime.tunnel = { status: 'error', url: '', host: '', error: error.message };
    recordError('Доступ из интернета', error);
  });
  child.on('exit', (code) => {
    if (tunnelProcess !== child) return;
    tunnelProcess = null;
    if (!data.config.remoteAccess || shuttingDown) {
      runtime.tunnel = { status: 'off', url: '', host: '', error: '' };
      return;
    }
    const delaySeconds = Math.round(tunnelRestartDelay / 1000);
    const failure = tunnelFailureText(lastError, named);
    runtime.tunnel = { status: 'error', url: '', host: '', error: failure + ' Новая попытка через ' + (delaySeconds >= 60 ? Math.round(delaySeconds / 60) + ' мин.' : delaySeconds + ' с.') };
    if (tunnelRestartDelay === TUNNEL_RESTART_DELAY_MS) recordError('Доступ из интернета', failure + (code != null ? ' (код ' + code + ')' : ''));
    tunnelRestartTimer = setTimeout(() => startTunnel(spawnProcess), tunnelRestartDelay);
    if (tunnelRestartTimer.unref) tunnelRestartTimer.unref();
    // Retries get rarer while the tunnel keeps failing.
    tunnelRestartDelay = Math.min(tunnelRestartDelay * 2, TUNNEL_MAX_RESTART_DELAY_MS);
  });
}

function stopTunnel() {
  clearTimeout(tunnelRestartTimer);
  tunnelRestartDelay = TUNNEL_RESTART_DELAY_MS;
  const child = tunnelProcess;
  tunnelProcess = null;
  runtime.tunnel = { status: 'off', url: '', host: '', error: '' };
  if (child) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
}

export {
  CLOUDFLARED_PATH,
  REMOTE_LOGIN_CODE_ATTEMPTS,
  REMOTE_LOGIN_CODE_TTL_MS,
  TUNNEL_MAX_RESTART_DELAY_MS,
  TUNNEL_RESTART_DELAY_MS,
  TUNNEL_URL_PATTERN,
  announceTunnel,
  pendingRemoteLogins,
  remoteLoginCodeHash,
  startDecoyRemoteLogin,
  startRemoteLogin,
  startTunnel,
  stopTunnel,
  tunnelErrorFrom,
  tunnelFailureText,
  tunnelInstalled,
  tunnelMode,
  tunnelProcess,
  tunnelRestartDelay,
  tunnelRestartTimer,
  tunnelUrlFrom,
};
