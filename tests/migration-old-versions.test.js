'use strict';

// Файл данных владельца — это годы переписки, объекты и настройки. Формат
// менялся десятки раз, а у бота одна попытка открыть старый файл без потерь:
// проверяем, что файлы прежних версий (28 и 30) доходят до нынешней целыми —
// клиенты, обращения с ответами, объекты, группы, настройки, свои тексты, — а
// повторная загрузка ничего не меняет и не тянет за собой прежних миграций.
// Проверяется только чистый разбор: рабочий bot-data.json тест не трогает.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BOT_NO_START = '1';

function oldFile(version) {
  return {
    version,
    config: {
      botToken: '123456:OLD-TOKEN',
      passwordSalt: 'ab'.repeat(16),
      passwordHash: 'cd'.repeat(64),
      adminChatId: '4242',
      adminName: 'Олег',
      active: true,
      timeZone: 'Europe/Madrid',
      messages: {
        ru: { welcome: 'Своё приветствие Олега', help: 'Своя помощь' },
        en: { welcome: 'Own welcome' },
        es: {},
      },
    },
    users: {
      '1001': { id: '1001', chatId: 1001, firstName: 'Ольга', username: 'olga', preferredLanguage: 'es', favorites: ['villa-1'], tags: ['vip'], note: 'Ищет у моря', phone: '+34600111222' },
      '1002': { id: '1002', chatId: 1002, firstName: 'Ivan', preferredLanguage: 'en', favorites: [], tags: [], newsConsentAt: '2026-01-10T10:00:00.000Z' },
    },
    inquiries: [
      { id: 'i1', userId: '1001', type: 'lead', status: 'in_progress', text: 'Позвоните мне', createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z', propertyId: 'villa-1', assignee: 'Олег', note: 'Перезвонить вечером', replies: [{ text: 'Добрый день!', at: '2026-01-01T11:00:00.000Z' }] },
      { id: 'i2', userId: '1002', type: 'question', status: 'closed', text: 'Is it available?', createdAt: '2026-01-05T10:00:00.000Z', replies: [] },
    ],
    objects: [
      { id: 'villa-1', status: 'active', reference: 'V-1', title: { ru: 'Вилла у моря', en: 'Sea villa', es: 'Villa junto al mar' }, price: 250000, city: { ru: 'Бенидорм', en: 'Benidorm', es: 'Benidorm' }, description: { ru: 'Описание', en: 'Description', es: 'Descripción' } },
      { id: 'flat-2', status: 'hidden', reference: 'F-2', title: { ru: 'Квартира', en: '', es: '' }, price: 90000 },
    ],
    promotions: [],
    groups: [{ id: '-1001234567890', title: 'Клуб покупателей', type: 'supergroup', status: 'administrator', memberCount: 24, messages: [{ messageId: 5, name: 'Ирина', text: 'Привет', kind: 'text', date: '2026-01-03T10:00:00.000Z' }] }],
    replyTemplates: [{ id: 'tpl-1', title: 'Приветствие', text: { ru: 'Здравствуйте!', en: '', es: '' } }],
    broadcasts: [],
    interfaceText: { menuLabels: { ru: { objects: '🏠 Наш каталог' } } },
  };
}

async function loaders() {
  const { DATA_VERSION, normalizeLoadedData } = await import('../src/data-format.mjs');
  return { DATA_VERSION, normalizeLoadedData };
}

for (const version of [28, 30]) {
  test.describe('файл версии ' + version, () => {
    test('доходит до нынешней версии без потерь', async () => {
      const { DATA_VERSION, normalizeLoadedData } = await loaders();
      const loaded = normalizeLoadedData(oldFile(version));

      assert.equal(loaded.version, DATA_VERSION);
      assert.equal(loaded.config.botToken, '123456:OLD-TOKEN', 'токен бота цел');
      assert.equal(loaded.config.passwordHash, 'cd'.repeat(64), 'пароль панели цел — владелец сможет войти');
      assert.equal(loaded.config.adminChatId, '4242');
      assert.equal(loaded.config.active, true);
      assert.equal(loaded.config.messages.ru.welcome, 'Своё приветствие Олега', 'своё приветствие сохранено');
      assert.equal(loaded.config.messages.ru.help, 'Своя помощь');
      assert.equal(loaded.config.messages.en.welcome, 'Own welcome');

      assert.deepEqual(Object.keys(loaded.users).sort(), ['1001', '1002'], 'все клиенты на месте');
      const olga = loaded.users['1001'];
      assert.deepEqual([olga.firstName, olga.preferredLanguage, olga.favorites, olga.tags, olga.note, olga.phone], ['Ольга', 'es', ['villa-1'], ['vip'], 'Ищет у моря\n\nПо заявке от 01.01: Перезвонить вечером', '+34600111222']); // заметка заявки переехала в заметку клиента
      assert.equal(loaded.users['1002'].newsConsentAt, '2026-01-10T10:00:00.000Z', 'согласие на рассылки не потеряно');

      assert.equal(loaded.inquiries.length, 2);
      const first = loaded.inquiries.find((item) => item.id === 'i1');
      assert.deepEqual([first.status, first.text, first.assignee, first.note, first.propertyId], ['in_progress', 'Позвоните мне', 'Олег', '', 'villa-1']);
      assert.ok(first.messages.some((message) => message.direction === 'out' && message.text === 'Добрый день!'), 'ответ менеджера стал сообщением переписки');
      assert.ok(first.messages.some((message) => message.direction === 'in' && message.text === 'Позвоните мне'), 'слова клиента тоже');
      assert.equal(loaded.inquiries.find((item) => item.id === 'i2').status, 'closed', 'закрытое обращение не открылось заново');

      assert.deepEqual(loaded.objects.map((record) => record.id), ['villa-1', 'flat-2']);
      const villa = loaded.objects[0];
      assert.equal(villa.title.es, 'Villa junto al mar');
      assert.equal(villa.price.ru, '250000', 'цена цела');
      assert.equal(villa.city.en, 'Benidorm');
      assert.equal(loaded.objects[1].status, 'hidden', 'скрытый объект не стал видимым клиентам');

      assert.equal(loaded.groups.length, 1);
      assert.equal(loaded.groups[0].title, 'Клуб покупателей');
      assert.equal(loaded.groups[0].messages[0].text, 'Привет');
      assert.equal(loaded.groups[0].isForum, false, 'новое поле получило значение по умолчанию');
      assert.deepEqual(loaded.groups[0].topics, []);

      assert.equal(loaded.interfaceText.menuLabels.ru.objects, '🏠 Наш каталог', 'своя подпись кнопки сохранена');
    });

    test('повторная загрузка ничего не отнимает и через один круг устаканивается', async () => {
      const { normalizeLoadedData } = await loaders();
      const again = (value) => normalizeLoadedData(JSON.parse(JSON.stringify(value)));
      const once = normalizeLoadedData(oldFile(version));
      const twice = again(once);
      // Данные людей и настроек после первой загрузки уже не меняются.
      for (const part of ['config', 'users', 'objects', 'groups', 'interfaceText', 'replyTemplates']) {
        assert.deepEqual(twice[part], once[part], part + ': вторая загрузка даёт то же самое');
      }
      assert.deepEqual(twice.inquiries.map((item) => [item.id, item.status, item.text, item.messages.length]),
        once.inquiries.map((item) => [item.id, item.status, item.text, item.messages.length]), 'сообщения переписки не размножаются');
      // Служебные поля («порядок» правила, время правки) дозаполняются на втором круге и дальше стоят.
      assert.deepEqual(again(twice), twice, 'третья загрузка равна второй');
    });
  });
}
