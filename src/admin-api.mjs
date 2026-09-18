// Панель: API и резервные копии.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cleanText, clone, dayKey, delay, hashPassword } from './util.mjs';
import { MAX_REPLY_TEMPLATES, REMINDER_HOUR_OPTIONS, normalizeLoadedData, normalizeWorkingHours, pruneOrphanPropertyAnalytics } from './data-format.mjs';
import { forEachStoredImage, imageBytes, imageExists } from './media.mjs';
import { MANAGER_CONTACT_TEXT, applyInterfaceText, normalizedInterfaceText } from './texts.mjs';
import { configured, data, replaceData, runtime, saveDataNow, verifyPassword } from './store.mjs';
import { recordError } from './analytics.mjs';
import { eraseUserData, rebuildUserIndex, userByChatId, userById, userDataExport } from './users.mjs';
import { forgetTelegramFileIds, sendMessage, sendPhotoMessage, telegramFileIds, telegramRequest } from './telegram.mjs';
import { configureBotCommands, menuKeyboard } from './menus.mjs';
import { recordImages, validHttpUrl, whatsappContactUrl } from './catalog.mjs';
import { findRule, restartPolling } from './updates.mjs';
import { broadcastUsers, deliverBroadcast, runBroadcast, userUnavailableError } from './broadcasts.mjs';
import { BOT_TOKEN_PATTERN, MAX_UNAUTHENTICATED_BODY_BYTES, binaryImage, clientAddress, createSession, isLocalRequest, json, loginAttempts, parseUploadedImage, readBackup, readJson, requestIsRemote, requireAuth, safeState, securityHeaders, sessions } from './admin-http.mjs';
import { REMOTE_LOGIN_CODE_ATTEMPTS, pendingRemoteLogins, remoteLoginCodeHash, startRemoteLogin, startTunnel, stopTunnel, tunnelInstalled } from './remote.mjs';
import { loginAllowed, menuInput, messagesInput, parseBroadcast, parseContentRecord, replyTemplateInput, rulesConflict, translatedInput, validateBackupPayload } from './admin-input.mjs';
import { INQUIRY_EXPORT_COLUMNS, inquiryExportRows, xlsxWorkbook } from './excel.mjs';
import { queuePropertyAlerts } from './alerts.mjs';
import { confirmViewing } from './viewings.mjs';

function portableBackupData() {
  const payload = clone(data);
  forEachStoredImage(payload, (image) => {
    if (!image) return;
    const bytes = imageBytes(image);
    image.dataBase64 = bytes.toString('base64');
    image.size = bytes.length;
    delete image.storageFile;
  });
  return payload;
}

function sendBackupDownload(res, filename) {
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(portableBackupData()), 'utf8'), { level: 6 });
  securityHeaders(res);
  res.writeHead(200, {
    'content-type': 'application/gzip',
    'content-disposition': 'attachment; filename="' + filename + '"',
    'content-length': compressed.length,
    'cache-control': 'no-store',
  });
  res.end(compressed);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, {
      configured: configured(),
      setupLocalOnly: !configured(),
      botName: data.bot.firstName || '',
    });
  }

  if (url.pathname === '/api/setup' && req.method === 'POST') {
    if (configured()) return json(res, 409, { error: 'Первичная настройка уже выполнена' });
    if (!isLocalRequest(req)) return json(res, 403, { error: 'Настройка доступна только с этого компьютера' });
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
    const token = cleanText(body.token, 256);
    const password = String(body.password || '');
    if (!BOT_TOKEN_PATTERN.test(token)) {
      return json(res, 400, { error: 'Токен выглядит некорректно' });
    }
    if (password.length < 8) return json(res, 400, { error: 'Пароль должен содержать минимум 8 символов' });
    let me;
    try {
      me = await telegramRequest(token, 'getMe', {});
    } catch (error) {
      return json(res, 400, { error: 'Telegram не принял токен: ' + error.message });
    }
    const passwordData = hashPassword(password);
    data.config.botToken = token;
    data.telegramOffset = 0;
    data.config.passwordSalt = passwordData.salt;
    data.config.passwordHash = passwordData.hash;
    data.bot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
    saveDataNow();
    const session = createSession(res, req);
    restartPolling();
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!configured()) return json(res, 409, { error: 'Сначала завершите настройку' });
    const ip = clientAddress(req);
    if (!loginAllowed(ip)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
    if (!verifyPassword(String(body.password || ''))) {
      await delay(250);
      return json(res, 401, { error: 'Неверный пароль' });
    }
    if (requestIsRemote(req)) return startRemoteLogin(res, ip);
    loginAttempts.delete(ip);
    const session = createSession(res, req);
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  if (url.pathname === '/api/login/verify' && req.method === 'POST') {
    const ip = clientAddress(req);
    if (!loginAllowed(ip)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
    const challenge = cleanText(body.challenge, 100);
    const pending = pendingRemoteLogins.get(challenge);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingRemoteLogins.delete(challenge);
      return json(res, 401, { error: 'Код устарел. Введите пароль ещё раз.', expired: true });
    }
    pending.attempts += 1;
    if (pending.attempts > REMOTE_LOGIN_CODE_ATTEMPTS) {
      pendingRemoteLogins.delete(challenge);
      return json(res, 401, { error: 'Слишком много неверных кодов. Введите пароль ещё раз.', expired: true });
    }
    const candidate = remoteLoginCodeHash(String(body.code || '').replace(/\s/g, ''), challenge);
    if (!crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(pending.codeHash, 'hex'))) {
      await delay(250);
      return json(res, 401, { error: 'Неверный код' });
    }
    pendingRemoteLogins.delete(challenge);
    loginAttempts.delete(ip);
    const session = createSession(res, req);
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  if (url.pathname === '/api/remote-access' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const enabled = body.enabled === true;
    if (body.tunnelHostname != null) {
      const hostname = cleanText(body.tunnelHostname, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (hostname && !/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
        return json(res, 400, { error: 'Адрес панели должен быть доменным именем, например panel.example.com' });
      }
      data.config.tunnelHostname = hostname;
    }
    if (body.tunnelToken != null) {
      const token = cleanText(body.tunnelToken, 2000);
      if (token && !/^[A-Za-z0-9+/=_-]{40,}$/.test(token)) return json(res, 400, { error: 'Токен туннеля выглядит некорректно — скопируйте его из панели Cloudflare целиком' });
      data.config.tunnelToken = token;
    }
    if (enabled) {
      if (!data.config.adminChatId || !data.config.adminNotificationVerifiedAt) {
        return json(res, 400, { error: 'Сначала подключите и проверьте уведомления в Telegram: на этот чат будут приходить коды для входа из интернета.' });
      }
      if (!tunnelInstalled()) {
        return json(res, 400, { error: 'Рядом с ботом нет cloudflared.exe — без него туннель не запустить.' });
      }
    }
    data.config.remoteAccess = enabled;
    saveDataNow();
    // Settings changes restart a running tunnel so they take effect.
    stopTunnel();
    if (enabled) startTunnel();
    return json(res, 200, { ok: true, tunnel: runtime.tunnel });
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    sessions.delete(session.id);
    res.setHeader('set-cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    // The panel polls every few seconds. When nothing changed since the
    // version it already has, answer with a tiny body and let it skip
    // re-rendering.
    const serialized = JSON.stringify(safeState(session));
    const stateVersion = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 24);
    if (url.searchParams.get('since') === stateVersion) return json(res, 200, { unchanged: true, stateVersion });
    securityHeaders(res);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(serialized.slice(0, -1) + ',"stateVersion":"' + stateVersion + '"}');
  }

  if (url.pathname === '/api/welcome' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const body = await readJson(req);
      const nextMessages = messagesInput(body.messages);
      const nextMenu = menuInput(body.menu);
      const nextImages = { ...data.welcomeImages };
      const imageChanges = body.images && typeof body.images === 'object' ? body.images : {};
      for (const language of ['ru', 'en', 'es']) {
        const change = imageChanges[language];
        if (!change) continue;
        if (change.remove) nextImages[language] = null;
        else if (change.dataUrl) nextImages[language] = parseUploadedImage(change.dataUrl, change.name || ('welcome-' + language + '.jpg'));
      }
      data.config.messages = nextMessages;
      data.config.menu = nextMenu;
      data.welcomeImages = nextImages;
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/backup' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    try {
      return sendBackupDownload(res, 'telegram-bot-backup-' + dayKey() + '.json.gz');
    } catch (error) {
      recordError('Создание резервной копии', error);
      return json(res, 500, { error: 'Не удалось создать резервную копию: ' + error.message });
    }
  }

  if (url.pathname === '/api/restore' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const backup = await readBackup(req);
      if (!backup || typeof backup !== 'object') throw new Error('Выберите корректный файл резервной копии');
      validateBackupPayload(backup);
      const restored = normalizeLoadedData(backup);
      replaceData(restored);
      rebuildUserIndex();
      telegramFileIds.clear();
      data.interfaceText = applyInterfaceText(data.interfaceText);
      saveDataNow();
      restartPolling();
      sessions.clear();
      const nextSession = createSession(res, req);
      return json(res, 200, { ok: true, csrf: nextSession.csrf });
    } catch (error) {
      return json(res, 400, { error: 'Не удалось восстановить копию: ' + error.message });
    }
  }

  if (url.pathname === '/api/token-test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const token = cleanText(body.token, 256) || data.config.botToken;
    if (!BOT_TOKEN_PATTERN.test(token)) return json(res, 400, { error: 'Токен выглядит некорректно' });
    try {
      const me = await telegramRequest(token, 'getMe', {});
      return json(res, 200, { ok: true, username: me.username || '', firstName: me.first_name || '' });
    } catch (error) {
      return json(res, 400, { error: 'Telegram не принял токен: ' + error.message });
    }
  }

  if (url.pathname === '/api/errors' && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    data.errors = [];
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/statistics/reset' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    data.stats.messagesReceived = 0;
    data.stats.messagesSent = 0;
    data.stats.reactionsReceived = 0;
    data.stats.statisticsResetAt = new Date().toISOString();
    data.analytics = { daily: {}, properties: {} };
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/activity' && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    for (const user of Object.values(data.users)) {
      user.activity = [];
      user.messages = 0;
      user.firstSeenAt = '';
      user.lastSeenAt = '';
    }
    data.activityClearedAt = new Date().toISOString();
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  const mediaMatch = url.pathname.match(/^\/api\/media\/(objects|promotions|broadcasts)\/([^/]+)$/);
  if (mediaMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const collection = mediaMatch[1] === 'broadcasts' ? data.broadcasts : data[mediaMatch[1]];
    const record = collection.find((item) => item.id === decodeURIComponent(mediaMatch[2]));
    if (!record) return json(res, 404, { error: 'Изображение не найдено' });
    const imageId = cleanText(url.searchParams.get('imageId'), 80);
    const searchableImages = mediaMatch[1] === 'objects' || mediaMatch[1] === 'promotions'
      ? ['ru', 'en', 'es'].flatMap((language) => recordImages(record, language))
      : recordImages(record);
    const image = imageId ? searchableImages.find((item) => String(item.id) === imageId) : (record.image || searchableImages[0]);
    if (!imageExists(image)) return json(res, 404, { error: 'Изображение не найдено' });
    return binaryImage(res, image);
  }

  if ((url.pathname === '/api/objects' || url.pathname === '/api/promotions') && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const kind = url.pathname.endsWith('objects') ? 'objects' : 'promotions';
    try {
      const record = parseContentRecord(await readJson(req), kind);
      data[kind].unshift(record);
      saveDataNow();
      const alertsQueued = kind === 'objects' ? queuePropertyAlerts(record, null) : 0;
      return json(res, 201, { ok: true, id: record.id, alertsQueued });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const contentMatch = url.pathname.match(/^\/api\/(objects|promotions)\/([^/]+)$/);
  if (contentMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const kind = contentMatch[1];
    const record = data[kind].find((item) => item.id === decodeURIComponent(contentMatch[2]));
    if (!record) return json(res, 404, { error: 'Запись не найдена' });
    try {
      const before = { status: record.status, priceValue: record.priceValue };
      Object.assign(record, parseContentRecord(await readJson(req), kind, record));
      saveDataNow();
      const alertsQueued = kind === 'objects' ? queuePropertyAlerts(record, before) : 0;
      return json(res, 200, { ok: true, alertsQueued });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (contentMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const kind = contentMatch[1];
    const before = data[kind].length;
    data[kind] = data[kind].filter((item) => item.id !== decodeURIComponent(contentMatch[2]));
    if (data[kind].length === before) return json(res, 404, { error: 'Запись не найдена' });
    pruneOrphanPropertyAnalytics(data);
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/contacts' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const website = cleanText(body.website, 500);
    const mapUrl = cleanText(body.mapUrl, 500);
    const whatsapp = cleanText(body.whatsapp, 500);
    const email = cleanText(body.email, 254);
    if (website && !validHttpUrl(website)) return json(res, 400, { error: 'Ссылка на сайт должна начинаться с http:// или https://' });
    if (mapUrl && !validHttpUrl(mapUrl)) return json(res, 400, { error: 'Ссылка на карту должна начинаться с http:// или https://' });
    if (whatsapp && !whatsappContactUrl(whatsapp)) return json(res, 400, { error: 'Укажите номер WhatsApp с кодом страны или ссылку wa.me' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Проверьте адрес электронной почты' });
    data.contacts = {
      managerName: cleanText(body.managerName, 160),
      phone: cleanText(body.phone, 80),
      whatsapp,
      whatsappEnabled: body.whatsappEnabled !== false,
      telegram: cleanText(body.telegram, 500),
      email,
      website,
      mapUrl,
      text: translatedInput(body.text, 2000),
    };
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/interface-text' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const body = await readJson(req);
      data.interfaceText = normalizedInterfaceText(body.interfaceText, true);
      data.interfaceText = applyInterfaceText(data.interfaceText);
      saveDataNow();
      if (data.config.active && data.config.botToken) {
        configureBotCommands(data.config.botToken).catch((error) => recordError('Обновление команд Telegram', error));
      }
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/admin-notification/test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const adminChatId = cleanText(data.config.adminChatId, 40);
    if (!adminChatId) return json(res, 400, { error: 'Сначала укажите Chat ID администратора' });
    try {
      await sendMessage(adminChatId, '✅ Уведомления работают. Теперь действия пользователей будут приходить в этот чат.', data.config.botToken, { track: false });
      data.config.adminNotificationVerifiedAt = new Date().toISOString();
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      data.config.adminNotificationVerifiedAt = '';
      saveDataNow();
      recordError('Проверка уведомлений', error);
      const notFound = /chat not found/i.test(String(error && error.message));
      return json(res, 400, {
        error: notFound
          ? 'Telegram не нашёл этот Chat ID. Откройте бота с нужного аккаунта, отправьте /start, затем /myid и сохраните полученный номер.'
          : 'Не удалось отправить уведомление: ' + error.message,
      });
    }
  }

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
      if (image && outgoingText.length <= 1000) await sendPhotoMessage(user.chatId, image, outgoingText, data.config.botToken, markup);
      else if (image) {
        await sendPhotoMessage(user.chatId, image, '', data.config.botToken, null);
        await sendMessage(user.chatId, outgoingText, data.config.botToken, markup ? { reply_markup: markup } : {});
      } else {
        await sendMessage(user.chatId, outgoingText, data.config.botToken, markup ? { reply_markup: markup } : {});
      }
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      if (userUnavailableError(error)) user.blocked = true;
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
    if (['ru', 'en', 'es', ''].includes(body.preferredLanguage)) user.preferredLanguage = body.preferredLanguage;
    if (typeof body.blocked === 'boolean') user.blocked = body.blocked;
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
    const name = 'Обращения ' + dayKey() + '.xlsx';
    securityHeaders(res);
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-length': file.length,
      'content-disposition': 'attachment; filename="inquiries-' + dayKey() + '.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(name),
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

  const inquiryMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)$/);
  if (inquiryMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const inquiry = data.inquiries.find((item) => item.id === decodeURIComponent(inquiryMatch[1]));
    if (!inquiry) return json(res, 404, { error: 'Обращение не найдено' });
    const body = await readJson(req);
    if (body.status != null && !['new', 'in_progress', 'closed'].includes(body.status)) {
      return json(res, 400, { error: 'Некорректный статус обращения' });
    }
    if (body.status != null) inquiry.status = body.status;
    if (body.note != null) inquiry.note = cleanText(body.note, 2000);
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
      if (user && userUnavailableError(error)) user.blocked = true;
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
    const text = cleanText(body.text, 4000);
    if (!text) return json(res, 400, { error: 'Введите ответ пользователю' });
    const user = userById(inquiry.userId) || userByChatId(inquiry.chatId);
    if (!user || !user.chatId) return json(res, 400, { error: 'У пользователя нет доступного чата' });
    try {
      const language = user.preferredLanguage || inquiry.language || 'ru';
      const header = (MANAGER_CONTACT_TEXT[language] || MANAGER_CONTACT_TEXT.ru).replyHeader;
      const replyParameters = Number.isFinite(Number(inquiry.sourceMessageId))
        ? { message_id: Number(inquiry.sourceMessageId), allow_sending_without_reply: true }
        : null;
      const sentMessage = await sendMessage(user.chatId, header + '\n\n' + text, data.config.botToken, {
        reply_markup: menuKeyboard(user.preferredLanguage || inquiry.language || 'ru'),
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
      inquiry.replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
      inquiry.replies.push({
        id: crypto.randomUUID(),
        text,
        source: 'panel',
        createdAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        telegramMessageId: sentMessage && sentMessage.message_id ? Number(sentMessage.message_id) : null,
      });
      inquiry.replies = inquiry.replies.slice(-50);
      inquiry.status = body.keepOpen ? 'in_progress' : 'closed';
      inquiry.updatedAt = new Date().toISOString();
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      if (userUnavailableError(error)) user.blocked = true;
      recordError('Ответ на обращение', error);
      return json(res, 400, { error: 'Не удалось отправить ответ: ' + error.message });
    }
  }

  const welcomeImageMatch = url.pathname.match(/^\/api\/images\/(ru|en|es)\/welcome$/);
  if (welcomeImageMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const image = data.welcomeImages[welcomeImageMatch[1]];
    if (!imageExists(image)) return json(res, 404, { error: 'Изображение не загружено' });
    return binaryImage(res, image);
  }

  if (welcomeImageMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    try {
      data.welcomeImages[welcomeImageMatch[1]] = parseUploadedImage(body.dataUrl, body.name);
      saveDataNow();
      return json(res, 201, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (welcomeImageMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    data.welcomeImages[welcomeImageMatch[1]] = null;
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/rules/test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const text = cleanText(body.text, 1000);
    const language = ['ru', 'en', 'es'].includes(body.language) ? body.language : 'ru';
    if (!text) return json(res, 400, { error: 'Введите тестовое сообщение' });
    const rule = findRule(text, language);
    return json(res, 200, { matched: rule || null });
  }

  if (url.pathname === '/api/rules/reorder' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    if (!Array.isArray(body.ids) || body.ids.length !== data.rules.length) return json(res, 400, { error: 'Некорректный порядок правил' });
    const known = new Set(data.rules.map((rule) => rule.id));
    if (new Set(body.ids).size !== known.size || body.ids.some((id) => !known.has(id))) return json(res, 400, { error: 'Некорректный список правил' });
    const byId = new Map(data.rules.map((rule) => [rule.id, rule]));
    data.rules = body.ids.map((id, index) => ({ ...byId.get(id), order: index, updatedAt: new Date().toISOString() }));
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/rules' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const trigger = cleanText(body.trigger, 200);
    const answer = cleanText(body.answer, 4000);
    const type = ['contains', 'exact', 'starts'].includes(body.type) ? body.type : 'contains';
    const language = ['ru', 'en', 'es', 'all'].includes(body.language) ? body.language : 'ru';
    if (!trigger || !answer) return json(res, 400, { error: 'Заполните условие и ответ' });
    const candidate = {
      id: crypto.randomUUID(),
      trigger,
      type,
      answer,
      language,
      enabled: true,
      order: data.rules.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const conflicts = rulesConflict(candidate);
    data.rules.push(candidate);
    saveDataNow();
    return json(res, 201, { ok: true, id: candidate.id, conflicts: conflicts.map((rule) => rule.id) });
  }

  const ruleMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/);
  if (ruleMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const rule = data.rules.find((item) => item.id === decodeURIComponent(ruleMatch[1]));
    if (!rule) return json(res, 404, { error: 'Правило не найдено' });
    const body = await readJson(req);
    if (typeof body.enabled === 'boolean') rule.enabled = body.enabled;
    if (body.trigger != null) rule.trigger = cleanText(body.trigger, 200) || rule.trigger;
    if (body.answer != null) rule.answer = cleanText(body.answer, 4000) || rule.answer;
    if (['contains', 'exact', 'starts'].includes(body.type)) rule.type = body.type;
    if (['ru', 'en', 'es', 'all'].includes(body.language)) rule.language = body.language;
    rule.updatedAt = new Date().toISOString();
    const conflicts = rulesConflict(rule, rule.id);
    saveDataNow();
    return json(res, 200, { ok: true, conflicts: conflicts.map((item) => item.id) });
  }

  if (ruleMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const before = data.rules.length;
    data.rules = data.rules.filter((item) => item.id !== decodeURIComponent(ruleMatch[1]));
    if (data.rules.length === before) return json(res, 404, { error: 'Правило не найдено' });
    data.rules.forEach((rule, index) => { rule.order = index; });
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/menu' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const body = await readJson(req);
      data.config.menu = menuInput(body.menu);
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    let nextMessages;
    try {
      nextMessages = messagesInput(body.messages);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    let tokenChanged = false;
    let nextBot = data.bot;
    const newToken = cleanText(body.token, 256);
    const newPassword = String(body.password || '');
    // A session alone must not be enough to take over the panel or the bot.
    if (newToken || newPassword) {
      const ip = clientAddress(req);
      if (!loginAllowed(ip)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
      if (!verifyPassword(String(body.currentPassword || ''))) {
        await delay(250);
        return json(res, 403, { error: 'Для смены пароля или токена введите текущий пароль' });
      }
      loginAttempts.delete(ip);
    }
    if (newToken) {
      if (!BOT_TOKEN_PATTERN.test(newToken)) return json(res, 400, { error: 'Токен выглядит некорректно' });
      try {
        const me = await telegramRequest(newToken, 'getMe', {});
        nextBot = { id: me.id, username: me.username || '', firstName: me.first_name || '' };
      } catch (error) {
        return json(res, 400, { error: 'Telegram не принял новый токен: ' + error.message });
      }
      tokenChanged = true;
    }

    let passwordData = null;
    if (newPassword) {
      if (newPassword.length < 8) return json(res, 400, { error: 'Новый пароль должен содержать минимум 8 символов' });
      if (newPassword !== String(body.passwordConfirm || '')) return json(res, 400, { error: 'Пароли не совпадают' });
      passwordData = hashPassword(newPassword);
    }
    const previousAdminChatId = String(data.config.adminChatId || '');
    const adminChatId = body.adminChatId == null ? previousAdminChatId : cleanText(body.adminChatId, 40);
    if (adminChatId && !/^-?\d{4,20}$/.test(adminChatId)) return json(res, 400, { error: 'Chat ID должен состоять из цифр' });
    if (body.notifyMode != null && !['all', 'inquiries'].includes(body.notifyMode)) return json(res, 400, { error: 'Некорректный режим уведомлений' });
    if (body.reminderHours != null && !REMINDER_HOUR_OPTIONS.includes(Number(body.reminderHours))) return json(res, 400, { error: 'Некорректный срок напоминания' });

    if (tokenChanged) {
      data.bot = nextBot;
      data.config.botToken = newToken;
      data.telegramOffset = 0;
      forgetTelegramFileIds(data);
    }
    if (passwordData) {
      data.config.passwordSalt = passwordData.salt;
      data.config.passwordHash = passwordData.hash;
    }
    data.config.adminChatId = adminChatId;
    if (body.notifyMode != null) data.config.notifyMode = body.notifyMode;
    if (body.reminderHours != null) data.config.reminderHours = Number(body.reminderHours);
    if (adminChatId !== previousAdminChatId) data.config.adminNotificationVerifiedAt = '';
    data.config.messages = nextMessages;
    const activeChanged = data.config.active !== Boolean(body.active);
    data.config.active = Boolean(body.active);
    saveDataNow();
    if (activeChanged || tokenChanged) restartPolling();
    if (passwordData) {
      for (const id of sessions.keys()) if (id !== session.id) sessions.delete(id);
    }
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/working-hours' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!clock.test(String(body.from || '')) || !clock.test(String(body.to || ''))) return json(res, 400, { error: 'Время укажите в формате ЧЧ:ММ' });
    if (String(body.from) >= String(body.to)) return json(res, 400, { error: 'Конец рабочего дня должен быть позже начала' });
    const days = Array.isArray(body.days) ? body.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
    if (body.enabled === true && !days.length) return json(res, 400, { error: 'Отметьте хотя бы один рабочий день' });
    const note = body.note && typeof body.note === 'object' ? body.note : {};
    for (const language of ['ru', 'en', 'es']) {
      if (cleanText(note[language], 500) && !String(note[language]).includes('{next}')) return json(res, 400, { error: 'В тексте для клиента оставьте {next} — туда бот подставит, когда ответит менеджер' });
    }
    data.config.workingHours = normalizeWorkingHours({ enabled: body.enabled === true, days, from: body.from, to: body.to, note });
    saveDataNow();
    return json(res, 200, { ok: true, workingHours: data.config.workingHours });
  }

  if (url.pathname === '/api/broadcast/estimate' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const entry = parseBroadcast(await readJson(req), {}, { requireMessages: false, requireSelectedTexts: false });
      return json(res, 200, { total: broadcastUsers(entry).length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/broadcast/test' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const user = body.userId ? userById(body.userId) : null;
    if (!user || !user.chatId) return json(res, 400, { error: 'Выберите получателя тестового сообщения' });
    try {
      await deliverBroadcast(user, parseBroadcast(body));
      return json(res, 200, { ok: true });
    } catch (error) {
      recordError('Тест рассылки', error);
      return json(res, 400, { error: error.message });
    }
  }

  if ((url.pathname === '/api/broadcast' || url.pathname === '/api/broadcasts') && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    try {
      const mode = ['draft', 'schedule', 'send'].includes(body.mode) ? body.mode : 'send';
      const entry = parseBroadcast(body, {}, {
        requireMessages: mode !== 'draft',
        requireSelectedTexts: mode !== 'draft',
      });
      if (mode === 'schedule') {
        if (!entry.scheduledAt || Date.parse(entry.scheduledAt) <= Date.now()) throw new Error('Укажите будущую дату и время');
        entry.status = 'scheduled';
      } else if (mode === 'draft') entry.status = 'draft';
      else {
        if (!data.config.active) throw new Error('Сначала включите бота в настройках');
        if (runtime.broadcastRunning) return json(res, 409, { error: 'Предыдущая рассылка еще выполняется' });
        if (!broadcastUsers(entry).length) throw new Error('Для выбранных языков и тегов нет получателей');
        entry.status = 'queued';
      }
      data.broadcasts.unshift(entry);
      data.broadcasts = data.broadcasts.slice(0, 100);
      saveDataNow();
      if (mode === 'send') void runBroadcast(entry).catch((error) => {
        entry.status = 'failed';
        entry.error = cleanText(error.message, 400);
        runtime.lastError = error.message;
        recordError('Рассылка', error);
      });
      return json(res, mode === 'send' ? 202 : 201, { ok: true, id: entry.id, total: broadcastUsers(entry).length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const broadcastMatch = url.pathname.match(/^\/api\/broadcasts\/([^/]+)$/);
  if (broadcastMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const entry = data.broadcasts.find((item) => item.id === decodeURIComponent(broadcastMatch[1]));
    if (!entry) return json(res, 404, { error: 'Рассылка не найдена' });
    if (!['draft', 'scheduled'].includes(entry.status)) return json(res, 409, { error: 'Завершенную или выполняемую рассылку нельзя изменить' });
    try {
      const body = await readJson(req);
      const nextStatus = body.mode === 'schedule' ? 'scheduled' : 'draft';
      const updated = parseBroadcast(body, entry, {
        requireMessages: nextStatus !== 'draft',
        requireSelectedTexts: nextStatus !== 'draft',
      });
      updated.status = nextStatus;
      if (updated.status === 'scheduled' && (!updated.scheduledAt || Date.parse(updated.scheduledAt) <= Date.now())) throw new Error('Укажите будущую дату и время');
      Object.assign(entry, updated);
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (broadcastMatch && req.method === 'DELETE') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const entry = data.broadcasts.find((item) => item.id === decodeURIComponent(broadcastMatch[1]));
    if (!entry) return json(res, 404, { error: 'Рассылка не найдена' });
    if (entry.status === 'running') return json(res, 409, { error: 'Выполняемую рассылку нельзя удалить' });
    data.broadcasts = data.broadcasts.filter((item) => item.id !== entry.id);
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Не найдено' });
}

export {
  handleApi,
  portableBackupData,
  sendBackupDownload,
};
