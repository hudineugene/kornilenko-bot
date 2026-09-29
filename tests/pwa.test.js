'use strict';

// «Установить на экран телефона»: у страницы панели есть манифест приложения, цвет
// адресной строки и значки. Панель открывается как отдельное окно без адресной
// строки, с собственным значком. Службы фоновой работы и офлайн-режима нет: панель
// показывает данные клиентов и без связи с ботом работать не должна. Манифест и значок
// открыты без входа (браузер запрашивает их без cookie), в них нет ничего личного.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, cleanup } = require('./helpers/chat');

let base = '';

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test('страница ссылается на манифест, задаёт цвет адресной строки и значок для iPhone', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(PANEL_HTML, /<meta name="theme-color" content="#2f56d9" media="\(prefers-color-scheme: light\)">/);
  assert.match(PANEL_HTML, /<meta name="theme-color" content="#101828" media="\(prefers-color-scheme: dark\)">/);
  assert.match(PANEL_HTML, /<link rel="apple-touch-icon" href="\/admin-assets\/sidebar-logo\.png">/);
  assert.ok(!/serviceWorker/.test(PANEL_HTML), 'службы фоновой работы нет: данные клиентов не кешируются');
});

test('манифест: название, запуск с главной, окно без адресной строки, значки; открыт без входа', async () => {
  const response = await realFetch(base + '/manifest.webmanifest');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  assert.ok(!response.headers.get('set-cookie'));
  const manifest = await response.json();
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ru');
  assert.equal(manifest.theme_color, '#2f56d9');
  assert.ok(manifest.name && manifest.short_name && manifest.short_name.length <= 12, 'короткое имя помещается под значком');
  assert.ok(manifest.icons.length >= 2);
  // Ничего личного: ни имени бота, ни адресов.
  const text = JSON.stringify(manifest);
  assert.ok(!/bot|токен|token|@/i.test(text.replace(/Telegram-бота/g, '')), 'в манифесте нет личных данных: ' + text);
});

test('значки из манифеста открываются без входа и правильного типа', async () => {
  const manifest = await (await realFetch(base + '/manifest.webmanifest')).json();
  for (const icon of manifest.icons) {
    const answer = await realFetch(base + icon.src);
    assert.equal(answer.status, 200, icon.src);
    assert.equal(answer.headers.get('content-type'), icon.type, icon.src);
    assert.ok((await answer.arrayBuffer()).byteLength > 200, icon.src + ' не пустой');
  }
  assert.ok(manifest.icons.some((icon) => icon.type === 'image/svg+xml' && icon.sizes === 'any'), 'значок любого размера (SVG)');
});

test('значок-монограмма — безопасный SVG: без скриптов и внешних ссылок', async () => {
  const svg = await (await realFetch(base + '/admin-assets/app-icon.svg')).text();
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!/<script|href=|onload|javascript:/i.test(svg), 'в значке нет ни скриптов, ни ссылок');
});

test('чужой метод и адрес манифеста с лишним не работают', async () => {
  assert.equal((await realFetch(base + '/manifest.webmanifest', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await realFetch(base + '/manifest.webmanifest/../api/state')).status === 200, false);
});
