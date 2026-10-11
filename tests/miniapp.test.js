'use strict';

// Mini App: проверка подписи Telegram, открытый каталог для гостей, действия клиента (избранное, сравнение, запись, звонок,
// вопрос), выдача фото только видимых объектов и защитные свойства самой страницы.

const realFetch = global.fetch;
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, telegram, TOKEN, ADMIN_CHAT, createChat, property, resetData, cleanup,
} = require('./helpers/chat');

const { validateInitData, signInitData } = require('../src/miniapp/auth.mjs');
const { createMiniAppServer } = require('../src/miniapp/server.mjs');
const { APP_CSS, APP_HTML, APP_JS } = require('../src/miniapp/assets.mjs');

const NOW = Math.floor(Date.now() / 1000);
let server;
let base;

function initDataFor(userId, extra = {}, token = TOKEN) {
  return signInitData({
    auth_date: String(extra.auth_date || NOW),
    query_id: 'AAH-test',
    user: { id: userId, first_name: 'Мария', last_name: 'Тест', language_code: 'ru' },
    ...(extra.start_param ? { start_param: extra.start_param } : {}),
  }, token);
}

async function call(path, { method = 'GET', body, initData, headers = {} } = {}) {
  const response = await realFetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(initData ? { 'x-tg-init-data': initData } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, headers: response.headers, buffer: Buffer.from(text, 'latin1') };
}

function seed() {
  resetData((data) => {
    data.objects = [
      property('villa-marbella-01', 'Вилла в Марбелье', 'active', { priceValue: 450000, currency: 'EUR', bedrooms: 3, area: 140 }),
      property('flat-benidorm-02', 'Квартира в Бенидорме', 'active', { priceValue: 180000, currency: 'EUR' }),
      property('flat-reserved-03', 'Квартира в резерве', 'reserved', { priceValue: 200000, currency: 'EUR' }),
      property('flat-extra-0005', 'Ещё квартира', 'active', { priceValue: 150000, currency: 'EUR' }),
      property('flat-draft-004', 'Черновик', 'draft', { priceValue: 100000, currency: 'EUR' }),
    ];
    data.contacts = { ...(data.contacts || {}), phone: '+34 600 123 456', telegram: '@kornilenko_test' };
  });
}

test.before(async () => {
  seed();
  server = createMiniAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  server.close();
  server.closeAllConnections && server.closeAllConnections();
  cleanup();
});

test('подпись Telegram: верная принимается, подделка, чужой токен и устаревшие данные — нет', () => {
  const good = validateInitData(initDataFor(777), TOKEN);
  assert.equal(good.ok, true);
  assert.equal(good.user.id, 777);
  assert.equal(good.user.first_name, 'Мария');

  const params = new URLSearchParams(initDataFor(777));
  params.set('user', JSON.stringify({ id: 888, first_name: 'Чужой' }));
  assert.equal(validateInitData(params.toString(), TOKEN).reason, 'bad-signature');

  assert.equal(validateInitData(initDataFor(777), '999:OTHER_TOKEN_VALUE').ok, false);
  assert.equal(validateInitData(initDataFor(777, { auth_date: NOW - 3 * 86400 }), TOKEN).reason, 'expired');
  assert.equal(validateInitData(initDataFor(777, { auth_date: NOW + 3600 }), TOKEN).reason, 'from-future');
  assert.equal(validateInitData('', TOKEN).ok, false);
  assert.equal(validateInitData('hash=zzz', TOKEN).ok, false);
  assert.equal(validateInitData(initDataFor(777), '').ok, false);
});

test('гость видит каталог без скрытых объектов, но ничего не записывает', async () => {
  const boot = await call('/api/app/bootstrap?lang=ru');
  assert.equal(boot.status, 200);
  assert.equal(boot.json.guest, true);
  const ids = boot.json.cards.map((card) => card.id).sort();
  assert.deepEqual(ids, ['flat-benidorm-02', 'flat-extra-0005', 'flat-reserved-03', 'villa-marbella-01']);
  assert.ok(boot.json.cards.every((card) => card.cover.startsWith('/m/')));
  assert.equal(boot.json.facets.maxBedrooms >= 3, true);
  assert.equal(boot.json.company.name, 'Construcciones Kornilenko');

  const write = await call('/api/app/favorite', { method: 'POST', body: { id: 'villa-marbella-01', on: true } });
  assert.equal(write.status, 401);

  const forged = await call('/api/app/favorite', { method: 'POST', body: { id: 'villa-marbella-01', on: true }, initData: initDataFor(4242, {}, '1:WRONG_TOKEN_XXXX') });
  assert.equal(forged.status, 401);
});

test('карточка объекта и фото: свои объекты отдаются, черновик и чужой номер — нет', async () => {
  const detail = await call('/api/app/property/villa-marbella-01?lang=ru');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.title, 'Вилла в Марбелье');
  assert.equal(detail.json.images.length >= 1, true);
  assert.match(detail.json.shareUrl, /^https:\/\/t\.me\/share\/url\?url=/);

  const photo = await call(detail.json.images[0]);
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get('content-type'), /^image\//);

  assert.equal((await call('/api/app/property/flat-draft-004')).status, 404);
  assert.equal((await call('/m/flat-draft-004/flat-draft-004-ru')).status, 404);
  assert.equal((await call('/m/villa-marbella-01/no-such-image')).status, 404);
  assert.equal((await call('/api/app/property/unknown')).status, 404);
});

test('избранное и сравнение сохраняются у клиента; сравнить можно не больше трёх', async () => {
  const initData = initDataFor(5551);
  const fav = await call('/api/app/favorite', { method: 'POST', body: { id: 'villa-marbella-01', on: true }, initData });
  assert.equal(fav.status, 200);
  assert.deepEqual(fav.json.favorites, ['villa-marbella-01']);
  assert.deepEqual(bot.userById('5551').favorites, ['villa-marbella-01']);
  assert.equal(bot.userById('5551').source, 'app');

  const boot = await call('/api/app/bootstrap?lang=ru', { initData });
  assert.equal(boot.json.guest, false);
  assert.deepEqual(boot.json.favorites, ['villa-marbella-01']);

  assert.equal((await call('/api/app/favorite', { method: 'POST', body: { id: 'villa-marbella-01', on: false }, initData })).json.favorites.length, 0);
  assert.equal((await call('/api/app/favorite', { method: 'POST', body: { id: 'flat-draft-004', on: true }, initData })).status, 404);

  for (const id of ['villa-marbella-01', 'flat-benidorm-02', 'flat-reserved-03']) {
    assert.equal((await call('/api/app/compare', { method: 'POST', body: { id, on: true }, initData })).status, 200);
  }
  const fourth = await call('/api/app/compare', { method: 'POST', body: { id: 'flat-extra-0005', on: true }, initData });
  assert.equal(fourth.status, 409);
  assert.equal(bot.userById('5551').comparisonIds.length, 3);
  const removed = await call('/api/app/compare', { method: 'POST', body: { id: 'villa-marbella-01', on: false }, initData });
  assert.equal(removed.json.compare.length, 2);
});

test('запись на просмотр заводит заявку как в боте и подтверждает клиенту в чат', async () => {
  const initData = initDataFor(5552);
  const day = new Date();
  day.setDate(day.getDate() + 3);
  const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');

  const options = await call('/api/app/viewing-options?lang=ru', { initData });
  assert.equal(options.status, 200);
  assert.ok(options.json.days.length > 0);

  const noPhone = await call('/api/app/viewing', { method: 'POST', initData, body: { propertyId: 'villa-marbella-01', day: key, time: 'morning', name: 'Мария' } });
  assert.equal(noPhone.status, 400);

  const reserved = await call('/api/app/viewing', { method: 'POST', initData, body: { propertyId: 'flat-reserved-03', day: key, time: 'morning', phone: '+34 600 111 222' } });
  assert.equal(reserved.status, 409);

  const before = telegram.calls.length;
  const ok = await call('/api/app/viewing', { method: 'POST', initData, body: { propertyId: 'villa-marbella-01', day: key, time: 'morning', name: 'Мария', phone: '+34 600 111 222', online: false } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.ok, true);
  const inquiry = bot.getData().inquiries.find((item) => item.userId === '5552' && item.type === 'viewing');
  assert.ok(inquiry, 'заявка на просмотр создана');
  assert.match(inquiry.text, /Из приложения/);
  assert.equal(inquiry.propertyId, 'villa-marbella-01');
  const sent = telegram.calls.slice(before).filter((item) => item.method === 'sendMessage');
  assert.ok(sent.some((item) => String(item.body.chat_id) === '5552'), 'клиенту ушло подтверждение');
  assert.ok(sent.some((item) => String(item.body.chat_id) === ADMIN_CHAT), 'менеджеру ушла карточка заявки');

  const badDay = await call('/api/app/viewing', { method: 'POST', initData, body: { propertyId: 'villa-marbella-01', day: '2001-01-01', time: 'morning', phone: '+34 600 111 222' } });
  assert.equal(badDay.status, 400);
});

test('звонок и вопрос: заявки, проверка телефона и текста', async () => {
  const initData = initDataFor(5553);
  assert.equal((await call('/api/app/call', { method: 'POST', initData, body: { name: 'Игорь' } })).status, 400);
  const lead = await call('/api/app/call', { method: 'POST', initData, body: { name: 'Игорь', phone: '+34 611 222 333', time: 'после 18:00', propertyId: 'flat-benidorm-02' } });
  assert.equal(lead.status, 200, lead.text);
  assert.ok(bot.getData().inquiries.some((item) => item.userId === '5553' && item.type === 'lead'));

  assert.equal((await call('/api/app/question', { method: 'POST', initData, body: { text: ' ' } })).status, 400);
  const question = await call('/api/app/question', { method: 'POST', initData, body: { text: 'Есть ли рассрочка?', propertyId: 'villa-marbella-01' } });
  assert.equal(question.status, 200);
  assert.ok(bot.getData().inquiries.some((item) => item.userId === '5553' && item.type === 'question' && /рассрочка/.test(item.text)));
});

test('страница: заголовки защиты, нет опасных конструкций, нужные файлы отдаются', async () => {
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self' https:\/\/telegram\.org/);
  assert.match(page.headers.get('content-security-policy'), /style-src 'self'(;|$)/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(APP_HTML, /<script(?![^>]*\bsrc=)/i, 'в разметке нет встроенных скриптов');
  assert.doesNotMatch(APP_HTML, /\sstyle=|\son\w+=/i);
  assert.doesNotThrow(() => new vm.Script(APP_JS), 'сценарий приложения разбирается без ошибок');
  assert.doesNotMatch(APP_JS, /\beval\(|new Function|document\.write|insertAdjacentHTML|outerHTML/);
  assert.equal((APP_JS.match(/innerHTML/g) || []).length, 1, 'innerHTML только для собственных значков');
  assert.doesNotMatch(APP_CSS, /@import|url\(https?:/);
  for (const path of ['/app.js', '/app.css', '/logo.png', '/icon.png', '/hero.jpg', '/grid.svg', '/art/coastal.jpg', '/art/pool.jpg', '/fonts/inter-latin.woff2', '/fonts/inter-cyrillic.woff2']) {
    const file = await call(path);
    assert.equal(file.status, 200, path);
  }
  assert.equal((await call('/api/app/health')).json.ok, true);
  assert.equal((await call('/health')).json.ok, true, 'проверка живости для прокси сервера');
  assert.equal((await call('/panel-secret')).status, 404);
  const post = await call('/', { method: 'POST', body: {} });
  assert.equal(post.status, 405);
});

test('оформление по набору элементов: цвета, логотип целиком, четыре вкладки, главная и профиль', () => {
  assert.match(APP_CSS, /--red:#ef3655/);
  assert.match(APP_CSS, /--yellow:#ffcc22/);
  assert.match(APP_CSS, /--cyan:#06b6c8/);
  assert.match(APP_CSS, /--bg:#f8fafb/);
  assert.match(APP_CSS, /\.logo\{[^}]*object-fit:contain/, 'логотип не обрезается');
  assert.doesNotMatch(APP_CSS, /\.logo\{[^}]*overflow:hidden/);
  assert.match(APP_CSS, /\.hero\{/);
  assert.match(APP_CSS, /\.status-card/);
  assert.match(APP_JS, /src: '\/logo\.png', alt: company\.name/);
  assert.match(APP_JS, /src: '\/hero\.jpg'/);
  assert.match(APP_JS, /function searchKey\(value\)/);
  assert.match(APP_JS, /function renderLanding\(view\)/);
  assert.match(APP_JS, /function renderProfile\(view\)/);
  for (const tab of ["tabButton('home'", "tabButton('objects'", "tabButton('fav'", "tabButton('profile'"]) assert.ok(APP_JS.includes(tab), tab);
  assert.match(APP_JS, /api\('\/me\?lang='/);
});

test('адрес приложения: только https и обычное имя сайта', () => {
  const { normalizeMiniAppUrl, miniAppSettings } = require('../src/miniapp/settings.mjs');
  assert.equal(normalizeMiniAppUrl('https://app.example.com/'), 'https://app.example.com');
  assert.equal(normalizeMiniAppUrl(' https://app.example.com/catalog/ '), 'https://app.example.com/catalog');
  for (const bad of ['http://app.example.com', 'https://127.0.0.1', 'https://localhost', 'https://user:pass@app.example.com', 'ftp://app.example.com', 'app.example.com', '', 'https://intranet']) {
    assert.equal(normalizeMiniAppUrl(bad), '', bad);
  }
  bot.getData().config.miniApp = { enabled: true, url: '' };
  assert.equal(miniAppSettings().enabled, false, 'без адреса включить нельзя');
});

test('кнопка приложения в чате: ставится на языке клиента один раз', async () => {
  const { chat } = (() => ({ chat: createChat({ language: 'es', firstName: 'Лука' }) }))();
  bot.getData().config.miniApp = { enabled: true, url: 'https://app.example.com' };
  const before = telegram.calls.length;
  await chat.say('/start');
  const buttons = telegram.calls.slice(before).filter((call) => call.method === 'setChatMenuButton');
  assert.equal(buttons.length, 1);
  assert.equal(String(buttons[0].body.chat_id), String(chat.id));
  assert.equal(buttons[0].body.menu_button.type, 'web_app');
  assert.equal(buttons[0].body.menu_button.web_app.url, 'https://app.example.com');
  assert.match(buttons[0].body.menu_button.text, /Catálogo/);
  const again = telegram.calls.length;
  await chat.say('/start');
  assert.equal(telegram.calls.slice(again).filter((call) => call.method === 'setChatMenuButton').length, 0);
  bot.getData().config.miniApp = { enabled: false, url: '' };
});

test('на порту панели по адресу приложения отвечает только приложение', async () => {
  const http = require('node:http');
  seed();
  bot.getData().config.miniApp = { enabled: true, url: 'https://app.example.com' };
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  const port = bot.server.address().port;
  const ask = (host, path, method = 'GET') => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, headers: { host } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
    });
    request.on('error', reject);
    request.end();
  });
  try {
    const page = await ask('app.example.com', '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /telegram-web-app\.js/);
    const api = await ask('app.example.com', '/api/app/bootstrap?lang=ru');
    assert.equal(api.status, 200);
    assert.equal(JSON.parse(api.body).company.name, 'Construcciones Kornilenko');
    // Ни одного маршрута панели по адресу приложения.
    for (const path of ['/api/state', '/api/session', '/api/login']) {
      assert.equal((await ask('app.example.com', path)).status, 404, path);
    }
    // Этот же порт по адресу панели отдаёт панель, а не приложение.
    const panel = await ask('127.0.0.1:' + port, '/');
    assert.equal(panel.status, 200);
    assert.doesNotMatch(panel.body, /telegram-web-app\.js/);
    // Выключенное приложение по своему адресу ничего не отдаёт.
    bot.getData().config.miniApp = { enabled: false, url: 'https://app.example.com' };
    assert.notEqual((await ask('app.example.com', '/api/app/bootstrap')).status, 200);
  } finally {
    bot.getData().config.miniApp = { enabled: false, url: '' };
  }
});

test('после проверки: скрытые объекты не мешают лимиту, окна без свободного времени не тупик, телефон обновляется', async () => {
  seed();
  const initData = initDataFor(5560);
  // В сравнении лежат два объекта, которых клиент уже не видит.
  const user = bot.userById('5560') || (await call('/api/app/favorite', { method: 'POST', body: { id: 'villa-marbella-01', on: true }, initData }), bot.userById('5560'));
  user.comparisonIds = ['hidden-1', 'hidden-2', 'villa-marbella-01'];
  const added = await call('/api/app/compare', { method: 'POST', body: { id: 'flat-benidorm-02', on: true }, initData });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.json.compare.sort(), ['flat-benidorm-02', 'villa-marbella-01']);

  // Окна включены, но свободных нет: приложение предлагает день и время суток, как бот.
  bot.getData().config.viewingSlots = { enabled: true, days: [], times: ['10:00'], daysAhead: 7, perSlot: 1 };
  const options = await call('/api/app/viewing-options?lang=ru', { initData });
  assert.equal(options.json.mode, 'free');
  bot.getData().config.viewingSlots = { enabled: false, days: [], times: [], daysAhead: 7, perSlot: 1 };

  // Телефон и имя из формы заменяют прежние; плохая дата отклоняется с кодом.
  user.phone = '+34 600 000 000';
  user.contactName = 'Старое имя';
  const day = new Date();
  day.setDate(day.getDate() + 2);
  const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
  const bad = await call('/api/app/viewing', { method: 'POST', initData, body: { propertyId: 'villa-marbella-01', day: day.getFullYear() + '-02-31', time: 'morning', phone: '+34 611 999 888' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'pick-day');
  const ok = await call('/api/app/viewing', { method: 'POST', initData, body: { propertyId: 'villa-marbella-01', day: key, time: 'evening', name: 'Новое имя', phone: '+34 611 999 888', lang: 'en' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(bot.userById('5560').phone.replace(/\s/g, ''), '+34611999888');
  assert.equal(bot.userById('5560').contactName, 'Новое имя');
  const inquiry = bot.getData().inquiries.find((item) => item.userId === '5560' && item.type === 'viewing');
  assert.match(inquiry.text, /611/);
});

test('язык приложения идёт в действия; коды ошибок; счётчики; клиент бота не становится «приложением»', async () => {
  seed();
  const chat = createChat({ language: 'ru', firstName: 'Давний' });
  const initData = initDataFor(chat.id);
  // Объект готов только на английском: клиент с русским ботом, открывший приложение на EN, всё равно может его сохранить.
  bot.getData().objects.push(property('flat-english-only', 'Only English', 'active', {
    title: { ru: '', en: 'Only English', es: '' }, description: { ru: '', en: 'A short description.', es: '' },
    city: { ru: '', en: 'Benidorm', es: '' }, priceValue: 120000, currency: 'EUR',
  }));
  const ru = await call('/api/app/favorite', { method: 'POST', initData, body: { id: 'flat-english-only', on: true } });
  assert.equal(ru.status, 404);
  assert.equal(ru.json.code, 'unavailable');
  const en = await call('/api/app/favorite', { method: 'POST', initData, body: { id: 'flat-english-only', on: true, lang: 'en' } });
  assert.equal(en.status, 200, en.text);
  assert.equal(bot.userById(String(chat.id)).source || '', '');

  const noText = await call('/api/app/question', { method: 'POST', initData, body: { text: ' ' } });
  assert.equal(noText.json.code, 'question-short');
  const noPhone = await call('/api/app/call', { method: 'POST', initData: initDataFor(5561), body: { name: 'Нет телефона' } });
  assert.equal(noPhone.json.code, 'phone-required');

  // Открытие карточки и просмотр галереи попадают в статистику объекта.
  await call('/api/app/property/villa-marbella-01?lang=ru', { initData });
  const track = await call('/api/app/track', { method: 'POST', initData, body: { id: 'villa-marbella-01', event: 'galleries' } });
  assert.equal(track.status, 200);
  const stats = bot.getData().analytics.properties['villa-marbella-01'];
  assert.ok(stats.details >= 1);
  assert.ok(stats.galleries >= 1);
  assert.equal((await call('/api/app/track', { method: 'POST', initData, body: { id: 'villa-marbella-01', event: 'favorites' } })).status, 200);

  // Битый адрес — 404, а не ошибка сервера.
  assert.equal((await call('/m/%E0%A4%A/x')).status, 404);
  assert.equal((await call('/api/app/property/%E0%A4%A')).status, 404);
});

test('выключили приложение: у клиентов снимается своя кнопка', async () => {
  const { resetChatMenuButtons } = require('../src/miniapp/menu-button.mjs');
  seed();
  const chat = createChat({ language: 'en', firstName: 'Кнопка' });
  bot.getData().config.miniApp = { enabled: true, url: 'https://app.example.com' };
  await chat.say('/start');
  assert.ok(bot.userById(String(chat.id)).menuButtonKey);
  bot.getData().config.miniApp = { enabled: false, url: '' };
  const before = telegram.calls.length;
  await resetChatMenuButtons(TOKEN);
  const calls = telegram.calls.slice(before).filter((call) => call.method === 'setChatMenuButton' && String(call.body.chat_id) === String(chat.id));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.menu_button.type, 'default');
  assert.equal(bot.userById(String(chat.id)).menuButtonKey, '');
});
