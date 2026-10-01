// Обращения клиентов, уведомления администратору и ответы из Telegram.

import { goalLabelRu } from './goal.mjs';
import crypto from 'node:crypto';
import { cleanText, localDayKey } from './util.mjs';
import { normalizePipelineStage, normalizeSelectionMatching, normalizeViewing } from './data-format.mjs';
import { nextOpening } from './hours.mjs';
import { adminSendPlan } from './notify-plan.mjs';
import { INTERACTION_TEXT, MANAGER_CONTACT_TEXT } from './texts.mjs';
import { data, saveDataNow, scheduleSave } from './store.mjs';
import { recordActivity, recordDaily, recordError } from './analytics.mjs';
import { markUnavailable, normalizeUser, userByChatId, userById } from './users.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { localized } from './catalog.mjs';
import { PLACES } from './places.mjs';
import { acknowledgeCallback, propertyRequestText } from './sections.mjs';
import { recordBroadcastResponse, userUnavailableError } from './broadcasts.mjs';
import { sendStatusNotice } from './status.mjs';

const MAX_INQUIRIES = 5000;
const MAX_INQUIRY_MESSAGES = 200;
// A client writing again continues the open conversation (also after the
// manager's answer), so a dialogue is one inquiry, not one per message.
const INQUIRY_MERGE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const INQUIRY_ACKNOWLEDGED_WINDOW_MS = 10 * 60 * 1000;
const INQUIRY_RATE_LIMIT = { count: 20, windowMs: 60 * 60 * 1000 };
const ADMIN_NOTIFY_LIMIT = { count: 15, windowMs: 10 * 60 * 1000 };
const ADMIN_MESSAGE_NOTIFY_LIMIT = { count: 20, windowMs: 10 * 60 * 1000 };
const MERGEABLE_INQUIRY_TYPES = ['general', 'question'];
const inquiryTimes = new Map();
const adminNotifyTimes = new Map();
const adminMuteNotices = new Map();

function messageKind(message) {
  if (!message) return 'text';
  if (message.text || (!message.photo && !message.video && !message.voice && !message.audio && !message.document && !message.location && !message.contact && !message.sticker)) return 'text';
  if (message.photo) return 'photo';
  if (message.video) return 'video';
  if (message.voice) return 'voice';
  if (message.audio) return 'audio';
  if (message.document) return 'document';
  if (message.location) return 'location';
  if (message.contact) return 'contact';
  if (message.sticker) return 'sticker';
  return 'other';
}

function messageFile(message, kind) {
  if (!message) return null;
  if (kind === 'photo') return Array.isArray(message.photo) ? message.photo[message.photo.length - 1] : null;
  return message[kind] && typeof message[kind] === 'object' ? message[kind] : null;
}

// Пустое значение — это «неизвестно», а не ноль: иначе заявка без исходного
// сообщения ломалась на попытке прочитать его номер.
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function inquiryTimelineMessage(message, direction = 'in', options = {}) {
  const kind = options.kind || messageKind(message);
  const file = messageFile(message, kind);
  const timestamp = Number(message && message.date) * 1000;
  const replied = message && message.reply_to_message;
  return {
    id: crypto.randomUUID(),
    direction: direction === 'out' ? 'out' : 'in',
    kind,
    text: cleanText(options.text != null ? options.text : messageSummary(message), 4000),
    fileId: cleanText(options.fileId != null ? options.fileId : file && file.file_id, 512),
    fileName: cleanText(options.fileName != null ? options.fileName : file && file.file_name, 200),
    mimeType: cleanText(options.mimeType != null ? options.mimeType : file && file.mime_type, 120),
    telegramMessageId: numberOrNull(options.telegramMessageId != null ? options.telegramMessageId : message && message.message_id),
    replyToTelegramMessageId: numberOrNull(options.replyToTelegramMessageId != null ? options.replyToTelegramMessageId : replied && replied.message_id),
    replyToText: cleanText(options.replyToText != null ? options.replyToText : replied && messageSummary(replied), 300),
    deliveryStatus: direction === 'out' ? (options.deliveryStatus === 'failed' ? 'failed' : 'delivered') : '',
    clientRequestId: cleanText(options.clientRequestId, 100),
    source: cleanText(options.source, 40),
    by: cleanText(options.by, 80),
    reactions: [],
    reactionUpdatedAt: '',
    createdAt: options.createdAt || (Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString()),
  };
}

function appendInquiryMessage(inquiry, message) {
  if (!inquiry || !message) return null;
  inquiry.messages = Array.isArray(inquiry.messages) ? inquiry.messages : [];
  inquiry.messages.push(message);
  inquiry.messages = inquiry.messages.slice(-MAX_INQUIRY_MESSAGES);
  return message;
}

// Ответ бота попадает в ту же ленту, что и ответы менеджера: иначе в панели
// видно только вопрос клиента и непонятно, ответили ему хоть что-нибудь.
// Пишем в последнюю открытую заявку клиента — ту, которую менеджер и читает.
function recordBotAnswer(user, text, options = {}) {
  const answer = cleanText(text, 4000);
  if (!user || !answer) return null;
  const inquiry = data.inquiries.filter((item) => String(item.userId) === String(user.id) && item.status !== 'closed').pop();
  if (!inquiry) return null;
  const message = appendInquiryMessage(inquiry, inquiryTimelineMessage(null, 'out', {
    text: answer,
    source: 'bot',
    by: 'бот',
    kind: 'text',
    createdAt: new Date().toISOString(),
    telegramMessageId: options.messageId || null,
  }));
  inquiry.updatedAt = new Date().toISOString();
  scheduleSave();
  return message;
}

// Sliding-window counter per key; returns false once the limit is reached.
function withinRateLimit(store, key, limit, now = Date.now()) {
  const times = (store.get(key) || []).filter((time) => now - time < limit.windowMs);
  const allowed = times.length < limit.count;
  if (allowed) times.push(now);
  store.set(key, times);
  return allowed;
}

// Closed inquiries are dropped first, so a flood of new messages cannot push
// out open requests from other clients.
//
// Раньше это происходило совсем молча: когда закрытых не хватало, под нож
// уходили и обращения в работе — клиент ждёт ответа, а его карточки в панели
// уже нет. Теперь бот считает, сколько живых обращений пришлось удалить, и
// сообщает об этом владельцу.
function trimInquiries() {
  let excess = data.inquiries.length - MAX_INQUIRIES;
  if (excess <= 0) return { removed: 0, open: 0 };
  const total = excess;
  const kept = [];
  for (let index = data.inquiries.length - 1; index >= 0; index -= 1) {
    const item = data.inquiries[index];
    if (excess > 0 && item.status === 'closed') {
      excess -= 1;
      continue;
    }
    kept.push(item);
  }
  kept.reverse();
  // Закрытых не хватило: дальше уходят самые старые из живых.
  const openRemoved = Math.max(0, excess);
  if (excess > 0) kept.length -= excess;
  data.inquiries = kept;
  if (openRemoved > 0) reportInquiryOverflow(openRemoved);
  return { removed: total, open: openRemoved };
}

// Сообщение владельцу — не чаще раза в сутки, чтобы поток обращений не
// превратился в поток предупреждений.
function reportInquiryOverflow(openRemoved, now = new Date()) {
  const today = localDayKey(now);
  // И запись в журнал — раз в сутки, вместе с сообщением. Журнал хранит сто
  // последних записей: обращение за обращением они вытесняли оттуда настоящие
  // сбои, в том числе «Сохранение данных» — единственный след того, что бот не
  // может писать на диск.
  if (data.lastInquiryOverflowFor === today) return;
  data.lastInquiryOverflowFor = today;
  recordError('Предел заявок', new Error('Список заявок упёрся в предел ' + MAX_INQUIRIES
    + ': удаляются самые старые заявки в работе (в этот раз — ' + openRemoved
    + '). Дальше за сегодня бот об этом не напоминает.'));
  scheduleSave();
  void sendStatusNotice([
    '⚠️ Заявок стало больше ' + MAX_INQUIRIES,
    '',
    'Место закончилось, и самые старые заявки в работе пришлось удалить: ' + openRemoved + '.',
    'Закройте отработанные заявки или очистите старые в панели: ' + PLACES.cleanup + '.',
    'Перед очисткой их можно выгрузить в Excel — там же, кнопкой «Выгрузить в Excel».',
  ].join('\n')).catch(() => {});
}

// Messages sent in a row go into the client's latest open inquiry instead of
// creating a new card each time. Past the rate limit every further message is
// merged, so one person cannot flood the inquiry list.
function mergeIntoLatestInquiry(user, text, type, context) {
  const latest = data.inquiries.find((item) => item.userId === String(user.id));
  if (!latest) return null;
  const combined = latest.text + '\n\n' + text;
  // A question to the manager and the free messages that follow it are one
  // conversation, so these two types continue each other. A free message
  // also continues any other open inquiry: "Yes, tomorrow is fine" after
  // the manager answered a callback request or a viewing.
  const continuation = MERGEABLE_INQUIRY_TYPES.includes(type)
    && !context.propertyId && !context.lead && !context.selection
    && ['new', 'in_progress'].includes(latest.status)
    && (type === 'general' || (MERGEABLE_INQUIRY_TYPES.includes(latest.type) && !latest.propertyId))
    && Date.now() - Date.parse(latest.updatedAt) < INQUIRY_MERGE_WINDOW_MS
    && combined.length <= 4000;
  // Only new inquiries count towards the limit.
  if (!continuation && withinRateLimit(inquiryTimes, String(user.id), INQUIRY_RATE_LIMIT)) return null;
  // Past the limit the text is kept only while it fits; every message is
  // still in the user's activity history.
  if (combined.length <= 4000) latest.text = combined;
  // A real message turns a search lead into a conversation that waits for an answer.
  if (!context.searchLead) latest.searchLead = false;
  latest.updatedAt = new Date().toISOString();
  latest.clientMessageAt = latest.updatedAt;
  if (context.sourceMessage && numberOrNull(context.sourceMessage.message_id) !== null) latest.sourceMessageId = Number(context.sourceMessage.message_id);
  appendInquiryMessage(latest, inquiryTimelineMessage(context.sourceMessage, 'in', { text, source: 'telegram', createdAt: latest.updatedAt }));
  if (latest.status === 'closed') latest.status = 'new';
  return latest;
}

// Photos, voice messages and files from the client are copied to the admin
// chat so the admin sees them. Messages sent by the bot itself (a property
// card behind a button the client pressed) are only referenced, not copied.
function isClientMedia(message) {
  return Boolean(message && !message.text && message.from && !message.from.is_bot);
}

// Inquiries that just received another message from the client. The client
// was already told that the message is with the manager, so the bot does not
// repeat it for every message sent in a row.
const mergedInquiries = new WeakSet();

function inquiryWasMerged(inquiry) {
  return Boolean(inquiry && mergedInquiries.has(inquiry));
}

// A form confirmation ("your request is sent") is not an acknowledgement of a
// free message: only the answer to a message counts, so a question right
// after a form is answered instead of silently merged.
function acknowledgesMessage(type, context) {
  return ['general', 'question'].includes(type) && !context.searchLead;
}

function createInquiry(user, text, context = {}) {
  const type = ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(context.type) ? context.type : 'general';
  recordBroadcastResponse(user, 'inquiry');
  const latest = data.inquiries.find((item) => item.userId === String(user.id));
  const acknowledgedAt = latest ? Date.parse(latest.acknowledgedAt || '') || 0 : 0;
  const merged = mergeIntoLatestInquiry(user, cleanText(text, 4000), type, context);
  if (merged) {
    // Messages in a row are acknowledged once; after a pause, or after a form
    // confirmation, the client hears again that the message was received.
    if (Date.now() - acknowledgedAt < INQUIRY_ACKNOWLEDGED_WINDOW_MS) mergedInquiries.add(merged);
    else {
      mergedInquiries.delete(merged);
      if (acknowledgesMessage(type, context)) merged.acknowledgedAt = new Date().toISOString();
    }
    scheduleSave();
    const notify = (copies) => notifyAdministrator(merged, user, { text: cleanText(text, 4000), title: 'Новое сообщение в заявке', repeated: true, replyTo: copies });
    if (isClientMedia(context.sourceMessage)) {
      void copyUserMessageToAdministrator(context.sourceMessage, data.config.botToken, merged)
        .then(notify)
        .catch((error) => recordError('Уведомление администратору', error));
    } else {
      void notify();
    }
    return merged;
  }
  const now = new Date().toISOString();
  const inquiry = {
    id: crypto.randomUUID(),
    userId: String(user.id),
    chatId: String(user.chatId),
    language: ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'ru',
    text: cleanText(text, 4000),
    type: ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(context.type) ? context.type : 'general',
    propertyId: cleanText(context.propertyId, 100),
    sourceMessageId: context.sourceMessage ? numberOrNull(context.sourceMessage.message_id) : null,
    lead: context.lead && typeof context.lead === 'object' ? {
      name: cleanText(context.lead.name, 120),
      phone: cleanText(context.lead.phone, 80),
      preferredTime: cleanText(context.lead.preferredTime, 160),
      method: ['call', 'whatsapp', 'telegram'].includes(context.lead.method) ? context.lead.method : 'call',
    } : null,
    selection: context.selection && typeof context.selection === 'object' ? {
      deal: cleanText(context.selection.deal, 200),
      type: cleanText(context.selection.type, 200),
      location: cleanText(context.selection.location, 200),
      budget: cleanText(context.selection.budget, 200),
      bedrooms: cleanText(context.selection.bedrooms, 200),
    } : null,
    matching: type === 'selection' ? normalizeSelectionMatching(context.matching) : null,
    viewing: type === 'viewing' ? normalizeViewing(context.viewing || {}) : null,
    // A viewing booked into a free slot is confirmed from the start.
    status: context.status === 'in_progress' ? 'in_progress' : 'new',
    pipelineStage: normalizePipelineStage('', { type, status: context.status === 'in_progress' ? 'in_progress' : 'new' }),
    note: '',
    replies: [],
    messages: [inquiryTimelineMessage(context.sourceMessage, 'in', { text: cleanText(text, 4000), source: 'telegram', createdAt: now })],
    readAt: '',
    acknowledgedAt: acknowledgesMessage(type, context) ? now : '',
    searchLead: context.searchLead === true,
    createdAt: now,
    updatedAt: now,
    clientMessageAt: now,
  };
  data.inquiries.unshift(inquiry);
  trimInquiries();
  recordDaily('inquiry');
  scheduleSave();
  if (isClientMedia(context.sourceMessage)) {
    void copyUserMessageToAdministrator(context.sourceMessage, data.config.botToken, inquiry)
      .then((copies) => notifyAdministrator(inquiry, user, { replyTo: copies }))
      .catch((error) => recordError('Уведомление администратору', error));
  } else {
    void notifyAdministrator(inquiry, user, inquiry.searchLead ? { title: 'Запрос клиента' } : {});
  }
  return inquiry;
}

const INQUIRY_TYPE_LABELS = {
  question: 'вопрос по объекту',
  interest: 'интерес к объекту',
  selection: 'подбор объекта',
  viewing: 'запись на просмотр',
  lead: 'заявка на звонок',
  general: 'сообщение',
};

// Whose turn it is: a new inquiry nobody has taken, or one where the client
// wrote after the last answer. One taken "In progress" without an answer in
// the chat (the manager calls) is not waiting.
function awaitingReply(inquiry) {
  if (!inquiry || inquiry.status === 'closed') return false;
  // The client searched on their own and got the catalog: nobody is waiting.
  if (inquiry.searchLead) return false;
  const replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
  if (!replies.length) {
    if (inquiry.status === 'new') return true;
    // «⏳ В работу» значит «я взял», а не «я ответил»: пока ответа не было,
    // клиент всё ещё ждёт. Исключение — просмотр, записанный в свободное окно:
    // он подтверждён сразу, и ответа от менеджера никто не ждёт.
    const confirmedViewing = Boolean(inquiry.viewing && inquiry.viewing.confirmedAt);
    const clientWrote = (Array.isArray(inquiry.messages) ? inquiry.messages : []).some((message) => message.direction === 'in');
    return inquiry.status === 'in_progress' && clientWrote && !confirmedViewing;
  }
  const lastReply = Math.max(...replies.map((reply) => Date.parse(reply.createdAt) || 0));
  return (Date.parse(inquiry.clientMessageAt || inquiry.createdAt) || 0) > lastReply;
}

// Состояние заявки одной строкой — внизу карточки, у каждого менеджера одно и то же: кто взял, кто ответил, ждёт ли клиент.
function stateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
}

function inquiryStateLine(inquiry) {
  if (!inquiry) return '';
  if (inquiry.status === 'closed') return '✔️ Закрыта';
  const replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
  const last = replies[replies.length - 1];
  const owner = inquiry.assignee ? ' · ведёт: ' + inquiry.assignee : '';
  if (awaitingReply(inquiry)) {
    if (last) return '🆕 Клиент написал снова, ' + stateTime(inquiry.clientMessageAt) + owner;
    if (inquiry.assignee) return '⏳ Ведёт: ' + inquiry.assignee + (inquiry.takenAt ? ', с ' + stateTime(inquiry.takenAt) : '') + ' — клиент ждёт ответа';
    return '🆕 Ждёт ответа';
  }
  if (last) return '💬 Ответ: ' + (last.by || 'менеджер') + ', ' + stateTime(last.createdAt) + (inquiry.assignee && inquiry.assignee !== last.by ? owner : '');
  if (inquiry.assignee) return '⏳ Ведёт: ' + inquiry.assignee + (inquiry.takenAt ? ', с ' + stateTime(inquiry.takenAt) : '');
  return '';
}

function cardWithState(base, inquiry) {
  const state = inquiryStateLine(inquiry);
  return state ? base + '\n\n' + state : base;
}

// Карточка заявки у всех: после «В работу», ответа или закрытия строка состояния меняется во всех чатах сразу, а не только
// кнопки у нажавшего. Тексты карточек лежат в adminReplyTargets (поле card); более старые карточки без него остаются как были.
async function refreshInquiryCards(inquiry, token = data.config.botToken) {
  if (!inquiry || !token || !data.adminReplyTargets) return 0;
  const cards = Object.entries(data.adminReplyTargets)
    .filter(([, target]) => target.inquiryId === inquiry.id && target.card)
    .sort((a, b) => (Date.parse(b[1].createdAt) || 0) - (Date.parse(a[1].createdAt) || 0))
    .slice(0, 12);
  let edited = 0;
  for (const [key, target] of cards) {
    const index = key.lastIndexOf(':');
    const chatId = index >= 0 ? key.slice(0, index) : cleanText(data.config.adminChatId, 40);
    const messageId = Number(index >= 0 ? key.slice(index + 1) : key);
    if (!adminChatFor(chatId) || !Number.isFinite(messageId)) continue;
    try {
      const markup = inquiryStatusMarkup(inquiry);
      await telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: cardWithState(target.card, inquiry), ...(markup ? { reply_markup: markup } : {}) });
      edited += 1;
    } catch {
      // Сообщение удалено или слишком старое — остальные всё равно обновляем.
    }
  }
  return edited;
}

function inquiryTypeLabel(inquiry) {
  if (inquiry.searchLead) return 'искал объекты сам';
  if (inquiry.type === 'question' && !inquiry.propertyId) return 'вопрос менеджеру';
  return INQUIRY_TYPE_LABELS[inquiry.type] || 'сообщение';
}

const INQUIRY_STATUS_LABELS = { new: 'ждёт ответа', in_progress: 'в работе', closed: 'закрыта' };

// Buttons under an inquiry notification let the admin keep statuses from
// Telegram, without opening the panel.
function inquiryStatusMarkup(inquiry) {
  if (!inquiry) return null;
  if (inquiry.status === 'closed') return { inline_keyboard: [[{ text: '↩️ Открыть снова', callback_data: 'inq:new:' + inquiry.id }]] };
  const rows = [];
  // A viewing request is confirmed with the date and time the client chose;
  // another date is set in the panel.
  if (inquiry.type === 'viewing' && !(inquiry.viewing && inquiry.viewing.confirmedAt)) {
    rows.push([{ text: '✅ Подтвердить просмотр', callback_data: 'inq:confirm:' + inquiry.id }]);
  }
  const row = [];
  // «В работу» нужна, чтобы коллеги видели, кто ведёт заявку; у одиночки она только глушит напоминание — кнопки нет.
  if (inquiry.status !== 'in_progress' && inquiryChats().length >= 2) row.push({ text: '⏳ В работу', callback_data: 'inq:in_progress:' + inquiry.id });
  row.push({ text: '✔️ Закрыть', callback_data: 'inq:closed:' + inquiry.id });
  rows.push(row);
  const planned = inquiry.followUpDate && !inquiry.followUpNotifiedAt ? ' (' + inquiry.followUpDate.split('-').reverse().slice(0, 2).join('.') + ')' : '';
  rows.push([{ text: planned ? '📌 Напомню' + planned : '📌 Напомнить завтра', callback_data: 'inq:follow:' + inquiry.id }]);
  return { inline_keyboard: rows };
}

// "Remind me tomorrow": the next working day when office hours are set.
function nextFollowUpDate(now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const opening = nextOpening(tomorrow);
  return localDayKey(opening || tomorrow);
}

// The chats that get client inquiries: the main admin first, then the
// managers. Digests, reports, login codes and backups go to the main admin
// only.
function inquiryChats() {
  const main = cleanText(data.config.adminChatId, 40);
  const chats = main ? [{ chatId: main, name: cleanText(data.config.adminName, 60) || 'Администратор', main: true }] : [];
  for (const manager of Array.isArray(data.config.managers) ? data.config.managers : []) {
    if (manager && manager.chatId && manager.chatId !== main) chats.push({ chatId: String(manager.chatId), name: manager.name, main: false, manager });
  }
  return chats;
}

function adminChatFor(chatId) {
  return inquiryChats().find((chat) => chat.chatId === String(chatId)) || null;
}

// Message ids are counted per chat: the main admin's keys stay plain numbers
// (as before managers existed), a manager's are "<chat id>:<message id>".
function replyTargetKey(chatId, messageId) {
  return String(chatId) === cleanText(data.config.adminChatId, 40) ? String(messageId) : String(chatId) + ':' + String(messageId);
}

// Only buttons in the admin's or a manager's chat may act on inquiries.
function adminCallbackAllowed(query) {
  const chatId = query && query.message && query.message.chat ? String(query.message.chat.id) : '';
  return Boolean(chatId && adminChatFor(chatId));
}

async function handleInquiryStatusCallback(query, token) {
  const chatId = query.message && query.message.chat ? String(query.message.chat.id) : '';
  if (!adminCallbackAllowed(query)) {
    await acknowledgeCallback(query, token, INTERACTION_TEXT.ru.stale);
    return;
  }
  const pressedBy = adminChatFor(chatId);
  const [, status, ...rest] = String(query.data || '').split(':');
  const inquiry = data.inquiries.find((item) => item.id === rest.join(':'));
  if (!inquiry || (!Object.hasOwn(INQUIRY_STATUS_LABELS, status) && !['follow', 'take', 'keep'].includes(status))) {
    await acknowledgeCallback(query, token, 'Заявка не найдена — возможно, она удалена.');
    return;
  }
  // «Оставить»: менеджер передумал забирать заявку — вопрос убираем.
  if (status === 'keep') {
    await acknowledgeCallback(query, token);
    await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    return;
  }
  // Заявку уже ведёт другой менеджер: молча забирать нельзя — сначала спросим, а прежнему сообщим, если заберут.
  if (status === 'in_progress' && inquiry.status === 'in_progress' && inquiry.assignee && inquiry.assignee !== pressedBy.name) {
    await acknowledgeCallback(query, token, 'Заявку ведёт ' + inquiry.assignee);
    await sendMessage(chatId, '👤 Заявку ведёт ' + inquiry.assignee + '. Забрать себе?', token, {
      track: false,
      reply_markup: { inline_keyboard: [[{ text: 'Забрать себе', callback_data: 'inq:take:' + inquiry.id }, { text: 'Оставить', callback_data: 'inq:keep:' + inquiry.id }]] },
    }).catch(() => {});
    return;
  }
  if (status === 'take') {
    const previous = inquiry.assignee;
    inquiry.assignee = pressedBy.name;
    if (inquiry.status !== 'closed') inquiry.status = 'in_progress';
    inquiry.takenAt = new Date().toISOString();
    inquiry.updatedAt = inquiry.takenAt;
    saveDataNow();
    await acknowledgeCallback(query, token, 'Заявка ваша');
    await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    const former = previous && previous !== pressedBy.name ? inquiryChats().find((chat) => chat.name === previous) : null;
    if (former) {
      const owner = userById(inquiry.userId) || userByChatId(inquiry.chatId);
      const who = owner ? [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'клиент' : 'клиент';
      await sendMessage(former.chatId, '👤 ' + pressedBy.name + ' забрал(а) заявку: ' + inquiryTypeLabel(inquiry) + ' — ' + who + '.', token, { track: false }).catch(() => {});
    }
    await refreshInquiryCards(inquiry, token);
    return;
  }
  if (status === 'follow') {
    inquiry.followUpDate = nextFollowUpDate();
    inquiry.followUpTime = '';
    inquiry.followUpNotifiedAt = '';
    if (inquiry.status === 'new') inquiry.status = 'in_progress';
    if (!inquiry.assignee) inquiry.assignee = pressedBy.name;
  } else {
    inquiry.status = status;
    // "In progress" means "I take it".
    if (status === 'in_progress') {
      inquiry.assignee = pressedBy.name;
      inquiry.takenAt = new Date().toISOString();
    }
    // «Открыть снова» на выигранном или проигранном деле снимает этот итог,
    // иначе заявка открыта, а этап всё ещё «Выиграно».
    if (status !== 'closed' && ['won', 'lost'].includes(inquiry.pipelineStage)) {
      inquiry.pipelineStage = status === 'new' ? 'new' : 'contact';
      inquiry.wonAt = '';
    }
  }
  inquiry.updatedAt = new Date().toISOString();
  saveDataNow();
  const taken = inquiryChats().length > 1 && inquiry.assignee ? ' · взял(а): ' + inquiry.assignee : '';
  await acknowledgeCallback(query, token, status === 'follow'
    ? 'Напомню ' + inquiry.followUpDate.split('-').reverse().join('.') + ' в начале рабочего дня'
    : 'Статус: ' + INQUIRY_STATUS_LABELS[status] + (status === 'in_progress' ? taken : ''));
  try {
    await telegramRequest(token, 'editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: inquiryStatusMarkup(inquiry),
    });
  } catch {
    // The status is saved even if Telegram no longer allows editing the buttons.
  }
  await refreshInquiryCards(inquiry, token);
}

// Navigation notices repeat what is already in the title ("Opened «Offers»"
// + "🔥 Offers") or show a bare command; those details are left out.
function detailsWorthShowing(title, details) {
  if (!details || details.startsWith('/')) return false;
  const plain = details.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return !plain || !String(title).includes(plain);
}

// 'send', a one-time 'notice' that the user is muted, or 'drop'.
// Navigation (opened a section, looked at photos) and messages have separate
// budgets: a client who simply browses the catalog must never use up the
// budget of their own inquiries. Extra navigation is dropped quietly; only
// too many messages are reported as a flood.
function adminNotificationDecision(user, important) {
  const key = String(user.id) + (important ? ':messages' : ':activity');
  const limit = important ? ADMIN_MESSAGE_NOTIFY_LIMIT : ADMIN_NOTIFY_LIMIT;
  if (withinRateLimit(adminNotifyTimes, key, limit)) return 'send';
  if (!important) return 'drop';
  const noticeSentAt = adminMuteNotices.get(key) || 0;
  if (Date.now() - noticeSentAt < limit.windowMs) return 'drop';
  adminMuteNotices.set(key, Date.now());
  return 'notice';
}

// --- Карточка заявки: один сборщик на уведомление, напоминание и /inbox ---------------------------------------------------
const LANGUAGE_WORDS = { en: 'по-английски', es: 'по-испански' };
const REPLY_HINT = '↩️ Ответьте на это сообщение — ответ получит клиент.';

function clientWho(user) {
  if (!user) return '👤 Клиент удалён';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';
  return '👤 ' + name + (user.username ? ' (@' + user.username + ')' : '') + (user.source ? ' · 📣 ' + user.source : '') + (user.goal ? ' · 🎯 ' + goalLabelRu(user.goal) : '');
}

// Объект — по-русски, как всё остальное для менеджера.
function inquiryPropertyLine(inquiry) {
  const property = inquiry && inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  return property ? '🔖 ' + (localized(property.title, 'ru') || property.reference || property.id) : '';
}

// Текст заявки без повторов: объект уже показан строкой, а имя и телефон анкеты — в шапке карточки.
function inquiryBody(inquiry, text = inquiry && inquiry.text) {
  let body = String(text || '');
  const property = inquiry && inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  if (property) {
    for (const type of ['question', 'viewing', 'interest']) {
      // Текст заявки теперь по-русски; у прежних заявок приставка на языке клиента — убираем обе.
      for (const wording of ['ru', inquiry.language]) {
        const prefix = propertyRequestText(property, wording, type);
        if (body.startsWith(prefix)) body = body.slice(prefix.length).trim();
      }
    }
  }
  if (inquiry && inquiry.type === 'lead') body = body.split('\n').filter((line) => !/^(Имя|Телефон): /.test(line)).join('\n');
  return body.trim();
}

// Шапка, кто, язык («Клиент пишет по-испански»), телефон, число прежних заявок, тело и — только на первой карточке клиента —
// подсказка «Ответьте на это сообщение».
function buildInquiryCard(user, inquiry, { heading, body = [], hint = false } = {}) {
  const language = (inquiry && inquiry.language) || (user && user.preferredLanguage) || '';
  const lines = [heading, clientWho(user)];
  if (LANGUAGE_WORDS[language]) lines.push('🌐 Клиент пишет ' + LANGUAGE_WORDS[language]);
  if (user && user.phone) lines.push('📞 ' + cleanText(user.phone, 40));
  const earlier = user ? data.inquiries.filter((item) => item.userId === String(user.id) && (!inquiry || item.id !== inquiry.id)).length : 0;
  if (earlier) lines.push('🗂 Заявок раньше: ' + earlier);
  lines.push('', ...body.filter((line) => line !== undefined && line !== null && line !== false));
  if (hint) lines.push('', REPLY_HINT);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Номер сообщения-карточки этой заявки в чате — чтобы повторные сообщения клиента шли ответом на неё.
function inquiryCardMessageId(inquiry, chatId) {
  const entries = Object.entries(data.adminReplyTargets || {})
    .filter(([key, target]) => target.inquiryId === inquiry.id && target.card && (String(chatId) === cleanText(data.config.adminChatId, 40) ? !key.includes(':') : key.startsWith(String(chatId) + ':')))
    .sort((a, b) => (Date.parse(a[1].createdAt) || 0) - (Date.parse(b[1].createdAt) || 0));
  if (!entries.length) return null;
  const id = Number(entries[0][0].split(':').pop());
  return Number.isFinite(id) ? id : null;
}

async function notifyAdministratorAction(user, title, details = '', inquiryId = '', sourceMessageId = null, options = {}) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken || !user || !user.chatId || adminChatFor(user.chatId)) return false;
  if (data.config.notifyMode === 'inquiries' && !options.important) return false;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';
  const username = user.username ? ' (@' + user.username + ')' : '';
  const decision = adminNotificationDecision(user, Boolean(options.important));
  if (decision === 'drop') return false;
  if (decision === 'notice') {
    await sendMessage(adminChatId, '⚠️ ' + name + username + ' (ID ' + user.id + ') присылает слишком много сообщений. Уведомления о новых сообщениях этого клиента приостановлены на ' + Math.round(ADMIN_MESSAGE_NOTIFY_LIMIT.windowMs / 60000) + ' минут. Все сообщения сохраняются в панели.', data.config.botToken, { track: false }).catch((error) => recordError('Уведомление администратору', error));
    return false;
  }
  // Routing of replies does not depend on this text (see adminReplyTargets),
  // so it only carries what a person needs to read.
  const who = clientWho(user);
  const cleanDetails = cleanText(details, 4000);
  const inquiry = options.important && inquiryId ? data.inquiries.find((item) => item.id === inquiryId) : null;
  // A manager calling back needs the number without opening the panel; past
  // inquiries tell a returning client from a new one.
  // Повторное сообщение клиента в той же заявке — не новая карточка с кнопками, а короткий ответ на первую.
  const compact = Boolean(options.compact && inquiry);
  let text;
  if (compact) text = '💬 ' + ([user.firstName, user.lastName].filter(Boolean).join(' ') || 'Клиент') + ': ' + cleanDetails;
  else if (options.important) text = buildInquiryCard(user, inquiry, { heading: '📩 ' + cleanText(title, 160), body: [cleanDetails], hint: Boolean(options.first) });
  else text = ['👀 ' + cleanText(title, 160), who, ...(detailsWorthShowing(title, cleanDetails) ? ['', cleanDetails] : [])].filter((line, index, lines) => !(line === '' && lines[index - 1] === '')).join('\n').trim();
  // Inquiries go to every manager; navigation only to the main admin.
  const chats = options.important ? inquiryChats() : inquiryChats().filter((chat) => chat.main);
  const shownText = inquiry && !compact ? cardWithState(text, inquiry) : text;
  let delivered = false;
  for (const chat of chats) {
    try {
      const messageIds = [];
      const markup = compact ? null : inquiryStatusMarkup(inquiry);
      const replyTo = (options.replyTo instanceof Map ? options.replyTo.get(String(chat.chatId)) : null) || (compact ? inquiryCardMessageId(inquiry, chat.chatId) : null);
      await sendMessage(chat.chatId, shownText, data.config.botToken, {
        track: false,
        messageIds,
        ...adminSendPlan('inquiry').options,
        ...(markup ? { reply_markup: markup } : {}),
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
      rememberAdminReplyTarget(messageIds, { chatId: user.chatId, inquiryId, sourceMessageId, card: inquiry && !compact ? text : '' }, chat.chatId);
      delivered = true;
      markAdminChatVerified(chat, true);
    } catch (error) {
      // Only a refusal from Telegram (wrong chat, bot blocked) means the chat
      // is misconfigured; a network hiccup says nothing about it.
      if ([400, 403].includes(Number(error && error.telegramCode))) markAdminChatVerified(chat, false);
      recordError(chat.main ? 'Уведомление администратору' : 'Уведомление менеджеру ' + chat.name, error);
    }
  }
  return delivered;
}

function markAdminChatVerified(chat, verified) {
  const now = new Date().toISOString();
  if (chat.main) {
    if (verified && data.config.adminNotificationVerifiedAt) return;
    data.config.adminNotificationVerifiedAt = verified ? now : '';
  } else {
    if (verified && chat.manager.verifiedAt) return;
    chat.manager.verifiedAt = verified ? now : '';
  }
  scheduleSave();
}

async function notifyAdministrator(inquiry, user, options = {}) {
  const matchingAttention = selectionMatchingAttention(inquiry);
  const repeated = options.repeated === true;
  // Первое сообщение заявки — карточка со всем нужным; следующие сообщения клиента в ней — коротко, ответом на неё.
  return notifyAdministratorAction(user, (options.title || 'Новая заявка') + ': ' + inquiryTypeLabel(inquiry), repeated
    ? cleanText(options.text || inquiry.text, 4000)
    : [inquiryPropertyLine(inquiry), inquiryBody(inquiry, options.text || inquiry.text), matchingAttention].filter(Boolean).join('\n'),
  inquiry.id, inquiry.sourceMessageId, { important: true, replyTo: options.replyTo, compact: repeated, first: !repeated });
}

function selectionMatchingAttention(inquiry) {
  const results = inquiry && inquiry.matching && Array.isArray(inquiry.matching.results) ? inquiry.matching.results : [];
  const rows = [];
  for (const result of results) {
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const missing = [];
    if (warnings.includes('priceMissing')) missing.push('цена');
    if (warnings.includes('bedroomsMissing')) missing.push('спальни');
    if (!missing.length) continue;
    const record = data.objects.find((item) => String(item.id) === String(result.id));
    const title = record ? localized(record.title, 'ru') || record.reference || record.id : 'Объект ' + result.id;
    rows.push('• ' + cleanText(title, 100) + ': ' + missing.join(', '));
  }
  if (!rows.length) return '';
  const more = rows.length > 5 ? '\n• ещё ' + (rows.length - 5) : '';
  return '⚠️ В карточках нужно уточнить данные:\n' + rows.slice(0, 5).join('\n') + more;
}

// Returns the copies by admin chat, so the notification can be a reply to
// the photo or voice message it is about.
async function copyUserMessageToAdministrator(message, token, inquiry = null) {
  const copies = new Map();
  if (!message || !message.chat || adminChatFor(message.chat.id)) return copies;
  // Альбом уходит менеджеру одним запросом и приходит альбомом же: иначе это
  // десять отдельных сообщений подряд, а у Telegram есть предел на чат.
  const album = Array.isArray(message.albumMessageIds) ? message.albumMessageIds : [];
  for (const chat of inquiryChats()) {
    try {
      if (album.length) {
        const all = [message.message_id, ...album];
        let copiedAlbum = null;
        try {
          copiedAlbum = await telegramRequest(token, 'copyMessages', { chat_id: chat.chatId, from_chat_id: message.chat.id, message_ids: all, ...adminSendPlan('inquiry').options });
        } catch (error) {
          // Старый Telegram не знает копирования пачкой: копируем по одному,
          // чтобы менеджер всё-таки увидел все снимки.
          recordError('Копирование альбома', error);
          copiedAlbum = [];
          for (const id of all) {
            const one = await telegramRequest(token, 'copyMessage', { chat_id: chat.chatId, from_chat_id: message.chat.id, message_id: id, ...adminSendPlan('inquiry').options }).catch(() => null);
            if (one) copiedAlbum.push(one);
          }
        }
        const ids = (Array.isArray(copiedAlbum) ? copiedAlbum : [])
          .map((item) => Number(item && item.message_id))
          .filter((id) => Number.isFinite(id));
        if (ids.length) {
          rememberAdminReplyTarget(ids, {
            chatId: message.chat.id,
            inquiryId: inquiry ? inquiry.id : '',
            sourceMessageId: message.message_id,
          }, chat.chatId);
          copies.set(String(chat.chatId), ids[ids.length - 1]);
        }
        continue;
      }
      const copied = await telegramRequest(token, 'copyMessage', {
        chat_id: chat.chatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
        ...adminSendPlan('inquiry').options,
      });
      // Replying directly to the copied photo or voice message works too.
      if (copied && Number.isFinite(Number(copied.message_id))) {
        rememberAdminReplyTarget([Number(copied.message_id)], {
          chatId: message.chat.id,
          inquiryId: inquiry ? inquiry.id : '',
          sourceMessageId: message.message_id,
        }, chat.chatId);
        copies.set(String(chat.chatId), Number(copied.message_id));
      }
    } catch (error) {
      recordError('Копирование сообщения ' + (chat.main ? 'администратору' : 'менеджеру ' + chat.name), error);
    }
  }
  return copies;
}

// Служебные сообщения Telegram: клиент закрепил сообщение, включил таймер
// автоудаления, поделился контактом кнопкой, в группе кто-то вошёл или вышел.
// Это не сообщение клиента — обращения из такого быть не должно. Перечислены
// именно служебные поля, а не наоборот: новый вид вложения от Telegram лучше
// покажем менеджеру как «нетекстовое сообщение», чем молча выбросим.
const SERVICE_MESSAGE_FIELDS = [
  'pinned_message', 'message_auto_delete_timer_changed', 'write_access_allowed',
  'users_shared', 'chat_shared', 'connected_website', 'passport_data',
  'proximity_alert_triggered', 'boost_added', 'chat_background_set',
  'successful_payment', 'refunded_payment', 'web_app_data',
  'new_chat_members', 'left_chat_member', 'new_chat_title', 'new_chat_photo',
  'delete_chat_photo', 'group_chat_created', 'supergroup_chat_created',
  'channel_chat_created', 'migrate_to_chat_id', 'migrate_from_chat_id',
  'forum_topic_created', 'forum_topic_edited', 'forum_topic_closed',
  'forum_topic_reopened', 'general_forum_topic_hidden', 'general_forum_topic_unhidden',
  'giveaway_created', 'giveaway_winners', 'giveaway_completed',
  'video_chat_scheduled', 'video_chat_started', 'video_chat_ended',
  'video_chat_participants_invited',
];

function serviceMessage(message) {
  if (!message || typeof message !== 'object') return false;
  return SERVICE_MESSAGE_FIELDS.some((field) => message[field] !== undefined);
}

function messageSummary(message) {
  if (!message) return 'Сообщение';
  if (message.text) return cleanText(message.text, 4000);
  // Альбом: подпись есть только у одного снимка, остальное — «ещё N файлов».
  const albumCount = Array.isArray(message.albumMessageIds) ? message.albumMessageIds.length + 1 : 0;
  if (albumCount > 1) {
    const kind = message.video ? 'файлов' : 'фотографий';
    const title = 'Альбом, ' + kind + ': ' + albumCount;
    return message.caption ? title + '\n' + cleanText(message.caption, 4000) : title;
  }
  if (message.caption) return cleanText(message.caption, 4000);
  if (message.photo) return 'Фотография';
  if (message.video) return 'Видео';
  if (message.voice) return 'Голосовое сообщение';
  if (message.audio) return 'Аудиофайл';
  if (message.document) return 'Документ' + (message.document.file_name ? ': ' + cleanText(message.document.file_name, 160) : '');
  if (message.location) return 'Геолокация';
  if (message.contact) return 'Контакт';
  if (message.sticker) return 'Стикер';
  return 'Нетекстовое сообщение';
}

function reactionInfo(reaction) {
  if (!reaction || typeof reaction !== 'object') return null;
  if (reaction.type === 'emoji' && reaction.emoji) {
    return { key: 'emoji:' + reaction.emoji, label: cleanText(reaction.emoji, 20) };
  }
  if (reaction.type === 'custom_emoji' && reaction.custom_emoji_id) {
    return { key: 'custom:' + reaction.custom_emoji_id, label: '✦ пользовательский эмодзи' };
  }
  if (reaction.type === 'paid') return { key: 'paid', label: '⭐' };
  return null;
}

async function handleMessageReaction(change) {
  if (!change || !change.chat || !change.user) return;
  // Реакция в группе или канале — не реакция клиента на наше сообщение ему.
  if (change.chat.type && change.chat.type !== 'private') return;
  const user = normalizeUser(change.user, change.chat.id, false);
  const oldItems = (Array.isArray(change.old_reaction) ? change.old_reaction : []).map(reactionInfo).filter(Boolean);
  const newItems = (Array.isArray(change.new_reaction) ? change.new_reaction : []).map(reactionInfo).filter(Boolean);
  const oldKeys = new Set(oldItems.map((item) => item.key));
  const newKeys = new Set(newItems.map((item) => item.key));
  const added = newItems.filter((item) => !oldKeys.has(item.key));
  const removed = oldItems.filter((item) => !newKeys.has(item.key));
  if (!added.length && !removed.length) return;

  user.activity = Array.isArray(user.activity) ? user.activity : [];
  const target = [...user.activity].reverse().find((entry) => entry.direction === 'out' && (
    Number(entry.messageId) === Number(change.message_id) ||
    (Array.isArray(entry.messageIds) && entry.messageIds.some((messageId) => Number(messageId) === Number(change.message_id)))
  ));
  if (target) {
    target.reactions = newItems.map((item) => item.label);
    target.reactionUpdatedAt = new Date(Number(change.date || 0) * 1000 || Date.now()).toISOString();
  }

  for (const inquiry of data.inquiries) {
    if (String(inquiry.userId) !== String(user.id)) continue;
    const conversationMessage = [...(Array.isArray(inquiry.messages) ? inquiry.messages : [])].reverse().find((entry) => entry.direction === 'out' && Number(entry.telegramMessageId) === Number(change.message_id));
    if (!conversationMessage) continue;
    conversationMessage.reactions = newItems.map((item) => item.label);
    conversationMessage.reactionUpdatedAt = new Date(Number(change.date || 0) * 1000 || Date.now()).toISOString();
    break;
  }

  let reactionAction = 'changed';
  let actionText;
  if (added.length && removed.length) {
    actionText = 'Изменил реакцию: ' + removed.map((item) => item.label).join(' ') + ' → ' + added.map((item) => item.label).join(' ');
  } else if (added.length) {
    reactionAction = 'added';
    actionText = 'Поставил реакцию ' + added.map((item) => item.label).join(' ');
  } else {
    reactionAction = 'removed';
    actionText = 'Убрал реакцию ' + removed.map((item) => item.label).join(' ');
  }
  const targetText = target && target.text ? target.text : 'Сообщение №' + String(change.message_id);
  recordActivity(user, 'in', actionText, 'reaction', {
    targetMessageId: change.message_id,
    reactions: newItems.map((item) => item.label),
    reactionAction,
    targetText,
  });
  if (added.length) {
    data.stats.reactionsReceived = Number(data.stats.reactionsReceived || 0) + added.length;
    recordDaily('reaction', '', added.length);
  }
  data.stats.lastUpdateAt = new Date().toISOString();
  scheduleSave();
  void notifyAdministratorAction(user, actionText, 'На сообщение: ' + targetText);
}

const ADMIN_REPLY_TARGET_LIMIT = 3000;
const LEGACY_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Every message the bot puts into the admin chat on behalf of a user is
// recorded here: admin chat message id -> the user it belongs to. Replies are
// routed only by this map, never by the message text, because the text
// contains the user's own name and message and can be forged.
function rememberAdminReplyTarget(messageIds, target, adminChatId = data.config.adminChatId) {
  if (!target || target.chatId == null || !messageIds.length) return;
  if (!data.adminReplyTargets || typeof data.adminReplyTargets !== 'object') data.adminReplyTargets = {};
  for (const messageId of messageIds) {
    data.adminReplyTargets[replyTargetKey(adminChatId, messageId)] = {
      chatId: String(target.chatId),
      inquiryId: cleanText(target.inquiryId, 100),
      sourceMessageId: Number.isFinite(Number(target.sourceMessageId)) && target.sourceMessageId != null ? Number(target.sourceMessageId) : null,
      createdAt: new Date().toISOString(),
      ...(target.card ? { card: cleanText(target.card, 1500) } : {}),
    };
  }
  const keys = Object.keys(data.adminReplyTargets);
  if (keys.length > ADMIN_REPLY_TARGET_LIMIT) {
    const createdAt = (key) => Date.parse(data.adminReplyTargets[key].createdAt) || 0;
    keys.sort((a, b) => createdAt(a) - createdAt(b) || Number(a.split(':').pop()) - Number(b.split(':').pop()));
    for (const key of keys.slice(0, keys.length - ADMIN_REPLY_TARGET_LIMIT)) delete data.adminReplyTargets[key];
  }
  scheduleSave();
}

// Notifications sent by older versions are not in the map. For a short
// transition period they are still parsed, taking the last marker, which the
// bot itself appends after the user's text.
function legacyAdministratorReplyTarget(replied) {
  const since = Date.parse(data.adminReplyTargetsSince || '');
  const sentAt = Number(replied.date) * 1000;
  if (!Number.isFinite(since) || !(sentAt < since) || Date.now() - since > LEGACY_REPLY_WINDOW_MS) return null;
  const source = String(replied.text || replied.caption || '');
  const last = (pattern) => {
    const matches = Array.from(source.matchAll(pattern));
    return matches.length ? matches[matches.length - 1][1] : '';
  };
  const chatId = last(/Получатель ID:\s*(-?\d{4,20})/g);
  if (!chatId) return null;
  const sourceMessageId = last(/Сообщение пользователя ID:\s*(\d{1,20})/g);
  return {
    chatId,
    inquiryId: last(/Обращение ID:\s*([A-Za-z0-9-]{8,100})/g),
    sourceMessageId: sourceMessageId ? Number(sourceMessageId) : null,
  };
}

function administratorReplyTarget(message) {
  const replied = message && message.reply_to_message;
  if (!replied) return null;
  if (data.bot.id && replied.from && Number(replied.from.id) !== Number(data.bot.id)) return null;
  const key = replyTargetKey(message.chat.id, replied.message_id);
  const targets = data.adminReplyTargets || {};
  if (Object.hasOwn(targets, key)) {
    const stored = targets[key];
    return { chatId: stored.chatId, inquiryId: stored.inquiryId || '', sourceMessageId: stored.sourceMessageId };
  }
  return adminChatFor(message.chat.id) && adminChatFor(message.chat.id).main ? legacyAdministratorReplyTarget(replied) : null;
}

function looksLikeUserNotification(message) {
  const replied = message && message.reply_to_message;
  if (!replied) return false;
  if (data.bot.id && replied.from) return Number(replied.from.id) === Number(data.bot.id);
  return /Получатель ID:/.test(String(replied.text || replied.caption || ''));
}

// Понятная причина вместо сырой ошибки Telegram: что случилось и что делать. Сама ошибка — в журнал (recordError).
function humanSendError(error, user) {
  if (user && userUnavailableError(error)) {
    return 'Клиент заблокировал бота — сообщение не доставлено.' + (user.phone ? ' Позвоните: ' + user.phone : ' Телефона у клиента нет — только панель.');
  }
  if (Number(error && error.telegramCode) === 429) return 'Telegram просит подождать — сообщение не отправлено. Повторите через минуту.';
  return 'Сообщение не доставлено. Повторите позже; подробности — в «' + PLACES.dataCopies + '».';
}

// Подтверждение ответа: реакция 👌 на сообщение менеджера, а не ещё одно сообщение в чате. Если реакцию поставить нельзя —
// короткая строка.
async function confirmStaffMessage(message, token, name) {
  try {
    await telegramRequest(token, 'setMessageReaction', { chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: 'emoji', emoji: '👌' }] });
  } catch {
    await sendMessage(message.chat.id, '✅ Отправлено' + (name ? ': ' + name : ''), token, { track: false }).catch(() => {});
  }
}

async function handleAdministratorReply(message, token) {
  const adminChat = message && message.chat ? adminChatFor(message.chat.id) : null;
  if (!adminChat) return false;
  const adminChatId = adminChat.chatId;
  const target = administratorReplyTarget(message);
  if (!target) {
    // A reply to an old notification must not fall through and be treated
    // as a message from a client.
    if (!looksLikeUserNotification(message)) return false;
    await sendMessage(adminChatId, '⚠️ Это сообщение не про клиента — ответ никому не ушёл. Откройте /inbox и ответьте на карточку клиента.', token, { track: false }).catch(() => {});
    return true;
  }
  const user = userByChatId(target.chatId);
  let answeredInquiry = null;
  try {
    const language = user && user.preferredLanguage || 'ru';
    const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
    const replyParameters = target.sourceMessageId != null && Number.isFinite(Number(target.sourceMessageId))
      ? { message_id: Number(target.sourceMessageId), allow_sending_without_reply: true }
      : null;
    const album = Array.isArray(message.albumMessageIds) ? message.albumMessageIds : [];
    let copied;
    let sentCount = 1;
    if (message.text) {
      copied = await sendMessage(target.chatId, header + '\n\n' + cleanText(message.text, 3800), token, {
        track: false,
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
    } else if (album.length) {
      // Альбом менеджера — один ответ: одна шапка и все снимки, а не три «Ответа менеджера» с тремя фото.
      await sendMessage(target.chatId, header, token, { track: false, ...(replyParameters ? { reply_parameters: replyParameters } : {}) });
      const all = [message.message_id, ...album];
      let sent = [];
      try {
        sent = await telegramRequest(token, 'copyMessages', { chat_id: target.chatId, from_chat_id: message.chat.id, message_ids: all });
      } catch {
        for (const id of all) {
          const one = await telegramRequest(token, 'copyMessage', { chat_id: target.chatId, from_chat_id: message.chat.id, message_id: id }).catch(() => null);
          if (one) sent.push(one);
        }
      }
      copied = Array.isArray(sent) ? sent[0] : null;
      sentCount = 1 + all.length;
    } else {
      await sendMessage(target.chatId, header, token, {
        track: false,
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
      copied = await telegramRequest(token, 'copyMessage', {
        chat_id: target.chatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      });
      sentCount = 2;
    }
    data.stats.messagesSent += sentCount;
    for (let index = 0; index < sentCount; index += 1) recordDaily('sent');
    recordActivity(user, 'out', messageSummary(message), 'admin_reply', { messageId: copied && copied.message_id });
    if (target.inquiryId) {
      const inquiry = data.inquiries.find((item) => item.id === target.inquiryId);
      if (inquiry) {
        inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
        const createdAt = new Date().toISOString();
        inquiry.replies.push({
          id: crypto.randomUUID(), text: messageSummary(message), source: 'telegram', by: adminChat.name, createdAt,
          telegramMessageId: copied && copied.message_id ? Number(copied.message_id) : null,
          // Откуда ответ: по этому номеру найдём его, если менеджер потом поправит сообщение.
          adminChatId: String(message.chat.id), adminMessageId: Number(message.message_id),
        });
        inquiry.replies = inquiry.replies.slice(-50);
        appendInquiryMessage(inquiry, inquiryTimelineMessage(message, 'out', {
          text: messageSummary(message), source: 'telegram', by: adminChat.name, createdAt,
          telegramMessageId: copied && copied.message_id,
          replyToTelegramMessageId: target.sourceMessageId,
          replyToText: ((inquiry.messages || []).find((entry) => entry.direction === 'in' && Number(entry.telegramMessageId) === Number(target.sourceMessageId)) || {}).text || '',
        }));
        if (inquiry.status === 'new') inquiry.status = 'in_progress';
        // Ответ в закрытую заявку не должен оставлять её закрытой: клиент снова в разговоре.
        if (inquiry.status === 'closed') {
          inquiry.status = 'in_progress';
          if (['won', 'lost'].includes(inquiry.pipelineStage)) {
            inquiry.pipelineStage = 'contact';
            inquiry.wonAt = '';
          }
        }
        // Ответ менеджера из Telegram тоже двигает воронку «Новая» → «Связались»,
        // как ответ из панели.
        if (!inquiry.pipelineStage || inquiry.pipelineStage === 'new') inquiry.pipelineStage = 'contact';
        if (!inquiry.assignee) {
          inquiry.assignee = adminChat.name;
          inquiry.takenAt = new Date().toISOString();
        }
        inquiry.updatedAt = new Date().toISOString();
        answeredInquiry = inquiry;
      }
    }
    saveDataNow();
    if (answeredInquiry) void refreshInquiryCards(answeredInquiry, token);
    await confirmStaffMessage(message, token, user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '');
  } catch (error) {
    if (user && userUnavailableError(error)) markUnavailable(user);
    recordError('Ответ администратора из Telegram', error);
    await sendMessage(adminChatId, '❌ ' + humanSendError(error, user), token, { track: false }).catch(() => {});
  }
  return true;
}

// Менеджер поправил уже отправленный ответ: правим и сообщение у клиента (текст или подпись), если оно ещё доступно.
async function handleAdministratorEdit(message, token) {
  const adminChat = message && message.chat ? adminChatFor(message.chat.id) : null;
  if (!adminChat) return false;
  const inquiry = data.inquiries.find((item) => (item.replies || []).some((reply) => reply.adminMessageId === Number(message.message_id) && reply.adminChatId === String(message.chat.id)));
  const reply = inquiry && inquiry.replies.find((item) => item.adminMessageId === Number(message.message_id) && item.adminChatId === String(message.chat.id));
  if (!reply || !reply.telegramMessageId) return false;
  const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
  if (!user) return true;
  const language = user.preferredLanguage || 'ru';
  const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
  try {
    if (typeof message.text === 'string') {
      await telegramRequest(token, 'editMessageText', { chat_id: user.chatId, message_id: reply.telegramMessageId, text: header + '\n\n' + cleanText(message.text, 3800) });
    } else if (message.caption !== undefined) {
      await telegramRequest(token, 'editMessageCaption', { chat_id: user.chatId, message_id: reply.telegramMessageId, caption: cleanText(message.caption, 1000) });
    } else {
      return true;
    }
    reply.text = messageSummary(message);
    const timeline = (inquiry.messages || []).find((entry) => entry.direction === 'out' && Number(entry.telegramMessageId) === Number(reply.telegramMessageId));
    if (timeline) timeline.text = messageSummary(message);
    saveDataNow();
    await confirmStaffMessage(message, token, '');
  } catch (error) {
    recordError('Правка ответа клиенту', error);
    await sendMessage(adminChat.chatId, '❌ Исправление до клиента не дошло: Telegram не даёт изменить это сообщение. Отправьте новый ответ.', token, { track: false }).catch(() => {});
  }
  return true;
}

export {
  ADMIN_MESSAGE_NOTIFY_LIMIT,
  ADMIN_NOTIFY_LIMIT,
  ADMIN_REPLY_TARGET_LIMIT,
  INQUIRY_MERGE_WINDOW_MS,
  awaitingReply,
  INQUIRY_RATE_LIMIT,
  INQUIRY_STATUS_LABELS,
  INQUIRY_TYPE_LABELS,
  LEGACY_REPLY_WINDOW_MS,
  MAX_INQUIRIES,
  MERGEABLE_INQUIRY_TYPES,
  adminCallbackAllowed,
  adminChatFor,
  adminMuteNotices,
  adminNotificationDecision,
  adminNotifyTimes,
  administratorReplyTarget,
  copyUserMessageToAdministrator,
  createInquiry,
  detailsWorthShowing,
  handleAdministratorEdit,
  handleAdministratorReply,
  handleInquiryStatusCallback,
  handleMessageReaction,
  buildInquiryCard,
  inquiryBody,
  inquiryPropertyLine,
  inquiryStateLine,
  refreshInquiryCards,
  inquiryChats,
  inquiryStatusMarkup,
  inquiryTimes,
  inquiryTypeLabel,
  inquiryWasMerged,
  isClientMedia,
  legacyAdministratorReplyTarget,
  looksLikeUserNotification,
  mergeIntoLatestInquiry,
  mergedInquiries,
  messageSummary,
  inquiryTimelineMessage,
  appendInquiryMessage,
  recordBotAnswer,
  nextFollowUpDate,
  notifyAdministrator,
  notifyAdministratorAction,
  reactionInfo,
  rememberAdminReplyTarget,
  serviceMessage,
  trimInquiries,
  withinRateLimit,
};
