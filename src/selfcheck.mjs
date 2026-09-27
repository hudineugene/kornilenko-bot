// Самопроверка: короткий список «всё ли на месте», одинаковый для консоли при
// запуске, для панели и для сообщения администратору. Ничего не меняет.

import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIRECTORY } from './config.mjs';
import { DATA_VERSION } from './data-format.mjs';
import { cleanText } from './util.mjs';
import { data, runtime } from './store.mjs';
import { propertyReadyForLanguage } from './catalog.mjs';
import { forEachStoredImage, imageExists, referencedImageFiles } from './media.mjs';
import { policyIsDraft } from './privacy.mjs';

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
  const active = data.objects.filter((record) => record.status === 'active');
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
  return 'связь: ' + runtime.status + (failures ? ', неудачных попыток подряд: ' + failures : '')
    + (runtime.lastError ? ' (' + cleanText(runtime.lastError, 160) + ')' : '');
}

// Каждая проверка: ok — всё хорошо, warn — стоит посмотреть, bad — клиенты
// или администратор это почувствуют.
function runSelfCheck(now = new Date()) {
  const checks = [];
  const add = (id, title, status, detail, hint = '') => checks.push({ id, title, status, detail, hint });

  const token = cleanText(data.config.botToken, 100);
  if (!token) add('token', 'Токен бота', 'bad', 'не задан', 'Настройки → Подключение');
  else if (!TOKEN_SHAPE.test(token)) add('token', 'Токен бота', 'bad', 'формат не похож на токен BotFather', 'Настройки → Подключение');
  else if (!data.config.active) add('token', 'Токен бота', 'warn', 'задан, но бот выключен в настройках', 'Настройки → Подключение');
  else if (runtime.status === ONLINE) add('token', 'Токен бота', 'ok', 'принят Telegram, связь есть');
  // Несколько неудачных попыток подряд — бот не работает, а не «подключается».
  else if (runtime.status === 'error' || Number(runtime.consecutiveFailures) >= 3) add('token', 'Токен бота', 'bad', connectionDetail(), 'Настройки → Подключение');
  else add('token', 'Токен бота', 'warn', connectionDetail(), 'Настройки → Подключение');

  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId) add('admin', 'Чат администратора', 'bad', 'не задан — уведомления о заявках никуда не уходят', 'Настройки → Подключение');
  else if (!data.config.adminNotificationVerifiedAt) add('admin', 'Чат администратора', 'warn', 'задан, но проверочное сообщение ещё не приходило', 'Настройки → Подключение → «Проверить»');
  else add('admin', 'Чат администратора', 'ok', 'проверен ' + new Date(data.config.adminNotificationVerifiedAt).toLocaleDateString('ru-RU'));

  const catalog = catalogReport();
  if (!catalog.active) add('catalog', 'Каталог', 'warn', 'активных объектов нет', 'Каталог → Объекты');
  else if (!catalog.visible) add('catalog', 'Каталог', 'bad', (catalog.active === 1 ? 'единственный объект не проходит правила публикации' : 'ни один из ' + catalog.active + ' объектов не проходит правила публикации') + ' — у клиентов каталог пустой', 'Каталог → Объекты');
  else if (catalog.visible < catalog.active) add('catalog', 'Каталог', 'warn', 'клиенты видят ' + catalog.visible + ' из ' + catalog.active + ' объектов', 'Каталог → Объекты');
  else add('catalog', 'Каталог', 'ok', 'клиенты видят все ' + objects(catalog.active) + (catalog.visibleRu < catalog.active ? ', но не на всех языках' : ''));

  // Политика конфиденциальности с подстановками в квадратных скобках — это
  // черновик: клиенту его показывать нельзя.
  if (policyIsDraft()) add('privacy', 'Политика конфиденциальности', 'warn', 'в тексте остались подстановки в [квадратных скобках] — подставьте данные компании и срок хранения', 'Тексты бота → Интерфейс → privacy');
  else add('privacy', 'Политика конфиденциальности', 'ok', 'заполнена');

  const media = mediaReport();
  if (media.missing.length) {
    add('media', 'Файлы картинок', 'bad', 'нет файлов: ' + media.missing.length + ' из ' + media.total
      + ' (' + media.missing.slice(0, 3).join(', ') + (media.missing.length > 3 ? ', …' : '') + ')', 'Настройки → Данные → «Проверить файлы»');
  } else if (media.orphans) {
    add('media', 'Файлы картинок', 'warn', 'все ' + media.total + ' на месте, лишних файлов в папке: ' + media.orphans, 'Настройки → Данные');
  } else {
    add('media', 'Файлы картинок', 'ok', 'все на месте: ' + media.total);
  }

  if (Number(data.version) !== DATA_VERSION) {
    add('version', 'Версия данных', 'bad', 'в файле ' + data.version + ', программа ждёт ' + DATA_VERSION, 'Обновите программу или восстановите копию');
  } else {
    const backup = latestDailyBackup();
    const ageDays = backup ? Math.floor((now - backup.at) / 86400000) : Infinity;
    if (!backup) add('version', 'Версия данных и копия', 'warn', 'версия ' + DATA_VERSION + ', ежедневной копии ещё нет', 'Настройки → Данные');
    else if (ageDays > BACKUP_FRESH_DAYS) add('version', 'Версия данных и копия', 'warn', 'версия ' + DATA_VERSION + ', последняя копия ' + backup.name + ' (' + ageDays + ' дн. назад)', 'Настройки → Данные');
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
  mediaReport,
  runSelfCheck,
  selfCheckLines,
  selfCheckNotice,
};
