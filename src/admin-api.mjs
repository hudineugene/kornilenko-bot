// Панель: API и резервные копии.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cleanText, clone, dayKey, delay, hashPassword } from './util.mjs';
import { CLOCK_TIME_PATTERN, DAY_KEY_PATTERN, MAX_REPLY_TEMPLATES, PIPELINE_STAGES, REMINDER_HOUR_OPTIONS, MAX_MANAGERS, TIME_ZONES, normalizeCalculator, normalizeLoadedData, normalizeManagers, normalizeTimeZone, normalizeViewingSlots, normalizeWorkingHours, pruneOrphanPropertyAnalytics } from './data-format.mjs';
import { dropMissingImages, forEachStoredImage, imageBytes, imageExists } from './media.mjs';
import { MANAGER_CONTACT_TEXT, applyInterfaceText, normalizedInterfaceText } from './texts.mjs';
import { applyConfiguredTimeZone, configured, data, replaceData, restoreMissingMedia, runtime, saveDataNow, verifyPassword } from './store.mjs';
import { mediaReport, runSelfCheck } from './selfcheck.mjs';
import { recordError } from './analytics.mjs';
import { eraseUserData, rebuildUserIndex, userByChatId, userById, userDataExport } from './users.mjs';
import { forgetTelegramFileIds, sendDocumentMessage, sendMessage, sendPhotoMessage, telegramFileIds, telegramRequest } from './telegram.mjs';
import { configureBotCommands, menuKeyboard } from './menus.mjs';
import { appendInquiryMessage, inquiryChats, inquiryTimelineMessage } from './inquiries.mjs';
import { recordImages, validHttpUrl, whatsappContactUrl } from './catalog.mjs';
import { findRule, restartPolling } from './updates.mjs';
import { broadcastUsers, deliverBroadcast, runBroadcast, userUnavailableError } from './broadcasts.mjs';
import { BOT_TOKEN_PATTERN, MAX_UNAUTHENTICATED_BODY_BYTES, binaryImage, clientAddress, createSession, isLocalRequest, json, loginAttempts, parseUploadedDocument, parseUploadedImage, readBackup, readJson, requestIsRemote, requireAuth, safeState, securityHeaders, sessions } from './admin-http.mjs';
import { REMOTE_LOGIN_CODE_ATTEMPTS, pendingRemoteLogins, remoteLoginCodeHash, startRemoteLogin, startTunnel, stopTunnel, tunnelInstalled } from './remote.mjs';
import { loginAllowed, menuInput, messagesInput, parseBroadcast, parseContentRecord, replyTemplateInput, rulesConflict, translatedInput, validateBackupPayload } from './admin-input.mjs';
import { INQUIRY_EXPORT_COLUMNS, inquiryExportRows, xlsxWorkbook } from './excel.mjs';
import { queuePropertyAlerts } from './alerts.mjs';
import { confirmViewing } from './viewings.mjs';
import { announceActiveChange } from './status.mjs';
import { MIN_BACKUP_PASSWORD_LENGTH, sendTelegramBackup, setBackupPassword, telegramBackupSettings } from './offsite.mjs';
import { applyImport, feedSettings, fetchFeed, planImport, planSummary, readFeed } from './feed-import.mjs';
import { handleGroupApi } from './group-api.mjs';
import { autostartStatus, setAutostart } from './autostart.mjs';
import { readAllAdminNotifications, updateAdminNotification } from './admin-notifications.mjs';

function portableBackupData() {
  const payload = clone(data);
  // The key of the Telegram copy stays on this computer: with it, anyone
  // holding this file could open every weekly copy in the admin chat.
  if (payload.config && payload.config.telegramBackup) payload.config.telegramBackup = { enabled: false };
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


// /inbox, /viewings and /stats are in the command menu of the admin and
// manager chats only: a chat that is no longer one of them loses them.
function refreshStaffCommands(previousChatIds = []) {
  const token = data.config.botToken;
  if (!token || !data.config.active) return;
  const current = new Set(inquiryChats().map((chat) => chat.chatId));
  for (const chatId of previousChatIds) {
    if (current.has(chatId)) continue;
    telegramRequest(token, 'deleteMyCommands', { scope: { type: 'chat', chat_id: chatId } }).catch(() => {});
  }
  configureBotCommands(token).catch((error) => recordError('Обновление команд Telegram', error));
}

async function handleApi(req, res, url) {
  // Groups live in their own module: publishing, members, rights, links.
  if (await handleGroupApi(req, res, url)) return;
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

  if (url.pathname === '/api/autostart' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, autostartStatus());
  }

  if (url.pathname === '/api/autostart' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    try {
      return json(res, 200, setAutostart(body.enabled === true));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
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

  if (url.pathname === '/api/admin-notifications/read-all' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    readAllAdminNotifications();
    return json(res, 200, { ok: true });
  }

  const adminNotificationMatch = url.pathname.match(/^\/api\/admin-notifications\/([^/]+)$/);
  if (adminNotificationMatch && req.method === 'PATCH') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const action = cleanText(body.action, 20);
    if (!['read', 'unread', 'handle', 'reopen'].includes(action)) return json(res, 400, { error: 'Некорректное действие с уведомлением' });
    const changed = updateAdminNotification(decodeURIComponent(adminNotificationMatch[1]), action);
    if (!changed) return json(res, 404, { error: 'Уведомление больше не актуально' });
    return json(res, 200, { ok: true });
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
      const missingPhotos = dropMissingImages(backup);
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
      return json(res, 200, { ok: true, csrf: nextSession.csrf, missingPhotos });
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

  // Самопроверка: токен и связь, админ-чат, каталог, файлы картинок, версия
  // данных. Только читает.
  if (url.pathname === '/api/self-check' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, runSelfCheck());
  }

  // Сверка картинок в данных с файлами на диске; по запросу возвращает
  // потерянные файлы из ежедневной копии.
  if (url.pathname === '/api/media-check' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    let restored = 0;
    if (body.restore) {
      try {
        restored = restoreMissingMedia(data);
      } catch (error) {
        return json(res, 500, { error: 'Не удалось вернуть файлы: ' + error.message });
      }
    }
    return json(res, 200, { ...mediaReport(), restored });
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

  // Плашка рубрики лежит в настройках, а не в коллекции.
  const rubricMatch = url.pathname.match(/^\/api\/media\/rubrics\/([^/]+)$/);
  if (rubricMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const rubrics = (data.config.publishing && data.config.publishing.rubrics) || [];
    const rubric = rubrics.find((item) => item.id === decodeURIComponent(rubricMatch[1]));
    if (!rubric || !imageExists(rubric.image)) return json(res, 404, { error: 'Изображение не найдено' });
    return binaryImage(res, rubric.image);
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

  // A property-centric view for the manager: aggregate counters plus the
  // clients who showed a concrete signal of interest. Keeping this endpoint
  // separate avoids limiting the list to the 500 users returned by /api/state.
  const propertyInsightsMatch = url.pathname.match(/^\/api\/objects\/([^/]+)\/insights$/);
  if (propertyInsightsMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const propertyId = decodeURIComponent(propertyInsightsMatch[1]);
    const record = data.objects.find((item) => String(item.id) === propertyId);
    if (!record) return json(res, 404, { error: 'Объект не найден' });
    const raw = (data.analytics && data.analytics.properties && data.analytics.properties[propertyId]) || {};
    const relatedInquiries = data.inquiries.filter((item) => String(item.propertyId || '') === propertyId);
    const resetAt = Date.parse(data.stats && data.stats.statisticsResetAt || '') || 0;
    const periodInquiries = resetAt
      ? relatedInquiries.filter((item) => (Date.parse(item.createdAt || '') || 0) >= resetAt)
      : relatedInquiries;
    const inquiriesByUser = new Map();
    for (const inquiry of relatedInquiries) {
      const userId = String(inquiry.userId || '');
      if (!userId) continue;
      const current = inquiriesByUser.get(userId) || [];
      current.push(inquiry);
      inquiriesByUser.set(userId, current);
    }
    function includesProperty(values) {
      return Array.isArray(values) && values.some((value) => String(value) === propertyId);
    }
    const clients = Object.values(data.users).map((user) => {
      const inquiries = (inquiriesByUser.get(String(user.id)) || []).sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0));
      const signals = [];
      if (includesProperty(user.favorites)) signals.push('favorite');
      if (includesProperty(user.comparisonIds)) signals.push('comparison');
      if (includesProperty(user.recentlyViewed)) signals.push('viewed');
      if (includesProperty(user.selectionMatchIds)) signals.push('match');
      if (inquiries.length) signals.push('inquiry');
      if (!signals.length) return null;
      return {
        id: String(user.id), firstName: user.firstName || '', lastName: user.lastName || '', contactName: user.contactName || '',
        username: user.username || '', phone: user.phone || '', preferredLanguage: user.preferredLanguage || '', source: user.source || '',
        blocked: Boolean(user.blocked), lastSeenAt: user.lastSeenAt || '', signals, inquiryCount: inquiries.length,
        latestInquiryId: inquiries[0] ? inquiries[0].id : '', latestInquiryStatus: inquiries[0] ? inquiries[0].status : '',
        latestInquiryAt: inquiries[0] ? inquiries[0].updatedAt || inquiries[0].createdAt || '' : '',
      };
    }).filter(Boolean).sort((a, b) => {
      const weight = (client) => (client.signals.includes('inquiry') ? 100 : 0) + (client.signals.includes('favorite') ? 20 : 0) + (client.signals.includes('comparison') ? 10 : 0);
      return weight(b) - weight(a) || (Date.parse(b.latestInquiryAt || b.lastSeenAt) || 0) - (Date.parse(a.latestInquiryAt || a.lastSeenAt) || 0);
    });
    const countSignal = (signal) => clients.filter((client) => client.signals.includes(signal)).length;
    return json(res, 200, {
      propertyId,
      analytics: {
        impressions: Number(raw.impressions || raw.views || 0), details: Number(raw.details || 0), galleries: Number(raw.galleries || 0),
        managerContacts: Number(raw.managerContacts || 0), similar: Number(raw.similar || 0), availability: Number(raw.availability || 0),
        interests: Number(raw.interests || 0), viewings: Number(raw.viewings || 0), questions: Number(raw.questions || 0),
        favorites: Number(raw.favorites || 0), calculator: Number(raw.calculator || 0), updatedAt: raw.updatedAt || '',
      },
      summary: {
        clients: clients.length, inquiries: periodInquiries.length, inquiryClients: new Set(periodInquiries.map((item) => String(item.userId || '')).filter(Boolean)).size,
        viewings: periodInquiries.filter((item) => item.type === 'viewing').length,
        favorites: countSignal('favorite'), comparisons: countSignal('comparison'), viewed: countSignal('viewed'), matches: countSignal('match'),
      },
      clients: clients.slice(0, 1000),
    });
  }

  // A copy of a property to start a similar one: hidden until the admin
  // checks it, placed right after the original, sharing the photo files.
  const duplicateMatch = url.pathname.match(/^\/api\/objects\/([^/]+)\/duplicate$/);
  if (duplicateMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const index = data.objects.findIndex((item) => item.id === decodeURIComponent(duplicateMatch[1]));
    if (index < 0) return json(res, 404, { error: 'Объект не найден' });
    const copy = clone(data.objects[index]);
    const now = new Date().toISOString();
    const suffix = { ru: ' (копия)', en: ' (copy)', es: ' (copia)' };
    copy.id = crypto.randomUUID();
    copy.status = 'hidden';
    copy.reference = '';
    copy.createdAt = now;
    copy.updatedAt = now;
    copy.title = Object.fromEntries(['ru', 'en', 'es'].map((language) => {
      const title = cleanText(copy.title && copy.title[language], 160);
      return [language, title ? cleanText(title + suffix[language], 160) : ''];
    }));
    for (const language of ['ru', 'en', 'es']) {
      const images = copy.imagesByLanguage && Array.isArray(copy.imagesByLanguage[language]) ? copy.imagesByLanguage[language] : [];
      for (const image of images) image.id = crypto.randomUUID();
    }
    data.objects.splice(index + 1, 0, copy);
    saveDataNow();
    return json(res, 201, { ok: true, id: copy.id });
  }

  // The catalog shows properties in this order.
  const moveMatch = url.pathname.match(/^\/api\/objects\/([^/]+)\/move$/);
  if (moveMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const step = Number(body.step);
    if (![-1, 1].includes(step)) return json(res, 400, { error: 'Некорректное направление' });
    const index = data.objects.findIndex((item) => item.id === decodeURIComponent(moveMatch[1]));
    if (index < 0) return json(res, 404, { error: 'Объект не найден' });
    const target = index + step;
    if (target < 0 || target >= data.objects.length) return json(res, 200, { ok: true, moved: false });
    [data.objects[index], data.objects[target]] = [data.objects[target], data.objects[index]];
    saveDataNow();
    return json(res, 200, { ok: true, moved: true });
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
    if (body.contactName != null) user.contactName = cleanText(body.contactName, 120);
    if (body.phone != null) user.phone = cleanText(body.phone, 80);
    if (body.preferredContactTime != null) user.preferredContactTime = cleanText(body.preferredContactTime, 160);
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
      const matches = scope === 'all' ? true : scope === 'closed' ? inquiry.status === 'closed' : inquiry.status !== 'new';
      if (matches && old) removed += 1;
      else keep.push(inquiry);
    }
    data.inquiries = keep;
    saveDataNow();
    return json(res, 200, { ok: true, removed, left: data.inquiries.length });
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
      securityHeaders(res);
      res.writeHead(200, {
        'content-type': attachment.mimeType || response.headers.get('content-type') || 'application/octet-stream',
        'content-disposition': "inline; filename*=UTF-8''" + encodeURIComponent(fileName),
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
    if (body.timeZone != null && !TIME_ZONES.includes(String(body.timeZone))) return json(res, 400, { error: 'Некорректный часовой пояс' });

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
    if (body.timeZone != null) data.config.timeZone = normalizeTimeZone(body.timeZone);
    if (typeof body.statusNotices === 'boolean') data.config.statusNotices = body.statusNotices;
    const staffChatsBefore = inquiryChats().map((chat) => chat.chatId);
    if (adminChatId !== previousAdminChatId) {
      data.config.adminNotificationVerifiedAt = '';
      // Plain keys are message numbers in the old admin chat; in the new chat
      // the same numbers are other messages and must not route replies.
      for (const key of Object.keys(data.adminReplyTargets || {})) if (!key.includes(':')) delete data.adminReplyTargets[key];
      // A manager who became the main admin is not listed twice.
      data.config.managers = (data.config.managers || []).filter((manager) => manager.chatId !== adminChatId);
    }
    data.config.messages = nextMessages;
    const activeChanged = data.config.active !== Boolean(body.active);
    data.config.active = Boolean(body.active);
    applyConfiguredTimeZone();
    saveDataNow();
    if (activeChanged || tokenChanged) restartPolling();
    if (activeChanged) announceActiveChange(data.config.active);
    if (adminChatId !== previousAdminChatId) refreshStaffCommands(staffChatsBefore);
    if (passwordData) {
      for (const id of sessions.keys()) if (id !== session.id) sessions.delete(id);
    }
    return json(res, 200, { ok: true });
  }

  // Properties from the website's XML feed (Kyero format): a preview first,
  // then the import; optionally every day from the saved link.
  if ((url.pathname === '/api/feed/preview' || url.pathname === '/api/feed/import') && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    try {
      const address = cleanText(body.url, 1000);
      const xml = typeof body.xml === 'string' && body.xml.trim() ? body.xml : await fetchFeed(address);
      const items = readFeed(xml);
      if (url.pathname === '/api/feed/preview') return json(res, 200, { ok: true, ...planSummary(planImport(items)) });
      const settings = feedSettings();
      const result = await applyImport(items, { publishNew: body.publishNew === true });
      data.config.feedImport = { ...settings, url: address || settings.url, publishNew: body.publishNew === true, lastRunAt: new Date().toISOString(), lastResult: result, lastError: '' };
      saveDataNow();
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (url.pathname === '/api/feed/settings' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const address = cleanText(body.url, 1000);
    if (address && !validHttpUrl(address)) return json(res, 400, { error: 'Ссылка на выгрузку должна начинаться с http:// или https://' });
    if (body.daily === true && !address) return json(res, 400, { error: 'Для ежедневного обновления укажите ссылку на выгрузку' });
    data.config.feedImport = { ...feedSettings(), url: address, daily: body.daily === true, publishNew: body.publishNew === true };
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/managers' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const list = Array.isArray(body.managers) ? body.managers.slice(0, 20) : [];
    const adminChatId = cleanText(data.config.adminChatId, 40);
    const seen = new Set();
    for (const item of list) {
      const name = cleanText(item && item.name, 60);
      const chatId = cleanText(item && item.chatId, 40);
      if (!name) return json(res, 400, { error: 'Укажите имя каждого менеджера' });
      if (!/^-?\d{4,20}$/.test(chatId)) return json(res, 400, { error: 'Chat ID менеджера «' + name + '» должен состоять из цифр' });
      if (chatId === adminChatId) return json(res, 400, { error: 'Chat ID менеджера «' + name + '» совпадает с чатом главного администратора' });
      if (seen.has(chatId)) return json(res, 400, { error: 'Chat ID ' + chatId + ' указан дважды' });
      seen.add(chatId);
    }
    if (list.length > MAX_MANAGERS) return json(res, 400, { error: 'Можно добавить не больше ' + MAX_MANAGERS + ' менеджеров' });
    const previous = new Map((data.config.managers || []).map((manager) => [manager.chatId, manager]));
    const staffChatsBefore = inquiryChats().map((chat) => chat.chatId);
    data.config.adminName = cleanText(body.adminName, 60);
    // A chat that stays the same keeps its checked state.
    data.config.managers = normalizeManagers(list.map((item) => {
      const chatId = cleanText(item.chatId, 40);
      const old = previous.get(chatId);
      return { id: old ? old.id : '', name: item.name, chatId, verifiedAt: old ? old.verifiedAt : '' };
    }), adminChatId);
    saveDataNow();
    refreshStaffCommands(staffChatsBefore);
    return json(res, 200, { ok: true });
  }

  const managerTestMatch = url.pathname.match(/^\/api\/managers\/([^/]+)\/test$/);
  if (managerTestMatch && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const manager = (data.config.managers || []).find((item) => item.id === decodeURIComponent(managerTestMatch[1]));
    if (!manager) return json(res, 404, { error: 'Менеджер не найден — сначала сохраните список' });
    try {
      await sendMessage(manager.chatId, '✅ ' + manager.name + ', уведомления работают. Сюда будут приходить заявки клиентов: отвечайте на уведомление — ответ получит клиент; «⏳ В работу» закрепит заявку за вами. Команды: /inbox — без ответа, /viewings — просмотры, /stats — цифры.', data.config.botToken, { track: false });
      manager.verifiedAt = new Date().toISOString();
      saveDataNow();
      return json(res, 200, { ok: true });
    } catch (error) {
      manager.verifiedAt = '';
      saveDataNow();
      const notFound = /chat not found/i.test(String(error && error.message));
      return json(res, 400, { error: notFound ? 'Telegram не нашёл этот чат. Менеджер должен открыть бота, отправить /start, затем /myid — и прислать вам полученный номер.' : 'Не удалось отправить: ' + error.message });
    }
  }

  if (url.pathname === '/api/telegram-backup' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const enabled = body.enabled === true;
    const password = String(body.password || '');
    // Sending all data out of this computer needs the admin password, as
    // changing the token does.
    if (enabled || password) {
      const ip = clientAddress(req);
      if (!loginAllowed(ip)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
      if (!verifyPassword(String(body.currentPassword || ''))) {
        await delay(250);
        return json(res, 403, { error: 'Введите текущий пароль администратора' });
      }
      loginAttempts.delete(ip);
    }
    if (password) {
      if (password.length < MIN_BACKUP_PASSWORD_LENGTH) return json(res, 400, { error: 'Пароль копии — не короче ' + MIN_BACKUP_PASSWORD_LENGTH + ' символов' });
      if (password !== String(body.passwordConfirm || '')) return json(res, 400, { error: 'Пароли копии не совпадают' });
      if (verifyPassword(password)) return json(res, 400, { error: 'Пароль копии должен отличаться от пароля панели' });
      setBackupPassword(password);
    }
    const settings = telegramBackupSettings();
    if (enabled && !settings.key) return json(res, 400, { error: 'Задайте пароль копии' });
    if (enabled && !data.config.adminChatId) return json(res, 400, { error: 'Сначала подключите админ-чат в Telegram' });
    data.config.telegramBackup = { ...settings, enabled };
    saveDataNow();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/telegram-backup/send' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    if (!telegramBackupSettings().enabled) return json(res, 400, { error: 'Сначала включите копию в Telegram' });
    try {
      const size = await sendTelegramBackup();
      return json(res, 200, { ok: true, size });
    } catch (error) {
      recordError('Копия данных в Telegram', error);
      return json(res, 400, { error: 'Не удалось отправить копию: ' + error.message });
    }
  }

  if (url.pathname === '/api/viewing-slots' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const times = (Array.isArray(body.times) ? body.times : String(body.times || '').split(/[,;\s]+/)).map((time) => String(time).trim()).filter(Boolean);
    const wrong = times.find((time) => !CLOCK_TIME_PATTERN.test(time));
    if (wrong) return json(res, 400, { error: 'Время «' + cleanText(wrong, 20) + '» укажите в формате ЧЧ:ММ, например 10:00' });
    const days = Array.isArray(body.days) ? body.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
    if (body.enabled === true && (!days.length || !times.length)) return json(res, 400, { error: 'Отметьте дни и укажите хотя бы одно время' });
    const daysAhead = Number(body.daysAhead);
    const perSlot = Number(body.perSlot);
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 30) return json(res, 400, { error: 'Запись вперёд — от 1 до 30 дней' });
    if (!Number.isInteger(perSlot) || perSlot < 1 || perSlot > 5) return json(res, 400, { error: 'Просмотров в одно время — от 1 до 5' });
    data.config.viewingSlots = normalizeViewingSlots({ enabled: body.enabled === true, days, times, daysAhead, perSlot });
    saveDataNow();
    return json(res, 200, { ok: true, viewingSlots: data.config.viewingSlots });
  }

  if (url.pathname === '/api/calculator' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const limits = {
      resaleTaxPercent: ['Налог на вторичное жильё', 0, 30],
      newBuildTaxPercent: ['НДС на новостройку', 0, 30],
      stampDutyPercent: ['Гербовый сбор', 0, 10],
      otherCostsPercent: ['Нотариус и прочие расходы', 0, 10],
      downPaymentPercent: ['Первый взнос', 0, 100],
      interestPercent: ['Ставка по ипотеке', 0, 20],
      years: ['Срок ипотеки', 1, 40],
    };
    for (const [key, [label, min, max]] of Object.entries(limits)) {
      const value = Number(body[key]);
      if (body[key] === '' || !Number.isFinite(value) || value < min || value > max) return json(res, 400, { error: '«' + label + '»: укажите число от ' + min + ' до ' + max });
    }
    data.config.calculator = normalizeCalculator({ ...body, enabled: body.enabled === true });
    saveDataNow();
    return json(res, 200, { ok: true, calculator: data.config.calculator });
  }

  if (url.pathname === '/api/working-hours' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    if (body.timeZone != null && !TIME_ZONES.includes(String(body.timeZone))) return json(res, 400, { error: 'Некорректный часовой пояс' });
    if (!CLOCK_TIME_PATTERN.test(String(body.from || '')) || !CLOCK_TIME_PATTERN.test(String(body.to || ''))) return json(res, 400, { error: 'Время укажите в формате ЧЧ:ММ' });
    if (String(body.from) >= String(body.to)) return json(res, 400, { error: 'Конец рабочего дня должен быть позже начала' });
    const days = Array.isArray(body.days) ? body.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
    if (body.enabled === true && !days.length) return json(res, 400, { error: 'Отметьте хотя бы один рабочий день' });
    const note = body.note && typeof body.note === 'object' ? body.note : {};
    for (const language of ['ru', 'en', 'es']) {
      if (cleanText(note[language], 500) && !String(note[language]).includes('{next}')) return json(res, 400, { error: 'В тексте для клиента оставьте {next} — туда бот подставит, когда ответит менеджер' });
    }
    data.config.workingHours = normalizeWorkingHours({ enabled: body.enabled === true, days, from: body.from, to: body.to, note });
    if (body.timeZone != null) data.config.timeZone = normalizeTimeZone(body.timeZone);
    applyConfiguredTimeZone();
    saveDataNow();
    return json(res, 200, { ok: true, workingHours: data.config.workingHours });
  }

  if (url.pathname === '/api/broadcast/estimate' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    try {
      const entry = parseBroadcast(await readJson(req), {}, { requireMessages: false, requireSelectedTexts: false });
      const users = broadcastUsers(entry);
      const byLanguage = { ru: 0, en: 0, es: 0 };
      for (const user of users) byLanguage[['ru', 'en', 'es'].includes(user.preferredLanguage) ? user.preferredLanguage : 'ru'] += 1;
      const sample = users.slice(0, 5).map((user) => cleanText(user.contactName || [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? '@' + user.username : 'Клиент ' + user.id), 160));
      return json(res, 200, { total: users.length, byLanguage, sample });
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
        if (!broadcastUsers(entry).length) throw new Error('Для выбранных условий нет получателей');
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
      const mode = ['draft', 'schedule', 'send'].includes(body.mode) ? body.mode : 'draft';
      const nextStatus = mode === 'schedule' ? 'scheduled' : mode === 'send' ? 'queued' : 'draft';
      const updated = parseBroadcast(body, entry, {
        requireMessages: nextStatus !== 'draft',
        requireSelectedTexts: nextStatus !== 'draft',
      });
      updated.status = nextStatus;
      if (updated.status === 'scheduled' && (!updated.scheduledAt || Date.parse(updated.scheduledAt) <= Date.now())) throw new Error('Укажите будущую дату и время');
      if (updated.status === 'queued') {
        if (!data.config.active) throw new Error('Сначала включите бота в настройках');
        if (runtime.broadcastRunning) return json(res, 409, { error: 'Предыдущая рассылка еще выполняется' });
        if (!broadcastUsers(updated).length) throw new Error('Для выбранных условий нет получателей');
      }
      Object.assign(entry, updated);
      saveDataNow();
      if (mode === 'send') void runBroadcast(entry).catch((error) => {
        entry.status = 'failed';
        entry.error = cleanText(error.message, 400);
        runtime.lastError = error.message;
        recordError('Рассылка', error);
      });
      return json(res, mode === 'send' ? 202 : 200, { ok: true, total: broadcastUsers(entry).length });
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
