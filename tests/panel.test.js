'use strict';

// Страница панели — один встроенный скрипт. Браузер разбирает его целиком,
// поэтому опечатка в кавычках ломает всю панель: проверяем синтаксис здесь.
// Как этот код ведёт себя при работе — в tests/panel-render.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('скрипт панели разбирается без ошибок', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const scripts = [...PANEL_HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1, 'скрипт должен быть один — страница разрешает его по хешу');
  new vm.Script(scripts[0]);
});

test('в разметке панели есть каркас и все разделы', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  for (const id of ['loginForm', 'setupForm', 'app', 'nav', 'page', 'savebar', 'toast']) {
    assert.ok(PANEL_HTML.includes('id="' + id + '"'), 'нет элемента ' + id);
  }
  const script = PANEL_HTML.slice(PANEL_HTML.indexOf('<script'));
  for (const view of ['overview', 'notifications', 'inquiries', 'catalog', 'texts', 'reach', 'stats', 'settings']) {
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

test('меню закреплено сверху и показывает подразделы', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /class="app-head"/);
  assert.match(PANEL_HTML, /class="head-nav"/);
  assert.match(PANEL_HTML, /class="nav-dropdown/);
  assert.doesNotMatch(PANEL_HTML, /<aside class="side"/);
  assert.match(PANEL_HTML, /Надёжный запуск/);
  assert.match(PANEL_HTML, /\/api\/autostart/);
});

test('внутренняя навигация защищает несохранённые изменения', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /async function confirmPageLeave\(\)/);
  assert.match(PANEL_HTML, /async function handleHashChange\(\)/);
  assert.match(PANEL_HTML, /Перейти без сохранения\?/);
  const renderView = PANEL_HTML.match(/function renderView\(options\) \{([\s\S]*?)\n\}/);
  assert.ok(renderView, 'функция отрисовки страницы не найдена');
  assert.doesNotMatch(renderView[1], /clearDirty\(\)/, 'обычная перерисовка не должна молча сбрасывать черновик');
});

test('редакторы предупреждают перед закрытием несохранённого черновика', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const protectedEditors = PANEL_HTML.match(/protectChanges: true/g) || [];
  assert.ok(protectedEditors.length >= 5, 'основные редакторы должны защищать черновики');
  assert.match(PANEL_HTML, /dialog\.closeClean\(\)/);
});

test('редакторы объекта и рассылки имеют живой предпросмотр', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="recordPreview"/);
  assert.match(PANEL_HTML, /function renderRecordPreview\(\)/);
  assert.match(PANEL_HTML, /id="campaignPreview"/);
  assert.match(PANEL_HTML, /function renderCampaignPreview\(\)/);
  assert.ok((PANEL_HTML.match(/wide: true/g) || []).length >= 2, 'оба редактора должны использовать широкую компоновку');
  assert.match(PANEL_HTML, /Готовность карточки/);
  assert.match(PANEL_HTML, /сохраните объект как скрытый/);
  assert.match(PANEL_HTML, /encodeURIComponent\(record\.id\), "PATCH"/);
  assert.match(PANEL_HTML, /comparison\.cardAddShort/, 'предпросмотр должен показывать компактную кнопку сравнения');
  assert.match(PANEL_HTML, /actions\.bedroomsLabel/, 'характеристики в предпросмотре должны иметь локализованные подписи');
  assert.match(PANEL_HTML, /facts\.slice\(factIndex, factIndex \+ 2\)/, 'в строке предпросмотра должно быть не больше двух характеристик');
  assert.match(PANEL_HTML, /✦ /, 'премиальные метки должны совпадать с карточкой Telegram');
  assert.match(PANEL_HTML, /Цена по запросу \/ текст/);
  assert.match(PANEL_HTML, /полный адрес показываются клиенту только после нажатия/);
});

test('в заявке на подбор менеджер видит результаты и недостающие данные', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const { INQUIRIES_JS } = await import('../src/panel/view-inquiries.mjs');
  assert.match(PANEL_HTML, /function selectionMatchingPanel\(item\)/);
  assert.match(PANEL_HTML, /Автоматический подбор/);
  assert.match(PANEL_HTML, /нет цены — уточнить/);
  assert.match(PANEL_HTML, /не указаны спальни — уточнить/);
  assert.match(PANEL_HTML, /data-match-property/);

  const context = {
    VIEWS: {},
    state: { objects: [{ id: 'villa-one', title: { ru: 'Вилла без цены' } }] },
    esc: function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); },
    localized: function (value, language) { return value && value[language] || ''; },
  };
  vm.createContext(context);
  new vm.Script(INQUIRIES_JS + '\nresult=selectionMatchingPanel({type:"selection",matching:{results:[{id:"villa-one",tier:"close",score:80,reasons:["type"],warnings:["priceMissing"]}]}});').runInContext(context);
  assert.match(context.result, /Вилла без цены/);
  assert.match(context.result, /нет цены — уточнить/);
  assert.match(context.result, /оценка 80%/);
  assert.match(context.result, /data-match-property="villa-one"/);
});

test('центр переписки объединяет диалоги и показывает вложения, реакции и ответственного', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function conversationGroups\(\)/);
  assert.match(PANEL_HTML, /title: "Переписка"/);
  assert.match(PANEL_HTML, /Центр сообщений/);
  assert.match(PANEL_HTML, /Непрочитанные/);
  assert.match(PANEL_HTML, /class="messenger-shell"/);
  assert.match(PANEL_HTML, /Один клиент — одна переписка/);
  assert.match(PANEL_HTML, /class="conversation-thread"/);
  assert.match(PANEL_HTML, /conversation-media/);
  assert.match(PANEL_HTML, /message\.reactions/);
  assert.match(PANEL_HTML, /Ответить в Telegram/);
  assert.match(PANEL_HTML, /Сопровождение обращения/);
  assert.match(PANEL_HTML, /Карточка клиента/);
  assert.match(PANEL_HTML, /id="inqAssignee"/);
  assert.match(PANEL_HTML, /Сохранить изменения/);
});

test('мессенджер отправляет файлы, цитирует сообщение и безопасно повторяет ответ', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="replyFile"/);
  assert.match(PANEL_HTML, /\.jpg,\.jpeg,\.png,\.pdf,\.txt,\.doc,\.docx,\.xls,\.xlsx/);
  assert.match(PANEL_HTML, /data-reply-target/);
  assert.match(PANEL_HTML, /replyToMessageId/);
  assert.match(PANEL_HTML, /clientRequestId/);
  assert.match(PANEL_HTML, /Повторить отправку/);
  assert.match(PANEL_HTML, /Доставлено в Telegram/);
  assert.match(PANEL_HTML, /черновик сохранён/i);
});

test('воронка отделяет этап продажи от статуса переписки', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /\["pipeline", "Воронка"\]/);
  assert.match(PANEL_HTML, /function renderPipeline\(host\)/);
  assert.match(PANEL_HTML, /Активные клиенты/);
  assert.match(PANEL_HTML, /Переговоры/);
  assert.match(PANEL_HTML, /Успешно завершено/);
  assert.match(PANEL_HTML, /data-pipeline-stage/);
  assert.match(PANEL_HTML, /id="inqPipeline"/);
});

test('рабочий список собирает контакты менеджера и быстрые действия', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /\["tasks", "Задачи"\]/);
  assert.match(PANEL_HTML, /function renderTasks\(host\)/);
  assert.match(PANEL_HTML, /К выполнению/);
  assert.match(PANEL_HTML, /Без следующего шага/);
  assert.match(PANEL_HTML, /data-task-plan/);
  assert.match(PANEL_HTML, /data-task-done/);
  assert.match(PANEL_HTML, /Откройте рабочий список менеджера/);
});

test('карточка клиента объединяет профиль, интересы и личную переписку', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /class="client-profile"/);
  assert.match(PANEL_HTML, /Написать клиенту/);
  assert.match(PANEL_HTML, /Объекты и интересы/);
  assert.match(PANEL_HTML, /История обращений/);
  assert.match(PANEL_HTML, /id="clientContactName"/);
  assert.match(PANEL_HTML, /id="clientPhone"/);
  assert.match(PANEL_HTML, /id="clientContactTime"/);
  assert.match(PANEL_HTML, /\/message", "POST"/);
  assert.match(PANEL_HTML, /result\.inquiryId/);
  assert.match(PANEL_HTML, /Черновик сообщения будет потерян/);
});

test('аналитика объекта связывает показы, обращения и заинтересованных клиентов', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function openObjectInsights\(id\)/);
  assert.match(PANEL_HTML, /\/api\/objects\/" \+ encodeURIComponent\(id\) \+ "\/insights/);
  assert.match(PANEL_HTML, /class="object-path"/);
  assert.match(PANEL_HTML, /Заинтересованные клиенты/);
  assert.match(PANEL_HTML, /data-insight-client/);
  assert.match(PANEL_HTML, /data-insight-conversation/);
  assert.match(PANEL_HTML, /stats\.impressions \|\| stats\.views/);
  assert.match(PANEL_HTML, /\{ step: button\.dataset\.move === "up" \? -1 : 1 \}/);
});

test('рассылка показывает точную аудиторию и поддерживает CRM-сегменты', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="campStage"/);
  assert.match(PANEL_HTML, /id="campSource"/);
  assert.match(PANEL_HTML, /id="campProperty"/);
  assert.match(PANEL_HTML, /id="campPropertySignal"/);
  assert.match(PANEL_HTML, /pipelineStages:/);
  assert.match(PANEL_HTML, /propertySignal:/);
  assert.match(PANEL_HTML, /result\.byLanguage\.ru/);
  assert.match(PANEL_HTML, /Сегмент: " \+ campaignAudienceLabel/);
  assert.match(PANEL_HTML, /Для выбранных условий нет получателей/);
});

test('просмотры собраны в недельный календарь с подтверждением и переносом', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /class="viewing-calendar"/);
  assert.match(PANEL_HTML, /Ждут подтверждения/);
  assert.match(PANEL_HTML, /data-viewing-schedule/);
  assert.match(PANEL_HTML, /Подтвердить и уведомить/);
  assert.match(PANEL_HTML, /Перенести и уведомить/);
  assert.match(PANEL_HTML, /function openViewingSchedule\(item\)/);
  assert.match(PANEL_HTML, /viewingWeekOffset/);
  assert.match(PANEL_HTML, /\/viewing", "POST"/);
});

test('центр уведомлений связывает рабочие события с нужными разделами', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="notificationBell"/);
  assert.match(PANEL_HTML, /VIEWS\.notifications/);
  assert.match(PANEL_HTML, /Требуют внимания/);
  assert.match(PANEL_HTML, /Непрочитанные/);
  assert.match(PANEL_HTML, /Обработанные/);
  assert.match(PANEL_HTML, /data-notification-open/);
  assert.match(PANEL_HTML, /\/api\/admin-notifications\/read-all/);
  assert.match(PANEL_HTML, /action: "handle"|data-notification-action="handle"/);
});

test('отложенное время переводится через часовой пояс компании', async () => {
  const { PANEL_RUNTIME_JS } = await import('../src/panel/runtime.mjs');
  const context = {};
  vm.createContext(context);
  new vm.Script(PANEL_RUNTIME_JS + '\nstate={config:{timeZone:"Europe/Madrid"}}; result={winter:dateTimeLocalValue("2026-01-15T11:00:00.000Z"),summer:dateTimeLocalValue("2026-07-15T10:00:00.000Z"),back:zonedDateTimeToIso("2026-07-15T12:00")};').runInContext(context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    winter: '2026-01-15T12:00',
    summer: '2026-07-15T12:00',
    back: '2026-07-15T10:00:00.000Z',
  });
});
