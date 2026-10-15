// Связь с «Диалогами» GenAgent, когда клиента ведёт менеджер.
// • Бот забирает из GenAgent (/outbox) то, что менеджер сделал там: ответ клиенту (dm) — отправляет своим именем
//   и записывает в заявку; «Вернуть агенту» (resume) — ИИ-консультант снова отвечает клиенту.
// • Бот сообщает в GenAgent (/log), что происходило без агента: что клиент написал менеджеру и что менеджер ответил
//   в самом боте, — чтобы в «Диалогах» была вся переписка.

import { cleanText } from './util.mjs';
import { data, scheduleSave } from './store.mjs';
import { aiAgentSettings } from './ai-agent.mjs';
import { sendMessage } from './telegram.mjs';
import { userById } from './users.mjs';

const POLL_EVERY_MS = 10000;
const TIMEOUT_MS = 20000;
const state = { timer: null, busy: false, lastError: '' };

const headers = (settings) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key });

// Событие в GenAgent: role — user (клиент написал менеджеру), operator (менеджер ответил в боте), returned (вернули ИИ).
async function logToAgent(user, role, text = '') {
  const settings = aiAgentSettings();
  if (!settings || !user || !user.id) return false;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  try {
    const response = await fetch(settings.url + '/log', {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({
        user: { id: String(user.id), ...(name ? { name } : {}), ...(user.username ? { username: user.username } : {}) },
        role,
        text: cleanText(text, 4000),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ack(settings, body) {
  await fetch(settings.url + '/outbox', { method: 'POST', headers: headers(settings), body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
}

// Последняя заявка клиента (открытая — в приоритете): в неё пишем ответ менеджера из GenAgent.
function latestInquiryOf(userId) {
  const own = data.inquiries.filter((item) => String(item.userId) === String(userId));
  return own.find((item) => item.status !== 'closed') || own[0] || null;
}

// Напоминание от консультанта клиенту, который поговорил и не дошёл до заявки или просмотра. Не пишем тем,
// кто заблокировал бота, с кем уже говорит менеджер или у кого открыто обращение.
async function sendFollowUp(user, text) {
  if (!text) return { error: 'пустое напоминание' };
  if (user.blocked) return { error: 'клиент заблокировал бота' };
  const { managerInConversation, openInquiryOf } = await import('./inquiries.mjs');
  if (managerInConversation(user) || openInquiryOf(user)) return { error: 'уже есть открытое обращение' };
  try {
    const { ratingMarkup } = await import('./ai-agent.mjs');
    const sent = await sendMessage(user.id, cleanText(text, 1000), undefined, { reply_markup: ratingMarkup() });
    return { messageId: sent && sent.message_id ? sent.message_id : undefined, done: true };
  } catch (error) {
    return { error: cleanText(error.description || error.message || 'не отправлено', 300) };
  }
}

async function pollAgentOutbox() {
  const settings = aiAgentSettings();
  if (!settings || state.busy) return;
  state.busy = true;
  try {
    const response = await fetch(settings.url + '/outbox?kinds=dm,resume,followup', { headers: headers(settings), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error('ответ ' + response.status);
    const { items = [] } = await response.json();
    if (!items.length) return;
    const { appendInquiryMessage, createInquiry, inquiryTimelineMessage } = await import('./inquiries.mjs');
    for (const item of items) {
      const user = userById(item.userId);
      if (!user) {
        await ack(settings, { id: item.id, error: 'клиент не найден в боте' });
        continue;
      }
      if (item.kind === 'resume') {
        const inquiry = latestInquiryOf(user.id);
        if (inquiry) inquiry.aiResumedAt = new Date().toISOString();
        scheduleSave();
        await ack(settings, { id: item.id, done: true });
        continue;
      }
      if (item.kind === 'followup') {
        await ack(settings, { id: item.id, ...(await sendFollowUp(user, item.text)) });
        continue;
      }
      if (item.kind !== 'dm' || !item.text) {
        await ack(settings, { id: item.id, done: true });
        continue;
      }
      let sent = null;
      try {
        sent = await sendMessage(user.id, cleanText(item.text, 4000));
      } catch (error) {
        await ack(settings, { id: item.id, error: cleanText(error.description || error.message || 'не отправлено', 300) });
        continue;
      }
      // Ответ менеджера — в ленту заявки (разговор у менеджера: ИИ молчит, пока его не вернут).
      let inquiry = latestInquiryOf(user.id);
      if (!inquiry) {
        // Служебная запись: заявку заводим, чтобы было куда записать ответ менеджера; клиент этого не писал.
        createInquiry(user, '⚙️ Служебная запись: менеджер написал клиенту из GenAgent (клиент этого не писал)', { type: 'general', system: true });
        inquiry = latestInquiryOf(user.id);
      }
      if (inquiry) {
        const createdAt = new Date().toISOString();
        appendInquiryMessage(inquiry, inquiryTimelineMessage(null, 'out', {
          text: item.text, source: 'genagent', by: 'менеджер (GenAgent)', kind: 'text', createdAt,
          telegramMessageId: sent && sent.message_id,
        }));
        if (inquiry.status !== 'in_progress') inquiry.status = 'in_progress';
        inquiry.updatedAt = createdAt;
        scheduleSave();
      }
      await ack(settings, { id: item.id, messageId: sent && sent.message_id ? sent.message_id : undefined, done: true });
    }
    state.lastError = '';
  } catch (error) {
    if (state.lastError !== error.message) console.error('GenAgent (ответы менеджера):', error.message);
    state.lastError = error.message;
  } finally {
    state.busy = false;
  }
}

function startAgentOutbox() {
  if (state.timer) return;
  state.timer = setInterval(() => void pollAgentOutbox(), POLL_EVERY_MS);
  if (state.timer.unref) state.timer.unref();
}

function stopAgentOutbox() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export { logToAgent, pollAgentOutbox, startAgentOutbox, stopAgentOutbox };
