// Недельный дайджест и мягкий возврат. Оба выключены, пока владелец сам не включит
// их в «Настройки → Компания», и оба следуют трём правилам: только согласившимся на
// «Новости и акции», только когда есть что показать (пустое не отправляется) и с
// ограничением частоты. Каждое сообщение выключается одной кнопкой.

import { delay } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { markUnavailable, normalizeUser } from './users.mjs';
import { sendMessage } from './telegram.mjs';
import { localizedExact, objectPriceText, propertyReadyForLanguage, sendCatalogPage } from './catalog.mjs';
import { savedSearchMatches } from './saved-search.mjs';
import { similarPropertyRanking } from './similar.mjs';
import { temporaryDeliveryError, userUnavailableError } from './broadcasts.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { INTERACTION_TEXT } from './texts.mjs';
import { comebackText, digestCopy } from './digest-text.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
// Дайджест — раз в неделю; мягкий возврат — не чаще раза в три недели; друг за
// другом два сообщения одному клиенту не приходят (разводим на три дня).
const DIGEST_INTERVAL_MS = 7 * DAY_MS;
const COMEBACK_INTERVAL_MS = 21 * DAY_MS;
const SEPARATION_MS = 3 * DAY_MS;
// Молчит от пяти до десяти дней: раньше рано, позже уже не «возврат».
const COMEBACK_MIN_SILENCE_MS = 5 * DAY_MS;
const COMEBACK_MAX_SILENCE_MS = 10 * DAY_MS;
// Днём, а не ночью; и не пачкой — за один проход не больше этого числа клиентов.
const SEND_FROM_HOUR = 10;
const SEND_TO_HOUR = 19;
const PER_RUN = 30;
const SPACING_MS = 60;
const DIGEST_SHOWN = 4;
const LIST_LIMIT = 20;

function engagement() {
  return (data.config && data.config.engagement) || { digest: false, comeback: false };
}

function daytime(now) {
  return now.getHours() >= SEND_FROM_HOUR && now.getHours() < SEND_TO_HOUR;
}

// Согласился на «Новости и акции» и не отписался: те же условия, что у рассылок.
function consentedAudience(user) {
  return Boolean(user && user.chatId && !user.blocked && !user.broadcastsOptOut && user.newsConsentAt && user.preferredLanguage);
}

function elapsed(stamp, now) {
  const time = Date.parse(stamp || '');
  return Number.isFinite(time) ? now.getTime() - time : Infinity;
}

function readyRecords(user) {
  return data.objects.filter((record) => record.status === 'active' && propertyReadyForLanguage(record, user.preferredLanguage));
}

function recordLine(record, language, suffix = '') {
  const title = localizedExact(record.title, language, 80) || record.reference || record.id;
  const city = localizedExact(record.city, language, 60);
  return '• ' + [title, [city, objectPriceText(record, language)].filter(Boolean).join(' · ')].filter(Boolean).join(' — ') + suffix;
}

// Что показать клиенту в дайджесте: новые объекты (в первую очередь подходящие под
// его сохранённый поиск) и объекты, которые подешевели, с прошлого дайджеста.
function buildDigest(user, now = new Date()) {
  const language = user.preferredLanguage || 'ru';
  const since = user.digestAt ? Date.parse(user.digestAt) : now.getTime() - DIGEST_INTERVAL_MS;
  const records = readyRecords(user);
  const fresh = records.filter((record) => Date.parse(record.publishedAt || '') > since);
  const dropped = records.filter((record) => Number(record.previousPriceValue) > 0 && Number(record.priceValue) > 0
    && Number(record.priceValue) < Number(record.previousPriceValue) && Date.parse(record.priceChangedAt || '') > since);
  if (!fresh.length && !dropped.length) return null;
  const copy = digestCopy(language);
  const matching = fresh.filter((record) => savedSearchMatches(user, record));
  const others = fresh.filter((record) => !matching.includes(record));
  const chosen = [
    ...matching.map((record) => ({ record, suffix: ' · ' + copy.forYou })),
    ...others.map((record) => ({ record, suffix: '' })),
    ...dropped.filter((record) => !fresh.includes(record)).map((record) => ({ record, suffix: ' · 💰 ' + objectPriceText({ ...record, priceValue: record.previousPriceValue }, language) + ' → ' + objectPriceText(record, language) })),
  ].slice(0, DIGEST_SHOWN);
  const lines = [copy.title, ''];
  if (fresh.length) lines.push(copy.fresh + fresh.length);
  if (dropped.length) lines.push(copy.drops + dropped.length);
  lines.push('', ...chosen.map((item) => recordLine(item.record, language, item.suffix)));
  const rows = [];
  if (fresh.length) rows.push([{ text: copy.showNew, callback_data: 'digest:new' }]);
  if (dropped.length) rows.push([{ text: copy.showDrops, callback_data: 'digest:drops' }]);
  rows.push([{ text: copy.off, callback_data: 'digest:off' }]);
  return {
    text: lines.join('\n'),
    markup: { inline_keyboard: rows },
    newIds: fresh.map((record) => record.id).slice(0, LIST_LIMIT),
    dropIds: dropped.map((record) => record.id).slice(0, LIST_LIMIT),
  };
}

function digestDue(user, now) {
  return consentedAudience(user) && !user.digestOptOut
    && elapsed(user.digestAt, now) >= DIGEST_INTERVAL_MS
    && elapsed(user.comebackAt, now) >= SEPARATION_MS;
}

async function deliver(user, text, markup, token) {
  await sendMessage(user.chatId, text, token, { reply_markup: markup });
}

async function runWeeklyDigest(now = new Date(), token = data.config.botToken) {
  if (!engagement().digest || !data.config.active || !token || !daytime(now)) return [];
  const sent = [];
  for (const user of Object.values(data.users)) {
    if (sent.length >= PER_RUN) break;
    if (!digestDue(user, now)) continue;
    const digest = buildDigest(user, now);
    // Пустой дайджест не отправляется — и «неделя» не тратится: как только появится
    // что показать, он уйдёт в ближайший проход.
    if (!digest) continue;
    try {
      await deliver(user, digest.text, digest.markup, token);
      user.digestAt = now.toISOString();
      user.digestNewIds = digest.newIds;
      user.digestDropIds = digest.dropIds;
      sent.push(String(user.id));
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(user);
      else if (!temporaryDeliveryError(error)) user.digestAt = now.toISOString();
      recordError('Недельный дайджест', error);
    }
    await delay(SPACING_MS);
  }
  if (sent.length) scheduleSave();
  return sent;
}

// Подходящие объекты, появившиеся, пока клиент молчал: под его сохранённый поиск
// или похожие на то, что он смотрел.
function comebackMatches(user, now) {
  const since = Date.parse(user.lastSeenAt || '') || now.getTime() - 7 * DAY_MS;
  const language = user.preferredLanguage || 'ru';
  const fresh = readyRecords(user).filter((record) => Date.parse(record.publishedAt || '') > since);
  if (!fresh.length) return [];
  const viewed = (Array.isArray(user.recentlyViewed) ? user.recentlyViewed : []).slice(0, 3)
    .map((id) => data.objects.find((record) => record.id === id)).filter(Boolean);
  return fresh.filter((record) => savedSearchMatches(user, record)
    || viewed.some((source) => similarPropertyRanking(source, [record], language).length > 0)).slice(0, LIST_LIMIT);
}

function comebackDue(user, now) {
  if (!consentedAudience(user) || user.comebackOptOut) return false;
  if (!(Array.isArray(user.recentlyViewed) && user.recentlyViewed.length) && !user.savedSearch) return false;
  const silence = elapsed(user.lastSeenAt, now);
  return silence >= COMEBACK_MIN_SILENCE_MS && silence <= COMEBACK_MAX_SILENCE_MS
    && elapsed(user.comebackAt, now) >= COMEBACK_INTERVAL_MS
    && elapsed(user.digestAt, now) >= SEPARATION_MS;
}

async function runComeback(now = new Date(), token = data.config.botToken) {
  if (!engagement().comeback || !data.config.active || !token || !daytime(now)) return [];
  const sent = [];
  for (const user of Object.values(data.users)) {
    if (sent.length >= PER_RUN) break;
    if (!comebackDue(user, now)) continue;
    const matches = comebackMatches(user, now);
    if (!matches.length) continue;
    const copy = digestCopy(user.preferredLanguage || 'ru');
    try {
      await deliver(user, comebackText(user.preferredLanguage || 'ru', matches.length), {
        inline_keyboard: [[{ text: copy.comebackShow, callback_data: 'digest:back' }], [{ text: copy.comebackOff, callback_data: 'digest:coff' }]],
      }, token);
      user.comebackAt = now.toISOString();
      user.comebackIds = matches.map((record) => record.id);
      sent.push(String(user.id));
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(user);
      else if (!temporaryDeliveryError(error)) user.comebackAt = now.toISOString();
      recordError('Мягкий возврат', error);
    }
    await delay(SPACING_MS);
  }
  if (sent.length) scheduleSave();
  return sent;
}

async function handleDigestCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = digestCopy(language);
  const lists = { new: user.digestNewIds, drops: user.digestDropIds, back: user.comebackIds };
  if (Object.hasOwn(lists, action)) {
    await acknowledgeCallback(query, token);
    user.digestIds = (Array.isArray(lists[action]) ? lists[action] : []).slice(0, LIST_LIMIT);
    scheduleSave();
    // Объекты могли уйти из каталога с тех пор, как ушло сообщение.
    const readable = readyRecords(user).filter((record) => user.digestIds.includes(record.id));
    if (!readable.length) {
      await sendMessage(chatId, copy.nothing, token);
      return;
    }
    await sendCatalogPage(chatId, user, token, 0, 'digest');
    return;
  }
  const switches = { off: ['digestOptOut', true, copy.offDone, copy.on, 'digest:on'], on: ['digestOptOut', false, copy.onDone, null, ''], coff: ['comebackOptOut', true, copy.comebackOffDone, null, ''] };
  if (Object.hasOwn(switches, action)) {
    const [field, value, message, buttonText, buttonData] = switches[action];
    user[field] = value;
    scheduleSave();
    await acknowledgeCallback(query, token);
    await sendMessage(chatId, message, token, buttonText ? { reply_markup: { inline_keyboard: [[{ text: buttonText, callback_data: buttonData }]] } } : {});
    return;
  }
  await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
}

export {
  COMEBACK_INTERVAL_MS,
  DIGEST_INTERVAL_MS,
  buildDigest,
  comebackDue,
  comebackMatches,
  consentedAudience,
  digestDue,
  handleDigestCallback,
  runComeback,
  runWeeklyDigest,
};
