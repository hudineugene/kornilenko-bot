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
const { bot, resetData, cleanup } = require('./helpers/chat');

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
