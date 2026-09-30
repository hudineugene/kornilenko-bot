// «📋 Мой план покупки»: чек-лист шагов для покупателя из другой страны (NIE, счёт,
// юрист, ипотека, подбор, просмотр, резервация, контракт, нотариус, регистрация).
// Клиент отмечает «✅ Готово» или «💬 Нужна помощь» — помощь уходит менеджеру
// заявкой. В «Моё» видно «шаг 3 из 10». Если клиент начал план и замолчал, бот
// (когда владелец включил напоминания) один раз в две недели напоминает о
// следующем шаге. Формулировки шагов правит владелец в панели.

import { delay } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { recordError } from './analytics.mjs';
import { markUnavailable, normalizeUser } from './users.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { createInquiry } from './inquiries.mjs';
import { sendUiMessage } from './catalog.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { withOffHoursNote } from './hours.mjs';
import { temporaryDeliveryError, userUnavailableError } from './broadcasts.mjs';
import { INTERACTION_TEXT } from './texts.mjs';
import { DEFAULT_BUY_PLAN, normalizeBuyPlan } from './data-format.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_AFTER_MS = 6 * DAY_MS;
const REMIND_UNTIL_MS = 45 * DAY_MS;
const REMIND_EVERY_MS = 14 * DAY_MS;
const HELP_REPEAT_MS = DAY_MS;
const SEND_FROM_HOUR = 10;
const SEND_TO_HOUR = 19;
const PER_RUN = 30;

const PLAN_TEXT = {
  ru: {
    title: '📋 Мой план покупки',
    menuButton: '📋 Мой план покупки',
    progress: 'Вы на шаге {n} из {total}',
    finished: 'Все шаги пройдены 🎉',
    hint: 'Нажмите на номер шага, чтобы открыть его.',
    disclaimer: 'Это ориентир, а не юридическая консультация: сроки и суммы зависят от случая — уточняйте у юриста.',
    step: 'Шаг {n} из {total}',
    done: '✅ Готово',
    undo: '↩️ Ещё не сделано',
    help: '💬 Нужна помощь',
    back: '⬅️ Назад',
    next: 'Дальше ➡️',
    toPlan: '📋 К плану',
    statusDone: '✅ Отмечено как готовое',
    statusHelp: '💬 Помощь запрошена — менеджер ответит в этом чате',
    helpSent: 'Спасибо! Просьба о помощи передана менеджеру.',
    helpAlready: 'Просьба уже передана менеджеру — он ответит в этом чате.',
    helpRequest: 'Клиент просит помощи в плане покупки, шаг {n}: {title}',
    reminder: 'Ваш план покупки ждёт. Следующий шаг: {n}. {title}',
    open: '📋 Открыть план',
    off: '🔕 Не напоминать',
    offDone: 'Хорошо, о плане больше не напоминаю. Он остаётся в «Моё → Мой план покупки».',
    menu: '🏠 В меню',
  },
  en: {
    title: '📋 My buying plan',
    menuButton: '📋 My buying plan',
    progress: 'You are on step {n} of {total}',
    finished: 'All steps done 🎉',
    hint: 'Tap a step number to open it.',
    disclaimer: 'This is a guide, not legal advice: timing and amounts depend on the case — check with a lawyer.',
    step: 'Step {n} of {total}',
    done: '✅ Done',
    undo: '↩️ Not done yet',
    help: '💬 I need help',
    back: '⬅️ Back',
    next: 'Next ➡️',
    toPlan: '📋 To the plan',
    statusDone: '✅ Marked as done',
    statusHelp: '💬 Help requested — an agent will reply in this chat',
    helpSent: 'Thank you! Your request for help has been sent to an agent.',
    helpAlready: 'Your request has already been sent — an agent will reply in this chat.',
    helpRequest: 'The client asks for help with the buying plan, step {n}: {title}',
    reminder: 'Your buying plan is waiting. Next step: {n}. {title}',
    open: '📋 Open the plan',
    off: '🔕 Stop reminders',
    offDone: 'OK, no more plan reminders. The plan stays in “My account → My buying plan”.',
    menu: '🏠 Main menu',
  },
  es: {
    title: '📋 Mi plan de compra',
    menuButton: '📋 Mi plan de compra',
    progress: 'Estás en el paso {n} de {total}',
    finished: 'Todos los pasos completados 🎉',
    hint: 'Pulsa el número de un paso para abrirlo.',
    disclaimer: 'Es una orientación, no asesoramiento jurídico: los plazos e importes dependen del caso; consúltalo con un abogado.',
    step: 'Paso {n} de {total}',
    done: '✅ Hecho',
    undo: '↩️ Aún no',
    help: '💬 Necesito ayuda',
    back: '⬅️ Atrás',
    next: 'Siguiente ➡️',
    toPlan: '📋 Al plan',
    statusDone: '✅ Marcado como hecho',
    statusHelp: '💬 Ayuda solicitada: un asesor responderá en este chat',
    helpSent: '¡Gracias! Tu petición de ayuda se ha enviado a un asesor.',
    helpAlready: 'Tu petición ya se ha enviado: un asesor responderá en este chat.',
    helpRequest: 'El cliente pide ayuda con el plan de compra, paso {n}: {title}',
    reminder: 'Tu plan de compra te espera. Siguiente paso: {n}. {title}',
    open: '📋 Abrir el plan',
    off: '🔕 No recordar más',
    offDone: 'De acuerdo, no te lo recuerdo más. El plan sigue en «Mi espacio → Mi plan de compra».',
    menu: '🏠 Menú principal',
  },
};

function planCopy(language) {
  return PLAN_TEXT[language] || PLAN_TEXT.ru;
}

function fill(text, values) {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll('{' + key + '}', () => String(value)), String(text || ''));
}

function steps() {
  return normalizeBuyPlan(data.buyPlan);
}

// Состояние клиента: какие шаги отмечены, о чём просил помощи, когда начал и когда
// последний раз что-то делал в плане.
function planOf(user) {
  const stored = user.plan && typeof user.plan === 'object' ? user.plan : {};
  return {
    startedAt: stored.startedAt || '',
    updatedAt: stored.updatedAt || '',
    remindedAt: stored.remindedAt || '',
    remindOptOut: stored.remindOptOut === true,
    done: stored.done && typeof stored.done === 'object' ? { ...stored.done } : {},
    help: stored.help && typeof stored.help === 'object' ? { ...stored.help } : {},
  };
}

function savePlan(user, plan) {
  user.plan = plan;
  scheduleSave();
}

// Первый шаг, который ещё не отмечен; после последнего — steps.length.
function currentStepIndex(user) {
  const plan = planOf(user);
  const list = steps();
  const index = list.findIndex((step) => !plan.done[step.id]);
  return index < 0 ? list.length : index;
}

function planProgress(user) {
  const list = steps();
  const plan = planOf(user);
  return { done: list.filter((step) => plan.done[step.id]).length, total: list.length, current: currentStepIndex(user) };
}

// Заявка «помощь по шагу плана» узнаётся по тексту, который создаёт сам бот (helpRequest на любом
// языке): схема данных не меняется, а в «Мои заявки» она подписана «План · шаг 2: …», а не «Вопрос».
function parsePlanHelp(text) {
  for (const copy of Object.values(PLAN_TEXT)) {
    const [head, tail] = String(copy.helpRequest || '').split('{n}');
    const [middle] = String(tail || '').split('{title}');
    const source = String(text || '');
    if (!head || !source.startsWith(head)) continue;
    const match = source.slice(head.length).match(/^(\d+)/);
    if (!match) continue;
    const rest = source.slice(head.length + match[1].length);
    if (!rest.startsWith(middle)) continue;
    return { n: Number(match[1]), title: rest.slice(middle.length).trim() };
  }
  return null;
}

function stepMark(plan, step) {
  return plan.done[step.id] ? '✅' : plan.help[step.id] ? '💬' : '⬜';
}

function overviewText(user, language) {
  const copy = planCopy(language);
  const plan = planOf(user);
  const list = steps();
  const current = currentStepIndex(user);
  const lines = [copy.title, ''];
  lines.push(current >= list.length ? copy.finished : fill(copy.progress, { n: current + 1, total: list.length }), '');
  list.forEach((step, index) => {
    lines.push((index === current ? '👉' : stepMark(plan, step)) + ' ' + (index + 1) + '. ' + (step.title[language] || step.title.ru));
  });
  lines.push('', copy.hint, '', copy.disclaimer);
  return lines.join('\n');
}

function overviewMarkup(user, language) {
  const copy = planCopy(language);
  const list = steps();
  const buttons = list.map((step, index) => ({ text: String(index + 1), callback_data: 'plan:step:' + index }));
  const rows = [];
  for (let start = 0; start < buttons.length; start += 5) rows.push(buttons.slice(start, start + 5));
  rows.push([{ text: copy.menu, callback_data: 'nav:menu' }]);
  return { inline_keyboard: rows };
}

function stepText(user, language, index) {
  const copy = planCopy(language);
  const plan = planOf(user);
  const list = steps();
  const step = list[index];
  const lines = ['📋 ' + fill(copy.step, { n: index + 1, total: list.length }) + ': ' + (step.title[language] || step.title.ru), '', step.text[language] || step.text.ru];
  if (plan.done[step.id]) lines.push('', copy.statusDone);
  else if (plan.help[step.id]) lines.push('', copy.statusHelp);
  return lines.join('\n');
}

function stepMarkup(user, language, index) {
  const copy = planCopy(language);
  const plan = planOf(user);
  const list = steps();
  const step = list[index];
  const rows = [[plan.done[step.id]
    ? { text: copy.undo, callback_data: 'plan:undo:' + index }
    : { text: copy.done, callback_data: 'plan:done:' + index }]];
  rows.push([{ text: copy.help, callback_data: 'plan:help:' + index }]);
  const move = [];
  if (index > 0) move.push({ text: copy.back, callback_data: 'plan:step:' + (index - 1) });
  if (index < list.length - 1) move.push({ text: copy.next, callback_data: 'plan:step:' + (index + 1) });
  if (move.length) rows.push(move);
  rows.push([{ text: copy.toPlan, callback_data: 'plan:open' }]);
  return { inline_keyboard: rows };
}

// Экран листается в том же сообщении; не вышло изменить — новым.
async function showScreen(chatId, user, token, query, text, markup) {
  if (query && query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: query.message.message_id, text, reply_markup: markup });
      return;
    } catch {
      // Сообщение уже не изменить.
    }
  }
  await sendUiMessage(chatId, user, text, token, { reply_markup: markup });
}

// Строка «📋 Мой план покупки · 3/10» для «Моё».
function planMenuRow(user, language) {
  const progress = planProgress(user);
  const started = Boolean(planOf(user).startedAt);
  return [{ text: planCopy(language).menuButton + (started ? ' · ' + progress.done + '/' + progress.total : ''), callback_data: 'plan:open' }];
}

// Строка «Мой план» на странице гида.
function planGuideRow(language) {
  return [{ text: planCopy(language).menuButton, callback_data: 'plan:open' }];
}

async function handlePlanCallback(query, token) {
  const [, action, indexText] = String(query.data || '').split(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = planCopy(language);
  const list = steps();
  const index = Number(indexText);
  const validIndex = Number.isInteger(index) && index >= 0 && index < list.length;
  const now = new Date().toISOString();
  const plan = planOf(user);

  if (action === 'open') {
    await acknowledgeCallback(query, token);
    if (!plan.startedAt) {
      plan.startedAt = now;
      plan.updatedAt = now;
      savePlan(user, plan);
    }
    await showScreen(chatId, user, token, query, overviewText(user, language), overviewMarkup(user, language));
    return;
  }
  if (action === 'off') {
    plan.remindOptOut = true;
    savePlan(user, plan);
    await acknowledgeCallback(query, token);
    await sendMessage(chatId, copy.offDone, token);
    return;
  }
  if (!['step', 'done', 'undo', 'help'].includes(action) || !validIndex) {
    await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
    return;
  }
  const step = list[index];
  if (!plan.startedAt) plan.startedAt = now;

  if (action === 'done') {
    plan.done[step.id] = now;
    delete plan.help[step.id];
    plan.updatedAt = now;
    savePlan(user, plan);
    await acknowledgeCallback(query, token);
    // Отметил — сразу к следующему шагу, если он есть: план должен двигаться.
    const next = Math.min(index + 1, list.length - 1);
    if (index < list.length - 1) await showScreen(chatId, user, token, query, stepText(user, language, next), stepMarkup(user, language, next));
    else await showScreen(chatId, user, token, query, overviewText(user, language), overviewMarkup(user, language));
    return;
  }
  if (action === 'undo') {
    delete plan.done[step.id];
    plan.updatedAt = now;
    savePlan(user, plan);
    await acknowledgeCallback(query, token);
    await showScreen(chatId, user, token, query, stepText(user, language, index), stepMarkup(user, language, index));
    return;
  }
  if (action === 'help') {
    const previous = Date.parse(plan.help[step.id] || '');
    if (Number.isFinite(previous) && Date.now() - previous < HELP_REPEAT_MS) {
      await acknowledgeCallback(query, token, copy.helpAlready);
      return;
    }
    plan.help[step.id] = now;
    plan.updatedAt = now;
    savePlan(user, plan);
    await acknowledgeCallback(query, token);
    createInquiry(user, fill(copy.helpRequest, { n: index + 1, title: step.title[language] || step.title.ru }), { type: 'question' });
    await showScreen(chatId, user, token, query, stepText(user, language, index), stepMarkup(user, language, index));
    await sendMessage(chatId, withOffHoursNote(copy.helpSent, language, { user }), token);
    return;
  }
  await acknowledgeCallback(query, token);
  plan.updatedAt = plan.updatedAt || now;
  savePlan(user, plan);
  await showScreen(chatId, user, token, query, stepText(user, language, index), stepMarkup(user, language, index));
}

function daytime(now) {
  return now.getHours() >= SEND_FROM_HOUR && now.getHours() < SEND_TO_HOUR;
}

function elapsed(stamp, now) {
  const time = Date.parse(stamp || '');
  return Number.isFinite(time) ? now.getTime() - time : Infinity;
}

// Напомнить тому, кто начал план и замолчал: от 6 до 45 суток тишины в плане, не
// чаще раза в две недели, пока не закончил и не отказался.
function planReminderDue(user, now) {
  if (!user || !user.chatId || user.blocked || !user.preferredLanguage) return false;
  const plan = planOf(user);
  if (!plan.startedAt || plan.remindOptOut) return false;
  if (currentStepIndex(user) >= steps().length) return false;
  const silence = elapsed(plan.updatedAt || plan.startedAt, now);
  return silence >= REMIND_AFTER_MS && silence <= REMIND_UNTIL_MS && elapsed(plan.remindedAt, now) >= REMIND_EVERY_MS;
}

async function runPlanReminders(now = new Date(), token = data.config.botToken) {
  const enabled = data.config.engagement && data.config.engagement.planReminder;
  if (!enabled || !data.config.active || !token || !daytime(now)) return [];
  const sent = [];
  for (const user of Object.values(data.users)) {
    if (sent.length >= PER_RUN) break;
    if (!planReminderDue(user, now)) continue;
    const language = user.preferredLanguage || 'ru';
    const copy = planCopy(language);
    const index = currentStepIndex(user);
    const step = steps()[index];
    const plan = planOf(user);
    try {
      await sendMessage(user.chatId, fill(copy.reminder, { n: index + 1, title: step.title[language] || step.title.ru }), token, {
        reply_markup: { inline_keyboard: [[{ text: copy.open, callback_data: 'plan:open' }], [{ text: copy.off, callback_data: 'plan:off' }]] },
      });
      plan.remindedAt = now.toISOString();
      savePlan(user, plan);
      sent.push(String(user.id));
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(user);
      else if (!temporaryDeliveryError(error)) {
        plan.remindedAt = now.toISOString();
        savePlan(user, plan);
      }
      recordError('Напоминание о плане покупки', error);
    }
    await delay(60);
  }
  return sent;
}

export {
  DEFAULT_BUY_PLAN,
  PLAN_TEXT,
  currentStepIndex,
  handlePlanCallback,
  planGuideRow,
  planMenuRow,
  planProgress,
  planReminderDue,
  runPlanReminders,
  parsePlanHelp,
};
