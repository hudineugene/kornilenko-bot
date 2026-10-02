// Пользователи: карточки, поиск, источник, выгрузка и удаление данных.

import { cleanText, clone } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { adminMuteNotices, adminNotifyTimes, inquiryTimes } from './inquiries.mjs';
import { normalizedCatalogFilter, normalizedSavedSearch } from './catalog.mjs';
import { normalizedSimilarPropertyDetails } from './similar.mjs';

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
const SELECTION_MATCH_TIERS = new Set(['exact', 'close', 'consider']);
const SELECTION_MATCH_REASONS = new Set(['deal', 'type', 'location', 'budget', 'bedrooms', 'general']);
const SELECTION_MATCH_WARNINGS = new Set(['location', 'budgetClose', 'budgetHigh', 'priceMissing', 'currency', 'periodConverted', 'bedroomsClose', 'bedroomsMissing']);

function normalizedSelectionMatchDetails(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    id: cleanText(item && item.id, 100),
    tier: SELECTION_MATCH_TIERS.has(item && item.tier) ? item.tier : 'consider',
    score: Math.max(0, Math.min(100, Math.round(Number(item && item.score) || 0))),
    reasons: (Array.isArray(item && item.reasons) ? item.reasons : []).filter((key) => SELECTION_MATCH_REASONS.has(key)).slice(0, 6),
    warnings: (Array.isArray(item && item.warnings) ? item.warnings : []).filter((key) => SELECTION_MATCH_WARNINGS.has(key)).slice(0, 8),
  })).filter((item) => item.id).slice(0, 20);
}

function leadSourceFromPayload(payload) {
  const match = cleanText(payload, 100).match(LEAD_SOURCE_PATTERN);
  return match ? match[1].toLowerCase() : '';
}

// Языки, в которых русский понятнее английского: соседние страны, где им
// пользуются каждый день.
const RUSSIAN_NEIGHBOUR_LANGUAGES = ['uk', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'mo'];

// Язык клиента по настройкам Telegram. Мы говорим на трёх языках, поэтому
// выбираем ближайший: русский соседям, испанский испаноязычным, всем
// остальным — английский. Пустой ответ не возвращаем никогда: экран выбора
// языка в начале разговора отпугивает сильнее, чем чужой язык, который можно
// переключить одной кнопкой.
function telegramInterfaceLanguage(user) {
  const code = String(user && user.languageCode || '').toLowerCase().split('-')[0];
  if (['ru', 'en', 'es'].includes(code)) return code;
  if (RUSSIAN_NEIGHBOUR_LANGUAGES.includes(code)) return 'ru';
  return 'en';
}

// Язык угадан, а не задан клиентом: в приветствии показываем кнопку «🌐».
function languageWasGuessed(user) {
  const code = String(user && user.languageCode || '').toLowerCase().split('-')[0];
  return !['ru', 'en', 'es'].includes(code);
}

// Telegram отказался доставлять: клиент заблокировал бота или удалил аккаунт.
// Помечаем это как технический запрет — он снимется сам, когда клиент напишет.
function markUnavailable(user) {
  if (!user || user.blockedBy === 'admin') return;
  user.blocked = true;
  user.blockedBy = 'telegram';
  scheduleSave();
}

// Сигнал Telegram о личном чате: клиент заблокировал бота или вернулся.
function applyPrivateChatStatus(userId, status) {
  const user = userById(String(userId));
  if (!user || user.blockedBy === 'admin') return null;
  if (['kicked', 'left'].includes(status)) {
    user.blocked = true;
    user.blockedBy = 'telegram';
  } else if (status === 'member') {
    user.blocked = false;
    user.blockedBy = '';
  } else return null;
  scheduleSave();
  return user;
}

// «Мой план покупки»: какие шаги отмечены (по коду шага), о чём просили помощи,
// когда начали, когда последний раз что-то делали и напоминали ли.
function normalizedPlan(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const marks = (input) => Object.fromEntries(Object.entries(input && typeof input === 'object' && !Array.isArray(input) ? input : {})
    .filter(([key, stamp]) => /^[a-z]{2,20}$/.test(key) && typeof stamp === 'string' && stamp).slice(0, 20).map(([key, stamp]) => [key, cleanText(stamp, 40)]));
  return {
    startedAt: cleanText(source.startedAt, 40),
    updatedAt: cleanText(source.updatedAt, 40),
    remindedAt: cleanText(source.remindedAt, 40),
    remindOptOut: source.remindOptOut === true,
    done: marks(source.done),
    help: marks(source.help),
  };
}

function idList(value) {
  return Array.isArray(value) ? value.map(String).filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 20) : [];
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
    // Пришло сообщение или нажатие — значит клиент нас не блокирует. Галочку
    // администратора «не писать этому клиенту» это не снимает.
    blocked: previous.blockedBy === 'admin' ? true : false,
    blockedBy: previous.blockedBy === 'admin' ? 'admin' : '',
    tags: Array.isArray(previous.tags) ? previous.tags : [],
    note: previous.note || '',
    favorites: Array.isArray(previous.favorites) ? previous.favorites : [],
    comparisonIds: Array.isArray(previous.comparisonIds)
      ? previous.comparisonIds.map(String).filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 3)
      : [],
    recentlyViewed: Array.isArray(previous.recentlyViewed)
      ? previous.recentlyViewed.map(String).filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 20)
      : [],
    catalogMessageIds: Array.isArray(previous.catalogMessageIds) ? previous.catalogMessageIds : [],
    uiMessageIds: Array.isArray(previous.uiMessageIds) ? previous.uiMessageIds : [],
    galleryMessageIds: Array.isArray(previous.galleryMessageIds) ? previous.galleryMessageIds : [],
    lastCallback: previous.lastCallback && typeof previous.lastCallback === 'object' ? previous.lastCallback : null,
    lastInboundMessageId: previous.lastInboundMessageId != null && Number.isFinite(Number(previous.lastInboundMessageId)) ? Number(previous.lastInboundMessageId) : null,
    catalogContext: previous.catalogContext && typeof previous.catalogContext === 'object' ? {
      mode: ['all', 'favorites', 'matches', 'similar', 'recent', 'comparison', 'digest', 'shared'].includes(previous.catalogContext.mode) ? previous.catalogContext.mode : 'all',
      page: Math.max(0, Number(previous.catalogContext.page) || 0),
      propertyId: cleanText(previous.catalogContext.propertyId, 100),
    } : { mode: 'all', page: 0, propertyId: '' },
    pendingAction: previous.pendingAction && typeof previous.pendingAction === 'object' ? previous.pendingAction : null,
    expiredAction: previous.expiredAction && typeof previous.expiredAction === 'object' ? previous.expiredAction : null,
    pendingStartPayload: cleanText(previous.pendingStartPayload, 100),
    activity: Array.isArray(previous.activity) ? previous.activity : [],
    propertyAlerts: previous.propertyAlerts !== false,
    source: cleanText(previous.source, 40),
    catalogFilter: previous.catalogFilter && typeof previous.catalogFilter === 'object' ? normalizedCatalogFilter(previous.catalogFilter) : null,
    savedSearch: normalizedSavedSearch(previous.savedSearch),
    // Когда клиент впервые открыл каталог и «Подробнее» — для воронки в отчёте.
    funnel: {
      ...(previous.funnel && previous.funnel.catalog ? { catalog: cleanText(previous.funnel.catalog, 40) } : {}),
      ...(previous.funnel && previous.funnel.details ? { details: cleanText(previous.funnel.details, 40) } : {}),
    },
    // Цель клиента со старта: «купить для жизни» / «инвестиция и аренда» / «пока смотрю».
    // Дайджест и мягкий возврат: когда слали в последний раз, что показали, отписался ли.
    plan: normalizedPlan(previous.plan),
    digestAt: cleanText(previous.digestAt, 40),
    digestOptOut: Boolean(previous.digestOptOut),
    digestNewIds: idList(previous.digestNewIds),
    digestDropIds: idList(previous.digestDropIds),
    digestIds: idList(previous.digestIds),
    // Подборка, которую клиент сейчас листает по присланной ссылке.
    sharedListCode: /^[A-Za-z0-9_-]{6,32}$/.test(String(previous.sharedListCode || '')) ? String(previous.sharedListCode) : '',
    comebackIds: idList(previous.comebackIds),
    comebackAt: cleanText(previous.comebackAt, 40),
    comebackOptOut: Boolean(previous.comebackOptOut),
    goal: ['live', 'invest', 'browse'].includes(previous.goal) ? previous.goal : '',
    goalAt: cleanText(previous.goalAt, 40),
    goalAskedAt: cleanText(previous.goalAskedAt, 40),
    // День (ГГГГ-ММ-ДД), когда клиенту последний раз показали блок «Что дальше» целиком.
    whatNextDay: cleanText(previous.whatNextDay, 10),
    sourceAt: cleanText(previous.sourceAt, 40),
    alertsSent: previous.alertsSent && typeof previous.alertsSent === 'object' && !Array.isArray(previous.alertsSent) ? previous.alertsSent : {},
    // The client turned broadcasts off (the "Unsubscribe" button or settings).
    broadcastsOptOut: Boolean(previous.broadcastsOptOut),
    broadcastsOptOutAt: cleanText(previous.broadcastsOptOutAt, 40),
    // Явное согласие на новости и акции: без него рассылка не уходит.
    newsConsentAt: cleanText(previous.newsConsentAt, 40),
    // The last broadcast this client received, to count their response to it.
    lastBroadcast: previous.lastBroadcast && typeof previous.lastBroadcast === 'object' ? {
      id: cleanText(previous.lastBroadcast.id, 100),
      at: cleanText(previous.lastBroadcast.at, 40),
    } : null,
    // Properties that matched the client's last selection form.
    selectionMatchIds: Array.isArray(previous.selectionMatchIds) ? previous.selectionMatchIds.map(String).slice(0, 20) : [],
    selectionMatchDetails: normalizedSelectionMatchDetails(previous.selectionMatchDetails),
    // Ranked results from the last "Similar properties" request.
    similarPropertyIds: Array.isArray(previous.similarPropertyIds)
      ? previous.similarPropertyIds.map(String).filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 20)
      : [],
    similarPropertyDetails: normalizedSimilarPropertyDetails(previous.similarPropertyDetails),
    similarPropertySourceId: cleanText(previous.similarPropertySourceId, 100),
  };
  data.users[id] = user;
  indexUser(user);
  return user;
}

// Everything the bot stores about one person, for a data access request.
// Всё, что бот хранит о клиенте: карточка, обращения, его сообщения в группах,
// заявки на вступление и записи о нём в центре уведомлений. По запросу клиента
// это должно быть полным, иначе выгрузка не отвечает на вопрос «что у вас есть
// обо мне».
function userTraces(user) {
  const id = String(user.id);
  const chatId = String(user.chatId);
  const inquiries = data.inquiries.filter((item) => String(item.userId) === id || String(item.chatId) === chatId);
  const inquiryIds = new Set(inquiries.map((item) => String(item.id)));
  const groupMessages = [];
  const joinRequests = [];
  for (const group of Array.isArray(data.groups) ? data.groups : []) {
    for (const message of Array.isArray(group.messages) ? group.messages : []) {
      if (String(message.userId) === id) groupMessages.push({ groupId: group.id, groupTitle: group.title, ...message });
    }
    for (const request of Array.isArray(group.joinRequests) ? group.joinRequests : []) {
      if (String(request.userId) === id) joinRequests.push({ groupId: group.id, groupTitle: group.title, ...request });
    }
  }
  // Ключи центра уведомлений начинаются с вида «message:<клиент>:…», остальные
  // ссылаются на обращение — оба случая относятся к этому клиенту.
  const notificationKeys = Object.keys(data.adminNotificationStates || {}).filter((key) => {
    if (key.startsWith('message:' + id + ':')) return true;
    const stored = data.adminNotificationStates[key] || {};
    const route = stored.snapshot && stored.snapshot.route;
    return Boolean(route && route.inquiryId && inquiryIds.has(String(route.inquiryId)));
  });
  return { id, chatId, inquiries, groupMessages, joinRequests, notificationKeys };
}

function userDataExport(user) {
  const traces = userTraces(user);
  return {
    exportedAt: new Date().toISOString(),
    user: clone(user),
    inquiries: traces.inquiries.map(clone),
    groupMessages: traces.groupMessages.map(clone),
    groupJoinRequests: traces.joinRequests.map(clone),
    adminNotifications: traces.notificationKeys.map((key) => clone({ key, ...(data.adminNotificationStates[key] || {}) })),
    sharedLists: Object.entries(data.sharedLists || {}).filter(([, list]) => [String(user.id), 'offer:' + String(user.id)].includes(String(list.owner))).map(([code, list]) => clone({ code, ...list })),
  };
}

// Right to erasure: removes the user's card, history, favourites, inquiries
// and every reference to them. Copies in backups/ still hold the data for a
// while: daily snapshots for two weeks, one-off ones (before an upgrade or a
// restore) for three months — see pruneOldSnapshots in store.mjs.
function eraseUserData(user) {
  const traces = userTraces(user);
  const id = traces.id;
  const chatId = traces.chatId;
  delete data.users[id];
  for (const [code, list] of Object.entries(data.sharedLists || {})) {
    if (String(list.owner) === id || String(list.owner) === 'offer:' + id) delete data.sharedLists[code];
  }
  usersByChatId.delete(chatId);
  inquiryTimes.delete(id);
  for (const key of [id, id + ':messages', id + ':activity']) {
    adminNotifyTimes.delete(key);
    adminMuteNotices.delete(key);
  }
  const inquiriesBefore = data.inquiries.length;
  data.inquiries = data.inquiries.filter((item) => item.userId !== id && String(item.chatId) !== chatId);
  for (const entry of data.broadcasts) {
    for (const field of ['processedUserIds', 'respondedUserIds', 'inquiryUserIds', 'unsubscribedUserIds']) {
      if (Array.isArray(entry[field])) entry[field] = entry[field].filter((value) => String(value) !== id);
    }
    if (Array.isArray(entry.failures)) entry.failures = entry.failures.filter((failure) => String(failure.userId) !== id);
  }
  for (const [messageId, target] of Object.entries(data.adminReplyTargets || {})) {
    if (String(target.chatId) === chatId) delete data.adminReplyTargets[messageId];
  }
  // Центр уведомлений хранит снимки с именем и текстом клиента.
  for (const key of traces.notificationKeys) delete data.adminNotificationStates[key];
  // Сообщения клиента в группах и его заявки на вступление — тоже его данные.
  let groupTraces = 0;
  for (const group of Array.isArray(data.groups) ? data.groups : []) {
    if (Array.isArray(group.messages)) {
      const before = group.messages.length;
      group.messages = group.messages.filter((message) => String(message.userId) !== id);
      groupTraces += before - group.messages.length;
    }
    if (Array.isArray(group.joinRequests)) {
      const before = group.joinRequests.length;
      group.joinRequests = group.joinRequests.filter((request) => String(request.userId) !== id);
      groupTraces += before - group.joinRequests.length;
    }
  }
  return {
    inquiriesRemoved: inquiriesBefore - data.inquiries.length,
    notificationsRemoved: traces.notificationKeys.length,
    groupTracesRemoved: groupTraces,
  };
}

export {
  LEAD_SOURCE_PATTERN,
  applyPrivateChatStatus,
  eraseUserData,
  markUnavailable,
  indexUser,
  leadSourceFromPayload,
  normalizeUser,
  rebuildUserIndex,
  languageWasGuessed,
  telegramInterfaceLanguage,
  userByChatId,
  userById,
  userDataExport,
  userTraces,
  usersByChatId,
};
