// API панели для групп: публикации, закрепление, участники, права,
// приглашения, заявки на вступление. Все действия — от имени бота.

import crypto from 'node:crypto';
import { cleanText, delay } from './util.mjs';
import { MAX_RUBRICS, normalizePublishing } from './data-format.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordError } from './analytics.mjs';
import { telegramRequest } from './telegram.mjs';
import { persistImage } from './media.mjs';
import { json, parseUploadedImage, readJson, requireAuth } from './admin-http.mjs';
import { objectCaption, propertyDeepLink, recordImages } from './catalog.mjs';
import {
  GENERAL_TOPIC_ID,
  fetchAdministrators,
  upsertGroup,
  findTopic,
  forgetGroupMessage,
  forgetTopic,
  groupById,
  groupList,
  listingMessage,
  messageLink,
  newGroupPost,
  postToGroup,
  publishBlocker,
  updateListingPost,
  refreshGroup,
  refreshGroups,
  rememberTopic,
} from './groups.mjs';

const MAX_SCHEDULED_POSTS = 50;
// Member permissions a group can set for everyone (setChatPermissions).
const CHAT_PERMISSIONS = [
  'can_send_messages',
  'can_send_photos',
  'can_send_videos',
  'can_send_other_messages',
  'can_send_polls',
  'can_add_web_page_previews',
  'can_invite_users',
  'can_pin_messages',
  'can_change_info',
];

function token() {
  const value = cleanText(data.config.botToken, 100);
  if (!value) throw new Error('Токен бота не задан');
  return value;
}

function postImage(body) {
  if (!body.image) return null;
  const image = parseUploadedImage(body.image, 'group');
  persistImage(image);
  return image;
}

// Тема из поля «ссылка или номер»: ссылка на тему или на сообщение в ней
// (t.me/c/1234567890/12 или t.me/имя/12) либо просто номер. Ссылка на чужую
// группу отвергается: иначе пост ушёл бы в тему с тем же номером не там.
function topicFromInput(group, value) {
  const text = cleanText(value, 300);
  if (/^\d{1,10}$/.test(text)) {
    if (Number(text) < 1) throw new Error('Номер темы — число больше нуля (у «Общей» темы номер 1, у остальных больше)');
    return Number(text);
  }
  const link = text.match(/^(?:https?:\/\/)?t\.me\/(c\/(\d+)|([A-Za-z0-9_]{4,32}))\/(\d+)(?:\/\d+)?(?:\?.*)?$/i);
  if (!link) throw new Error('Укажите номер темы или ссылку на неё вида https://t.me/c/1234567890/12');
  if (link[2] && group.id !== '-100' + link[2]) throw new Error('Эта ссылка ведёт в другую группу');
  // Ссылка с публичным именем подходит только группе с таким именем: у группы без
  // публичного адреса темы открываются ссылками вида t.me/c/….
  if (link[3] && (!group.username || link[3].toLowerCase() !== group.username.toLowerCase())) throw new Error('Эта ссылка ведёт в другую группу');
  return Number(link[4]);
}

function requestedThread(group, value) {
  const threadId = Math.floor(Number(value)) || 0;
  return threadId > GENERAL_TOPIC_ID && group.isForum ? threadId : 0;
}

function futureDate(value) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) throw new Error('Укажите дату и время публикации');
  if (time < Date.now() - 60 * 1000) throw new Error('Дата публикации уже прошла');
  return new Date(time).toISOString();
}

// Текст поста — та же подпись, что видит клиент в карточке, плюс кнопка со
// ссылкой на объект в боте. Метка источника в ссылке показывает, что клиент
// пришёл из канала.
function channelPostForProperty(record, language, body = {}) {
  const images = recordImages(record, language);
  const text = cleanText(body.text, 4000) || objectCaption(record, language);
  const buttonText = cleanText(body.buttonText, 64) || CHANNEL_BUTTON_TEXT[language] || CHANNEL_BUTTON_TEXT.ru;
  return {
    text,
    image: images.length ? images[0] : null,
    buttonText,
    buttonUrl: propertyDeepLink(record, cleanText(body.source, 40) || 'channel'),
    rubricId: cleanText(body.rubricId, 60),
    withoutSignature: body.withoutSignature === true,
    pin: body.pin === true,
    notify: body.notify !== false,
  };
}

const CHANNEL_BUTTON_TEXT = { ru: '🤖 Смотреть в боте', en: '🤖 View in the bot', es: '🤖 Ver en el bot' };

const LISTING_LANGUAGES = ['ru', 'en', 'es'];
const MAX_LISTING_TARGETS = 20;
// Telegram разрешает в группу около 20 сообщений в минуту: между группами делаем паузу, а в одну — альбом и текст.
const LISTING_PAUSE_MS = 1500;

// Публикация объявления в выбранные группы. Одна неудача не останавливает остальные: на каждую группу — своя строка
// результата (ссылка на пост или причина отказа словами).
async function publishListing(res, record, body) {
  const list = Array.isArray(body.targets) ? body.targets : [];
  if (!list.length) return json(res, 400, { error: 'Выберите хотя бы одну группу' });
  if (list.length > MAX_LISTING_TARGETS) return json(res, 400, { error: 'Не больше ' + MAX_LISTING_TARGETS + ' групп за раз' });
  if (!['active', 'reserved'].includes(record.status)) return json(res, 400, { error: 'Объект скрыт или продан — по ссылке из поста клиент его не увидит. Верните объект в каталог и повторите.' });
  const seen = new Set();
  const targets = [];
  for (const item of list) {
    const group = groupById(cleanText(item && item.groupId, 40));
    if (!group) continue;
    const threadId = requestedThread(group, item.threadId);
    const key = group.id + ':' + threadId;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ group, threadId, language: LISTING_LANGUAGES.includes(item.language) ? item.language : 'ru' });
  }
  if (!targets.length) return json(res, 404, { error: 'Выбранные группы не найдены' });
  let sendAt = '';
  if (body.sendAt) {
    try {
      sendAt = futureDate(body.sendAt);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const queued = (data.groupPosts || []).filter((item) => item.status === 'scheduled').length;
    if (queued + targets.length > MAX_SCHEDULED_POSTS) return json(res, 400, { error: 'Слишком много отложенных публикаций' });
  }
  const layout = body.layout === 'split' ? 'split' : 'single';
  const options = { withoutSignature: body.withoutSignature === true, pin: body.pin === true, notify: body.notify !== false };
  const results = [];
  for (const [index, target] of targets.entries()) {
    const { group, threadId, language } = target;
    const row = { groupId: group.id, title: group.title || group.id, threadId, language, ok: false, error: '', link: '', scheduled: false };
    try {
      // Права могли измениться с прошлой проверки: смотрим свежие, а не те, что в списке.
      if (!sendAt) await refreshGroup(group);
      const blocker = publishBlocker(group);
      if (blocker) throw new Error(blocker);
      const fields = { ...options, groupId: group.id, threadId, listing: { objectId: record.id, language, layout } };
      if (sendAt) {
        data.groupPosts = [...(data.groupPosts || []), newGroupPost({ ...fields, sendAt })];
        row.scheduled = true;
      } else {
        const messageId = await postToGroup(group, newGroupPost({ ...fields, sendAt: new Date().toISOString() }));
        row.link = messageLink(group, messageId, threadId);
      }
      row.ok = true;
    } catch (error) {
      row.error = cleanText(error && error.message, 400) || 'Не удалось опубликовать';
      recordError('Публикация объявления в группу «' + (group.title || group.id) + '»', error);
    }
    results.push(row);
    if (!sendAt && index < targets.length - 1) await delay(LISTING_PAUSE_MS);
  }
  saveDataNow();
  return json(res, 200, { ok: results.some((row) => row.ok), results, publications: record.publications || [] });
}

// Удаление опубликованного объявления из группы: все его сообщения (альбом и текст). Запись об этом посте на объекте
// снимается, только когда удалено всё. Сообщение, которого уже нет, считается удалённым. Если Telegram не даёт удалить
// (прошло много времени, нет права), запись остаётся и панель предлагает убрать её из списка вручную (forget).
function deleteFailureText(message) {
  if (/not enough rights|CHAT_ADMIN_REQUIRED|can_delete/i.test(message)) return 'У бота нет права удалять сообщения в этой группе. Включите его в Telegram: «Администраторы» → бот → «Удаление сообщений».';
  if (/can't be deleted|cannot be deleted|too old/i.test(message)) return 'Telegram не разрешил удалить этот пост (так бывает, если прошло больше 48 часов). Удалите его в Telegram вручную, а здесь нажмите «Убрать из списка».';
  return 'Не удалось удалить пост: ' + message;
}

async function unpublishListing(res, record, body) {
  const groupId = cleanText(body.groupId, 40);
  const messageId = Math.floor(Number(body.messageId)) || 0;
  const list = Array.isArray(record.publications) ? record.publications : [];
  const entry = list.find((item) => item.groupId === groupId && item.messageId === messageId);
  if (!entry) return json(res, 404, { error: 'Такой публикации в списке нет — возможно, её уже удалили' });
  const group = groupById(groupId);
  const ids = entry.messageIds && entry.messageIds.length ? entry.messageIds : [entry.messageId].filter(Boolean);
  const remaining = [];
  let failure = '';
  if (body.forget !== true && group) {
    for (const id of ids) {
      try {
        await telegramRequest(token(), 'deleteMessage', { chat_id: group.id, message_id: id });
      } catch (error) {
        if (!/message to delete not found|MESSAGE_ID_INVALID|message identifier is not specified/i.test(error.message)) {
          remaining.push(id);
          failure = error.message;
          continue;
        }
      }
      forgetGroupMessage(group, id);
    }
  }
  if (remaining.length) {
    entry.messageIds = remaining;
    saveDataNow();
    recordError('Удаление объявления из группы', new Error(failure));
    return json(res, 409, { error: deleteFailureText(failure), canForget: true });
  }
  record.publications = list.filter((item) => item !== entry);
  saveDataNow();
  return json(res, 200, { ok: true, publications: record.publications });
}

// Обновить опубликованные посты объекта на месте по его нынешним данным. Без groupId и messageId — все посты объекта; одна
// неудача (пост удалён, пост прежней версии) остальные не останавливает: на каждый пост — строка результата.
async function updateListings(res, record, body) {
  const list = Array.isArray(record.publications) ? record.publications : [];
  const groupId = cleanText(body.groupId, 40);
  const messageId = Math.floor(Number(body.messageId)) || 0;
  const targets = list.filter((item) => (!groupId || item.groupId === groupId) && (!messageId || item.messageId === messageId));
  if (!targets.length) return json(res, 404, { error: 'Таких публикаций у объекта нет' });
  const results = [];
  for (const entry of targets) {
    const group = groupById(entry.groupId);
    const row = { groupId: entry.groupId, title: entry.title, threadId: entry.threadId, messageId: entry.messageId, ok: false, error: '' };
    try {
      if (!group) throw new Error('Группа больше не подключена');
      await updateListingPost(group, record, entry);
      row.ok = true;
    } catch (error) {
      row.error = cleanText(error && error.message, 400) || 'Не удалось обновить';
      recordError('Обновление поста в группе «' + (entry.title || entry.groupId) + '»', error);
    }
    results.push(row);
    if (targets.length > 1) await delay(500);
  }
  saveDataNow();
  return json(res, 200, { ok: results.some((row) => row.ok), results, publications: record.publications || [] });
}

// Every route here is /api/groups/... and needs an authenticated session.
async function handleGroupApi(req, res, url) {
  // Публикация объекта в канал живёт здесь же: ей нужны и канал, и отправка
  // поста, которые описаны в этом файле.
  const objectChannelPost = /^\/api\/objects\/[^/]+\/(channel-post|listing-preview|listing-publish|listing-unpublish|listing-update)$/.test(url.pathname);
  if (!url.pathname.startsWith('/api/groups') && !url.pathname.startsWith('/api/group-posts') && url.pathname !== '/api/publishing' && !objectChannelPost) return false;
  // Чтение (GET) защитного кода не требует — панель его в такие запросы не кладёт; любое изменение — требует.
  const session = requireAuth(req, res, req.method !== 'GET');
  if (!session) return true;

  // Постоянная подпись под постами и рубричные плашки.
  if (url.pathname === '/api/publishing' && req.method === 'PUT') {
    const body = await readJson(req);
    const current = normalizePublishing(data.config.publishing);
    const incoming = Array.isArray(body.rubrics) ? body.rubrics.slice(0, MAX_RUBRICS) : [];
    try {
      const rubrics = incoming.map((item) => {
        const existing = current.rubrics.find((rubric) => rubric.id === cleanText(item.id, 60));
        const name = cleanText(item.name, 60);
        if (!name) throw new Error('У каждой рубрики должно быть название');
        let image = existing ? existing.image : null;
        if (item.imageDataUrl) {
          // persistImage кладёт файл на диск и правит объект на месте.
          image = parseUploadedImage(item.imageDataUrl, name + '.jpg');
          persistImage(image);
        }
        if (!image) throw new Error('Загрузите плашку для рубрики «' + name + '»');
        const placement = ['top', 'separate'].includes(item.placement) ? item.placement : 'bottom';
        return { id: existing ? existing.id : crypto.randomUUID(), name, placement, image };
      });
      data.config.publishing = normalizePublishing({
        signature: body.signature,
        signatureEnabled: body.signatureEnabled !== false,
        signatureWrap: body.signatureWrap,
        signatureQuote: body.signatureQuote === true,
        signatureDivider: body.signatureDivider,
        buttons: Array.isArray(body.buttons) ? body.buttons : [],
        buttonsPerRow: body.buttonsPerRow,
        rubrics,
      });
      saveDataNow();
      return json(res, 200, { ok: true, publishing: data.config.publishing }), true;
    } catch (error) {
      return json(res, 400, { error: error.message }), true;
    }
  }

  // Одна группа целиком, с лентой и заявками на вступление: состояние панели их не несёт.
  const groupOneMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupOneMatch && req.method === 'GET') {
    const group = groupById(decodeURIComponent(groupOneMatch[1]));
    if (!group) json(res, 404, { error: 'Группа не найдена' });
    else json(res, 200, { group });
    return true;
  }

  if (url.pathname === '/api/groups' && req.method === 'GET') {
    await refreshGroups().catch((error) => recordError('Обновление групп', error));
    json(res, 200, { groups: groupList(), posts: data.groupPosts || [] });
    return true;
  }

  // Telegram сообщает о группе только когда бота добавляют или меняют права,
  // поэтому группу, где он уже состоит, подключают по её ID.
  if (url.pathname === '/api/groups' && req.method === 'POST') {
    const body = await readJson(req);
    const chatId = cleanText(body.chatId, 60).replace(/^https?:\/\/t\.me\//i, '@');
    if (!/^-?\d{4,20}$/.test(chatId) && !/^@[A-Za-z0-9_]{4,32}$/.test(chatId)) {
      return json(res, 400, { error: 'Укажите ID вида -1001234567890 или @имя канала' }), true;
    }
    try {
      const chat = await telegramRequest(token(), 'getChat', { chat_id: chatId });
      if (!chat || chat.type === 'private') throw new Error('Это не группа и не канал');
      const group = upsertGroup(chat, {});
      if (!group) throw new Error('Слишком много групп');
      await refreshGroup(group);
      if (['left', 'kicked'].includes(group.status)) throw new Error('Бот не состоит в этой группе');
      saveDataNow();
      return json(res, 200, { ok: true, group }), true;
    } catch (error) {
      recordError('Подключение группы', error);
      return json(res, 400, { error: error.message }), true;
    }
  }

  if (url.pathname === '/api/groups/refresh' && req.method === 'POST') {
    for (const group of groupList()) await refreshGroup(group).catch(() => {});
    saveDataNow();
    json(res, 200, { groups: groupList() });
    return true;
  }

  const match = url.pathname.match(/^\/api\/groups\/(-?\d{4,20})(?:\/([a-z-]+))?(?:\/(-?\d{1,20}))?(?:\/([a-z-]+))?$/);
  const postMatch = url.pathname.match(/^\/api\/group-posts\/([A-Za-z0-9-]{8,60})$/);

  if (postMatch && req.method === 'DELETE') {
    const post = (data.groupPosts || []).find((item) => item.id === postMatch[1]);
    if (!post) return json(res, 404, { error: 'Публикация не найдена' }), true;
    post.status = 'cancelled';
    saveDataNow();
    json(res, 200, { ok: true });
    return true;
  }

  // «Вернуть» отменённый пост: снова в очереди, если время публикации не прошло
  // (иначе он ушёл бы в канал сразу, о чём никто не просил).
  const restorePostMatch = url.pathname.match(/^\/api\/group-posts\/([A-Za-z0-9-]{8,60})\/restore$/);
  if (restorePostMatch && req.method === 'POST') {
    const post = (data.groupPosts || []).find((item) => item.id === restorePostMatch[1]);
    if (!post) return json(res, 404, { error: 'Публикация не найдена' }), true;
    if (post.status !== 'cancelled') return json(res, 409, { error: 'Эта публикация не отменена — возвращать нечего' }), true;
    if (!(Date.parse(post.sendAt) > Date.now())) return json(res, 409, { error: 'Время публикации уже прошло: создайте пост заново с новой датой' }), true;
    post.status = 'scheduled';
    saveDataNow();
    json(res, 200, { ok: true });
    return true;
  }

  // Объект в канал: подпись, фотография и кнопка с ссылкой на карточку в боте.
  // Собираем на стороне бота — в панели нет ни файлов фотографий, ни адреса
  // бота, а текст должен совпадать с тем, что клиент видит в карточке.
  const channelPostMatch = url.pathname.match(/^\/api\/objects\/([^/]+)\/channel-post$/);
  if (channelPostMatch && req.method === 'POST') {
    const body = await readJson(req);
    const record = (data.objects || []).find((item) => item.id === decodeURIComponent(channelPostMatch[1]));
    if (!record) return json(res, 404, { error: 'Объект не найден' }), true;
    const group = groupById(cleanText(body.groupId, 60));
    if (!group) return json(res, 404, { error: 'Канал не найден' }), true;
    const language = ['ru', 'en', 'es'].includes(body.language) ? body.language : 'ru';
    const post = channelPostForProperty(record, language, body);
    if (!post.text && !post.image) return json(res, 400, { error: 'Пост пустой: заполните карточку объекта' }), true;
    try {
      if (body.sendAt) {
        const scheduled = (data.groupPosts || []).filter((item) => item.status === 'scheduled');
        if (scheduled.length >= MAX_SCHEDULED_POSTS) return json(res, 400, { error: 'Слишком много отложенных публикаций' }), true;
        const saved = newGroupPost({ ...post, groupId: group.id, sendAt: futureDate(body.sendAt) });
        data.groupPosts = [...(data.groupPosts || []), saved];
        saveDataNow();
        return json(res, 200, { ok: true, post: saved }), true;
      }
      const messageId = await postToGroup(group, { ...post, groupId: group.id });
      saveDataNow();
      return json(res, 200, { ok: true, messageId }), true;
    } catch (error) {
      recordError('Публикация объекта в канал', error);
      return json(res, 400, { error: 'Не удалось опубликовать: ' + error.message }), true;
    }
  }

  // Объявление об объекте в несколько групп сразу: предпросмотр и публикация.
  const listingMatch = url.pathname.match(/^\/api\/objects\/([^/]+)\/listing-(preview|publish|unpublish|update)$/);
  if (listingMatch) {
    const record = (data.objects || []).find((item) => item.id === decodeURIComponent(listingMatch[1]));
    if (!record) return json(res, 404, { error: 'Объект не найден' }), true;
    if (listingMatch[2] === 'preview' && req.method === 'GET') {
      const language = LISTING_LANGUAGES.includes(url.searchParams.get('language')) ? url.searchParams.get('language') : 'ru';
      const layout = url.searchParams.get('layout') === 'split' ? 'split' : 'single';
      const message = listingMessage(record, language, { layout, withoutSignature: url.searchParams.get('signature') === '0', source: 'group' });
      return json(res, 200, {
        language,
        layout: message.layout,
        album: message.album,
        caption: message.caption,
        html: message.html,
        photoCount: message.images.length,
        buttonText: message.buttonText,
        hasButton: Boolean(message.markup),
        truncated: message.truncated,
        plainLength: message.plainLength,
      }), true;
    }
    if (listingMatch[2] === 'publish' && req.method === 'POST') {
      return publishListing(res, record, await readJson(req)), true;
    }
    if (listingMatch[2] === 'update' && req.method === 'POST') {
      return updateListings(res, record, await readJson(req)), true;
    }
    if (listingMatch[2] === 'unpublish' && req.method === 'POST') {
      return unpublishListing(res, record, await readJson(req)), true;
    }
    return json(res, 405, { error: 'Неверный метод' }), true;
  }

  if (!match) return json(res, 404, { error: 'Неизвестный запрос' }), true;
  const group = groupById(match[1]);
  if (!group) return json(res, 404, { error: 'Группа не найдена' }), true;
  const action = match[2] || '';
  const target = match[3] || '';
  const sub = match[4] || '';

  try {
    // --- Публикации ---------------------------------------------------------
    if (action === 'post' && req.method === 'POST') {
      const body = await readJson(req);
      const fields = { ...body, groupId: group.id, threadId: requestedThread(group, body.threadId), image: postImage(body) };
      if (body.sendAt) {
        const scheduled = (data.groupPosts || []).filter((item) => item.status === 'scheduled');
        if (scheduled.length >= MAX_SCHEDULED_POSTS) throw new Error('Слишком много отложенных публикаций');
        if (!cleanText(fields.text, 4000) && !fields.image) throw new Error('Сообщение пустое');
        const post = newGroupPost({ ...fields, sendAt: futureDate(body.sendAt) });
        data.groupPosts = [...(data.groupPosts || []), post];
        saveDataNow();
        return json(res, 200, { ok: true, post }), true;
      }
      if (body.preview) {
        // Проверка вида: тот же пост, но в админ-чат, а не в группу.
        const adminChatId = cleanText(data.config.adminChatId, 40);
        if (!adminChatId) throw new Error("Админ-чат не настроен");
        await postToGroup({ ...group, id: adminChatId, messages: [] }, { ...fields, threadId: 0, pin: false });
        return json(res, 200, { ok: true, preview: true }), true;
      }
      const messageId = await postToGroup(group, fields);
      saveDataNow();
      return json(res, 200, { ok: true, messageId }), true;
    }

    // --- Темы (подгруппы) ---------------------------------------------------
    // Список тем Telegram боту не отдаёт: бот запоминает те, о которых узнал по
    // сообщениям, а остальные можно добавить по ссылке или создать заново.
    if (action === 'topics' && !target && !sub && req.method === 'POST') {
      const body = await readJson(req);
      const name = cleanText(body.name, 128);
      if (!name) throw new Error('Назовите тему');
      if (!group.isForum) throw new Error('В этой группе не включены темы. Включите их в Telegram: «Управление группой» → «Темы».');
      let created;
      try {
        created = await telegramRequest(token(), 'createForumTopic', { chat_id: group.id, name });
      } catch (error) {
        if (/not enough rights|CHAT_ADMIN_REQUIRED|manage topics/i.test(error.message)) {
          throw new Error('У бота нет права управлять темами. В Telegram откройте «Администраторы» → бот и включите «Управление темами».');
        }
        throw error;
      }
      const threadId = Number(created && created.message_thread_id);
      if (!threadId) throw new Error('Telegram не вернул номер новой темы');
      const topic = rememberTopic(group, threadId, { name, closed: false, at: new Date().toISOString() });
      saveDataNow();
      return json(res, 200, { ok: true, topic, topics: group.topics }), true;
    }

    if (action === 'topics' && !target && sub === 'add' && req.method === 'POST') {
      const body = await readJson(req);
      const threadId = topicFromInput(group, body.link);
      if (threadId <= GENERAL_TOPIC_ID) throw new Error('«Общая» тема уже в списке');
      const known = findTopic(group, threadId);
      const topic = rememberTopic(group, threadId, { name: body.name, manual: !known, at: known ? known.lastMessageAt : '' });
      if (!topic) throw new Error('Слишком много тем');
      saveDataNow();
      return json(res, 200, { ok: true, topic, topics: group.topics }), true;
    }

    if (action === 'topics' && target && !sub && req.method === 'DELETE') {
      if (!forgetTopic(group, target)) throw new Error('Такой темы в списке нет');
      saveDataNow();
      return json(res, 200, { ok: true, topics: group.topics }), true;
    }

    if (action === 'messages' && target && req.method === 'DELETE') {
      await telegramRequest(token(), 'deleteMessage', { chat_id: group.id, message_id: Number(target) });
      forgetGroupMessage(group, target);
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    if (action === 'messages' && target && req.method === 'PUT') {
      const body = await readJson(req);
      const text = cleanText(body.text, 4000);
      if (!text) throw new Error('Текст пустой');
      const method = body.caption ? 'editMessageCaption' : 'editMessageText';
      await telegramRequest(token(), method, { chat_id: group.id, message_id: Number(target), [body.caption ? 'caption' : 'text']: text });
      const saved = group.messages.find((item) => item.messageId === Number(target));
      if (saved) saved.text = text.slice(0, 1000);
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    if (action === 'pin' && req.method === 'POST') {
      const body = await readJson(req);
      const messageId = Number(body.messageId);
      if (!messageId) throw new Error('Не выбрано сообщение');
      await telegramRequest(token(), 'pinChatMessage', { chat_id: group.id, message_id: messageId, disable_notification: !body.notify });
      group.pinnedMessageId = messageId;
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    if (action === 'unpin' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.all) await telegramRequest(token(), 'unpinAllChatMessages', { chat_id: group.id });
      else await telegramRequest(token(), 'unpinChatMessage', { chat_id: group.id, ...(body.messageId ? { message_id: Number(body.messageId) } : {}) });
      group.pinnedMessageId = 0;
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    // --- Описание и оформление ---------------------------------------------
    if (action === 'info' && req.method === 'PUT') {
      const body = await readJson(req);
      const title = cleanText(body.title, 128);
      const description = cleanText(body.description, 255);
      if (title && title !== group.title) {
        await telegramRequest(token(), 'setChatTitle', { chat_id: group.id, title });
        group.title = title;
      }
      if (description !== group.description) {
        await telegramRequest(token(), 'setChatDescription', { chat_id: group.id, description });
        group.description = description;
      }
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    if (action === 'permissions' && req.method === 'PUT') {
      const body = await readJson(req);
      const permissions = Object.fromEntries(CHAT_PERMISSIONS.map((name) => [name, Boolean(body[name])]));
      await telegramRequest(token(), 'setChatPermissions', { chat_id: group.id, permissions });
      group.permissions = permissions;
      saveDataNow();
      return json(res, 200, { ok: true, permissions }), true;
    }

    // --- Участники ----------------------------------------------------------
    if (action === 'admins' && req.method === 'GET') {
      const admins = await fetchAdministrators(group);
      return json(res, 200, { admins }), true;
    }

    if (action === 'members' && target && req.method === 'POST') {
      const body = await readJson(req);
      const untilDate = body.until ? Math.floor(Date.parse(body.until) / 1000) : 0;
      if (sub === 'ban') {
        await telegramRequest(token(), 'banChatMember', { chat_id: group.id, user_id: Number(target), revoke_messages: Boolean(body.revokeMessages), ...(untilDate ? { until_date: untilDate } : {}) });
      } else if (sub === 'unban') {
        await telegramRequest(token(), 'unbanChatMember', { chat_id: group.id, user_id: Number(target), only_if_banned: true });
      } else if (sub === 'restrict') {
        const permissions = Object.fromEntries(CHAT_PERMISSIONS.map((name) => [name, Boolean(body[name])]));
        await telegramRequest(token(), 'restrictChatMember', { chat_id: group.id, user_id: Number(target), permissions, ...(untilDate ? { until_date: untilDate } : {}) });
      } else if (sub === 'promote') {
        await telegramRequest(token(), 'promoteChatMember', {
          chat_id: group.id,
          user_id: Number(target),
          can_manage_chat: Boolean(body.can_manage_chat),
          can_delete_messages: Boolean(body.can_delete_messages),
          can_restrict_members: Boolean(body.can_restrict_members),
          can_invite_users: Boolean(body.can_invite_users),
          can_pin_messages: Boolean(body.can_pin_messages),
          can_change_info: Boolean(body.can_change_info),
        });
      } else {
        throw new Error('Неизвестное действие с участником');
      }
      return json(res, 200, { ok: true }), true;
    }

    if (action === 'join-requests' && target && req.method === 'POST') {
      const body = await readJson(req);
      await telegramRequest(token(), body.approve ? 'approveChatJoinRequest' : 'declineChatJoinRequest', { chat_id: group.id, user_id: Number(target) });
      group.joinRequests = (group.joinRequests || []).filter((item) => item.userId !== String(target));
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    // --- Ссылка-приглашение -------------------------------------------------
    if (action === 'invite-link' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.revoke && group.inviteLink) {
        await telegramRequest(token(), 'revokeChatInviteLink', { chat_id: group.id, invite_link: group.inviteLink });
        group.inviteLink = '';
      } else {
        const link = await telegramRequest(token(), 'createChatInviteLink', {
          chat_id: group.id,
          name: cleanText(body.name, 32) || 'Из панели',
          ...(body.memberLimit ? { member_limit: Math.min(99999, Math.max(1, Number(body.memberLimit))) } : {}),
          ...(body.approval ? { creates_join_request: true } : {}),
        });
        group.inviteLink = cleanText(link && link.invite_link, 200);
      }
      saveDataNow();
      return json(res, 200, { ok: true, inviteLink: group.inviteLink }), true;
    }

    if (action === 'leave' && req.method === 'POST') {
      await telegramRequest(token(), 'leaveChat', { chat_id: group.id });
      group.status = 'left';
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    if (!action && req.method === 'DELETE') {
      // Forget a chat the bot is no longer in; it comes back if it is added again.
      data.groups = groupList().filter((item) => item.id !== group.id);
      saveDataNow();
      return json(res, 200, { ok: true }), true;
    }

    if (!action && req.method === 'GET') {
      await refreshGroup(group);
      return json(res, 200, { group }), true;
    }
  } catch (error) {
    recordError('Группа ' + (group.title || group.id), error);
    return json(res, 400, { error: error.message }), true;
  }

  return json(res, 404, { error: 'Неизвестный запрос' }), true;
}

export { CHAT_PERMISSIONS, handleGroupApi };
