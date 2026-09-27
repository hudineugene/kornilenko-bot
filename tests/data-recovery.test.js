'use strict';

// Файл bot-data.json может пропасть: папку перенесли, файл удалил антивирус,
// не подключился сетевой диск. Раньше бот в таком случае запускался пустым —
// как будто его только что поставили, — а через час пустой файл затирал
// запасную копию .bak, и данные пропадали окончательно.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { bot, dataFile, cleanup } = require('./helpers/chat');

const workDirectory = path.dirname(dataFile);
const backupFile = dataFile + '.bak';
const backupDirectory = path.join(workDirectory, 'backups');
const dailyDirectory = path.join(backupDirectory, 'daily');

test.after(cleanup);

function realData(chatId) {
  const data = bot.normalizeLoadedData({ version: 14, config: { adminChatId: chatId } });
  data.config.botToken = '12345:ABCDEFGHIJKLMNOPQRSTUV';
  return data;
}

function clearFiles() {
  fs.rmSync(dataFile, { force: true });
  fs.rmSync(backupFile, { force: true });
  fs.rmSync(backupDirectory, { recursive: true, force: true });
}

// Загрузка молчит в журнал теста: сообщения о восстановлении проверяем по данным.
function quietly(run) {
  const originalError = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = originalError;
  }
}

test('файл данных пропал — бот поднимается из .bak, а не пустым', () => {
  clearFiles();
  fs.writeFileSync(backupFile, JSON.stringify(realData('777001')));
  const recovered = quietly(() => bot.loadData());
  assert.equal(recovered.config.adminChatId, '777001', 'данные взяты из запасной копии');
  assert.equal(recovered.errors[0].area, 'Загрузка данных');
  assert.match(recovered.errors[0].message, /не найден/i, 'владелец увидит причину в журнале ошибок панели');
});

test('нет и .bak — берётся самый свежий снимок из backups', () => {
  clearFiles();
  fs.mkdirSync(dailyDirectory, { recursive: true });
  fs.writeFileSync(path.join(dailyDirectory, 'bot-data-2026-09-20.json'), JSON.stringify(realData('777002')));
  const recovered = quietly(() => bot.loadData());
  assert.equal(recovered.config.adminChatId, '777002');
  assert.match(recovered.errors[0].message, /bot-data-2026-09-20\.json/, 'в журнале видно, из какой копии подняли');
});

test('первый запуск: копий нет — начинаем с пустых данных', () => {
  clearFiles();
  const fresh = quietly(() => bot.loadData());
  assert.equal(fresh.config.adminChatId, '');
  assert.deepEqual(fresh.errors, [], 'это не ошибка, а обычный первый запуск');
});

test('пустые данные не затирают запасную копию', () => {
  // Отдельная папка и отдельный запуск: счётчик часовой копии живёт в памяти
  // бота, и проверять его нужно на честном старте.
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-empty-save-'));
  const file = path.join(box, 'bot-data.json');
  fs.writeFileSync(file + '.bak', JSON.stringify(realData('777003')));
  fs.writeFileSync(file, JSON.stringify(bot.normalizeLoadedData({ version: 14 })));
  const script = 'const bot = require(' + JSON.stringify(path.resolve(__dirname, '..', 'bot.js')) + ');'
    + 'bot.saveDataNow();'
    + 'console.log(JSON.stringify({ empty: bot.looksEmpty(bot.getData()) }));';
  const output = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, BOT_NO_START: '1', NO_AUTO_OPEN: '1', BOT_DATA_FILE: file, BOT_MEDIA_DIRECTORY: path.join(box, 'bot-media') },
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(output.trim().split('\n').pop()).empty, true, 'бот и правда стартовал с пустыми данными');
  const kept = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
  assert.equal(kept.config.adminChatId, '777003', 'запасная копия осталась прежней');
  fs.rmSync(box, { recursive: true, force: true });
});

test('признак пустых данных не путает пустые с настроенными', () => {
  assert.equal(bot.looksEmpty(bot.normalizeLoadedData({ version: 14 })), true);
  assert.equal(bot.looksEmpty(realData('777004')), false, 'настроенный токен — уже не пустые данные');
  const withObject = bot.normalizeLoadedData({ version: 14 });
  withObject.objects.push({ id: 'one', status: 'hidden', title: { ru: 'Объект', en: '', es: '' } });
  assert.equal(bot.looksEmpty(withObject), false, 'есть объекты — не пустые');
  const withUser = bot.normalizeLoadedData({ version: 14 });
  withUser.users['5'] = { id: '5' };
  assert.equal(bot.looksEmpty(withUser), false, 'есть клиенты — не пустые');
});
