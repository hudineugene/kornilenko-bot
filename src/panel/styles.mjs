// Оформление панели: плотная светлая тема и закреплённая верхняя навигация.

const PANEL_CSS = String.raw`
/* Inter встроен в программу: панель ничего не грузит из интернета. Две части (латиница с испанскими буквами и
   кириллица), обе — переменные по весу; браузер берёт только ту, чьи знаки на странице есть. */
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/panel-fonts/inter-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/panel-fonts/inter-cyrillic.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:clip}
:root{
  /* Цвета: 22 значения вместо 33. Нейтральные — фон, поверхность, линии, текст; бренд;
     четыре состояния (успех, внимание, беда) с мягким фоном и линией. Остальное —
     смеси этих же цветов. */
  --bg:#f5f6f8; --surface:#fff; --surface-soft:#fafbfc; --line:#e4e7ec; --line-soft:#eef1f4; --field-line:#7d8798;
  --text:#101828; --muted:#525d70;
  --brand:#2f56d9; --brand-soft:#eef2ff; --brand-dark:#2344b5; --brand-soft-line:#c7d7fe;
  --live:#12b76a; --ok:#067647; --ok-soft:#ecfdf3; --ok-line:#abefc6;
  --warn:#b54708; --warn-soft:#fffaeb; --warn-line:#fedf89;
  --bad:#b42318; --bad-soft:#fef3f2; --bad-line:#fecdca;
  /* Радиусы: маленький, обычный и «таблетка» (круг — 50%). */
  --radius-sm:6px; --radius:10px; --edge:4px; --side:320px; --row-pad:var(--sp-3) var(--sp-4);--radius-pill:999px;
  /* Тени: обычная и для всплывающего. */
  --ink-rgb:16,24,40;
  --shadow:0 1px 2px rgba(var(--ink-rgb),.06); --shadow-lg:0 12px 32px rgba(var(--ink-rgb),.14);
  /* Затемнение под окнами и шторкой меню; тёмная «стеклянная» подложка под мелкими значками на фото. */
  --overlay:rgba(var(--ink-rgb),.45); --glass:rgba(var(--ink-rgb),.76);
  /* Слои сверху вниз: закреплённая полоса, панели, шапка, всплывающее, окна. */
  --z-sticky:20; --z-bar:40; --z-head:50; --z-toast:60; --z-popup:70;
  --header:60px;
  /* Три высоты строки: плотная (заголовки, числа), обычная, свободная (длинные подписи). */
  --lh-tight:1.25; --lh:1.45; --lh-loose:1.6;
  /* Поле закреплённых элементов (полоса сохранения, всплывающее, предупреждение) от края экрана. */
  --gutter:20px;
  /* Нижняя панель на телефоне и запас под закреплённой полосой сохранения: страница не должна прятаться под ними. */
  --tabbar-h:62px; --savebar-h:96px;
  /* Шкала размеров текста: 13, 14, 16, 20. Основной — 14 px. */
  --fs-xs:13px; --fs-sm:14px; --fs-lg:16px; --fs-xl:20px; --fs-display:28px;
  /* Роли заголовков: h1 — название экрана, h2 — заголовок окна, имя клиента или объекта, h3 — заголовок карточки. */
  --fs-h1:24px; --fs-h2:18px; --fs-h3:15px;
  /* Одна шкала отступов: 4, 8, 12, 16, 24 (и 2 px — только для волосяных зазоров). */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px;
}
html,body{margin:0;padding:0}
/* Кнопки берут шрифт страницы: без этого браузер ставил им свои 13,33 px. */
button{font:inherit}
body{background:var(--bg);color:var(--text);font:400 var(--fs-sm)/var(--lh) "Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-weight:600;letter-spacing:-.01em}
h1{font-size:var(--fs-h1)}h2{font-size:var(--fs-h2)}h3{font-size:var(--fs-h3)}
p{margin:0}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.hidden{display:none!important}
.muted{color:var(--muted)}
.small{font-size:var(--fs-xs)}
.nowrap{white-space:nowrap}
.right{text-align:right}
.grow{flex:1}
.row{display:flex;align-items:center;gap:var(--sp-2)}
.row.wrap{flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--sp-3)}
.grid{display:grid;gap:var(--sp-3)}
.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.split{display:grid;grid-template-columns:minmax(0,1fr) var(--side);gap:var(--sp-3);align-items:start}

/* --- Каркас ---------------------------------------------------------------- */
.app{min-height:100vh}
.app-head{position:sticky;top:0;z-index:var(--z-head);min-height:var(--header);display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-4);background:color-mix(in srgb, var(--surface) 96%, transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);box-shadow:var(--shadow)}
.app-brand{display:flex;align-items:center;gap:var(--sp-2);flex:none;padding-right:var(--sp-1)}
.app-brand img{height:44px;width:auto;max-width:50px;object-fit:contain}
.app-brand b{line-height:var(--lh-tight);white-space:nowrap}
.app-brand .brand-sub{display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:400}
.app-brand .brand-short{display:none}
.head-nav{display:flex;align-items:center;gap:2px;min-width:0;flex:1 1 0;overflow-x:auto;scrollbar-width:none}
.head-nav::-webkit-scrollbar{display:none}
/* Меню не помещается и листается вбок: правый край гаснет — видно, что дальше есть пункты (класс ставит панель). */
.head-nav.more-right{-webkit-mask-image:linear-gradient(to right,var(--text) calc(100% - 32px),transparent);mask-image:linear-gradient(to right,var(--text) calc(100% - 32px),transparent)}
.nav-item{flex:none}
/* Общий поиск: одно поле в шапке. */
.global-search{position:relative;flex:0 1 220px;min-width:140px}
.global-search input{width:100%;padding:var(--sp-2) var(--sp-3);border-radius:var(--radius);background:var(--surface-soft);font-size:var(--fs-sm)}
.global-results{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:var(--z-popup);max-height:70vh;overflow:auto;min-width:300px;padding:var(--sp-2);box-shadow:var(--shadow-lg)}
.global-title{padding:var(--sp-2) var(--sp-3) 2px;color:var(--muted);font-size:var(--fs-xs);font-weight:700;text-transform:uppercase}
.global-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:var(--sp-2) var(--sp-3);border:0;border-radius:var(--radius);background:none;font:inherit;text-align:left;cursor:pointer}
.global-item:hover,.global-item:focus{background:var(--brand-soft)}
.global-item span{color:var(--muted);font-size:var(--fs-xs)}
.global-empty{padding:var(--sp-3) var(--sp-3);color:var(--muted);font-size:var(--fs-sm)}
.btn.search-toggle{display:none}
/* Поиск должен помещаться: на средней ширине текст состояния бота уступает ему место. */
@media(max-width:1960px) and (min-width:861px){.head-tools #botStateText{display:none}}
.nav-item{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-2);border:0;background:none;border-radius:var(--radius);color:var(--text);font:inherit;font-size:var(--fs-sm);text-align:left;cursor:pointer;white-space:nowrap}
.nav-item:hover{background:var(--surface-soft)}
.nav-item.active{background:var(--brand-soft);color:var(--brand-dark);font-weight:600}
.nav-item .ico{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;opacity:.9}
.nav-item .ico svg,.tab-ico svg,.more-item .ico svg{width:100%;height:100%}
.nav-item .count{margin-left:auto;min-width:20px;padding:0px var(--sp-2);border-radius:var(--radius);background:var(--bad);color:var(--surface);font-weight:700;text-align:center}
.nav-item.active .count{background:var(--brand)}
.head-tools{display:flex;align-items:center;gap:var(--sp-1);margin-left:auto;flex:none}
.notification-bell{position:relative;display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:var(--radius);background:transparent;color:var(--muted);font:inherit;font-size:var(--fs-sm);cursor:pointer}
.notification-bell b.dot{min-width:10px;width:10px;height:10px;padding:0;right:2px;top:1px}
.notification-bell:hover,.notification-bell.active{border-color:var(--line);background:var(--surface-soft);color:var(--text)}
.notification-bell b{position:absolute;right:-3px;top:-4px;min-width:18px;height:18px;padding:0 var(--sp-1);border:2px solid var(--surface);border-radius:var(--radius-pill);background:var(--bad);color:var(--surface);font-size:var(--fs-xs);line-height:14px;text-align:center}
.state-line{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-2);border-radius:var(--radius);background:var(--surface-soft);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
.dot.on{background:var(--live);box-shadow:0 0 0 3px color-mix(in srgb, var(--live) 13%, transparent)}
.dot.off{background:var(--line)}
.dot.bad{background:var(--bad);box-shadow:0 0 0 3px color-mix(in srgb, var(--bad) 13%, transparent)}
.main{min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:var(--header);z-index:var(--z-sticky);display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2) var(--sp-4);padding:var(--sp-2) var(--sp-5);background:color-mix(in srgb, var(--bg) 94%, transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.topbar .sub{color:var(--muted)}
.topbar .page-tabs{flex:0 1 auto;min-width:0;max-width:100%;gap:var(--sp-1);padding:0;background:none;border:0;border-radius:0}
.topbar .page-tabs button{padding:0 var(--sp-3);border-radius:0;border-bottom:2px solid transparent;color:var(--muted)}
.topbar .page-tabs button:hover{color:var(--text)}
.topbar .page-tabs button.active{background:none;box-shadow:none;color:var(--brand);border-bottom-color:var(--brand)}
.topbar h1{white-space:nowrap}
.page{padding:var(--sp-4) var(--sp-5) var(--savebar-h);max-width:1560px;width:100%;margin:0 auto}
/* Шапка, заголовок страницы и содержимое начинаются с одного левого края и на очень широком экране: поля растут вместе с отцентровкой страницы. */
@media(min-width:1181px){.app-head,.topbar{padding-left:max(var(--sp-5), calc((100% - 1560px) / 2 + var(--sp-5)));padding-right:max(var(--sp-5), calc((100% - 1560px) / 2 + var(--sp-5)))}}
/* Таблицы-списки (объекты, акции, очередь, история, база) — до 1100 px: строка шире читается плохо, текст и кнопки расходятся. */
@media(min-width:861px){#viewBody>.card:has(>.table-wrap),#viewBody>.table-wrap,.stack>.card:has(>.table-wrap){max-width:1100px}}

/* --- Карточки и таблицы ----------------------------------------------------- */
/* Карточка — одна поверхность для всех: обычная, карточка воронки, дела. Цветная кромка слева
   у тех, кто её несёт, — от переменной --flag (модификаторы только задают цвет). */
/* Поверхности: две группы — белая и мягкая; правило каждого блока ниже задаёт только раскладку. */
.card,.funnel-card,.task-card,.global-results,.viewing-event,.today-numbers,.editor-section,.auth-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
.banner,.tabs,.conversation-side-inner,.reply-box,.funnel-column,.client-profile-side,.object-insights-head,.viewing-day,.markup-bar,.editor-preview-panel,.conversation-side-details>summary{background:var(--surface-soft);border:1px solid var(--line);border-radius:var(--radius)}
.card,.funnel-card,.task-card{box-shadow:var(--shadow)}
.task-card,.viewing-card{border-left:var(--edge) solid var(--flag,var(--line))}
.card>header{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-soft)}
.card>header .actions{margin-left:auto;display:flex;align-items:center;gap:var(--sp-2)}
.card-body{padding:var(--sp-4)}
.card-body.tight{padding:var(--sp-3) var(--sp-4)}
.kpi{display:flex;flex-direction:column;gap:2px;padding:var(--sp-3) var(--sp-4)}
.kpi .label{color:var(--muted)}
.kpi .value{font-size:var(--fs-xl);font-weight:700;letter-spacing:-.02em}
.kpi .delta{color:var(--muted)}
.kpi .delta.up{color:var(--ok)}.kpi .delta.down{color:var(--bad)}
table{width:100%;border-collapse:collapse}
th{font-size:var(--fs-sm);font-weight:600;color:var(--muted);text-align:left;padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line-soft);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr.clickable{cursor:pointer}
tbody tr.clickable:hover{background:var(--surface-soft)}
tbody tr.selected{background:var(--brand-soft)}
.table-wrap{overflow:auto}
.empty{padding:var(--sp-5) var(--sp-4);text-align:center;color:var(--muted)}
.empty b{display:block;color:var(--text);margin-bottom:2px}

/* --- Элементы --------------------------------------------------------------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);border:1px solid var(--brand);border-radius:var(--radius);background:var(--brand);color:var(--surface);font:inherit;font-weight:600;font-size:var(--fs-sm);cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--brand-dark);border-color:var(--brand-dark)}
/* Две высоты кнопок на компьютере (36 и 30) и одна на телефоне (44, ниже). */
.btn{min-height:36px}
.btn.small{min-height:30px}
/* Сообщение-полоса: одна конструкция для «внимание», «ошибка», «готово» и справки; цветная кромка — только слева. */
.banner{--flag:var(--brand);padding:var(--sp-2) var(--sp-3);border-left:var(--edge) solid var(--flag);font-size:var(--fs-sm);overflow-wrap:anywhere}
.banner.warn{--flag:var(--warn);background:var(--warn-soft);border-color:var(--warn-line)}
.banner.bad{--flag:var(--bad);background:var(--bad-soft);border-color:var(--bad-line);color:var(--bad)}
.banner.ok{--flag:var(--ok);background:var(--ok-soft);border-color:var(--ok-line)}
.banner.warn,.banner.bad,.banner.ok{border-left-color:var(--flag)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn.secondary{background:var(--surface);color:var(--text);border-color:var(--line)}
.btn.secondary:hover{background:var(--surface-soft)}
.btn.ghost{background:none;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{background:var(--surface-soft);color:var(--text)}
.btn.danger{background:var(--bad);border-color:var(--bad)}
.btn.danger:hover{background:var(--bad);border-color:var(--bad)}
/* Опасное действие рядом с обычными — контуром, а не сплошной заливкой. */
.btn.danger-outline{background:none;border-color:var(--bad-line);color:var(--bad)}
.readiness{border-color:var(--warn-line)}
.health{gap:var(--sp-2)}
.danger-zone{border-color:var(--bad-line)}
.danger-zone>header h3{color:var(--bad)}
.btn.danger-outline:hover{background:var(--bad-soft)}
.editor-foot{justify-content:flex-end;gap:var(--sp-2)}
.btn.small{padding:var(--sp-1) var(--sp-2);font-size:var(--fs-sm);border-radius:var(--radius-sm)}
.btn.icon{padding:var(--sp-1) var(--sp-2)}
/* Высот у кнопок две: 36 (обычная, вкладка, пункт меню, колокольчик) и 30 (малая). Вертикальные отступы не задаём — высоту держит min-height. */
.btn,.btn.small,.btn.icon{padding-top:0;padding-bottom:0}
.btn.small,.card>header .actions .btn,#pageActions .btn{white-space:nowrap}
.tabs button{min-height:36px;display:inline-flex;align-items:center}
.head-tools .btn.icon{flex:none;min-width:36px}
.btn-ico{display:inline-flex;flex:none;width:16px;height:16px}
@media (max-width:860px){.object-performance{min-height:44px}.objects-table .btn.icon,.objects-table [data-more]{min-width:44px;min-height:44px}}
.hint-more{margin-top:var(--sp-1)}
/* Подвал редактора на телефоне: пояснение сверху, главные кнопки рядом, «Отмена» — узкой строкой снизу.
   Раньше «Отмена» тянулась во всю высоту, а кнопки шли лесенкой (около 170 px). */
@media (max-width:600px){
  .dialog-foot{flex-wrap:wrap;align-items:center}
  .dialog-foot>.grow{display:none}
  .dialog-foot .editor-foot{flex:1 1 100%;order:1;display:flex;flex-wrap:wrap;justify-content:stretch}
  .dialog-foot .editor-foot .btn{flex:1 1 auto}
  .dialog-foot .editor-foot .publish-why{flex:1 1 100%;order:-1}
  /* «Отмена» на телефоне не нужна: в шапке окна есть «✕», и он спрашивает про несохранённое так же. */
  .dialog-foot>.editor-cancel{display:none}
}
.hint-more>summary{cursor:pointer;color:var(--brand)}
/* Пояснение к числу: на компьютере — подсказка при наведении (title), на телефоне наведения нет — подпись под числом. */
.strip-hint{display:none;color:var(--muted);font-size:var(--fs-xs)}
@media(max-width:860px){.today-numbers .strip-hint{display:block}}
/* Телефон: цифры дня — две колонки помельче, недельная строка — только ссылка на отчёт: дела начинаются выше. */
.btn-ico svg{width:100%;height:100%}
/* Значок внутри строки текста (в чипе, заголовке, подписи) и значки шапки. */
.ico-inline{display:inline-flex;width:16px;height:16px;vertical-align:-3px;flex:none}
.ico-inline svg,.ico-svg{width:100%;height:100%}
.head-tools .btn.icon .ico-svg,.notification-bell .ico-svg{width:20px;height:20px}
.save-alert .ico-svg{width:16px;height:16px;vertical-align:-3px}
.toast-action svg{width:14px;height:14px;display:block}
.chip .ico-inline{width:14px;height:14px;vertical-align:-2px}
/* Предпочтение «меньше движения»: переходы и плавная прокрутка отключаются. */
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
.chip{display:inline-flex;align-items:center;gap:var(--sp-1);padding:2px var(--sp-2);border-radius:var(--radius-pill);border:1px solid var(--line);background:var(--surface-soft);font-size:var(--fs-sm);font-weight:600;color:var(--muted);white-space:nowrap}
.chip.ok{background:var(--ok-soft);border-color:var(--ok-line);color:var(--ok)}
.chip.warn{background:var(--warn-soft);border-color:var(--warn-line);color:var(--warn)}
.chip.bad{background:var(--bad-soft);border-color:var(--bad-line);color:var(--bad)}
.chip.brand{background:var(--brand-soft);border-color:var(--brand-soft-line);color:var(--brand-dark)}
.field{display:flex;flex-direction:column;gap:var(--sp-1);min-width:0}
.field>label,.field-label{font-size:var(--fs-sm);font-weight:600;color:var(--muted)}
.hint{font-size:var(--fs-sm);color:var(--muted);max-width:80ch}
@media(min-width:861px){.field select{max-width:420px}.funnel-table,.source-table{max-width:1000px}}
input,textarea,select{width:100%;padding:var(--sp-2) var(--sp-3);border:1px solid var(--field-line);border-radius:var(--radius);background:var(--surface);color:var(--text);font:inherit;font-size:var(--fs-sm)}
/* Одно кольцо фокуса — и у кнопок, и у полей: контур 2 px цвета бренда. У поля ещё и рамка становится цвета бренда. */
input:focus,textarea:focus,select:focus{outline:0;border-color:var(--brand)}
input:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
/* Состояния «выключено» и «нажато» — у всех элементов, а не только у .btn. */
input:disabled,textarea:disabled,select:disabled{opacity:.55;background:var(--surface-soft);cursor:not-allowed}
.tabs button:disabled,.check input:disabled{opacity:.55;cursor:not-allowed}
.btn:active:not(:disabled){transform:translateY(1px)}
.tabs button:active:not(:disabled),.tab:active,.nav-item:active{transform:translateY(1px)}
[tabindex]:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
textarea{min-height:76px;resize:vertical;line-height:var(--lh)}
/* Флажки не мельче 18 px: на телефоне и при работе мышью 13-пиксельный флажок — мишень для промаха. */
input[type=checkbox],input[type=radio]{width:18px;height:18px;flex:none;accent-color:var(--brand)}
.check{display:flex;align-items:center;gap:var(--sp-2);min-height:28px;font-size:var(--fs-sm);cursor:pointer}
.switch{position:relative;display:inline-flex;align-items:center;gap:var(--sp-2);cursor:pointer;font-size:var(--fs-sm)}
.switch input{position:absolute;opacity:0;width:0;height:0}
.switch .track{width:38px;height:22px;border-radius:var(--radius);background:var(--line);transition:background .15s;flex:none}
.switch .track::after{content:"";display:block;width:18px;height:18px;margin:2px;border-radius:50%;background:var(--surface);box-shadow:var(--shadow);transition:transform .15s}
.switch input:checked+.track{background:var(--live)}
.switch input:checked+.track::after{transform:translateX(16px)}
/* Таблицы-карточки на телефоне: «Объекты» и «База клиентов». Таблица шире экрана
   уходила в горизонтальную прокрутку без подсказки, и цена, статус и «⋯» оказывались
   за краем. До 600 px строка — карточка; ячейки ставятся по номеру (td:nth-child),
   поэтому порядок столбцов в разметке менять нельзя без правки этих правил
   (его сторожит тест). */
@media (max-width:600px){
  .table-stack,.table-stack tbody{display:block;width:100%}
  .table-stack thead{display:none}
  .table-stack tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--sp-1) var(--sp-3);padding:var(--sp-3);border-bottom:1px solid var(--line)}
  .table-stack td{display:block;padding:0;border:0;min-width:0;text-align:left}
  .table-stack td:first-child{grid-column:1/-1}
  .table-stack td[data-label]:not(:first-child)::before{content:attr(data-label) ": ";color:var(--muted);font-size:var(--fs-xs)}
  .table-stack td.right{text-align:left}
  .table-cards,.table-cards tbody{display:block;width:100%}
  .table-cards thead{display:none}
  .table-cards tr{display:grid;gap:2px var(--sp-3);padding:var(--sp-3) var(--sp-3);border-bottom:1px solid var(--line);align-items:center}
  .table-cards td{display:block;padding:0;border:0;min-width:0}
  .table-cards td[colspan]{grid-column:1/-1;grid-row:auto}
  .objects-table tr{grid-template-columns:52px minmax(0,1fr) auto}
  .objects-table td:nth-child(1){grid-column:1;grid-row:1/span 3}
  .objects-table td:nth-child(1) .thumb{width:52px;height:52px}
  .objects-table td:nth-child(2){grid-column:2;grid-row:1}
  .objects-table td:nth-child(8){grid-column:3;grid-row:1}
  .objects-table td:nth-child(2) .small{white-space:nowrap}
  .objects-table td:nth-child(3){display:none}
  .objects-table td:nth-child(4){grid-column:2;grid-row:2;color:var(--muted)}
  .objects-table td:nth-child(5){grid-column:3;grid-row:2;font-weight:700;text-align:right}
  .objects-table td:nth-child(6){grid-column:2;grid-row:3}
  .objects-table td:nth-child(7){grid-column:3;grid-row:3;text-align:right}
  .objects-table .object-performance{display:flex;flex-direction:column;align-items:flex-end;gap:0;font-size:var(--fs-xs)}
  .objects-table td:nth-child(6) .chip{max-width:100%;white-space:normal}
  .clients-table tr{grid-template-columns:minmax(0,1fr) auto}
  .clients-table td:nth-child(1){grid-column:1/-1;grid-row:1}
  .clients-table td:nth-child(3){grid-column:1;grid-row:2}
  .clients-table td:nth-child(4){grid-column:2;grid-row:2;text-align:right}
  .clients-table td:nth-child(2){grid-column:1;grid-row:3;font-size:var(--fs-sm);color:var(--muted)}
  .clients-table td:nth-child(5){grid-column:2;grid-row:3;text-align:right}
}
/* Шаблоны ответа: кнопки в ряд; на телефоне ряд листается вбок. */
.reply-templates{display:flex;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-2)}
.template-chip{flex:none;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
@media (max-width:860px){.reply-templates{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:var(--sp-1)}.template-chip{min-height:38px}}
.deeds-scope{padding:var(--sp-3) var(--sp-4) 0;align-items:center;gap:var(--sp-2)}
.tabs{display:flex;gap:2px;padding:2px;overflow:auto}
.tabs button{padding:0 var(--sp-3);border:0;border-radius:var(--radius-sm);background:none;color:var(--muted);font:inherit;font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap}
.tabs button.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow)}
.search{position:relative;flex:1;min-width:140px;max-width:320px}
.search input{padding-left:28px}
.search::before{content:"⌕";position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:var(--fs-lg)}
.toolbar{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-3)}
.toolbar select{width:auto;min-width:200px;max-width:320px}
.attention{display:flex;align-items:flex-start;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line-soft);cursor:pointer}
.attention:last-child{border-bottom:0}
.attention:hover{background:var(--surface-soft)}
.attention .what{font-weight:600}
.attention .why{font-size:var(--fs-sm);color:var(--muted)}
/* Пока миниатюра не загрузилась (или фото нет) — значок дома вместо пустого серого квадрата. */
.thumb{width:40px;height:30px;border-radius:var(--radius-sm);object-fit:cover;flex:none;background:var(--surface-soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23525d70' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z'/%3E%3C/svg%3E") center/55% no-repeat}
.avatar{width:26px;height:26px;border-radius:50%;background:var(--brand-soft);color:var(--brand-dark);display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.bar-row{display:grid;grid-template-columns:minmax(90px,1fr) 46px;align-items:center;gap:var(--sp-2);padding:var(--sp-1) 0}
.bar{height:7px;border-radius:var(--radius-sm);background:var(--brand-soft);overflow:hidden}
.bar>span{display:block;height:100%;background:var(--brand);border-radius:var(--radius-sm)}
/* График с осями: наибольшее значение и ноль слева, даты снизу, числа над столбцами. */
.chart{display:flex;gap:var(--sp-2);align-items:stretch}
.chart-y{display:flex;flex-direction:column;justify-content:space-between;padding-top:var(--sp-4);min-width:26px;color:var(--muted);font-size:var(--fs-xs);text-align:right}
.chart-plot{flex:1;min-width:0}
.chart-x{display:flex;justify-content:space-between;margin-top:var(--sp-1);color:var(--muted);font-size:var(--fs-xs)}
.chart-x.even span{flex:1;text-align:center}
.spark div>b{position:absolute;left:-4px;right:-4px;text-align:center;color:var(--muted);font-size:var(--fs-xs);font-weight:600;line-height:1}
.spark{display:flex;align-items:flex-end;gap:2px;height:90px;padding-top:var(--sp-4)}
/* Высота столбика задаётся в процентах, поэтому у дорожки должна быть своя
   высота: без неё проценты считались от нуля и график не рисовался никогда. */
.spark div{flex:1;min-width:3px;height:100%;background:var(--brand-soft);border-radius:var(--radius-sm) var(--radius-sm) 0 0;position:relative}
.spark div>i{position:absolute;inset:auto 0 0 0;background:var(--brand);border-radius:var(--radius-sm) var(--radius-sm) 0 0;display:block}
.legend{display:flex;flex-wrap:wrap;gap:var(--sp-1) var(--sp-4);color:var(--muted);margin-top:var(--sp-2)}
.legend b{color:var(--text)}
.legend i{display:inline-block;width:8px;height:8px;border-radius:var(--radius-sm);margin-right:var(--sp-1)}
.list{display:flex;flex-direction:column}
.list-item{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--line-soft)}
.list-item:last-child{border-bottom:0}
.msg{padding:var(--sp-2) var(--sp-3);border-radius:var(--radius);background:var(--surface-soft);border:1px solid var(--line-soft);font-size:var(--fs-sm);white-space:pre-wrap;word-break:break-word}
.msg.out{background:var(--brand-soft);border-color:var(--brand-soft-line)}
.msg.attention{background:var(--warn-soft);border-color:var(--warn-line);color:var(--warn)}
.msg-meta{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);color:var(--muted);margin-top:var(--sp-1)}
.msg-meta>span{min-width:0}
.messenger-toolbar{display:flex;flex-direction:column;gap:var(--sp-2);margin-bottom:var(--sp-3)}
@media(min-width:861px){.messenger-toolbar{flex-direction:row;flex-wrap:wrap;align-items:center;gap:var(--sp-2) var(--sp-4)}}
.messenger-controls{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap}
.messenger-controls .search{max-width:none;min-width:260px;flex:1}
.messenger-controls select{width:auto;min-width:210px}
.messenger-filters{align-self:flex-start;max-width:100%}
.messenger-filter-compact{display:none}
.conversation-back{display:none}
.messenger-shell{display:grid;grid-template-columns:clamp(340px,30vw,440px) minmax(0,1fr);gap:var(--sp-3);align-items:start}
.conversation-list-panel{position:sticky;top:calc(var(--header) + 64px);display:flex;flex-direction:column;max-height:calc(100vh - var(--header) - var(--savebar-h));overflow:hidden}
.conversation-list-panel>header{flex:none}
.conversation-list-panel>header .chip{margin-left:auto}
.conversation-list{overflow:auto;overscroll-behavior:contain}
.conversation-item{width:100%;display:flex;align-items:flex-start;gap:var(--sp-3);padding:var(--row-pad);border:0;border-bottom:1px solid var(--line-soft);background:var(--surface);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.conversation-item:last-child{border-bottom:0}
.conversation-item:hover{background:var(--surface-soft)}
.conversation-item.selected{background:var(--brand-soft);box-shadow:inset var(--edge) 0 var(--brand)}
.conversation-item.unread .conversation-item-top b,.conversation-item.unread .conversation-preview{font-weight:600;color:var(--text)}
.conversation-avatar{position:relative;width:38px;height:38px;border-radius:50%;background:var(--brand-soft);color:var(--brand-dark);display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.conversation-avatar.large{width:42px;height:42px}
.conversation-avatar i{position:absolute;right:0;bottom:0;width:10px;height:10px;border:2px solid var(--surface);border-radius:50%;background:var(--brand)}
.conversation-item-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.conversation-item-top{display:flex;align-items:center;gap:var(--sp-2);min-width:0}
.conversation-item-top b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conversation-item-top time{margin-left:auto;color:var(--muted);font-size:var(--fs-xs);font-weight:400;white-space:nowrap}
.lang-chip{font-size:var(--fs-xs);padding:0 var(--sp-2);flex:none}
.batch-bar{padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line-soft);background:var(--surface-soft);align-items:center}
.batch-mark{flex:none;font-size:var(--fs-lg);line-height:1;color:var(--brand);align-self:center}
.conversation-item.batch-picked{background:var(--brand-soft)}
.conversation-preview{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.conversation-item-meta{display:flex;align-items:center;gap:var(--sp-2);min-width:0;color:var(--muted);font-size:var(--fs-xs)}
.conversation-item-meta>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}
.conversation-state{margin-left:auto;white-space:nowrap}
.conversation-state.ok{color:var(--ok)}.conversation-state.warn{color:var(--warn)}.conversation-state.bad{color:var(--bad)}
/* Дольше суток — самое яркое: жирнее и с точкой-маркером, чтобы отличалось не только цветом. */
.conversation-state.overdue{font-weight:700}.conversation-state.overdue::before{content:"● "}
.chip.overdue{background:var(--bad);border-color:var(--bad);color:var(--surface);font-weight:700}
.week-line{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin:0 0 var(--sp-3);color:var(--muted)}
.week-line:empty{display:none}
.qr-last{white-space:pre-wrap;max-height:8em;overflow:auto}
.client-filter{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);margin:0 0 var(--sp-3)}
.client-filter .search{flex:1 1 220px;min-width:160px}
.messenger-toolbar .client-filter{margin:0}
.trust-review{background:var(--surface-soft)}
.funnel-report{display:flex;flex-direction:column;gap:var(--sp-2)}
.funnel-table th,.funnel-table td{padding:var(--sp-2) var(--sp-2)}
.funnel-table th{white-space:normal}
.source-table td:first-child{white-space:nowrap}
.source-table th{white-space:normal}
@media(max-width:860px){.source-table th,.source-table td{padding:var(--sp-2) var(--sp-2)}}
.source-total td{border-top:1px solid var(--line);font-weight:600}
.week-line-text b{color:var(--text)}
.late-note{color:var(--bad);font-weight:600}
.nav-item .count.late{box-shadow:0 0 0 2px var(--bad-line)}
.messenger-chat{min-width:0}
.conversation-card{min-height:420px;overflow:hidden}
.conversation-head{min-height:65px}
.conversation-person{display:flex;align-items:center;gap:var(--sp-3);min-width:0}
.conversation-person>div{min-width:0}
.conversation-person .small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conversation-body{display:flex;flex-direction:column;gap:var(--sp-3)}
.conversation-context{display:flex;align-items:flex-end;gap:var(--sp-3);padding:var(--sp-3) var(--sp-3);border:1px solid var(--line-soft);border-radius:var(--radius);background:var(--surface-soft)}
.conversation-context-title{margin-top:var(--sp-1);font-weight:600}
.conversation-context .property-link{width:auto;min-width:240px}
/* Карточка просмотра в переписке: дата, состояние и одно действие. */
.viewing-card{--flag:var(--warn);display:flex;flex-direction:column;gap:var(--sp-2);align-items:flex-start;padding:var(--sp-3);border-top:1px solid var(--flag);border-right:1px solid var(--flag);border-bottom:1px solid var(--flag);border-radius:var(--radius);background:var(--surface-soft)}
.viewing-card.confirmed{--flag:var(--ok)}
.viewing-card-head{display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap;width:100%}
.viewing-card-when{font-weight:600}
.conversation-main .viewing-card{flex-direction:row;flex-wrap:wrap;align-items:center;gap:var(--sp-1) var(--sp-3);padding:var(--sp-2) var(--sp-3);border:1px solid var(--line-soft);border-left:var(--edge) solid var(--flag);background:var(--surface-soft)}
.conversation-main .viewing-card-head{width:auto}
/* Экран клиента: переписка слева, сопровождение справа. На узком экране одно
   под другим — иначе на телефоне обе колонки становятся нечитаемыми. */
.conversation-split{display:grid;grid-template-columns:minmax(0,1fr) var(--side);gap:var(--sp-4);align-items:start}
.conversation-main{display:flex;flex-direction:column;gap:var(--sp-3);min-width:0}
.conversation-side{position:sticky;top:var(--sp-3)}
.conversation-side-inner{padding:var(--sp-3)}
.conversation-side .conversation-save{display:flex;flex-direction:column;gap:var(--sp-2);align-items:stretch}
@media (max-width:1180px){.conversation-split{grid-template-columns:minmax(0,1fr)}.conversation-side{position:static}}
@media(min-width:861px){
  .conversation-card{display:flex;flex-direction:column;height:calc(100vh - var(--header) - 140px);min-height:520px}
  .conversation-card>.conversation-split{flex:1 1 auto;min-height:0;align-items:stretch}
  .conversation-card .conversation-main{min-height:0;overflow:auto}
  .conversation-card .conversation-thread{flex:1 1 auto;min-height:96px;max-height:none}
  /* Сжимаем то, что над перепиской: заявка и запись на просмотр — по одной строке, поле ответа не уезжает вниз. */
  .conversation-card .conversation-context{align-items:center;padding:var(--sp-2) var(--sp-3)}
  .conversation-card .conversation-context .field-label{display:none}
  .conversation-card .conversation-context-title{margin-top:0}
  .conversation-card .conversation-context .property-link{min-width:0;padding:var(--sp-1) var(--sp-2)}
  .conversation-card .viewing-card>.small{display:none}
  .conversation-card .reply-box-head{display:none}
  .conversation-card .reply-box{position:sticky;bottom:0}
  .conversation-card .reply-actions>.small{display:none}
  .conversation-card .editor-section>summary{padding:var(--sp-2) var(--sp-3)}
  .conversation-card .conversation-context,.conversation-card .viewing-card,.conversation-card .reply-box{flex:none}
  .conversation-card .reply-box textarea{min-height:56px;height:56px}
  /* Переписке — не меньше четырёх сообщений на экране 1366×800: поле ответа ужато до трёх строк, файл и кнопка-ссылка — в одной полосе. */
  .conversation-card .reply-box{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3)}
  .conversation-card .reply-box>*{margin:0}
  .conversation-card .reply-box>.reply-templates,.conversation-card .reply-box>.reply-quote,.conversation-card .reply-box>.reply-delivery{flex:1 1 100%}
  /* Как в мессенджере: поле и «Отправить» в одной строке, под ними — файл и кнопка-ссылка. */
  .conversation-card .reply-box>textarea{flex:1 1 260px;order:1;min-width:0}
  .conversation-card .reply-box>.reply-actions{order:2;margin-left:0;align-self:stretch;align-items:stretch}
  .conversation-card .reply-box>.reply-actions .btn{height:100%;min-height:56px}
  .conversation-card .reply-box>.reply-attachments{order:3}
  .conversation-card .reply-box>details.editor-section{order:4}
  .conversation-card .reply-box>.reply-delivery{order:5}
  .conversation-card .reply-box>.reply-attachments{flex:0 1 auto}
  .conversation-card .reply-box>.reply-attachments .reply-file-name:not(.has-file){display:none}
  .conversation-card .reply-box>details.editor-section{flex:1 1 0;min-width:200px}
  .conversation-card .reply-box>details.editor-section[open]{flex-basis:100%}
  .conversation-card .reply-box>details.editor-section>summary span{display:none}
  .conversation-card .reply-box>.reply-actions{flex:0 0 auto}
  .conversation-card .conversation-context .property-link{white-space:nowrap;flex:none;min-height:0}
  .conversation-card .conversation-main{gap:var(--sp-2)}
  .conversation-card .conversation-head{min-height:0;padding-top:var(--sp-2);padding-bottom:var(--sp-2)}
  .conversation-card .conversation-avatar.large{width:34px;height:34px}
  .conversation-card .conversation-context{padding:var(--sp-1) var(--sp-3)}
  .conversation-card .conversation-main .viewing-card{padding:var(--sp-1) var(--sp-3)}
  .conversation-card .conversation-thread{padding:var(--sp-2) var(--sp-3);gap:var(--sp-1)}
  .conversation-card .reply-box{padding:var(--sp-2)}
  .conversation-card .reply-box textarea,.conversation-card .reply-box>.reply-actions .btn{min-height:48px;height:48px}
  .conversation-card .reply-box>.reply-actions .btn{height:100%}
  /* Контекст заявки и запись на просмотр — по одной строке. */
  .conversation-card .conversation-context{flex-wrap:nowrap;justify-content:space-between}
  .conversation-card .conversation-context>div:first-child{min-width:0}
  .conversation-card .conversation-context-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .conversation-card .conversation-main .viewing-card{flex-wrap:nowrap;white-space:nowrap}
  .conversation-card .viewing-card-when{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .conversation-card .viewing-card-head{flex-wrap:nowrap;width:auto}
  .conversation-card .viewing-card-head>b{display:none}
  .conversation-card .reply-box>details.editor-section{flex:0 1 auto;min-width:0}
  .conversation-card .reply-box>details.editor-section[open]{flex:1 1 100%}
  .conversation-card .conversation-side{position:static;min-height:0;overflow:auto}
  /* Состояние заявки справа уже есть (в списке слева и в «Статусе»): рядом с именем оно лишнее. */
  .conversation-head .status-in-head{display:none}
}
.conversation-side-toggle,.side-close,.side-backdrop{display:none}
/* Ноутбук и планшет (861–1180): окно диалога — по высоте экрана, поле ответа всегда видно; статус и заметка — справа выезжающей панелью, как на телефоне. */
@media(min-width:861px) and (max-width:1180px){
  .conversation-card .conversation-side-toggle{display:inline-flex}
  .conversation-card .conversation-side{position:fixed;top:var(--header);right:0;bottom:0;z-index:calc(var(--z-popup) + 1);width:min(92vw,400px);margin:0;padding:var(--sp-3);overflow:auto;background:var(--surface);box-shadow:var(--shadow-lg);transform:translateX(105%);transition:transform .2s ease}
  .conversation-card.side-open .conversation-side{transform:none}
  .conversation-card .side-close{display:inline-flex;margin-bottom:var(--sp-2)}
  .conversation-card .side-backdrop{position:fixed;inset:0;z-index:var(--z-popup);background:var(--overlay)}
  .conversation-card.side-open .side-backdrop{display:block}
}
.conversation-thread{display:flex;flex-direction:column;gap:var(--sp-2);min-height:300px;max-height:min(54vh,620px);overflow:auto;padding:var(--sp-3);border:1px solid var(--line-soft);border-radius:var(--radius);background:var(--surface-soft);overscroll-behavior:contain}
.conversation-line{display:flex;justify-content:flex-start}
.conversation-line.out{justify-content:flex-end}
.conversation-line .msg{max-width:88%;min-width:120px;background:var(--surface)}
.conversation-line .msg.out{background:var(--brand-soft)}
.conversation-photo,.conversation-video{display:block;width:100%;max-height:310px;object-fit:contain;border-radius:var(--radius-sm);margin-bottom:var(--sp-2);background:var(--text)}
.conversation-audio{display:block;width:min(320px,100%);margin:var(--sp-1) 0 var(--sp-2)}
.message-kind{font-size:var(--fs-sm);font-weight:700;color:var(--muted);margin-bottom:var(--sp-1)}
.message-text{white-space:pre-wrap}
.message-reactions{display:inline-block;margin-left:var(--sp-2);padding:0px var(--sp-1);border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.message-quote-preview{display:flex;flex-direction:column;gap:0px;margin-bottom:var(--sp-2);padding:var(--sp-2) var(--sp-2);border-left:var(--edge) solid var(--brand);border-radius:var(--radius-sm);background:color-mix(in srgb, var(--surface) 65%, transparent);color:var(--muted);font-size:var(--fs-sm);white-space:normal}
.message-quote-preview span{color:var(--brand-dark);font-size:var(--fs-xs);font-weight:700;text-transform:uppercase;letter-spacing:.02em}
.message-delivery{display:inline-block;margin-left:var(--sp-2);white-space:nowrap}.message-delivery.ok{color:var(--ok)}.message-delivery.bad{color:var(--bad)}
.message-reply-button{flex:none;padding:2px var(--sp-1);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--brand);font:inherit;font-size:var(--fs-xs);cursor:pointer;opacity:0;transition:opacity .15s,background .15s}
.conversation-line:hover .message-reply-button,.message-reply-button:focus-visible{opacity:1}
.message-reply-button:hover{background:var(--brand-soft)}
.reply-box{padding:var(--sp-3)}
.reply-box-head{display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-2)}
.reply-box-head select{width:auto;min-width:220px;margin-left:auto}
.reply-box textarea{min-height:96px;background:var(--surface)}
.reply-quote{display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-2);padding:var(--sp-2) var(--sp-3);border-left:var(--edge) solid var(--brand);border-radius:var(--radius-sm);background:var(--brand-soft)}
.reply-quote>div{display:flex;flex-direction:column;min-width:0}.reply-quote span{font-size:var(--fs-xs);color:var(--brand-dark);font-weight:700}.reply-quote b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);font-weight:400}
.reply-quote-remove{margin-left:auto;padding:0 var(--sp-1);border:0;background:transparent;color:var(--muted);font:inherit;font-size:var(--fs-xl);line-height:1;cursor:pointer}
.reply-attachments{display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-2);min-width:0}
.reply-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reply-delivery{display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-2);padding:var(--sp-2) var(--sp-2);border-radius:var(--radius-sm);background:var(--surface);color:var(--muted)}
.reply-delivery.ok{background:var(--ok-soft);color:var(--ok)}.reply-delivery.bad{background:var(--bad-soft);color:var(--bad)}
.reply-delivery .btn{margin-left:auto}
.reply-actions{display:flex;align-items:center;gap:var(--sp-3);margin-top:var(--sp-2);flex-wrap:wrap}
.followup-fields{align-items:flex-end}
.followup-time{max-width:120px}
.conversation-save{display:flex;align-items:center;gap:var(--sp-2)}
.conversation-save #deleteInq{margin-left:auto}
.property-link{display:flex;align-items:center;gap:var(--sp-2);width:100%;padding:var(--sp-2) var(--sp-3);border:1px solid var(--brand-soft-line);border-radius:var(--radius);background:var(--brand-soft);color:var(--brand-dark);font:inherit;font-size:var(--fs-sm);font-weight:600;cursor:pointer;text-align:left}
.property-link span{margin-left:auto;font-weight:400}
.unread-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 var(--sp-1);border-radius:var(--radius-pill);background:var(--brand);color:var(--surface);font-size:var(--fs-xs);font-weight:700}
.funnel-kpis{margin-bottom:var(--sp-3)}
.funnel-toolbar{display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)}
.funnel-toolbar .search{max-width:460px}
.funnel-toolbar select{width:auto;min-width:210px}
.funnel-toolbar>.small{margin-left:auto;white-space:nowrap}
/* Колонки воронки — по 200 px: семь этапов рядом, без лишней ширины. */
.funnel-board{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--sp-2);padding-bottom:var(--sp-2)}
@media(max-width:1180px){.funnel-board{grid-template-columns:repeat(7,200px);min-width:1480px}}
#viewBody:has(.funnel-board){overflow-x:auto;overscroll-behavior-inline:contain}
.funnel-column{overflow:hidden;border-top:var(--edge) solid var(--muted)}
.funnel-column.stage-contact{border-top-color:var(--brand-soft-line)}.funnel-column.stage-selection{border-top-color:var(--brand)}.funnel-column.stage-viewing{border-top-color:var(--brand-dark)}.funnel-column.stage-negotiation{border-top-color:var(--warn)}.funnel-column.stage-won{border-top-color:var(--live)}.funnel-column.stage-lost{border-top-color:var(--muted)}
.funnel-column>header{display:flex;align-items:flex-start;gap:var(--sp-2);padding:var(--sp-3) var(--sp-3);border-bottom:1px solid var(--line);background:var(--surface)}
.funnel-column>header div{min-width:0;flex:1}
.funnel-column>header span{display:block;margin-top:0px;color:var(--muted);font-size:var(--fs-xs)}
.funnel-column>header>b{display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:23px;padding:0 var(--sp-2);border-radius:var(--radius);background:var(--surface-soft);color:var(--muted)}
.funnel-column-body{display:flex;flex-direction:column;gap:var(--sp-2);min-height:180px;padding:var(--sp-2)}
.funnel-card{padding:var(--sp-2)}
.funnel-card.due{border-color:var(--bad-line);box-shadow:inset var(--edge) 0 var(--bad)}
.funnel-open{width:100%;display:flex;align-items:center;gap:var(--sp-2);padding:0;border:0;background:none;color:var(--text);font:inherit;text-align:left;cursor:pointer}
.funnel-open:hover .funnel-person b{color:var(--brand)}
.funnel-person{display:flex;min-width:0;flex:1;flex-direction:column}
.funnel-person b,.funnel-person small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.funnel-person small{color:var(--muted);font-size:var(--fs-xs)}
.funnel-arrow{display:none}
.funnel-board .conversation-avatar{width:28px;height:28px;flex:none;font-size:var(--fs-xs)}
.funnel-property{margin-top:var(--sp-2);overflow:hidden;color:var(--brand-dark);font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.funnel-signals{display:flex;gap:var(--sp-1);flex-wrap:wrap;margin:var(--sp-2) 0}
.funnel-signals .chip{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.funnel-card{position:relative}
.funnel-move{position:absolute;right:var(--sp-1);bottom:var(--sp-1);min-width:30px;min-height:30px;padding:0}
.funnel-signals{padding-right:32px}
.stage-picker{gap:var(--sp-2)}
.post-preview-column{position:sticky;top:calc(var(--header) + 72px)}
.stage-pick{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left}
.stage-pick span{font-weight:400;color:var(--muted);font-size:var(--fs-xs)}
.funnel-empty{padding:var(--sp-5) var(--sp-2);color:var(--muted);text-align:center}
.task-kpis{margin-bottom:var(--sp-3)}
.task-toolbar{display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-3)}
.task-toolbar>.tabs{max-width:100%}
.task-controls{display:flex;align-items:center;gap:var(--sp-2);margin-left:auto}
.task-controls .search{width:270px}
.task-controls select{width:auto;min-width:190px}
.task-list{display:flex;flex-direction:column;gap:var(--sp-2)}
.task-card{display:flex;align-items:center;gap:var(--sp-3);padding:var(--row-pad)}
.task-card.overdue{--flag:var(--bad)}.task-card.today{--flag:var(--warn)}.task-card.future{--flag:var(--brand)}.task-card.none{--flag:var(--muted)}
.task-main{display:flex;align-items:flex-start;gap:var(--sp-3);min-width:0;flex:1}
.task-copy{min-width:0;flex:1}
.task-copy>.small{margin-top:2px}
.task-property{margin-top:var(--sp-1);color:var(--brand-dark);font-weight:600}
.task-note{max-width:800px;margin-top:var(--sp-2);padding:var(--sp-2) var(--sp-2);border-radius:var(--radius-sm);background:var(--surface-soft);color:var(--muted);white-space:pre-wrap}
.task-actions{display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-2);flex-wrap:wrap}
.client-profile{display:grid;grid-template-columns:var(--side) minmax(0,1fr);gap:var(--sp-4);align-items:start}
.client-profile-side{position:sticky;top:0;display:flex;flex-direction:column;gap:var(--sp-4);padding:var(--sp-4)}
.client-profile-identity{display:flex;align-items:center;gap:var(--sp-3);min-width:0}
.client-profile-identity>div{min-width:0}
.client-profile-identity h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.client-avatar{width:48px;height:48px;font-size:var(--fs-lg)}
.client-facts{display:grid;gap:var(--sp-2);padding:var(--sp-3);border-radius:var(--radius);background:var(--surface)}
.client-facts>div{display:flex;align-items:flex-start;gap:var(--sp-2)}
.client-facts span{color:var(--muted);font-size:var(--fs-sm)}
.client-facts b{margin-left:auto;text-align:right;font-size:var(--fs-sm)}
.client-edit{padding-top:2px}
.client-profile-main{display:flex;min-width:0;flex-direction:column;gap:var(--sp-3)}
.client-message-box>header>.chip{margin-left:auto}
.client-interest-grid{align-items:stretch}
.client-properties{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
.client-property{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-3);border:0;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);background:var(--surface);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.client-property:hover{background:var(--surface-soft)}
.client-property-title{display:flex;min-width:0;flex:1;flex-direction:column}
.client-property-title b,.client-property-title small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.client-property-title small{color:var(--muted);font-size:var(--fs-xs)}
.client-property-price{white-space:nowrap;font-size:var(--fs-sm);font-weight:600}
.client-inquiries{display:flex;flex-direction:column}
.client-inquiry{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-3);border:0;border-bottom:1px solid var(--line-soft);background:var(--surface);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.client-inquiry:hover{background:var(--surface-soft)}
.client-inquiry:last-child{border-bottom:0}
.client-inquiry>span:first-child{display:flex;min-width:0;flex-direction:column}
.client-inquiry small{overflow:hidden;color:var(--muted);font-size:var(--fs-sm);text-overflow:ellipsis;white-space:nowrap}
.client-inquiry time{color:var(--muted);font-size:var(--fs-xs);white-space:nowrap}
.client-inquiry i{color:var(--muted);font-style:normal}
.object-performance{display:flex;flex-direction:row;min-height:30px;gap:var(--sp-2);align-items:center;background:none;border:0;cursor:pointer;color:inherit;font:inherit;padding:2px 0;white-space:nowrap}
.object-performance small{color:var(--muted);font-size:var(--fs-xs)}
.object-performance:hover{background:var(--brand-soft);color:var(--brand-dark)}
.object-performance b{font-size:var(--fs-sm)}
.object-performance small{color:var(--muted);font-size:var(--fs-xs);white-space:nowrap}
.object-insights-head{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3)}
.object-insights-head>img,.object-insights-placeholder{width:90px;height:68px;border-radius:var(--radius);flex:none;object-fit:cover;background:var(--brand-soft)}
.object-insights-placeholder{display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:var(--fs-xl)}
.object-insights-head>div{min-width:0}
.object-insights-head h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.object-insight-kpis{margin:0}
.object-path{display:grid;grid-template-columns:repeat(7,auto);align-items:center;justify-content:space-between;gap:var(--sp-3)}
.object-path>div{display:flex;min-width:120px;flex-direction:column;align-items:center;padding:var(--sp-3);border:1px solid var(--line-soft);border-radius:var(--radius);background:var(--surface-soft);text-align:center}
.object-path b{font-size:var(--fs-xl);color:var(--brand-dark)}
.object-path span{margin-top:2px;color:var(--muted);font-size:var(--fs-xs)}
.object-path i{color:var(--muted);font-style:normal}
.object-signal-summary{margin-top:var(--sp-3)}
.object-client-list{display:flex;flex-direction:column}
.object-client{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-3);border-bottom:1px solid var(--line-soft)}
.object-client:last-child{border-bottom:0}
.object-client:hover{background:var(--surface-soft)}
.object-client-main{display:flex;min-width:0;flex:1;align-items:flex-start;gap:var(--sp-3);padding:0;border:0;background:transparent;color:var(--text);font:inherit;text-align:left;cursor:pointer}
.object-client-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}
.object-client-copy>b,.object-client-copy>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.object-client-copy>small{color:var(--muted);font-size:var(--fs-sm)}
.object-client-copy .chip{font-size:var(--fs-xs)}
/* --- Центр уведомлений ----------------------------------------------------- */
/* --- Календарь просмотров -------------------------------------------------- */
.viewing-kpis{margin-bottom:var(--sp-3)}
.viewing-toolbar{display:flex;align-items:center;gap:var(--sp-3);justify-content:space-between;margin-bottom:var(--sp-3)}
.tabs button>span{display:inline-flex;min-width:18px;justify-content:center;margin-left:var(--sp-1);padding:0 var(--sp-1);border-radius:var(--radius-pill);background:var(--surface-soft);color:var(--muted);font-size:var(--fs-xs)}
.tabs button.active>span{background:var(--brand-soft);color:var(--brand-dark)}
.viewing-toolbar .tabs button span{display:inline-flex;min-width:18px;justify-content:center;margin-left:var(--sp-1);padding:0 var(--sp-1);border-radius:var(--radius-pill);background:var(--warn-soft);color:var(--warn);font-size:var(--fs-xs)}
.viewing-calendar-card{overflow:hidden}
.viewing-calendar-card>header>div:first-child{display:flex;flex-direction:column;gap:2px}
.viewing-week-nav{display:flex;align-items:center;gap:var(--sp-1);margin-left:auto}
.viewing-calendar-shell{overflow:auto;padding:var(--sp-3);overscroll-behavior-x:contain}
.viewing-calendar{display:grid;grid-template-columns:repeat(7,minmax(176px,1fr));gap:var(--sp-2);min-width:1280px}
.viewing-day{min-height:330px;overflow:hidden}
.viewing-day.today{border-color:var(--brand-soft-line);box-shadow:inset 0 var(--edge) var(--brand)}
.viewing-day-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0px var(--sp-2);padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line);background:var(--surface)}
.viewing-day-head span{color:var(--muted);font-size:var(--fs-xs);font-weight:700;text-transform:uppercase}
.viewing-day-head b{grid-column:1}
.viewing-day-head i{grid-column:2;grid-row:1/3;align-self:center;min-width:23px;padding:2px var(--sp-2);border-radius:var(--radius);background:var(--surface-soft);color:var(--muted);font-size:var(--fs-xs);font-style:normal;text-align:center}
.viewing-day.today .viewing-day-head i{background:var(--brand-soft);color:var(--brand-dark)}
.viewing-day-body{display:flex;flex-direction:column;gap:var(--sp-2);padding:var(--sp-2)}
.viewing-day-empty{padding:var(--sp-5) var(--sp-1);color:var(--muted);text-align:center}
.viewing-event{display:flex;min-width:0;flex-direction:column;gap:var(--sp-1);padding:var(--sp-2);border-left:var(--edge) solid var(--brand);box-shadow:var(--shadow)}
.viewing-event.pending{border-left-color:var(--warn)}
.viewing-event.past,.viewing-event.cancelled{border-left-color:var(--line)}
.viewing-event-head{display:flex;align-items:center;gap:var(--sp-2);justify-content:space-between}
.viewing-event-head .chip{max-width:110px;overflow:hidden;text-overflow:ellipsis}
.viewing-event-time{white-space:nowrap}
.viewing-event-client{overflow:hidden;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.viewing-event-property{display:-webkit-box;overflow:hidden;color:var(--muted);line-height:var(--lh-tight);-webkit-box-orient:vertical;-webkit-line-clamp:2}
.viewing-event-actions{display:flex;align-items:center;gap:2px;margin:2px calc(var(--sp-1) * -1) calc(var(--sp-1) * -1)}
.viewing-event-actions .btn{min-width:0;flex:1;padding-left:var(--sp-1);padding-right:var(--sp-1)}
.viewing-unscheduled{margin-top:var(--sp-3)}
.viewing-unscheduled-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-2);padding:var(--sp-3)}
.viewing-pending-list{display:flex;flex-direction:column;gap:var(--sp-2)}
.viewing-pending-card{display:flex;align-items:center;gap:var(--sp-4);padding:var(--row-pad)}
.viewing-pending-card>div:first-child{display:grid;min-width:0;flex:1;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:2px var(--sp-2)}
.viewing-pending-card h3{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viewing-pending-card p,.viewing-pending-card small{grid-column:2;overflow:hidden;color:var(--muted);text-overflow:ellipsis;white-space:nowrap}
.viewing-pending-card small{font-size:var(--fs-sm)}
.viewing-pending-actions{display:flex;align-items:center;gap:var(--sp-2);flex:none}
.viewing-history{display:flex;flex-direction:column}
.viewing-history-row{display:grid;grid-template-columns:130px minmax(0,1fr);gap:var(--sp-3);padding:var(--sp-3) var(--sp-3);border-bottom:1px solid var(--line-soft)}
.viewing-history-row:last-child{border-bottom:0}
.viewing-history-date{display:flex;flex-direction:column;padding:var(--sp-2) var(--sp-1)}
.viewing-history-date span{color:var(--muted);font-size:var(--fs-sm)}
.viewing-history-row .viewing-event{display:grid;grid-template-columns:150px minmax(140px,1fr) minmax(180px,2fr) auto;align-items:center;gap:var(--sp-2);border:0;box-shadow:none;padding:var(--sp-2) var(--sp-2)}
.viewing-history-row .viewing-event-head{justify-content:flex-start}
.viewing-history-row .viewing-event-actions{margin:0}
.viewing-dialog-context{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-3);border:1px solid var(--line-soft);border-radius:var(--radius);background:var(--surface-soft)}
.viewing-dialog-context>div{display:flex;min-width:0;flex-direction:column}
.viewing-dialog-context span:last-child{overflow:hidden;color:var(--muted);font-size:var(--fs-sm);text-overflow:ellipsis;white-space:nowrap}
/* Предпросмотр сообщения так, как его покажет Telegram */
.tg-preview{background:var(--line);padding:var(--sp-3);border-radius:var(--radius);display:flex;flex-direction:column;gap:var(--sp-2);align-items:flex-start}
.tg-bubble{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;max-width:min(420px,100%);width:100%}
.tg-bubble img{display:block;width:100%;height:auto}
.tg-text{padding:var(--sp-2) var(--sp-3);line-height:var(--lh);white-space:pre-wrap;word-break:break-word}
.tg-text a{color:var(--brand)}
.tg-quote{border-left:var(--edge) solid var(--brand);padding-left:var(--sp-2);margin-top:var(--sp-2);color:var(--text)}
.tg-buttons{display:grid;gap:2px;margin-top:2px;width:100%;max-width:min(420px,100%)}
.tg-buttons .row{gap:2px}
.tg-button{flex:1;text-align:center;padding:var(--sp-2) var(--sp-2);border-radius:var(--radius);background:var(--surface);color:var(--brand);box-shadow:var(--shadow);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tg-note{color:var(--muted)}
.tg-text blockquote{margin:0;padding-left:var(--sp-2);border-left:var(--edge) solid var(--brand)}
/* Раскрывающаяся цитата Telegram: видны первые строки, остальное — по нажатию. */
.tg-text blockquote.expandable{position:relative;max-height:5em;overflow:hidden;cursor:pointer}
.tg-text blockquote.expandable:not(.expanded)::after{content:"Показать полностью";position:absolute;right:0;bottom:0;padding-left:var(--sp-3);background:var(--surface);color:var(--brand);font-size:var(--fs-xs)}
.tg-text blockquote.expandable.expanded{max-height:none}
.tg-album{display:grid;gap:2px}
.tg-album[data-count="1"]{grid-template-columns:minmax(0,1fr)}
.tg-album:not([data-count="1"]){grid-template-columns:repeat(2,minmax(0,1fr))}
.tg-album[data-count="3"] .tg-album-cell:first-child{grid-column:1 / -1}
.tg-album-cell{position:relative;display:block;aspect-ratio:4 / 3;overflow:hidden;background:var(--line)}
.tg-bubble .tg-album-cell img{width:100%;height:100%;object-fit:cover}
.tg-album-more{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--glass);color:var(--surface);font-size:var(--fs-xl);font-weight:600}
/* Публикация объявления в группы: слева — куда, справа — что получат подписчики. */
.listing-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,400px);gap:var(--sp-4);align-items:start}
.listing-targets{display:flex;flex-direction:column;gap:var(--sp-2)}
.listing-target{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2) var(--sp-3);padding:var(--sp-2) var(--sp-3);border:1px solid var(--line-soft);border-radius:var(--radius);background:var(--surface-soft)}
.listing-target.is-blocked{opacity:.75}
.listing-pick{display:flex;align-items:center;gap:var(--sp-2);flex:1 1 200px;min-width:0;cursor:pointer}
.listing-pick>span{display:flex;flex-direction:column;min-width:0}
.listing-opts{display:flex;flex-wrap:wrap;gap:var(--sp-2)}
.listing-opts select{width:auto;min-width:0;max-width:100%}
.listing-done{flex:1 1 100%}
.listing-target.is-forum .listing-pick{cursor:default}
.listing-topics{flex:1 1 100%;display:flex;flex-direction:column;gap:var(--sp-1);padding-left:var(--sp-3);border-left:var(--edge) solid var(--line)}
.listing-topic{display:flex;align-items:center;gap:var(--sp-2);min-height:28px;cursor:pointer}
.listing-add{flex:1 1 100%}
.listing-add>summary{cursor:pointer;color:var(--brand);font-size:var(--fs-sm)}
.listing-add[open]>summary{margin-bottom:var(--sp-2)}
.listing-preview-col{position:sticky;top:0;min-width:0}
.listing-seg{display:inline-flex;gap:var(--sp-1)}
.listing-seg .btn.active{border-color:var(--brand);background:var(--brand-soft);color:var(--brand-dark)}
.listing-result{padding:var(--sp-2) var(--sp-3);border-left:var(--edge) solid var(--line);background:var(--surface-soft)}
.listing-result.ok{border-left-color:var(--ok)}
.listing-result.bad{border-left-color:var(--bad)}
@media(max-width:860px){.listing-layout{grid-template-columns:minmax(0,1fr)}.listing-preview-col{position:static}}
.markup-bar{gap:2px;padding:var(--sp-1)}
.markup-bar .btn{padding:2px var(--sp-2);min-width:30px}
code{padding:0px var(--sp-1);border-radius:var(--radius-sm);background:var(--surface-soft);border:1px solid var(--line);font-size:var(--fs-sm)}

/* --- Панель сохранения, тосты, диалоги -------------------------------------- */
/* Полосы и тост — одна основа: строка с отступами, скруглением и тенью; закреплённые — поверх страницы.
   У каждой свой цвет и место (снизу — сохранить и обновить, сверху — беда, справа снизу — тост). */
.savebar,.refresh-hint,.save-alert,.link-alert{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4)}
.savebar,.refresh-hint,.save-alert,.toast{position:fixed;border-radius:var(--radius);box-shadow:var(--shadow-lg)}
.savebar,.refresh-hint{left:var(--gutter);right:var(--gutter);bottom:16px;z-index:var(--z-bar)}
.refresh-hint{z-index:calc(var(--z-bar) - 1);background:var(--surface);border:1px solid var(--line)}
.savebar{background:var(--text);color:var(--surface)}
.savebar .btn.secondary{background:transparent;color:var(--surface);border-color:color-mix(in srgb, var(--surface) 30%, transparent)}
.savebar .btn.secondary:hover{background:color-mix(in srgb, var(--surface) 14%, transparent)}
.gap-bottom{margin-bottom:var(--sp-3)}
.gap-top{margin-top:var(--sp-2)}
.gap-top-sm{margin-top:var(--sp-1)}
.gap-top-lg{margin-top:var(--sp-3)}
.warn-text{color:var(--warn)}
.ok-text{color:var(--ok)}
.bad-text{color:var(--bad)}
.field-error{margin-top:var(--sp-1);color:var(--bad);font-size:var(--fs-sm)}
[aria-invalid="true"]{border-color:var(--bad)}
.legend i.brand-dot{background:var(--brand)}
.thumb-sm{width:74px;height:52px}
.thumb-xs{width:52px}
.thumb-md{width:130px;height:90px}
.thumb-preview{width:120px;height:auto;border-radius:var(--radius-sm)}
.field-xs{max-width:140px}
.field-sm{max-width:170px}
.field-md{max-width:200px}
.field-lg{max-width:220px}
.field-xl{max-width:260px}
.area-sm{min-height:110px}
.area-md{min-height:130px}
.area-lg{min-height:150px}
.pad-sm{padding:var(--sp-1) var(--sp-3)}
.flat{border:0;box-shadow:none}
.divided{border-top:1px solid var(--line-soft);padding-top:var(--sp-2)}
.inline-flex{display:inline-flex}
.clickable-area{cursor:pointer}
.start{align-items:flex-start}
.switch-inline{width:34px;height:24px;padding:0;vertical-align:middle}
.chip-inline{width:auto;display:inline-block;padding:2px var(--sp-2)}
/* Неделя одной страницей: плитки с числом и сравнением. */
.week-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--sp-3)}
.week-subtitle{margin-bottom:var(--sp-2);color:var(--muted);font-weight:600}
.today-numbers{display:flex;flex-wrap:wrap;gap:var(--sp-2) var(--sp-5);margin-bottom:var(--sp-3);padding:var(--sp-3) var(--sp-4);color:var(--muted)}
.today-numbers b{font-size:var(--fs-lg);color:var(--text)}
.today-numbers b.bad{color:var(--bad)}
.deeds{display:flex;flex-direction:column}
.deed.done{opacity:.85}
.deed{display:flex;align-items:flex-start;gap:var(--sp-3);padding:var(--row-pad);border-top:1px solid var(--line-soft)}
.deed:first-child{border-top:0}
.deed[data-deed-row]{cursor:pointer}
.deed[data-deed-row]:hover{background:var(--surface-soft)}
.deed-icon{flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius);background:var(--surface-soft);color:var(--muted)}
.deed.urgent .deed-icon{background:var(--bad-soft);color:var(--bad)}
.deed-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.deed-body span{color:var(--muted);overflow-wrap:anywhere}
.deed-body .deed-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);color:inherit}
.deed-head b{color:var(--text)}
.deed-actions{flex:none;display:flex;align-items:center;gap:var(--sp-2)}
@media (max-width:860px){.deed{align-items:center}.deed-body{flex:1 1 0}.deed-actions{gap:var(--sp-1)}
  /* Строка с перепиской на телефоне нажимается целиком; кнопка «Ответить» только съедала ширину и растягивала дело до 150 px. */
  .deed[data-deed-row] .deed-actions [data-deed]{display:none}}
/* Панель не достаёт до бота: красная полоса над шапкой, на любом экране; когда страницу
   прокрутили, о том же говорит точка состояния в шапке. */
.link-alert{position:relative;z-index:var(--z-toast);background:var(--bad);color:var(--surface)}
.link-alert>div{display:flex;flex-direction:column;gap:2px;min-width:0}
/* Выше шапки: раньше лежала под ней, и главное предупреждение — «данные не сохраняются» — не было видно. */
.save-alert{top:14px;left:var(--gutter);right:var(--gutter);z-index:var(--z-toast);flex-direction:column;align-items:stretch;gap:2px;background:var(--bad-soft);border:1px solid var(--bad);color:var(--bad)}
@media (max-width:860px){.save-alert{top:8px}}
.toast{right:var(--gutter);bottom:18px;z-index:var(--z-toast);padding:var(--sp-3) var(--sp-4);background:var(--text);color:var(--surface);max-width:380px}
.toast.bad{background:var(--bad)}
.quick-times{display:flex;gap:var(--sp-2);margin-top:var(--sp-2)}
.toast-action{margin-left:var(--sp-2);padding:2px var(--sp-3);border:1px solid color-mix(in srgb, var(--surface) 55%, transparent);border-radius:var(--radius-sm);background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
dialog{border:0;border-radius:var(--radius);padding:0;background:var(--surface);box-shadow:var(--shadow-lg);max-width:min(720px,calc(100vw - 32px));width:100%}
dialog::backdrop{background:var(--overlay)}
.dialog-head{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-soft)}
.dialog-body{padding:var(--sp-4);max-height:min(70vh,640px);overflow:auto}
.dialog-foot{display:flex;gap:var(--sp-2);justify-content:flex-end;padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--line-soft);background:var(--surface-soft);border-radius:0 0 var(--radius) var(--radius)}
.drawer{position:fixed;inset:0 0 0 auto;width:min(560px,100vw);max-width:none;height:100vh;max-height:100vh;border-radius:0;display:flex;flex-direction:column}
.drawer.wide{width:min(1040px,100vw)}
.drawer .dialog-body{flex:1;max-height:none}
.editor-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--side);gap:var(--sp-4);align-items:start}
.editor-form{min-width:0}
.editor-language{position:sticky;top:-16px;z-index:4;margin:calc(var(--sp-4) * -1) -2px 0;padding:var(--sp-4) 2px var(--sp-3);background:linear-gradient(var(--surface) 82%,transparent)}
.editor-language .hint{margin-left:auto;text-align:right}
.editor-section{overflow:hidden}
.editor-section>summary{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-3);list-style:none;cursor:pointer;background:var(--surface-soft);user-select:none}
.editor-section>summary::-webkit-details-marker{display:none}
.editor-section>summary::after{content:"⌄";margin-left:auto;color:var(--muted);font-size:var(--fs-sm);transition:transform .15s}
.editor-section[open]>summary::after{transform:rotate(180deg)}
.editor-section>summary span{color:var(--muted);font-weight:400}
.editor-section-body{padding:var(--sp-3)}
.editor-preview-panel{position:sticky;top:0;padding:var(--sp-3)}
.editor-preview-head{display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-2)}
.editor-preview-head span{margin-left:auto;color:var(--muted)}
.editor-preview-panel .tg-preview{min-height:180px;padding:var(--sp-3)}
.editor-preview-empty{display:flex;min-height:130px;align-items:center;justify-content:center;padding:var(--sp-4);color:var(--muted);font-size:var(--fs-sm);text-align:center}
.image-list{display:flex;flex-wrap:wrap;gap:var(--sp-2);min-height:4px;margin-bottom:var(--sp-2)}
.media-thumb{position:relative;display:block;width:86px;height:64px;border-radius:var(--radius-sm);overflow:hidden;background:var(--surface-soft);border:1px solid var(--line)}
.media-thumb img{width:100%;height:100%;display:block;object-fit:cover}
.media-thumb .media-remove{position:absolute;right:3px;top:3px;width:23px;height:23px;min-height:0;padding:0;border:0;border-radius:50%;background:var(--glass);color:var(--surface);line-height:23px}
.image-upload-row{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap}
.file-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.recipient-summary{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);border-radius:var(--radius);background:var(--brand-soft);color:var(--brand-dark)}
.recipient-summary>div{display:flex;min-width:0;flex-direction:column;gap:2px}
.recipient-summary b{font-size:var(--fs-sm)}
.recipient-summary small{overflow:hidden;color:var(--muted);font-size:var(--fs-xs);text-overflow:ellipsis;white-space:nowrap}
.required{color:var(--bad);font-weight:700}
.publication-check{border:1px solid var(--warn-line);border-radius:var(--radius);background:var(--warn-soft);overflow:hidden}
.publication-check.is-ready{border-color:var(--ok-line);background:var(--ok-soft)}
.publication-check.is-ready .publication-head{border-bottom-color:var(--ok-line)}
.publication-head{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-3);border-bottom:1px solid var(--warn-soft)}
.publication-head>div{display:flex;flex-direction:column;min-width:0}
.publication-head>div span{font-size:var(--fs-sm);color:var(--muted)}
.publication-head>.chip{margin-left:auto;white-space:nowrap}
.publication-details>summary{padding:var(--sp-2) var(--sp-3);cursor:pointer;font-size:var(--fs-sm);font-weight:600}
.publication-ready{padding:var(--sp-2) var(--sp-3);font-size:var(--fs-sm)}
.publish-why{align-self:center;max-width:100%}
.publication-rows{padding:var(--sp-1) var(--sp-3)}
.publication-row{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-1) 0;border-bottom:1px solid var(--warn-soft);font-size:var(--fs-sm)}
.publication-row:last-child{border-bottom:0}
.publication-row>b{width:22px;color:var(--brand-dark)}
.publication-row .warn-text{max-width:62%;color:var(--warn);text-align:right}
.publication-row .ok-text{color:var(--ok)}
.publication-actions{display:flex;gap:var(--sp-3);align-items:center;flex-wrap:wrap;margin-top:var(--sp-2)}

/* --- Вход ------------------------------------------------------------------- */
.auth{position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-4);padding:var(--sp-5);background:var(--bg) url(/login-assets/background.webp) center/cover no-repeat}
.auth-card{position:relative;width:min(440px,100%);box-shadow:var(--shadow-lg);padding:var(--sp-5) calc(var(--sp-5) * 1.5) calc(var(--sp-5) * 1.5);text-align:center}
.auth-card .auth-logo{display:block;width:min(200px,60%);height:auto;margin:0 auto var(--sp-4)}
.auth-card h1{font-size:var(--fs-display);margin-bottom:var(--sp-2)}
.auth-lead{color:var(--muted);margin:0 auto;max-width:32ch}
.auth-card .stack{margin-top:var(--sp-5);text-align:left}
.auth-card .btn{width:100%;min-height:48px;justify-content:center}
.auth-card .field{margin:0}
/* Поле пароля: замок слева, «показать» справа; подпись для чтения с экрана — невидимая. */
.auth-password{position:relative}
.auth-password input{padding-left:calc(var(--sp-5) * 1.6);padding-right:calc(var(--sp-5) * 1.8);min-height:48px}
.auth-password .auth-lock{position:absolute;left:var(--sp-3);top:50%;width:20px;height:20px;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.auth-reveal{position:absolute;right:var(--sp-1);top:50%;width:40px;height:40px;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--radius-sm);background:none;color:var(--muted);cursor:pointer}
.auth-reveal:hover{color:var(--text)}
.auth-reveal svg{width:20px;height:20px}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
/* Надписи с эталона на фоне: слева девиз, справа сверху слоган; внизу подпись. На узком экране остаются карточка и подпись. */
.auth-motto{position:absolute;left:6%;top:50%;transform:translateY(-50%);margin:0;max-width:13ch;color:var(--muted);font-size:clamp(26px,2.4vw,36px);font-weight:400;line-height:var(--lh-tight)}
.auth-motto::after,.auth-slogan::after{content:"";display:block;width:44px;height:2px;margin-top:var(--sp-4);background:var(--field-line)}
.auth-slogan{position:absolute;right:5%;top:8%;margin:0;max-width:16ch;color:var(--muted);font-size:var(--fs-xs);font-weight:400;letter-spacing:.28em;line-height:var(--lh-loose);text-transform:uppercase}
.auth-foot{position:relative;margin:0;max-width:60ch;text-align:center;color:var(--muted);font-size:var(--fs-xs);line-height:var(--lh-loose)}
@media(max-width:1180px){.auth-motto,.auth-slogan{display:none}}

@media(max-width:1180px){.split{grid-template-columns:minmax(0,1fr)}.cols-4{grid-template-columns:repeat(2,minmax(0,1fr))}.messenger-shell{grid-template-columns:var(--side) minmax(0,1fr)}}
@media(max-width:860px){
  :root{--header:58px;--gutter:12px}
  .app-head{padding:var(--sp-2) var(--sp-3);gap:var(--sp-2)}
  .app-brand{padding:0}
  .app-brand img{height:38px;max-width:44px}
  .app-brand b{font-size:var(--fs-sm)}
  .head-tools .state-line{padding:var(--sp-2);background:transparent}
  .head-tools #botStateText{display:none}
  .head-tools #logoutBtn{display:none}
  .head-nav{display:none;position:fixed;left:var(--gutter);right:var(--gutter);top:calc(var(--header) + 6px);max-height:calc(100vh - var(--header) - 18px);overflow:auto;padding:var(--sp-2);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg)}
  .head-nav.open{display:block}
  .head-nav>.nav-item{width:100%;padding:var(--sp-3)}
  .page{padding:var(--sp-4) var(--sp-4) var(--savebar-h)}
  /* Верхняя полоса на телефоне переносится: две кнопки действий («Рассылка» и
     «Пост в канал») рядом не помещаются в 375 px и растягивали всю страницу —
     а вместе с ней и выдвижные окна, которые «уезжали» вправо. */
  .topbar{padding:var(--sp-3) var(--sp-4);flex-wrap:wrap}
  .topbar #pageActions{flex-wrap:nowrap;width:100%;overflow-x:auto;scrollbar-width:none}
  .topbar #pageActions .btn{flex:0 0 auto}

  .cols-3,.cols-2{grid-template-columns:minmax(0,1fr)}
  .drawer,.drawer.wide{left:0;right:0;width:100%;max-width:100%}
  .editor-layout{grid-template-columns:minmax(0,1fr)}
  .editor-preview-panel{position:static}
  .editor-language{top:-16px}
  .messenger-controls>*{width:100%}
  .messenger-controls .search,.messenger-controls select{min-width:0;max-width:none;width:100%}
  .messenger-filters{width:100%}
  .messenger-shell{grid-template-columns:minmax(0,1fr)}
  /* Телефон: либо список, либо переписка — целым экраном, с возвратом. */
  .messenger-shell.chat-open .conversation-list-panel{display:none}
  .messenger-shell:not(.chat-open) .messenger-chat{display:none}
  .conversation-back{display:inline-flex}
  .messenger-filters{display:none}
  .messenger-filter-compact{display:block;width:100%}
  .conversation-list-panel{position:static;max-height:none}
  .conversation-context{align-items:stretch;flex-direction:column}
  .conversation-context .property-link{width:100%;min-width:0}
  .reply-box-head{align-items:stretch;flex-direction:column}
  .reply-box-head select{width:100%;min-width:0;margin-left:0}
  .message-reply-button{opacity:1}
  .reply-attachments{align-items:flex-start;flex-wrap:wrap}
  .reply-file-name{order:3;width:100%;white-space:normal}
  .reply-delivery{align-items:flex-start;flex-wrap:wrap}
  .reply-delivery .btn{margin-left:0}
  .conversation-thread{min-height:260px;max-height:55vh}
  .conversation-save{flex-wrap:wrap}
  .conversation-save #deleteInq{margin-left:0}
  .funnel-toolbar{align-items:stretch;flex-direction:column}
  .funnel-toolbar .search,.funnel-toolbar select{width:100%;max-width:none;min-width:0}
  .funnel-toolbar>.small{margin-left:0}
  .task-toolbar{align-items:stretch;flex-direction:column}
  .task-toolbar>.tabs{width:100%}
  .task-controls{width:100%;margin-left:0;flex-direction:column}
  .task-controls .search,.task-controls select{width:100%;max-width:none;min-width:0}
  .task-card{align-items:stretch;flex-direction:column}
  .task-actions{justify-content:flex-start}
  .client-profile{grid-template-columns:minmax(0,1fr)}
  .client-profile-side{position:static}
  .client-properties{grid-template-columns:minmax(0,1fr)}
  .client-inquiry{grid-template-columns:minmax(0,1fr) auto}
  .client-inquiry time,.client-inquiry i{display:none}
  .client-interest-grid{grid-template-columns:minmax(0,1fr)}
  .object-path{grid-template-columns:minmax(0,1fr)}
  .object-path i{transform:rotate(90deg);text-align:center}
  .object-path>div{min-width:0}
  .object-client{align-items:flex-start;flex-direction:column}
  .viewing-toolbar{align-items:stretch;flex-direction:column}
  .viewing-toolbar>.small{padding-left:var(--sp-1)}
  .viewing-calendar{grid-template-columns:repeat(7,220px);min-width:1588px}
  .viewing-unscheduled-grid{grid-template-columns:minmax(0,1fr)}
  .viewing-pending-card{align-items:stretch;flex-direction:column}
  .viewing-pending-actions{width:100%;flex-wrap:wrap}
  .viewing-pending-actions .btn{flex:1}
  .viewing-history-row{grid-template-columns:minmax(0,1fr)}
  .viewing-history-date{padding-bottom:0}
  .viewing-history-row .viewing-event{display:flex;align-items:stretch}
}
@media(min-width:861px){.conversation-side-details>summary{display:none}}
.conversation-side-details>summary{list-style:none;cursor:pointer;padding:var(--sp-3) var(--sp-4);font-weight:600}
.conversation-side-details>summary::-webkit-details-marker{display:none}
.conversation-side-details[open]>summary{border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom:0}
/* Нижняя панель разделов — только на телефоне. */
.tabbar,.more-sheet{display:none}
@media(max-width:860px){
  .head-nav{display:none !important}
  /* На телефоне поиск — значок 🔍 в шапке; поле раскрывается под ней. */
  .btn.search-toggle{display:inline-flex}
  .global-search{display:none;position:fixed;left:var(--gutter);right:var(--gutter);top:calc(var(--header) + 6px);z-index:var(--z-toast);max-width:none;padding:var(--sp-2);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg)}
  .global-search.open{display:block}
  .global-results{position:static;margin-top:var(--sp-2);box-shadow:none;border:0;min-width:0;max-height:60vh}
  .tabbar{position:fixed;left:0;right:0;bottom:0;z-index:var(--z-head);display:flex;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -2px 10px rgba(var(--ink-rgb),.06);padding-bottom:env(safe-area-inset-bottom)}
  .tab{position:relative;flex:1 1 0;min-width:0;min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:var(--sp-2) 2px;border:0;background:none;color:var(--muted);font:inherit;font-size:var(--fs-xs);cursor:pointer}
  .tab-ico{display:inline-flex;width:24px;height:24px;line-height:1}
  .tab-title{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tab.active{color:var(--brand-dark);font-weight:600}
  .tab.active::before{content:"";position:absolute;top:0;left:22%;right:22%;height:3px;border-radius:0 0 var(--radius-sm) var(--radius-sm);background:var(--brand)}
  .tab-count{position:absolute;top:4px;left:calc(50% + 6px);min-width:18px;padding:0 var(--sp-1);border-radius:var(--radius-pill);background:var(--bad);color:var(--surface);font-size:var(--fs-xs);font-weight:700;text-align:center}
  .more-sheet{position:fixed;left:var(--gutter);right:var(--gutter);bottom:calc(64px + env(safe-area-inset-bottom));z-index:calc(var(--z-head) + 1);display:block;padding:var(--sp-2);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg)}
  .more-sheet.hidden{display:none}
  /* Пока лист «Ещё» открыт, остальной экран затемнён; нажатие по затемнению закрывает лист. */
  body:has(.more-sheet:not(.hidden))::after{content:"";position:fixed;inset:0;z-index:var(--z-head);background:var(--overlay)}
  .more-item{display:flex;align-items:center;gap:var(--sp-3);width:100%;min-height:48px;padding:var(--sp-3) var(--sp-3);border:0;border-radius:var(--radius);background:none;color:var(--text);font:inherit;text-align:left;cursor:pointer}
  .more-item.active{background:var(--brand-soft);color:var(--brand-dark);font-weight:600}
  .more-item .ico{display:inline-flex;width:22px;height:22px;justify-content:center}
  /* Всё, что висит над экраном, поднимаем выше нижней панели. */
  .page{padding-bottom:calc(var(--savebar-h) + env(safe-area-inset-bottom))}
  .savebar,.refresh-hint{bottom:calc(66px + env(safe-area-inset-bottom))}
  .toast{bottom:calc(72px + env(safe-area-inset-bottom));right:var(--gutter);left:var(--gutter);max-width:none}
  /* Шапка страницы уезжает вместе с прокруткой: липкая, она съедала пятую часть экрана. */
  .topbar{position:static}
  /* Открытый диалог — целый экран: заголовок, вкладки раздела и фильтры скрыты. */
  .phone-chat .topbar,.phone-chat .page>.toolbar,.phone-chat .messenger-toolbar{display:none}
  .phone-chat .page{padding-top:var(--sp-2)}
  /* Диалог на телефоне — экран мессенджера: страница не прокручивается, переписка
     занимает всё свободное место и прокручивается сама, поле ответа — под ней. */
  .phone-chat .page{padding:0 var(--sp-2) calc(var(--tabbar-h) + var(--sp-4) + env(safe-area-inset-bottom))}
  .phone-chat .conversation-card{display:flex;flex-direction:column;height:calc(100dvh - var(--header) - var(--tabbar-h) - var(--sp-5) - env(safe-area-inset-bottom));min-height:0}
  .phone-chat .conversation-card>.conversation-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:var(--sp-2)}
  .phone-chat .conversation-head{flex:none;flex-wrap:wrap}
  .phone-chat .conversation-main{flex:1 1 auto;min-height:0}
  .phone-chat .conversation-thread{flex:1 1 auto;min-height:120px;max-height:none}
  .phone-chat .conversation-context,.phone-chat .reply-box{flex:none}
  /* Поле ответа на телефоне — компактное: без заголовка, без пояснений; кнопка во всю ширину. */
  .phone-chat .reply-box{padding:var(--sp-2)}
  .phone-chat .reply-box-head{display:none}
  .phone-chat #replyText{min-height:64px;height:64px}
  .phone-chat .reply-attachments{margin:var(--sp-1) 0}
  .phone-chat .reply-file-name,.phone-chat .reply-actions .muted{display:none}
  .phone-chat .reply-box .editor-section>summary{padding:var(--sp-2) var(--sp-3)}
  /* Переписке — не меньше трёх сообщений: шапка, заявка и запись на просмотр — по одной-две строки, поле и «Отправить» — рядом. */
  .phone-chat .conversation-head{padding:var(--sp-1) var(--sp-2);gap:var(--sp-1) var(--sp-2);min-height:0}
  .phone-chat .conversation-avatar.large{display:none}
  .phone-chat .conversation-head h3{font-size:var(--fs-lg)}
  .phone-chat .conversation-main{gap:var(--sp-1)}
  .phone-chat .conversation-context{flex-direction:row;align-items:center;flex-wrap:nowrap;justify-content:space-between;gap:var(--sp-2);padding:var(--sp-1) var(--sp-2)}
  .phone-chat .conversation-context>div:first-child{min-width:0}
  .phone-chat .conversation-context .field-label{display:none}
  .phone-chat .conversation-context-title{margin-top:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .phone-chat .conversation-context .property-link{width:auto;flex:none;min-height:0;min-width:0;max-width:40%;padding:var(--sp-1) var(--sp-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .phone-chat .conversation-context .property-link>span:last-child{display:none}
  .phone-chat .conversation-main .viewing-card{padding:var(--sp-1) var(--sp-2);gap:var(--sp-1) var(--sp-2)}
  .phone-chat .viewing-card>.small{display:none}
  .phone-chat .viewing-card-when{flex:1 1 100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .phone-chat .conversation-thread{padding:var(--sp-2);gap:var(--sp-1)}
  .phone-chat .reply-box{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-1) var(--sp-2)}
  .phone-chat .reply-box>*{margin:0}
  .phone-chat .reply-box>.reply-quote{flex:1 1 100%}
  .phone-chat .reply-box>textarea{flex:1 1 0;order:1;min-width:0;min-height:48px;height:48px}
  .phone-chat .reply-box>.reply-actions{order:2;flex:0 0 auto}
  .phone-chat .reply-box>.reply-actions .btn{min-height:48px;height:48px;width:auto}
  .phone-chat .reply-box>.reply-attachments{order:3;flex:0 0 auto}
  .phone-chat .reply-box>details.editor-section{order:4;flex:1 1 0;min-width:0}
  .phone-chat .reply-box>details.editor-section[open]{flex-basis:100%}
  .phone-chat .reply-box>details.editor-section>summary span{display:none}
  .phone-chat .reply-box>.reply-delivery{order:5;flex:1 1 100%}
  .conversation-thread{max-height:42vh}
  .conversation-side-toggle{display:inline-flex}
  /* Статус, этап, заметка и следующий шаг — панель, выезжающая справа. */
  .conversation-side{position:fixed;top:0;right:0;bottom:0;z-index:calc(var(--z-popup) + 1);width:min(92vw,400px);margin:0;padding:calc(8px + env(safe-area-inset-top)) var(--sp-3) calc(var(--tabbar-h) + var(--sp-5) + env(safe-area-inset-bottom));overflow:auto;background:var(--surface);box-shadow:var(--shadow-lg);transform:translateX(105%);transition:transform .2s ease}
  .side-open .conversation-side{transform:none}
  .side-close{display:inline-flex;margin-bottom:var(--sp-2)}
  .side-backdrop{position:fixed;inset:0;z-index:var(--z-popup);background:var(--overlay)}
  .side-open .side-backdrop{display:block}
  .conversation-side-details>summary{display:none}
  /* Воронка и календарь просмотров на телефоне — вертикальные списки, а не
     горизонтальная лента из семи колонок: этап за этапом, день за днём. Пустые
     этапы и дни без просмотров не занимают места (сегодняшний остаётся). */
  .funnel-board,.viewing-calendar{grid-template-columns:minmax(0,1fr);min-width:0}
  #viewBody:has(.funnel-board){overflow-x:visible}
  .funnel-column-body{min-height:0}
  .funnel-column:has(.funnel-empty){display:none}
  .viewing-calendar-shell{overflow:visible}
  .viewing-day{min-height:0}
  .viewing-day:not(.today):has(.viewing-day-empty){display:none}
  /* Кнопки под палец: не ниже 44 px; у плотных (панель форматирования поста, закрытие подсказки, «Ответить» у сообщения) — не ниже 34. */
  .btn,.btn.small{min-height:44px}
  .markup-bar .btn,.reply-delivery .btn.small{min-height:34px}
  .toast-action{min-height:36px;padding-left:var(--sp-4);padding-right:var(--sp-4)}
  .message-reply-button{padding:var(--sp-2) var(--sp-3)}
}
/* Ноутбук (1181–1960 px): восемь пунктов, поле поиска и значки справа не помещаются вместе с названием
   компании, и последний пункт («Настройки») уходил под поиск. Остаётся логотип, пункты без значков и с
   узкими отступами, поле поиска уже; название и значки видны на широком экране. Один диапазон вместо
   пяти прежних (1600, 1500, 1480, 1340, 1240 px): на ширине 1481–1960 меню и раньше вылезало под поиск
   (проверено измерением ширины меню на 1181…2200; со шрифтом Inter, он шире системного, границу пришлось сдвинуть с 1880 на 1960). */
@media(max-width:1960px) and (min-width:1181px){
  .app-brand .brand-full,.app-brand .brand-sub{display:none}
  .app-brand .brand-short{display:inline}
  .nav-item{padding-left:clamp(var(--sp-1),.4vw,var(--sp-2));padding-right:clamp(var(--sp-1),.4vw,var(--sp-2))}
  .global-search{flex-basis:clamp(120px,11vw,240px);min-width:120px;max-width:none}
}
/* Значки пунктов меню — только на широком экране (и в нижней панели телефона). */
@media(max-width:1960px) and (min-width:861px){.head-nav .nav-item .ico{display:none}}
@media(max-width:1180px) and (min-width:861px){
  .app-brand .brand-full,.app-brand .brand-sub,.app-brand .brand-short{display:none}
  .app-head{gap:var(--sp-2);padding-left:var(--sp-3);padding-right:var(--sp-3)}
  .nav-item{padding-left:var(--sp-1);padding-right:var(--sp-1)}
  .nav-item .ico{display:none}
  .state-line #botStateText{display:none}
  /* Поле поиска прячется за значок 🔍, как на телефоне: с ним пункты меню
     налезали друг на друга. Само меню при нехватке места листается вбок. */
  .btn.search-toggle{display:inline-flex}
  .global-search{display:none;position:fixed;left:var(--gutter);right:var(--gutter);top:calc(var(--header) + 6px);z-index:var(--z-toast);max-width:none;padding:var(--sp-2);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg)}
  .global-search.open{display:block}
  .global-results{position:static;margin-top:var(--sp-2);box-shadow:none;border:0;min-width:0;max-height:60vh}
  .head-nav{flex:1 1 0;overflow-x:auto;scrollbar-width:none}
  .head-nav::-webkit-scrollbar{display:none}
  .nav-item{flex:none}
}
/* Календарь и отчёты: чип статуса и кнопки не обрезаются, а переносятся. */
.viewing-event-head{flex-wrap:wrap}
.viewing-event-head .chip{max-width:100%}
.card>header{flex-wrap:wrap}
.card>header .actions{flex-wrap:wrap;justify-content:flex-end}
/* Телефон: цели касания не меньше 44 px, полоса вкладок с затухающей кромкой
   вместо серой полосы прокрутки, подписи нижней панели помещаются целиком. */
@media(max-width:860px){
  .tabs{scrollbar-width:none;background:linear-gradient(to right,var(--surface-soft) 30%,transparent) left center/32px 100% no-repeat local,linear-gradient(to left,var(--surface-soft) 30%,transparent) right center/32px 100% no-repeat local,radial-gradient(farthest-side at 0 50%,rgba(var(--ink-rgb),.22),transparent) left center/12px 100% no-repeat scroll,radial-gradient(farthest-side at 100% 50%,rgba(var(--ink-rgb),.22),transparent) right center/12px 100% no-repeat scroll,var(--surface-soft)}
  .tabs::-webkit-scrollbar{display:none}
  .tabs button{flex:none;min-height:44px;white-space:nowrap}
  input,select{min-height:44px}
  .notification-bell,.search-toggle,.head-tools .btn.icon{width:44px;min-width:44px;height:44px;min-height:44px}
  .tab{padding-left:0;padding-right:0}
  .tab-title{letter-spacing:-.02em}
  /* Шапка на узком экране: название усекается многоточием, подзаголовок
     прячется, а на самых узких экранах остаётся один знак — иначе значки справа
     уезжали за край (320 px: 467 при экране 320). */
  .app-head{flex-wrap:nowrap}
  .app-brand{flex:1 1 0;min-width:0}
  .app-brand>div,.app-brand>span{min-width:0}
  .app-brand b{display:block;overflow:hidden;text-overflow:ellipsis}
  .app-brand .brand-full,.app-brand .brand-sub{display:none}
  .app-brand .brand-short{display:inline}
  .head-tools{flex:none;gap:0}
  /* Точка состояния: при беде рядом короткая подпись, а не одна красная точка. */
  .head-tools .state-line{cursor:pointer}
  .state-line[data-state="bad"]::after,.state-line[data-state="off"]::after{content:attr(data-short);font-size:var(--fs-xs);font-weight:700;color:var(--bad)}
}
/* «Сегодня» на телефоне: дела начинаются выше. Правило стоит в конце файла — раньше оно лежало выше основного и не действовало. */
@media(max-width:600px){
  .today-numbers{display:grid;grid-template-columns:1fr;gap:var(--sp-1);margin-bottom:var(--sp-2);padding:var(--sp-2) var(--sp-3);font-size:var(--fs-xs);line-height:var(--lh-tight)}
  .toolbar select{width:100%;max-width:none}
  .today-numbers>span:nth-child(n+3){display:none}
  .today-numbers b{font-size:var(--fs-sm)}
  .week-line{display:none}
  /* «Список дел»: название и «Ответить по очереди» в одной строке, переключатель — под ними */
  .card>header:has(#answerQueue){display:grid;grid-template-columns:1fr auto;gap:var(--sp-2)}
  .card>header:has(#answerQueue) .actions{display:contents}
  .card>header:has(#answerQueue) #feedTabs{grid-column:1/-1}
}
`;

export { PANEL_CSS };
