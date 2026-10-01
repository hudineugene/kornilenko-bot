// Песочница для проверок: копия живых данных, выдуманный токен и одноразовый
// пароль, каталог заполнен до состояния «виден клиенту».
// Запуск: node tools/sandbox.js [папка]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const project = path.resolve(__dirname, '..');
const box = path.resolve(process.argv[2] || path.join(project, '.sandbox'));
const PASSWORD = 'sandbox-pass';

fs.rmSync(box, { recursive: true, force: true });
fs.mkdirSync(box, { recursive: true });
if (fs.existsSync(path.join(project, 'bot-media'))) {
  fs.cpSync(path.join(project, 'bot-media'), path.join(box, 'bot-media'), { recursive: true });
}

// Нет живого файла (чистая копия проекта) — песочница собирается из пустых данных; фотографии тогда не из чего взять.
const source = path.join(project, 'bot-data.json');
const data = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, 'utf8')) : { config: {}, objects: [] };
data.config.active = true;
data.config.botToken = '12345:FAKEFAKEFAKEFAKEFAKEFAKE';
const salt = crypto.randomBytes(16).toString('hex');
data.config.passwordSalt = salt;
data.config.passwordHash = crypto.scryptSync(PASSWORD, salt, 64).toString('hex');
// Именно false, а не { enabled: false }: объект считается истиной, и
// песочница поднимала бы настоящий туннель наружу.
data.config.remoteAccess = false;
data.config.tunnelToken = '';
data.config.tunnelHostname = '';
if (data.config.telegramBackup) data.config.telegramBackup.key = '';
data.users = {};
data.inquiries = [];
data.broadcasts = [];
data.errors = [];
data.config.viewingSlots = { enabled: true, days: [1, 2, 3, 4, 5], times: ['10:00', '12:00', '17:00'], daysAhead: 7, perSlot: 1 };
data.config.calculator = { ...(data.config.calculator || {}), enabled: true };
data.config.workingHours = { ...(data.config.workingHours || {}), enabled: false };

const CITIES = [
  { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' },
  { ru: 'Альтеа', en: 'Altea', es: 'Altea' },
  { ru: 'Финестрат', en: 'Finestrat', es: 'Finestrat' },
  { ru: 'Кальпе', en: 'Calpe', es: 'Calpe' },
];
const three = (ru, en, es) => ({ ru, en: en || ru, es: es || ru });

// Фотографии берём из живых карточек: файлы уже лежат на диске.
const photos = [];
for (const record of data.objects) {
  for (const image of (record.imagesByLanguage || {}).ru || []) photos.push(image);
}

function demo(index, patch) {
  const images = photos.slice(index * 2, index * 2 + 3).map((image) => ({ ...image }));
  return {
    id: crypto.randomUUID(),
    reference: 'DEMO-' + String(index + 1).padStart(3, '0'),
    status: 'active',
    propertyType: 'apartment',
    dealType: 'sale',
    priceValue: 250000 + index * 90000,
    currency: 'EUR',
    pricePeriod: 'total',
    bedrooms: 2 + (index % 3),
    bathrooms: 1 + (index % 2),
    area: 70 + index * 25,
    plotArea: 0,
    floor: String(2 + index),
    floors: '8',
    distanceSea: 150 + index * 200,
    condition: index % 2 ? 'renovated' : 'new',
    badges: index === 0 ? ['new'] : index === 1 ? ['price_reduced'] : [],
    city: CITIES[index % CITIES.length],
    district: three('Центр', 'Centre', 'Centro'),
    address: three('Calle Demo ' + (index + 1), 'Calle Demo ' + (index + 1), 'Calle Demo ' + (index + 1)),
    title: three('Демо-объект ' + (index + 1), 'Demo property ' + (index + 1), 'Inmueble demo ' + (index + 1)),
    description: three(
      'Светлая квартира в шаговой доступности от моря. Большая терраса, парковка, закрытая территория с бассейном.',
      'A bright apartment a short walk from the sea. Large terrace, parking, gated grounds with a pool.',
      'Apartamento luminoso a pocos pasos del mar. Gran terraza, parking y zona cerrada con piscina.',
    ),
    price: three('', '', ''),
    url: '',
    mapUrl: 'https://maps.google.com/?q=Benidorm',
    imagesByLanguage: { ru: images, en: images.map((image) => ({ ...image })), es: images.map((image) => ({ ...image })) },
    createdAt: new Date(Date.now() - (index + 1) * 864e5).toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

data.objects = [
  demo(0),
  demo(1, { propertyType: 'villa', bedrooms: 4, bathrooms: 3, area: 220, plotArea: 600, priceValue: 690000 }),
  demo(2, { dealType: 'rent', pricePeriod: 'month', priceValue: 1400, bedrooms: 1, bathrooms: 1, area: 55 }),
  demo(3, { status: 'reserved' }),
  demo(4, { propertyType: 'land', bedrooms: null, bathrooms: 0, area: 0, plotArea: 800, priceValue: 180000 }),
  // Цена по запросу, три фотографии: так выглядит карточка комплекса, где цену называют после разговора.
  demo(5, { priceValue: 0, price: three('', '', '') }),
];

// --- демо-жизнь: клиенты, заявки и цифры за две недели ----------------------
// Без них панель выглядит пустой, и проверить экраны «как у владельца» нельзя.
const day = 864e5;
const at = (daysAgo, hour = 12, minute = 0) => {
  const date = new Date(Date.now() - daysAgo * day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const dayKey = (daysAgo) => {
  const date = new Date(Date.now() - daysAgo * day);
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
};

const PEOPLE = [
  { id: '5100001', firstName: 'Анна', lastName: 'Соколова', username: 'anna_s', phone: '+34 600 111 222', language: 'ru', source: 'Instagram' },
  { id: '5100002', firstName: '마르크', lastName: '', username: '', phone: '', language: 'en', source: 'Сайт' },
  { id: '5100003', firstName: 'Diego', lastName: 'Ferrer', username: 'dferrer', phone: '+34 611 333 444', language: 'es', source: '' },
  { id: '5100004', firstName: 'Павел', lastName: 'Ким', username: '', phone: '+7 916 555 66 77', language: 'ru', source: 'Реклама' },
  { id: '5100005', firstName: 'Мария', lastName: 'Ланге', username: 'm_lange', phone: '', language: 'en', source: 'Instagram' },
  { id: '5100006', firstName: 'Олег', lastName: 'Гринь', username: '', phone: '+34 622 777 888', language: 'ru', source: 'Сайт' },
];

data.users = {};
PEOPLE.forEach((person, index) => {
  data.users[person.id] = {
    id: person.id,
    chatId: Number(person.id),
    firstName: person.firstName,
    lastName: person.lastName,
    username: person.username,
    phone: person.phone,
    preferredLanguage: person.language,
    source: person.source,
    sourceAt: person.source ? at(index + 3) : '',
    firstSeenAt: at(index + 3, 10, 15),
    lastSeenAt: at(index % 3, 11, 5),
    newsConsentAt: index % 2 ? at(index + 2) : '',
    tags: index === 0 ? ['покупка', 'горячий'] : [],
    note: index === 0 ? 'Смотрит вторую линию, бюджет до 300 000 €.' : '',
    activity: [],
    favouriteIds: index < 2 ? [data.objects[index].id] : [],
    comparisonIds: [],
  };
});

const message = (index, direction, text, daysAgo, hour) => ({
  id: 'demo-msg-' + index,
  direction,
  kind: 'text',
  text,
  createdAt: at(daysAgo, hour, 0),
  source: direction === 'out' ? 'panel' : 'telegram',
});

// Заявки в разных состояниях: ждут ответа, в работе, закрытая, просмотр без
// подтверждения и просмотр подтверждённый.
data.inquiries = [
  {
    id: 'demo-inq-1', userId: '5100001', chatId: '5100001', language: 'ru', type: 'question',
    propertyId: data.objects[0].id, text: 'Добрый день! Эта квартира ещё продаётся?',
    status: 'new', pipelineStage: 'new', assignee: '', note: '', readAt: '',
    replies: [], messages: [
      message(1, 'in', 'Добрый день! Эта квартира ещё продаётся?', 0, 9),
      message(2, 'out', 'Здравствуйте! Да, объект свободен. Подскажите, когда вам удобно посмотреть?', 0, 10),
      message(3, 'in', 'Можно в выходные. И есть ли парковка?', 0, 11),
    ],
    createdAt: at(0, 9), updatedAt: at(0, 11), clientMessageAt: at(0, 11),
  },
  {
    id: 'demo-inq-2', userId: '5100002', chatId: '5100002', language: 'en', type: 'lead',
    propertyId: data.objects[1].id, text: 'Please call me about the villa',
    status: 'in_progress', pipelineStage: 'contact', assignee: '', note: 'Звонить после 18:00.',
    readAt: at(1, 12), followUpDate: dayKey(0), followUpTime: '17:00', followUpNotifiedAt: '',
    replies: [{ id: 'demo-reply-1', text: 'Позвоню сегодня вечером.', source: 'panel', by: 'Администратор', createdAt: at(1, 12), deliveredAt: at(1, 12) }],
    messages: [
      message(4, 'in', 'Please call me about the villa', 1, 11),
      message(5, 'out', 'Sure, I will call you this evening.', 1, 12),
    ],
    createdAt: at(1, 11), updatedAt: at(1, 12), clientMessageAt: at(1, 11),
  },
  {
    id: 'demo-inq-3', userId: '5100003', chatId: '5100003', language: 'es', type: 'viewing',
    propertyId: data.objects[2].id, text: 'Quiero ver el piso',
    status: 'new', pipelineStage: 'viewing', assignee: '', note: '', readAt: '',
    viewing: { date: dayKey(-2), dateText: 'el sábado por la tarde', timeText: 'como indicado', confirmedAt: '', confirmedDate: '', confirmedTime: '', cancelledAt: '' },
    replies: [], messages: [message(6, 'in', 'Quiero ver el piso el sábado por la tarde', 1, 18)],
    createdAt: at(1, 18), updatedAt: at(1, 18), clientMessageAt: at(1, 18),
  },
  {
    id: 'demo-inq-4', userId: '5100004', chatId: '5100004', language: 'ru', type: 'viewing',
    propertyId: data.objects[3].id, text: 'Запись на просмотр',
    status: 'in_progress', pipelineStage: 'viewing', assignee: '', note: '', readAt: at(2, 10),
    viewing: { date: dayKey(-1), dateText: 'завтра', timeText: '12:00', confirmedAt: at(2, 10), confirmedDate: dayKey(-1), confirmedTime: '12:00', cancelledAt: '' },
    replies: [{ id: 'demo-reply-2', text: 'Ждём вас завтра в 12:00.', source: 'panel', by: 'Администратор', createdAt: at(2, 10), deliveredAt: at(2, 10) }],
    messages: [message(7, 'in', 'Хочу посмотреть завтра', 2, 9), message(8, 'out', 'Ждём вас завтра в 12:00.', 2, 10)],
    createdAt: at(2, 9), updatedAt: at(2, 10), clientMessageAt: at(2, 9),
  },
  {
    id: 'demo-inq-5', userId: '5100005', chatId: '5100005', language: 'en', type: 'selection',
    propertyId: '', text: 'Подбор: покупка · квартира · Альтеа · до 350 000 € · 2 спальни',
    status: 'closed', pipelineStage: 'won', assignee: '', note: 'Купила Демо-объект 2.', readAt: at(6, 15),
    replies: [{ id: 'demo-reply-3', text: 'Sent three options.', source: 'panel', by: 'Администратор', createdAt: at(6, 15), deliveredAt: at(6, 15) }],
    messages: [message(9, 'in', 'Looking for a 2-bedroom flat in Altea', 6, 14), message(10, 'out', 'Sent three options.', 6, 15)],
    createdAt: at(6, 14), updatedAt: at(5, 10), clientMessageAt: at(6, 14),
  },
  {
    id: 'demo-inq-6', userId: '5100006', chatId: '5100006', language: 'ru', type: 'general',
    propertyId: '', text: 'Сколько стоит содержание квартиры в год?',
    status: 'new', pipelineStage: 'new', assignee: '', note: '', readAt: '',
    replies: [], messages: [message(11, 'in', 'Сколько стоит содержание квартиры в год?', 0, 8)],
    createdAt: at(0, 8), updatedAt: at(0, 8), clientMessageAt: at(0, 8),
  },
];

// Цифры за две недели: график на Обзоре и в Статистике должно быть видно.
data.analytics = { daily: {}, properties: {} };
for (let back = 13; back >= 0; back -= 1) {
  const busy = back % 7 === 0 || back % 7 === 6 ? 0.4 : 1;
  const received = Math.round((6 + ((back * 5) % 9)) * busy);
  data.analytics.daily[dayKey(back)] = {
    received,
    sent: received + 2,
    reactions: back % 4 === 0 ? 2 : 0,
    inquiries: back % 3 === 0 ? 2 : 1,
    menu: { catalog: 3 + (back % 4), contacts: 1 + (back % 2), selection: back % 3 },
  };
}
data.objects.forEach((record, index) => {
  data.analytics.properties[record.id] = { views: 40 - index * 6, cards: 18 - index * 3, inquiries: 3 - (index % 3), favourites: 2 };
});
data.stats = {
  ...(data.stats || {}),
  messagesReceived: Object.values(data.analytics.daily).reduce((sum, item) => sum + item.received, 0),
  messagesSent: Object.values(data.analytics.daily).reduce((sum, item) => sum + item.sent, 0),
  reactionsReceived: 8,
};

fs.writeFileSync(path.join(box, 'bot-data.json'), JSON.stringify(data));
console.log('песочница готова:', box);
console.log('объектов:', data.objects.length, '| клиентов:', Object.keys(data.users).length,
  '| заявок:', data.inquiries.length, '| пароль панели:', PASSWORD);

module.exports = { box, PASSWORD };
