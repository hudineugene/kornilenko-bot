'use strict';

// Инструкции не должны расходиться с программой: то, что в них названо
// командой или файлом, должно существовать.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('инструкция «Что делать, если…» называет только существующие команды и файлы', () => {
  const runbook = read('docs/runbook.md');
  for (const file of ['start-bot.ps1', 'tools/stop-bot.ps1', 'src/password-reset.mjs', 'src/entry.mjs']) {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' существует');
  }
  assert.match(runbook, /bot\.exe --reset-password/, 'про сброс пароля без Node');
  assert.match(runbook, /start-bot\.ps1/);
  assert.match(runbook, /tools\\stop-bot\.ps1/);
  assert.match(runbook, /Настройки → Копии/, 'экран восстановления назван так же, как в панели');
  // Режим действительно поддержан точкой входа программы.
  assert.match(read('src/entry.mjs'), /--reset-password/);
  assert.match(read('package.json'), /esbuild src\/entry\.mjs/, 'bot.exe собирается из точки входа с этим режимом');
  // Экран из инструкции есть в панели.
  const menu = read('src/panel/runtime.mjs');
  assert.match(menu, /\["data", "Копии"\]/);
  assert.match(menu, /\["telegram", "Telegram и приложение"\]/);
});

test('start-bot.ps1: в комментарии правильный путь журнала', () => {
  const script = read('start-bot.ps1');
  assert.ok(!script.includes('logsot.log'), 'опечатки «logsot.log» нет');
  assert.match(script, /logs\\bot\.log/);
});
