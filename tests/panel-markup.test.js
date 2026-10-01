'use strict';

// Сторож разметки панели (этап 52). Панель запускается на настоящем маленьком DOM (tests/helpers/panel-dom): обходятся
// все экраны и окна на полных и на пустых данных — 128 мест. Проверяется то, что глазами в исходниках не видно:
// незакрытые и лишние теги, повторы id, кнопки без обработчика, кнопки-значки без подписи, текст, вставленный в
// разметку без экранирования, числа без неразрывного пробела, число залитых (главных) кнопок на экране.

const test = require('node:test');
const assert = require('node:assert/strict');

let walked = null;
async function walk() {
  if (!walked) walked = await (await import('./helpers/panel-dom/walk.mjs')).walkAll();
  return walked;
}
const places = (report) => Object.entries({ ...report.screens, ...report.dialogs });

test('обход охватывает все экраны и окна: если проверка сузилась, тест это заметит', async () => {
  const report = await walk();
  assert.ok(Object.keys(report.screens).length >= 77, 'экранов: ' + Object.keys(report.screens).length);
  assert.ok(Object.keys(report.dialogs).length >= 51, 'окон: ' + Object.keys(report.dialogs).length);
  const missing = places(report).filter(([, place]) => place.missing).map(([name]) => name);
  assert.deepEqual(missing, [], 'окна, которые не открылись: ' + missing.join('; '));
});

test('разметка: нет незакрытых и лишних тегов, повторяющихся атрибутов, блока внутри строчного элемента', async () => {
  const report = await walk();
  assert.deepEqual(report.anomalies.map((item) => item.kind + ' · ' + item.label + ' · ' + item.snippet), []);
});

test('скрипт панели не падает ни на одном экране и окне; console.error не вызывается', async () => {
  const report = await walk();
  assert.deepEqual(report.errors.map((item) => String(item).split('\n')[0]), []);
});

test('id на странице не повторяются', async () => {
  const report = await walk();
  const repeated = places(report).filter(([, place]) => (place.duplicateIds || []).length).map(([name, place]) => name + ': ' + place.duplicateIds.join(', '));
  assert.deepEqual(repeated, []);
});

test('у каждой видимой кнопки есть действие: «мёртвых» кнопок и кликабельных строк без обработчика нет', async () => {
  const report = await walk();
  const dead = [];
  for (const [name, place] of places(report)) {
    for (const item of place.dead || []) {
      if (item.visible === false) continue;
      dead.push(name + ': ' + item.what + ' «' + (item.text || item.id || item.cls) + '»' + (item.data ? ' [' + item.data + ']' : ''));
    }
  }
  assert.deepEqual(dead, []);
});

test('кнопка из одних значков подписана (aria-label или title); исключение — набор смайлов подписи поста: там значок и есть содержимое', async () => {
  const report = await walk();
  const unlabelled = [];
  for (const [name, place] of places(report)) {
    for (const button of place.iconOnly || []) {
      if (button.aria || button.title) continue;
      if (/\bdata-sign\b/.test(button.data)) continue;
      unlabelled.push(name + ': «' + button.text + '» ' + (button.id || button.cls));
    }
  }
  assert.deepEqual(unlabelled, []);
});

test('текст из данных не попадает в разметку без экранирования: «вредные» кавычки и тег в фамилиях, названиях и заметках остаются текстом', async () => {
  const report = await walk();
  const leaks = places(report).filter(([, place]) => place.leaks).map(([name, place]) => name + ' × ' + place.leaks);
  assert.deepEqual(leaks, []);
});

test('число и его слово не разделяются переносом: после обработки панели «5 заявок», «2 объекта», «7 дней» связаны неразрывным пробелом', async () => {
  const report = await walk();
  const loose = [];
  for (const [name, place] of places(report)) for (const item of place.plainSpaces || []) loose.push(name + ': ' + item.hits);
  assert.deepEqual(loose, []);
});

// Залитая (главная) кнопка на экране — одна: так человек видит, что делать дальше. Исключения записаны здесь: на каждое —
// своя причина. Новое исключение не появится само: тест упадёт, пока его не запишут осознанно.
const SOLID_EXCEPTIONS = {
  'clients/inbox (диалог открыт)': 2, // «Отправить сообщение» в переписке и «Сохранить» в боковой панели заявки
  'clients/inbox (просмотр, es)': 2,
  'clients/inbox (подбор)': 2,
  'clients/inbox (пакетный режим)': 2,
  'viewings/pending': 3, // кнопка «Подтвердить и уведомить» в каждой строке очереди — по одной на запись
  'posts/channels': 2, // «Принять» у каждой заявки на вступление
  'окно · карточка клиента': 2, // «Открыть диалог» и «Сохранить»
};

test('залитых кнопок на экране и в окне — одна; исключения перечислены и не растут', async () => {
  const report = await walk();
  const over = [];
  for (const [name, place] of places(report)) {
    const count = (place.solid || []).length;
    const key = name.replace(/^(полный|пустой) · /, '');
    const allowed = Object.entries(SOLID_EXCEPTIONS).find(([prefix]) => key === prefix || key.startsWith(prefix + ' ') || key.startsWith(prefix.replace(/ \(.*$/, '') + ' ('));
    const limit = allowed ? allowed[1] : 1;
    if (count > limit) over.push(name + ': ' + count + ' (допустимо ' + limit + ') — ' + place.solid.map((button) => button.text).join(' | '));
  }
  assert.deepEqual(over, []);
});
