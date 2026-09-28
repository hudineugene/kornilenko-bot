'use strict';

// Песочница и обход клиента писали в живой logs\bot.log: журнал по умолчанию
// лежал рядом с программой, а не рядом с файлом данных. В настоящем журнале
// от этого накопились сотни ложных «Telegram отклонил токен» от выдуманного
// токена — и такую тревогу легко принять за настоящую.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

// Отдельный процесс: путь журнала вычисляется один раз при загрузке модуля, а
// окружение у каждого сценария своё.
function logLocation(environment) {
  const script = "import('./src/logfile.mjs').then((m) => process.stdout.write(m.LOG_FILE))";
  const cleaned = { ...process.env };
  delete cleaned.BOT_LOG_FILE;
  delete cleaned.BOT_DATA_FILE;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: { ...cleaned, ...environment },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('журнал по умолчанию лежит рядом с файлом данных', () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-log-place-'));
  try {
    const location = logLocation({ BOT_DATA_FILE: path.join(box, 'bot-data.json') });
    assert.equal(location, path.join(box, 'logs', 'bot.log'), 'песочница пишет в свою папку, а не в живую');
    assert.ok(!location.startsWith(root), 'и уж точно не в папку программы');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

test('явно заданный BOT_LOG_FILE важнее', () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-log-place-'));
  try {
    const explicit = path.join(box, 'other', 'my.log');
    const location = logLocation({ BOT_DATA_FILE: path.join(box, 'bot-data.json'), BOT_LOG_FILE: explicit });
    assert.equal(location, explicit);
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

test('без своих путей журнал остаётся там же, где и был', () => {
  // Настоящий бот запускается без BOT_DATA_FILE: файл данных лежит рядом с
  // программой, значит и журнал — в её папке logs, как и раньше.
  const location = logLocation({});
  assert.equal(location, path.join(root, 'logs', 'bot.log'));
});
