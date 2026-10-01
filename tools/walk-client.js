// Прогон бота глазами клиента на песочнице: каталог, карточка, похожие,
// сравнение, «Моё», данные и политика, анкеты — на русском, английском и
// испанском. Пишет протокол «что нажал — что получил», у каждого ответа —
// «строк на телефоне», и список замечаний.
// Запуск (каждый раз на свежей песочнице — повторный прогон на той же тихо молчит из-за защиты от дублей):
//   node tools/sandbox.js && node tools/walk-client.js [папка] [ru,en,es]
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
const notes = [];
let update = 1;
const now = () => Math.floor(Date.now() / 1000);

function buttons(markup) {
  if (!markup) return '';
  const rows = markup.keyboard || markup.inline_keyboard;
  return rows ? '\n   ' + (markup.keyboard ? '⌨ ' : '▦ ') + rows.map((row) => row.map((b) => '[' + (b.text || b) + ']').join(' ')).join(' / ') : '';
}

// Сколько строк займёт текст на экране телефона: в пузыре Telegram помещается около 38 знаков.
function phoneLines(text) {
  return String(text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / 38)), 0);
}

// Подпись длиннее ряда — по правилу этапа 44: под фото по две в ряду до 13 знаков, под текстом до 15; по три до 10; полный ряд до 32.
function checkButtons(title, markup, photo) {
  for (const row of (markup && markup.inline_keyboard) || []) {
    const limit = row.length >= 4 ? 8 : row.length === 3 ? 10 : row.length === 2 ? (photo ? 13 : 15) : 32;
    for (const button of row) if ([...String(button.text)].length > limit) notes.push(title + ' — кнопка «' + button.text + '» длиннее ряда из ' + row.length + ' (' + limit + ')');
  }
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
    const shown = String(b.text || b.caption || (b.media && b.media.caption) || '');
    const rows = phoneLines(shown);
    out.push('  ' + kind + ' ' + shown.replace(/\n/g, '\n     ').slice(0, 1500) + buttons(b.reply_markup) + '\n   ↳ строк на телефоне: ' + rows);
    if (rows > 30) notes.push(title + ' — ответ в ' + rows + ' строк (больше экрана)');
    // Жирный заголовок — у каждого экрана с кнопками (правило этапов 45 и 49): первая строка — «значок Название».
    if (['sendMessage', 'editMessageText'].includes(call.method) && b.reply_markup && b.reply_markup.inline_keyboard && !(Array.isArray(b.entities) && b.entities.some((item) => item.type === 'bold' && item.offset === 0)) && !(b.parse_mode === 'HTML' && String(b.text || '').startsWith('<b>'))) {
      notes.push('нет жирного заголовка: «' + String(b.text || '').split('\n')[0].slice(0, 60) + '»');
    }
    checkButtons(title, b.reply_markup, call.method === 'sendPhoto' || call.method === 'editMessageMedia' || call.method === 'editMessageCaption');
    // Брак в тексте: неподставленные поля {count}, undefined, null, [object Object], NaN.
    const defect = /\{[a-zA-Z]+\}|undefined|\bnull\b|\[object|\bNaN\b/.exec(shown + ' ' + JSON.stringify(b.reply_markup || ''));
    if (defect) problems.push(title + ' — в ответе брак «' + defect[0] + '»');
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
      await bot.processUpdates([{ update_id: update++, callback_query: { id: 'cb' + update, from, data: value, message: api.lastMessage() } }], TOKEN);
      await new Promise((r) => setTimeout(r, 45));
      report('👆 ' + name + ' → ' + (label || value), before, id);
    },
    // Сообщение, под которым «нажата» кнопка, — как его прислал бы Telegram: у карточки есть фото и подпись, у экрана — текст.
    lastMessage() {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (String(call.body.chat_id) !== String(id) || !['sendMessage', 'sendPhoto', 'editMessageText', 'editMessageMedia', 'editMessageCaption'].includes(call.method)) continue;
        const withPhoto = call.method === 'sendPhoto' || call.method === 'editMessageMedia' || call.method === 'editMessageCaption';
        const caption = call.body.caption || (call.body.media && call.body.media.caption) || '';
        const base = { message_id: api.lastMessageId(), date: now(), chat };
        return withPhoto ? { ...base, photo: [{ file_id: 'walk-photo', file_unique_id: 'walk', width: 800, height: 600 }], caption } : { ...base, text: call.body.text || '' };
      }
      return { message_id: 1, date: now(), chat, text: '' };
    },
    lastMessageId() {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (String(call.body.chat_id) !== String(id)) continue;
        if (['sendMessage', 'sendPhoto', 'sendMediaGroup'].includes(call.method)) return call.id;
      }
      return 1;
    },
    inlineButtons() {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const markup = calls[index].body.reply_markup;
        if (String(calls[index].body.chat_id) !== String(id) || !markup || !markup.inline_keyboard) continue;
        return [...new Set(markup.inline_keyboard.flat().map((item) => item.callback_data).filter(Boolean))];
      }
      return [];
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

const SAYINGS = {
  ru: { name: 'Анна', callTime: 'Сегодня после 18:00', ask: 'Куплю квартиру в Бенидорме до 400 000 €', follow: 'А когда можно посмотреть?' },
  en: { name: 'John', callTime: 'Today after 18:00', ask: 'I want to buy a flat in Benidorm up to €400,000', follow: 'When can I see it?' },
  es: { name: 'Carlos', callTime: 'Hoy después de las 18:00', ask: 'Quiero comprar un piso en Benidorm hasta 400.000 €', follow: '¿Cuándo puedo verlo?' },
};
const CLIENT_IDS = { ru: 94000001, en: 94000002, es: 94000004 };

// Один и тот же путь клиента на любом языке: всё, что зависит от языка, берётся из меню бота и таблицы SAYINGS.
// Обход: с каждого экрана нажимаем каждую кнопку-callback (кроме разрушающих и уводящих из бота) и смотрим, что ответил бот.
const SKIP_BUTTONS = /:none|erase|erased|clear|delete|remove|cancel|unpin|forget|reset|stop|revoke|pause|off|unsubscribe|language:|lang:|nav:menu|policy|^url/i;
async function crawl(person, label, entry, depth = 1) {
  const screens = [];
  await entry();
  const first = person.inlineButtons();
  for (const callback of first) {
    if (SKIP_BUTTONS.test(callback)) continue;
    await person.press(callback, label + ' → ' + callback);
    if (depth > 1) {
      for (const inner of person.inlineButtons()) {
        if (SKIP_BUTTONS.test(inner) || inner === callback || first.includes(inner)) continue;
        await person.press(inner, label + ' → ' + callback + ' → ' + inner);
      }
    }
    await entry();
  }
  return screens;
}

async function walk(lang) {
  const MENU = bot.text.menu[lang];
  const words = SAYINGS[lang];
  const anna = client(CLIENT_IDS[lang], words.name, lang);
  const [flat, villa, rent, reserved] = data.objects;
  const head = lang === 'ru' ? '' : ' [' + lang.toUpperCase() + ']';

  out.push('\n# Клиент на языке: ' + lang);
  out.push('\n## Каталог и карточка' + head);
  await anna.say('/start');
  await anna.say(MENU.objects, 'открыть каталог');
  await anna.press('catalog:all:1', 'следующая карточка');
  await anna.press('cfilter:open', 'открыть фильтр');
  await anna.press('cfilter:deal:rent', 'только аренда');
  await anna.press('cfilter:reset', 'сбросить фильтр');
  await anna.press('property:details:' + flat.id, 'подробнее');
  await anna.press('property:gallery:' + flat.id, 'все фотографии');
  await anna.press('calc:' + flat.id, 'калькулятор покупки');
  await anna.press('property:similar:' + flat.id, 'похожие объекты');

  out.push('\n## Избранное, сравнение, сохранённый поиск' + head);
  await anna.press('property:favorite:' + flat.id, 'в избранное');
  await anna.press('property:compare:' + flat.id, 'в сравнение');
  await anna.press('property:compare:' + villa.id, 'второй в сравнение');
  await anna.press('compare:view', 'показать сравнение');
  await anna.say(MENU.more, 'личный раздел');
  await anna.press('cfilter:open', 'настроить фильтр');
  await anna.press('cfilter:deal:sale', 'только покупка');
  await anna.press('saved:save', 'сохранить поиск');
  await anna.press('saved:results', 'результаты сохранённого поиска');
  await anna.press('nav:my', 'вернуться в «Моё»');
  await anna.press('plan:open', 'план покупки');

  out.push('\n## Мои данные и политика' + head);
  await anna.press('privacy:open', 'раздел «Мои данные»');
  await anna.press('privacy:policy', 'как мы обращаемся с данными');
  await anna.press('privacy:erase', 'удалить мои данные');
  await anna.press('privacy:open', 'передумала удалять');

  out.push('\n## Связаться и анкеты' + head);
  await anna.say(MENU.contacts, 'контакты');
  await anna.say(MENU.request, 'заявка на звонок');
  await anna.press('lead:call', 'выбрать звонок');
  await anna.say('+34 600 111 222', 'номер телефона');
  await anna.say(words.callTime, 'удобное время');

  await anna.press('property:viewing:' + rent.id, 'записаться на просмотр');
  const days = anna.keyboard();
  await anna.say(days[0] || 'Tomorrow', 'выбор дня');
  const times = anna.keyboard();
  await anna.say(times[0] || '10:00', 'выбор времени');
  const confirm = anna.keyboard().find((label) => String(label).startsWith('✅'));
  if (confirm) await anna.say(confirm, 'подтвердить');

  out.push('\n## Запрос своими словами и бронь' + head);
  const second = client(CLIENT_IDS[lang] + 100, words.name + '2', lang);
  await second.say('/start');
  await second.say(words.ask, 'запрос параметрами');
  await second.say(words.follow, 'живой вопрос после запроса');
  await anna.press('property:details:' + reserved.id, 'карточка забронированного');
  await anna.press('property:availability:' + reserved.id, 'уточнить доступность');

  out.push('\n## Мои заявки и уведомления' + head);
  await anna.press('myreq:list', 'мои заявки');
  await anna.press('subs:menu', 'настройки уведомлений');

  out.push('\n## Обход экранов: подбор, гид, акции, избранное, цели, помощь, план, «Моё»' + head);
  const visitor = client(CLIENT_IDS[lang] + 200, words.name + '3', lang);
  await visitor.say('/start');
  for (const [name, entryText] of [['Подбор', MENU.selection], ['Гид', MENU.guide], ['Акции', MENU.promotions], ['Избранное', MENU.favorites], ['Моё', MENU.more], ['Связаться', MENU.contacts]]) {
    if (!entryText) continue;
    await crawl(visitor, name, () => visitor.say(entryText, 'вход: ' + name), 2);
  }
  await crawl(visitor, 'Цель', () => visitor.press('goal:menu', 'вход: цель'), 1);
  await crawl(visitor, 'План', () => visitor.press('plan:open', 'вход: план'), 2);
  await crawl(visitor, 'Фильтр', () => visitor.press('cfilter:open', 'вход: фильтр'), 2);
  await visitor.say('/help', 'команда /help');
  await visitor.say('/privacy', 'команда /privacy');
  await visitor.say('какая-то невнятная фраза', 'непонятная фраза');
  await visitor.say('🙂', 'эмодзи');
}

(async () => {
  out.push('# Прогон глазами клиента');
  const only = process.argv[3] ? process.argv[3].split(',') : ['ru', 'en', 'es'];
  for (const lang of only) await walk(lang);

  const file = path.join(box, 'walk-client.md');
  out.push('\n# Замечания по оформлению (строк на телефоне, кнопки длиннее ряда)');
  [...new Set(notes)].forEach((line) => out.push('- ' + line));
  fs.writeFileSync(file, out.join('\n'));
  console.log('протокол:', file);
  console.log('замечаний: ' + problems.length + ' (клиент без ответа); по оформлению: ' + new Set(notes).size);
  problems.forEach((line) => console.log('  ⚠️ ' + line));
  [...new Set(notes)].slice(0, 30).forEach((line) => console.log('  · ' + line));
  bot.server.close();
  process.exit(problems.length ? 1 : 0);
})().catch((error) => { console.error('СБОЙ:', error.message, error.stack.split('\n')[1]); process.exit(1); });
