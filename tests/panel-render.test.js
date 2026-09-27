'use strict';

// Панель — 340 КБ кода в браузере, и синтаксической проверки мало: ошибка вида
// «переменная не объявлена» видна только когда код работает. Здесь каждый
// экран панели действительно отрисовывается на простой заглушке браузера.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bot, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

// --- Заглушка браузера -------------------------------------------------------
// Умеет ровно то, что нужно отрисовке: собрать разметку строкой, найти в ней
// элемент, повесить обработчик. Списки возвращает пустыми.
function fakeElement(tag = 'div') {
  // Один и тот же селектор должен возвращать один и тот же элемент: иначе
  // назначенный обработчик тут же терялся бы, и проверить нажатие было нельзя.
  const found = new Map();
  const classes = new Set();
  const node = {
    tagName: String(tag).toUpperCase(),
    innerHTML: '',
    outerHTML: '',
    textContent: '',
    // Непустое значение: иначе ветки «если поле заполнено» никогда не выполнятся
    // и ошибка внутри них останется незамеченной.
    value: '1',
    checked: false,
    disabled: false,
    hidden: false,
    open: false,
    files: [],
    children: [],
    attributes: [],
    dataset: {},
    style: {},
    // Классы запоминаем по-настоящему: панель прячет и показывает экраны
    // именно классом hidden, и проверить это иначе нельзя.
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      contains(name) { return classes.has(name); },
    },
    querySelector: (selector) => {
      const key = String(selector);
      if (!found.has(key)) found.set(key, fakeElement());
      return found.get(key);
    },
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    closest: () => fakeElement(),
    contains: () => false,
    appendChild(child) { node.children.push(child); return child; },
    append() {}, prepend() {}, remove() {}, insertAdjacentHTML() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, showModal() {}, close() {}, submit() {}, reset() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100 }),
    setSelectionRange() {},
    selectionStart: 0,
    selectionEnd: 0,
    parentElement: null,
    parentNode: null,
    firstChild: null,
    lastChild: null,
    nextElementSibling: null,
    previousElementSibling: null,
    offsetWidth: 100,
    offsetHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
  };
  return node;
}

function fakeDocument() {
  const body = fakeElement('body');
  const byId = new Map();
  const bySelector = new Map();
  // Открытые диалоги считаем по-настоящему: панель спрашивает
  // document.querySelector('dialog[open]') перед обновлением экрана.
  const openDialogs = new Set();
  const makeDialog = () => {
    const dialog = fakeElement('dialog');
    dialog.showModal = () => { dialog.open = true; openDialogs.add(dialog); };
    dialog.close = () => { dialog.open = false; openDialogs.delete(dialog); };
    dialog.remove = () => { openDialogs.delete(dialog); };
    return dialog;
  };
  return {
    body,
    documentElement: fakeElement('html'),
    head: fakeElement('head'),
    readyState: 'complete',
    getElementById: (id) => {
      if (!byId.has(String(id))) byId.set(String(id), fakeElement());
      return byId.get(String(id));
    },
    querySelector: (selector) => {
      const key = String(selector);
      if (key === 'dialog[open]') return openDialogs.size ? Array.from(openDialogs)[0] : null;
      if (!bySelector.has(key)) bySelector.set(key, fakeElement());
      return bySelector.get(key);
    },
    querySelectorAll: () => [],
    createElement: (tag) => (String(tag).toLowerCase() === 'dialog' ? makeDialog() : fakeElement(tag)),
    createDocumentFragment: () => fakeElement('fragment'),
    createTextNode: () => fakeElement('text'),
    addEventListener() {}, removeEventListener() {},
    execCommand() { return true; },
    activeElement: body,
    hidden: false,
  };
}

// Ответы сервера, которые панель ждёт при загрузке.
function fakeFetch(state, texts, requests = []) {
  return async (url, options) => {
    const path = String(url);
    let body = null;
    try { body = options && options.body ? JSON.parse(options.body) : null; } catch { body = String(options.body); }
    requests.push({
      url: path,
      method: (options && options.method) || 'GET',
      body,
      raw: options ? options.body : null,
      headers: (options && options.headers) || {},
    });
    const answer = (payload) => ({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
      headers: { get: () => '' },
    });
    if (path.includes('/api/status')) return answer({ configured: true, botName: 'Test' });
    if (path.includes('/api/state')) {
      const since = (path.split('since=')[1] || '').split('&')[0];
      if (since && since === state.stateVersion) return answer({ unchanged: true, stateVersion: state.stateVersion });
      return answer(state);
    }
    if (path.includes('/api/interface-text')) return answer({ interfaceText: texts });
    if (path.includes('/api/autostart')) return answer({ supported: false, enabled: false });
    return answer({ ok: true });
  };
}

async function panelSandbox() {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const { safeState } = await import('../src/admin-http.mjs');
  const { normalizedInterfaceText } = await import('../src/texts.mjs');
  const script = PANEL_HTML.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

  const state = safeState({ csrf: 'test-csrf' });
  // Отпечаток данных: панель присылает его в ?since= и получает «не изменилось».
  state.stateVersion = 'version-1';
  const texts = normalizedInterfaceText(bot.getData().interfaceText);
  const errors = [];
  const requests = [];
  const sandbox = {
    console: { log() {}, warn() {}, error(...args) { errors.push(String(args[0])); } },
    document: fakeDocument(),
    location: { hash: '', href: 'http://localhost/', pathname: '/', search: '', reload() {}, assign() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test', clipboard: { writeText: async () => {} } },
    fetch: fakeFetch(state, texts, requests),
    setTimeout,
    clearTimeout,
    // Запоминаем повторяющиеся таймеры: тест сам вызывает их, как это сделал бы
    // браузер через 45 секунд.
    setInterval: (fn, ms) => { sandbox.__timers.push({ fn, ms }); return sandbox.__timers.length; },
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    Intl, URL, URLSearchParams, Blob, FormData, Promise, JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error, Map, Set, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, btoa, atob,
    // Браузерные escape/unescape работают с процентными последовательностями
    // побайтно: подмена на decodeURIComponent ломала бы кодирование пароля.
    escape: (value) => String(value).replace(/[^A-Za-z0-9@*_+\-./]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')),
    unescape: (value) => String(value).replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16))),
    FileReader: class { readAsDataURL() {} readAsText() {} },
    alert() {}, confirm: () => true, prompt: () => '',
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    scrollTo(...args) { sandbox.__scrolls.push(args); }, open: () => null, print() {},
    innerWidth: 1280, innerHeight: 800,
  };
  sandbox.__scrolls = [];
  sandbox.__timers = [];
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  new vm.Script(script, { filename: 'panel.js' }).runInContext(context);
  // Загрузка панели асинхронная: даём ей закончить.
  await new Promise((resolve) => setTimeout(resolve, 60));
  sandbox.state = state;
  sandbox.csrf = 'test-csrf';
  // Диалоги подтверждения в заглушке никто не нажмёт, поэтому отвечаем «да»,
  // а на просьбу ввести пароль — известным паролем.
  sandbox.confirmDialog = async () => true;
  sandbox.askPassword = async () => 'пароль-панели';
  return { sandbox, errors, state, requests };
}

test('каждый экран панели рисуется без ошибок', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('flat-01', 'Квартира у моря', 'active', { priceValue: 250000, currency: 'EUR' }));
    data.objects.push(property('villa-02', 'Вилла с бассейном', 'reserved', { priceValue: 900000, currency: 'EUR', propertyType: 'villa' }));
    data.promotions.push({ id: 'promo-1', title: { ru: 'Скидка недели' }, description: { ru: 'Три объекта со скидкой' }, enabled: true });
    data.users['700001'] = { id: '700001', chatId: 700001, firstName: 'Анна', preferredLanguage: 'ru', activity: [], lastSeenAt: new Date().toISOString() };
    data.inquiries.push({
      id: 'inq-1', userId: '700001', chatId: '700001', language: 'ru', type: 'general',
      text: 'Есть ли парковка?', status: 'new', pipelineStage: 'new', replies: [], messages: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(),
    });
    data.errors.push({ id: 'err-1', area: 'Связь с Telegram', message: 'Telegram не ответил вовремя', createdAt: new Date().toISOString() });
  });

  const { sandbox, errors } = await panelSandbox();
  assert.ok(sandbox.VIEWS, 'скрипт панели объявляет разделы');

  const screens = [];
  for (const item of sandbox.navItems()) {
    const tabs = Array.isArray(item.tabs) && item.tabs.length ? item.tabs.map((tab) => tab.id || tab[0] || '') : [''];
    for (const tab of tabs) screens.push([item.id, tab]);
  }
  assert.ok(screens.length >= 8, 'разделов и подразделов должно быть много, нашлось ' + screens.length);

  const broken = [];
  for (const [view, tab] of screens) {
    const host = fakeElement('main');
    try {
      await sandbox.VIEWS[view].render(host, tab);
      if (!String(host.innerHTML).length) broken.push(view + '/' + tab + ': пусто');
    } catch (error) {
      broken.push(view + '/' + tab + ': ' + error.message);
    }
  }
  assert.deepEqual(broken, [], 'экраны с ошибками');

  // Диалоги — отдельная половина панели: редактор объекта, обращение, клиент,
  // шаблоны, рассылка, правило автоответа. Внутри них тоже работает код.
  const object = (sandbox.state.objects || [])[0] || {};
  const promotion = (sandbox.state.promotions || [])[0] || {};
  const inquiry = (sandbox.state.inquiries || [])[0] || {};
  const dialogs = [
    ['редактор объекта', () => sandbox.openRecordEditor('objects', object.id)],
    ['новый объект', () => sandbox.openRecordEditor('objects', null)],
    ['редактор акции', () => sandbox.openRecordEditor('promotions', promotion.id)],
    ['обращение', () => sandbox.openInquiry(inquiry.id)],
    ['карточка клиента', () => sandbox.openClient(inquiry.userId)],
    ['шаблоны ответов', () => sandbox.openTemplates()],
    ['очистка обращений', () => sandbox.openCleanup()],
    ['напоминание по задаче', () => sandbox.openTaskSchedule(inquiry)],
    ['рассылка', () => sandbox.openCampaignEditor(null)],
    ['правило автоответа', () => sandbox.openRuleEditor(null)],
  ];
  const brokenDialogs = [];
  for (const [name, open] of dialogs) {
    if (typeof open !== 'function') continue;
    try {
      await open();
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      brokenDialogs.push(name + ': ' + error.message);
    }
  }
  assert.deepEqual(brokenDialogs, [], 'диалоги с ошибками');
  assert.deepEqual(errors.filter((line) => /ReferenceError|TypeError|not defined/.test(line)), [], 'ошибок в консоли нет');
});

test('смена токена бота действительно отправляет токен и пароль', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.settings.render(host, '');

  const button = host.querySelector('#saveToken');
  assert.equal(typeof button.onclick, 'function', 'на экране есть кнопка смены токена');
  host.querySelector('#setToken').value = '123456789:AAHnewTokenForTheBotAAAAAAAAAAAAAAA';
  host.querySelector('#setTokenPass').value = 'пароль-панели';
  requests.length = 0;
  await button.onclick.call(button);

  const sent = requests.filter((request) => request.url.includes('/api/settings') && request.method === 'PUT');
  assert.equal(sent.length, 1, 'запрос ушёл на сервер');
  assert.equal(sent[0].body.token, '123456789:AAHnewTokenForTheBotAAAAAAAAAAAAAAA', 'токен передан');
  assert.equal(sent[0].body.currentPassword, 'пароль-панели', 'текущий пароль передан — сервер без него откажет');
});

test('без токена или пароля запрос не уходит', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.settings.render(host, '');
  const button = host.querySelector('#saveToken');

  host.querySelector('#setToken').value = '';
  host.querySelector('#setTokenPass').value = 'пароль-панели';
  requests.length = 0;
  await button.onclick.call(button);
  assert.deepEqual(requests.filter((request) => request.url.includes('/api/settings')), [], 'пустой токен не отправляется');

  host.querySelector('#setToken').value = '123456789:AAHnewTokenForTheBotAAAAAAAAAAAAAAA';
  host.querySelector('#setTokenPass').value = '';
  requests.length = 0;
  await button.onclick.call(button);
  assert.deepEqual(requests.filter((request) => request.url.includes('/api/settings')), [], 'без пароля запрос не уходит');
});

test.describe('восстановление копии из панели', () => {
  // Копия .json.gz и .kbk двоичные: чтение текстом их портит, поэтому файл
  // должен уходить как есть.
  function pickFile(sandbox, host, name, bytes) {
    const input = host.querySelector('#restoreFile');
    const file = new Blob([bytes]);
    file.name = name;
    input.files = [file];
    return input.onchange({ target: input });
  }

  test('файл уходит байтами, а не текстом', async () => {
    resetData((data) => { data.config.active = true; });
    const { sandbox, requests } = await panelSandbox();
    const host = fakeElement('main');
    await sandbox.VIEWS.settings.render(host, 'data');
    const input = host.querySelector('#restoreFile');
    assert.equal(typeof input.onchange, 'function', 'выбор файла подключён');

    requests.length = 0;
    const gzipBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]);
    await pickFile(sandbox, host, 'telegram-bot-backup-2026-09-27.json.gz', gzipBytes);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const sent = requests.find((request) => request.url.includes('/api/restore'));
    assert.ok(sent, 'запрос на восстановление ушёл');
    assert.equal(typeof sent.raw, 'object', 'тело запроса — файл, а не строка');
    assert.ok(typeof sent.raw.arrayBuffer === 'function', 'отправлен сам файл');
    assert.equal(sent.headers['content-type'], 'application/octet-stream');
    assert.ok(sent.headers['x-current-password'], 'вместе с файлом уходит текущий пароль панели');
  });

  test('для зашифрованной копии спрашивается пароль и уходит в заголовке', async () => {
    resetData((data) => { data.config.active = true; });
    const { sandbox, requests } = await panelSandbox();
    sandbox.prompt = () => 'пароль-копии';
    const host = fakeElement('main');
    await sandbox.VIEWS.settings.render(host, 'data');

    requests.length = 0;
    await pickFile(sandbox, host, 'bot-backup.kbk', Buffer.from('KBK1зашифровано'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const sent = requests.find((request) => request.url.includes('/api/restore'));
    assert.ok(sent, 'запрос ушёл');
    assert.ok(sent.headers['x-backup-password'], 'пароль передан отдельным заголовком');
    assert.equal(Buffer.from(sent.headers['x-backup-password'], 'base64').toString('utf8'), 'пароль-копии');
  });

  test('без пароля зашифрованная копия не отправляется', async () => {
    resetData((data) => { data.config.active = true; });
    const { sandbox, requests } = await panelSandbox();
    sandbox.prompt = () => '';
    const host = fakeElement('main');
    await sandbox.VIEWS.settings.render(host, 'data');

    requests.length = 0;
    await pickFile(sandbox, host, 'bot-backup.kbk', Buffer.from('KBK1зашифровано'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(requests.filter((request) => request.url.includes('/api/restore')), []);
  });

  test('в выборе файла видны все три вида копии', async () => {
    const { PANEL_HTML } = await import('../src/panel/index.mjs');
    const script = PANEL_HTML.slice(PANEL_HTML.indexOf('<script'));
    const accept = script.match(/id="restoreFile" accept="([^"]+)"/);
    assert.ok(accept, 'поле выбора файла на месте');
    for (const kind of ['.json', '.gz', '.kbk']) {
      assert.ok(accept[1].includes(kind), 'в выборе файла нет ' + kind);
    }
  });
});

test.describe('автообновление панели раз в 45 секунд', () => {
  // Панель ставит таймер на 45 секунд; берём именно его, чтобы проверять то,
  // что происходит в работе, а не отдельную функцию.
  function tick(sandbox) {
    const timer = sandbox.__timers.find((entry) => entry.ms === 45000);
    assert.ok(timer, 'таймер обновления поставлен');
    return timer.fn();
  }

  async function screen(view) {
    resetData((data) => { data.config.active = true; });
    const ready = await panelSandbox();
    ready.sandbox.currentView = view;
    ready.sandbox.renderView();
    const page = ready.sandbox.document.getElementById('page');
    page.innerHTML = 'ЧЕРНОВИК НА ЭКРАНЕ';
    ready.requests.length = 0;
    ready.sandbox.__scrolls.length = 0;
    return { ...ready, page };
  }

  test('когда ничего не изменилось, экран не перерисовывается', async () => {
    const { sandbox, requests, page } = await screen('settings');
    sandbox.stateVersion = 'version-1';

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const asked = requests.find((request) => request.url.includes('/api/state'));
    assert.ok(asked, 'панель спросила сервер');
    assert.match(asked.url, /since=version-1/, 'спрашивает с отпечатком данных');
    assert.equal(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'страница не перерисована');
    assert.deepEqual(sandbox.__scrolls, [], 'и не прокручена наверх');
  });

  test('введённый текст не стирается обновлением, а о новых данных сообщается', async () => {
    const { sandbox, page } = await screen('inquiries');
    sandbox.stateVersion = 'старая-версия';
    sandbox.pageTouched = true;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'черновик на месте');
    assert.equal(sandbox.document.getElementById('refreshHint').classList.contains('hidden'), false, 'видна полоска «появились новые данные»');
  });

  test('когда данные изменились и никто не печатает, экран обновляется без прыжка наверх', async () => {
    const { sandbox, page } = await screen('overview');
    sandbox.stateVersion = 'старая-версия';
    sandbox.pageTouched = false;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.notEqual(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'экран обновился');
    assert.deepEqual(sandbox.__scrolls, [], 'без прокрутки наверх');
  });

  test('переход между разделами прокручивает наверх, как и раньше', async () => {
    const { sandbox } = await screen('overview');
    sandbox.__scrolls.length = 0;
    sandbox.renderView();
    assert.equal(sandbox.__scrolls.length, 1, 'при обычной отрисовке страница прокручивается наверх');
  });
});

test('беседа помечается прочитанной только когда её открыл человек', async () => {
  resetData((data) => {
    data.config.active = true;
    data.users['700001'] = { id: '700001', chatId: 700001, firstName: 'Анна', preferredLanguage: 'ru', activity: [], lastSeenAt: new Date().toISOString() };
    data.inquiries.push({
      id: 'inq-unread', userId: '700001', chatId: '700001', language: 'ru', type: 'general',
      text: 'Есть ли парковка?', status: 'new', pipelineStage: 'new', replies: [], messages: [], readAt: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(),
    });
  });
  const { sandbox, requests } = await panelSandbox();
  const readRequests = () => requests.filter((request) => /\/api\/conversations\/.+\/read/.test(request.url));

  // Экран открыт: первую беседу панель выбирает сама, а не человек.
  requests.length = 0;
  await sandbox.VIEWS.inquiries.render(fakeElement('main'), 'inbox');
  assert.deepEqual(readRequests(), [], 'сама по себе беседа прочитанной не становится');
  assert.equal(sandbox.state.inquiries[0].readAt, '', 'обращение осталось непрочитанным');

  // Перерисовка по таймеру тоже ничего не помечает.
  await sandbox.VIEWS.inquiries.render(fakeElement('main'), 'inbox');
  assert.deepEqual(readRequests(), [], 'обновление экрана не помечает беседу');

  // Человек нажал на беседу в списке.
  sandbox.selectConversation('inq-unread');
  await sandbox.VIEWS.inquiries.render(fakeElement('main'), 'inbox');
  assert.equal(readRequests().length, 1, 'открытая беседа помечается прочитанной');
  assert.equal(readRequests()[0].method, 'POST');
  assert.ok(sandbox.state.inquiries[0].readAt, 'отметка проставлена и в панели');

  // И только один раз: следующая перерисовка не шлёт запрос заново.
  await sandbox.VIEWS.inquiries.render(fakeElement('main'), 'inbox');
  assert.equal(readRequests().length, 1, 'повторных запросов нет');
});

test('истёкший вход возвращает на экран входа, а не сыплет ошибками', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const document = sandbox.document;
  assert.equal(document.getElementById('app').classList.contains('hidden'), false, 'панель открыта');

  // Бот перезапустили: сессии больше нет.
  const working = sandbox.fetch;
  sandbox.fetch = async (url, options) => {
    if (String(url).includes('/api/state') || String(url).includes('/api/inquiries')) {
      return { ok: false, status: 401, json: async () => ({ error: 'Требуется вход' }), text: async () => '', headers: { get: () => '' } };
    }
    return working(url, options);
  };

  await assert.rejects(() => sandbox.api('/api/state'), (error) => error.status === 401);
  assert.equal(document.getElementById('app').classList.contains('hidden'), true, 'старые данные убраны с экрана');
  assert.equal(document.getElementById('loginScreen').classList.contains('hidden'), false, 'показан экран входа');
  assert.match(document.getElementById('loginError').textContent, /перестал действовать/i, 'сказано, что случилось');
  assert.equal(document.getElementById('loginError').classList.contains('hidden'), false, 'сообщение видно');

  // Неверный пароль на самом входе экран не ломает: это не истёкшая сессия.
  sandbox.fetch = async (url) => (String(url).includes('/api/login')
    ? { ok: false, status: 401, json: async () => ({ error: 'Неверный пароль' }), text: async () => '', headers: { get: () => '' } }
    : working(url));
  await assert.rejects(() => sandbox.send('/api/login', 'POST', { password: 'не тот' }), (error) => error.status === 401);
  assert.match(document.getElementById('loginError').textContent, /перестал действовать/i, 'текст про сессию не затёрт входом');
});
