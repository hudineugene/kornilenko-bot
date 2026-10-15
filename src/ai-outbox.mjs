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
async function logToAgent(user, role, text = '', messageId = '') {
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
        ...(messageId ? { messageId } : {}),
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
    const { asAuthor } = await import('./agent-journal.mjs');
    const sent = await asAuthor('agent', () => sendMessage(user.id, cleanText(text, 1000), undefined, { reply_markup: ratingMarkup() }));
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
        const { asAuthor } = await import('./agent-journal.mjs');
        sent = await asAuthor('manager', () => sendMessage(user.id, cleanText(item.text, 4000)));
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

// --- Агент сопровождает заявку ---------------------------------------------------
// Раз в минуту сверяем статусы заявок с тем, что уже знает GenAgent, и шлём изменения (POST /order):
// агент видит ленту заявки и точно отвечает «когда мой просмотр», «что с моей заявкой».
// Статус меняется во многих местах (кнопки, панель, просмотры, ответы менеджера) — сверка ловит все.
const ORDERS_EVERY_MS = 60000;
const ORDERS_PER_RUN = 10;
const ORDERS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const INQUIRY_KIND = { viewing: 'Просмотр', question: 'Вопрос менеджеру', interest: 'Интерес к объекту', selection: 'Подбор объектов', lead: 'Заявка на звонок', general: 'Заявка' };
const INQUIRY_STATE = { new: 'получена, ждёт ответа менеджера', in_progress: 'в работе у менеджера', closed: 'закрыта' };

function agentInquiry(inquiry, viewingWhen) {
  const property = inquiry.propertyId ? (data.objects || []).find((item) => item.id === inquiry.propertyId) : null;
  const name = property ? cleanText((property.title && (property.title.ru || property.title.en || Object.values(property.title)[0])) || property.reference || '', 80) : '';
  const title = [INQUIRY_KIND[inquiry.type] || 'Заявка', name].filter(Boolean).join(': ');
  let status = inquiry.status || 'new';
  let label = INQUIRY_STATE[status] || status;
  let facts = '';
  if (inquiry.type === 'viewing' && inquiry.viewing) {
    const when = viewingWhen(inquiry, 'ru');
    const at = [when.date, when.time].filter(Boolean).join(', ');
    if (inquiry.viewing.cancelledAt) [status, label] = ['viewing_cancelled', 'просмотр отменён'];
    else if (inquiry.viewing.confirmedAt) [status, label] = ['viewing_confirmed', 'просмотр подтверждён'];
    else if (status !== 'closed') [status, label] = ['viewing_requested', 'запись на просмотр, ждёт подтверждения менеджера'];
    if (at) facts = (inquiry.viewing.online ? 'Онлайн-показ: ' : 'Когда: ') + at;
  }
  return { id: String(inquiry.id).slice(0, 8), title: title.slice(0, 120), status, label, ...(facts ? { facts: facts.slice(0, 600) } : {}) };
}

async function reportAgentOrders() {
  const settings = aiAgentSettings();
  if (!settings || state.ordersBusy) return;
  state.ordersBusy = true;
  try {
    const { viewingWhen } = await import('./viewings.mjs');
    const since = Date.now() - ORDERS_WINDOW_MS;
    let sent = 0;
    for (const inquiry of data.inquiries || []) {
      if (sent >= ORDERS_PER_RUN) break;
      if (inquiry.system || !inquiry.userId || Date.parse(inquiry.updatedAt || inquiry.createdAt || 0) < since) continue;
      const order = agentInquiry(inquiry, viewingWhen);
      const sig = [order.status, order.label, order.facts || ''].join('|');
      if (inquiry.agentSig === sig) continue;
      const user = userById(inquiry.userId);
      const response = await fetch(settings.url + '/order', {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ user: { id: String(inquiry.userId), ...(user && user.firstName ? { name: cleanText([user.firstName, user.lastName].filter(Boolean).join(' '), 200) } : {}) }, order }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('ответ ' + response.status);
      inquiry.agentSig = sig;
      sent += 1;
    }
    if (sent) scheduleSave();
  } catch (error) {
    state.lastError = error.message;
  } finally {
    state.ordersBusy = false;
  }
}

function startAgentOutbox() {
  if (state.timer) return;
  state.timer = setInterval(() => void pollAgentOutbox(), POLL_EVERY_MS);
  if (state.timer.unref) state.timer.unref();
  state.ordersTimer = setInterval(() => void reportAgentOrders(), ORDERS_EVERY_MS);
  if (state.ordersTimer.unref) state.ordersTimer.unref();
}

function stopAgentOutbox() {
  if (state.timer) clearInterval(state.timer);
  if (state.ordersTimer) clearInterval(state.ordersTimer);
  state.timer = null;
  state.ordersTimer = null;
}

export { agentInquiry, logToAgent, pollAgentOutbox, reportAgentOrders, startAgentOutbox, stopAgentOutbox };
