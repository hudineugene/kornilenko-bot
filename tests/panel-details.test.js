'use strict';

// Единые детали панели: чипы только пяти видов, поверхности — двумя группами, кромка одной толщины, боковая колонка одной
// ширины. Тест читает исходники как текст, ничего не импортирует.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PANEL = path.join(__dirname, '..', 'src', 'panel');
const sources = fs.readdirSync(PANEL).filter((name) => name.endsWith('.mjs')).map((name) => ({ name, text: fs.readFileSync(path.join(PANEL, name), 'utf8') }));
const styles = sources.find((item) => item.name === 'styles.mjs').text;

test('чип — одного из видов ok / warn / bad / brand / overdue или серый; неизвестный цвет не придумывается', () => {
  const allowed = new Set(['ok', 'warn', 'bad', 'brand', 'overdue', 'lang-chip']);
  const wrong = [];
  for (const { name, text } of sources) {
    for (const match of text.matchAll(/class="chip( [a-z-]+)?[ "]/g)) {
      const kind = (match[1] || '').trim();
      if (kind && !allowed.has(kind)) wrong.push(name + ': chip ' + kind);
    }
    for (const match of text.matchAll(/\bchip\("([^"]*)"/g)) {
      if (match[1] && !allowed.has(match[1])) wrong.push(name + ': chip("' + match[1] + '")');
    }
  }
  assert.deepEqual(wrong, []);
});

test('поверхности: рамка, радиус и фон заданы двумя группами, а не в каждом правиле', () => {
  const lines = styles.split('\n').filter((line) => !/^\s*@media/.test(line) && !/^\s{2,}/.test(line));
  const repeated = lines.filter((line) => /border:1px solid var\(--line\)[;}]/.test(line) && /border-radius:var\(--radius\)[;}]/.test(line));
  const single = repeated.filter((line) => !/^.card,|^.banner,/.test(line)).map((line) => line.split('{')[0]);
  assert.deepEqual(single, ['.message-reactions'], 'кроме двух групп рамка + радиус только у значка реакции: ' + single.join(' | '));
});

test('цветная кромка — одной толщины (--edge), боковая колонка — одной ширины (--side)', () => {
  assert.doesNotMatch(styles, /border-left:[34]px solid/);
  assert.doesNotMatch(styles, /box-shadow:inset (3px 0|0 3px)/);
  assert.match(styles, /--edge:4px/);
  assert.match(styles, /--side:320px/);
  assert.doesNotMatch(styles, /grid-template-columns:(minmax\(0,1fr\) (360|320)px|300px minmax\(0,1fr\))/);
});

test('плитка с числом одна — .kpi; у раскрывашки один вид — .editor-section', () => {
  assert.doesNotMatch(styles, /\.week-tile|\.week-value|\.week-trend|\.conversation-details|\.flat-divided/);
  const views = sources.filter((item) => item.name.startsWith('view-')).map((item) => item.text).join('\n');
  assert.doesNotMatch(views, /class="week-tile"|class="conversation-details"|class="card flat-divided"/);
});

test('ошибка ввода — текстом под полем, поле помечено и получает фокус; исправили — подпись исчезла', () => {
  const runtime = sources.find((item) => item.name === 'runtime.mjs').text;
  const start = runtime.indexOf('function fieldError(');
  const end = runtime.indexOf('function toast(', start);
  assert.ok(start > 0 && end > start, 'помощник fieldError на месте');
  const make = new Function('document', 'toast', runtime.slice(start, end) + '\nreturn fieldError;');

  const listeners = {};
  const children = [];
  const box = {
    querySelector: (selector) => children.find((child) => '.' + child.className === selector) || null,
    appendChild(child) { child.remove = () => children.splice(children.indexOf(child), 1); children.push(child); },
  };
  const input = {
    attributes: {}, focused: false,
    closest: (selector) => (selector === '.field' ? box : null),
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused = true; },
    addEventListener(name, handler) { listeners[name] = handler; },
    removeEventListener(name) { delete listeners[name]; },
  };
  const toasts = [];
  const fieldError = make({ createElement: () => ({ className: '', setAttribute() {} }) }, (text) => toasts.push(text));

  fieldError(input, 'Укажите имя клиента');
  assert.equal(children.length, 1);
  assert.equal(children[0].className, 'field-error');
  assert.equal(children[0].textContent, 'Укажите имя клиента');
  assert.equal(input.attributes['aria-invalid'], 'true');
  assert.ok(input.focused);
  assert.deepEqual(toasts, [], 'подсказка не дублируется');

  fieldError(input, 'Другой текст');
  assert.equal(children.length, 1, 'вторая ошибка заменяет первую, а не добавляется');
  listeners.input();
  assert.equal(children.length, 0, 'начали исправлять — подпись убрана');
  assert.equal(input.attributes['aria-invalid'], undefined);

  fieldError({ closest: () => null }, 'Нет поля');
  assert.deepEqual(toasts, ['Нет поля'], 'без поля — обычная подсказка');
});

test('«Сегодня» на телефоне: правила для телефона стоят ПОСЛЕ основных (раньше лежали выше и не действовали)', () => {
  const base = styles.indexOf('.today-numbers{display:flex');
  const phone = styles.indexOf('.today-numbers{display:grid');
  assert.ok(base > 0 && phone > base, 'phone правило после основного: ' + base + ' / ' + phone);
  assert.match(styles, /\.today-numbers>span:nth-child\(n\+3\)\{display:none\}/);
});

test('font-size:var(--fs-sm) без нужды не повторяется: их меньше пятидесяти (было 86)', () => {
  const count = (styles.match(/font-size:var\(--fs-sm\)/g) || []).length;
  assert.ok(count < 50, 'объявлений: ' + count);
});
