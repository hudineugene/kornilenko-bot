'use strict';

// Подсказки к частым вопросам: «где офис», «какие налоги», «кто вы», «пришлите планировку», «сколько стоит» — клиент получает короткий
// ответ с кнопками на готовые экраны, менеджер получает сообщение как обычно; автоответы владельца сильнее подсказок.

const test = require('node:test');
const assert = require('node:assert/strict');
const { callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('flat-01', 'Квартира', 'active'));
  data.contacts = { ...data.contacts, mapUrl: 'https://maps.example.com/office', phone: '+34 600 111 222', managerName: 'Евгений' };
}));
test.after(cleanup);

const urls = (markup) => ((markup && markup.inline_keyboard) || []).flat().map((button) => button.url).filter(Boolean);

test('«где ваш офис?» — контакты и карта кнопками; менеджеру сообщение ушло', async () => {
  const chat = createChat();
  const step = await chat.say('Где ваш офис?');
  assert.match(step.last.text, /Контакты и офис — по кнопкам ниже\. Менеджер тоже получил ваше сообщение\./);
  assert.ok(callbacksOf(step.last.markup).includes('contact:show'));
  assert.deepEqual(urls(step.last.markup), ['https://maps.example.com/office']);
  assert.equal(chat.inquiries.length, 1, 'заявка создана: менеджер видит вопрос');
});

test('налоги, «кто вы», порядок покупки, планировка, цена — каждому своя кнопка', async () => {
  const cases = [
    ['Какие налоги при покупке?', 'guide:page:2', /Налоги, расходы и ипотека/],
    ['А вы застройщик или агентство?', 'nav:about', /Коротко о компании/],
    ['Как купить квартиру, какие документы нужны?', 'guide:page:0', /Порядок покупки/],
    ['Пришлите планировку', 'catalog:all:0', /Планировки и дополнительные материалы пришлёт менеджер/],
    ['Сколько стоит двухкомнатная?', 'catalog:all:0', /Цены указаны в карточках/],
  ];
  for (const [text, callback, pattern] of cases) {
    const chat = createChat();
    const step = await chat.say(text);
    assert.match(step.last.text, pattern, text);
    assert.ok(callbacksOf(step.last.markup).includes(callback), text + ' → ' + callback);
  }
});

test('на английском и испанском — своя подсказка', async () => {
  const english = createChat({ language: 'en' });
  const en = await english.say('What are the taxes and closing costs?');
  assert.match(en.last.text, /Taxes, costs and mortgages/);
  assert.ok(callbacksOf(en.last.markup).includes('guide:page:2'));
  const spanish = createChat({ language: 'es' });
  const es = await spanish.say('¿Dónde está vuestra oficina?');
  assert.match(es.last.text, /Contacto y oficina/);
});

test('одна и та же подсказка не повторяется чаще, чем раз в полчаса; следующие вопросы — по-прежнему менеджеру', async () => {
  const chat = createChat();
  const first = await chat.say('Какие налоги?');
  assert.match(first.last.text, /Налоги, расходы/);
  const again = await chat.say('А ипотеку дают?');
  assert.ok(!/Налоги, расходы/.test((again.last && again.last.text) || ''), 'та же тема — подсказки второй раз нет');
  assert.ok(chat.inquiries[0].messages.length >= 2, 'вопрос всё равно записан в заявку');
  const other = await chat.say('Где ваш офис?');
  assert.match(other.last.text, /Контакты и офис/, 'другая тема — подсказка есть');
});

test('автоответ владельца важнее подсказки; обычная реплика подсказки не вызывает', async () => {
  resetData((data) => {
    data.config.active = true;
    data.rules = [{ id: 'r1', enabled: true, language: 'ru', type: 'contains', trigger: 'офис', answer: 'Наш офис: Финестрат, Carrer Benifato 10', order: 1 }];
  });
  const chat = createChat();
  const step = await chat.say('Где ваш офис?');
  assert.match(step.last.text, /Carrer Benifato 10/);
  assert.ok(!/Контакты и офис/.test(step.last.text));
  const plain = await chat.say('Добрый день, жду ответа');
  assert.ok(!/кнопк/.test((plain.last && plain.last.text) || ''), 'без вопроса из списка подсказки нет');
});

test('кнопка «Контакты» из подсказки открывает экран связи', async () => {
  const chat = createChat();
  await chat.say('Какой у вас телефон?');
  const step = await chat.press('contact:show');
  const text = step.calls.map((call) => String(call.body.text || call.body.caption || '')).join('\n');
  assert.match(text, /Связь с менеджером/);
  assert.match(text, /\+34 600 11 12 22/);
});

test('в уже открытом разговоре подсказки только навигационные: «И ещё вопрос про налоги» остаётся без подсказки, «где офис» — с ней', async () => {
  const chat = createChat();
  await chat.say('Здравствуйте, подскажите по документам');
  const tax = await chat.say('И ещё вопрос про налоги');
  assert.ok(!/Налоги, расходы/.test((tax.last && tax.last.text) || ''));
  const office = await chat.say('А где ваш офис?');
  assert.match(office.last.text, /Контакты и офис/);
});

test('вопрос о цене содержания — не про каталог: подсказка про цены не вызывается', async () => {
  const chat = createChat();
  const step = await chat.say('Сколько стоит содержание квартиры в год?');
  assert.ok(!/Цены указаны в карточках/.test((step.last && step.last.text) || ''));
});
