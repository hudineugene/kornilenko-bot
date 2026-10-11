// Режим «только приложение»: клиенту, который пишет боту или нажимает старые кнопки, коротко объясняют, что всё теперь в
// приложении, и дают кнопку его открытия. Сообщения менеджеру не теряются: текст клиента попадает в заявку, как раньше.
// Администратор и менеджеры работают с ботом как прежде.

import { cleanText } from '../util.mjs';
import { scheduleSave } from '../store.mjs';
import { sendMessage } from '../telegram.mjs';
import { telegramInterfaceLanguage } from '../users.mjs';
import { createInquiry } from '../inquiries.mjs';
import { propertyIdFromStartPayload } from '../catalog.mjs';
import { withOffHoursNote } from '../hours.mjs';
import { miniAppSettings } from './settings.mjs';

// Кнопки, которые бот сам присылает клиенту (напоминание о просмотре, отписка, согласия, подборки) и которые должны работать.
const KEPT_CALLBACKS = ['subs:', 'privacy:', 'vfb:', 'vcal:', 'myreq:', 'vf:', 'digest:', 'alerts:', 'saved:'];
const NUDGE_PAUSE_MS = 12 * 60 * 60 * 1000;
const BUTTON = { ru: '🏡 Открыть каталог', en: '🏡 Open the catalog', es: '🏡 Abrir el catálogo' };
const TEXT = {
  ru: {
    hello: 'Здравствуйте{name}! 👋\n\nКаталог проектов, запись на просмотр, расчёт стоимости и связь с менеджером теперь собраны в нашем приложении.\n\nНажмите кнопку «{button}» внизу экрана.',
    property: 'Этот проект открывается в нашем приложении: там фото, характеристики, расчёт стоимости и запись на просмотр.\n\nНажмите кнопку «{button}» внизу экрана.',
    received: 'Спасибо, сообщение передано менеджеру: он ответит вам в этом чате.\n\nПроекты, запись на просмотр и расчёт стоимости удобнее смотреть в приложении: кнопка «{button}» внизу экрана.',
  },
  en: {
    hello: 'Hello{name}! 👋\n\nThe project catalogue, viewing requests, cost calculator and contact with a manager are now all in our app.\n\nTap the “{button}” button at the bottom of the screen.',
    property: 'This project opens in our app: photos, details, cost calculator and viewing requests.\n\nTap the “{button}” button at the bottom of the screen.',
    received: 'Thank you, your message has been passed to a manager: they will reply to you in this chat.\n\nProjects, viewings and the cost calculator are easier in the app: tap “{button}” at the bottom of the screen.',
  },
  es: {
    hello: '¡Hola{name}! 👋\n\nEl catálogo de proyectos, las visitas, el cálculo del coste y el contacto con un asesor están ahora en nuestra aplicación.\n\nPulsa el botón «{button}» en la parte inferior de la pantalla.',
    property: 'Este proyecto se abre en nuestra aplicación: fotos, características, cálculo del coste y solicitud de visita.\n\nPulsa el botón «{button}» en la parte inferior de la pantalla.',
    received: 'Gracias, tu mensaje se ha pasado a un asesor: te responderá en este chat.\n\nLos proyectos, las visitas y el cálculo del coste son más cómodos en la aplicación: pulsa «{button}» en la parte inferior.',
  },
};

function appOnlyActive() {
  const settings = miniAppSettings();
  return settings.enabled && settings.appOnly;
}

function appOnlyCallbackAllowed(callbackData) {
  const value = String(callbackData || '');
  return KEPT_CALLBACKS.some((prefix) => value.startsWith(prefix));
}

function nudgeLanguage(user) {
  return ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : telegramInterfaceLanguage(user);
}

async function sendAppNudge(chatId, user, token, { kind = 'hello', propertyId = '' } = {}) {
  const settings = miniAppSettings();
  if (!settings.enabled) return;
  const language = nudgeLanguage(user);
  const copy = TEXT[language] || TEXT.ru;
  const name = cleanText(user.firstName, 40);
  let text = copy[kind].replace('{button}', BUTTON[language]).replace('{name}', kind === 'hello' && name ? ', ' + name : '');
  if (kind === 'received') text = withOffHoursNote(text, language, { user });
  const url = settings.url + (propertyId ? '?p=' + encodeURIComponent(propertyId) : '');
  await sendMessage(chatId, text, token, {
    reply_markup: { keyboard: [[{ text: BUTTON[language], web_app: { url } }]], resize_keyboard: true, is_persistent: true },
  });
  user.appNudgeAt = new Date().toISOString();
  scheduleSave();
}

// Сообщение клиента в режиме «только приложение». Команды и кнопки меню получают подсказку; обычный текст и вложения
// становятся заявкой для менеджера (как раньше), а подсказка повторяется не чаще раза в 12 часов, чтобы не мешать диалогу.
async function handleAppOnlyMessage({ user, message, text, command, commandArgument, summary }, token) {
  user.pendingAction = null;
  user.pendingStartPayload = '';
  const isCommand = command.startsWith('/');
  if (!isCommand) {
    createInquiry(user, text || summary, { type: 'general', sourceMessage: message });
    const last = Date.parse(user.appNudgeAt || '') || 0;
    if (Date.now() - last < NUDGE_PAUSE_MS) return;
    await sendAppNudge(message.chat.id, user, token, { kind: 'received' });
    return;
  }
  const propertyId = command === '/start' ? propertyIdFromStartPayload(commandArgument) : '';
  await sendAppNudge(message.chat.id, user, token, { kind: propertyId ? 'property' : 'hello', propertyId });
}

export { appOnlyActive, appOnlyCallbackAllowed, handleAppOnlyMessage, sendAppNudge };
