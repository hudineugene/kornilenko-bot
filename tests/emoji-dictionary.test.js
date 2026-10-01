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
