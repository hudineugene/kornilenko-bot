// API панели: правила автоответов, меню, настройки бота, менеджеры,
// импорт фида, копия в Telegram, слоты просмотров, калькулятор и часы работы.

import crypto from 'node:crypto';
import { cleanText, delay, hashPassword } from './util.mjs';
import { CLOCK_TIME_PATTERN, REMINDER_HOUR_OPTIONS, REPLY_MINUTES_CHOICES, RETENTION_MONTH_OPTIONS, MAX_MANAGERS, TIME_ZONES, normalizeCalculator, normalizeManagers, normalizeTimeZone, normalizeViewingSlots, normalizeWorkingHours } from './data-format.mjs';
import { applyConfiguredTimeZone, data, saveDataNow, verifyPassword } from './store.mjs';
import { recordError } from './analytics.mjs';
import { forgetTelegramFileIds, sendMessage, telegramRequest } from './telegram.mjs';
import { configureBotCommands } from './menus.mjs';
import { inquiryChats } from './inquiries.mjs';
import { validHttpUrl } from './catalog.mjs';
import { findRule, restartPolling } from './updates.mjs';
import { BOT_TOKEN_PATTERN, clientAddress, json, loginAttempts, readJson, requireAuth, sessions } from './admin-http.mjs';
import { passwordAccepted } from './admin-http.mjs';
import { loginAllowed, menuInput, messagesInput, rulesConflict } from './admin-input.mjs';
import { announceActiveChange } from './status.mjs';
import { MIN_BACKUP_PASSWORD_LENGTH, sendTelegramBackup, setBackupPassword, telegramBackupSettings } from './offsite.mjs';
import { applyImport, feedSettings, fetchFeed, planImport, planSummary, readFeed } from './feed-import.mjs';

// Каждая ветка сама отвечает клиенту и возвращает управление. Если не подошла
// ни одна, функция возвращает false — тогда запрос ищут в других модулях.

async function handleSettingsApi(req, res, url) {
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
    // Каждое поле необязательно: правка присылает только то, что человек изменил,
    // а не весь набор настроек из состояния панели, которое могло устареть.
    let nextMessages = null;
    if (body.messages != null) {
      try {
        nextMessages = messagesInput(body.messages);
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    // Смена админ-чата отдаёт заявки клиентов в другой Telegram-чат, поэтому
    // тоже просит пароль.
    const nextAdminChatId = body.adminChatId == null ? String(data.config.adminChatId || '') : cleanText(body.adminChatId, 40);
    const adminChatChanged = nextAdminChatId !== String(data.config.adminChatId || '');
    let tokenChanged = false;
    let nextBot = data.bot;
    const newToken = cleanText(body.token, 256);
    const newPassword = String(body.password || '');
    // A session alone must not be enough to take over the panel or the bot.
    if (newToken || newPassword || adminChatChanged) {
      // Пароль не введён и пароль введён неверно — разные вещи, и говорить о них
      // надо по-разному. Проверку делает общая passwordAccepted: у неё и счёт
      // попыток, и одинаковая по времени пауза.
      const current = String(body.currentPassword || '');
      if (!current) return json(res, 403, { error: 'Для смены пароля, токена или чата администратора введите текущий пароль' });
      if (!(await passwordAccepted(req, res, current))) return;
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
    if (body.retentionMonths != null && !RETENTION_MONTH_OPTIONS.includes(Number(body.retentionMonths))) return json(res, 400, { error: 'Некорректный срок хранения данных' });
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
    if (body.retentionMonths != null) data.config.retentionMonths = Number(body.retentionMonths);
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
    if (nextMessages) data.config.messages = nextMessages;
    const activeChanged = typeof body.active === 'boolean' && data.config.active !== body.active;
    if (typeof body.active === 'boolean') data.config.active = body.active;
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
    // Менеджер получает заявки клиентов и может отвечать от имени компании:
    // список меняется только с текущим паролем.
    const before = JSON.stringify((data.config.managers || []).map((manager) => [manager.name, manager.chatId]));
    const after = JSON.stringify(list.map((manager) => [cleanText(manager && manager.name, 60), cleanText(manager && manager.chatId, 40)]));
    if (before !== after && !(await passwordAccepted(req, res, body.currentPassword))) return;
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
    const adminNameBefore = cleanText(data.config.adminName, 60) || 'Администратор';
    data.config.adminName = cleanText(body.adminName, 60);
    // A chat that stays the same keeps its checked state.
    data.config.managers = normalizeManagers(list.map((item) => {
      const chatId = cleanText(item.chatId, 40);
      const old = previous.get(chatId);
      return { id: old ? old.id : '', name: item.name, chatId, verifiedAt: old ? old.verifiedAt : '' };
    }), adminChatId);
    // Ответственный в заявке записан именем: переименовали человека — имя в его
    // заявках идёт следом, иначе клиенты остаются «без хозяина» и пропадают из «Мои».
    const renamed = new Map();
    const adminNameAfter = cleanText(data.config.adminName, 60) || 'Администратор';
    if (adminNameBefore !== adminNameAfter) renamed.set(adminNameBefore, adminNameAfter);
    for (const manager of data.config.managers) {
      const old = previous.get(manager.chatId);
      if (old && old.name !== manager.name) renamed.set(old.name, manager.name);
    }
    if (renamed.size) {
      for (const inquiry of data.inquiries) {
        if (inquiry.assignee && renamed.has(inquiry.assignee)) inquiry.assignee = renamed.get(inquiry.assignee);
      }
    }
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
      // Разные случаи — разные ответы: раньше на неверный пароль панель писала
      // «Введите текущий пароль», и человек искал, куда его вводить, хотя ввёл.
      const current = String(body.currentPassword || '');
      if (!current) return json(res, 403, { error: 'Введите текущий пароль администратора' });
      if (!(await passwordAccepted(req, res, current))) return;
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
      businessTaxPercent: ['НДС на участок и коммерцию', 0, 30],
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
    if (body.replyMinutes != null && !REPLY_MINUTES_CHOICES.includes(Number(body.replyMinutes))) {
      return json(res, 400, { error: 'Срок ответа выберите из списка' });
    }
    data.config.workingHours = normalizeWorkingHours({
      enabled: body.enabled === true,
      days,
      from: body.from,
      to: body.to,
      replyMinutes: body.replyMinutes,
      note,
    });
    if (body.timeZone != null) data.config.timeZone = normalizeTimeZone(body.timeZone);
    applyConfiguredTimeZone();
    saveDataNow();
    return json(res, 200, { ok: true, workingHours: data.config.workingHours });
  }

  return false;
}

export {
  handleSettingsApi,
};
