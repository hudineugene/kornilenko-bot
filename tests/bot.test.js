'use strict';

// Run with: npm test  (or: node --test tests/*.test.js)
// The bot is loaded with BOT_NO_START=1 against a temporary data folder, so
// the tests never touch bot-data.json and never contact Telegram.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-'));
const dataFile = path.join(workDirectory, 'bot-data.json');
const mediaDirectory = path.join(workDirectory, 'bot-media');
process.env.BOT_NO_START = '1';
process.env.BOT_DATA_FILE = dataFile;
process.env.BOT_MEDIA_DIRECTORY = mediaDirectory;
process.env.NO_AUTO_OPEN = '1';

const bot = require('../bot.js');
// Текущая версия формата: берём из кода, иначе каждое её повышение ломало бы
// половину проверок ниже.
const DATA_VERSION = bot.DATA_VERSION;

const PNG_BYTES = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('test image payload')]);

test.after(() => {
  bot.server.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

function withFetch(stub, callback) {
  const original = global.fetch;
  global.fetch = stub;
  return Promise.resolve().then(callback).finally(() => {
    global.fetch = original;
  });
}

function telegramResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('data from an older version is copied to backups/ before the upgrade, once', () => {
  const backups = path.join(workDirectory, 'backups');
  const upgradeCopies = () => (fs.existsSync(backups) ? fs.readdirSync(backups) : []).filter((name) => name.startsWith('pre-upgrade-'));
  const saved = fs.existsSync(dataFile) ? fs.readFileSync(dataFile) : null;
  try {
    const old = JSON.stringify({ version: 16, config: { reminderHours: 4 }, users: {} });
    fs.writeFileSync(dataFile, old);
    const loaded = bot.loadData();
    assert.equal(loaded.version, DATA_VERSION);
    const copies = upgradeCopies();
    assert.equal(copies.length, 1);
    assert.match(copies[0], new RegExp('^pre-upgrade-v16-to-v' + DATA_VERSION + '-\\d{8}-\\d{6}\\.json$'));
    assert.equal(fs.readFileSync(path.join(backups, copies[0]), 'utf8'), old, 'the file exactly as it was');

    bot.loadData();
    assert.equal(upgradeCopies().length, 1, 'not copied again on the next start');
    fs.writeFileSync(dataFile, JSON.stringify({ ...JSON.parse(old), version: DATA_VERSION }));
    bot.loadData();
    assert.equal(upgradeCopies().length, 1, 'current data needs no copy');
  } finally {
    for (const name of upgradeCopies()) fs.rmSync(path.join(backups, name));
    if (saved) fs.writeFileSync(dataFile, saved);
    else fs.rmSync(dataFile, { force: true });
  }
});

// С версии 39 значения, равные словарю, из сохранённого убираются: смотрим на то,
// что увидит клиент, то есть на тексты после сложения со словарём.
const effectiveTexts = (saved) => bot.normalizedInterfaceText(saved.interfaceText);

test('версия 39: сохранённые прежние тексты уступают словарю, а слова владельца остаются', () => {
  const OWN = 'Напишите нам — ответим сегодня';
  const saved = bot.normalizeLoadedData({
    version: 38,
    config: { messages: {
      ru: { help: '👋 Чем я могу помочь?\n\n❤️ Избранное — вернуться к сохранённым объектам\n📞 Позвоните мне — менеджер перезвонит', fallback: 'Спасибо' },
      en: { help: 'Our own help text', fallback: 'Thank you! Your message has been received. A manager will reply in this chat.' },
      es: { fallback: '¡Gracias! Hemos recibido tu mensaje. Un gestor responderá en este chat.' },
    } },
    interfaceText: {
      // прежние значения по умолчанию, которые бот когда-то записал сам
      menuLabels: { en: { contacts: '💬 Manager', objects: '🏡 Homes' }, es: { contacts: '💬 Gestor' } },
      managerContact: {
        en: { intro: '💬 Choose a convenient way to contact a manager.', received: OWN },
        es: { intro: '💬 Elige una forma cómoda de contactar con un gestor.' },
      },
      // значение, равное нынешнему словарю, и испорченный набор названий
      calculator: { en: { discuss: '💬 Discuss with an agent' } },
      callbackForm: { ru: { methodNames: '[object Object]' } },
    },
  });
  const effective = effectiveTexts(saved);
  assert.equal(effective.menuLabels.en.contacts, '💬 Contact us', 'старая подпись кнопки заменена нынешней');
  assert.equal(effective.menuLabels.es.contacts, '💬 Contactar');
  assert.equal(effective.managerContact.en.intro, '💬 Choose a convenient way to contact an agent.', 'agent, а не manager');
  assert.equal(effective.managerContact.es.intro, '💬 Elige una forma cómoda de contactar con un asesor.', 'asesor, а не gestor');
  // Своё — остаётся, в том числе рядом с прежним значением в той же группе.
  assert.equal(effective.menuLabels.en.objects, '🏡 Homes');
  assert.equal(effective.managerContact.en.received, OWN);
  assert.deepEqual(saved.interfaceText.menuLabels.en, { objects: '🏡 Homes' }, 'в файле осталось только своё');
  assert.equal(saved.interfaceText.calculator.en.discuss, undefined, 'равное словарю не хранится');
  assert.equal(typeof effective.callbackForm.ru.methodNames, 'object', 'испорченное «[object Object]» заменено набором названий');

  // Помощь, описывающая кнопки, которых уже нет, заменена нынешней; своя — нет.
  assert.match(saved.config.messages.ru.help, /💬 Связаться —/);
  assert.ok(!saved.config.messages.ru.help.includes('❤️ Избранное —'));
  assert.equal(saved.config.messages.en.help, 'Our own help text');
  assert.match(saved.config.messages.en.fallback, /An agent will reply/);
  assert.match(saved.config.messages.es.fallback, /Un asesor responderá/);

  // Миграция выполняется один раз: свежие данные версии 39 она не трогает.
  const again = bot.normalizeLoadedData({ version: 39, interfaceText: { menuLabels: { en: { contacts: '💬 Manager' } } } });
  assert.equal(effectiveTexts(again).menuLabels.en.contacts, '💬 Manager', 'то, что владелец задал после миграции, остаётся');
});

test('панель хранит только отличия от словаря, поэтому новые формулировки доходят до клиента', async () => {
  const { applyInterfaceText, normalizedInterfaceText: normalize } = await import('../src/texts.mjs');
  try {
    const edited = normalize({});
    edited.menuLabels.ru.objects = '🏠 Каталог';
    const stored = applyInterfaceText(edited);
    assert.deepEqual(stored, { menuLabels: { ru: { objects: '🏠 Каталог' } } }, 'сохраняется одна правка, а не весь набор');
    // Без правок хранить нечего.
    assert.deepEqual(applyInterfaceText(normalize({})), {});
    assert.equal(bot.text.menuLabels.ru.objects, '🏘 Объекты', 'словарь вернулся к своим значениям');
  } finally {
    applyInterfaceText({});
  }
});

test('version 16 renumbers the saved selection steps, keeping the admin\'s wording', () => {
  const saved = bot.normalizeLoadedData({
    version: 15,
    interfaceText: { selectionForm: {
      ru: { askDeal: '1 из 4. Вы рассматриваете покупку или аренду?', askLocation: '2 из 4. Где хотите жить?', askBudget: 'Бюджет?', askBedrooms: '4 из 4. Сколько спален нужно?' },
      en: { askBudget: '3 of 4. What budget are you considering? You can include the amount and currency.' },
      es: { askLocation: '2 de 4. ¿Qué ciudad, zona o ubicación te interesa?' },
    } },
  });
  const form = effectiveTexts(saved).selectionForm;
  assert.equal(form.ru.askDeal, '1 из 5. Вы рассматриваете покупку или аренду?');
  assert.equal(form.ru.askLocation, '3 из 5. Где хотите жить?');
  assert.equal(form.ru.askBudget, 'Бюджет?', 'a text without a step number is left alone');
  assert.equal(form.ru.askBedrooms, '5 из 5. Сколько спален нужно?');
  assert.equal(form.en.askBudget, '4 of 5. What budget are you considering? You can include the amount and currency.');
  assert.equal(form.es.askLocation, '3 de 5. ¿Qué ciudad, zona o ubicación te interesa?');
  const again = bot.normalizeLoadedData(JSON.parse(JSON.stringify(saved)));
  assert.equal(effectiveTexts(again).selectionForm.ru.askLocation, '3 из 5. Где хотите жить?', 'runs once');
});

test('version 17 gives the short menu labels and help to texts still at the old defaults', () => {
  const saved = bot.normalizeLoadedData({
    version: 16,
    config: { messages: {
      ru: { greeting: 'Привет', help: bot.previousHelpDefaults.ru, fallback: 'Спасибо' },
      en: { greeting: 'Hi', help: 'My own help', fallback: 'Thanks' },
    } },
    interfaceText: { menuLabels: {
      ru: { objects: '🏘 Наши объекты', selection: '✨ Помогите подобрать объект', contacts: '💬 Связаться с менеджером', request: '📞 Заказать звонок', more: '☰ Ещё' },
      en: { objects: '🏡 Homes', request: '📞 Request a call' },
    } },
  });
  assert.deepEqual(
    ['objects', 'selection', 'contacts', 'request'].map((key) => effectiveTexts(saved).menuLabels.ru[key]),
    ['🏘 Объекты', '✨ Подбор', '💬 Связаться', '📞 Позвоните мне'],
  );
  assert.equal(effectiveTexts(saved).menuLabels.en.objects, '🏡 Homes', 'a label the administrator changed is kept');
  assert.equal(effectiveTexts(saved).menuLabels.en.request, '📞 Call me back');
  assert.equal(effectiveTexts(saved).menuLabels.ru.more, '👤 Моё');
  assert.match(saved.config.messages.ru.help, /💬 Связаться —/, 'старая помощь заменена нынешней');
  assert.equal(saved.config.messages.en.help, 'My own help');
});

test('version 19 introduces comparison without overwriting administrator texts', () => {
  const previousIntro = 'Здесь собраны сохранённые объекты, история просмотров, ваши заявки и личные настройки.';
  const previousHelp = '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — специальные предложения\n📞 Позвоните мне — менеджер перезвонит в удобное время\n💬 Менеджер — задать вопрос, позвонить или написать в WhatsApp\n👤 Моё — избранное, история просмотров, заявки и уведомления\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.';
  const saved = bot.normalizeLoadedData({
    version: 18,
    config: { messages: {
      ru: { help: previousHelp },
      en: { help: 'My custom help' },
    } },
    interfaceText: { myArea: {
      ru: { intro: previousIntro },
      en: { intro: 'My custom personal area' },
    } },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.match(effectiveTexts(saved).myArea.ru.intro, /сравниваемые объекты/);
  assert.match(saved.config.messages.ru.help, /избранное, сравнение/);
  assert.equal(effectiveTexts(saved).myArea.en.intro, 'My custom personal area');
  assert.equal(saved.config.messages.en.help, 'My custom help');
});

test('version 20 introduces saved search without overwriting administrator texts', () => {
  const previousIntro = 'Здесь собраны сохранённые и сравниваемые объекты, история просмотров, ваши заявки и личные настройки.';
  const previousHelp = '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — специальные предложения\n📞 Позвоните мне — менеджер перезвонит в удобное время\n💬 Менеджер — задать вопрос, позвонить или написать в WhatsApp\n👤 Моё — избранное, сравнение, история просмотров, заявки и уведомления\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.';
  const saved = bot.normalizeLoadedData({
    version: 19,
    config: { messages: { ru: { help: previousHelp }, en: { help: 'My own help' } } },
    interfaceText: { myArea: { ru: { intro: previousIntro }, en: { intro: 'My own personal area' } } },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.match(effectiveTexts(saved).myArea.ru.intro, /сохранённый поиск/);
  assert.match(saved.config.messages.ru.help, /👤 Моё —/, 'старая помощь заменена нынешней');
  assert.equal(effectiveTexts(saved).myArea.en.intro, 'My own personal area');
  assert.equal(saved.config.messages.en.help, 'My own help');
});

test('version 21 keeps only valid explanations for ranked selection results', () => {
  const saved = bot.normalizeLoadedData({
    version: 20,
    users: { client: {
      id: 'client',
      selectionMatchIds: ['villa-1', 'villa-2'],
      selectionMatchDetails: [
        { id: 'villa-1', tier: 'exact', score: 100, reasons: ['deal', 'budget', 'invented'], warnings: [] },
        { id: 'villa-2', tier: 'unknown', score: 300, reasons: [], warnings: ['priceMissing', 'invented'] },
      ],
    } },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.deepEqual(saved.users.client.selectionMatchIds, ['villa-1', 'villa-2']);
  assert.deepEqual(saved.users.client.selectionMatchDetails, [
    { id: 'villa-1', tier: 'exact', score: 100, reasons: ['deal', 'budget'], warnings: [] },
    { id: 'villa-2', tier: 'consider', score: 100, reasons: [], warnings: ['priceMissing'] },
  ]);
});

test('version 22 keeps the selection result snapshot inside its inquiry', () => {
  const saved = bot.normalizeLoadedData({
    version: 21,
    inquiries: [{
      id: 'selection-one', userId: 'client', chatId: 'client', language: 'ru', type: 'selection', status: 'new', text: 'Подбор',
      matching: { generatedAt: '2026-09-24T06:00:00.000Z', results: [
        { id: 'villa-1', tier: 'close', score: 80.4, reasons: ['deal', 'type'], warnings: ['priceMissing', 'invented'] },
      ] },
      replies: [], createdAt: '2026-09-24T06:00:00.000Z', updatedAt: '2026-09-24T06:00:00.000Z',
    }],
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.deepEqual(saved.inquiries[0].matching, {
    generatedAt: '2026-09-24T06:00:00.000Z',
    results: [{ id: 'villa-1', tier: 'close', score: 80, reasons: ['deal', 'type'], warnings: ['priceMissing'] }],
  });
});

test('version 23 keeps a safe snapshot of the similar-property mini-catalog', () => {
  const saved = bot.normalizeLoadedData({
    version: 22,
    users: { client: {
      id: 'client',
      similarPropertyIds: ['villa-2', 'villa-2', 'house-3'],
      similarPropertySourceId: 'villa-1',
      similarPropertyDetails: [
        { id: 'villa-2', score: 150, reasons: ['type', 'city', 'invented'], warnings: ['priceMissing', 'invented'] },
        { id: 'house-3', score: 72.4, reasons: ['relatedType', 'area'], warnings: [] },
      ],
      catalogContext: { mode: 'similar', page: 1, propertyId: 'house-3' },
    } },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.deepEqual(saved.users.client.similarPropertyIds, ['villa-2', 'house-3']);
  assert.deepEqual(saved.users.client.similarPropertyDetails, [
    { id: 'villa-2', score: 100, reasons: ['type', 'city'], warnings: ['priceMissing'] },
    { id: 'house-3', score: 72, reasons: ['relatedType', 'area'], warnings: [] },
  ]);
  assert.equal(saved.users.client.similarPropertySourceId, 'villa-1');
  assert.deepEqual(saved.users.client.catalogContext, { mode: 'similar', page: 1, propertyId: 'house-3' });
});

test('version 24 keeps a custom price from a natural-language saved search', () => {
  const saved = bot.normalizeLoadedData({
    version: 23,
    users: { client: {
      id: 'client',
      savedSearch: {
        filter: { deal: 'sale', type: 'apartment', city: 'Марбелья', bedrooms: 2, minPrice: 300000, maxPrice: 525000 },
        enabled: true,
      },
    } },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.equal(saved.users.client.savedSearch.filter.minPrice, 300000);
  assert.equal(saved.users.client.savedSearch.filter.maxPrice, 525000);
});

test('version 26 builds a readable conversation history without making old messages unread', () => {
  const saved = bot.normalizeLoadedData({
    version: 25,
    inquiries: [{
      id: 'old-dialog', userId: 'client', chatId: '501', language: 'ru', type: 'general', status: 'in_progress', text: 'Старая переписка',
      replies: [{ id: 'reply-one', text: 'Ответ менеджера', source: 'panel', by: 'Олег', createdAt: '2026-09-20T11:00:00.000Z', telegramMessageId: 77 }],
      createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T11:00:00.000Z', clientMessageAt: '2026-09-20T10:00:00.000Z',
    }],
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.deepEqual(saved.inquiries[0].messages.map((message) => [message.direction, message.text, message.telegramMessageId]), [
    ['in', 'Старая переписка', null],
    ['out', 'Ответ менеджера', 77],
  ]);
  assert.equal(saved.inquiries[0].readAt, '2026-09-20T10:00:00.000Z');
});

test('version 27 keeps safe notification-center state', () => {
  const saved = bot.normalizeLoadedData({
    version: 26,
    adminNotificationStates: {
      'message:client:1': {
        readAt: '2026-09-24T10:00:00.000Z',
        handledAt: '2026-09-24T11:00:00.000Z',
        snapshot: { id: 'message:client:1', kind: 'message', severity: 'bad', title: 'Новое сообщение', text: 'Текст', createdAt: '2026-09-24T09:00:00.000Z', route: { view: 'inquiries', tab: 'inbox', inquiryId: 'one' } },
      },
    },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.equal(saved.adminNotificationStates['message:client:1'].snapshot.route.inquiryId, 'one');
  assert.equal(saved.adminNotificationStates['message:client:1'].handledAt, '2026-09-24T11:00:00.000Z');
});

test('version 28 keeps messenger delivery, quote and retry metadata', () => {
  const saved = bot.normalizeLoadedData({
    version: 27,
    inquiries: [{
      id: 'dialog', userId: 'client', chatId: '501', type: 'general', status: 'in_progress', text: 'Нужны документы',
      messages: [{
        id: 'answer', direction: 'out', kind: 'document', text: 'Отправляю презентацию', fileId: 'telegram-file', fileName: 'offer.pdf', mimeType: 'application/pdf',
        telegramMessageId: 88, replyToTelegramMessageId: 77, replyToText: 'Нужны документы', deliveryStatus: 'delivered', clientRequestId: 'request-12345678', createdAt: '2026-09-25T10:00:00.000Z',
      }],
    }],
  });
  const message = saved.inquiries[0].messages[0];
  assert.equal(saved.version, DATA_VERSION);
  assert.equal(message.kind, 'document');
  assert.equal(message.replyToTelegramMessageId, 77);
  assert.equal(message.replyToText, 'Нужны документы');
  assert.equal(message.deliveryStatus, 'delivered');
  assert.equal(message.clientRequestId, 'request-12345678');
});

test('old open inquiries receive a useful funnel stage without inventing an outcome', () => {
  const saved = bot.normalizeLoadedData({
    version: 26,
    inquiries: [
      { id: 'selection', userId: '1', type: 'selection', status: 'new' },
      { id: 'viewing', userId: '2', type: 'viewing', status: 'in_progress' },
      { id: 'contact', userId: '3', type: 'general', status: 'in_progress' },
      { id: 'closed', userId: '4', type: 'general', status: 'closed' },
      { id: 'won', userId: '5', type: 'general', status: 'closed', pipelineStage: 'won' },
    ],
  });
  assert.deepEqual(saved.inquiries.map((item) => item.pipelineStage), ['selection', 'viewing', 'contact', '', 'won']);
});

test('version 25 keeps the district in a saved search', () => {
  const saved = bot.normalizeLoadedData({
    version: 24,
    users: { client: {
      id: 'client',
      savedSearch: {
        filter: { deal: 'sale', city: 'Марбелья', district: 'Сьерра-Бланка' },
        enabled: true,
      },
    } },
  });
  assert.equal(saved.version, DATA_VERSION);
  assert.equal(saved.users.client.savedSearch.filter.district, 'Сьерра-Бланка');
});

// Списки прежних подписей кнопок остаются дословными: по ним бот узнаёт
// кнопки, которые всё ещё висят у старых клиентов.
// «💬 Gestor» — прежняя подпись кнопки, которую бот обязан узнавать у старых клиентов.
const PREVIOUS_LABELS = /Our properties|Nuestros inmuebles|Contact an agent|Contactar con un agente|💬 Gestor/;

test('the Spanish and English wording matches how agencies actually speak', () => {
  // «Gestor» в Испании — тот, кто оформляет документы, а не тот, кто продаёт
  // дома. Клиент ждёт «asesor» или «agente».
  // Смотрим весь словарь на диске, а не только то, что бот экспортирует.
  const dictionary = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'texts.mjs'), 'utf8');
  const stray = dictionary.split(/\r?\n/).filter(function (line) {
    // В расходах на покупку gestoría — это именно оформление документов.
    return /gestor/i.test(line) && !/otherCosts:/.test(line) && !PREVIOUS_LABELS.test(line);
  });
  assert.deepEqual(stray, [], 'в текстах для клиента «gestor» остался только в расходах на оформление');

  assert.equal(bot.text.propertyActions.en.contactManager, 'Contact us', 'кнопка связи называется одинаково везде');
  assert.equal(bot.text.propertyActions.es.contactManager, 'Contactar');
  assert.equal(bot.text.menuLabels.en.contacts, '💬 Contact us');
  assert.equal(bot.text.menuLabels.es.contacts, '💬 Contactar');
  assert.equal(bot.text.propertyActions.en.cardFavoriteRemove, 'Saved ✓', 'кнопка показывает состояние, а не действие «не сохранять»');
  assert.match(bot.text.selection.es.askBudget, /¿Cuál es tu presupuesto\?/);

  // Прежние подписи бот всё ещё понимает: у старых клиентов они на экране.
  assert.equal(bot.menuItemForText('💬 Contactar con un gestor', 'es'), 'contacts');
  assert.equal(bot.menuItemForText('💬 Contact a manager', 'en'), 'contacts');
});

test('язык меняют названием языка, а не страной или кодом', () => {
  for (const [word, language] of [['Русский', 'ru'], ['English', 'en'], ['Español', 'es'], ['испанский', 'es'], ['🇪🇸', 'es']]) {
    assert.equal(bot.languageFromText(word, { exact: true }), language, word);
  }
  // Страна и короткий код — это место поиска или обычное слово, а не смена языка.
  for (const word of ['Испания', 'Россия', 'es', 'en', 'ru', 'ES', 'eng', 'spa', 'rus']) {
    assert.equal(bot.languageFromText(word, { exact: true }), '', word);
    assert.equal(bot.languageFromText(word), '', word + ' (язык ещё не выбран)');
  }
  assert.equal(bot.languageFromText('en Marbella'), '', 'испанское «en» — это «в»');
  assert.equal(bot.languageFromText('es bonito'), '', 'испанское «es» — это «есть»');
});

test('кнопка «Связаться» узнаётся под всеми прежними названиями', () => {
  // Клиент, не обновивший чат, нажимает то, что осталось у него на клавиатуре.
  for (const [label, language] of [['💬 Менеджер', 'ru'], ['💬 Manager', 'en'], ['💬 Agent', 'en'], ['💬 Gestor', 'es'], ['💬 Asesor', 'es']]) {
    assert.equal(bot.menuItemForText(label, language), 'contacts', label);
  }
  assert.equal(bot.menuItemForText('💬 Связаться', 'ru'), 'contacts', 'нынешняя подпись по-прежнему работает');
  assert.equal(bot.menuItemForText('💬 Manager', 'ru'), '', 'чужой язык не подхватывается случайно');
  assert.equal(bot.menuItemForText('❤️ Favorites', 'en'), 'favorites', 'прежняя подпись «Favorites» узнаётся после перехода на «Favourites»');
});

test('an old menu keyboard still opens its sections', async () => {
  assert.equal(bot.menuItemForText('🏘 Наши объекты', 'ru'), 'objects');
  assert.equal(bot.menuItemForText('📞 Заказать звонок', 'ru'), 'request');
  assert.equal(bot.menuItemForText('✨ Help me find a property', 'en'), 'selection');
  assert.equal(bot.menuItemForText('💬 Contactar con un gestor', 'es'), 'contacts');
  assert.equal(bot.menuItemForText('☰ Ещё', 'ru'), 'more');
  assert.equal(bot.menuItemForText('☰ More', 'en'), 'more');
  assert.equal(bot.menuItemForText('☰ Más', 'es'), 'more');
});

test('admin edits of Russian texts survive a restart', () => {
  const saved = bot.normalizeLoadedData({
    version: 13,
    config: {
      greeting: 'Старое приветствие',
      help: 'Отправьте сообщение, и я постараюсь подобрать ответ.',
      fallback: 'Спасибо за сообщение! Я передал его администратору.',
      messages: {
        ru: { greeting: 'Моё приветствие', help: 'Моя справка', fallback: 'Мой ответ' },
      },
    },
  });
  assert.equal(saved.config.messages.ru.greeting, 'Моё приветствие');
  assert.equal(saved.config.messages.ru.help, 'Моя справка');
  assert.equal(saved.config.messages.ru.fallback, 'Мой ответ');
  assert.equal(saved.version, DATA_VERSION);
  for (const key of ['greeting', 'help', 'fallback']) assert.equal(key in saved.config, false);

  const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reloaded.config.messages, saved.config.messages);
});

test('one-language files are still migrated into Russian texts', () => {
  const migrated = bot.normalizeLoadedData({ config: { greeting: 'Привет из старой версии' } });
  assert.equal(migrated.config.messages.ru.greeting, 'Привет из старой версии');
  assert.equal('greeting' in migrated.config, false);
});

test('text migrations run once and never rewrite the owner\'s own words', () => {
  const custom = { ru: { greeting: 'Наш агент на связи', help: 'Справка', fallback: 'Ответ' } };
  // Раньше при переходе со старого формата «агент» молча менялся на «менеджер».
  // Слова владельца теперь остаются как есть.
  const legacy = bot.normalizeLoadedData({ version: 13, config: { messages: custom } });
  assert.equal(legacy.config.messages.ru.greeting, 'Наш агент на связи');
  assert.equal(legacy.config.messages.ru.help, 'Справка');
  const current = bot.normalizeLoadedData({ version: 14, config: { messages: custom } });
  assert.equal(current.config.messages.ru.greeting, 'Наш агент на связи');
});

test('analytics of deleted properties are dropped on load', () => {
  const loaded = bot.normalizeLoadedData({
    version: 14,
    objects: [{ id: 'kept' }],
    analytics: { daily: {}, properties: { kept: { details: 1 }, removed: { details: 5 } } },
  });
  assert.deepEqual(Object.keys(loaded.analytics.properties), ['kept']);
});

test('a failing update does not block the offset or other chats', async () => {
  bot.runtime.offset = 0;
  const handled = [];
  const updates = [
    { update_id: 10, message: { chat: { id: 1 }, text: 'a' } },
    { update_id: 11, message: { chat: { id: 2 }, text: 'boom' } },
    { update_id: 12, message: { chat: { id: 1 }, text: 'b' } },
  ];
  await bot.processUpdates(updates, 'token', async (update) => {
    if (update.message.text === 'boom') throw new Error('Forbidden: bot was blocked by the user');
    handled.push(update.update_id);
  });
  assert.equal(bot.runtime.offset, 13);
  assert.equal(bot.getData().telegramOffset, 13);
  assert.deepEqual(handled, [10, 12]);
  assert.ok(bot.getData().errors.some((item) => item.message.includes('blocked')));
});

test('Telegram 429 is retried after retry_after', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return calls === 1
      ? telegramResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } })
      : telegramResponse(200, { ok: true, result: { message_id: 7 } });
  }, async () => {
    const result = await bot.telegramRequest('1:token', 'sendMessage', { chat_id: 1, text: 'hi' });
    assert.equal(result.message_id, 7);
  });
  assert.equal(calls, 2);
});

test('an unreasonable retry_after is reported instead of waited for', async () => {
  await withFetch(async () => telegramResponse(429, {
    ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3600 },
  }), async () => {
    await assert.rejects(bot.telegramRequest('1:token', 'sendMessage', {}), (error) => error.telegramCode === 429);
  });
});

test('identical images share one file on disk', () => {
  const first = { id: 'a', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') };
  const second = { id: 'b', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') };
  bot.persistImage(first);
  bot.persistImage(second);
  assert.equal(first.storageFile, second.storageFile);
  assert.match(first.storageFile, /^[0-9a-f]{64}\.png$/);
  assert.notEqual(first.id, second.id);
});

test('images from older versions move to content-addressed names', () => {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  fs.writeFileSync(path.join(mediaDirectory, 'old-upload-1.png'), PNG_BYTES);
  fs.writeFileSync(path.join(mediaDirectory, 'old-upload-2.png'), PNG_BYTES);
  const root = {
    objects: [{
      imagesByLanguage: {
        ru: [{ id: 'x', mimeType: 'image/png', storageFile: 'old-upload-1.png' }],
        en: [{ id: 'y', mimeType: 'image/png', storageFile: 'old-upload-2.png' }],
        es: [],
      },
    }],
  };
  bot.contentAddressImages(root);
  const [ru] = root.objects[0].imagesByLanguage.ru;
  const [en] = root.objects[0].imagesByLanguage.en;
  assert.equal(ru.storageFile, en.storageFile);
  assert.deepEqual(fs.readFileSync(path.join(mediaDirectory, ru.storageFile)), PNG_BYTES);
  assert.equal(bot.referencedImageFiles(root).size, 1);
});

test('user lookups ignore prototype keys', () => {
  assert.equal(bot.userById('__proto__'), undefined);
  assert.equal(bot.userById('constructor'), undefined);
});

test('the chat index follows user updates', () => {
  bot.normalizeUser({ id: 501, first_name: 'Анна' }, 9001);
  assert.equal(bot.userByChatId(9001).firstName, 'Анна');
  bot.normalizeUser({ id: 501, first_name: 'Анна-Мария' }, 9001);
  assert.equal(bot.userByChatId('9001').firstName, 'Анна-Мария');
  assert.equal(bot.userByChatId(424242), undefined);
});

test('the panel rejects foreign host names', () => {
  const request = (host) => ({ headers: { host } });
  assert.equal(bot.hostAllowed(request('127.0.0.1:3000')), true);
  assert.equal(bot.hostAllowed(request('localhost:3000')), true);
  assert.equal(bot.hostAllowed(request('[::1]:3000')), true);
  assert.equal(bot.hostAllowed(request('192.168.1.20:3000')), true);
  assert.equal(bot.hostAllowed(request('attacker.example:3000')), false);
});

test('a corrupt data file is recovered from the .bak copy', () => {
  const good = bot.normalizeLoadedData({ version: 14, config: { adminChatId: '123456' } });
  fs.writeFileSync(dataFile + '.bak', JSON.stringify(good));
  fs.writeFileSync(dataFile, '{"config": ');
  const originalError = console.error;
  console.error = () => {};
  let recovered;
  try {
    recovered = bot.loadData();
  } finally {
    console.error = originalError;
  }
  assert.equal(recovered.config.adminChatId, '123456');
  assert.equal(recovered.errors[0].area, 'Загрузка данных');
  assert.ok(fs.readdirSync(workDirectory).some((name) => name.startsWith('bot-data.json.corrupt-')));
});

test.describe('admin API', () => {
  let baseUrl;
  let cookie;
  let csrf;

  test.before(async () => {
    const data = bot.normalizeLoadedData({ version: 14 });
    const password = bot.hashPassword('correct-password');
    data.config.botToken = '12345:ABCDEFGHIJKLMNOPQRSTUV';
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    data.config.active = false;
    data.users['700'] = { id: '700', chatId: 700, firstName: 'Тест', activity: [] };
    bot.setData(data);
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + bot.server.address().port;
    const response = await fetch(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' }),
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrf;
  });

  function call(method, url, body) {
    return fetch(baseUrl + url, {
      method,
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  test('PATCH /api/users/__proto__ cannot pollute Object.prototype', async () => {
    const response = await call('PATCH', '/api/users/__proto__', { blocked: true, note: 'x' });
    assert.equal(response.status, 404);
    assert.equal({}.blocked, undefined);
  });

  test('changing the password requires the current password', async () => {
    const messages = bot.getData().config.messages;
    const change = { messages, active: false, password: 'new-password-1', passwordConfirm: 'new-password-1' };
    assert.equal((await call('PUT', '/api/settings', change)).status, 403);
    assert.equal((await call('PUT', '/api/settings', { ...change, currentPassword: 'wrong-password' })).status, 403);
    assert.equal((await call('PUT', '/api/settings', { ...change, currentPassword: 'correct-password' })).status, 200);
    const login = await fetch(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'new-password-1' }),
    });
    assert.equal(login.status, 200);
  });

  test('saving other settings needs no password', async () => {
    const messages = bot.getData().config.messages;
    assert.equal((await call('PUT', '/api/settings', { messages, active: false })).status, 200);
  });

  test('/api/state answers "unchanged" for the version the panel already has', async () => {
    const full = await (await call('GET', '/api/state')).json();
    assert.ok(full.stateVersion);
    assert.ok(Array.isArray(full.users));
    const repeat = await (await call('GET', '/api/state?since=' + full.stateVersion)).json();
    assert.deepEqual(repeat, { unchanged: true, stateVersion: full.stateVersion });
  });

  test('a downloaded backup restores with its photos', async () => {
    const data = bot.getData();
    // Предыдущая проверка меняет пароль панели, а скачивание и восстановление
    // копии просят текущий: ставим известный.
    const known = bot.hashPassword('correct-password');
    data.config.passwordSalt = known.salt;
    data.config.passwordHash = known.hash;
    data.objects.push({
      id: 'backup-object',
      imagesByLanguage: {
        ru: [{ id: 'p1', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
        en: [{ id: 'p2', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
        es: [],
      },
    });
    bot.saveDataNow();
    const ticket = await (await call('POST', '/api/backup/ticket', { currentPassword: 'correct-password' })).json();
    const backup = Buffer.from(await (await call('GET', '/api/backup?ticket=' + ticket.ticket)).arrayBuffer());
    data.objects = [];
    bot.saveDataNow();
    const response = await fetch(baseUrl + '/api/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/gzip', cookie, 'x-csrf-token': csrf,
        'x-current-password': Buffer.from('correct-password', 'utf8').toString('base64'),
      },
      body: backup,
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrf;
    const restored = bot.getData().objects.find((item) => item.id === 'backup-object');
    const [ru] = restored.imagesByLanguage.ru;
    const [en] = restored.imagesByLanguage.en;
    assert.equal(ru.storageFile, en.storageFile);
    assert.deepEqual(fs.readFileSync(path.join(mediaDirectory, ru.storageFile)), PNG_BYTES);
  });

  test('requests with a foreign Host header are refused', async () => {
    const http = require('node:http');
    const status = await new Promise((resolve, reject) => {
      const request = http.request(baseUrl + '/api/status', { headers: { host: 'attacker.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 421);
  });
});

test('версия 39: приветствие EN/ES из четырёх абзацев заменено коротким, своё — остаётся', () => {
  const pitchEn = '🏗️ Welcome to Construcciones Kornilenko! 👋\n\n🏡 We specialize in building cottages and private homes, creating modern, reliable, and comfortable spaces for everyday living.\n\nIn this bot, you can explore our services, learn more about our company, and quickly get in touch with our team.\n\n🤝 Quality construction. Responsible work. Homes made for living.';
  const pitchEs = '¡Bienvenido a Construcciones Kornilenko! 👋\n\n🏡 Nos especializamos en la construcción de chalets y viviendas unifamiliares, creando espacios modernos, fiables y confortables para vivir.\n\nEn este bot puedes conocer nuestros servicios, obtener más información sobre la empresa y contactar rápidamente con nuestro equipo.\n\n🤝 Construimos con calidad. Trabajamos con responsabilidad. Creamos hogares para vivir.';
  const saved = bot.normalizeLoadedData({
    version: 38,
    config: { messages: { ru: { greeting: 'Здравствуйте, {first_name}!' }, en: { greeting: pitchEn }, es: { greeting: pitchEs } } },
  });
  assert.match(saved.config.messages.en.greeting, /^Hello, \{first_name\}!/);
  assert.match(saved.config.messages.es.greeting, /^¡Hola, \{first_name\}!/);
  assert.ok(saved.config.messages.en.greeting.length < 80 && saved.config.messages.es.greeting.length < 80, 'короткое, как русское');

  const own = bot.normalizeLoadedData({ version: 38, config: { messages: { en: { greeting: 'Welcome, {first_name}! We build homes in Finestrat.' } } } });
  assert.equal(own.config.messages.en.greeting, 'Welcome, {first_name}! We build homes in Finestrat.', 'приветствие, написанное владельцем иначе, не трогаем');
});

test('кнопка связи с менеджером называется одинаково в меню, на карточке и в подписях', () => {
  const withoutEmoji = (label) => label.replace(/^[^\p{L}]+/u, '');
  for (const language of ['ru', 'en', 'es']) {
    const inMenu = withoutEmoji(bot.text.menuLabels[language].contacts);
    assert.equal(bot.text.propertyActions[language].contact, inMenu, language + ': на карточке то же слово, что в меню');
    assert.equal(bot.text.propertyActions[language].contactManager, inMenu, language + ': и в остальных подписях');
    // Прежние названия — «Manager», «Contact», «Gestor» — ни на одной кнопке не остались.
    for (const old of ['Manager', 'Gestor', 'Менеджер']) {
      assert.notEqual(inMenu, old, language + ': ' + old + ' — прежнее название');
    }
  }
  assert.equal(bot.text.menuLabels.ru.contacts, '💬 Связаться');
  assert.equal(bot.text.menuLabels.en.contacts, '💬 Contact us');
  assert.equal(bot.text.menuLabels.es.contacts, '💬 Contactar');
});

test('цены и числа одного вида на всех экранах: «€250,000», «250.000 €», «250 000 €»', () => {
  const record = { id: 'fmt-1', status: 'active', propertyType: 'villa', dealType: 'sale', currency: 'EUR', priceValue: 250000, area: 70, title: { ru: 'Вилла', en: 'Villa', es: 'Villa' } };
  const caption = (language) => bot.objectCaption(record, language).replace(/ | /g, ' ');
  assert.match(caption('en'), /€250,000 · €3,571\/m²/, 'английский: символ впереди');
  assert.match(caption('es'), /250\.000 € · 3\.571 €\/m²/, 'испанский: точка и символ после, и у цены за метр тоже');
  assert.match(caption('ru'), /250 000 € · 3 571 €\/м²/, 'русский: пробел и символ после');
  const rent = { ...record, dealType: 'rent', pricePeriod: 'month', priceValue: 2000 };
  assert.match(bot.objectCaption(rent, 'en'), /€2,000 \/ month/);
  assert.match(bot.objectCaption(rent, 'es').replace(/ /g, ' '), /2\.000 € \/ mes/);
});

test('вычитка EN/ES: британское написание, «Beach», «Pedir visita», «Avísame», единые «promociones»', async () => {
  const { INTERFACE_TEXT_DEFAULTS: texts } = await import('../src/texts.mjs');
  const only = (groups, language) => groups.map((group) => JSON.stringify(texts[group][language])).join('');
  const english = only(['menuLabels', 'propertyActions', 'emptyStates', 'selectionForm', 'catalogFilter', 'myRequests', 'subscriptions'], 'en')
    .replace(/"(favorites|emptyFavorites)":/g, '"":');
  assert.ok(!/[Ff]avorites/.test(english), 'в английских текстах «favourites», а не «favorites»');
  assert.ok(!/catalog/.test(english), '«catalogue», а не «catalog»');
  assert.equal(texts.menuLabels.en.favorites, '❤️ Favourites');
  assert.equal(texts.propertyActions.en.distanceSeaLabel, 'Beach');
  assert.equal(texts.propertyActions.es.viewing, 'Pedir visita', 'в недвижимости «reservar» — внести резерв');
  assert.equal(texts.selectionForm.es.wizardNotify, '🔔 Avísame de los nuevos');
  assert.equal(texts.selectionForm.es.wizardFound, 'Resultados: {count}');
  assert.equal(texts.selectionForm.en.wizardFound, 'Properties found: {count}');
  assert.equal(texts.calculator.es.openButton, '🧮 Calculadora de compra e hipoteca');
  assert.ok(!/Novedades y ofertas/.test(only(['subscriptions'], 'es')), 'одно название рассылки: «Novedades y promociones»');
  assert.ok(!/[Rr]eservar/.test(only(['propertyActions', 'viewingForm', 'myRequests'], 'es')), 'клиенту не предлагают «reservar» визит');
});

test('«/start» и «Помощь» на английском и испанском — без «manager/gestor» и без исчезнувших кнопок', async () => {
  const { INTERFACE_TEXT_DEFAULTS: texts } = await import('../src/texts.mjs');
  const fresh = bot.normalizeLoadedData({ version: 39 });
  for (const [language, banned] of [['en', /\bmanager\b/i], ['es', /\bgestor\b/i]]) {
    const messages = fresh.config.messages[language];
    const screen = [messages.greeting, messages.help, messages.fallback, texts.menuHints[language].text].join('\n');
    assert.ok(!banned.test(screen), language + ': нет слова ' + banned);
    // Кнопки, которых в главном меню больше нет, в помощи не описаны.
    assert.ok(!/❤️|🔥|📞/.test(messages.help), language + ': помощь не рассказывает про исчезнувшие кнопки');
    // Зато названа настоящая кнопка связи и «Моё».
    assert.ok(messages.help.includes(bot.text.menuLabels[language].contacts.replace(/^[^\p{L}]+/u, '')), language + ': в помощи — настоящая кнопка связи');
    assert.ok(messages.help.includes(bot.text.menuLabels[language].more.replace(/^[^\p{L}]+/u, '')), language + ': и «Моё»');
  }
  const russian = fresh.config.messages.ru;
  assert.ok(!/❤️|🔥|📞/.test(russian.help), 'ru: то же');
});
