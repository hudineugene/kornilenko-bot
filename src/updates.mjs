// Обработка входящих обновлений Telegram и цикл опроса.

import { cleanText, delay, fillTemplate } from './util.mjs';
import { COMMAND_TEXT, INTERACTION_TEXT, LANGUAGE_NAMES, MANAGER_CONTACT_TEXT, MENU_LABELS, PROPERTY_ACTION_TEXT } from './texts.mjs';
import { configured, data, runtime, saveDataNow, scheduleSave } from './store.mjs';
import { recordActivity, recordDaily, recordError, recordPropertyEvent } from './analytics.mjs';
import { leadSourceFromPayload, normalizeUser, telegramInterfaceLanguage } from './users.mjs';
import { markTelegramFailure, markTelegramSuccess, sendMessage, telegramErrorMessage, telegramRequest } from './telegram.mjs';
import { configureBotCommands, isLanguageChangeText, languageMessages, menuItemForText, menuKeyboard, sendLanguagePicker, sendMainMenu, sendMoreMenu, sendWelcome } from './menus.mjs';
import { duplicateCallback, duplicateInboundMessage, expiredActionKeyboard, handleLeadFormMessage, handleSelectionFormMessage, handleViewingFormMessage, isStaleFormControl, pendingActionExpired, rememberExpiredAction, restartExpiredAction, showPendingActionStep, startLeadForm, startSelectionForm, unfinishedActionKeyboard } from './forms.mjs';
import { createInquiry, handleAdministratorReply, handleInquiryStatusCallback, handleMessageReaction, inquiryWasMerged, messageSummary, notifyAdministratorAction } from './inquiries.mjs';
import { catalogRecords, clearCatalogMessages, normalizedCatalogFilter, clearGalleryMessages, clearUiMessages, handleCatalogFilterCallback, localizedExact, openPendingStartPayload, sendCatalog, sendCatalogPage, sendPropertyCard } from './catalog.mjs';
import { catalogRequest } from './search.mjs';
import { acknowledgeCallback, handleAboutCallback, handleCatalogCallback, handleContactCallback, handleLanguageCallback, handleNavigationCallback, handlePromotionCallback, handlePropertyCallback, handleSelectionCallback, propertyRequestText, sendAbout, sendContacts, sendHelp, sendPromotions } from './sections.mjs';
import { recordBroadcastResponse, runDueBroadcasts } from './broadcasts.mjs';
import { handleAlertsCallback } from './alerts.mjs';
import { handleViewingConfirmCallback, handleViewingFeedbackCallback } from './viewings.mjs';
import { handleMyRequestsCallback, sendMyRequests } from './requests.mjs';
import { handleSubscriptionCallback } from './subscriptions.mjs';
import { withOffHoursNote } from './hours.mjs';

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

async function handleUpdate(update, token) {
  if (update.message_reaction) {
    await handleMessageReaction(update.message_reaction);
    return;
  }
  if (update.callback_query && String(update.callback_query.data || '').startsWith('inq:confirm:')) {
    await handleViewingConfirmCallback(update.callback_query, token);
    return;
  }
  if (update.callback_query && String(update.callback_query.data || '').startsWith('inq:')) {
    await handleInquiryStatusCallback(update.callback_query, token);
    return;
  }
  if (update.callback_query) {
    const callbackData = String(update.callback_query.data || '');
    const callbackChatId = update.callback_query.message && update.callback_query.message.chat
      ? update.callback_query.message.chat.id
      : update.callback_query.from.id;
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
      else if (callbackData.startsWith('promotions:')) await handlePromotionCallback(update.callback_query, token);
      else if (callbackData.startsWith('contact:')) await handleContactCallback(update.callback_query, token);
      else if (callbackData.startsWith('about:')) await handleAboutCallback(update.callback_query, token);
      else if (callbackData.startsWith('nav:')) await handleNavigationCallback(update.callback_query, token);
      else if (callbackData.startsWith('selection:')) await handleSelectionCallback(update.callback_query, token);
      else if (callbackData.startsWith('alerts:')) await handleAlertsCallback(update.callback_query, token);
      else if (callbackData.startsWith('cfilter:')) await handleCatalogFilterCallback(update.callback_query, token);
      else if (callbackData.startsWith('myreq:')) await handleMyRequestsCallback(update.callback_query, token);
      else if (callbackData.startsWith('vfb:')) await handleViewingFeedbackCallback(update.callback_query, token);
      else if (callbackData.startsWith('subs:')) await handleSubscriptionCallback(update.callback_query, token);
      else {
        const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
        await acknowledgeCallback(update.callback_query, token, copy.stale);
      }
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Действие пользователя', error);
      console.error('Не удалось выполнить действие пользователя:', error.message);
      const copy = INTERACTION_TEXT[callbackUser.preferredLanguage] || INTERACTION_TEXT.ru;
      await sendMessage(callbackChatId, copy.failed, token, { reply_markup: menuKeyboard(callbackUser.preferredLanguage || 'ru') }).catch(() => {});
    }
    return;
  }
  const message = update.message;
  if (!message || !message.from || !message.chat) return;
  if (await handleAdministratorReply(message, token)) return;

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
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const commandArgument = cleanText(text.split(/\s+/).slice(1).join(' '), 100);
  const sourceLabel = command === '/start' ? leadSourceFromPayload(commandArgument) : '';
  if (sourceLabel) {
    // The first link a client came through is kept: it is what brought them.
    if (!user.source) {
      user.source = sourceLabel;
      user.sourceAt = new Date().toISOString();
    }
    scheduleSave();
  } else if (command === '/start' && commandArgument) {
    user.pendingStartPayload = commandArgument;
    scheduleSave();
  }
  if (command === '/myid') {
    void notifyAdministratorAction(user, 'Запросил свой Telegram ID', 'Chat ID: ' + String(message.chat.id));
    const copy = COMMAND_TEXT[user.preferredLanguage || 'ru'] || COMMAND_TEXT.ru;
    await sendMessage(message.chat.id, copy.myId + ' ' + String(message.chat.id), token);
    return;
  }
  // First contact: when the client's Telegram is set to a language the bot
  // speaks, greet them in it instead of asking. "🌐 Change language" stays in
  // the menu. Other Telegram languages still get the picker.
  const telegramLanguage = telegramInterfaceLanguage(user);
  if (!user.preferredLanguage && telegramLanguage && command !== '/language') {
    user.preferredLanguage = telegramLanguage;
    scheduleSave();
    void notifyAdministratorAction(user, 'Первый запуск', 'Язык по настройкам Telegram: ' + LANGUAGE_NAMES[telegramLanguage]);
    await sendWelcome(message.chat.id, user, token);
    if (command === '/start') {
      await openPendingStartPayload(user, token);
      return;
    }
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
    const inquiry = createInquiry(user, text || summary, { type: 'general', sourceMessage: message });
    answer = inquiryWasMerged(inquiry) ? '' : fillTemplate(messages.fallback, user);
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
  else if (user.pendingAction && user.pendingAction.type === 'lead' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleLeadFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'viewing_form' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleViewingFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'property_selection' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    await handleSelectionFormMessage(message, user, token);
    return;
  }
  else if (user.pendingAction && user.pendingAction.type === 'manager_question' && (!text || !menuItemForText(text, user.preferredLanguage))) {
    user.pendingAction = null;
    const inquiry = createInquiry(user, text || summary, { type: 'question', sourceMessage: message });
    scheduleSave();
    answer = inquiryWasMerged(inquiry) ? '' : (MANAGER_CONTACT_TEXT[user.preferredLanguage] || MANAGER_CONTACT_TEXT.ru).received;
    inquiryAnswer = true;
  }
  else if (user.pendingAction && (!text || !menuItemForText(text, user.preferredLanguage))) {
    const pending = user.pendingAction;
    user.pendingAction = null;
    const property = data.objects.find((item) => item.id === pending.propertyId);
    if (property) {
      const type = pending.type === 'viewing' ? 'viewing' : 'question';
      const prefix = propertyRequestText(property, user.preferredLanguage, type);
      createInquiry(user, prefix + '\n\n' + (text || summary), { type, propertyId: property.id, sourceMessage: message });
      recordPropertyEvent(property.id, type === 'viewing' ? 'viewings' : 'questions');
      const received = (PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).received;
      const propertyTitle = localizedExact(property.title, user.preferredLanguage) || property.reference || '';
      answer = [received, propertyTitle ? '🏠 ' + propertyTitle : ''].filter(Boolean).join('\n\n');
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
        if (menuItem === 'objects' && await sendCatalog(message.chat.id, user, token)) return;
        if (menuItem === 'selection') {
          await startSelectionForm(user, token);
          return;
        }
        if (menuItem === 'promotions' && await sendPromotions(message.chat.id, user, token)) return;
        if (menuItem === 'favorites') {
          const context = user.catalogContext && user.catalogContext.mode === 'favorites' ? user.catalogContext : { page: 0 };
          await sendCatalogPage(message.chat.id, user, token, Math.max(0, Number(context.page) || 0), 'favorites');
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
        if (found && found.kind === 'city') {
          // A city name alone: the catalog in that city, the filter can be reset.
          user.catalogFilter = normalizedCatalogFilter({ city: found.city });
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
          user.catalogContext = { mode: 'all', page: Math.max(0, records.findIndex((item) => item.id === found.record.id)) };
          scheduleSave();
          void notifyAdministratorAction(user, 'Открыл объект по номеру', found.record.reference || found.record.id);
          await clearUiMessages(message.chat.id, user, token);
          await sendPropertyCard(message.chat.id, user, token, found.record, { heading: '🏠 ' + (PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).propertyHeading, page: 0, totalPages: 1, mode: 'all' });
          return;
        }
        if (found) {
          // A question that names a property: the manager sees which one.
          const inquiry = createInquiry(user, propertyRequestText(found.record, user.preferredLanguage, 'question') + '\n\n' + text, { type: 'question', propertyId: found.record.id, sourceMessage: message });
          recordPropertyEvent(found.record.id, 'questions');
          const title = localizedExact(found.record.title, user.preferredLanguage) || found.record.reference || '';
          answer = inquiryWasMerged(inquiry) ? '' : [(PROPERTY_ACTION_TEXT[user.preferredLanguage] || PROPERTY_ACTION_TEXT.ru).received, title ? '🏠 ' + title : ''].filter(Boolean).join('\n\n');
          inquiryAnswer = true;
        } else {
          const inquiry = createInquiry(user, text, { type: 'general', sourceMessage: message });
          answer = inquiryWasMerged(inquiry) ? '' : fillTemplate(messages.fallback, user);
          inquiryAnswer = true;
        }
      }
    }
  } else {
    const inquiry = createInquiry(user, summary, { type: 'general', sourceMessage: message });
    answer = inquiryWasMerged(inquiry) ? '' : fillTemplate(messages.fallback, user);
    inquiryAnswer = true;
  }

  if (answer) {
    if (inquiryAnswer) answer = withOffHoursNote(answer, user.preferredLanguage);
    try {
      await sendMessage(message.chat.id, answer, token, {
        reply_markup: menuKeyboard(user.preferredLanguage),
      });
    } catch (error) {
      runtime.lastError = error.message;
      recordError('Ответ пользователю', error);
      console.error('Не удалось ответить пользователю:', error.message);
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
async function processUpdates(updates, token, handler = handleUpdate) {
  const generation = runtime.generation;
  const queues = new Map();
  for (const update of updates) {
    const key = updateChatKey(update);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(update);
  }
  await Promise.all(Array.from(queues.values(), async (queue) => {
    for (const update of queue) {
      try {
        await handler(update, token);
      } catch (error) {
        runtime.lastError = error.message;
        recordError('Обработка сообщения', error);
        console.error('Не удалось обработать обновление ' + update.update_id + ':', error.message);
      }
    }
  }));
  // After a token change or restart the offset belongs to the new session.
  if (generation !== runtime.generation) return;
  for (const update of updates) {
    runtime.offset = Math.max(runtime.offset, Number(update.update_id) + 1);
  }
  data.telegramOffset = runtime.offset;
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
        allowed_updates: ['message', 'callback_query', 'message_reaction'],
      }, controller.signal);
      if (generation !== runtime.generation) break;
      markTelegramSuccess();
      backoff = 1000;
      await processUpdates(updates, token);
      if (generation !== runtime.generation) break;
      if (updates.length) saveDataNow();
    } catch (error) {
      if (error.name === 'AbortError' || generation !== runtime.generation) break;
      const firstFailure = markTelegramFailure(error, 'reconnecting');
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
  findRule,
  handleUpdate,
  pollingLoop,
  processUpdates,
  restartPolling,
  updateChatKey,
};
