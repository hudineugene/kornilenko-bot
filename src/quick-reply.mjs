// Ответ клиенту шаблоном прямо из Telegram: кнопка «📝 Шаблон» на карточке заявки открывает список шаблонов
// из панели, выбранный показывается с предпросмотром на языке клиента, «Отправить» отправляет его как обычный ответ
// менеджера (тот же путь, что и ответ на карточку). Запись в переписку, этап и состояние карточки — как у ответа.

import { cleanText } from './util.mjs';
import { data } from './store.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { localized } from './catalog.mjs';
import { userById, userByChatId } from './users.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { INTERACTION_TEXT } from './texts.mjs';
import { adminCallbackAllowed, handleAdministratorReply } from './inquiries.mjs';
import { addUk } from './languages.mjs';

const OBJECT_FALLBACK = { ru: 'этот объект', en: 'this property', es: 'este inmueble' };
addUk(OBJECT_FALLBACK);
const PICK_LIFETIME_MS = 30 * 60 * 1000;
const MAX_PICKS = 60;

// Открытые списки: «чат:сообщение со списком» → какая заявка, на какой карточке и какие шаблоны по номерам.
// Живут в памяти: после перезапуска старые кнопки отвечают «устарело».
const picks = new Map();

function pickKey(query) {
  return String(query.message.chat.id) + ':' + String(query.message.message_id);
}

function forgetOldPicks(now = Date.now()) {
  for (const [key, pick] of picks) if (now - pick.createdAt > PICK_LIFETIME_MS) picks.delete(key);
  while (picks.size > MAX_PICKS) picks.delete(picks.keys().next().value);
}

function clientOf(inquiry) {
  return userById(inquiry.userId) || userByChatId(inquiry.chatId) || null;
}

// Текст шаблона для этого клиента: на его языке, иначе русский (как в панели); {имя} и {объект} подставлены.
function templateText(template, inquiry) {
  const user = clientOf(inquiry);
  const language = String((user && user.preferredLanguage) || inquiry.language || 'ru');
  const texts = template.text || {};
  const own = String(texts[language] || '');
  let body = own || String(texts.ru || texts.en || texts.es || '');
  const property = inquiry.propertyId ? data.objects.find((record) => String(record.id) === String(inquiry.propertyId)) : null;
  const name = String((user && (user.contactName || user.firstName)) || '');
  body = body.replace(/\{(?:имя|ім['’ʼ]?я|name)\}/gi, name).replace(/\{(?:объект|об['’ʼ]?єкт|property)\}/gi, property ? localized(property.title, own ? language : 'ru') : OBJECT_FALLBACK[own ? language : 'ru'] || OBJECT_FALLBACK.ru);
  return { text: body.trim(), language, missing: language !== 'ru' && !own && Boolean(body) };
}

function clientName(inquiry) {
  const user = clientOf(inquiry);
  return user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? '@' + user.username : '') : '';
}

function listMarkup(templates) {
  return {
    inline_keyboard: [
      ...templates.map((template, index) => [{ text: '📝 ' + cleanText(template.title, 60), callback_data: 'tpl:pick:' + index }]),
      [{ text: '✕ Закрыть', callback_data: 'tpl:x' }],
    ],
  };
}

// Нажатие «📝 Шаблон» на карточке заявки: список шаблонов отдельным сообщением под карточкой.
async function openTemplateList(query, token) {
  const inquiryId = String(query.data || '').split(':').slice(2).join(':');
  const inquiry = data.inquiries.find((item) => item.id === inquiryId);
  const templates = Array.isArray(data.replyTemplates) ? data.replyTemplates : [];
  if (!inquiry) {
    await acknowledgeCallback(query, token, 'Заявка не найдена — возможно, она удалена.');
    return;
  }
  if (!templates.length) {
    await acknowledgeCallback(query, token, 'Шаблонов пока нет: добавьте их в панели — «Клиенты → Шаблоны ответов».');
    return;
  }
  await acknowledgeCallback(query, token);
  const name = clientName(inquiry);
  const sent = await sendMessage(query.message.chat.id, '📝 Ответ шаблоном' + (name ? ' — ' + name : '') + '\nВыберите шаблон: сначала покажу текст, отправлю только после вашего «Отправить».', token, {
    track: false,
    reply_markup: listMarkup(templates),
    reply_parameters: { message_id: query.message.message_id, allow_sending_without_reply: true },
  });
  if (!sent || !sent.message_id) return;
  forgetOldPicks();
  picks.set(String(query.message.chat.id) + ':' + String(sent.message_id), {
    inquiryId: inquiry.id,
    cardMessageId: query.message.message_id,
    templateIds: templates.map((template) => template.id),
    createdAt: Date.now(),
  });
}

async function editPick(query, token, text, markup) {
  await telegramRequest(token, 'editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text,
    reply_markup: markup || { inline_keyboard: [] },
  }).catch(() => {});
}

// tpl:pick:<n> — предпросмотр; tpl:back — назад к списку; tpl:send:<n> — отправить; tpl:x — закрыть.
async function handleQuickReplyCallback(query, token) {
  if (!adminCallbackAllowed(query)) {
    await acknowledgeCallback(query, token, INTERACTION_TEXT.ru.stale);
    return;
  }
  const parts = String(query.data || '').split(':');
  if (parts[0] === 'inq') {
    await openTemplateList(query, token);
    return;
  }
  const action = parts[1];
  const pick = picks.get(pickKey(query));
  if (!pick || Date.now() - pick.createdAt > PICK_LIFETIME_MS) {
    await acknowledgeCallback(query, token, INTERACTION_TEXT.ru.stale);
    await editPick(query, token, '📝 Список устарел — нажмите «📝 Шаблон» на карточке ещё раз.');
    return;
  }
  const inquiry = data.inquiries.find((item) => item.id === pick.inquiryId);
  const templates = Array.isArray(data.replyTemplates) ? data.replyTemplates : [];
  if (action === 'x') {
    picks.delete(pickKey(query));
    await acknowledgeCallback(query, token);
    await telegramRequest(token, 'deleteMessage', { chat_id: query.message.chat.id, message_id: query.message.message_id }).catch(() => {});
    return;
  }
  if (!inquiry) {
    await acknowledgeCallback(query, token, 'Заявка не найдена — возможно, она удалена.');
    return;
  }
  if (action === 'back') {
    await acknowledgeCallback(query, token);
    const name = clientName(inquiry);
    await editPick(query, token, '📝 Ответ шаблоном' + (name ? ' — ' + name : '') + '\nВыберите шаблон.', listMarkup(templates));
    return;
  }
  const index = Number(parts[2] != null ? parts[2] : NaN);
  const template = Number.isInteger(index) ? templates.find((item) => item.id === pick.templateIds[index]) : null;
  if (!template) {
    await acknowledgeCallback(query, token, 'Этого шаблона уже нет — выберите из списка.');
    await editPick(query, token, '📝 Выберите шаблон.', listMarkup(templates));
    return;
  }
  const found = templateText(template, inquiry);
  if (!found.text) {
    await acknowledgeCallback(query, token, 'В шаблоне нет текста.');
    return;
  }
  if (action === 'pick') {
    await acknowledgeCallback(query, token);
    const name = clientName(inquiry);
    await editPick(query, token, [
      '📝 ' + cleanText(template.title, 80) + (name ? ' → ' + name : ''),
      found.missing ? '⚠️ Шаблона на языке клиента (' + found.language.toUpperCase() + ') нет — уйдёт русский текст.' : '',
      '',
      cleanText(found.text, 3000),
    ].filter((line, position) => line !== '' || position > 1).join('\n'), {
      inline_keyboard: [
        [{ text: '✅ Отправить', callback_data: 'tpl:send:' + index }],
        [{ text: '← К списку', callback_data: 'tpl:back' }],
      ],
    });
    return;
  }
  if (action === 'send') {
    // Один раз: пока отправка идёт или уже прошла, список закрыт.
    picks.delete(pickKey(query));
    await acknowledgeCallback(query, token);
    const lastReplyId = () => { const replies = inquiry.replies || []; return replies.length ? replies[replies.length - 1].id : ''; };
    const before = lastReplyId();
    const { asAuthor } = await import('./agent-journal.mjs');
    await asAuthor('manager', () => handleAdministratorReply({
      chat: query.message.chat,
      message_id: pick.cardMessageId,
      text: found.text,
      reply_to_message: { message_id: pick.cardMessageId, from: data.bot && data.bot.id ? { id: data.bot.id } : undefined },
    }, token));
    // Ответ записан в заявку только после того, как Telegram принял сообщение клиенту.
    const delivered = lastReplyId() !== before;
    await editPick(query, token, delivered ? '✅ Отправлено: ' + cleanText(template.title, 80) : '⚠️ Не получилось отправить — ответьте на карточку вручную.');
    return;
  }
  await acknowledgeCallback(query, token, INTERACTION_TEXT.ru.stale);
}

export { handleQuickReplyCallback, templateText };
