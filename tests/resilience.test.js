'use strict';

// Устойчивость: самопроверка, защита от второй запущенной копии и отсутствие
// повторных ответов, если Telegram присылает те же обновления заново.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { bot, telegram, dataFile, createChat, property, resetData, cleanup } = require('./helpers/chat');

const markerFile = path.join(path.dirname(dataFile), 'bot-running.json');
const checkOf = (report, id) => report.checks.find((check) => check.id === id);

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminNotificationVerifiedAt = new Date().toISOString();
  data.objects.push(property('flat-ready-01', 'Готовая квартира', 'active', { priceValue: 250000, currency: 'EUR' }));
}));
test.after(() => {
  fs.rmSync(markerFile, { force: true });
  cleanup();
});

test.describe('self-check', () => {
  test('a ready bot passes every check', () => {
    bot.runtime.status = 'polling';
    const report = bot.runSelfCheck();
    assert.equal(checkOf(report, 'token').status, 'ok');
    assert.equal(checkOf(report, 'admin').status, 'ok');
    assert.equal(checkOf(report, 'catalog').status, 'ok');
    assert.equal(checkOf(report, 'media').status, 'ok');
    assert.equal(report.bad, 0);
    assert.equal(bot.selfCheckNotice(report), '', 'администратора не беспокоят, когда всё в порядке');
  });

  test('a missing token and admin chat are reported as problems', () => {
    const data = bot.getData();
    data.config.botToken = '';
    data.config.adminChatId = '';
    const report = bot.runSelfCheck();
    assert.equal(checkOf(report, 'token').status, 'bad');
    assert.equal(checkOf(report, 'admin').status, 'bad');
    assert.match(bot.selfCheckNotice(report), /Токен бота/);
    assert.match(bot.selfCheckNotice(report), /Чат администратора/);
  });

  test('a token that does not look like one is caught before Telegram refuses it', () => {
    bot.getData().config.botToken = 'мой-токен';
    assert.equal(checkOf(bot.runSelfCheck(), 'token').status, 'bad');
  });

  test('an empty catalog for clients is a problem, a partly filled one a warning', () => {
    const data = bot.getData();
    data.objects.push(property('flat-empty-02', 'Без описания', 'active'));
    data.objects[1].description = { ru: '', en: '', es: '' };
    let report = bot.runSelfCheck();
    assert.equal(checkOf(report, 'catalog').status, 'warn');
    assert.match(checkOf(report, 'catalog').detail, /клиенты видят 1 из 2 объектов/);

    data.objects[0].description = { ru: '', en: '', es: '' };
    report = bot.runSelfCheck();
    assert.equal(checkOf(report, 'catalog').status, 'bad');
    assert.match(checkOf(report, 'catalog').detail, /каталог пустой/);
  });

  test('a photo referenced by the data but missing on disk is found', () => {
    const data = bot.getData();
    data.objects[0].imagesByLanguage.ru = [{ id: 'gone', storageFile: 'gone.jpg', mimeType: 'image/jpeg' }];
    const report = bot.runSelfCheck();
    assert.equal(checkOf(report, 'media').status, 'bad');
    assert.match(checkOf(report, 'media').detail, /gone\.jpg/);
    assert.equal(bot.mediaReport().missing.length, 1);
    assert.deepEqual(bot.mediaReport().missing, ['gone.jpg'], 'в списке имя файла');
  });

  test('a data version the program does not expect is a problem', () => {
    bot.getData().version = 17;
    assert.equal(checkOf(bot.runSelfCheck(), 'version').status, 'bad');
  });
});

test.describe('a second copy on the same data', () => {
  function writeMarker(pid, lastAliveAt) {
    fs.writeFileSync(markerFile, JSON.stringify({ pid, startedAt: new Date().toISOString(), lastAliveAt: lastAliveAt.toISOString() }), 'utf8');
  }

  test('a live copy with a fresh marker is detected and explained', async () => {
    const other = spawn(process.execPath, ['-e', 'setTimeout(function () {}, 5000)'], { stdio: 'ignore' });
    try {
      writeMarker(other.pid, new Date());
      const running = bot.runningCopy();
      assert.ok(running, 'работающая копия должна быть видна');
      assert.equal(running.pid, other.pid);
      const notice = bot.secondCopyNotice(running);
      assert.match(notice, /уже запущен/);
      assert.match(notice, /Ctrl\+C/);
    } finally {
      other.kill();
    }
  });

  test('a marker left by a crash does not block a new start', () => {
    writeMarker(999999999, new Date());
    assert.equal(bot.runningCopy(), null, 'мёртвый процесс не считается запущенной копией');
    assert.ok(bot.previousRunEndedAbruptly(), 'но это признак нештатной остановки');
  });

  test('a stale marker of a frozen process does not block a start either', async () => {
    const other = spawn(process.execPath, ['-e', 'setTimeout(function () {}, 5000)'], { stdio: 'ignore' });
    try {
      writeMarker(other.pid, new Date(Date.now() - 10 * 60 * 1000));
      assert.equal(bot.runningCopy(), null);
    } finally {
      other.kill();
    }
  });
});

test.describe('Telegram resends updates after a crash', () => {
  test('the same update is answered once, and the offset still moves on', async () => {
    const chat = createChat();
    const update = {
      update_id: 777001,
      message: { message_id: 4001, date: Math.floor(Date.now() / 1000), from: { id: chat.id, first_name: 'Анна', language_code: 'ru' }, chat: { id: chat.id, type: 'private' }, text: 'Здравствуйте, есть ли парковка?' },
    };
    telegram.calls = [];
    await bot.processUpdates([update], 'token');
    const first = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id)).length;
    assert.equal(first, 1);
    assert.equal(bot.getData().telegramOffset, 777002);

    // Telegram присылает то же самое снова: бот не упал между ответом и
    // сохранением offset, но мог бы.
    telegram.calls = [];
    await bot.processUpdates([update], 'token');
    assert.deepEqual(telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id)), []);
    assert.equal(bot.getData().telegramOffset, 777002, 'offset не откатывается назад');
    assert.equal(chat.inquiries.length, 1, 'обращение одно');
  });

  test('the list of handled updates survives a restart and does not grow forever', () => {
    const data = bot.getData();
    data.handledUpdateIds = Array.from({ length: 260 }, (item, index) => index + 1);
    const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(data)));
    assert.equal(reloaded.handledUpdateIds.length, 200);
    assert.equal(reloaded.handledUpdateIds[199], 260, 'остаются последние');
  });
});
