// Обращения клиентов, уведомления администратору и ответы из Telegram.

import crypto from 'node:crypto';
import { cleanText } from './util.mjs';
import { INTERACTION_TEXT, MANAGER_CONTACT_TEXT } from './texts.mjs';
import { data, saveDataNow, scheduleSave } from './store.mjs';
import { recordActivity, recordDaily, recordError } from './analytics.mjs';
import { normalizeUser, userByChatId } from './users.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { localized } from './catalog.mjs';
import { acknowledgeCallback, propertyRequestText } from './sections.mjs';
import { userUnavailableError } from './broadcasts.mjs';

const MAX_INQUIRIES = 5000;
const INQUIRY_MERGE_WINDOW_MS = 10 * 60 * 1000;
const INQUIRY_RATE_LIMIT = { count: 20, windowMs: 60 * 60 * 1000 };
const ADMIN_NOTIFY_LIMIT = { count: 15, windowMs: 10 * 60 * 1000 };
const ADMIN_MESSAGE_NOTIFY_LIMIT = { count: 20, windowMs: 10 * 60 * 1000 };
const MERGEABLE_INQUIRY_TYPES = ['general', 'question'];
const inquiryTimes = new Map();
const adminNotifyTimes = new Map();
const adminMuteNotices = new Map();

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
function trimInquiries() {
  let excess = data.inquiries.length - MAX_INQUIRIES;
  if (excess <= 0) return;
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
  if (excess > 0) kept.length -= excess;
  data.inquiries = kept;
}

// Messages sent in a row go into the client's latest open inquiry instead of
// creating a new card each time. Past the rate limit every further message is
// merged, so one person cannot flood the inquiry list.
function mergeIntoLatestInquiry(user, text, type, context) {
  const latest = data.inquiries.find((item) => item.userId === String(user.id));
  if (!latest) return null;
  const combined = latest.text + '\n\n' + text;
  // A question to the manager and the free messages that follow it are one
  // conversation, so these two types continue each other.
  const continuation = MERGEABLE_INQUIRY_TYPES.includes(type)
    && !context.propertyId && !context.lead && !context.selection
    && MERGEABLE_INQUIRY_TYPES.includes(latest.type) && !latest.propertyId && latest.status === 'new'
    && Date.now() - Date.parse(latest.updatedAt) < INQUIRY_MERGE_WINDOW_MS
    && combined.length <= 4000;
  // Only new inquiries count towards the limit.
  if (!continuation && withinRateLimit(inquiryTimes, String(user.id), INQUIRY_RATE_LIMIT)) return null;
  // Past the limit the text is kept only while it fits; every message is
  // still in the user's activity history.
  if (combined.length <= 4000) latest.text = combined;
  latest.updatedAt = new Date().toISOString();
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

function createInquiry(user, text, context = {}) {
  const type = ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(context.type) ? context.type : 'general';
  const merged = mergeIntoLatestInquiry(user, cleanText(text, 4000), type, context);
  if (merged) {
    mergedInquiries.add(merged);
    scheduleSave();
    const notify = () => notifyAdministrator(merged, user, { text: cleanText(text, 4000), title: 'Новое сообщение в обращении' });
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
    sourceMessageId: Number.isFinite(Number(context.sourceMessage && context.sourceMessage.message_id)) ? Number(context.sourceMessage.message_id) : null,
    lead: context.lead && typeof context.lead === 'object' ? {
      name: cleanText(context.lead.name, 120),
      phone: cleanText(context.lead.phone, 80),
      preferredTime: cleanText(context.lead.preferredTime, 160),
    } : null,
    selection: context.selection && typeof context.selection === 'object' ? {
      deal: cleanText(context.selection.deal, 200),
      location: cleanText(context.selection.location, 200),
      budget: cleanText(context.selection.budget, 200),
      bedrooms: cleanText(context.selection.bedrooms, 200),
    } : null,
    status: 'new',
    note: '',
    replies: [],
    createdAt: now,
    updatedAt: now,
  };
  data.inquiries.unshift(inquiry);
  trimInquiries();
  recordDaily('inquiry');
  scheduleSave();
  if (isClientMedia(context.sourceMessage)) {
    void copyUserMessageToAdministrator(context.sourceMessage, data.config.botToken, inquiry)
      .then(() => notifyAdministrator(inquiry, user))
      .catch((error) => recordError('Уведомление администратору', error));
  } else {
    void notifyAdministrator(inquiry, user);
  }
  return inquiry;
}

const INQUIRY_TYPE_LABELS = {
  question: 'вопрос по объекту',
  interest: 'интерес к объекту',
  selection: 'подбор недвижимости',
  viewing: 'запись на просмотр',
  lead: 'заявка на звонок',
  general: 'сообщение',
};

function inquiryTypeLabel(inquiry) {
  if (inquiry.type === 'question' && !inquiry.propertyId) return 'вопрос менеджеру';
  return INQUIRY_TYPE_LABELS[inquiry.type] || 'сообщение';
}

const INQUIRY_STATUS_LABELS = { new: 'новое', in_progress: 'в работе', closed: 'закрыто' };

// Buttons under an inquiry notification let the admin keep statuses from
// Telegram, without opening the panel.
function inquiryStatusMarkup(inquiry) {
  if (!inquiry) return null;
  if (inquiry.status === 'closed') return { inline_keyboard: [[{ text: '↩️ Открыть снова', callback_data: 'inq:new:' + inquiry.id }]] };
  const row = [];
  if (inquiry.status !== 'in_progress') row.push({ text: '⏳ В работу', callback_data: 'inq:in_progress:' + inquiry.id });
  row.push({ text: '✅ Закрыть', callback_data: 'inq:closed:' + inquiry.id });
  return { inline_keyboard: [row] };
}

async function handleInquiryStatusCallback(query, token) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  const chatId = query.message && query.message.chat ? String(query.message.chat.id) : '';
  // Only buttons in the admin chat may change statuses.
  if (!adminChatId || chatId !== adminChatId) {
    await acknowledgeCallback(query, token, INTERACTION_TEXT.ru.stale);
    return;
  }
  const [, status, ...rest] = String(query.data || '').split(':');
  const inquiry = data.inquiries.find((item) => item.id === rest.join(':'));
  if (!inquiry || !Object.hasOwn(INQUIRY_STATUS_LABELS, status)) {
    await acknowledgeCallback(query, token, 'Обращение не найдено — возможно, оно удалено.');
    return;
  }
  inquiry.status = status;
  inquiry.updatedAt = new Date().toISOString();
  saveDataNow();
  await acknowledgeCallback(query, token, 'Статус: ' + INQUIRY_STATUS_LABELS[status]);
  try {
    await telegramRequest(token, 'editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: inquiryStatusMarkup(inquiry),
    });
  } catch {
    // The status is saved even if Telegram no longer allows editing the buttons.
  }
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

async function notifyAdministratorAction(user, title, details = '', inquiryId = '', sourceMessageId = null, options = {}) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !data.config.botToken || !user || !user.chatId || String(user.chatId) === adminChatId) return false;
  if (data.config.notifyMode === 'inquiries' && !options.important) return false;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';
  const username = user.username ? ' (@' + user.username + ')' : '';
  const decision = adminNotificationDecision(user, Boolean(options.important));
  if (decision === 'drop') return false;
  if (decision === 'notice') {
    await sendMessage(adminChatId, '⚠️ ' + name + username + ' (ID ' + user.id + ') присылает слишком много сообщений. Уведомления о новых сообщениях этого пользователя приостановлены на ' + Math.round(ADMIN_MESSAGE_NOTIFY_LIMIT.windowMs / 60000) + ' минут. Все сообщения сохраняются в панели.', data.config.botToken, { track: false }).catch((error) => recordError('Уведомление администратору', error));
    return false;
  }
  // Routing of replies does not depend on this text (see adminReplyTargets),
  // so it only carries what a person needs to read.
  const language = user.preferredLanguage ? ' · ' + user.preferredLanguage.toUpperCase() : '';
  const who = '👤 ' + name + username + language + (user.source ? ' · 📣 ' + user.source : '');
  const cleanDetails = cleanText(details, 4000);
  const notification = options.important
    ? ['📩 ' + cleanText(title, 160), who, '', cleanDetails, '', '↩️ Ответьте на это сообщение — ответ получит клиент.']
    : ['👀 ' + cleanText(title, 160), who, ...(detailsWorthShowing(title, cleanDetails) ? ['', cleanDetails] : [])];
  try {
    const messageIds = [];
    const inquiry = options.important && inquiryId ? data.inquiries.find((item) => item.id === inquiryId) : null;
    const markup = inquiryStatusMarkup(inquiry);
    await sendMessage(adminChatId, notification.filter((line, index, lines) => !(line === '' && lines[index - 1] === '')).join('\n').trim(), data.config.botToken, { track: false, messageIds, ...(markup ? { reply_markup: markup } : {}) });
    rememberAdminReplyTarget(messageIds, { chatId: user.chatId, inquiryId, sourceMessageId });
    if (!data.config.adminNotificationVerifiedAt) {
      data.config.adminNotificationVerifiedAt = new Date().toISOString();
      scheduleSave();
    }
    return true;
  } catch (error) {
    // Only a refusal from Telegram (wrong chat, bot blocked) means the admin
    // chat is misconfigured; a network hiccup says nothing about it.
    if ([400, 403].includes(Number(error && error.telegramCode))) data.config.adminNotificationVerifiedAt = '';
    recordError('Уведомление администратору', error);
    return false;
  }
}

async function notifyAdministrator(inquiry, user, options = {}) {
  const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  const propertyLine = property
    ? '🏠 ' + (localized(property.title, inquiry.language) || property.reference || property.id)
    : '';
  let text = options.text || inquiry.text;
  // Property requests start with "Question about: <title>", already shown above.
  if (property) {
    for (const type of ['question', 'viewing', 'interest']) {
      const prefix = propertyRequestText(property, inquiry.language, type);
      if (text.startsWith(prefix)) text = text.slice(prefix.length).trim();
    }
  }
  return notifyAdministratorAction(user, (options.title || 'Новое обращение') + ': ' + inquiryTypeLabel(inquiry), [
    propertyLine,
    text,
  ].filter(Boolean).join('\n'), inquiry.id, inquiry.sourceMessageId, { important: true });
}

async function copyUserMessageToAdministrator(message, token, inquiry = null) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !message || !message.chat || String(message.chat.id) === adminChatId) return false;
  try {
    const copied = await telegramRequest(token, 'copyMessage', {
      chat_id: adminChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
    // Replying directly to the copied photo or voice message works too.
    if (copied && Number.isFinite(Number(copied.message_id))) {
      rememberAdminReplyTarget([Number(copied.message_id)], {
        chatId: message.chat.id,
        inquiryId: inquiry ? inquiry.id : '',
        sourceMessageId: message.message_id,
      });
    }
    return true;
  } catch (error) {
    recordError('Копирование сообщения администратору', error);
    return false;
  }
}

function messageSummary(message) {
  if (!message) return 'Сообщение';
  if (message.text) return cleanText(message.text, 4000);
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
function rememberAdminReplyTarget(messageIds, target) {
  if (!target || target.chatId == null || !messageIds.length) return;
  if (!data.adminReplyTargets || typeof data.adminReplyTargets !== 'object') data.adminReplyTargets = {};
  for (const messageId of messageIds) {
    data.adminReplyTargets[String(messageId)] = {
      chatId: String(target.chatId),
      inquiryId: cleanText(target.inquiryId, 100),
      sourceMessageId: Number.isFinite(Number(target.sourceMessageId)) && target.sourceMessageId != null ? Number(target.sourceMessageId) : null,
      createdAt: new Date().toISOString(),
    };
  }
  const keys = Object.keys(data.adminReplyTargets);
  if (keys.length > ADMIN_REPLY_TARGET_LIMIT) {
    keys.sort((a, b) => Number(a) - Number(b));
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
  const key = String(replied.message_id);
  const targets = data.adminReplyTargets || {};
  if (Object.hasOwn(targets, key)) {
    const stored = targets[key];
    return { chatId: stored.chatId, inquiryId: stored.inquiryId || '', sourceMessageId: stored.sourceMessageId };
  }
  return legacyAdministratorReplyTarget(replied);
}

function looksLikeUserNotification(message) {
  const replied = message && message.reply_to_message;
  if (!replied) return false;
  if (data.bot.id && replied.from) return Number(replied.from.id) === Number(data.bot.id);
  return /Получатель ID:/.test(String(replied.text || replied.caption || ''));
}

async function handleAdministratorReply(message, token) {
  const adminChatId = cleanText(data.config.adminChatId, 40);
  if (!adminChatId || !message || !message.chat || String(message.chat.id) !== adminChatId) return false;
  const target = administratorReplyTarget(message);
  if (!target) {
    // A reply to an old notification must not fall through and be treated
    // as a message from a client.
    if (!looksLikeUserNotification(message)) return false;
    await sendMessage(adminChatId, '⚠️ Сообщение не отправлено: не удалось определить получателя этого уведомления. Ответьте пользователю из панели управления.', token, { track: false }).catch(() => {});
    return true;
  }
  const user = userByChatId(target.chatId);
  try {
    const language = user && user.preferredLanguage || 'ru';
    const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
    const replyParameters = target.sourceMessageId != null && Number.isFinite(Number(target.sourceMessageId))
      ? { message_id: Number(target.sourceMessageId), allow_sending_without_reply: true }
      : null;
    let copied;
    let sentCount = 1;
    if (message.text) {
      copied = await sendMessage(target.chatId, header + '\n\n' + cleanText(message.text, 3800), token, {
        track: false,
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
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
        inquiry.replies.push({ id: crypto.randomUUID(), text: messageSummary(message), source: 'telegram', createdAt: new Date().toISOString() });
        inquiry.replies = inquiry.replies.slice(-50);
        if (inquiry.status === 'new') inquiry.status = 'in_progress';
        inquiry.updatedAt = new Date().toISOString();
      }
    }
    saveDataNow();
    await sendMessage(adminChatId, '✅ Сообщение отправлено пользователю' + (user ? ' ' + ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.id) : '') + '.', token, { track: false });
  } catch (error) {
    if (user && userUnavailableError(error)) user.blocked = true;
    recordError('Ответ администратора из Telegram', error);
    await sendMessage(adminChatId, '❌ Не удалось отправить сообщение: ' + error.message, token, { track: false }).catch(() => {});
  }
  return true;
}

export {
  ADMIN_MESSAGE_NOTIFY_LIMIT,
  ADMIN_NOTIFY_LIMIT,
  ADMIN_REPLY_TARGET_LIMIT,
  INQUIRY_MERGE_WINDOW_MS,
  INQUIRY_RATE_LIMIT,
  INQUIRY_STATUS_LABELS,
  INQUIRY_TYPE_LABELS,
  LEGACY_REPLY_WINDOW_MS,
  MAX_INQUIRIES,
  MERGEABLE_INQUIRY_TYPES,
  adminMuteNotices,
  adminNotificationDecision,
  adminNotifyTimes,
  administratorReplyTarget,
  copyUserMessageToAdministrator,
  createInquiry,
  detailsWorthShowing,
  handleAdministratorReply,
  handleInquiryStatusCallback,
  handleMessageReaction,
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
  notifyAdministrator,
  notifyAdministratorAction,
  reactionInfo,
  rememberAdminReplyTarget,
  trimInquiries,
  withinRateLimit,
};
