// Главное меню, приветствие, выбор языка и команды бота.

import { fillTemplate } from './util.mjs';
import { imageExists } from './media.mjs';
import { BOT_COMMAND_DESCRIPTIONS, LANGUAGE_NAMES, LANGUAGE_PICKER_TEXT, LEGACY_MENU_LABELS, MAIN_MENU_TEXT, MENU_HINTS, MENU_LABELS, NAVIGATION_TEXT } from './texts.mjs';
import { data, runtime } from './store.mjs';
import { sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { clearCatalogMessages, clearGalleryMessages, clearUiMessages, sendUiMessage } from './catalog.mjs';
import { tunnelInstalled } from './remote.mjs';

function languageMessages(language) {
  return data.config.messages[language] || data.config.messages.ru;
}

function menuKeyboard(language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  return {
    keyboard: [
      [{ text: labels.objects }],
      [{ text: labels.selection }],
      [{ text: labels.favorites }, { text: labels.promotions }],
      [{ text: labels.contacts }],
      [{ text: labels.more }, { text: labels.language }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: labels.placeholder,
  };
}

function menuItemForText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  return ['objects', 'selection', 'contacts', 'promotions', 'favorites', 'request', 'about', 'help', 'more'].find((key) => {
    return labels[key] === text || legacy[key] === text;
  }) || '';
}

function isLanguageChangeText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  return text === labels.language || text === legacy.language;
}

async function sendWelcome(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  const greeting = fillTemplate(languageMessages(language).greeting, user) + '\n\n' + MENU_HINTS[language];
  const keyboard = menuKeyboard(language);
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
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const prompt = language === 'en'
    ? 'More useful sections:'
    : language === 'es'
      ? 'Más secciones útiles:'
      : 'Дополнительные разделы:';
  await sendUiMessage(chatId, user, prompt, token, {
    reply_markup: {
      inline_keyboard: [
        [{ text: labels.about, callback_data: 'nav:about' }],
        [{ text: labels.help, callback_data: 'nav:help' }],
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
    tunnel: { status: runtime.tunnel.status, url: runtime.tunnel.url, error: runtime.tunnel.error, installed: tunnelInstalled() },
  };
}

export {
  configureBotCommands,
  isLanguageChangeText,
  languageMessages,
  menuItemForText,
  menuKeyboard,
  publicRuntime,
  sendLanguagePicker,
  sendMainMenu,
  sendMoreMenu,
  sendWelcome,
};
