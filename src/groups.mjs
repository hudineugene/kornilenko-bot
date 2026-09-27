// Группы и каналы, где состоит бот: учёт по обновлениям Telegram и действия
// от имени бота — публикации, закрепление, участники, права, приглашения.
//
// Чего Telegram не даёт: бот не может прочитать историю группы и получить
// список участников. Он видит только сообщения, пришедшие ему как обновления
// (в группе — если в BotFather выключен privacy mode), и число участников.

import crypto from 'node:crypto';
import { cleanText } from './util.mjs';
import { normalizePublishing } from './data-format.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { sendDocumentMessage, sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { imageExists, imageHasTransparency } from './media.mjs';
import { validHttpUrl } from './catalog.mjs';
import { applyPrivateChatStatus } from './users.mjs';

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
  if (!chat) return null;
  // В личном чате это сообщение значит одно из двух: клиент заблокировал бота
  // или вернулся и разблокировал. Второе снимает запрет на отправку.
  if (chat.type === 'private') {
    const member = update.new_chat_member || {};
    applyPrivateChatStatus(chat.id, cleanText(member.status, 20));
    return null;
  }
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

// В панели ссылку пишут как [ТикТок](https://…). Для Telegram это
// превращается в HTML, а весь остальной текст экранируется.
const LINK_PATTERN = /\[([^\]\n]{1,120})\]\(((?:https?:\/\/|mailto:)[^\s()<>"']{4,500})\)/g;
const MAILTO_LINK_PATTERN = /\[([^\]\n]{1,120})\]\(mailto:([^\s()<>"']{4,500})\)/g;

// Telegram у ботов может не принять ссылку mailto. Тогда пост уходит ещё раз,
// где вместо надписи стоит сам адрес — его Telegram делает кликабельным сам.
function flattenMailto(text) {
  return String(text || '').replace(MAILTO_LINK_PATTERN, '$2');
}

function hasMailto(text) {
  return MAILTO_LINK_PATTERN.test(String(text || ''));
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// **жирный** и __курсив__. Двойные знаки выбраны, чтобы обычный текст со
// звёздочкой или подчёркиванием случайно не превратился в разметку.
const BOLD_PATTERN = /\*\*([^*\n]{1,200})\*\*/g;
const ITALIC_PATTERN = /__([^_\n]{1,200})__/g;

function applyMarks(escaped, counter) {
  return escaped
    .replace(BOLD_PATTERN, (match, inner) => {
      counter.marks += 1;
      return '<b>' + inner + '</b>';
    })
    .replace(ITALIC_PATTERN, (match, inner) => {
      counter.marks += 1;
      return '<i>' + inner + '</i>';
    });
}

function withoutMarks(text) {
  return String(text).replace(BOLD_PATTERN, '$1').replace(ITALIC_PATTERN, '$1');
}

// Возвращает готовый HTML и тот же текст без разметки — по нему считаются
// ограничения Telegram на длину подписи.
function formatLinks(text) {
  const source = String(text || '');
  const counter = { marks: 0 };
  let html = '';
  let plain = '';
  let last = 0;
  let links = 0;
  for (const match of source.matchAll(LINK_PATTERN)) {
    const before = source.slice(last, match.index);
    html += applyMarks(escapeHtml(before), counter);
    plain += withoutMarks(before);
    html += '<a href="' + escapeHtml(match[2]) + '">' + applyMarks(escapeHtml(match[1]), counter) + '</a>';
    plain += withoutMarks(match[1]);
    last = match.index + match[0].length;
    links += 1;
  }
  html += applyMarks(escapeHtml(source.slice(last)), counter);
  plain += withoutMarks(source.slice(last));
  return { html, plain, links, marks: counter.marks };
}

// Текст поста: то, что набрали, плюс постоянная подпись под ним.
// Telegram переносит текст по ширине экрана сам, а набранные в панели
// переносы остаются жёсткими. «Одной строкой» убирает их, чтобы подпись
// подстраивалась под ширину.
// Строка-разделитель: она же задаёт ширину блока.
const DIVIDERS = {
  thin: '─────────────────────',
  bold: '━━━━━━━━━━━━━━━━━━',
  dash: '- - - - - - - - - - - - - - - -',
  dots: '· · · · · · · · · · · · · · · ·',
};

function signatureText(publishing) {
  const signature = publishing.signatureEnabled ? publishing.signature : '';
  if (!signature || publishing.signatureWrap === 'keep') return signature;
  const parts = signature.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return parts.join(publishing.signatureWrap === 'dot' ? ' · ' : ' ');
}

// Подпись вместе с разделителем — в таком виде она уходит в сообщение.
function signatureBlock(publishing) {
  const signature = signatureText(publishing);
  if (!signature) return '';
  const divider = DIVIDERS[publishing.signatureDivider];
  return divider ? divider + '\n' + signature : signature;
}

function postText(post) {
  const publishing = normalizePublishing(data.config.publishing);
  const body = cleanText(post.text, 4000);
  const signature = signatureBlock(publishing);
  const written = post.withoutSignature || !signature ? body : (body ? body + '\n\n' + signature : signature);
  return post.plainMail ? flattenMailto(written) : written;
}

// Подпись цитатой отделяется полоской слева — заметный, но спокойный блок.
function postHtml(post) {
  const publishing = normalizePublishing(data.config.publishing);
  const body = post.plainMail ? flattenMailto(cleanText(post.text, 4000)) : cleanText(post.text, 4000);
  const rawSignature = post.withoutSignature ? '' : signatureBlock(publishing);
  const signature = post.plainMail ? flattenMailto(rawSignature) : rawSignature;
  const bodyPart = formatLinks(body);
  const signaturePart = formatLinks(signature);
  const quote = signature && publishing.signatureQuote;
  const html = [bodyPart.html, quote ? '<blockquote>' + signaturePart.html + '</blockquote>' : signaturePart.html]
    .filter(Boolean).join('\n\n');
  const plain = [bodyPart.plain, signaturePart.plain].filter(Boolean).join('\n\n');
  const rich = bodyPart.links + signaturePart.links + bodyPart.marks + signaturePart.marks + (quote ? 1 : 0);
  return { html, plain, rich };
}

// Кнопка самого поста плюс постоянные кнопки из «Оформления постов».
function postMarkup(post) {
  const publishing = normalizePublishing(data.config.publishing);
  const rows = [];
  const url = validHttpUrl(post.buttonUrl);
  const buttonText = cleanText(post.buttonText, 64);
  if (url && buttonText) rows.push([{ text: buttonText, url }]);
  if (!post.withoutSignature && publishing.signatureEnabled) {
    const perRow = publishing.buttonsPerRow || 3;
    let row = [];
    for (const button of publishing.buttons) {
      row.push({ text: button.text, url: button.url });
      if (row.length >= perRow) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) rows.push(row);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

function rubricOf(post) {
  const publishing = normalizePublishing(data.config.publishing);
  const rubric = post.rubricId ? publishing.rubrics.find((item) => item.id === post.rubricId) : null;
  return rubric && imageExists(rubric.image) ? rubric : null;
}

function rememberOwnMessage(group, messageId, text, kind) {
  if (!messageId) return;
  group.messages.push({
    messageId,
    userId: String(data.bot && data.bot.id || ''),
    name: group.type === 'channel' ? (group.title || 'Канал') : 'Бот',
    username: cleanText(data.bot && data.bot.username, 60),
    text: String(text || '').slice(0, 1000),
    kind: kind || 'text',
    fromBot: true,
    date: new Date().toISOString(),
  });
  if (group.messages.length > GROUP_MESSAGE_LIMIT) group.messages = group.messages.slice(-GROUP_MESSAGE_LIMIT);
}

// Пост из панели: текст с подписью, своё фото, кнопка-ссылка и плашка рубрики.
// Telegram всегда показывает фото над текстом, поэтому плашка «снизу» уходит
// отдельным сообщением сразу за постом.
// Подпись к фотографии помещается в 1024 знака — столько же занимает текст
// поста вместе с постоянной подписью, когда плашка стоит внизу сообщения.
const CAPTION_LIMIT = 1024;

// Повтор без ссылки mailto, если Telegram её не принял.
async function postToGroup(group, post, token = data.config.botToken) {
  try {
    return await sendPost(group, post, token);
  } catch (error) {
    const rejected = /url|entit|parse/i.test(String(error && error.message));
    if (!rejected || post.plainMail || !hasMailto(postText(post))) throw error;
    recordError('Ссылка mailto не принята, отправляем адрес текстом', error);
    return sendPost(group, { ...post, plainMail: true }, token);
  }
}

async function sendPost(group, post, token = data.config.botToken) {
  const written = postText(post);
  const formatted = postHtml(post);
  // Разметка нужна только когда в тексте есть ссылки, выделения или цитата.
  const useHtml = formatted.rich > 0 && formatted.html.length <= 4000;
  const text = useHtml ? formatted.html : written;
  const plain = useHtml ? formatted.plain : written;
  const parseMode = useHtml ? 'HTML' : undefined;
  const markup = postMarkup(post);
  const rubric = rubricOf(post);
  const ownImage = imageExists(post.image) ? post.image : null;
  // Прозрачный PNG Telegram сохраняет только файлом, а файл нельзя поставить
  // под текст внутри сообщения — такая плашка уходит отдельным сообщением.
  const plateTransparent = Boolean(rubric) && imageHasTransparency(rubric.image);
  const ownTransparent = Boolean(ownImage) && imageHasTransparency(ownImage);
  const topImage = ownImage || (rubric && rubric.placement === 'top' && !plateTransparent ? rubric.image : null);
  // Плашка внизу одним сообщением: текст ставится над картинкой. Так можно,
  // только если фотографии поста нет и текст помещается в подпись.
  const plateInside = Boolean(rubric) && rubric.placement === 'bottom' && !ownImage && !plateTransparent && text && plain.length <= CAPTION_LIMIT;
  let sent;
  let plateSentInside = false;
  if (plateInside) {
    sent = await sendPhotoMessage(group.id, rubric.image, text, token, markup, { captionAbove: true, parseMode });
    plateSentInside = true;
  } else if (topImage) {
    const sendImage = ownTransparent ? sendDocumentMessage : sendPhotoMessage;
    if (text && plain.length <= CAPTION_LIMIT) {
      sent = await sendImage(group.id, topImage, text, token, markup, { parseMode });
    } else {
      sent = await sendImage(group.id, topImage, '', token, null);
      if (text) await sendMessage(group.id, text, token, { track: false, ...(parseMode ? { parse_mode: parseMode } : {}), ...(markup ? { reply_markup: markup } : {}) });
    }
  } else {
    if (!text) throw new Error('Сообщение пустое');
    sent = await sendMessage(group.id, text, token, { track: false, ...(parseMode ? { parse_mode: parseMode } : {}), ...(markup ? { reply_markup: markup } : {}) });
  }
  const messageId = sent && Number(sent.message_id);
  rememberOwnMessage(group, messageId, plain, topImage || plateSentInside ? 'photo' : 'text');
  // Длинный пост или своё фото: плашка уходит отдельным сообщением следом.
  if (rubric && (rubric.placement !== 'top' || plateTransparent) && !plateSentInside) {
    const sendPlate = plateTransparent ? sendDocumentMessage : sendPhotoMessage;
    const plate = await sendPlate(group.id, rubric.image, '', token, null).catch((error) => {
      recordError('Плашка рубрики «' + rubric.name + '»', error);
      return null;
    });
    rememberOwnMessage(group, plate && Number(plate.message_id), '🏷 ' + rubric.name, 'photo');
  }
  if (messageId && post.pin) {
    await telegramRequest(token, 'pinChatMessage', { chat_id: group.id, message_id: messageId, disable_notification: !post.notify });
    group.pinnedMessageId = messageId;
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
    rubricId: cleanText(fields.rubricId, 60),
    withoutSignature: Boolean(fields.withoutSignature),
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
  formatLinks,
  postHtml,
  postMarkup,
  postText,
  postToGroup,
  signatureBlock,
  signatureText,
  refreshGroup,
  refreshGroups,
  rememberGroupMessage,
  runDueGroupPosts,
  upsertGroup,
};
