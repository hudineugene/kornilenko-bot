'use strict';

// «✅ Почему мы» — экран доверия. Его наполняет владелец (цифры, регистрационные
// данные, адрес офиса, отзывы с разрешением авторов); бот ничего не сочиняет. Пока
// не заполнено ни одного пункта, экрана и ведущих к нему кнопок у клиента нет.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const { menu: MENU } = bot.text;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('manager face')]);

let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('trust-villa', 'Вилла', 'active', { propertyType: 'villa', priceValue: 500000 }));
}));

function fill(extra = {}) {
  const data = bot.getData();
  data.trust = bot.normalizeLoadedData({
    version: 44,
    trust: {
      yearsOnMarket: 12, dealsCount: 340, registration: 'Agencia inscrita, Registro de la Propiedad, №1234',
      officeAddress: 'Calle del Mar, 5, Марбелья', reviewsUrl: 'https://reviews.example.com/kornilenko',
      reviews: [
        { name: 'Ханс', country: 'Германия', text: 'Всё прошло спокойно и честно.', allowed: true },
        { name: 'Скрытый', country: 'Франция', text: 'Разрешения нет.', allowed: false },
      ],
      ...extra,
    },
  }).trust;
  data.contacts.mapUrl = 'https://maps.example.com/office';
}

async function login() {
  const data = bot.getData();
  const password = bot.hashPassword('trust-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'trust-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
}

const put = (body) => realFetch(base + '/api/trust', { method: 'PUT', headers, body: JSON.stringify(body) });

test.describe('данные', () => {
  test('по умолчанию пусто; старые данные без блока получают пустой', () => {
    const empty = bot.normalizeLoadedData({});
    assert.deepEqual(empty.trust, { yearsOnMarket: 0, dealsCount: 0, registration: '', officeAddress: '', reviewsUrl: '', reviews: [] });
    assert.deepEqual(bot.normalizeLoadedData({ version: 43 }).trust.reviews, []);
  });

  test('числа, ссылка и отзывы приводятся к порядку; разрешение — только настоящее «да»', () => {
    const { trust } = bot.normalizeLoadedData({
      trust: {
        yearsOnMarket: '12.4', dealsCount: -5, reviewsUrl: 'javascript:alert(1)',
        reviews: [
          { name: 'А', text: 'один', allowed: 'true' },
          { name: 'Б', text: 'два', allowed: true },
          { name: '', text: '' },
          ...Array.from({ length: 8 }, (_, index) => ({ name: 'Имя' + index, text: 'Текст' + index, allowed: true })),
        ],
      },
    });
    assert.equal(trust.yearsOnMarket, 12);
    assert.equal(trust.dealsCount, 0, 'отрицательное число — нет числа');
    assert.equal(trust.reviewsUrl, '', 'чужая схема вместо ссылки отбрасывается');
    assert.equal(trust.reviews.length, 5, 'не больше пяти отзывов');
    assert.equal(trust.reviews[0].allowed, false, 'строка «true» разрешением не является');
    assert.equal(trust.reviews[1].allowed, true);
    assert.ok(trust.reviews.every((review) => review.id), 'у каждого отзыва есть номер');
    assert.equal(new Set(trust.reviews.map((review) => review.id)).size, trust.reviews.length, 'номера разные');
  });

  test('переживает запись на диск', () => {
    fill();
    const again = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
    assert.equal(again.trust.yearsOnMarket, 12);
    assert.equal(again.trust.reviews[0].allowed, true);
  });
});

test.describe('панель: сохранение', () => {
  test.beforeEach(login);

  test('сохраняется и попадает в состояние; без входа и без токена — отказ', async () => {
    const body = { yearsOnMarket: 12, dealsCount: 340, registration: 'Рег. №1', officeAddress: 'Адрес', reviewsUrl: 'https://r.example.com', reviews: [{ name: 'Ханс', country: 'Германия', text: 'Отлично', allowed: true }] };
    assert.equal((await put(body)).status, 200);
    assert.equal(bot.getData().trust.dealsCount, 340);
    const state = await (await realFetch(base + '/api/state', { headers })).json();
    assert.equal(state.trust.reviews[0].name, 'Ханс');

    const noLogin = await realFetch(base + '/api/trust', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(noLogin.status, 401);
    const noToken = await realFetch(base + '/api/trust', { method: 'PUT', headers: { ...headers, 'x-csrf-token': 'bad' }, body: JSON.stringify(body) });
    assert.equal(noToken.status, 403);
  });

  test('ошибки ввода объяснены словами и ничего не портят', async () => {
    fill();
    const before = JSON.stringify(bot.getData().trust);
    assert.equal((await put({ reviewsUrl: 'не-ссылка' })).status, 400);
    assert.equal((await put({ reviews: [{ name: 'Без текста', text: '' }] })).status, 400, 'отзыв без текста');
    assert.equal((await put({ reviews: [{ name: '', text: 'Без имени' }] })).status, 400, 'отзыв без имени');
    assert.equal((await put({ reviews: Array.from({ length: 6 }, (_, index) => ({ name: 'Н' + index, text: 'Т' + index })) })).status, 400, 'шесть отзывов');
    assert.equal((await put({ yearsOnMarket: -3 })).status, 400);
    assert.equal(JSON.stringify(bot.getData().trust), before, 'после отказов данные прежние');
  });

  test('сохранение контактов «Почему мы» не стирает', async () => {
    fill();
    const contacts = await realFetch(base + '/api/contacts', { method: 'PUT', headers, body: JSON.stringify({ managerName: 'Ольга', phone: '+34 600 111 222' }) });
    assert.equal(contacts.status, 200);
    assert.equal(bot.getData().trust.yearsOnMarket, 12);
  });
});

test.describe('у клиента', () => {
  function withPhoto() {
    const data = bot.getData();
    data.contacts.managerName = 'Ольга Корниленко';
    data.contacts.photo = { id: 'mgr', mimeType: 'image/png', name: 'olga.png', size: PNG.length, dataBase64: PNG.toString('base64'), updatedAt: new Date().toISOString() };
  }

  test('пока владелец ничего не вписал: кнопки нет ни на одном экране, а нажатие вхолостую молчит', async () => {
    const chat = createChat();
    for (const label of [MENU.ru.more, MENU.ru.guide, MENU.ru.contacts]) {
      const step = await chat.say(label);
      assert.ok(!callbacksOf(step.last.markup).includes('trust:open'), label);
    }
    const details = await chat.press('property:details:trust-villa');
    const markups = details.calls.map((call) => call.body && call.body.reply_markup).filter(Boolean);
    assert.ok(markups.every((markup) => !callbacksOf(markup).includes('trust:open')), '«Подробнее»');
    telegram.calls = [];
    const pressed = await chat.press('trust:open');
    assert.equal(pressed.calls.filter((call) => call.method === 'sendMessage').length, 0, 'экрана нет — сообщения нет');
  });

  test('одно имя и фото агента экран не создают', async () => {
    withPhoto();
    const step = await createChat().say(MENU.ru.more);
    assert.ok(!callbacksOf(step.last.markup).includes('trust:open'));
  });

  test('заполнено: кнопка есть в «Ещё», в гиде, на «Связаться» и в «Подробнее»', async () => {
    fill();
    const chat = createChat();
    for (const label of [MENU.ru.more, MENU.ru.guide, MENU.ru.contacts]) {
      const step = await chat.say(label);
      assert.ok(callbacksOf(step.last.markup).includes('trust:open'), label);
    }
    const details = await chat.press('property:details:trust-villa');
    const markups = details.calls.map((call) => call.body && call.body.reply_markup).filter(Boolean);
    assert.ok(markups.some((markup) => callbacksOf(markup).includes('trust:open')), '«Подробнее»');
  });

  test('экран: цифры, регистрация, офис и только разрешённые отзывы', async () => {
    fill();
    const chat = createChat();
    const step = await chat.press('trust:open');
    const text = step.last.text;
    assert.match(text, /^✅ Почему мы/);
    assert.match(text, /📆 На рынке: 12 лет/);
    assert.match(text, /🤝 Сделок: 340/);
    assert.match(text, /🏛 Agencia inscrita/);
    assert.match(text, /📍 Офис: Calle del Mar/);
    assert.match(text, /«Всё прошло спокойно и честно\.»\n— Ханс, Германия/);
    assert.ok(!/Разрешения нет|Скрытый/.test(text), 'отзыв без разрешения не показывается');
    const urls = step.last.markup.inline_keyboard.flat().filter((button) => button.url).map((button) => button.url);
    assert.deepEqual(urls, ['https://reviews.example.com/kornilenko', 'https://maps.example.com/office']);
    assert.ok(callbacksOf(step.last.markup).includes('nav:menu'));
  });

  test('склонение «год / года / лет»', async () => {
    for (const [years, word] of [[1, 'год'], [3, 'года'], [11, 'лет'], [21, 'год'], [25, 'лет']]) {
      fill({ yearsOnMarket: years });
      const step = await createChat().press('trust:open');
      assert.match(step.last.text, new RegExp('На рынке: ' + years + ' ' + word + '(\\n|$)'), years + ' → ' + word);
    }
  });

  test('только заполненные строки: без цифр и отзывов остаётся то, что вписано', async () => {
    bot.getData().trust = bot.normalizeLoadedData({ trust: { registration: 'Рег. №7' } }).trust;
    const text = (await createChat().press('trust:open')).last.text;
    assert.match(text, /🏛 Рег\. №7/);
    assert.ok(!/На рынке|Сделок|Отзывы|Офис/.test(text));
  });

  test('отзывы без разрешения не создают экран: разрешён ни один — экрана нет', async () => {
    bot.getData().trust = bot.normalizeLoadedData({ trust: { reviews: [{ name: 'А', text: 'Б', allowed: false }] } }).trust;
    const step = await createChat().say(MENU.ru.more);
    assert.ok(!callbacksOf(step.last.markup).includes('trust:open'));
  });

  test('фото агента над экраном, имя не повторяется в тексте', async () => {
    fill();
    withPhoto();
    const chat = createChat();
    telegram.calls = [];
    const step = await chat.press('trust:open');
    const order = telegram.calls.map((call) => call.method).filter((method) => ['sendPhoto', 'sendMessage'].includes(method));
    assert.deepEqual(order, ['sendPhoto', 'sendMessage']);
    assert.ok(!step.last.text.includes('Ольга Корниленко'));
    assert.equal(chat.user.uiMessageIds.length, 2, 'бот убирает оба сообщения вместе');
  });

  test('на английском и испанском', async () => {
    fill();
    const en = await createChat({ language: 'en' }).press('trust:open');
    assert.match(en.last.text, /^✅ Why choose us/);
    assert.match(en.last.text, /On the market: 12 years/);
    const es = await createChat({ language: 'es' }).press('trust:open');
    assert.match(es.last.text, /^✅ Por qué elegirnos/);
    assert.match(es.last.text, /En el mercado: 12 años/);
  });
});
