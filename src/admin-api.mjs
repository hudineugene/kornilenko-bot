// Панель: API и резервные копии.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cleanText, clone, dayKey, delay, hashPassword } from './util.mjs';
import { normalizeLoadedData } from './data-format.mjs';
import { dropMissingImages, forEachStoredImage, imageBytes } from './media.mjs';
import { applyInterfaceText, normalizedInterfaceText } from './texts.mjs';
import { configured, data, replaceData, restoreMissingMedia, runtime, saveDataNow, verifyPassword, verifyPasswordAsync } from './store.mjs';
import { mediaReport, runSelfCheck } from './selfcheck.mjs';
import { handleContentApi } from './admin-api-content.mjs';
import { handleClientsApi } from './admin-api-clients.mjs';
import { handleSettingsApi } from './admin-api-settings.mjs';
import { recordError } from './analytics.mjs';
import { rebuildUserIndex, userById } from './users.mjs';
import { sendMessage, telegramFileIds, telegramRequest } from './telegram.mjs';
import { configureBotCommands } from './menus.mjs';
import { validHttpUrl, whatsappContactUrl } from './catalog.mjs';
import { restartPolling } from './updates.mjs';
import { broadcastUsers, deliverBroadcast, runBroadcast } from './broadcasts.mjs';
import { BOT_TOKEN_PATTERN, DOWNLOAD_TICKET_MS, MAX_UNAUTHENTICATED_BODY_BYTES, clientAddress, headerPassword, issueDownloadTicket, passwordAccepted, useDownloadTicket, createSession, isLocalRequest, json, loginAttempts, parseUploadedImage, readBackup, readJson, requestIsRemote, requireAuth, safeState, securityHeaders, sessions } from './admin-http.mjs';
import { REMOTE_LOGIN_CODE_ATTEMPTS, pendingRemoteLogins, remoteLoginCodeHash, startDecoyRemoteLogin, startRemoteLogin, startTunnel, stopTunnel, tunnelInstalled } from './remote.mjs';
import { attemptKey, loginAllowed, menuInput, messagesInput, parseBroadcast, translatedInput, validateBackupPayload } from './admin-input.mjs';
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
    const correct = await verifyPasswordAsync(String(body.password || ''));
    const remote = requestIsRemote(req);
    // Из интернета ответ одинаковый и на верный, и на неверный пароль: иначе
    // перебор узнавал бы пароль, не имея доступа к коду из Telegram.
    if (remote) {
      if (!correct) {
        await delay(250);
        return startDecoyRemoteLogin(res);
      }
      return startRemoteLogin(res, ip);
    }
    if (!correct) {
      await delay(250);
      return json(res, 401, { error: 'Неверный пароль' });
    }
    loginAttempts.delete(attemptKey(ip));
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
    // Подставной вход: пароль был неверным, код совпасть не может.
    if (pending.decoy) {
      await delay(250);
      return json(res, 401, { error: 'Неверный код' });
    }
    loginAttempts.delete(attemptKey(ip));
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

  // Пропуск на скачивание копии: выдаётся по текущему паролю на две минуты.
  if (url.pathname === '/api/backup/ticket' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    if (!passwordAccepted(req, res, body.currentPassword)) return;
    return json(res, 200, { ticket: issueDownloadTicket(), validMs: DOWNLOAD_TICKET_MS });
  }

  if (url.pathname === '/api/backup' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    // В копии лежат токен бота и данные клиентов, поэтому одной сессии мало.
    if (!useDownloadTicket(url.searchParams.get('ticket'))) {
      return json(res, 403, { error: 'Ссылка на копию устарела. Запросите копию заново и введите пароль.' });
    }
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
    // Восстановление заменяет все данные бота: просим текущий пароль.
    if (!passwordAccepted(req, res, headerPassword(req))) return;
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

  // Разделы панели живут своими модулями; каждый сам отвечает клиенту.
  if (await handleContentApi(req, res, url) !== false) return;
  if (await handleClientsApi(req, res, url) !== false) return;
  if (await handleSettingsApi(req, res, url) !== false) return;

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

  // Тексты интерфейса — больше половины веса общего пакета, поэтому панель
  // просит их только на своём экране.
  if (url.pathname === '/api/interface-text' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, { interfaceText: normalizedInterfaceText(data.interfaceText) });
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
