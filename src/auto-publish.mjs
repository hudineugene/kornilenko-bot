// Автопубликация: два правила, оба по умолчанию выключены и включаются владельцем в «Публикации → Каналы и группы».
//
// 1. Новые объекты. Объект впервые стал виден клиентам — в выбранные группы и разделы ставятся ОТЛОЖЕННЫЕ посты (через
//    delayMinutes, по умолчанию 30 минут). Это не мгновенная отправка: за полчаса можно поправить ошибку или отменить пост в
//    «Публикации → Очередь и история». Объект публикуется автоматически один раз (метка autoPublishedAt).
// 2. Свежие посты. Поменялись цена, статус или описание объекта — уже опубликованные посты правятся на месте (updateListingPost),
//    без новых сообщений в группах.
// Оба правила работают только через те же функции, что и ручная публикация: те же проверки прав и те же записи об опубликованном.

import { cleanText } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { groupById, newGroupPost, publishBlocker, updateListingPost } from './groups.mjs';
import { LISTING_LANGUAGES, MAX_SCHEDULED_POSTS, requestedThread } from './listing-publish.mjs';
import { propertyReadyForLanguage } from './catalog.mjs';
import { recordError } from './analytics.mjs';
import { tellAdminProblem } from './notify-plan.mjs';

const MAX_AUTO_TARGETS = 10;
const MAX_DELAY_MINUTES = 24 * 60;
const VISIBLE = ['active', 'reserved'];

// Настройки хранятся в config.autoPublish (появляется при первом сохранении, формат файла не меняется) и читаются через
// эту функцию: любой мусор в файле превращается в безопасные значения «выключено».
function autoPublishConfig() {
  const raw = data.config && data.config.autoPublish && typeof data.config.autoPublish === 'object' ? data.config.autoPublish : {};
  const rawNew = raw.newObjects && typeof raw.newObjects === 'object' ? raw.newObjects : {};
  const targets = [];
  const seen = new Set();
  for (const item of Array.isArray(rawNew.targets) ? rawNew.targets : []) {
    const groupId = cleanText(item && item.groupId, 40);
    const threadId = Math.max(0, Math.floor(Number(item && item.threadId)) || 0);
    const key = groupId + ':' + threadId;
    if (!groupId || seen.has(key)) continue;
    seen.add(key);
    targets.push({ groupId, threadId, language: LISTING_LANGUAGES.includes(item && item.language) ? item.language : 'ru' });
    if (targets.length >= MAX_AUTO_TARGETS) break;
  }
  const delay = Math.floor(Number(rawNew.delayMinutes));
  return {
    newObjects: {
      enabled: rawNew.enabled === true,
      targets,
      layout: rawNew.layout === 'split' ? 'split' : 'single',
      delayMinutes: Number.isFinite(delay) ? Math.min(MAX_DELAY_MINUTES, Math.max(0, delay)) : 30,
    },
    keepFresh: raw.keepFresh === true,
  };
}

// Сохранить настройки из панели: всё, что не годится, отбрасывается при чтении (autoPublishConfig).
function saveAutoPublishConfig(body) {
  data.config.autoPublish = { newObjects: { ...(body && body.newObjects) }, keepFresh: Boolean(body && body.keepFresh) };
  data.config.autoPublish = autoPublishConfig();
  scheduleSave();
  return data.config.autoPublish;
}

function changedForPosts(before, record) {
  if (!before) return false;
  if (before.status !== record.status) return true;
  if (Number(before.priceValue || 0) !== Number(record.priceValue || 0) || Boolean(before.priceFrom) !== Boolean(record.priceFrom)) return true;
  return ['title', 'description', 'city', 'district', 'address'].some((field) => JSON.stringify(before[field] || {}) !== JSON.stringify(record[field] || {}));
}

// Вызывается после создания и после сохранения объекта (alerts.mjs → queuePropertyAlerts).
function autoPublishAfterSave(record, before) {
  const config = autoPublishConfig();
  if (!data.config.botToken || !data.config.active) return;
  const visible = VISIBLE.includes(record.status);
  const wasVisible = Boolean(before) && VISIBLE.includes(before.status);

  // 1. Новый объект — отложенные посты в выбранные места.
  if (config.newObjects.enabled && visible && !wasVisible && !record.autoPublishedAt && config.newObjects.targets.length) {
    const queued = [];
    const skipped = [];
    const sendAt = new Date(Date.now() + config.newObjects.delayMinutes * 60 * 1000).toISOString();
    for (const target of config.newObjects.targets) {
      const group = groupById(target.groupId);
      const label = (group && group.title || target.groupId) + (target.threadId ? ' · раздел ' + target.threadId : '');
      if (!group) { skipped.push(label + ' — группа больше не подключена'); continue; }
      const blocker = publishBlocker(group);
      if (blocker) { skipped.push(label + ' — ' + blocker); continue; }
      // Недозаполненную карточку не публикуем: клиент её на этом языке всё равно не увидит.
      if (!propertyReadyForLanguage(record, target.language)) { skipped.push(label + ' — карточка не заполнена на языке ' + target.language.toUpperCase()); continue; }
      const waiting = (data.groupPosts || []).filter((item) => item.status === 'scheduled').length;
      if (waiting >= MAX_SCHEDULED_POSTS) { skipped.push(label + ' — слишком много отложенных постов'); continue; }
      data.groupPosts = [...(data.groupPosts || []), newGroupPost({
        groupId: group.id,
        threadId: requestedThread(group, target.threadId),
        listing: { objectId: record.id, language: target.language, layout: config.newObjects.layout },
        sendAt,
      })];
      queued.push(label);
    }
    record.autoPublishedAt = new Date().toISOString();
    scheduleSave();
    const title = cleanText((record.title && (record.title.ru || record.title.en || record.title.es)) || record.reference, 100);
    void tellAdminProblem('autopub-new-' + record.id + '-' + Date.now(), [
      '🚀 Новый объект «' + title + '»: ' + (queued.length ? 'пост поставлен в очередь (' + queued.join(', ') + ') — уйдёт ' + (config.newObjects.delayMinutes ? 'через ' + config.newObjects.delayMinutes + ' мин' : 'сейчас') + '. Отменить — «Публикации → Очередь и история».' : 'в группы не поставлен.'),
      ...(skipped.length ? ['Не поставлено: ' + skipped.join('; ') + '.'] : []),
    ].join('\n'));
  }

  // 2. Изменилось то, что видно в посте, — правим уже опубликованные посты на месте.
  if (config.keepFresh && changedForPosts(before, record)) {
    const posted = (Array.isArray(record.publications) ? record.publications : []).filter((entry) => entry.layout);
    if (posted.length) void refreshPosts(record, posted);
  }
}

async function refreshPosts(record, posted) {
  let updated = 0;
  const failures = [];
  for (const entry of posted) {
    try {
      const group = groupById(entry.groupId);
      if (!group) throw new Error('группа больше не подключена');
      await updateListingPost(group, record, entry);
      updated += 1;
    } catch (error) {
      failures.push((entry.title || entry.groupId) + ' — ' + cleanText(error && error.message, 160));
      recordError('Автообновление поста в группе «' + (entry.title || entry.groupId) + '»', error);
    }
  }
  scheduleSave();
  const title = cleanText((record.title && (record.title.ru || record.title.en || record.title.es)) || record.reference, 100);
  await tellAdminProblem('autopub-fresh-' + record.id + '-' + Date.now(), [
    '♻️ «' + title + '»: ' + (updated ? 'обновил посты в группах — ' + updated + '.' : 'посты не обновлены.'),
    ...(failures.length ? ['Не удалось: ' + failures.join('; ') + '.'] : []),
  ].join('\n'));
}

export { autoPublishAfterSave, autoPublishConfig, saveAutoPublishConfig };
