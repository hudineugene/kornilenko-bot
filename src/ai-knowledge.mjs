// База знаний ИИ-консультанта (GenAgent) собирается из данных бота и отправляется сама: объекты, о компании и контакты,
// гиды по покупке, расходы. Раз в 5 минут бот сверяет собранное с последним отправленным и, если что-то изменилось
// (новый объект, цена, снят с продажи, правка текста), отправляет заново. После запуска — один раз сразу.
// Отправляется только то, что и так видят клиенты: без данных клиентов, заявок и ключей.

import crypto from 'node:crypto';
import { data } from './store.mjs';
import { aiAgentSettings } from './ai-agent.mjs';

const SYNC_EVERY_MS = 5 * 60 * 1000;
// Даже без изменений — раз в 6 часов: GenAgent по тишине понимает, что синхронизация сломалась.
const RESEND_MS = 6 * 60 * 60 * 1000;
const FIRST_SYNC_DELAY_MS = 20 * 1000;
const TIMEOUT_MS = 60000;

const ru = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? String(value.ru || value.en || '') : String(value || '')).trim();
const CONDITION = { under_construction: 'строится', new: 'новый', renovated: 'после ремонта', resale: 'вторичка', good: 'в хорошем состоянии' };
const TYPE = { apartment: 'апартаменты', villa: 'вилла', house: 'дом', townhouse: 'таунхаус', penthouse: 'пентхаус', newbuild: 'новостройка', land: 'участок', commercial: 'коммерческая недвижимость' };
const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function money(value, currency) {
  const number = Number(value);
  if (!(number > 0)) return 'по запросу';
  return number.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ' + (currency === 'EUR' || !currency ? '€' : currency);
}

function objectText(record) {
  const from = record.priceFrom ? 'от ' : '';
  const names = ['en', 'es'].map((language) => record.title && record.title[language]).filter(Boolean).join(' / ');
  const facts = [
    'Код объекта: ' + (record.reference || record.id),
    record.status === 'reserved' ? 'Статус: забронирован' : '',
    'Цена: ' + from + money(record.priceValue, record.currency) + (record.dealType === 'rent' && record.pricePeriod ? ' (' + record.pricePeriod + ')' : ''),
    'Тип: ' + [TYPE[record.propertyType] || record.propertyType, record.dealType === 'rent' ? 'аренда' : 'продажа', CONDITION[record.condition] || record.condition].filter(Boolean).join(', '),
    'Где: ' + [ru(record.city), ru(record.district)].filter(Boolean).join(', ') + (ru(record.address) ? ' (адрес: ' + ru(record.address) + ')' : ''),
    record.bedrooms ? 'Спальни: ' + from + record.bedrooms : '',
    record.bathrooms ? 'Санузлы: ' + record.bathrooms : '',
    record.area ? 'Площадь: ' + from + record.area + ' м²' : '',
    record.plotArea ? 'Участок: ' + record.plotArea + ' м²' : '',
    record.floor ? 'Этаж: ' + record.floor : '',
    record.distanceSea ? 'До моря: ~' + String(Math.round(record.distanceSea / 100) / 10).replace('.', ',') + ' км' : '',
    record.url ? 'Сайт проекта: ' + record.url : '',
  ].filter(Boolean);
  return '## ' + ru(record.title) + (names ? ' (' + names + ')' : '') + '\n' + facts.join('\n') + '\n\n' + ru(record.description);
}

// Адрес офиса из ссылки Google Maps (…/place/Carrer+Benifato,+10,…/@…), если отдельно не указан.
function officeFromMap(url) {
  const match = /\/place\/([^/@]+)/.exec(String(url || ''));
  if (!match) return '';
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
  } catch {
    return '';
  }
}

// [{ key, title, content }] — то, что отправляется в GenAgent.
function buildKnowledge() {
  const objects = (data.objects || []).filter((record) => ['active', 'reserved'].includes(record.status));
  const contacts = data.contacts || {};
  const hours = (data.config && data.config.workingHours) || {};
  const calc = (data.config && data.config.calculator) || {};
  const about = ru(data.config && data.config.menu && data.config.menu.ru && data.config.menu.ru.about);
  const office = cleanLine((data.trust && data.trust.officeAddress) || '') || officeFromMap(contacts.mapUrl);
  const days = Array.isArray(hours.days) && hours.days.length ? hours.days.map((day) => DAY_NAMES[day]).filter(Boolean).join(', ') : '';

  const sources = [
    {
      key: 'objects',
      title: 'Объекты в продаже',
      content: '# Объекты\nЦены и наличие ориентировочные, актуальные подтверждает менеджер. У каждого объекта есть карточка с фото, расчётом расходов и записью на просмотр.\n\n'
        + (objects.length ? objects.map(objectText).join('\n\n') : 'Сейчас объектов в продаже нет — предложите оставить заявку менеджеру.'),
    },
    {
      key: 'company',
      title: 'О компании и контакты',
      content: [
        about ? '# О компании\n' + about : '',
        '# Контакты',
        contacts.managerName ? '- Менеджер: ' + contacts.managerName : '',
        contacts.phone ? '- Телефон' + (contacts.whatsappEnabled ? ' / WhatsApp' : '') + ': ' + contacts.phone : '',
        contacts.telegram ? '- Telegram: ' + contacts.telegram : '',
        contacts.email ? '- Email: ' + contacts.email : '',
        contacts.website ? '- Сайт: ' + contacts.website : '',
        office ? '- Офис: ' + office : '',
        contacts.mapUrl ? '- Офис на карте: ' + contacts.mapUrl : '',
        days && hours.from && hours.to ? '- Время работы менеджера: ' + days + ' ' + hours.from + '–' + hours.to + ' (' + ((data.config && data.config.timeZone) || 'Europe/Madrid') + ')' : '',
      ].filter(Boolean).join('\n'),
    },
    {
      key: 'guides',
      title: 'Как купить недвижимость в Испании',
      content: [
        '# Гиды по покупке',
        ...(data.guidePages || []).map((page) => '## ' + ru(page.title) + '\n' + ru(page.text || page.body)),
        '# План покупки по шагам',
        ...(data.buyPlan || []).map((step, index) => (index + 1) + '. ' + ru(step.title) + ' — ' + ru(step.text || step.description)),
      ].join('\n\n'),
    },
    {
      key: 'costs',
      title: 'Расходы на покупку и ипотека',
      content: [
        '# Расходы сверх цены объекта (как считает калькулятор бота)',
        '- Новостройка: IVA ' + calc.newBuildTaxPercent + '% и гербовый сбор (AJD) ' + calc.stampDutyPercent + '%',
        '- Вторичное жильё: налог ITP ' + calc.resaleTaxPercent + '%',
        '- Участок и коммерческая недвижимость: IVA ' + calc.businessTaxPercent + '%',
        '- Нотариус, регистрация, оформление: около ' + calc.otherCostsPercent + '%',
        '- В сумме обычно закладывают 10–14% сверх цены.',
        '',
        '# Ипотека в калькуляторе (пример, не предложение банка)',
        '- Первый взнос: ' + calc.downPaymentPercent + '% (нерезидентам банки обычно дают до 60–70% стоимости)',
        '- Ставка: ' + calc.interestPercent + '% годовых, срок: ' + calc.years + ' лет',
        '- Точный расчёт по объекту — в карточке объекта; условия банка подтверждает сам банк.',
      ].join('\n'),
    },
  ];
  return sources.filter((source) => source.content.trim());
}

function cleanLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const state = { lastHash: '', lastSyncAt: '', lastError: '', timer: null, running: false };

function knowledgeHash(sources) {
  return crypto.createHash('sha256').update(JSON.stringify(sources)).digest('hex');
}

// Отправить, если база изменилась с прошлой отправки (force — отправить в любом случае).
async function syncKnowledge({ force = false } = {}) {
  const settings = aiAgentSettings();
  if (!settings || state.running) return { skipped: true };
  const sources = buildKnowledge();
  const hash = knowledgeHash(sources) + '|' + settings.url;
  const fresh = state.lastSyncAt && Date.now() - Date.parse(state.lastSyncAt) < RESEND_MS;
  if (!force && hash === state.lastHash && fresh) return { unchanged: true };
  state.running = true;
  try {
    const response = await fetch(settings.url + '/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.key },
      body: JSON.stringify({ sources }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('GenAgent ответил ' + response.status);
    const result = await response.json().catch(() => ({}));
    state.lastHash = hash;
    state.lastSyncAt = new Date().toISOString();
    state.lastError = '';
    return result;
  } catch (error) {
    state.lastError = error.message;
    console.error('База знаний ИИ-консультанта не отправилась:', error.message);
    return { error: error.message };
  } finally {
    state.running = false;
  }
}

function startKnowledgeSync() {
  if (state.timer) return;
  const first = setTimeout(() => void syncKnowledge(), FIRST_SYNC_DELAY_MS);
  state.timer = setInterval(() => void syncKnowledge(), SYNC_EVERY_MS);
  if (first.unref) first.unref();
  if (state.timer.unref) state.timer.unref();
}

function stopKnowledgeSync() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function knowledgeSyncState() {
  return { lastSyncAt: state.lastSyncAt, lastError: state.lastError };
}

function resetKnowledgeSync() {
  state.lastHash = '';
  state.lastSyncAt = '';
  state.lastError = '';
}

export { buildKnowledge, knowledgeSyncState, resetKnowledgeSync, startKnowledgeSync, stopKnowledgeSync, syncKnowledge };
