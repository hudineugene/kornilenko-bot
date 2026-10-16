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
const WEEKDAY_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dayRu = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return WEEKDAY_RU[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ', ' + String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0') + '.' + y;
};

// Когда сам просмотр: подтверждённые менеджером дата и время, иначе — что выбрал клиент
function viewingWhen(item) {
  const v = item.type === 'viewing' && item.viewing;
  if (!v) return '';
  if (v.cancelledAt) return ' — просмотр отменён';
  const online = v.online ? ' (по видеосвязи)' : '';
  if (v.confirmedDate) return ' — просмотр подтверждён на ' + dayRu(v.confirmedDate) + (v.confirmedTime ? ' ' + v.confirmedTime : '') + online;
  const when = v.date ? dayRu(v.date) : v.dateText;
  if (!when && !v.timeText) return '';
  return ' — клиент выбрал ' + [when, v.timeText].filter(Boolean).join(', ') + online + ', менеджер ещё не подтвердил';
}

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
      // Дата обращения — когда клиент его оставил; у просмотра своя дата — её и называем клиенту
      return (INQUIRY_RU[item.type] || 'обращение') + (record ? ' по «' + recordLine(record).split(',')[0] + '»' : '') + viewingWhen(item) + ', оставлено ' + String(item.createdAt || '').slice(0, 10) + ' (' + (STATUS_RU[item.status] || item.status) + ')';
    }).join('; '));
  }
  if (user.phone || user.preferredContactTime) lines.push('Контакт: ' + [user.phone ? 'телефон уже оставлял' : '', user.preferredContactTime ? 'удобно связываться: ' + cleanText(user.preferredContactTime, 80) : ''].filter(Boolean).join(', '));
  return lines.length ? 'Что известно о клиенте из бота (используй, чтобы советовать по его интересам; не пересказывай это клиенту дословно):\n' + lines.join('\n') : '';
}

// { reply, handoff } или null, если агент ничего не ответил.
async function askAiAgent(user, text, { context = '', chatId = null, token = '', language = '', messageId = '', image = null, earlier = [], voiceReply = false } = {}) {
  const settings = aiAgentSettings();
  const question = cleanText(text, 4000);
  // Фото без подписи — тоже вопрос: GenAgent опишет, что на нём
  if (!settings || !user || (!question && !image)) return null;

  // «Печатает…», пока агент думает: Telegram гасит статус через 5 секунд.
  const typing = () => (chatId && token ? telegramRequest(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}) : null);
  void typing();
  const timer = setInterval(() => void typing(), TYPING_EVERY_MS);
  const fullContext = [cleanText(context, 1000), clientProfile(user), await slotsContext()].filter(Boolean).join('\n\n');
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
        // номер в журнале переписки (agent-journal.mjs) — чтобы GenAgent не записал это сообщение дважды
        ...(messageId ? { messageId } : {}),
        // фото клиента: GenAgent опишет его, консультант ответит с учётом того, что на нём
        ...(image ? { image } : {}),
        // работает ли офис сейчас — консультант назовёт честный срок, когда передаёт клиента менеджеру
        team: await teamNow(LANGUAGES.includes(language) ? language : clientLanguage(user)),
        // клиент написал несколько сообщений подряд: предыдущие (каждое со своим номером в журнале), ответ — один на все
        ...(earlier.length ? { earlier: earlier.slice(-10).map((item) => ({ text: cleanText(item.text, 4000), ...(item.messageId ? { messageId: item.messageId } : {}) })) } : {}),
        // клиент спросил голосовым — консультант ответит и голосовым (если включено в GenAgent)
        ...(voiceReply ? { voiceReply: true } : {}),
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
    // голосовой ответ (OGG/Opus, base64) — бот отправит его голосовым, текст — подписью
    const voice = body.voice && typeof body.voice.data === 'string' ? Buffer.from(body.voice.data, 'base64') : null;
    // upset — консультант передал недовольного клиента: заявка с пометкой «срочно»
    const result = { reply, handoff: body.handoff === true, upset: body.upset === true, summary, actions, lead: '', viewingId: '', shownIds: [], ...(voice && voice.length ? { voice } : {}) };
    // Объекты, которые консультант предлагает посмотреть ([[ACTION show: код или название]]) — бот покажет карточки.
    const shown = actions.filter((item) => item.type === 'show' && item.value).slice(0, 5);
    for (const item of shown) {
      const id = await viewingRecordId(item.value, user);
      if (id && !result.shownIds.includes(id)) result.shownIds.push(id);
      if (result.shownIds.length >= 3) break;
    }
    // Консультант зовёт на просмотр конкретного объекта — кнопка записи на него.
    // Клиент согласился на конкретное время просмотра ([[ACTION book: объект | YYYY-MM-DD HH:MM]]) —
    // кнопка «Записаться» на это время (или ближайшие свободные, если его уже заняли).
    const book = actions.find((item) => item.type === 'book' && item.value);
    if (book) result.booking = await bookingOffer(book.value, user);
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
    // Код объекта из базы знаний агента («Код объекта: …») — точное совпадение по коду или id.
    const { publishedCatalog: catalogOf } = await import('./catalog.mjs');
    const code = String(value).trim().toLowerCase();
    const byCode = catalogOf(user).find((record) => record.status === 'active' && [record.reference, record.id].some((item) => item && String(item).toLowerCase() === code));
    if (byCode) return byCode.id;
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
  const rows = [...bookingRows(ai, user)];
  if (!rows.length) rows.push(...(await viewingRow(ai, user)));
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

// Офис сейчас: открыт ли, когда откроется («завтра с 9:00») и за сколько обычно отвечаем (настройка «Часы работы»).
async function teamNow(language, now = new Date()) {
  const { isWorkingTime, nextOpening, openingPhrase, workingHours } = await import('./hours.mjs');
  const hours = workingHours();
  if (hours.enabled && !isWorkingTime(now, hours)) {
    const opening = nextOpening(now, hours);
    return { open: false, ...(opening ? { next: openingPhrase(opening, language, now) } : {}) };
  }
  const minutes = Math.round(Number(hours.replyMinutes) || 0);
  return { open: true, ...(minutes >= 1 && minutes <= 10080 ? { minutes } : {}) };
}

// Переход из чата на сайте («Продолжить в Telegram», /start w_<код>): GenAgent переносит переписку с сайта
// в разговор этого клиента в боте — консультант продолжает с того же места. true — перенесено.
async function linkFromSite(token, user) {
  const settings = aiAgentSettings();
  if (!settings || !token) return false;
  try {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const response = await fetch(settings.url + '/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({ token, user: { id: String(user.id), ...(name ? { name: cleanText(name, 200) } : {}), ...(user.username ? { username: user.username } : {}) } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return false;
    return Boolean((await response.json().catch(() => ({}))).linked);
  } catch {
    return false;
  }
}

const SITE_CONTINUED_TEXT = {
  ru: 'Продолжаем разговор с сайта 👋 Консультант видит всю переписку — пишите сюда.',
  uk: 'Продовжуємо розмову із сайту 👋 Консультант бачить усе листування — пишіть сюди.',
  en: 'Let’s continue the chat from the website 👋 The consultant sees the whole conversation — just write here.',
  es: 'Seguimos la conversación de la web 👋 El asesor ve todo el chat — escríbenos aquí.',
};

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

// ---------- запись на просмотр от консультанта ----------

// Свободное время просмотров (окна из настроек) — консультанту, чтобы он предлагал реальное время.
async function slotsContext() {
  try {
    const { availableSlotDays, slotsEnabled } = await import('./slots.mjs');
    if (!slotsEnabled()) return '';
    const days = availableSlotDays('ru').slice(0, 5);
    if (!days.length) return '';
    return 'Свободное время для просмотров объектов (дата YYYY-MM-DD — часы): ' + days.map((day) => day.key + ' (' + day.label + '): ' + day.times.join(', ')).join('; ')
      + '. Когда клиент выбрал объект и время из этого списка — предложи записать и добавь в конце строку [[ACTION book: <код объекта> | <YYYY-MM-DD> <HH:MM>]]: бот покажет кнопку записи на это время.';
  } catch {
    return '';
  }
}

// { recordId, title, day, time, free, alternatives: [{ day, time }] } или null, если объект не нашёлся.
async function bookingOffer(value, user) {
  const [objectPart, whenPart = ''] = String(value).split('|').map((part) => part.trim());
  const recordId = objectPart ? await viewingRecordId(objectPart, user) : '';
  if (!recordId) return null;
  const { availableSlotDays, slotFree, slotsEnabled } = await import('./slots.mjs');
  if (!slotsEnabled()) return null;
  const { publishedCatalog } = await import('./catalog.mjs');
  const record = publishedCatalog(user).find((item) => item.id === recordId);
  if (!record || record.status !== 'active') return null;
  const match = /(\d{4}-\d{2}-\d{2})\D+(\d{1,2}:\d{2})/.exec(whenPart);
  const day = match ? match[1] : '';
  const time = match ? match[2].padStart(5, '0') : '';
  const free = Boolean(day && time && slotFree(day, time));
  const alternatives = [];
  if (!free) {
    // Сначала выбранный клиентом день и следующие за ним, потом остальные ближайшие.
    const slotDays = availableSlotDays('ru');
    const ordered = day ? [...slotDays.filter((item) => item.key >= day), ...slotDays.filter((item) => item.key < day)] : slotDays;
    for (const slotDay of ordered) {
      for (const slotTime of slotDay.times) if (alternatives.length < 3) alternatives.push({ day: slotDay.key, time: slotTime });
      if (alternatives.length >= 3) break;
    }
  }
  const title = (record.title && (record.title[clientLanguage(user)] || record.title.ru || record.title.en)) || record.reference || record.id;
  return { recordId, title: cleanText(title, 40), day, time, free, alternatives };
}

const BOOK_TEXT = {
  ru: { book: '✅ Записаться', other: '📅 Свободно', at: 'в' },
  uk: { book: '✅ Записатися', other: '📅 Вільно', at: 'о' },
  en: { book: '✅ Book', other: '📅 Free', at: 'at' },
  es: { book: '✅ Reservar', other: '📅 Libre', at: 'a las' },
};

function slotLabel(day, time, language) {
  const date = new Date(day + 'T12:00:00');
  const locale = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-GB', es: 'es-ES' }[language] || 'ru-RU';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date) + ' ' + (BOOK_TEXT[language] || BOOK_TEXT.ru).at + ' ' + time;
}

// Кнопки записи под ответом консультанта: на выбранное время или на ближайшие свободные.
function bookingRows(ai, user) {
  const offer = ai && ai.booking;
  if (!offer) return [];
  const language = clientLanguage(user);
  const copy = BOOK_TEXT[language] || BOOK_TEXT.ru;
  const callback = (day, time) => 'aibk:' + offer.recordId + ':' + day + ':' + time.replace(':', '');
  if (offer.free) return [[{ text: copy.book + ': ' + offer.title + ', ' + slotLabel(offer.day, offer.time, language), callback_data: callback(offer.day, offer.time) }]];
  return offer.alternatives.map((slot) => [{ text: copy.other + ': ' + slotLabel(slot.day, slot.time, language), callback_data: callback(slot.day, slot.time) }]);
}

// Нажали «Записаться» под ответом консультанта: запись тем же путём, что в приложении (окна, подтверждение,
// заявка менеджеру). Нет телефона — открываем обычную запись на объект, где его спросят.
async function handleAiBookingCallback(query, token) {
  const match = /^aibk:([^:]+):(\d{4}-\d{2}-\d{2}):(\d{4})$/.exec(String(query.data || ''));
  const { acknowledgeCallback } = await import('./sections.mjs');
  const { userById } = await import('./users.mjs');
  const user = match && query.from && userById(String(query.from.id));
  if (!user) return acknowledgeCallback(query, token, 'Кнопка устарела — напишите, когда удобно');
  const [, recordId, day, hhmm] = match;
  const time = hhmm.slice(0, 2) + ':' + hhmm.slice(2);
  const language = clientLanguage(user);
  if (!user.phone) {
    await acknowledgeCallback(query, token, '');
    const row = await viewingRow({ viewingId: recordId }, user);
    const ask = { ru: 'Чтобы записать вас, менеджеру нужен телефон — оставьте его в записи на просмотр 👇', uk: 'Щоб записати вас, менеджеру потрібен телефон — залиште його в записі на перегляд 👇', en: 'To book you in, the manager needs your phone — leave it in the viewing form 👇', es: 'Para reservar, el gestor necesita su teléfono — déjelo en el formulario 👇' }[language];
    const { sendMessage } = await import('./telegram.mjs');
    await sendMessage(query.message ? query.message.chat.id : user.id, ask, token, { reply_markup: { inline_keyboard: row } });
    return undefined;
  }
  const { requestViewing, AppError } = await import('./miniapp/actions.mjs');
  try {
    await requestViewing(user, { propertyId: recordId, day, time, note: 'Записался через ИИ-консультанта' }, token, language);
    await acknowledgeCallback(query, token, '');
    if (query.message) await telegramRequest(token, 'editMessageReplyMarkup', { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  } catch (error) {
    const taken = error instanceof AppError && error.code === 'slot-taken';
    await acknowledgeCallback(query, token, taken ? { ru: 'Это время только что заняли — выберите другое', uk: 'Цей час щойно зайняли — оберіть інший', en: 'That time was just taken — pick another', es: 'Esa hora acaba de ocuparse — elija otra' }[language] : 'Не получилось записать — попробуйте ещё раз');
  }
  return undefined;
}

// Файл из Telegram в память (фото клиента для консультанта, превью для журнала). null — не вышло или больше maxBytes.
async function downloadTelegramFile(fileId, token, maxBytes = 4 * 1024 * 1024) {
  try {
    const file = await telegramRequest(token, 'getFile', { file_id: fileId });
    const filePath = cleanText(file && file.file_path, 512);
    if (!filePath || filePath.includes('..') || !/^[A-Za-z0-9_./-]+$/.test(filePath)) return null;
    const download = await fetch('https://api.telegram.org/file/bot' + token + '/' + filePath, { signal: AbortSignal.timeout(30000) });
    if (!download.ok) return null;
    const buffer = Buffer.from(await download.arrayBuffer());
    return buffer.length && buffer.length <= maxBytes ? buffer : null;
  } catch {
    return null;
  }
}

// Фото клиента → консультант: самое крупное до 1280 px, с подписью; номер — тот же, что в журнале переписки.
// null — фото не скачалось или консультант не ответил (тогда, как раньше, заявка менеджеру).
async function askAboutPhoto(user, message, token, context = 'Клиент прислал фото (например, участок, дом, документ или пример того, что ищет).') {
  const size = [...message.photo].reverse().find((p) => (p.width || 0) <= 1280 && (p.file_size || 0) <= 4 * 1024 * 1024) || message.photo[0];
  const buffer = await downloadTelegramFile(size.file_id, token);
  if (!buffer) return null;
  return askAiAgent(user, typeof message.caption === 'string' ? message.caption.trim() : '', {
    context,
    chatId: message.chat.id,
    token,
    messageId: 'in:' + message.message_id,
    image: { data: buffer.toString('base64'), mediaType: 'image/jpeg' },
  });
}

// Голосовое из мини-приложения (WAV, записан в браузере) → текст. { text, reason } или null (GenAgent недоступен).
async function transcribeWav(user, base64) {
  const settings = aiAgentSettings();
  if (!settings || !base64) return null;
  try {
    const response = await fetch(settings.url + '/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({ user: { id: String(user.id) }, audio: base64, format: 'wav', language: clientLanguage(user) }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error('GenAgent ответил ' + response.status);
    const result = await response.json();
    return { text: result.text ? cleanText(result.text, 2000) : null, reason: result.reason || (result.text ? '' : 'no_speech') };
  } catch (error) {
    console.warn('Голосовое из приложения не расшифровано:', error && error.message);
    return null;
  }
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

export { aiReplyMarkup, askAboutPhoto, askAiAgent, transcribeWav, clientProfile, downloadTelegramFile, handleAiBookingCallback, sendAiCards, transcribeVoice, aiAgentSettings, clientLanguage, handoffText, normalizeAiAgent, ratingMarkup, sendAgentEvent, teamNow, linkFromSite, SITE_CONTINUED_TEXT };
