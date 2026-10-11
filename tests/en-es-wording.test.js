'use strict';

// Английский и испанский «как родные» (этап 35): новые ярлыки и фразы, старые кнопки на клавиатурах
// клиентов продолжают работать, прежние тексты по умолчанию у владельца заменяются при обновлении
// формата, а то, что он правил сам, остаётся.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, resetData, cleanup } = require('./helpers/chat');

test.beforeEach(() => resetData((data) => { data.config.active = true; }));
test.after(cleanup);

test('новые ярлыки меню: «Help me choose», «My account», «Buscar por mí»', () => {
  assert.equal(bot.text.menuLabels.en.selection, '✨ Help me choose');
  assert.equal(bot.text.menuLabels.en.more, '👤 My account');
  assert.equal(bot.text.menuLabels.es.selection, '✨ Buscar por mí');
  assert.ok(!/My space/.test(JSON.stringify(bot.text.menuLabels.en)), 'в подписях меню «My space» не осталось');
});

test('кнопка со старой клавиатуры («Find for me», «My space», «Búsqueda») по-прежнему работает', async () => {
  const { menuItemForText } = bot;
  assert.equal(menuItemForText('✨ Find for me', 'en'), 'selection');
  assert.equal(menuItemForText('👤 My space', 'en'), 'more');
  assert.equal(menuItemForText('✨ Búsqueda', 'es'), 'selection');
  assert.equal(menuItemForText('✨ Ayúdame a elegir', 'es'), 'selection', 'и более старая');
  assert.equal(menuItemForText('✨ Help me choose', 'en'), 'selection');
  assert.equal(menuItemForText('👤 My account', 'en'), 'more');
  assert.equal(menuItemForText('что-то другое', 'en'), '');
});

test('мастер подбора: «Buying or renting?», «5 properties match», «Show 1 property», «Ver 1 inmueble»', async () => {
  const { INTERFACE_TEXT_DEFAULTS: texts } = await import('../src/texts.mjs');
  const en = texts.selectionForm.en;
  const es = texts.selectionForm.es;
  assert.equal(en.wizardDeal, 'Buying or renting?');
  assert.equal(es.wizardDeal, '¿Comprar o alquilar?');
  assert.equal(en.wizardFound.replace('{count}', 5), '5 properties match');
  assert.equal(en.wizardFoundOne, '1 property matches');
  assert.equal(es.wizardFound.replace('{count}', 5), '5 inmuebles coinciden');
  assert.equal(en.wizardShow.replace('{count}', 4), '👀 Show 4 properties');
  assert.equal(en.wizardShowOne, '👀 Show 1 property');
  assert.equal(es.wizardShowOne, '👀 Ver 1 inmueble');
  assert.equal(en.confirm, '✅ Send request');
});

test('приветствие и помощь по умолчанию — новые; расстояние до пляжа — «Beach»', () => {
  const fresh = bot.normalizeLoadedData({ version: 48 });
  assert.match(fresh.config.messages.en.greeting, /Nice to meet you/);
  assert.ok(!/Glad to see you/.test(fresh.config.messages.en.greeting));
  assert.match(fresh.config.messages.en.help, /✨ Help me choose/);
  assert.match(fresh.config.messages.en.help, /👤 My account/);
  assert.match(fresh.config.messages.es.help, /✨ Buscar por mí/);
  assert.equal(bot.text.propertyActions.en.distanceSeaLabel, 'Distance to beach');
  assert.equal(bot.text.comparison.en.distanceSea, '🌊 Distance to beach');
});

test('обновление с версии 47: нетронутые прежние тексты заменяются, правленые владельцем остаются', () => {
  const old = bot.normalizeLoadedData({ version: 48 });
  const previous = {
    en: { greeting: 'Hello, {first_name}! Glad to see you. How can I help?', help: old.config.messages.en.help.replace('Help me choose', 'Find for me').replace('My account', 'My space') },
    es: { help: old.config.messages.es.help.replace('Buscar por mí', 'Búsqueda') },
  };
  const migrated = bot.normalizeLoadedData({
    version: 47,
    config: { messages: { en: { greeting: previous.en.greeting, help: previous.en.help }, es: { help: previous.es.help } } },
    interfaceText: { menuLabels: { en: { selection: '✨ Find for me', more: '👤 My space' }, es: { selection: '✨ Búsqueda' } } },
  });
  assert.match(migrated.config.messages.en.greeting, /Nice to meet you/);
  assert.match(migrated.config.messages.en.help, /Help me choose/);
  assert.match(migrated.config.messages.es.help, /Buscar por mí/);
  assert.equal(migrated.interfaceText.menuLabels.en.selection, '✨ Help me choose');
  assert.equal(migrated.interfaceText.menuLabels.en.more, '👤 My account');
  assert.equal(migrated.interfaceText.menuLabels.es.selection, '✨ Buscar por mí');

  // Владелец правил сам — его текст остаётся как есть.
  const custom = bot.normalizeLoadedData({
    version: 47,
    config: { messages: { en: { greeting: 'Hi {first_name}, welcome to our agency!', help: 'My own help text' } } },
    interfaceText: { menuLabels: { en: { selection: '✨ Find me a home' } } },
  });
  assert.equal(custom.config.messages.en.greeting, 'Hi {first_name}, welcome to our agency!');
  assert.equal(custom.config.messages.en.help, 'My own help text');
  assert.equal(custom.interfaceText.menuLabels.en.selection, '✨ Find me a home');
});

test('день и месяц — с ведущими нулями на всех языках: «09.09», «09/09» (Intl для es-ES отдавал «9/9»)', async () => {
  const { formatDayMonth } = await import('../src/util.mjs');
  const date = new Date(2026, 8, 9);
  assert.equal(formatDayMonth(date, 'ru'), '09.09');
  assert.equal(formatDayMonth(date, 'en'), '09/09');
  assert.equal(formatDayMonth(date, 'es'), '09/09');
  assert.equal(formatDayMonth(new Date(2026, 11, 29), 'es'), '29/12');
});

test('имя менеджера для EN/ES-клиента — латиницей, для русского — как записано', async () => {
  const { latinName, managerNameFor } = await import('../src/util.mjs');
  assert.equal(latinName('Ольга Корниленко'), 'Olga Kornilenko');
  assert.equal(latinName('Юлия Щукина'), 'Yuliya Shchukina');
  assert.equal(latinName('Ёлкин Жуков'), 'Elkin Zhukov');
  assert.equal(latinName('Olga Kornilenko'), 'Olga Kornilenko', 'латиница остаётся как есть');
  const contact = { managerName: 'Ольга Корниленко' };
  assert.equal(managerNameFor(contact, 'ru'), 'Ольга Корниленко');
  assert.equal(managerNameFor(contact, 'en'), 'Olga Kornilenko');
  assert.equal(managerNameFor(contact, 'es'), 'Olga Kornilenko');
  assert.equal(managerNameFor({}, 'en'), '');
});
