// Пользователи: карточки, поиск, источник, выгрузка и удаление данных.

import { cleanText, clone } from './util.mjs';
import { data } from './store.mjs';
import { adminMuteNotices, adminNotifyTimes, inquiryTimes } from './inquiries.mjs';
import { normalizedCatalogFilter } from './catalog.mjs';

// data.users is a plain object, so ids such as "__proto__" must not reach it
// directly: that would return Object.prototype and let a PATCH pollute it.
function userById(id) {
  const key = String(id);
  return Object.hasOwn(data.users, key) ? data.users[key] : undefined;
}

// userByChatId runs for every outgoing message, so it uses an index instead
// of scanning all users. normalizeUser keeps the index current.
const usersByChatId = new Map();

function indexUser(user) {
  if (user && user.chatId != null && user.chatId !== '') usersByChatId.set(String(user.chatId), user);
}

function rebuildUserIndex() {
  usersByChatId.clear();
  for (const user of Object.values(data.users)) indexUser(user);
}

function userByChatId(chatId) {
  const key = String(chatId);
  const indexed = usersByChatId.get(key);
  if (indexed && userById(indexed.id) === indexed && String(indexed.chatId) === key) return indexed;
  const found = Object.values(data.users).find((user) => String(user.chatId) === key);
  if (found) indexUser(found);
  return found;
}

// ru / en / es from Telegram's language_code ("en-US" counts as en); empty
// for any other language.
// Advertising links carry a label: t.me/<bot>?start=src_instagram.
const LEAD_SOURCE_PATTERN = /^src_([a-z0-9_-]{1,40})$/i;

function leadSourceFromPayload(payload) {
  const match = cleanText(payload, 100).match(LEAD_SOURCE_PATTERN);
  return match ? match[1].toLowerCase() : '';
}

function telegramInterfaceLanguage(user) {
  const code = String(user && user.languageCode || '').toLowerCase().split('-')[0];
  return ['ru', 'en', 'es'].includes(code) ? code : '';
}

function normalizeUser(from, chatId, countMessage = true) {
  const id = String(from.id);
  const previous = userById(id) || {};
  const user = {
    id,
    chatId,
    firstName: from.first_name || '',
    lastName: from.last_name || '',
    username: from.username || '',
    languageCode: from.language_code || '',
    preferredLanguage: previous.preferredLanguage || '',
    contactName: previous.contactName || '',
    phone: previous.phone || '',
    preferredContactTime: previous.preferredContactTime || '',
    firstSeenAt: previous.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    messages: Number(previous.messages || 0) + (countMessage ? 1 : 0),
    blocked: Boolean(previous.blocked),
    tags: Array.isArray(previous.tags) ? previous.tags : [],
    note: previous.note || '',
    favorites: Array.isArray(previous.favorites) ? previous.favorites : [],
    catalogMessageIds: Array.isArray(previous.catalogMessageIds) ? previous.catalogMessageIds : [],
    uiMessageIds: Array.isArray(previous.uiMessageIds) ? previous.uiMessageIds : [],
    galleryMessageIds: Array.isArray(previous.galleryMessageIds) ? previous.galleryMessageIds : [],
    lastCallback: previous.lastCallback && typeof previous.lastCallback === 'object' ? previous.lastCallback : null,
    lastInboundMessageId: previous.lastInboundMessageId != null && Number.isFinite(Number(previous.lastInboundMessageId)) ? Number(previous.lastInboundMessageId) : null,
    catalogContext: previous.catalogContext && typeof previous.catalogContext === 'object' ? {
      mode: ['all', 'favorites', 'matches'].includes(previous.catalogContext.mode) ? previous.catalogContext.mode : 'all',
      page: Math.max(0, Number(previous.catalogContext.page) || 0),
    } : { mode: 'all', page: 0 },
    pendingAction: previous.pendingAction && typeof previous.pendingAction === 'object' ? previous.pendingAction : null,
    expiredAction: previous.expiredAction && typeof previous.expiredAction === 'object' ? previous.expiredAction : null,
    pendingStartPayload: cleanText(previous.pendingStartPayload, 100),
    activity: Array.isArray(previous.activity) ? previous.activity : [],
    propertyAlerts: previous.propertyAlerts !== false,
    source: cleanText(previous.source, 40),
    catalogFilter: previous.catalogFilter && typeof previous.catalogFilter === 'object' ? normalizedCatalogFilter(previous.catalogFilter) : null,
    sourceAt: cleanText(previous.sourceAt, 40),
    alertsSent: previous.alertsSent && typeof previous.alertsSent === 'object' && !Array.isArray(previous.alertsSent) ? previous.alertsSent : {},
    // Properties that matched the client's last selection form.
    selectionMatchIds: Array.isArray(previous.selectionMatchIds) ? previous.selectionMatchIds.map(String).slice(0, 20) : [],
  };
  data.users[id] = user;
  indexUser(user);
  return user;
}

// Everything the bot stores about one person, for a data access request.
function userDataExport(user) {
  const id = String(user.id);
  const chatId = String(user.chatId);
  return {
    exportedAt: new Date().toISOString(),
    user: clone(user),
    inquiries: data.inquiries.filter((item) => item.userId === id || String(item.chatId) === chatId).map(clone),
  };
}

// Right to erasure: removes the user's card, history, favourites, inquiries
// and every reference to them. Snapshots in backups/ keep the data until they
// are rotated out.
function eraseUserData(user) {
  const id = String(user.id);
  const chatId = String(user.chatId);
  delete data.users[id];
  usersByChatId.delete(chatId);
  inquiryTimes.delete(id);
  adminNotifyTimes.delete(id);
  adminMuteNotices.delete(id);
  const inquiriesBefore = data.inquiries.length;
  data.inquiries = data.inquiries.filter((item) => item.userId !== id && String(item.chatId) !== chatId);
  for (const entry of data.broadcasts) {
    if (Array.isArray(entry.processedUserIds)) entry.processedUserIds = entry.processedUserIds.filter((value) => String(value) !== id);
    if (Array.isArray(entry.failures)) entry.failures = entry.failures.filter((failure) => String(failure.userId) !== id);
  }
  for (const [messageId, target] of Object.entries(data.adminReplyTargets || {})) {
    if (String(target.chatId) === chatId) delete data.adminReplyTargets[messageId];
  }
  return { inquiriesRemoved: inquiriesBefore - data.inquiries.length };
}

export {
  LEAD_SOURCE_PATTERN,
  eraseUserData,
  indexUser,
  leadSourceFromPayload,
  normalizeUser,
  rebuildUserIndex,
  telegramInterfaceLanguage,
  userByChatId,
  userById,
  userDataExport,
  usersByChatId,
};
