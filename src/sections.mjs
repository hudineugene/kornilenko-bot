// Акции, контакты, «О компании», помощь и обработка их кнопок.

import { cleanText, fillTemplate, managerNameFor } from './util.mjs';
import { defaultData, normalizeGuidePages } from './data-format.mjs';
import { imageExists } from './media.mjs';
import { COMPARISON_TEXT, EMPTY_STATE_TEXT, INTERACTION_TEXT, LANGUAGE_NAMES, LEAD_FORM_TEXT, LANGUAGE_SELECTED, MANAGER_CONTACT_TEXT, MENU_LABELS, NAVIGATION_TEXT, PROPERTY_ACTION_TEXT } from './texts.mjs';
import { data, scheduleSave } from './store.mjs';
import { markFunnel, recordError, recordPropertyEvent } from './analytics.mjs';
import { normalizeUser } from './users.mjs';
import { sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { languageMessages, menuKeyboard, sendLanguagePicker, sendMainMenu, sendMoreMenu, sendWelcome } from './menus.mjs';
import { knownLeadPhone, startLeadEdit, startLeadForm, startViewingForm } from './forms.mjs';
import { createInquiry, notifyAdministratorAction } from './inquiries.mjs';
import { replyPromise, withOffHoursNote } from './hours.mjs';
import { calculatorButton } from './calculator.mjs';
import { CATALOG_MODES, catalogHeading, catalogViewContext, escapeTelegramHtml, catalogMode, catalogRecords, clearCatalogMessages, clearGalleryMessages, clearUiMessages, COMPARISON_LIMIT, contentButtons, deleteCatalogMessages, editPropertyCard, localizedExact, mobileButtonText, objectCaptionHtml, openPendingStartPayload, promotionButtons, promotionIsActive, propertyReadyForLanguage, propertyShareUrl, recordImages, sendCatalogPage, sendPropertyCard, sendSelectionWizard, sendUiMessage, shortenedText, showCatalogPageFromCallback, showPropertyPhoto, translateCatalogFilterCity, validHttpUrl, whatsappContactUrl } from './catalog.mjs';
import { addToComparison, comparisonContains, sendComparison } from './comparison.mjs';
import { similarPropertyRanking } from './similar.mjs';
import { DEAD_END_TEXT, nearestByBudget } from './dead-end.mjs';
import { trustButtonRow } from './trust.mjs';
import { askGoal } from './goal.mjs';
import { planGuideRow } from './plan.mjs';

async function sendPromotionPage(chatId, user, token, page = 0) {
  const language = user.preferredLanguage || 'ru';
  const records = data.promotions.filter((record) => {
    return promotionIsActive(record) && (localizedExact(record.title, language) || localizedExact(record.text, language));
  }).slice(0, 12);
  if (!records.length) {
    await clearCatalogMessages(chatId, user, token);
    const empty = EMPTY_STATE_TEXT[language] || EMPTY_STATE_TEXT.ru;
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const manager = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    await sendUiMessage(chatId, user, empty.promotions, token, { reply_markup: { inline_keyboard: [
      [{ text: '🏘 ' + navigation.browse, callback_data: 'catalog:all:0' }],
      [{ text: manager.question, callback_data: 'contact:question' }],
    ] } });
    return true;
  }
  const safePage = Math.min(Math.max(0, Number(page) || 0), records.length - 1);
  const record = records[safePage];
  const title = localizedExact(record.title, language);
  const body = localizedExact(record.text, language);
  // The page number is shown on the pager buttons when there is more than one.
  const caption = [('🔥 ' + title).trim(), body].filter(Boolean).join('\n\n').slice(0, 1000);
  const markup = promotionButtons(record, language, safePage, records.length);
  const previousMessageIds = Array.isArray(user.catalogMessageIds) ? [...user.catalogMessageIds] : [];
  let message;
  const image = recordImages(record, language)[0];
  if (imageExists(image)) message = await sendPhotoMessage(chatId, image, caption, token, markup);
  else message = await sendMessage(chatId, caption, token, markup ? { reply_markup: markup } : {});
  const nextIds = message && Number.isFinite(Number(message.message_id)) ? [Number(message.message_id)] : [];
  user.catalogMessageIds = nextIds;
  scheduleSave();
  await deleteCatalogMessages(chatId, previousMessageIds.filter((messageId) => !nextIds.includes(Number(messageId))), token);
  return true;
}

async function sendPromotions(chatId, user, token) {
  return sendPromotionPage(chatId, user, token, 0);
}

async function sendContacts(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
  const contact = data.contacts || defaultData.contacts;
  const phones = String(contact.phone || '').match(/\+?\d[\d\s().-]{5,}\d/g) || [];
  const lines = [localizedExact(contact.text, language, 3200) || copy.intro];
  const managerName = managerNameFor(contact, language);
  const email = cleanText(contact.email, 254);
  // Лицо агента: покупателю из-за границы важно увидеть, с кем он говорит. Фото
  // идёт отдельным сообщением над экраном (правки текста экрана его не трогают)
  // и убирается вместе с ним. Имя тогда стоит под фото и в тексте не повторяется.
  const photoMessageId = await sendManagerPhoto(chatId, user, contact, managerName, token);
  if (managerName && !photoMessageId) lines.push('👨‍💼 ' + managerName);
  if (phones.length) lines.push(copy.tapPhone);
  for (const phone of phones) lines.push('☎️ ' + cleanText(phone, 80));
  if (email) lines.push('✉️ ' + email);
  // Сколько ждать ответа — видно сразу, а не только после отправки заявки.
  const promise = replyPromise(language);
  if (promise) lines.push('⏱ ' + promise);
  const text = lines.filter(Boolean).join('\n\n');
  const entities = [];
  for (const phone of phones) {
    const display = cleanText(phone, 80);
    const offset = text.lastIndexOf(display);
    if (offset >= 0) entities.push({ type: 'phone_number', offset, length: display.length });
  }
  if (email) {
    const offset = text.lastIndexOf(email);
    if (offset >= 0) entities.push({ type: 'email', offset, length: email.length });
  }
  const buttons = [];
  const site = validHttpUrl(contact.website);
  const map = validHttpUrl(contact.mapUrl);
  const whatsapp = contact.whatsappEnabled === false ? '' : whatsappContactUrl(contact.whatsapp, phones[0], copy.whatsappHello || MANAGER_CONTACT_TEXT.ru.whatsappHello);
  const telegramName = String(contact.telegram || '').replace(/^@/, '');
  const telegram = /^[A-Za-z0-9_]{5,}$/.test(telegramName)
    ? 'https://t.me/' + telegramName
    : validHttpUrl(contact.telegram);
  // Экран связи — пять рядов вместо девяти: мессенджеры вместе, «О компании» и
  // сайт вместе, карта рядом с возвратом в меню. Гид переехал в главное меню.
  const messengers = [];
  if (whatsapp) messengers.push({ text: '🟢 ' + copy.whatsapp, url: whatsapp });
  if (telegram) messengers.push({ text: '✈️ ' + copy.telegram, url: telegram });
  if (messengers.length) buttons.push(messengers);
  buttons.push([{ text: copy.request, callback_data: 'contact:lead' }]);
  buttons.push([{ text: copy.question, callback_data: 'contact:question' }]);
  // «О компании» — там же, где клиент решает, довериться ли фирме.
  const aboutRow = [{ text: (MENU_LABELS[language] || MENU_LABELS.ru).about, callback_data: 'nav:about' }];
  if (site) aboutRow.push({ text: '🌐 ' + copy.website, url: site });
  buttons.push(aboutRow);
  const trust = trustButtonRow(language);
  if (trust) buttons.push(trust);
  const closing = [];
  if (map) closing.push({ text: '📍 ' + copy.map, url: map });
  closing.push({ text: '🏠 ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).mainMenu, callback_data: 'nav:menu' });
  buttons.push(closing);
  const sent = await sendUiMessage(chatId, user, text, token, {
    ...(entities.length ? { entities } : {}),
    reply_markup: { inline_keyboard: buttons },
  });
  if (photoMessageId && sent && Number.isFinite(Number(sent.message_id))) {
    user.uiMessageIds = [photoMessageId, Number(sent.message_id)];
    scheduleSave();
  }
}

// Фото менеджера над экраном связи. Не вышло отправить — экран всё равно
// показывается, только без фото.
async function sendManagerPhoto(chatId, user, contact, managerName, token) {
  if (!imageExists(contact.photo)) return 0;
  await clearUiMessages(chatId, user, token);
  try {
    const sent = await sendPhotoMessage(chatId, contact.photo, managerName ? '👨‍💼 ' + managerName : '', token, null);
    const id = sent && Number(sent.message_id);
    return Number.isFinite(id) ? id : 0;
  } catch (error) {
    recordError('Фото менеджера', error);
    return 0;
  }
}

// Всплывающая подсказка на кнопке заказа звонка: клиент сразу видит, на какой
// номер ему перезвонят, и не гадает, ушла ли заявка.
function leadCallbackToast(user, language) {
  const phone = knownLeadPhone(user);
  if (!phone) return '';
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  return cleanText(copy.callbackToast.replace('{phone}', () => (phone)), 190);
}

async function handleContactCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
  if (action !== 'cancel') await acknowledgeCallback(query, token, action === 'lead' ? leadCallbackToast(user, language) : '');
  if (action === 'lead') return startLeadForm(user, token);
  if (action === 'leadedit') return startLeadEdit(user, token);
  if (action === 'question') {
    user.pendingAction = { type: 'manager_question', createdAt: new Date().toISOString() };
    scheduleSave();
    await sendMessage(chatId, copy.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + copy.cancel, callback_data: 'contact:cancel' }]] },
    });
    return;
  }
  if (action === 'cancel') {
    if (user.pendingAction && user.pendingAction.type === 'manager_question') user.pendingAction = null;
    scheduleSave();
    await acknowledgeCallback(query, token, (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).cancelled);
  }
}

function aboutPreview(text) {
  const value = cleanText(text, 4000);
  if (value.length <= 850) return value;
  const paragraphs = value.split(/\n\s*\n/).filter(Boolean);
  let preview = '';
  for (const paragraph of paragraphs) {
    if (preview && preview.length + paragraph.length + 2 > 850) break;
    preview += (preview ? '\n\n' : '') + paragraph;
  }
  return preview || shortenedText(value, 850);
}

async function sendAbout(chatId, user, token, full = false) {
  const language = user.preferredLanguage || 'ru';
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const source = fillTemplate(data.config.menu[language].about, user);
  const text = full ? source : aboutPreview(source);
  const rows = [];
  if (!full && text.length < source.length) rows.push([{ text: '📖 ' + navigation.readMore, callback_data: 'about:full' }]);
  rows.push([{ text: (MENU_LABELS[language] || MENU_LABELS.ru).contacts, callback_data: 'about:contact' }]);
  rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
  await sendUiMessage(chatId, user, text, token, { reply_markup: { inline_keyboard: rows } });
}

// «Как купить в Испании»: пять коротких экранов, которые листаются кнопками.
// На каждом — бесплатная консультация: вопросы у покупателя возникают именно
// здесь, а не после каталога.
async function sendGuidePage(chatId, user, token, index = 0, query = null) {
  const language = user.preferredLanguage || 'ru';
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const pages = normalizeGuidePages(data.guidePages);
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), pages.length - 1);
  const page = pages[safeIndex];
  const text = ['<b>' + escapeTelegramHtml(page.title[language] || page.title.ru) + '</b>', escapeTelegramHtml(page.text[language] || page.text.ru)].join('\n\n');
  const rows = [];
  const pager = [];
  if (safeIndex > 0) pager.push({ text: '◀️', callback_data: 'guide:page:' + (safeIndex - 1) });
  pager.push({ text: String(safeIndex + 1) + ' / ' + String(pages.length), callback_data: 'guide:none' });
  if (safeIndex < pages.length - 1) pager.push({ text: '▶️', callback_data: 'guide:page:' + (safeIndex + 1) });
  rows.push(pager);
  rows.push([{ text: navigation.guideConsult, callback_data: 'contact:lead' }]);
  rows.push(planGuideRow(language));
  const trust = trustButtonRow(language);
  if (trust) rows.push(trust);
  rows.push([{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }]);
  // Гид листается в том же сообщении: пять экранов подряд в чате — это стена.
  if (query && query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', {
        chat_id: chatId,
        message_id: query.message.message_id,
        text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return true;
    } catch {
      // Сообщение уже не изменить — покажем гид заново.
    }
  }
  await sendUiMessage(chatId, user, text, token, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
  return true;
}

async function handleGuideCallback(query, token) {
  const [, value, pageNumber] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (value === 'none') return true;
  // Внутри гида листаем то же сообщение, а с других экранов открываем новое:
  // иначе кнопка «Как купить» затирала бы экран, с которого её нажали.
  if (value === 'page') return sendGuidePage(chatId, user, token, Number(pageNumber) || 0, query);
  return sendGuidePage(chatId, user, token, Number(value) || 0, null);
}

async function sendHelp(chatId, user, token) {
  const language = user.preferredLanguage || 'ru';
  const messages = languageMessages(language);
  const labels = MENU_LABELS[language] || MENU_LABELS.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const text = fillTemplate(messages.help, user);
  await sendUiMessage(chatId, user, text, token, { reply_markup: { inline_keyboard: [
    [{ text: labels.objects, callback_data: 'catalog:all:0' }],
    [{ text: labels.selection, callback_data: 'selection:start' }],
    [{ text: labels.contacts, callback_data: 'contact:question' }],
    [{ text: '🏠 ' + navigation.mainMenu, callback_data: 'nav:menu' }],
  ] } });
}

async function handleNavigationCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (action === 'menu') return sendMainMenu(chatId, user, token);
  if (action === 'my') return sendMoreMenu(chatId, user, token);
  if (action === 'about') return sendAbout(chatId, user, token);
  if (action === 'help') return sendHelp(chatId, user, token);
  if (action === 'language') return sendLanguagePicker(chatId, token, user.preferredLanguage || '');
  if (action === 'close' && query.message && query.message.message_id) {
    user.uiMessageIds = (Array.isArray(user.uiMessageIds) ? user.uiMessageIds : []).filter((messageId) => Number(messageId) !== Number(query.message.message_id));
    scheduleSave();
    try {
      await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: query.message.message_id });
    } catch {
      // The action is still complete when an old message can no longer be deleted.
    }
  }
}

async function handleSelectionCallback(query, token) {
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  // Подбор — мастер в одном сообщении: сделка, тип, город, бюджет, спальни.
  await sendSelectionWizard(chatId, user, token, 'deal');
}

async function handleAboutCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (action === 'contact') return sendContacts(chatId, user, token);
  if (action === 'full') return sendAbout(chatId, user, token, true);
}

async function handlePromotionCallback(query, token) {
  const rawPage = String(query.data || '').split(':')[1] || '0';
  if (rawPage === 'none') return acknowledgeCallback(query, token);
  if (rawPage === 'ask') return handlePromotionQuestion(query, token);
  const page = Number(rawPage);
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  await sendPromotionPage(chatId, user, token, page);
}

async function handlePromotionQuestion(query, token) {
  const promotionId = String(query.data || '').split(':').slice(2).join(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const text = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const record = data.promotions.find((item) => item.id === promotionId && promotionIsActive(item));
  if (!record) {
    await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
    return;
  }
  await acknowledgeCallback(query, token);
  const title = localizedExact(record.title, language) || localizedExact(record.title, 'ru');
  createInquiry(user, '🔥 Акция «' + title + '»: клиент хочет узнать подробнее', { type: 'question' });
  await sendMessage(chatId, withOffHoursNote([text.received, '🔥 ' + title].join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
}

async function handleLanguageCallback(query, token) {
  const language = String(query.data || '').replace('language:', '');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  if (!LANGUAGE_NAMES[language]) {
    const copy = INTERACTION_TEXT[user.preferredLanguage] || INTERACTION_TEXT.ru;
    return acknowledgeCallback(query, token, copy.stale);
  }
  translateCatalogFilterCity(user, language);
  user.preferredLanguage = language;
  user.pendingAction = null;
  user.expiredAction = null;
  data.stats.lastUpdateAt = new Date().toISOString();
  scheduleSave();
  void notifyAdministratorAction(user, 'Сменил язык', 'Выбран язык: ' + LANGUAGE_NAMES[language]);

  try {
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: LANGUAGE_SELECTED[language],
    });
  } catch {
    // The language still gets saved if the short-lived callback notification expires.
  }

  if (query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', {
        chat_id: chatId,
        message_id: query.message.message_id,
        text: LANGUAGE_SELECTED[language],
      });
    } catch {
      // A callback can still continue when the original picker is no longer editable.
    }
  }
  await sendWelcome(chatId, user, token);
  if (!(await openPendingStartPayload(user, token))) await askGoal(chatId, user, token);
}

async function acknowledgeCallback(query, token, text = '') {
  try {
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: cleanText(text, 180) || undefined,
    });
  } catch {
    // The requested action can still complete when the short callback notification expires.
  }
}

async function handleCatalogCallback(query, token) {
  const parts = String(query.data || '').split(':');
  const mode = parts[1];
  if (mode === 'none') return acknowledgeCallback(query, token);
  if (!CATALOG_MODES.includes(mode)) return acknowledgeCallback(query, token);
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  await acknowledgeCallback(query, token);
  if (!user.preferredLanguage) return sendLanguagePicker(chatId, token, '');
  void notifyAdministratorAction(
    user,
    mode === 'favorites'
      ? 'Листает избранные объекты'
      : mode === 'matches'
        ? 'Листает объекты по своему подбору'
        : mode === 'recent'
          ? 'Просматривает недавно открытые объекты'
          : mode === 'comparison'
            ? 'Просматривает выбранные для сравнения объекты'
          : 'Листает каталог объектов',
    'Страница: ' + (Math.max(0, Number(parts[2] || 0)) + 1)
  );
  await showCatalogPageFromCallback(chatId, user, token, Number(parts[2] || 0), mode, query.message);
}

function propertyRequestText(record, language, type) {
  const title = localizedExact(record.title, language) || record.reference || record.id;
  const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if (type === 'viewing') return copy.requestViewingPrefix + ' ' + title;
  if (type === 'question') return copy.questionPrefix + ' ' + title;
  return copy.interestPrefix + ' ' + title;
}

// The list the client was browsing, if the property is still in it.
function browsingMode(user, record) {
  const mode = catalogMode(user.catalogContext && user.catalogContext.mode);
  return catalogRecords(user, mode).some((item) => item.id === record.id) ? mode : 'all';
}

function configuredWhatsappUrl(message = '') {
  // Выключен в «Контактах» — не предлагаем нигде (раньше выключатель действовал
  // только на экране связи, а на карточке объекта кнопка оставалась).
  if (data.contacts && data.contacts.whatsappEnabled === false) return '';
  const phone = (String(data.contacts && data.contacts.phone || '').match(/\+?\d[\d\s().-]{5,}\d/) || [])[0] || '';
  return whatsappContactUrl(data.contacts && data.contacts.whatsapp, phone, message);
}

// Ряд с кнопкой «🟢 WhatsApp» для «горячих» экранов; null, если WhatsApp не настроен.
function whatsappRow(message = '') {
  const url = configuredWhatsappUrl(message);
  return url ? [{ text: '🟢 WhatsApp', url }] : null;
}

// «Интересует объект: Вилла (DEMO-001)» — то, что клиент увидит в поле ввода WhatsApp.
function whatsappPropertyMessage(record, language) {
  const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
  const title = localizedExact(record.title, language) || localizedExact(record.title, 'ru') || '';
  const reference = cleanText(record.reference, 40);
  const name = title && reference ? title + ' (' + reference + ')' : title || reference || record.id;
  return (copy.whatsappHelloProperty || MANAGER_CONTACT_TEXT.ru.whatsappHelloProperty).replace('{property}', () => (name));
}

function propertyManagerMarkup(record, language, returnToCatalog = false) {
  const text = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
  const rows = [];
  // Экран только про связь: запись на просмотр теперь на самой карточке, а
  // похожие объекты — в «Подробнее». Раньше здесь было шесть кнопок, и среди
  // них терялось главное — как связаться.
  if (record.status === 'reserved') {
    rows.push([{ text: '🔔 ' + text.availability, callback_data: 'property:availability:' + record.id }]);
  } else {
    rows.push([{ text: '📞 ' + text.interest, callback_data: 'property:interest:' + record.id }]);
  }
  rows.push([{ text: '❓ ' + text.question, callback_data: 'property:question:' + record.id }]);
  const whatsapp = configuredWhatsappUrl(whatsappPropertyMessage(record, language));
  if (whatsapp) rows.push([{ text: '🟢 WhatsApp', url: whatsapp }]);
  rows.push([{ text: '⬅️ ' + navigation.backToCard, callback_data: 'property:' + (returnToCatalog ? 'return' : 'card') + ':' + record.id }]);
  return { inline_keyboard: rows };
}

// options.intro — фраза перед найденными похожими; options.noSimilarText — единственное сообщение, если
// похожих нет (без вступления: «Посмотрите похожий вариант» и тут же «Похожих нет» противоречили друг другу).
async function sendSimilarProperty(chatId, user, record, token, options = {}) {
  const language = user.preferredLanguage || 'ru';
  const candidates = data.objects.filter((item) => item.id !== record.id && item.status === 'active' && propertyReadyForLanguage(item, language));
  const ranking = similarPropertyRanking(record, candidates, language);
  user.similarPropertyIds = ranking.map((item) => item.id);
  user.similarPropertyDetails = ranking.map(({ id, score, reasons, warnings }) => ({ id, score, reasons, warnings }));
  user.similarPropertySourceId = record.id;
  scheduleSave();
  if (!ranking.length) {
    const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    // Не тупик: подписаться на похожие одним нажатием и посмотреть ближайшее по
    // бюджету (если рядом по цене хоть что-то есть).
    const deadEnd = DEAD_END_TEXT[language] || DEAD_END_TEXT.ru;
    const nearby = nearestByBudget(record, candidates);
    const whatsapp = whatsappRow(whatsappPropertyMessage(record, language));
    await sendUiMessage(chatId, user, options.noSimilarText || copy.noSimilar, token, { reply_markup: { inline_keyboard: [
      [{ text: deadEnd.notify, callback_data: 'saved:similar:' + record.id }],
      ...(nearby.length ? [[{ text: deadEnd.budget, callback_data: 'property:nearprice:' + record.id }]] : []),
      [{ text: (MENU_LABELS[language] || MENU_LABELS.ru).contacts, callback_data: 'contact:question' }],
      ...(whatsapp ? [whatsapp] : []),
      [{ text: '⬅️ ' + navigation.backToCard, callback_data: 'property:return:' + record.id }],
    ] } });
    return;
  }
  if (options.intro) await sendMessage(chatId, options.intro, token);
  await sendCatalogPage(chatId, user, token, 0, 'similar');
}

async function handlePropertyCallback(query, token) {
  const parts = String(query.data || '').split(':');
  const actionName = parts[1];
  // У листания фотографий номер стоит перед объектом: property:photo:3:<id>.
  const photoIndex = actionName === 'photo' ? Number(parts[2]) : NaN;
  const propertyId = actionName === 'photo' ? parts.slice(3).join(':') : parts.slice(2).join(':');
  const record = data.objects.find((item) => item.id === propertyId && ['active', 'reserved'].includes(item.status));
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const text = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
  if ((!record || !propertyReadyForLanguage(record, language)) && actionName !== 'cancel') {
    await acknowledgeCallback(query, token, text.propertyUnavailable);
    return;
  }
  if (actionName === 'cancel') {
    if (user.pendingAction && user.pendingAction.propertyId === propertyId) user.pendingAction = null;
    scheduleSave();
    await acknowledgeCallback(query, token, text.cancelled);
    if (query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [] },
        });
      } catch {
        // The cancellation is complete even if Telegram no longer allows editing the prompt.
      }
    }
    return;
  }
  if (actionName === 'card') {
    await acknowledgeCallback(query, token);
    if (query.message && query.message.message_id) {
      // Возврат из просмотра фотографий: вернуть нужно и первую картинку, и
      // подпись, и кнопки карточки, а не только кнопки.
      const context = catalogViewContext(user, record, language);
      const restored = await editPropertyCard(chatId, user, token, query.message, record, context);
      if (!restored) {
        try {
          await telegramRequest(token, 'editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: contentButtons(record, language, user, 'property', context),
          });
        } catch {
          await sendPropertyCard(chatId, user, token, record, { heading: (MENU_LABELS[language] || MENU_LABELS.ru).objects, page: 0, totalPages: 1, mode: 'all' });
        }
      }
    }
    return;
  }
  if (actionName === 'return') {
    await acknowledgeCallback(query, token);
    const mode = browsingMode(user, record);
    const records = catalogRecords(user, mode);
    const page = records.findIndex((item) => item.id === record.id);
    if (page >= 0) {
      await sendCatalogPage(chatId, user, token, page, mode);
    } else {
      user.catalogContext = { mode: 'all', page: 0, propertyId: record.id };
      scheduleSave();
      await sendPropertyCard(chatId, user, token, record, {
        heading: '🏠 ' + text.propertyHeading,
        page: 0,
        totalPages: 1,
        mode: 'all',
        filter: null,
      });
    }
    if (query.message && query.message.message_id) {
      try { await telegramRequest(token, 'deleteMessage', { chat_id: chatId, message_id: query.message.message_id }); } catch {}
    }
    return;
  }
  if (actionName === 'next') {
    await acknowledgeCallback(query, token);
    const mode = browsingMode(user, record);
    const records = catalogRecords(user, mode);
    const currentIndex = records.findIndex((item) => item.id === record.id);
    const nextPage = currentIndex >= 0 && records.length ? (currentIndex + 1) % records.length : -1;
    if (nextPage >= 0) await sendCatalogPage(chatId, user, token, nextPage, mode);
    return;
  }
  if (actionName === 'details') {
    recordPropertyEvent(record.id, 'details');
    markFunnel(user, 'details');
    const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
    const interaction = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
    const full = objectCaptionHtml(record, language, { full: true });
    // Ссылки и расчёт — не повтор кнопок карточки, они только здесь.
    const links = [];
    const external = validHttpUrl(record.url);
    const map = validHttpUrl(record.mapUrl);
    const share = propertyShareUrl(record, language);
    // Ссылки идут по три в ряду, поэтому подписи короткие: «Сайт», «Карта», «Друзьям».
    if (external) links.push({ text: '🌐 ' + (text.siteShort || text.viewWebsite), url: external });
    if (map) links.push({ text: '📍 ' + (text.mapShort || text.openMap), url: map });
    if (share) links.push({ text: '📤 ' + (text.shareShort || text.share), url: share });
    const extra = [];
    const calculator = calculatorButton(record, language, true);
    if (calculator) extra.push(calculator);
    extra.push({ text: '🏘 ' + (text.similarShort || text.similar), callback_data: 'property:similar:' + record.id });

    await acknowledgeCallback(query, token);
    // Подпись под фотографией Telegram ограничивает 1024 знаками — считаем по
    // видимому тексту, без разметки.
    const plainLength = full.replace(/<[^>]*>/g, '').length;
    const isCard = Boolean(query.message && Array.isArray(query.message.photo) && query.message.photo.length);
    if (isCard && plainLength <= 1024) {
      const rows = [
        ...(record.status === 'active'
          ? [[{ text: mobileButtonText('📅', text.viewingShort || text.viewing), callback_data: 'property:viewing:' + record.id },
            { text: mobileButtonText('💬', text.contact), callback_data: 'property:manager:' + record.id }]]
          : [[{ text: mobileButtonText('💬', text.contact), callback_data: 'property:manager:' + record.id }]]),
        extra,
        ...(links.length ? [links] : []),
        ...(trustButtonRow(language) ? [trustButtonRow(language)] : []),
        [{ text: '🔼 ' + interaction.collapseDetails, callback_data: 'property:card:' + record.id }],
      ];
      try {
        await telegramRequest(token, 'editMessageCaption', {
          chat_id: chatId,
          message_id: query.message.message_id,
          caption: full,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
        return;
      } catch {
        // Не получилось изменить карточку — покажем отдельным сообщением.
      }
    }
    // Длинное описание отдельным сообщением: то, чего нет на карточке, и возврат к ней. Если карточка
    // стоит выше (нажали «Подробнее» на ней), кнопки не повторяем. Если «Подробнее» открыто из другого
    // сообщения — после расчёта, похожих, по ссылке, — карточки рядом нет, и ряд «Записаться / Связаться»
    // здесь нужен: без него клиент шёл назад ради двух кнопок.
    const rows = [];
    if (!isCard) {
      rows.push(record.status === 'active'
        ? [{ text: mobileButtonText('📅', text.viewingShort || text.viewing), callback_data: 'property:viewing:' + record.id },
          { text: mobileButtonText('💬', text.contact), callback_data: 'property:manager:' + record.id }]
        : [{ text: mobileButtonText('💬', text.contact), callback_data: 'property:manager:' + record.id }]);
    }
    if (extra.length) rows.push(extra);
    if (links.length) rows.push(links);
    if (trustButtonRow(language)) rows.push(trustButtonRow(language));
    rows.push([{ text: '⬅️ ' + navigation.backToCard, callback_data: 'property:return:' + record.id }]);
    await sendUiMessage(chatId, user, full, token, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }
  if (actionName === 'manager') {
    recordPropertyEvent(record.id, 'managerContacts');
    await acknowledgeCallback(query, token);
    const source = String(query.message && (query.message.caption || query.message.text) || '');
    const favoriteHeading = (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
    const isCatalogCard = Boolean(query.message && query.message.caption)
      || source.includes((MENU_LABELS[language] || MENU_LABELS.ru).objects)
      || source.includes(favoriteHeading);
    if (isCatalogCard && query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: query.message.message_id, reply_markup: propertyManagerMarkup(record, language) });
        return;
      } catch {
        // Fall back to a compact service message when the original card cannot be edited.
      }
    }
    const title = localizedExact(record.title, language) || record.reference || '';
    await sendUiMessage(chatId, user, [title, text.managerPrompt].filter(Boolean).join('\n\n'), token, { reply_markup: propertyManagerMarkup(record, language, true) });
    return;
  }
  if (actionName === 'price') {
    recordPropertyEvent(record.id, 'questions');
    await acknowledgeCallback(query, token);
    createInquiry(user, propertyRequestText(record, language, 'question') + '\n\n' + text.askPrice, { type: 'question', propertyId: record.id });
    await sendMessage(chatId, withOffHoursNote([text.received, '🏠 ' + (localizedExact(record.title, language) || record.reference || '')].filter(Boolean).join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
    return;
  }
  if (actionName === 'availability') {
    recordPropertyEvent(record.id, 'availability');
    await acknowledgeCallback(query, token);
    const inquiry = propertyRequestText(record, language, 'question') + '\n\n' + text.availability;
    createInquiry(user, inquiry, { type: 'question', propertyId: record.id, sourceMessage: query.message });
    await sendMessage(chatId, withOffHoursNote([text.received, '🏠 ' + (localizedExact(record.title, language) || record.reference || '')].filter(Boolean).join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
    return;
  }
  if (actionName === 'similar') {
    recordPropertyEvent(record.id, 'similar');
    await acknowledgeCallback(query, token);
    await sendSimilarProperty(chatId, user, record, token);
    return;
  }
  if (actionName === 'nearprice') {
    await acknowledgeCallback(query, token);
    const candidates = data.objects.filter((item) => propertyReadyForLanguage(item, language));
    const nearby = nearestByBudget(record, candidates);
    if (!nearby.length) {
      await sendSimilarProperty(chatId, user, record, token);
      return;
    }
    user.similarPropertyIds = nearby.map((item) => item.id);
    user.similarPropertyDetails = nearby;
    user.similarPropertySourceId = record.id;
    scheduleSave();
    await sendCatalogPage(chatId, user, token, 0, 'similar');
    return;
  }
  if (actionName === 'compare') {
    const comparison = COMPARISON_TEXT[language] || COMPARISON_TEXT.ru;
    if (comparisonContains(user, record.id)) {
      await acknowledgeCallback(query, token);
      void notifyAdministratorAction(user, 'Открыл сравнение объектов', localizedExact(record.title, language) || record.reference || record.id);
      await sendComparison(chatId, user, token);
      return;
    }
    const result = addToComparison(user, record);
    if (result.status === 'limit') {
      await acknowledgeCallback(query, token, comparison.limit);
      return;
    }
    void notifyAdministratorAction(user, 'Добавил объект к сравнению', localizedExact(record.title, language) || record.reference || record.id);
    if (query.message && query.message.message_id) {
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: contentButtons(record, language, user, 'property', catalogViewContext(user, record, language)),
        });
      } catch {
        // The comparison is saved even when an older card cannot be edited.
      }
    }
    await acknowledgeCallback(query, token, comparison.added.replace('{count}', () => (String(result.count))).replace('{max}', () => (String(COMPARISON_LIMIT))));
    return;
  }
  if (actionName === 'favorite') {
    const favorites = new Set(Array.isArray(user.favorites) ? user.favorites : []);
    let notice;
    if (favorites.has(record.id)) {
      favorites.delete(record.id);
      notice = text.favoriteRemove;
    } else {
      favorites.add(record.id);
      notice = text.favoriteAdd;
      recordPropertyEvent(record.id, 'favorites');
    }
    user.favorites = Array.from(favorites).slice(0, 500);
    scheduleSave();
    void notifyAdministratorAction(user, favorites.has(record.id) ? 'Добавил объект в избранное' : 'Удалил объект из избранного', localizedExact(record.title, language) || record.reference || record.id);
    const messageText = String(query.message && (query.message.caption || query.message.text) || '');
    const favoriteHeading = (MENU_LABELS[language] || MENU_LABELS.ru).favorites;
    if (!favorites.has(record.id) && messageText.includes(favoriteHeading)) {
      await acknowledgeCallback(query, token, notice);
      const pageMatch = messageText.match(/·\s*(\d+)\s*\/\s*\d+/);
      const requestedPage = Math.max(0, Number(pageMatch && pageMatch[1] || 1) - 1);
      const remaining = catalogRecords(user, 'favorites');
      if (remaining.length) await sendCatalogPage(chatId, user, token, Math.min(requestedPage, remaining.length - 1), 'favorites');
      else {
        const previous = Array.isArray(user.catalogMessageIds) ? [...user.catalogMessageIds] : [];
        user.catalogMessageIds = [];
        scheduleSave();
        await deleteCatalogMessages(chatId, previous, token);
        await sendCatalogPage(chatId, user, token, 0, 'favorites');
      }
      return;
    }
    if (query.message && query.message.message_id && query.message.reply_markup && Array.isArray(query.message.reply_markup.inline_keyboard)) {
      const markup = contentButtons(record, language, user, 'property', catalogViewContext(user, record, language));
      try {
        await telegramRequest(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: markup,
        });
      } catch {
        // The favorite is saved even when an older Telegram message cannot be edited.
      }
    }
    await acknowledgeCallback(query, token, notice);
    return;
  }
  if (actionName === 'gallery' || actionName === 'photo') {
    const images = recordImages(record, language);
    if (!images.length) {
      await acknowledgeCallback(query, token, text.photosUnavailable);
      return;
    }
    if (actionName === 'gallery') {
      void notifyAdministratorAction(user, 'Открыл фотографии объекта', localizedExact(record.title, language) || record.reference || record.id);
      recordPropertyEvent(record.id, 'galleries');
    }
    await acknowledgeCallback(query, token);
    // Фотографии листаются прямо в карточке. Раньше бот присылал альбом из
    // восьми отдельных сообщений и следом вопрос «Что вы хотите сделать
    // дальше?» с третьим набором кнопок — чат зарастал, а вернуться к объекту
    // было некуда.
    const index = Number.isFinite(photoIndex) ? photoIndex : 0;
    const shown = await showPropertyPhoto(chatId, user, token, query.message, record, index);
    if (!shown) {
      // Сообщение не редактируется (например, слишком старое) — показываем
      // карточку заново, с неё фотографии откроются обычным путём.
      await sendPropertyCard(chatId, user, token, record, catalogViewContext(user, record, language));
    }
    return;
  }
  if (actionName === 'interest') {
    recordPropertyEvent(record.id, 'interests');
    void notifyAdministratorAction(user, 'Начал заявку по объекту', localizedExact(record.title, language) || record.reference || record.id);
    // Телефон уже известен — клиент видит «Перезвоним на …» прямо на кнопке,
    // и заявка уходит без единого вопроса.
    await acknowledgeCallback(query, token, leadCallbackToast(user, language));
    await startLeadForm(user, token, { propertyId: record.id });
    return;
  }
  if (actionName === 'viewing' || actionName === 'question') {
    if (actionName === 'viewing') {
      await acknowledgeCallback(query, token);
      if (record.status === 'reserved') {
        const inquiry = propertyRequestText(record, language, 'question') + '\n\n' + text.availability;
        createInquiry(user, inquiry, { type: 'question', propertyId: record.id, sourceMessage: query.message });
        await sendMessage(chatId, withOffHoursNote([text.received, '🏠 ' + (localizedExact(record.title, language) || record.reference || '')].filter(Boolean).join('\n\n'), language, { user }), token, { reply_markup: menuKeyboard(language) });
      } else {
        await startViewingForm(user, record, token);
      }
      return;
    }
    user.pendingAction = { type: actionName, propertyId: record.id, createdAt: new Date().toISOString() };
    scheduleSave();
    void notifyAdministratorAction(user, actionName === 'viewing' ? 'Нажал «Записаться на просмотр»' : 'Нажал «Задать вопрос»', localizedExact(record.title, language) || record.reference || record.id);
    await acknowledgeCallback(query, token);
    await sendMessage(chatId, text.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + text.cancel, callback_data: 'property:cancel:' + record.id }]] },
    });
    return;
  }
  await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
}

export {
  aboutPreview,
  acknowledgeCallback,
  configuredWhatsappUrl,
  sendManagerPhoto,
  whatsappPropertyMessage,
  whatsappRow,
  handleAboutCallback,
  handleCatalogCallback,
  handleContactCallback,
  handleLanguageCallback,
  handleNavigationCallback,
  handlePromotionCallback,
  handlePromotionQuestion,
  handlePropertyCallback,
  handleGuideCallback,
  handleSelectionCallback,
  propertyManagerMarkup,
  propertyRequestText,
  sendAbout,
  sendContacts,
  sendGuidePage,
  sendHelp,
  sendPromotionPage,
  sendPromotions,
  sendSimilarProperty,
};
