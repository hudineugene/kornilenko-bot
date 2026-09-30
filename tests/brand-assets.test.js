'use strict';

// Бренд панели: всё, что встроено в программу, где-то используется и отдаётся; тяжёлого нет.
// Раньше фон входа (1,3 МБ) и два фона шапки лежали в exe и отдавались сервером, но нигде не были подключены.

const realFetch = global.fetch; // до helpers: они подменяют fetch на заглушку Telegram
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bot, cleanup } = require('./helpers/chat');

const root = path.resolve(__dirname, '..');
let base = '';

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test('встроенные в exe ресурсы (sea-config) и загрузка в config.mjs совпадают, файлы на месте и не тяжёлые', () => {
  const sea = JSON.parse(fs.readFileSync(path.join(root, 'sea-config.json'), 'utf8')).assets;
  const config = fs.readFileSync(path.join(root, 'src', 'config.mjs'), 'utf8');
  const loaded = Array.from(config.matchAll(/loadBundledAsset\([A-Z_]+, '([a-z0-9-]+)', '([^']+)'/g)).map((match) => [match[1], match[2]]);
  assert.deepEqual(loaded.map(([key]) => key).sort(), Object.keys(sea).sort(), 'что в exe — то и загружается, лишнего нет');
  for (const [key, file] of loaded) {
    assert.ok(sea[key].endsWith('/' + file), key + ': файл в sea-config совпадает с загружаемым');
    const size = fs.statSync(path.join(root, sea[key])).size;
    assert.ok(size <= 200 * 1024, key + ' весит ' + Math.round(size / 1024) + ' КБ — предел 200 КБ');
  }
});

test('каждый отдаваемый ресурс серверу нужен: на него ссылается страница, стили или манифест', async () => {
  const server = fs.readFileSync(path.join(root, 'src', 'server.mjs'), 'utf8');
  const routes = Array.from(server.matchAll(/pathname === '(\/(?:login-assets|admin-assets|panel-fonts)\/[^']+)'/g)).map((match) => match[1]);
  assert.ok(routes.length >= 7, 'нашлись маршруты ресурсов: ' + routes.length);
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const manifest = await (await realFetch(base + '/manifest.webmanifest')).text();
  const unused = routes.filter((route) => !PANEL_HTML.includes(route) && !manifest.includes(route));
  assert.deepEqual(unused, [], 'ресурсы, на которые никто не ссылается');
  for (const route of routes) {
    const answer = await realFetch(base + route);
    assert.equal(answer.status, 200, route);
    assert.ok((await answer.arrayBuffer()).byteLength > 1000, route + ' не пустой');
    assert.match(answer.headers.get('cache-control') || '', /immutable/, route + ' кешируется');
  }
  for (const gone of ['/admin-assets/header.webp', '/admin-assets/header-mobile.webp', '/login-assets/background.png']) {
    assert.equal((await realFetch(base + gone)).status, 404, gone + ' убран');
  }
});

test('вход: заголовок, «глаз» у пароля, подпись с эталона; шрифт Inter встроен со своего адреса', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /<h1>Вход в кабинет<\/h1>/);
  assert.match(PANEL_HTML, /Введите пароль администратора для управления Telegram-ботом/);
  assert.match(PANEL_HTML, /id="loginReveal"[^>]*aria-label="Показать пароль"/);
  assert.match(PANEL_HTML, /<label class="sr-only" for="loginPassword">Пароль<\/label>/, 'у поля есть подпись для чтения с экрана');
  assert.match(PANEL_HTML, /© <span id="authYear">/);
  assert.match(PANEL_HTML, /url\(\/login-assets\/background\.webp\)/, 'фон входа подключён');
  assert.match(PANEL_HTML, /font-family:"Inter"[^}]*inter-latin\.woff2/);
  assert.match(PANEL_HTML, /font-family:"Inter"[^}]*inter-cyrillic\.woff2/);
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(PANEL_HTML), 'ничего из интернета');
  assert.ok(fs.existsSync(path.join(root, 'panel-fonts', 'OFL.txt')), 'лицензия шрифта лежит рядом');
});
