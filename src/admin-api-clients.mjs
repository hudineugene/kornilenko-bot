// API панели: клиенты, обращения, переписка и шаблоны ответов.

import crypto from 'node:crypto';
import { cleanText, localDayKey } from './util.mjs';
import { CLOCK_TIME_PATTERN, DAY_KEY_PATTERN, MAX_REPLY_TEMPLATES, PIPELINE_STAGES } from './data-format.mjs';
import { MANAGER_CONTACT_TEXT } from './texts.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { eraseUserData, markUnavailable, userByChatId, userById, userDataExport } from './users.mjs';
import { sendDocumentMessage, sendMessage, sendPhotoMessage, telegramRequest } from './telegram.mjs';
import { menuKeyboard } from './menus.mjs';
import { appendInquiryMessage, awaitingReply, inquiryTimelineMessage } from './inquiries.mjs';
import { validHttpUrl } from './catalog.mjs';
import { userUnavailableError } from './broadcasts.mjs';
import { json, parseUploadedDocument, parseUploadedImage, readJson, requireAuth, securityHeaders } from './admin-http.mjs';
import { replyTemplateInput } from './admin-input.mjs';
import { INQUIRY_EXPORT_COLUMNS, inquiryExportRows, xlsxWorkbook } from './excel.mjs';
import { confirmViewing } from './viewings.mjs';

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
        data.inquiries = data.inquiries.slice(0, 5000);
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
    if (body.note != null) user.note = cleanText(body.note, 2000);
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
    const inquiries = ids ? ids.map((id) => byId.get(id)).filter(Boolean) : data.inquiries;
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

  const conversationReadMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/read$/);
  if (conversationReadMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const userId = decodeURIComponent(conversationReadMatch[1]);
    const inquiries = data.inquiries.filter((item) => String(item.userId) === userId);
    if (!inquiries.length) return json(res, 404, { error: 'Диалог не найден' });
    const now = new Date().toISOString();
    for (const inquiry of inquiries) inquiry.readAt = now;
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
    if (body.pipelineStage != null) {
      inquiry.pipelineStage = body.pipelineStage;
      if (['won', 'lost'].includes(body.pipelineStage)) inquiry.status = 'closed';
      else if (body.pipelineStage && inquiry.status === 'closed') inquiry.status = 'in_progress';
    }
    if (body.status != null) {
      inquiry.status = body.status;
      if (body.status !== 'closed' && ['won', 'lost'].includes(inquiry.pipelineStage)) {
        inquiry.pipelineStage = body.status === 'new' ? 'new' : 'contact';
      }
    }
    if (body.note != null) inquiry.note = cleanText(body.note, 2000);
    if (assignee != null) inquiry.assignee = assignee;
    inquiry.updatedAt = new Date().toISOString();
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
      const keyboard = menuKeyboard(language);
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
        text: text || attachment.name,
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
      inquiry.status = body.keepOpen ? 'in_progress' : 'closed';
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
