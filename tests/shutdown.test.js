'use strict';

// Выключение Windows. Сигнала SIGTERM на Windows не бывает: система шлёт
// консольному приложению один и тот же сигнал и при закрытии окна, и при
// выходе из учётной записи, и при выключении компьютера. Бот подписывал
// причину «закрыли окно бота» даже когда выключали компьютер, а Ctrl+Break не
// обрабатывал вовсе. README при этом обещал больше, чем бот может успеть.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { bot, resetData, cleanup } = require('./helpers/chat');

const project = path.resolve(__dirname, '..');

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('причина остановки не выдаёт закрытие окна за выключение компьютера', async () => {
  const { rememberShutdown, startNoticeText, stopNoticeText } = await import('../src/status.mjs');
  rememberShutdown('SIGHUP', new Date());
  const stop = stopNoticeText('SIGHUP');
  assert.match(stop, /закрыли окно бота или выключили компьютер/, 'сказано и то, и другое — различить их нельзя');
  assert.match(startNoticeText(new Date()), /закрыли окно бота или выключили компьютер/, 'и при следующем запуске тоже');
});

test('Ctrl+Break и завершение процесса подписаны по-своему', async () => {
  const { stopNoticeText } = await import('../src/status.mjs');
  assert.match(stopNoticeText('SIGBREAK'), /Ctrl\+Break/);
  assert.match(stopNoticeText('SIGINT'), /Ctrl\+C/);
  assert.match(stopNoticeText('SIGTERM'), /диспетчер задач|служб/i);
});

test('бот слушает все сигналы, которые приходят на Windows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lifecycle.mjs'), 'utf8');
  for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGBREAK']) {
    assert.match(source, new RegExp("process\\.on\\('" + signal + "', shutdown\\)"), 'нет обработчика ' + signal);
  }
  assert.match(source, /process\.on\('exit'/, 'есть последняя попытка сохранить данные при любом выходе');
});

test('на прощание отведено меньше времени, чем даёт Windows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lifecycle.mjs'), 'utf8');
  const timeout = Number((source.match(/WINDOW_CLOSED_NOTICE_TIMEOUT_MS = (\d+)/) || [])[1]);
  assert.ok(timeout > 0 && timeout <= 3000, 'ожидание сообщения не должно съедать весь запас: ' + timeout + ' мс');
  const shutdown = source.slice(source.indexOf('function shutdown('));
  assert.ok(shutdown.indexOf('saveDataNow()') < shutdown.indexOf('sendStatusNotice'), 'данные сохраняются раньше, чем бот пытается написать в Telegram');
});

test('README описывает остановку так, как она работает', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /SIGTERM на Windows\s*\n?\s*не существует/, 'сказано, что SIGTERM на Windows не бывает');
  assert.match(readme, /может и не успеть уйти/, 'обещание «успевает» заменено на честное');
  assert.match(readme, /bot-running\.json/, 'сказано, как бот замечает принудительное завершение');
});

test('изменения последних секунд перед выходом попадают на диск', () => {
  // Остановка длится до нескольких секунд: бот ещё пишет администратору, а
  // данные за это время меняются. Раньше отложенная запись отменялась через
  // clearTimeout, но переменная оставалась занятой — scheduleSave считал, что
  // запись уже назначена, и молчал, а второго сохранения перед выходом не было.
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-shutdown-test-'));
  const dataFile = path.join(box, 'bot-data.json');
  fs.writeFileSync(dataFile, JSON.stringify({
    version: 28,
    config: { botToken: '12345:ABCDEFGHIJKLMNOPQRSTUV', adminChatId: '9990001', statusNotices: true, adminName: 'До остановки' },
  }), 'utf8');

  const fileUrl = (name) => 'require("node:url").pathToFileURL(' + JSON.stringify(path.join(project, 'src', name)) + ').href';
  const script = '(async () => {'
    // Telegram не отвечает: прощальное сообщение будет ждать своей секунды, и
    // ровно в это время данные меняются.
    + 'global.fetch = () => new Promise(() => {});'
    + 'const store = await import(' + fileUrl('store.mjs') + ');'
    + 'const lifecycle = await import(' + fileUrl('lifecycle.mjs') + ');'
    // Как в жизни: за миг до остановки что-то изменилось и запись уже назначена.
    + 'store.data.config.adminName = "Перед остановкой"; store.scheduleSave();'
    + 'setTimeout(() => { store.data.config.adminName = "Записано на прощание"; store.scheduleSave(); }, 50);'
    + 'lifecycle.shutdown("SIGINT");'
    + '})();';
  const run = spawnSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      NO_AUTO_OPEN: '1',
      BOT_DATA_FILE: dataFile,
      BOT_MEDIA_DIRECTORY: path.join(box, 'bot-media'),
      BOT_LOG_FILE: path.join(box, 'logs', 'bot.log'),
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(run.status, 0, String(run.stdout) + String(run.stderr));

  const onDisk = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(onDisk.config.adminName, 'Записано на прощание', 'правка из последних секунд сохранена');
  assert.equal(onDisk.lastShutdown && onDisk.lastShutdown.reason, 'SIGINT', 'причина остановки тоже записана');
  fs.rmSync(box, { recursive: true, force: true });
});

test('отменённая отложенная запись не блокирует следующую', async () => {
  const { cancelScheduledSave, scheduleSave } = await import('../src/store.mjs');
  resetData((data) => { data.config.adminName = 'Начало'; });
  scheduleSave();
  cancelScheduledSave();
  bot.getData().config.adminName = 'После отмены';
  scheduleSave();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const onDisk = JSON.parse(fs.readFileSync(require('./helpers/chat').dataFile, 'utf8'));
  assert.equal(onDisk.config.adminName, 'После отмены', 'запись назначилась заново и прошла');
});
