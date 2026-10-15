// ИИ-консультант (GenAgent). На вопрос, написанный текстом, бот сначала спрашивает агента:
// тот отвечает по базе знаний застройщика на языке клиента в боте. Менеджер получает заявку,
// только когда агент сам решил передать клиента (просмотр, бронь, торг, просьба позвать человека).
// Если агент выключен, не настроен или не ответил — бот поступает как раньше: заявка менеджеру
// и обычный ответ «сообщение получено». Пока у клиента открыт разговор с менеджером, агент молчит.

import { cleanText } from './util.mjs';
import { data } from './store.mjs';
import { normalizeAiAgent } from './data-format.mjs';
import { LANGUAGES } from './languages.mjs';
import { telegramInterfaceLanguage } from './users.mjs';
import { telegramRequest } from './telegram.mjs';

// Агент думает несколько секунд; дольше минуты клиента не держим — дальше обычный путь.
const ANSWER_TIMEOUT_MS = 60000;
const TYPING_EVERY_MS = 4500;
// Настройки, с которыми можно спрашивать агента, или null.
function aiAgentSettings() {
  const settings = normalizeAiAgent(data.config && data.config.aiAgent);
  return settings.enabled && settings.url && settings.key ? settings : null;
}

// Язык ответа — тот, на котором клиент пользуется ботом; если он его не выбирал — как в Telegram.
function clientLanguage(user) {
  return LANGUAGES.includes(user && user.preferredLanguage) ? user.preferredLanguage : telegramInterfaceLanguage(user);
}

const TYPE_RU = { apartment: 'апартаменты', villa: 'вилла', house: 'дом', townhouse: 'таунхаус', penthouse: 'пентхаус', duplex: 'дуплекс', studio: 'студия', land: 'участок' };
const INQUIRY_RU = { question: 'вопрос', interest: 'интерес к объекту', selection: 'подбор', viewing: 'запись на просмотр', lead: 'просьба связаться', general: 'обращение' };
const STATUS_RU = { new: 'ждёт ответа', in_progress: 'в работе', closed: 'закрыто' };

// Объект для профиля: «Riviera 1 (Финестрат), от 147 312 €».
function recordLine(record) {
  const title = (record.title && (record.title.ru || record.title.en)) || record.reference || record.id;
  const city = record.city && (record.city.ru || record.city.en);
  const price = record.priceValue ? (record.priceFrom ? 'от ' : '') + Math.round(record.priceValue).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ' + (record.currency === 'EUR' || !record.currency ? '€' : record.currency) : '';
  return [title + (city ? ' (' + city + ')' : ''), price, record.status === 'reserved' ? 'в резерве' : record.status === 'sold' ? 'продан' : ''].filter(Boolean).join(', ');
}

// Что бот знает о клиенте — консультант советует по интересам, а не с нуля. Без телефона и личных данных.
function clientProfile(user) {
  if (!user) return '';
  const byId = new Map((data.objects || []).map((record) => [String(record.id), record]));
  const lines = [];
  const favorites = (user.favorites || []).map((id) => byId.get(String(id))).filter(Boolean).slice(0, 5);
  if (favorites.length) lines.push('В избранном: ' + favorites.map(recordLine).join('; '));
  const favoriteIds = new Set(favorites.map((record) => String(record.id)));
  const viewed = (user.recentlyViewed || []).filter((id) => !favoriteIds.has(String(id))).map((id) => byId.get(String(id))).filter(Boolean).slice(0, 5);
  if (viewed.length) lines.push('Недавно смотрел: ' + viewed.map(recordLine).join('; '));
  const filter = user.catalogFilter || {};
  const wanted = [
    filter.deal === 'rent' ? 'аренда' : filter.deal === 'sale' ? 'покупка' : '',
    TYPE_RU[filter.type] || '',
    filter.bedrooms ? filter.bedrooms + '+ спальни' : '',
    [filter.city, filter.district].filter(Boolean).join(', '),
    filter.minPrice || filter.maxPrice ? 'бюджет ' + [filter.minPrice ? 'от ' + filter.minPrice.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') : '', filter.maxPrice ? 'до ' + filter.maxPrice.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') : ''].filter(Boolean).join(' ') + ' €' : '',
  ].filter(Boolean);
  if (wanted.length) lines.push('Искал в каталоге: ' + wanted.join(', '));
  const inquiries = (data.inquiries || []).filter((item) => String(item.userId) === String(user.id) && !item.system).slice(0, 3);
  if (inquiries.length) {
    lines.push('Обращения: ' + inquiries.map((item) => {
      const record = item.propertyId && byId.get(String(item.propertyId));
      return (INQUIRY_RU[item.type] || 'обращение') + (record ? ' по «' + recordLine(record).split(',')[0] + '»' : '') + ' ' + String(item.createdAt || '').slice(0, 10) + ' (' + (STATUS_RU[item.status] || item.status) + ')';
    }).join('; '));
  }
  if (user.phone || user.preferredContactTime) lines.push('Контакт: ' + [user.phone ? 'телефон уже оставлял' : '', user.preferredContactTime ? 'удобно связываться: ' + cleanText(user.preferredContactTime, 80) : ''].filter(Boolean).join(', '));
  return lines.length ? 'Что известно о клиенте из бота (используй, чтобы советовать по его интересам; не пересказывай это клиенту дословно):\n' + lines.join('\n') : '';
}

// { reply, handoff } или null, если агент ничего не ответил.
async function askAiAgent(user, text, { context = '', chatId = null, token = '', language = '' } = {}) {
  const settings = aiAgentSettings();
  const question = cleanText(text, 4000);
  if (!settings || !user || !question) return null;

  // «Печатает…», пока агент думает: Telegram гасит статус через 5 секунд.
  const typing = () => (chatId && token ? telegramRequest(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}) : null);
  void typing();
  const timer = setInterval(() => void typing(), TYPING_EVERY_MS);
  const fullContext = [cleanText(context, 1000), clientProfile(user)].filter(Boolean).join('\n\n');
  try {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({
        user: { id: String(user.id), ...(name ? { name } : {}), ...(user.username ? { username: user.username } : {}) },
        text: question,
        language: LANGUAGES.includes(language) ? language : clientLanguage(user),
        ...(fullContext ? { context: cleanText(fullContext, 2000) } : {}),
      }),
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('ИИ-консультант ответил ошибкой:', response.status);
      return null;
    }
    const body = await response.json().catch(() => ({}));
    const reply = typeof body.reply === 'string' ? cleanText(body.reply, 4000) : '';
    // Выжимка для менеджера — приходит, когда агент передаёт клиента.
    const summary = typeof body.summary === 'string' ? cleanText(body.summary, 1000) : '';
    if (!reply) return null;
    const actions = Array.isArray(body.actions) ? body.actions.filter((item) => item && typeof item.type === 'string') : [];
    // upset — консультант передал недовольного клиента: заявка с пометкой «срочно»
    const result = { reply, handoff: body.handoff === true, upset: body.upset === true, summary, actions, lead: '', viewingId: '', shownIds: [] };
    // Объекты, которые консультант предлагает посмотреть ([[ACTION show: код или название]]) — бот покажет карточки.
    const shown = actions.filter((item) => item.type === 'show' && item.value).slice(0, 5);
    for (const item of shown) {
      const id = await viewingRecordId(item.value, user);
      if (id && !result.shownIds.includes(id)) result.shownIds.push(id);
      if (result.shownIds.length >= 3) break;
    }
    // Консультант зовёт на просмотр конкретного объекта — кнопка записи на него.
    const viewing = actions.find((item) => item.type === 'viewing' && item.value);
    if (viewing) result.viewingId = await viewingRecordId(viewing.value, user);
    // Передаёт менеджеру — квалификация лида из разговора: бюджет, цель, спальни, район, сроки, связь.
    if (result.handoff) result.lead = await leadFromConversation(settings, user);
    return result;
  } catch (error) {
    console.error('ИИ-консультант не ответил:', error.message);
    return null;
  } finally {
    clearInterval(timer);
  }
}

const LEAD_FIELDS = [
  { key: 'budget', label: 'Бюджет', description: 'Бюджет клиента на покупку (сумма и валюта), как он сказал' },
  { key: 'goal', label: 'Цель', description: 'Зачем покупает', options: ['жить', 'сдавать в аренду', 'инвестиция', 'отдых'] },
  { key: 'bedrooms', label: 'Спальни', description: 'Сколько спален нужно' },
  { key: 'location', label: 'Где', description: 'Город, район или проект, который интересует' },
  { key: 'timeline', label: 'Сроки', description: 'Когда планирует покупку или просмотр' },
  { key: 'payment', label: 'Оплата', description: 'Как планирует платить: свои средства, ипотека, рассрочка' },
  { key: 'contact', label: 'Связь', description: 'Как и когда удобно связаться (телефон, WhatsApp, время)' },
];

// Квалификация лида для менеджера (GenAgent /extract, дешёвая модель): только то, что клиент сказал сам.
async function leadFromConversation(settings, user) {
  try {
    const response = await fetch(settings.url + '/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({ user: { id: String(user.id) }, fields: LEAD_FIELDS.map(({ key, description, options }) => ({ key, description, ...(options ? { options } : {}) })) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return '';
    const { values = {} } = await response.json();
    const lines = LEAD_FIELDS.filter((field) => values[field.key]).map((field) => '• ' + field.label + ': ' + cleanText(values[field.key], 200));
    return lines.join('\n');
  } catch {
    return '';
  }
}

// Объект, на просмотр которого зовёт консультант (по коду или названию из метки [[ACTION viewing: …]]).
async function viewingRecordId(value, user) {
  try {
    const { catalogRequest } = await import('./search.mjs');
    const found = catalogRequest(String(value), user);
    if (found && found.record && found.record.status === 'active') return found.record.id;
    // Консультант чаще называет проект по названию («Sierra Verde»), а не по коду — ищем по названию.
    const { publishedCatalog } = await import('./catalog.mjs');
    const wanted = String(value).toLowerCase().replace(/[«»"']/g, '').trim();
    if (wanted.length < 3) return '';
    const titles = (record) => Object.values(record.title || {}).filter(Boolean).map((title) => String(title).toLowerCase().replace(/[«»"']/g, '').trim());
    const match = publishedCatalog(user).find((record) => record.status === 'active' && titles(record).some((title) => title.length >= 3 && (title.includes(wanted) || wanted.includes(title))));
    return match ? match.id : '';
  } catch {
    return '';
  }
}

// Кнопка «📅 Записаться на просмотр» под ответом консультанта: в режиме «только приложение» — карточка объекта
// в приложении (там свободные даты), иначе — запись прямо в боте.
async function viewingRow(ai, user) {
  if (!ai || !ai.viewingId) return [];
  const label = { ru: '📅 Записаться на просмотр', uk: '📅 Записатися на перегляд', en: '📅 Book a viewing', es: '📅 Reservar una visita' }[clientLanguage(user)] || '📅 Записаться на просмотр';
  const { appOnlyActive } = await import('./miniapp/app-only.mjs');
  if (appOnlyActive()) {
    const { miniAppSettings } = await import('./miniapp/settings.mjs');
    const url = miniAppSettings().url;
    if (url) return [[{ text: label, web_app: { url: url + '?p=' + encodeURIComponent(ai.viewingId) } }]];
  }
  return [[{ text: label, callback_data: 'property:viewing:' + ai.viewingId }]];
}

// Кнопки под ответом консультанта: запись на просмотр (если звал) и оценка 👍/👎.
// Кнопки под ответом консультанта: запись на просмотр (если звал), каталог ([[ACTION button: catalog]]),
// подсказки следующего вопроса ([[ACTION suggest: …]] — нажатие = клиент написал этот вопрос) и оценка 👍/👎.
async function aiReplyMarkup(ai, user) {
  const rows = [...(await viewingRow(ai, user))];
  const actions = (ai && ai.actions) || [];
  if (!rows.length && actions.some((item) => item.type === 'button' && String(item.value).trim().toLowerCase() === 'catalog')) {
    const label = { ru: '🏡 Открыть каталог', uk: '🏡 Відкрити каталог', en: '🏡 Open the catalog', es: '🏡 Abrir el catálogo' }[clientLanguage(user)] || '🏡 Открыть каталог';
    const { appOnlyActive } = await import('./miniapp/app-only.mjs');
    const { miniAppSettings } = await import('./miniapp/settings.mjs');
    const url = miniAppSettings().url;
    if (appOnlyActive() && url) rows.push([{ text: label, web_app: { url } }]);
    else rows.push([{ text: label, callback_data: 'catalog:all:0' }]);
  }
  const suggest = actions.filter((item) => item.type === 'suggest').map((item) => cleanText(item.value, 60)).filter((text) => text.length >= 3).slice(0, 3);
  if (user) user.aiSuggest = suggest;
  suggest.forEach((text, index) => rows.push([{ text: '💬 ' + text, callback_data: 'sq:' + index }]));
  return { inline_keyboard: [...rows, ...ratingMarkup().inline_keyboard] };
}

// Событие воронки в GenAgent (заявка, просмотр, сделка) или оценка ответа (rating_up / rating_down). Тихо, без ожидания.
function sendAgentEvent(userId, type, label = '', value = undefined) {
  const settings = aiAgentSettings();
  if (!settings || !userId) return;
  const body = { user: { id: String(userId) }, type, ...(label ? { label } : {}), ...(Number(value) > 0 ? { value: Number(value) } : {}) };
  fetch(settings.url + '/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }).catch(() => {});
}

// Кнопки оценки под ответом консультанта в чате бота.
function ratingMarkup() {
  return { inline_keyboard: [[{ text: '👍', callback_data: 'air:up' }, { text: '👎', callback_data: 'air:down' }]] };
}

// Текст заявки менеджеру при передаче: сначала выжимка консультанта (что клиент ищет и чего ждёт), потом сообщение клиента.
// Недовольный клиент (консультант поставил пометку) — первой строкой, чтобы менеджер ответил в первую очередь.
function handoffText(ai, text) {
  const urgent = ai && ai.upset ? '🔴 Клиент недоволен — ответить в первую очередь\n\n' : '';
  const base = urgent + (ai && ai.summary ? '🤖 Консультант: ' + ai.summary + '\n\n💬 Клиент: ' + text : text);
  return ai && ai.lead ? base + '\n\n🎯 Что известно о клиенте:\n' + ai.lead : base;
}

// Карточки объектов, которые предложил консультант: фото, короткое описание и кнопка. В режиме «только приложение» —
// «Подробнее и запись» открывает объект в приложении, иначе — обычные кнопки карточки каталога.
const CARD_BUTTON = { ru: '🏡 Подробнее и запись на просмотр', uk: '🏡 Детальніше й запис на перегляд', en: '🏡 Details and viewing', es: '🏡 Detalles y visita' };
async function sendAiCards(chatId, user, token, ai) {
  const ids = (ai && ai.shownIds) || [];
  if (!ids.length) return 0;
  const catalog = await import('./catalog.mjs');
  const { appOnlyActive } = await import('./miniapp/app-only.mjs');
  const { miniAppSettings } = await import('./miniapp/settings.mjs');
  const { sendPhotoMessage, sendMessage } = await import('./telegram.mjs');
  const { recordPropertyEvent } = await import('./analytics.mjs');
  const language = clientLanguage(user);
  const byId = new Map(catalog.publishedCatalog(user).map((record) => [String(record.id), record]));
  const appUrl = appOnlyActive() ? miniAppSettings().url : '';
  let sent = 0;
  for (const id of ids) {
    const record = byId.get(String(id));
    if (!record || record.status !== 'active') continue;
    const caption = catalog.objectCaptionHtml(record, language, { maximum: 600 });
    const markup = appUrl
      ? { inline_keyboard: [[{ text: CARD_BUTTON[language] || CARD_BUTTON.ru, web_app: { url: appUrl + '?p=' + encodeURIComponent(record.id) } }]] }
      : catalog.contentButtons(record, language, user, 'property', null);
    try {
      const images = catalog.recordImages(record, language);
      if (images.length) await sendPhotoMessage(chatId, images[0], caption, token, markup, { parseMode: 'HTML' });
      else await sendMessage(chatId, caption, token, { reply_markup: markup, parse_mode: 'HTML' });
      recordPropertyEvent(record.id, 'impressions');
      sent += 1;
    } catch (error) {
      console.warn('Карточка объекта от консультанта не отправлена:', error.message);
    }
  }
  return sent;
}

// Голосовое клиента → текст. Расшифровывает GenAgent на своём сервере (без оплаты за минуты).
// { text, reason } или null, если консультант выключен, файл не скачался или GenAgent не ответил.
const VOICE_MAX_SECONDS = 120;
async function transcribeVoice(voice, user, token) {
  const settings = aiAgentSettings();
  if (!settings || !voice || !voice.file_id) return null;
  if ((voice.duration || 0) > VOICE_MAX_SECONDS) return { text: null, reason: 'too_long' };
  try {
    const file = await telegramRequest(token, 'getFile', { file_id: voice.file_id });
    const filePath = cleanText(file && file.file_path, 512);
    if (!filePath || filePath.includes('..') || !/^[A-Za-z0-9_./-]+$/.test(filePath)) throw new Error('Telegram не вернул путь к файлу');
    const download = await fetch('https://api.telegram.org/file/bot' + token + '/' + filePath, { signal: AbortSignal.timeout(30000) });
    if (!download.ok) throw new Error('Telegram не отдал файл');
    const audio = Buffer.from(await download.arrayBuffer());
    if (audio.length > 3 * 1024 * 1024) return { text: null, reason: 'too_long' };
    const response = await fetch(settings.url + '/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({ user: { id: String(user.id) }, audio: audio.toString('base64'), format: 'ogg', language: clientLanguage(user) }),
      // первое голосовое после паузы ждёт загрузки модели (~30 с)
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error('GenAgent ответил ' + response.status);
    const result = await response.json();
    return { text: result.text ? cleanText(result.text, 2000) : null, reason: result.reason || (result.text ? '' : 'no_speech') };
  } catch (error) {
    console.warn('Голосовое не расшифровано:', error && error.name === 'TimeoutError' ? 'нет ответа за 90 с' : error && error.message);
    return null;
  }
}

export { aiReplyMarkup, askAiAgent, clientProfile, sendAiCards, transcribeVoice, aiAgentSettings, clientLanguage, handoffText, normalizeAiAgent, ratingMarkup, sendAgentEvent };
