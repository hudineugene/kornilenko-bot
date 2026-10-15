// ИИ-консультант в приложении: тот же агент и тот же разговор, что в чате бота (GenAgent узнаёт клиента по id Telegram).
// Правила те же: менеджер уже ведёт разговор — вопрос уходит ему заявкой; консультант передал клиента или обращение
// уже открыто — сообщение попадает в заявку; консультант недоступен — обычный вопрос менеджеру, как раньше.

import { cleanText } from '../util.mjs';
import { recordApp } from '../agent-journal.mjs';
import { saveDataNow } from '../store.mjs';
import { createInquiry, managerInConversation, openInquiryOf, recordBotAnswer } from '../inquiries.mjs';
import { recordPropertyEvent } from '../analytics.mjs';
import { localized } from '../catalog.mjs';
import { propertyRequestText } from '../sections.mjs';
import { askAiAgent, handoffText } from '../ai-agent.mjs';
import { AppError, askQuestion } from './actions.mjs';
import { findRecord } from './data.mjs';

const APP_CONTEXT = 'Клиент пишет из приложения (Mini App): в нём каталог проектов с фото, расчёт стоимости, запись на просмотр, заказ звонка и избранное. Советуй эти разделы приложения.';

async function askAssistant(user, body, token, language) {
  const text = cleanText(body.text, 1000);
  if (text.length < 2) throw new AppError('Напишите вопрос', 400, 'question-short');
  const record = body.propertyId ? findRecord(cleanText(body.propertyId, 100), language) : null;
  const inquiryText = record ? propertyRequestText(record, 'ru', 'question') + '\n\n' + text : text;
  const inquiryContext = record ? { type: 'question', propertyId: record.id } : { type: 'general' };

  if (managerInConversation(user)) {
    recordApp(user, 'in', text);
    // Менеджер уже на связи — вопрос ему, ответ придёт в чат с ботом.
    await askQuestion(user, { propertyId: record ? record.id : '', text }, token, language);
    return { reply: null, forwarded: true };
  }

  const context = APP_CONTEXT + (record ? ' Сейчас клиент открыл карточку объекта: ' + (localized(record.title, 'ru') || '') + ' (' + (record.reference || record.id) + ').' : '');
  // Журнал переписки: вопрос из приложения — с тем же номером, что получит консультант; ответ консультанта тоже
  const messageId = recordApp(user, 'in', text);
  const ai = await askAiAgent(user, text, { context, language, messageId });
  if (ai && ai.reply) recordApp(user, 'out', ai.reply, { by: 'agent' });
  if (!ai) {
    await askQuestion(user, { propertyId: record ? record.id : '', text }, token, language);
    return { reply: null, forwarded: true };
  }
  if (record) recordPropertyEvent(record.id, 'questions');
  if (ai.handoff || openInquiryOf(user)) {
    const body = ai.handoff ? handoffText(ai, text) : text;
    createInquiry(user, record ? propertyRequestText(record, 'ru', 'question') + '\n\n' + body : body, inquiryContext);
  }
  recordBotAnswer(user, ai.reply);
  saveDataNow();
  // viewingId — консультант зовёт на просмотр этого объекта: приложение покажет кнопку записи.
  const suggest = (ai.actions || []).filter((item) => item.type === 'suggest').map((item) => cleanText(item.value, 60)).filter((value) => value.length >= 3).slice(0, 3);
  // Объекты, которые предложил консультант — приложение покажет кнопки, открывающие их карточки.
  const objects = (ai.shownIds || []).map((id) => findRecord(id, language)).filter((record) => record && record.status === 'active')
    .map((record) => ({ id: record.id, title: cleanText(localized(record.title, language) || record.reference || record.id, 60) }));
  return { reply: ai.reply, handoff: ai.handoff, viewingId: ai.viewingId || '', suggest, objects };
}

export { askAssistant };
