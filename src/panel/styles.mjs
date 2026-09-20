// Оформление панели: плотная светлая тема, одна колонка навигации слева.

const PANEL_CSS = String.raw`
*{box-sizing:border-box}
:root{
  --bg:#f5f6f8; --surface:#fff; --surface-soft:#fafbfc; --line:#e4e7ec; --line-soft:#eef1f4;
  --text:#101828; --muted:#667085; --faint:#98a2b3;
  --brand:#2f56d9; --brand-soft:#eef2ff; --brand-dark:#2344b5;
  --ok:#067647; --ok-soft:#ecfdf3; --warn:#b54708; --warn-soft:#fffaeb; --bad:#b42318; --bad-soft:#fef3f2;
  --radius:10px; --shadow:0 1px 2px rgba(16,24,40,.06); --shadow-lg:0 12px 32px rgba(16,24,40,.14);
  --sidebar:232px;
}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:400 13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-weight:650;letter-spacing:-.01em}
h1{font-size:20px}h2{font-size:16px}h3{font-size:14px}
p{margin:0}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.hidden{display:none!important}
.muted{color:var(--muted)}
.faint{color:var(--faint)}
.small{font-size:12px}
.nowrap{white-space:nowrap}
.right{text-align:right}
.grow{flex:1}
.row{display:flex;align-items:center;gap:8px}
.row.wrap{flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:12px}
.grid{display:grid;gap:12px}
.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.split{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px;align-items:start}

/* --- Каркас ---------------------------------------------------------------- */
.app{display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:2px;padding:12px 10px;background:var(--surface);border-right:1px solid var(--line)}
.side-brand{display:flex;align-items:center;gap:9px;padding:6px 8px 12px}
.side-brand img{width:28px;height:28px;border-radius:7px;object-fit:contain}
.side-brand b{font-size:13.5px;line-height:1.15}
.side-brand span{display:block;font-size:11px;color:var(--faint);font-weight:400}
.nav-item{display:flex;align-items:center;gap:9px;padding:7px 9px;border:0;width:100%;background:none;border-radius:8px;color:var(--text);font:inherit;text-align:left;cursor:pointer}
.nav-item:hover{background:var(--surface-soft)}
.nav-item.active{background:var(--brand-soft);color:var(--brand-dark);font-weight:600}
.nav-item .ico{width:18px;text-align:center;font-size:14px;opacity:.9}
.nav-item .count{margin-left:auto;min-width:20px;padding:1px 6px;border-radius:9px;background:var(--bad);color:#fff;font-size:11px;font-weight:700;text-align:center}
.nav-item.active .count{background:var(--brand)}
.side-foot{margin-top:auto;padding-top:10px;border-top:1px solid var(--line-soft);display:flex;flex-direction:column;gap:8px}
.state-line{display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:8px;background:var(--surface-soft);font-size:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:none}
.dot.on{background:#12b76a;box-shadow:0 0 0 3px #12b76a22}
.dot.off{background:#d0d5dd}
.dot.bad{background:#f04438;box-shadow:0 0 0 3px #f0443822}
.main{min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;padding:12px 20px;background:rgba(245,246,248,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.topbar .sub{font-size:12px;color:var(--muted)}
.page{padding:16px 20px 96px;max-width:1240px;width:100%}

/* --- Карточки и таблицы ----------------------------------------------------- */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.card>header{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--line-soft)}
.card>header .actions{margin-left:auto;display:flex;gap:6px}
.card-body{padding:14px}
.card-body.tight{padding:10px 14px}
.kpi{display:flex;flex-direction:column;gap:2px;padding:12px 14px}
.kpi .label{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.kpi .value{font-size:23px;font-weight:680;letter-spacing:-.02em}
.kpi .delta{font-size:11.5px;color:var(--muted)}
.kpi .delta.up{color:var(--ok)}.kpi .delta.down{color:var(--bad)}
table{width:100%;border-collapse:collapse}
th{font-size:11.5px;font-weight:600;color:var(--muted);text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr.clickable{cursor:pointer}
tbody tr.clickable:hover{background:var(--surface-soft)}
tbody tr.selected{background:var(--brand-soft)}
.table-wrap{overflow:auto}
.empty{padding:26px 14px;text-align:center;color:var(--muted)}
.empty b{display:block;color:var(--text);margin-bottom:3px}

/* --- Элементы --------------------------------------------------------------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border:1px solid var(--brand);border-radius:8px;background:var(--brand);color:#fff;font:inherit;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--brand-dark);border-color:var(--brand-dark)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn.secondary{background:var(--surface);color:var(--text);border-color:var(--line)}
.btn.secondary:hover{background:var(--surface-soft)}
.btn.ghost{background:none;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{background:var(--surface-soft);color:var(--text)}
.btn.danger{background:var(--bad);border-color:var(--bad)}
.btn.danger:hover{background:#912018;border-color:#912018}
.btn.small{padding:4px 9px;font-size:12px;border-radius:7px}
.btn.icon{padding:5px 7px}
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:20px;border:1px solid var(--line);background:var(--surface-soft);font-size:11.5px;font-weight:600;color:var(--muted);white-space:nowrap}
.chip.ok{background:var(--ok-soft);border-color:#abefc6;color:var(--ok)}
.chip.warn{background:var(--warn-soft);border-color:#fedf89;color:var(--warn)}
.chip.bad{background:var(--bad-soft);border-color:#fecdca;color:var(--bad)}
.chip.brand{background:var(--brand-soft);border-color:#c7d7fe;color:var(--brand-dark)}
.field{display:flex;flex-direction:column;gap:5px;min-width:0}
.field>label,.field-label{font-size:12px;font-weight:600;color:var(--muted)}
.hint{font-size:11.5px;color:var(--faint)}
input,textarea,select{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);font:inherit;font-size:13px}
input:focus,textarea:focus,select:focus{outline:0;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
textarea{min-height:76px;resize:vertical;line-height:1.45}
input[type=checkbox],input[type=radio]{width:auto;accent-color:var(--brand)}
.check{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}
.switch{position:relative;display:inline-flex;align-items:center;gap:9px;cursor:pointer;font-size:13px}
.switch input{position:absolute;opacity:0;width:0;height:0}
.switch .track{width:38px;height:22px;border-radius:12px;background:#d0d5dd;transition:background .15s;flex:none}
.switch .track::after{content:"";display:block;width:18px;height:18px;margin:2px;border-radius:50%;background:#fff;box-shadow:var(--shadow);transition:transform .15s}
.switch input:checked+.track{background:#12b76a}
.switch input:checked+.track::after{transform:translateX(16px)}
.tabs{display:flex;gap:2px;padding:3px;background:var(--surface-soft);border:1px solid var(--line);border-radius:9px;overflow:auto}
.tabs button{padding:6px 11px;border:0;border-radius:7px;background:none;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.tabs button.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow)}
.search{position:relative;flex:1;min-width:140px;max-width:320px}
.search input{padding-left:30px}
.search::before{content:"⌕";position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--faint);font-size:15px}
.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.attention{display:flex;align-items:flex-start;gap:9px;padding:9px 12px;border-bottom:1px solid var(--line-soft);cursor:pointer}
.attention:last-child{border-bottom:0}
.attention:hover{background:var(--surface-soft)}
.attention .what{font-weight:600}
.attention .why{font-size:12px;color:var(--muted)}
.thumb{width:40px;height:30px;border-radius:5px;object-fit:cover;background:var(--surface-soft);flex:none}
.avatar{width:26px;height:26px;border-radius:50%;background:var(--brand-soft);color:var(--brand-dark);display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;flex:none}
.bar-row{display:grid;grid-template-columns:minmax(90px,1fr) 46px;align-items:center;gap:8px;padding:4px 0;font-size:12.5px}
.bar{height:7px;border-radius:4px;background:var(--brand-soft);overflow:hidden}
.bar>span{display:block;height:100%;background:var(--brand);border-radius:4px}
.spark{display:flex;align-items:flex-end;gap:2px;height:74px}
.spark div{flex:1;min-width:3px;background:var(--brand-soft);border-radius:3px 3px 0 0;position:relative}
.spark div>i{position:absolute;inset:auto 0 0 0;background:var(--brand);border-radius:3px 3px 0 0;display:block}
.legend{display:flex;gap:12px;font-size:11.5px;color:var(--muted);margin-top:6px}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
.list{display:flex;flex-direction:column}
.list-item{display:flex;align-items:center;gap:9px;padding:8px 14px;border-bottom:1px solid var(--line-soft)}
.list-item:last-child{border-bottom:0}
.msg{padding:8px 10px;border-radius:9px;background:var(--surface-soft);border:1px solid var(--line-soft);font-size:13px;white-space:pre-wrap;word-break:break-word}
.msg.out{background:var(--brand-soft);border-color:#c7d7fe}
.msg-meta{font-size:11px;color:var(--faint);margin-top:3px}
/* Предпросмотр сообщения так, как его покажет Telegram */
.tg-preview{background:#e8ecf1;padding:12px;border-radius:10px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.tg-bubble{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(16,24,40,.12);overflow:hidden;max-width:min(420px,100%);width:100%}
.tg-bubble img{display:block;width:100%;height:auto}
.tg-text{padding:9px 11px;font-size:13.5px;line-height:1.42;white-space:pre-wrap;word-break:break-word}
.tg-text a{color:#2f6fd0}
.tg-quote{border-left:3px solid #2f6fd0;padding-left:9px;margin-top:8px;color:#222}
.tg-buttons{display:grid;gap:3px;margin-top:3px;width:100%;max-width:min(420px,100%)}
.tg-buttons .row{gap:3px}
.tg-button{flex:1;text-align:center;padding:7px 8px;border-radius:8px;background:#fff;color:#2f6fd0;font-size:12.5px;box-shadow:0 1px 2px rgba(16,24,40,.12);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tg-note{font-size:11.5px;color:var(--muted)}
.markup-bar{gap:3px;padding:4px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft)}
.markup-bar .btn{padding:3px 8px;min-width:30px}
code{padding:1px 5px;border-radius:5px;background:var(--surface-soft);border:1px solid var(--line);font-size:11.5px}

/* --- Панель сохранения, тосты, диалоги -------------------------------------- */
.savebar{position:fixed;left:calc(var(--sidebar) + 20px);right:20px;bottom:16px;z-index:40;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:11px;background:#101828;color:#fff;box-shadow:var(--shadow-lg)}
.savebar .btn.secondary{background:transparent;color:#fff;border-color:#475467}
.savebar .btn.secondary:hover{background:#1d2939}
.toast{position:fixed;right:18px;bottom:18px;z-index:60;padding:10px 14px;border-radius:9px;background:#101828;color:#fff;box-shadow:var(--shadow-lg);max-width:380px}
.toast.bad{background:var(--bad)}
dialog{border:0;border-radius:12px;padding:0;background:var(--surface);box-shadow:var(--shadow-lg);max-width:min(720px,calc(100vw - 32px));width:100%}
dialog::backdrop{background:rgba(16,24,40,.45)}
.dialog-head{display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--line-soft)}
.dialog-body{padding:16px;max-height:min(70vh,640px);overflow:auto}
.dialog-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--line-soft);background:var(--surface-soft);border-radius:0 0 12px 12px}
.drawer{position:fixed;inset:0 0 0 auto;width:min(560px,100vw);max-width:none;height:100vh;max-height:100vh;border-radius:0;display:flex;flex-direction:column}
.drawer .dialog-body{flex:1;max-height:none}

/* --- Вход ------------------------------------------------------------------- */
.auth{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg)}
.auth-card{width:min(400px,100%);background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-lg);padding:26px}
.auth-card img{width:56px;height:56px;border-radius:12px;object-fit:contain;margin-bottom:14px}
.auth-card h1{margin-bottom:4px}
.auth-card .stack{margin-top:16px}

@media(max-width:1100px){.split{grid-template-columns:minmax(0,1fr)}.cols-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:860px){
  .app{grid-template-columns:1fr}
  .side{position:fixed;z-index:50;left:0;top:0;bottom:0;width:var(--sidebar);transform:translateX(-102%);transition:transform .18s;box-shadow:var(--shadow-lg)}
  .side.open{transform:none}
  .page{padding:14px 14px 92px}
  .topbar{padding:10px 14px}
  .savebar{left:14px;right:14px}
  .cols-3,.cols-2{grid-template-columns:minmax(0,1fr)}
  .drawer{width:100vw}
}
@media(min-width:861px){.menu-toggle{display:none}}
`;

export { PANEL_CSS };
