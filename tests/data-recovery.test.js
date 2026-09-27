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

// Отдельный запуск бота на подготовленной папке: так видно, запустился он
// или отказался, и что осталось в файле данных.
function startBotIn(box) {
  const script = 'const bot = require(' + JSON.stringify(require('node:path').resolve(__dirname, '..', 'bot.js')) + ');'
    + 'console.log("ЗАПУСТИЛСЯ:" + bot.getData().config.adminChatId);';
  try {
    const output = require('node:child_process').execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        BOT_NO_START: '1',
        NO_AUTO_OPEN: '1',
        BOT_DATA_FILE: require('node:path').join(box, 'bot-data.json'),
        BOT_MEDIA_DIRECTORY: require('node:path').join(box, 'bot-media'),
        BOT_LOG_FILE: require('node:path').join(box, 'logs', 'bot.log'),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { started: true, output };
  } catch (error) {
    return { started: false, output: String(error.stdout || '') + String(error.stderr || '') };
  }
}

function prepare(files) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-recovery-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(box, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  }
  return box;
}

test('повреждённый файл поднимается из свежей копии', () => {
  const box = prepare({
    'bot-data.json': '{"config": ',
    'bot-data.json.bak': realData('777010'),
  });
  const result = startBotIn(box);
  assert.equal(result.started, true, result.output);
  assert.match(result.output, /ЗАПУСТИЛСЯ:777010/, 'данные взяты из копии');
  assert.ok(fs.readdirSync(box).some((name) => name.includes('.corrupt-')), 'повреждённый файл сохранён рядом');
  fs.rmSync(box, { recursive: true, force: true });
});

test('занятый файл не подменяется копией — бот просто не запускается', () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-recovery-'));
  // Папка вместо файла: прочитать нельзя, но и повреждением это не является.
  fs.mkdirSync(path.join(box, 'bot-data.json'));
  fs.writeFileSync(path.join(box, 'bot-data.json.bak'), JSON.stringify(realData('777011')), 'utf8');
  const result = startBotIn(box);
  assert.equal(result.started, false, 'запуск остановлен');
  assert.match(result.output, /Не удалось прочитать файл данных/);
  assert.match(result.output, /не тронут/i, 'сказано, что файл цел');
  assert.ok(fs.existsSync(path.join(box, 'bot-data.json')), 'файл на месте');
  fs.rmSync(box, { recursive: true, force: true });
});

test('старую копию бот сам не подставляет', () => {
  const box = prepare({ 'bot-data.json': '{сломано' });
  const old = path.join(box, 'backups', 'daily', 'bot-data-2025-01-01.json');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, JSON.stringify(realData('777012')), 'utf8');
  const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, longAgo, longAgo);

  const result = startBotIn(box);
  assert.equal(result.started, false, 'бот не поднялся на данных трёхмесячной давности');
  assert.match(result.output, /повреждён/i);
  assert.match(result.output, /backups/, 'подсказано, где искать копию');
  fs.rmSync(box, { recursive: true, force: true });
});
