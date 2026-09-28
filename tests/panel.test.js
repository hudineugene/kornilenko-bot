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
  for (const view of ['today', 'notifications', 'clients', 'viewings', 'objects', 'texts', 'posts', 'reports', 'settings']) {
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

test('меню закреплено сверху, нажатие открывает раздел, подвкладки — на странице', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /class="app-head"/);
  assert.match(PANEL_HTML, /class="head-nav"/);
  assert.doesNotMatch(PANEL_HTML, /<aside class="side"/);
  // Раньше подвкладки были выведены дважды: выпадающим списком в меню и полосой
  // на странице, а нажатие на раздел только раскрывало список.
  assert.doesNotMatch(PANEL_HTML, /class="nav-dropdown/, 'выпадающего списка в меню больше нет');
  assert.doesNotMatch(PANEL_HTML, /nav-subitem/, 'подпунктов в меню нет');
  assert.match(PANEL_HTML, /class="nav-item' \+ \(active \? " active" : ""\) \+ '" data-view="/, 'раздел — обычная кнопка');
  assert.match(PANEL_HTML, /Надёжный запуск/);
  assert.match(PANEL_HTML, /\/api\/autostart/);
});

test('старые адреса панели и ссылки из уведомлений продолжают работать', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Уведомления бота ссылаются на прежние разделы (inquiries/inbox и другие),
  // и у владельца могут быть закладки: адреса переводятся, а не ломаются.
  assert.match(PANEL_HTML, /var LEGACY_ROUTES = \{/);
  assert.match(PANEL_HTML, /"inquiries": \{ "": \["clients", "inbox"\]/);
  assert.match(PANEL_HTML, /"catalog": \{ "": \["objects", "list"\]/);
  assert.match(PANEL_HTML, /"stats": \["settings", "reports"\]/);
  assert.match(PANEL_HTML, /function normalizeRoute\(view, tab\)/);
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

test('«Приветствие и меню» — на одной вкладке и с живым предпросмотром', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Приветствие, подсказка, помощь и подписи кнопок — в одной форме.
  assert.match(PANEL_HTML, /Подсказка под приветствием/);
  assert.match(PANEL_HTML, /field-label">Кнопки меню/);
  assert.match(PANEL_HTML, /\["objects", "Каталог"\]/);
  assert.match(PANEL_HTML, /\["placeholder", "Подсказка в поле ввода"\]/);
  assert.match(PANEL_HTML, /data-menu="/);
  assert.match(PANEL_HTML, /data-hint="text"/);

  // Предпросмотр обновляется при вводе и показывает картинку, текст и кнопки.
  assert.match(PANEL_HTML, /function renderWelcomePreview\(\)/);
  assert.match(PANEL_HTML, /host\.addEventListener\("input", renderWelcomePreview\)/);
  assert.match(PANEL_HTML, /id="welcomePreview"/);
  assert.match(PANEL_HTML, /tg-buttons/);

  // Ключ подстановки объяснён словами, а не как есть.
  assert.match(PANEL_HTML, /\{first_name\} подставит имя клиента/);
  assert.match(PANEL_HTML, /\["welcome", "Приветствие и меню"\]/);
  // Подписи кнопок сохраняются тем же нажатием.
  assert.match(PANEL_HTML, /payload\.menuLabels\[language\[0\]\]\[field\[0\]\] = input\.value/);
});

test('«Публикации» — две кнопки, общая очередь и общая история', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function renderPublications\(host\)/);
  assert.match(PANEL_HTML, /pageAction\("✉ Рассылка клиентам"/);
  assert.match(PANEL_HTML, /pageAction\("➤ Пост в канал", openChannelComposer/);
  // Очередь и история — общие для рассылок и постов.
  assert.match(PANEL_HTML, /function publicationRows\(\)/);
  assert.match(PANEL_HTML, /<h3>Очередь<\/h3>/);
  assert.match(PANEL_HTML, /<h3>История<\/h3>/);
  assert.match(PANEL_HTML, /Клиентам · /);
  assert.match(PANEL_HTML, /"Канал · "/);

  // Оформление — кнопкой из формы поста, отдельной вкладки больше нет.
  assert.match(PANEL_HTML, /id="openPostStyle"/);
  assert.match(PANEL_HTML, /function openPostStyleDialog\(\)/);
  assert.match(PANEL_HTML, /\["broadcast", "Очередь и история"\], \["channel", "Каналы и группы"\]/);
  assert.ok(!/\["style", "Оформление"\]/.test(PANEL_HTML), 'вкладка «Оформление» убрана');
  assert.ok(!/во вкладке «Оформление постов»/.test(PANEL_HTML), 'подсказки больше не шлют во вкладку');
});

test('в списке объектов цифры подписаны, а редкие действия — под «⋯»', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Колонка «Эффективность»: видно, что за числа.
  assert.match(PANEL_HTML, /👁 ' \+ counted\(stats\.impressions, "показ", "показа", "показов"\)/);
  assert.match(PANEL_HTML, /📩 ' \+ counted\(stats\.inquiries, "заявка", "заявки", "заявок"\)/);

  // Вместо четырёх значков в строке — одно меню.
  assert.match(PANEL_HTML, /function openObjectExtras\(id\)/);
  assert.match(PANEL_HTML, /data-more="1" title="Ещё действия"/);
  assert.match(PANEL_HTML, /↑ Поднять в списке/);
  assert.match(PANEL_HTML, /↓ Опустить в списке/);
  assert.match(PANEL_HTML, /⧉ Создать копию/);
  assert.match(PANEL_HTML, /Удалить объект/);
  assert.ok(!/title="Выше"/.test(PANEL_HTML), 'голых значков в строке не осталось');
  assert.ok(!/title="Копия"/.test(PANEL_HTML));
});

test('у объекта есть кнопка «Опубликовать», а значок говорит про клиента', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="togglePublish"/);
  assert.match(PANEL_HTML, /"Снять с публикации" : "Опубликовать"/);
  assert.match(PANEL_HTML, /Объект сразу появится в каталоге у клиентов/);
  assert.match(PANEL_HTML, /Объект пропадёт из каталога, переписка и заявки останутся/);
  // Значок больше не называет скрытый объект «готовым к публикации».
  assert.ok(!/готова к публикации/.test(PANEL_HTML), 'старая подпись значка убрана');
  assert.match(PANEL_HTML, /text: "черновик — клиенты не видят"/);
  assert.match(PANEL_HTML, /виден клиентам · забронирован/);
  assert.match(PANEL_HTML, /: "виден клиентам", chip: "ok"/);
  // И в списке статусов «Скрыт» назван черновиком.
  assert.match(PANEL_HTML, /\["hidden", "Черновик — клиенты не видят"\]/);
});

test('номер объекта стоит наверху формы, участок — только там, где он бывает', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Номер объекта — в первом разделе, до фотографий и характеристик.
  const referenceAt = PANEL_HTML.indexOf('id="fReference"');
  const photosAt = PANEL_HTML.indexOf('photo-field');
  const specsAt = PANEL_HTML.indexOf('Характеристики');
  const addressAt = PANEL_HTML.indexOf('Адрес и ссылки');
  assert.ok(referenceAt > 0 && referenceAt < photosAt, 'номер объекта выше фотографий');
  assert.ok(referenceAt < specsAt && referenceAt < addressAt, 'и выше характеристик с адресом');
  assert.equal(PANEL_HTML.split('id="fReference"').length - 1, 1, 'поле одно, а не два');

  // Участок прячется у квартиры и новостройки.
  assert.match(PANEL_HTML, /data-field="plotArea"/);
  assert.match(PANEL_HTML, /\["apartment", "newbuild"\]\.indexOf\(type\) >= 0\)/);
});

test('редакторы объекта и рассылки имеют живой предпросмотр', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /id="recordPreview"/);
  assert.match(PANEL_HTML, /function renderRecordPreview\(\)/);
  assert.match(PANEL_HTML, /id="campaignPreview"/);
  assert.match(PANEL_HTML, /function renderCampaignPreview\(\)/);
  assert.ok((PANEL_HTML.match(/wide: true/g) || []).length >= 2, 'оба редактора должны использовать широкую компоновку');
  assert.match(PANEL_HTML, /Готовность карточки/);
  assert.match(PANEL_HTML, /клиенты видят её только на тех языках, где заполнено всё/, 'карточка объясняет готовность, а не запрещает сохранение');
  assert.match(PANEL_HTML, /encodeURIComponent\(record\.id\), "PATCH"/);
  assert.match(PANEL_HTML, /comparison\.cardAddShort/, 'предпросмотр должен показывать компактную кнопку сравнения');
  assert.match(PANEL_HTML, /actions\.bedroomsLabel/, 'характеристики в предпросмотре должны иметь локализованные подписи');
  assert.match(PANEL_HTML, /facts\.slice\(factIndex, factIndex \+ 2\)/, 'в строке предпросмотра должно быть не больше двух характеристик');
  assert.match(PANEL_HTML, /✦ /, 'премиальные метки должны совпадать с карточкой Telegram');
  assert.match(PANEL_HTML, /Цена по запросу \/ текст/);
  assert.match(PANEL_HTML, /Полный адрес показывается клиенту только после нажатия/);
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
  assert.match(PANEL_HTML, /title: "Клиенты"/);
  assert.match(PANEL_HTML, /\["inbox", "Диалоги"\]/);
  assert.match(PANEL_HTML, /Непрочитанные/);
  assert.match(PANEL_HTML, /class="messenger-shell/);
  assert.match(PANEL_HTML, /Один клиент — одна переписка/);
  assert.match(PANEL_HTML, /class="conversation-thread"/);
  assert.match(PANEL_HTML, /conversation-media/);
  assert.match(PANEL_HTML, /message\.reactions/);
  assert.match(PANEL_HTML, /Ответить в Telegram/);
  assert.match(PANEL_HTML, /class="conversation-side"/);
  assert.match(PANEL_HTML, /Карточка клиента/);
  assert.match(PANEL_HTML, /id="inqAssignee"/);
  assert.match(PANEL_HTML, /id="saveInq"/);
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

test('редкие действия убраны под «⋯»', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function openInquiryExtras\(\)/);
  assert.match(PANEL_HTML, /pageAction\("⋯", openInquiryExtras/, 'на экране одна кнопка «⋯» вместо «Очистить»');
  assert.match(PANEL_HTML, /id="extraExport"/);
  assert.match(PANEL_HTML, /id="extraCleanup"/);
  assert.match(PANEL_HTML, /id="extraDelete"/, 'удаление заявки — тоже под «⋯»');
  // Рядом с поиском и с кнопкой «Сохранить» их больше нет.
  assert.ok(!/id="exportInq"/.test(PANEL_HTML), 'выгрузка ушла из строки фильтров');
  assert.ok(!/id="deleteInq"/.test(PANEL_HTML), 'удаление ушло из ряда с «Сохранить»');
  assert.match(PANEL_HTML, /id="inquiryExtras"/);
});

test('состояние заявки — одно на всю панель', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /function inquiryState\(inquiry\)/);
  assert.match(PANEL_HTML, /text: "Ждёт ответа"/);
  assert.match(PANEL_HTML, /text: "Отвечено"/);
  assert.match(PANEL_HTML, /text: "Закрыт"/);
  assert.ok(!/оставить диалог в работе/.test(PANEL_HTML), 'галочка «оставить диалог в работе» убрана');
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
  assert.match(PANEL_HTML, /\["tasks", "Следующие шаги"\]/);
  assert.match(PANEL_HTML, /function renderTasks\(host\)/);
  assert.match(PANEL_HTML, /К выполнению/);
  assert.match(PANEL_HTML, /Без следующего шага/);
  assert.match(PANEL_HTML, /data-task-plan/);
  assert.match(PANEL_HTML, /data-task-done/);
});

test('карточка клиента объединяет профиль, интересы и личную переписку', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  assert.match(PANEL_HTML, /class="client-profile"/);
  assert.match(PANEL_HTML, /Написать клиенту/);
  assert.match(PANEL_HTML, /Объекты и интересы/);
  assert.match(PANEL_HTML, /История заявок/);
  assert.match(PANEL_HTML, /id="clientContactName"/);
  assert.match(PANEL_HTML, /id="clientPhone"/);
  assert.match(PANEL_HTML, /id="clientContactTime"/);
  // Писать клиенту можно в одном месте — на экране переписки.
  assert.match(PANEL_HTML, /id="clientWrite"/);
  assert.match(PANEL_HTML, /Открыть переписку/);
  assert.ok(!/id="clientMessageText"/.test(PANEL_HTML), 'второй формы отправки в карточке больше нет');
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

test('несохранённая плашка рубрики привязана к самой рубрике, а не к номеру строки', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Хранение по номеру строки ломалось при удалении рубрики: список сдвигался,
  // а выбранная картинка доставалась соседней рубрике.
  assert.doesNotMatch(PANEL_HTML, /pendingImages\[index\]/, 'картинки рубрик больше не хранятся по номеру');
  assert.doesNotMatch(PANEL_HTML, /delete pendingImages/, 'удалять записи по номеру больше не нужно');
  assert.match(PANEL_HTML, /rubrics\[index\]\.pendingImage = reader\.result/, 'выбранная картинка кладётся в саму рубрику');
  assert.match(PANEL_HTML, /imageDataUrl: rubric\.pendingImage/, 'и сохраняется вместе с ней');
});

test('действия, которые видят клиенты, спрашивают подтверждение', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  // Выключение бота останавливает ответы клиентам, пост уходит всем сразу,
  // отозванная ссылка перестаёт работать у всех, кому её отправили.
  assert.match(PANEL_HTML, /Выключить бота\?/, 'переключатель «Бот включён» спрашивает');
  assert.match(PANEL_HTML, /Клиенты перестанут получать ответы/);
  assert.match(PANEL_HTML, /Опубликовать\?/, 'публикация в группу спрашивает');
  assert.match(PANEL_HTML, /Запланировать публикацию\?/, 'и отложенная тоже');
  assert.match(PANEL_HTML, /Отозвать ссылку-приглашение\?/, 'отзыв ссылки спрашивает');
  // Включение бота подтверждения не требует: оно ничего не ломает.
  const toggle = PANEL_HTML.match(/if \(toggle\) toggle\.onchange = async function \(\) \{([\s\S]*?)\n    \};/);
  assert.ok(toggle, 'обработчик переключателя найден');
  assert.match(toggle[1], /!toggle\.checked &&/, 'спрашиваем только при выключении');
});

test('панель просит пароль перед изменением доступа из интернета', async () => {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const handler = PANEL_HTML.match(/#saveRemote"\)\.onclick = async function \(\) \{([\s\S]*?)\n  \};/);
  assert.ok(handler, 'обработчик кнопки найден');
  assert.match(handler[1], /askPassword\(/, 'спрашивается текущий пароль');
  assert.match(handler[1], /x-current-password/, 'и уходит на сервер заголовком');
  assert.match(handler[1], /Открыть панель из интернета\?/, 'включение доступа подтверждается отдельно');
});

test('столбики графика имеют высоту, иначе график не рисуется', async () => {
  // Графики «14 дней» на Обзоре и «30 дней» в Статистике не рисовались никогда:
  // закрашенная часть столбика задана в процентах и выведена из потока, а у
  // дорожки своей высоты не было — проценты считались от нуля.
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const track = PANEL_HTML.match(/\.spark div\{([^}]*)\}/);
  const shell = PANEL_HTML.match(/\.spark\{([^}]*)\}/);
  assert.ok(shell && /height:\s*\d+px/.test(shell[1]), 'у графика задана своя высота');
  assert.ok(track, 'дорожка столбика описана в стилях');
  assert.match(track[1], /height:\s*100%/, 'дорожка занимает всю высоту графика');
  assert.match(PANEL_HTML, /<i style="height:' \+ Math\.round\(\(value \/ top\) \* 100\) \+ "%/, 'закрашенная часть считается в процентах от дорожки');
});

test('в подписях панели один словарь и нет технических слов', async () => {
  // Одна и та же сущность называлась пятью словами: обращение, диалог, клиент,
  // задача, воронка. Плюс в подписях попадались «Chat ID», «формат Kyero»,
  // «Europe/Madrid» и расширения файлов — слова не из мира владельца.
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  const screens = PANEL_HTML.slice(PANEL_HTML.indexOf('<script'));

  assert.doesNotMatch(screens, /обращени[ейя]/i, 'вместо «обращения» — «заявка»');
  assert.doesNotMatch(screens, /Chat ID/, '«Chat ID» — это Telegram-чат');
  assert.doesNotMatch(screens, /формат Kyero|XML-выгрузк/, 'формат выгрузки владельцу знать незачем');
  assert.doesNotMatch(screens, /JPG, PNG до|PDF, TXT/, 'расширения файлов из подписей убраны');
  assert.doesNotMatch(screens, /Время панели: ' \+ esc\(panelTimeZone/, 'часовой пояс показывается словами');

  assert.match(screens, /Текущая заявка/);
  assert.match(screens, /Следующий шаг/);
  assert.match(screens, /\["tasks", "Следующие шаги"\]/);
  assert.match(screens, /Видели в каталоге/);
  assert.match(screens, /Открыли карточку/);
  assert.match(screens, /function timeZoneName\(\)/);
});
