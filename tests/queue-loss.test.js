'use strict';

// Регрессия из этапа 6: сообщения, стоявшие в очереди чата, молча пропадали,
// если в этот момент менялось «поколение» опроса — бота остановили, выключили
// в панели, сменили токен или восстановили копию. Номер обновления уже считался
// обработанным, отметка прочитанного у Telegram была сдвинута, и сообщение не
// приходило больше никогда: клиент писал, а в панели не появлялось ничего.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, resetData, cleanup } = require('./helpers/chat');

const TOKEN = '12345:ABCDEFGHIJKLMNOPQRSTUV';
let nextId = 60000;

function message(chatId, text) {
  nextId += 1;
  return {
    update_id: nextId,
    message: {
      message_id: nextId,
      date: Math.floor(Date.now() / 1000),
      from: { id: chatId, first_name: 'Клиент', language_code: 'ru' },
      chat: { id: chatId, type: 'private' },
      text,
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.botToken = TOKEN;
}));
test.after(cleanup);

test('сообщение из очереди не пропадает, если бота остановили', async () => {
  const handled = [];
  const handler = async (update) => {
    if (update.message.text === 'первое') await wait(300);
    handled.push(update.message.text);
  };
  const slow = message(11, 'первое');
  const next = message(11, 'второе');
  const work = bot.processUpdates([slow, next], TOKEN, handler);

  // Владелец выключает бота в панели, пока сообщения ещё в очереди.
  bot.runtime.generation += 1;
  await work;
  assert.deepEqual(handled, ['первое', 'второе'], 'оба сообщения обработаны, а не выброшены');
});

test('сохраняемая отметка не обгоняет незаконченные сообщения', async () => {
  const handler = async () => { await wait(300); };
  const update = message(12, 'в работе');
  const work = bot.processUpdates([update], TOKEN, handler);
  assert.ok(bot.getData().telegramOffset <= update.update_id, 'пока сообщение в работе, оно не принято');
  await work;
  assert.equal(bot.getData().telegramOffset, update.update_id + 1, 'после обработки — принято');
});

test('обработанное сообщение не разбирается второй раз', async () => {
  const handled = [];
  const handler = async (update) => { handled.push(update.update_id); };
  const update = message(13, 'одно');
  await bot.processUpdates([update], TOKEN, handler);
  // Telegram прислал то же самое ещё раз (так бывает после перезапуска).
  await bot.processUpdates([update], TOKEN, handler);
  assert.deepEqual(handled, [update.update_id], 'повтор отсеян');
});

test('пока сообщение в очереди, его повтор не берут в работу', async () => {
  const handled = [];
  const handler = async (update) => { await wait(200); handled.push(update.update_id); };
  const update = message(14, 'долгое');
  const first = bot.processUpdates([update], TOKEN, handler);
  const again = bot.processUpdates([update], TOKEN, handler);
  await Promise.all([first, again]);
  assert.deepEqual(handled, [update.update_id], 'обработано ровно один раз');
});

test('незаконченный альбом возвращается после перезапуска, а не пропадает', async () => {
  const data = bot.getData();
  data.users['700900'] = { id: '700900', chatId: '700900', firstName: 'Анна', preferredLanguage: 'ru', activity: [] };
  const part = (index) => {
    nextId += 1;
    return {
      update_id: nextId,
      message: {
        message_id: nextId,
        date: Math.floor(Date.now() / 1000),
        from: { id: 700900, first_name: 'Анна', language_code: 'ru' },
        chat: { id: 700900, type: 'private' },
        media_group_id: 'album-loss',
        photo: [{ file_id: 'p' + index, file_unique_id: 'u' + index, width: 100, height: 100 }],
        caption: index ? '' : 'Наш дом',
      },
    };
  };
  const parts = [part(0), part(1)];
  await bot.processUpdates(parts, TOKEN);
  // Альбом ещё собирается (окно 2,5 секунды) — бота останавливают именно сейчас.
  assert.ok(bot.getData().telegramOffset <= parts[0].update_id, 'части альбома не считаются принятыми');
  // Даём альбому собраться: после обработки отметка догоняет.
  await wait(3200);
  assert.ok(bot.getData().telegramOffset >= parts[1].update_id + 1, 'после сборки альбом принят');
});
