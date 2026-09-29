// API панели: каталог, акции, их фотографии и картинка приветствия.

import crypto from 'node:crypto';
import { cleanText, clone } from './util.mjs';
import { normalizeGuidePages, pruneOrphanPropertyAnalytics } from './data-format.mjs';
import { imageExists } from './media.mjs';
import { data, saveDataNow } from './store.mjs';
import { recordImages } from './catalog.mjs';
import { binaryImage, json, parseUploadedImage, readJson, requireAuth } from './admin-http.mjs';
import { parseContentRecord } from './admin-input.mjs';
import { queuePropertyAlerts } from './alerts.mjs';

// Каждая ветка сама отвечает клиенту и возвращает управление. Если не подошла
// ни одна, функция возвращает false — тогда запрос ищут в других модулях.

async function handleContentApi(req, res, url) {
  // Плашка рубрики лежит в настройках, а не в коллекции.
  const rubricMatch = url.pathname.match(/^\/api\/media\/rubrics\/([^/]+)$/);
  if (rubricMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const rubrics = (data.config.publishing && data.config.publishing.rubrics) || [];
    const rubric = rubrics.find((item) => item.id === decodeURIComponent(rubricMatch[1]));
    if (!rubric || !imageExists(rubric.image)) return json(res, 404, { error: 'Изображение не найдено' });
    return binaryImage(res, rubric.image, req);
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
    return binaryImage(res, image, req);
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
      // Пометка о снижении цены ставится уже после первой записи — сохраняем её.
      if (kind === 'objects') saveDataNow();
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

  const welcomeImageMatch = url.pathname.match(/^\/api\/images\/(ru|en|es)\/welcome$/);
  if (welcomeImageMatch && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const image = data.welcomeImages[welcomeImageMatch[1]];
    if (!imageExists(image)) return json(res, 404, { error: 'Изображение не загружено' });
    return binaryImage(res, image, req);
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

  // Гид «Как купить в Испании»: набор страниц задан ботом, владелец правит
  // заголовки и тексты на трёх языках.
  if (url.pathname === '/api/guide' && req.method === 'PUT') {
    const session = requireAuth(req, res, true);
    if (!session) return;
    const body = await readJson(req);
    data.guidePages = normalizeGuidePages(Array.isArray(body.pages) ? body.pages : []);
    saveDataNow();
    return json(res, 200, { ok: true, pages: data.guidePages });
  }

  return false;
}

export {
  handleContentApi,
};
