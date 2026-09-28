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

const data = JSON.parse(fs.readFileSync(path.join(project, 'bot-data.json'), 'utf8'));
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
];

fs.writeFileSync(path.join(box, 'bot-data.json'), JSON.stringify(data));
console.log('песочница готова:', box);
console.log('объектов:', data.objects.length, '| пароль панели:', PASSWORD);

module.exports = { box, PASSWORD };
