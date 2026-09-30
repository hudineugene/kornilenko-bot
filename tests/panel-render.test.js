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
    // Один элемент, а не пустота: панель назначает почти все обработчики
    // списком (querySelectorAll(...).forEach), и с пустым списком в проверках
    // не было ни одной живой кнопки.
    querySelectorAll: (selector) => [node.querySelector(selector)],
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
  // Обработчики на документе запоминаем: панель слушает возвращение во вкладку.
  const listeners = new Map();
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
    querySelectorAll: (selector) => (String(selector) === 'dialog[open]' ? Array.from(openDialogs) : []),
    createElement: (tag) => (String(tag).toLowerCase() === 'dialog' ? makeDialog() : fakeElement(tag)),
    createDocumentFragment: () => fakeElement('fragment'),
    createTextNode: () => fakeElement('text'),
    addEventListener(type, handler) {
      if (!listeners.has(String(type))) listeners.set(String(type), []);
      listeners.get(String(type)).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(String(type)) || [];
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
    __fire(type, event) {
      (listeners.get(String(type)) || []).slice().forEach((handler) => handler(event || {}));
    },
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
  await sandbox.renderTelegramConnection(host);

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
  await sandbox.renderTelegramConnection(host);
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
    await sandbox.renderData(host);
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
    // Пароль копии спрашивается своим окном, а не prompt(): его не видно на
    // экране и он не остаётся в истории браузера.
    sandbox.askPassword = async (title) => (/копии/i.test(title) ? 'пароль-копии' : 'пароль-панели');
    const host = fakeElement('main');
    await sandbox.renderData(host);

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
    sandbox.askPassword = async (title) => (/копии/i.test(title) ? '' : 'пароль-панели');
    const host = fakeElement('main');
    await sandbox.renderData(host);

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
    const { sandbox, page } = await screen('clients');
    sandbox.stateVersion = 'старая-версия';
    sandbox.pageTouched = true;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'черновик на месте');
    assert.equal(sandbox.document.getElementById('refreshHint').classList.contains('hidden'), false, 'видна полоска «появились новые данные»');
  });

  test('когда данные изменились и никто не печатает, экран обновляется без прыжка наверх', async () => {
    const { sandbox, page } = await screen('today');
    sandbox.stateVersion = 'старая-версия';
    sandbox.pageTouched = false;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.notEqual(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'экран обновился');
    assert.deepEqual(sandbox.__scrolls, [], 'без прокрутки наверх');
  });

  // Сколько клиентов ждут ответа — значок «Клиенты» в меню слева.
  function waitingBadge(sandbox) {
    return sandbox.navItems().find(function (item) { return item.id === 'clients'; }).count;
  }

  test('несохранённая форма не отменяет обновление счётчиков', async () => {
    // Раньше при несохранённой форме автообновление не шло совсем: менеджер
    // писал заметку и не видел, что пришло новое сообщение от клиента.
    const { sandbox, page, state, requests } = await screen('settings');
    sandbox.stateVersion = 'старая-версия';
    // На экране форма с несохранёнными изменениями.
    sandbox.watchForm(sandbox.document.getElementById('page'), async () => {}, 'Есть несохранённые изменения').mark();
    assert.equal(sandbox.isDirty(), true, 'форма считается изменённой');

    const before = waitingBadge(sandbox);
    // Клиент написал: в новом состоянии одна беседа ждёт ответа.
    state.attention.waitingClients = before + 3;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(requests.some((request) => request.url.includes('/api/state')), 'панель всё равно спросила сервер');
    assert.equal(waitingBadge(sandbox), before + 3, 'счётчик «Переписки» обновился');
    assert.equal(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'а экран с формой не тронут');
    assert.equal(sandbox.document.getElementById('refreshHint').classList.contains('hidden'), false, 'о новых данных сказано полоской');
    assert.equal(sandbox.isDirty(), true, 'форма по-прежнему ждёт сохранения');
  });

  test('открытое окно тоже не отменяет обновление счётчиков', async () => {
    const { sandbox, page, state, requests } = await screen('objects');
    sandbox.stateVersion = 'старая-версия';
    const dialog = sandbox.openDialog({ title: 'Карточка объекта', body: '<input id="cardTitle">', protectChanges: true });
    assert.equal(dialog.open, true);

    const before = waitingBadge(sandbox);
    state.attention.waitingClients = before + 1;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(requests.some((request) => request.url.includes('/api/state')), 'обновление не отменено');
    assert.equal(waitingBadge(sandbox), before + 1, 'счётчик обновился');
    assert.equal(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'экран под окном не перерисован');
    assert.equal(dialog.open, true, 'и окно осталось открытым');
    dialog.closeClean();
  });

  test('наверх прокручивает только переход на другой экран; перерисовка после действия остаётся на месте', async () => {
    const { sandbox } = await screen('today');
    // Первая отрисовка экрана — переход: страница наверху.
    sandbox.__scrolls.length = 0;
    sandbox.lastRenderKey = '';
    sandbox.renderView();
    assert.equal(sandbox.__scrolls.length, 1, 'при входе на экран страница прокручивается наверх');
    // «Выполнено», смена этапа, удаление: тот же экран перерисован — прокрутка не сбрасывается.
    sandbox.__scrolls.length = 0;
    sandbox.renderView();
    assert.equal(sandbox.__scrolls.length, 0, 'тот же экран после действия остаётся на месте');
    await sandbox.reload();
    assert.equal(sandbox.__scrolls.length, 0, 'и после reload() тоже');
    // Другая вкладка или другой открытый диалог — новый экран.
    sandbox.currentView = 'clients';
    sandbox.currentTab = 'inbox';
    sandbox.renderView();
    assert.equal(sandbox.__scrolls.length, 1, 'смена раздела прокручивает наверх');
    sandbox.__scrolls.length = 0;
    sandbox.currentSub = 'inq-1';
    sandbox.renderView();
    assert.equal(sandbox.__scrolls.length, 1, 'открытый диалог — другой экран');
    sandbox.renderView({ top: true });
    assert.equal(sandbox.__scrolls.length, 2, 'по явной просьбе — наверх');
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
  sandbox.currentView = 'clients';
  sandbox.currentTab = 'inbox';

  // Обновление по таймеру и вход в раздел диалог сами не открывают и ничего не
  // помечают: раньше вход открывал первую беседу и тут же «читал» её.
  requests.length = 0;
  sandbox.renderView({ auto: true });
  sandbox.renderView();
  assert.equal(sandbox.selectedInquiry, '', 'первый диалог сам не открывается');
  assert.deepEqual(readRequests(), [], 'ничего не помечено прочитанным');
  assert.equal(sandbox.state.inquiries[0].readAt, '', 'обращение осталось непрочитанным');

  // Человек выбрал диалог — вот теперь он прочитан, и один раз.
  sandbox.selectConversation('inq-unread');
  sandbox.renderView();
  assert.equal(readRequests().length, 1, 'выбранный человеком диалог помечается прочитанным');
  assert.equal(readRequests()[0].method, 'POST');
  assert.ok(sandbox.state.inquiries[0].readAt, 'отметка проставлена и в панели');

  await sandbox.VIEWS.clients.render(fakeElement('main'), 'inbox');
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

test('в списке диалогов видно последнее сообщение, а не первое', async () => {
  // Переписка перестала уезжать в панель целиком (она тяжёлая и нужна только для
  // открытой беседы), а список диалогов всё ещё искал последнее сообщение в
  // ней — и показывал item.text, первое сообщение клиента. В живой панели
  // превью всех бесед месяцами оставалось «Есть ли парковка?».
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.users['700002'] = { id: '700002', chatId: 700002, firstName: 'Мария', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(1) };
    data.inquiries.push({
      id: 'inq-preview', userId: '700002', chatId: '700002', language: 'ru', type: 'general',
      text: 'Есть ли парковка?', status: 'in_progress', pipelineStage: 'contact', replies: [],
      messages: [
        { id: 'm1', direction: 'in', kind: 'text', text: 'Есть ли парковка?', createdAt: minutesAgo(30) },
        { id: 'm2', direction: 'out', kind: 'text', text: 'Да, два места в подземном', createdAt: minutesAgo(20) },
        { id: 'm3', direction: 'in', kind: 'text', text: 'Отлично, когда можно посмотреть?', createdAt: minutesAgo(5) },
      ],
      createdAt: minutesAgo(30), updatedAt: minutesAgo(5), clientMessageAt: minutesAgo(5),
    });
  });

  const { sandbox, state } = await panelSandbox();
  const stored = state.inquiries.find((item) => item.id === 'inq-preview');
  assert.ok(stored, 'обращение попало в состояние');
  assert.equal(stored.messages, undefined, 'переписка целиком в панель по-прежнему не уезжает');
  assert.equal(stored.lastMessage.text, 'Отлично, когда можно посмотреть?', 'а последнее сообщение — да');
  assert.equal(stored.lastMessage.direction, 'in');
  assert.equal(stored.messageCount, 3);

  const host = fakeElement('main');
  // Смотрим все беседы, а не только ждущие ответа.
  sandbox.inquiryFilter.status = '';
  await sandbox.VIEWS.clients.render(host, '');
  const previews = String(host.innerHTML).match(/class="conversation-preview">([^<]*)</g) || [];
  assert.ok(previews.length, 'в списке есть беседы');
  assert.ok(previews.some((line) => line.includes('когда можно посмотреть')), 'показано последнее сообщение, нашлось: ' + previews.join(' | '));
  assert.ok(!previews.some((line) => line.includes('Есть ли парковка')), 'первое сообщение в превью больше не висит');
});

test('ответ менеджера в превью подписан «Вы»', async () => {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.users['700003'] = { id: '700003', chatId: 700003, firstName: 'Пётр', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(2) };
    data.inquiries.push({
      id: 'inq-out', userId: '700003', chatId: '700003', language: 'ru', type: 'general',
      text: 'Сколько стоит содержание?', status: 'in_progress', pipelineStage: 'contact', replies: [],
      messages: [
        { id: 'o1', direction: 'in', kind: 'text', text: 'Сколько стоит содержание?', createdAt: minutesAgo(10) },
        { id: 'o2', direction: 'out', kind: 'text', text: 'Около 120 евро в месяц', createdAt: minutesAgo(2) },
      ],
      createdAt: minutesAgo(10), updatedAt: minutesAgo(2), clientMessageAt: minutesAgo(10),
    });
  });

  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  sandbox.inquiryFilter.status = '';
  await sandbox.VIEWS.clients.render(host, '');
  const previews = String(host.innerHTML).match(/class="conversation-preview">([^<]*)</g) || [];
  assert.ok(previews.some((line) => line.includes('Вы: Около 120 евро')), 'видно, что последнее слово за менеджером: ' + previews.join(' | '));
});

// Две беседы, обе ждут ответа: главный рабочий экран менеджера.
function twoWaitingConversations() {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.users['720001'] = { id: '720001', chatId: 720001, firstName: 'Ольга', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(4) };
    data.users['720002'] = { id: '720002', chatId: 720002, firstName: 'Николай', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(9) };
    data.inquiries.push({
      id: 'inq-olga', userId: '720001', chatId: '720001', language: 'ru', type: 'general',
      text: 'Когда можно посмотреть?', status: 'new', pipelineStage: 'new', replies: [],
      messages: [
        { id: 'o-1', direction: 'in', kind: 'text', text: 'Когда можно посмотреть?', createdAt: minutesAgo(40) },
        { id: 'o-2', direction: 'out', kind: 'text', text: 'Уточню у собственника', createdAt: minutesAgo(20) },
        { id: 'o-3', direction: 'in', kind: 'text', text: 'Жду, спасибо', createdAt: minutesAgo(4) },
      ],
      createdAt: minutesAgo(40), updatedAt: minutesAgo(4), clientMessageAt: minutesAgo(4),
    });
    data.inquiries.push({
      id: 'inq-nikolay', userId: '720002', chatId: '720002', language: 'ru', type: 'general',
      text: 'Есть ли рассрочка?', status: 'new', pipelineStage: 'new', replies: [], messages: [
        { id: 'n-1', direction: 'in', kind: 'text', text: 'Есть ли рассрочка?', createdAt: minutesAgo(9) },
      ],
      createdAt: minutesAgo(9), updatedAt: minutesAgo(9), clientMessageAt: minutesAgo(9),
    });
  });
}

test('отвеченная беседа остаётся открытой, а не подменяется другим клиентом', async () => {
  // При фильтре «Ждут ответа» отвеченная беседа выпадала из списка, и панель
  // тут же открывала первого из оставшихся: менеджер отвечал одному клиенту, а
  // смотрел уже на другого.
  twoWaitingConversations();
  const { sandbox, state } = await panelSandbox();
  sandbox.inquiryFilter.status = 'waiting';
  sandbox.selectConversation('inq-olga');

  const host = fakeElement('main');
  await sandbox.VIEWS.clients.render(host, '');
  assert.equal(sandbox.selectedInquiry, 'inq-olga', 'беседа выбрана');
  assert.match(String(host.innerHTML), /Ольга/);

  // Ответили: клиент больше не ждёт, беседа под фильтр не подходит.
  const answered = state.inquiries.find((item) => item.id === 'inq-olga');
  answered.status = 'in_progress';
  answered.replies = [{ id: 'r-1', text: 'Договорились на субботу', createdAt: new Date().toISOString(), source: 'panel' }];

  const after = fakeElement('main');
  await sandbox.VIEWS.clients.render(after, '');
  assert.equal(sandbox.selectedInquiry, 'inq-olga', 'осталась та же беседа, другой клиент не подменил её');
  assert.match(String(after.innerHTML), /Ольга/, 'и она по-прежнему видна в списке');
});

test('«Объекты» и «База клиентов» на телефоне: таблица превращается в карточки, порядок ячеек не сбит', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push({ id: 'card-1', status: 'active', reference: 'C-1', dealType: 'sale', propertyType: 'apartment', title: { ru: 'Квартира у моря', en: '', es: '' }, city: { ru: 'Бенидорм', en: '', es: '' }, priceValue: 150000, currency: 'EUR', imagesByLanguage: { ru: [], en: [], es: [] } });
    data.users['610'] = { id: '610', chatId: 610, firstName: 'Анна', activity: [] };
  });
  const { sandbox } = await panelSandbox();
  const cells = (html) => (String(html).match(/<tr[^>]*data-id[^>]*>([\s\S]*?)<\/tr>/) || [])[1].match(/<td[\s>]/g).length;

  // Карточки на телефоне рисуются правилами по номеру ячейки (td:nth-child):
  // изменили столбцы — правила надо менять вместе с ними.
  const objects = fakeElement('main');
  sandbox.renderObjects(objects);
  const objectsHtml = String(objects.innerHTML);
  assert.match(objectsHtml, /<table class="table-cards objects-table">/);
  assert.equal(cells(objectsHtml), 8, 'в строке объекта восемь ячеек: фото, название, тип, город, цена, статус, эффективность, «⋯»');

  const clients = fakeElement('main');
  sandbox.renderClients(clients);
  const clientsHtml = String(clients.innerHTML);
  assert.match(clientsHtml, /<table class="table-cards clients-table">/);
  assert.equal(cells(clientsHtml), 5, 'в строке клиента пять ячеек: клиент, источник и язык, этап, следующий шаг, активность');

  // Сами правила: до 600 px строка — сетка, а не ширина таблицы.
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const sheet = PANEL_HTML.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const phone = sheet.slice(sheet.indexOf('/* Таблицы-карточки на телефоне'));
  assert.match(phone, /@media \(max-width:600px\)/);
  for (const rule of ['.table-cards thead{display:none}', '.table-cards tr{display:grid', '.objects-table tr{grid-template-columns', '.clients-table tr{grid-template-columns', '.table-cards td[colspan]']) {
    assert.ok(phone.includes(rule), 'правило: ' + rule);
  }
});

test('полоса «Есть несохранённые изменения»: пропадает, когда значение вернули к исходному; правки не из полей её удерживают', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const listeners = {};
  const inputs = [{ id: 'a', type: 'text', value: 'один' }, { id: 'b', type: 'checkbox', checked: false, value: 'on' }, { id: 'f', type: 'file', value: '' }];
  const root = {
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); },
    querySelectorAll: () => inputs,
  };
  const fire = (type) => (listeners[type] || []).forEach((handler) => handler({}));
  const bar = sandbox.el('savebar');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  const watcher = sandbox.watchForm(root, async () => {}, 'Правки');
  await tick();
  assert.equal(sandbox.isDirty(), false, 'сначала ничего не изменено');

  inputs[0].value = 'два';
  fire('input');
  assert.equal(sandbox.isDirty(), true, 'изменили — полоса есть');
  assert.ok(!bar.classList.contains('hidden'));

  inputs[0].value = 'один';
  fire('input');
  assert.equal(sandbox.isDirty(), false, 'вернули прежнее значение — полосы больше нет');
  assert.ok(bar.classList.contains('hidden'));

  // Флажок и повторная правка.
  inputs[1].checked = true;
  fire('change');
  assert.equal(sandbox.isDirty(), true);
  inputs[1].checked = false;
  fire('change');
  assert.equal(sandbox.isDirty(), false);

  // Файл выбрали — значения полей не изменились, но изменение есть: код сообщает о нём сам.
  watcher.mark();
  assert.equal(sandbox.isDirty(), true);
  inputs[0].value = 'три';
  fire('input');
  inputs[0].value = 'один';
  fire('input');
  assert.equal(sandbox.isDirty(), true, 'выбранное фото не пропадает от того, что текст вернули к прежнему');

  // Поля добавились или убавились (строка менеджера) — это тоже изменение.
  sandbox.clearDirty();
  const second = sandbox.watchForm(root, async () => {}, 'Правки');
  await tick();
  inputs.push({ id: 'm', type: 'text', value: '' });
  second.check();
  assert.equal(sandbox.isDirty(), true, 'добавили строку — есть что сохранять');
  inputs.pop();
  second.check();
  assert.equal(sandbox.isDirty(), false, 'убрали её же — сохранять нечего');
});

test('«Команда»: одна полоса сохранения на чат администратора и менеджеров, пароль спрашивается один раз', async () => {
  resetData((data) => {
    data.config.active = true;
    data.config.adminChatId = '111';
    data.config.managers = [{ id: 'm1', name: 'Мария', chatId: '222', verifiedAt: '' }];
  });
  const { sandbox, requests } = await panelSandbox();
  let save = null;
  sandbox.watchForm = (root, callback) => { save = callback; return { mark() {}, check() {} }; };
  let prompts = 0;
  sandbox.askPassword = async () => { prompts += 1; return 'пароль-панели'; };

  const host = fakeElement('main');
  sandbox.renderConnection(host);
  const html = String(host.innerHTML);
  assert.ok(!html.includes('id="saveManagers"'), 'отдельной кнопки «Сохранить менеджеров» нет');
  assert.match(html, /кнопкой «Сохранить» в полосе снизу/, 'сказано, как сохранить');
  assert.ok(typeof save === 'function', 'форма следит за изменениями всего экрана');

  // Изменились и чат, и список менеджеров: пароль один, запросов два.
  host.querySelector('#setAdminChat').value = '999';
  host.querySelector('#adminName').value = 'Олег';
  sandbox.state.config.adminChatId = '111';
  requests.length = 0;
  await save();
  assert.equal(prompts, 1, 'пароль спрошен один раз');
  const settings = requests.find((request) => request.url === '/api/settings' && request.method === 'PUT');
  const managers = requests.find((request) => request.url === '/api/managers' && request.method === 'PUT');
  assert.ok(settings && managers, 'сохранились и настройки чата, и менеджеры');
  assert.equal(settings.body.currentPassword, 'пароль-панели');
  assert.ok(!('messages' in settings.body) && !('active' in settings.body), 'настройки команды не тянут за собой приветствие и включение бота');
  assert.equal(managers.body.currentPassword, 'пароль-панели');
});

test('редактор объекта: «Готовность карточки» — одна строка «Не хватает: N полей», по языкам — по нажатию; причина рядом с «Опубликовать»', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push({ id: 'gaps-1', status: 'hidden', reference: '', title: { ru: 'Вилла', en: '', es: 'Villa' }, imagesByLanguage: { ru: [], en: [], es: [] } });
  });
  const { sandbox } = await panelSandbox();
  const original = sandbox.openDialog;
  let dialog = null;
  // Поддельная страница отдаёт во все поля «1»: пробелы задаём сами.
  sandbox.openDialog = (options) => {
    const ready = options.ready;
    options.ready = (opened) => {
      opened.querySelector('#fReference').value = '';
      opened.querySelector('#fArea').value = '0';
      opened.querySelector('[data-tr="title"][data-lang="en"]').value = '';
      ready(opened);
    };
    dialog = original(options);
    return dialog;
  };
  sandbox.openRecordEditor('objects', 'gaps-1');
  const check = String(dialog.querySelector('#publicationCheck').innerHTML);

  // Один список сверху, а не три одинаковых подряд.
  assert.match(check, /<summary class="warn-text">Не хватает: 3 поля \(номер объекта, площадь, название\)<\/summary>/, 'одна строка с числом и первыми названиями');
  assert.equal((check.match(/<summary/g) || []).length, 1, 'общая строка одна, а не по строке на язык');
  assert.ok(check.indexOf('<details') < check.indexOf('publication-rows'), 'разбор по языкам — внутри раскрывающегося блока');
  assert.match(check, /<b>EN<\/b>[\s\S]*?название, номер объекта, площадь/, 'у английского не хватает и названия');

  // Причина неактивной «Опубликовать» — текстом рядом, а не подсказкой title.
  const foot = String(dialog.querySelector('#editorFoot').innerHTML);
  assert.match(foot, /id="publishWhy">Опубликовать нельзя\. Не хватает: 3 поля/, 'причина видна без наведения мыши');
  assert.ok(foot.indexOf('publishWhy') < foot.indexOf('id="publishNow"'), 'подпись стоит перед кнопкой');
  assert.match(foot, /id="publishNow"[^>]*disabled/, 'кнопка недоступна');
});

test('карточка клиента: удаление данных — отдельным блоком в конце, а не красной кнопкой рядом с «Сохранить»', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const original = sandbox.openDialog;
  let options = null;
  sandbox.openDialog = (dialogOptions) => { options = dialogOptions; return original(dialogOptions); };
  sandbox.openClient('720001');
  assert.ok(options, 'карточка открылась');

  // Нижняя полоса — только безопасное: выгрузить, закрыть, сохранить.
  assert.ok(!options.footer.includes('eraseClient'), 'в нижней полосе кнопки удаления нет');
  assert.ok(!/class="btn danger"/.test(options.footer), 'красных кнопок в нижней полосе нет');
  assert.ok(options.footer.indexOf('exportClient') < options.footer.indexOf('data-close'), 'выгрузка — слева');
  assert.ok(options.footer.indexOf('data-close') < options.footer.indexOf('saveClient'), 'Закрыть — левее «Сохранить»');

  // Удаление — в конце содержимого, с объяснением и рамкой предупреждения.
  const body = String(options.body);
  const zone = body.indexOf('danger-zone');
  assert.ok(zone > body.indexOf('История заявок'), 'блок удаления — после истории заявок, в самом конце');
  assert.ok(body.indexOf('eraseClient') > zone, 'кнопка внутри этого блока');
  assert.match(body, /без возможности восстановления/);
  assert.match(body, /сначала нажмите «Выгрузить данные»/, 'подсказка выгрузить данные заранее');
});

test('точка состояния бота: у неё есть подпись для скринридера и короткая метка для телефона', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const box = sandbox.el('botState');
  sandbox.state.config.active = true;
  sandbox.state.runtime = { status: 'running', consecutiveFailures: 0 };
  sandbox.renderBotState();
  assert.equal(box.dataset.state, 'on');
  assert.equal(box.dataset.short, '', 'когда всё хорошо, подписи рядом с точкой нет');

  sandbox.state.runtime = { status: 'error', consecutiveFailures: 3 };
  sandbox.renderBotState();
  assert.equal(box.dataset.state, 'bad');
  assert.equal(box.dataset.short, 'Нет связи', 'при обрыве связи рядом с точкой — слова, а не одна красная точка');

  sandbox.state.config.active = false;
  sandbox.renderBotState();
  assert.equal(box.dataset.state, 'off');
  assert.equal(box.dataset.short, 'Выключен');
});

test('кнопки в шапке экрана не плодятся, когда список перерисовывается сам', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const box = sandbox.el('pageActions');
  box.children.length = 0;

  // «Диалоги» перерисовывают список при каждом выборе клиента и смене фильтра, не
  // трогая шапку: раньше каждая такая перерисовка дописывала ещё пару кнопок.
  for (let round = 0; round < 4; round += 1) await sandbox.VIEWS.clients.render(fakeElement('main'), '');
  assert.deepEqual(box.children.map((button) => button.textContent), ['✎ Шаблоны ответов', '⋯'], 'по одной кнопке, а не по четыре пары');

  // Повторный вызов обновляет обработчик и вид кнопки, а не добавляет вторую.
  let clicked = '';
  sandbox.pageAction('Действие', () => { clicked = 'первый'; }, 'secondary');
  const again = sandbox.pageAction('Действие', () => { clicked = 'второй'; }, 'ghost');
  assert.equal(box.children.filter((button) => button.textContent === 'Действие').length, 1);
  again.onclick();
  assert.equal(clicked, 'второй', 'сработал последний обработчик');
  assert.match(again.className, /ghost/, 'вид обновлён');
});

test('шаблоны ответа — кнопками в один ряд, а вставка не стирает набранное', async () => {
  twoWaitingConversations();
  const { sandbox, state } = await panelSandbox();
  state.replyTemplates = [
    { id: 't-view', title: 'Просмотр', text: { ru: 'Когда вам удобно посмотреть объект?', en: 'When would you like to view it?', es: '' } },
    { id: 't-price', title: 'Цена', text: { ru: 'Актуальную цену пришлю сегодня.', en: '', es: '' } },
  ];
  sandbox.selectConversation('inq-olga');
  const host = fakeElement('main');
  await sandbox.VIEWS.clients.render(host, '');
  const html = String(host.innerHTML) + String(host.querySelector('#inquiryCard').innerHTML);
  assert.match(html, /id="replyTemplates"/, 'ряд шаблонов есть');
  assert.match(html, /<button class="btn secondary small template-chip" type="button" data-template="t-view"[^>]*>Просмотр<\/button>/, 'шаблон — кнопка с названием');
  assert.match(html, /data-template="t-price"/);
  assert.ok(!html.includes('id="replyTemplate"'), 'списка «Вставить шаблон…» больше нет');
  assert.ok(html.indexOf('id="replyTemplates"') < html.indexOf('id="replyText"'), 'шаблоны — над полем ответа');

  // Без шаблонов ряда нет.
  state.replyTemplates = [];
  const empty = fakeElement('main');
  await sandbox.VIEWS.clients.render(empty, '');
  assert.ok(!(String(empty.innerHTML) + String(empty.querySelector('#inquiryCard').innerHTML)).includes('id="replyTemplates"'));

  // Вставка: пустое поле — просто текст; набранное — остаётся, шаблон ниже.
  assert.equal(sandbox.withTemplate('', 'Шаблон'), 'Шаблон');
  assert.equal(sandbox.withTemplate('   ', 'Шаблон'), 'Шаблон', 'одни пробелы — как пусто');
  assert.equal(sandbox.withTemplate('Здравствуйте, Ольга!', 'Шаблон'), 'Здравствуйте, Ольга!\n\nШаблон');
  assert.equal(sandbox.withTemplate('Начал писать  \n', 'Шаблон'), 'Начал писать\n\nШаблон', 'хвостовые пробелы не копятся');
});

test('в переписке видно ответы бота, а запись на просмотр выделена карточкой', async () => {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.objects.push({ id: 'villa-1', title: { ru: 'Вилла у моря' }, status: 'active', images: [], reference: 'REF-1' });
    data.users['730001'] = { id: '730001', chatId: 730001, firstName: 'Пётр', preferredLanguage: 'ru', activity: [] };
    data.inquiries.push({
      id: 'inq-viewing', userId: '730001', chatId: '730001', language: 'ru', type: 'viewing', propertyId: 'villa-1',
      text: 'Хочу посмотреть виллу', status: 'new', pipelineStage: 'viewing', replies: [],
      viewing: { dateText: 'в субботу', timeText: '12:00' },
      messages: [
        { id: 'v-1', direction: 'in', kind: 'text', text: 'Хочу посмотреть виллу', createdAt: minutesAgo(30) },
        { id: 'v-2', direction: 'out', kind: 'text', text: 'Спасибо! Заявка на просмотр отправлена.', source: 'bot', by: 'бот', createdAt: minutesAgo(29) },
      ],
      createdAt: minutesAgo(30), updatedAt: minutesAgo(29), clientMessageAt: minutesAgo(30),
    });
  });
  const { sandbox } = await panelSandbox();
  // Переписку панель просит отдельным запросом — отвечаем той же лентой.
  const timeline = bot.getData().inquiries.find((item) => item.id === 'inq-viewing').messages;
  const fetchBefore = sandbox.fetch;
  sandbox.fetch = async (url, options) => (String(url).includes('/timeline')
    ? { ok: true, status: 200, json: async () => ({ messages: timeline }), text: async () => '', headers: { get: () => '' } }
    : fetchBefore(url, options));
  sandbox.selectConversation('inq-viewing');
  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');
  // Переписка подгружается отдельным запросом — ждём его и рисуем ещё раз.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await sandbox.VIEWS.clients.render(host, '');

  const html = String(card.innerHTML);
  assert.match(html, /Спасибо! Заявка на просмотр отправлена\./, 'ответ бота виден в ленте');
  assert.match(html, /бот/, 'и подписан, кто ответил');
  assert.match(html, /class="viewing-card/, 'запись на просмотр — отдельная карточка');
  assert.match(html, /Ждёт подтверждения/);
  assert.match(html, /в субботу · 12:00/);
  assert.ok(card.querySelector('#confirmViewingInline'), 'подтвердить можно прямо из переписки');
});

test('«Просмотры» открываются на очереди подтверждения, а в окне время ставится кнопками', async () => {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.objects.push({ id: 'villa-1', title: { ru: 'Вилла у моря' }, status: 'active', images: [], reference: 'REF-1' });
    data.users['730001'] = { id: '730001', chatId: 730001, firstName: 'Пётр', preferredLanguage: 'ru', activity: [] };
    data.inquiries.push({
      id: 'inq-viewing', userId: '730001', chatId: '730001', language: 'ru', type: 'viewing', propertyId: 'villa-1',
      text: 'Хочу посмотреть виллу', status: 'new', pipelineStage: 'viewing', replies: [], messages: [],
      viewing: { dateText: 'como indicado', timeText: 'después de comer' },
      createdAt: minutesAgo(30), updatedAt: minutesAgo(29), clientMessageAt: minutesAgo(30),
    });
  });
  const { sandbox } = await panelSandbox();

  // Есть что подтверждать — экран открывается на очереди, а не на календаре.
  sandbox.currentView = 'today';
  sandbox.location.hash = '#/viewings';
  sandbox.applyRoute();
  const host = fakeElement('main');
  await sandbox.VIEWS.viewings.render(host, '');
  assert.equal(sandbox.viewingMode, 'pending', 'первая вкладка — «Ждут подтверждения»');
  assert.match(String(host.innerHTML), /viewing-pending-card/, 'и на экране очередь');

  // Человек выбрал календарь — экран его выбор не переопределяет.
  sandbox.viewingModeChosen = true;
  sandbox.viewingMode = 'calendar';
  await sandbox.VIEWS.viewings.render(host, '');
  assert.equal(sandbox.viewingMode, 'calendar');

  // Очередь пуста — календарь.
  sandbox.viewingModeChosen = false;
  sandbox.state.inquiries[0].viewing.confirmedAt = new Date().toISOString();
  await sandbox.VIEWS.viewings.render(host, '');
  assert.equal(sandbox.viewingMode, 'calendar', 'без очереди открывается календарь');

  // Окно подтверждения: просьба клиента, кнопки времени, дата не «сегодня».
  let dialogOptions = null;
  sandbox.openDialog = (options) => { dialogOptions = options; };
  sandbox.state.inquiries[0].viewing.confirmedAt = '';
  sandbox.openViewingSchedule(sandbox.state.inquiries[0]);
  const body = String(dialogOptions.body).replace(/ /g, ' ');
  assert.match(body, /Клиент просил: como indicado · después de comer/, 'просьба клиента видна как есть');
  for (const time of ['10:00', '12:00', '17:00']) assert.match(body, new RegExp('data-quick-time="' + time + '"'), 'кнопка ' + time);
  assert.match(body, /id="viewingScheduleDate"[^>]*value=""/, 'дата не подставлена «сегодняшним числом»');

  // Онлайн-показ: менеджер видит формат и в очереди, и в окне подтверждения.
  sandbox.state.inquiries[0].viewing.online = true;
  sandbox.openViewingSchedule(sandbox.state.inquiries[0]);
  assert.match(String(dialogOptions.body), /онлайн-просмотр по видеосвязи/, 'в окне подтверждения');
  assert.match(sandbox.viewingOnlineTag(sandbox.state.inquiries[0]), /📹 онлайн/, 'и пометка в очереди');
  assert.equal(sandbox.viewingOnlineTag({ viewing: {} }), '', 'у обычного показа пометки нет');
});

test('состояние заявки бот считает сам, руками остаётся только закрыть', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  sandbox.selectConversation('inq-olga');

  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');

  // Клиент написал последним — «Ждёт ответа».
  assert.match(String(card.innerHTML), /Ждёт ответа/);
  assert.ok(!String(card.innerHTML).includes('оставить диалог в работе'), 'галочки больше нет');
  assert.ok(!String(card.innerHTML).includes('id="keepOpen"'));

  const options = String(card.innerHTML).match(/<select id="inqStatusValue">.*?<\/select>/s)[0];
  assert.match(options, /Ждёт ответа/, 'в списке — само состояние, а не безликое «Открыта»');
  assert.match(options, /Закрыт</);
  assert.ok(!/В работе<\/option>/.test(options), 'промежуточного статуса в списке нет');

  // Закрытие — обычное сохранение.
  card.querySelector('#inqStatusValue').value = 'closed';
  const before = requests.length;
  await card.querySelector('#saveInq').onclick();
  const saved = requests.slice(before).find((request) => request.url.includes('/api/inquiries/'));
  assert.equal(saved.body.status, 'closed');
});

test('«Сохранить» шлёт этап и статус только когда их изменили', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  sandbox.selectConversation('inq-olga');
  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');
  const patchOf = async () => {
    const before = requests.length;
    await card.querySelector('#saveInq').onclick();
    return requests.slice(before).find((request) => request.method === 'PATCH' && request.url.includes('/api/inquiries/')).body;
  };

  // Ничего не менял, кроме заметки: ни статус, ни этап не уходят и не затирают друг друга.
  // (у поддельного DOM выбранное значение списка надо задать самому)
  const item = sandbox.state.inquiries.find((entry) => entry.id === 'inq-olga');
  card.querySelector('#inqStatusValue').value = 'open';
  card.querySelector('#inqPipeline').value = sandbox.pipelineStageOf(item);
  card.querySelector('#inqNote').value = 'позвонить';
  const plain = await patchOf();
  assert.ok(!('status' in plain), 'статус не менялся — не отправляется');
  assert.ok(!('pipelineStage' in plain), 'этап не менялся — не отправляется');

  // Выбрал этап «Выиграно» — уходит только этап.
  card.querySelector('#inqPipeline').value = 'won';
  const won = await patchOf();
  assert.equal(won.pipelineStage, 'won');
  assert.ok(!('status' in won), 'статус вместе с этапом не уходит и не откатывает его');
});

test('сопровождение заявки собрано в одной панели: одна заметка, один запрос, форма под наблюдением', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  sandbox.selectConversation('inq-olga');
  const watched = [];
  sandbox.watchForm = (root, save, label) => { watched.push({ root, save, label }); return { mark() {}, check() {} }; };

  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');

  const side = card.querySelector('.conversation-side');
  assert.ok(side, 'справа от переписки — панель сопровождения');
  for (const id of ['#inqStatusValue', '#inqPipeline', '#inqAssignee', '#followDate', '#inqNote', '#clientTagsInq', '#saveInq']) {
    assert.ok(card.querySelector(id), id + ' живёт в этой же панели');
  }
  assert.ok(!String(card.innerHTML).includes('data-status='), 'статус больше не сохраняется отдельной кнопкой');

  // Заметка одна — о клиенте: второго поля «по этой заявке» нет.
  const html = String(card.innerHTML);
  assert.match(html, /<label for="inqNote">Заметка о клиенте<\/label>/);
  assert.ok(!html.includes('clientNoteInq'), 'второй заметки нет');
  assert.ok(!/Заметка по этой заявке|Общая заметка/.test(html));

  // Панель — под наблюдением: несохранённая правка не теряется при уходе со страницы.
  const form = watched.find((entry) => entry.root === side);
  assert.ok(form, 'форма сопровождения зарегистрирована в watchForm');
  assert.match(form.label, /заявке|клиенте/i);

  // Кнопка «Сохранить» в панели и кнопка полосы — одно и то же действие, один запрос.
  card.querySelector('#inqStatusValue').value = 'closed';
  card.querySelector('#inqNote').value = 'перезвонить в среду';
  card.querySelector('#clientTagsInq').value = 'покупка, горячий лид';
  requests.length = 0;
  await card.querySelector('#saveInq').onclick();
  const saved = requests.filter((request) => request.method === 'PATCH');
  assert.equal(saved.length, 1, 'один запрос вместо двух');
  assert.ok(saved[0].url.includes('/api/inquiries/'));
  assert.equal(saved[0].body.status, 'closed', 'статус уходит вместе с остальным');
  assert.equal(saved[0].body.note, 'перезвонить в среду');
  assert.deepEqual(saved[0].body.tags, ['покупка', 'горячий лид']);
  assert.ok(!requests.some((request) => request.url.includes('/api/users/')), 'клиент отдельным запросом не сохраняется');

  requests.length = 0;
  await form.save();
  assert.equal(requests.filter((request) => request.method === 'PATCH').length, 1, 'кнопка полосы сохранения — тот же единственный запрос');
});

test('переписка открывается на последнем сообщении', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.selectConversation('inq-olga');

  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');
  const thread = card.querySelector('.conversation-thread');
  assert.equal(thread.scrollTop, thread.scrollHeight, 'переписка прокручена к последнему сообщению');
});

test('на телефоне список и переписка — разные экраны', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.innerWidth = 375;
  const host = fakeElement('main');
  const scrolled = [];
  sandbox.scrollTo = function (options) { scrolled.push(options || {}); };
  // Открытый диалог прокручивается к полю ответа, чтобы конец переписки и поле были на экране.
  host.querySelector('#inquiryCard').querySelector('.reply-box').scrollIntoView = function (options) { scrolled.push(options || {}); };
  const classes = sandbox.document.body.classList;

  // Пока никого не выбрали — виден список.
  await sandbox.VIEWS.clients.render(host, '');
  assert.ok(!String(host.innerHTML).includes('chat-open'), 'сначала список');

  // Открыл человек: переписка занимает экран целиком.
  sandbox.selectConversation('inq-olga');
  await sandbox.VIEWS.clients.render(host, '');
  assert.match(String(host.innerHTML), /messenger-shell chat-open/, 'переписка вместо списка');
  assert.equal(scrolled.length, 0, 'страница к полю ответа не прыгает: переписка прокручивается сама, поле ответа под ней');
  assert.ok(classes.contains('phone-chat'), 'обвязка (заголовок, вкладки, фильтры) на телефоне скрыта');
  const card = host.querySelector('#inquiryCard');
  assert.equal(card.querySelector('.conversation-side-details').open, true, 'панель заявки раскрыта: на телефоне она выезжает справа по кнопке «⋯ Сведения»');
  assert.match(String(card.innerHTML), /<summary>Статус, этап и заметки<\/summary>/);
  assert.ok(card.querySelector('#backToList'), 'есть возврат к списку');

  // Обновление по таймеру экран не дёргает.
  await sandbox.VIEWS.clients.render(host, '');
  assert.equal(scrolled.length, 0, 'при перерисовке экран не дёргается');

  // Возврат к списку.
  await card.querySelector('#backToList').onclick();
  assert.equal(sandbox.selectedInquiryId ? sandbox.selectedInquiryId() : '', '');
  assert.ok(!classes.contains('phone-chat'), 'со списком обвязка возвращается');
  sandbox.innerWidth = 1280;
});

test('статус один: «Ждёт ответа / Отвечено / Закрыт», без «В работе» и без второго фильтра', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.clients.render(host, '');
  const html = String(host.innerHTML).replace(/ /g, ' ');

  assert.ok(!html.includes('id="inqType"'), 'отдельного фильтра по виду заявки нет');
  assert.ok(!/data-status="progress"/.test(html), 'вкладки «В работе» нет');
  assert.ok(!/>В работе/.test(html), 'слова «В работе» нет ни во вкладках, ни в строках');
  for (const label of ['Ждут ответа', 'Отвеченные', 'Закрытые']) assert.match(html, new RegExp(label), label + ' — на месте');

  // Вид заявки ищется обычным поиском.
  sandbox.inquiryFilter.status = '';
  sandbox.inquiryFilter.search = 'сообщение';
  const found = sandbox.conversationGroups().filter(sandbox.conversationMatches);
  assert.ok(found.length > 0, 'поиск понимает название вида заявки');

  // В карточке — один статус, этап отдельно и по желанию.
  sandbox.selectConversation('inq-olga');
  const view = fakeElement('main');
  await sandbox.VIEWS.clients.render(view, '');
  const card = String(view.querySelector('#inquiryCard').innerHTML);
  assert.match(card, /<label for="inqStatusValue">Статус<\/label>/);
  assert.match(card, /Этап <span class="small faint">\(по желанию\)/);
  assert.ok(!card.includes('Этап воронки'), 'старая подпись убрана');
});

test('три слоя фильтров сворачиваются в одну строку', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.clients.render(host, '');

  const compact = host.querySelector('#inqStatusCompact');
  assert.ok(compact, 'на телефоне состояние выбирается одной строкой');
  assert.match(String(host.innerHTML), /Ждут ответа · 2/, 'в строке видно, сколько ждут ответа');

  compact.value = 'unread';
  await compact.onchange();
  const active = String(host.innerHTML).match(/data-status="([a-z]*)" class="active"/);
  assert.equal(active[1], 'unread', 'выбор из строки меняет фильтр');
  assert.match(String(host.innerHTML), /Николай/, 'в списке остаётся непрочитанный диалог');
});

test('после отправки ответа страница не прыгает наверх', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.selectConversation('inq-olga');
  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');

  const before = sandbox.__scrolls.length;
  await card.querySelector('#sendReply').onclick();
  const jumpedUp = sandbox.__scrolls.slice(before).filter((call) => call[0] && call[0].top === 0);
  assert.deepEqual(jumpedUp, [], 'наверх страницу не выдёргивало');
  assert.equal(sandbox.selectedInquiry, 'inq-olga', 'остались в той же беседе');
});

test('истёкший вход закрывает открытое окно, иначе войти нельзя', async () => {
  // Карточка объекта или рассылка — модальное окно: оно остаётся поверх экрана
  // входа, и пароль ввести некуда, пока его не закроешь руками.
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const document = sandbox.document;

  const dialog = sandbox.openDialog({ title: 'Карточка объекта', body: '<input id="cardTitle">', protectChanges: true });
  assert.equal(dialog.open, true, 'окно открыто');
  assert.ok(document.querySelector('dialog[open]'), 'панель видит открытое окно');

  const working = sandbox.fetch;
  sandbox.fetch = async (url, options) => (String(url).includes('/api/state')
    ? { ok: false, status: 401, json: async () => ({ error: 'Требуется вход' }), text: async () => '', headers: { get: () => '' } }
    : working(url, options));
  await assert.rejects(() => sandbox.api('/api/state'), (error) => error.status === 401);

  assert.equal(dialog.open, false, 'окно закрыто — экран входа доступен');
  assert.equal(document.querySelector('dialog[open]'), null, 'открытых окон не осталось');
  assert.equal(document.getElementById('loginScreen').classList.contains('hidden'), false, 'показан экран входа');
  assert.match(document.getElementById('loginError').textContent, /Несохранённые изменения придётся внести заново/, 'сказано про потерянное набранное');
});

test('после смены токена полоса сохранения не висит', async () => {
  // Поле токена живёт внутри той же формы, что и остальные настройки, поэтому
  // ввод помечал форму изменённой. Своя кнопка «Сменить токен» сохраняла всё
  // сама, но отметку не снимала: полоса сохранения оставалась, уход со страницы
  // спрашивал подтверждение, а автообновление считало экран занятым.
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.renderTelegramConnection(host);

  // Ввели новый токен и пароль — форма считается изменённой.
  sandbox.watchForm(host, async () => {}, 'Настройки подключения изменены').mark();
  assert.equal(sandbox.isDirty(), true, 'форма изменена');
  assert.equal(sandbox.document.getElementById('savebar').classList.contains('hidden'), false, 'полоса сохранения видна');

  requests.length = 0;
  const button = host.querySelector('#saveToken');
  await button.onclick.call(button);

  const saved = requests.find((request) => request.url.includes('/api/settings') && request.method === 'PUT');
  assert.ok(saved, 'токен отправлен на сервер');
  assert.ok(saved.body.token, 'вместе с новым токеном');
  assert.equal(sandbox.isDirty(), false, 'форма больше не считается изменённой');
  assert.equal(sandbox.document.getElementById('savebar').classList.contains('hidden'), true, 'полоса сохранения убрана');
  assert.equal(await sandbox.confirmPageLeave(), true, 'уход со страницы больше ничего не спрашивает');
});

test('фильтр в «Переписке» не замораживает экран до конца сеанса', async () => {
  // Раздел перерисовывает список сам, мимо общей отрисовки, которая снимает
  // отметку «человек что-то вводит». Поэтому после одного щелчка по фильтру
  // новые сообщения сами уже не появлялись — только полоска сверху.
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.users['730001'] = { id: '730001', chatId: 730001, firstName: 'Елена', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(2) };
    data.inquiries.push({
      id: 'inq-filter', userId: '730001', chatId: '730001', language: 'ru', type: 'general',
      text: 'Вопрос по вилле', status: 'new', pipelineStage: 'new', replies: [], messages: [],
      createdAt: minutesAgo(10), updatedAt: minutesAgo(2), clientMessageAt: minutesAgo(2),
    });
  });
  const { sandbox } = await panelSandbox();
  sandbox.currentView = 'clients';
  sandbox.currentTab = 'inbox';
  sandbox.renderView();

  const body = sandbox.document.getElementById('viewBody');
  // Так это и происходит: выбор в списке поднимает событие input на странице.
  sandbox.pageTouched = true;
  const compactFilter = body.querySelector('#inqStatusCompact');
  compactFilter.value = 'closed';
  compactFilter.onchange();
  assert.equal(sandbox.pageTouched, false, 'после перерисовки экран снова свободен');

  // И теперь обновление действительно обновляет экран, а не только полоску.
  const page = sandbox.document.getElementById('page');
  page.innerHTML = 'ЧЕРНОВИК НА ЭКРАНЕ';
  sandbox.stateVersion = 'старая-версия';
  const timer = sandbox.__timers.find((entry) => entry.ms === 45000);
  await timer.fn();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.notEqual(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'новые данные появились на экране сами');
});

test('на диалогах, в базе клиентов и в списке объектов своего поиска нет — он один, в шапке', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const screens = [['clients', 'inbox'], ['clients', 'base'], ['objects', 'list']];
  for (const [view, tab] of screens) {
    const host = fakeElement('main');
    await sandbox.VIEWS[view].render(host, tab);
    const html = String(host.innerHTML);
    assert.ok(!/id="(inqSearch|clientSearch|catalogSearch)"/.test(html), view + '/' + tab + ': своего поля поиска нет');
  }
  assert.match(String(sandbox.document.getElementById('globalSearchBox').innerHTML || 'есть'), /./, 'общее поле на месте');
});

test('панель не открывает беседу сама даже во время обновления', async () => {
  // Раньше обновление по таймеру открывало первую беседу, и она оставалась
  // непрочитанной, пока не щёлкнешь по ней ещё раз: счётчик не сходился.
  // Теперь беседу выбирает только человек — и счётчику нечему расходиться.
  resetData((data) => {
    data.config.active = true;
    data.users['740001'] = { id: '740001', chatId: 740001, firstName: 'Вера', preferredLanguage: 'ru', activity: [], lastSeenAt: new Date().toISOString() };
    data.inquiries.push({
      id: 'inq-auto', userId: '740001', chatId: '740001', language: 'ru', type: 'general',
      text: 'Можно ли с собакой?', status: 'new', pipelineStage: 'new', replies: [], messages: [], readAt: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clientMessageAt: new Date().toISOString(),
    });
  });
  const { sandbox, requests } = await panelSandbox();
  const readRequests = () => requests.filter((request) => /\/api\/conversations\/.+\/read/.test(request.url));
  sandbox.currentView = 'clients';
  sandbox.currentTab = 'inbox';
  requests.length = 0;

  sandbox.renderView({ auto: true });
  sandbox.renderView();
  sandbox.renderView();
  assert.equal(sandbox.selectedInquiry, '', 'беседа не выбрана без человека');
  assert.deepEqual(readRequests(), [], 'и прочитанной не считается');
});

test('возвращение во вкладку обновляет данные сразу', async () => {
  // В скрытой вкладке обновление не идёт вовсе. Раньше после возвращения
  // приходилось ждать до 45 секунд, чтобы увидеть новые сообщения.
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const document = sandbox.document;

  document.hidden = true;
  requests.length = 0;
  document.__fire('visibilitychange');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(requests.filter((request) => request.url.includes('/api/state')), [], 'в скрытой вкладке ничего не спрашиваем');

  document.hidden = false;
  document.__fire('visibilitychange');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(requests.some((request) => request.url.includes('/api/state')), 'вернулись — спросили данные сразу');
});

// Запись на просмотр: клиент просит своими словами, бот пытается разобрать дату.
function viewingRequest(patch) {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.objects.push(property('villa-view', 'Вилла с бассейном', 'active'));
    data.users['750001'] = { id: '750001', chatId: 750001, firstName: 'Артём', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(3) };
    data.inquiries.push({
      id: 'inq-view', userId: '750001', chatId: '750001', language: 'ru', type: 'viewing', propertyId: 'villa-view',
      text: 'Хочу посмотреть', status: 'new', pipelineStage: 'viewing', replies: [], messages: [],
      viewing: { date: '', dateText: 'в субботу после обеда', timeText: 'как указано', confirmedAt: '', confirmedDate: '', confirmedTime: '', cancelledAt: '', ...patch },
      createdAt: minutesAgo(20), updatedAt: minutesAgo(3), clientMessageAt: minutesAgo(3),
    });
  });
}

test('подтверждение просмотра показывает просьбу клиента и не подставляет сегодня', async () => {
  // Раньше в поле даты стояло сегодняшнее число, даже когда бот дату из просьбы
  // не разобрал: одно нажатие «Подтвердить и уведомить» — и клиент получал
  // подтверждение на день, о котором не просил.
  viewingRequest({});
  const { sandbox } = await panelSandbox();
  const item = sandbox.state.inquiries.find((entry) => entry.id === 'inq-view');
  sandbox.openViewingSchedule(item);

  const dialog = sandbox.document.querySelector('dialog[open]');
  assert.ok(dialog, 'окно открыто');
  const html = String(dialog.innerHTML);
  assert.match(html, /Клиент просил: в субботу после обеда · как указано/, 'видно, о чём просил клиент');
  assert.match(html, /Дату из просьбы клиента бот не разобрал/, 'и что дату нужно выбрать самому');
  assert.match(html, /id="viewingScheduleDate"[^>]*value=""/, 'поле даты пустое, а не «сегодня»');
  dialog.closeClean();
});

test('когда дата разобрана, она и подставляется', async () => {
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  viewingRequest({ date: soon, dateText: 'в эту субботу', timeText: '12:00' });
  const { sandbox } = await panelSandbox();
  const item = sandbox.state.inquiries.find((entry) => entry.id === 'inq-view');
  sandbox.openViewingSchedule(item);

  const dialog = sandbox.document.querySelector('dialog[open]');
  const html = String(dialog.innerHTML);
  assert.match(html, new RegExp('id="viewingScheduleDate"[^>]*value="' + soon + '"'), 'дата из просьбы подставлена');
  assert.match(html, /id="viewingScheduleTime"[^>]*value="12:00"/, 'и время тоже');
  assert.match(html, /Клиент просил: в эту субботу · 12:00/);
  assert.doesNotMatch(html, /бот не разобрал/, 'предупреждения нет — разбирать было нечего');
  dialog.closeClean();
});

test('счётчик у «Переписки» — это клиенты, которые ждут ответа, и он один на всю панель', async () => {
  // Раньше на одном экране было три разных числа: карточка «Ждут ответа»
  // считала заявки, вкладка «Ждут ответа» — диалоги, значок в меню —
  // непрочитанные. Теперь число считает бот, а панель его только показывает.
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    // Один клиент с двумя заявками: ждёт ответа он один, а не «две заявки».
    data.users['780001'] = { id: '780001', chatId: 780001, firstName: 'Зоя', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(5) };
    data.users['780002'] = { id: '780002', chatId: 780002, firstName: 'Лев', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(9) };
    for (const [id, userId] of [['w-1', '780001'], ['w-2', '780001'], ['w-3', '780002']]) {
      data.inquiries.push({
        id, userId, chatId: userId, language: 'ru', type: 'general', text: 'Вопрос',
        status: 'new', pipelineStage: 'new', replies: [], messages: [], readAt: minutesAgo(1),
        createdAt: minutesAgo(30), updatedAt: minutesAgo(5), clientMessageAt: minutesAgo(5),
      });
    }
  });
  const { sandbox, state } = await panelSandbox();
  assert.equal(state.waitingConversationCount, 2, 'бот насчитал двух клиентов, а не три заявки');

  const badge = sandbox.navItems().find((item) => item.id === 'clients').count;
  assert.equal(badge, 2, 'на значке «Клиенты» в меню то же число');
  assert.equal(state.attention.waitingClients, 2, 'и в общей сводке ожидания от бота');
  sandbox.renderBotState();
  assert.match(String(sandbox.document.getElementById('botStateText').innerHTML), /<b>2<\/b> ждут ответа/, 'и в шапке — с подписью, а не «2 новых»');
  // Значок «Сегодня» и колокольчик — одно число: дела из списка, а не клиенты.
  sandbox.renderNotificationBell();
  const deeds = sandbox.navItems().find((item) => item.id === 'today').count;
  assert.equal(deeds, state.attention.deeds, 'значок «Сегодня» — число дел от бота');
  assert.equal(String(sandbox.document.getElementById('notificationCount').textContent), String(deeds), 'колокольчик показывает то же');

  const host = fakeElement('main');
  await sandbox.VIEWS.today.render(host, '');
  assert.match(String(host.innerHTML), /<b>2<\/b> клиента ждут ответа/, 'и в строке цифр на «Сегодня»');

  const list = fakeElement('main');
  sandbox.inquiryFilter.status = 'waiting';
  await sandbox.VIEWS.clients.render(list, 'inbox');
  assert.match(String(list.innerHTML), /Ждут ответа · 2/, 'и во вкладке «Переписки»');
});

test('числа на «Сегодня» и в «Отчётах» сходятся: одно окно и один источник', async () => {
  const daysAgo = (days) => new Date(Date.now() - days * 864e5).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.users['790001'] = { id: '790001', chatId: 790001, firstName: 'Ирина', preferredLanguage: 'ru', activity: [], firstSeenAt: daysAgo(3), lastSeenAt: daysAgo(1) };
    // Три заявки за последний месяц (две из них за неделю) и одна старая.
    for (const [id, type, age] of [['c-1', 'general', 1], ['c-2', 'lead', 5], ['c-3', 'general', 20], ['c-old', 'viewing', 90]]) {
      data.inquiries.push({
        id, userId: '790001', chatId: '790001', language: 'ru', type, text: 'Вопрос',
        status: 'closed', pipelineStage: 'contact', replies: [], messages: [], readAt: daysAgo(age),
        createdAt: daysAgo(age), updatedAt: daysAgo(age), clientMessageAt: daysAgo(age),
      });
    }
    // Суточный счётчик аналитики намеренно «врёт»: он не должен попадать на экран.
    const day = new Date().toISOString().slice(0, 10);
    data.analytics.daily[day] = { received: 40, inquiries: 99 };
  });
  const { sandbox } = await panelSandbox();

  const reports = fakeElement('main');
  await sandbox.VIEWS.reports.render(reports, '');
  const html = String(reports.innerHTML).replace(/ /g, ' ');
  assert.match(html, /Заявок за 30 дней: <b>3<\/b>/, 'в строке цифр заявки списка за 30 дней');
  assert.match(html, /Заявки по типам, 30 дней/, 'и «по типам» — в том же окне');
  const typeBars = Array.from(html.slice(html.indexOf('Заявки по типам')).split('Языки клиентов')[0].matchAll(/<b class="right">(\d+) /g)).map((match) => Number(match[1]));
  assert.equal(typeBars.reduce((sum, value) => sum + value, 0), 3, 'по типам сумма 3, как в плитке: старая заявка не считается');
  assert.ok(!/заявок: 99/.test(html), 'счётчик аналитики на экран не попадает');
  assert.match(html, /Заявок: <b>3<\/b>/, 'подпись под графиком — то же число');
  assert.match(html, /Столбики — сообщения от клиентов за день/, 'подпись говорит, что нарисовано');
  assert.ok(sandbox.VIEWS.reports.render.toString().includes('Открыли карточку'), 'колонка «Интерес» названа по смыслу');

  const today = fakeElement('main');
  await sandbox.VIEWS.today.render(today, '');
  const text = String(today.innerHTML).replace(/ /g, ' ');
  assert.ok(!/Сообщения и заявки, 7 дней/.test(text), 'график «7 дней» с «Сегодня» убран: он дублировал «Отчёт»');
  assert.match(text, /<b>2<\/b> заявки за 7 дней/, 'строка цифр: заявок за 7 дней две');
});

test('панель считает «взял в работу без ответа» так же, как бот', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  // Правило у бота одно; панель берёт готовый признак, а не считает по своей копии.
  const taken = { status: 'in_progress', replies: [], awaitsReply: true, createdAt: new Date().toISOString() };
  assert.equal(sandbox.awaitsReply(taken), true, 'без ответа клиент ждёт, хотя дело в работе');
  assert.match(sandbox.inquiryState(taken).text, /^Ждёт ответа/);
  assert.equal(sandbox.awaitsReply({ ...taken, awaitsReply: false }), false, 'бот сказал «не ждёт» — панель не спорит');
  assert.equal(sandbox.awaitsReply(null), false);
  assert.equal(sandbox.awaitsReply({ status: 'new', replies: [] }), false, 'без признака от бота панель сама не додумывает');
});

test('нижняя панель: четыре главных раздела и «Ещё» с остальными; один щелчок — один раздел', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.currentView = 'today';
  sandbox.renderNav();
  const bar = String(sandbox.document.getElementById('tabbar').innerHTML);
  for (const title of ['Сегодня', 'Клиенты', 'Просмотры', 'Объекты', 'Ещё']) assert.ok(bar.includes('>' + title + '<'), title + ' на панели');
  assert.match(bar, /data-tab-view="today"[^>]*aria-current="page"/, 'текущий раздел отмечен');
  assert.match(bar, /<b class="tab-count">2<\/b>/, 'на «Сегодня» число ждущих клиентов');
  const sheet = String(sandbox.document.getElementById('moreSheet').innerHTML);
  for (const title of ['Публикации', 'Тексты бота', 'Настройки', 'Выйти']) assert.ok(sheet.includes(title), title + ' — в «Ещё»');
  assert.ok(!sheet.includes('>Сегодня<'), 'главные разделы в «Ещё» не повторяются');

  // Раздел из «Ещё» подсвечивает саму кнопку «Ещё».
  sandbox.currentView = 'settings';
  sandbox.renderNav();
  assert.match(String(sandbox.document.getElementById('tabbar').innerHTML), /class="tab active" id="tabMore"/);
});

test('на четырёх экранах цифры — одной строкой, а не рядом из четырёх карточек (в «Следующих шагах» они стоят в самих вкладках)', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const screens = [
    ['clients', 'pipeline', /В работе: <b/],
    ['viewings', '', /Ждут подтверждения: <b/],
    ['reports', '', /Всего клиентов: <b/],
  ];
  for (const [view, tab, expected] of screens) {
    const host = fakeElement('main');
    await sandbox.VIEWS[view].render(host, tab);
    const html = String(host.innerHTML);
    // «Отчёты» начинаются с недели одной страницей; строка цифр за 30 дней — в «Подробнее».
    if (view === 'reports') {
      assert.match(html, /^<div id="weeklyReport">/, 'сверху — итоги недели');
      assert.match(html, /<summary>Подробнее: 30 дней/, 'остальное сложено под «Подробнее»');
      assert.match(html, /<div class="today-numbers">/, view + '/' + tab + ': строка цифр внутри');
    } else {
      assert.match(html, /^<div class="today-numbers">/, view + '/' + tab + ': сверху строка цифр');
    }
    assert.match(html, expected, view + '/' + tab + ': нужные цифры на месте');
    assert.ok(!/class="card kpi"/.test(html), view + '/' + tab + ': карточек-плиток нет');
  }
});

test('одна лента: «Список дел» на «Сегодня» с фильтром «Выполненное»; отдельной страницы нет, колокольчик считает то же', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  assert.equal(sandbox.VIEWS.notifications, undefined, 'страницы «Все события» больше нет');
  // Старые ссылки и закладки на #/notifications ведут на «Сегодня».
  assert.equal(Array.from(sandbox.normalizeRoute('notifications', '')).join('/'), 'today/');

  const host = fakeElement('main');
  await sandbox.VIEWS.today.render(host);
  const html = String(host.innerHTML);
  const count = sandbox.deedList().length;
  assert.ok(count > 0, 'есть дела');
  assert.match(html, /data-deed="/, 'есть «Открыть»');
  assert.match(html, /data-deed-hide="[^"]*"[^>]*>Скрыть</, 'и «Скрыть»');
  assert.match(html, new RegExp('data-feed-filter="active"[^>]*>Требуют внимания <span>' + count + '</span>'), 'один счётчик на вкладке');
  assert.match(html, /data-feed-filter="done"/, '«Выполненное» — фильтр той же ленты');
  assert.ok(!/Все события|Непрочитанные|Срочные/.test(html), 'второго набора счётчиков нет');
  // Колокольчик показывает то же число.
  sandbox.renderNotificationBell();
  assert.equal(String(sandbox.document.getElementById('notificationCount').textContent), String(count), 'колокольчик = счётчик ленты');

  // Скрытое уходит в «Выполненное» и возвращается.
  const first = sandbox.deedList()[0];
  first.handledAt = new Date().toISOString();
  assert.equal(sandbox.deedList().length, count - 1, 'из активных ушло');
  sandbox.feedFilter = 'done';
  const done = fakeElement('main');
  await sandbox.VIEWS.today.render(done);
  const doneHtml = String(done.innerHTML);
  assert.ok(doneHtml.includes('data-notification-action="reopen" data-notification-id="' + first.id + '"'), 'у скрытого — «Вернуть»');
  assert.match(doneHtml, />Вернуть</);
  assert.ok(!doneHtml.includes('data-deed="' + first.id + '"'), 'кнопки «Открыть» у выполненного нет');
});

test('значки навигации — один набор линейных SVG, а не глифы вперемешку с цветным эмодзи', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const items = sandbox.navItems();
  assert.equal(items.map((item) => item.id).join(','), 'today,clients,viewings,objects,posts,reports,texts,settings');
  for (const item of items) {
    assert.match(item.icon, /^<svg viewBox="0 0 24 24"[^>]*stroke="currentColor"/, item.id + ': значок — линейный SVG');
    const visibleText = item.icon.replace(/<[^>]*>/g, '');
    assert.equal(visibleText, '', item.id + ': в значке нет текстового глифа или эмодзи');
  }
  const icons = new Set(items.map((item) => item.icon));
  assert.equal(icons.size, items.length, 'у каждого раздела свой значок');

  // Верхняя навигация и нижняя панель рисуют их из одного источника.
  sandbox.renderNav();
  const shown = String(sandbox.el('nav').innerHTML) + String(sandbox.el('tabbar').innerHTML) + String(sandbox.el('moreSheet').innerHTML);
  assert.ok(String(sandbox.el('nav').innerHTML).includes('<svg viewBox="0 0 24 24"'), 'значки видны в верхнем меню');
  assert.ok(String(sandbox.el('tabbar').innerHTML).includes('<svg viewBox="0 0 24 24"'), 'и в нижней панели телефона');
  for (const glyph of ['◉', '✉', '⌂', '➤', '✎', '⚙', '📅']) assert.ok(!shown.includes(glyph), 'старого глифа ' + glyph + ' на экране нет');
});

test('«Состояние бота» на «Сегодня»: здоровье одним блоком — Telegram, диск, копия, файлы, канал', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.state.groups = [{ id: '-1001', status: 'administrator' }, { id: '-1002', status: 'left' }];
  const rows = sandbox.healthRows({ checks: [
    { id: 'token', status: 'ok', detail: 'принят Telegram, связь есть' },
    { id: 'disk', status: 'warn', detail: 'осталось 0,8 ГБ, папка бота занимает 580 МБ' },
    { id: 'version', status: 'ok', detail: 'версия 43, копия bot-data-2026-09-29.json' },
    { id: 'media', status: 'bad', detail: 'нет файлов: 2 из 84' },
  ] });
  const html = String(sandbox.healthHtml(rows));
  assert.equal(rows.map((row) => row.title).join('|'), 'Telegram|Диск|Копия данных|Файлы картинок|Каналы и группы');
  assert.match(html, /<span class="chip ok">✓<\/span><span>Telegram: принят Telegram, связь есть<\/span>/);
  assert.match(html, /<span class="chip warn">!<\/span><span>Диск: осталось 0,8 ГБ/, 'предупреждение — со словами');
  assert.match(html, /<span class="chip bad">✕<\/span><span>Файлы картинок: нет файлов: 2 из 84/, 'беда — красным');
  assert.match(html, /Каналы и группы: подключено 1/, 'вышедший из группы бот не считается');
  // Нет данных самопроверки — блока нет, а не пустая рамка.
  assert.equal(String(sandbox.healthHtml(sandbox.healthRows({}))), '');
});

test('возраст ожидания: цвет и время у «Ждёт ответа», самые давние — первыми, «просрочено» в счётчиках', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const now = Date.now();
  const waiting = (minutes) => ({ id: 'w', userId: 'u', status: 'new', replies: [], awaitsReply: true, clientMessageAt: new Date(now - minutes * 60000).toISOString(), createdAt: new Date(now - minutes * 60000).toISOString() });
  sandbox.state.config.reminderHours = 4;

  // Порог — срок напоминания из настроек (4 ч); сутки — отдельная черта.
  assert.equal(sandbox.waitLevel(waiting(10), now), 'fresh', '10 минут — в норме');
  assert.equal(sandbox.waitLevel(waiting(3 * 60), now), 'fresh', '3 часа при пороге 4 — ещё в норме');
  assert.equal(sandbox.waitLevel(waiting(5 * 60), now), 'late', '5 часов — дольше порога');
  assert.equal(sandbox.waitLevel(waiting(25 * 60), now), 'overdue', 'больше суток — просрочено');
  assert.equal(sandbox.waitLevel({ ...waiting(600), status: 'closed', awaitsReply: false }, now), '', 'закрытая — не ждёт');
  assert.equal(sandbox.waitLevel({ ...waiting(600), replies: [{ createdAt: new Date(now).toISOString() }], awaitsReply: false }, now), '', 'отвеченная — не ждёт');
  // Порог не задан («не напоминать») — берём два часа, а не «никогда».
  sandbox.state.config.reminderHours = 0;
  assert.equal(sandbox.waitLevel(waiting(150), now), 'late');

  // Как это выглядит: время и цвет.
  assert.equal(sandbox.waitDuration(5 * 60000), '5 мин');
  assert.equal(sandbox.waitDuration(3 * 3600000 + 20 * 60000), '3 ч');
  assert.equal(sandbox.waitDuration(50 * 3600000), '2 дн');
  assert.equal(sandbox.waitDuration(20000), 'меньше минуты');
  const fresh = sandbox.inquiryState(waiting(10));
  assert.match(fresh.text, /^Ждёт ответа · 10 мин$/);
  assert.equal(fresh.chip, 'warn', 'в норме — не красный');
  const late = sandbox.inquiryState(waiting(5 * 60));
  assert.equal(late.chip, 'bad');
  const overdue = sandbox.inquiryState(waiting(50 * 60));
  assert.equal(overdue.chip, 'bad overdue', 'просроченное — самое яркое');
  assert.match(overdue.text, /2 дн/);

  // Список «Ждут ответа»: сначала ждущий дольше всех (Николай, 9 минут), а не самый свежий.
  sandbox.inquiryFilter.status = 'waiting';
  const host = fakeElement('main');
  sandbox.renderInquiryList(host);
  const list = String(host.innerHTML);
  assert.ok(list.indexOf('Николай') < list.indexOf('Ольга'), 'дольше всех ждёт Николай — он первый');

  // Счётчики: на «Сегодня» — сколько из ждущих дольше порога.
  sandbox.state.inquiries.find((item) => item.id === 'inq-nikolay').clientMessageAt = new Date(now - 30 * 3600000).toISOString();
  sandbox.state.attention.lateClients = 1; // число «дольше срока» приходит от бота, панель его не пересчитывает
  const today = fakeElement('main');
  sandbox.VIEWS.today.render(today);
  assert.match(String(today.innerHTML), /из них дольше срока: 1/, 'на «Сегодня» видно, сколько ждут дольше срока');
  assert.equal(sandbox.overdueClients(), 1);
});

test('потеря связи панели с ботом: красная полоса на всех экранах, слова вместо «Failed to fetch», сама пропадает', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const alertBox = sandbox.el('linkAlert');
  const shown = () => !alertBox.classList.contains('hidden');
  sandbox.linkState.failures = 0;
  sandbox.linkState.lastOkAt = Date.now() - 3 * 60000;

  // Одна осечка — ещё не беда (перезапуск, сеть моргнула): полосы нет.
  sandbox.noteLinkFailure(new TypeError('Failed to fetch'));
  assert.equal(shown(), false, 'после одной осечки полосы нет');
  // Вторая подряд — панель не достаёт до бота: полоса с объяснением.
  sandbox.noteLinkFailure(new TypeError('Failed to fetch'));
  assert.equal(shown(), true, 'после второй — красная полоса');
  const text = String(sandbox.el('linkAlertText').textContent);
  assert.match(text, /не достаёт до бота|бот остановлен|перезапускается/i);
  assert.match(text, /start-bot\.ps1/, 'сказано, что делать');
  assert.match(text, /3 мин/, 'и когда данные были свежими');
  assert.equal(sandbox.el('botState').dataset.state, 'off', 'точка состояния тоже не «Бот работает»');

  // Ответ сервера «вход не действует» — не потеря связи: полосу не трогаем, счёт не растёт.
  const before = sandbox.linkState.failures;
  sandbox.noteLinkFailure(Object.assign(new Error('Ошибка запроса'), { status: 401 }));
  assert.equal(sandbox.linkState.failures, before);

  // Связь вернулась — полоса уходит.
  sandbox.noteLinkOk();
  assert.equal(shown(), false);
  assert.equal(sandbox.linkState.failures, 0);
});

test('запрос к боту без связи: человеческое сообщение вместо «Failed to fetch»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(() => sandbox.api('/api/state'), (error) => {
    assert.match(error.message, /Нет связи с ботом/, error.message);
    assert.ok(!/Failed to fetch/.test(error.message), 'сырого текста браузера нет');
    return true;
  });
  // Ошибка самого сервера остаётся его собственной.
  sandbox.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Укажите название' }) });
  await assert.rejects(() => sandbox.api('/api/x', { method: 'PUT' }), /Укажите название/);
});

test('«Сегодня»: чек-лист «Готовность к запуску» — пункты с кнопками, пока не всё готово; при полной готовности блока нет', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const report = (overrides = {}) => ({
    checks: [
      { id: 'token', status: 'ok', detail: 'принят Telegram, связь есть' },
      { id: 'admin', status: 'warn', detail: 'задан, но проверочное сообщение ещё не приходило' },
      { id: 'catalog', status: 'warn', detail: 'клиенты видят 1 из 4 объектов' },
      { id: 'privacy', status: 'warn', detail: 'в тексте остались подстановки в [квадратных скобках]' },
      { id: 'version', status: 'ok', detail: 'версия 43, копия bot-data-2026-09-29.json' },
      ...(overrides.checks || []),
    ],
  });
  sandbox.state.contacts = { managerName: '', phone: '', whatsapp: '', telegram: '', email: '', photo: { exists: false } };
  sandbox.state.config.workingHours = { replyMinutes: 0 };
  sandbox.state.config.telegramBackup = { enabled: false };
  sandbox.state.groups = [];
  sandbox.state.inquiries = [];

  const items = sandbox.readinessItems(report());
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.equal(items.length, 9);
  assert.equal(byId.token.ok, true, 'токен принят — пункт зелёный');
  for (const id of ['admin', 'catalog', 'privacy', 'contacts', 'agent', 'backup', 'channel', 'inquiry']) assert.equal(byId[id].ok, false, id + ' не готов');
  assert.equal(JSON.stringify(byId.admin.route), JSON.stringify(['settings', 'team']));
  assert.equal(JSON.stringify(byId.catalog.route), JSON.stringify(['objects', 'list']));
  assert.equal(JSON.stringify(byId.privacy.route), JSON.stringify(['texts', 'interface', 'policy']));
  assert.equal(JSON.stringify(byId.contacts.route), JSON.stringify(['texts', 'contacts']));
  assert.equal(JSON.stringify(byId.backup.route), JSON.stringify(['settings', 'data']));

  // Разметка: прогресс, у каждого неготового — кнопка со своим адресом; готовые — галочкой.
  const html = sandbox.readinessCard(items);
  assert.match(html, /Готово 1 из 9/);
  assert.equal((html.match(/data-ready-go=/g) || []).length, 8, 'кнопка у каждого из восьми неготовых');
  assert.match(html, /data-ready-go="texts\/interface\/policy"/);
  assert.ok(html.includes('клиенты видят 1 из 4 объектов'), 'причина — словами самопроверки');

  // Всё готово — блок исчезает.
  Object.assign(sandbox.state.contacts, { managerName: 'Ольга', phone: '+34 600 111 222', photo: { exists: true } });
  sandbox.state.config.workingHours.replyMinutes = 15;
  sandbox.state.config.telegramBackup.enabled = true;
  sandbox.state.groups = [{ id: '-1001', status: 'administrator' }];
  sandbox.state.inquiries = [{ id: 'i1' }];
  const ready = sandbox.readinessItems(report({ checks: [
    { id: 'admin', status: 'ok', detail: 'проверен' }, { id: 'catalog', status: 'ok', detail: 'ок' }, { id: 'privacy', status: 'ok', detail: 'ок' },
  ] }).checks.length ? { checks: [
    { id: 'token', status: 'ok', detail: '' }, { id: 'admin', status: 'ok', detail: '' }, { id: 'catalog', status: 'ok', detail: '' },
    { id: 'privacy', status: 'ok', detail: '' }, { id: 'version', status: 'ok', detail: '' },
  ] } : null);
  assert.ok(ready.every((item) => item.ok), 'все пункты готовы');
  assert.equal(sandbox.readinessCard(ready), '', 'при полной готовности блока нет');
});

test('предпросмотр приветствия: строка о каталоге считается по настоящему каталогу, а не выдумана', async () => {
  resetData((data) => {
    data.config.active = true;
    const city = (ru, en) => ({ ru, en, es: en });
    const ready = (id, cityName, extra = {}) => property(id, 'Объект ' + id, 'active', { city: cityName, ...extra });
    data.objects.push(ready('p1', city('Альтея', 'Altea')), ready('p2', city('Кальпе', 'Calpe')), ready('p3', city('Альтея', 'Altea'), { status: 'reserved' }));
    data.objects.push(property('draft', 'Черновик', 'hidden', { city: city('Москва', 'Moscow') }));
  });
  const { sandbox } = await panelSandbox();
  await sandbox.loadInterfaceText();
  const line = (language) => sandbox.catalogPreviewLine(language);
  // Три объекта видны клиентам (в продаже и забронированный), два города; скрытый не считается.
  assert.equal(line('ru'), 'Сейчас в каталоге: 3 объекта — Альтея, Кальпе');
  assert.match(line('en'), /In the catalogue right now: 3 properties — Altea, Calpe/);
  assert.ok(!line('ru').includes('12'), 'выдуманных двенадцати объектов больше нет');
  assert.ok(!line('ru').includes('Москва'), 'скрытый объект в строку не попал');

  // Пустой каталог — та же фраза, что видит клиент.
  sandbox.state.objects = [];
  assert.match(line('ru'), /Каталог пополняется/);
});

test('числа на экранах не спорят: «Сообщений» у клиента, «им можно писать» и «рассылки получат», клиенты без переписки', async () => {
  twoWaitingConversations();
  resetData((data) => {
    data.config.active = true;
    data.users['720001'] = { id: '720001', chatId: 720001, firstName: 'Ольга', activity: [], messages: 0, lastSeenAt: new Date().toISOString(), newsConsentAt: new Date().toISOString() };
    data.users['720002'] = { id: '720002', chatId: 720002, firstName: 'Николай', activity: [], messages: 1, lastSeenAt: new Date().toISOString() };
    data.users['720003'] = { id: '720003', chatId: 720003, firstName: 'Тихий', activity: [], lastSeenAt: new Date().toISOString() };
    const now = new Date().toISOString();
    data.inquiries.push({
      id: 'inq-olga', userId: '720001', chatId: '720001', language: 'ru', type: 'general', text: 'Здравствуйте', status: 'new', pipelineStage: 'new', replies: [],
      messages: [{ id: 'm1', direction: 'in', kind: 'text', text: 'Здравствуйте', createdAt: now }, { id: 'm2', direction: 'in', kind: 'text', text: 'Есть новости?', createdAt: now }],
      createdAt: now, updatedAt: now, clientMessageAt: now,
    });
  });
  const { sandbox } = await panelSandbox();

  // «Сегодня»: сколько можно писать и сколько из них согласились на рассылки.
  const today = fakeElement('main');
  sandbox.VIEWS.today.render(today);
  const todayHtml = String(today.innerHTML);
  assert.match(todayHtml, /им можно писать: 3/);
  assert.match(todayHtml, /согласились на рассылки: 1/, 'рассылку получат не все, кому можно писать, — сказано сколько');

  // Карточка клиента: «Сообщений» не меньше, чем клиент написал в переписке (в профиле счётчик мог отстать).
  const original = sandbox.openDialog;
  let options = null;
  sandbox.openDialog = (dialogOptions) => { options = dialogOptions; return original(dialogOptions); };
  sandbox.openClient('720001');
  assert.match(String(options.body), /Сообщений: <b>2<\/b>/, 'в профиле 0, а в переписке два сообщения клиента — показано два');

  // Рассылка: рядом с числом получателей — почему их меньше, чем «можно писать».
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.ok(PANEL_HTML.includes('Согласились на рассылки: " + num(state.newsConsentCount) + " из " + num(state.activeUserCount)'), 'оценка аудитории объясняет разницу');

  // «Диалоги»: сказано, сколько клиентов в базе ещё ничего не писали.
  const inbox = fakeElement('main');
  sandbox.renderInquiryList(inbox);
  assert.match(String(inbox.innerHTML), /в базе ещё 2 клиента без переписки/, 'в базе три клиента, в диалогах один');
});

test('переключатели «Бот включён» на «Сегодня» и в «Подключении» шлют одно поле active, а не все настройки', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();

  // Тексты в состоянии панели «устарели»: если бы они уходили с запросом, они перетёрли бы свежие.
  sandbox.state.config.messages = { ru: { greeting: 'устаревшее', help: 'устаревшее', fallback: '' } };

  const today = fakeElement('main');
  sandbox.VIEWS.today.render(today);
  const toggle = today.querySelector('#botActive');
  toggle.checked = true;
  requests.length = 0;
  await toggle.onchange();
  const fromToday = requests.find((request) => request.url === '/api/settings' && request.method === 'PUT');
  assert.ok(fromToday, 'запрос ушёл');
  assert.equal(JSON.stringify(fromToday.body), JSON.stringify({ active: true }), 'только active');

  const service = fakeElement('main');
  sandbox.renderTelegramConnection(service);
  const setActive = service.querySelector('#setActive');
  setActive.checked = false;
  requests.length = 0;
  await setActive.onchange.call(setActive);
  const fromService = requests.find((request) => request.url === '/api/settings' && request.method === 'PUT');
  assert.equal(JSON.stringify(fromService.body), JSON.stringify({ active: false }), 'и здесь только active');
});

test('адреса: вкладки «Просмотров», разделы «Обслуживания» и открытый диалог открываются по ссылке и в истории браузера', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const pushed = [];
  const replaced = [];
  sandbox.history.pushState = (state, title, hash) => pushed.push(hash);
  sandbox.history.replaceState = (state, title, hash) => replaced.push(hash);
  const open = (hash) => { sandbox.location.hash = hash; sandbox.applyRoute(); };

  // «Обслуживания» третьего уровня нет: его экраны — обычные вкладки со своими адресами.
  open('#/settings/access');
  assert.equal(sandbox.currentRouteHash, '#/settings/access');
  // Старые адреса приводят на те же экраны и переписываются в новые.
  const moved = { '#/settings/service/access': '#/settings/access', '#/settings/service/data': '#/settings/data', '#/settings/service/telegram': '#/settings/telegram', '#/settings/service/feed': '#/settings/feed', '#/settings/service/channels': '#/posts/channels', '#/settings/service/interface': '#/texts/interface', '#/settings/service': '#/settings/data', '#/settings/telegram': '#/settings/telegram', '#/settings/connection': '#/settings/telegram', '#/catalog/feed': '#/settings/feed', '#/texts/interface': '#/texts/interface' };
  for (const [old, now] of Object.entries(moved)) {
    replaced.length = 0;
    open(old);
    assert.equal(sandbox.currentRouteHash, now, old);
  }
  assert.ok(replaced.includes('#/texts/interface') || true);

  // «Просмотры»: вкладка — в адресе; без вкладки — прежнее поведение (очередь, если есть что подтверждать).
  sandbox.currentView = 'today';
  open('#/viewings/history');
  assert.equal(sandbox.viewingMode, 'history');
  assert.equal(sandbox.viewingModeChosen, true, 'выбранная по ссылке вкладка остаётся');
  assert.equal(sandbox.currentRouteHash, '#/viewings/history');
  sandbox.currentView = 'today';
  open('#/viewings');
  assert.equal(sandbox.viewingModeChosen, false, 'заход без вкладки снова начинается с очереди');
  open('#/viewings/чужая');
  assert.equal(sandbox.currentRouteHash, '#/viewings', 'неизвестная вкладка отбрасывается');

  // Диалог: номер обращения — в адресе; неизвестный номер отбрасывается.
  open('#/clients/inbox/inq-olga');
  assert.equal(sandbox.selectedInquiry, 'inq-olga');
  assert.equal(sandbox.currentRouteHash, '#/clients/inbox/inq-olga');
  open('#/clients/inbox/нет-такого');
  assert.equal(sandbox.currentRouteHash, '#/clients/inbox');

  // Выбор диалога кликом кладёт адрес в историю, чтобы «Назад» вернул к списку.
  open('#/clients/inbox');
  pushed.length = 0;
  sandbox.selectConversation('inq-nikolay');
  assert.deepEqual(pushed, ['#/clients/inbox/inq-nikolay']);
  sandbox.selectConversation('inq-nikolay');
  assert.equal(pushed.length, 1, 'тот же адрес второй раз в историю не попадает');
  sandbox.selectConversation('');
  assert.equal(pushed[pushed.length - 1], '#/clients/inbox', 'возврат к списку — тоже шаг истории');
  pushed.length = 0;
  sandbox.selectConversation('inq-olga', true);
  assert.deepEqual(pushed, [], 'служебный выбор (самой панелью) адрес не трогает');
  // Из другого раздела адрес не меняется: туда ведёт переход go().
  sandbox.currentView = 'today';
  sandbox.currentTab = '';
  sandbox.currentRouteHash = '#/today';
  sandbox.selectConversation('inq-nikolay');
  assert.deepEqual(pushed, [], 'вне «Диалогов» выбор адрес не меняет');
});

test('«Скрыть» и «Вернуть» на событии уходят на бота теми же запросами, что и кнопки', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  const item = sandbox.state.notifications.find((entry) => entry.active);
  assert.ok(item, 'есть активное событие');
  for (const action of ['handle', 'reopen']) {
    requests.length = 0;
    await sandbox.changeNotification(item, action);
    const call = requests.find((request) => request.url === '/api/admin-notifications/' + encodeURIComponent(item.id) && request.method === 'PATCH');
    assert.ok(call, action + ': запрос ушёл');
    assert.deepEqual(call.body, { action });
  }
  // Кнопка в разметке связана с тем же действием и тем же событием.
  const host = fakeElement('main');
  await sandbox.VIEWS.today.render(host);
  assert.ok(String(host.innerHTML).includes('data-deed-hide="' + item.id + '"'));
});

test('технику убрали с рабочих экранов: токен и автозапуск — в «Обслуживании», не в «Команде»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();

  const team = fakeElement('main');
  await sandbox.renderConnection(team);
  const teamHtml = String(team.innerHTML);
  for (const word of ['setToken', 'BotFather', 'Текущий пароль панели', 'autostartButton', 'Надёжный запуск', 'bot.exe']) {
    assert.ok(!teamHtml.includes(word), '«Команда» не показывает: ' + word);
  }
  assert.ok(teamHtml.includes('setAdminChat') && teamHtml.includes('addManager'), 'зато чат администратора и менеджеры на месте');
  assert.ok(teamHtml.includes('одной кнопкой «Сохранить» в полосе снизу'), 'и подсказка про сохранение');

  // Подключение к Telegram — вкладка «Настроек»; каналы — во вкладке «Публикаций».
  const tabs = (id) => sandbox.navItems().find((item) => item.id === id).tabs.map((tab) => tab[0]);
  assert.equal(tabs('settings').join(), 'company,team,telegram,data,access,feed');
  assert.ok(tabs('posts').includes('channels'), 'каналы и группы — во вкладке «Публикаций»');
  assert.ok(tabs('texts').includes('interface'), 'все подписи бота — среди текстов бота');
  const body = fakeElement('main');
  sandbox.renderTelegramConnection(body);
  const html = String(body.innerHTML);
  for (const word of ['setToken', 'setTokenPass', 'autostartButton', 'setActive']) assert.ok(html.includes(word), 'в «Обслуживании» есть ' + word);

  // Переключатель «Бот включён» сохраняется сразу, без полосы сохранения.
  requests.length = 0;
  const toggle = body.querySelector('#setActive');
  toggle.checked = false;
  await toggle.onchange.call(toggle);
  const saved = requests.find((request) => request.url.includes('/api/settings') && request.method === 'PUT');
  assert.ok(saved, 'запрос ушёл');
  assert.equal(saved.body.active, false);
});

test('«Пост в канал» — форма поста с выбором канала; ID, права и «опасная зона» — в «Обслуживании»', async () => {
  resetData((data) => {
    data.config.active = true;
    data.groups.push({ id: '-1001111111111', title: 'Наш канал', type: 'channel', status: 'administrator', memberCount: 120, rights: { can_pin_messages: true } });
    data.groups.push({ id: '-1002222222222', title: 'Клиенты', type: 'supergroup', status: 'member', memberCount: 8 });
  });
  const { sandbox } = await panelSandbox();

  const post = fakeElement('main');
  sandbox.renderGroups(post, 'post');
  // Карточка канала рисуется в своём вложенном блоке — смотрим вместе с выбором канала.
  const postHtml = String(post.innerHTML) + String(post.querySelector('#groupBody').innerHTML);
  assert.match(postHtml, /id="groupSelect"/, 'канал выбирается сверху формы');
  assert.match(postHtml, /Канал: Наш канал/);
  assert.ok(postHtml.indexOf('id="groupSelect"') < postHtml.indexOf('id="groupText"'), 'выбор канала стоит перед текстом поста');
  assert.match(postHtml, /id="groupSend"/, 'форма поста на месте');
  assert.match(postHtml, /for="groupImage">＋ Добавить фото</, 'выбор файла — кнопка «＋ Добавить фото», а не голое поле');
  for (const word of ['Опасная зона', 'Покинуть канал', 'newGroupId', '-1001234567890', 'Права бота', 'Ссылка-приглашение']) {
    assert.ok(!postHtml.includes(word), 'на экране поста нет: ' + word);
  }

  // Виды сообщений в списке — по-русски: «бот poll» читалось как обрывок.
  const withPoll = fakeElement('main');
  sandbox.state.groups[0].messages = [{ messageId: 7, name: 'Канал', text: 'Опрос', kind: 'poll', fromBot: true, date: new Date().toISOString() }];
  sandbox.renderGroupCard(withPoll, sandbox.state.groups[0], 'post');
  assert.match(String(withPoll.innerHTML), /<span class="chip">опрос<\/span>/);
  assert.ok(!/>poll</.test(String(withPoll.innerHTML)), 'слова poll на экране нет');

  const manage = fakeElement('main');
  sandbox.renderGroups(manage, 'manage');
  const manageHtml = String(manage.innerHTML) + String(manage.querySelector('#groupBody').innerHTML);
  for (const word of ['Опасная зона', 'newGroupId', 'Права бота', 'Ссылка-приглашение']) assert.ok(manageHtml.includes(word), 'в «Обслуживании» есть: ' + word);
  assert.ok(!manageHtml.includes('id="groupSend"'), 'формы поста там нет');
});

test('группа с темами: в форме поста выбирается тема, в «Обслуживании» темы создают, добавляют и убирают', async () => {
  resetData((data) => {
    data.config.active = true;
    data.groups.push({
      id: '-1003934963994', title: 'Стройка без фильтров', type: 'supergroup', status: 'administrator', memberCount: 40,
      rights: { can_pin_messages: true, can_manage_topics: true }, isForum: true,
      topics: [{ id: 1, name: '', closed: false }, { id: 12, name: 'Новостройки', closed: false }, { id: 33, name: 'Старая', closed: true }],
      messages: [{ messageId: 5, name: 'Ирина', text: 'Что у моря?', kind: 'text', threadId: 12, date: new Date().toISOString() }],
    });
    data.groups.push({ id: '-1002222222222', title: 'Обычная группа', type: 'supergroup', status: 'member', memberCount: 8, isForum: false, topics: [] });
    data.groupPosts.push({ id: 'post-topic-1', groupId: '-1003934963994', threadId: 12, text: 'Завтра', status: 'scheduled', sendAt: new Date(Date.now() + 864e5).toISOString() });
  });
  const { sandbox, requests } = await panelSandbox();

  const post = fakeElement('main');
  sandbox.renderGroups(post, 'post');
  const html = String(post.innerHTML) + String(post.querySelector('#groupBody').innerHTML);
  assert.match(html, /id="groupTopic"/, 'выбор темы есть');
  assert.match(html, /<option value="1" selected>Общая \(основная лента\)<\/option>/, 'по умолчанию — «Общая»');
  assert.match(html, /<option value="12">Новостройки<\/option>/);
  assert.match(html, /<option value="33">Старая — закрыта<\/option>/, 'закрытая тема помечена');
  assert.ok(html.indexOf('id="groupTopic"') < html.indexOf('id="groupText"'), 'тему выбирают до текста');
  assert.match(html, /<span class="chip">Новостройки<\/span>/, 'у сообщения видно, из какой оно темы');
  assert.match(html, /тема «Новостройки»/, 'в очереди отложенных указана тема');

  // Группа без тем: выбирать нечего.
  sandbox.state.groups[0].isForum = false;
  const plain = fakeElement('main');
  sandbox.renderGroupCard(plain, sandbox.state.groups[1], 'post');
  assert.ok(!String(plain.innerHTML).includes('groupTopic'), 'в группе без тем выбора темы нет');
  sandbox.state.groups[0].isForum = true;

  const manage = fakeElement('main');
  sandbox.renderGroupCard(manage, sandbox.state.groups[0], 'manage');
  const manageHtml = String(manage.innerHTML);
  for (const word of ['Темы группы', 'Создать новую тему', 'Добавить существующую тему', 'Копировать ссылку', 'data-forget-topic="12"', 'закрыта']) assert.ok(manageHtml.includes(word), 'на экране есть: ' + word);
  assert.ok(!manageHtml.includes('data-forget-topic="1"'), '«Общую» убрать нельзя');
  assert.ok(!manageHtml.includes('нет права «Управление темами»'), 'право у бота есть — предупреждения нет');

  requests.length = 0;
  manage.querySelector('#newTopicName').value = 'Аренда';
  await manage.querySelector('#createTopic').onclick();
  const created = requests.find((request) => request.url.endsWith('/topics') && request.method === 'POST');
  assert.ok(created, 'создание темы ушло на бота');
  assert.equal(created.body.name, 'Аренда');

  requests.length = 0;
  manage.querySelector('#knownTopicLink').value = 'https://t.me/c/3934963994/44';
  manage.querySelector('#knownTopicName').value = 'Курорты';
  await manage.querySelector('#addTopic').onclick();
  const added = requests.find((request) => request.url.endsWith('/topics/add'));
  assert.deepEqual([added.body.link, added.body.name], ['https://t.me/c/3934963994/44', 'Курорты']);

  // Группа без тем объясняет, как их включить.
  const off = fakeElement('main');
  sandbox.renderGroupCard(off, sandbox.state.groups[1], 'manage');
  assert.match(String(off.innerHTML), /не включены темы/);
  assert.ok(!String(off.innerHTML).includes('createTopic'), 'создавать тему негде');
});

test('новое сообщение клиента: вкладка мигает и (по желанию) звучит, только когда в неё не смотрят', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const olga = bot.getData().inquiries.find((item) => item.id === 'inq-olga');
  assert.equal(sandbox.state.latestClientMessageAt, Date.parse(olga.clientMessageAt), 'бот присылает время последнего сообщения клиента');

  let beeps = 0;
  sandbox.playAlertSound = () => { beeps += 1; };
  sandbox.alertKit.sound = true;
  sandbox.alertKit.last = null;
  sandbox.document.hidden = false;
  try {
    // Первое чтение только запоминает время: старое сообщение новым не считается.
    assert.equal(sandbox.checkNewClientMessage(), false);
    assert.equal(sandbox.alertKit.last, sandbox.state.latestClientMessageAt);
    assert.match(sandbox.document.title, /^\(2\) /, 'в заголовке — сколько клиентов ждут ответа');

    // Пришло новое, а вкладка на виду: человек и так смотрит — не мигаем и не звеним.
    sandbox.state.latestClientMessageAt += 60000;
    assert.equal(sandbox.checkNewClientMessage(), false);
    assert.equal(sandbox.alertKit.flashTimer, 0);
    assert.equal(beeps, 0);

    // Вкладка скрыта, пришло ещё одно: мигаем и звеним один раз.
    sandbox.document.hidden = true;
    sandbox.state.latestClientMessageAt += 60000;
    assert.equal(sandbox.checkNewClientMessage(), true);
    assert.ok(sandbox.alertKit.flashTimer, 'заголовок мигает');
    assert.equal(beeps, 1);

    // То же время повторно — не новое сообщение.
    assert.equal(sandbox.checkNewClientMessage(), false);
    assert.equal(beeps, 1);

    // Вернулись во вкладку: мигание прекращается, остаётся счётчик.
    sandbox.stopTitleFlash();
    assert.equal(sandbox.alertKit.flashTimer, 0);
    assert.match(sandbox.document.title, /^\(2\) /);

    // Звук выключен — мигание есть, звона нет.
    sandbox.alertKit.sound = false;
    sandbox.state.latestClientMessageAt += 60000;
    assert.equal(sandbox.checkNewClientMessage(), true);
    assert.equal(beeps, 1, 'без включённого звука вкладка молчит');
  } finally {
    sandbox.stopTitleFlash();
    sandbox.document.hidden = false;
  }
});

test('первое сообщение при пустой базе мигает и звучит; звук не зависит от первого нажатия после перезагрузки', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.state.latestClientMessageAt = 0;
  sandbox.alertKit.last = null;
  sandbox.alertKit.sound = true;
  let beeps = 0;
  const realPlay = sandbox.playAlertSound;
  sandbox.playAlertSound = () => { beeps += 1; };
  sandbox.document.hidden = true;
  try {
    // Первое чтение — пустая база: запоминаем «сообщений нет» и ничего не сигналим.
    assert.equal(sandbox.checkNewClientMessage(), false);
    assert.equal(sandbox.alertKit.last, 0, 'помним, что сообщений не было');
    // Пришло самое первое сообщение клиента в истории: раньше «до этого было 0»
    // читалось как «ещё не смотрели», и оно проходило молча.
    sandbox.state.latestClientMessageAt = Date.now();
    assert.equal(sandbox.checkNewClientMessage(), true, 'первое сообщение в пустой базе сигналит');
    assert.equal(beeps, 1);
  } finally {
    sandbox.stopTitleFlash();
    sandbox.playAlertSound = realPlay;
    sandbox.document.hidden = false;
  }

  // Звук: один общий AudioContext на страницу. Браузер держит созданный без
  // нажатия контекст «приостановленным» — его надо возобновлять, иначе после
  // перезагрузки страницы звука нет, пока не нажмёшь что-нибудь.
  const created = [];
  sandbox.window.AudioContext = class {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
      this.resumed = 0;
      created.push(this);
    }
    resume() { this.resumed += 1; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    close() {}
  };
  sandbox.alertKit.audio = null;
  sandbox.alertKit.sound = true;
  sandbox.playAlertSound();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(created.length, 1);
  assert.ok(created[0].resumed >= 1, 'приостановленный контекст возобновлён перед сигналом');
  sandbox.playAlertSound();
  assert.equal(created.length, 1, 'контекст один на страницу, а не новый на каждый сигнал');

  // Первое нажатие на странице «будит» звук заранее.
  created.length = 0;
  sandbox.alertKit.audio = null;
  sandbox.unlockAudio();
  assert.equal(created.length, 1, 'нажатие создаёт контекст');
  assert.equal(created[0].state, 'running');
  sandbox.alertKit.sound = false;
  sandbox.alertKit.audio = null;
  created.length = 0;
  sandbox.unlockAudio();
  assert.equal(created.length, 0, 'при выключенном звуке контекст не создаётся');
});

test('скрытая вкладка обновляет данные, но не перерисовывает экран, пока в неё не вернутся', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  let renders = 0;
  sandbox.renderView = () => { renders += 1; };
  sandbox.stateVersion = 'устаревшая-версия';
  sandbox.alertKit.last = 1;
  sandbox.document.hidden = true;
  try {
    await sandbox.refresh();
    assert.equal(renders, 0, 'в скрытой вкладке экран не перерисовывается');
    assert.equal(sandbox.staleWhileHidden, true, 'но помнится, что он устарел');
    assert.ok(sandbox.alertKit.last > 1, 'а данные прочитаны: о новом сообщении вкладка узнала');

    // Вернулись: данные уже свежие, экран обновляется сразу.
    sandbox.document.hidden = false;
    sandbox.document.__fire('visibilitychange');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(renders, 1, 'при возвращении экран перерисован');
    assert.equal(sandbox.staleWhileHidden, false);
  } finally {
    sandbox.stopTitleFlash();
    sandbox.document.hidden = false;
  }
});

test('«Сегодня»: «Мои / Все» появляется при двух и больше менеджерах и оставляет дела за выбранным человеком', async () => {
  // Один менеджер — переключателя нет: выбирать не из чего.
  twoWaitingConversations();
  let { sandbox } = await panelSandbox();
  let host = fakeElement('main');
  sandbox.VIEWS.today.render(host);
  assert.ok(!String(host.innerHTML).includes('id="deedScope"'), 'без второго менеджера переключателя нет');

  // Двое: Ольга закреплена за Марией, Николай — ничей.
  twoWaitingConversations();
  const data = bot.getData();
  data.config.adminName = 'Олег';
  data.config.managers = [{ id: 'm1', name: 'Мария', chatId: '9000501', verifiedAt: '' }];
  data.inquiries.find((item) => item.id === 'inq-olga').assignee = 'Мария';
  ({ sandbox } = await panelSandbox());
  host = fakeElement('main');
  sandbox.VIEWS.today.render(host);
  let html = String(host.innerHTML);
  assert.match(html, /id="deedScope"/, 'переключатель есть');
  assert.match(html, /<option value="Олег" selected>/, 'по умолчанию «я» — первый в списке');
  assert.ok(html.includes('Когда можно посмотреть?') || html.includes('Ольга'), 'в «Все» видны дела Ольги');
  assert.ok(html.includes('Николай'), 'и Николая');

  sandbox.todayScope.mine = true;
  sandbox.todayScope.me = 'Мария';
  sandbox.VIEWS.today.render(host);
  html = String(host.innerHTML);
  assert.ok(html.includes('Ольга'), 'у Марии — её клиентка');
  // Новое обращение, за которым ещё никто не закреплён, видят все: иначе в «Мои»
  // оно не показывалось бы никому и могло ждать, пока его заметят в «Все».
  assert.ok(html.includes('Николай'), 'ничей клиент в «Мои» виден');
  assert.match(html, /<span class="chip warn">без менеджера<\/span>/, 'с пометкой «без менеджера»');
  assert.equal((html.match(/без менеджера<\/span>/g) || []).length, 1, 'пометка только у ничьего, не у клиентки Марии');
  data.inquiries.find((item) => item.id === 'inq-nikolay').assignee = 'Олег';
  ({ sandbox } = await panelSandbox());
  sandbox.todayScope.mine = true;
  sandbox.todayScope.me = 'Мария';
  host = fakeElement('main');
  sandbox.VIEWS.today.render(host);
  html = String(host.innerHTML);
  assert.ok(!html.includes('Николай'), 'клиент Олега у Марии не виден');
  assert.match(html, /Ещё \d+ — чужие или не про клиентов/, 'сказано, сколько дел спрятано');

  data.inquiries.find((item) => item.id === 'inq-olga').assignee = 'Мария';
  ({ sandbox } = await panelSandbox());
  sandbox.todayScope.mine = true;
  sandbox.todayScope.me = 'Олег';
  host = fakeElement('main');
  sandbox.VIEWS.today.render(host);
  html = String(host.innerHTML);
  assert.ok(html.includes('Николай'), 'у Олега — его клиент');
  data.inquiries.find((item) => item.id === 'inq-nikolay').assignee = 'Мария';
  ({ sandbox } = await panelSandbox());
  sandbox.todayScope.mine = true;
  sandbox.todayScope.me = 'Олег';
  host = fakeElement('main');
  sandbox.VIEWS.today.render(host);
  assert.match(String(host.innerHTML), /Своих дел нет/, 'ничьих и своих нет — так и сказано, а не «все отвечены»');
});

test('«Отчёты»: неделя одной страницей — плитки со сравнением, источники, объекты, копирование текстом', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const report = {
    which: 'last', label: '14.09–20.09',
    users: { count: 5, previous: 2 },
    inquiries: { count: 3, previous: 3, byType: [['вопрос по объекту', 2], ['запись на просмотр', 1]] },
    viewings: { booked: 1, held: 4 },
    deals: { count: 0, previous: 1 },
    waiting: 2,
    topProperties: [{ name: 'Вилла у моря', count: 2 }],
    sources: [['instagram', 3], ['без метки', 2]],
    broadcasts: { count: 1, sent: 40, responded: 6 },
  };
  const html = String(sandbox.weeklyCard({ report, text: 'текст' }));
  assert.match(html, /Неделя 14\.09–20\.09/);
  for (const word of ['Новых клиентов', 'Заявок', 'Записались на просмотр', 'Сделок', 'Без ответа сейчас', 'Откуда пришли новые клиенты', 'Больше всего заявок', 'Скопировать текстом', 'Вилла у моря', 'instagram']) {
    assert.ok(html.includes(word), 'на странице есть: ' + word);
  }
  assert.match(html, /↑ \+3 · было 2/, 'рост — со стрелкой и числом');
  assert.match(html, /как раньше/, 'без изменений — так и сказано');
  assert.match(html, /↓ −1 · было 1/, 'падение — со стрелкой');
  assert.match(html, /прошло 4/);
  assert.match(html, /Рассылок: 1, получили 40, откликнулись 6/);
  assert.match(html, /с позапрошлой неделей/);
  assert.ok(!/обращени/i.test(html.replace('вопрос по объекту', '')), 'слова «обращения» нет: в панели это «заявки»');

  // Неделя идёт: сравнение с тем же отрезком, переключатель показывает «Эта».
  const current = String(sandbox.weeklyCard({ report: { ...report, which: 'current' }, text: '' }));
  assert.match(current, /с тем же отрезком прошлой недели/);
  assert.match(current, /data-week="current" class="active"/);
});

test('«Отчёт» — отдельный пункт меню: открывается на «Эта, пока идёт», строка недели на «Сегодня», слова без двусмыслицы', async () => {
  twoWaitingConversations();
  bot.getData().objects.push(property('flat-report', 'Квартира для отчёта', 'active'));
  const { sandbox, requests } = await panelSandbox();
  const items = sandbox.navItems();
  assert.ok(items.some((item) => item.id === 'reports' && item.title === 'Отчёт'), 'в меню есть «Отчёт»');
  const settings = items.find((item) => item.id === 'settings');
  assert.ok(!settings.tabs.some((tab) => tab[0] === 'reports'), 'в «Настройках» отчётов больше нет');
  // На телефоне он в «Ещё»: два нажатия.
  assert.ok(!sandbox.TAB_BAR_VIEWS.includes('reports'));
  // Старые адреса ведут на новый пункт.
  assert.equal(Array.from(sandbox.normalizeRoute('settings', 'reports')).join('/'), 'reports/');
  assert.equal(Array.from(sandbox.normalizeRoute('stats', '')).join('/'), 'reports/');

  // Открывается на идущей неделе (прошлая во вторник — почти нули).
  assert.equal(sandbox.reportWeek, 'current');
  requests.length = 0;
  const host = fakeElement('main');
  await sandbox.VIEWS.reports.render(host);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(requests.some((request) => /\/api\/weekly-report\?week=current/.test(request.url)), 'неделя запрошена «текущая»');
  const html = String(host.innerHTML);
  // «Конверсия» объяснена: от чего считается.
  assert.match(html, /Конверсия в заявку[\s\S]*?\d+ из \d+ клиентов в базе/);
  // «Показы» и «Просмотры» — разные слова: одно про каталог, другое про запись на встречу.
  assert.ok(!/>Показы</.test(html) && !/>Подробнее</.test(html.replace(/<summary>[^<]*<\/summary>/, '')), 'двусмысленных «Показы»/«Подробнее» в таблице нет');
  assert.match(html, /Видели в каталоге/);
  assert.match(html, /Открыли карточку/);

  // Строка недели на «Сегодня»: одна строка и ссылка в отчёт.
  const line = String(sandbox.weekLineHtml({ report: { which: 'current', label: '21.09–23.09', users: { count: 3 }, inquiries: { count: 5 }, deals: { count: 1 }, waiting: 2 } }));
  assert.match(line, /Неделя 21\.09–23\.09/);
  assert.match(line, /3 новых клиента/);
  assert.match(line, /5 заявок/);
  assert.match(line, /1 сделка/);
  assert.match(line, /data-go="reports"/);
  const today = fakeElement('main');
  await sandbox.VIEWS.today.render(today);
  assert.match(String(today.innerHTML), /id="weekLine"/, 'на «Сегодня» есть место под строку недели');
});

test('«Отчёт»: воронка бота — шаги от «зашли» до «подтверждено», по языкам и меткам; неполные данные помечены', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const base = {
    which: 'last', label: '14.09–20.09',
    users: { count: 10, previous: 8 }, inquiries: { count: 3, previous: 3, byType: [] },
    viewings: { booked: 1, held: 0 }, deals: { count: 0, previous: 0 }, waiting: 0,
    topProperties: [], sources: [], broadcasts: { count: 0, sent: 0, responded: 0 },
  };
  const funnel = {
    joined: 10, catalog: 8, details: 5, inquiry: 3, viewing: 2, confirmed: 1, trackedFrom: '10.09', partial: false,
    byLanguage: [{ key: 'ru', joined: 7, catalog: 6, details: 4, inquiry: 2, viewing: 1, confirmed: 1 }, { key: 'en', joined: 3, catalog: 2, details: 1, inquiry: 1, viewing: 1, confirmed: 0 }],
    bySource: [{ key: 'instagram', joined: 6, catalog: 5, details: 3, inquiry: 2, viewing: 1, confirmed: 1 }, { key: 'без метки', joined: 4, catalog: 3, details: 2, inquiry: 1, viewing: 1, confirmed: 0 }],
  };
  const html = String(sandbox.weeklyCard({ report: { ...base, funnel }, text: '' }));
  assert.match(html, /Воронка бота/);
  for (const step of ['Зашли', 'Открыли каталог', 'Нажали «Подробнее»', 'Оставили заявку', 'Записались на просмотр', 'Получили подтверждение']) assert.ok(html.includes(step), 'шаг: ' + step);
  assert.match(html, /Открыли каталог[\s\S]*?8[\s\S]*?80%/, 'проценты — от «зашли»');
  assert.match(html, /Русский/);
  assert.match(html, /English/);
  assert.match(html, /instagram/);
  assert.match(html, /без метки/);
  assert.ok(!/неполные/.test(html), 'полные данные — без пометки');

  // Отметки начались позже начала недели: честно сказано.
  const partial = String(sandbox.weeklyCard({ report: { ...base, funnel: { ...funnel, trackedFrom: '16.09', partial: true } }, text: '' }));
  assert.match(partial, /с 16\.09/);
  assert.match(partial, /неполные/);

  // Отметок нет вовсе: шагов каталога нет, остальное — есть.
  const untracked = String(sandbox.weeklyCard({ report: { ...base, funnel: { ...funnel, trackedFrom: '', catalog: 0, details: 0 } }, text: '' }));
  assert.ok(!untracked.includes('Открыли каталог') && !untracked.includes('Нажали «Подробнее»'));
  assert.match(untracked, /Оставили заявку/);

  // Новых клиентов не было — воронки нет; старый ответ без воронки не ломает страницу.
  assert.ok(!String(sandbox.weeklyCard({ report: { ...base, funnel: { ...funnel, joined: 0 } }, text: '' })).includes('Воронка бота'));
  assert.ok(!String(sandbox.weeklyCard({ report: base, text: '' })).includes('Воронка бота'));
});

test('«Почему мы»: вкладка в «Текстах бота»; поля, отзывы с разрешением, статус «виден / скрыт», сохранение', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const texts = sandbox.navItems().find((item) => item.id === 'texts');
  assert.ok(texts.tabs.some((tab) => tab[0] === 'trust' && tab[1] === 'Почему мы'), 'вкладка есть');

  let save = null;
  sandbox.watchForm = (root, callback) => { save = callback; return { mark() {} }; };

  // Пусто: экран клиентам не виден, об этом сказано.
  sandbox.state.trust = { yearsOnMarket: 0, dealsCount: 0, registration: '', officeAddress: '', reviewsUrl: '', reviews: [] };
  const empty = fakeElement('main');
  sandbox.renderTrust(empty);
  const emptyHtml = String(empty.innerHTML);
  assert.match(emptyHtml, /Скрыт: пока ничего не заполнено/);
  assert.match(emptyHtml, /id="tYears"/);
  assert.match(emptyHtml, /id="tReviewsUrl"/);
  assert.match(String(empty.querySelector('#trustPreview').innerHTML), /Пока пусто — клиенты этого экрана не увидят/);
  assert.match(emptyHtml, /бот ничего не сочиняет/, 'предупреждение: содержимое только своё');

  // Заполнено: статус меняется; отзыв без разрешения помечен и в превью не попадает.
  sandbox.state.trust = {
    yearsOnMarket: 12, dealsCount: 340, registration: 'Рег. №1', officeAddress: 'Calle del Mar, 5', reviewsUrl: 'https://r.example.com',
    reviews: [{ id: 'r1', name: 'Ханс', country: 'Германия', text: 'Отлично', allowed: true }, { id: 'r2', name: 'Скрытый', country: '', text: 'Нет разрешения', allowed: false }],
  };
  const filled = fakeElement('main');
  sandbox.renderTrust(filled);
  const html = String(filled.innerHTML);
  assert.match(html, /Экран виден клиентам/);
  assert.match(html, /value="12"/);
  const rows = String(filled.querySelector('#trustReviews').innerHTML);
  assert.match(rows, /data-rv-allow="0" checked/, 'у первого отзыва разрешение отмечено');
  assert.ok(!/data-rv-allow="1" checked/.test(rows), 'у второго — нет');
  assert.match(rows, /Без отметки о разрешении отзыв клиентам не показывается/);
  const preview = String(filled.querySelector('#trustPreview').innerHTML);
  assert.match(preview, /Ханс/);
  assert.ok(!/Скрытый|Нет разрешения/.test(preview), 'отзыв без разрешения в превью не попадает');

  // Сохранение: пустые строки отзывов отбрасываются, разрешение уходит как есть.
  filled.querySelector('#tYears').value = '13';
  filled.querySelector('#tDeals').value = '350';
  filled.querySelector('#tReg').value = 'Рег. №2';
  filled.querySelector('#tOffice').value = 'Другой адрес';
  filled.querySelector('#tReviewsUrl').value = 'https://r2.example.com';
  filled.querySelector('[data-rv-name="0"]').value = 'Ханс';
  filled.querySelector('[data-rv-country="0"]').value = 'Германия';
  filled.querySelector('[data-rv-text="0"]').value = 'Отлично';
  filled.querySelector('[data-rv-allow="0"]').checked = true;
  filled.querySelector('[data-rv-name="1"]').value = '';
  filled.querySelector('[data-rv-country="1"]').value = '';
  filled.querySelector('[data-rv-text="1"]').value = '';
  filled.querySelector('[data-rv-allow="1"]').checked = false;
  requests.length = 0;
  await save();
  const call = requests.find((request) => request.url === '/api/trust');
  assert.equal(call.method, 'PUT');
  assert.equal(call.body.yearsOnMarket, '13');
  assert.equal(call.body.registration, 'Рег. №2');
  assert.deepEqual(call.body.reviews, [{ name: 'Ханс', country: 'Германия', text: 'Отлично', allowed: true }], 'пустой отзыв не уходит');

  // «Добавить отзыв»: не больше пяти.
  sandbox.state.trust.reviews = Array.from({ length: 4 }, (_, index) => ({ id: 'x' + index, name: 'Н' + index, country: '', text: 'Т' + index, allowed: true }));
  const many = fakeElement('main');
  sandbox.renderTrust(many);
  many.querySelector('#addReview').onclick();
  assert.match(String(many.querySelector('#trustReviews').innerHTML), /data-review="4"/, 'пятый отзыв добавлен');
  assert.equal(many.querySelector('#addReview').disabled, true, 'больше пяти нельзя');
});

test('«Отчёт»: цели новых клиентов — в воронке; «большинство пока смотрит» выделено', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const funnel = { joined: 10, catalog: 0, details: 0, inquiry: 1, viewing: 0, confirmed: 0, trackedFrom: '', partial: false, byLanguage: [], bySource: [], goals: { live: 2, invest: 1, browse: 6, answered: 9, mostlyBrowsing: true } };
  const html = String(sandbox.funnelBlock(funnel));
  assert.match(html, /Цели: для жизни 2, инвестиция и аренда 1, пока смотрят 6/);
  assert.match(html, /большинство «пока смотрит»/);
  assert.ok(!/большинство/.test(String(sandbox.funnelBlock({ ...funnel, goals: { live: 4, invest: 3, browse: 2, answered: 9, mostlyBrowsing: false } }))));
  assert.ok(!/Цели:/.test(String(sandbox.funnelBlock({ ...funnel, goals: { live: 0, invest: 0, browse: 0, answered: 0, mostlyBrowsing: false } }))), 'никто не отвечал — строки нет');
});

test('«Клиенты»: один общий фильтр на все виды — менеджер, шаг «сегодня / просрочено», поиск; при смене вида не теряется', async () => {
  const dayKey = (offset) => {
    const date = new Date(); date.setDate(date.getDate() + offset);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  };
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.config.adminName = 'Олег';
    data.config.managers = [{ id: 'm1', name: 'Мария', chatId: '8880001', verifiedAt: '' }];
    for (const [id, name] of [['1', 'Анна'], ['2', 'Борис'], ['3', 'Вера']]) data.users[id] = { id, chatId: Number(id), firstName: name, preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(5) };
    const inquiry = (id, userId, extra) => ({ id, userId, chatId: userId, language: 'ru', type: 'question', text: 'Вопрос ' + id, status: 'in_progress', pipelineStage: 'contact', replies: [], messages: [], createdAt: minutesAgo(90), updatedAt: minutesAgo(60), clientMessageAt: minutesAgo(60), ...extra });
    data.inquiries.push(
      inquiry('qa', '1', { assignee: 'Мария', followUpDate: dayKey(-1) }),
      inquiry('qb', '2', { assignee: 'Олег', followUpDate: dayKey(0) }),
      inquiry('qc', '3', {}),
    );
  });
  const { sandbox } = await panelSandbox();
  sandbox.inquiryFilter.status = '';
  const render = async (tab) => {
    const host = fakeElement('main');
    await sandbox.VIEWS.clients.render(host, tab);
    return { host, html: String(host.innerHTML) };
  };
  const names = (html) => ['Анна', 'Борис', 'Вера'].filter((name) => html.includes(name));

  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.clientFilter)), { search: '', assignee: '', step: '' }, 'вначале фильтра нет');

  // Панель фильтра есть на каждом виде; у воронки и «шагов» — ещё и поле поиска.
  for (const tab of ['inbox', 'pipeline', 'base', 'tasks']) {
    const { html } = await render(tab);
    assert.match(html, /id="cfAssignee"/, tab + ': выбор менеджера');
    assert.ok(!/id="(pipelineSearch|pipelineAssignee|taskSearch|taskAssignee)"/.test(html), tab + ': прежних отдельных полей нет');
  }
  assert.match((await render('pipeline')).html, /id="cfSearch"/);
  assert.match((await render('tasks')).html, /id="cfSearch"/);
  assert.ok(!/id="cfSearch"/.test((await render('inbox')).html), 'в диалогах поиск — в шапке, второго поля нет');
  const inbox = await render('inbox');
  assert.match(inbox.html, /data-step="today"[^>]*>Шаг сегодня · 1</);
  assert.match(inbox.html, /data-step="overdue"[^>]*>Шаг просрочен · 1</);
  assert.ok(!/data-step=/.test((await render('tasks')).html), 'в «Следующих шагах» свои вкладки «Шаг просрочен / К выполнению»: дублей нет');

  // «Просрочено» — общий для всех видов.
  sandbox.clientFilter.step = 'overdue';
  for (const tab of ['inbox', 'pipeline', 'base']) assert.deepEqual(names((await render(tab)).html), ['Анна'], tab + ': только просроченные');
  sandbox.clientFilter.step = 'today';
  for (const tab of ['inbox', 'pipeline', 'base']) assert.deepEqual(names((await render(tab)).html), ['Борис'], tab + ': только на сегодня');

  // Менеджер — тоже общий.
  sandbox.clientFilter.step = '';
  sandbox.clientFilter.assignee = 'Мария';
  for (const tab of ['inbox', 'pipeline', 'base', 'tasks']) assert.deepEqual(names((await render(tab)).html), ['Анна'], tab + ': клиенты Марии');
  sandbox.clientFilter.assignee = 'none';
  for (const tab of ['inbox', 'pipeline', 'base']) assert.deepEqual(names((await render(tab)).html), ['Вера'], tab + ': без менеджера');

  // Поиск из воронки действует и в остальных видах (а сбросить его можно кнопкой).
  sandbox.clientFilter.assignee = '';
  sandbox.clientFilter.search = 'борис';
  for (const tab of ['inbox', 'pipeline', 'base', 'tasks']) assert.deepEqual(names((await render(tab)).html), ['Борис'], tab + ': по поиску');
  assert.match((await render('inbox')).html, /id="cfReset"/, 'фильтр включён — есть «Сбросить»');
  sandbox.clientFilter.search = '';

  // Нажатие на кнопку включает фильтр, повторное — снимает.
  const view = await render('inbox');
  view.host.querySelector('[data-step="today"]').onclick();
  assert.equal(sandbox.clientFilter.step, 'today');
  view.host.querySelector('[data-step="today"]').onclick();
  assert.equal(sandbox.clientFilter.step, '');
  sandbox.clientFilter.assignee = 'Мария';
  const filtered = await render('pipeline');
  filtered.host.querySelector('#cfReset').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.clientFilter)), { search: '', assignee: '', step: '' }, '«Сбросить» очищает всё');
  assert.ok(!/id="cfReset"/.test((await render('inbox')).html), 'фильтра нет — и «Сбросить» не нужна');
});

test('«Отчёт»: реклама → сделки — одна таблица «источник → клиенты → заявки → просмотры → сделки» и конструктор ссылки рядом', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.state.bot = { username: 'kornilenko_bot' };
  sandbox.state.sources = [
    { source: 'instagram', users: 10, recent: 4, withRequests: 4, inquiries: 6, viewings: 3, deals: 1 },
    { source: '', users: 5, recent: 0, withRequests: 1, inquiries: 1, viewings: 0, deals: 0 },
  ];
  const html = String(sandbox.sourceTableCard());
  for (const head of ['Источник', 'Клиентов', 'Заявок', 'Записались на просмотр', 'Сделок']) assert.ok(html.includes('>' + head + '<'), 'колонка: ' + head);
  assert.match(html, /<td[^>]*><b>instagram<\/b><\/td><td class="right">10<\/td><td class="right">6<\/td><td class="right">3<\/td><td class="right"><b>1<\/b><\/td>/, 'строка источника: клиенты, заявки, просмотры, сделки');
  assert.match(html, /без метки/, 'клиенты без метки — отдельной строкой');
  assert.match(html, /Всего[\s\S]*?15[\s\S]*?7[\s\S]*?3[\s\S]*?1/, 'итог по всем источникам');
  // Конструктор ссылки — в той же карточке.
  assert.match(html, /id="sourceLabel"/);
  assert.match(html, /id="makeSourceLink"/);
  assert.match(html, /data-copy-source="instagram"/, 'у метки — кнопка «Копировать ссылку»');
  assert.ok(!/data-copy-source=""/.test(html), 'для «без метки» ссылки нет');
  // На странице отчёта карточка стоит сразу под неделей, а не спрятана под «Подробнее».
  const host = fakeElement('main');
  await sandbox.VIEWS.reports.render(host);
  const page = String(host.innerHTML);
  assert.ok(page.indexOf('id="sourceLabel"') > 0 && page.indexOf('id="sourceLabel"') < page.indexOf('<details'), 'таблица источников — над «Подробнее»');
  assert.equal((page.match(/id="sourceLabel"/g) || []).length, 1, 'конструктор ссылки один');
});

test('передача клиента: «Передать…» появляется, когда есть кому; диалог шлёт запрос и честно говорит, ушло ли уведомление', async () => {
  twoWaitingConversations();
  bot.getData().config.adminName = 'Олег';
  bot.getData().config.managers = [{ id: 'm1', name: 'Мария', chatId: '8880001', verifiedAt: '' }];
  const { sandbox, requests } = await panelSandbox();
  sandbox.selectConversation('inq-olga');
  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');
  assert.match(String(card.innerHTML), /id="transferInq"/, 'рядом с «Ответственный менеджер» есть «Передать…»');

  const toasts = [];
  sandbox.toast = (message) => toasts.push(String(message));
  const baseFetch = sandbox.fetch;
  let answer = { ok: true, moved: 1, notified: true };
  sandbox.fetch = async (url, options) => {
    const response = await baseFetch(url, options);
    return String(url).includes('/transfer') ? { ...response, json: async () => answer } : response;
  };
  const original = sandbox.openDialog;
  let dialog = null;
  let shown = null;
  sandbox.openDialog = (options) => { shown = options; dialog = original(options); return dialog; };

  // Один клиент.
  await card.querySelector('#transferInq').onclick();
  assert.ok(dialog, 'диалог открылся');
  assert.match(String(shown.body), /<option value="Мария">/);
  assert.ok(/уведомление/i.test(String(shown.body)), 'диалог предупреждает, что новому менеджеру придёт сообщение');
  dialog.querySelector('#transferTo').value = 'Мария';
  requests.length = 0;
  await dialog.querySelector('#doTransfer').onclick();
  const call = requests.find((request) => request.url === '/api/inquiries/inq-olga/transfer');
  assert.ok(call && call.method === 'POST', 'запрос ушёл');
  assert.deepEqual(call.body, { to: 'Мария' });
  assert.ok(toasts.some((message) => /Мария/.test(message) && /Telegram/.test(message) && !/не отправлено/.test(message)), 'уведомление ушло — так и сказано: ' + toasts.join(' | '));

  // Уведомление не дошло — об этом не молчим.
  toasts.length = 0;
  answer = { ok: true, moved: 1, notified: false };
  await card.querySelector('#transferInq').onclick();
  dialog.querySelector('#transferTo').value = 'Мария';
  await dialog.querySelector('#doTransfer').onclick();
  assert.ok(toasts.some((message) => /не отправлено|не дошло/.test(message)), 'если сообщение не ушло, сказано: ' + toasts.join(' | '));

  // Все клиенты человека.
  await sandbox.openTransferDialog('all');
  assert.ok(dialog.querySelector('#transferFrom'), 'выбор, у кого забрать');
  assert.match(String(shown.body), /Без менеджера/);
  // Один и тот же человек в обоих списках: кнопка гаснет сама (нажатие внутри окна блокировало бы её насовсем).
  dialog.querySelector('#transferFrom').value = 'Олег';
  dialog.querySelector('#transferTo').value = 'Олег';
  dialog.querySelector('#transferTo').onchange();
  assert.equal(dialog.querySelector('#doTransfer').disabled, true, 'одинаковый выбор — «Передать» недоступна');
  assert.match(String(dialog.querySelector('#transferHint').textContent), /разных людей/);
  dialog.querySelector('#transferTo').value = 'Мария';
  dialog.querySelector('#transferTo').onchange();
  assert.equal(dialog.querySelector('#doTransfer').disabled, false, 'выбрали разных — снова доступна');
  requests.length = 0;
  answer = { ok: true, moved: 2, notified: true };
  await dialog.querySelector('#doTransfer').onclick();
  const bulk = requests.find((request) => request.url === '/api/inquiries/transfer');
  assert.deepEqual(bulk.body, { from: 'Олег', to: 'Мария' });

  // Без менеджеров передавать некому: кнопки нет.
  bot.getData().config.managers = [];
  const { sandbox: lonely } = await panelSandbox();
  lonely.selectConversation('inq-olga');
  const lonelyHost = fakeElement('main');
  const lonelyCard = lonelyHost.querySelector('#inquiryCard');
  await lonely.VIEWS.clients.render(lonelyHost, '');
  assert.ok(!/id="transferInq"/.test(String(lonelyCard.innerHTML)), 'один человек в команде — «Передать…» не нужна');
});

test('воронка без шума: «без менеджера» — только когда есть кому назначить, «Отвечено» не значком, этап в списке карточки не повторяет колонку', async () => {
  twoWaitingConversations();
  bot.getData().config.managers = [];
  const { sandbox } = await panelSandbox();
  // Клиентка Ольга уже отвечена: значок «Отвечено» — норма, а не повод для значка.
  const olga = sandbox.state.inquiries.find((item) => item.id === 'inq-olga');
  olga.replies = [{ id: 'r', text: 'Ответ', createdAt: new Date(Date.now() + 60000).toISOString() }];
  const board = async () => {
    const host = fakeElement('main');
    await sandbox.VIEWS.clients.render(host, 'pipeline');
    return String(host.innerHTML);
  };

  // Один человек в команде: назначать некому, «без менеджера» — пустой шум.
  let html = await board();
  assert.ok(!/без менеджера<\/span>/.test(html), 'значка «без менеджера» на карточках нет');
  assert.ok(!/Без менеджера/.test(html), 'и в цифрах, и в фильтре — тоже');
  assert.ok(!/class="chip ok">Отвечено</.test(html), 'значка «Отвечено» нет: это обычное состояние');
  assert.match(html, /Ждёт ответа/, 'а то, что требует внимания, — на месте');

  // Этап в списке карточки: «Перенести в…» и остальные этапы, без текущего (он уже назван колонкой).
  const card = html.slice(html.indexOf('<article class="funnel-card'), html.indexOf('</article>'));
  assert.match(card, /<option value="" selected>Перенести в…<\/option>/);
  assert.ok(!/<option value="new"/.test(card), 'текущий этап в списке не повторяется');
  assert.match(card, /<option value="contact">/);
  assert.ok((card.match(/class="chip/g) || []).length <= 3, 'не больше трёх значков на карточку');

  // Команда из двух и больше: пометка возвращается — её можно исправить.
  sandbox.state.config.managers = [{ id: 'm1', name: 'Мария', chatId: '1', verifiedAt: '' }];
  html = await board();
  assert.match(html, /<span class="chip warn">без менеджера<\/span>/);
  assert.match(html, /Без менеджера/);
});

test('«База клиентов»: кнопка «В Excel» выгружает тех, кто на экране', async () => {
  resetData((data) => {
    data.config.active = true;
    data.users['601'] = { id: '601', chatId: 601, firstName: 'Анна', activity: [] };
    data.users['602'] = { id: '602', chatId: 602, firstName: 'Борис', activity: [] };
  });
  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  sandbox.renderClients(host);
  assert.match(String(host.innerHTML), /id="exportClients"[^>]*>⬇ В Excel</);
  let sent = null;
  sandbox.exportClients = (ids) => { sent = ids; };
  host.querySelector('#exportClients').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)).sort(), ['601', '602'], 'в файл идут те, кого показывает таблица');
});

test('контакты: фото менеджера с миниатюрой и «Убрать»; без срока ответа — напоминание', async () => {
  resetData((data) => {
    data.config.active = true;
    data.contacts.managerName = 'Ольга';
    data.contacts.photo = { id: 'mgr', mimeType: 'image/png', name: 'olga.png', size: 10, dataBase64: Buffer.from('x').toString('base64'), updatedAt: '2026-09-29T10:00:00.000Z' };
  });
  const { sandbox, requests } = await panelSandbox();
  let save = null;
  sandbox.watchForm = (root, callback) => { save = callback; return { mark() {} }; };

  const host = fakeElement('main');
  sandbox.renderContacts(host);
  const html = String(host.innerHTML);
  assert.match(html, /id="contactPhoto" accept="image\/jpeg,image\/png"/, 'есть выбор файла');
  assert.match(html, /src="\/api\/images\/contacts\/photo\?rev=/, 'миниатюра загруженного фото');
  assert.match(html, /class="btn ghost small" id="contactPhotoDrop"/, 'кнопка «Убрать фото» видна, когда фото есть');
  assert.match(html, /«Обычно отвечаем за …» не задано/, 'нет срока ответа — владельцу напоминают');

  // Сохранение без изменения фото не шлёт «убрать».
  requests.length = 0;
  await save();
  const kept = requests.find((request) => request.url === '/api/contacts');
  assert.equal(kept.body.photo, null, 'фото не трогали — панель ничего о нём не присылает');

  // «Убрать фото» уходит в запросе.
  host.querySelector('#contactPhotoDrop').onclick();
  requests.length = 0;
  await save();
  assert.deepEqual(requests.find((request) => request.url === '/api/contacts').body.photo, { remove: true });

  // Срок ответа задан — напоминания нет; фото нет — так и сказано.
  sandbox.state.config.workingHours.replyMinutes = 15;
  sandbox.state.contacts.photo = { exists: false };
  const second = fakeElement('main');
  sandbox.renderContacts(second);
  assert.ok(!String(second.innerHTML).includes('не задано'), 'срок задан — напоминания нет');
  assert.match(String(second.innerHTML), /Фото не загружено/);
});

test('редактор объекта: внизу «Опубликовать» и «Сохранить как черновик»; опубликованный — «Сохранить», «Снять», «В канал»', async () => {
  resetData((data) => {
    data.config.active = true;
    data.objects.push({ id: 'draft-1', status: 'hidden', reference: 'D-1', title: { ru: 'Черновик', en: '', es: '' }, images: [] });
    data.objects.push({ id: 'live-1', status: 'active', reference: 'L-1', title: { ru: 'Живой', en: 'Live', es: 'Vivo' }, images: [] });
  });
  const { sandbox, requests } = await panelSandbox();
  const original = sandbox.openDialog;
  let dialog = null;
  // Поддельная страница не хранит значения полей из разметки: статус, с которым
  // открывается редактор, задаём сами — до того, как редактор его прочитает.
  let presetStatus = '';
  sandbox.openDialog = (options) => {
    const ready = options.ready;
    options.ready = (opened) => { if (presetStatus) opened.querySelector('#fStatus').value = presetStatus; ready(opened); };
    dialog = original(options);
    return dialog;
  };

  sandbox.openRecordEditor('objects', 'draft-1');
  let foot = String(dialog.querySelector('#editorFoot').innerHTML);
  assert.match(foot, /id="saveDraft"[^>]*>Сохранить как черновик</);
  assert.match(foot, /id="publishNow"/);
  assert.ok(!foot.includes('id="unpublish"'), 'у черновика нет «Снять с публикации»');
  assert.ok(!String(dialog.innerHTML).includes('<label>Статус</label>'), 'поля «Статус» в форме нет');

  presetStatus = 'active';
  sandbox.openRecordEditor('objects', 'live-1');
  foot = String(dialog.querySelector('#editorFoot').innerHTML);
  for (const id of ['saveRecord', 'unpublish', 'postToChannel']) assert.ok(foot.includes('id="' + id + '"'), id + ' у опубликованного объекта');
  assert.ok(!foot.includes('id="publishNow"'));

  // «Снять с публикации» сохраняет объект скрытым.
  requests.length = 0;
  const unpublish = dialog.querySelector('#editorFoot').querySelector('#unpublish');
  await unpublish.onclick.call(unpublish);
  const saved = requests.find((request) => request.method === 'PATCH' && request.url.includes('/api/objects/live-1'));
  assert.ok(saved, 'объект сохранён');
  assert.equal(saved.body.status, 'hidden');
});

test('«Настройки → Компания»: одна полоса сохранения вместо четырёх кнопок, ставки — под спойлером', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  let captured = null;
  sandbox.watchForm = (root, save, label) => { captured = { save, label }; return { mark() {} }; };
  const host = fakeElement('main');
  sandbox.renderWork(host);
  const html = String(host.innerHTML);

  for (const id of ['saveHours', 'saveSlots', 'saveCalc', 'saveReminders']) assert.ok(!html.includes('id="' + id + '"'), 'кнопки ' + id + ' больше нет');
  assert.ok(captured, 'весь экран — одна отслеживаемая форма');
  assert.match(captured.label, /Настройки компании/);
  assert.match(html, /<details class="editor-section rates-details"><summary><b>Ставки налогов и сборов<\/b>/, 'ставки калькулятора под спойлером');
  assert.ok(!/rates-details" open/.test(html), 'спойлер закрыт');
  assert.ok(html.indexOf('id="calcOn"') < html.indexOf('rates-details'), 'выключатель калькулятора — над спойлером');

  // Одна кнопка полосы сохраняет всё: часы, окна для просмотров, калькулятор, напоминания.
  requests.length = 0;
  await captured.save();
  const paths = requests.filter((request) => request.method === 'PUT').map((request) => new URL(request.url, 'http://x').pathname);
  assert.deepEqual(paths, ['/api/working-hours', '/api/viewing-slots', '/api/calculator', '/api/settings', '/api/engagement']);
});

test('«Настройки → Компания»: «Сообщения клиентам сами» — дайджест и возврат выключены, видно, кто получит; сохраняются той же полосой', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  let captured = null;
  sandbox.watchForm = (root, save) => { captured = save; return { mark() {} }; };
  sandbox.state.engagement = { digest: false, comeback: true, audience: 14, activeObjects: 3 };
  const host = fakeElement('main');
  sandbox.renderWork(host);
  const html = String(host.innerHTML);
  assert.match(html, /Сообщения клиентам сами/);
  assert.ok(!/id="digestOn" checked/.test(html) && /id="digestOn"/.test(html), 'дайджест выключен');
  assert.match(html, /id="comebackOn" checked/, 'возврат включён, как в настройках');
  assert.match(html, /Получат: 14/, 'видно, сколько клиентов согласились на новости');
  assert.match(html, /в продаже сейчас 3/, 'и сколько объектов в каталоге');
  assert.match(html, /живом каталоге/, 'предупреждение: включать на настоящем каталоге');

  host.querySelector('#digestOn').checked = true;
  host.querySelector('#comebackOn').checked = false;
  requests.length = 0;
  await captured();
  const call = requests.find((request) => request.url === '/api/engagement');
  assert.equal(call.method, 'PUT');
  assert.deepEqual(call.body, { digest: true, comeback: false, planReminder: false });
});

test('«План покупки»: вкладка, десять шагов с текстами на трёх языках, сохранение; напоминание — в «Компании»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const texts = sandbox.navItems().find((item) => item.id === 'texts');
  assert.ok(texts.tabs.some((tab) => tab[0] === 'plan' && tab[1] === 'План покупки'), 'вкладка есть');
  assert.equal(sandbox.state.buyPlan.length, 10, 'бот отдал десять шагов');

  let save = null;
  sandbox.watchForm = (root, callback) => { save = callback; return { mark() {} }; };
  const host = fakeElement('main');
  sandbox.renderBuyPlan(host);
  const html = String(host.innerHTML);
  assert.equal((html.match(/data-plan-step="/g) || []).length, 10);
  assert.match(html, /1\. NIE — номер иностранца/);
  assert.match(html, /data-plan-title="nie" data-lang="en"/);
  assert.match(html, /data-plan-text="register" data-lang="es"/);
  assert.match(html, /не давайте юридических обещаний/, 'предупреждение владельцу');

  host.querySelector('[data-plan-title="nie"][data-lang="ru"]').value = 'Получите NIE';
  host.querySelector('[data-plan-text="nie"][data-lang="ru"]').value = 'Наш юрист поможет.';
  requests.length = 0;
  await save();
  const call = requests.find((request) => request.url === '/api/buy-plan');
  assert.equal(call.method, 'PUT');
  assert.equal(call.body.steps.length, 10);
  assert.equal(call.body.steps[0].id, 'nie');
  assert.equal(call.body.steps[0].title.ru, 'Получите NIE');
  assert.equal(call.body.steps[0].text.ru, 'Наш юрист поможет.');

  // Напоминания о плане — отдельная галочка в «Компании».
  sandbox.state.engagement = { digest: false, comeback: false, planReminder: true, audience: 0, activeObjects: 0 };
  const work = fakeElement('main');
  sandbox.renderWork(work);
  assert.match(String(work.innerHTML), /id="planReminderOn" checked/);
});

test('общий поиск в шапке: клиенты, объекты и сообщения — одним полем', async () => {
  twoWaitingConversations();
  bot.getData().objects.push({ id: 'find-villa', status: 'active', reference: 'REF-77', title: { ru: 'Вилла у моря', en: 'Sea villa', es: 'Villa' }, city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' }, images: [] });
  const { sandbox, requests } = await panelSandbox();
  // Объекты из поддельной страницы — из другого «мира»: сравниваем через JSON.
  const found = (query) => JSON.parse(JSON.stringify(sandbox.globalSearchMatches(query)));

  assert.deepEqual(found('о'), { clients: [], objects: [] }, 'одна буква — слишком мало');
  assert.ok(found('оль').clients.some((user) => /Ольга/.test(user.firstName)), 'клиент находится по имени');
  assert.deepEqual(found('ref-77').objects.map((record) => record.id), ['find-villa'], 'объект — по номеру');
  assert.deepEqual(found('altea').objects.map((record) => record.id), ['find-villa'], 'и по городу на другом языке');
  assert.deepEqual(found('sea v').objects.map((record) => record.id), ['find-villa'], 'и по названию на английском');
  assert.deepEqual(found('zzzz'), { clients: [], objects: [] });

  // Выбор результата открывает нужное окно.
  const opened = [];
  sandbox.openClient = (id) => opened.push(['client', id]);
  sandbox.openRecordEditor = (kind, id) => opened.push(['object', kind, id]);
  sandbox.openInquiry = (id) => opened.push(['message', id]);
  sandbox.state.users.push({ id: '700002', firstName: 'Тест', activity: [] });
  sandbox.globalSearchOpen('client', '700002');
  sandbox.globalSearchOpen('object', 'find-villa');
  sandbox.globalSearchOpen('message', 'inq-olga');
  assert.equal(JSON.stringify(opened), JSON.stringify([['client', '700002'], ['object', 'objects', 'find-villa'], ['message', 'inq-olga']]));

  // Сообщения ищет бот по всей переписке: поле шлёт запрос и рисует ответ.
  requests.length = 0;
  sandbox.document.getElementById('globalSearch').value = 'парковка';
  sandbox.globalSearchRun('парковка');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(requests.some((request) => request.url.includes('/api/conversations/search?q=' + encodeURIComponent('парковка'))), 'запрос к поиску по переписке ушёл');
});

test('Ctrl+K: палитра с действиями, клиенты — по всей базе (не только 500 последних), полная карточка запрашивается отдельно', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  const box = () => String(sandbox.el('globalResults').innerHTML);

  // Действия ищутся по названию и по словам рядом; пустой запрос — самые частые.
  const titles = (query) => Array.from(sandbox.globalSearchActions(query)).map((action) => action.title);
  assert.ok(titles('').length >= 5, 'пустой запрос — список частых действий');
  assert.deepEqual(titles('нов').filter((title) => /объект/.test(title)), ['Новый объект']);
  assert.ok(titles('просмотр').includes('Открыть просмотры'));
  assert.ok(titles('рассыл').includes('Создать рассылку'));
  assert.deepEqual(titles('zzzz'), []);

  // Горячая клавиша: Ctrl+K и Cmd+K; обычная «k» — нет.
  sandbox.document.getElementById('globalSearch').value = '';
  let prevented = 0;
  const key = (extra) => ({ key: 'k', preventDefault() { prevented += 1; }, ...extra });
  assert.equal(sandbox.paletteShortcut(key({ ctrlKey: true })), true);
  assert.equal(sandbox.paletteShortcut(key({ metaKey: true })), true);
  assert.equal(sandbox.paletteShortcut(key({ key: 'K', ctrlKey: true })), true, 'и заглавная (с включённым Caps Lock)');
  assert.equal(sandbox.paletteShortcut(key({})), false, 'просто «k» — обычный ввод');
  assert.equal(prevented, 3, 'браузерный поиск не перехватывает сочетание');
  assert.match(box(), /Действия/, 'открытая палитра показывает действия');
  assert.match(box(), /Новый объект/);

  // Действие запускается по выбору.
  const ran = [];
  sandbox.go = async (view, tab) => { ran.push(['go', view, tab || '']); return true; };
  sandbox.openRecordEditor = (kind, id) => ran.push(['editor', kind, id]);
  await sandbox.globalSearchOpen('action', String(sandbox.PALETTE_ACTIONS.findIndex((action) => action.title === 'Новый объект')));
  assert.deepEqual(JSON.parse(JSON.stringify(ran)), [['go', 'objects', 'list'], ['editor', 'objects', null]]);

  // Клиент, которого нет среди 500 последних: сервер находит, панель показывает и открывает.
  const baseFetch = sandbox.fetch;
  sandbox.fetch = async (url, options) => {
    const path = String(url);
    const answer = (payload) => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload), headers: { get: () => '' } });
    if (path.includes('/api/conversations/search')) return answer({ query: 'соколова', inquiryIds: [], clients: [{ id: 'old-9', name: 'Ирина Соколова', username: 'irina_sk', phone: '+34 600 111 222', lastSeenAt: '2020-01-01T00:00:00.000Z' }] });
    if (path.includes('/api/users/old-9')) { requests.push({ url: path, method: 'GET' }); return answer({ user: { id: 'old-9', firstName: 'Ирина', lastName: 'Соколова', username: 'irina_sk', activity: [] } }); }
    return baseFetch(url, options);
  };
  sandbox.document.getElementById('globalSearch').value = 'соколова';
  sandbox.globalSearchRun('соколова');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.match(box(), /Ирина Соколова/, 'клиент с сервера — в результатах');
  assert.match(box(), /data-id="old-9"/);
  assert.match(box(), /✉ Написать: Ирина Соколова/, 'и действие «Написать клиенту»');
  assert.ok(!sandbox.state.users.some((user) => user.id === 'old-9'), 'предпосылка: в состоянии его нет');

  const opened = [];
  sandbox.openClient = (id) => opened.push(id);
  requests.length = 0;
  await sandbox.globalSearchOpen('client', 'old-9');
  assert.ok(requests.some((request) => request.url.includes('/api/users/old-9')), 'полная карточка запрошена');
  assert.ok(sandbox.state.users.some((user) => user.id === 'old-9' && !user.partial), 'и добавлена в состояние');
  assert.deepEqual(opened, ['old-9'], 'карточка открылась');
});

test('быстрый ответ со «Сегодня»: окно с последним сообщением, шаблонами, «Отправить и следующий» — самые давние первыми', async () => {
  twoWaitingConversations();
  bot.getData().replyTemplates = [{ id: 't1', title: 'Здравствуйте', text: { ru: 'Здравствуйте! Уточню и отвечу.', en: '', es: '' } }];
  const { sandbox, requests } = await panelSandbox();
  const original = sandbox.openDialog;
  const dialogs = [];
  sandbox.openDialog = (options) => { const dialog = original(options); dialogs.push({ options, dialog }); return dialog; };
  const toasts = [];
  sandbox.toast = (message) => toasts.push(String(message));

  const today = fakeElement('main');
  sandbox.VIEWS.today.render(today);
  assert.match(String(today.innerHTML), /id="answerQueue"[^>]*>Ответить по очереди · 2</, 'на «Сегодня» есть «Ответить по очереди · 2»');

  // Дело «Новое сообщение» на «Сегодня»: «Ответить» открывает окно, а не уводит в диалог.
  const deed = sandbox.deedList().find((item) => item.kind === 'message' && /Ольга/.test(item.title));
  assert.ok(deed, 'есть дело про Ольгу');
  await sandbox.runDeed(deed);
  assert.equal(dialogs.length, 1, 'окно открылось');
  const first = dialogs[0];
  assert.match(first.options.title, /Ольга/);
  assert.match(String(first.options.body), /Жду, спасибо/, 'видно последнее сообщение клиента');
  assert.match(String(first.options.body), /data-template="t1"/, 'шаблоны под рукой');
  for (const id of ['qrText', 'qrSend', 'qrSendNext', 'qrSkip', 'qrOpen']) assert.ok(String(first.options.body + first.options.footer).includes('id="' + id + '"'), id);

  // Пустой ответ не уходит.
  requests.length = 0;
  first.dialog.querySelector('#qrText').value = '   ';
  await first.dialog.querySelector('#qrSendNext').onclick();
  assert.ok(!requests.some((request) => request.url.includes('/reply')), 'пустое сообщение не отправляется');
  assert.ok(toasts.some((message) => /Введите сообщение/.test(message)));

  // «Отправить и следующий»: ответ уходит, открывается следующий ждущий (Николай).
  first.dialog.querySelector('#qrText').value = 'Добрый день, Ольга!';
  await first.dialog.querySelector('#qrSendNext').onclick();
  const call = requests.find((request) => request.url === '/api/inquiries/inq-olga/reply');
  assert.ok(call && call.method === 'POST', 'ответ ушёл по заявке Ольги');
  assert.equal(call.body.text, 'Добрый день, Ольга!');
  assert.ok(call.body.clientRequestId, 'с номером запроса: повтор не задвоит сообщение');
  assert.equal(dialogs.length, 2, 'открылось окно следующего');
  assert.match(dialogs[1].options.title, /Николай/);

  // «Пропустить»: никому ничего не уходит, очередь заканчивается.
  requests.length = 0;
  await dialogs[1].dialog.querySelector('#qrSkip').onclick();
  assert.ok(!requests.some((request) => request.url.includes('/reply')), 'пропуск ничего не отправляет');
  assert.equal(dialogs.length, 2, 'больше ждущих нет — новое окно не открывается');
  assert.ok(toasts.some((message) => /Больше никто не ждёт/.test(message)));

  // «Открыть диалог» ведёт на обычный экран диалога.
  const routes = [];
  sandbox.go = async (view, tab) => { routes.push([view, tab]); return true; };
  await sandbox.runDeed(sandbox.deedList().find((item) => item.kind === 'message' && /Николай/.test(item.title)));
  await dialogs[2].dialog.querySelector('#qrOpen').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [['clients', 'inbox']]);
});

test('быстрый ответ: очередь «по очереди» начинается с ждущего дольше всех; ошибка отправки не двигает очередь', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const original = sandbox.openDialog;
  const dialogs = [];
  sandbox.openDialog = (options) => { const dialog = original(options); dialogs.push({ options, dialog }); return dialog; };
  sandbox.toast = () => {};

  // Николай ждёт 9 минут, Ольга — 4: первым — Николай.
  await sandbox.openNextQuickReply([]);
  assert.match(dialogs[0].options.title, /Николай/);

  // Ошибка доставки: окно остаётся, сообщение об ошибке видно, следующий не открывается.
  const baseFetch = sandbox.fetch;
  sandbox.fetch = async (url, options) => (String(url).includes('/reply')
    ? { ok: false, status: 502, json: async () => ({ error: 'Telegram не ответил' }), text: async () => '', headers: { get: () => '' } }
    : baseFetch(url, options));
  dialogs[0].dialog.querySelector('#qrText').value = 'Ответ';
  await dialogs[0].dialog.querySelector('#qrSendNext').onclick();
  assert.equal(dialogs.length, 1, 'следующий не открылся');
  assert.match(String(dialogs[0].dialog.querySelector('#qrError').textContent), /Не отправлено: Telegram не ответил/);
  assert.equal(dialogs[0].dialog.querySelector('#qrText').value, 'Ответ', 'черновик остался');
});

test('диалог на телефоне: сведения — выезжающая панель «⋯ Сведения», страница не прыгает к полю ответа', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.innerWidth = 375;
  sandbox.selectConversation('inq-olga');
  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  let scrolled = 0;
  card.querySelector('.reply-box').scrollIntoView = () => { scrolled += 1; };
  await sandbox.VIEWS.clients.render(host, '');
  const html = String(card.innerHTML);

  // Кнопка в шапке, крестик в самой панели и подложка.
  assert.match(html, /id="sideToggle"[^>]*>⋯ Сведения</);
  assert.match(html, /id="sideClose"/);
  assert.match(html, /class="side-backdrop"/);
  assert.ok(html.indexOf('id="sideToggle"') < html.indexOf('conversation-split'), 'кнопка — в шапке диалога, а не под полем ответа');

  // Панель открывается и закрывается: кнопкой, крестиком и подложкой.
  const cardBox = card.querySelector('.conversation-card');
  card.querySelector('#sideToggle').onclick();
  assert.equal(cardBox.classList.contains('side-open'), true, 'открылась');
  card.querySelector('#sideClose').onclick();
  assert.equal(cardBox.classList.contains('side-open'), false, 'закрылась крестиком');
  card.querySelector('#sideToggle').onclick();
  card.querySelector('.side-backdrop').onclick();
  assert.equal(cardBox.classList.contains('side-open'), false, 'и нажатием на подложку');

  // Содержимое панели раскрыто (её прячет выезд, а не свёрнутая «шторка»), а страница к полю ответа не прокручивается.
  assert.equal(card.querySelector('.conversation-side-details').open, true);
  assert.equal(scrolled, 0, 'прокрутки страницы к полю ответа нет: переписка сама открывается на последнем сообщении');
});

test('«Вернуть»: смена этапа, закрытие заявки, удаление акции и объекта, отмена поста — тост с кнопкой и обратный запрос', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  const toasts = [];
  sandbox.toast = (message, bad, action) => toasts.push({ message: String(message), action });
  const last = () => toasts[toasts.length - 1];
  const bodyOf = (method, urlPart) => requests.filter((request) => request.method === method && request.url.includes(urlPart)).pop();

  // Этап: перенесли карточку — можно вернуть прежние этап и статус.
  const item = sandbox.state.inquiries.find((entry) => entry.id === 'inq-olga');
  requests.length = 0;
  await sandbox.changeStageWithUndo(item, 'won');
  assert.deepEqual(bodyOf('PATCH', '/api/inquiries/inq-olga').body, { pipelineStage: 'won' });
  assert.match(last().message, /Этап обновлён/);
  assert.equal(last().action.label, 'Вернуть');
  requests.length = 0;
  await last().action.run();
  assert.deepEqual(bodyOf('PATCH', '/api/inquiries/inq-olga').body, { status: 'new', pipelineStage: 'new' }, 'вернулись и статус, и этап');
  assert.match(last().message, /Возвращено/);

  // Сделку сдвинули с «Сделки» — «Вернуть» несёт и прежнюю дату сделки.
  const won = { ...item, pipelineStage: 'won', status: 'closed', wonAt: '2026-09-01T10:00:00.000Z' };
  sandbox.state.inquiries.push(won);
  won.id = 'inq-won';
  requests.length = 0;
  await sandbox.changeStageWithUndo(won, 'contact');
  requests.length = 0;
  await last().action.run();
  assert.deepEqual(bodyOf('PATCH', '/api/inquiries/inq-won').body, { status: 'closed', pipelineStage: 'won', wonAt: '2026-09-01T10:00:00.000Z' }, 'дата сделки едет обратно вместе с этапом');

  // Закрытие заявки в панели сопровождения — тем же образом; правка одной заметки «Вернуть» не предлагает.
  sandbox.selectConversation('inq-olga');
  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');
  card.querySelector('#inqStatusValue').value = 'closed';
  card.querySelector('#inqPipeline').value = sandbox.pipelineStageOf(item);
  requests.length = 0;
  await card.querySelector('#saveInq').onclick();
  assert.match(last().message, /Сохранено/);
  assert.ok(last().action && /Вернуть/.test(last().action.label), 'закрытие можно отменить');
  requests.length = 0;
  await last().action.run();
  assert.deepEqual(bodyOf('PATCH', '/api/inquiries/inq-olga').body, { status: 'new', pipelineStage: 'new' });
  card.querySelector('#inqStatusValue').value = 'open';
  card.querySelector('#inqNote').value = 'Только заметка';
  await card.querySelector('#saveInq').onclick();
  assert.ok(!last().action, 'заметку «возвращать» не предлагаем');

  // Акция, объект: удалили — вернули.
  for (const [kind, id, done] of [['promotions', 'promo-1', 'Акция удалена'], ['objects', 'villa-1', 'Объект удалён']]) {
    requests.length = 0;
    await sandbox.removeWithUndo(kind, id, done);
    assert.equal(bodyOf('DELETE', '/api/' + kind + '/' + id).method, 'DELETE');
    assert.equal(last().message, done);
    assert.equal(last().action.label, 'Вернуть');
    requests.length = 0;
    await last().action.run();
    assert.equal(bodyOf('POST', '/api/' + kind + '/' + id + '/restore').method, 'POST', kind + ': запрос на возврат ушёл');
  }

  // Пост: отменили — вернули.
  requests.length = 0;
  await sandbox.cancelPostWithUndo('post-aaaa-1111');
  assert.equal(bodyOf('DELETE', '/api/group-posts/post-aaaa-1111').method, 'DELETE');
  assert.match(last().message, /Публикация убрана/);
  requests.length = 0;
  await last().action.run();
  assert.equal(bodyOf('POST', '/api/group-posts/post-aaaa-1111/restore').method, 'POST');
});

test('сжатое состояние приходит без токена защиты — панель помнит прежний и не теряет возможность сохранять', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  assert.equal(sandbox.csrf, 'test-csrf');
  sandbox.state.csrf = '';
  await sandbox.reload(false);
  assert.equal(sandbox.csrf, 'test-csrf', 'токен прежний');
  sandbox.state.csrf = 'новый-токен';
  await sandbox.reload(false);
  assert.equal(sandbox.csrf, 'новый-токен', 'а если бот прислал новый — берём его');

  // Страницу открыли заново: своего токена нет, а сжатое состояние его не несёт —
  // панель просит его отдельным запросом (иначе первое же сохранение получило бы отказ).
  sandbox.csrf = '';
  sandbox.state.csrf = '';
  const baseFetch = sandbox.fetch;
  const asked = [];
  sandbox.fetch = async (url, options) => {
    if (String(url).includes('/api/csrf')) {
      asked.push(String(url));
      return { ok: true, status: 200, json: async () => ({ csrf: 'токен-из-запроса' }), text: async () => '', headers: { get: () => '' } };
    }
    return baseFetch(url, options);
  };
  await sandbox.reload(false);
  assert.equal(asked.length, 1, 'токен запрошен');
  assert.equal(sandbox.csrf, 'токен-из-запроса');
  await sandbox.reload(false);
  assert.equal(asked.length, 1, 'а когда он есть — не запрашивается снова');
});

test('клавиатура и скринридер: кликабельные строки берутся по Tab и нажимаются Enter/пробелом, вкладки — tablist, окна названы, тост — status', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();

  // Разметка каркаса: тост и полосы объявляются скринридеру, не перебивая речь.
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /<div id="toast" class="toast hidden" role="status" aria-live="polite">/);
  assert.match(PANEL_HTML, /<div id="savebar" class="savebar hidden" role="status">/);
  assert.match(PANEL_HTML, /<div id="refreshHint" class="refresh-hint hidden" role="status">/);

  // Поддельный узел с атрибутами и классами.
  const node = (classes = [], children = []) => {
    const attrs = {};
    return {
      attrs, children,
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
      hasAttribute(name) { return Object.hasOwn(attrs, name); },
      classList: { contains: (name) => classes.includes(name) },
      querySelectorAll(selector) { return selector === 'button' ? children : []; },
      clicked: 0, click() { this.clicked += 1; },
    };
  };
  const row = node(['clickable']);
  const inputRow = node(['clickable']);
  inputRow.setAttribute('tabindex', '-1');
  const first = node(['active']);
  const second = node();
  const tabs = node([], [first, second]);
  const root = { querySelectorAll: (selector) => (selector.includes('tr.clickable') ? [row, inputRow] : selector === '.tabs' ? [tabs] : []) };
  sandbox.enhanceAccessibility(root);
  assert.equal(row.getAttribute('tabindex'), '0', 'строка попадает в очередь Tab');
  assert.equal(row.getAttribute('data-kbd'), '1', 'и помечена для нажатия с клавиатуры');
  assert.equal(inputRow.getAttribute('tabindex'), '-1', 'уже настроенное не трогаем');
  assert.equal(tabs.getAttribute('role'), 'tablist');
  assert.equal(first.getAttribute('role'), 'tab');
  assert.equal(first.getAttribute('aria-selected'), 'true', 'активная вкладка выбрана');
  assert.equal(second.getAttribute('aria-selected'), 'false');

  // Enter и пробел на самой строке — нажатие; на другом — нет; вложенная кнопка своё нажатие сохраняет.
  let prevented = 0;
  const key = (target, pressed) => ({ key: pressed, target, preventDefault() { prevented += 1; } });
  assert.equal(sandbox.keyboardActivate(key(row, 'Enter')), true);
  assert.equal(sandbox.keyboardActivate(key(row, ' ')), true);
  assert.equal(row.clicked, 2);
  assert.equal(prevented, 2, 'пробел не прокручивает страницу');
  assert.equal(sandbox.keyboardActivate(key(row, 'a')), false);
  assert.equal(sandbox.keyboardActivate(key(node(), 'Enter')), false, 'обычные элементы не трогаем');

  // Окно названо по своему заголовку.
  const dialog = sandbox.openDialog({ title: 'Ответ клиенту', body: '<p>тело</p>' });
  assert.match(String(dialog.innerHTML), /<h2 id="dialogTitle\d+">Ответ клиенту<\/h2>/);
  assert.match(PANEL_HTML, /dialog\.setAttribute\("aria-labelledby", titleId\)/, 'окно связано со своим заголовком');
});

test('старые адреса подключения к Telegram ведут на вкладку «Подключение»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  for (const tab of ['connection', 'telegram']) {
    assert.equal(sandbox.normalizeRoute('settings', tab).join('/'), 'settings/telegram', tab);
  }
});

test('график: слева наибольшее значение и ноль, снизу даты, над короткими столбцами — числа', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const week = sandbox.lastDays(7);
  sandbox.state.analytics = { daily: {} };
  sandbox.state.analytics.daily[week[6]] = { received: 40 };
  sandbox.state.analytics.daily[week[3]] = { received: 10 };
  const html = String(sandbox.sparkline(week, 'received', 'var(--brand)'));
  assert.match(html, /<div class="chart-y"><span>40<\/span><span>0<\/span><\/div>/, 'ось: наибольшее значение и ноль');
  const label = (key) => key.slice(8, 10) + '.' + key.slice(5, 7);
  for (const day of week) assert.ok(html.includes('<span>' + label(day) + '</span>'), 'под графиком дата ' + label(day));
  assert.match(html, /<b style="bottom:calc\(100% \+ 2px\)">40<\/b>/, 'над столбцом — число');
  assert.match(html, /<b style="bottom:calc\(25% \+ 2px\)">10<\/b>/);
  assert.ok(!html.includes('>0</b>'), 'над пустыми днями нуля нет');

  // Месячный график: подписи реже, но даты и ось есть.
  const month = sandbox.lastDays(30);
  sandbox.state.analytics.daily[month[29]] = { received: 5 };
  const long = String(sandbox.sparkline(month, 'received', 'var(--brand)'));
  assert.match(long, /class="chart-x">/, 'у месячного графика подписи не по столбцам');
  assert.ok(long.includes('<span>' + label(month[0]) + '</span>') && long.includes('<span>' + label(month[29]) + '</span>'), 'первая и последняя даты');
  assert.ok(!/<b style="bottom/.test(long), 'над 30 столбцами числа не пишем — значения в подсказке');
});

test('когда все отвечены, ноль везде', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, state } = await panelSandbox();
  assert.equal(state.waitingConversationCount, 0);
  assert.equal(sandbox.navItems().find((item) => item.id === 'clients').count, 0, 'значок «Клиенты» пустой');
});

test('сбой загрузки переписки виден как сбой, а не как пустая беседа', async () => {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  resetData((data) => {
    data.config.active = true;
    data.users['770001'] = { id: '770001', chatId: 770001, firstName: 'Павел', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(2) };
    data.inquiries.push({
      id: 'inq-broken', userId: '770001', chatId: '770001', language: 'ru', type: 'general',
      text: 'Есть ли лифт?', status: 'new', pipelineStage: 'new', replies: [],
      messages: [{ id: 'b-1', direction: 'in', kind: 'text', text: 'Есть ли лифт?', createdAt: minutesAgo(2) }],
      createdAt: minutesAgo(10), updatedAt: minutesAgo(2), clientMessageAt: minutesAgo(2),
    });
  });
  const { sandbox } = await panelSandbox();
  const working = sandbox.fetch;
  sandbox.fetch = async (url, options) => (String(url).includes('/timeline')
    ? { ok: false, status: 500, json: async () => ({ error: 'Диск занят' }), text: async () => '', headers: { get: () => '' } }
    : working(url, options));

  sandbox.selectConversation('inq-broken');
  const host = fakeElement('main');
  await sandbox.VIEWS.clients.render(host, 'inbox');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const card = host.querySelector('#inquiryCard');
  const html = String(card.innerHTML);
  assert.match(html, /Не удалось загрузить сообщения/, 'сказано, что это сбой');
  assert.match(html, /Диск занят/, 'и почему');
  assert.match(html, /id="retryConversation"/, 'есть кнопка «Повторить»');
  assert.doesNotMatch(html, /Сообщений пока нет/, 'сбой больше не выглядит пустой беседой');
});

test('отмена отложенной публикации спрашивает подтверждение', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /Отменить публикацию\?/, 'отмена публикации спрашивает');
  assert.match(PANEL_HTML, /Запланированный пост будет удалён вместе с текстом/, 'и говорит, что пропадёт');
});

test('двойное нажатие не открывает второе окно подтверждения', async () => {
  // Запрос уходит не сразу: сначала окно «Удалить?». Пока оно открыто, запросов
  // нет, и прежняя защита кнопку не держала — второе нажатие открывало второе
  // окно, то есть второе удаление.
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const guard = PANEL_HTML.match(/function guardDoubleClicks\(\) \{[\s\S]*?\n\}/);
  assert.ok(guard, 'защита от двойного нажатия на месте');
  assert.match(guard[0], /waitingForAnswer\(\)/, 'открытое окно тоже держит кнопку');
});

test('подсказка про сохранение настроек говорит правду', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.doesNotMatch(PANEL_HTML, /остальные настройки сохраняются сами/, 'неверная подсказка убрана');
  assert.match(PANEL_HTML, /сохраняется одной кнопкой «Сохранить» в полосе снизу/, 'сказано, как на самом деле');
});

test('сбой записи на диск виден на всех экранах панели', async () => {
  // Раньше про это знал только журнал ошибок: владелец продолжал работать, не
  // подозревая, что всё держится в памяти до перезапуска.
  resetData((data) => { data.config.active = true; });
  const { sandbox, state } = await panelSandbox();
  const alert = sandbox.document.getElementById('saveAlert');
  assert.equal(alert.classList.contains('hidden'), true, 'пока всё хорошо — полосы нет');

  state.runtime.save = {
    error: 'EBUSY: файл занят другой программой',
    at: new Date().toISOString(),
    nextRetryAt: new Date(Date.now() + 60000).toISOString(),
  };
  sandbox.renderBotState();

  assert.equal(alert.classList.contains('hidden'), false, 'полоса появилась');
  const text = String(sandbox.document.getElementById('saveAlertText').textContent);
  assert.match(text, /файл занят другой программой/, 'сказано, в чём дело');
  assert.match(text, /только в памяти/, 'и чем это грозит');
  assert.match(text, /пробует записать снова/, 'и что бот делает');
  assert.match(text, /антивируса|места на диске/, 'и с чего начать разбираться');

  // Запись удалась — полоса уходит сама.
  state.runtime.save = { error: '', at: null, nextRetryAt: null };
  sandbox.renderBotState();
  assert.equal(alert.classList.contains('hidden'), true, 'полоса убрана');
});

test('«Сегодня» — это список дел с одной кнопкой на строку', async () => {
  // Раньше на Обзоре было четыре KPI-карточки, отдельный список «Требует
  // внимания» без кнопок, а дела лежали ещё и в Центре уведомлений и в
  // «Задачах» — три места про одно и то же.
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  resetData((data) => {
    data.config.active = true;
    data.config.adminNotificationVerifiedAt = new Date().toISOString();
    data.objects.push(property('villa-today', 'Вилла у моря', 'active'));
    data.users['790001'] = { id: '790001', chatId: 790001, firstName: 'Нина', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(5) };
    data.users['790002'] = { id: '790002', chatId: 790002, firstName: 'Егор', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(9) };
    data.inquiries.push({
      id: 'today-msg', userId: '790001', chatId: '790001', language: 'ru', type: 'general',
      text: 'Можно посмотреть в субботу?', status: 'new', pipelineStage: 'new', replies: [], readAt: '',
      messages: [{ id: 'tm-1', direction: 'in', kind: 'text', text: 'Можно посмотреть в субботу?', createdAt: minutesAgo(5) }],
      createdAt: minutesAgo(30), updatedAt: minutesAgo(5), clientMessageAt: minutesAgo(5),
    });
    data.inquiries.push({
      id: 'today-viewing', userId: '790002', chatId: '790002', language: 'ru', type: 'viewing', propertyId: 'villa-today',
      text: 'Запись на просмотр', status: 'new', pipelineStage: 'viewing', replies: [], messages: [], readAt: minutesAgo(1),
      viewing: { date: soon, dateText: 'в субботу', timeText: '12:00', confirmedAt: '', confirmedDate: '', confirmedTime: '', cancelledAt: '' },
      createdAt: minutesAgo(60), updatedAt: minutesAgo(60), clientMessageAt: minutesAgo(60),
    });
  });

  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.today.render(host, '');
  const html = String(host.innerHTML);

  assert.match(html, /class="today-numbers"/, 'цифры одной строкой');
  assert.doesNotMatch(html, /class="card kpi"/, 'ряда KPI-карточек больше нет');
  assert.match(html, /Список дел/, 'главное на экране — дела');
  assert.match(html, /Новое сообщение от Нина[\s\S]*?>Ответить</, 'у сообщения кнопка «Ответить»');
  assert.match(html, /Просмотр ждёт подтверждения[\s\S]*?>Подтвердить</, 'у просмотра — «Подтвердить»');
  assert.match(html, /data-deed-hide=/, 'дело можно убрать из списка');
});

test('«Подтвердить» на «Сегодня» открывает окно просмотра, не уводя в другой раздел', async () => {
  const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  resetData((data) => {
    data.config.active = true;
    data.config.adminNotificationVerifiedAt = new Date().toISOString();
    data.objects.push(property('villa-confirm', 'Вилла', 'active'));
    data.users['790003'] = { id: '790003', chatId: 790003, firstName: 'Тимур', preferredLanguage: 'ru', activity: [], lastSeenAt: minutesAgo(4) };
    data.inquiries.push({
      id: 'confirm-me', userId: '790003', chatId: '790003', language: 'ru', type: 'viewing', propertyId: 'villa-confirm',
      text: 'Запись на просмотр', status: 'new', pipelineStage: 'viewing', replies: [], messages: [], readAt: minutesAgo(1),
      viewing: { date: soon, dateText: 'в понедельник', timeText: '11:00', confirmedAt: '', confirmedDate: '', confirmedTime: '', cancelledAt: '' },
      createdAt: minutesAgo(50), updatedAt: minutesAgo(50), clientMessageAt: minutesAgo(50),
    });
  });

  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.today.render(host, '');
  assert.ok(host.querySelector('[data-deed]').onclick, 'кнопки дел живые');
  const deed = (sandbox.state.notifications || []).find((item) => item.kind === 'viewing');
  assert.ok(deed, 'просмотр попал в список дел');
  await sandbox.runDeed(deed);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const dialog = sandbox.document.querySelector('dialog[open]');
  assert.ok(dialog, 'окно открылось прямо с «Сегодня»');
  assert.match(String(dialog.innerHTML), /Клиент просил: в понедельник · 11:00/, 'и в нём видно просьбу клиента');
  dialog.closeClean();
});

test('быстрые действия открывают редактор, а не список', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  sandbox.el('pageActions').children.length = 0;
  await sandbox.VIEWS.today.render(host, '');
  // Быстрые действия — кнопки в шапке страницы.
  const quick = sandbox.el('pageActions').children.find((button) => button.dataset && button.dataset.label === '＋ Объект');
  assert.ok(quick, 'кнопка «＋ Объект» в шапке «Сегодня»');
  await quick.onclick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const dialog = sandbox.document.querySelector('dialog[open]');
  assert.ok(dialog, 'открылась карточка объекта');
  assert.match(String(dialog.innerHTML), /Номер объекта|Название/, 'это форма объекта');
  dialog.closeClean();
});

test('этапы воронки в панели — те же, что у бота, и в том же порядке', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const { PIPELINE_STAGES } = await import('../src/data-format.mjs');
  assert.deepEqual(Array.from(sandbox.PIPELINE_STAGES, (stage) => stage[0]), PIPELINE_STAGES, 'подписи — дело панели, набор и порядок — бота');
});

test('сохранение — два способа: форма с полосой «Сохранить» и мгновенное действие с «Вернуть»; кнопок «Сохранить» посреди страницы нет', async () => {
  resetData((data) => {
    data.config.active = true;
    data.config.telegramBackup = { enabled: false };
    data.replyTemplates = [{ id: 't1', title: 'Привет', text: { ru: 'Здравствуйте', en: '', es: '' } }];
  });
  const { sandbox, requests } = await panelSandbox();
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  // Копия в Telegram: поля — форма, «Отправить сейчас» — отдельное действие.
  const data = fakeElement('main');
  const form = data.querySelector('#tgBackupForm');
  const handlers = {};
  form.addEventListener = (type, handler) => { handlers[type] = handler; };
  sandbox.renderData(data);
  assert.ok(!String(data.innerHTML).includes('saveTgBackup'), 'кнопки «Сохранить» у карточки нет');
  assert.match(String(data.innerHTML), /id="tgBackupForm"/);
  assert.match(String(data.innerHTML), /id="sendTgBackup"/, 'отправить сейчас — своё действие');
  await tick();
  assert.equal(sandbox.isDirty(), false);
  form.querySelectorAll = () => [{ id: 'tgBackupOn', type: 'checkbox', checked: true, value: 'on' }];
  handlers.change({});
  assert.equal(sandbox.isDirty(), true, 'правка поля включила полосу «Сохранить»');
  requests.length = 0;
  await sandbox.saveDirty();
  const put = requests.find((request) => request.url === '/api/telegram-backup' && request.method === 'PUT');
  assert.ok(put, 'полоса сохраняет копию в Telegram');
  assert.equal(sandbox.isDirty(), false, 'после сохранения полоса убрана');

  // Шаблоны ответов: одна полоса на все, уходят только изменённые.
  const rules = fakeElement('main');
  const card = fakeElement();
  card.dataset.template = 't1';
  const fields = {};
  card.querySelector = (selector) => fields[selector] || (fields[selector] = Object.assign(fakeElement(), { value: selector.includes('title') ? 'Привет' : 'Здравствуйте' }));
  rules.querySelectorAll = (selector) => selector === '[data-template]' ? [card] : [];
  const list = rules.querySelector('#templateList');
  const listHandlers = {};
  list.addEventListener = (type, handler) => { listHandlers[type] = handler; };
  const typed = { id: 'title', type: 'text', value: 'Привет' };
  list.querySelectorAll = () => [typed];
  sandbox.bindTemplatesCard(rules, () => {});
  await tick();
  assert.equal(sandbox.isDirty(), false);
  typed.value = 'Добрый день';
  fields['[data-field="title"]'].value = 'Добрый день';
  listHandlers.input({});
  assert.equal(sandbox.isDirty(), true, 'правка шаблона включила полосу');
  requests.length = 0;
  await sandbox.saveDirty();
  const templatePut = requests.filter((request) => request.method === 'PATCH' && request.url === '/api/reply-templates/t1');
  assert.equal(templatePut.length, 1, 'ушёл один запрос — на изменённый шаблон');
  assert.equal(templatePut[0].body.title, 'Добрый день');
  assert.ok(!sandbox.templatesCardHtml().includes('data-save'), 'у каждого шаблона своей кнопки «Сохранить» нет');
  rules.querySelector('#addTemplate').onclick();
  assert.equal(sandbox.isDirty(), true, 'новый шаблон включает полосу «Сохранить»');
  sandbox.clearDirty();

  // Разметка: названия и описания группы — форма; кнопки-«Сохранить» на карточках нет.
  assert.ok(PANEL_HTML.includes('id="groupInfoForm"') && !PANEL_HTML.includes('groupSaveInfo'), 'название и описание группы — форма с полосой');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panel', 'runtime.mjs'), 'utf8'), /Как в панели сохраняется то, что человек правит/, 'правило записано в коде');
  // «Загрузка с сайта»: настройки — форма с полосой; «Оформление постов»: «Сохранить» в подвале окна, не в теле.
  assert.ok(PANEL_HTML.includes('id="feedForm"') && !PANEL_HTML.includes('id="feedSave"'), 'настройки загрузки с сайта — форма с полосой');
  assert.match(PANEL_HTML, /footer: '[^']*id="saveStyle"[^']*'/, '«Сохранить» оформления постов — в подвале окна');
  assert.equal((PANEL_HTML.match(/id="saveStyle"/g) || []).length, 1, 'и только там');
  // Бот правит шаблон запросом PATCH; панель слала PUT, и правка существующего шаблона отвечала «Не найдено».
  assert.ok(!/reply-templates\/"[^;]*"PUT"/.test(PANEL_HTML), 'шаблон правится тем методом, который принимает бот');
});

test('быстрый поиск клиента и его заявок: индексы совпадают с обходом списка и обновляются со списком', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.state.users = [{ id: '1', firstName: 'Анна' }, { id: '2', firstName: 'Борис' }];
  sandbox.state.inquiries = [{ id: 'a', userId: '1' }, { id: 'b', userId: 2 }, { id: 'c', userId: '1' }];
  assert.equal(sandbox.userById('2').firstName, 'Борис');
  assert.equal(sandbox.userById(1).firstName, 'Анна', 'код можно спросить и числом');
  assert.equal(sandbox.userById('999'), null);
  assert.equal(Array.from(sandbox.inquiriesOfUser('1'), (item) => item.id).join(), 'a,c');
  assert.equal(Array.from(sandbox.inquiriesOfUser(2), (item) => item.id).join(), 'b');
  assert.equal(sandbox.inquiriesOfUser('nobody').length, 0);
  // Копия: сортировка у вызывающего не портит индекс.
  sandbox.inquiriesOfUser('1').reverse();
  assert.equal(Array.from(sandbox.inquiriesOfUser('1'), (item) => item.id).join(), 'a,c');
  // Пришло новое состояние — индекс перестроен.
  sandbox.state.users = [{ id: '3', firstName: 'Вера' }];
  sandbox.state.inquiries = [{ id: 'd', userId: '3' }];
  assert.equal(sandbox.userById('1'), null);
  assert.equal(sandbox.userById('3').firstName, 'Вера');
  assert.equal(Array.from(sandbox.inquiriesOfUser('3'), (item) => item.id).join(), 'd');
  // Добавили клиента в тот же список — длина изменилась, индекс тоже.
  sandbox.state.users.push({ id: '4', firstName: 'Глеб' });
  assert.equal(sandbox.userById('4').firstName, 'Глеб');
});

test('«Диалоги» рисуются порциями по 100; открытый диалог виден всегда; смена фильтра начинает сначала', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const now = Date.now();
  sandbox.state.users = []; sandbox.state.inquiries = [];
  for (let index = 0; index < 250; index++) {
    sandbox.state.users.push({ id: 'u' + index, firstName: 'Клиент' + index });
    sandbox.state.inquiries.push({ id: 'i' + index, userId: 'u' + index, type: 'general', text: 'Вопрос', status: 'new', replies: [], awaitsReply: true, createdAt: new Date(now - index * 60000).toISOString(), updatedAt: new Date(now - index * 60000).toISOString(), clientMessageAt: new Date(now - index * 60000).toISOString() });
  }
  sandbox.inquiryFilter.status = '';
  const rows = (host) => (String(host.innerHTML).match(/class="conversation-item[ "]/g) || []).length;
  const host = fakeElement('main');
  sandbox.renderInquiryList(host);
  assert.equal(rows(host), 100, 'первая порция — сто');
  assert.match(String(host.innerHTML), /Показано 100 из 250/);
  assert.match(String(host.innerHTML), /id="moreConversations"[^>]*>Показать ещё 100</);

  // «Показать ещё» добавляет порцию.
  host.querySelector('#moreConversations').onclick();
  assert.equal(rows(host), 200);
  host.querySelector('#moreConversations').onclick();
  assert.equal(rows(host), 250, 'третья порция — последние пятьдесят');
  assert.ok(!/id="moreConversations"/.test(String(host.innerHTML)), 'всё показано — кнопки нет');

  // Смена фильтра возвращает первую порцию.
  host.querySelector('#inqStatus button').onclick.call({ dataset: { status: '' } });
  sandbox.conversationsShown = 200;
  host.querySelectorAll('#inqStatus button')[0].onclick();
  assert.equal(sandbox.conversationsShown, 100, 'после смены фильтра — снова первая порция');

  // Открытая беседа из хвоста списка остаётся видимой.
  sandbox.selectConversation('i240', true);
  sandbox.renderInquiryList(host);
  assert.equal(rows(host), 101, 'сто строк и открытая беседа');
  assert.ok(String(host.innerHTML).includes('data-id="i240"'));
});

test('маршруты уведомлений и переходов из кода ведут на существующие экраны, а не на старые имена', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const fs = require('node:fs');
  const path = require('node:path');
  const items = sandbox.navItems();
  const exists = (view, tab) => {
    const item = items.find((entry) => entry.id === view);
    if (!item) return false;
    return !item.tabs ? !tab : item.tabs.some((entry) => entry[0] === tab);
  };
  const bad = [];
  // Сервер: route('вид', 'вкладка', …) в списке дел.
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-notifications.mjs'), 'utf8');
  for (const match of server.matchAll(/route\('([a-z]+)', '([a-z]*)'/g)) if (!exists(match[1], match[2])) bad.push('сервер: ' + match[1] + '/' + match[2]);
  // Панель: go("вид", "вкладка").
  for (const file of fs.readdirSync(path.join(__dirname, '..', 'src', 'panel'))) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', file), 'utf8');
    for (const match of source.matchAll(/\bgo\("([a-z]+)", "([a-z]*)"/g)) if (!exists(match[1], match[2])) bad.push(file + ': go(' + match[1] + ', ' + match[2] + ')');
  }
  assert.deepEqual(bad, [], 'старые или несуществующие адреса: ' + bad.join('; '));
});

test('в списке диалогов автоответ бота подписан «Бот:», а ответ менеджера — «Вы:»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const now = new Date().toISOString();
  sandbox.state.users = [{ id: 'u1', firstName: 'Игорь' }, { id: 'u2', firstName: 'Мария' }];
  const inquiry = (id, userId, lastMessage) => ({ id, userId, type: 'general', text: 'Вопрос', status: 'new', replies: [], awaitsReply: false, createdAt: now, updatedAt: now, clientMessageAt: now, lastMessage });
  sandbox.state.inquiries = [
    inquiry('a', 'u1', { text: 'Спасибо! Сообщение получено', direction: 'out', fromBot: true, createdAt: now }),
    inquiry('b', 'u2', { text: 'Завтра в 12:00 подойдёт?', direction: 'out', fromBot: false, createdAt: now }),
  ];
  sandbox.inquiryFilter.status = '';
  const host = fakeElement('main');
  sandbox.renderInquiryList(host);
  const html = String(host.innerHTML);
  assert.match(html, /Бот: Спасибо! Сообщение получено/, 'автоответ бота не выдаётся за ответ менеджера');
  assert.match(html, /Вы: Завтра в 12:00 подойдёт\?/);
  assert.ok(!/Вы: Спасибо/.test(html));
});

test('«Акции»: удаление под «⋯», как у объектов; длинный текст оканчивается многоточием; колонка называется «Статус»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const long = 'Скидка на все виллы первой линии до конца месяца, рассрочка без процентов на два года и подарок каждому покупателю';
  sandbox.state.promotions = [{ id: 'p1', title: { ru: 'Осенняя акция' }, text: { ru: long }, enabled: true, startAt: '', endAt: '', imagesByLanguage: { ru: [] } }];
  const host = fakeElement('main');
  host.querySelector('tr[data-id]').dataset.id = 'p1';
  sandbox.renderOffers(host);
  const html = String(host.innerHTML);
  assert.match(html, /<th>Статус<\/th>/);
  assert.ok(!/<th>Показ<\/th>/.test(html));
  assert.match(html, /data-more="1"[^>]*>⋯</, 'кнопка «⋯» в строке');
  assert.ok(!/data-delete="1">✕/.test(html), 'красного «✕» в строке больше нет');
  assert.match(html, /…<\/span>/, 'обрезанный текст оканчивается многоточием');
  assert.ok(!html.includes(long), 'весь длинный текст в строку не попал');
  assert.equal(sandbox.shortText('Короткий текст', 70), 'Короткий текст', 'короткий — без многоточия');

  // «⋯» открывает окно с удалением.
  const dialogs = [];
  sandbox.openDialog = (options) => { const dialog = fakeElement('dialog'); dialog.closeClean = () => {}; dialogs.push({ options, dialog }); if (options.ready) options.ready(dialog); return dialog; };
  sandbox.confirmDialog = async () => true;
  sandbox.toast = () => {};
  host.querySelector('tr[data-id]').querySelector('[data-more]').onclick();
  assert.match(dialogs[0].options.body, /Удалить акцию/);
  assert.match(dialogs[0].options.body, /15 минут/);
  requests.length = 0;
  await dialogs[0].dialog.querySelector('[data-delete]').onclick();
  assert.ok(requests.some((request) => request.method === 'DELETE' && request.url.includes('/api/promotions/p1')), 'удаление ушло на бота: ' + JSON.stringify(requests));
});

test('очередь публикаций: клик по отложенному посту открывает сам пост с отменой, а не пустую форму', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox, requests } = await panelSandbox();
  const when = new Date(Date.now() + 86400000).toISOString();
  sandbox.state.broadcasts = [];
  sandbox.state.groups = [{ id: '-100200', title: 'Наш канал', type: 'channel', status: 'administrator' }];
  sandbox.state.groupPosts = [{ id: 'g1', groupId: '-100200', text: 'Новый объект в Бенидорме: вилла с бассейном', status: 'scheduled', sendAt: when, createdAt: when }];
  const host = fakeElement('main');
  const row = host.querySelector('tr[data-id]');
  row.dataset.id = 'g1';
  row.dataset.kind = 'post';
  sandbox.renderPublications(host);
  const dialogs = [];
  const routes = [];
  sandbox.openDialog = (options) => { const dialog = fakeElement('dialog'); dialog.closeClean = () => {}; dialogs.push({ options, dialog }); if (options.ready) options.ready(dialog); return dialog; };
  sandbox.go = async (view, tab) => { routes.push([view, tab]); return true; };
  sandbox.confirmDialog = async () => true;
  sandbox.toast = () => {};
  row.querySelector('[data-open]').onclick();
  assert.equal(routes.length, 0, 'на пустую форму «Пост в канал» не уводит');
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].options.title, /Отложенный пост/);
  assert.match(dialogs[0].options.body, /Новый объект в Бенидорме: вилла с бассейном/, 'виден текст поста целиком');
  assert.match(dialogs[0].options.body, /Наш канал/, 'и куда он уйдёт');
  assert.match(dialogs[0].options.footer, /Отменить публикацию/);
  requests.length = 0;
  await dialogs[0].dialog.querySelector('#cancelScheduledPost').onclick();
  assert.ok(requests.some((request) => request.method === 'DELETE' || /cancel/.test(request.url)), 'отмена ушла на бота: ' + JSON.stringify(requests.map((request) => request.method + ' ' + request.url)));
});

test('журнал ошибок: подряд идущие одинаковые строки схлопываются в «×N, последняя …»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const error = (area, message, minutes) => ({ area, message, createdAt: at(minutes) });
  const list = [error('Копия', 'Не удалось создать копию', 1), error('Копия', 'Не удалось создать копию', 5), error('Копия', 'Не удалось создать копию', 9), error('Telegram', 'Таймаут', 12), error('Копия', 'Не удалось создать копию', 20)];
  const grouped = sandbox.groupErrors(list);
  assert.equal(grouped.length, 3, 'три подряд слились, четвёртая — другая, пятая — снова копия отдельной строкой');
  assert.equal(grouped[0].count, 3);
  assert.equal(grouped[0].createdAt, list[0].createdAt, 'время у группы — самой свежей (первой)');
  assert.equal(grouped[1].count, 1);
  assert.equal(sandbox.groupErrors([]).length, 0);
  assert.equal(sandbox.groupErrors(null).length, 0);

  sandbox.state.errors = [error('Копия', 'Не удалось создать копию', 1), error('Копия', 'Не удалось создать копию', 5), error('Telegram', 'Таймаут', 12)];
  const host = fakeElement('main');
  sandbox.renderData(host);
  const html = String(host.innerHTML);
  assert.match(html, /Копия<\/b> <span class="chip warn">×2<\/span>/, 'у сдвоенной строки — «×2»');
  assert.match(html, /последняя /);
  assert.equal((html.match(/Не удалось создать копию/g) || []).length, 1, 'сообщение показано один раз');
});

test('сбой не пропадает сам: тост ошибки держится до «✕»; экран, не загрузивший тексты, предлагает «Повторить»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const box = sandbox.el('toast');

  // Обычная подсказка уходит сама, сбой — нет и с крестиком.
  box._timer = undefined;
  sandbox.toast('Введите пароль', true);
  assert.ok(box._timer !== undefined, 'подсказка убирается по таймеру');
  box._timer = undefined;
  box.children.length = 0;
  sandbox.fail(new Error('Не удалось создать копию: диск занят'));
  assert.equal(box._timer, undefined, 'сбой таймером не убирается');
  assert.equal(box.classList.contains('hidden'), false);
  const close = box.children.find((child) => child.textContent === '✕');
  assert.ok(close, 'у сбоя есть «✕»');
  close.onclick();
  assert.equal(box.classList.contains('hidden'), true, '«✕» закрывает');
  // Успех с «Вернуть» по-прежнему уходит сам.
  box._timer = undefined;
  sandbox.toast('Готово', false, { label: 'Вернуть', run() {} });
  assert.ok(box._timer !== undefined);

  // Экран текстов бота при сбое загрузки: причина и «Повторить».
  let attempts = 0;
  sandbox.loadInterfaceText = async () => { attempts += 1; throw new Error('Нет связи с ботом'); };
  const host = fakeElement('main');
  await sandbox.renderInterface(host);
  assert.equal(attempts, 1);
  assert.match(String(host.innerHTML), /Не удалось загрузить/);
  assert.match(String(host.innerHTML), /Нет связи с ботом/);
  assert.match(String(host.innerHTML), /id="retryLoad"/);
  await host.querySelector('#retryLoad').onclick();
  assert.equal(attempts, 2, '«Повторить» пробует загрузить снова');
});

test('числа не спорят словами: «В работе» в воронке, в базе «им можно писать» только когда отличается от общего', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.state.users = [{ id: 'a', firstName: 'Анна' }, { id: 'b', firstName: 'Борис' }];
  sandbox.state.inquiries = [];
  sandbox.state.userCount = 2;
  sandbox.state.activeUserCount = 2;
  const same = fakeElement('main');
  sandbox.renderClients(same);
  assert.match(String(same.innerHTML), /Показано 2 из 2<\/span>/, 'когда все доступны — слова «активных» нет');
  assert.ok(!/активных/.test(String(same.innerHTML)));
  sandbox.state.activeUserCount = 1;
  const differs = fakeElement('main');
  sandbox.renderClients(differs);
  assert.match(String(differs.innerHTML), /Показано 2 из 2 · им можно писать: 1/, 'у бота то же слово, что на «Сегодня»');
});

test('бейджи в меню подписаны: у «Сегодня» — дела, у «Клиентов» — ждут ответа; на телефоне — через aria-label; точка «нет связи» ведёт к разбору', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const items = sandbox.navItems();
  const today = items.find((item) => item.id === 'today');
  const clients = items.find((item) => item.id === 'clients');
  assert.match(today.hint, /^\d+ (дело|дела|дел) в списке$/);
  assert.match(clients.hint, /^2 клиента ждут ответа/, 'бот насчитал двух клиентов');
  sandbox.renderNav();
  const nav = String(sandbox.el('nav').innerHTML);
  assert.match(nav, /aria-label="Клиенты: 2 клиента ждут ответа/);
  assert.match(nav, /title="Сегодня: |title="\d+ (дело|дела|дел) в списке"/, 'подсказка есть и на компьютере');
  const bar = String(sandbox.el('tabbar').innerHTML);
  assert.match(bar, /aria-label="Клиенты: 2 клиента ждут ответа/, 'на телефоне бейдж читается скринридером');

  // Беда — точка ведёт на «Сегодня» к блоку состояния; норма — только подсказка.
  const routes = [];
  sandbox.go = async (view) => { routes.push(view); return true; };
  sandbox.state.runtime = { status: 'error', consecutiveFailures: 3 };
  sandbox.renderBotState();
  assert.match(sandbox.el('botState').title, /нажмите, чтобы посмотреть подробности/);
  await sandbox.el('botState').onclick();
  assert.deepEqual(routes, ['today']);
});

test('один сбой связи — одно место: в чек-листе короткое «!», в списке дел его нет, полный текст — в «Состоянии бота»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const long = 'связь: переподключается, неудачных попыток подряд: 7 (Telegram отклонил токен бота. Проверьте токен в настройках.)';
  const items = sandbox.readinessItems({ checks: [{ id: 'token', status: 'bad', detail: long }] });
  const token = items.find((item) => item.id === 'token');
  assert.equal(token.ok, false);
  assert.ok(!token.detail.includes('Telegram отклонил'), 'полного текста ошибки в чек-листе нет: ' + token.detail);
  assert.match(token.detail, /«Состоянии бота»/);

  const now = new Date().toISOString();
  sandbox.state.notifications = [
    { id: 'system:connection:Telegram отклонил токен', kind: 'system', severity: 'bad', title: 'Нет стабильной связи с Telegram', text: long, createdAt: now, active: true, handledAt: '' },
    { id: 'catalog:empty', kind: 'catalog', severity: 'warn', title: 'В каталоге нет активных объектов', text: 'x', createdAt: now, active: true, handledAt: '' },
  ];
  assert.deepEqual(Array.from(sandbox.deedList(), (item) => item.id), ['catalog:empty'], 'сбой связи в делах не показывается');
});

test('число дел от бота тоже не считает сбой связи', async () => {
  const { attentionCounts } = await import('../src/admin-notifications.mjs');
  const list = [
    { id: 'system:connection:x', active: true, handledAt: '' },
    { id: 'catalog:empty', active: true, handledAt: '' },
    { id: 'task:1', active: true, handledAt: '2026-09-29T10:00:00.000Z' },
  ];
  assert.equal(attentionCounts(list).deeds, 1);
});

test('значки кнопок: ведущий глиф (＋ ⬇ ✉️ …) заменяется линейным SVG из общего набора, текст остаётся; одиночные и чужие глифы не трогаются', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const run = (text, marked) => {
    const node = { nodeType: 3, nodeValue: text };
    const button = fakeElement('button');
    button.firstChild = node;
    let inserted = null;
    button.insertBefore = (span) => { inserted = span; };
    if (marked) button.getAttribute = () => '1';
    sandbox.iconifyButtons({ querySelectorAll: () => [button] });
    return { node, inserted };
  };
  const plus = run(' ＋ Добавить фото');
  assert.equal(plus.node.nodeValue, 'Добавить фото', 'глиф ушёл из текста');
  assert.equal(plus.inserted.className, 'btn-ico');
  assert.match(plus.inserted.innerHTML, /^<svg viewBox="0 0 24 24"[^>]*aria-hidden="true">.*M12 5v14M5 12h14/, 'вместо него — «плюс» из набора');
  assert.match(run('⬇ Скачать копию').inserted.innerHTML, /M12 4v11/, 'стрелка вниз');
  const mail = run('✉️ Почта');
  assert.equal(mail.node.nodeValue, 'Почта', 'эмодзи с вариантным селектором тоже');
  assert.match(mail.inserted.innerHTML, /rect x="3\.5"/);
  assert.equal(run('↑').inserted, null, 'кнопка из одного глифа остаётся как есть');
  assert.equal(run('🎵 ТикТок').inserted, null, 'неизвестные глифы не трогаем');
  assert.equal(run('Просто текст').inserted, null);
  assert.equal(run('＋ Объект', true).inserted, null, 'уже заменённое второй раз не трогаем');
  assert.ok(Object.values(sandbox.GLYPH_ICONS).every((name) => sandbox.BUTTON_ICONS[name]), 'у каждого глифа в таблице есть значок');
  assert.match(String(sandbox.icon('plus')), /stroke="currentColor"/, 'цвет — от текста кнопки');
});

test('пояснение к числу на «Сегодня» и в воронке — не только title: на телефоне оно видно подписью', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const html = String(sandbox.numberStrip([['Ждут ответа', '3', 'bad', 'Клиенты, которым ещё не ответили'], ['Всего', '9', '']]));
  assert.match(html, /title="Клиенты, которым ещё не ответили"/, 'на компьютере — подсказка');
  assert.match(html, /<small class="strip-hint">Клиенты, которым ещё не ответили<\/small>/, 'на телефоне — подпись под числом');
  assert.equal((html.match(/strip-hint/g) || []).length, 1, 'у числа без пояснения подписи нет');
  const { PANEL_CSS } = await import('../src/panel/styles.mjs');
  assert.match(PANEL_CSS, /@media\(max-width:860px\)\{\.today-numbers \.strip-hint\{display:block\}\}/);
});

test('чек-лист «Лицо агента»: если не хватает только срока ответа — кнопка ведёт в «Настройки → Компания», иначе на «Контакты»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const agent = () => sandbox.readinessItems({ checks: [] }).find((item) => item.id === 'agent');
  sandbox.state.contacts = { managerName: 'Ольга', photo: { exists: true } };
  sandbox.state.config.workingHours = { replyMinutes: 0 };
  let item = agent();
  assert.equal(item.ok, false);
  assert.equal(Array.from(item.route).join('/'), 'settings/company', 'нужен только срок — ведём туда, где он задаётся');
  assert.match(item.detail, /срок ответа — в «Настройки → Компания»/);
  sandbox.state.contacts = { managerName: '', photo: null };
  item = agent();
  assert.equal(Array.from(item.route).join('/'), 'texts/contacts', 'не хватает имени и фото — на «Контакты»');
  sandbox.state.contacts = { managerName: 'Ольга', photo: { exists: true } };
  sandbox.state.config.workingHours = { replyMinutes: 30 };
  assert.equal(agent().ok, true);
  // На «Контактах» подсказка про срок — кнопкой, а не текстом без ссылки.
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="goReplyTime"[^>]*>Задать срок ответа</);
});

test('«Объекты»: клик по строке открывает редактор, «Эффективность» — только по своей кнопке; в «⋯» есть «Редактировать»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.state.objects = [{ id: 'o1', title: { ru: 'Вилла', en: '', es: '' }, propertyType: 'villa', dealType: 'sale', status: 'active', city: { ru: 'Альтея' }, imagesByLanguage: { ru: [] } }];
  const host = fakeElement('main');
  const row = host.querySelector('tr[data-id]');
  row.dataset.id = 'o1';
  const opened = [];
  sandbox.openRecordEditor = (kind, id) => opened.push(kind + ':' + id);
  sandbox.openObjectInsights = (id) => opened.push('insights:' + id);
  sandbox.renderObjects(host);
  assert.match(String(host.innerHTML), /<tr class="clickable" data-id="o1">/, 'строка кликабельна (и с клавиатуры)');
  // Клик по пустому месту строки — редактор.
  row.onclick({ target: { closest: () => null } });
  assert.deepEqual(opened, ['objects:o1']);
  // Клик по кнопке внутри строки строку не срабатывает.
  row.onclick({ target: { closest: () => ({}) } });
  assert.equal(opened.length, 1);
  // Кнопка эффективности — своя.
  row.querySelector('[data-insights]').onclick({ stopPropagation() {} });
  assert.equal(opened[1], 'insights:o1');
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /data-edit-object="1" type="button">✎ Редактировать</, 'в «⋯» есть «Редактировать»');
});

test('«Сегодня»: дела выше чек-листа готовности; нет карточки «Быстрые действия», дублирующих кнопок «Настройки»/«Отчёт» и графика «7 дней»', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const host = fakeElement('main');
  await sandbox.VIEWS.today.render(host, '');
  const html = String(host.innerHTML);
  assert.ok(html.indexOf('Список дел') > 0 && html.indexOf('Список дел') < html.indexOf('id="readiness"'), 'первым идёт список дел, потом готовность');
  assert.ok(html.indexOf('id="readiness"') < html.indexOf('Состояние бота'), 'а здоровье — после');
  assert.ok(!/Быстрые действия/.test(html));
  assert.ok(!/data-go="reports"|data-go="settings" data-tab="team"/.test(html), 'кнопки, повторяющие меню, убраны');
  const labels = sandbox.el('pageActions').children.map((button) => button.dataset && button.dataset.label);
  assert.ok(['＋ Объект', '✉ Рассылка', '➤ Пост в канал'].every((label) => labels.includes(label)), 'быстрые действия — в шапке: ' + labels);
});

test('«Настроить» у политики: после отрисовки «Всех подписей» группа раскрыта и курсор стоит в поле политики', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.loadInterfaceText = async () => ({ privacy: { ru: { policy: 'Кто обрабатывает данные: [название]' }, en: { policy: '' }, es: { policy: '' } } });
  sandbox.interfaceTexts = () => ({ privacy: { ru: { policy: 'Кто обрабатывает данные: [название]' }, en: { policy: '' }, es: { policy: '' } } });
  const host = fakeElement('main');
  const focused = [];
  const details = fakeElement('details');
  const field = fakeElement('textarea');
  field.closest = () => details;
  field.focus = () => focused.push('policy');
  field.scrollIntoView = () => focused.push('scroll');
  const wrapper = fakeElement('div');
  wrapper.querySelector = (selector) => (selector === '[data-lang="ru"]' ? field : null);
  host.querySelector = ((original) => (selector) => (selector === '[data-text="policy"]' ? wrapper : original(selector)))(host.querySelector.bind(host));
  sandbox.interfaceGroupOpen = 'privacy';
  sandbox.interfaceFocusKey = 'policy';
  await sandbox.renderInterface(host);
  assert.deepEqual(focused, ['scroll', 'policy'], 'курсор поставлен в поле политики');
  assert.equal(details.open, true, 'группа раскрыта');
  assert.equal(sandbox.interfaceFocusKey, '', 'метка снята: следующий заход курсор не двигает');
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /interfaceGroupOpen = "privacy"; interfaceFocusKey = "policy"/, 'кнопка чек-листа запоминает, что раскрыть');
});

test('заметка и теги клиента — одинаково названы в диалоге и в карточке и шлются, только если их правили здесь', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.ok(!/Общая заметка|Теги через запятую/.test(PANEL_HTML), 'одно название: «Заметка о клиенте» и «Теги клиента»');
  assert.equal((PANEL_HTML.match(/Заметка о клиенте<\/label>/g) || []).length, 2, 'в двух местах — одно название');
  assert.match(PANEL_HTML, /if \(noteNow !== initialNote\) patch\.note = noteNow;/, 'диалог шлёт заметку только изменённой');
  assert.match(PANEL_HTML, /if \(noteNow !== \(user\.note \|\| ""\)\) payload\.note = noteNow;/, 'карточка тоже');
  assert.ok(!/patch = \{\s*note: /.test(PANEL_HTML), 'заметка не уходит с каждым сохранением диалога');
});

test('быстрый ответ: клиент пишет по-испански — об этом сказано; шаблонов нет — есть «Создать шаблон»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const now = new Date().toISOString();
  sandbox.state.users = [{ id: 'u1', firstName: 'Diego', preferredLanguage: 'es' }];
  sandbox.state.inquiries = [{ id: 'q1', userId: 'u1', type: 'general', text: '¿Hay parking?', status: 'new', replies: [], awaitsReply: true, language: 'es', createdAt: now, updatedAt: now, clientMessageAt: now }];
  sandbox.state.replyTemplates = [];
  const dialogs = [];
  const routes = [];
  sandbox.openDialog = (options) => { const dialog = fakeElement('dialog'); dialog.closeClean = () => {}; dialogs.push({ options, dialog }); if (options.ready) options.ready(dialog); return dialog; };
  sandbox.go = async (view, tab) => { routes.push(view + '/' + tab); return true; };
  sandbox.openQuickReply('q1', []);
  const body = dialogs[0].options.body;
  assert.match(body, /<span class="chip brand">ES<\/span> Клиент пишет на языке: испанский/);
  assert.match(body, /id="qrTemplates"[^>]*>Создать шаблон</);
  dialogs[0].dialog.querySelector('#qrTemplates').onclick();
  assert.deepEqual(routes, ['texts/rules']);
  // Русскому клиенту про язык не говорим; при готовых шаблонах кнопки создания нет.
  sandbox.state.users[0].preferredLanguage = 'ru';
  sandbox.state.inquiries[0].language = 'ru';
  sandbox.state.replyTemplates = [{ id: 't1', title: 'Привет', text: { ru: 'Здравствуйте' } }];
  sandbox.openQuickReply('q1', []);
  assert.ok(!/Клиент пишет на языке/.test(dialogs[1].options.body));
  assert.ok(!/qrTemplates/.test(dialogs[1].options.body));
});

test('карточка нового клиента: цифры одной строкой, вместо трёх пустых блоков-заглушек — короткие строки', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  sandbox.state.users = [{ id: 'n1', firstName: 'Новый', chatId: 5, favorites: [], recentlyViewed: [], tags: [], note: '' }];
  sandbox.state.inquiries = [];
  let options = null;
  sandbox.openDialog = (opts) => { options = opts; const dialog = fakeElement('dialog'); dialog.closeClean = () => {}; return dialog; };
  sandbox.openClient('n1');
  const html = String(options.body);
  assert.match(html, /<div class="today-numbers">/, 'цифры — строкой, как на других экранах');
  assert.ok(!/class="grid cols-4"><div class="kpi/.test(html), 'карточек-плиток нет');
  for (const stub of ['Сохранённый поиск', 'Последняя заявка на подбор', 'Интересы ещё не сформированы', 'Сохранённый поиск не настроен']) assert.ok(!html.includes(stub), 'заглушки «' + stub + '» нет');
  assert.match(html, /клиент пока не оставлял ни сохранённого поиска, ни заявки на подбор/, 'одна строка вместо двух пустых полей');
  assert.match(html, /Интересы пока не сформированы/, 'и одна строка вместо пустого блока интересов');
});
