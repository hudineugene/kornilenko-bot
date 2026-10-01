'use strict';

// Этап 51: рабочие экраны панели. Тест читает исходники как текст (ничего не импортирует) и держит то, что нельзя проверить
// без браузера: две высоты кнопок, воронка без прокрутки на ноутбуке, строка дела со временем ожидания, неразрывные пробелы.
// Сами размеры измерены в браузере на 1366×800 (диалог — переписке 304 px, кнопки — 30 и 36 px на 19 экранах).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PANEL = path.join(__dirname, '..', 'src', 'panel');
const read = (name) => fs.readFileSync(path.join(PANEL, name), 'utf8');
const styles = read('styles.mjs');
const runtime = read('runtime.mjs');
const overview = read('view-overview.mjs');
const inquiries = read('view-inquiries.mjs');

test('высот кнопок две: 36 (обычная, вкладка, колокольчик) и 30 (малая); вертикальных отступов у кнопки нет', () => {
  assert.match(styles, /\.btn\{min-height:36px\}/);
  assert.match(styles, /\.btn\.small\{min-height:30px\}/);
  assert.match(styles, /\.btn,\.btn\.small,\.btn\.icon\{padding-top:0;padding-bottom:0\}/);
  assert.match(styles, /\.tabs button\{min-height:36px/);
  assert.match(styles, /\.topbar \.page-tabs button\{padding:0 var\(--sp-3\)/);
  assert.match(styles, /\.notification-bell\{[^}]*width:36px;height:36px/);
});

test('воронка: на ноутбуке семь колонок делят ширину (без min-width 1480), прокрутка вбок — только до 1180 px; перенос — кнопкой «⇄»', () => {
  assert.match(styles, /\.funnel-board\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:1180px\)\{\.funnel-board\{grid-template-columns:repeat\(7,200px\);min-width:1480px\}\}/);
  assert.ok(!/class="pipeline-stage-select"/.test(inquiries), 'выпадающих списков «Перенести в…» на карточках нет');
  assert.match(inquiries, /data-pipeline-move=/);
});

test('«Сегодня»: в строке дела — имя, сколько ждёт (цветом), язык; ждущие по давности, самый давний сверху; вся строка — «Ответить»', () => {
  assert.match(overview, /function deedHeadHtml/);
  assert.match(overview, /"ждёт " \+ waitDuration\(waitAge\(inquiry\)\)/);
  assert.match(overview, /first\.kind === "message" && second\.kind === "message"\) return \(Date\.parse\(first\.createdAt\)/);
  assert.match(overview, /data-deed-row=/);
  assert.match(overview, /row\.onclick = function \(event\)/);
});

test('шапка: колокольчик — точкой (число уже у «Сегодня»), лупа не рядом с полем поиска, кнопка звука не сжимается', () => {
  assert.match(runtime, /badge\.textContent = ""/);
  assert.match(styles, /\.btn\.search-toggle\{display:none\}/);
  assert.match(styles, /\.head-tools \.btn\.icon\{flex:none;min-width:36px\}/);
});

test('диалог на компьютере: поле ответа — одной строкой с кнопкой «Отправить», контекст и запись на просмотр — по одной строке, ID клиента в шапке нет', () => {
  assert.match(styles, /\.conversation-card \.reply-box>textarea\{flex:1 1 260px;order:1/);
  assert.match(styles, /\.conversation-card \.conversation-main \.viewing-card\{flex-wrap:nowrap/);
  assert.ok(!/"ID " \+ esc\(user\.id\)/.test(inquiries), 'технического ID в шапке диалога нет');
});

test('таблицы-списки — до 1100 px, шапка и содержимое начинаются с одного края', () => {
  assert.match(styles, /#viewBody>\.card:has\(>\.table-wrap\)[^{]*\{max-width:1100px\}/);
  assert.match(styles, /\.app-head,\.topbar\{padding-left:max\(var\(--sp-5\), calc\(\(100% - 1560px\) \/ 2 \+ var\(--sp-5\)\)\)/);
});

test('неразрывные пробелы: «7 дней», «5 из 9», «28 сент», «10 ГБ», «13 ч» не рвутся', () => {
  const source = /function tightenText\(text\) \{[\s\S]*?\n\}/.exec(runtime)[0];
  const tighten = new Function(source + '\nreturn tightenText;')();
  for (const phrase of ['7 дней', '30 дней', '5 из 9', '28 сент', '10 ГБ', '13 ч', '2 мин', '70 м²', '5 %']) {
    const fixed = tighten('Текст ' + phrase + ' дальше');
    assert.ok(!/\d [а-яёА-ЯЁ%]/.test(fixed.replace(/\d [а-яё]+ [а-яё]+$/, '')) || fixed.includes(' '), phrase + ' → ' + JSON.stringify(fixed));
    assert.ok(fixed.includes(phrase.replace(' ', ' ')), phrase + ' → ' + JSON.stringify(fixed));
  }
  assert.equal(tighten('3 объекта'), '3 объекта', 'слова, которых нет в списке единиц, не трогаем');
});

test('«Отчёт»: шаги бота названы не воронкой, а отдельными показателями; «Тексты бота» — вкладки короткие, одной строкой', () => {
  assert.match(overview, /Что сделали новые клиенты недели/);
  assert.match(runtime, /\["welcome", "Приветствие"\], \["contacts", "Контакты"\]/);
});

test('редактор объекта: «Готовность» зелёная, когда всё заполнено; «Пост в канал» — предпросмотр справа', () => {
  assert.match(read('view-catalog.mjs'), /classList\.toggle\("is-ready", ready\)/);
  assert.match(styles, /\.publication-check\.is-ready\{border-color:var\(--ok-line\)/);
  assert.match(read('view-reach.mjs'), /post-preview-column/);
});
