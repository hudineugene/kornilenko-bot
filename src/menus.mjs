// Главное меню, приветствие, выбор языка и команды бота.

import { fillTemplate } from './util.mjs';
import { imageExists } from './media.mjs';
import { BOT_COMMAND_DESCRIPTIONS, COMPARISON_TEXT, PRIVACY_TEXT, LANGUAGE_NAMES, LANGUAGE_PICKER_TEXT, LEGACY_MENU_LABELS, MAIN_MENU_TEXT, MENU_HINTS, MENU_LABELS, MY_AREA_TEXT, MY_REQUESTS_TEXT, NAVIGATION_TEXT, PREVIOUS_MENU_LABELS, SAVED_SEARCH_TEXT, SUBSCRIPTION_TEXT } from './texts.mjs';
import { data, runtime } from './store.mjs';
import { sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { catalogRecords, clearCatalogMessages, clearGalleryMessages, clearUiMessages, normalizedSavedSearch, sendUiMessage } from './catalog.mjs';
import { tunnelInstalled } from './remote.mjs';
import { inquiryChats } from './inquiries.mjs';
import { ADMIN_COMMAND_DESCRIPTIONS } from './admin-commands.mjs';

function languageMessages(language) {
  return data.config.messages[language] || data.config.messages.ru;
}

// Four short rows. "Call me back" is on the main keyboard: for an agency it
// is the main action. The language is chosen automatically and can be
// changed in "My space".
function menuKeyboard(language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  return {
    keyboard: [
      [{ text: labels.objects }, { text: labels.selection }],
      [{ text: labels.favorites }, { text: labels.promotions }],
      [{ text: labels.request }, { text: labels.contacts }],
      [{ text: labels.more }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: labels.placeholder,
  };
}

function menuItemForText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  const previous = PREVIOUS_MENU_LABELS[language] || PREVIOUS_MENU_LABELS.ru;
  return ['objects', 'selection', 'contacts', 'promotions', 'favorites', 'request', 'about', 'help', 'more'].find((key) => {
    return labels[key] === text || legacy[key] === text || previous[key] === text;
  }) || '';
}

// The picker is inline buttons, but people type the answer too: "Русский",
// "English", "es", a flag. A typed name counts as a choice, so the picker is
// not sent again and again.
const LANGUAGE_TEXT_ALIASES = {
  ru: ['русский', 'руский', 'россия', 'russian', 'ru', 'rus', '🇷🇺'],
  en: ['english', 'английский', 'англ', 'en', 'eng', '🇬🇧', '🇺🇸'],
  es: ['español', 'espanol', 'espanol', 'испанский', 'испания', 'spanish', 'es', 'spa', '🇪🇸'],
};

function languageFromText(text, options = {}) {
  const value = String(text || '').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{Emoji_Presentation}]+/gu, ' ').trim();
  if (!value || value.length > 20) return '';
  for (const [language, aliases] of Object.entries(LANGUAGE_TEXT_ALIASES)) {
    // Точное совпадение — когда язык уже выбран: «есть русский агент?» должно
    // остаться вопросом менеджеру, а не сменой языка.
    if (aliases.some((alias) => value === alias || (!options.exact && value.split(' ').includes(alias)))) return language;
  }
  return '';
}

function isLanguageChangeText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  return text === labels.language || text === legacy.language;
}

async function sendWelcome(chatId, user, token, options = {}) {
  const language = user.preferredLanguage || 'ru';
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  const greeting = fillTemplate(languageMessages(language).greeting, user) + '\n\n' + MENU_HINTS[language];
  const menu = menuKeyboard(language);
  // Язык выбран за клиента — значит первым делом даём его сменить.
  const keyboard = options.languageButton
    ? { ...menu, keyboard: [...menu.keyboard, [{ text: (MENU_LABELS[language] || MENU_LABELS.ru).language }]] }
    : menu;
  const image = data.welcomeImages[language];
  if (imageExists(image)) {
    if (greeting.length <= 1000) {
      await sendPhotoMessage(chatId, image, greeting, token, keyboard);
    } else {
      await sendPhotoMessage(chatId, image, '', token, null);
      await sendMessage(chatId, greeting, token, { reply_markup: keyboard });
    }
  } else {
    await sendMessage(chatId, greeting, token, { reply_markup: keyboard });
  }
}

async function sendMainMenu(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  await sendMessage(chatId, MAIN_MENU_TEXT[language] || MAIN_MENU_TEXT.ru, token, { reply_markup: menuKeyboard(language) });
}

async function sendMoreMenu(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const copy = MY_AREA_TEXT[language] || MY_AREA_TEXT.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const favorites = catalogRecords(user, 'favorites').length;
  const comparison = catalogRecords(user, 'comparison').length;
  const savedSearch = normalizedSavedSearch(user.savedSearch);
  const savedCopy = SAVED_SEARCH_TEXT[language] || SAVED_SEARCH_TEXT.ru;
  const savedState = savedSearch
    ? ' · ' + (savedSearch.enabled && user.propertyAlerts !== false ? savedCopy.onShort : savedCopy.pausedShort)
    : '';
  const recent = catalogRecords(user, 'recent').length;
  const requests = data.inquiries.filter((inquiry) => inquiry.userId === String(user.id)).length;
  const count = (value) => ' · ' + Math.min(999, Number(value) || 0);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  await sendUiMessage(chatId, user, copy.title + '\n\n' + copy.intro, token, {
    reply_markup: {
      inline_keyboard: [
        [{ text: labels.favorites + count(favorites), callback_data: 'catalog:favorites:0' }],
        [{ text: (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).menuButton + count(comparison), callback_data: 'compare:view' }],
        [{ text: savedCopy.menuButton + savedState, callback_data: 'saved:view' }],
        [{ text: copy.recent + count(recent), callback_data: 'catalog:recent:0' }],
        [{ text: (MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru).menuButton + count(requests), callback_data: 'myreq:list' }],
        [{ text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).menuButton, callback_data: 'subs:menu' }],
        [{ text: (PRIVACY_TEXT[language] || PRIVACY_TEXT.ru).menuButton, callback_data: 'privacy:open' }],
        [{ text: labels.about, callback_data: 'nav:about' }, { text: labels.help, callback_data: 'nav:help' }],
        [{ text: labels.language, callback_data: 'nav:language' }],
        [{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }],
      ],
    },
  });
}

async function sendLanguagePicker(chatId, token, currentLanguage = '') {
  const language = ['ru', 'en', 'es'].includes(currentLanguage) ? currentLanguage : 'ru';
  const languageButton = (language, flag) => ({
    text: (currentLanguage === language ? '✓ ' : '') + flag + ' ' + LANGUAGE_NAMES[language],
    callback_data: 'language:' + language,
  });
  await sendMessage(
    chatId,
    LANGUAGE_PICKER_TEXT[language] || LANGUAGE_PICKER_TEXT.ru,
    token,
    {
      reply_markup: {
        inline_keyboard: [
          [languageButton('ru', '🇷🇺')],
          [languageButton('en', '🇬🇧')],
          [languageButton('es', '🇪🇸')],
        ],
      },
    }
  );
}

async function configureBotCommands(token) {
  const commandsFor = (language) => Object.entries(BOT_COMMAND_DESCRIPTIONS[language] || BOT_COMMAND_DESCRIPTIONS.en)
    .map(([command, description]) => ({ command, description }));
  const commandSets = {
    default: commandsFor('en'),
    ru: commandsFor('ru'),
    en: commandsFor('en'),
    es: commandsFor('es'),
  };
  for (const [language, commands] of Object.entries(commandSets)) {
    const payload = { commands };
    if (language !== 'default') payload.language_code = language;
    await telegramRequest(token, 'setMyCommands', payload);
  }
  // The admin and manager chats also see /inbox, /viewings and /stats. A chat
  // the bot cannot reach yet is skipped: it gets them on the next update.
  const staff = Object.entries(ADMIN_COMMAND_DESCRIPTIONS).map(([command, description]) => ({ command, description }));
  for (const chat of inquiryChats()) {
    await telegramRequest(token, 'setMyCommands', { commands: [...staff, ...commandsFor('ru')], scope: { type: 'chat', chat_id: chat.chatId } })
      .catch((error) => console.error('Команды для чата ' + chat.name + ' не обновлены:', error.message));
  }
}

function publicRuntime() {
  return {
    status: runtime.status,
    lastError: runtime.lastError,
    lastErrorAt: runtime.lastErrorAt,
    lastSuccessfulContactAt: runtime.lastSuccessfulContactAt,
    consecutiveFailures: runtime.consecutiveFailures,
    nextRetryAt: runtime.nextRetryAt,
    pollingStartedAt: runtime.pollingStartedAt,
    broadcastRunning: runtime.broadcastRunning,
    // Запись на диск не удалась: изменения пока только в памяти. Панель должна
    // сказать об этом сразу — иначе владелец узнает о потере после перезапуска.
    save: {
      error: runtime.lastSaveError || '',
      at: runtime.lastSaveErrorAt || null,
      nextRetryAt: runtime.nextSaveRetryAt || null,
    },
    tunnel: { status: runtime.tunnel.status, url: runtime.tunnel.url, error: runtime.tunnel.error, installed: tunnelInstalled() },
  };
}

export {
  configureBotCommands,
  isLanguageChangeText,
  languageFromText,
  languageMessages,
  menuItemForText,
  menuKeyboard,
  publicRuntime,
  sendLanguagePicker,
  sendMainMenu,
  sendMoreMenu,
  sendWelcome,
};
