// Формы заявки на звонок, записи на просмотр и подбора объекта.

import { PENDING_ACTION_TTL_MS } from './config.mjs';
import { cleanText } from './util.mjs';
import { CATALOG_FILTER_TEXT, INTERACTION_TEXT, LEAD_FORM_TEXT, PRIVACY_TEXT, MANAGER_CONTACT_TEXT, NAVIGATION_TEXT, PROPERTY_ACTION_TEXT, SELECTION_FORM_TEXT, VIEWING_FORM_TEXT } from './texts.mjs';
import { data, saveDataNow, scheduleSave } from './store.mjs';
import { recordPropertyEvent } from './analytics.mjs';
import { markUnavailable } from './users.mjs';
import { sendMessage } from './telegram.mjs';
import { menuKeyboard, sendMainMenu } from './menus.mjs';
import { createInquiry } from './inquiries.mjs';
import { localizedExact, publishedCatalog, sendCatalogPage, sendUiMessage, showCatalogPricePrompt, startCatalogPriceInput } from './catalog.mjs';
import { currentSelectionRanking } from './alerts.mjs';
import { temporaryDeliveryError } from './broadcasts.mjs';
import { propertyRequestText } from './sections.mjs';
import { parseViewingDate, sendViewingConfirmation, viewingDayForOption } from './viewings.mjs';
import { withOffHoursNote } from './hours.mjs';
import { availableSlotDays, bookedViewings, freeTimes, slotFree, slotSettings, slotsEnabled } from './slots.mjs';

function savedLeadOption(user, language, field) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const value = field === 'phone' ? cleanText(user && user.phone, 40) : cleanText(user && user.contactName, 40);
  if (!value) return '';
  return cleanText((field === 'phone' ? copy.savedPhone : copy.savedName) + ': ' + value, 64);
}

function leadFormKeyboard(language, step, user) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const keyboard = [];
  const savedName = savedLeadOption(user, language, 'name');
  const savedPhone = savedLeadOption(user, language, 'phone');
  if (step === 'name' && savedName) keyboard.push([{ text: savedName }]);
  if (step === 'phone') {
    if (savedPhone) keyboard.push([{ text: savedPhone }]);
    keyboard.push([{ text: copy.phoneButton, request_contact: true }]);
  }
  if (step === 'time') {
    keyboard.push([{ text: copy.timeOptions[0] }, { text: copy.timeOptions[1] }]);
    keyboard.push([{ text: copy.timeOptions[2] }]);
  }
  if (step === 'confirm') {
    keyboard.push([{ text: copy.confirm }]);
    keyboard.push(...optionRows([copy.editName, copy.editPhone, copy.editTime]));
  }
  keyboard.push([{ text: copy.cancel }]);
  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: cleanText(step === 'phone' ? copy.askPhone : step === 'time' ? copy.askTime : step === 'confirm' ? copy.review : copy.askName, 64),
  };
}

function leadReviewText(copy, lead, language) {
  const labels = copy.reviewLabels;
  return [copy.review, '', labels[0] + ': ' + lead.name, labels[1] + ': ' + lead.phone, labels[2] + ': ' + lead.preferredTime].join('\n');
}

async function sendLeadReview(user, pending, token, language) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  pending.step = 'confirm';
  pending.editing = '';
  pending.reviewed = true;
  scheduleSave();
  await sendMessage(user.chatId, leadReviewText(copy, {
    name: cleanText(pending.data && pending.data.name, 120),
    phone: cleanText(pending.data && pending.data.phone, 80),
    preferredTime: cleanText(pending.data && pending.data.preferredTime, 160),
  }, language), token, { reply_markup: leadFormKeyboard(language, 'confirm', user) });
}

// Имя клиента: то, что он называл сам, иначе имя из Telegram. Отдельный шаг
// «Как к вам обращаться?» из-за этого не нужен — он стоил заявке одного
// лишнего сообщения.
function leadContactName(user) {
  const saved = cleanText(user && user.contactName, 120);
  if (saved.length >= 2) return saved;
  const telegram = cleanText([user && user.firstName, user && user.lastName].filter(Boolean).join(' '), 120);
  if (telegram.length >= 2) return telegram;
  return cleanText(user && user.username, 120);
}

// Телефон, который бот уже знает: по нему заявку можно оформить без вопросов.
function knownLeadPhone(user) {
  return validLeadPhone(user && user.phone);
}

function validLeadPhone(value) {
  const phone = cleanText(value, 80);
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 20 ? phone : '';
}

function preferredTimeWithDate(value, language, answeredAt) {
  const text = cleanText(value, 160);
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const optionIndex = copy.timeOptions.indexOf(text);
  if (optionIndex !== 0 && optionIndex !== 1) return text;
  const date = new Date(answeredAt || Date.now());
  if (!Number.isFinite(date.getTime())) return text;
  if (optionIndex === 1) date.setDate(date.getDate() + 1);
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
  const calendarDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return text + ' (' + calendarDate + ')';
}

function pendingActionExpired(user) {
  if (!user || !user.pendingAction) return false;
  const createdAt = Date.parse(user.pendingAction.createdAt || '');
  return !Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_ACTION_TTL_MS;
}

function rememberExpiredAction(user, pending) {
  if (!user || !pending) return null;
  const type = pending.type === 'property_selection' ? 'selection'
    : pending.type === 'viewing_form' ? 'viewing'
      : pending.type === 'manager_question' ? 'manager_question'
        : pending.type === 'question' ? 'property_question'
          : pending.type === 'lead' ? 'lead'
            : pending.type === 'catalog_filter_price' ? 'catalog_filter_price'
              : '';
  if (!type) return null;
  user.expiredAction = {
    type,
    propertyId: cleanText(pending.propertyId, 100),
    priceBound: type === 'catalog_filter_price' && pending.priceBound === 'min' ? 'min' : '',
    createdAt: new Date().toISOString(),
  };
  return user.expiredAction;
}

function expiredActionKeyboard(language) {
  const copy = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
  return {
    keyboard: [[{ text: copy.resume }], [{ text: copy.backToMenu }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: copy.resume,
  };
}

function unfinishedActionKeyboard(language) {
  const copy = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
  return optionReplyKeyboard([copy.continueForm], copy.discardForm, copy.unfinished);
}

async function showPendingActionStep(user, token) {
  const pending = user && user.pendingAction;
  if (!pending) return false;
  const language = user.preferredLanguage || 'ru';
  if (pending.type === 'lead') {
    const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
    const step = ['name', 'phone', 'time', 'confirm'].includes(pending.step) ? pending.step : 'name';
    if (step === 'confirm') {
      await sendLeadReview(user, pending, token, language);
      return true;
    }
    const prompt = step === 'phone' ? phonePrompt(copy, language) : step === 'time' ? copy.askTime : copy.askName;
    await sendMessage(user.chatId, prompt, token, { reply_markup: leadFormKeyboard(language, step, user) });
    return true;
  }
  if (pending.type === 'viewing_form') {
    const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
    const property = data.objects.find((item) => item.id === pending.propertyId && item.status === 'active');
    if (!property) {
      user.pendingAction = null;
      scheduleSave();
      await sendMessage(user.chatId, copy.unavailable, token, { reply_markup: menuKeyboard(language) });
      return true;
    }
    const step = ['date', 'time', 'custom', 'custom_time', 'confirm'].includes(pending.step) ? pending.step : 'date';
    if (step === 'confirm') {
      await sendViewingReview(user, pending, property, token, language);
      return true;
    }
    const prompt = step === 'time' ? copy.askTime : step === 'custom_time' ? copy.askCustomTime : step === 'custom' ? copy.askCustom : copy.askDate;
    const title = step === 'date' ? localizedExact(property.title, language) || property.reference || '' : '';
    await sendMessage(user.chatId, [title ? '🏠 ' + title : '', prompt].filter(Boolean).join('\n\n'), token, { reply_markup: viewingKeyboard(language, step, pending) });
    return true;
  }
  if (pending.type === 'property_selection') {
    const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
    const step = SELECTION_STEPS.concat('confirm').includes(pending.step) ? pending.step : 'deal';
    if (step === 'confirm') {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    await sendMessage(user.chatId, selectionPrompt(copy, step), token, { reply_markup: selectionKeyboard(language, step) });
    return true;
  }
  if (pending.type === 'manager_question') {
    const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    await sendMessage(user.chatId, copy.askQuestion, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  if (pending.type === 'catalog_filter_price') return showCatalogPricePrompt(user, token);
  if (pending.type === 'question' && pending.propertyId) {
    const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    const property = data.objects.find((item) => item.id === pending.propertyId && ['active', 'reserved'].includes(item.status));
    if (property) {
      const title = localizedExact(property.title, language) || property.reference || '';
      await sendMessage(user.chatId, [title ? '🏠 ' + title : '', copy.askQuestion].filter(Boolean).join('\n\n'), token, { reply_markup: menuKeyboard(language) });
      return true;
    }
  }
  user.pendingAction = null;
  scheduleSave();
  await sendMainMenu(user.chatId, user, token);
  return true;
}

function duplicateInboundMessage(user, messageId) {
  if (!user || !Number.isFinite(Number(messageId))) return false;
  const normalizedId = Number(messageId);
  if (Number(user.lastInboundMessageId) === normalizedId) return true;
  user.lastInboundMessageId = normalizedId;
  scheduleSave();
  return false;
}

function duplicateCallback(user, key, intervalMs = 1400) {
  if (!user) return false;
  const now = Date.now();
  const normalizedKey = cleanText(key, 120);
  const previous = user.lastCallback && typeof user.lastCallback === 'object' ? user.lastCallback : null;
  if (previous && previous.key === normalizedKey && now - Number(previous.at || 0) < intervalMs) return true;
  user.lastCallback = { key: normalizedKey, at: now };
  scheduleSave();
  return false;
}

// К вопросу о телефоне всегда добавляется, зачем он нужен и где посмотреть,
// что бот хранит: этого требует RGPD при сборе персональных данных.
function phonePrompt(copy, language, question = '') {
  const notice = cleanText((PRIVACY_TEXT[language] || PRIVACY_TEXT.ru).phoneNotice, 300);
  const prompt = String(question || copy.askPhone || '');
  return notice && !prompt.includes('/privacy') ? prompt + '\n\n' + notice : prompt;
}

function isStaleFormControl(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const keys = ['confirm', 'cancel', 'edit', 'editName', 'editPhone', 'editTime', 'restart', 'editDate', 'editDeal', 'editType', 'editLocation', 'editBudget', 'editBedrooms'];
  for (const language of ['ru', 'en', 'es']) {
    const interaction = INTERACTION_TEXT[language];
    if (interaction && [interaction.continueForm, interaction.discardForm, interaction.resume, interaction.backToMenu].includes(value)) return true;
    for (const source of [LEAD_FORM_TEXT[language], VIEWING_FORM_TEXT[language], SELECTION_FORM_TEXT[language], CATALOG_FILTER_TEXT[language]]) {
      if (source && keys.some((key) => source[key] && source[key] === value)) return true;
    }
  }
  return false;
}

// Способ связи: звонок (по умолчанию), WhatsApp или переписка в Telegram.
// Для Telegram телефон не нужен — это и есть главный смысл выбора.
const LEAD_METHODS = ['call', 'whatsapp', 'telegram'];
const LEAD_METHOD_LABELS = { call: 'звонок', whatsapp: 'WhatsApp', telegram: 'Telegram' };

function leadMethod(value) {
  return LEAD_METHODS.includes(value) ? value : 'call';
}

// Экран выбора: показывается только когда телефона ещё нет. Если номер уже
// известен, звонок — самый короткий путь, и спрашивать незачем.
function leadMethodKeyboard(language, propertyId) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const suffix = propertyId ? ':' + propertyId : '';
  return {
    inline_keyboard: [
      [{ text: copy.methodCall, callback_data: 'lead:call' + suffix }],
      [{ text: copy.methodWhatsapp, callback_data: 'lead:whatsapp' + suffix }],
      [{ text: copy.methodTelegram, callback_data: 'lead:telegram' + suffix }],
    ],
  };
}

// Заявка уходит менеджеру и запоминает контакты клиента: в следующий раз
// звонок можно будет заказать одним нажатием.
async function submitLead(user, pending, token, language, message, extraRows = []) {
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const lead = {
    name: cleanText(pending.data && pending.data.name, 120),
    phone: cleanText(pending.data && pending.data.phone, 80),
    preferredTime: cleanText(pending.data && pending.data.preferredTime, 160),
    method: leadMethod(pending.method),
  };
  const propertyId = cleanText(pending.propertyId, 100);
  user.contactName = lead.name;
  // Пустой номер не стирает известный: клиент мог выбрать переписку в Telegram.
  if (lead.phone) user.phone = lead.phone;
  if (lead.preferredTime) user.preferredContactTime = lead.preferredTime;
  user.pendingAction = null;
  createInquiry(user, [
    'Имя: ' + lead.name,
    'Способ связи: ' + LEAD_METHOD_LABELS[lead.method],
    lead.phone ? 'Телефон: ' + lead.phone : '',
    lead.preferredTime ? 'Удобное время: ' + lead.preferredTime : '',
  ].filter(Boolean).join('\n'), { type: 'lead', propertyId, lead, sourceMessage: message });
  saveDataNow();
  const property = propertyId ? data.objects.find((item) => item.id === propertyId) : null;
  const propertyTitle = property ? localizedExact(property.title, language) : '';
  const success = lead.method === 'telegram'
    ? copy.telegramSuccess
    : lead.method === 'whatsapp'
      ? copy.whatsappSuccess.replace('{phone}', lead.phone)
      : pending.instant
        ? copy.instantSuccess.replace('{phone}', lead.phone)
        : copy.success;
  await sendMessage(user.chatId, withOffHoursNote([success, propertyTitle ? '🏠 ' + propertyTitle : ''].filter(Boolean).join('\n\n'), language), token, {
    reply_markup: extraRows.length ? { inline_keyboard: extraRows } : menuKeyboard(language),
  });
}

async function startLeadForm(user, token, context = {}) {
  const language = user.preferredLanguage || 'ru';
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const phone = knownLeadPhone(user);
  const name = leadContactName(user);
  const propertyId = cleanText(context.propertyId, 100);
  const method = LEAD_METHODS.includes(context.method) ? context.method : '';
  // Телефона нет — сначала спросим, как связаться: переписка в Telegram
  // обходится вообще без номера.
  if (!phone && !method) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.chooseMethod, token, { reply_markup: leadMethodKeyboard(language, propertyId) });
    return;
  }
  // Пишем в Telegram — заявка уходит сразу, ничего спрашивать не нужно.
  if (method === 'telegram') {
    const pending = { type: 'lead', step: 'confirm', method, propertyId, data: { name }, createdAt: new Date().toISOString() };
    user.pendingAction = pending;
    await submitLead(user, pending, token, language, null);
    return;
  }
  // Телефон уже известен — заявка уходит сразу, а поправить номер или время
  // можно кнопкой под подтверждением.
  if (phone && method !== 'whatsapp') {
    const pending = {
      type: 'lead',
      step: 'confirm',
      instant: true,
      method: 'call',
      propertyId,
      data: { name, phone, preferredTime: cleanText(user.preferredContactTime, 160) },
      createdAt: new Date().toISOString(),
    };
    user.pendingAction = pending;
    await submitLead(user, pending, token, language, null, [[{ text: copy.changeDetails, callback_data: 'contact:leadedit' }]]);
    return;
  }
  if (phone && method === 'whatsapp') {
    const pending = { type: 'lead', step: 'confirm', method, propertyId, data: { name, phone }, createdAt: new Date().toISOString() };
    user.pendingAction = pending;
    await submitLead(user, pending, token, language, null);
    return;
  }
  user.pendingAction = {
    type: 'lead',
    step: 'phone',
    method: leadMethod(method),
    propertyId,
    data: { name },
    createdAt: new Date().toISOString(),
  };
  scheduleSave();
  const prompt = phonePrompt(copy, language, method === 'whatsapp' ? copy.askWhatsapp : '');
  await sendMessage(user.chatId, prompt, token, { reply_markup: leadFormKeyboard(language, 'phone', user) });
}

// Нажатие на кнопку способа связи.
async function handleLeadMethodCallback(query, token, user) {
  const [, method, propertyId] = String(query.data || '').split(':');
  await startLeadForm(user, token, { propertyId: propertyId || '', method });
}

// Правка после мгновенной заявки: показываем то, что бот знает, и даём
// изменить номер или время.
async function startLeadEdit(user, token) {
  const language = user.preferredLanguage || 'ru';
  const pending = {
    type: 'lead',
    step: 'confirm',
    propertyId: '',
    data: {
      name: leadContactName(user),
      phone: knownLeadPhone(user),
      preferredTime: cleanText(user.preferredContactTime, 160),
    },
    createdAt: new Date().toISOString(),
  };
  user.pendingAction = pending;
  await sendLeadReview(user, pending, token, language);
}

async function handleLeadFormMessage(message, user, token) {
  const pending = user.pendingAction;
  if (!pending || pending.type !== 'lead') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = LEAD_FORM_TEXT[language] || LEAD_FORM_TEXT.ru;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text === copy.cancel) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.cancelled, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  pending.data = pending.data && typeof pending.data === 'object' ? pending.data : {};
  if (pending.step === 'name') {
    const savedName = savedLeadOption(user, language, 'name');
    const name = cleanText(savedName && text === savedName ? user.contactName : text, 120);
    if (name.length < 2) {
      await sendMessage(user.chatId, copy.invalidName, token, { reply_markup: leadFormKeyboard(language, 'name', user) });
      return true;
    }
    pending.data.name = name;
    if (pending.editing === 'name') {
      await sendLeadReview(user, pending, token, language);
      return true;
    }
    pending.step = 'phone';
    scheduleSave();
    await sendMessage(user.chatId, phonePrompt(copy, language), token, { reply_markup: leadFormKeyboard(language, 'phone', user) });
    return true;
  }
  if (pending.step === 'phone') {
    const savedPhone = savedLeadOption(user, language, 'phone');
    const phone = validLeadPhone(message.contact && message.contact.phone_number ? message.contact.phone_number : savedPhone && text === savedPhone ? user.phone : text);
    if (!phone) {
      await sendMessage(user.chatId, copy.invalidPhone, token, { reply_markup: leadFormKeyboard(language, 'phone', user) });
      return true;
    }
    pending.data.phone = phone;
    if (pending.editing === 'phone') {
      await sendLeadReview(user, pending, token, language);
      return true;
    }
    // Для переписки в WhatsApp удобное время не нужно: менеджер просто напишет.
    if (pending.method === 'whatsapp') {
      await submitLead(user, pending, token, language, message);
      return true;
    }
    pending.step = 'time';
    scheduleSave();
    await sendMessage(user.chatId, copy.askTime, token, { reply_markup: leadFormKeyboard(language, 'time', user) });
    return true;
  }
  if (pending.step === 'confirm') {
    const editStep = text === copy.editName ? 'name' : text === copy.editPhone ? 'phone' : text === copy.editTime ? 'time' : '';
    if (editStep) {
      pending.step = editStep;
      pending.editing = editStep;
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      const prompt = editStep === 'phone' ? phonePrompt(copy, language) : editStep === 'time' ? copy.askTime : copy.askName;
      await sendMessage(user.chatId, prompt, token, { reply_markup: leadFormKeyboard(language, editStep, user) });
      return true;
    }
    if (text === copy.edit) {
      pending.step = 'name';
      pending.editing = '';
      pending.data = {};
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      await sendMessage(user.chatId, copy.askName, token, { reply_markup: leadFormKeyboard(language, 'name', user) });
      return true;
    }
    const lead = {
      name: cleanText(pending.data.name, 120),
      phone: cleanText(pending.data.phone, 80),
      preferredTime: cleanText(pending.data.preferredTime, 160),
    };
    if (text !== copy.confirm) {
      await sendMessage(user.chatId, leadReviewText(copy, lead, language), token, { reply_markup: leadFormKeyboard(language, 'confirm', user) });
      return true;
    }
    await submitLead(user, pending, token, language, message);
    return true;
  }
  // "Today" / "tomorrow" are resolved at the moment of the answer: the form
  // may have been opened the day before.
  const preferredTime = preferredTimeWithDate(text, language, Date.now());
  if (preferredTime.length < 2) {
    await sendMessage(user.chatId, copy.invalidTime, token, { reply_markup: leadFormKeyboard(language, 'time', user) });
    return true;
  }
  pending.data.preferredTime = preferredTime;
  // Экран проверки нужен только тем, кто сам нажал «Изменить»: остальным он
  // добавлял лишнее нажатие в конце.
  if (pending.editing || pending.reviewed) {
    await sendLeadReview(user, pending, token, language);
    return true;
  }
  await submitLead(user, pending, token, language, message);
  return true;
}

// Short answers go two to a row (three for times such as "10:00") so the
// keyboard does not cover the chat; the first `fullWidth` options (such as
// "Send") and long answers get a row of their own.
function optionRows(options, fullWidth = 0) {
  const rows = [];
  let row = [];
  const flush = () => {
    if (row.length) rows.push(row);
    row = [];
  };
  options.forEach((text, index) => {
    const length = [...String(text)].length;
    if (index < fullWidth || length > 22) {
      flush();
      rows.push([{ text }]);
      return;
    }
    const perRow = length <= 6 && row.every((button) => [...button.text].length <= 6) ? 3 : 2;
    if (row.length >= perRow) flush();
    row.push({ text });
  });
  flush();
  return rows;
}

function optionReplyKeyboard(options, cancelText, placeholder, fullWidth = 0) {
  return {
    keyboard: [...optionRows(options, fullWidth), [{ text: cancelText }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: cleanText(placeholder, 64),
  };
}

function viewingDateValue(value, copy, language, now = new Date()) {
  const index = copy.dateOptions.indexOf(value);
  if (index < 0 || index > 2) return value;
  const date = new Date(now);
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'ru-RU';
  if (index === 2) {
    const formatter = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
    // On Sunday "at the weekend" means today, not the next weekend.
    if (date.getDay() === 0) return value + ' (' + formatter.format(date) + ')';
    const daysUntilSaturday = 6 - date.getDay();
    const saturday = new Date(date);
    saturday.setDate(date.getDate() + daysUntilSaturday);
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);
    return value + ' (' + formatter.format(saturday) + '–' + formatter.format(sunday) + ')';
  }
  if (index === 1) date.setDate(date.getDate() + 1);
  const formatted = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return value + ' (' + formatted + ')';
}

// With free slots set in the panel ("slot mode") the date and time buttons
// are the free days and hours, and the booking is confirmed at once.
// "Another date" / "Another time" leave slot mode: the manager confirms.
function viewingKeyboard(language, step, pending = null) {
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  const slotMode = Boolean(pending && pending.data && pending.data.slotMode && slotsEnabled());
  if (step === 'date' && slotMode) {
    return optionReplyKeyboard(availableSlotDays(language).map((day) => day.label).concat(copy.dateOptions[3]), copy.cancel, copy.askDate);
  }
  if (step === 'time' && slotMode) {
    return optionReplyKeyboard(freeTimes(pending.data.day).concat(copy.timeOptions[3]), copy.cancel, copy.askTime);
  }
  if (step === 'date') return optionReplyKeyboard(copy.dateOptions, copy.cancel, copy.askDate);
  if (step === 'time') return optionReplyKeyboard(copy.timeOptions, copy.cancel, copy.askTime);
  if (step === 'confirm') return optionReplyKeyboard([copy.confirm, copy.editDate, copy.editTime], copy.cancel, copy.review, 1);
  return optionReplyKeyboard([], copy.cancel, step === 'custom_time' ? copy.askCustomTime : copy.askCustom);
}

function viewingReviewText(copy, property, pending, language) {
  const labels = copy.reviewLabels;
  const title = localizedExact(property && property.title, language) || (property && property.reference) || '';
  return [copy.review, '', labels[0] + ': ' + title, labels[1] + ': ' + cleanText(pending.data.date, 160), labels[2] + ': ' + cleanText(pending.data.time, 160)].join('\n');
}

async function sendViewingReview(user, pending, property, token, language) {
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  pending.step = 'confirm';
  scheduleSave();
  await sendMessage(user.chatId, viewingReviewText(copy, property, pending, language), token, { reply_markup: viewingKeyboard(language, 'confirm', pending) });
}

// Slot mode only when there is something to choose from.
function newViewingData(language) {
  return slotsEnabled() && availableSlotDays(language).length ? { slotMode: true } : {};
}

async function startViewingForm(user, record, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  const pending = { type: 'viewing_form', propertyId: record.id, step: 'date', data: newViewingData(language), createdAt: new Date().toISOString() };
  user.pendingAction = pending;
  scheduleSave();
  const title = localizedExact(record.title, language) || record.reference || '';
  await sendMessage(user.chatId, [title ? '🏠 ' + title : '', copy.askDate].filter(Boolean).join('\n\n'), token, { reply_markup: viewingKeyboard(language, 'date', pending) });
}

// Ответ с клавиатуры приходит буква в букву, а написанный от руки — как
// придётся: другой регистр, без эмодзи, короче или длиннее. Формы сами просят
// «напишите ответ», поэтому такой ответ тоже должен приниматься.
function cleanAnswer(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, ' ').trim();
}

// Слова длиной меньше трёх букв в сравнении не участвуют: «не», «или», «or»
// есть сразу в нескольких вариантах и только путали бы.
const MIN_ANSWER_WORD = 3;
// Общий корень: «квартиру» и «квартира», «alquiler» и «alquilar».
const SHARED_ROOT_LETTERS = 5;

function closeWords(first, second) {
  if (first.length < MIN_ANSWER_WORD || second.length < MIN_ANSWER_WORD) return false;
  if (first === second || first.startsWith(second) || second.startsWith(first)) return true;
  let shared = 0;
  while (shared < first.length && shared < second.length && first[shared] === second[shared]) shared += 1;
  return shared >= SHARED_ROOT_LETTERS;
}

// Люди отвечают своими словами: «купить» вместо «Покупка», «снять» вместо
// «Аренда», «piso» вместо «Apartamento». Слева — по какому слову узнаётся сам
// вариант ответа, справа — начала слов, которыми это пишут от руки. Языки
// вместе: клиент может ответить по-русски и в английской анкете.
const ANSWER_SYNONYMS = [
  { option: /покупк|buy|comprar/i, typed: ['куп', 'покуп', 'приобрет', 'buy', 'purchas', 'compr'] },
  { option: /аренд|rent|alquilar/i, typed: ['снять', 'сним', 'сдач', 'аренд', 'rent', 'leas', 'alquil'] },
  { option: /квартир|apartment|apartamento/i, typed: ['квартир', 'студи', 'flat', 'studio', 'apartm', 'apartam', 'pis'] },
  { option: /вилла|house|casa/i, typed: ['дом', 'вилл', 'коттедж', 'таунхаус', 'hous', 'villa', 'cottage', 'cas', 'chalet', 'adosad'] },
  { option: /участок|land|terreno/i, typed: ['участ', 'земл', 'сотк', 'land', 'plot', 'terren', 'solar', 'parcel'] },
  { option: /коммерч|commercial|comercial/i, typed: ['коммерч', 'офис', 'магазин', 'помещен', 'бизнес', 'commerc', 'office', 'shop', 'busines', 'local', 'negoci'] },
];

function matchingOptions(list, matches) {
  const found = list.filter(matches);
  // Подошло больше одного — лучше переспросить, чем угадать неверно.
  return found.length === 1 ? found[0] : '';
}

function optionFromText(text, options) {
  const typed = cleanAnswer(text);
  if (!typed) return '';
  const list = (Array.isArray(options) ? options : []).filter(Boolean);
  const exact = list.find((option) => cleanAnswer(option) === typed);
  if (exact) return exact;
  // «покупка квартиры» → «Покупка», «кварт» → «Квартира». Если подходит больше
  // одного варианта, лучше переспросить, чем угадать неверно.
  // Обрывок в две буквы слишком легко отнести не к тому варианту, поэтому
  // начало слова засчитываем от трёх букв.
  const near = list.filter((option) => {
    const value = cleanAnswer(option);
    return (typed.length >= 3 && value.startsWith(typed)) || typed.startsWith(value);
  });
  if (near.length === 1) return near[0];
  // «Купить» → «Покупка», «снять» → «Аренда», «piso» → «Apartamento».
  const typedWords = typed.split(' ').filter(Boolean);
  const bySynonym = matchingOptions(list, (option) => ANSWER_SYNONYMS.some((entry) => entry.option.test(option)
    && entry.typed.some((stem) => typedWords.some((word) => word.startsWith(stem)))));
  if (bySynonym) return bySynonym;
  // «квартиру» → «Квартира», «виллу» → «Дом или вилла»: сравниваем по словам и
  // по общему корню, а не по началу всей строки.
  const byWord = matchingOptions(list, (option) => cleanAnswer(option).split(' ')
    .some((word) => typedWords.some((input) => closeWords(input, word))));
  if (byWord) return byWord;
  // Ответ одним числом: «2» → «2 спальни», «6» → «4+ спальни».
  const number = /^\d{1,2}$/.test(typed) ? Number(typed) : NaN;
  if (!Number.isFinite(number)) return '';
  const numbered = list
    .map((option) => ({ option, value: Number((cleanAnswer(option).match(/^(\d{1,2})/) || [])[1]) }))
    .filter((item) => Number.isFinite(item.value));
  const same = numbered.find((item) => item.value === number);
  if (same) return same.option;
  const open = numbered.filter((item) => String(item.option).includes('+')).sort((a, b) => b.value - a.value)[0];
  return open && number > open.value ? open.option : '';
}

// Если ответ всё-таки не понят, показываем, из чего выбирать: повторять
// «напишите ответ» в ответ на написанный ответ — издевательство.
function invalidWithOptions(copy, options) {
  const list = (Array.isArray(options) ? options : []).filter(Boolean);
  return list.length ? copy.invalid + '\n\n' + list.join(' · ') : copy.invalid;
}

async function handleViewingFormMessage(message, user, token) {
  const pending = user.pendingAction;
  if (!pending || pending.type !== 'viewing_form') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  const property = data.objects.find((item) => item.id === pending.propertyId && item.status === 'active');
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const keyboard = (step) => viewingKeyboard(language, step, pending);
  if (!property) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.unavailable, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  if (text === copy.cancel) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.cancelled, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  pending.data = pending.data && typeof pending.data === 'object' ? pending.data : {};
  // Free slots were switched off in the panel while the form was open.
  if (pending.data.slotMode && !slotsEnabled()) pending.data.slotMode = false;
  if (pending.step === 'date') {
    const chosenDate = copy.dateOptions.includes(text) ? text : optionFromText(text, copy.dateOptions);
    if (chosenDate === copy.dateOptions[3]) {
      pending.data.slotMode = false;
      pending.step = 'custom';
      scheduleSave();
      await sendMessage(user.chatId, copy.askCustom, token, { reply_markup: keyboard('custom') });
      return true;
    }
    if (pending.data.slotMode) {
      const days = availableSlotDays(language);
      const typedDay = parseViewingDate(text);
      const day = days.find((item) => item.label === text)
        || days.find((item) => item.label === optionFromText(text, days.map((entry) => entry.label)))
        || (typedDay ? days.find((item) => item.key === typedDay) : null);
      if (!day) {
        // Написанную дату, которой нет среди свободных окон, принимаем как
        // обычное пожелание: менеджер подтвердит её вручную.
        if (typedDay) {
          pending.data.slotMode = false;
          pending.data.date = text;
          pending.data.day = typedDay;
          pending.data.time = copy.asSpecified;
          await sendViewingReview(user, pending, property, token, language);
          return true;
        }
        await sendMessage(user.chatId, invalidWithOptions(copy, days.map((item) => item.label).concat(copy.dateOptions[3])), token, { reply_markup: keyboard('date') });
        return true;
      }
      pending.data.day = day.key;
      pending.data.date = day.label;
      if (pending.editing === 'date' && day.times.includes(pending.data.time)) {
        await sendViewingReview(user, pending, property, token, language);
        return true;
      }
      pending.data.time = '';
    } else {
      const optionIndex = copy.dateOptions.indexOf(chosenDate);
      if (optionIndex < 0) {
        // «25 октября», «3.11» — форма сама просит написать дату, значит и
        // принимать её надо, а не отвечать «выберите вариант».
        const typedDay = parseViewingDate(text);
        if (typedDay) {
          pending.data.date = text;
          pending.data.day = typedDay;
          pending.data.time = copy.asSpecified;
          await sendViewingReview(user, pending, property, token, language);
          return true;
        }
        await sendMessage(user.chatId, invalidWithOptions(copy, copy.dateOptions), token, { reply_markup: keyboard('date') });
        return true;
      }
      pending.data.date = viewingDateValue(chosenDate, copy, language);
      pending.data.day = viewingDayForOption(optionIndex);
      // "As specified" belonged to the free-text date that was just replaced.
      if (pending.data.time === copy.asSpecified) pending.data.time = '';
      if (pending.editing === 'date' && pending.data.time) {
        await sendViewingReview(user, pending, property, token, language);
        return true;
      }
    }
    pending.step = 'time';
    scheduleSave();
    await sendMessage(user.chatId, copy.askTime, token, { reply_markup: keyboard('time') });
    return true;
  }
  if (pending.step === 'time') {
    const times = pending.data.slotMode ? freeTimes(pending.data.day) : copy.timeOptions;
    const chosenTime = times.includes(text) ? text : optionFromText(text, times);
    if (chosenTime === copy.timeOptions[3]) {
      pending.data.slotMode = false;
      pending.step = 'custom_time';
      scheduleSave();
      await sendMessage(user.chatId, copy.askCustomTime, token, { reply_markup: keyboard('custom_time') });
      return true;
    }
    if (!chosenTime) {
      // Написанное время («17:00», «после обеда») тоже ответ: в свободные окна
      // оно не встанет, но менеджеру уйдёт как пожелание.
      if (!pending.data.slotMode && text.length >= 2 && /\d/.test(text)) {
        pending.data.time = text;
        await sendViewingReview(user, pending, property, token, language);
        return true;
      }
      await sendMessage(user.chatId, invalidWithOptions(copy, times.concat(pending.data.slotMode ? [copy.timeOptions[3]] : [])), token, { reply_markup: keyboard('time') });
      return true;
    }
    pending.data.time = chosenTime;
    await sendViewingReview(user, pending, property, token, language);
    return true;
  }
  if (pending.step === 'custom' || pending.step === 'custom_time') {
    if (text.length < 3) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: keyboard(pending.step) });
      return true;
    }
    if (pending.step === 'custom') {
      pending.data.date = text;
      pending.data.day = parseViewingDate(text);
      pending.data.time = copy.asSpecified;
    } else {
      pending.data.time = text;
    }
    await sendViewingReview(user, pending, property, token, language);
    return true;
  }
  if (pending.step === 'confirm') {
    const editStep = text === copy.editDate ? 'date' : text === copy.editTime ? 'time' : '';
    if (editStep) {
      // Editing starts again from the free slots when they are set.
      if (!pending.data.slotMode && editStep === 'date') Object.assign(pending.data, newViewingData(language));
      if (pending.data.slotMode && editStep === 'time' && !pending.data.day) pending.data.slotMode = false;
      pending.step = editStep;
      pending.editing = editStep;
      scheduleSave();
      const prompt = editStep === 'date' ? copy.askDate : copy.askTime;
      await sendMessage(user.chatId, prompt, token, { reply_markup: keyboard(editStep) });
      return true;
    }
    if (text === copy.restart) {
      pending.step = 'date';
      pending.data = newViewingData(language);
      pending.editing = '';
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      await sendMessage(user.chatId, copy.askDate, token, { reply_markup: keyboard('date') });
      return true;
    }
    if (text !== copy.confirm) {
      await sendMessage(user.chatId, viewingReviewText(copy, property, pending, language), token, { reply_markup: keyboard('confirm') });
      return true;
    }
    const slotBooking = Boolean(pending.data.slotMode && pending.data.day && pending.data.time);
    // Someone else may have taken the slot while this client was deciding,
    // or it is now too close to book.
    if (slotBooking && !slotFree(pending.data.day, pending.data.time)) {
      const taken = bookedViewings(pending.data.day, pending.data.time) >= slotSettings().perSlot;
      pending.step = 'date';
      pending.editing = '';
      pending.data = newViewingData(language);
      scheduleSave();
      await sendMessage(user.chatId, taken ? copy.slotTaken : copy.slotGone, token, { reply_markup: keyboard('date') });
      return true;
    }
    const details = [
      propertyRequestText(property, language, 'viewing'),
      copy.reviewLabels[1] + ': ' + cleanText(pending.data.date, 160),
      copy.reviewLabels[2] + ': ' + cleanText(pending.data.time, 160),
      ...(slotBooking ? ['', '✅ Время из свободных окон — просмотр подтверждён автоматически'] : []),
    ].join('\n');
    const viewing = { date: pending.data.day, dateText: pending.data.date, timeText: pending.data.time };
    if (slotBooking) Object.assign(viewing, { confirmedDate: pending.data.day, confirmedTime: pending.data.time, confirmedAt: new Date().toISOString() });
    user.pendingAction = null;
    const inquiry = createInquiry(user, details, {
      type: 'viewing',
      propertyId: property.id,
      sourceMessage: message,
      viewing,
      status: slotBooking ? 'in_progress' : 'new',
    });
    recordPropertyEvent(property.id, 'viewings');
    saveDataNow();
    if (slotBooking) {
      // Подтверждение одно: заголовок «Готово» и сразу подробности. Клавиатуру
      // главного меню возвращаем этим же сообщением, а тем, чьего номера мы не
      // знаем, добавляем кнопку «Оставить номер».
      await sendViewingConfirmation(inquiry, user, token, {
        heading: copy.slotBooked,
        keyboard: viewingMenuKeyboard(language, user),
      });
      return true;
    }
    await sendMessage(user.chatId, withOffHoursNote([copy.success, '🏠 ' + (localizedExact(property.title, language) || property.reference || '')].filter(Boolean).join('\n\n'), language), token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  return false;
}

// Меню после записи на просмотр: у кого нет телефона — с кнопкой «Оставить
// номер». Телефон для показа нужен не боту, а менеджеру: в день показа он
// звонит, а не пишет.
function viewingMenuKeyboard(language, user) {
  const menu = menuKeyboard(language);
  if (knownLeadPhone(user)) return menu;
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  return {
    ...menu,
    keyboard: [[{ text: copy.sharePhoneForViewing, request_contact: true }], ...menu.keyboard],
  };
}

// Клиент прислал номер после записи на просмотр: сохраняем и говорим спасибо.
async function saveViewingPhone(message, user, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = VIEWING_FORM_TEXT[language] || VIEWING_FORM_TEXT.ru;
  const phone = validLeadPhone(message.contact && message.contact.phone_number);
  if (!phone) return false;
  user.phone = phone;
  scheduleSave();
  const viewing = data.inquiries.filter((item) => item.type === 'viewing' && item.userId === user.id).pop();
  createInquiry(user, 'Телефон для связи в день показа: ' + phone, {
    type: 'question',
    propertyId: viewing ? viewing.propertyId : '',
    sourceMessage: message,
  });
  saveDataNow();
  await sendMessage(user.chatId, copy.phoneForViewingSaved, token, { reply_markup: menuKeyboard(language) });
  return true;
}

const SELECTION_STEPS = ['deal', 'type', 'location', 'budget', 'bedrooms'];

function selectionPrompt(copy, step) {
  return { deal: copy.askDeal, type: copy.askType, location: copy.askLocation, budget: copy.askBudget, bedrooms: copy.askBedrooms }[step] || copy.askDeal;
}

function selectionKeyboard(language, step) {
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  if (step === 'deal') return optionReplyKeyboard(copy.dealOptions, copy.cancel, copy.askDeal);
  if (step === 'type') return optionReplyKeyboard(copy.typeOptions, copy.cancel, copy.askType);
  if (step === 'location') return optionReplyKeyboard([copy.anyLocation], copy.cancel, copy.askLocation);
  if (step === 'budget') return optionReplyKeyboard([copy.noBudget], copy.cancel, copy.askBudget);
  if (step === 'bedrooms') return optionReplyKeyboard(copy.bedroomOptions, copy.cancel, copy.askBedrooms);
  return optionReplyKeyboard([copy.confirm, copy.editDeal, copy.editType, copy.editLocation, copy.editBudget, copy.editBedrooms], copy.cancel, copy.review, 1);
}

// Land and commercial property have no bedrooms, so that question is skipped.
function selectionNeedsBedrooms(copy, type) {
  const index = copy.typeOptions.indexOf(type);
  return index !== 2 && index !== 3;
}

function selectionReviewText(copy, pending) {
  const values = SELECTION_STEPS.map((step) => pending.data[step]);
  return [copy.review, '', ...copy.labels.map((label, index) => label + ': ' + cleanText(values[index], 200))].join('\n');
}

function selectionMatchSummary(copy, ranking) {
  const counts = { exact: 0, close: 0, consider: 0 };
  for (const item of ranking) if (Object.hasOwn(counts, item.tier)) counts[item.tier] += 1;
  return String(copy.matchSummary || '')
    .replace('{exact}', String(counts.exact))
    .replace('{close}', String(counts.close))
    .replace('{consider}', String(counts.consider));
}

async function sendSelectionReview(user, pending, token, language) {
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  pending.step = 'confirm';
  pending.editing = '';
  scheduleSave();
  await sendMessage(user.chatId, selectionReviewText(copy, pending), token, { reply_markup: selectionKeyboard(language, 'confirm') });
}

async function startSelectionForm(user, token) {
  const language = user.preferredLanguage || 'ru';
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  user.pendingAction = { type: 'property_selection', step: 'deal', data: {}, createdAt: new Date().toISOString() };
  scheduleSave();
  await sendMessage(user.chatId, copy.intro + '\n\n' + copy.askDeal, token, { reply_markup: selectionKeyboard(language, 'deal') });
}

async function handleSelectionFormMessage(message, user, token) {
  const pending = user.pendingAction;
  if (!pending || pending.type !== 'property_selection') return false;
  const language = user.preferredLanguage || 'ru';
  const copy = SELECTION_FORM_TEXT[language] || SELECTION_FORM_TEXT.ru;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text === copy.cancel) {
    user.pendingAction = null;
    scheduleSave();
    await sendMessage(user.chatId, copy.cancelled, token, { reply_markup: menuKeyboard(language) });
    return true;
  }
  pending.data = pending.data && typeof pending.data === 'object' ? pending.data : {};
  if (pending.step === 'deal') {
    const chosen = copy.dealOptions.includes(text) ? text : optionFromText(text, copy.dealOptions);
    if (!chosen) {
      await sendMessage(user.chatId, invalidWithOptions(copy, copy.dealOptions), token, { reply_markup: selectionKeyboard(language, 'deal') });
      return true;
    }
    pending.data.deal = chosen;
    if (pending.editing === 'deal') {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    pending.step = 'type';
    scheduleSave();
    await sendMessage(user.chatId, copy.askType, token, { reply_markup: selectionKeyboard(language, 'type') });
    return true;
  }
  if (pending.step === 'type') {
    const chosen = copy.typeOptions.includes(text) ? text : optionFromText(text, copy.typeOptions);
    if (!chosen) {
      await sendMessage(user.chatId, invalidWithOptions(copy, copy.typeOptions), token, { reply_markup: selectionKeyboard(language, 'type') });
      return true;
    }
    pending.data.type = chosen;
    if (!selectionNeedsBedrooms(copy, chosen)) {
      pending.data.bedrooms = copy.bedroomOptions[copy.bedroomOptions.length - 1];
      pending.data.bedroomsSkipped = true;
    } else if (pending.editing === 'type' && pending.data.bedroomsSkipped) {
      // Changed from land to a house: the bedrooms were never asked.
      pending.step = 'bedrooms';
      pending.editing = 'bedrooms';
      scheduleSave();
      await sendMessage(user.chatId, copy.askBedrooms, token, { reply_markup: selectionKeyboard(language, 'bedrooms') });
      return true;
    }
    if (pending.editing === 'type') {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    pending.step = 'location';
    scheduleSave();
    await sendMessage(user.chatId, copy.askLocation, token, { reply_markup: selectionKeyboard(language, 'location') });
    return true;
  }
  if (pending.step === 'location' || pending.step === 'budget') {
    if (text.length < 2) {
      await sendMessage(user.chatId, copy.invalid, token, { reply_markup: selectionKeyboard(language, pending.step) });
      return true;
    }
    const completedStep = pending.step;
    pending.data[completedStep] = text;
    if (pending.editing === completedStep) {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    if (completedStep === 'budget' && !selectionNeedsBedrooms(copy, pending.data.type)) {
      await sendSelectionReview(user, pending, token, language);
      return true;
    }
    pending.step = completedStep === 'location' ? 'budget' : 'bedrooms';
    scheduleSave();
    await sendMessage(user.chatId, selectionPrompt(copy, pending.step), token, { reply_markup: selectionKeyboard(language, pending.step) });
    return true;
  }
  if (pending.step === 'bedrooms') {
    const chosen = copy.bedroomOptions.includes(text) ? text : optionFromText(text, copy.bedroomOptions);
    if (!chosen) {
      await sendMessage(user.chatId, invalidWithOptions(copy, copy.bedroomOptions), token, { reply_markup: selectionKeyboard(language, 'bedrooms') });
      return true;
    }
    pending.data.bedrooms = chosen;
    pending.data.bedroomsSkipped = false;
    await sendSelectionReview(user, pending, token, language);
    return true;
  }
  if (pending.step === 'confirm') {
    const editStep = text === copy.editDeal ? 'deal'
      : text === copy.editType ? 'type'
        : text === copy.editLocation ? 'location'
          : text === copy.editBudget ? 'budget'
            : text === copy.editBedrooms ? 'bedrooms'
              : '';
    if (editStep) {
      pending.step = editStep;
      pending.editing = editStep;
      scheduleSave();
      await sendMessage(user.chatId, selectionPrompt(copy, editStep), token, { reply_markup: selectionKeyboard(language, editStep) });
      return true;
    }
    if (text === copy.restart) {
      pending.step = 'deal';
      pending.data = {};
      pending.editing = '';
      pending.createdAt = new Date().toISOString();
      scheduleSave();
      await sendMessage(user.chatId, copy.askDeal, token, { reply_markup: selectionKeyboard(language, 'deal') });
      return true;
    }
    if (text !== copy.confirm) {
      await sendMessage(user.chatId, selectionReviewText(copy, pending), token, { reply_markup: selectionKeyboard(language, 'confirm') });
      return true;
    }
    const selection = {
      deal: cleanText(pending.data.deal, 200),
      type: cleanText(pending.data.type, 200),
      location: cleanText(pending.data.location, 200),
      budget: cleanText(pending.data.budget, 200),
      bedrooms: cleanText(pending.data.bedrooms, 200),
    };
    const ranking = currentSelectionRanking(user, selection);
    const matchSummary = selectionMatchSummary(copy, ranking);
    const inquiryText = [selectionReviewText(copy, pending).replace(copy.review, copy.summaryTitle).trim(), matchSummary].filter(Boolean).join('\n\n');
    const matchDetails = ranking.map((item) => ({
      id: item.record.id,
      tier: item.tier,
      score: item.score,
      reasons: item.reasons,
      warnings: item.warnings,
    }));
    user.pendingAction = null;
    createInquiry(user, inquiryText, {
      type: 'selection',
      selection,
      matching: { results: matchDetails, generatedAt: new Date().toISOString() },
      sourceMessage: message,
    });
    // Exact matches come first, then useful nearby alternatives. The short
    // explanation stored with each id follows the user through catalog pages.
    user.selectionMatchIds = ranking.map((item) => item.record.id);
    user.selectionMatchDetails = matchDetails;
    saveDataNow();
    if (!ranking.length) {
      await sendMessage(user.chatId, withOffHoursNote(copy.success, language), token, { reply_markup: menuKeyboard(language) });
      // Nothing fits yet: the rest of the catalog is one tap away.
      if (publishedCatalog(user).length) {
        const navigation = NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru;
        await sendUiMessage(user.chatId, user, copy.noMatchesYet, token, { reply_markup: { inline_keyboard: [[{ text: '🏘 ' + navigation.browse, callback_data: 'catalog:all:0' }]] } });
      }
      return true;
    }
    await sendMessage(user.chatId, withOffHoursNote([copy.successMatches, matchSummary].filter(Boolean).join('\n\n'), language), token, { reply_markup: menuKeyboard(language) });
    await sendCatalogPage(user.chatId, user, token, 0, 'matches');
    return true;
  }
  return false;
}

// A client who started a form and went quiet hears about it once, a couple
// of hours later and before the form expires, in the daytime. The buttons
// are the same as after /start in the middle of a form.
const FORM_REMINDER_IDLE_MS = 2 * 60 * 60 * 1000;
const FORM_REMINDER_HOURS = { from: 9, to: 21 };
const FORM_REMINDERS_PER_RUN = 20;
const FORM_REMINDER_TEXT_KEYS = { lead: 'reminderLead', viewing_form: 'reminderViewing', property_selection: 'reminderSelection' };

function formReminderDue(user, now = new Date()) {
  const pending = user && user.pendingAction;
  if (!pending || !FORM_REMINDER_TEXT_KEYS[pending.type] || pending.remindedAt || user.blocked || !user.chatId) return false;
  if (now.getHours() < FORM_REMINDER_HOURS.from || now.getHours() >= FORM_REMINDER_HOURS.to) return false;
  const createdAt = Date.parse(pending.createdAt || '');
  if (!Number.isFinite(createdAt)) return false;
  const lastSeen = Math.max(createdAt, Date.parse(user.lastSeenAt || '') || 0);
  return now.getTime() - lastSeen >= FORM_REMINDER_IDLE_MS
    && now.getTime() - createdAt < PENDING_ACTION_TTL_MS - 60 * 60 * 1000;
}

async function runFormReminders(now = new Date(), token = data.config.botToken) {
  if (!token || !data.config.active) return [];
  const sent = [];
  for (const user of Object.values(data.users)) {
    if (sent.length >= FORM_REMINDERS_PER_RUN) break;
    if (!formReminderDue(user, now)) continue;
    const language = user.preferredLanguage || 'ru';
    const copy = INTERACTION_TEXT[language] || INTERACTION_TEXT.ru;
    // Marked first: a refusal from Telegram must not be retried every run.
    const markedBefore = user.pendingAction.remindedAt;
    user.pendingAction.remindedAt = now.toISOString();
    scheduleSave();
    try {
      await sendMessage(user.chatId, copy[FORM_REMINDER_TEXT_KEYS[user.pendingAction.type]], token, { reply_markup: unfinishedActionKeyboard(language) });
      sent.push(user.id);
    } catch (error) {
      if (Number(error && error.telegramCode) === 403) markUnavailable(user);
      else if (temporaryDeliveryError(error) && user.pendingAction) {
        // Связи не было — напомним при следующей проверке, пока форма жива.
        user.pendingAction.remindedAt = markedBefore || '';
        scheduleSave();
      }
    }
  }
  if (sent.length) saveDataNow();
  return sent;
}

async function restartExpiredAction(user, token) {
  const action = user && user.expiredAction;
  if (!action) return false;
  const language = user.preferredLanguage || 'ru';
  user.expiredAction = null;
  scheduleSave();
  const property = action.propertyId
    ? data.objects.find((item) => item.id === action.propertyId && ['active', 'reserved'].includes(item.status))
    : null;
  if (action.type === 'selection') {
    await startSelectionForm(user, token);
    return true;
  }
  if (action.type === 'lead') {
    await startLeadForm(user, token, { propertyId: property ? property.id : '' });
    return true;
  }
  if (action.type === 'viewing' && property && property.status === 'active') {
    await startViewingForm(user, property, token);
    return true;
  }
  if (action.type === 'property_question' && property) {
    const copy = PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru;
    user.pendingAction = { type: 'question', propertyId: property.id, createdAt: new Date().toISOString() };
    scheduleSave();
    await sendMessage(user.chatId, copy.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + copy.cancel, callback_data: 'property:cancel:' + property.id }]] },
    });
    return true;
  }
  if (action.type === 'manager_question') {
    const copy = MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru;
    user.pendingAction = { type: 'manager_question', createdAt: new Date().toISOString() };
    scheduleSave();
    await sendMessage(user.chatId, copy.askQuestion, token, {
      reply_markup: { inline_keyboard: [[{ text: '✕ ' + copy.cancel, callback_data: 'contact:cancel' }]] },
    });
    return true;
  }
  if (action.type === 'catalog_filter_price') {
    await startCatalogPriceInput(user, token, action.priceBound === 'min' ? 'min' : 'max');
    return true;
  }
  await sendMessage(user.chatId, (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).propertyUnavailable, token, { reply_markup: menuKeyboard(language) });
  return true;
}

export {
  optionFromText,
  FORM_REMINDER_IDLE_MS,
  duplicateCallback,
  formReminderDue,
  runFormReminders,
  duplicateInboundMessage,
  expiredActionKeyboard,
  handleLeadFormMessage,
  handleSelectionFormMessage,
  handleViewingFormMessage,
  isStaleFormControl,
  leadFormKeyboard,
  leadReviewText,
  optionReplyKeyboard,
  optionRows,
  pendingActionExpired,
  preferredTimeWithDate,
  rememberExpiredAction,
  restartExpiredAction,
  savedLeadOption,
  selectionKeyboard,
  selectionReviewText,
  sendLeadReview,
  sendSelectionReview,
  sendViewingReview,
  showPendingActionStep,
  handleLeadMethodCallback,
  knownLeadPhone,
  saveViewingPhone,
  startLeadEdit,
  startLeadForm,
  startSelectionForm,
  startViewingForm,
  unfinishedActionKeyboard,
  validLeadPhone,
  viewingDateValue,
  viewingKeyboard,
  viewingReviewText,
};
