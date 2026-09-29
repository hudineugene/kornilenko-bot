'use strict';

// Shared harness for conversation tests: loads bot.js against a temporary
// data folder, replaces the Telegram Bot API with a local stub and simulates
// client chats and the admin chat. Require it before anything else.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-chat-test-'));
const dataFile = path.join(workDirectory, 'bot-data.json');
process.env.BOT_NO_START = '1';
process.env.BOT_DATA_FILE = dataFile;
process.env.BOT_MEDIA_DIRECTORY = path.join(workDirectory, 'bot-media');
process.env.NO_AUTO_OPEN = '1';

const bot = require('../../bot.js');

const TOKEN = '12345:ABCDEFGHIJKLMNOPQRSTUV';
const ADMIN_CHAT = '9990001';
const BOT_ID = 5550001;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('chat test image')]).toString('base64');

// --- Telegram stub -----------------------------------------------------------

const telegram = { calls: [], nextMessageId: 1000 };
global.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  let body = {};
  if (init && typeof init.body === 'string') body = JSON.parse(init.body);
  else if (init && init.body instanceof FormData) {
    // Photos are uploaded as multipart; keep the text fields, parse the markup.
    for (const [key, value] of init.body.entries()) if (typeof value === 'string') body[key] = value;
    if (body.reply_markup) body.reply_markup = JSON.parse(body.reply_markup);
    if (body.reply_parameters) body.reply_parameters = JSON.parse(body.reply_parameters);
  }
  telegram.calls.push({ method, body });
  telegram.nextMessageId += 1;
  const result = method === 'sendMediaGroup' ? [{ message_id: telegram.nextMessageId }]
    : method === 'sendPhoto' ? { message_id: telegram.nextMessageId, photo: [{ file_id: 'photo-' + telegram.nextMessageId }] }
      : method === 'sendDocument' ? { message_id: telegram.nextMessageId, document: { file_id: 'document-' + telegram.nextMessageId, file_name: 'document' } }
    : ['deleteMessage', 'answerCallbackQuery', 'setMyCommands'].includes(method) ? true
      : { message_id: telegram.nextMessageId };
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

function buttonsOf(markup) {
  const rows = markup && (markup.keyboard || markup.inline_keyboard);
  return rows ? rows.flat().map((button) => button.text) : [];
}

function callbacksOf(markup) {
  const rows = markup && markup.inline_keyboard;
  return rows ? rows.flat().map((button) => button.callback_data).filter(Boolean) : [];
}

// --- Simulated chats ---------------------------------------------------------

let updateId = 1;
let nextUserId = 70000001;

async function deliver(update, chatId) {
  const before = telegram.calls.length;
  await bot.processUpdates([{ update_id: updateId++, ...update }], TOKEN);
  await settle();
  const calls = telegram.calls.slice(before);
  const replies = calls
    .filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chatId))
    .map((call) => ({ text: call.body.text, buttons: buttonsOf(call.body.reply_markup), markup: call.body.reply_markup }));
  const popups = calls.filter((call) => call.method === 'answerCallbackQuery' && call.body.text).map((call) => call.body.text);
  return { calls, replies, popups, last: replies[replies.length - 1] || { text: '', buttons: [] }, text: replies.map((reply) => reply.text).join('\n---\n') };
}

function createChat({ language = 'ru', firstName = 'Анна' } = {}) {
  const userId = nextUserId++;
  const from = { id: userId, first_name: firstName, language_code: language };
  bot.getData().users[String(userId)] = {
    id: String(userId), chatId: userId, firstName, preferredLanguage: language, activity: [],
    // Согласие на рассылки: большинство проверок про механику рассылок, а не
    // про согласие, поэтому клиент в помощнике его уже дал. Само согласие
    // проверяется отдельно в tests/subscriptions.test.js.
    newsConsentAt: new Date().toISOString(),
  };
  let messageId = 1;
  const chat = { id: userId, type: 'private' };
  const now = () => Math.floor(Date.now() / 1000);

  return {
    id: userId,
    get user() {
      return bot.userById(String(userId));
    },
    get inquiries() {
      return bot.getData().inquiries.filter((item) => item.userId === String(userId));
    },
    say(text) {
      messageId += 1;
      return deliver({ message: { message_id: messageId, date: now(), from, chat, text } }, userId);
    },
    // ownerId — чей это контакт: по умолчанию клиента, а можно подсунуть чужой.
    shareContact(phone, { ownerId = userId } = {}) {
      messageId += 1;
      return deliver({ message: { message_id: messageId, date: now(), from, chat, contact: { phone_number: phone, user_id: ownerId, first_name: firstName } } }, userId);
    },
    // options.card = true — кнопка нажата под карточкой объекта, то есть под
    // сообщением с фотографией: именно такие сообщения бот меняет на месте.
    press(data, options = {}) {
      messageId += 1;
      // The same button pressed twice within 1.4 s counts as a double click.
      if (this.user) this.user.lastCallback = null;
      const message = options.card
        ? { message_id: 5000 + messageId, date: now(), chat, caption: options.caption || 'карточка объекта', photo: [{ file_id: 'photo-card' }] }
        : { message_id: 5000 + messageId, date: now(), chat, text: '' };
      return deliver({ callback_query: { id: 'cb' + updateId, from, data, message } }, userId);
    },
  };
}

// The administrator pressing a button under a message in the admin chat.
function adminPress(data, messageId = 1) {
  const adminId = Number(ADMIN_CHAT);
  return deliver({ callback_query: { id: 'admin' + updateId, from: { id: adminId, first_name: 'Admin' }, data, message: { message_id: messageId, date: Math.floor(Date.now() / 1000), chat: { id: adminId, type: 'private' }, text: '' } } }, ADMIN_CHAT);
}

function property(id, title, status, extra = {}) {
  return {
    id,
    status,
    reference: id.toUpperCase(),
    dealType: 'sale',
    propertyType: 'apartment',
    title: { ru: title, en: title + ' (EN)', es: title + ' (ES)' },
    description: { ru: 'Краткое описание объекта.', en: 'A short property description.', es: 'Una breve descripción del inmueble.' },
    city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
    area: 80,
    bedrooms: 2,
    bathrooms: 1,
    imagesByLanguage: {
      ru: [{ id: id + '-ru', mimeType: 'image/png', dataBase64: PNG }],
      en: [{ id: id + '-en', mimeType: 'image/png', dataBase64: PNG }],
      es: [],
    },
    ...extra,
  };
}

function resetData(configure = () => {}) {
  const data = bot.normalizeLoadedData({ version: 15 });
  data.config.botToken = TOKEN;
  data.config.adminChatId = ADMIN_CHAT;
  data.config.active = false;
  data.bot = { id: BOT_ID, username: 'test_bot', firstName: 'Test' };
  configure(data);
  bot.setData(data);
  telegram.calls = [];
  return data;
}

function adminMessages() {
  return telegram.calls
    .filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT)
    .map((call) => ({ text: call.body.text, markup: call.body.reply_markup }));
}

function adminNotifications() {
  return adminMessages().map((message) => message.text);
}

function calendarDate(date, language = 'ru') {
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function cleanup() {
  bot.server.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
}

module.exports = {
  bot,
  telegram,
  TOKEN,
  ADMIN_CHAT,
  dataFile,
  settle,
  buttonsOf,
  callbacksOf,
  createChat,
  adminPress,
  property,
  resetData,
  adminMessages,
  adminNotifications,
  calendarDate,
  cleanup,
};
