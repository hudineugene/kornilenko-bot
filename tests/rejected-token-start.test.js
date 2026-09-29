'use strict';

// Токен могут сменить в BotFather, а бот при этом стоит запущенным. Отказ
// Telegram («токен отклонён») не должен убивать программу: панель остаётся
// открытой (в ней и меняют токен), бот сам повторяет подключение, а причина
// названа человеческим языком. Проверяем настоящим запуском бота на временных
// данных; запросы к Telegram заменены заглушкой (tests\helpers\reject-token.cjs).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await wait(150);
  }
  return null;
}

test('бот с отклонённым токеном не падает: панель отвечает, подключение повторяется', async () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-rejected-token-'));
  const salt = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(box, 'bot-data.json'), JSON.stringify({
    version: 40,
    config: { botToken: '123456:TOKEN-THAT-WAS-REVOKED', active: true, passwordSalt: salt, passwordHash: crypto.scryptSync('пароль-для-теста', salt, 64).toString('hex') },
  }));
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'helpers', 'reject-token.cjs'), path.join(root, 'bot.js')], {
    cwd: root,
    env: { ...process.env, BOT_DATA_FILE: path.join(box, 'bot-data.json'), PORT: String(port), NO_AUTO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  try {
    // Панель поднялась, несмотря на отказ Telegram.
    const page = await until(async () => {
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/');
        return response.ok ? response : null;
      } catch { return null; }
    }, 15000);
    assert.ok(page, 'панель отвечает. Вывод бота:\n' + output);

    // Бот пробует подключиться снова и снова, а не сдаётся после первого отказа.
    const retried = await until(() => (output.match(/STUB-REJECT/g) || []).length >= 3, 12000);
    assert.ok(retried, 'подключение повторяется. Вывод бота:\n' + output);
    assert.equal(exited, null, 'программа не завершилась');
    assert.match(output, /Telegram отклонил токен бота/, 'причина названа по-человечески');
    assert.match(output, /повтор подключения/, 'сказано, что бот повторит попытку');
  } finally {
    child.kill();
    await until(() => exited !== null, 5000);
    fs.rmSync(box, { recursive: true, force: true });
  }
});
