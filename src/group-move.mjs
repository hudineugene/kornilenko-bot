// Перенос сообщений между темами форума. В Telegram нет действия «переместить»: бот пересылает (или копирует)
// сообщение в нужную тему и удаляет оригинал. Автор у пересланного виден («Переслано от …»), у копии — нет.
//
// Два способа: вручную из панели (отмеченные сообщения) и автоматически — всё, что участники пишут в «Основную
// ленту», уходит в выбранную тему. Администраторов, ответы на сообщения и сообщения бота автоперенос не трогает.

import { cleanText } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { GENERAL_TOPIC_ID, fetchAdministrators, findTopic, forgetGroupMessage, groupById, messageLink, topicTitle } from './groups.mjs';

const MOVE_LIMIT = 50;
const ADMIN_CACHE_MS = 10 * 60 * 1000;
const ALBUM_WAIT_MS = 1500;
// Что в сообщении считается содержимым: служебные записи («вступил», «закрепил») не переносятся.
const CONTENT_FIELDS = ['text', 'caption', 'photo', 'video', 'document', 'voice', 'audio', 'animation', 'sticker', 'video_note', 'poll', 'location', 'contact', 'venue', 'dice'];

const adminCache = new Map();
const albums = new Map();
const warnedAt = new Map();

function defaultAutoMove() {
  return { enabled: false, fromThreadId: GENERAL_TOPIC_ID, toThreadId: 0, mode: 'forward', notify: false };
}

function normalizeAutoMove(value) {
  const base = defaultAutoMove();
  if (!value || typeof value !== 'object') return base;
  return {
    enabled: Boolean(value.enabled),
    fromThreadId: GENERAL_TOPIC_ID,
    toThreadId: Math.max(0, Math.floor(Number(value.toThreadId)) || 0),
    mode: value.mode === 'copy' ? 'copy' : 'forward',
    notify: Boolean(value.notify),
  };
}

function canDelete(group) {
  return Boolean(group && group.rights && group.rights.can_delete_messages);
}

function friendly(error) {
  const text = String(error && error.message || error || '');
  if (/message to forward not found|message to copy not found|MESSAGE_ID_INVALID/i.test(text)) return 'Telegram не нашёл сообщение: его уже удалили';
  if (/protected|can't be forwarded|CHAT_FORWARDS_RESTRICTED/i.test(text)) return 'В группе запрещена пересылка и копирование (защищённый контент)';
  if (/TOPIC_CLOSED|topic.*closed/i.test(text)) return 'Тема закрыта: бот не может писать в неё';
  if (/thread not found|TOPIC_ID_INVALID/i.test(text)) return 'Такой темы в группе нет';
  return text.slice(0, 160) || 'Не удалось';
}

// Копия или пересылка уже лежит в теме — теперь убираем оригинал. Пачкой, а если Telegram не принял — по одному.
async function deleteOriginals(group, ids, token) {
  try {
    await telegramRequest(token, 'deleteMessages', { chat_id: group.id, message_ids: ids });
    return [];
  } catch {
    const left = [];
    for (const id of ids) {
      try {
        await telegramRequest(token, 'deleteMessage', { chat_id: group.id, message_id: id });
      } catch (error) {
        left.push(id);
        recordError('Перенос сообщения: оригинал не удалился', error);
      }
    }
    return left;
  }
}

// Сообщения одного альбома переносятся вместе, иначе альбом развалится на отдельные фотографии.
function movingUnits(group, ids) {
  const known = new Map((group.messages || []).map((item) => [item.messageId, item]));
  const units = [];
  const byAlbum = new Map();
  for (const id of ids) {
    const album = known.get(id) && known.get(id).mediaGroupId;
    if (!album) {
      units.push({ ids: [id] });
      continue;
    }
    if (byAlbum.has(album)) continue;
    const members = (group.messages || []).filter((item) => item.mediaGroupId === album).map((item) => item.messageId).sort((a, b) => a - b);
    const unit = { ids: members.length ? members : [id] };
    byAlbum.set(album, unit);
    units.push(unit);
  }
  return units;
}

function addMovedToFeed(group, unit, sentIds, target, mode) {
  const known = new Map((group.messages || []).map((item) => [item.messageId, item]));
  unit.ids.forEach((id, index) => {
    const sentId = sentIds[index] || sentIds[0];
    if (!sentId) return;
    const was = known.get(id) || {};
    group.messages.push({
      messageId: sentId,
      userId: mode === 'copy' ? String(data.bot && data.bot.id || '') : was.userId || '',
      name: mode === 'copy' ? 'Бот' : was.name || 'Без имени',
      username: mode === 'copy' ? cleanText(data.bot && data.bot.username, 60) : was.username || '',
      text: was.text || '',
      kind: was.kind || 'text',
      fromBot: mode === 'copy',
      threadId: target > GENERAL_TOPIC_ID ? target : GENERAL_TOPIC_ID,
      mediaGroupId: '',
      date: new Date().toISOString(),
    });
  });
  if (group.messages.length > 200) group.messages = group.messages.slice(-200);
}

async function moveGroupMessages(group, rawIds, targetThreadId, options = {}) {
  const token = options.token || data.config.botToken;
  const mode = options.mode === 'copy' ? 'copy' : 'forward';
  if (!group || !group.isForum) throw new Error('В этой группе не включены темы');
  const target = Math.floor(Number(targetThreadId)) || 0;
  if (target > GENERAL_TOPIC_ID && !findTopic(group, target)) throw new Error('Такой темы нет в списке тем группы');
  const ids = [...new Set((Array.isArray(rawIds) ? rawIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).slice(0, MOVE_LIMIT);
  if (!ids.length) throw new Error('Не выбрано ни одного сообщения');
  if (!canDelete(group)) {
    throw new Error('У бота нет права удалять сообщения: без него после переноса остались бы копии в двух темах. Включите боту право «Удаление сообщений» в Telegram.');
  }
  const place = target > GENERAL_TOPIC_ID ? { message_thread_id: target } : {};
  const result = { moved: 0, failed: [], notDeleted: [], newIds: [] };
  for (const unit of movingUnits(group, ids)) {
    try {
      let sentIds;
      if (unit.ids.length > 1) {
        const sent = await telegramRequest(token, mode === 'copy' ? 'copyMessages' : 'forwardMessages', {
          chat_id: group.id, from_chat_id: group.id, message_ids: unit.ids, disable_notification: true, ...place,
        });
        sentIds = (Array.isArray(sent) ? sent : []).map((item) => Number(item && item.message_id)).filter(Boolean);
        // Часть альбома не ушла: оригиналы не трогаем, иначе потеряем то, что не скопировалось.
        if (sentIds.length !== unit.ids.length) throw new Error('Альбом перенесён не целиком — проверьте обе темы и удалите лишнее вручную');
      } else {
        const sent = await telegramRequest(token, mode === 'copy' ? 'copyMessage' : 'forwardMessage', {
          chat_id: group.id, from_chat_id: group.id, message_id: unit.ids[0], disable_notification: true, ...place,
        });
        sentIds = [Number(sent && sent.message_id)].filter(Boolean);
        if (!sentIds.length) throw new Error('Telegram не вернул номер нового сообщения');
      }
      const left = await deleteOriginals(group, unit.ids, token);
      result.notDeleted.push(...left);
      // Сначала запись о новом сообщении (автор берётся из старой), потом оригинал уходит из ленты.
      addMovedToFeed(group, unit, sentIds, target, mode);
      for (const id of unit.ids) if (!left.includes(id)) forgetGroupMessage(group, id);
      result.moved += unit.ids.length;
      result.newIds.push(...sentIds);
    } catch (error) {
      recordError('Перенос сообщения между темами', error);
      for (const id of unit.ids) result.failed.push({ messageId: id, error: friendly(error) });
    }
  }
  scheduleSave();
  return result;
}

// Правило автопереноса из панели: куда переносить и писать ли участнику.
function saveAutoMove(group, body) {
  const wanted = normalizeAutoMove(body);
  if (wanted.enabled) {
    if (!group.isForum) throw new Error('В группе не включены темы');
    if (!canDelete(group)) throw new Error('У бота нет права удалять сообщения: перенос без него оставлял бы копии. Включите право «Удаление сообщений».');
    const topic = findTopic(group, wanted.toThreadId);
    if (wanted.toThreadId <= GENERAL_TOPIC_ID || !topic) throw new Error('Выберите тему, куда переносить');
    if (topic.closed) throw new Error('Эта тема закрыта — бот не сможет писать в неё');
  }
  group.autoMove = wanted;
  scheduleSave();
  return wanted;
}

async function administratorIds(group, token) {
  const hit = adminCache.get(group.id);
  if (hit && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.ids;
  const list = await fetchAdministrators(group, token);
  const ids = new Set(list.map((item) => item.userId));
  adminCache.set(group.id, { at: Date.now(), ids });
  return ids;
}

async function runAutoMove(group, ids, rule, token, who) {
  const target = rule.toThreadId;
  const result = await moveGroupMessages(group, ids, target, { mode: rule.mode, token });
  if (result.moved && rule.notify) {
    const link = messageLink(group, result.newIds[0], target);
    const text = (who ? who + ', в' : 'В') + 'аше сообщение перенесено в тему «' + topicTitle(group, target) + '».' + (link ? '\n' + link : '');
    await sendMessage(group.id, text, token, { track: false }).catch((error) => recordError('Перенос: уведомление в «Основной ленте»', error));
  }
  return result;
}

// Новое сообщение в группе: если это не-администратор в «Основной ленте» и правило включено — переносим.
async function autoMoveFromGeneral(message, token = data.config.botToken) {
  const chat = message && message.chat;
  if (!chat || chat.type === 'private' || chat.type === 'channel') return false;
  const group = groupById(chat.id);
  const rule = group && normalizeAutoMove(group.autoMove);
  if (!rule || !rule.enabled || !group.isForum || !rule.toThreadId) return false;
  const from = message.from;
  // Только «Основная лента»: сообщения тем помечены is_topic_message. Ответы остаются там, где завязан разговор.
  if (message.is_topic_message || message.reply_to_message || message.is_automatic_forward || message.sender_chat) return false;
  if (!from || from.is_bot) return false;
  if (!CONTENT_FIELDS.some((field) => message[field])) return false;
  if (!canDelete(group)) {
    const last = warnedAt.get(group.id) || 0;
    if (Date.now() - last > 6 * 3600 * 1000) {
      warnedAt.set(group.id, Date.now());
      recordError('Перенос из «Основной ленты»: у бота нет права удалять сообщения', new Error('Включите боту право «Удаление сообщений» в «' + (group.title || 'группе') + '»'));
    }
    return false;
  }
  let admins;
  try {
    admins = await administratorIds(group, token);
  } catch (error) {
    recordError('Перенос из «Основной ленты»: не удалось получить администраторов', error);
    return false;
  }
  if (admins.has(String(from.id))) return false;
  const who = cleanText([from.first_name, from.last_name].filter(Boolean).join(' '), 60);
  if (message.media_group_id) {
    const key = group.id + ':' + message.media_group_id;
    const entry = albums.get(key) || { ids: [] };
    entry.ids.push(Number(message.message_id));
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      albums.delete(key);
      runAutoMove(group, entry.ids, rule, token, who).catch((error) => recordError('Перенос альбома из «Основной ленты»', error));
    }, ALBUM_WAIT_MS);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
    albums.set(key, entry);
    return true;
  }
  await runAutoMove(group, [Number(message.message_id)], rule, token, who);
  return true;
}

export { autoMoveFromGeneral, defaultAutoMove, moveGroupMessages, normalizeAutoMove, saveAutoMove };
