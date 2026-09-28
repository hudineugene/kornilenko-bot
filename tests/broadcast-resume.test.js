'use strict';

// Рассылка с фотографией и длинным текстом уходит двумя сообщениями: снимок, а
// за ним текст. Если связь оборвалась между ними, рассылка продолжается с этого
// же получателя — и раньше он получал ту же фотографию второй раз.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, resetData, cleanup } = require('./helpers/chat');

const stub = global.fetch;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('broadcast photo')]).toString('base64');
// Больше 1000 знаков: Telegram не принимает такой текст подписью к фотографии.
const LONG_TEXT = 'Подробности осенней акции и условия рассрочки. '.repeat(30);

// Текстовые сообщения не доходят заданное число раз — как при обрыве связи.
function withFailingText(failures, run) {
  let left = failures;
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/sendMessage') && left > 0) {
      left -= 1;
      throw new Error('socket hang up');
    }
    return stub(url, init);
  };
  return run().finally(() => { global.fetch = stub; });
}

const sentTo = (method, chatId) => telegram.calls.filter((call) => call.method === method && String(call.body.chat_id) === chatId).length;

function broadcastWithPhoto() {
  const data = resetData((prepared) => { prepared.config.active = true; });
  data.users['9001'] = {
    id: '9001', chatId: '9001', firstName: 'Клиент', preferredLanguage: 'ru', activity: [],
    newsConsentAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  };
  const entry = {
    id: 'bc-photo', messages: { ru: LONG_TEXT, en: LONG_TEXT, es: LONG_TEXT }, languages: [], tags: [],
    buttonText: { ru: '', en: '', es: '' }, buttonUrl: '', audience: 'all',
    image: { id: 'bc-img', mimeType: 'image/png', dataBase64: PNG },
    status: 'queued', createdAt: new Date().toISOString(), processedUserIds: [], failures: [], total: 0,
  };
  data.broadcasts = [entry];
  telegram.calls = [];
  return { data, entry };
}

test.after(() => {
  global.fetch = stub;
  cleanup();
});

test('обрыв на тексте не приводит к повторной фотографии', async () => {
  const { entry } = broadcastWithPhoto();

  await withFailingText(1, () => bot.runBroadcast(entry));
  assert.equal(sentTo('sendPhoto', '9001'), 1, 'фотография ушла');
  assert.equal(entry.sent, 0, 'доставка не считается завершённой');
  assert.equal(entry.status, 'queued', 'рассылка встала в очередь и продолжится сама');
  assert.deepEqual(entry.processedUserIds, [], 'получатель не помечен обработанным');
  assert.deepEqual(entry.photoOnlyUserIds, ['9001'], 'бот помнит, что снимок уже доставлен');

  telegram.calls = [];
  await bot.runBroadcast(entry);
  assert.equal(sentTo('sendPhoto', '9001'), 0, 'второй раз фотография не отправлена');
  assert.equal(sentTo('sendMessage', '9001'), 1, 'ушёл только текст');
  assert.equal(entry.sent, 1, 'получатель обслужен');
  assert.deepEqual(entry.photoOnlyUserIds, [], 'отметка снята');
});

test('обычная рассылка с фотографией отметок не оставляет', async () => {
  const { entry } = broadcastWithPhoto();
  await bot.runBroadcast(entry);
  assert.equal(sentTo('sendPhoto', '9001'), 1);
  assert.equal(sentTo('sendMessage', '9001'), 1);
  assert.deepEqual(entry.photoOnlyUserIds, [], 'ничего не осталось висеть');
  assert.equal(entry.sent, 1);
});

test('короткий текст по-прежнему уходит подписью к фотографии', async () => {
  const { entry } = broadcastWithPhoto();
  entry.messages = { ru: 'Коротко о новом объекте', en: '', es: '' };
  await bot.runBroadcast(entry);
  assert.equal(sentTo('sendPhoto', '9001'), 1, 'одно сообщение с подписью');
  assert.equal(sentTo('sendMessage', '9001'), 0, 'отдельного текста нет');
});
