// Группы и каналы, где состоит бот: учёт по обновлениям Telegram и действия
// от имени бота — публикации, закрепление, участники, права, приглашения.
//
// Чего Telegram не даёт: бот не может прочитать историю группы и получить
// список участников. Он видит только сообщения, пришедшие ему как обновления
// (в группе — если в BotFather выключен privacy mode), и число участников.

import crypto from 'node:crypto';
import { cleanText } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { imageExists } from './media.mjs';
import { validHttpUrl } from './catalog.mjs';

// What the bot saw in the group: enough to answer, delete or pin a message.
const GROUP_MESSAGE_LIMIT = 200;
const GROUP_LIMIT = 50;
const MEMBER_COUNT_TTL_MS = 5 * 60 * 1000;

const ADMIN_RIGHT_FIELDS = [
  'can_manage_chat',
  'can_delete_messages',
  'can_restrict_members',
  'can_promote_members',
  'can_change_info',
  'can_invite_users',
  'can_pin_messages',
  'can_post_messages',
  'can_edit_messages',
  'can_manage_topics',
];

function groupList() {
  if (!Array.isArray(data.groups)) data.groups = [];
  return data.groups;
}

function groupById(chatId) {
  const id = String(chatId);
  return groupList().find((group) => group.id === id) || null;
}

// A chat the bot is in right now and can act in.
function activeGroups() {
  return groupList().filter((group) => ['member', 'administrator', 'creator'].includes(group.status));
}

function rightsOf(member) {
  const rights = {};
  for (const field of ADMIN_RIGHT_FIELDS) rights[field] = Boolean(member && member[field]);
  if (member && member.status === 'creator') for (const field of ADMIN_RIGHT_FIELDS) rights[field] = true;
  return rights;
}

function normalizeGroupMessage(message) {
  const from = message.from || message.sender_chat || {};
  return {
    messageId: Number(message.message_id),
    userId: from.id ? String(from.id) : '',
    name: cleanText([from.first_name, from.last_name].filter(Boolean).join(' ') || from.title, 120) || 'Без имени',
    username: cleanText(from.username, 60),
    text: cleanText(message.text || message.caption || '', 1000),
    kind: message.photo ? 'photo' : message.video ? 'video' : message.document ? 'document' : message.voice ? 'voice' : message.poll ? 'poll' : 'text',
    fromBot: Boolean(from.is_bot) || (!message.from && Boolean(message.sender_chat)),
    date: new Date(Number(message.date || 0) * 1000 || Date.now()).toISOString(),
  };
}

function upsertGroup(chat, patch = {}) {
  if (!chat || !chat.id) return null;
  const id = String(chat.id);
  let group = groupById(id);
  if (!group) {
    if (groupList().length >= GROUP_LIMIT) return null;
    group = {
      id,
      title: '',
      type: '',
      username: '',
      status: 'member',
      rights: rightsOf(null),
      memberCount: 0,
      memberCountAt: '',
      description: '',
      inviteLink: '',
      pinnedMessageId: 0,
      messages: [],
      joinRequests: [],
      addedAt: new Date().toISOString(),
      lastMessageAt: '',
    };
    groupList().push(group);
  }
  group.title = cleanText(chat.title || group.title, 200);
  group.type = cleanText(chat.type || group.type, 20);
  group.username = cleanText(chat.username || group.username, 60);
  Object.assign(group, patch);
  group.updatedAt = new Date().toISOString();
  scheduleSave();
  return group;
}

// The bot was added, promoted, demoted or removed.
function handleMyChatMember(update) {
  const chat = update && update.chat;
  if (!chat || chat.type === 'private') return null;
  const member = update.new_chat_member || {};
  const status = cleanText(member.status, 20) || 'member';
  return upsertGroup(chat, { status, rights: rightsOf(member) });
}

function rememberGroupMessage(message) {
  const chat = message && message.chat;
  if (!chat || chat.type === 'private') return null;
  const group = groupById(chat.id);
  if (!group) return null;
  upsertGroup(chat);
  group.messages.push(normalizeGroupMessage(message));
  if (group.messages.length > GROUP_MESSAGE_LIMIT) group.messages = group.messages.slice(-GROUP_MESSAGE_LIMIT);
  group.lastMessageAt = new Date().toISOString();
  if (message.pinned_message && message.pinned_message.message_id) group.pinnedMessageId = Number(message.pinned_message.message_id);
  if (message.new_chat_members) group.memberCountAt = '';
  if (message.left_chat_member) group.memberCountAt = '';
  scheduleSave();
  return group;
}

function handleChatJoinRequest(update) {
  const group = update && update.chat ? upsertGroup(update.chat) : null;
  if (!group) return null;
  const from = update.from || {};
  group.joinRequests = (Array.isArray(group.joinRequests) ? group.joinRequests : []).filter((item) => item.userId !== String(from.id));
  group.joinRequests.push({
    userId: String(from.id),
    name: cleanText([from.first_name, from.last_name].filter(Boolean).join(' '), 120) || 'Без имени',
    username: cleanText(from.username, 60),
    at: new Date().toISOString(),
  });
  scheduleSave();
  return group;
}

// Fresh title, member count, description and the bot's own rights.
async function refreshGroup(group, token = data.config.botToken) {
  if (!group || !token) return group;
  try {
    const chat = await telegramRequest(token, 'getChat', { chat_id: group.id });
    upsertGroup(chat, {
      description: cleanText(chat.description, 1000),
      inviteLink: cleanText(chat.invite_link, 200),
      pinnedMessageId: chat.pinned_message ? Number(chat.pinned_message.message_id) : group.pinnedMessageId,
      photoFileId: chat.photo ? cleanText(chat.photo.small_file_id, 200) : '',
    });
    const count = await telegramRequest(token, 'getChatMemberCount', { chat_id: group.id });
    group.memberCount = Number(count) || 0;
    group.memberCountAt = new Date().toISOString();
    const me = data.bot && data.bot.id
      ? await telegramRequest(token, 'getChatMember', { chat_id: group.id, user_id: data.bot.id })
      : null;
    if (me) {
      group.status = cleanText(me.status, 20) || group.status;
      group.rights = rightsOf(me);
    }
    group.lastError = '';
  } catch (error) {
    group.lastError = error.message;
    recordError('Группа ' + (group.title || group.id), error);
  }
  scheduleSave();
  return group;
}

// Only what is stale, so opening the panel does not hammer Telegram.
async function refreshGroups(token = data.config.botToken, now = Date.now()) {
  if (!token) return [];
  const stale = activeGroups().filter((group) => now - (Date.parse(group.memberCountAt) || 0) > MEMBER_COUNT_TTL_MS);
  for (const group of stale) await refreshGroup(group, token);
  return groupList();
}

async function fetchAdministrators(group, token = data.config.botToken) {
  const list = await telegramRequest(token, 'getChatAdministrators', { chat_id: group.id });
  return (Array.isArray(list) ? list : []).map((member) => ({
    userId: String(member.user && member.user.id),
    name: cleanText([member.user && member.user.first_name, member.user && member.user.last_name].filter(Boolean).join(' '), 120) || 'Без имени',
    username: cleanText(member.user && member.user.username, 60),
    isBot: Boolean(member.user && member.user.is_bot),
    status: cleanText(member.status, 20),
    customTitle: cleanText(member.custom_title, 60),
    rights: rightsOf(member),
  }));
}

// A post from the panel: text, optionally a photo and a link button.
async function postToGroup(group, post, token = data.config.botToken) {
  const text = cleanText(post.text, 4000);
  const url = validHttpUrl(post.buttonUrl);
  const buttonText = cleanText(post.buttonText, 64);
  const markup = url && buttonText ? { inline_keyboard: [[{ text: buttonText, url }]] } : null;
  let sent;
  if (imageExists(post.image)) {
    if (text.length <= 1000) {
      sent = await sendPhotoMessage(group.id, post.image, text, token, markup);
    } else {
      sent = await sendPhotoMessage(group.id, post.image, '', token, null);
      await sendMessage(group.id, text, token, { track: false, ...(markup ? { reply_markup: markup } : {}) });
    }
  } else {
    if (!text) throw new Error('Сообщение пустое');
    sent = await sendMessage(group.id, text, token, { track: false, ...(markup ? { reply_markup: markup } : {}) });
  }
  const messageId = sent && Number(sent.message_id);
  if (messageId) {
    group.messages.push({
      messageId,
      userId: String(data.bot && data.bot.id || ''),
      name: 'Бот',
      username: cleanText(data.bot && data.bot.username, 60),
      text: text.slice(0, 1000),
      kind: imageExists(post.image) ? 'photo' : 'text',
      fromBot: true,
      date: new Date().toISOString(),
    });
    if (group.messages.length > GROUP_MESSAGE_LIMIT) group.messages = group.messages.slice(-GROUP_MESSAGE_LIMIT);
    if (post.pin) {
      await telegramRequest(token, 'pinChatMessage', { chat_id: group.id, message_id: messageId, disable_notification: !post.notify });
      group.pinnedMessageId = messageId;
    }
  }
  group.lastPostAt = new Date().toISOString();
  scheduleSave();
  return messageId || 0;
}

function forgetGroupMessage(group, messageId) {
  group.messages = group.messages.filter((item) => item.messageId !== Number(messageId));
  if (group.pinnedMessageId === Number(messageId)) group.pinnedMessageId = 0;
  scheduleSave();
}

// Scheduled posts are sent by the same scheduler as broadcasts.
function duePosts(now = new Date()) {
  return (Array.isArray(data.groupPosts) ? data.groupPosts : [])
    .filter((post) => post.status === 'scheduled' && Date.parse(post.sendAt) <= now.getTime());
}

async function runDueGroupPosts(now = new Date(), token = data.config.botToken) {
  if (!token || !data.config.active) return [];
  const sent = [];
  for (const post of duePosts(now)) {
    const group = groupById(post.groupId);
    if (!group) {
      post.status = 'failed';
      post.error = 'Группа недоступна';
      continue;
    }
    try {
      post.messageId = await postToGroup(group, post, token);
      post.status = 'sent';
      post.sentAt = new Date().toISOString();
      post.error = '';
      sent.push(post.id);
    } catch (error) {
      post.status = 'failed';
      post.error = error.message;
      recordError('Отложенная публикация в группу', error);
    }
  }
  if (sent.length || duePosts(now).length) scheduleSave();
  return sent;
}

function newGroupPost(fields) {
  return {
    id: crypto.randomUUID(),
    groupId: cleanText(fields.groupId, 40),
    text: cleanText(fields.text, 4000),
    buttonText: cleanText(fields.buttonText, 64),
    buttonUrl: cleanText(fields.buttonUrl, 500),
    image: fields.image || null,
    pin: Boolean(fields.pin),
    notify: fields.notify !== false,
    status: 'scheduled',
    sendAt: fields.sendAt,
    createdAt: new Date().toISOString(),
    messageId: 0,
    error: '',
  };
}

export {
  GROUP_MESSAGE_LIMIT,
  activeGroups,
  duePosts,
  fetchAdministrators,
  forgetGroupMessage,
  groupById,
  groupList,
  handleChatJoinRequest,
  handleMyChatMember,
  newGroupPost,
  postToGroup,
  refreshGroup,
  refreshGroups,
  rememberGroupMessage,
  runDueGroupPosts,
  upsertGroup,
};
