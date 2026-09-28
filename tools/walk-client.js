// Прогон бота глазами клиента на песочнице: каталог, карточка, похожие,
// сравнение, «Моё», данные и политика, анкеты. Пишет протокол «что нажал —
// что получил» и список замечаний.
// Запуск: node tools/sandbox.js && node tools/walk-client.js
'use strict';
const fs = require('fs');
const path = require('path');

const project = path.resolve(__dirname, '..');
const box = path.resolve(process.argv[2] || path.join(project, '.sandbox'));
process.env.BOT_NO_START = '1';
process.env.BOT_DATA_FILE = path.join(box, 'bot-data.json');
process.env.BOT_MEDIA_DIRECTORY = path.join(box, 'bot-media');
process.env.BOT_LOG_FILE = path.join(box, 'logs', 'bot.log');
process.env.NO_AUTO_OPEN = '1';
const bot = require(path.join(project, 'bot.js'));

const calls = [];
let nextId = 80000;
global.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  let body = {};
  if (init && typeof init.body === 'string') body = JSON.parse(init.body);
  else if (init && init.body instanceof FormData) {
    for (const [key, value] of init.body.entries()) if (typeof value === 'string') body[key] = value;
    if (body.reply_markup) body.reply_markup = JSON.parse(body.reply_markup);
    if (body.media) body.media = JSON.parse(body.media);
  }
  nextId += 1;
  calls.push({ method, body, id: nextId });
  const result = method === 'sendMediaGroup' ? [{ message_id: nextId }]
    : ['deleteMessage', 'answerCallbackQuery', 'setMyCommands', 'setMessageReaction', 'pinChatMessage'].includes(method) ? true
      : { message_id: nextId, chat: { id: body.chat_id } };
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const data = bot.getData();
const TOKEN = data.config.botToken;
const ADMIN = String(data.config.adminChatId);
const out = [];
const problems = [];
let update = 1;
const now = () => Math.floor(Date.now() / 1000);

function buttons(markup) {
  if (!markup) return '';
  const rows = markup.keyboard || markup.inline_keyboard;
  return rows ? '\n   ' + (markup.keyboard ? '⌨ ' : '▦ ') + rows.map((row) => row.map((b) => '[' + (b.text || b) + ']').join(' ')).join(' / ') : '';
}

function report(title, from, chatId) {
  out.push('\n### ' + title);
  let toClient = 0;
  for (const call of calls.slice(from)) {
    const b = call.body;
    if (String(b.chat_id) === ADMIN) { out.push('  👨‍💼 админу: ' + String(b.text || b.caption || call.method).split('\n')[0].slice(0, 80)); continue; }
    if (b.chat_id != null && String(b.chat_id) !== String(chatId)) continue;
    if (call.method === 'deleteMessage' || call.method === 'setMyCommands') continue;
    if (call.method === 'answerCallbackQuery') { if (b.text) { out.push('  💬 ' + b.text); toClient += 1; } continue; }
    toClient += 1;
    const kind = call.method === 'sendPhoto' ? '🖼' : call.method === 'sendMediaGroup' ? '🖼🖼 альбом' : call.method.startsWith('edit') ? '✏️' : '🤖';
    out.push('  ' + kind + ' ' + String(b.text || b.caption || (b.media && b.media.caption) || '').replace(/\n/g, '\n     ').slice(0, 520) + buttons(b.reply_markup));
  }
  if (!toClient) {
    out.push('  ⚠️ клиент не получил ничего');
    problems.push(title + ' — клиент не получил ответа');
  }
}

function client(id, name, lang) {
  let messageId = 1000;
  const from = { id, first_name: name, language_code: lang, username: name.toLowerCase() };
  const chat = { id, type: 'private' };
  const api = {
    async say(text, label) {
      const before = calls.length;
      messageId += 1;
      await bot.processUpdates([{ update_id: update++, message: { message_id: messageId, date: now(), from, chat, text } }], TOKEN);
      await new Promise((r) => setTimeout(r, 45));
      report('👤 ' + name + ': «' + text + '»' + (label ? ' — ' + label : ''), before, id);
    },
    async press(value, label) {
      const before = calls.length;
      const user = bot.userById(String(id));
      if (user) user.lastCallback = null;
      await bot.processUpdates([{ update_id: update++, callback_query: { id: 'cb' + update, from, data: value, message: { message_id: api.lastMessageId(), date: now(), chat, text: '', caption: 'карточка' } } }], TOKEN);
      await new Promise((r) => setTimeout(r, 45));
      report('👆 ' + name + ' → ' + (label || value), before, id);
    },
    lastMessageId() {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (String(call.body.chat_id) !== String(id)) continue;
        if (['sendMessage', 'sendPhoto', 'sendMediaGroup'].includes(call.method)) return call.id;
      }
      return 1;
    },
    keyboard() {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const markup = calls[index].body.reply_markup;
        if (String(calls[index].body.chat_id) !== String(id) || !markup) continue;
        if (markup.keyboard) return markup.keyboard.flat().map((item) => (typeof item === 'string' ? item : item.text));
        if (markup.inline_keyboard) return markup.inline_keyboard.flat().map((item) => item.text);
      }
      return [];
    },
  };
  return api;
}

(async () => {
  const anna = client(94000001, 'Анна', 'ru');
  const objects = data.objects;
  const [flat, villa, rent, reserved] = objects;

  out.push('# Прогон глазами клиента');
  out.push('\n## Каталог и карточка');
  await anna.say('/start');
  await anna.say('🏘 Объекты', 'открыть каталог');
  await anna.press('catalog:all:1', 'следующая карточка');
  await anna.press('cfilter:open', 'открыть фильтр');
  await anna.press('cfilter:deal:rent', 'только аренда');
  await anna.press('cfilter:reset', 'сбросить фильтр');
  await anna.press('property:details:' + flat.id, 'подробнее');
  await anna.press('property:gallery:' + flat.id, 'все фотографии');
  await anna.press('calc:' + flat.id, 'калькулятор покупки');
  await anna.press('property:similar:' + flat.id, 'похожие объекты');

  out.push('\n## Избранное, сравнение, сохранённый поиск');
  await anna.press('property:favorite:' + flat.id, 'в избранное');
  await anna.press('property:compare:' + flat.id, 'в сравнение');
  await anna.press('property:compare:' + villa.id, 'второй в сравнение');
  await anna.press('compare:view', 'показать сравнение');
  await anna.say('👤 Моё', 'личный раздел');
  await anna.press('cfilter:open', 'настроить фильтр');
  await anna.press('cfilter:deal:sale', 'только покупка');
  await anna.press('saved:save', 'сохранить поиск');
  await anna.press('saved:results', 'результаты сохранённого поиска');
  await anna.press('nav:my', 'вернуться в «Моё»');

  out.push('\n## Мои данные и политика');
  await anna.press('privacy:open', 'раздел «Мои данные»');
  await anna.press('privacy:policy', 'как мы обращаемся с данными');
  await anna.press('privacy:erase', 'удалить мои данные');
  await anna.press('privacy:open', 'передумала удалять');

  out.push('\n## Анкеты');
  await anna.say('📞 Позвоните мне', 'заявка на звонок');
  await anna.press('lead:call', 'выбрать звонок');
  await anna.say('+34 600 111 222', 'номер телефона');
  await anna.say('Сегодня после 18:00', 'удобное время');

  await anna.press('property:viewing:' + rent.id, 'записаться на просмотр');
  const days = anna.keyboard();
  await anna.say(days[0] || 'Завтра', 'выбор дня');
  const times = anna.keyboard();
  await anna.say(times[0] || '10:00', 'выбор времени');
  await anna.say('✅ Отправить менеджеру');

  out.push('\n## Запрос своими словами и бронь');
  const igor = client(94000003, 'Игорь', 'ru');
  await igor.say('/start');
  await igor.say('Куплю квартиру в Бенидорме до 400 000 €', 'запрос параметрами');
  await igor.say('А когда можно посмотреть?', 'живой вопрос после запроса');
  await anna.press('property:details:' + reserved.id, 'карточка забронированного');
  await anna.press('property:availability:' + reserved.id, 'уточнить доступность');

  out.push('\n## Мои заявки и уведомления');
  await anna.press('myreq:list', 'мои заявки');
  await anna.press('subs:menu', 'настройки уведомлений');

  out.push('\n## Английский клиент');
  const john = client(94000002, 'John', 'en');
  await john.say('/start');
  await john.say('🏘 Properties', 'английский каталог');
  await john.press('property:details:' + flat.id, 'details');

  const file = path.join(box, 'walk-client.md');
  fs.writeFileSync(file, out.join('\n'));
  console.log('протокол:', file);
  console.log('замечаний:', problems.length);
  problems.forEach((line) => console.log('  ⚠️ ' + line));
  bot.server.close();
  process.exit(problems.length ? 1 : 0);
})().catch((error) => { console.error('СБОЙ:', error.message, error.stack.split('\n')[1]); process.exit(1); });
