// Журнал переписки для «Диалогов» GenAgent: всё, что клиент написал боту, и всё, что бот отправил клиенту
// (меню, каталог, карточки, формы, ответы менеджера, уведомления, рассылки…), — с номерами сообщений и временем.
// Запись — в двух точках: входящие обновления (record*) и каждая отправка через telegram.mjs (setSentHook).
// В GenAgent уходит фоном пачками на {url}/sync с повтором при сбое; очередь хранится в данных бота и переживает
// перезапуск. GenAgent отбрасывает повторы по номеру и узнаёт то, что уже пришло через консультанта.
import { AsyncLocalStorage } from 'node:async_hooks';
import { data, scheduleSave } from './store.mjs';
import { setSentHook } from './telegram.mjs';
import { adminChatFor } from './inquiries.mjs';
import { userByChatId, userById } from './users.mjs';
import { aiAgentSettings, downloadTelegramFile } from './ai-agent.mjs';

const FLUSH_EVERY_MS = 4000;
const BATCH = 100;
const MAX_PENDING = 20000;
const TIMEOUT_MS = 20000;

// Кто пишет клиенту: agent — ответ консультанта, manager — менеджер (панель, Telegram, GenAgent), иначе — сам бот
const author = new AsyncLocalStorage();

/** Выполнить fn так, что всё, что она отправит клиенту, подписано как от консультанта или менеджера. */
function asAuthor(by, fn) {
  return author.run(by, fn);
}

function queue() {
  if (!Array.isArray(data.agentJournal)) data.agentJournal = [];
  return data.agentJournal;
}

function isClientChat(chatId) {
  const id = Number(chatId);
  return Number.isFinite(id) && id > 0 && !adminChatFor(chatId);
}

function userInfo(chatId, from) {
  const user = (from && userById(String(from.id))) || userByChatId(chatId) || {};
  const name = [from ? from.first_name : user.firstName, from ? from.last_name : user.lastName].filter(Boolean).join(' ').slice(0, 200);
  const username = from ? from.username : user.username;
  return { id: String((from && from.id) || user.id || chatId), ...(name ? { name } : {}), ...(username ? { username } : {}) };
}

function push(chatId, item, from) {
  if (!aiAgentSettings() || !chatId) return;
  const q = queue();
  q.push({ user: userInfo(chatId, from), item: { ...item, text: String(item.text || '').slice(0, 4000) } });
  if (q.length > MAX_PENDING) q.splice(0, q.length - MAX_PENDING);
  scheduleSave();
}

// Превью для «Диалогов»: фото ~320 px или миниатюра стикера/видео — скачиваем при отправке в GenAgent
function thumbOf(message) {
  if (!message) return null;
  if (Array.isArray(message.photo) && message.photo.length) return (message.photo.find((p) => p.width >= 320) || message.photo[message.photo.length - 1]).file_id;
  const t = (message.sticker && message.sticker.thumbnail) || (message.video && message.video.thumbnail)
    || (message.animation && message.animation.thumbnail) || (message.video_note && message.video_note.thumbnail) || (message.document && message.document.thumbnail);
  return (t && t.file_id) || null;
}

const plain = (html) => String(html || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const duration = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

/** Содержимое сообщения Telegram для журнала: { kind, text }. */
function describe(m) {
  const caption = m.caption ? plain(m.caption) : '';
  if (m.text) return { kind: 'text', text: m.text };
  if (m.sticker) return { kind: 'sticker', text: m.sticker.emoji || '' };
  if (m.photo) return { kind: 'photo', text: caption };
  if (m.video_note) return { kind: 'video_note', text: duration(m.video_note.duration) };
  if (m.video) return { kind: 'video', text: caption };
  if (m.animation) return { kind: 'animation', text: caption };
  if (m.voice) return { kind: 'voice', text: duration(m.voice.duration) };
  if (m.audio) return { kind: 'audio', text: [m.audio.performer, m.audio.title].filter(Boolean).join(' — ') || caption };
  if (m.document) return { kind: 'document', text: [m.document.file_name, caption].filter(Boolean).join('\n') };
  if (m.venue) return { kind: 'location', text: [m.venue.title, m.venue.address].filter(Boolean).join(', ') };
  if (m.location) return { kind: 'location', text: `${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)}` };
  if (m.contact) return { kind: 'contact', text: [m.contact.first_name, m.contact.last_name, m.contact.phone_number].filter(Boolean).join(' ') };
  if (m.dice) return { kind: 'sticker', text: m.dice.emoji || '🎲' };
  if (m.poll) return { kind: 'other', text: m.poll.question || '' };
  return { kind: 'other', text: caption };
}

const incomingId = (message) => `in:${message.message_id}`;

/** Сообщение клиента в личном чате — до любых сценариев бота. Тот же номер бот передаёт консультанту. */
function recordIncoming(message) {
  if (!message || !message.chat || message.chat.type !== 'private' || !message.from || message.from.is_bot) return;
  if (!isClientChat(message.chat.id) || message.service || message.new_chat_members || message.pinned_message) return;
  const { kind, text } = describe(message);
  const thumbFile = thumbOf(message);
  push(message.chat.id, { id: incomingId(message), dir: 'in', kind, text, at: (message.date || Date.now() / 1000) * 1000, ...(thumbFile ? { thumbFile } : {}) }, message.from);
}

/** Нажатие кнопки: подпись кнопки, которую клиент видел. */
function recordCallback(query) {
  const chat = query && query.message && query.message.chat;
  if (!chat || chat.type !== 'private' || !isClientChat(chat.id)) return;
  const rows = (query.message.reply_markup && query.message.reply_markup.inline_keyboard) || [];
  const button = rows.flat().find((b) => b.callback_data === query.data);
  push(chat.id, { id: `cb:${query.id}`, dir: 'in', kind: 'button', text: (button && button.text) || query.data || '', at: Date.now() }, query.from);
}

/** Реакция клиента (👍, ❤️…). Снятую реакцию не записываем. */
function recordReaction(reaction) {
  if (!reaction || !reaction.chat || reaction.chat.type !== 'private' || !reaction.user || !isClientChat(reaction.chat.id)) return;
  const emojis = (reaction.new_reaction || []).map((x) => (x.type === 'emoji' ? x.emoji : '⭐')).join(' ');
  if (!emojis) return;
  push(reaction.chat.id, { id: `re:${reaction.message_id}:${reaction.date}`, dir: 'in', kind: 'reaction', text: emojis, at: (reaction.date || Date.now() / 1000) * 1000 }, reaction.user);
}

/** Клиент исправил своё сообщение — новый текст отдельной строкой. */
function recordEdit(message) {
  if (!message || !message.chat || message.chat.type !== 'private' || !message.from || !isClientChat(message.chat.id)) return;
  const { text } = describe(message);
  if (!text) return;
  const at = (message.edit_date || message.date || Date.now() / 1000) * 1000;
  push(message.chat.id, { id: `ed:${message.message_id}:${message.edit_date || message.date}`, dir: 'in', kind: 'edit', text, at }, message.from);
}

/** Сообщение в Mini App (не сообщение Telegram): свой номер, тот же передаётся консультанту. */
function recordApp(user, dir, text, { by, kind = 'text', thumb, thumbType } = {}) {
  if (!user || !user.chatId) return undefined;
  const id = `app:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  push(user.chatId, { id, dir, ...(dir === 'out' && by ? { by } : {}), kind, text, at: Date.now(), ...(thumb ? { thumb, thumbType: thumbType || 'image/jpeg' } : {}) });
  return id;
}

const SENDS = {
  sendMessage: 'text', sendPhoto: 'photo', sendDocument: 'document', sendVideo: 'video', sendAnimation: 'animation',
  sendVoice: 'voice', sendAudio: 'audio', sendSticker: 'sticker', sendVideoNote: 'video_note', sendLocation: 'location',
  sendVenue: 'location', sendContact: 'contact', sendMediaGroup: 'photo', copyMessage: 'other', forwardMessage: 'other',
};

function buttonsOf(markup) {
  let value = markup;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const labels = ((value && value.inline_keyboard) || []).flat().map((b) => b.text).filter(Boolean).slice(0, 8);
  return labels.length ? `\n\n[${labels.join(' · ')}]` : '';
}

// Каждая успешная отправка клиенту — в журнал
setSentHook((method, payload, result) => {
  const kind = SENDS[method];
  if (!kind || !payload) return;
  const chatId = payload.chat_id;
  if (!isClientChat(chatId)) return;
  const by = author.getStore();
  const base = { dir: 'out', ...(by ? { by } : {}), at: Date.now() };
  if (method === 'sendMediaGroup') {
    let media = payload.media;
    if (typeof media === 'string') { try { media = JSON.parse(media); } catch { media = []; } }
    (Array.isArray(result) ? result : []).forEach((r, i) => {
      const part = (Array.isArray(media) && media[i]) || {};
      const thumbFile = thumbOf(r);
      push(chatId, { ...base, id: `out:${r.message_id}`, kind: part.type || 'photo', text: plain(part.caption || ''), ...(thumbFile ? { thumbFile } : {}) });
    });
    return;
  }
  const id = result && result.message_id;
  if (!id) return;
  let text = plain(payload.text || payload.caption || '');
  if (method === 'sendDocument' && payload.document && payload.document.fileName) text = [payload.document.fileName, text].filter(Boolean).join('\n');
  if (method === 'sendContact') text = [payload.first_name, payload.phone_number].filter(Boolean).join(' ');
  if (method === 'sendLocation') text = `${payload.latitude}, ${payload.longitude}`;
  const thumbFile = thumbOf(result);
  push(chatId, { ...base, id: `out:${id}`, kind, text: (text + buttonsOf(payload.reply_markup)).trim(), ...(thumbFile ? { thumbFile } : {}) });
});

// --- Отправка в GenAgent ---

const state = { busy: false, backoffUntil: 0, failures: 0, timer: null, lastError: '' };

const MAX_THUMB = 300 * 1024;
const MAX_THUMBS_PER_BATCH = 3 * 1024 * 1024;

function imageType(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  return null;
}

// Превью: thumbFile → thumb (base64). Не вышло — сообщение уйдёт без превью.
async function withThumbs(items) {
  const token = data.config && data.config.botToken;
  let total = 0;
  const out = [];
  for (const { thumbFile, ...item } of items) {
    if (thumbFile && token && total < MAX_THUMBS_PER_BATCH) {
      const buffer = await downloadTelegramFile(thumbFile, token, MAX_THUMB);
      const type = buffer && imageType(buffer);
      if (type) {
        item.thumb = buffer.toString('base64');
        item.thumbType = type;
        total += item.thumb.length;
      }
    }
    out.push(item);
  }
  return out;
}

async function flushOne() {
  const settings = aiAgentSettings();
  const q = queue();
  if (!settings || state.busy || !q.length || Date.now() < state.backoffUntil) return false;
  state.busy = true;
  try {
    // Пачка — сообщения одного клиента, по порядку
    const uid = q[0].user.id;
    const batch = [];
    for (const entry of q) {
      if (entry.user.id !== uid) continue;
      batch.push(entry);
      if (batch.length >= BATCH) break;
    }
    const response = await fetch(settings.url + '/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({ user: batch[batch.length - 1].user, items: await withThumbs(batch.map((entry) => entry.item)) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 400 — пачку не приняли из-за содержимого: не держим из-за неё всю очередь
    if (!response.ok && response.status !== 400) throw new Error(response.status === 404 ? 'GenAgent ещё не принимает журнал (/sync)' : 'ответ ' + response.status);
    if (response.status === 400) console.error('GenAgent: журнал переписки — пачка не принята (400), пропускаю');
    const sent = new Set(batch);
    data.agentJournal = queue().filter((entry) => !sent.has(entry));
    scheduleSave();
    state.failures = 0;
    state.lastError = '';
    return true;
  } catch (error) {
    state.failures += 1;
    state.backoffUntil = Date.now() + Math.min(60000, 4000 * 2 ** Math.min(state.failures, 4));
    if (state.lastError !== error.message) console.error('GenAgent (журнал переписки):', error.message);
    state.lastError = error.message;
    return false;
  } finally {
    state.busy = false;
  }
}

async function flushJournal() {
  // За один проход — несколько клиентов, чтобы очередь после сбоя быстро разошлась
  for (let i = 0; i < 20; i += 1) {
    if (!(await flushOne())) break;
  }
}

/**
 * Один раз: прошлая переписка, которую бот сохранил сам, — ленты обращений (клиент ↔ менеджер, ответы бота).
 * Что в GenAgent уже есть, он узнаёт по тексту и времени — дублей не будет.
 */
function backfillJournal() {
  if (!aiAgentSettings() || data.agentJournalBackfilled) return 0;
  let count = 0;
  for (const inquiry of data.inquiries || []) {
    const user = userById(String(inquiry.userId));
    if (!user || !user.chatId || !isClientChat(user.chatId) || inquiry.system) continue;
    for (const message of inquiry.messages || []) {
      const at = Date.parse(message.createdAt);
      if (!Number.isFinite(at) || !message.id || (!message.text && message.kind === 'text')) continue;
      const out = message.direction === 'out';
      // Ответы бота/консультанта (source bot) — без подписи: GenAgent сам узнает ответ консультанта; остальное — менеджер
      const by = out && message.source !== 'bot' ? 'manager' : undefined;
      // Номер Telegram, если он есть, — тот же, что у живого журнала (без двойной записи)
      const id = message.telegramMessageId ? `${out ? 'out' : 'in'}:${message.telegramMessageId}` : `inq:${message.id}`;
      push(user.chatId, { id, dir: out ? 'out' : 'in', ...(by ? { by } : {}), kind: message.kind || 'text', text: message.text || '', at });
      count += 1;
    }
  }
  queue().sort((a, b) => a.item.at - b.item.at);
  data.agentJournalBackfilled = new Date().toISOString();
  scheduleSave();
  console.log('GenAgent: журнал переписки — к отправке прошлых сообщений:', count);
  return count;
}

function startAgentJournal() {
  if (state.timer) return;
  setTimeout(() => {
    try { backfillJournal(); } catch (error) { console.error('GenAgent: прошлая переписка не собрана:', error.message); }
  }, 30000).unref?.();
  state.timer = setInterval(() => void flushJournal(), FLUSH_EVERY_MS);
  if (state.timer.unref) state.timer.unref();
}

function stopAgentJournal() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export {
  asAuthor,
  backfillJournal,
  describe,
  flushJournal,
  incomingId,
  recordApp,
  recordCallback,
  recordEdit,
  recordIncoming,
  recordReaction,
  startAgentJournal,
  stopAgentJournal,
};
