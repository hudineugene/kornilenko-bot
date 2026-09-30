// API панели: клиенты, обращения, переписка и шаблоны ответов.

import { markMessageNotificationsRead } from './admin-notifications.mjs';
import crypto from 'node:crypto';
import { cleanText, localDayKey } from './util.mjs';
import { CLIENT_NOTE_LIMIT, CLOCK_TIME_PATTERN, DAY_KEY_PATTERN, MAX_REPLY_TEMPLATES, PIPELINE_STAGES, normalizeViewing } from './data-format.mjs';
import { MANAGER_CONTACT_TEXT } from './texts.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { eraseUserData, markUnavailable, normalizeUser, userByChatId, userById, userDataExport } from './users.mjs';
import { sendDocumentMessage, sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { menuKeyboard } from './menus.mjs';
import { appendInquiryMessage, awaitingReply, inquiryChats, inquiryTimelineMessage, trimInquiries } from './inquiries.mjs';
import { validHttpUrl } from './catalog.mjs';
import { userUnavailableError } from './broadcasts.mjs';
import { json, panelUserView, parseUploadedDocument, parseUploadedImage, readJson, requireAuth, securityHeaders } from './admin-http.mjs';
import { replyTemplateInput } from './admin-input.mjs';
import { CLIENT_EXPORT_COLUMNS, INQUIRY_EXPORT_COLUMNS, clientExportRows, inquiryExportRows, xlsxWorkbook } from './excel.mjs';
import { confirmViewing } from './viewings.mjs';
import { sendInquiryToAdministrator, weeklyReportData, weeklyReportText } from './notices.mjs';

// Сколько бесед вернуть в ответ на поиск: больше в списке всё равно не читают,
// а перебор пяти тысяч переписок не должен занимать заметное время.
const CONVERSATION_SEARCH_LIMIT = 200;

// Последние слияния карточек — для «Вернуть» (только в памяти).
const recentMerges = new Map();

// Каждая ветка сама отвечает клиенту и возвращает управление. Если не подошла
// ни одна, функция возвращает false — тогда запрос ищут в других модулях.

// Вложение прислал клиент, а открывается оно на адресе панели: страница
// text/html или SVG могла бы показать поддельную форму входа. Поэтому встроенно
// отдаём только картинки, аудио и видео, остальное — скачиванием, и в любом
// случае запрещаем такой странице что-либо делать (sandbox).
const INLINE_SAFE_TYPES = /^(?:image\/(?:jpeg|jpg|png|gif|webp|bmp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i;

function attachmentDelivery(mimeType) {
  const type = cleanText(mimeType, 100).toLowerCase();
  if (INLINE_SAFE_TYPES.test(type)) return { type, disposition: 'inline' };
  return { type: 'application/octet-stream', disposition: 'attachment' };
}

// «Закрытые и отвеченные» — это закрытые плюс те, где ответ отправлен, клиент
// ничего не ждёт и обращение не взято в работу. Раньше сюда попадало всё, что
// не «новое», то есть и дела в работе, и переписка, где ждут ответа: нажатие
// «Очистить» стирало живую работу.
function cleanupMatches(inquiry, scope) {
  if (scope === 'all') return true;
  if (inquiry.status === 'closed') return true;
  if (scope === 'closed') return false;
  const replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
  return inquiry.status !== 'in_progress' && !awaitingReply(inquiry) && replies.length > 0;
}

async function handleClientsApi(req, res, url) {
  const directMessageMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/message$/);
  if (directMessageMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = userById(decodeURIComponent(directMessageMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    if (!user.chatId || user.blocked) return json(res, 400, { error: 'Пользователь сейчас недоступен для сообщений' });
    try {
      const body = await readJson(req);
      const text = cleanText(body.text, 4000);
      // Тот же идентификатор отправки, что и у ответа в переписке: повторный
      // запрос (двойное нажатие, «отправить ещё раз» после обрыва) не шлёт
      // клиенту второе сообщение.
      const requestedId = cleanText(body.clientRequestId, 100);
      if (requestedId && !/^[A-Za-z0-9._:-]{8,100}$/.test(requestedId)) return json(res, 400, { error: 'Некорректный идентификатор отправки' });
      const clientRequestId = requestedId || crypto.randomUUID();
      const alreadySent = data.inquiries.find((item) => String(item.userId) === String(user.id)
        && (Array.isArray(item.replies) ? item.replies : []).some((reply) => reply.clientRequestId === clientRequestId));
      if (alreadySent) return json(res, 200, { ok: true, duplicate: true, inquiryId: alreadySent.id });
      const buttonText = cleanText(body.buttonText, 80);
      const buttonUrl = cleanText(body.buttonUrl, 500);
      if (!text && !body.imageDataUrl) return json(res, 400, { error: 'Введите сообщение или добавьте изображение' });
      if (buttonUrl && !validHttpUrl(buttonUrl)) return json(res, 400, { error: 'Ссылка кнопки должна начинаться с http:// или https://' });
      if ((buttonText && !buttonUrl) || (buttonUrl && !buttonText)) return json(res, 400, { error: 'Для кнопки нужны и название, и ссылка' });
      const image = body.imageDataUrl ? parseUploadedImage(body.imageDataUrl, body.imageName || 'message.jpg') : null;
      const markup = buttonText && buttonUrl ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] } : null;
      const language = user.preferredLanguage || 'ru';
      const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
      const outgoingText = text ? header + '\n\n' + text : header;
      const delivered = [];
      if (image && outgoingText.length <= 1000) {
        const message = await sendPhotoMessage(user.chatId, image, outgoingText, data.config.botToken, markup);
        delivered.push({ message, kind: 'photo', text: text || 'Изображение' });
      }
      else if (image) {
        const photoMessage = await sendPhotoMessage(user.chatId, image, '', data.config.botToken, null);
        delivered.push({ message: photoMessage, kind: 'photo', text: 'Изображение' });
        const textMessage = await sendMessage(user.chatId, outgoingText, data.config.botToken, markup ? { reply_markup: markup } : {});
        delivered.push({ message: textMessage, kind: 'text', text });
      } else {
        const message = await sendMessage(user.chatId, outgoingText, data.config.botToken, markup ? { reply_markup: markup } : {});
        delivered.push({ message, kind: 'text', text });
      }
      const now = new Date().toISOString();
      let inquiry = data.inquiries.find((item) => String(item.userId) === String(user.id) && item.status !== 'closed');
      if (!inquiry) {
        inquiry = {
          id: crypto.randomUUID(), userId: String(user.id), chatId: String(user.chatId), language,
          text: text || 'Исходящее сообщение менеджера', type: 'general', propertyId: '', sourceMessageId: null,
          lead: null, selection: null, matching: null, viewing: null, status: 'in_progress', pipelineStage: 'contact',
          note: '', replies: [], messages: [], readAt: now, remindedAt: '', followUpDate: '', followUpTime: '',
          followUpNotifiedAt: '', assignee: cleanText(data.config.adminName, 60) || 'Администратор',
          createdAt: now, updatedAt: now, clientMessageAt: '',
        };
        data.inquiries.unshift(inquiry);
        // Через общую защиту: она сначала убирает закрытые обращения и
        // предупреждает владельца, если пришлось тронуть живые. Прежний
        // slice(0, 5000) просто отрезал хвост — вместе с открытыми делами и
        // молча.
        trimInquiries();
      }
      const replyText = [text, buttonText ? '🔗 ' + buttonText : ''].filter(Boolean).join('\n') || 'Изображение';
      const lastMessage = delivered[delivered.length - 1] && delivered[delivered.length - 1].message;
      inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
      inquiry.replies.push({
        id: crypto.randomUUID(), text: replyText, source: 'panel', by: cleanText(data.config.adminName, 60) || 'Администратор',
        createdAt: now, deliveredAt: now, telegramMessageId: lastMessage && lastMessage.message_id ? Number(lastMessage.message_id) : null,
        clientRequestId,
      });
      inquiry.replies = inquiry.replies.slice(-50);
      for (const delivery of delivered) {
        appendInquiryMessage(inquiry, inquiryTimelineMessage(delivery.message, 'out', {
          kind: delivery.kind, text: delivery.text, source: 'panel', by: cleanText(data.config.adminName, 60) || 'Администратор', createdAt: now,
          telegramMessageId: delivery.message && delivery.message.message_id,
        }));
      }
      inquiry.status = 'in_progress';
      inquiry.readAt = now;
      inquiry.updatedAt = now;
      saveDataNow();
      return json(res, 200, { ok: true, inquiryId: inquiry.id });
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(user);
      recordError('Личное сообщение пользователю', error);
      return json(res, 400, { error: 'Не удалось отправить сообщение: ' + error.message });
    }
  }

  const userExportMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/export$/);
  if (userExportMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = userById(decodeURIComponent(userExportMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    const payload = JSON.stringify(userDataExport(user), null, 2);
    securityHeaders(res);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="user-' + String(user.id).replace(/[^0-9A-Za-z_-]/g, '') + '.json"',
    });
    return res.end(payload);
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  // Полная карточка одного клиента: панель просит её, когда нашла человека, которого
  // нет среди 500 последних в общем состоянии.
  if (userMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const user = userById(decodeURIComponent(userMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    return json(res, 200, { user: panelUserView(user) });
  }
  if (userMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = userById(decodeURIComponent(userMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    const result = eraseUserData(user);
    saveDataNow();
    return json(res, 200, { ok: true, ...result });
  }
  if (userMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = userById(decodeURIComponent(userMatch[1]));
    if (!user) return json(res, 404, { error: 'Пользователь не найден' });
    const body = await readJson(req);
    if (body.note != null) user.note = cleanText(body.note, CLIENT_NOTE_LIMIT);
    if (Array.isArray(body.tags)) user.tags = body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20);
    if (body.contactName != null) user.contactName = cleanText(body.contactName, 120);
    if (body.phone != null) user.phone = cleanText(body.phone, 80);
    if (body.preferredContactTime != null) user.preferredContactTime = cleanText(body.preferredContactTime, 160);
    if (['ru', 'en', 'es', ''].includes(body.preferredLanguage)) user.preferredLanguage = body.preferredLanguage;
    if (typeof body.blocked === 'boolean') {
      // Галочка «не писать этому клиенту» — решение администратора: входящее
      // сообщение клиента её не снимает, в отличие от отказа Telegram.
      user.blocked = body.blocked;
      user.blockedBy = body.blocked ? 'admin' : '';
    }
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/inquiries/export' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    // The panel sends the ids it currently shows, so the file matches the
    // filters and search on screen. Without ids everything is exported.
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 10000) : null;
    const byId = new Map(data.inquiries.map((item) => [item.id, item]));
    let inquiries = ids ? ids.map((id) => byId.get(id)).filter(Boolean) : data.inquiries;
    // Период: заявки, созданные с одного дня по другой включительно (по часам бота). Даты важнее списка на экране.
    const from = cleanText(body.from, 10);
    const to = cleanText(body.to, 10);
    if (from || to) {
      if ((from && !DAY_KEY_PATTERN.test(from)) || (to && !DAY_KEY_PATTERN.test(to)) || (from && to && from > to)) return json(res, 400, { error: 'Период указан неверно: начало не может быть позже конца' });
      inquiries = data.inquiries.filter((item) => {
        const day = localDayKey(new Date(item.createdAt));
        return (!from || day >= from) && (!to || day <= to);
      });
    }
    const file = xlsxWorkbook('Обращения', INQUIRY_EXPORT_COLUMNS, inquiryExportRows(inquiries));
    const name = 'Обращения ' + localDayKey() + '.xlsx';
    securityHeaders(res);
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-length': file.length,
      'content-disposition': 'attachment; filename="inquiries-' + localDayKey() + '.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(name),
    });
    return res.end(file);
  }

  // Неделя одной страницей: те же цифры, что бот присылает по понедельникам.
  if (url.pathname === '/api/weekly-report' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const report = weeklyReportData(new Date(), url.searchParams.get('week') === 'current' ? 'current' : 'last');
    return json(res, 200, { report, text: weeklyReportText(report) }), true;
  }

  // Клиенты одним файлом: панель присылает номера тех, кого показывает (с учётом
  // выбранного этапа и поиска); без номеров выгружаются все.
  // Клиент, позвонивший по телефону или написавший в WhatsApp, заводится руками — без бота и без чата в
  // Telegram: имя, телефон, язык, источник и заметка. Ему нельзя писать из панели (нет чата), но он есть в
  // базе, ему можно поставить шаг и назначить просмотр.
  if (url.pathname === '/api/users' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const name = cleanText(body.name, 120);
    if (!name) return json(res, 400, { error: 'Укажите имя клиента' });
    const phone = cleanText(body.phone, 80);
    if (phone && !/^[+()\d\s.-]{5,}$/.test(phone)) return json(res, 400, { error: 'Телефон: цифры, пробелы, «+», «-» и скобки' });
    if (body.language != null && !['ru', 'en', 'es', ''].includes(body.language)) return json(res, 400, { error: 'Язык — русский, английский или испанский' });
    const id = 'manual-' + crypto.randomBytes(5).toString('hex');
    const now = new Date().toISOString();
    data.users[id] = {
      id, contactName: name, phone, preferredLanguage: body.language || '', note: cleanText(body.note, CLIENT_NOTE_LIMIT),
      source: cleanText(body.source, 40) || 'вручную', sourceAt: now, firstSeenAt: now,
    };
    const user = normalizeUser({ id, first_name: name }, null, false);
    user.contactName = name;
    user.lastSeenAt = '';
    saveDataNow();
    return json(res, 201, { ok: true, id });
  }

  // Встреча, назначенная по телефону: «просмотр» без заявки из бота. Сразу подтверждена; клиенту в Telegram
  // ничего не уходит (у него может не быть чата), менеджер видит её в календаре и в утренней сводке.
  if (url.pathname === '/api/viewings' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const user = userById(String(body.userId || ''));
    if (!user) return json(res, 404, { error: 'Клиент не найден' });
    const date = cleanText(body.date, 10);
    const time = cleanText(body.time, 5);
    if (!DAY_KEY_PATTERN.test(date)) return json(res, 400, { error: 'Укажите дату просмотра' });
    if (date < localDayKey()) return json(res, 400, { error: 'Дата просмотра уже прошла' });
    if (time && !CLOCK_TIME_PATTERN.test(time)) return json(res, 400, { error: 'Время укажите в формате ЧЧ:ММ' });
    const propertyId = cleanText(body.propertyId, 100);
    if (propertyId && !data.objects.some((item) => item.id === propertyId)) return json(res, 400, { error: 'Такого объекта нет' });
    const now = new Date().toISOString();
    const admin = cleanText(data.config.adminName, 60) || 'Администратор';
    const inquiry = {
      id: crypto.randomUUID(), userId: String(user.id), chatId: user.chatId ? String(user.chatId) : '',
      language: ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'ru',
      text: cleanText(body.note, 4000) || 'Просмотр назначен вручную', type: 'viewing', propertyId, sourceMessageId: null,
      lead: null, selection: null, matching: null,
      viewing: normalizeViewing({ date, timeText: time, confirmedDate: date, confirmedTime: time, confirmedAt: now }),
      status: 'in_progress', pipelineStage: 'viewing', note: '', replies: [], messages: [], readAt: now, remindedAt: '',
      followUpDate: '', followUpTime: '', followUpNotifiedAt: '', assignee: admin, createdAt: now, updatedAt: now, clientMessageAt: '',
    };
    data.inquiries.unshift(inquiry);
    trimInquiries();
    saveDataNow();
    return json(res, 201, { ok: true, id: inquiry.id });
  }

  // Объединение двух карточек одного человека: заведённый руками клиент (без чата в Telegram) вливается в
  // основную карточку — заявки переходят к ней, пустые поля дополняются, а телефон и заметки не теряются.
  // Вливать можно только карточку без Telegram-чата: два живых чата в одну не склеить. «Вернуть» держится в
  // памяти бота (несколько последних слияний): после перезапуска вернуть уже нельзя, но данные остаются целыми.
  if (url.pathname === '/api/users/merge' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const keep = userById(String(body.keepId || ''));
    const gone = userById(String(body.mergeId || ''));
    if (!keep || !gone) return json(res, 404, { error: 'Клиент не найден' });
    if (keep === gone) return json(res, 400, { error: 'Выберите двух разных клиентов' });
    if (gone.chatId != null && gone.chatId !== '' && gone.chatId !== 0) return json(res, 400, { error: 'В основную карточку можно влить только клиента без чата в Telegram' });
    const before = { phone: keep.phone, contactName: keep.contactName, preferredLanguage: keep.preferredLanguage, source: keep.source, note: keep.note, tags: keep.tags, favorites: keep.favorites, firstSeenAt: keep.firstSeenAt, messages: keep.messages };
    const moved = [];
    for (const inquiry of data.inquiries) {
      if (String(inquiry.userId) !== String(gone.id)) continue;
      moved.push({ id: inquiry.id, chatId: inquiry.chatId });
      inquiry.userId = String(keep.id);
      if (!inquiry.chatId && keep.chatId) inquiry.chatId = String(keep.chatId);
    }
    for (const field of ['phone', 'contactName', 'preferredLanguage', 'source']) if (!keep[field] && gone[field]) keep[field] = gone[field];
    if (gone.note && !String(keep.note || '').includes(gone.note)) keep.note = cleanText([keep.note, gone.note].filter(Boolean).join('\n'), CLIENT_NOTE_LIMIT);
    keep.tags = [...new Set([...(keep.tags || []), ...(gone.tags || [])])].slice(0, 20);
    keep.favorites = [...new Set([...(keep.favorites || []), ...(gone.favorites || [])].map(String))];
    if (gone.firstSeenAt && (!keep.firstSeenAt || gone.firstSeenAt < keep.firstSeenAt)) keep.firstSeenAt = gone.firstSeenAt;
    keep.messages = Number(keep.messages || 0) + Number(gone.messages || 0);
    const token = crypto.randomBytes(8).toString('hex');
    recentMerges.set(token, { keepId: String(keep.id), gone: JSON.parse(JSON.stringify(gone)), moved, before: JSON.parse(JSON.stringify(before)) });
    while (recentMerges.size > 5) recentMerges.delete(recentMerges.keys().next().value);
    delete data.users[String(gone.id)];
    saveDataNow();
    return json(res, 200, { ok: true, keepId: String(keep.id), moved: moved.length, undoToken: token });
  }

  if (url.pathname === '/api/users/unmerge' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const token = String(body.token || '');
    const entry = recentMerges.get(token);
    if (!entry) return json(res, 404, { error: 'Вернуть уже нельзя: слияние давно сделано или бот перезапускался' });
    const keep = userById(entry.keepId);
    if (!keep || userById(entry.gone.id)) return json(res, 409, { error: 'Карточки изменились — вернуть нельзя' });
    Object.assign(keep, entry.before);
    data.users[entry.gone.id] = entry.gone;
    for (const item of entry.moved) {
      const inquiry = data.inquiries.find((candidate) => candidate.id === item.id);
      if (!inquiry) continue;
      inquiry.userId = String(entry.gone.id);
      inquiry.chatId = item.chatId;
    }
    recentMerges.delete(token);
    saveDataNow();
    return json(res, 200, { ok: true, id: String(entry.gone.id) });
  }

  // Следующий шаг у клиента: «позвонить в четверг». Если у клиента есть открытая заявка — дата ставится на неё;
  // если заявок нет (позвонил и всё), создаётся заявка-«шаг»: так шаг попадает в «Следующие шаги», в список дел и в
  // напоминания без отдельного механизма.
  const stepMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/step$/);
  if (stepMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const user = userById(decodeURIComponent(stepMatch[1]));
    if (!user) return json(res, 404, { error: 'Клиент не найден' });
    const body = await readJson(req);
    const date = cleanText(body.date, 10);
    const time = cleanText(body.time, 5);
    if (!DAY_KEY_PATTERN.test(date)) return json(res, 400, { error: 'Укажите день следующего шага' });
    if (time && !CLOCK_TIME_PATTERN.test(time)) return json(res, 400, { error: 'Время укажите в формате ЧЧ:ММ' });
    const note = cleanText(body.note, 300);
    const open = data.inquiries.find((item) => String(item.userId) === String(user.id) && item.status !== 'closed' && !item.searchLead);
    if (open) {
      open.followUpDate = date;
      open.followUpTime = time;
      open.followUpNotifiedAt = '';
      open.updatedAt = new Date().toISOString();
      saveDataNow();
      return json(res, 200, { ok: true, inquiryId: open.id, created: false });
    }
    const now = new Date().toISOString();
    const inquiry = {
      id: crypto.randomUUID(), userId: String(user.id), chatId: user.chatId ? String(user.chatId) : '',
      language: ['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'ru',
      text: note || 'Следующий шаг', type: 'general', propertyId: '', sourceMessageId: null, lead: null, selection: null, matching: null, viewing: null,
      status: 'in_progress', pipelineStage: 'contact', note: '', replies: [], messages: [], readAt: now, remindedAt: '',
      followUpDate: date, followUpTime: time, followUpNotifiedAt: '', assignee: cleanText(data.config.adminName, 60) || 'Администратор',
      createdAt: now, updatedAt: now, clientMessageAt: '',
    };
    data.inquiries.unshift(inquiry);
    trimInquiries();
    saveDataNow();
    return json(res, 201, { ok: true, inquiryId: inquiry.id, created: true });
  }

  if (url.pathname === '/api/users/export' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 20000) : null;
    const users = ids ? ids.filter((id) => Object.hasOwn(data.users, id)).map((id) => data.users[id]) : Object.values(data.users);
    const file = xlsxWorkbook('Клиенты', CLIENT_EXPORT_COLUMNS, clientExportRows(users));
    const name = 'Клиенты ' + localDayKey() + '.xlsx';
    securityHeaders(res);
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-length': file.length,
      'content-disposition': 'attachment; filename="clients-' + localDayKey() + '.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(name),
    });
    return res.end(file);
  }

  if (url.pathname === '/api/reply-templates' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const input = replyTemplateInput(await readJson(req));
      if (data.replyTemplates.length >= MAX_REPLY_TEMPLATES) return json(res, 400, { error: 'Можно сохранить не больше ' + MAX_REPLY_TEMPLATES + ' шаблонов' });
      const template = { id: crypto.randomUUID(), ...input, updatedAt: new Date().toISOString() };
      data.replyTemplates.push(template);
      saveDataNow();
      return json(res, 201, { ok: true, id: template.id });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const replyTemplateMatch = url.pathname.match(/^\/api\/reply-templates\/([^/]+)$/);
  if (replyTemplateMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const id = decodeURIComponent(replyTemplateMatch[1]);
    const template = data.replyTemplates.find((item) => item.id === id);
    if (!template) return json(res, 404, { error: 'Шаблон не найден' });
    if (req.method === 'DELETE') {
      data.replyTemplates = data.replyTemplates.filter((item) => item.id !== id);
      saveDataNow();
      return json(res, 200, { ok: true });
    }
    try {
      Object.assign(template, replyTemplateInput(await readJson(req)), { updatedAt: new Date().toISOString() });
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  // Уборка списка обращений: по одному или пачкой (закрытые, старше N дней).
  if (url.pathname === '/api/inquiries/cleanup' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const days = Math.max(0, Math.min(3650, Number(body.olderThanDays) || 0));
    const before = days ? Date.now() - days * 24 * 60 * 60 * 1000 : Infinity;
    const scope = ['closed', 'answered', 'all'].includes(body.scope) ? body.scope : 'closed';
    const keep = [];
    let removed = 0;
    for (const inquiry of data.inquiries) {
      const old = (Date.parse(inquiry.updatedAt || inquiry.createdAt) || 0) < before;
      if (cleanupMatches(inquiry, scope) && old) removed += 1;
      else keep.push(inquiry);
    }
    data.inquiries = keep;
    saveDataNow();
    return json(res, 200, { ok: true, removed, left: data.inquiries.length });
  }

  // Переписка беседы: панель просит её, когда беседу открывают, — в общем
  // состоянии её больше нет, иначе каждое обновление экрана тянуло бы всю
  // переписку всех клиентов.
  const conversationTimelineMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/timeline$/);
  if (conversationTimelineMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const userId = decodeURIComponent(conversationTimelineMatch[1]);
    const messages = [];
    for (const inquiry of data.inquiries) {
      if (String(inquiry.userId) !== userId) continue;
      for (const message of Array.isArray(inquiry.messages) ? inquiry.messages : []) {
        messages.push({ ...message, inquiryId: inquiry.id });
      }
    }
    messages.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    return json(res, 200, { userId, messages: messages.slice(-400) });
  }

  // Поиск по переписке. Сами сообщения в панель не уезжают, поэтому искать по
  // ним панель не может — ищет бот и отвечает списком найденных обращений.
  if (url.pathname === '/api/conversations/search' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const query = cleanText(url.searchParams.get('q'), 100).toLocaleLowerCase('ru-RU');
    if (query.length < 2) return json(res, 200, { query, inquiryIds: [], clients: [] });
    // Клиенты — по всей базе, а не только по 500 последним, которые попадают в
    // панель: клиент, давно не писавший и без заявок, иначе не находился вовсе.
    const digits = query.replace(/\D/g, '');
    const handle = query.replace(/^@/, '');
    const clients = [];
    for (const user of Object.values(data.users)) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.contactName || '';
      const haystack = [name, user.contactName, user.username, user.note, user.id, user.chatId].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
      const phoneDigits = String(user.phone || '').replace(/\D/g, '');
      const hit = haystack.includes(query) || haystack.includes(handle)
        || (digits.length >= 3 && phoneDigits.includes(digits)) || String(user.phone || '').toLowerCase().includes(query);
      if (!hit) continue;
      clients.push({ id: String(user.id), name: name || 'Без имени', username: user.username || '', phone: user.phone || '', lastSeenAt: user.lastSeenAt || '' });
      if (clients.length >= 8) break;
    }
    const inquiryIds = [];
    for (const inquiry of data.inquiries) {
      const found = (Array.isArray(inquiry.messages) ? inquiry.messages : []).some((message) => {
        const text = String((message && message.text) || '') + ' ' + String((message && message.fileName) || '');
        return text.toLocaleLowerCase('ru-RU').includes(query);
      });
      if (found) inquiryIds.push(inquiry.id);
      if (inquiryIds.length >= CONVERSATION_SEARCH_LIMIT) break;
    }
    return json(res, 200, { query, inquiryIds, clients });
  }

  const conversationReadMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/read$/);
  if (conversationReadMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const userId = decodeURIComponent(conversationReadMatch[1]);
    const inquiries = data.inquiries.filter((item) => String(item.userId) === userId);
    if (!inquiries.length) return json(res, 404, { error: 'Диалог не найден' });
    const now = new Date().toISOString();
    for (const inquiry of inquiries) inquiry.readAt = now;
    markMessageNotificationsRead(userId);
    saveDataNow();
    return json(res, 200, { ok: true, readAt: now });
  }

  const conversationMediaMatch = url.pathname.match(/^\/api\/conversation-media\/([^/]+)$/);
  if (conversationMediaMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const messageId = decodeURIComponent(conversationMediaMatch[1]);
    let attachment = null;
    for (const inquiry of data.inquiries) {
      attachment = (Array.isArray(inquiry.messages) ? inquiry.messages : []).find((message) => message.id === messageId && message.fileId);
      if (attachment) break;
    }
    if (!attachment) return json(res, 404, { error: 'Вложение не найдено' });
    try {
      const telegramFile = await telegramRequest(data.config.botToken, 'getFile', { file_id: attachment.fileId });
      const filePath = cleanText(telegramFile && telegramFile.file_path, 512);
      if (!filePath || filePath.includes('..') || !/^[A-Za-z0-9_./-]+$/.test(filePath)) throw new Error('Telegram не вернул путь к файлу');
      const response = await fetch('https://api.telegram.org/file/bot' + data.config.botToken + '/' + filePath);
      if (!response.ok) throw new Error('Telegram не отдал файл');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ');
      const fallbackName = filePath.split('/').pop() || 'attachment';
      const fileName = (attachment.fileName || fallbackName).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 180) || 'attachment';
      const delivery = attachmentDelivery(attachment.mimeType || response.headers.get('content-type'));
      securityHeaders(res);
      // Даже картинку отдаём в песочнице: браузер не станет считать её
      // страницей панели и ничего из неё не выполнит.
      res.setHeader('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'none'");
      res.writeHead(200, {
        'content-type': delivery.type,
        'content-disposition': delivery.disposition + "; filename*=UTF-8''" + encodeURIComponent(fileName),
        'content-length': bytes.length,
        'cache-control': 'private, no-store',
      });
      res.end(bytes);
      return;
    } catch (error) {
      recordError('Открытие вложения в панели', error);
      return json(res, 502, { error: 'Не удалось получить вложение из Telegram' });
    }
  }

  // Передача клиента: сменить ответственного и сказать об этом новому менеджеру.
  // Один клиент — целым уведомлением (на него можно ответить), все клиенты человека
  // (например, перед отпуском) — одной сводкой.
  const staffNames = () => [cleanText(data.config.adminName, 60) || 'Администратор', ...(Array.isArray(data.config.managers) ? data.config.managers.map((manager) => cleanText(manager.name, 60)) : [])];
  const transferTarget = (name) => inquiryChats().find((chat) => chat.name === name) || null;
  const transferClientName = (inquiry) => {
    const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
    return user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени' : 'Пользователь удалён';
  };
  const transferActor = () => cleanText(data.config.adminName, 60) || 'Администратор';

  const transferOneMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/transfer$/);
  if (transferOneMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(transferOneMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    const to = cleanText(body.to, 60);
    if (!to || !staffNames().includes(to)) return json(res, 400, { error: 'Выберите, кому передать клиента, из списка менеджеров' });
    if (inquiry.assignee === to) return json(res, 200, { ok: true, moved: 0, notified: false });
    inquiry.assignee = to;
    inquiry.updatedAt = new Date().toISOString();
    saveDataNow();
    let notified = false;
    const chat = transferTarget(to);
    if (chat && data.config.botToken) {
      try {
        notified = (await sendInquiryToAdministrator(inquiry, '🔁 Вам передан клиент. Передал(а): ' + transferActor(), [], { chats: [chat] })) > 0;
      } catch (error) {
        recordError('Передача клиента: уведомление менеджеру', error);
      }
    }
    return json(res, 200, { ok: true, moved: 1, notified });
  }

  if (url.pathname === '/api/inquiries/transfer' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const from = cleanText(body.from, 60);
    const to = cleanText(body.to, 60);
    const names = staffNames();
    if (!to || !names.includes(to)) return json(res, 400, { error: 'Выберите, кому передать клиентов, из списка менеджеров' });
    if (from && !names.includes(from)) return json(res, 400, { error: 'Выберите, у кого забрать клиентов, из списка менеджеров' });
    // Выбранные в списке диалогов заявки (ids) — вместо «всех у менеджера».
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String).slice(0, 2000)) : null;
    if (!ids && from === to) return json(res, 400, { error: 'Клиенты уже у этого менеджера' });
    // Открытые заявки: закрытые остаются у прежнего — это история.
    const moving = data.inquiries.filter((item) => item.status !== 'closed' && !item.searchLead
      && (ids ? ids.has(item.id) && cleanText(item.assignee, 60) !== to : cleanText(item.assignee, 60) === from));
    const now = new Date().toISOString();
    for (const inquiry of moving) {
      inquiry.assignee = to;
      inquiry.updatedAt = now;
    }
    if (moving.length) saveDataNow();
    let notified = false;
    const chat = transferTarget(to);
    if (moving.length && chat && data.config.botToken) {
      const shown = moving.slice(0, 15).map((item) => '• ' + transferClientName(item));
      const text = ['🔁 Вам передано клиентов: ' + moving.length + '. Передал(а): ' + transferActor() + '.', '', ...shown, ...(moving.length > shown.length ? ['и ещё ' + (moving.length - shown.length)] : []), '', 'Все они теперь в «Мои» в панели.'].join('\n');
      try {
        await sendMessage(chat.chatId, text, data.config.botToken, { track: false });
        notified = true;
      } catch (error) {
        recordError('Передача клиентов: уведомление менеджеру', error);
      }
    }
    return json(res, 200, { ok: true, moved: moving.length, notified });
  }

  const inquiryMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)$/);
  if (inquiryMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const id = decodeURIComponent(inquiryMatch[1]);
    const before = data.inquiries.length;
    data.inquiries = data.inquiries.filter((item) => item.id !== id);
    if (data.inquiries.length === before) return json(res, 404, { error: 'Обращение не найдено' });
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (inquiryMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(inquiryMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    if (body.status != null && !['new', 'in_progress', 'closed'].includes(body.status)) {
      return json(res, 400, { error: 'Некорректный статус обращения' });
    }
    if (body.pipelineStage != null && !['', ...PIPELINE_STAGES].includes(body.pipelineStage)) {
      return json(res, 400, { error: 'Некорректный этап воронки' });
    }
    let assignee = null;
    if (body.assignee != null) {
      assignee = cleanText(body.assignee, 60);
      const allowed = new Set(['', cleanText(data.config.adminName, 60) || 'Администратор', ...(Array.isArray(data.config.managers) ? data.config.managers.map((manager) => cleanText(manager.name, 60)) : [])]);
      if (!allowed.has(assignee)) return json(res, 400, { error: 'Выберите ответственного из списка менеджеров' });
    }
    if (body.followUpDate != null) {
      const date = cleanText(body.followUpDate, 10);
      const time = cleanText(body.followUpTime, 5);
      if (date && !DAY_KEY_PATTERN.test(date)) return json(res, 400, { error: 'Некорректная дата напоминания' });
      if (time && !CLOCK_TIME_PATTERN.test(time)) return json(res, 400, { error: 'Время напоминания укажите в формате ЧЧ:ММ' });
      if (time && !date) return json(res, 400, { error: 'Укажите дату напоминания' });
      if (date !== inquiry.followUpDate || time !== inquiry.followUpTime) inquiry.followUpNotifiedAt = '';
      inquiry.followUpDate = date;
      inquiry.followUpTime = date ? time : '';
    }
    // Сначала статус, потом этап: если пришли оба, выбранный этап остаётся
    // последним словом. Раньше порядок был обратным, и «Выиграно» из карточки
    // клиента тут же откатывалось на «Общение» — работало только перетаскивание.
    const wasWon = inquiry.pipelineStage === 'won';
    if (body.status != null) {
      inquiry.status = body.status;
      if (body.status !== 'closed' && ['won', 'lost'].includes(inquiry.pipelineStage)) {
        inquiry.pipelineStage = body.status === 'new' ? 'new' : 'contact';
      }
    }
    if (body.pipelineStage != null) {
      inquiry.pipelineStage = body.pipelineStage;
      if (['won', 'lost'].includes(body.pipelineStage)) inquiry.status = 'closed';
      // Этап сам заявку открывает, только если статус не задан явно.
      else if (body.pipelineStage && inquiry.status === 'closed' && body.status == null) inquiry.status = 'in_progress';
    }
    // Одна заметка — о клиенте (раньше была ещё «по этой заявке»). Заметка и теги
    // клиента идут тем же запросом: всё сохраняется вместе или не сохраняется совсем
    // (все проверки — выше, до первой правки).
    const owner = userById(inquiry.userId) || userByChatId(inquiry.chatId);
    if (body.note != null) {
      if (owner) owner.note = cleanText(body.note, CLIENT_NOTE_LIMIT);
      else inquiry.note = cleanText(body.note, CLIENT_NOTE_LIMIT);
    }
    if (owner && Array.isArray(body.tags)) owner.tags = body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20);
    if (assignee != null) inquiry.assignee = assignee;
    inquiry.updatedAt = new Date().toISOString();
    // Дата сделки: ставится один раз, когда обращение стало «Сделкой», и снимается, если его вернули в работу.
    // «Вернуть» смены этапа присылает прежнюю дату сделки: старая сделка не переезжает в
    // текущую неделю отчёта. Принимаем её только как дату в прошлом, не позже «сейчас».
    const restoredWonAt = Date.parse(String(body.wonAt || ''));
    const keptWonAt = Number.isFinite(restoredWonAt) && restoredWonAt <= Date.now() ? new Date(restoredWonAt).toISOString() : '';
    if (inquiry.pipelineStage === 'won' && !wasWon) inquiry.wonAt = keptWonAt || inquiry.updatedAt;
    else if (inquiry.pipelineStage !== 'won') inquiry.wonAt = '';
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  const inquiryViewingMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/viewing$/);
  if (inquiryViewingMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(inquiryViewingMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    try {
      await confirmViewing(inquiry, { date: cleanText(body.date, 10), time: cleanText(body.time, 5), source: 'panel' });
      return json(res, 200, { ok: true });
    } catch (error) {
      const user = userById(inquiry.userId);
      if (user && userUnavailableError(error)) markUnavailable(user);
      if (error.telegramCode) recordError('Подтверждение просмотра', error);
      return json(res, 400, { error: 'Не удалось подтвердить просмотр: ' + error.message });
    }
  }

  const inquiryReplyMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/reply$/);
  if (inquiryReplyMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(inquiryReplyMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    const text = cleanText(body.text, 3800);
    const requestedId = cleanText(body.clientRequestId, 100);
    if (requestedId && !/^[A-Za-z0-9._:-]{8,100}$/.test(requestedId)) return json(res, 400, { error: 'Некорректный идентификатор отправки' });
    const clientRequestId = requestedId || crypto.randomUUID();
    const existingReply = (Array.isArray(inquiry.replies) ? inquiry.replies : []).find((item) => item.clientRequestId === clientRequestId);
    if (existingReply) {
      return json(res, 200, {
        ok: true,
        duplicate: true,
        deliveredAt: existingReply.deliveredAt || existingReply.createdAt || '',
        messageId: existingReply.telegramMessageId || null,
      });
    }
    if (body.imageDataUrl && body.documentDataUrl) return json(res, 400, { error: 'За один раз можно отправить только один файл' });
    let attachment = null;
    let attachmentKind = '';
    try {
      if (body.imageDataUrl) {
        attachment = parseUploadedImage(body.imageDataUrl, body.imageName || 'photo.jpg');
        attachmentKind = 'photo';
      } else if (body.documentDataUrl) {
        attachment = parseUploadedDocument(body.documentDataUrl, body.documentName || 'document.pdf');
        attachmentKind = 'document';
      }
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    if (!text && !attachment) return json(res, 400, { error: 'Введите сообщение или добавьте файл' });
    if (attachment && text.length > 800) return json(res, 400, { error: 'С вложением отправьте подпись до 800 знаков' });
    // Кнопка-ссылка: раньше она была только в карточке клиента, из-за чего
    // менеджер писал одно и то же сообщение дважды в разных местах.
    const buttonText = cleanText(body.buttonText, 80);
    const buttonUrl = cleanText(body.buttonUrl, 500);
    if (buttonUrl && !validHttpUrl(buttonUrl)) return json(res, 400, { error: 'Ссылка кнопки должна начинаться с http:// или https://' });
    if ((buttonText && !buttonUrl) || (buttonUrl && !buttonText)) return json(res, 400, { error: 'Для кнопки нужны и название, и ссылка' });
    const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
    if (!user || !user.chatId) return json(res, 400, { error: 'У пользователя нет доступного чата' });
    const requestedReplyTo = Number(body.replyToMessageId);
    let replyTarget = null;
    if (body.replyToMessageId != null && body.replyToMessageId !== '') {
      if (!Number.isFinite(requestedReplyTo)) return json(res, 400, { error: 'Не удалось определить сообщение для ответа' });
      for (const related of data.inquiries) {
        if (String(related.userId) !== String(inquiry.userId)) continue;
        replyTarget = (Array.isArray(related.messages) ? related.messages : []).find((message) => message.direction === 'in' && Number(message.telegramMessageId) === requestedReplyTo);
        if (replyTarget) break;
      }
      if (!replyTarget) return json(res, 400, { error: 'Сообщение для ответа не найдено в этом диалоге' });
    }
    try {
      const language = user.preferredLanguage || inquiry.language || 'ru';
      const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
      const targetMessageId = replyTarget ? requestedReplyTo : Number(inquiry.sourceMessageId);
      const replyParameters = Number.isFinite(targetMessageId)
        ? { message_id: targetMessageId, allow_sending_without_reply: true }
        : null;
      // С кнопкой-ссылкой уходит inline-клавиатура, без неё — обычное меню.
      const keyboard = buttonText && buttonUrl
        ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] }
        : menuKeyboard(language);
      const outgoingText = header + (text ? '\n\n' + text : '');
      let sentMessage;
      if (attachmentKind === 'photo') {
        sentMessage = await sendPhotoMessage(user.chatId, attachment, outgoingText, data.config.botToken, keyboard, { replyParameters });
      } else if (attachmentKind === 'document') {
        sentMessage = await sendDocumentMessage(user.chatId, attachment, outgoingText, data.config.botToken, keyboard, { replyParameters });
      } else {
        sentMessage = await sendMessage(user.chatId, outgoingText, data.config.botToken, {
          reply_markup: keyboard,
          ...(replyParameters ? { reply_parameters: replyParameters } : {}),
        });
      }
      let fileId = '';
      if (attachmentKind === 'photo' && sentMessage && Array.isArray(sentMessage.photo) && sentMessage.photo.length) fileId = cleanText(sentMessage.photo[sentMessage.photo.length - 1].file_id, 512);
      if (attachmentKind === 'document' && sentMessage && sentMessage.document) fileId = cleanText(sentMessage.document.file_id, 512);
      inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
      const createdAt = new Date().toISOString();
      inquiry.replies.push({
        id: crypto.randomUUID(),
        text: [text || (attachment ? attachment.name : ''), buttonText ? '🔗 ' + buttonText : ''].filter(Boolean).join('\n'),
        source: 'panel',
        by: cleanText(data.config.adminName, 60) || 'Администратор',
        createdAt,
        deliveredAt: createdAt,
        telegramMessageId: sentMessage && sentMessage.message_id ? Number(sentMessage.message_id) : null,
        clientRequestId,
        kind: attachmentKind || 'text',
        fileName: attachment ? attachment.name : '',
      });
      inquiry.replies = inquiry.replies.slice(-50);
      appendInquiryMessage(inquiry, inquiryTimelineMessage(null, 'out', {
        kind: attachmentKind || 'text',
        text,
        fileId,
        fileName: attachment ? attachment.name : '',
        mimeType: attachment ? attachment.mimeType : '',
        source: 'panel',
        by: cleanText(data.config.adminName, 60) || 'Администратор',
        createdAt,
        telegramMessageId: sentMessage && sentMessage.message_id,
        replyToTelegramMessageId: Number.isFinite(targetMessageId) ? targetMessageId : null,
        replyToText: replyTarget ? (replyTarget.text || replyTarget.fileName || 'Вложение клиента') : '',
        deliveryStatus: 'delivered',
        clientRequestId,
      }));
      // Ответ не закрывает заявку: закрытие — отдельное решение человека.
      // Раньше галочка «оставить диалог в работе» решала это за менеджера, и
      // живые переписки закрывались сами собой.
      inquiry.status = 'in_progress';
      // Первый ответ сдвигает воронку с «Новый» на «Контакт» сам.
      if (!inquiry.pipelineStage || inquiry.pipelineStage === 'new') inquiry.pipelineStage = 'contact';
      inquiry.readAt = createdAt;
      inquiry.updatedAt = createdAt;
      saveDataNow();
      return json(res, 200, { ok: true, deliveredAt: createdAt, messageId: sentMessage && sentMessage.message_id ? Number(sentMessage.message_id) : null });
    } catch (error) {
      if (userUnavailableError(error)) markUnavailable(user);
      recordError('Ответ на обращение', error);
      return json(res, 400, { error: 'Не удалось отправить ответ: ' + error.message });
    }
  }

  return false;
}

export {
  handleClientsApi,
};
