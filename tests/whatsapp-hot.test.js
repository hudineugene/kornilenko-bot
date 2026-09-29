'use strict';

// WhatsApp одним нажатием на «горячих» экранах: после «Расчёта покупки» (там был
// только «Обсудить с менеджером»), в «Сравнении» и в пустой выдаче. Кто попал на
// такой экран, уже почти готов писать — не заставляем его искать контакты. Кнопка
// открывает чат с уже написанным текстом (какой объект, что сравнивал, что искал).
// Если владелец выключил WhatsApp в «Контактах» или номера нет, кнопки нет нигде —
// в том числе на карточке объекта, где раньше выключение не действовало.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const VILLA = 'villa-a';
const FLAT = 'flat-b';

function configure({ whatsapp = '+34 600 111 222', enabled = true, phone = '' } = {}) {
  const data = bot.getData();
  data.contacts.whatsapp = whatsapp;
  data.contacts.whatsappEnabled = enabled;
  data.contacts.phone = phone;
}

test.beforeEach(() => resetData((data) => {
  data.config.calculator = { ...(data.config.calculator || {}), enabled: true };
  data.objects.push(property(VILLA, 'Вилла у моря', 'active', { propertyType: 'villa', priceValue: 900000, currency: 'EUR' }));
  data.objects.push(property(FLAT, 'Квартира в центре', 'active', { propertyType: 'apartment', priceValue: 300000, currency: 'EUR' }));
  data.contacts.whatsapp = '+34 600 111 222';
  data.contacts.whatsappEnabled = true;
}));
test.after(cleanup);

const urls = (markup) => (markup && markup.inline_keyboard ? markup.inline_keyboard.flat().filter((button) => button.url) : []);
const whatsappOf = (markup) => urls(markup).find((button) => /wa\.me\//.test(button.url));
const textOf = (button) => decodeURIComponent(new URL(button.url).searchParams.get('text') || '');

test('после «Расчёта покупки» рядом с «Обсудить» — WhatsApp с названием объекта', async () => {
  const chat = createChat();
  const step = await chat.press('calc:' + VILLA);
  const button = whatsappOf(step.last.markup);
  assert.ok(button, 'кнопка есть');
  assert.equal(button.text, '🟢 WhatsApp');
  assert.match(button.url, /^https:\/\/wa\.me\/34600111222\?text=/);
  assert.match(textOf(button), /Вилла у моря/, 'в поле ввода — какой объект обсуждаем');
  assert.ok(step.last.markup.inline_keyboard.flat().some((item) => item.callback_data === 'property:manager:' + VILLA), '«Обсудить» осталась');
});

test('в «Сравнении» — WhatsApp с названиями сравниваемых объектов', async () => {
  const chat = createChat();
  await chat.press('property:compare:' + VILLA);
  await chat.press('property:compare:' + FLAT);
  const step = await chat.press('compare:view');
  const button = whatsappOf(step.last.markup);
  assert.ok(button, 'кнопка есть');
  const text = textOf(button);
  assert.match(text, /Вилла у моря/);
  assert.match(text, /Квартира в центре/);
});

test('пустое сравнение WhatsApp не предлагает: обсуждать нечего', async () => {
  const chat = createChat();
  const step = await chat.press('compare:view');
  assert.ok(!whatsappOf(step.last.markup));
});

test('пустая выдача фильтра: WhatsApp с тем, что клиент искал', async () => {
  const chat = createChat();
  chat.user.catalogFilter = { city: 'Мадрид', deal: 'sale' };
  const step = await chat.press('catalog:all:0');
  const button = whatsappOf(step.last.markup);
  assert.ok(button, 'кнопка есть на экране «ничего не найдено»');
  assert.match(textOf(button), /Мадрид/, 'в тексте — условия поиска');
});

test('«Похожих нет»: WhatsApp с названием объекта', async () => {
  const chat = createChat();
  const step = await chat.press('property:similar:' + VILLA);
  assert.match(step.last.text, /похожих объектов нет/);
  const button = whatsappOf(step.last.markup);
  assert.ok(button);
  assert.match(textOf(button), /Вилла у моря/);
});

test('текст сообщения — на языке клиента', async () => {
  const chat = createChat({ language: 'en' });
  await chat.press('property:compare:' + VILLA);
  await chat.press('property:compare:' + FLAT);
  const compare = await chat.press('compare:view');
  assert.match(textOf(whatsappOf(compare.last.markup)), /^Hello! I am comparing/);
  const spanish = createChat({ language: 'es' });
  await spanish.press('property:compare:' + VILLA);
  const compareEs = await spanish.press('compare:view');
  assert.match(textOf(whatsappOf(compareEs.last.markup)), /^¡Hola! Estoy comparando/);
});

test('выключен в «Контактах» — кнопки нет нигде, и на карточке объекта тоже', async () => {
  configure({ enabled: false });
  const chat = createChat();
  assert.ok(!whatsappOf((await chat.press('calc:' + VILLA)).last.markup), 'расчёт');
  await chat.press('property:compare:' + VILLA);
  assert.ok(!whatsappOf((await chat.press('compare:view')).last.markup), 'сравнение');
  assert.ok(!whatsappOf((await chat.press('property:similar:' + VILLA)).last.markup), 'похожих нет');
  assert.ok(!whatsappOf((await chat.press('property:manager:' + VILLA)).last.markup), 'экран «Связаться» у объекта — раньше показывал кнопку и при выключенном WhatsApp');
});

test('ни номера, ни WhatsApp — кнопки нет', async () => {
  configure({ whatsapp: '', enabled: true, phone: '' });
  const chat = createChat();
  assert.ok(!whatsappOf((await chat.press('calc:' + VILLA)).last.markup));
});
