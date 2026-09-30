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
