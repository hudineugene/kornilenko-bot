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

const APP_CONTEXT = 'Клиент пишет из приложения (Mini App): в нём каталог проектов с фото, расчёт стоимости, запись на просмотр, заказ звонка и избранное. Советуй эти разделы приложения. Здесь клиент может не только писать, но и прислать фото (кнопка 📷 у поля ввода — участок, дом, документ, пример) или голосовое (кнопка 🎤): ты увидишь описание фото или текст голосового и ответишь. Не говори, что фото или голосовые отправить нельзя.';

// Фото из приложения: JPEG, уменьшенный на телефоне (до ~1280 px), и превью для «Диалогов»
const MAX_IMAGE_BASE64 = 4 * 1024 * 1024;
const MAX_THUMB_BASE64 = 400 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+=*$/;

function mediaOf(body) {
  const image = body.image && typeof body.image.data === 'string' && body.image.data.length <= MAX_IMAGE_BASE64 && BASE64.test(body.image.data) ? body.image : null;
  const thumb = image && typeof image.thumb === 'string' && image.thumb.length <= MAX_THUMB_BASE64 && BASE64.test(image.thumb) ? image.thumb : '';
  const voice = typeof body.voice === 'string' && body.voice.length <= MAX_IMAGE_BASE64 + 1024 * 1024 && BASE64.test(body.voice) ? body.voice : '';
  return { image: image ? image.data : '', thumb, voice };
}

async function askAssistant(user, body, token, language) {
  const media = mediaOf(body);
  let text = cleanText(body.text, 1000);
  let heard = '';
  // Голосовое: GenAgent расшифровывает его на своём сервере, дальше — как вопрос текстом
  if (media.voice) {
    const { transcribeWav } = await import('../ai-agent.mjs');
    const result = await transcribeWav(user, media.voice);
    if (!result) throw new AppError('Не получилось обработать голосовое — попробуйте ещё раз или напишите текстом', 503, 'voice-failed');
    if (!result.text) throw new AppError(result.reason === 'too_long' ? 'Голосовое длиннее 2 минут — запишите короче' : 'Не разобрал слов — попробуйте ещё раз или напишите текстом', 422, 'voice-unclear');
    heard = result.text;
    text = cleanText(result.text, 1000);
  }
  if (!media.image && text.length < 2) throw new AppError('Напишите вопрос', 400, 'question-short');
  const record = body.propertyId ? findRecord(cleanText(body.propertyId, 100), language) : null;
  const inquiryText = record ? propertyRequestText(record, 'ru', 'question') + '\n\n' + text : text;
  const inquiryContext = record ? { type: 'question', propertyId: record.id } : { type: 'general' };

  const journal = media.image ? { kind: 'photo', thumb: media.thumb } : media.voice ? { kind: 'voice' } : {};
  // Вопрос менеджеру (если консультант не отвечает): фото без подписи — пометкой, само фото видно в «Диалогах» GenAgent
  const forManager = text || (media.image ? '📷 Клиент прислал фото из приложения' : text);
  if (managerInConversation(user)) {
    recordApp(user, 'in', text, journal);
    // Менеджер уже на связи — вопрос ему, ответ придёт в чат с ботом.
    await askQuestion(user, { propertyId: record ? record.id : '', text: forManager }, token, language);
    return { reply: null, forwarded: true };
  }

  const context = APP_CONTEXT + (record ? ' Сейчас клиент открыл карточку объекта: ' + (localized(record.title, 'ru') || '') + ' (' + (record.reference || record.id) + ').' : '');
  // Журнал переписки: вопрос из приложения — с тем же номером, что получит консультант; ответ консультанта тоже
  const messageId = recordApp(user, 'in', text, journal);
  const ai = await askAiAgent(user, text, {
    context: media.image ? context + ' Клиент прислал фото из приложения.' : context,
    language,
    messageId,
    ...(media.image ? { image: { data: media.image, mediaType: 'image/jpeg' } } : {}),
  });
  if (ai && ai.reply) recordApp(user, 'out', ai.reply, { by: 'agent' });
  if (!ai) {
    await askQuestion(user, { propertyId: record ? record.id : '', text: forManager }, token, language);
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
  return { reply: ai.reply, handoff: ai.handoff, viewingId: ai.viewingId || '', suggest, objects, ...(heard ? { heard } : {}) };
}

export { askAssistant };
