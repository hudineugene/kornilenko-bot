'use strict';

// Структура меню панели: загрузка проектов — в «Объекты → Загрузка», команда и доступ — одна вкладка,
// копии и проверка — раздельно, «Пустые разделы» — в «Подписи бота». Старые адреса ведут на новые места.

const test = require('node:test');
const assert = require('node:assert/strict');

let panelModules = null;
async function modules() {
  if (!panelModules) {
    panelModules = {
      harness: await import('./helpers/panel-dom/harness.mjs'),
      fixtures: await import('./helpers/panel-dom/fixtures.mjs'),
    };
  }
  return panelModules;
}

async function open(view, tab) {
  const { harness, fixtures } = await modules();
  const panel = await harness.makePanel(fixtures.richState());
  await panel.go(view, tab);
  await harness.settle(80);
  const text = (id) => String(panel.doc.getElementById(id).textContent || '');
  return { text: text('page'), tabs: text('pageTabs'), title: text('pageTitle') };
}

test('названия разделов и вкладок', async () => {
  const settings = await open('settings', 'company');
  assert.equal(settings.title, 'Настройки');
  for (const name of ['Работа с клиентами', 'Telegram и приложение', 'Команда и доступ', 'Копии', 'Проверка и журнал']) {
    assert.ok(settings.tabs.includes(name), 'вкладка «' + name + '»');
  }
  assert.ok(!/Загрузка с сайта|Данные и копии|Подключение/.test(settings.tabs), 'старых названий нет');
  const texts = await open('texts', 'welcome');
  assert.equal(texts.title, 'Тексты и контакты');
  assert.ok(texts.tabs.includes('Подписи бота') && !texts.tabs.includes('Пустые разделы'));
  const objects = await open('objects', 'list');
  assert.ok(objects.tabs.includes('Загрузка'));
});

test('«Объекты → Загрузка»: проекты из файла и выгрузка с сайта на одном экране', async () => {
  const { text } = await open('objects', 'load');
  assert.match(text, /Проекты из файла/);
  assert.match(text, /Только расстояние до пляжа/);
  assert.match(text, /Выгрузка с сайта/);
});

test('«Команда и доступ»: менеджеры и пароль — вместе; копии и проверка — раздельно', async () => {
  const team = (await open('settings', 'team')).text;
  assert.match(team, /Менеджеры/);
  assert.match(team, /Пароль от панели/);
  assert.match(team, /Доступ из интернета/);
  const copies = (await open('settings', 'data')).text;
  assert.match(copies, /Резервная копия/);
  assert.match(copies, /Копия в Telegram/);
  assert.ok(!/Самопроверка|Журнал ошибок|Проекты из файла/.test(copies), 'служебное и загрузка — на других вкладках');
  const check = (await open('settings', 'check')).text;
  assert.match(check, /Самопроверка/);
  assert.match(check, /Файлы картинок/);
  assert.match(check, /Журнал ошибок/);
  assert.ok(!/Резервная копия/.test(check));
});

test('«Подписи бота»: сверху «Если раздел пуст», ниже все подписи', async () => {
  const { text } = await open('texts', 'interface');
  assert.match(text, /Если раздел пуст/);
});
