// Настройки Mini App: включено ли оно и по какому публичному адресу открывается. Лежат в config.miniApp и читаются «лениво»,
// поэтому старые файлы данных менять не нужно.

import { data } from '../store.mjs';

// Адрес — только https и обычное имя сайта: Telegram не открывает приложение по http и по голому IP-адресу.
function normalizeMiniAppUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 300) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
  const host = parsed.hostname;
  if (!host.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host === 'localhost') return '';
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
}

function miniAppSettings() {
  const raw = data.config && data.config.miniApp && typeof data.config.miniApp === 'object' ? data.config.miniApp : {};
  const url = normalizeMiniAppUrl(raw.url);
  const enabled = raw.enabled === true && Boolean(url);
  // «Только приложение»: бот перенаправляет клиентов в приложение. Имеет смысл, лишь когда приложение включено.
  return { enabled, url, appOnly: enabled && raw.appOnly === true };
}

export { miniAppSettings, normalizeMiniAppUrl };
