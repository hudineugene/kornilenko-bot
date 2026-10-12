// Панель: API и резервные копии.

import { miniAppSettings } from './miniapp/settings.mjs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cleanText, clone, delay, hashPassword, localDayKey } from './util.mjs';
import { MAX_TRUST_REVIEWS, normalizeEngagement, normalizeLoadedData, normalizeTrust } from './data-format.mjs';
import { backupChunks } from './backup-file.mjs';
import { dropMissingImages, storedMediaFiles } from './media.mjs';
import { applyInterfaceText, normalizedInterfaceText } from './texts.mjs';
import { applyConfiguredTimeZone, configured, data, replaceData, restoreMissingMedia, runtime, saveDataNow, snapshotBeforeRestore, verifyPassword, verifyPasswordAsync } from './store.mjs';
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
import {
  BOT_TOKEN_PATTERN,
  clientAddress,
  createSession,
  DOWNLOAD_TICKET_MS,
  headerPassword,
  isLocalRequest,
  issueDownloadTicket,
  json,
  loginAttempts,
  MAX_UNAUTHENTICATED_BODY_BYTES,
  ownPageRequest,
  parseUploadedImage,
  passwordAccepted,
  readBackup,
  readJson,
  requestIsRemote,
  requireAuth,
  safeState,
  securityHeaders,
  sendJsonText,
  sessions,
  stateFingerprint,
  useDownloadTicket,
  writeBackupMedia,
} from './admin-http.mjs';
import { CLOUDFLARED_PATH, REMOTE_LOGIN_ANSWER_MS, REMOTE_LOGIN_CODE_ATTEMPTS, decoyRemoteLogin, pendingRemoteLogins, remoteLoginCodeHash, startRemoteLogin, startTunnel, stopTunnel, tunnelInstalled } from './remote.mjs';
import { attemptKey, forgetLoginAttempts, loginAllowed, rememberFailedLogin, validateBackupStructure, validatePartsBackup, validatePartsPayload, menuInput, messagesInput, parseBroadcast, translatedInput, validateBackupPayload } from './admin-input.mjs';
import { handleGroupApi } from './group-api.mjs';
import { openEventStream } from './panel-events.mjs';
import { autostartStatus, setAutostart } from './autostart.mjs';
import { readAllAdminNotifications, updateAdminNotification } from './admin-notifications.mjs';
import { LANGUAGES } from './languages.mjs';

function hasGalleryImages(record) {
  const byLanguage = record && record.imagesByLanguage;
  return !!byLanguage && Object.values(byLanguage).some((list) => Array.isArray(list) && list.length > 0);
}

function portableBackupData() {
  const payload = clone(data);
  // The key of the Telegram copy stays on this computer: with it, anyone
  // holding this file could open every weekly copy in the admin chat.
  if (payload.config && payload.config.telegramBackup) payload.config.telegramBackup = { enabled: false };
  return payload;
}

// Копия собирается по кусочкам и сразу уходит в ответ: данные, потом
// фотографии по одной. Раньше бот держал в памяти и снимки в base64, и строку
// JSON, и её байты — для 50 МБ фотографий это под три сотни мегабайт.
function sendBackupDownload(res, filename) {
  securityHeaders(res);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="' + filename + '"',
    'cache-control': 'no-store',
  });
  for (const chunk of backupChunks(portableBackupData(), storedMediaFiles(data))) res.write(chunk);
  res.end();
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
    // Иначе чужая страница в браузере могла бы настроить бота на свой токен.
    if (!ownPageRequest(req)) return json(res, 403, { error: 'Запрос пришёл со стороннего сайта' });
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
    // Проверяем до счётчика попыток: иначе чужая страница могла бы забить
    // счётчик и запереть вход владельцу.
    if (!ownPageRequest(req)) return json(res, 403, { error: 'Запрос пришёл со стороннего сайта' });
    const ip = clientAddress(req);
    const local = isLocalRequest(req);
    if (!loginAllowed(ip, { local })) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
    const startedAt = Date.now();
    const correct = await verifyPasswordAsync(String(body.password || ''));
    // Код из Telegram — только если он включён в панели; иначе из интернета входят по паролю, как с этого компьютера.
    const remote = !local && data.config.loginCodeRequired === true;
    // Из интернета ответ одинаковый и на верный, и на неверный пароль: иначе
    // перебор узнавал бы пароль, не имея доступа к коду из Telegram. Одинаков
    // и по времени: раньше верный пароль выдавал себя задержкой на отправку
    // кода в Telegram.
    if (remote) {
      if (!correct) rememberFailedLogin(ip, { local });
      const answer = correct ? await startRemoteLogin(res, ip, { defer: true }) : decoyRemoteLogin();
      await delay(Math.max(0, REMOTE_LOGIN_ANSWER_MS - (Date.now() - startedAt)));
      return json(res, 200, answer);
    }
    if (!correct) {
      rememberFailedLogin(ip, { local });
      await delay(250);
      return json(res, 401, { error: 'Неверный пароль' });
    }
    forgetLoginAttempts(ip);
    const session = createSession(res, req);
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  if (url.pathname === '/api/login/verify' && req.method === 'POST') {
    if (!ownPageRequest(req)) return json(res, 403, { error: 'Запрос пришёл со стороннего сайта' });
    const ip = clientAddress(req);
    const localVerify = isLocalRequest(req);
    if (!loginAllowed(ip, { local: localVerify })) return json(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    const body = await readJson(req, MAX_UNAUTHENTICATED_BODY_BYTES);
    const challenge = cleanText(body.challenge, 100);
    const pending = pendingRemoteLogins.get(challenge);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingRemoteLogins.delete(challenge);
      return json(res, 401, { error: 'Код устарел. Введите пароль ещё раз.', expired: true });
    }
    pending.attempts += 1;
    if (pending.attempts > REMOTE_LOGIN_CODE_ATTEMPTS) {
      rememberFailedLogin(ip, { local: localVerify });
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
      rememberFailedLogin(ip, { local: localVerify });
      await delay(250);
      return json(res, 401, { error: 'Неверный код' });
    }
    forgetLoginAttempts(ip);
    const session = createSession(res, req);
    return json(res, 200, { ok: true, csrf: session.csrf });
  }

  // Код из Telegram при входе из интернета: включить можно сразу, выключить — только с текущим паролем.
  if (url.pathname === '/api/login-code' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const required = body.required === true;
    if (!required && data.config.loginCodeRequired === true) {
      if (!(await passwordAccepted(req, res, headerPassword(req)))) return;
    }
    // Код приходит в админ-чат: без подтверждённого чата вход из интернета остался бы без кода и без входа.
    if (required && !(cleanText(data.config.adminChatId, 40) && data.config.adminNotificationVerifiedAt && data.config.botToken)) {
      return json(res, 400, { error: 'Код приходит в админ-чат Telegram. Сначала подключите чат и проверьте его в «Настройки → Команда и доступ».' });
    }
    data.config.loginCodeRequired = required;
    saveDataNow();
    return json(res, 200, { ok: true, required });
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
    // Включение доступа из интернета и подмена туннеля — самое опасное, что
    // можно сделать из панели: чужой туннель открывает путь с этого
    // компьютера в домашнюю сеть. Одной открытой (или украденной) сессии для
    // этого мало — просим текущий пароль, как у восстановления копии.
    const changesTunnel = body.tunnelHostname != null || body.tunnelToken != null;
    if (enabled || changesTunnel || data.config.remoteAccess) {
      if (!(await passwordAccepted(req, res, headerPassword(req)))) return;
    }
    if (body.tunnelHostname != null) {
      const hostname = cleanText(body.tunnelHostname, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (hostname && !/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
        return json(res, 400, { error: 'Адрес панели должен быть доменным именем, например panel.example.com' });
      }
      if (hostname && miniAppSettings().url && new URL(miniAppSettings().url).hostname.toLowerCase() === hostname) {
        return json(res, 400, { error: 'Этот адрес уже занят приложением в Telegram: выберите другой для панели' });
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
        return json(res, 400, { error: process.platform === 'win32' ? 'Рядом с ботом нет cloudflared.exe — без него туннель не запустить.' : 'Не найдена программа cloudflared (' + CLOUDFLARED_PATH + ') — без неё туннель не запустить.' });
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

  // Токен защиты отдельным коротким (несжимаемым) ответом: в сжатое состояние он не
  // попадает, а панели, открытой заново, он нужен для первого же сохранения.
  if (url.pathname === '/api/csrf' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, { csrf: session.csrf });
  }

  // Поток «данные изменились» для открытой панели (панель сама спрашивает новое, см. panel-events.mjs).
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    openEventStream(req, res, securityHeaders);
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    // The panel polls every few seconds. When nothing changed since the
    // version it already has, answer with a tiny body and let it skip
    // re-rendering.
    const state = safeState(session);
    const serialized = JSON.stringify(state);
    const stateVersion = stateFingerprint(state);
    if (url.searchParams.get('since') === stateVersion) return json(res, 200, { unchanged: true, stateVersion });
    return sendJsonText(res, 200, serialized.slice(0, -1) + ',"stateVersion":"' + stateVersion + '"}', session.csrf);
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
      for (const language of LANGUAGES) {
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
    if (!(await passwordAccepted(req, res, body.currentPassword))) return;
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
      return sendBackupDownload(res, 'telegram-bot-backup-' + localDayKey() + '.kbz');
    } catch (error) {
      recordError('Создание резервной копии', error);
      return json(res, 500, { error: 'Не удалось создать резервную копию: ' + error.message });
    }
  }

  if (url.pathname === '/api/restore' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    // Восстановление заменяет все данные бота: просим текущий пароль.
    if (!(await passwordAccepted(req, res, headerPassword(req)))) return;
    try {
      const backup = await readBackup(req);
      if (!backup || typeof backup !== 'object') throw new Error('Выберите корректный файл резервной копии');
      // Порядок важен. Сначала возвращаем файлы фотографий из копии медиа:
      // иначе снимки, которые лежат рядом в backups/media, потерялись бы сразу.
      // Потом отбрасываем то, чего нет нигде, проверяем файл целиком и только
      // перед самой заменой складываем рядом снимок прежних данных.
      // Порядок важен. Сначала убеждаемся, что это вообще наша копия и версия
      // подходящая — это проверяется по самим данным, ничего не трогая на
      // диске. Потом кладём фотографии из копии и возвращаем недостающие из
      // папки backups/media. Потом отбрасываем то, чего нет нигде, и только
      // после этого проверяем файл целиком, включая изображения.
      validateBackupStructure(backup);
      const fromFile = writeBackupMedia(backup);
      const restoredPhotos = restoreMissingMedia(backup) + fromFile;
      const missingPhotos = dropMissingImages(backup);
      validateBackupPayload(backup);
      const restored = normalizeLoadedData(backup);
      const snapshot = snapshotBeforeRestore();
      replaceData(restored);
      rebuildUserIndex();
      telegramFileIds.clear();
      data.interfaceText = applyInterfaceText(data.interfaceText);
      saveDataNow();
      restartPolling();
      sessions.clear();
      const nextSession = createSession(res, req);
      return json(res, 200, {
        ok: true,
        csrf: nextSession.csrf,
        missingPhotos,
        restoredPhotos,
        snapshot: snapshot ? snapshot.split(/[\\/]/).pop() : '',
      });
    } catch (error) {
      return json(res, 400, { error: 'Не удалось восстановить копию: ' + error.message });
    }
  }

  // «Взять из файла»: добавить или обновить проекты (и по желанию контакты, «О компании») из файла каталога. Клиенты, заявки,
  // настройки и остальные проекты не меняются: в отличие от восстановления копии, ничего не заменяется целиком.
  if (url.pathname === '/api/restore-parts' && req.method === 'POST') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    if (!(await passwordAccepted(req, res, headerPassword(req)))) return;
    const parts = String(url.searchParams.get('parts') || '').split(',').filter((part, index, all) => ['objects', 'photos', 'sea', 'contacts', 'about', 'texts', 'settings'].includes(part) && all.indexOf(part) === index);
    if (!parts.length) return json(res, 400, { error: 'Отметьте, что взять из файла' });
    try {
      const backup = await readBackup(req);
      validatePartsBackup(backup);
      // Файл с одним полем (расстояние до пляжа) нельзя применять как полные проекты: они потеряли бы фото и тексты.
      if (backup.onlyField === 'distanceSea' && parts.some((part) => part !== 'sea')) {
        throw new Error('в этом файле только расстояние до пляжа. Отметьте единственный пункт «Только расстояние до пляжа»');
      }
      // Фотографии пишем на диск только после проверки структуры; потери (чего нет ни в файле, ни на диске) отбрасываем.
      const fromFile = writeBackupMedia(backup);
      const missingPhotos = dropMissingImages(backup);
      validatePartsPayload(backup);
      const sourceConfig = backup.config && typeof backup.config === 'object' ? backup.config : {};
      const incoming = normalizeLoadedData({
        version: backup.version,
        objects: backup.objects,
        contacts: backup.contacts,
        trust: backup.trust,
        guidePages: backup.guidePages,
        buyPlan: backup.buyPlan,
        welcomeImages: backup.welcomeImages,
        rules: backup.rules,
        replyTemplates: backup.replyTemplates,
        interfaceText: backup.interfaceText,
        config: {
          menu: sourceConfig.menu,
          messages: sourceConfig.messages,
          calculator: sourceConfig.calculator,
          workingHours: sourceConfig.workingHours,
          viewingSlots: sourceConfig.viewingSlots,
          timeZone: sourceConfig.timeZone,
          reminderHours: sourceConfig.reminderHours,
        },
      });
      const snapshot = snapshotBeforeRestore();
      const result = { objectsAdded: 0, objectsUpdated: 0, photosUpdated: 0, seaUpdated: 0, contacts: false, about: false, texts: 0, settings: 0 };
      if (parts.includes('objects')) {
        for (const record of incoming.objects) {
          const index = data.objects.findIndex((item) => item.id === record.id);
          if (index >= 0) {
            // Файл без фотографий не стирает те, что уже есть у проекта.
            if (!hasGalleryImages(record) && hasGalleryImages(data.objects[index])) record.imagesByLanguage = data.objects[index].imagesByLanguage;
            data.objects[index] = record;
            result.objectsUpdated += 1;
          } else {
            data.objects.push(record);
            result.objectsAdded += 1;
          }
        }
      }
      // Только фотографии: у проектов, которые уже есть (по номеру), заменяются фото; тексты, цена и статус остаются как есть.
      if (parts.includes('photos') && !parts.includes('objects')) {
        for (const record of incoming.objects) {
          const existing = data.objects.find((item) => item.id === record.id);
          if (!existing) continue;
          existing.imagesByLanguage = record.imagesByLanguage;
          existing.updatedAt = new Date().toISOString();
          result.photosUpdated += 1;
        }
      }
      // Только расстояние до пляжа: у проектов, которые уже есть (по номеру), меняется одно это поле.
      if (parts.includes('sea') && !parts.includes('objects')) {
        for (const record of incoming.objects) {
          const existing = data.objects.find((item) => item.id === record.id);
          const distance = Number(record.distanceSea);
          if (!existing || !(distance > 0)) continue;
          existing.distanceSea = distance;
          existing.updatedAt = new Date().toISOString();
          result.seaUpdated += 1;
        }
      }
      if (parts.includes('contacts') && backup.contacts) {
        data.contacts = incoming.contacts;
        result.contacts = true;
      }
      if (parts.includes('about')) {
        if (backup.trust) data.trust = incoming.trust;
        for (const language of LANGUAGES) {
          // Берём только то, что в файле написано: нормализация подставила бы стандартный текст там, где его нет.
          const raw = backup.config && backup.config.menu && backup.config.menu[language];
          const about = raw && typeof raw.about === 'string' ? cleanText(raw.about, 4000) : '';
          if (about) data.config.menu[language] = { ...data.config.menu[language], about };
        }
        result.about = true;
      }
      // Тексты бота: целиком то, что есть в файле; чего в файле нет — остаётся как на этом сервере.
      if (parts.includes('texts')) {
        if (sourceConfig.menu) { data.config.menu = incoming.config.menu; result.texts += 1; }
        if (sourceConfig.messages) { data.config.messages = incoming.config.messages; result.texts += 1; }
        if (Array.isArray(backup.guidePages)) { data.guidePages = incoming.guidePages; result.texts += 1; }
        if (backup.buyPlan && typeof backup.buyPlan === 'object') { data.buyPlan = incoming.buyPlan; result.texts += 1; }
        if (Array.isArray(backup.rules)) { data.rules = incoming.rules; result.texts += 1; }
        if (Array.isArray(backup.replyTemplates)) { data.replyTemplates = incoming.replyTemplates; result.texts += 1; }
        if (backup.interfaceText && typeof backup.interfaceText === 'object') {
          data.interfaceText = applyInterfaceText(incoming.interfaceText);
          result.texts += 1;
        }
        for (const language of LANGUAGES) {
          if (backup.welcomeImages && backup.welcomeImages[language] && incoming.welcomeImages[language]) {
            data.welcomeImages[language] = incoming.welcomeImages[language];
            result.texts += 1;
          }
        }
      }
      // Настройки показа клиентам: калькулятор, рабочее время, окна просмотров, часовой пояс. Ничего про вход, токен и админ-чат.
      if (parts.includes('settings')) {
        for (const key of ['calculator', 'workingHours', 'viewingSlots', 'timeZone', 'reminderHours']) {
          if (sourceConfig[key] != null) {
            data.config[key] = incoming.config[key];
            result.settings += 1;
          }
        }
        if (result.settings) applyConfiguredTimeZone();
      }
      saveDataNow();
      return json(res, 200, { ok: true, ...result, photos: fromFile, missingPhotos, snapshot: snapshot ? snapshot.split(/[\\/]/).pop() : '' });
    } catch (error) {
      return json(res, 400, { error: 'Не удалось взять данные из файла: ' + error.message });
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
    // Фото меняется только если панель прислала новое или просьбу убрать;
    // без этого каждое сохранение контактов стирало бы фото.
    let photo = data.contacts && data.contacts.photo ? data.contacts.photo : null;
    if (body.photo && body.photo.remove) photo = null;
    else if (body.photo && body.photo.dataUrl) {
      try {
        photo = parseUploadedImage(body.photo.dataUrl, body.photo.name || 'manager.jpg');
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }
    data.contacts = {
      photo,
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

  // Автоматические сообщения клиентам: включаются владельцем, по умолчанию выключены.
  if (url.pathname === '/api/engagement' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    data.config.engagement = normalizeEngagement({ ...data.config.engagement, ...(typeof body.digest === 'boolean' ? { digest: body.digest } : {}), ...(typeof body.comeback === 'boolean' ? { comeback: body.comeback } : {}), ...(typeof body.planReminder === 'boolean' ? { planReminder: body.planReminder } : {}) });
    saveDataNow();
    return json(res, 200, { ok: true, engagement: data.config.engagement });
  }

  // «Почему мы»: цифры, регистрационные данные, адрес офиса, отзывы. Отзыв без
  // подтверждённого разрешения автора клиентам не показывается.
  if (url.pathname === '/api/trust' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    const reviewsUrl = cleanText(body.reviewsUrl, 500);
    if (reviewsUrl && !validHttpUrl(reviewsUrl)) return json(res, 400, { error: 'Ссылка на отзывы должна начинаться с http:// или https://' });
    const reviews = Array.isArray(body.reviews) ? body.reviews : [];
    if (reviews.length > MAX_TRUST_REVIEWS) return json(res, 400, { error: 'Можно добавить не больше ' + MAX_TRUST_REVIEWS + ' отзывов' });
    for (const review of reviews) {
      const name = cleanText(review && review.name, 80);
      const text = cleanText(review && review.text, 600);
      if (!name && !text) continue;
      if (!name || !text) return json(res, 400, { error: 'У каждого отзыва должны быть имя автора и текст' });
    }
    const years = Number(body.yearsOnMarket);
    const deals = Number(body.dealsCount);
    if ((body.yearsOnMarket !== '' && body.yearsOnMarket != null && !(years >= 0 && years <= 200)) || (body.dealsCount !== '' && body.dealsCount != null && !(deals >= 0 && deals <= 1000000))) {
      return json(res, 400, { error: 'Годы на рынке и число сделок — целые числа, не отрицательные' });
    }
    data.trust = normalizeTrust({ ...body, reviewsUrl });
    saveDataNow();
    return json(res, 200, { ok: true, trust: data.trust });
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
      await sendMessage(adminChatId, '✅ Уведомления работают. Теперь действия клиентов будут приходить в этот чат.', data.config.botToken, { track: false });
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
      const byLanguage = { ru: 0, uk: 0, en: 0, es: 0 };
      for (const user of users) byLanguage[LANGUAGES.includes(user.preferredLanguage) ? user.preferredLanguage : 'ru'] += 1;
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
