// «Уведомления»: клиент сам выбирает, получать ли рассылки и уведомления об
// объектах, и может отписаться от рассылки одной кнопкой под ней.

import { MENU_LABELS, SUBSCRIPTION_TEXT } from './texts.mjs';
import { scheduleSave } from './store.mjs';
import { normalizeUser } from './users.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';
import { sendUiMessage } from './catalog.mjs';
import { acknowledgeCallback } from './sections.mjs';

function subscriptionPanel(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru;
  const newsOn = Boolean(user.newsConsentAt) && !user.broadcastsOptOut;
  const alertsOn = user.propertyAlerts !== false;
  return {
    text: copy.title + (newsOn ? '' : '\n\n' + copy.newsConsent),
    markup: { inline_keyboard: [
      [{ text: (newsOn ? '✅ ' : '⬜ ') + copy.news, callback_data: 'subs:news:' + (newsOn ? 'off' : 'on') }],
      [{ text: (alertsOn ? '✅ ' : '⬜ ') + copy.alerts, callback_data: 'subs:alerts:' + (alertsOn ? 'off' : 'on') }],
      [{ text: '⬅️ ' + (MENU_LABELS[language] || MENU_LABELS.ru).more, callback_data: 'nav:my' }],
    ] },
  };
}

async function sendSubscriptionPanel(chatId, user, token) {
  const panel = subscriptionPanel(user);
  await sendUiMessage(chatId, user, panel.text, token, { reply_markup: panel.markup });
}

// The button under every broadcast.
function unsubscribeButton(language) {
  return { text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).unsubscribe, callback_data: 'subs:news:off:bc' };
}

async function handleSubscriptionCallback(query, token) {
  const [, kind, value, origin] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru;
  if (kind === 'news' && ['on', 'off'].includes(value)) {
    const hadConsent = Boolean(user.newsConsentAt) && !user.broadcastsOptOut;
    const changed = hadConsent !== (value === 'on');
    user.broadcastsOptOut = value === 'off';
    user.broadcastsOptOutAt = value === 'off' ? new Date().toISOString() : '';
    // Время согласия храним как доказательство: его требует и RGPD, и LSSI.
    user.newsConsentAt = value === 'on' ? new Date().toISOString() : '';
    if (changed) void notifyAdministratorAction(user, value === 'off' ? 'Отписался от рассылок' : 'Согласился получать рассылки');
  } else if (kind === 'alerts' && ['on', 'off'].includes(value)) {
    const changed = (user.propertyAlerts !== false) !== (value === 'on');
    user.propertyAlerts = value === 'on';
    if (changed) void notifyAdministratorAction(user, value === 'on' ? 'Включил уведомления об объектах' : 'Отключил уведомления об объектах');
  } else if (kind !== 'menu') {
    await acknowledgeCallback(query, token);
    return;
  }
  scheduleSave();
  // Under a broadcast: a short confirmation with a way back; the broadcast
  // itself stays as it was.
  if (origin === 'bc') {
    await acknowledgeCallback(query, token);
    await sendMessage(chatId, copy.newsOff, token, { reply_markup: { inline_keyboard: [[{ text: copy.undo, callback_data: 'subs:news:on:undo' }]] } });
    return;
  }
  // "Resubscribe" under that confirmation.
  if (origin === 'undo') {
    await acknowledgeCallback(query, token, copy.newsOn);
    if (query.message && query.message.message_id) {
      telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: copy.newsOn }).catch(() => {});
    }
    return;
  }
  await acknowledgeCallback(query, token);
  const panel = subscriptionPanel(user);
  if (kind !== 'menu' && query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: panel.text, reply_markup: panel.markup });
      return;
    } catch {
      // Sent again below when the old panel can no longer be edited.
    }
  }
  await sendSubscriptionPanel(chatId, user, token);
}

export {
  handleSubscriptionCallback,
  sendSubscriptionPanel,
  subscriptionPanel,
  unsubscribeButton,
};
