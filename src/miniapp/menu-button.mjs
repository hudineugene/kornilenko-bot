// Кнопка приложения рядом с полем ввода в Telegram. Общая кнопка ставится всем чатам сразу, а когда клиент выбрал язык, ему
// ставится своя — с подписью на его языке. Пока приложение выключено, у клиентов обычная кнопка команд.

import { telegramRequest } from '../telegram.mjs';
import { data, scheduleSave } from '../store.mjs';
import { miniAppSettings } from './settings.mjs';

const BUTTON_TEXT = { ru: '🏡 Каталог', uk: '🏡 Каталог', en: '🏡 Catalog', es: '🏡 Catálogo' };

async function configureMiniAppButton(token) {
  if (!token) return;
  const settings = miniAppSettings();
  const menuButton = settings.enabled
    ? { type: 'web_app', text: BUTTON_TEXT.ru, web_app: { url: settings.url } }
    : { type: 'default' };
  await telegramRequest(token, 'setChatMenuButton', { menu_button: menuButton });
}

// Клиенту — кнопка на его языке. Повторно не отправляем, пока язык и адрес те же.
async function refreshChatMenuButton(user, token) {
  const settings = miniAppSettings();
  if (!settings.enabled || !token || !user || !user.chatId) return;
  const language = BUTTON_TEXT[user.preferredLanguage] ? user.preferredLanguage : 'ru';
  const key = language + '|' + settings.url;
  if (user.menuButtonKey === key) return;
  try {
    await telegramRequest(token, 'setChatMenuButton', {
      chat_id: user.chatId,
      menu_button: { type: 'web_app', text: BUTTON_TEXT[language], web_app: { url: settings.url } },
    });
    user.menuButtonKey = key;
    scheduleSave();
  } catch {
    // Кнопка — приятное дополнение: ошибка (клиент заблокировал бота) не должна мешать приветствию.
  }
}

// Выключили приложение или сменили адрес: персональные кнопки перекрывают общую, поэтому снимаем их у всех, у кого они стоят.
// По одной и не быстрее Telegram: в чате без кнопки клиент ничего не теряет, она встанет заново при следующем /start.
async function resetChatMenuButtons(token) {
  if (!token) return;
  const users = Object.values(data.users || {}).filter((user) => user && user.menuButtonKey && user.chatId);
  for (const user of users) {
    try {
      await telegramRequest(token, 'setChatMenuButton', { chat_id: user.chatId, menu_button: { type: 'default' } });
    } catch {
      // Чат недоступен (клиент заблокировал бота): кнопки там и не видно.
    }
    user.menuButtonKey = '';
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  scheduleSave();
}

export { BUTTON_TEXT, configureMiniAppButton, refreshChatMenuButton, resetChatMenuButtons };
