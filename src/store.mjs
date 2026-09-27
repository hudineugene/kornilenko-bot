// Данные бота в памяти и на диске: загрузка, сохранение, резервные копии, runtime.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_FILE, MEDIA_DIRECTORY } from './config.mjs';
import { clone, dayKey } from './util.mjs';
import { DATA_VERSION, defaultData, normalizeLoadedData, normalizeTimeZone } from './data-format.mjs';
import { cleanupOrphanImages, containsEmbeddedImages, contentAddressImages, ensureMigrationBackup, externalizeImages, forEachStoredImage, needsContentAddressing, referencedImageFiles, storedImageFile } from './media.mjs';
import { applyInterfaceText } from './texts.mjs';
import { recordError } from './analytics.mjs';

const DATA_BACKUP_FILE = DATA_FILE + '.bak';
const DATA_BACKUP_INTERVAL_MS = 60 * 60 * 1000;

function fileStamp(value = new Date()) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function readDataFile(filePath) {
  return normalizeLoadedData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

const BACKUP_DIRECTORY = path.join(path.dirname(DATA_FILE), 'backups');
const DAILY_BACKUP_DIRECTORY = path.join(BACKUP_DIRECTORY, 'daily');
const MEDIA_BACKUP_DIRECTORY = path.join(BACKUP_DIRECTORY, 'media');
const DAILY_BACKUPS_KEPT = 14;

function jsonFilesIn(directory) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

// The hourly .bak copy first, then the snapshots in backups/ and
// backups/daily/, newest first.
function recoveryCandidates() {
  const snapshots = jsonFilesIn(BACKUP_DIRECTORY).concat(jsonFilesIn(DAILY_BACKUP_DIRECTORY))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return [DATA_BACKUP_FILE, ...snapshots].filter((candidate) => fs.existsSync(candidate));
}

// Data written by an older version is upgraded while it loads. The file as
// it was is copied to backups/ first, once per upgrade
// (pre-upgrade-v15-to-v16-<time>.json), so the upgrade can be undone by
// stopping the bot and putting that copy back as bot-data.json.
function backupBeforeUpgrade(raw) {
  const version = Number(raw && raw.version) || 0;
  if (version >= DATA_VERSION) return '';
  try {
    return ensureMigrationBackup('pre-upgrade-v' + version + '-to-v' + DATA_VERSION);
  } catch (error) {
    console.error('Не удалось сохранить копию данных перед обновлением формата:', error.message);
    return '';
  }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return clone(defaultData);
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const snapshot = backupBeforeUpgrade(raw);
    if (snapshot) console.log('Формат данных обновляется до версии ' + DATA_VERSION + '. Копия прежних данных:', snapshot);
    return normalizeLoadedData(raw);
  } catch (error) {
    console.error('Не удалось прочитать файл данных:', error.message);
  }
  for (const candidate of recoveryCandidates()) {
    let recovered;
    try {
      recovered = readDataFile(candidate);
    } catch {
      continue;
    }
    const corruptCopy = DATA_FILE + '.corrupt-' + fileStamp();
    fs.copyFileSync(DATA_FILE, corruptCopy);
    console.error('Данные восстановлены из копии:', candidate);
    console.error('Повреждённый файл сохранён как:', corruptCopy);
    recovered.errors.unshift({
      id: crypto.randomUUID(),
      area: 'Загрузка данных',
      message: 'Файл данных был повреждён. Данные восстановлены из копии ' + path.basename(candidate) + ', последние изменения могли потеряться. Повреждённый файл: ' + path.basename(corruptCopy),
      createdAt: new Date().toISOString(),
    });
    return recovered;
  }
  console.error('Подходящая резервная копия не найдена. Исправьте или удалите файл:', DATA_FILE);
  process.exit(1);
}

let data = loadData();

function applyConfiguredTimeZone(root = data) {
  const timeZone = normalizeTimeZone(root && root.config && root.config.timeZone);
  if (root && root.config) root.config.timeZone = timeZone;
  process.env.TZ = timeZone;
  return timeZone;
}

applyConfiguredTimeZone();
let saveTimer = null;
let lastReferencedImages = null;
let lastDataBackupAt = 0;

// Keeps a known-good copy of the data file that loadData can fall back to.
function rotateDataBackup() {
  if (Date.now() - lastDataBackupAt < DATA_BACKUP_INTERVAL_MS || !fs.existsSync(DATA_FILE)) return;
  try {
    JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return;
  }
  fs.copyFileSync(DATA_FILE, DATA_BACKUP_FILE);
  lastDataBackupAt = Date.now();
}

function saveDataNow() {
  const directory = path.dirname(DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  if (containsEmbeddedImages(data)) {
    ensureMigrationBackup();
    externalizeImages(data);
  }
  if (needsContentAddressing(data)) contentAddressImages(data);
  rotateDataBackup();
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
  // Scanning the media folder is only needed when the set of referenced files changed.
  const referenced = referencedImageFiles(data);
  const signature = Array.from(referenced).sort().join('|');
  if (signature !== lastReferencedImages) {
    cleanupOrphanImages(data, referenced);
    lastReferencedImages = signature;
  }
}

// Throttled rather than debounced: a steady stream of updates must not
// postpone the write indefinitely.
function scheduleSave() {
  // Во время рассылки файл сохраняет сама рассылка — раз в пять секунд и в
  // конце. Иначе каждый получатель тянул бы за собой запись всего файла:
  // на пяти тысячах клиентов это тысячи перезаписей за одну рассылку.
  if (runtime.broadcastRunning) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveDataNow();
    } catch (error) {
      console.error('Ошибка сохранения:', error.message);
    }
  }, 150);
}

if (containsEmbeddedImages(data)) {
  try {
    saveDataNow();
    console.log('Фотографии перенесены в отдельное локальное хранилище:', MEDIA_DIRECTORY);
  } catch (error) {
    console.error('Не удалось перенести фотографии в локальное хранилище:', error.message);
    process.exit(1);
  }
}

if (needsContentAddressing(data)) {
  try {
    ensureMigrationBackup('pre-media-dedupe');
    saveDataNow();
    console.log('Одинаковые фотографии объединены в хранилище:', MEDIA_DIRECTORY);
  } catch (error) {
    console.error('Не удалось объединить одинаковые фотографии:', error.message);
  }
}

function storedImageNames(root) {
  const names = new Set();
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName) names.add(fileName);
  });
  return names;
}

// Brings back photos that are referenced by the data but missing from
// bot-media, using the copies made by the daily backup.
function restoreMissingMedia(root) {
  let restored = 0;
  for (const fileName of storedImageNames(root)) {
    const target = path.join(MEDIA_DIRECTORY, fileName);
    const copy = path.join(MEDIA_BACKUP_DIRECTORY, fileName);
    if (fs.existsSync(target) || !fs.existsSync(copy)) continue;
    fs.mkdirSync(MEDIA_DIRECTORY, { recursive: true });
    fs.copyFileSync(copy, target);
    restored += 1;
  }
  return restored;
}

// Once a day: a copy of bot-data.json in backups/daily/ and a copy of every
// photo it references in backups/media/. Photo files are named by their
// content, so each one is copied only once no matter how many snapshots use
// it. Only the newest DAILY_BACKUPS_KEPT snapshots are kept, and photos that
// none of them references any more are removed.
function runDailyBackup(now = new Date()) {
  const target = path.join(DAILY_BACKUP_DIRECTORY, 'bot-data-' + dayKey(now) + '.json');
  if (fs.existsSync(target)) return '';
  saveDataNow();
  fs.mkdirSync(DAILY_BACKUP_DIRECTORY, { recursive: true });
  fs.mkdirSync(MEDIA_BACKUP_DIRECTORY, { recursive: true });
  for (const fileName of storedImageNames(data)) {
    const source = path.join(MEDIA_DIRECTORY, fileName);
    const copy = path.join(MEDIA_BACKUP_DIRECTORY, fileName);
    if (!fs.existsSync(copy) && fs.existsSync(source)) fs.copyFileSync(source, copy);
  }
  const temporary = target + '.tmp';
  fs.copyFileSync(DATA_FILE, temporary);
  fs.renameSync(temporary, target);

  const snapshots = jsonFilesIn(DAILY_BACKUP_DIRECTORY).sort().reverse();
  for (const old of snapshots.slice(DAILY_BACKUPS_KEPT)) fs.unlinkSync(old);
  const needed = storedImageNames(data);
  for (const snapshot of snapshots.slice(0, DAILY_BACKUPS_KEPT)) {
    try {
      for (const fileName of storedImageNames(JSON.parse(fs.readFileSync(snapshot, 'utf8')))) needed.add(fileName);
    } catch {
      // A damaged snapshot must not cause photos to be deleted: keep everything.
      return target;
    }
  }
  for (const fileName of fs.readdirSync(MEDIA_BACKUP_DIRECTORY)) {
    if (!needed.has(fileName)) fs.unlinkSync(path.join(MEDIA_BACKUP_DIRECTORY, fileName));
  }
  return target;
}

function runDailyBackupSafely() {
  try {
    const created = runDailyBackup();
    if (created) console.log('Создана ежедневная резервная копия:', created);
  } catch (error) {
    recordError('Ежедневная резервная копия', error);
    console.error('Не удалось создать ежедневную резервную копию:', error.message);
  }
}

try {
  const restoredMedia = restoreMissingMedia(data);
  if (restoredMedia) console.log('Восстановлено фотографий из резервной копии:', restoredMedia);
} catch (error) {
  console.error('Не удалось восстановить фотографии из резервной копии:', error.message);
}

function configured() {
  return Boolean(data.config.botToken && data.config.passwordHash && data.config.passwordSalt);
}

function verifyPassword(password) {
  try {
    const candidate = Buffer.from(crypto.scryptSync(password, data.config.passwordSalt, 64));
    const expected = Buffer.from(data.config.passwordHash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

const runtime = {
  generation: 0,
  abortController: null,
  status: 'stopped',
  lastError: '',
  lastErrorAt: null,
  lastSuccessfulContactAt: null,
  consecutiveFailures: 0,
  nextRetryAt: null,
  offset: Number(data.telegramOffset || 0),
  pollingStartedAt: null,
  broadcastRunning: false,
  tunnel: { status: 'off', url: '', host: '', error: '' },
  // Status messages to the admin (see status.mjs).
  pendingStartNotice: '',
  outageSince: null,
};

data.interfaceText = applyInterfaceText(data.interfaceText);

// The whole data object is replaced by a restored backup and by the tests.
function getData() {
  return data;
}

function replaceData(next) {
  data = next;
  applyConfiguredTimeZone();
}

export {
  BACKUP_DIRECTORY,
  applyConfiguredTimeZone,
  DAILY_BACKUPS_KEPT,
  DAILY_BACKUP_DIRECTORY,
  DATA_BACKUP_FILE,
  DATA_BACKUP_INTERVAL_MS,
  MEDIA_BACKUP_DIRECTORY,
  configured,
  data,
  fileStamp,
  getData,
  jsonFilesIn,
  lastDataBackupAt,
  lastReferencedImages,
  loadData,
  readDataFile,
  recoveryCandidates,
  replaceData,
  restoreMissingMedia,
  rotateDataBackup,
  runDailyBackup,
  runDailyBackupSafely,
  runtime,
  saveDataNow,
  saveTimer,
  scheduleSave,
  storedImageNames,
  verifyPassword,
};
