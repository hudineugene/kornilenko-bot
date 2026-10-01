'use strict';

// Сторож слов, которыми бот и панель говорят с менеджером (этап 52). Слова проверяются в строках, которые человек видит, —
// не в комментариях и не в именах переменных (tests/helpers/literals.js). Три правила:
//  1. «Обращение» и «пользователь» из слов бота убраны: менеджер читает «заявка», «клиент», «диалог».
//  2. Адрес вида «Раздел → Вкладка» в сообщениях менеджеру пишется только через places.mjs (там его сверяют с панелью)
//     — либо это подсказка про сам Telegram.
//  3. Каждый переход панели go("раздел", "вкладка") и каждая ссылка #/раздел/вкладка в сообщениях бота ведёт на
//     существующий экран.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { literals } = require('./helpers/literals');

const SRC = path.join(__dirname, '..', 'src');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

// Всё, что бот пишет менеджеру и владельцу: уведомления, команды в чате, самопроверка, ответы панели.
const MANAGER_FILES = [
  'notices.mjs', 'admin-commands.mjs', 'notify-plan.mjs', 'status.mjs', 'selfcheck.mjs', 'alerts.mjs',
  'admin-notifications.mjs', 'viewings.mjs', 'retention.mjs', 'offsite.mjs', 'feed-import.mjs', 'broadcasts.mjs',
  'groups.mjs', 'group-api.mjs', 'admin-api.mjs', 'admin-api-clients.mjs', 'admin-api-content.mjs',
  'admin-api-settings.mjs', 'admin-http.mjs', 'inquiries.mjs', 'analytics.mjs', 'lifecycle.mjs', 'listing.mjs',
];
const PANEL_FILES = fs.readdirSync(path.join(SRC, 'panel')).filter((name) => name.endsWith('.mjs') && name !== 'styles.mjs').map((name) => 'panel/' + name);

// Файлы панели — большие шаблоны String.raw с кодом самой панели внутри: разбираем и код внутри шаблона.
function stringsOf(files) {
  const out = [];
  for (const file of files) {
    for (const item of literals(read(file))) {
      if (file.startsWith('panel/') && item.text.length > 2000) {
        for (const inner of literals(item.text)) out.push({ file, line: item.line + inner.line - 1, text: inner.text });
      } else out.push({ file, line: item.line, text: item.text });
    }
  }
  return out;
}

test('в словах менеджеру нет «обращения» и «пользователя»: заявка, клиент, диалог', () => {
  const bad = /обращени|пользовател(?!ьск)/i;
  const hits = stringsOf([...MANAGER_FILES, ...PANEL_FILES]).filter((item) => bad.test(item.text))
    .map((item) => item.file + ':' + item.line + ' ' + item.text.slice(0, 90).replace(/\n/g, ' '));
  assert.deepEqual(hits, []);
});

test('адрес «Раздел → Вкладка» в сообщениях менеджеру — только из places.mjs или подсказка про Telegram', () => {
  const address = /[А-Яа-яё»]\s*→\s*[«А-Яа-яё]/;
  const hits = stringsOf(MANAGER_FILES).filter((item) => address.test(item.text) && !/Telegram/.test(item.text))
    .map((item) => item.file + ':' + item.line + ' ' + item.text.slice(0, 90).replace(/\n/g, ' '));
  assert.deepEqual(hits, [], 'пишите адрес через PLACES (src/places.mjs): там его сверяют со страницей панели');
});

test('служебные слова из кода не доходят до менеджера: reconnecting, undefined, [object Object], NaN', () => {
  const bad = /\breconnecting\b|\bundefined\b|\[object Object\]|\bNaN\b/;
  const hits = stringsOf([...MANAGER_FILES, ...PANEL_FILES]).filter((item) => bad.test(item.text) && !/typeof|=== ?'undefined'|Number\.isNaN/.test(item.text))
    .map((item) => item.file + ':' + item.line + ' ' + item.text.slice(0, 90).replace(/\n/g, ' '));
  assert.deepEqual(hits, []);
});

test('переходы панели go("раздел", "вкладка") и ссылки #/раздел/вкладка в сообщениях бота ведут на существующие экраны', async () => {
  const { makePanel } = await import('./helpers/panel-dom/harness.mjs');
  const { richState } = await import('./helpers/panel-dom/fixtures.mjs');
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const panel = await makePanel(richState());
  const sandbox = panel.sandbox;
  const views = new Set(Object.keys(sandbox.VIEWS));
  const tabs = new Map(sandbox.navItems().map((item) => [item.id, new Set((item.tabs || []).map((tab) => tab[0]))]));
  const viewingModes = new Set(sandbox.VIEWING_MODES);
  function problem(view, tab) {
    if (!views.has(view)) return 'нет раздела «' + view + '»';
    if (!tab) return '';
    if (view === 'viewings') return viewingModes.has(tab) ? '' : 'нет вида просмотров «' + tab + '»';
    return tabs.get(view) && tabs.get(view).has(tab) ? '' : 'в разделе «' + view + '» нет вкладки «' + tab + '»';
  }
  const bad = [];
  for (const match of PANEL_HTML.matchAll(/\bgo\("(\w+)"(?:,\s*"([\w-]*)")?/g)) {
    const why = problem(match[1], match[2] || '');
    if (why) bad.push('go(' + match[0].slice(3) + ': ' + why);
  }
  for (const item of stringsOf(['inquiries.mjs', 'notices.mjs', 'admin-commands.mjs', 'notify-plan.mjs', 'viewings.mjs', 'status.mjs'])) {
    for (const match of item.text.matchAll(/#\/(\w+)(?:\/([\w-]+))?/g)) {
      const why = problem(match[1], match[2] && !/^[0-9a-f-]{8,}$/i.test(match[2]) ? match[2] : '');
      // Третья часть адреса — номер заявки (inquiry.id), он подставляется кодом; название вкладки — вторая.
      if (why) bad.push(item.file + ':' + item.line + ' ' + match[0] + ': ' + why);
    }
  }
  assert.deepEqual(bad, []);
});
