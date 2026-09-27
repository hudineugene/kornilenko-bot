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
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector: () => fakeElement(),
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
  return {
    body,
    documentElement: fakeElement('html'),
    head: fakeElement('head'),
    readyState: 'complete',
    getElementById: () => fakeElement(),
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    createElement: (tag) => fakeElement(tag),
    createDocumentFragment: () => fakeElement('fragment'),
    createTextNode: () => fakeElement('text'),
    addEventListener() {}, removeEventListener() {},
    execCommand() { return true; },
    activeElement: body,
    hidden: false,
  };
}

// Ответы сервера, которые панель ждёт при загрузке.
function fakeFetch(state, texts) {
  return async (url) => {
    const path = String(url);
    const answer = (payload) => ({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
      headers: { get: () => '' },
    });
    if (path.includes('/api/status')) return answer({ configured: true, botName: 'Test' });
    if (path.includes('/api/state')) return answer(state);
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
  const texts = normalizedInterfaceText(bot.getData().interfaceText);
  const errors = [];
  const sandbox = {
    console: { log() {}, warn() {}, error(...args) { errors.push(String(args[0])); } },
    document: fakeDocument(),
    location: { hash: '', href: 'http://localhost/', pathname: '/', search: '', reload() {}, assign() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test', clipboard: { writeText: async () => {} } },
    fetch: fakeFetch(state, texts),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    Intl, URL, URLSearchParams, Blob, FormData, Promise, JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error, Map, Set, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, btoa, atob, escape: encodeURIComponent, unescape: decodeURIComponent,
    FileReader: class { readAsDataURL() {} readAsText() {} },
    alert() {}, confirm: () => true, prompt: () => '',
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    scrollTo() {}, open: () => null, print() {},
    innerWidth: 1280, innerHeight: 800,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  new vm.Script(script, { filename: 'panel.js' }).runInContext(context);
  // Загрузка панели асинхронная: даём ей закончить.
  await new Promise((resolve) => setTimeout(resolve, 60));
  sandbox.state = state;
  sandbox.csrf = 'test-csrf';
  return { sandbox, errors, state };
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
