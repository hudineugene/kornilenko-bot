'use strict';

// Смена пароля панели без Node у владельца: bot.exe --reset-password. Проверяем
// на копии данных, двумя путями запуска — через инструмент tools\ и через точку
// входа, из которой собирается bot.exe. Живой bot-data.json тесты не трогают:
// путь к файлу задан переменной BOT_DATA_FILE.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const OLD_SALT = 'aa'.repeat(16);
const OLD_HASH = crypto.scryptSync('старый-пароль', OLD_SALT, 64).toString('hex');

function workspace(extra = {}) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-password-'));
  const dataFile = path.join(box, 'bot-data.json');
  fs.writeFileSync(dataFile, JSON.stringify({ version: 39, config: { botToken: '123:test', passwordSalt: OLD_SALT, passwordHash: OLD_HASH, adminName: 'Оставить как есть' }, inquiries: [{ id: 'x' }], ...extra }));
  return { box, dataFile };
}

function run(script, args, dataFile, input) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, BOT_DATA_FILE: dataFile },
    input,
    encoding: 'utf8',
  });
}

const ways = [
  ['инструмент tools\\set-panel-password.js', path.join(root, 'tools', 'set-panel-password.js'), []],
  ['точка входа bot.exe с --reset-password', path.join(root, 'src', 'entry.mjs'), ['--reset-password']],
];

for (const [name, script, args] of ways) {
  test.describe(name, () => {
    test('новый пароль записывается, остальные данные целы, копия сохранена', () => {
      const { box, dataFile } = workspace();
      try {
        const result = run(script, args, dataFile, 'новый-надёжный-пароль\nновый-надёжный-пароль\n');
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const after = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        const check = crypto.scryptSync('новый-надёжный-пароль', after.config.passwordSalt, 64).toString('hex');
        assert.equal(after.config.passwordHash, check, 'сохранён отпечаток нового пароля');
        assert.notEqual(after.config.passwordSalt, OLD_SALT, 'соль новая');
        assert.equal(after.config.adminName, 'Оставить как есть', 'остальные настройки не тронуты');
        assert.deepEqual(after.inquiries, [{ id: 'x' }], 'заявки не тронуты');
        assert.ok(!result.stdout.includes('новый-надёжный-пароль') && !result.stderr.includes('новый-надёжный-пароль'), 'пароль нигде не напечатан');
        const backups = fs.readdirSync(path.join(box, 'backups')).filter((file) => file.startsWith('bot-data-before-password-'));
        assert.equal(backups.length, 1, 'копия прежних данных лежит в backups');
        assert.equal(JSON.parse(fs.readFileSync(path.join(box, 'backups', backups[0]), 'utf8')).config.passwordHash, OLD_HASH, 'в копии — прежний пароль');
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    });

    test('короткий пароль и несовпадение отклоняются, файл остаётся прежним', () => {
      const { box, dataFile } = workspace();
      try {
        const short = run(script, args, dataFile, 'коротко\nкоротко\n');
        assert.notEqual(short.status, 0);
        assert.match(short.stderr + short.stdout, /минимум 8 знаков/);
        const mismatch = run(script, args, dataFile, 'первый-пароль-1\nвторой-пароль-2\n');
        assert.notEqual(mismatch.status, 0);
        assert.match(mismatch.stderr + mismatch.stdout, /не совпали/);
        assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).config.passwordHash, OLD_HASH, 'пароль не менялся');
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    });

    test('пока бот работает, пароль не меняется', () => {
      const { box, dataFile } = workspace();
      try {
        fs.writeFileSync(path.join(box, 'bot-running.json'), JSON.stringify({ pid: 4242, startedAt: new Date().toISOString(), lastAliveAt: new Date().toISOString() }));
        const result = run(script, args, dataFile, 'новый-надёжный-пароль\nновый-надёжный-пароль\n');
        assert.notEqual(result.status, 0);
        assert.match(result.stderr + result.stdout, /Бот сейчас работает/);
        assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).config.passwordHash, OLD_HASH);
      } finally {
        fs.rmSync(box, { recursive: true, force: true });
      }
    });
  });
}

test('служебный режим не запускает бота и не открывает порт', () => {
  const { box, dataFile } = workspace();
  try {
    const result = run(path.join(root, 'src', 'entry.mjs'), ['--reset-password'], dataFile, 'ещё-один-пароль-8\nещё-один-пароль-8\n');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(!/Пульт Telegram-бота запущен/.test(result.stdout), 'панель не поднималась');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});
