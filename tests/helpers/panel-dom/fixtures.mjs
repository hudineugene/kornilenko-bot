// Состояние панели для аудита: руками собранное по форме safeState (src/admin-http.mjs читался только глазами).
// H — «вредная» строка: кавычки и тег. Если где-то текст вставлен в разметку без экранирования, разбор это покажет.
export const H = '"\'><u data-leak="1">Щ</u>';
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();
const day = (offset) => new Date(now + offset * 864e5).toISOString().slice(0, 10);
const HOUR = 3600e3, DAY = 864e5;

export function richState() {
  const users = [
    { id: 'u1', chatId: 1001, firstName: 'Анна ' + H, lastName: 'Иванова', username: 'anna', phone: '+34 600 111 222', preferredLanguage: 'ru', source: 'instagram ' + H, tags: ['покупка', 'горячий ' + H], note: 'Заметка ' + H, favorites: ['obj1'], comparisonIds: ['obj1', 'obj3'], recentlyViewed: ['obj1'], selectionMatchIds: ['obj3'], savedSearch: { filter: { deal: 'sale', type: 'villa', city: 'Альтеа ' + H, bedrooms: 3, maxPrice: 350000 }, enabled: true }, goal: 'live', plan: { startedAt: iso(-DAY), done: { nie: true }, help: { bank: true } }, firstSeenAt: iso(-5 * DAY), lastSeenAt: iso(-HOUR), messages: 4, activity: [{ kind: 'reaction', text: '👍 ' + H, createdAt: iso(-HOUR) }], contactName: '', preferredContactTime: 'после 18 ' + H },
    { id: 'u2', chatId: 1002, firstName: 'Carlos', lastName: H, username: '', phone: '+34 600 333 444', preferredLanguage: 'es', source: '', tags: [], note: '', firstSeenAt: iso(-20 * DAY), lastSeenAt: iso(-3 * DAY), messages: 2, activity: [] },
    { id: 'u3', chatId: 1003, firstName: 'John', lastName: 'Smith', username: 'john', phone: '', preferredLanguage: 'en', source: 'google', tags: [], note: '', firstSeenAt: iso(-2 * DAY), lastSeenAt: iso(-2 * HOUR), messages: 1, activity: [] },
    { id: 'u4', chatId: 1004, firstName: 'Олег', lastName: '', username: '', phone: '', preferredLanguage: 'ru', source: '', blocked: true, tags: [], note: '', firstSeenAt: iso(-40 * DAY), lastSeenAt: iso(-30 * DAY), messages: 0, activity: [] },
    { id: 'u5', chatId: 1005, firstName: '', lastName: '', username: 'nobody', phone: '', preferredLanguage: '', source: '', tags: [], note: '', firstSeenAt: iso(-DAY), lastSeenAt: iso(-DAY), messages: 0, activity: [] },
    { id: 'u6', chatId: 0, firstName: 'Ручной', lastName: 'Клиент', username: '', phone: '600 333 444', preferredLanguage: '', source: 'звонок', tags: [], note: '', firstSeenAt: iso(-DAY), lastSeenAt: iso(-DAY), messages: 0, activity: [] },
    { id: 'u7', chatId: 1007, firstName: 'Без', lastName: 'Заявок', username: 'nolead', phone: '', preferredLanguage: 'ru', source: '', tags: [], note: '', firstSeenAt: iso(-DAY), lastSeenAt: iso(-DAY), messages: 0, activity: [] },
  ];
  const objects = [
    { id: 'obj1', reference: 'REF-1 ' + H, title: { ru: 'Квартира у моря ' + H, en: 'Sea flat', es: '' }, description: { ru: 'Описание ' + H, en: '', es: '' }, city: { ru: 'Альтеа ' + H, en: 'Altea', es: '' }, district: { ru: 'Центр', en: '', es: '' }, address: { ru: '', en: '', es: '' }, price: { ru: '', en: '', es: '' }, propertyType: 'apartment', dealType: 'sale', status: 'active', priceValue: 250000, currency: 'EUR', pricePeriod: 'total', bedrooms: 2, bathrooms: 1, area: 70, badges: ['new'], url: 'https://example.com/?a="b"', mapUrl: '', videoUrl: '', imagesByLanguage: { ru: [{ id: 'img1' }, { id: 'img2' }], en: [], es: [{ id: 'img3' }] }, publicationIssues: { ru: [], en: ['описание'], es: ['название', 'описание', 'город'] } },
    { id: 'obj2', reference: '', title: { ru: '', en: '', es: '' }, description: {}, city: {}, propertyType: 'land', dealType: 'sale', status: 'hidden', imagesByLanguage: {}, publicationIssues: { ru: ['название'], en: ['название'], es: ['название'] } },
    { id: 'obj3', reference: 'REF-3', title: { ru: 'Вилла', en: 'Villa', es: 'Villa' }, description: { ru: 'd', en: 'd', es: 'd' }, city: { ru: 'Кальпе', en: 'Calpe', es: 'Calpe' }, propertyType: 'villa', dealType: 'rent', status: 'reserved', priceValue: 0, price: { ru: 'по запросу ' + H }, currency: 'EUR', pricePeriod: 'month', bedrooms: 4, bathrooms: 3, area: 180, plotArea: 500, imagesByLanguage: { ru: [{ id: 'i' }] }, publicationIssues: { ru: [], en: [], es: [] } },
    { id: 'obj4', reference: 'REF-4', title: { ru: 'Проданный дом', en: '', es: '' }, description: { ru: 'd' }, city: { ru: 'Дения' }, propertyType: 'house', dealType: 'sale', status: 'sold', priceValue: 100000, currency: 'USD', imagesByLanguage: { ru: [] }, publicationIssues: { ru: ['фотография'], en: ['название'], es: ['название'] } },
  ];
  const inquiries = [
    { id: 'inq1', userId: 'u1', chatId: 1001, language: 'ru', type: 'general', text: 'Есть ли парковка? ' + H, status: 'new', pipelineStage: 'new', replies: [], awaitsReply: true, createdAt: iso(-HOUR), updatedAt: iso(-HOUR), clientMessageAt: iso(-HOUR / 2), lastMessage: { text: 'Последнее ' + H, direction: 'in' }, clientMessageCount: 2, assignee: '', note: '' },
    { id: 'inq2', userId: 'u2', chatId: 1002, language: 'es', type: 'viewing', text: 'Quiero ver', status: 'in_progress', pipelineStage: 'viewing', propertyId: 'obj1', viewing: { dateText: 'в субботу ' + H, timeText: 'после обеда' }, replies: [], awaitsReply: true, createdAt: iso(-4 * DAY), updatedAt: iso(-3 * DAY), clientMessageAt: iso(-3 * DAY), followUpDate: day(-1), followUpTime: '10:00', assignee: 'Мария', lastMessage: { text: 'Hola', direction: 'in' } },
    { id: 'inq3', userId: 'u3', chatId: 1003, language: 'en', type: 'viewing', text: 'I want to see', status: 'in_progress', pipelineStage: 'negotiation', propertyId: 'obj3', viewing: { date: day(2), confirmedDate: day(2), confirmedTime: '12:00', confirmedAt: iso(-HOUR), online: true }, replies: [{ text: 'ok' }], awaitsReply: false, createdAt: iso(-2 * DAY), updatedAt: iso(-HOUR), followUpDate: day(3), assignee: 'Менеджер ' + H, lastMessage: { text: 'Спасибо', direction: 'out', fromBot: false } },
    { id: 'inq4', userId: 'u1', chatId: 1001, language: 'ru', type: 'selection', text: 'Подбор', status: 'in_progress', pipelineStage: 'selection', selection: { deal: 'покупка', type: 'вилла', location: 'Альтеа ' + H, budget: 'до 350 000 €', bedrooms: '3' }, matching: { results: [{ id: 'obj1', tier: 'exact', score: 92, reasons: ['deal', 'type'], warnings: [] }, { id: 'obj3', tier: 'close', score: 70, reasons: ['location'], warnings: ['budgetClose', 'priceMissing'] }, { id: 'gone', tier: 'consider', score: 40, reasons: [], warnings: ['location'] }] }, replies: [{ text: 'a' }], awaitsReply: false, createdAt: iso(-3 * DAY), updatedAt: iso(-2 * DAY), followUpDate: day(0), followUpTime: '15:00' },
    { id: 'inq5', userId: 'u4', chatId: 1004, language: 'ru', type: 'lead', text: 'Позвоните', status: 'closed', pipelineStage: 'won', wonAt: iso(-DAY), replies: [{ text: 'a' }], awaitsReply: false, createdAt: iso(-35 * DAY), updatedAt: iso(-30 * DAY) },
    { id: 'inq6', userId: 'u4', chatId: 1004, language: 'ru', type: 'viewing', text: 'Отменил', status: 'in_progress', pipelineStage: 'lost', propertyId: 'missing', viewing: { date: day(-10), cancelledAt: iso(-9 * DAY) }, replies: [], awaitsReply: false, createdAt: iso(-12 * DAY), updatedAt: iso(-9 * DAY) },
    { id: 'inq7', userId: 'u5', chatId: 1005, language: '', type: 'general', text: 'искал', searchLead: true, status: 'new', replies: [], awaitsReply: false, createdAt: iso(-DAY), updatedAt: iso(-DAY) },
    { id: 'inq8', userId: 'u3', chatId: 1003, language: 'en', type: 'viewing', text: 'old viewing', status: 'in_progress', pipelineStage: 'contact', propertyId: 'obj1', viewing: { date: day(-3), confirmedDate: day(-3), confirmedTime: '09:00', confirmedAt: iso(-5 * DAY) }, replies: [{ text: 'a' }], awaitsReply: false, createdAt: iso(-6 * DAY), updatedAt: iso(-5 * DAY) },
    { id: 'inq9', userId: 'u2', chatId: 1002, language: 'es', type: 'viewing', text: 'pending past', status: 'new', pipelineStage: 'viewing', propertyId: 'obj3', viewing: { date: day(-1), timeText: '11:00' }, replies: [], awaitsReply: true, createdAt: iso(-2 * DAY), updatedAt: iso(-2 * DAY), clientMessageAt: iso(-5 * HOUR) },
  ];
  const groups = [
    { id: 'g1', type: 'channel', title: 'Канал ' + H, username: 'kornilenko', status: 'administrator', rights: { can_pin_messages: true, can_delete_messages: true, can_change_info: true }, memberCount: 120, messageCount: 2, lastMessageId: 5, joinRequestCount: 0, pinnedMessageId: 5, inviteLink: 'https://t.me/+abc"x', description: 'Описание ' + H, topics: [] },
    { id: 'g2', type: 'supergroup', title: 'Группа с темами', username: '', status: 'member', rights: {}, isForum: true, memberCount: 15, messageCount: 1, lastMessageId: 9, joinRequestCount: 2, lastError: 'Ошибка ' + H, topics: [{ id: 1, name: '' }, { id: 7, name: 'Новостройки ' + H, closed: true, lastMessageAt: iso(-DAY) }] },
    { id: 'g3', type: 'group', title: 'Покинутая', status: 'left', rights: {}, memberCount: 0, messageCount: 0, joinRequestCount: 0, topics: [] },
    { id: 'g4', type: 'supergroup', title: 'Админ-группа', status: 'creator', rights: {}, isForum: true, memberCount: 30, messageCount: 0, joinRequestCount: 1, topics: [{ id: 3, name: 'Продажа' }] },
  ];
  return {
    csrf: 'csrf', stateVersion: 'v1',
    bot: { username: 'kornilenko_bot', firstName: 'Бот ' + H },
    runtime: { status: 'ok', consecutiveFailures: 0, lastSuccessfulContactAt: iso(-1000), tunnel: { status: 'error', error: 'туннель ' + H, url: '' }, save: {} },
    config: {
      messages: { ru: { greeting: 'Привет, {first_name}! ' + H, help: 'Помощь', fallback: 'Не понял' }, en: { greeting: 'Hi' }, es: {} },
      menu: { ru: { objects: 'Пусто ' + H, promotions: '', about: 'О нас ' + H }, en: {}, es: {} },
      active: true, adminChatId: '555', adminNotificationVerifiedAt: '', notifyMode: 'inquiries',
      notifyPrefs: { kinds: { inquiry: 'sound', reminder: 'silent', viewing: 'sound', digest: 'off', system: 'sound' }, quiet: { enabled: true, from: '22:00', to: '08:00' } },
      remoteAccess: false, tunnelTokenSet: true, tunnelHostname: 'panel.example.com', reminderHours: 2, retentionMonths: 0, timeZone: 'Europe/Madrid',
      workingHours: { enabled: true, from: '09:00', to: '19:00', days: [1, 2, 3, 4, 5], replyMinutes: 0, note: { ru: 'Мы ответим {next} ' + H } }, statusNotices: true,
      calculator: { enabled: false, resaleTaxPercent: 10, newBuildTaxPercent: 10, businessTaxPercent: 21, stampDutyPercent: 1.5, otherCostsPercent: 2, downPaymentPercent: 30, interestPercent: 3.5, years: 25 },
      viewingSlots: { enabled: true, days: [1, 3], times: ['10:00', '12:00'], daysAhead: 7, perSlot: 1 },
      adminName: 'Олег ' + H, feedImport: { url: 'https://site/feed.xml?a="1"', publishNew: false, daily: true, lastRunAt: iso(-DAY), lastResult: { added: 1, updated: 2, photos: 3 }, lastError: 'Сбой ' + H },
      managers: [{ id: 'm1', name: 'Мария', chatId: '111', verifiedAt: iso(-DAY) }, { id: 'm2', name: 'Менеджер ' + H, chatId: '222' }],
      telegramBackup: { enabled: true, passwordSet: true, lastSentAt: iso(-DAY), lastError: 'Не ушла ' + H },
    },
    welcomeImages: { ru: { exists: true, updatedAt: iso(-DAY) }, en: {}, es: {} },
    rules: [{ id: 'r1', order: 1, trigger: 'цена ' + H, type: 'contains', answer: 'Ответ ' + H, language: 'ru', enabled: true }, { id: 'r2', order: 2, trigger: 'hola', type: 'exact', answer: 'Hola', language: 'all', enabled: false }],
    users, userCount: 9, activeUserCount: 5,
    stats: { messagesReceived: 100, messagesSent: 80, reactionsReceived: 3, statisticsResetAt: '' },
    analytics: { daily: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [day(-i), { received: i % 5 }])), properties: { obj1: { impressions: 10, details: 4 }, obj3: { impressions: 3, details: 1 } } },
    objects,
    promotions: [
      { id: 'p1', title: { ru: 'Скидка ' + H }, text: { ru: 'Текст ' + H }, enabled: true, startAt: day(-1), endAt: day(5), url: '', imagesByLanguage: { ru: [{ id: 'pi' }] } },
      { id: 'p2', title: { ru: 'Выключена' }, text: {}, enabled: false, imagesByLanguage: {} },
      { id: 'p3', title: { ru: 'Будущая' }, text: {}, enabled: true, startAt: day(3), endAt: day(9), imagesByLanguage: {} },
      { id: 'p4', title: { ru: 'Прошедшая' }, text: {}, enabled: true, startAt: day(-9), endAt: day(-3), imagesByLanguage: {} },
    ],
    contacts: { phone: '+34 600 000 000, +34 611 111 111', whatsapp: '', whatsappEnabled: true, telegram: '@korn', email: 'a@b.c', website: 'https://k.es', mapUrl: 'https://maps', managerName: 'Олег ' + H, text: { ru: 'Пишите ' + H, en: '', es: '' }, photo: { exists: true, updatedAt: iso(-DAY) } },
    trust: { yearsOnMarket: 10, dealsCount: 50, registration: 'Рег ' + H, officeAddress: 'Адрес ' + H, reviewsUrl: 'https://r', reviews: [{ name: 'Ханс ' + H, country: 'Германия', text: 'Отлично ' + H, allowed: true }, { name: 'Без разрешения', country: '', text: 'текст', allowed: false }] },
    engagement: { digest: false, comeback: true, planReminder: false, audience: 3, activeObjects: 1 },
    guidePages: [{ id: 'gp1', title: { ru: 'Шаг 1 ' + H, en: 'Step', es: '' }, text: { ru: 'Текст ' + H, en: '', es: '' } }, { id: 'gp2', title: { ru: 'Шаг 2', en: '', es: '' }, text: { ru: '', en: '', es: '' } }],
    buyPlan: [{ id: 'nie', title: { ru: 'NIE ' + H, en: 'NIE', es: 'NIE' }, text: { ru: 'Текст ' + H, en: '', es: '' } }, { id: 'bank', title: { ru: 'Счёт', en: '', es: '' }, text: { ru: '', en: '', es: '' } }],
    errors: [{ id: 'e1', area: 'Связь ' + H, message: 'Не ответил ' + H, createdAt: iso(-HOUR) }, { id: 'e2', area: 'Связь ' + H, message: 'Не ответил ' + H, createdAt: iso(-2 * HOUR) }, { id: 'e3', context: 'Диск', message: 'Мало места', at: iso(-DAY) }],
    notifications: [
      { id: 'message:inq1', kind: 'message', severity: 'warn', title: 'Анна ждёт ответа ' + H, text: 'Есть ли парковка? ' + H, createdAt: iso(-HOUR), route: { view: 'clients', tab: 'inbox', inquiryId: 'inq1' }, active: true, readAt: '', handledAt: '' },
      { id: 'viewing:inq2', kind: 'viewing', severity: 'bad', title: 'Просмотр без подтверждения', text: 'Carlos', createdAt: iso(-DAY), route: { view: 'viewings', tab: '', inquiryId: 'inq2' }, active: true, readAt: '', handledAt: '' },
      { id: 'task:inq4', kind: 'task', severity: 'warn', title: 'Связаться сегодня', text: 'Анна', createdAt: iso(-DAY), route: { view: 'clients', tab: 'inbox', inquiryId: 'inq4' }, active: true },
      { id: 'catalog:incomplete', kind: 'catalog', severity: 'warn', title: 'Карточки не готовы', text: '2 объекта', createdAt: iso(-DAY), route: { view: 'objects', tab: 'list' }, active: true },
      { id: 'group:g2', kind: 'group', severity: 'warn', title: 'Заявки на вступление', text: '2', createdAt: iso(-DAY), route: { view: 'posts', tab: 'channels' }, active: true },
      { id: 'broadcast:b4', kind: 'broadcast', severity: 'bad', title: 'Рассылка не ушла', text: 'ошибка', createdAt: iso(-DAY), route: { view: 'posts', tab: 'broadcast' }, active: true },
      { id: 'system:admin-chat', kind: 'system', severity: 'warn', title: 'Админ-чат не проверен', text: 'Уведомления могут не приходить', createdAt: iso(-DAY), route: { view: 'settings', tab: 'team' }, active: true },
      { id: 'error:e1', kind: 'error', severity: 'bad', title: 'Ошибка ' + H, text: 'текст', createdAt: iso(-DAY), route: { view: 'settings', tab: 'data' }, active: true },
      { id: 'old:1', kind: 'message', severity: 'warn', title: 'Скрытое дело', text: 'x', createdAt: iso(-2 * DAY), route: { view: 'inquiries', tab: 'inbox' }, active: true, handledAt: iso(-DAY) },
      { id: 'old:2', kind: 'catalog', severity: 'warn', title: 'Решилось само', text: 'x', createdAt: iso(-2 * DAY), route: { view: 'catalog', tab: 'objects' }, active: false, handledAt: iso(-DAY) },
    ],
    languageCounts: { ru: 5, en: 2, es: 1, unknown: 1, all: 9 },
    broadcasts: [
      { id: 'b1', status: 'draft', messages: { ru: 'Черновик ' + H, en: '', es: '' }, buttonText: { ru: 'Кнопка "x"' }, buttonUrl: '', languages: ['ru'], tags: ['покупка'], pipelineStages: ['selection'], sources: ['instagram ' + H], propertyId: 'obj1', propertySignal: 'favorite', sendAsCard: true, image: { exists: true }, createdAt: iso(-DAY), updatedAt: iso(-DAY) },
      { id: 'b2', status: 'scheduled', messages: { ru: 'План' }, languages: ['ru', 'en'], scheduledAt: iso(DAY), createdAt: iso(-DAY) },
      { id: 'b3', status: 'sent', messages: { ru: 'Отправлено' }, languages: [], sent: 10, responses: 2, unsubscribes: 1, startedAt: iso(-3 * DAY) },
      { id: 'b4', status: 'failed', messages: { ru: 'Сбой' }, languages: [], sent: 0, responses: 0, unsubscribes: 0, startedAt: iso(-2 * DAY), error: 'err' },
      { id: 'b5', status: 'queued', pausedAt: iso(-HOUR), error: 'сеть ' + H, messages: { ru: 'Пауза' }, languages: [], sent: 3, startedAt: iso(-HOUR) },
      { id: 'b6', status: 'running', messages: { ru: 'Идёт' }, languages: [], sent: 1, startedAt: iso(-HOUR) },
    ],
    inquiries,
    replyTemplates: [{ id: 't1', title: 'Приветствие "x" ' + H, text: { ru: 'Здравствуйте, {имя}! ' + H, en: '', es: '' } }, { id: 't2', title: 'Адрес', text: { ru: 'Адрес', en: 'Address', es: 'Dirección' } }],
    serverTime: now, serverTzOffset: new Date().getTimezoneOffset(),
    attention: { waitingClients: 2, lateClients: 1, deeds: 8 }, waitingConversationCount: 2, latestClientMessageAt: now - HOUR,
    broadcastOptOutCount: 0, newsConsentCount: 3,
    sources: [{ source: 'instagram ' + H, users: 3, inquiries: 2, viewings: 1, deals: 1 }, { source: '', users: 5, inquiries: 4, viewings: 2, deals: 0 }],
    publishing: { signature: 'Construcciones ' + H + '\n+34 600\nhttps://t.me/x', signatureEnabled: true, signatureWrap: 'keep', signatureQuote: true, signatureDivider: 'thin', buttons: [{ text: '🎵 ТикТок длинное название', url: 'https://t' }, { text: 'Сайт ' + H, url: 'https://s' }], buttonsPerRow: 3, rubrics: [{ id: 'rb1', name: 'Новинки ' + H, placement: 'bottom', image: { exists: true, updatedAt: iso(-DAY) } }, { id: 'rb2', name: 'Без картинки', placement: 'top', image: {} }] },
    groups,
    groupPosts: [{ id: 'gpost1', groupId: 'g1', text: 'Пост ' + H, status: 'scheduled', sendAt: iso(DAY), threadId: 0 }, { id: 'gpost2', groupId: 'g2', text: '', status: 'failed', sendAt: iso(-DAY), threadId: 7, error: 'не ушло ' + H }],
  };
}

export function emptyState() {
  return {
    csrf: 'csrf', stateVersion: 'v0', bot: {}, runtime: { status: 'error', lastError: 'нет связи', consecutiveFailures: 3, save: { error: 'Диск занят', nextRetryAt: iso(60000) } },
    config: { messages: {}, menu: {}, active: false, adminChatId: '', notifyMode: 'inquiries', notifyPrefs: {}, remoteAccess: false, tunnelTokenSet: false, tunnelHostname: '', reminderHours: 0, retentionMonths: 0, timeZone: 'Europe/Madrid', workingHours: {}, statusNotices: true, calculator: {}, viewingSlots: {}, adminName: '', feedImport: {}, managers: [], telegramBackup: {} },
    welcomeImages: {}, rules: [], users: [], userCount: 0, activeUserCount: 0, stats: {}, analytics: {}, objects: [], promotions: [], contacts: {}, trust: { reviews: [] }, engagement: {}, guidePages: [], buyPlan: [], errors: [], notifications: [], languageCounts: {}, broadcasts: [], inquiries: [], replyTemplates: [], serverTime: now, serverTzOffset: new Date().getTimezoneOffset(), attention: { waitingClients: 0, lateClients: 0, deeds: 0 }, waitingConversationCount: 0, latestClientMessageAt: 0, newsConsentCount: 0, sources: [], publishing: { signature: '', signatureEnabled: true, rubrics: [] }, groups: [], groupPosts: [],
  };
}

export const interfaceText = (() => {
  const three = (ru) => ({ ru, en: Object.fromEntries(Object.keys(ru).map((k) => [k, Array.isArray(ru[k]) ? [] : ''])), es: Object.fromEntries(Object.keys(ru).map((k) => [k, Array.isArray(ru[k]) ? [] : ''])) });
  return {
    menuLabels: three({ objects: '🏘 Объекты', selection: '🔎 Подбор', contacts: '📞 Связаться', promotions: '🔥 Акции', more: '👤 Моё', guide: '🇪🇸 Как купить', placeholder: 'Напишите запрос ' + H }),
    menuHints: three({ text: 'Напишите, что ищете{example} ' + H }),
    catalogSummary: three({ line: 'В каталоге {count}: {cities}', empty: 'Каталог пуст', one: 'объект', few: 'объекта', many: 'объектов' }),
    managerContact: three({ request: '📞 Заказать звонок', question: '❓ Задать вопрос ' + H }),
    propertyActions: three({ details: 'ℹ️ Подробнее', viewWebsite: 'Сайт', priceOnRequest: 'Цена по запросу', priceMonth: 'в месяц', priceWeek: 'в неделю', longOne: 'Очень длинный текст подписи, который точно длиннее восьмидесяти знаков, чтобы поле стало многострочным ' + H }),
    privacy: three({ policy: 'Политика ' + H, consent: 'Согласие {first_name} {count}', list: ['один ' + H, 'два'] }),
    interaction: three({ wait: 'Подождите' }),
  };
})();

export function apiAnswer(path, method, state) {
  if (path.startsWith('/api/status')) return { configured: true };
  if (path.startsWith('/api/csrf')) return { csrf: 'csrf' };
  if (path.startsWith('/api/state')) { const since = (path.split('since=')[1] || ''); return since && since === state.stateVersion ? { unchanged: true } : state; }
  if (path.startsWith('/api/interface-text')) return { interfaceText };
  if (path.startsWith('/api/self-check')) return { bad: 1, warn: 2, checkedAt: iso(0), checks: [{ id: 'token', title: 'Токен', status: 'ok', detail: 'ок' }, { id: 'admin', title: 'Чат', status: 'warn', detail: 'не проверен ' + H, hint: 'подсказка ' + H }, { id: 'catalog', title: 'Каталог', status: 'bad', detail: 'пуст' }, { id: 'privacy', title: 'Политика', status: 'warn', detail: 'нет' }, { id: 'disk', title: 'Диск', status: 'ok', detail: 'свободно 10 ГБ' }, { id: 'version', title: 'Версия', status: 'ok', detail: 'v51' }, { id: 'media', title: 'Медиа', status: 'ok', detail: 'все на месте' }] };
  if (path.startsWith('/api/weekly-report')) return { text: 'Неделя…', report: { label: '23–29.09 ' + H, which: /week=last/.test(path) ? 'last' : 'current', users: { count: 5, previous: 3 }, inquiries: { count: 4, previous: 4, byType: [['заявка на звонок ' + H, 2], ['подбор', 2]] }, viewings: { booked: 2, held: 1 }, deals: { count: 1, previous: 2 }, sharedLists: { shared: 2, opened: 3 }, waiting: 2, sources: [['instagram ' + H, 3], ['без метки', 2]], topProperties: [{ name: 'Квартира ' + H, count: 2 }], funnel: { joined: 5, trackedFrom: '2026-09-20', partial: true, catalog: 4, details: 3, inquiry: 2, viewing: 1, confirmed: 1, goals: { answered: 3, live: 1, invest: 0, browse: 2, mostlyBrowsing: true }, byLanguage: [{ key: 'ru', joined: 3, catalog: 2, details: 2, inquiry: 1, viewing: 1, confirmed: 1 }], bySource: [{ key: 'instagram ' + H, joined: 2, catalog: 2, details: 1, inquiry: 1, viewing: 0, confirmed: 0 }] }, broadcasts: { count: 1, sent: 10, responded: 2 } } };
  let m;
  if ((m = path.match(/^\/api\/conversations\/([^/]+)\/timeline/))) return { messages: [
    { id: 'm1', direction: 'in', kind: 'text', text: 'Здравствуйте ' + H, createdAt: iso(-2 * HOUR), telegramMessageId: 11 },
    { id: 'm2', direction: 'out', kind: 'text', text: 'Добрый день', by: 'Бот ' + H, createdAt: iso(-HOUR), deliveryStatus: 'sent' },
    { id: 'm3', direction: 'in', kind: 'photo', fileId: 'f', fileName: 'a "b".jpg', text: '', createdAt: iso(-HOUR / 2), telegramMessageId: 12, reactions: ['👍'] },
    { id: 'm4', direction: 'out', kind: 'document', fileId: 'f2', fileName: 'договор.pdf', text: 'см.', by: '', createdAt: iso(-1000), deliveryStatus: 'failed', replyToTelegramMessageId: 11, replyToText: 'Здравствуйте ' + H },
    { id: 'm5', direction: 'in', kind: 'voice', fileId: 'v', createdAt: iso(-500), telegramMessageId: 13 },
  ] };
  if (path.startsWith('/api/conversations/search')) return { inquiryIds: ['inq1', 'inq3'], clients: [{ id: 'u9', name: 'Удалённый ' + H, username: 'far', phone: '' }] };
  if ((m = path.match(/^\/api\/groups\/([^/]+)\/admins/))) return { admins: [{ userId: 1, name: 'Владелец ' + H, username: 'own', status: 'creator' }, { userId: 2, name: 'Админ', status: 'administrator', customTitle: 'титул ' + H }, { userId: 3, name: 'Бот', status: 'administrator', isBot: true }] };
  if ((m = path.match(/^\/api\/groups\/([^/?]+)$/)) && method === 'GET') return { group: { messages: [{ messageId: 5, name: 'Канал ' + H, text: 'Пост ' + H, kind: 'text', date: iso(-DAY), fromBot: true }, { messageId: 4, name: 'Участник', text: '', kind: 'poll', date: iso(-2 * DAY), threadId: 7 }], joinRequests: [{ userId: 77, name: 'Проситель ' + H, username: 'ask' }, { userId: 78, name: 'Второй' }] } };
  if ((m = path.match(/^\/api\/objects\/([^/]+)\/insights/))) return { analytics: { impressions: 10, details: 4, galleries: 2, managerContacts: 1, updatedAt: iso(-HOUR) }, summary: { inquiries: 2, viewings: 1, favorites: 1, comparisons: 1, viewed: 2, matches: 1, clients: 2 }, clients: [{ id: 'u1', firstName: 'Анна ' + H, username: 'anna', phone: '+34', preferredLanguage: 'ru', signals: ['favorite', 'comparison', 'inquiry', 'viewed', 'match'], latestInquiryId: 'inq1', inquiryCount: 2, lastSeenAt: iso(-HOUR) }, { id: 'u7', firstName: '', signals: ['viewed'], lastSeenAt: iso(-DAY) }] };
  if (path.startsWith('/api/autostart')) return { supported: true, enabled: false };
  if (path.startsWith('/api/preview/object')) return { caption: '<b>Квартира</b>\n<i>Квартира · Продажа</i>\n🛏 2 · 🚿 1', rows: [['📷 Фото', 'ℹ️ Подробнее'], ['📅 Просмотр', '🧮 Расчёт'], ['🤍', '🏘 Похожие'], ['⬅️ Назад']] };
  if (path.startsWith('/api/preview/broadcast')) return { caption: '<b>Квартира</b>', rows: [['📅 Просмотр', 'ℹ️ Подробнее']] };
  if (path.startsWith('/api/broadcast/estimate')) return { total: 3, byLanguage: { ru: 2, en: 1 }, sample: ['Анна ' + H] };
  if ((m = path.match(/^\/api\/users\/([^/]+)$/)) && method === 'GET') return { user: { id: decodeURIComponent(m[1]), chatId: 9, firstName: 'Удалённый', activity: [] } };
  if (path.startsWith('/api/media-check')) return { missing: ['objects/a "b".jpg'], missingRefs: 2, total: 10, orphans: 1, restored: 1 };
  if (path.startsWith('/api/token-test')) return { bot: { firstName: 'B', username: 'b' } };
  if (path.startsWith('/api/feed/preview')) return { added: 1, updated: 2, photos: 3 };
  if (path.startsWith('/api/rules/test')) return { matched: { answer: 'Ответ' } };
  return { ok: true, id: 'new1', moved: 1, notified: true, removed: 1, left: 2, total: 3, group: { id: 'g1', title: 't' }, topic: { id: 9 }, ticket: 't', undoToken: 'u' };
}
