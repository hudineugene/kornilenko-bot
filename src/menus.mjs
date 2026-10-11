// Главное меню, приветствие, выбор языка и команды бота.

import { trustButtonRow } from './trust.mjs';
import { goalMenuRow } from './goal.mjs';
import { planMenuRow } from './plan.mjs';
import { fillTemplate } from './util.mjs';
import { imageExists } from './media.mjs';
import { PROPERTY_ACTION_TEXT, BOT_COMMAND_DESCRIPTIONS, CATALOG_SUMMARY_TEXT, COMPARISON_TEXT, PRIVACY_TEXT, LANGUAGE_NAMES, LANGUAGE_PICKER_TEXT, EARLIER_CONTACT_LABELS, EARLIER_FAVORITES_LABELS, LEGACY_MENU_LABELS, MAIN_MENU_TEXT, MENU_HINTS, MENU_LABELS, MY_AREA_TEXT, MY_REQUESTS_TEXT, NAVIGATION_TEXT, PREVIOUS_MENU_LABELS, SAVED_SEARCH_TEXT, SUBSCRIPTION_TEXT } from './texts.mjs';
import { data, runtime } from './store.mjs';
import { sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { sharedListByCode, catalogRecords, clearCatalogMessages, clearGalleryMessages, clearUiMessages, localizedExact, normalizedSavedSearch, promotionIsActive, searchExampleText, sendUiMessage } from './catalog.mjs';
import { tunnelInstalled } from './remote.mjs';
import { inquiryChats } from './inquiries.mjs';
import { ADMIN_COMMAND_DESCRIPTIONS } from './admin-commands.mjs';
import { refreshChatMenuButton } from './miniapp/menu-button.mjs';
import { LANGUAGES, addUk } from './languages.mjs';

function languageMessages(language) {
  return data.config.messages[language] || data.config.messages.ru;
}

// Сколько акций видит клиент прямо сейчас: пустой раздел в меню — это
// обещание, которого бот не выполняет.
function activePromotionCount(language) {
  return data.promotions.filter((record) => {
    return promotionIsActive(record) && (localizedExact(record.title, language) || localizedExact(record.text, language));
  }).length;
}

// Пять кнопок вместо семи: объекты, подбор, связаться, акции (только когда
// они есть) и «Моё». «Позвоните мне» и «Менеджер» вели в одно и то же место —
// теперь это одна кнопка «Связаться». «Избранное» переехало в «Моё»: им
// пользуются реже, чем каталогом, а место в меню дорогое.
function menuKeyboard(language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const promotions = activePromotionCount(language);
  // Без акций — 2-2-2: внизу «Связаться» и «О компании» (покупатель новостройки прежде всего спрашивает, кто строит). Раньше «Связаться» стояла одна. С акциями — три ряда
  // по две. Гид «Как купить в Испании» — на виду, в главном меню: раньше он был седьмым рядом экрана
  // «Связаться», и покупатель его не находил.
  const rows = promotions
    ? [
      [{ text: labels.objects }, { text: labels.selection }],
      [{ text: labels.contacts }, { text: labels.promotions + ' · ' + promotions }],
      [{ text: labels.guide }, { text: labels.more }],
    ]
    : [
      [{ text: labels.objects }, { text: labels.selection }],
      [{ text: labels.guide }, { text: labels.more }],
      [{ text: labels.contacts }, { text: labels.about }],
    ];
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: labels.placeholder,
  };
}

function menuItemForText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  const previous = PREVIOUS_MENU_LABELS[language] || PREVIOUS_MENU_LABELS.ru;
  // У «Акций» на кнопке стоит число — отрезаем его перед сравнением.
  const value = String(text || '').replace(/\s+·\s+\d+$/, '');
  const earlierContacts = EARLIER_CONTACT_LABELS[language] || EARLIER_CONTACT_LABELS.ru;
  return ['objects', 'selection', 'contacts', 'promotions', 'favorites', 'request', 'about', 'help', 'more', 'guide'].find((key) => {
    return labels[key] === value || legacy[key] === value || [].concat(previous[key] || []).includes(value)
      || (key === 'contacts' && earlierContacts.includes(value))
      || (key === 'favorites' && (EARLIER_FAVORITES_LABELS[language] || []).includes(value));
  }) || '';
}

// The picker is inline buttons, but people type the answer too: "Русский",
// "English", "Español", a flag. A typed name counts as a choice, so the picker is
// not sent again and again.
// Только названия самих языков и флаги. Названия стран («Испания», «Россия») и
// короткие коды («es», «en», «ru») сюда не входят: «es» по-испански значит
// «есть», «en» — «в», и клиент, написавший «en Marbella» или просто «Испания»
// про место поиска, оказывался на другом языке интерфейса.
const LANGUAGE_TEXT_ALIASES = {
  ru: ['русский', 'руский', 'russian', '🇷🇺'],
  uk: ['українська', 'українською', 'украинский', 'украинском', 'украинська', 'ukrainian', 'ucraniano', 'ua', 'uk', '🇺🇦'],
  en: ['english', 'английский', 'англ', '🇬🇧', '🇺🇸'],
  es: ['español', 'espanol', 'испанский', 'spanish', '🇪🇸'],
};
addUk(LANGUAGE_TEXT_ALIASES);

function languageFromText(text, options = {}) {
  const value = String(text || '').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{Emoji_Presentation}]+/gu, ' ').trim();
  if (!value || value.length > 20) return '';
  for (const [language, aliases] of Object.entries(LANGUAGE_TEXT_ALIASES)) {
    // Точное совпадение — когда язык уже выбран: «есть русский агент?» должно
    // остаться вопросом менеджеру, а не сменой языка.
    // Двухбуквенные коды («ua», «uk») — только когда они и есть всё сообщение: «uk» внутри фразы чаще значит Великобританию.
    if (aliases.some((alias) => value === alias || (!options.exact && alias.length > 2 && value.split(' ').includes(alias)))) return language;
  }
  return '';
}

function isLanguageChangeText(text, language) {
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const legacy = LEGACY_MENU_LABELS[language] || LEGACY_MENU_LABELS.ru;
  return text === labels.language || text === legacy.language;
}

// «Сейчас в каталоге: 12 объектов — Бенидорм, Альтеа, Кальпе». Клиент сразу
// видит, что бот не пустой и где именно есть дома. Считаем по тому, что видно
// именно этому клиенту — на его языке.
function catalogSummaryLine(user, language) {
  const copy = CATALOG_SUMMARY_TEXT[language] || CATALOG_SUMMARY_TEXT.ru;
  const records = catalogRecords(user, 'all');
  if (!records.length) return copy.empty;
  const cities = [];
  for (const record of records) {
    const city = localizedExact(record.city, language, 80);
    if (city && !cities.includes(city)) cities.push(city);
    if (cities.length >= 3) break;
  }
  const tens = records.length % 100;
  const ones = records.length % 10;
  const word = tens >= 11 && tens <= 14 ? copy.many : ones === 1 ? copy.one : ones >= 2 && ones <= 4 ? copy.few : copy.many;
  return copy.line
    .replace('{count}', () => (records.length + ' ' + word))
    .replace('{cities}', () => (cities.join(', ')));
}

// «… Или выберите раздел в меню ниже 👇» → «…»; если подсказка состоит из одного этого призыва, остаётся как есть.
function withoutMenuCall(hint) {
  const shorter = String(hint).replace(/\s*[^.!?]*👇\s*$/u, '').trim();
  return shorter || hint;
}

async function sendWelcome(chatId, user, token, options = {}) {
  const language = user.preferredLanguage || 'ru';
  void refreshChatMenuButton(user, token);
  await clearUiMessages(chatId, user, token);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  // Сразу за приветствием бот спросит о цели своим вопросом — второй призыв «выберите раздел» в приветствии лишний.
  const goalFollows = Boolean(options.goalFollows) && !user.goal && !user.goalAskedAt;
  // Пришёл по ссылке с подборкой: коротко здороваемся, без фото, примера запроса и вопросов — сразу подборка.
  if (options.compact) {
    await sendMessage(chatId, fillTemplate(languageMessages(language).greeting, user), token, { reply_markup: options.languageButton ? { ...menuKeyboard(language), keyboard: [...menuKeyboard(language).keyboard, [{ text: (MENU_LABELS[language] || MENU_LABELS.ru).language }]] } : menuKeyboard(language) });
    return;
  }
  const hint = MENU_HINTS[language].replace('{example}', () => (searchExampleText(user, language) ? ': ' + (language === 'en' ? '“' : '«') + searchExampleText(user, language) + (language === 'en' ? '”' : '»') : ''));
  const greeting = [
    fillTemplate(languageMessages(language).greeting, user),
    catalogSummaryLine(user, language),
    // Пример запроса — из настоящего каталога; в текст владельца без {example} ничего не подставляется.
    goalFollows ? withoutMenuCall(hint) : hint,
  ].filter(Boolean).join('\n\n');
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
  const requests = data.inquiries.filter((inquiry) => inquiry.userId === String(user.id)).length;
  // Счётчик без разделителя: в паре помещается 15 знаков.
  const count = (value) => ' ' + Math.min(999, Number(value) || 0);
  await clearGalleryMessages(chatId, user, token);
  await clearCatalogMessages(chatId, user, token);
  await sendUiMessage(chatId, user, copy.title + '\n\n' + copy.intro, token, {
    reply_markup: {
      // Шесть рядов вместо десяти: избранное и сравнение, заявки и подписки, план покупки,
      // «цель» с «Почему мы», служебный ряд из трёх коротких кнопок и главное меню.
      // Подписи в парах короткие: Telegram делит ряд поровну и обрезает длинное.
      inline_keyboard: [
        [
          { text: labels.favorites + count(favorites), callback_data: 'catalog:favorites:0' },
          { text: (COMPARISON_TEXT[language] || COMPARISON_TEXT.ru).menuButton + count(comparison), callback_data: 'compare:view' },
        ],
        [
          { text: (MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru).menuShort + count(requests), callback_data: 'myreq:list' },
          { text: (SUBSCRIPTION_TEXT[language] || SUBSCRIPTION_TEXT.ru).menuButton, callback_data: 'subs:menu' },
        ],
        planMenuRow(user, language),
        ...sharedMenuRow(user, language),
        [...goalMenuRow(language), ...(trustButtonRow(language) || [])],
        [
          { text: (PRIVACY_TEXT[language] || PRIVACY_TEXT.ru).menuShort, callback_data: 'privacy:open' },
          { text: labels.help, callback_data: 'nav:help' },
          { text: '🌐 ' + ({ ru: 'Язык', uk: 'Мова', en: 'Language', es: 'Idioma' }[language] || 'Язык'), callback_data: 'nav:language' },
        ],
        [{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }],
      ],
    },
  });
}

// «📤 Подборка · 3» — вернуться к подборке, которую прислал друг: из «Моё» путь назад к ней всегда есть.
function sharedMenuRow(user, language) {
  if (!sharedListByCode(user.sharedListCode)) return [];
  const count = catalogRecords(user, 'shared').length;
  if (!count) return [];
  return [[{ text: (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).sharedMenu + ' ' + count, callback_data: 'catalog:shared:0' }]];
}

async function sendLanguagePicker(chatId, token, currentLanguage = '') {
  const language = LANGUAGES.includes(currentLanguage) ? currentLanguage : 'ru';
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
          [languageButton('uk', '🇺🇦')],
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
    uk: commandsFor('uk'),
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
