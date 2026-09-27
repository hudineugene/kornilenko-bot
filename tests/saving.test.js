'use strict';

// Запись данных на диск: антивирус и программы резервного копирования держат
// файл занятым доли секунды, диск может закончиться. Раньше такой сбой был
// виден только в окне бота: ни повтора, ни записи в журнал, ни сообщения.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bot, telegram, dataFile, resetData, adminNotifications, settle, cleanup } = require('./helpers/chat');

const dataName = path.basename(dataFile);
const isDataWrite = (file) => String(file).includes(dataName);

// Подменяем запись файла данных: первые попытки «заняты», дальше как обычно.
function lockDataFile({ failures = 1, code = 'EPERM' } = {}) {
  const realWrite = fs.writeFileSync;
  let seen = 0;
  const state = { attempts: 0 };
  fs.writeFileSync = function (file, ...rest) {
    if (isDataWrite(file)) {
      state.attempts += 1;
      seen += 1;
      if (seen <= failures) {
        const error = new Error('EPERM: operation not permitted, open ' + file);
        error.code = code;
        throw error;
      }
    }
    return realWrite.call(fs, file, ...rest);
  };
  state.restore = () => { fs.writeFileSync = realWrite; };
  return state;
}

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = '9990001';
}));
test.after(cleanup);

test.describe('временная блокировка файла', () => {
  test('запись повторяется и данные всё-таки сохраняются', () => {
    const locked = lockDataFile({ failures: 2 });
    try {
      bot.getData().contacts = { ...(bot.getData().contacts || {}), website: 'https://example.com/повтор' };
      bot.saveDataNow();
    } finally {
      locked.restore();
    }
    assert.ok(locked.attempts >= 3, 'попыток должно быть больше одной, было: ' + locked.attempts);
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(saved.contacts.website, 'https://example.com/повтор', 'данные на диске');
    assert.equal(bot.runtime.lastSaveError, '', 'после успеха отметки о сбое нет');
  });

  test('после исчерпания попыток сбой попадает в журнал и уходит администратору', async () => {
    const locked = lockDataFile({ failures: 99 });
    let failed = false;
    try {
      bot.saveDataNow();
    } catch {
      failed = true;
    } finally {
      locked.restore();
    }
    assert.equal(failed, true, 'сохранение честно сообщает о неудаче вызывающему');
    assert.ok(locked.attempts >= 4, 'бот пробовал несколько раз: ' + locked.attempts);
    assert.ok(bot.runtime.lastSaveError, 'сбой виден в состоянии бота');

    const journal = bot.getData().errors || [];
    assert.ok(journal.some((entry) => entry.area === 'Сохранение данных'), 'сбой записан в журнал ошибок');
    await settle();
    assert.ok(adminNotifications().some((text) => /сохранение данных/i.test(text)), 'администратору сообщили');
  });

  test('переполненный диск не повторяют без толку', () => {
    const locked = lockDataFile({ failures: 99, code: 'ENOSPC' });
    try {
      assert.throws(() => bot.saveDataNow());
    } finally {
      locked.restore();
    }
    assert.equal(locked.attempts, 1, 'при нехватке места повторять бессмысленно');
  });
});

test('неудачная копия .bak не мешает сохранить данные', () => {
  const realCopy = fs.copyFileSync;
  let copyTried = 0;
  fs.copyFileSync = function (source, target, ...rest) {
    if (String(target).endsWith('.bak')) {
      copyTried += 1;
      const error = new Error('EBUSY: resource busy or locked');
      error.code = 'EBUSY';
      throw error;
    }
    return realCopy.call(fs, source, target, ...rest);
  };
  try {
    bot.saveDataNow();
    bot.getData().contacts = { ...(bot.getData().contacts || {}), website: 'https://example.com/без-копии' };
    // Копия делается не чаще, чем раз в интервал: сдвигаем время вручную.
    bot.runtime.lastSaveError = '';
    bot.saveDataNow();
  } finally {
    fs.copyFileSync = realCopy;
  }
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(saved.contacts.website, 'https://example.com/без-копии', 'данные записаны, несмотря на сбой копии');
  assert.equal(bot.runtime.lastSaveError, '', 'сбой копии не считается сбоем записи');
});

test('черновик .tmp не остаётся после неудачной записи', () => {
  const temporary = dataFile + '.tmp';
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = function (file, ...rest) {
    if (isDataWrite(file) && String(file).endsWith('.tmp')) {
      realWrite.call(fs, file, 'обрывок', 'utf8');
      const error = new Error('EPERM: operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return realWrite.call(fs, file, ...rest);
  };
  try {
    assert.throws(() => bot.saveDataNow());
  } finally {
    fs.writeFileSync = realWrite;
  }
  assert.equal(fs.existsSync(temporary), false, 'недописанный файл убран');
  assert.ok(fs.existsSync(dataFile), 'прежние данные на месте');
});
