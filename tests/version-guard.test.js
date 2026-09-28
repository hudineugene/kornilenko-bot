'use strict';

// Откат на старую версию бота. Формат данных со временем меняется; старая
// программа не знает новых полей и молча приводила файл к своему виду —
// всё новое терялось без следа и без предупреждения. Проверка в коде была,
// но смотрела на версию уже в памяти, где она всегда текущая, и не
// срабатывала никогда.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { bot, resetData, cleanup } = require('./helpers/chat');

const project = path.resolve(__dirname, '..');
let DATA_VERSION = 0;

test.before(async () => {
  ({ DATA_VERSION } = await import('../src/data-format.mjs'));
});
test.after(cleanup);

// Отдельный запуск бота на подготовленном файле данных. Вторым аргументом —
// что положить рядом: копию .bak и снимки в backups/.
function startBotWith(data, nearby = {}) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-version-test-'));
  if (data !== null) fs.writeFileSync(path.join(box, 'bot-data.json'), typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
  if (nearby.bak) fs.writeFileSync(path.join(box, 'bot-data.json.bak'), JSON.stringify(nearby.bak), 'utf8');
  for (const [name, content] of Object.entries(nearby.snapshots || {})) {
    const file = path.join(box, 'backups', 'daily', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content), 'utf8');
  }
  const script = 'const bot = require(' + JSON.stringify(path.join(project, 'bot.js')) + ');'
    + 'const report = bot.runSelfCheck();'
    + 'const check = report.checks.find((item) => item.id === "version");'
    + 'console.log("ВЕРСИЯ:" + check.status + ":" + check.detail);';
  // Смотрим оба потока: сообщения о восстановлении бот пишет в поток ошибок.
  const run = spawnSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      BOT_NO_START: '1',
      NO_AUTO_OPEN: '1',
      BOT_DATA_FILE: path.join(box, 'bot-data.json'),
      BOT_MEDIA_DIRECTORY: path.join(box, 'bot-media'),
      BOT_LOG_FILE: path.join(box, 'logs', 'bot.log'),
    },
    encoding: 'utf8',
  });
  return { started: run.status === 0, code: run.status, output: String(run.stdout || '') + String(run.stderr || ''), box };
}

test('на данных из более новой версии бот не запускается', () => {
  const result = startBotWith({ version: DATA_VERSION + 5, config: {}, users: {}, objects: [] });
  assert.equal(result.started, false, 'запуск остановлен');
  assert.equal(result.code, 1, 'и это не тихий выход');
  assert.match(result.output, /более новой версией/i, 'сказано, в чём дело');
  assert.match(result.output, new RegExp(String(DATA_VERSION + 5)), 'названа версия файла');
  assert.match(result.output, /Поставьте свежую версию bot\.exe|поставьте свежую/i, 'сказано, что делать');
  // Файл остался нетронутым: ничего не «обновилось» и не потерялось.
  const kept = JSON.parse(fs.readFileSync(path.join(result.box, 'bot-data.json'), 'utf8'));
  assert.equal(kept.version, DATA_VERSION + 5, 'версия в файле не понижена');
  fs.rmSync(result.box, { recursive: true, force: true });
});

test('на старых данных бот запускается и говорит, что формат обновлён', () => {
  const result = startBotWith({ version: 20, config: {}, users: {}, objects: [] });
  assert.equal(result.started, true, result.output);
  assert.match(result.output, /ВЕРСИЯ:ok:формат обновлён с версии 20/, 'в самопроверке видно обновление формата');
  fs.rmSync(result.box, { recursive: true, force: true });
});

test('копия из более новой версии не восстанавливается', async () => {
  const { validateBackupPayload } = await import('../src/admin-input.mjs');
  const backup = { version: DATA_VERSION + 3, config: { passwordHash: 'x'.repeat(20), passwordSalt: 'y'.repeat(20) }, objects: [] };
  assert.throws(() => validateBackupPayload(backup), /более новой версией/i);
  // Своя и старая копии по-прежнему проходят проверку.
  validateBackupPayload({ ...backup, version: DATA_VERSION });
  validateBackupPayload({ ...backup, version: 20 });
});

test('самопроверка смотрит на версию из файла, а не из памяти', async () => {
  resetData((data) => { data.config.active = true; });
  const { loadedDataVersion } = await import('../src/store.mjs');
  // В памяти версия всегда текущая — на этом прежняя проверка и спотыкалась.
  bot.getData().version = 17;
  const check = bot.runSelfCheck().checks.find((item) => item.id === 'version');
  assert.notEqual(check.status, 'bad', 'подмена версии в памяти больше ничего не значит');
  assert.equal(typeof loadedDataVersion(), 'number', 'есть версия, прочитанная из файла');
});

test('копия из более новой версии не подставляется при пропавшем файле данных', () => {
  // Откат на прежний bot.exe: сам файл данных проверяется, а копии рядом
  // проверку обходили — старая программа молча приводила .bak к своему формату
  // и теряла всё, чего не знает.
  const bak = { version: DATA_VERSION + 4, config: {}, users: {}, objects: [{ id: 'new-object' }] };
  const result = startBotWith(null, { bak });
  assert.equal(result.started, false, 'запуск остановлен');
  assert.equal(result.code, 1, 'и это не тихий выход');
  assert.match(result.output, /более новой версией/i, 'сказано, в чём дело');
  assert.match(result.output, /Поставьте свежую версию bot\.exe/i, 'сказано, что делать');

  const kept = JSON.parse(fs.readFileSync(path.join(result.box, 'bot-data.json.bak'), 'utf8'));
  assert.equal(kept.version, DATA_VERSION + 4, 'копия не тронута');
  assert.ok(!fs.existsSync(path.join(result.box, 'bot-data.json')), 'пустой файл данных не записан');
  fs.rmSync(result.box, { recursive: true, force: true });
});

test('при повреждённом файле берётся подходящая копия, а не та, что из будущего', () => {
  const bak = { version: DATA_VERSION + 4, config: {}, users: {}, objects: [] };
  const snapshot = { version: 20, config: { adminName: 'Из снимка' }, users: {}, objects: [] };
  const result = startBotWith('{ это не данные', { bak, snapshots: { 'bot-data-2026-09-27.json': snapshot } });
  assert.equal(result.started, true, result.output);
  assert.match(result.output, /Данные восстановлены из копии: bot-data-2026-09-27\.json/, 'взят снимок прежнего формата');
  fs.rmSync(result.box, { recursive: true, force: true });
});
