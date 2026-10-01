// Как отправить администратору сообщение по настройкам уведомлений: отключено ли это, и со звуком ли.
// Отдельный маленький модуль: им пользуются и inquiries, и notices, и viewings, а тянуть друг друга по кругу им не надо.

import { data } from './store.mjs';
import { normalizeNotifyPrefs } from './data-format.mjs';
import { cleanText } from './util.mjs';
import { sendMessage } from './telegram.mjs';

function minutesOf(clock) {
  const [hours, minutes] = String(clock).split(':').map(Number);
  return hours * 60 + minutes;
}

// kind: inquiry | reminder | viewing | digest | system. { send: false } — владелец отключил этот вид; иначе
// options (в Telegram — disable_notification) добавляются к отправке. В тихие часы всё приходит без звука.
function adminSendPlan(kind, now = new Date()) {
  const prefs = normalizeNotifyPrefs(data.config && data.config.notifyPrefs);
  const choice = prefs.kinds[kind] || 'sound';
  if (choice === 'off') return { send: false, options: {} };
  const quiet = prefs.quiet;
  let silent = choice === 'silent';
  if (!silent && quiet.enabled) {
    const minute = now.getHours() * 60 + now.getMinutes();
    const from = minutesOf(quiet.from);
    const to = minutesOf(quiet.to);
    silent = from < to ? minute >= from && minute < to : minute >= from || minute < to;
  }
  return { send: true, options: silent ? { disable_notification: true } : {} };
}

// Сбой, о котором владелец должен узнать не из журнала в панели, а в Telegram: рассылка, отложенный пост, загрузка с сайта.
// Одно и то же — не чаще раза в час; сам отправка не должна ничего ломать, поэтому ошибки глотаем.
const PROBLEM_REPEAT_MS = 60 * 60 * 1000;
const problemsSentAt = new Map();

async function tellAdminProblem(key, text, now = Date.now()) {
  const chatId = cleanText(data.config && data.config.adminChatId, 40);
  if (!chatId || !data.config.botToken) return false;
  if (now - (problemsSentAt.get(key) || 0) < PROBLEM_REPEAT_MS) return false;
  const plan = adminSendPlan('system');
  if (!plan.send) return false;
  problemsSentAt.set(key, now);
  try {
    await sendMessage(chatId, text, data.config.botToken, { track: false, ...plan.options });
    return true;
  } catch {
    return false;
  }
}

function forgetProblems() {
  problemsSentAt.clear();
}

export { adminSendPlan, forgetProblems, tellAdminProblem };
