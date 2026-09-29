// Смена пароля панели, когда войти не получается.
//
// Запуск: node tools\set-panel-password.js   (у владельца с одним bot.exe: bot.exe --reset-password)
// Вся работа — в src/password-reset.mjs; здесь только папка проекта и запуск.

'use strict';

const path = require('node:path');

globalThis.BOT_APP_DIRECTORY = path.resolve(__dirname, '..');
import('../src/password-reset.mjs')
  .then((module) => module.resetPassword())
  .catch((error) => {
    console.error('\n  Не удалось изменить пароль: ' + error.message + '\n');
    process.exit(1);
  });
