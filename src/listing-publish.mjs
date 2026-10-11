// Публикация объявления об объекте в несколько групп — общая часть панели и команды /post в Telegram.
//
// runListingPublish не знает ни про HTTP, ни про чат: принимает объект и «что куда» и возвращает { status, body } (200 с
// результатами по каждой группе или 4xx с понятной причиной). Одна неудача остальные группы не останавливает.

import { cleanText, delay } from './util.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { GENERAL_TOPIC_ID, groupById, groupList, messageLink, newGroupPost, postToGroup, publishBlocker, refreshGroup } from './groups.mjs';
import { LANGUAGES } from './languages.mjs';

const LISTING_LANGUAGES = LANGUAGES;
const MAX_LISTING_TARGETS = 20;
const MAX_SCHEDULED_POSTS = 50;
// Telegram разрешает в группу около 20 сообщений в минуту: между группами делаем паузу, а в одну — альбом и текст.
const LISTING_PAUSE_MS = 1500;

// Номер раздела для Telegram: «Общий» и группа без тем принимают сообщение без номера, а номер, которого там нет, Telegram
// отвергает.
function requestedThread(group, value) {
  const threadId = Math.floor(Number(value)) || 0;
  return threadId > GENERAL_TOPIC_ID && group.isForum ? threadId : 0;
}

function futureDate(value) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) throw new Error('Укажите дату и время публикации');
  if (time < Date.now() - 60 * 1000) throw new Error('Дата публикации уже прошла');
  return new Date(time).toISOString();
}

// Куда можно публиковать: группы и каналы, где бот администратор (у канала — с правом публикации); в группе с разделами —
// «Общий» и каждый известный раздел отдельным местом. Список для Telegram-экрана; панель строит такой же из state.groups.
function listingTargets() {
  const out = [];
  for (const group of groupList()) {
    if (!['administrator', 'creator'].includes(group.status) || publishBlocker(group)) continue;
    const title = group.title || group.id;
    if (!group.isForum) {
      out.push({ groupId: group.id, threadId: 0, label: title, language: group.listingLanguage || 'ru' });
      continue;
    }
    out.push({ groupId: group.id, threadId: 0, label: title + ' · Общий раздел', language: group.listingLanguage || 'ru' });
    for (const topic of (Array.isArray(group.topics) ? group.topics : []).filter((item) => item.id > GENERAL_TOPIC_ID)) {
      out.push({ groupId: group.id, threadId: topic.id, label: title + ' · ' + (topic.name || 'раздел №' + topic.id), language: group.listingLanguage || 'ru' });
    }
  }
  return out;
}

// body: { targets: [{ groupId, threadId, language }], layout, withoutSignature, pin, notify, sendAt }
async function runListingPublish(record, body) {
  const list = Array.isArray(body.targets) ? body.targets : [];
  if (!list.length) return { status: 400, body: { error: 'Выберите хотя бы одну группу' } };
  if (list.length > MAX_LISTING_TARGETS) return { status: 400, body: { error: 'Не больше ' + MAX_LISTING_TARGETS + ' групп за раз' } };
  if (!['active', 'reserved'].includes(record.status)) return { status: 400, body: { error: 'Объект скрыт или продан — по ссылке из поста клиент его не увидит. Верните объект в каталог и повторите.' } };
  const seen = new Set();
  const targets = [];
  for (const item of list) {
    const group = groupById(cleanText(item && item.groupId, 40));
    if (!group) continue;
    const threadId = requestedThread(group, item.threadId);
    const key = group.id + ':' + threadId;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ group, threadId, language: LISTING_LANGUAGES.includes(item.language) ? item.language : 'ru' });
  }
  if (!targets.length) return { status: 404, body: { error: 'Выбранные группы не найдены' } };
  let sendAt = '';
  if (body.sendAt) {
    try {
      sendAt = futureDate(body.sendAt);
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
    const queued = (data.groupPosts || []).filter((item) => item.status === 'scheduled').length;
    if (queued + targets.length > MAX_SCHEDULED_POSTS) return { status: 400, body: { error: 'Слишком много отложенных публикаций' } };
  }
  const layout = body.layout === 'split' ? 'split' : 'single';
  const options = { withoutSignature: body.withoutSignature === true, pin: body.pin === true, notify: body.notify !== false };
  const results = [];
  for (const [index, target] of targets.entries()) {
    const { group, threadId, language } = target;
    const row = { groupId: group.id, title: group.title || group.id, threadId, language, ok: false, error: '', link: '', scheduled: false };
    try {
      // Права могли измениться с прошлой проверки: смотрим свежие, а не те, что в списке.
      if (!sendAt) await refreshGroup(group);
      const blocker = publishBlocker(group);
      if (blocker) throw new Error(blocker);
      const fields = { ...options, groupId: group.id, threadId, listing: { objectId: record.id, language, layout } };
      if (sendAt) {
        data.groupPosts = [...(data.groupPosts || []), newGroupPost({ ...fields, sendAt })];
        row.scheduled = true;
      } else {
        const messageId = await postToGroup(group, newGroupPost({ ...fields, sendAt: new Date().toISOString() }));
        row.link = messageLink(group, messageId, threadId);
      }
      row.ok = true;
    } catch (error) {
      row.error = cleanText(error && error.message, 400) || 'Не удалось опубликовать';
      recordError('Публикация объявления в группу «' + (group.title || group.id) + '»', error);
    }
    results.push(row);
    if (!sendAt && index < targets.length - 1) await delay(LISTING_PAUSE_MS);
  }
  saveDataNow();
  return { status: 200, body: { ok: results.some((row) => row.ok), results, publications: record.publications || [] } };
}

export { LISTING_LANGUAGES, MAX_SCHEDULED_POSTS, futureDate, listingTargets, requestedThread, runListingPublish };
