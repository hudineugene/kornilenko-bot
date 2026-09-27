// Данные бота в памяти и на диске: загрузка, сохранение, резервные копии, runtime.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_FILE, MEDIA_DIRECTORY } from './config.mjs';
import { clone, localDayKey } from './util.mjs';
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
//
// Слишком старый снимок сам не подставляется: поднять бота на данных
// месячной давности — это тихо потерять всё, что было после, вместе с
// заявками клиентов. Такие копии показываем владельцу, но ставим только по
// его решению.
const RECOVERY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function recoveryCandidates(now = Date.now()) {
  const snapshots = jsonFilesIn(BACKUP_DIRECTORY).concat(jsonFilesIn(DAILY_BACKUP_DIRECTORY))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return [DATA_BACKUP_FILE, ...snapshots]
    .filter((candidate) => fs.existsSync(candidate))
    .filter((candidate) => now - fs.statSync(candidate).mtimeMs <= RECOVERY_MAX_AGE_MS);
}

// Файл занят антивирусом или программой копий: это не повреждение, читаем
// ещё раз. Коды перечислены здесь, потому что загрузка данных происходит
// раньше, чем объявлены общие константы записи.
const LOCKED_FILE_CODES = ['EPERM', 'EACCES', 'EBUSY', 'EAGAIN', 'UNKNOWN'];
const DATA_READ_ATTEMPTS = 4;

function readDataFileText() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return { text: fs.readFileSync(DATA_FILE, 'utf8') };
    } catch (error) {
      if (attempt < DATA_READ_ATTEMPTS && LOCKED_FILE_CODES.includes(String(error.code || ''))) {
        pauseSync(200 * attempt);
        continue;
      }
      return { error };
    }
  }
}

function refuseToStart(lines) {
  console.error('');
  for (const line of lines) console.error(line);
  console.error('');
  process.exit(1);
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

// Первая копия, которую удалось прочитать: .bak, потом снимки в backups/.
function recoverFromCopy() {
  for (const candidate of recoveryCandidates()) {
    try {
      return { data: readDataFile(candidate), name: path.basename(candidate) };
    } catch {
      continue;
    }
  }
  return null;
}

// Запись в журнале ошибок: владелец увидит её в панели и поймёт, почему
// последние изменения могли не сохраниться.
function noteRecovery(recovered, message) {
  recovered.errors.unshift({
    id: crypto.randomUUID(),
    area: 'Загрузка данных',
    message,
    createdAt: new Date().toISOString(),
  });
}

// Версия, которая была в файле до приведения к текущему формату: самопроверке
// нужно показывать её, а не ту, которую бот только что записал сам.
let loadedVersion = 0;

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    // Файла нет: либо это первый запуск, либо файл унесли (перенесли папку,
    // удалил антивирус, не подключился сетевой диск). Начинать «с чистого
    // листа» нельзя — первое же сохранение записало бы пустые данные, а через
    // час пустой файл затёр бы .bak, и всё было бы потеряно окончательно.
    const recovered = recoverFromCopy();
    if (!recovered) return clone(defaultData);
    console.error('Файл данных не найден. Данные восстановлены из копии:', recovered.name);
    noteRecovery(recovered.data, 'Файл данных не найден рядом с ботом. Данные восстановлены из копии ' + recovered.name + ' — последние изменения могли потеряться. Проверьте, не перемещали ли папку бота.');
    return recovered.data;
  }
  // Прочитать файл не дали: занят антивирусом, программой копий или правами.
  // Это не повреждение — файл цел, и подменять его копией нельзя: следующая
  // запись затёрла бы настоящие данные старым состоянием.
  const read = readDataFileText();
  if (read.error) {
    refuseToStart([
      'Не удалось прочитать файл данных: ' + read.error.message,
      'Файл на месте и не тронут. Обычно так бывает, когда его держит антивирус',
      'или программа резервного копирования. Подождите минуту и запустите бота снова.',
    ]);
  }
  let raw = null;
  try {
    raw = JSON.parse(read.text);
  } catch (error) {
    // Настоящее повреждение: файл есть, но это не данные. Только здесь имеет
    // смысл подниматься из копии.
    console.error('Файл данных повреждён:', error.message);
    const recovered = recoverFromCopy();
    if (recovered) {
      const corruptCopy = DATA_FILE + '.corrupt-' + fileStamp();
      fs.copyFileSync(DATA_FILE, corruptCopy);
      console.error('Данные восстановлены из копии:', recovered.name);
      console.error('Повреждённый файл сохранён как:', corruptCopy);
      noteRecovery(recovered.data, 'Файл данных был повреждён. Данные восстановлены из копии ' + recovered.name + ', последние изменения могли потеряться. Повреждённый файл: ' + path.basename(corruptCopy));
      return recovered.data;
    }
    refuseToStart([
      'Файл данных повреждён, а свежей копии рядом нет.',
      'Копии не старше двух недель бот ставит сам; всё, что старше, — только по вашему решению.',
      'Посмотрите папку backups и поставьте подходящий файл как bot-data.json,',
      'либо восстановите копию через панель после запуска.',
      'Повреждённый файл: ' + DATA_FILE,
    ]);
  }
  // Данные новее самой программы: так бывает, если рядом положили старый
  // bot.exe. Раньше он молча приводил файл к своему формату — всё, чего он
  // не знает, терялось без следа. Лучше не запускаться.
  const storedVersion = Number(raw && raw.version) || 0;
  if (storedVersion > DATA_VERSION) {
    refuseToStart([
      'Файл данных создан более новой версией бота: в файле ' + storedVersion
        + ', эта программа понимает ' + DATA_VERSION + '.',
      'Запуск остановлен, чтобы не потерять данные. Поставьте свежую версию bot.exe',
      'или восстановите копию, сделанную этой версией программы.',
    ]);
  }
  try {
    const snapshot = backupBeforeUpgrade(raw);
    if (snapshot) console.log('Формат данных обновляется до версии ' + DATA_VERSION + '. Копия прежних данных:', snapshot);
    loadedVersion = storedVersion;
    return normalizeLoadedData(raw);
  } catch (error) {
    // Файл читается, разбирается — значит дело в самой программе. Подставлять
    // копию нельзя: данные целы, а вот версия бота, похоже, нет.
    refuseToStart([
      'Не удалось разобрать данные этой версией бота: ' + error.message,
      'Файл данных не тронут. Поставьте прежнюю версию bot.exe из папки backups',
      'или свежую, если она уже есть.',
    ]);
  }
  return clone(defaultData);
}

let data = loadData();

function loadedDataVersion() {
  return loadedVersion;
}

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

// Живое состояние бота: связь, рассылка, последний сбой записи. Объявлено до
// функций сохранения — они пишут сюда, а первое сохранение бывает уже при
// загрузке данных.
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
  // Последний сбой записи данных: видно в панели и в самопроверке.
  lastSaveError: '',
  lastSaveErrorAt: null,
  nextSaveRetryAt: null,
  // Status messages to the admin (see status.mjs).
  pendingStartNotice: '',
  outageSince: null,
};
let saveRetryPause = 0;

// Keeps a known-good copy of the data file that loadData can fall back to.
// Неудачная копия не должна мешать самой записи: лучше сохранить данные без
// свежего .bak, чем не сохранить вовсе.
// Пустые данные — это бот, который ещё не настроен и ничего не завёл.
function looksEmpty(root) {
  if (!root) return true;
  const hasToken = Boolean(root.config && root.config.botToken);
  const hasObjects = Array.isArray(root.objects) && root.objects.length > 0;
  const hasUsers = root.users && typeof root.users === 'object' && Object.keys(root.users).length > 0;
  return !hasToken && !hasObjects && !hasUsers;
}

// Вторая защита к восстановлению при загрузке: даже если бот всё-таки запустился
// пустым, запасную копию с настоящими данными он не затрёт.
function backupWorthKeeping() {
  if (!looksEmpty(data) || !fs.existsSync(DATA_BACKUP_FILE)) return false;
  try {
    return !looksEmpty(JSON.parse(fs.readFileSync(DATA_BACKUP_FILE, 'utf8')));
  } catch {
    // Копию прочитать не удалось — тем более не трогаем.
    return true;
  }
}

function rotateDataBackup() {
  if (Date.now() - lastDataBackupAt < DATA_BACKUP_INTERVAL_MS || !fs.existsSync(DATA_FILE)) return;
  if (backupWorthKeeping()) {
    console.error('Запасная копия bot-data.json.bak не тронута: сейчас данные пустые, а в копии они есть.');
    lastDataBackupAt = Date.now();
    return;
  }
  try {
    JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    fs.copyFileSync(DATA_FILE, DATA_BACKUP_FILE);
    lastDataBackupAt = Date.now();
  } catch (error) {
    // Файл занят антивирусом или повреждён: пропускаем копию до следующего раза.
    lastDataBackupAt = Date.now() - DATA_BACKUP_INTERVAL_MS + 60 * 1000;
  }
}

// Антивирус, программа резервного копирования или индексатор Windows держат
// файл занятым доли секунды. Такую запись достаточно повторить.
const SAVE_ATTEMPTS = 4;
const SAVE_RETRY_PAUSE_MS = 120;
const RETRYABLE_WRITE_CODES = ['EPERM', 'EACCES', 'EBUSY', 'EAGAIN', 'EMFILE', 'ENFILE', 'UNKNOWN'];

function retryableWriteError(error) {
  return Boolean(error && RETRYABLE_WRITE_CODES.includes(String(error.code || '')));
}

function pauseSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* короткая пауза без таймеров */ }
  }
}

// О сбое записи сообщает тот, кто умеет писать в журнал и в Telegram
// (регистрируется в main.mjs) — store остаётся нижним слоем без зависимостей.
let saveFailureReporter = null;
let reportingSaveFailure = false;

function onSaveFailure(reporter) {
  saveFailureReporter = typeof reporter === 'function' ? reporter : null;
}

function reportSaveFailure(error, attempts) {
  runtime.lastSaveError = cleanTextSafe(error && error.message);
  runtime.lastSaveErrorAt = new Date().toISOString();
  console.error('Не удалось сохранить данные (попыток: ' + attempts + '):', error && error.message);
  // Повтор назначается всегда, кто бы ни сохранял: панель, рассылка или сам
  // бот. Раньше во время рассылки повтор не назначался вовсе, и изменения
  // оставались только в памяти до перезапуска.
  retrySaveLater();
  if (!saveFailureReporter || reportingSaveFailure) return;
  reportingSaveFailure = true;
  try {
    saveFailureReporter(error, attempts);
  } catch {
    // Сообщить не удалось — данные всё равно остаются в памяти.
  } finally {
    reportingSaveFailure = false;
  }
}

function cleanTextSafe(value) {
  return String(value == null ? '' : value).slice(0, 300);
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
  // Без отступов: на пяти клиентах это 20 % веса файла, на пяти тысячах —
  // десятки мегабайт и заметная пауза на каждом сохранении. Файл читается
  // программами, а не глазами.
  const content = JSON.stringify(data);
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, DATA_FILE);
      if (attempt > 1) console.log('Данные сохранены с ' + attempt + '-й попытки.');
      runtime.lastSaveError = '';
      // Запись удалась — повтор больше не нужен.
      runtime.nextSaveRetryAt = null;
      saveRetryPause = 0;
      break;
    } catch (error) {
      if (attempt < SAVE_ATTEMPTS && retryableWriteError(error)) {
        pauseSync(SAVE_RETRY_PAUSE_MS * attempt);
        continue;
      }
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Черновик останется рядом — он не мешает работе.
      }
      reportSaveFailure(error, attempt);
      throw error;
    }
  }
  // Scanning the media folder is only needed when the set of referenced files changed.
  const referenced = referencedImageFiles(data);
  const signature = Array.from(referenced).sort().join('|');
  if (signature !== lastReferencedImages) {
    cleanupOrphanImages(data, referenced);
    lastReferencedImages = signature;
  }
}

// Повтор записи после сбоя: с растущей паузой, пока файл не освободится.
// Работает и во время рассылки — там обычное «сохранить попозже» отключено,
// чтобы не переписывать файл на каждого получателя.
function retrySaveLater() {
  // Если запись уже была назначена, переносим её: только что стало известно,
  // что диск занят, и повторять через 150 мс бессмысленно.
  if (saveTimer) clearTimeout(saveTimer);
  saveRetryPause = Math.min(saveRetryPause ? saveRetryPause * 3 : 2000, 60000);
  runtime.nextSaveRetryAt = new Date(Date.now() + saveRetryPause).toISOString();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveDataNow();
    } catch {
      // Сообщение о сбое уже записано, повтор назначен заново.
    }
  }, saveRetryPause);
  if (saveTimer.unref) saveTimer.unref();
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
      saveRetryPause = 0;
    } catch {
      // Сообщение о сбое уже отправлено; здесь — повтор с растущей паузой,
      // чтобы данные попали на диск, когда файл освободится.
      saveRetryPause = Math.min(saveRetryPause ? saveRetryPause * 3 : 2000, 60000);
      runtime.nextSaveRetryAt = new Date(Date.now() + saveRetryPause).toISOString();
      saveTimer = setTimeout(() => { saveTimer = null; scheduleSave(); }, saveRetryPause);
      if (saveTimer.unref) saveTimer.unref();
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

// Перед восстановлением копии складываем прежние данные рядом: если файл
// оказался не тем, вернуться будет куда. Держим последние снимки, старые убираем.
const RESTORE_SNAPSHOTS_KEPT = 10;

function snapshotBeforeRestore(now = new Date()) {
  if (!fs.existsSync(DATA_FILE)) return '';
  fs.mkdirSync(BACKUP_DIRECTORY, { recursive: true });
  const target = path.join(BACKUP_DIRECTORY, 'pre-restore-' + fileStamp(now) + '.json');
  fs.copyFileSync(DATA_FILE, target);
  const snapshots = jsonFilesIn(BACKUP_DIRECTORY)
    .filter((file) => path.basename(file).startsWith('pre-restore-'))
    .sort((first, second) => fs.statSync(second).mtimeMs - fs.statSync(first).mtimeMs);
  for (const old of snapshots.slice(RESTORE_SNAPSHOTS_KEPT)) {
    try {
      fs.rmSync(old, { force: true });
    } catch {
      // Лишний снимок не мешает работе.
    }
  }
  return target;
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
  const target = path.join(DAILY_BACKUP_DIRECTORY, 'bot-data-' + localDayKey(now) + '.json');
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

// Проверка пароля считается специально медленно (scrypt). В синхронном виде она
// останавливает бота на это время: поток попыток из интернета означал бы, что
// клиенты не получают ответов. Асинхронный вариант считает в рабочем потоке,
// а бот продолжает отвечать.
function verifyPasswordAsync(password) {
  return new Promise((resolve) => {
    const salt = data.config.passwordSalt;
    const hash = data.config.passwordHash;
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(String(password == null ? '' : password), salt, 64, (error, derived) => {
      if (error) return resolve(false);
      try {
        const expected = Buffer.from(hash, 'hex');
        resolve(derived.length === expected.length && crypto.timingSafeEqual(derived, expected));
      } catch {
        resolve(false);
      }
    });
  });
}


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
  loadedDataVersion,
  looksEmpty,
  snapshotBeforeRestore,
  verifyPasswordAsync,
  onSaveFailure,
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
