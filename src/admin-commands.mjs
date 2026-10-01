// Команды администратора и менеджеров в их чатах с ботом: обращения без
// ответа, просмотры, цифры за день и неделю — без панели, с телефона.

import { localDayKey } from './util.mjs';
import { PLACES } from './places.mjs';
import { data } from './store.mjs';
import { sendMessage } from './telegram.mjs';
import { adminChatFor, awaitingReply, inquiryTypeLabel } from './inquiries.mjs';
import { waitingConversationCount } from './admin-notifications.mjs';
import { activityDigest, hoursAgoText, sendInquiryToAdministrator, weekFigures } from './notices.mjs';
import { viewingsOverview } from './viewings.mjs';
import { BOT_COMMAND_DESCRIPTIONS } from './texts.mjs';

// Shown in the command menu of the admin and manager chats only.
const ADMIN_COMMAND_DESCRIPTIONS = {
  inbox: 'Заявки без ответа',
  viewings: 'Просмотры сегодня и завтра',
  stats: 'Цифры за сегодня и неделю',
};
const INBOX_LIMIT = 10;

const ADMIN_CHAT_HINT = [
  'ℹ️ Сообщение никому не отправлено.',
  'Чтобы ответить клиенту, ответьте на его карточку (смахните влево). /inbox — кто ждёт ответа.',
].join('\n');

// В группе, назначенной чатом администратора или менеджера, бот отвечает только
// на команды сотрудников. Раньше всё остальное с косой чертой проваливалось в
// клиентский сценарий: /start участника заводил «клиента» с номером группы,
// клиентское меню уходило в группу, а «ответ клиенту» пришёл бы туда же.
const GROUP_COMMANDS_HINT = [
  'ℹ️ Это рабочий чат — здесь бот понимает только команды для сотрудников:',
  '',
  '/inbox — заявки без ответа',
  '/viewings — просмотры сегодня и завтра',
  '/stats — цифры за сегодня и неделю',
  '',
  'Меню клиента, заявки и анкеты живут в личной переписке с ботом.',
].join('\n');

// Команды самого бота: на них в группе отвечаем подсказкой. Чужие (/poll,
// команда другого бота) молча пропускаем — это не наш разговор.
const OWN_COMMANDS = new Set(['/inbox', '/viewings', '/stats', '/myid',
  ...Object.keys(BOT_COMMAND_DESCRIPTIONS.ru).map((name) => '/' + name)]);

function meantForAnotherBot(text) {
  const mention = (String(text).match(/^\/[A-Za-z0-9_]+@([A-Za-z0-9_]+)/) || [])[1];
  if (!mention) return false;
  const ours = String((data.bot && data.bot.username) || '').toLocaleLowerCase('en-US');
  return Boolean(ours) && mention.toLocaleLowerCase('en-US') !== ours;
}

// The main admin sees everything; a manager sees what is free or theirs.
function waitingFrom(inquiry) {
  return Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0;
}

// Один клиент — одна строка (как в панели): из его заявок берём ту, что ждёт дольше всех.
function oneRowPerClient(inquiries) {
  const byClient = new Map();
  for (const inquiry of inquiries) {
    const key = String(inquiry.userId);
    const known = byClient.get(key);
    if (!known || waitingFrom(inquiry) < waitingFrom(known)) byClient.set(key, inquiry);
  }
  return Array.from(byClient.values()).sort((a, b) => waitingFrom(a) - waitingFrom(b));
}

function inboxFor(chat) {
  return oneRowPerClient(data.inquiries.filter((inquiry) => awaitingReply(inquiry) && (chat.main || !inquiry.assignee || inquiry.assignee === chat.name)));
}

// Each inquiry comes again with its buttons, so the admin can reply to it.
async function sendInbox(chat, token, now = new Date()) {
  const waiting = inboxFor(chat);
  if (!waiting.length) {
    // Менеджер без своих заявок не должен думать, что всё отвечено, если у коллег клиент ждёт.
    const colleagues = chat.main ? 0 : oneRowPerClient(data.inquiries.filter(awaitingReply)).length;
    await sendMessage(chat.chatId, colleagues ? '📥 У вас нет заявок без ответа; у коллег ждут: ' + colleagues + '.' : '✅ Все заявки отвечены.', token, { track: false });
    return 0;
  }
  const shown = waiting.slice(0, INBOX_LIMIT);
  await sendMessage(chat.chatId, '📥 Ждут ответа: ' + waiting.length + (waiting.length > shown.length ? '. Ниже ' + shown.length + ' самых давних, остальные — в панели: «' + PLACES.dialogs + '».' : ''), token, { track: false });
  for (const inquiry of shown) {
    const since = Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || now.getTime();
    await sendInquiryToAdministrator(inquiry, '📥 Ждёт ответа ' + hoursAgoText(now.getTime() - since) + ': ' + inquiryTypeLabel(inquiry), [], { chats: [chat] });
  }
  return shown.length;
}

function statsText(now = new Date()) {
  const today = activityDigest(localDayKey(now)).split('\n').slice(2).filter((line) => /^(Новых|Сообщений)/.test(line));
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const week = weekFigures(monday, now);
  const pad = (value) => String(value).padStart(2, '0');
  const label = (date) => pad(date.getDate()) + '.' + pad(date.getMonth() + 1);
  const waiting = waitingConversationCount();
  return [
    '📊 Сегодня, ' + label(now),
    ...(today.length ? today : ['Новых клиентов: 0', 'Сообщений от клиентов: 0', 'Новых заявок: 0']),
    '📥 Ждут ответа: ' + waiting + (waiting ? ' — /inbox' : ''),
    '',
    '📈 С понедельника, ' + label(monday),
    'Новых клиентов: ' + week.users.length,
    'Заявок: ' + week.inquiries.length,
    'Записей на просмотр: ' + week.inquiries.filter((inquiry) => inquiry.type === 'viewing').length,
  ].join('\n');
}

// Commands of the admin and manager chats. In a group the staff also talk to
// each other, so only replies (handled before) and commands are for the bot.
async function handleAdminChatMessage(message, token) {
  const chat = message && message.chat ? adminChatFor(message.chat.id) : null;
  if (!chat) return false;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  if (command === '/inbox') {
    await sendInbox(chat, token);
    return true;
  }
  if (command === '/viewings') {
    await sendMessage(chat.chatId, viewingsOverview(), token, { track: false });
    return true;
  }
  if (command === '/stats') {
    await sendMessage(chat.chatId, statsText(), token, { track: false });
    return true;
  }
  // Личный чат администратора с ботом — исключение: там клиентский сценарий
  // работает, чтобы владелец мог посмотреть бота своими глазами.
  if (message.chat.type === 'private') return false;
  if (command === '/myid') {
    await sendMessage(chat.chatId, 'Telegram-чат (номер для панели): ' + String(message.chat.id), token, { track: false });
    return true;
  }
  if (OWN_COMMANDS.has(command) && !meantForAnotherBot(text)) {
    await sendMessage(chat.chatId, GROUP_COMMANDS_HINT, token, { track: false });
  }
  // Что бы это ни было — переписка сотрудников или команда другого бота, —
  // клиентский сценарий в группе не запускаем.
  return true;
}

export {
  ADMIN_CHAT_HINT,
  ADMIN_COMMAND_DESCRIPTIONS,
  handleAdminChatMessage,
  inboxFor,
  sendInbox,
  statsText,
};
