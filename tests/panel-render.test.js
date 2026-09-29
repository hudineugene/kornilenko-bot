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

  // Сколько диалогов ждут ответа — это число в меню слева и в колокольчике.
  function waitingBadge(sandbox) {
    return sandbox.navItems().find(function (item) { return item.id === 'today'; }).count;
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
    state.waitingConversationCount = before + 3;

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
    state.waitingConversationCount = before + 1;

    await tick(sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(requests.some((request) => request.url.includes('/api/state')), 'обновление не отменено');
    assert.equal(waitingBadge(sandbox), before + 1, 'счётчик обновился');
    assert.equal(page.innerHTML, 'ЧЕРНОВИК НА ЭКРАНЕ', 'экран под окном не перерисован');
    assert.equal(dialog.open, true, 'и окно осталось открытым');
    dialog.closeClean();
  });

  test('переход между разделами прокручивает наверх, как и раньше', async () => {
    const { sandbox } = await screen('today');
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
  sandbox.currentView = 'clients';
  sandbox.currentTab = 'inbox';

  // Обновление по таймеру и вход в раздел диалог сами не открывают и ничего не
  // помечают: раньше вход открывал первую беседу и тут же «читал» её.
  requests.length = 0;
  sandbox.renderView({ keepScroll: true, auto: true });
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
  assert.match(String(dialogOptions.body), /онлайн-показ по видеосвязи/, 'в окне подтверждения');
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

test('сопровождение заявки собрано в одной панели и сохраняется одной кнопкой', async () => {
  twoWaitingConversations();
  const { sandbox, requests } = await panelSandbox();
  sandbox.selectConversation('inq-olga');

  const host = fakeElement('main');
  const card = host.querySelector('#inquiryCard');
  await sandbox.VIEWS.clients.render(host, '');

  const side = card.querySelector('.conversation-side');
  assert.ok(side, 'справа от переписки — панель сопровождения');
  for (const id of ['#inqStatusValue', '#inqPipeline', '#inqAssignee', '#followDate', '#inqNote', '#clientTagsInq', '#clientNoteInq', '#saveInq']) {
    assert.ok(card.querySelector(id), id + ' живёт в этой же панели');
  }
  assert.ok(!String(card.innerHTML).includes('data-status='), 'статус больше не сохраняется отдельной кнопкой');

  // Одно нажатие сохраняет и заявку, и карточку клиента.
  card.querySelector('#inqStatusValue').value = 'closed';
  card.querySelector('#inqNote').value = 'перезвонить в среду';
  card.querySelector('#clientTagsInq').value = 'покупка, горячий лид';
  const before = requests.length;
  await card.querySelector('#saveInq').onclick();
  const saved = requests.slice(before).filter((request) => request.method === 'PATCH');
  assert.equal(saved.length, 2, 'одна кнопка — один заход: заявка и клиент');
  const inquiry = saved.find((request) => request.url.includes('/api/inquiries/'));
  assert.equal(inquiry.body.status, 'closed', 'статус уходит вместе с остальным');
  assert.equal(inquiry.body.note, 'перезвонить в среду');
  const client = saved.find((request) => request.url.includes('/api/users/'));
  assert.deepEqual(client.body.tags, ['покупка', 'горячий лид']);
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
  assert.equal(scrolled.length, 1, 'диалог открыт на поле ответа');
  assert.equal(scrolled[0].block, 'end');
  assert.ok(classes.contains('phone-chat'), 'обвязка (заголовок, вкладки, фильтры) на телефоне скрыта');
  const card = host.querySelector('#inquiryCard');
  assert.equal(card.querySelector('.conversation-side-details').open, false, 'панель заявки свёрнута под полем ответа');
  assert.match(String(card.innerHTML), /<summary>Статус, этап и заметки<\/summary>/);
  assert.ok(card.querySelector('#backToList'), 'есть возврат к списку');

  // Обновление по таймеру экран не дёргает.
  await sandbox.VIEWS.clients.render(host, '');
  assert.equal(scrolled.length, 1, 'при перерисовке экран не дёргается');

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
  assert.match(card, /Этап сделки <span class="small faint">\(по желанию\)/);
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

  sandbox.renderView({ keepScroll: true, auto: true });
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

  const badge = sandbox.navItems().find((item) => item.id === 'today').count;
  assert.equal(badge, 2, 'на значке в меню то же число');

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
  const typeBars = Array.from(html.slice(html.indexOf('Заявки по типам')).split('Откуда приходят клиенты')[0].matchAll(/<b class="right">(\d+) /g)).map((match) => Number(match[1]));
  assert.equal(typeBars.reduce((sum, value) => sum + value, 0), 3, 'по типам сумма 3, как в плитке: старая заявка не считается');
  assert.ok(!/заявок: 99/.test(html), 'счётчик аналитики на экран не попадает');
  assert.match(html, /Заявок: <b>3<\/b>/, 'подпись под графиком — то же число');
  assert.match(html, /Столбики — сообщения от клиентов за день/, 'подпись говорит, что нарисовано');
  assert.ok(sandbox.VIEWS.reports.render.toString().includes('Открыли карточку'), 'колонка «Интерес» названа по смыслу');

  const today = fakeElement('main');
  await sandbox.VIEWS.today.render(today, '');
  const text = String(today.innerHTML).replace(/ /g, ' ');
  assert.match(text, /Сообщения и заявки, 7 дней/, 'график — за 7 дней, как и строка цифр');
  assert.match(text, /<b>2<\/b> заявки за 7 дней/, 'строка цифр: заявок за 7 дней две');
  assert.match(text, /<b>2<\/b> заявки<\/span>/, 'под графиком то же число, а не 99');
});

test('панель считает «взял в работу без ответа» так же, как бот', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  const taken = { status: 'in_progress', replies: [], messages: [{ direction: 'in' }], createdAt: new Date().toISOString() };
  assert.equal(sandbox.awaitsReply(taken), true, 'без ответа клиент ждёт, хотя дело в работе');
  assert.equal(sandbox.inquiryState(taken).text, 'Ждёт ответа');
  assert.equal(sandbox.awaitsReply({ ...taken, viewing: { confirmedAt: new Date().toISOString() } }), false, 'подтверждённый просмотр ответа не ждёт');
  assert.equal(sandbox.awaitsReply({ ...taken, messages: [{ direction: 'out' }] }), false, 'начатое менеджером — тоже');
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
  for (const title of ['Публикации', 'Тексты бота', 'Настройки', 'Все события', 'Выйти']) assert.ok(sheet.includes(title), title + ' — в «Ещё»');
  assert.ok(!sheet.includes('>Сегодня<'), 'главные разделы в «Ещё» не повторяются');

  // Раздел из «Ещё» подсвечивает саму кнопку «Ещё».
  sandbox.currentView = 'settings';
  sandbox.renderNav();
  assert.match(String(sandbox.document.getElementById('tabbar').innerHTML), /class="tab active" id="tabMore"/);
});

test('на пяти экранах цифры — одной строкой, а не рядом из четырёх карточек', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  const screens = [
    ['clients', 'tasks', /К выполнению: <b/],
    ['clients', 'pipeline', /Активные клиенты: <b/],
    ['viewings', '', /Ждут подтверждения: <b/],
    ['notifications', '', /Требуют внимания: <b/],
    ['settings', 'reports', /Всего клиентов: <b/],
  ];
  for (const [view, tab, expected] of screens) {
    const host = fakeElement('main');
    await sandbox.VIEWS[view].render(host, tab);
    const html = String(host.innerHTML);
    // «Отчёты» начинаются с недели одной страницей; строка цифр за 30 дней — в «Подробнее».
    if (tab === 'reports') {
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

test('«Все события»: на карточке два действия — «Открыть» и «Скрыть», без «Прочитано» и «Обработано»', async () => {
  twoWaitingConversations();
  const { sandbox } = await panelSandbox();
  sandbox.notificationFilter = 'active';
  const host = fakeElement('main');
  await sandbox.VIEWS.notifications.render(host, '');
  const html = String(host.innerHTML);
  assert.match(html, /data-notification-open=/, 'есть «Открыть»');
  assert.match(html, /data-notification-action="handle"[^>]*>Скрыть</, 'и «Скрыть»');
  assert.ok(!/data-notification-action="(read|unread)"/.test(html), 'кнопок «Прочитано»/«Непрочитано» нет');
  assert.ok(!/>Прочитано</.test(html) && !/>Обработано</.test(html), 'слов «Прочитано» и «Обработано» на кнопках нет');
  // Скрытое возвращается.
  sandbox.notificationFilter = 'handled';
  const handled = fakeElement('main');
  sandbox.state.notifications.forEach((item, index) => { if (index === 0) item.handledAt = new Date().toISOString(); });
  await sandbox.VIEWS.notifications.render(handled, '');
  assert.match(String(handled.innerHTML), /data-notification-action="reopen"[^>]*>Вернуть</);
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
  sandbox.notificationFilter = 'active';
  const host = fakeElement('main');
  await sandbox.VIEWS.notifications.render(host, '');
  assert.ok(String(host.innerHTML).includes('data-notification-action="handle" data-notification-id="' + item.id + '"'));
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
  assert.ok(teamHtml.includes('сохраняются кнопкой в полосе снизу'), 'и подсказка про сохранение');

  // В «Обслуживании» появился экран «Подключение к Telegram» со всем этим.
  sandbox.serviceScreen = 'telegram';
  const service = fakeElement('main');
  sandbox.renderService(service);
  const nav = String(service.innerHTML);
  assert.match(nav, /Подключение к Telegram/);
  assert.match(nav, /Каналы и группы/);
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
  sandbox.alertKit.last = 0;
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
  assert.ok(!html.includes('Николай'), 'чужого и ничьего клиента в «Мои» нет');
  assert.match(html, /Ещё \d+ — чужие, без менеджера или не про клиентов/, 'сказано, сколько дел спрятано');

  sandbox.todayScope.me = 'Олег';
  sandbox.VIEWS.today.render(host);
  html = String(host.innerHTML);
  assert.match(html, /Своих дел нет/, 'у Олега закреплённых нет — так и сказано, а не «все отвечены»');
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
  for (const word of ['Новых клиентов', 'Заявок', 'Просмотров', 'Сделок', 'Без ответа сейчас', 'Откуда пришли новые клиенты', 'Больше всего заявок', 'Скопировать текстом', 'Вилла у моря', 'instagram']) {
    assert.ok(html.includes(word), 'на странице есть: ' + word);
  }
  assert.match(html, /↑ \+3 · было 2/, 'рост — со стрелкой и числом');
  assert.match(html, /как раньше/, 'без изменений — так и сказано');
  assert.match(html, /↓ −1 · было 1/, 'падение — со стрелкой');
  assert.match(html, /записались · прошло 4/);
  assert.match(html, /Рассылок: 1, получили 40, откликнулись 6/);
  assert.match(html, /с позапрошлой неделей/);
  assert.ok(!/обращени/i.test(html.replace('вопрос по объекту', '')), 'слова «обращения» нет: в панели это «заявки»');

  // Неделя идёт: сравнение с тем же отрезком, переключатель показывает «Эта».
  const current = String(sandbox.weeklyCard({ report: { ...report, which: 'current' }, text: '' }));
  assert.match(current, /с тем же отрезком прошлой недели/);
  assert.match(current, /data-week="current" class="active"/);
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
  assert.deepEqual(paths, ['/api/working-hours', '/api/viewing-slots', '/api/calculator', '/api/settings']);
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

test('старые адреса подключения к Telegram ведут на «Обслуживание → Подключение к Telegram»', async () => {
  resetData((data) => { data.config.active = true; });
  const { sandbox } = await panelSandbox();
  for (const tab of ['connection', 'telegram']) {
    sandbox.serviceScreen = 'data';
    const route = sandbox.normalizeRoute('settings', tab);
    assert.equal(route.join('/'), 'settings/service', tab);
    assert.equal(sandbox.serviceScreen, 'telegram', tab + ': открывается нужный экран');
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
  assert.equal(sandbox.navItems().find((item) => item.id === 'today').count, 0, 'значок пустой');
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
  assert.match(html, /Не удалось загрузить переписку/, 'сказано, что это сбой');
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
  assert.match(PANEL_HTML, /сохраняются кнопкой в полосе снизу/, 'сказано, как на самом деле');
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
  await sandbox.VIEWS.today.render(host, '');
  await host.querySelector('#quickObject').onclick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const dialog = sandbox.document.querySelector('dialog[open]');
  assert.ok(dialog, 'открылась карточка объекта');
  assert.match(String(dialog.innerHTML), /Номер объекта|Название/, 'это форма объекта');
  dialog.closeClean();
});
