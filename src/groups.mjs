// Группы и каналы, где состоит бот: учёт по обновлениям Telegram и действия
// от имени бота — публикации, закрепление, участники, права, приглашения.
//
// Чего Telegram не даёт: бот не может прочитать историю группы и получить
// список участников. Он видит только сообщения, пришедшие ему как обновления
// (в группе — если в BotFather выключен privacy mode), и число участников.

import crypto from 'node:crypto';
import { cleanText } from './util.mjs';
import { PLACES } from './places.mjs';
import { tellAdminProblem } from './notify-plan.mjs';
import { normalizePublishing } from './data-format.mjs';
import { data, scheduleSave } from './store.mjs';
import { temporaryDeliveryError } from './broadcasts.mjs';
import { recordError } from './analytics.mjs';
import { sendDocumentMessage, sendMessage, sendPhotoAlbum, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { imageExists, imageHasTransparency } from './media.mjs';
import { buildListing, plainOf } from './listing.mjs';
import { validHttpUrl } from './catalog.mjs';
import { applyPrivateChatStatus } from './users.mjs';

// What the bot saw in the group: enough to answer, delete or pin a message.
const GROUP_MESSAGE_LIMIT = 200;
const GROUP_LIMIT = 50;
const MEMBER_COUNT_TTL_MS = 5 * 60 * 1000;
// Темы форума (подгруппы). «Общая» тема — всегда номер 1.
const TOPIC_LIMIT = 100;
const GENERAL_TOPIC_ID = 1;

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
    threadId: 0,
    date: new Date(Number(message.date || 0) * 1000 || Date.now()).toISOString(),
  };
}

function topicList(group) {
  if (!Array.isArray(group.topics)) group.topics = [];
  return group.topics;
}

function findTopic(group, id) {
  const threadId = Math.floor(Number(id));
  return topicList(group).find((topic) => topic.id === threadId) || null;
}

// Название темы для человека: у «Общей» его нет в Telegram, у темы, о которой
// бот знает только номер, — тоже.
function topicTitle(group, id) {
  const threadId = Math.floor(Number(id)) || GENERAL_TOPIC_ID;
  const topic = findTopic(group, threadId);
  if (topic && topic.name) return topic.name;
  return threadId === GENERAL_TOPIC_ID ? 'Общая' : 'Тема №' + threadId;
}

// Запомнить тему (или обновить то, что о ней известно). Наличие темы означает,
// что в группе включены темы.
function rememberTopic(group, id, patch = {}) {
  const threadId = Math.floor(Number(id));
  if (!group || !Number.isFinite(threadId) || threadId < 1) return null;
  let topic = findTopic(group, threadId);
  if (!topic) {
    if (topicList(group).length >= TOPIC_LIMIT) return null;
    topic = { id: threadId, name: '', closed: false, manual: false, lastMessageAt: '' };
    topicList(group).push(topic);
  }
  const name = cleanText(patch.name, 128);
  if (name && (patch.overwrite !== false || !topic.name)) topic.name = name;
  if (patch.closed !== undefined) topic.closed = Boolean(patch.closed);
  if (patch.manual) topic.manual = true;
  if (patch.at) topic.lastMessageAt = patch.at;
  group.isForum = true;
  scheduleSave();
  return topic;
}

function forgetTopic(group, id) {
  const threadId = Math.floor(Number(id));
  if (threadId === GENERAL_TOPIC_ID) return false;
  const before = topicList(group).length;
  group.topics = topicList(group).filter((topic) => topic.id !== threadId);
  scheduleSave();
  return group.topics.length < before;
}

// В какой теме сообщение. Служебные события темы называют её сами; у обычного
// сообщения номер темы указан, если оно написано внутри темы. Сообщение без
// номера в форуме — из «Общей». Номер, который Telegram ставит у ответов в
// группе без тем, темой не считается.
function messageThread(message, group) {
  if (message.forum_topic_created) return Number(message.message_thread_id || message.message_id) || 0;
  const thread = Number(message.message_thread_id) || 0;
  if (message.forum_topic_edited || message.forum_topic_closed || message.forum_topic_reopened) return thread;
  if (message.is_topic_message && thread) return thread;
  return group && group.isForum ? GENERAL_TOPIC_ID : 0;
}

const TOPIC_SERVICE_FIELDS = ['forum_topic_created', 'forum_topic_edited', 'forum_topic_closed', 'forum_topic_reopened'];

function learnTopic(group, message, threadId, at) {
  const created = message.forum_topic_created;
  if (created) {
    rememberTopic(group, threadId, { name: created.name, closed: false, at });
    return;
  }
  const edited = message.forum_topic_edited;
  if (edited) rememberTopic(group, threadId, { name: edited.name, at });
  if (message.forum_topic_closed) rememberTopic(group, threadId, { closed: true, at });
  if (message.forum_topic_reopened) rememberTopic(group, threadId, { closed: false, at });
  if (!edited && !message.forum_topic_closed && !message.forum_topic_reopened && threadId) {
    // Первое сообщение темы отвечает на её «создание»: там лежит название.
    const origin = message.reply_to_message && message.reply_to_message.forum_topic_created;
    rememberTopic(group, threadId, { name: origin && origin.name, overwrite: false, at });
  }
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
      isForum: false,
      topics: [],
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
  const at = new Date().toISOString();
  if (message.is_topic_message || TOPIC_SERVICE_FIELDS.some((field) => message[field])) group.isForum = true;
  const threadId = messageThread(message, group);
  if (threadId) learnTopic(group, message, threadId, at);
  // Служебные события темы — не сообщения группы: в списке они были бы пустыми
  // строками. О самой теме бот уже узнал.
  if (TOPIC_SERVICE_FIELDS.some((field) => message[field])) {
    group.lastMessageAt = at;
    scheduleSave();
    return group;
  }
  const remembered = normalizeGroupMessage(message);
  remembered.threadId = threadId;
  group.messages.push(remembered);
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
  void tellAdminProblem('join-' + group.id + '-' + from.id, '👥 Заявка на вступление в «' + (group.title || 'группу') + '»: ' + group.joinRequests[group.joinRequests.length - 1].name + (from.username ? ' (@' + from.username + ')' : '') + '. Одобрить можно в Telegram или в «' + PLACES.groups + '».');
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
      isForum: Boolean(chat.is_forum),
    });
    if (group.isForum && !findTopic(group, GENERAL_TOPIC_ID)) rememberTopic(group, GENERAL_TOPIC_ID);
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

function rememberOwnMessage(group, messageId, text, kind, threadId = 0) {
  if (!messageId) return;
  group.messages.push({
    threadId,
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

// Номер темы для Telegram: «Общая» и группа без тем принимают сообщение без
// номера, а номер, которого там нет, Telegram отвергает.
function postThreadId(group, post) {
  const threadId = Math.floor(Number(post && post.threadId)) || 0;
  return threadId > GENERAL_TOPIC_ID && group.isForum ? threadId : 0;
}

// Ошибки Telegram про тему — человеческим языком.
function topicErrorMessage(group, post, error) {
  const message = String(error && error.message || '');
  const name = topicTitle(group, post.threadId);
  if (/thread not found|TOPIC_DELETED/i.test(message)) return 'Темы «' + name + '» нет: её могли удалить. Уберите её из списка тем или выберите другую.';
  if (/TOPIC_CLOSED|topic closed/i.test(message)) return 'Тема «' + name + '» закрыта — писать в неё нельзя. Откройте тему в Telegram или выберите другую.';
  return '';
}

// Метка источника для ссылки из поста: «g3» — группа №3, «g3t47» — раздел 47 в ней (см. source-title.mjs).
function groupSourceLabel(group, threadId = 0) {
  if (!group.sourceCode) {
    const used = groupList().map((item) => Number(item.sourceCode)).filter(Number.isFinite);
    group.sourceCode = String(Math.max(0, ...used) + 1);
    scheduleSave();
  }
  return 'g' + group.sourceCode + (threadId > GENERAL_TOPIC_ID ? 't' + threadId : '');
}

// Можно ли публиковать в группу от имени бота: причина отказа словами или пустая строка. Телеграм не пускает бота в
// канал без права «публикация сообщений»; в группе писать может любой участник, а закрытую для всех группу бот-админ
// тоже обходит, поэтому для групп достаточно того, что он администратор.
const PUBLISHER_STATUSES = ['administrator', 'creator'];

function publishBlocker(group) {
  if (!group) return 'Группа не найдена';
  if (!PUBLISHER_STATUSES.includes(group.status)) {
    return ['left', 'kicked'].includes(group.status) ? 'Бота нет в этой группе' : 'Бот не администратор — сделайте его администратором в Telegram';
  }
  if (group.type === 'channel' && !(group.rights && group.rights.can_post_messages)) return 'У бота нет права публиковать сообщения в канале';
  return '';
}

// Ссылка на сообщение: у публичной группы — по имени, у закрытой — вида t.me/c/<номер>/<сообщение>.
function messageLink(group, messageId, threadId = 0) {
  if (!group || !messageId) return '';
  const thread = threadId > GENERAL_TOPIC_ID ? '/' + threadId : '';
  if (group.username) return 'https://t.me/' + group.username + thread + '/' + messageId;
  const internal = String(group.id).replace(/^-100/, '');
  return /^\d+$/.test(internal) ? 'https://t.me/c/' + internal + thread + '/' + messageId : '';
}

// Объявление об объекте. «single» (по умолчанию): один пост — альбом или фото, всё в подписи, описание раскрывающейся
// цитатой. «split»: альбом с подписью, следом полный текст с кнопкой (если альбом ушёл, а текст нет, повторять нельзя —
// в группе окажутся два альбома, об этом говорит ошибка).
// listingMessage — всё, что уйдёт в группу: подпись, текст вместе с подписью канала, кнопки и фотографии. Тот же сбор
// нужен предпросмотру в панели, чтобы владелец видел ровно то, что получат подписчики.
function listingMessage(record, language, options = {}) {
  const publishing = normalizePublishing(data.config.publishing);
  const signature = options.withoutSignature ? { html: '', plain: '' } : formatLinks(signatureBlock(publishing));
  const built = buildListing(record, language, { reserve: signature.plain.length + 4, source: options.source, layout: options.layout, noPhotos: options.noPhotos });
  const quote = signature.html && publishing.signatureQuote;
  const signed = (body) => body + (signature.html ? '\n\n' + (quote ? '<blockquote>' + signature.html + '</blockquote>' : signature.html) : '');
  const oneCaption = built.layout === 'single' && built.images.length > 0;
  const caption = oneCaption ? signed(built.caption) : built.caption;
  const html = built.text ? signed(built.text) : '';
  // У альбома кнопок не бывает: ссылка на бота уже строкой в подписи.
  const markup = oneCaption && built.album ? null : postMarkup({ buttonText: built.buttonText, buttonUrl: built.buttonUrl, withoutSignature: options.withoutSignature });
  return { ...built, caption, html, markup, oneCaption, plainLength: plainOf(oneCaption ? caption : html).length };
}

async function sendListing(group, post, token = data.config.botToken) {
  const record = (Array.isArray(data.objects) ? data.objects : []).find((item) => item.id === (post.listing && post.listing.objectId));
  if (!record) throw new Error('Объекта уже нет в каталоге');
  const threadId = postThreadId(group, post);
  const built = listingMessage(record, post.listing.language, { layout: post.listing.layout, withoutSignature: post.withoutSignature, source: groupSourceLabel(group, threadId) });
  const html = built.html;
  const markup = built.markup;
  const threadOptions = threadId ? { threadId } : {};
  const feedThread = threadId || (group.isForum ? GENERAL_TOPIC_ID : 0);
  const photos = built.images;
  let albumIds = [];
  if (photos.length >= 2) {
    const album = await sendPhotoAlbum(group.id, photos, built.caption, token, { parseMode: 'HTML', ...threadOptions });
    albumIds = album.map((message) => Number(message.message_id)).filter(Boolean);
  } else if (photos.length === 1) {
    // Одно фото: в режиме «один пост» вместе с кнопкой; в «split» кнопка — под текстом.
    const photo = await sendPhotoMessage(group.id, photos[0], built.caption, token, built.oneCaption ? markup : null, { parseMode: 'HTML', ...threadOptions });
    albumIds = photo && photo.message_id ? [Number(photo.message_id)] : [];
  }
  if (albumIds.length) rememberOwnMessage(group, albumIds[0], plainOf(built.caption), 'photo', feedThread);
  let messageId = albumIds[0] || 0;
  if (html) {
    let sent;
    try {
      sent = await sendMessage(group.id, html, token, {
        track: false,
        parse_mode: 'HTML',
        ...(threadId ? { message_thread_id: threadId } : {}),
        ...(markup ? { reply_markup: markup } : {}),
        // В группе текст — ответ на альбом: видно, к чему он. В канале ответов на собственные посты нет.
        ...(albumIds.length && group.type !== 'channel' ? { reply_parameters: { message_id: albumIds[0], allow_sending_without_reply: true } } : {}),
      });
    } catch (error) {
      if (albumIds.length) throw new Error('Фотографии опубликованы, а текст — нет: ' + error.message + '. Повторно не отправляйте — в группе уже есть альбом.');
      throw error;
    }
    messageId = (sent && Number(sent.message_id)) || messageId;
    rememberOwnMessage(group, messageId, plainOf(html), 'text', feedThread);
  }
  if (messageId && post.pin) {
    const pinned = await telegramRequest(token, 'pinChatMessage', { chat_id: group.id, message_id: messageId, disable_notification: !post.notify })
      .then(() => true)
      .catch((error) => { recordError('Закрепление объявления', error); return false; });
    if (pinned) group.pinnedMessageId = messageId;
  }
  group.lastPostAt = new Date().toISOString();
  if (threadId) rememberTopic(group, threadId, { at: group.lastPostAt });
  // Что и куда уже опубликовано — для предупреждения «это объявление здесь уже было».
  record.publications = [
    // messageIds — все сообщения поста (альбом и текст): по ним пост удаляется из группы целиком.
    { groupId: group.id, title: cleanText(group.title, 200), language: built.language, at: group.lastPostAt, messageId: messageId || 0, messageIds: [...new Set([...albumIds, messageId].filter(Boolean))], threadId,
      // Из чего состоит пост — по этому он обновляется на месте: сообщение с фото (подпись) и отдельное текстовое.
      captionId: albumIds[0] || 0, textId: html ? messageId || 0 : 0, layout: built.layout, withoutSignature: Boolean(post.withoutSignature), updatedAt: '',
      link: messageLink(group, messageId || albumIds[0] || 0, threadId) },
    ...(Array.isArray(record.publications) ? record.publications : []),
  ].slice(0, 30);
  group.listingLanguage = built.language;
  scheduleSave();
  return messageId || 0;
}

// Обновить опубликованный пост на месте — по нынешним данным объекта (цена, статус, описание): правятся подпись фото и текст,
// фотографии и сообщения остаются. Пост, опубликованный прежней версией бота, не знает своего устройства — его обновить нельзя.
async function updateListingPost(group, record, entry, token = data.config.botToken) {
  if (!entry.layout || !(entry.captionId || entry.textId)) throw new Error('Этот пост опубликован прежней версией бота — обновить его нельзя. Удалите его и опубликуйте заново.');
  const hadPhotos = Boolean(entry.captionId);
  const built = listingMessage(record, entry.language, { layout: entry.layout, withoutSignature: entry.withoutSignature, source: groupSourceLabel(group, entry.threadId), noPhotos: !hadPhotos });
  if (hadPhotos && !built.images.length) throw new Error('У объекта больше нет фотографий — пост с фото обновить нельзя. Удалите его и опубликуйте заново.');
  // Кнопка «Смотреть в боте» — у одного фото и у текста; у проданного объекта её нет: ссылка вела бы в никуда.
  const noButtons = { inline_keyboard: [] };
  try {
    if (entry.captionId) {
      await telegramRequest(token, 'editMessageCaption', {
        chat_id: group.id,
        message_id: entry.captionId,
        caption: built.caption,
        parse_mode: 'HTML',
        ...(built.oneCaption && !built.album ? { reply_markup: built.markup || noButtons } : {}),
      });
    }
    if (entry.textId && built.html) {
      await telegramRequest(token, 'editMessageText', {
        chat_id: group.id,
        message_id: entry.textId,
        text: built.html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: built.markup || noButtons,
      });
    }
  } catch (error) {
    if (/message to edit not found|MESSAGE_ID_INVALID/i.test(String(error && error.message))) throw new Error('Поста в группе уже нет — его удалили. Уберите запись из списка.');
    throw error;
  }
  entry.updatedAt = new Date().toISOString();
  scheduleSave();
}

// Повтор без ссылки mailto, если Telegram её не принял.
async function postToGroup(group, post, token = data.config.botToken) {
  if (post && post.listing && post.listing.objectId) return sendListing(group, post, token);
  try {
    return await sendPost(group, post, token);
  } catch (error) {
    const friendly = postThreadId(group, post) ? topicErrorMessage(group, post, error) : '';
    if (friendly) throw new Error(friendly);
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
  const threadId = postThreadId(group, post);
  const threadOptions = threadId ? { threadId } : {};
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
    sent = await sendPhotoMessage(group.id, rubric.image, text, token, markup, { captionAbove: true, parseMode, ...threadOptions });
    plateSentInside = true;
  } else if (topImage) {
    const sendImage = ownTransparent ? sendDocumentMessage : sendPhotoMessage;
    if (text && plain.length <= CAPTION_LIMIT) {
      sent = await sendImage(group.id, topImage, text, token, markup, { parseMode, ...threadOptions });
    } else {
      sent = await sendImage(group.id, topImage, '', token, null, threadOptions);
      // Фотография уже в группе: если текст под ней не уйдёт, повторять весь
      // пост нельзя — в группе оказались бы две фотографии.
      if (text) {
        await sendMessage(group.id, text, token, { track: false, ...(threadId ? { message_thread_id: threadId } : {}), ...(parseMode ? { parse_mode: parseMode } : {}), ...(markup ? { reply_markup: markup } : {}) })
          .catch((error) => recordError('Текст поста под фотографией', error));
      }
    }
  } else {
    if (!text) throw new Error('Сообщение пустое');
    sent = await sendMessage(group.id, text, token, { track: false, ...(threadId ? { message_thread_id: threadId } : {}), ...(parseMode ? { parse_mode: parseMode } : {}), ...(markup ? { reply_markup: markup } : {}) });
  }
  const messageId = sent && Number(sent.message_id);
  rememberOwnMessage(group, messageId, plain, topImage || plateSentInside ? 'photo' : 'text', threadId || (group.isForum ? GENERAL_TOPIC_ID : 0));
  // Длинный пост или своё фото: плашка уходит отдельным сообщением следом.
  if (rubric && (rubric.placement !== 'top' || plateTransparent) && !plateSentInside) {
    const sendPlate = plateTransparent ? sendDocumentMessage : sendPhotoMessage;
    const plate = await sendPlate(group.id, rubric.image, '', token, null, threadOptions).catch((error) => {
      recordError('Плашка рубрики «' + rubric.name + '»', error);
      return null;
    });
    rememberOwnMessage(group, plate && Number(plate.message_id), '🏷 ' + rubric.name, 'photo', threadId || (group.isForum ? GENERAL_TOPIC_ID : 0));
  }
  if (messageId && post.pin) {
    // Сообщение уже опубликовано: неудачное закрепление — повод для записи в
    // журнал, а не для повторной публикации.
    const pinned = await telegramRequest(token, 'pinChatMessage', { chat_id: group.id, message_id: messageId, disable_notification: !post.notify })
      .then(() => true)
      .catch((error) => {
        recordError('Закрепление поста', error);
        return false;
      });
    if (pinned) group.pinnedMessageId = messageId;
  }
  group.lastPostAt = new Date().toISOString();
  if (threadId) rememberTopic(group, threadId, { at: group.lastPostAt });
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

// Обрыв связи не должен хоронить отложенный пост: он остаётся в очереди и
// уходит со следующей проверкой. После стольких неудачных попыток подряд пост
// признаётся несостоявшимся — иначе он молча висел бы в очереди вечно.
const GROUP_POST_ATTEMPTS = 5;

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
      post.attempts = 0;
      sent.push(post.id);
    } catch (error) {
      post.attempts = Number(post.attempts || 0) + 1;
      post.error = error.message;
      if (temporaryDeliveryError(error) && post.attempts < GROUP_POST_ATTEMPTS) {
        // Связи нет или Telegram попросил подождать: пробуем ещё раз позже.
        continue;
      }
      post.status = 'failed';
      recordError('Отложенная публикация в группу', error);
      void tellAdminProblem('group-post-' + post.id, '❌ Отложенный пост не опубликован: ' + cleanText(error.message, 200) + '. Подробности: «' + PLACES.groups + '».');
    }
  }
  if (sent.length || duePosts(now).length) scheduleSave();
  return sent;
}

function newGroupPost(fields) {
  return {
    id: crypto.randomUUID(),
    groupId: cleanText(fields.groupId, 40),
    threadId: Math.max(0, Math.floor(Number(fields.threadId)) || 0),
    text: cleanText(fields.text, 4000),
    buttonText: cleanText(fields.buttonText, 64),
    buttonUrl: cleanText(fields.buttonUrl, 500),
    image: fields.image || null,
    rubricId: cleanText(fields.rubricId, 60),
    withoutSignature: Boolean(fields.withoutSignature),
    pin: Boolean(fields.pin),
    notify: fields.notify !== false,
    // Объявление об объекте: текст и фотографии собираются в момент отправки, поэтому хранится только «что» и «на каком языке».
    listing: fields.listing && fields.listing.objectId ? { objectId: cleanText(fields.listing.objectId, 100), language: ['ru', 'en', 'es'].includes(fields.listing.language) ? fields.listing.language : 'ru', layout: fields.listing.layout === 'split' ? 'split' : 'single' } : null,
    status: 'scheduled',
    sendAt: fields.sendAt,
    createdAt: new Date().toISOString(),
    messageId: 0,
    error: '',
  };
}

export {
  GENERAL_TOPIC_ID,
  GROUP_POST_ATTEMPTS,
  GROUP_MESSAGE_LIMIT,
  activeGroups,
  duePosts,
  fetchAdministrators,
  findTopic,
  forgetGroupMessage,
  forgetTopic,
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
  groupSourceLabel,
  updateListingPost,
  listingMessage,
  publishBlocker,
  messageLink,
  sendListing,
  signatureBlock,
  signatureText,
  topicTitle,
  refreshGroup,
  refreshGroups,
  rememberGroupMessage,
  rememberTopic,
  runDueGroupPosts,
  upsertGroup,
};
