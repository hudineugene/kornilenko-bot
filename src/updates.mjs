// Обработка входящих обновлений Telegram и цикл опроса.

import { cleanText, delay, fillTemplate } from './util.mjs';
import { COMMAND_TEXT, INTERACTION_TEXT, LANGUAGE_NAMES, MANAGER_CONTACT_TEXT, MENU_LABELS, PROPERTY_ACTION_TEXT, SEARCH_UNCLEAR_TEXT } from './texts.mjs';
import { configured, data, runtime, saveDataNow, scheduleSave } from './store.mjs';
import { recordActivity, recordDaily, recordError, recordPropertyEvent, recordSourceOpen } from './analytics.mjs';
import { languageWasGuessed, leadSourceFromPayload, normalizeUser, telegramInterfaceLanguage } from './users.mjs';
import { markTelegramFailure, markTelegramSuccess, sendMessage, telegramErrorMessage, telegramRequest } from './telegram.mjs';
import { configureBotCommands, isLanguageChangeText, languageFromText, languageMessages, menuItemForText, menuKeyboard, sendLanguagePicker, sendMainMenu, sendMoreMenu, sendWelcome } from './menus.mjs';
import { duplicateCallback, duplicateInboundMessage, expiredActionKeyboard, handleLeadFormMessage, handleLeadMethodCallback, handleViewingFormCallback, handleViewingFormMessage, isStaleFormControl, pendingActionExpired, rememberExpiredAction, restartExpiredAction, saveViewingPhone, showPendingActionStep, startLeadForm, unfinishedActionKeyboard } from './forms.mjs';
import {
  adminChatFor,
  createInquiry,
  handleAdministratorEdit,
  handleAdministratorReply,
  handleInquiryStatusCallback,
  handleMessageReaction,
  inquiryWasMerged,
  messageSummary,
  notifyAdministratorAction,
  recordBotAnswer,
  serviceMessage,
} from './inquiries.mjs';
import { sharedListCodeFromStartPayload, catalogFilterSummary, catalogPageFromContext, catalogRecords, clearCatalogMessages, normalizedCatalogFilter, clearGalleryMessages, clearUiMessages, handleCatalogFilterCallback, handleCatalogPriceInputMessage, localizedExact, handleCatalogListCallback, handleSelectionWizardCallback, openPendingStartPayload, propertyIdFromStartPayload, sendSelectionWizard, sendCatalog, sendCatalogPage, sendPropertyCard, sourceFromStartPayload } from './catalog.mjs';
import { catalogRequest, searchSignalCount } from './search.mjs';
import { acknowledgeCallback, handleAboutCallback, handleCatalogCallback, handleSharedListCallback, handleContactCallback, handleGuideCallback, sendGuidePage, handleLanguageCallback, handleNavigationCallback, handlePromotionCallback, handlePropertyCallback, handleSelectionCallback, propertyRequestText, sendAbout, sendContacts, sendHelp, sendPromotions } from './sections.mjs';
import { recordBroadcastResponse, runDueBroadcasts } from './broadcasts.mjs';
import { handleAlertsCallback } from './alerts.mjs';
import { handleViewingCalendarCallback, handleViewingConfirmCallback, handleViewingFeedbackCallback } from './viewings.mjs';
import { handleMyRequestsCallback, sendMyRequests } from './requests.mjs';
import { handleSubscriptionCallback } from './subscriptions.mjs';
import { withOffHoursNote } from './hours.mjs';
import { handleCalculatorCallback } from './calculator.mjs';
import { handlePrivacyCallback, sendPrivacyCentre } from './privacy.mjs';
import { handleComparisonCallback } from './comparison.mjs';
import { handleSavedSearchCallback } from './saved-search.mjs';
import { handleTrustCallback } from './trust.mjs';
import { askGoal, handleGoalCallback } from './goal.mjs';
import { handleDigestCallback } from './digest.mjs';
import { handlePlanCallback } from './plan.mjs';
import { telegramContactLost, telegramContactRestored } from './status.mjs';
import { ADMIN_CHAT_HINT, handleAdminChatMessage, handleInboxShowCallback } from './admin-commands.mjs';
import { handlePostCallback } from './post-command.mjs';
import { handleChatJoinRequest, handleMyChatMember, rememberGroupMessage } from './groups.mjs';

function findRule(text, language) {
  const input = text.toLocaleLowerCase('ru-RU').trim();
  return [...data.rules].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).find((rule) => {
    if (!rule.enabled || !rule.trigger || ![language, 'all'].includes(rule.language || 'ru')) return false;
    const trigger = String(rule.trigger).toLocaleLowerCase('ru-RU').trim();
    if (rule.type === 'exact') return input === trigger;
    if (rule.type === 'starts') return input.startsWith(trigger);
    return input.includes(trigger);
  });
}

// --- Альбом от клиента -------------------------------------------------------
// Телеграм присылает альбом отдельными сообщениями с общим media_group_id, с
// паузой в доли секунды между ними. Раньше каждое проходило весь путь: своё
// уведомление менеджеру и свой ответ клиенту. Десять фотографий — больше
// двадцати сообщений, и Telegram начинал отбрасывать их по лимиту на чат.
// Ждём, пока придут все части, и дальше ведём альбом как одно сообщение.
const ALBUM_WINDOW_MS = 2500;
const ALBUM_MAX_PARTS = 50;
const pendingAlbums = new Map();

// Части альбома собираются сразу при получении, не дожидаясь очереди чата:
// иначе первая часть, которая ждёт сборки, не пустила бы в очередь остальные.
// В очередь встаёт только первая часть — она держит место альбома, поэтому
// то, что клиент написал следом, обрабатывается уже после альбома, а не
// вперёд него.
function albumKey(message) {
  return String(message.chat.id) + ':' + String(message.media_group_id);
}

function albumMessage(update) {
  const message = update && update.message;
  if (!message || !message.media_group_id || message.albumMessageIds) return null;
  if (!message.chat || message.chat.type !== 'private') return null;
  // Альбом сотрудника собираем только когда это ответ на карточку клиента.
  if (adminChatFor(message.chat.id) && !message.reply_to_message) return null;
  return message;
}

// Возвращает true, если это первая часть альбома: с неё начинается ожидание.
function collectAlbumMessage(message, handle, update) {
  const key = albumKey(message);
  const known = pendingAlbums.get(key);
  const album = known || { parts: [], updates: [], timer: null, done: null, finish: null };
  if (!known) album.done = new Promise((resolve) => { album.finish = resolve; });
  if (album.parts.length < ALBUM_MAX_PARTS) {
    album.parts.push(message);
    // Пока альбом собирается, его части считаются незаконченными: если бота
    // остановят в эти секунды, Telegram пришлёт их снова.
    if (update) {
      album.updates.push(update);
      holdUpdate(update);
    }
  }
  if (album.timer) clearTimeout(album.timer);
  album.timer = setTimeout(() => {
    pendingAlbums.delete(key);
    const [first, ...rest] = album.parts;
    if (!first) {
      album.finish();
      return;
    }
    const caption = album.parts.map((part) => cleanText(part.caption, 4000)).filter(Boolean).join('\n');
    Promise.resolve(handle({ ...first, caption, albumMessageIds: rest.map((part) => part.message_id) }))
      .catch((error) => recordError('Альбом от клиента', error))
      .finally(() => {
        for (const part of album.updates) releaseUpdate(part);
        album.finish();
      });
  }, ALBUM_WINDOW_MS);
  if (album.timer.unref) album.timer.unref();
  pendingAlbums.set(key, album);
  return !known;
}

// Место альбома в очереди чата: ждём, пока он соберётся и обработается.
function waitForAlbum(message) {
  const album = pendingAlbums.get(albumKey(message));
  return album ? album.done : Promise.resolve();
}

async function handleUpdate(update, token) {
  // Менеджер поправил отправленный ответ.
  if (update.edited_message) {
    await handleAdministratorEdit(update.edited_message, token);
    return;
  }
  // The bot was added to a group, promoted or removed.
  if (update.my_chat_member) {
    handleMyChatMember(update.my_chat_member);
    return;
  }
  if (update.chat_join_request) {
    handleChatJoinRequest(update.chat_join_request);
    return;
  }
  if (update.channel_post) {
    rememberGroupMessage(update.channel_post);
    return;
  }
  // В группе и канале бот — только бот: сценарий клиента (меню, обращения,
  // анкеты) живёт в личной переписке. Иначе сообщение участника завело бы ему
  // «личный чат» с номером группы, и ответы менеджера ушли бы в группу.
  // Исключение — группа, назначенная чатом администратора или менеджера: там
  // работают команды и ответы на уведомления.
  if (update.message && update.message.chat && update.message.chat.type && update.message.chat.type !== 'private') {
    rememberGroupMessage(update.message);
    if (!adminChatFor(update.message.chat.id)) return;
  }
  if (update.message_reaction) {
    await handleMessageReaction(update.message_reaction);
    return;
  }
  if (update.callback_query && String(update.callback_query.data || '').startsWith('inq:confirm:')) {
    await handleViewingConfirmCallback(update.callback_query, token);
    return;
  }
  // Публикация в группы командой /post: кнопки экрана «куда публикуем».
  if (update.callback_query && String(update.callback_query.data || '').startsWith('post:')) {
    await handlePostCallback(update.callback_query, token);
    return;
  }
  if (update.callback_query && String(update.callback_query.data || '').startsWith('inq:show:')) {
    await handleInboxShowCallback(update.callback_query, token);
    return;
  }
  if (update.callback_query && String(update.callback_query.data || '').startsWith('inq:')) {
    await handleInquiryStatusCallback(update.callback_query, token);
    return;
  }
  // Кнопка на карточке-примере, присланной владельцу из панели: действия у неё нет.
  if (update.callback_query && String(update.callback_query.data || '') === 'preview:demo') {
    await acknowledgeCallback(update.callback_query, token, 'Это пример карточки: у клиента кнопки работают');
    return;
  }
  if (update.callback_query) {
    const callbackData = String(update.callback_query.data || '');
    const callbackChat = update.callback_query.message && update.callback_query.message.chat;
    // Кнопка, нажатая в группе или канале, не должна заводить клиента с
    // номером группы: кнопки бота живут в личной переписке.
    if (callbackChat && callbackChat.type && callbackChat.type !== 'private' && !adminChatFor(callbackChat.id)) {
      await acknowledgeCallback(update.callback_query, token);
      return;
    }
    const callbackChatId = callbackChat ? callbackChat.id : update.callback_query.from.id;
    const callbackUser = normalizeUser(update.callback_query.from, callbackChatId, false);
    recordBroadcastResponse(callbackUser, callbackData === 'subs:news:off:bc' ? 'unsubscribe' : 'response');
    if (duplicateCallback(callbackUser, callbackData)) {
      const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
      await acknowledgeCallback(update.callback_query, token, copy.duplicate);
      return;
    }
    try {
      if (callbackData.startsWith('language:')) await handleLanguageCallback(update.callback_query, token);
      else if (callbackData.startsWith('catalog:')) await handleCatalogCallback(update.callback_query, token);
      else if (callbackData.startsWith('property:')) await handlePropertyCallback(update.callback_query, token);
      else if (callbackData.startsWith('compare:')) await handleComparisonCallback(update.callback_query, token, notifyAdministratorAction);
      else if (callbackData.startsWith('shared:')) await handleSharedListCallback(update.callback_query, token);
      else if (callbackData.startsWith('saved:')) await handleSavedSearchCallback(update.callback_query, token, notifyAdministratorAction);
      else if (callbackData.startsWith('promotions:')) await handlePromotionCallback(update.callback_query, token);
      else if (callbackData.startsWith('contact:')) await handleContactCallback(update.callback_query, token);
      else if (callbackData.startsWith('lead:')) {
        await acknowledgeCallback(update.callback_query, token);
        await handleLeadMethodCallback(update.callback_query, token, callbackUser);
      }
      else if (callbackData.startsWith('about:')) await handleAboutCallback(update.callback_query, token);
      else if (callbackData.startsWith('trust:')) await handleTrustCallback(update.callback_query, token);
      else if (callbackData.startsWith('goal:')) await handleGoalCallback(update.callback_query, token);
      else if (callbackData.startsWith('digest:')) await handleDigestCallback(update.callback_query, token);
      else if (callbackData.startsWith('plan:')) await handlePlanCallback(update.callback_query, token);
      else if (callbackData.startsWith('guide:')) await handleGuideCallback(update.callback_query, token);
      else if (callbackData.startsWith('vf:')) await handleViewingFormCallback(update.callback_query, token);
      else if (callbackData.startsWith('nav:')) await handleNavigationCallback(update.callback_query, token);
      else if (callbackData.startsWith('selection:')) await handleSelectionCallback(update.callback_query, token);
      else if (callbackData.startsWith('sel:')) await handleSelectionWizardCallback(update.callback_query, token);
      else if (callbackData.startsWith('clist:')) await handleCatalogListCallback(update.callback_query, token);
      else if (callbackData.startsWith('alerts:')) await handleAlertsCallback(update.callback_query, token);
      else if (callbackData.startsWith('cfilter:')) await handleCatalogFilterCallback(update.callback_query, token);
      else if (callbackData.startsWith('myreq:')) await handleMyRequestsCallback(update.callback_query, token);
      else if (callbackData.startsWith('vfb:')) await handleViewingFeedbackCallback(update.callback_query, token);
      else if (callbackData.startsWith('vcal:')) await handleViewingCalendarCallback(update.callback_query, token);
      else if (callbackData.startsWith('subs:')) await handleSubscriptionCallback(update.callback_query, token);
      else if (callbackData.startsWith('calc:')) await handleCalculatorCallback(update.callback_query, token);
      else if (callbackData.startsWith('privacy:')) await handlePrivacyCallback(update.callback_query, token);
      else {
        const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
        await acknowledgeCallback(update.callback_query, token, copy.stale);
      }
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Действие клиента', error);
      console.error('Не удалось выполнить действие клиента:', error.message);
      const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
      await sendMessage(callbackChatId, copy.failed, token, { reply_markup: menuKeyboard(callbackUser.preferredLanguage || 'ru') }).catch(() => {});
    }
    return;
  }
  const message = update.message;
  if (!message || !message.from || !message.chat) return;
  // Клиент закрепил сообщение или включил таймер автоудаления: Telegram
  // присылает это как сообщение в чате, и раньше бот заводил обращение
  // «Нетекстовое сообщение» — менеджер получал уведомление о том, чего клиент
  // не писал.
  if (serviceMessage(message)) return;
  if (await handleAdministratorReply(message, token)) return;
  if (await handleAdminChatMessage(message, token)) return;
  // The admin's own chat with the bot: menu, forms and auto-replies still work
  // for trying the bot out, but free text is not an inquiry from the admin.
  const adminOwnChat = Boolean(adminChatFor(message.chat.id));

  const user = normalizeUser(message.from, message.chat.id);
  if (duplicateInboundMessage(user, message.message_id)) return;
  recordBroadcastResponse(user, 'response');
  const expiredPending = pendingActionExpired(user) ? user.pendingAction : null;
  if (expiredPending) {
    rememberExpiredAction(user, expiredPending);
    user.pendingAction = null;
    scheduleSave();
  }
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const summary = messageSummary(message);
  data.stats.messagesReceived += 1;
  recordDaily('received');
  recordActivity(user, 'in', summary, text ? 'message' : 'media', { messageId: message.message_id });
  data.stats.lastUpdateAt = new Date().toISOString();
  scheduleSave();

  let answer = '';
  // Answers to what became an inquiry say when the manager will reply.
  let inquiryAnswer = false;
  // Сообщение дописано к открытому обращению, и клиенту ничего не отвечали:
  // молчание похоже на потерянное сообщение, поэтому ставим на него реакцию 👀.
  let mergedIntoOpen = false;
  let searchHint = null;
  const mergedAnswer = (inquiry) => {
    const merged = inquiryWasMerged(inquiry);
    if (merged) mergedIntoOpen = true;
    return merged;
  };
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const commandArgument = cleanText(text.split(/\s+/).slice(1).join(' '), 100);
  const sourceLabel = command === '/start'
    ? leadSourceFromPayload(commandArgument) || sourceFromStartPayload(commandArgument)
    : '';
  if (sourceLabel) {
    recordSourceOpen(sourceLabel);
    // The first link a client came through is kept: it is what brought them.
    if (!user.source) {
      user.source = sourceLabel;
      user.sourceAt = new Date().toISOString();
    }
    scheduleSave();
  }
  // Ссылка на объект открывает карточку и тогда, когда несёт метку источника.
  // Подборка, присланная другом: пришёл «по подборке» — это и есть его источник.
  if (command === '/start' && sharedListCodeFromStartPayload(commandArgument)) {
    if (!user.source) {
      user.source = 'podborka';
      user.sourceAt = new Date().toISOString();
    }
    user.pendingStartPayload = commandArgument;
    scheduleSave();
  } else if (command === '/start' && commandArgument && propertyIdFromStartPayload(commandArgument)) {
    user.pendingStartPayload = commandArgument;
    scheduleSave();
  } else if (command === '/start' && commandArgument && !sourceLabel) {
    user.pendingStartPayload = commandArgument;
    scheduleSave();
  }
  if (command === '/myid') {
    void notifyAdministratorAction(user, 'Запросил свой Telegram ID', 'Telegram-чат: ' + String(message.chat.id));
    const copy = COMMAND_TEXT[user.preferredLanguage || 'ru'] || COMMAND_TEXT.ru;
    await sendMessage(message.chat.id, copy.myId + ' ' + String(message.chat.id), token);
    return;
  }
  // Первый контакт: язык берём из настроек Telegram и здороваемся сразу.
  // Экрана выбора языка в начале разговора больше нет — он отпугивал раньше,
  // чем клиент видел хоть один объект. Сменить язык можно кнопкой «🌐».
  const telegramLanguage = telegramInterfaceLanguage(user);
  const guessed = languageWasGuessed(user);
  if (!user.preferredLanguage && telegramLanguage && command !== '/language') {
    user.preferredLanguage = telegramLanguage;
    scheduleSave();
    const detail = 'Язык по настройкам Telegram: ' + LANGUAGE_NAMES[telegramLanguage]
      + (guessed && user.languageCode ? ' (в Telegram: ' + user.languageCode + ')' : '');
    void notifyAdministratorAction(user, 'Первый запуск', detail);
    await sendWelcome(message.chat.id, user, token, { languageButton: guessed, goalFollows: command === '/start', compact: command === '/start' && Boolean(sharedListCodeFromStartPayload(commandArgument)) });
    if (command === '/start') {
      // Ссылка на объект открывает объект; вопрос о цели — только когда открывать нечего.
      if (!(await openPendingStartPayload(user, token))) await askGoal(message.chat.id, user, token);
      return;
    }
  }
  // Старая форма подбора отменена: без этой проверки клиент, застрявший в ней,
  // получал «объект недоступен» на любое сообщение до истечения срока действия.
  if (user.pendingAction && user.pendingAction.type === 'property_selection') {
    user.pendingAction = null;
    scheduleSave();
  }
  // Клиент может назвать язык словом вместо кнопки — например, когда бот
  // угадал язык неверно. Тому, у кого язык уже выбран, засчитываем только
  // точное «Русский», «English», «Español».
  const typedLanguage = command !== '/language' ? languageFromText(text, { exact: Boolean(user.preferredLanguage) }) : '';
  if (typedLanguage && typedLanguage !== user.preferredLanguage) {
    user.preferredLanguage = typedLanguage;
    scheduleSave();
    void notifyAdministratorAction(user, 'Выбрал язык сообщением', LANGUAGE_NAMES[typedLanguage]);
    await sendWelcome(message.chat.id, user, token);
    return;
  }
  if (command === '/language' || (user.preferredLanguage && isLanguageChangeText(text, user.preferredLanguage)) || !user.preferredLanguage) {
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    void notifyAdministratorAction(user, user.preferredLanguage ? 'Открыл выбор языка' : 'Первый запуск — выбор языка', summary);
    try {
      await clearUiMessages(message.chat.id, user, token);
      await clearGalleryMessages(message.chat.id, user, token);
      await clearCatalogMessages(message.chat.id, user, token);
      await sendLanguagePicker(message.chat.id, token, user.preferredLanguage || '');
    } catch (error) {
      runtime.lastError = error.message;
    }
    return;
  }

  const messages = languageMessages(user.preferredLanguage);
  if (command === '/start' || command === '/menu') {
    if (command === '/start' && !commandArgument && user.pendingAction) {
      const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
      void notifyAdministratorAction(user, 'Вернулся к незавершённой форме', summary);
      await sendMessage(message.chat.id, copy.unfinished, token, { reply_markup: unfinishedActionKeyboard(user.preferredLanguage) });
      return;
    }
    user.pendingAction = null;
    user.expiredAction = null;
    if (command === '/menu') user.pendingStartPayload = '';
    scheduleSave();
    void notifyAdministratorAction(user, command === '/start' ? 'Запустил бота' : 'Открыл главное меню', summary);
    try {
      if (command === '/start' && await openPendingStartPayload(user, token)) return;
      await sendMainMenu(message.chat.id, user, token);
    } catch (error) {
      runtime.lastError = error.message;
      console.error('Не удалось показать главное меню:', error.message);
    }
    return;
  }
  else if (command === '/privacy') {
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    void notifyAdministratorAction(user, 'Открыл раздел «Мои данные»', summary);
    await clearUiMessages(message.chat.id, user, token);
    await sendPrivacyCentre(message.chat.id, user, token);
    return;
  }
  else if (command === '/help') {
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    void notifyAdministratorAction(user, 'Открыл раздел «Помощь»', summary);
    await clearUiMessages(message.chat.id, user, token);
    await clearGalleryMessages(message.chat.id, user, token);
    await clearCatalogMessages(message.chat.id, user, token);
    await sendHelp(message.chat.id, user, token);
    return;
  }
  else if (command === '/requests') {
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    void notifyAdministratorAction(user, 'Открыл «Мои заявки»', summary);
    await clearGalleryMessages(message.chat.id, user, token);
    await clearCatalogMessages(message.chat.id, user, token);
    await sendMyRequests(message.chat.id, user, token);
    return;
  }
  else if (command === '/cancel') {
    const hadPendingAction = Boolean(user.pendingAction || user.expiredAction);
    user.pendingAction = null;
    user.expiredAction = null;
    scheduleSave();
    const copy = COMMAND_TEXT[user.preferredLanguage] || COMMAND_TEXT.ru;
    void notifyAdministratorAction(user, hadPendingAction ? 'Отменил текущее действие' : 'Открыл главное меню командой /cancel', summary);
    await sendMessage(message.chat.id, hadPendingAction ? copy.cancelled : copy.nothingToCancel, token, { reply_markup: menuKeyboard(user.preferredLanguage) });
    return;
  }
  else if (command.startsWith('/')) {
    const copy = COMMAND_TEXT[user.preferredLanguage] || COMMAND_TEXT.ru;
    const interaction = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    const hasPendingAction = Boolean(user.pendingAction);
    const hasExpiredAction = Boolean(user.expiredAction);
    void notifyAdministratorAction(user, 'Ввёл неизвестную команду', cleanText(command, 80));
    const commandMessage = hasExpiredAction ? copy.unknown + '\n\n' + interaction.expired : hasPendingAction ? copy.unknown + '\n\n' + interaction.unfinished : copy.unknown;
    await sendMessage(message.chat.id, commandMessage, token, {
      reply_markup: hasExpiredAction ? expiredActionKeyboard(user.preferredLanguage) : hasPendingAction ? unfinishedActionKeyboard(user.preferredLanguage) : menuKeyboard(user.preferredLanguage),
    });
    return;
  }
  else if (expiredPending && (!text || !menuItemForText(text, user.preferredLanguage))) {
    const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    await sendMessage(message.chat.id, copy.expired, token, { reply_markup: expiredActionKeyboard(user.preferredLanguage) });
    return;
  }
  else if (user.expiredAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).resume) {
    await restartExpiredAction(user, token);
    return;
  }
  else if (user.expiredAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).backToMenu) {
    user.expiredAction = null;
    scheduleSave();
    await sendMainMenu(message.chat.id, user, token);
    return;
  }
  else if (user.expiredAction && (!text || !menuItemForText(text, user.preferredLanguage))) {
    user.expiredAction = null;
    scheduleSave();
    if (text && isStaleFormControl(text)) {
      const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
      await sendMessage(message.chat.id, copy.stale, token, { reply_markup: menuKeyboard(user.preferredLanguage) });
      return;
    }
    if (adminOwnChat) {
      await sendMessage(message.chat.id, ADMIN_CHAT_HINT, token);
      return;
    }
    const inquiry = createInquiry(user, text || summary, { type: 'general', sourceMessage: message });
    answer = mergedAnswer(inquiry) ? '' : fillTemplate(messages.fallback, user);
    inquiryAnswer = true;
  }
  else if (user.pendingAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).continueForm) {
    await showPendingActionStep(user, token);
    return;
  }
  else if (user.pendingAction && text === (INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru).discardForm) {
    user.pendingAction = null;
    scheduleSave();
    await sendMainMenu(message.chat.id, user, token);
    return;
  }
  else if (!user.pendingAction && message.contact && await saveViewingPhone(message, user, token)) {
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'lead' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleLeadFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'viewing_form' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleViewingFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'catalog_filter_price' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleCatalogPriceInputMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'manager_question' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    user.pendingAction = null;
    const inquiry = createInquiry(user, text || summary, { type: 'question', sourceMessage: message });
    scheduleSave();
    answer = mergedAnswer(inquiry) ? '' : (MANAGER_CONTACT_TEXT[user.preferredLanguage] || MANAGER_CONTACT_TEXT.ru).received;
    inquiryAnswer = true;
  }
  else if (user.pendingAction && (!text || !menuItemForText(text, user.preferredLanguage))) {
    const pending = user.pendingAction;
    user.pendingAction = null;
    const property = data.objects.find((item) => item.id === pending.propertyId);
    if (property) {
      const type = pending.type === 'viewing' ? 'viewing' : 'question';
      const prefix = propertyRequestText(property, 'ru', type);
      createInquiry(user, prefix + '\n\n' + (text || summary), { type, propertyId: property.id, sourceMessage: message });
      recordPropertyEvent(property.id, type === 'viewing' ? 'viewings' : 'questions');
      const received = (PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).received;
      const propertyTitle = localizedExact(property.title, user.preferredLanguage) || property.reference || '';
      answer = [received, propertyTitle ? '🔖 ' + propertyTitle : ''].filter(Boolean).join('\n\n');
      inquiryAnswer = true;
    } else {
      answer = user.preferredLanguage === 'en' ? 'This property is no longer available.' : user.preferredLanguage === 'es' ? 'Este inmueble ya no está disponible.' : 'Этот объект уже недоступен.';
    }
    scheduleSave();
  }
  else if (text && isStaleFormControl(text)) {
    const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    await sendMessage(message.chat.id, copy.stale, token, { reply_markup: menuKeyboard(user.preferredLanguage) });
    return;
  }
  else if (text) {
    const menuItem = menuItemForText(text, user.preferredLanguage);
    if (menuItem) {
      user.pendingAction = null;
      user.expiredAction = null;
      scheduleSave();
      recordDaily('menu', menuItem);
      void notifyAdministratorAction(user, 'Открыл раздел «' + (MENU_LABELS[user.preferredLanguage][menuItem] || menuItem).replace(/^[^\p{L}\p{N}]+/u, '') + '»', summary);
      try {
        await clearUiMessages(message.chat.id, user, token);
        await clearGalleryMessages(message.chat.id, user, token);
        if (!['objects', 'favorites', 'promotions'].includes(menuItem)) await clearCatalogMessages(message.chat.id, user, token);
        // «Объекты» из меню — всегда весь каталог: фильтр, оставшийся от мастера
        // подбора, «прилипал» и отвечал «ничего не найдено».
        if (menuItem === 'objects') {
          user.catalogFilter = null;
          scheduleSave();
        }
        if (menuItem === 'objects' && await sendCatalog(message.chat.id, user, token)) return;
        if (menuItem === 'promotions' && await sendPromotions(message.chat.id, user, token)) return;
        if (menuItem === 'favorites') {
          await sendCatalogPage(message.chat.id, user, token, catalogPageFromContext(user, 'favorites'), 'favorites');
          return;
        }
        if (menuItem === 'selection') {
          await sendSelectionWizard(message.chat.id, user, token, 'deal');
          return;
        }
        if (menuItem === 'request') {
          await startLeadForm(user, token);
          return;
        }
        if (menuItem === 'contacts') {
          await sendContacts(message.chat.id, user, token);
          return;
        }
        if (menuItem === 'more') {
          await sendMoreMenu(message.chat.id, user, token);
          return;
        }
        if (menuItem === 'about') {
          await sendAbout(message.chat.id, user, token);
          return;
        }
        if (menuItem === 'guide') {
          await sendGuidePage(message.chat.id, user, token, 0);
          return;
        }
        if (menuItem === 'help') {
          await sendHelp(message.chat.id, user, token);
          return;
        }
      } catch (error) {
        recordError('Содержимое меню', error);
        runtime.lastError = error.message;
        answer = user.preferredLanguage === 'en' ? 'This section is temporarily unavailable. Please try again.' : user.preferredLanguage === 'es' ? 'Esta sección no está disponible temporalmente. Inténtalo de nuevo.' : 'Раздел временно недоступен. Попробуйте ещё раз.';
      }
      if (!answer) {
        const heading = MENU_LABELS[user.preferredLanguage][menuItem];
        answer = heading + '\n\n' + fillTemplate(data.config.menu[user.preferredLanguage][menuItem], user);
      }
    }
    else {
      const rule = findRule(text, user.preferredLanguage);
      if (rule) {
        void notifyAdministratorAction(user, 'Получил автоматический ответ', 'Сообщение: ' + text + '\nПравило: ' + rule.trigger);
        answer = fillTemplate(rule.answer, user);
      }
      else {
        const found = catalogRequest(text, user);
        if (found && found.kind === 'filter') {
          user.catalogFilter = normalizedCatalogFilter(found.filter);
          scheduleSave();
          const summary = catalogFilterSummary(user.catalogFilter, user.preferredLanguage);
          // The client asked in their own words: the catalog answers right
          // away, and the manager still sees the request in the panel.
          if (!adminOwnChat) createInquiry(user, '🔎 ' + summary + '\n\n' + text, { type: 'general', searchLead: true, sourceMessage: message });
          else void notifyAdministratorAction(user, 'Искал объекты по параметрам', summary);
          await clearUiMessages(message.chat.id, user, token);
          await clearGalleryMessages(message.chat.id, user, token);
          await sendCatalogPage(message.chat.id, user, token, 0, 'all');
          return;
        }
        if (found && found.kind === 'city') {
          // A city name alone: the catalog in that city. Choices made earlier (deal,
          // type, budget) stay while they still find something. If the combination
          // is empty («rent in Finestrat», then «Benidorm»), the client meant a new
          // search: the filter is replaced by the city alone, not left to answer
          // «nothing found» for a reason the client cannot see.
          user.catalogFilter = normalizedCatalogFilter({ ...(user.catalogFilter || {}), city: found.city, district: '' });
          if (!catalogRecords(user, 'all').length) user.catalogFilter = normalizedCatalogFilter({ city: found.city });
          scheduleSave();
          void notifyAdministratorAction(user, 'Искал объекты в городе', found.city);
          await clearUiMessages(message.chat.id, user, token);
          await clearGalleryMessages(message.chat.id, user, token);
          await sendCatalogPage(message.chat.id, user, token, 0, 'all');
          return;
        }
        if (found && found.exact) {
          // Just a property number: its card.
          const records = catalogRecords(user, 'all');
          user.catalogContext = { mode: 'all', page: Math.max(0, records.findIndex((item) => item.id === found.record.id)), propertyId: found.record.id };
          scheduleSave();
          void notifyAdministratorAction(user, 'Открыл объект по номеру', found.record.reference || found.record.id);
          await clearUiMessages(message.chat.id, user, token);
          await sendPropertyCard(message.chat.id, user, token, found.record, { heading: '🔖 ' + (PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).propertyHeading, page: 0, totalPages: 1, mode: 'all' });
          return;
        }
        if (adminOwnChat) {
          await sendMessage(message.chat.id, ADMIN_CHAT_HINT, token);
          return;
        }
        if (found) {
          // A question that names a property: the manager sees which one.
          const inquiry = createInquiry(user, propertyRequestText(found.record, 'ru', 'question') + '\n\n' + text, { type: 'question', propertyId: found.record.id, sourceMessage: message });
          recordPropertyEvent(found.record.id, 'questions');
          const title = localizedExact(found.record.title, user.preferredLanguage) || found.record.reference || '';
          answer = mergedAnswer(inquiry) ? '' : [(PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).received, title ? '🔖 ' + title : ''].filter(Boolean).join('\n\n');
          inquiryAnswer = true;
        } else {
          const inquiry = createInquiry(user, text, { type: 'general', sourceMessage: message });
          answer = mergedAnswer(inquiry) ? '' : fillTemplate(messages.fallback, user);
          inquiryAnswer = true;
        }
      }
    }
  } else if (adminOwnChat) {
    await sendMessage(message.chat.id, ADMIN_CHAT_HINT, token);
    return;
  } else {
    const inquiry = createInquiry(user, summary, { type: 'general', sourceMessage: message });
    answer = mergedAnswer(inquiry) ? '' : fillTemplate(messages.fallback, user);
    inquiryAnswer = true;
  }

  // Клиент с открытой заявкой перечислил условия поиска, а фраза не разобралась: одна реакция 👀
  // выглядела как «глаз вместо ответа». Отвечаем коротко и зовём в мастер подбора.
  if (!answer && mergedIntoOpen && searchSignalCount(text, user) >= 2) {
    const language = user.preferredLanguage || 'ru';
    answer = SEARCH_UNCLEAR_TEXT[language] || SEARCH_UNCLEAR_TEXT.ru;
    searchHint = { inline_keyboard: [[{ text: (MENU_LABELS[language] || MENU_LABELS.ru).selection, callback_data: 'selection:start' }]] };
  }

  if (!answer && mergedIntoOpen && message.message_id) {
    try {
      await telegramRequest(token, 'setMessageReaction', { chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: 'emoji', emoji: '👀' }] });
    } catch {
      // Реакция — добавка к тишине; если Telegram её не принял, ничего не теряется.
    }
  }

  if (answer) {
    if (inquiryAnswer) answer = withOffHoursNote(answer, user.preferredLanguage, { user });
    try {
      const sent = await sendMessage(message.chat.id, answer, token, {
        reply_markup: searchHint || menuKeyboard(user.preferredLanguage),
      });
      recordBotAnswer(user, answer, { messageId: sent && sent.message_id });
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Ответ клиенту', error);
      console.error('Не удалось ответить клиенту:', error.message);
    }
  }
}

function updateChatKey(update) {
  const source = update.message || update.message_reaction || (update.callback_query && update.callback_query.message);
  if (source && source.chat) return 'chat:' + source.chat.id;
  if (update.callback_query && update.callback_query.from) return 'chat:' + update.callback_query.from.id;
  return 'update:' + update.update_id;
}

// Updates from one chat are handled in order; different chats run in
// parallel, so one slow conversation does not hold up everyone else.
// A failing update is logged and skipped: the offset always moves past it,
// otherwise Telegram would return the same update forever.
// Telegram считает сообщение доставленным только после запроса со следующим
// offset. Если бот упал между ответом клиенту и сохранением offset, Telegram
// пришлёт те же обновления заново — поэтому номера последних обработанных
// обновлений хранятся в данных, и дважды никто не отвечает.
const HANDLED_UPDATES_KEPT = 200;

// Номера, которые прямо сейчас в работе: стоят в очереди чата или ждут, пока
// соберётся альбом. Пока обновление здесь, оно не считается обработанным, а
// сохраняемая отметка его не обгоняет — если бота остановят, Telegram пришлёт
// это сообщение снова.
// Значение — сколько раз обновление «удерживают»: очередь чата держит его,
// пока разбирает, а собираемый альбом — пока не соберётся. Отпустить его
// можно только когда отпустили все.
const inFlightUpdates = new Map();

function updateId(update) {
  const id = Number(update && update.update_id);
  return Number.isFinite(id) ? id : 0;
}

function wasHandled(update) {
  const id = updateId(update);
  if (!id) return false;
  if (!Array.isArray(data.handledUpdateIds)) data.handledUpdateIds = [];
  return data.handledUpdateIds.includes(id) || inFlightUpdates.has(id);
}

function markHandled(update) {
  const id = updateId(update);
  if (!id) return;
  if (!Array.isArray(data.handledUpdateIds)) data.handledUpdateIds = [];
  if (!data.handledUpdateIds.includes(id)) data.handledUpdateIds.push(id);
  if (data.handledUpdateIds.length > HANDLED_UPDATES_KEPT) {
    data.handledUpdateIds = data.handledUpdateIds.slice(-HANDLED_UPDATES_KEPT);
  }
}

// Сохраняемая отметка — это номер самого раннего незаконченного обновления.
// Отметка в памяти (runtime.offset) идёт вперёд сразу, чтобы Telegram не
// присылал одно и то же по кругу, пока бот работает.
function rememberOffset() {
  let lowest = runtime.offset;
  for (const id of inFlightUpdates.keys()) lowest = Math.min(lowest, id);
  data.telegramOffset = lowest;
}

function holdUpdate(update) {
  const id = updateId(update);
  if (!id) return;
  inFlightUpdates.set(id, (inFlightUpdates.get(id) || 0) + 1);
  rememberOffset();
}

function releaseUpdate(update) {
  const id = updateId(update);
  if (!id) return;
  const holds = (inFlightUpdates.get(id) || 1) - 1;
  if (holds > 0) {
    inFlightUpdates.set(id, holds);
    return;
  }
  markHandled(update);
  inFlightUpdates.delete(id);
  rememberOffset();
}

// Очередь на каждый чат: сообщения одного клиента обрабатываются по порядку,
// а разные чаты идут одновременно. Очереди живут между пачками обновлений,
// поэтому медленная отправка в один чат не задерживает остальные — бот тем
// временем продолжает получать и разбирать новые сообщения.
const chatQueues = new Map();

function queuedUpdates() {
  return chatQueues.size;
}

function enqueueUpdate(update, token, handler) {
  const key = updateChatKey(update);
  const previous = chatQueues.get(key) || Promise.resolve();
  holdUpdate(update);
  const work = previous.then(async () => {
    try {
      // Токен могли сменить, пока сообщение стояло в очереди: отвечаем
      // текущим. Раньше такое сообщение просто выбрасывалось — клиент писал,
      // а в панели не появлялось ничего.
      await handler(update, data.config.botToken || token);
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Обработка сообщения', error);
      console.error('Не удалось обработать обновление ' + update.update_id + ':', error.message);
    } finally {
      releaseUpdate(update);
    }
  });
  const tracked = work.finally(() => {
    if (chatQueues.get(key) === tracked) chatQueues.delete(key);
  });
  chatQueues.set(key, tracked);
  return tracked;
}

function processUpdates(allUpdates, token, handler = handleUpdate) {
  const updates = (Array.isArray(allUpdates) ? allUpdates : []).filter((update) => !wasHandled(update));
  const work = [];
  for (const update of updates) {
    const part = albumMessage(update);
    if (!part) {
      work.push(enqueueUpdate(update, token, handler));
      continue;
    }
    // Часть альбома: собираем сразу, а очередь чата занимает только первая —
    // она и дождётся собранного альбома.
    const first = collectAlbumMessage(part, (assembled) => handler({ ...update, message: assembled, update_id: 0 }, token), update);
    if (first) work.push(enqueueUpdate(update, token, () => waitForAlbum(part)));
  }
  // Отметка в памяти идёт вперёд сразу — иначе Telegram будет присылать те же
  // сообщения по кругу, пока бот их разбирает. Сохраняемая отметка ждёт, пока
  // обработка закончится: незаконченное вернётся после перезапуска.
  for (const update of Array.isArray(allUpdates) ? allUpdates : []) {
    runtime.offset = Math.max(runtime.offset, updateId(update) + 1);
  }
  rememberOffset();
  // Ожидание возвращаем тем, кому оно нужно (проверки и тесты); сам бот его
  // не ждёт.
  return Promise.all(work);
}

async function pollingLoop(generation, token) {
  let backoff = 1000;
  runtime.status = 'connecting';
  runtime.lastError = '';
  runtime.lastErrorAt = null;
  runtime.lastSuccessfulContactAt = null;
  runtime.consecutiveFailures = 0;
  runtime.nextRetryAt = null;
  runtime.pollingStartedAt = new Date().toISOString();

  try {
    const me = await telegramRequest(token, 'getMe', {});
    if (generation !== runtime.generation) return;
    data.bot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
    data.stats.startedAt = data.stats.startedAt || new Date().toISOString();
    markTelegramSuccess();
    telegramContactRestored();
    scheduleSave();
    try {
      await configureBotCommands(token);
    } catch (error) {
      console.error('Не удалось обновить список команд Telegram:', error.message);
    }
    void runDueBroadcasts();
  } catch (error) {
    if (generation !== runtime.generation || error.name === 'AbortError') return;
    markTelegramFailure(error, 'error');
    telegramContactLost();
    recordError('Подключение к Telegram', error);
    console.error('Ошибка подключения к Telegram:', telegramErrorMessage(error));
  }

  while (
    generation === runtime.generation &&
    data.config.active &&
    token === data.config.botToken
  ) {
    const controller = new AbortController();
    runtime.abortController = controller;
    try {
      const updates = await telegramRequest(token, 'getUpdates', {
        offset: runtime.offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query', 'edited_message', 'message_reaction', 'my_chat_member', 'chat_join_request', 'channel_post'],
      }, controller.signal);
      if (generation !== runtime.generation) break;
      markTelegramSuccess();
      telegramContactRestored();
      backoff = 1000;
      // Не ждём окончания обработки: пока одно сообщение грузит фотографию или
      // пережидает «слишком часто», остальные клиенты должны получать ответы.
      const work = processUpdates(updates, token);
      if (generation !== runtime.generation) break;
      if (updates.length) {
        work.then(() => {
          if (generation === runtime.generation) saveDataNow();
        }).catch(() => {});
      }
    } catch (error) {
      if (error.name === 'AbortError' || generation !== runtime.generation) break;
      const firstFailure = markTelegramFailure(error, 'reconnecting');
      telegramContactLost();
      if (firstFailure) recordError('Связь с Telegram', error);
      runtime.nextRetryAt = new Date(Date.now() + backoff).toISOString();
      console.error('Связь с Telegram потеряна, повтор подключения:', telegramErrorMessage(error));
      await delay(backoff);
      runtime.nextRetryAt = null;
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  if (generation === runtime.generation) {
    runtime.status = data.config.active ? 'error' : 'stopped';
    runtime.nextRetryAt = null;
  }
}

function restartPolling() {
  runtime.generation += 1;
  if (runtime.abortController) runtime.abortController.abort();
  runtime.abortController = null;
  runtime.offset = Number(data.telegramOffset || 0);
  runtime.lastError = '';
  runtime.lastErrorAt = null;
  runtime.lastSuccessfulContactAt = null;
  runtime.consecutiveFailures = 0;
  runtime.nextRetryAt = null;
  if (configured() && data.config.active) {
    void pollingLoop(runtime.generation, data.config.botToken);
  } else {
    runtime.status = 'stopped';
  }
}

export {
  inFlightUpdates,
  queuedUpdates,
  findRule,
  handleUpdate,
  pollingLoop,
  processUpdates,
  restartPolling,
  updateChatKey,
};
