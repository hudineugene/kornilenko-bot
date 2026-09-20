'use strict';

// Страница панели — один встроенный скрипт. Браузер разбирает его целиком,
// поэтому опечатка в кавычках ломает всю панель: проверяем синтаксис здесь.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('скрипт панели разбирается без ошибок', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const scripts = [...PANEL_HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1, 'скрипт должен быть один — иначе не сработает nonce');
  new vm.Script(scripts[0]);
});

test('в разметке панели есть каркас и все разделы', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  for (const id of ['loginForm', 'setupForm', 'app', 'nav', 'page', 'savebar', 'toast']) {
    assert.ok(PANEL_HTML.includes('id="' + id + '"'), 'нет элемента ' + id);
  }
  const script = PANEL_HTML.slice(PANEL_HTML.indexOf('<script'));
  for (const view of ['overview', 'inquiries', 'catalog', 'texts', 'reach', 'stats', 'settings']) {
    assert.ok(script.includes('VIEWS.' + view + ' ='), 'нет раздела ' + view);
  }
});

test('страница не тянет ничего со стороны', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Ссылки на t.me в разделах открываются по клику — это не загрузка ресурса.
  const shell = PANEL_HTML.slice(0, PANEL_HTML.indexOf('<script'));
  const external = shell.match(/(src|href)="https?:\/\/[^"]+"/g) || [];
  assert.deepEqual(external, [], 'панель должна работать без интернета');
});
