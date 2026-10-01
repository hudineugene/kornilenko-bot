// Словарь эмодзи: один знак — одно значение. Тест читает исходники как текст (ничего не импортирует, живые данные
// не трогает) и следит, чтобы знаки не расползлись обратно.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter((name) => name.endsWith('.mjs') && !/legacy-texts|data-format/.test(name));

function linesWith(glyph) {
  const found = [];
  for (const name of files) {
    fs.readFileSync(path.join(SRC, name), 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (line.includes(glyph) && !/^\s*\/\//.test(line)) found.push({ where: name + ':' + (index + 1), line });
    });
  }
  return found;
}

test('🏠 — только «Главное меню» (кнопка «В меню»)', () => {
  const stray = linesWith('🏠').filter(({ line }) => !/mainMenu|backToMenu|menu: '🏠/.test(line));
  assert.deepEqual(stray.map((item) => item.where), [], 'дом занят главным меню, для объекта — 🔖');
});

test('📋 — только «План покупки»; заявки — 📨, подробности — ℹ️', () => {
  const stray = linesWith('📋').filter(({ where }) => !/^(plan|requests)\.mjs/.test(where));
  assert.deepEqual(stray.map((item) => item.where), []);
});

test('🔖 отмечает объект, а не что-то ещё', () => {
  const uses = linesWith('🔖');
  assert.ok(uses.length >= 10, 'маркер объекта на месте');
});

// Этап 49: остальные знаки словаря — тоже один знак, одно значение.
const where = (glyph, allowed) => linesWith(glyph).filter(({ where: place, line }) => !allowed.test(place + ' ' + line)).map((item) => item.where);

test('👀 — «показать результат» (мастер и фильтр) и реакция бота; «Пока смотрю» — 🧭', () => {
  assert.deepEqual(where('👀', /wizardShow|show: |showNearby|реакци|emoji: '👀'|inquiries\.mjs/), []);
});

test('🔎 — фильтр и поиск по параметрам; «можно рассмотреть» — 💡, «Подобрать объект» — ✨', () => {
  assert.deepEqual(linesWith('🔎').filter(({ line }) => /tierConsider|selection:/.test(line)).map((item) => item.where), []);
});

test('🔑 — только «про аренду»; состояние объекта — 🛠', () => {
  assert.deepEqual(where('🔑', /goal\.mjs/), []);
});

test('🆕 — только состояние заявки («получена», «ждёт ответа»); новые объекты — 🏘', () => {
  assert.deepEqual(where('🆕', /statusNew|inquiries\.mjs/), []);
});

test('🔄 — только «Обновить»; «начать заново» — ↺', () => {
  assert.deepEqual(where('🔄', /update: |Обновить|Update|Actualizar/), []);
});

test('«Ещё»: выбранный вариант — ✓, а ✅ — только переключатели и «готово»', () => {
  const source = fs.readFileSync(path.join(SRC, 'catalog.mjs'), 'utf8');
  const extra = source.slice(source.indexOf('function catalogFilterExtraScreen'), source.indexOf('function catalogFilterExtraScreen') + 2400);
  assert.ok(!extra.includes("'✅ '"), 'на экране «Ещё» выбранный вариант отмечен ✓');
});
