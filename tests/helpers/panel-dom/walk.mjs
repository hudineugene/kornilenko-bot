// Обход всех экранов и окон панели на настоящем DOM: возвращает отчёт для тестов (аномалии разметки, мёртвые кнопки,
// залитые кнопки, чипы, глифы, подписи). Заготовка аудита 01.10, перенесённая в тесты.
import { makePanel, settle, anomalies, context, solidButtons, deadControls, duplicateIds, iconOnlyButtons, glyphTexts, plainSpaceNumbers, labelProblems, chips, screenStats, isVisible } from './harness.mjs';
import { richState, emptyState } from './fixtures.mjs';

const report = { screens: {}, dialogs: {}, errors: [], anomalies: [] };

function analyse(panel, scope, extraScopes = []) {
  panel.polish();
  const scopes = [scope].concat(extraScopes).filter(Boolean);
  const merge = (fn) => scopes.flatMap((s) => fn(s));
  const stats = screenStats(scope);
  return {
    stats,
    solid: merge(solidButtons),
    dead: merge(deadControls),
    iconOnly: merge(iconOnlyButtons),
    glyphs: merge(glyphTexts),
    plainSpaces: merge(plainSpaceNumbers),
    labels: (() => { const a = scopes.map(labelProblems); return { orphanLabels: a.flatMap((x) => x.orphanLabels), unlabelled: a.flatMap((x) => x.unlabelled) }; })(),
    chips: merge(chips),
    duplicateIds: duplicateIds(panel.doc),
    leaks: panel.doc.documentElement.querySelectorAll('[data-leak]').length,
  };
}

async function walk(kind, state) {
  const panel = await makePanel(state);
  const s = panel.sandbox, doc = panel.doc;
  const page = () => doc.getElementById('page');
  const top = () => doc.querySelector('.topbar');
  const screen = async (label, action) => {
    context.label = kind + ' · ' + label;
    try { await action(); await settle(70); } catch (e) { report.errors.push(context.label + ': ' + (e && e.stack || e)); }
    report.screens[context.label] = analyse(panel, page(), [top()]);
    report.screens[context.label].hash = panel.hash();
    report.screens[context.label].title = doc.getElementById('pageTitle').textContent;
    report.screens[context.label].savebar = !doc.getElementById('savebar').classList.contains('hidden');
  };
  const dialog = async (label, action) => {
    context.label = kind + ' · окно · ' + label;
    try { await action(); await settle(70); } catch (e) { report.errors.push(context.label + ': ' + (e && e.stack || e)); }
    const open = panel.dialogs();
    if (!open.length) { report.dialogs[context.label] = { missing: true }; return; }
    report.dialogs[context.label] = analyse(panel, open[open.length - 1]);
    report.dialogs[context.label].count = open.length;
    report.dialogs[context.label].heading = (open[open.length - 1].querySelector('h2') || { textContent: '' }).textContent;
    panel.closeDialogs();
    await settle(20);
    s.clearDirty();
  };

  // экран входа и первой настройки — разметка каркаса
  context.label = kind + ' · вход';
  report.screens[context.label] = analyse(panel, doc.getElementById('loginScreen'));
  context.label = kind + ' · первая настройка';
  report.screens[context.label] = analyse(panel, doc.getElementById('setupScreen'));

  await screen('today', () => panel.go('today'));
  await screen('today/выполненное', async () => { s.feedFilter = 'done'; s.renderView(); });
  s.feedFilter = 'active';
  await screen('clients/inbox (не выбран)', () => panel.go('clients', 'inbox'));
  if (state.inquiries.length) {
    await screen('clients/inbox (диалог открыт)', async () => { s.inquiryFilter.status = ''; s.selectConversation('inq1'); s.renderView(); await settle(60); });
    await screen('clients/inbox (просмотр, es)', async () => { s.selectConversation('inq2'); s.renderView(); await settle(60); });
    await screen('clients/inbox (подбор)', async () => { s.selectConversation('inq4'); s.renderView(); await settle(60); });
    await screen('clients/inbox (пакетный режим)', async () => { s.batchMode = true; s.batchPicked = { u1: true }; s.renderView(); await settle(40); });
    s.batchMode = false; s.batchPicked = {}; s.selectConversation('', true);
  }
  await screen('clients/tasks', async () => { await panel.go('clients', 'tasks'); s.taskFilter.scope = 'all'; s.renderView(); });
  await screen('clients/pipeline', () => panel.go('clients', 'pipeline'));
  await screen('clients/base', () => panel.go('clients', 'base'));
  await screen('viewings/calendar', async () => { await panel.go('viewings', 'calendar'); });
  await screen('viewings/pending', async () => { await panel.go('viewings', 'pending'); });
  await screen('viewings/history', async () => { await panel.go('viewings', 'history'); });
  await screen('objects/list', () => panel.go('objects', 'list'));
  await screen('objects/offers', () => panel.go('objects', 'offers'));
  await screen('objects/load (из файла и с сайта)', () => panel.go('objects', 'load'));
  await screen('posts/broadcast', () => panel.go('posts', 'broadcast'));
  await screen('posts/channel', async () => { s.selectedGroup = 'g1'; await panel.go('posts', 'channel'); });
  if (state.groups.length) await screen('posts/channel (группа с темами)', async () => { s.selectedGroup = 'g2'; s.renderView(); await settle(60); });
  await screen('posts/channels', async () => { s.selectedGroup = 'g1'; await panel.go('posts', 'channels'); });
  if (state.groups.length) {
    await screen('posts/channels (g1 + администраторы)', async () => { const b = doc.getElementById('loadAdmins'); if (b) b.click(); await settle(60); });
    await screen('posts/channels (g2 участник)', async () => { s.selectedGroup = 'g2'; s.renderView(); await settle(60); });
    await screen('posts/channels (g4 владелец)', async () => { s.selectedGroup = 'g4'; s.renderView(); await settle(60); });
    await screen('posts/channels (g3 вышел)', async () => { s.selectedGroup = 'g3'; s.renderView(); await settle(60); });
  }
  await screen('reports', () => panel.go('reports'));
  await screen('reports (подробнее раскрыто)', async () => { const d = page().querySelector('details'); if (d) d.open = true; });
  for (const tab of ['welcome', 'contacts', 'trust', 'plan', 'rules', 'interface']) await screen('texts/' + tab, () => panel.go('texts', tab));
  await screen('texts/interface (группа раскрыта)', async () => { const d = page().querySelectorAll('details'); d.forEach((x) => { x.open = true; }); await settle(30); });
  for (const tab of ['company', 'telegram', 'team', 'data', 'check']) await screen('settings/' + tab, () => panel.go('settings', tab));
  await screen('settings/check (самопроверка и файлы)', async () => { await panel.go('settings', 'check'); doc.getElementById('runSelfCheck').click(); doc.getElementById('checkMedia').click(); await settle(60); });

  // --- окна
  const first = (list) => (list || [])[0] || {};
  await panel.go('objects', 'list');
  await dialog('подтверждение (confirmDialog)', () => { s.confirmDialog('Удалить объект?', 'Карточка исчезнет из каталога бота.', 'Удалить', true); });
  await dialog('пароль (askPassword)', () => { s.askPassword('Скачать копию данных?', 'Нужен пароль.'); });
  await dialog('вопрос (askText)', () => { s.askText('Ссылка надписью', 'Адрес ссылки', 'https://', ''); });
  await dialog('новый объект', () => s.openRecordEditor('objects', null));
  if (state.objects.length) {
    await dialog('редактор объекта obj1 (опубликован)', () => s.openRecordEditor('objects', 'obj1'));
    await dialog('редактор объекта obj2 (черновик)', () => s.openRecordEditor('objects', 'obj2'));
    await dialog('редактор объекта obj4 (продан)', () => s.openRecordEditor('objects', 'obj4'));
    await dialog('ещё действия объекта', () => s.openObjectExtras('obj1'));
    await dialog('пост об объекте в канал', () => s.openChannelPost('obj1'));
    await dialog('эффективность объекта', () => s.openObjectInsights('obj1'));
  }
  await dialog('новая акция', () => s.openRecordEditor('promotions', null));
  if (state.promotions.length) {
    await dialog('редактор акции', () => s.openRecordEditor('promotions', 'p1'));
    await dialog('ещё действия акции', () => s.openOfferExtras('p1'));
  }
  await dialog('новая рассылка', () => s.openCampaignEditor(null));
  if (state.broadcasts.length) {
    await dialog('рассылка-черновик b1', () => s.openCampaignEditor('b1'));
    await dialog('отложенный пост', () => s.openScheduledPost(s.publicationRows().find((r) => r.kind === 'post')));
  }
  await dialog('оформление постов', () => s.openPostStyleDialog());
  await dialog('автопубликация', () => s.openAutoPublish());
  await dialog('новый автоответ', () => s.openRuleEditor(null));
  if (state.rules.length) await dialog('автоответ r1', () => s.openRuleEditor('r1'));
  await dialog('новый клиент', () => s.openManualClient());
  await dialog('назначить просмотр', () => s.openManualViewing(''));
  await dialog('ещё действия заявок', () => s.openInquiryExtras());
  await dialog('очистка заявок', () => s.openCleanup());
  await dialog('выгрузка заявок', () => s.openExportDialog());
  await dialog('передать всех', () => s.openTransferDialog('all'));
  if (state.inquiries.length) {
    await dialog('карточка клиента u1', () => s.openClient('u1'));
    await dialog('карточка клиента u2 (дубль)', () => s.openClient('u2'));
    await dialog('карточка клиента u6 (ручной)', () => s.openClient('u6'));
    await dialog('карточка клиента u7 (без заявок)', () => s.openClient('u7'));
    await dialog('карточка клиента u4 (заблокирован)', () => s.openClient('u4'));
    await dialog('передать одного', () => s.openTransferDialog('one', s.state.inquiries[0]));
    await dialog('быстрый ответ', () => s.openQuickReply('inq1', []));
    await dialog('быстрый ответ (es)', () => s.openQuickReply('inq2', []));
    await dialog('следующий шаг', () => s.openTaskSchedule(s.state.inquiries[1]));
    await dialog('подтвердить просмотр inq2', () => s.openViewingSchedule(s.state.inquiries[1]));
    await dialog('перенести просмотр inq3', () => s.openViewingSchedule(s.state.inquiries[2]));
    await dialog('пакетная передача', () => { s.batchPicked = { u1: true, u2: true }; s.openBatchTransfer(page()); });
  }
  // каркас: шапка, поиск, лист «Ещё»
  context.label = kind + ' · шапка и меню';
  doc.getElementById('globalSearch').value = 'ан';
  s.paletteOpen = true; s.globalSearchRun('ан'); await settle(60);
  doc.getElementById('moreSheet').classList.remove('hidden');
  report.screens[context.label] = analyse(panel, doc.getElementById('appHead'), [doc.getElementById('tabbar'), doc.getElementById('moreSheet'), doc.getElementById('savebar'), doc.getElementById('toast'), doc.getElementById('refreshHint'), doc.getElementById('linkAlert'), doc.getElementById('saveAlert')]);
  report.errors.push(...doc.errors);
  report.htmlCount = (report.htmlCount || 0) + doc.htmlLog.length;
  report.requestErrors = report.requestErrors || [];
}

// Один обход на весь прогон: полный набор данных и пустой.
let cached = null;
export async function walkAll() {
  if (cached) return cached;
  const onRejection = (e) => { report.errors.push(context.label + ': unhandledRejection: ' + (e && e.stack || e)); };
  process.on('unhandledRejection', onRejection);
  try {
    await walk('полный', richState());
    await walk('пустой', emptyState());
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  report.anomalies = anomalies;
  cached = report;
  return report;
}
