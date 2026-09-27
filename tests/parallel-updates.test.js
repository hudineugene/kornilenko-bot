'use strict';

// Одно медленное сообщение задерживало ответы всем. Бот получал пачку
// обновлений, полностью её обрабатывал и только потом спрашивал Telegram о
// новых. Загрузка фотографии или ожидание после «слишком часто» — это секунды,
// и всё это время остальные клиенты ждали молча.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, resetData, cleanup } = require('./helpers/chat');

const TOKEN = '12345:ABCDEFGHIJKLMNOPQRSTUV';
let updateId = 70000;

function message(chatId, text) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      from: { id: chatId, first_name: 'Клиент ' + chatId, language_code: 'ru' },
      chat: { id: chatId, type: 'private' },
      text,
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('медленное сообщение одного клиента не задерживает других', async () => {
  const finished = [];
  const handler = async (update) => {
    const text = update.message.text;
    // Первый клиент «грузит фотографию» полсекунды.
    if (text === 'медленно') await wait(500);
    finished.push(text);
  };
  const started = Date.now();
  const slow = bot.processUpdates([message(1, 'медленно')], TOKEN, handler);
  // Следующая пачка приходит, пока первая ещё обрабатывается — раньше бот
  // даже не спрашивал Telegram о ней, пока не закончит предыдущую.
  const quick = bot.processUpdates([message(2, 'быстро')], TOKEN, handler);
  await quick;
  assert.deepEqual(finished, ['быстро'], 'второй клиент получил ответ, пока первый ещё обрабатывается');
  assert.ok(Date.now() - started < 400, 'и получил его быстро');
  await slow;
  assert.deepEqual(finished, ['быстро', 'медленно'], 'медленное дело всё равно доделано');
});

test('сообщения одного клиента обрабатываются по порядку', async () => {
  const order = [];
  const handler = async (update) => {
    const text = update.message.text;
    if (text === 'первое') await wait(200);
    order.push(text);
  };
  await bot.processUpdates([message(3, 'первое'), message(3, 'второе'), message(3, 'третье')], TOKEN, handler);
  assert.deepEqual(order, ['первое', 'второе', 'третье'], 'очередь клиента не перемешалась');
});

test('бот не ждёт обработку, чтобы спросить Telegram о новых сообщениях', async () => {
  const handler = async () => { await wait(400); };
  const started = Date.now();
  const work = bot.processUpdates([message(4, 'долгое')], TOKEN, handler);
  const returned = Date.now() - started;
  assert.ok(returned < 100, 'разбор пачки возвращает управление сразу, потрачено ' + returned + ' мс');
  // Отметка в памяти уже сдвинута: следующий запрос к Telegram принесёт новые
  // обновления, а не эти же.
  assert.ok(bot.runtime.offset >= updateId + 1, 'спрашиваем Telegram дальше, не дожидаясь обработки');
  // А сохраняемая отметка ждёт окончания: если бота остановят сейчас, это
  // сообщение придёт снова, а не потеряется.
  assert.ok(bot.getData().telegramOffset <= updateId, 'незаконченное сообщение не считается принятым');
  await work;
  assert.ok(bot.getData().telegramOffset >= updateId + 1, 'после обработки отметка сохраняется');
});

test('обновления следующей пачки встают в ту же очередь клиента', async () => {
  const order = [];
  const handler = async (update) => {
    const text = update.message.text;
    if (text === 'длинное') await wait(300);
    order.push(text);
  };
  const first = bot.processUpdates([message(5, 'длинное')], TOKEN, handler);
  const second = bot.processUpdates([message(5, 'следом')], TOKEN, handler);
  await Promise.all([first, second]);
  assert.deepEqual(order, ['длинное', 'следом'], 'порядок сохранён и между пачками');
});

test('ошибка в одном сообщении не роняет остальные', async () => {
  const done = [];
  const handler = async (update) => {
    if (update.message.text === 'сломанное') throw new Error('обработка не удалась');
    done.push(update.message.text);
  };
  await bot.processUpdates([message(6, 'сломанное'), message(7, 'обычное')], TOKEN, handler);
  assert.deepEqual(done, ['обычное']);
  assert.equal(bot.getData().errors[0].area, 'Обработка сообщения', 'сбой записан в журнал');
});

test('цикл опроса не ждёт окончания обработки', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'updates.mjs'), 'utf8');
  const loop = source.slice(source.indexOf('async function pollingLoop('));
  // Раньше здесь стоял await: пока бот не закончит пачку, он не спрашивал
  // Telegram о новых сообщениях, и клиенты ждали.
  assert.doesNotMatch(loop, /await processUpdates\(/, 'обработка пачки не задерживает следующий запрос');
  assert.match(loop, /const work = processUpdates\(updates, token\);/);
  assert.match(loop, /work\.then\(/, 'сохранение данных ждёт окончания обработки');
});
