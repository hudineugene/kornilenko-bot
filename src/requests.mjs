// «Мои заявки»: клиент видит свои последние обращения и их статус и может
// отменить просмотр.

import { INTERACTION_TEXT, MENU_LABELS, MY_REQUESTS_TEXT } from './texts.mjs';
import { data } from './store.mjs';
import { normalizeUser } from './users.mjs';
import { localized, localizedExact, sendUiMessage, shortenedText } from './catalog.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { startViewingForm } from './forms.mjs';
import { cancelViewing, viewingIsUpcoming, viewingWhen } from './viewings.mjs';
import { backButtonText, formatDayMonth } from './util.mjs';
import { planHelpSteps } from './plan.mjs';
import { addUk } from './languages.mjs';

const MY_REQUESTS_SHOWN = 5;
const LOCALES = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-GB', es: 'es-ES' };

const PLAN_STEP_WORD = { ru: 'План · шаг', en: 'Plan · step', es: 'Plan · paso' };
addUk(PLAN_STEP_WORD);
const PLAN_STEPS_WORD = { ru: 'План · шаги', en: 'Plan · steps', es: 'Plan · pasos' };
addUk(PLAN_STEPS_WORD);

function requestTypeLabel(inquiry, copy, language = 'ru') {
  // Помощь по шагу плана покупки — «📋 План · шаг 2: Банковский счёт», а не безликий «Вопрос».
  // Несколько просьб в одной заявке — «План · шаги 1, 2, 3»: название шага у каждой не поместилось бы в строку.
  const steps = inquiry.type === 'question' ? planHelpSteps(inquiry.text) : [];
  if (steps.length === 1) return '📋 ' + (PLAN_STEP_WORD[language] || PLAN_STEP_WORD.ru) + ' ' + steps[0].n + ': ' + steps[0].title;
  if (steps.length > 1) return '📋 ' + (PLAN_STEPS_WORD[language] || PLAN_STEPS_WORD.ru) + ' ' + steps.map((step) => step.n).join(', ');
  return {
    viewing: copy.typeViewing,
    lead: copy.typeLead,
    selection: copy.typeSelection,
    question: copy.typeQuestion,
    interest: copy.typeInterest,
  }[inquiry.type] || copy.typeGeneral;
}

function requestStatusLabel(inquiry, copy) {
  const viewing = inquiry.type === 'viewing' ? inquiry.viewing || {} : {};
  if (viewing.cancelledAt) return copy.statusCancelled;
  if (inquiry.status === 'closed') return copy.statusClosed;
  if (viewing.confirmedAt) return copy.statusConfirmed;
  return inquiry.status === 'in_progress' ? copy.statusInProgress : copy.statusNew;
}

function requestTitle(inquiry, language) {
  const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
  if (!property) return '';
  return localizedExact(property.title, language) || localized(property.title, language) || property.reference || '';
}

function userRequests(user) {
  return data.inquiries
    .filter((inquiry) => inquiry.userId === String(user.id))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, MY_REQUESTS_SHOWN);
}

function myRequestsView(user) {
  const language = user.preferredLanguage || 'ru';
  const copy = MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru;
  const myArea = (MENU_LABELS[language] || MENU_LABELS.ru).more;
  const requests = userRequests(user);
  const rows = [];
  if (!requests.length) {
    rows.push([{ text: backButtonText(myArea), callback_data: 'nav:my' }]);
    return { text: copy.none, markup: { inline_keyboard: rows } };
  }
  // Название объекта в кнопках нужно, только когда будущих просмотров несколько: с одним оно лишь обрезается («· Villa…»).
  const upcomingViewings = requests.filter((item) => item.type === 'viewing' && viewingIsUpcoming(item)).length;
  const blocks = requests.map((inquiry) => {
    const title = requestTitle(inquiry, language);
    const heading = requestTypeLabel(inquiry, copy, language) + (title && !(inquiry.type === 'question' && planHelpSteps(inquiry.text).length) ? ' · ' + title : '');
    let details;
    if (inquiry.type === 'viewing' && inquiry.viewing) {
      const when = viewingWhen(inquiry, language);
      details = [when.date, when.time].filter(Boolean).join(', ');
    } else {
      const sent = new Date(inquiry.createdAt);
      details = Number.isFinite(sent.getTime())
        ? copy.sentOn + ' ' + formatDayMonth(sent, language)
        : '';
    }
    if (inquiry.type === 'viewing' && viewingIsUpcoming(inquiry)) {
      if (inquiry.propertyId) rows.push([{ text: shortenedText(copy.moveViewing + (title && upcomingViewings > 1 ? ' · ' + title : ''), 31), callback_data: 'myreq:move:' + inquiry.id }]);
      rows.push([{ text: shortenedText(copy.cancelViewing + (title && upcomingViewings > 1 ? ' · ' + title : ''), 31), callback_data: 'myreq:cancel:' + inquiry.id }]);
    }
    return [heading, [details, requestStatusLabel(inquiry, copy)].filter(Boolean).join(' — ')].join('\n');
  });
  rows.push([{ text: backButtonText(myArea), callback_data: 'nav:my' }]);
  return { text: [copy.title, '', blocks.join('\n\n'), '', copy.footer].join('\n'), markup: { inline_keyboard: rows } };
}

async function sendMyRequests(chatId, user, token) {
  const view = myRequestsView(user);
  await sendUiMessage(chatId, user, view.text, token, { reply_markup: view.markup });
}

async function handleMyRequestsCallback(query, token) {
  const [, action, ...rest] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = MY_REQUESTS_TEXT[language] || MY_REQUESTS_TEXT.ru;
  if (action === 'list') {
    await acknowledgeCallback(query, token);
    await sendMyRequests(chatId, user, token);
    return;
  }
  const inquiry = data.inquiries.find((item) => item.id === rest.join(':'));
  // A client can only cancel their own viewing, and only one still ahead.
  if (!inquiry || inquiry.userId !== String(user.id) || !viewingIsUpcoming(inquiry)) {
    await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
    return;
  }
  if (action === 'move') {
    const record = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
    if (!record || record.status !== 'active') {
      await acknowledgeCallback(query, token, copy.moveGone);
      return;
    }
    await acknowledgeCallback(query, token);
    await startViewingForm(user, record, token, { replaces: inquiry.id, note: copy.moveNote });
    return;
  }
  if (action === 'cancel') {
    await acknowledgeCallback(query, token);
    const title = requestTitle(inquiry, language);
    const when = viewingWhen(inquiry, language);
    const details = [title ? '🔖 ' + title : '', [when.date, when.time].filter(Boolean).join(', ')].filter(Boolean).join('\n');
    await sendUiMessage(chatId, user, [copy.cancelAsk, details].filter(Boolean).join('\n\n'), token, {
      reply_markup: { inline_keyboard: [
        [{ text: copy.cancelYes, callback_data: 'myreq:yes:' + inquiry.id }],
        [{ text: copy.cancelNo, callback_data: 'myreq:no:' + inquiry.id }],
      ] },
    });
    return;
  }
  if (action === 'yes') {
    await acknowledgeCallback(query, token);
    await cancelViewing(inquiry, user);
    await sendUiMessage(chatId, user, copy.cancelDone, token, { reply_markup: { inline_keyboard: [
      [{ text: copy.menuButton, callback_data: 'myreq:list' }],
      [{ text: backButtonText((MENU_LABELS[language] || MENU_LABELS.ru).more), callback_data: 'nav:my' }],
    ] } });
    return;
  }
  if (action === 'no') {
    await acknowledgeCallback(query, token, copy.kept);
    await sendMyRequests(chatId, user, token);
    return;
  }
  await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
}

export {
  MY_REQUESTS_SHOWN,
  handleMyRequestsCallback,
  myRequestsView,
  requestStatusLabel,
  sendMyRequests,
  userRequests,
};
