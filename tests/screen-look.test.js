'use strict';

// Единый вид экранов бота: заголовок экрана с кнопками — жирным (entity, а не разметка), итоги калькулятора — жирным,
// адрес карты и WhatsApp в тексте — словами-ссылкой. Тексты остаются простыми, поэтому «<» в них ничего не ломает.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;
let labelledLinks;
let screenTitleEntities;

test.before(async () => {
  ({ labelledLinks, screenTitleEntities } = await import('../src/telegram.mjs'));
});
test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.calculator = { ...(data.config.calculator || {}), enabled: true };
  data.objects.push(property('villa-a', 'Вилла у моря', 'active', { currency: 'EUR', priceValue: 650000, area: 180, bedrooms: 4 }));
}));
test.after(cleanup);

const lastCall = (step) => [...step.calls].reverse().find((call) => call.body && (call.body.text || call.body.caption));
const boldPart = (body) => body.text.slice(body.entities[0].offset, body.entities[0].offset + body.entities[0].length);

test('экран с кнопками: первая строка — жирным, текст без разметки', async () => {
  const chat = createChat();
  const step = await chat.say(MENU.ru.more);
  const body = lastCall(step).body;
  assert.ok(!body.parse_mode, 'разметка не включается');
  assert.equal(body.entities[0].type, 'bold');
  assert.equal(body.entities[0].offset, 0);
  assert.equal(boldPart(body), body.text.split('\n')[0]);
});

test('инструкция с точкой на конце жирным не выделяется', () => {
  const payload = { chat_id: 1, text: '📌 Выберите удобный вариант.\nЕщё строка', reply_markup: { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] } };
  assert.equal(screenTitleEntities(payload), null);
  assert.equal(screenTitleEntities({ ...payload, text: '📌 Выберите\nЕщё строка' })[0].length, '📌 Выберите'.length);
  assert.equal(screenTitleEntities({ ...payload, reply_markup: undefined, text: '📌 Выберите\nЕщё' }), null, 'без кнопок это не экран');
});

test('калькулятор: заголовок, итог и платёж выделены жирным, смещения совпадают с текстом', async () => {
  const chat = createChat();
  await chat.say(MENU.ru.objects);
  const body = lastCall(await chat.press('calc:villa-a')).body;
  assert.ok(body.entities.length >= 2, 'выделено несколько строк');
  for (const entity of body.entities) {
    const piece = body.text.slice(entity.offset, entity.offset + entity.length);
    assert.ok(piece && !piece.includes('\n'), 'жирным — целая строка: ' + JSON.stringify(piece));
  }
  assert.ok(body.text.split('\n').length <= 30);
});

test('адрес карты и WhatsApp становятся словами-ссылкой, остальные entity сдвигаются', () => {
  const text = 'Готово\n\nОткрыть карту: https://maps.app.goo.gl/abc123\n\n🟢 Быстрее — в WhatsApp: https://wa.me/34664179637\n\nКонец';
  const linked = labelledLinks({ chat_id: 1, text, entities: [{ type: 'bold', offset: text.indexOf('Конец'), length: 5 }] });
  assert.ok(!linked.text.includes('https://'), linked.text);
  assert.equal(linked.text, 'Готово\n\nОткрыть карту\n\n🟢 Быстрее — в WhatsApp\n\nКонец');
  const links = linked.entities.filter((entity) => entity.type === 'text_link');
  assert.deepEqual(links.map((entity) => entity.url), ['https://maps.app.goo.gl/abc123', 'https://wa.me/34664179637']);
  assert.deepEqual(links.map((entity) => linked.text.slice(entity.offset, entity.offset + entity.length)), ['Открыть карту', '🟢 Быстрее — в WhatsApp']);
  const bold = linked.entities.find((entity) => entity.type === 'bold');
  assert.equal(linked.text.slice(bold.offset, bold.offset + bold.length), 'Конец', 'жирный сдвинулся вместе с текстом');
});

test('чужие адреса и разметка не трогаются', () => {
  assert.equal(labelledLinks({ text: 'Сайт: https://example.com/page' }), null);
  assert.equal(labelledLinks({ text: 'Карта: https://maps.app.goo.gl/x', parse_mode: 'HTML' }), null);
  assert.equal(labelledLinks({ text: 'Просто текст без адреса' }), null);
});

test('«first contact»: дата по обычаю языка — 30.09.2026 / 30/09/2026', async () => {
  const cases = { ru: '30.09.2026', en: '30/09/2026', es: '30/09/2026' };
  for (const [language, expected] of Object.entries(cases)) {
    const chat = createChat({ language });
    chat.user.firstSeenAt = '2026-09-30T10:00:00.000Z';
    const step = await chat.press('privacy:open');
    assert.ok(step.text.includes(expected), language + ': ' + step.text);
  }
});

test('пример запроса в приветствии: в английском “…”, в русском и испанском «…»', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-a', 'Вилла', 'active', { currency: 'EUR', priceValue: 650000, bedrooms: 3, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }));
  });
  const quotes = { ru: /: «[^»]+»/, en: /: “[^”]+”/, es: /: «[^»]+»/ };
  for (const [language, pattern] of Object.entries(quotes)) {
    const chat = createChat({ language });
    chat.user.preferredLanguage = '';
    const step = await chat.say('/start');
    const text = step.replies[0].text || step.replies[0].caption || '';
    assert.match(text, pattern, language + ': ' + text);
  }
});

test('приветствие перед вопросом о цели не зовёт второй раз «выберите раздел»; без вопроса — зовёт', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const first = createChat({ language });
    first.user.preferredLanguage = '';
    const welcome = (await first.say('/start')).replies[0].text;
    assert.ok(!welcome.includes('👇'), language + ': ' + welcome);
    assert.match(welcome, /\S/);

    const asked = createChat({ language });
    asked.user.goalAskedAt = new Date().toISOString();
    asked.user.preferredLanguage = '';
    const again = (await asked.say('/start')).replies[0].text;
    assert.ok(again.includes('👇'), 'цель уже спрашивали — приветствие как раньше: ' + again);
  }
});

test('телефоны на экране «Связаться»: испанские — «+34 664 17 96 37», чужие как записал владелец', async () => {
  for (const [entered, shown] of [['+34664179637', '+34 664 17 96 37'], ['+34 664-17-96-37', '+34 664 17 96 37'], ['0034 664 179 637', '+34 664 17 96 37'], ['+44 20 7946 0958', '+44 20 7946 0958']]) {
    resetData((data) => { data.contacts.phone = entered; });
    const step = await createChat().say(MENU.ru.contacts);
    const call = lastCall(step).body;
    assert.ok(call.text.includes('☎️ ' + shown), entered + ' → ' + call.text);
    const phone = call.entities.find((entity) => entity.type === 'phone_number');
    assert.equal(call.text.slice(phone.offset, phone.offset + phone.length), shown, 'подсветка номера совпадает с текстом');
  }
});

test('экран фильтра — не больше шести рядов, спальни одним рядом, «Показать» и «Ещё» рядом', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    await chat.say(MENU[language].objects);
    const step = await chat.press('cfilter:open');
    const rows = step.last.markup.inline_keyboard;
    assert.ok(rows.length <= 6, language + ': ' + rows.length + ' рядов');
    const bedrooms = rows.find((row) => row.some((button) => button.callback_data === 'cfilter:bed:0'));
    assert.ok(bedrooms.every((button) => [...button.text].length <= 12), language + ': ' + bedrooms.map((button) => button.text).join(' | '));
    const last = rows[rows.length - 1];
    assert.deepEqual(last.map((button) => button.callback_data), ['cfilter:show', 'cfilter:more']);
  }
});

test('испанские кнопки способа связи — на «ты», как весь остальной бот; подписи уведомлений не путаются', async () => {
  const chat = createChat({ language: 'es' });
  await chat.say(MENU.es.request);
  const buttons = (await chat.say(MENU.es.request)).last.buttons.join(' | ');
  assert.doesNotMatch(buttons, /Llamadme|Escribidme/, buttons);
  assert.match(buttons, /Llámame/);
  for (const language of ['ru', 'en', 'es']) {
    const toggles = (await createChat({ language }).press('subs:menu')).last.buttons.filter((label) => /^[✅⬜]/.test(label)).map((label) => label.replace(/^[✅⬜] /, ''));
    assert.equal(new Set(toggles).size, toggles.length);
    assert.ok(toggles.every((label) => [...label].length <= 32), language + ': ' + toggles.join(' | '));
  }
});

test('телефон на экране «Связаться» и в подтверждении просмотра — в одном виде, номера — одним блоком', async () => {
  resetData((data) => { data.contacts.phone = '+34 (664) 17-96-37, +34 607 02 93 87'; });
  const call = lastCall(await createChat().say(MENU.ru.contacts)).body;
  assert.ok(call.text.includes('☎️ +34 664 17 96 37\n☎️ +34 607 02 93 87'), call.text);
});

test('у экранов плана, цены и «Ещё» в фильтре есть свой заголовок (жирный), выбор цели отмечен «✓»', async () => {
  for (const language of ['ru', 'en', 'es']) {
    const chat = createChat({ language });
    await chat.say(MENU[language].objects);
    for (const [callback, start] of [['plan:step:0', /^📋 /], ['cfilter:prices:0', /^💶 /], ['cfilter:more', /^⋯ /]]) {
      const body = lastCall(await chat.press(callback)).body;
      assert.match(body.text, start, language + ' ' + callback + ': ' + body.text);
    }
    const goal = lastCall(await chat.press('goal:browse')).body;
    const menu = (await chat.press('goal:menu')).last.buttons;
    assert.ok(menu.some((label) => label.startsWith('✓ ')) && !menu.some((label) => label.startsWith('✅ ')), language + ': ' + menu.join(' | '));
    assert.ok(goal);
  }
});
