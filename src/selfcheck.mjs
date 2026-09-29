// Самопроверка: короткий список «всё ли на месте», одинаковый для консоли при
// запуске, для панели и для сообщения администратору. Ничего не меняет.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_FILE, MEDIA_DIRECTORY } from './config.mjs';
import { DATA_VERSION } from './data-format.mjs';
import { cleanText, localDayKey } from './util.mjs';
import { data, loadedDataVersion, runtime, scheduleSave } from './store.mjs';
import { propertyReadyForLanguage } from './catalog.mjs';
import { forEachStoredImage, imageExists, referencedImageFiles } from './media.mjs';
import { policyIsDraft } from './privacy.mjs';
import { PLACES } from './places.mjs';

const LANGUAGES = ['ru', 'en', 'es'];
// Тот же вид токена, что принимает панель (admin-http не импортируем, чтобы
// не заводить круговую зависимость).
const TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
// Копия данных старше этого срока — повод напомнить о ней.
const BACKUP_FRESH_DAYS = 2;

// «1 объект», «2 объекта», «5 объектов».
function objects(count) {
  const tail = count % 100 >= 11 && count % 100 <= 14 ? 5 : count % 10;
  return count + ' ' + (tail === 1 ? 'объект' : [2, 3, 4].includes(tail) ? 'объекта' : 'объектов');
}

function backupDirectory() {
  return path.join(path.dirname(MEDIA_DIRECTORY), 'backups', 'daily');
}

function latestDailyBackup() {
  try {
    const names = fs.readdirSync(backupDirectory()).filter((name) => name.endsWith('.json')).sort();
    if (!names.length) return null;
    const name = names[names.length - 1];
    return { name, at: fs.statSync(path.join(backupDirectory(), name)).mtime };
  } catch {
    return null;
  }
}

// Ссылки на картинки без файла на диске и файлы, на которые никто не ссылается.
function mediaReport() {
  // Один и тот же файл может стоять в нескольких карточках и языках, поэтому
  // список — по файлам, а не по ссылкам.
  const byFile = new Map();
  let total = 0;
  let missingRefs = 0;
  forEachStoredImage(data, (image) => {
    if (!image || typeof image !== 'object') return;
    total += 1;
    if (imageExists(image)) return;
    missingRefs += 1;
    const name = cleanText(image.storageFile || image.name || image.id, 120) || 'без имени';
    byFile.set(name, (byFile.get(name) || 0) + 1);
  });
  const missing = Array.from(byFile, ([name, count]) => (count > 1 ? name + ' (ссылок: ' + count + ')' : name));
  let orphans = 0;
  try {
    const referenced = referencedImageFiles(data);
    for (const entry of fs.readdirSync(MEDIA_DIRECTORY, { withFileTypes: true })) {
      // Считаем так же, как уборка ничейных файлов: только картинки бота.
      if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.(?:jpg|png)$/i.test(entry.name)) continue;
      if (!referenced.has(entry.name.toLocaleLowerCase('en-US'))) orphans += 1;
    }
  } catch {
    // Папки с медиа может ещё не быть — это не ошибка.
  }
  return { total, missing, missingRefs, orphans };
}

function catalogReport() {
  // В каталог у клиента входят объекты в продаже и забронированные (проданные и скрытые — нет).
  const active = data.objects.filter((record) => ['active', 'reserved'].includes(record.status));
  const visible = active.filter((record) => LANGUAGES.some((language) => propertyReadyForLanguage(record, language)));
  const visibleRu = active.filter((record) => propertyReadyForLanguage(record, 'ru'));
  return { active: active.length, visible: visible.length, visibleRu: visibleRu.length };
}

// Здоровое состояние опроса Telegram называется online (см. telegram.mjs).
const ONLINE = 'online';

function connectionDetail() {
  if (runtime.status === ONLINE) return 'связь с Telegram есть';
  if (runtime.status === 'stopped') return data.config.active ? 'подключение ещё не начиналось' : 'бот выключен в настройках';
  const failures = Number(runtime.consecutiveFailures) || 0;
  // Слова, а не имена состояний из кода: владелец не знает, что такое reconnecting.
  const words = { reconnecting: 'переподключается', error: 'ошибка', connecting: 'подключается' };
  return 'связь: ' + (words[runtime.status] || runtime.status) + (failures ? ', неудачных попыток подряд: ' + failures : '')
    + (runtime.lastError ? ' (' + cleanText(runtime.lastError, 160) + ')' : '');
}

// Каждая проверка: ok — всё хорошо, warn — стоит посмотреть, bad — клиенты
// или администратор это почувствуют.
// --- Свободное место ---------------------------------------------------------
// 27.09 диск заполнился до нуля, и бот узнал бы об этом только в момент записи
// данных. Запас места проверяется заранее: в самопроверке он виден всегда, а
// когда места мало — администратор получает сообщение раз в сутки.
const DISK_LOW_BYTES = 1024 * 1024 * 1024;
const DISK_CRITICAL_BYTES = 300 * 1024 * 1024;

function fileSizeText(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return (value / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',') + ' ГБ';
  if (value >= 1024 * 1024) return Math.round(value / (1024 * 1024)) + ' МБ';
  return Math.max(1, Math.round(value / 1024)) + ' КБ';
}

// Размер папки бота: данные, фотографии, копии и сама программа. Считаем с
// ограничением, чтобы проверка оставалась быстрой на любой папке.
function folderSize(directory, budget = { files: 20000 }) {
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (budget.files <= 0) break;
    budget.files -= 1;
    const full = path.join(directory, entry.name);
    try {
      if (entry.isDirectory()) total += folderSize(full, budget);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch {
      // Файл занят или исчез — на итог это почти не влияет.
    }
  }
  return total;
}

function diskReport() {
  const folder = path.dirname(DATA_FILE);
  try {
    const stat = fs.statfsSync(folder);
    return {
      free: Number(stat.bsize) * Number(stat.bavail),
      total: Number(stat.bsize) * Number(stat.blocks),
      used: folderSize(folder),
    };
  } catch {
    return null;
  }
}

// Сообщение администратору о нехватке места — не чаще раза в сутки.
function diskSpaceNotice(now = new Date()) {
  const disk = diskReport();
  if (!disk || disk.free >= DISK_LOW_BYTES) return '';
  const today = localDayKey(now);
  if (data.lastDiskWarningFor === today) return '';
  data.lastDiskWarningFor = today;
  scheduleSave();
  const critical = disk.free < DISK_CRITICAL_BYTES;
  return [
    critical ? '🛑 На диске почти не осталось места' : '⚠️ На диске мало места',
    '',
    'Свободно: ' + fileSizeText(disk.free) + '. Папка бота занимает ' + fileSizeText(disk.used) + '.',
    critical
      ? 'Когда место закончится, бот не сможет сохранить данные: заявки и переписка останутся только в памяти до перезапуска.'
      : 'Пока всё работает, но лучше освободить место заранее: ежедневные копии данных и фотографии занимают всё больше.',
  ].join('\n');
}

function runSelfCheck(now = new Date()) {
  const checks = [];
  const add = (id, title, status, detail, hint = '') => checks.push({ id, title, status, detail, hint });

  const token = cleanText(data.config.botToken, 100);
  if (!token) add('token', 'Токен бота', 'bad', 'не задан', PLACES.telegram);
  else if (!TOKEN_SHAPE.test(token)) add('token', 'Токен бота', 'bad', 'формат не похож на токен BotFather', PLACES.telegram);
  else if (!data.config.active) add('token', 'Токен бота', 'warn', 'задан, но бот выключен в настройках', PLACES.telegram);
  else if (runtime.status === ONLINE) add('token', 'Токен бота', 'ok', 'принят Telegram, связь есть');
  // Несколько неудачных попыток подряд — бот не работает, а не «подключается».
  else if (runtime.status === 'error' || Number(runtime.consecutiveFailures) >= 3) add('token', 'Токен бота', 'bad', connectionDetail(), PLACES.telegram);
  else add('token', 'Токен бота', 'warn', connectionDetail(), PLACES.telegram);

  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId) add('admin', 'Чат администратора', 'bad', 'не задан — уведомления о заявках никуда не уходят', PLACES.adminChat);
  else if (!data.config.adminNotificationVerifiedAt) add('admin', 'Чат администратора', 'warn', 'задан, но проверочное сообщение ещё не приходило', PLACES.adminChat);
  else add('admin', 'Чат администратора', 'ok', 'проверен ' + new Date(data.config.adminNotificationVerifiedAt).toLocaleDateString('ru-RU'));

  const catalog = catalogReport();
  if (!catalog.active) add('catalog', 'Каталог', 'warn', 'активных объектов нет', PLACES.catalog);
  else if (!catalog.visible) add('catalog', 'Каталог', 'bad', (catalog.active === 1 ? 'единственный объект не проходит правила публикации' : 'ни один из ' + catalog.active + ' объектов не проходит правила публикации') + ' — у клиентов каталог пустой', PLACES.catalog);
  else if (catalog.visible < catalog.active) add('catalog', 'Каталог', 'warn', 'клиенты видят ' + catalog.visible + ' из ' + catalog.active + ' объектов', PLACES.catalog);
  else add('catalog', 'Каталог', 'ok', 'клиенты видят все ' + objects(catalog.active) + (catalog.visibleRu < catalog.active ? ', но не на всех языках' : ''));

  // Политика конфиденциальности с подстановками в квадратных скобках — это
  // черновик: клиенту его показывать нельзя.
  const months = Number(data.config.retentionMonths) || 0;
  if (policyIsDraft()) add('privacy', 'Политика конфиденциальности', 'warn', 'в тексте остались подстановки в [квадратных скобках] — подставьте данные компании и срок хранения', PLACES.policyText);
  else if (!months) add('privacy', 'Политика конфиденциальности', 'warn', 'политика заполнена, но срок хранения данных не задан', PLACES.retention);
  else add('privacy', 'Политика конфиденциальности', 'ok', 'заполнена, срок хранения ' + months + ' мес.');

  // Данные не сохраняются: самая тяжёлая из возможных неприятностей — вся
  // работа держится в памяти до перезапуска.
  if (runtime.lastSaveError) {
    add('save', 'Сохранение данных', 'bad', 'последняя запись не удалась: ' + runtime.lastSaveError
      + (runtime.nextSaveRetryAt ? '; повтор запланирован' : ''), PLACES.dataCopies);
  }

  const media = mediaReport();
  if (media.missing.length) {
    add('media', 'Файлы картинок', 'bad', 'нет файлов: ' + media.missing.length + ' из ' + media.total
      + ' (' + media.missing.slice(0, 3).join(', ') + (media.missing.length > 3 ? ', …' : '') + ')', PLACES.checkFiles);
  } else if (media.orphans) {
    add('media', 'Файлы картинок', 'warn', 'все ' + media.total + ' на месте, лишних файлов в папке: ' + media.orphans, PLACES.dataCopies);
  } else {
    add('media', 'Файлы картинок', 'ok', 'все на месте: ' + media.total);
  }

  const disk = diskReport();
  if (!disk) add('disk', 'Свободное место', 'warn', 'не удалось узнать запас места на диске');
  else if (disk.free < DISK_CRITICAL_BYTES) {
    add('disk', 'Свободное место', 'bad', 'осталось ' + fileSizeText(disk.free) + ' — данные могут не сохраниться', 'Освободите место на диске');
  } else if (disk.free < DISK_LOW_BYTES) {
    add('disk', 'Свободное место', 'warn', 'осталось ' + fileSizeText(disk.free) + ', папка бота занимает ' + fileSizeText(disk.used), 'Освободите место на диске');
  } else {
    add('disk', 'Свободное место', 'ok', 'свободно ' + fileSizeText(disk.free) + ', папка бота занимает ' + fileSizeText(disk.used));
  }

  // Сравниваем с тем, что было в файле при загрузке: в памяти версия всегда
  // текущая, поэтому прежняя проверка не срабатывала никогда.
  const stored = loadedDataVersion();
  if (stored && stored > DATA_VERSION) {
    add('version', 'Версия данных', 'bad', 'файл создан более новой версией бота: в файле ' + stored + ', программа понимает ' + DATA_VERSION, 'Поставьте свежую версию bot.exe');
  } else if (stored && stored < DATA_VERSION) {
    add('version', 'Версия данных', 'ok', 'формат обновлён с версии ' + stored + ' до ' + DATA_VERSION + ', копия прежних данных в папке backups');
  } else {
    const backup = latestDailyBackup();
    const ageDays = backup ? Math.floor((now - backup.at) / 86400000) : Infinity;
    if (!backup) add('version', 'Версия данных и копия', 'warn', 'версия ' + DATA_VERSION + ', ежедневной копии ещё нет', PLACES.dataCopies);
    else if (ageDays > BACKUP_FRESH_DAYS) add('version', 'Версия данных и копия', 'warn', 'версия ' + DATA_VERSION + ', последняя копия ' + backup.name + ' (' + ageDays + ' дн. назад)', PLACES.dataCopies);
    else add('version', 'Версия данных и копия', 'ok', 'версия ' + DATA_VERSION + ', копия ' + backup.name);
  }

  return {
    checkedAt: now.toISOString(),
    checks,
    bad: checks.filter((check) => check.status === 'bad').length,
    warn: checks.filter((check) => check.status === 'warn').length,
  };
}

function selfCheckLines(report) {
  const mark = { ok: '  ok  ', warn: '  !   ', bad: ' !!!  ' };
  return report.checks.map((check) => mark[check.status] + check.title + ': ' + check.detail);
}

// Сообщение администратору: только то, что требует внимания.
function selfCheckNotice(report) {
  const problems = report.checks.filter((check) => check.status === 'bad');
  if (!problems.length) return '';
  return ['⚠️ Проверка при запуске нашла проблемы:', '', ...problems.map((check) => '• ' + check.title + ' — ' + check.detail + (check.hint ? ' (' + check.hint + ')' : ''))].join('\n');
}

export {
  DISK_CRITICAL_BYTES,
  connectionDetail,
  DISK_LOW_BYTES,
  diskReport,
  diskSpaceNotice,
  fileSizeText,
  mediaReport,
  runSelfCheck,
  selfCheckLines,
  selfCheckNotice,
};
