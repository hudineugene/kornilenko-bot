// /post — публикация объекта в группы прямо из Telegram, без панели (с телефона, в дороге).
//
// Диалог одним сообщением, которое меняется на месте: список объектов → экран «куда» (группы и разделы флажками, язык,
// вид поста) → «Опубликовать» → итог со ссылками на посты. Публикует тот же код, что и панель (listing-publish.mjs), —
// те же проверки прав, те же посты. Только владелец: публикация видна всем подписчикам и откатывается лишь удалением.

import { cleanText } from './util.mjs';
import { PLACES } from './places.mjs';
import { data } from './store.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { adminChatFor } from './inquiries.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { localized, objectPriceText } from './catalog.mjs';
import { listingTargets, runListingPublish } from './listing-publish.mjs';

const PAGE_SIZE = 6;
const DRAFT_TTL_MS = 30 * 60 * 1000;
const LANGUAGE_BUTTONS = [['auto', 'Как в группе'], ['ru', 'RU'], ['en', 'EN'], ['es', 'ES']];

// Выбор хранится в памяти, а не в данных: через полчаса он всё равно никому не нужен, а формат файла не растёт.
const drafts = new Map();

function draftFor(chatId) {
  const draft = drafts.get(String(chatId));
  if (!draft || Date.now() - draft.at > DRAFT_TTL_MS) {
    drafts.delete(String(chatId));
    return null;
  }
  return draft;
}

function publishableObjects() {
  return (Array.isArray(data.objects) ? data.objects : []).filter((record) => ['active', 'reserved'].includes(record.status));
}

function objectTitle(record) {
  return localized(record.title, 'ru') || record.reference || 'Объект';
}

function short(text, limit) {
  const value = String(text || '');
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function objectsScreen(page) {
  const objects = publishableObjects();
  const pages = Math.max(1, Math.ceil(objects.length / PAGE_SIZE));
  const index = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const shown = objects.slice(index * PAGE_SIZE, index * PAGE_SIZE + PAGE_SIZE);
  const rows = shown.map((record) => [{ text: short(objectTitle(record) + ' · ' + objectPriceText(record, 'ru'), 60), callback_data: 'post:s:' + record.id }]);
  if (pages > 1) {
    const nav = [];
    if (index > 0) nav.push({ text: '◀️', callback_data: 'post:o:' + (index - 1) });
    nav.push({ text: (index + 1) + ' / ' + pages, callback_data: 'post:o:' + index });
    if (index < pages - 1) nav.push({ text: '▶️', callback_data: 'post:o:' + (index + 1) });
    rows.push(nav);
  }
  rows.push([{ text: '✕ Отмена', callback_data: 'post:x' }]);
  return { text: '🚀 Публикация в группы\nКакой объект публикуем?', markup: { inline_keyboard: rows } };
}

function targetsScreen(draft) {
  const record = (data.objects || []).find((item) => item.id === draft.objectId);
  const chosen = draft.picked.size;
  const rows = draft.targets.map((target, index) => [{ text: short((draft.picked.has(index) ? '☑ ' : '☐ ') + target.label, 60), callback_data: 'post:t:' + index }]);
  rows.push(LANGUAGE_BUTTONS.map(([code, label]) => ({ text: (draft.language === code ? '✓ ' : '') + label, callback_data: 'post:l:' + code })));
  rows.push([
    { text: (draft.layout === 'single' ? '✓ ' : '') + 'Один пост', callback_data: 'post:v:single' },
    { text: (draft.layout === 'split' ? '✓ ' : '') + 'Фото + текст', callback_data: 'post:v:split' },
  ]);
  rows.push([{ text: '✅ Опубликовать' + (chosen ? ' · ' + chosen : ''), callback_data: 'post:go' }]);
  rows.push([{ text: '⬅️ Другой объект', callback_data: 'post:o:0' }, { text: '✕ Отмена', callback_data: 'post:x' }]);
  const language = draft.language === 'auto' ? 'язык — как в каждой группе' : 'язык — ' + draft.language.toUpperCase();
  return {
    text: ['🚀 Публикация в группы', '🏡 ' + (record ? objectTitle(record) + ' · ' + objectPriceText(record, 'ru') : '—'), '', 'Отметьте, куда публиковать (выбрано: ' + chosen + '). ' + language[0].toUpperCase() + language.slice(1) + '.'].join('\n'),
    markup: { inline_keyboard: rows },
  };
}

async function editScreen(query, token, screen) {
  try {
    await telegramRequest(token, 'editMessageText', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: screen.text,
      disable_web_page_preview: true,
      reply_markup: screen.markup || { inline_keyboard: [] },
    });
  } catch (error) {
    if (!/message is not modified/i.test(String(error && error.message))) throw error;
  }
}

// /post в чате владельца.
async function startPostCommand(chat, token) {
  if (!chat.main) {
    await sendMessage(chat.chatId, '🔒 Публикация в группы — только у владельца: пост видят все подписчики. Попросите владельца или откройте панель.', token, { track: false });
    return;
  }
  if (!listingTargets().length) {
    await sendMessage(chat.chatId, 'Нет групп и каналов, куда можно публиковать: бот должен быть администратором. Подключить и проверить — «' + PLACES.groups + '».', token, { track: false });
    return;
  }
  if (!publishableObjects().length) {
    await sendMessage(chat.chatId, 'В каталоге нет объектов, которые клиенты видят, — публиковать нечего.', token, { track: false });
    return;
  }
  drafts.delete(String(chat.chatId));
  const screen = objectsScreen(0);
  await sendMessage(chat.chatId, screen.text, token, { track: false, reply_markup: screen.markup });
}

async function handlePostCallback(query, token) {
  const chat = query.message && query.message.chat ? adminChatFor(query.message.chat.id) : null;
  if (!chat) {
    await acknowledgeCallback(query, token, 'Эта кнопка устарела.');
    return;
  }
  if (!chat.main) {
    await acknowledgeCallback(query, token, 'Публикация в группы — только у владельца.');
    return;
  }
  const [, action, ...rest] = String(query.data || '').split(':');
  const value = rest.join(':');
  const chatKey = String(chat.chatId);

  if (action === 'x') {
    drafts.delete(chatKey);
    await acknowledgeCallback(query, token);
    await editScreen(query, token, { text: 'Публикация отменена.' });
    return;
  }
  if (action === 'o') {
    drafts.delete(chatKey);
    await acknowledgeCallback(query, token);
    await editScreen(query, token, objectsScreen(Number(value)));
    return;
  }
  if (action === 's') {
    const record = publishableObjects().find((item) => item.id === value);
    if (!record) {
      await acknowledgeCallback(query, token, 'Объект не найден — возможно, его уже скрыли.');
      return;
    }
    const targets = listingTargets();
    if (!targets.length) {
      await acknowledgeCallback(query, token, 'Нет групп, куда можно публиковать.');
      return;
    }
    const draft = { objectId: record.id, targets, picked: new Set(), language: 'auto', layout: 'single', at: Date.now() };
    drafts.set(chatKey, draft);
    await acknowledgeCallback(query, token);
    await editScreen(query, token, targetsScreen(draft));
    return;
  }

  const draft = draftFor(chatKey);
  if (!draft) {
    await acknowledgeCallback(query, token, 'Выбор устарел — начните заново: /post');
    return;
  }
  draft.at = Date.now();
  if (action === 't') {
    const index = Number(value);
    if (!draft.targets[index]) {
      await acknowledgeCallback(query, token, 'Список групп изменился — начните заново: /post');
      return;
    }
    if (draft.picked.has(index)) draft.picked.delete(index);
    else draft.picked.add(index);
  } else if (action === 'l' && LANGUAGE_BUTTONS.some(([code]) => code === value)) {
    draft.language = value;
  } else if (action === 'v' && ['single', 'split'].includes(value)) {
    draft.layout = value;
  } else if (action === 'go') {
    if (!draft.picked.size) {
      await acknowledgeCallback(query, token, 'Сначала отметьте, куда публиковать.');
      return;
    }
    const record = (data.objects || []).find((item) => item.id === draft.objectId);
    if (!record) {
      await acknowledgeCallback(query, token, 'Объект не найден.');
      return;
    }
    await acknowledgeCallback(query, token);
    drafts.delete(chatKey);
    await editScreen(query, token, { text: '⏳ Публикуем… (' + draft.picked.size + ')' });
    const targets = [...draft.picked].sort((a, b) => a - b).map((index) => draft.targets[index]).map((target) => ({
      groupId: target.groupId,
      threadId: target.threadId,
      language: draft.language === 'auto' ? target.language : draft.language,
    }));
    const { status, body } = await runListingPublish(record, { targets, layout: draft.layout });
    if (status !== 200) {
      await editScreen(query, token, { text: '❌ Не опубликовано: ' + cleanText(body.error, 300) });
      return;
    }
    const good = body.results.filter((row) => row.ok).length;
    await editScreen(query, token, {
      text: [
        (good === body.results.length ? '✅ Опубликовано' : good ? '⚠️ Опубликовано частично' : '❌ Не получилось') + ': ' + good + ' из ' + body.results.length,
        '🏡 ' + objectTitle(record),
        '',
        ...body.results.map((row) => (row.ok ? '✓ ' : '✕ ') + short(row.title, 60) + (row.ok ? (row.link ? ' — ' + row.link : '') : ' — ' + short(row.error, 200))),
      ].join('\n'),
    });
    return;
  }
  await acknowledgeCallback(query, token);
  await editScreen(query, token, targetsScreen(draft));
}

export { handlePostCallback, startPostCommand };
