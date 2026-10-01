// «Старт с целью»: на первом запуске клиента спрашивают, что ему ближе — купить для
// жизни, инвестиция и аренда или пока просто смотрит. Ответ подстраивает подсказки
// (что нажать дальше) и даёт менеджеру сегмент: в уведомлении о клиенте стоит его
// цель, в отчёте — как распределились ответы. Спрашиваем один раз; изменить цель
// можно в «Моё → Моя цель». Если «Пока смотрю» выбирает большинство — сегментация
// почти не помогает, и отчёт об этом говорит.

import { scheduleSave } from './store.mjs';
import { normalizeUser } from './users.mjs';
import { sendMessage, telegramRequest } from './telegram.mjs';
import { notifyAdministratorAction } from './inquiries.mjs';
import { acknowledgeCallback } from './sections.mjs';
import { INTERACTION_TEXT } from './texts.mjs';

const GOALS = ['live', 'invest', 'browse'];

const GOAL_TEXT = {
  ru: {
    ask: '🎯 Что вам ближе?\nТак я подскажу, с чего начать.',
    live: '🏡 Купить для жизни',
    invest: '📈 Инвестиция и аренда',
    browse: '🧭 Пока смотрю',
    menuButton: '🎯 Моя цель',
    change: 'Сменить цель можно в любой момент: «Моё → Моя цель».',
    selection: '✨ Подобрать объект',
    guide: '📖 Как купить',
    catalog: '🏘 Смотреть объекты',
    costs: '🧾 Расходы и налоги',
    rent: '🔑 Про аренду',
    alerts: '🔔 Сообщать о новых',
    reply: {
      live: '🎯 Цель выбрана\nОтлично — подберём вариант для жизни. С чего начнём?',
      invest: '🎯 Цель выбрана\nПонятно, смотрим на доходность. Расходы при покупке можно посчитать на карточке объекта («Расчёт покупки»). Начнём с объектов или с расходов и налогов?',
      browse: '🎯 Цель выбрана\nХорошо, без спешки. Посмотрите объекты, а если хотите — буду сообщать о новых: для этого коротко задайте, что вам интересно.',
    },
    labels: { live: 'купить для жизни', invest: 'инвестиция и аренда', browse: 'пока смотрит' },
  },
  en: {
    ask: '🎯 What suits you best?\nIt helps me suggest where to start.',
    live: '🏡 Buy to live',
    invest: '📈 Investment and rental',
    browse: '🧭 Just browsing',
    menuButton: '🎯 My goal',
    change: 'You can change it any time: “My account → My goal”.',
    selection: '✨ Find a property',
    guide: '📖 How to buy',
    catalog: '🏘 Browse properties',
    costs: '🧾 Costs and taxes',
    rent: '🔑 About renting out',
    alerts: '🔔 Tell me about new ones',
    reply: {
      live: '🎯 Goal set\nGreat — let’s find a place to live. Where shall we start?',
      invest: '🎯 Goal set\nUnderstood, we’ll look at returns. You can work out the purchase costs on a property card (“Purchase estimate”). Start with properties or with costs and taxes?',
      browse: '🎯 Goal set\nFine, no rush. Have a look at the properties, and if you like I will tell you about new ones: just tell me briefly what you are interested in.',
    },
    labels: { live: 'buying to live', invest: 'investment and rental', browse: 'just browsing' },
  },
  es: {
    ask: '🎯 ¿Qué te interesa más?\nAsí te sugiero por dónde empezar.',
    live: '🏡 Comprar para vivir',
    invest: '📈 Inversión y alquiler',
    browse: '🧭 Solo estoy mirando',
    menuButton: '🎯 Mi objetivo',
    change: 'Puedes cambiarlo cuando quieras: «Mi espacio → Mi objetivo».',
    selection: '✨ Buscar un inmueble',
    guide: '📖 Cómo comprar',
    catalog: '🏘 Ver inmuebles',
    costs: '🧾 Gastos e impuestos',
    rent: '🔑 Sobre el alquiler',
    alerts: '🔔 Avisarme de novedades',
    reply: {
      live: '🎯 Objetivo elegido\nGenial: busquemos un lugar para vivir. ¿Por dónde empezamos?',
      invest: '🎯 Objetivo elegido\nEntendido, veremos la rentabilidad. Puedes calcular los gastos de compra en la ficha del inmueble («Cálculo de compra»). ¿Empezamos por los inmuebles o por gastos e impuestos?',
      browse: '🎯 Objetivo elegido\nDe acuerdo, sin prisa. Echa un vistazo a los inmuebles y, si quieres, te aviso de las novedades: solo cuéntame brevemente qué te interesa.',
    },
    labels: { live: 'comprar para vivir', invest: 'inversión y alquiler', browse: 'solo mirando' },
  },
};

// Страницы гида: 2 — «расходы», 4 — «аренда» (порядок задан в DEFAULT_GUIDE_PAGES).
const GUIDE_COSTS_PAGE = 2;
const GUIDE_RENT_PAGE = 4;

function goalCopy(language) {
  return GOAL_TEXT[language] || GOAL_TEXT.ru;
}

// Название цели по-русски — для менеджера: он читает уведомления на русском.
function goalLabelRu(goal) {
  return GOAL_TEXT.ru.labels[goal] || '';
}

function questionMarkup(language, current = '') {
  const copy = goalCopy(language);
  return { inline_keyboard: GOALS.map((goal) => [{ text: (goal === current ? '✓ ' : '') + copy[goal], callback_data: 'goal:' + goal }]) };
}

function answerMarkup(goal, language) {
  const copy = goalCopy(language);
  const rows = goal === 'live'
    ? [[{ text: copy.selection, callback_data: 'selection:start' }], [{ text: copy.guide, callback_data: 'guide:page:0' }], [{ text: copy.catalog, callback_data: 'catalog:all:0' }]]
    : goal === 'invest'
      ? [[{ text: copy.catalog, callback_data: 'catalog:all:0' }], [{ text: copy.costs, callback_data: 'guide:page:' + GUIDE_COSTS_PAGE }], [{ text: copy.rent, callback_data: 'guide:page:' + GUIDE_RENT_PAGE }]]
      // «Пока смотрю» → «Сообщать о новых»: без сохранённого поиска сообщать нечего, поэтому кнопка ведёт в подбор,
      // в конце которого «🔔 Сообщать о новых» сохраняет поиск. Раньше она отвечала «уведомления снова включены» —
      // они и не выключались.
      : [[{ text: copy.catalog, callback_data: 'catalog:all:0' }], [{ text: copy.alerts, callback_data: 'selection:start' }]];
  return { inline_keyboard: rows };
}

// Один раз, на первом запуске: спросить цель. Уже спрашивали или ответили — молчим.
async function askGoal(chatId, user, token) {
  if (!user || user.goal || user.goalAskedAt) return false;
  user.goalAskedAt = new Date().toISOString();
  scheduleSave();
  const language = user.preferredLanguage || 'ru';
  await sendMessage(chatId, goalCopy(language).ask, token, { reply_markup: questionMarkup(language) });
  return true;
}

// Строка «🎯 Моя цель» в «Моё».
function goalMenuRow(language) {
  return [{ text: goalCopy(language).menuButton, callback_data: 'goal:menu' }];
}

async function handleGoalCallback(query, token) {
  const action = String(query.data || '').split(':')[1] || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const copy = goalCopy(language);

  if (action === 'menu') {
    await acknowledgeCallback(query, token);
    await sendMessage(chatId, copy.ask, token, { reply_markup: questionMarkup(language, user.goal) });
    return;
  }
  if (!GOALS.includes(action)) {
    await acknowledgeCallback(query, token, (INTERACTION_TEXT[language] || INTERACTION_TEXT.ru).stale);
    return;
  }
  const changed = user.goal !== action;
  user.goal = action;
  user.goalAt = new Date().toISOString();
  user.goalAskedAt = user.goalAskedAt || user.goalAt;
  scheduleSave();
  await acknowledgeCallback(query, token);
  if (changed) void notifyAdministratorAction(user, 'Выбрал цель', goalLabelRu(action));
  const text = copy.reply[action] + '\n\n' + copy.change;
  const markup = answerMarkup(action, language);
  // Ответ заменяет вопрос в том же сообщении; не получилось — новым сообщением.
  if (query.message && query.message.message_id) {
    try {
      await telegramRequest(token, 'editMessageText', { chat_id: chatId, message_id: query.message.message_id, text, reply_markup: markup });
      return;
    } catch {
      // Сообщение уже не изменить.
    }
  }
  await sendMessage(chatId, text, token, { reply_markup: markup });
}

export { GOALS, GOAL_TEXT, askGoal, goalCopy, goalLabelRu, goalMenuRow, handleGoalCallback };
