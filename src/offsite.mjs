// Копия данных вне этого компьютера: раз в неделю бот присылает в админ-чат
// зашифрованный файл со всеми данными, кроме фотографий (они больше лимита
// Telegram в 50 МБ). Расшифровать файл можно только паролем копии, который
// знает администратор; на компьютере хранится лишь ключ, полученный из него.
//
// Файл: "KBK1" + соль (16 байт) + IV (12) + тег (16) + AES-256-GCM(gzip(JSON)).

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cleanText, clone, localDayKey } from './util.mjs';
import { normalizeTelegramBackup } from './data-format.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { telegramMultipartRequest } from './telegram.mjs';
import { adminMessagesAllowed } from './hours.mjs';

const BACKUP_MAGIC = Buffer.from('KBK1');
const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BACKUP_PASSWORD_LENGTH = 10;

function deriveBackupKey(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32);
}

function telegramBackupSettings() {
  return normalizeTelegramBackup(data.config && data.config.telegramBackup);
}

// A new password: a new salt and key. Earlier files keep their own salt, so
// they still open with the password they were made with.
function setBackupPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = deriveBackupKey(password, salt).toString('hex');
  data.config.telegramBackup = { ...telegramBackupSettings(), salt, key };
  return data.config.telegramBackup;
}

function encryptBackup(plain, keyHex, saltHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, Buffer.from(saltHex, 'hex'), iv, cipher.getAuthTag(), encrypted]);
}

function isEncryptedBackup(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length > 48 && bytes.subarray(0, 4).equals(BACKUP_MAGIC);
}

// Returns the gzip-compressed JSON inside, or throws on a wrong password.
function decryptBackup(bytes, password) {
  if (!isEncryptedBackup(bytes)) throw new Error('Это не зашифрованная копия');
  const salt = bytes.subarray(4, 20);
  const iv = bytes.subarray(20, 32);
  const tag = bytes.subarray(32, 48);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveBackupKey(password, salt.toString('hex')), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(bytes.subarray(48)), decipher.final()]);
  } catch {
    throw new Error('Неверный пароль копии или файл повреждён');
  }
}

// Everything except the key itself, which would be of no use inside the file.
function backupPayload() {
  const copy = clone(data);
  if (copy.config) copy.config.telegramBackup = { enabled: false };
  return zlib.gzipSync(Buffer.from(JSON.stringify(copy), 'utf8'), { level: 9 });
}

async function sendTelegramBackup(now = new Date(), token = data.config.botToken) {
  const settings = telegramBackupSettings();
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!settings.key || !adminChatId || !token) throw new Error('Сначала задайте пароль копии и подключите админ-чат');
  const file = encryptBackup(backupPayload(), settings.key, settings.salt);
  const day = localDayKey(now);
  try {
    await telegramMultipartRequest(token, 'sendDocument', {
      chat_id: adminChatId,
      caption: '🔐 Резервная копия данных за ' + day.split('-').reverse().join('.') + ' (без фотографий). Хранится зашифрованной. Чтобы восстановить: панель → «Настройки» → «Резервная копия» → «Восстановить», затем пароль копии.',
      document: new File([file], 'kornilenko-backup-' + day + '.kbk', { type: 'application/octet-stream' }),
    });
    data.config.telegramBackup = { ...settings, lastSentAt: now.toISOString(), lastError: '' };
  } catch (error) {
    data.config.telegramBackup = { ...settings, lastError: cleanText(error.message, 300) };
    saveDataNow();
    throw error;
  }
  saveDataNow();
  return file.length;
}

let lastBackupAttemptAt = 0;

// Weekly, during the admin's hours; after a failure, again in an hour.
async function runTelegramBackup(now = new Date()) {
  const settings = telegramBackupSettings();
  if (!settings.enabled || !data.config.adminChatId || !data.config.botToken || !adminMessagesAllowed(now)) return false;
  const last = Date.parse(settings.lastSentAt || '');
  if (Number.isFinite(last) && now.getTime() - last < BACKUP_INTERVAL_MS) return false;
  if (settings.lastError && now.getTime() - lastBackupAttemptAt < 60 * 60 * 1000) return false;
  lastBackupAttemptAt = now.getTime();
  try {
    await sendTelegramBackup(now);
    return true;
  } catch (error) {
    recordError('Копия данных в Telegram', error);
    return false;
  }
}

export {
  BACKUP_INTERVAL_MS,
  MIN_BACKUP_PASSWORD_LENGTH,
  backupPayload,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  runTelegramBackup,
  sendTelegramBackup,
  setBackupPassword,
  telegramBackupSettings,
};
