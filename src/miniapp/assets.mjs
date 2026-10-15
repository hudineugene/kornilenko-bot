// Страница Mini App: разметка, стили и сценарий одним модулем (как панель), без сборщика и без внешних библиотек, кроме
// telegram-web-app.js от самого Telegram. В строках ниже нет обратных кавычек и «${»: это String.raw.

const APP_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>Construcciones Kornilenko</title>
<link rel="icon" href="/icon.png">
<link rel="stylesheet" href="/app.css">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
<div id="app" aria-live="polite"><div class="boot"><div class="boot-logo"></div><div class="boot-bar"></div></div></div>
<script src="/app.js"></script>
</body>
</html>`;

const APP_CSS = String.raw`
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-cyrillic.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#f8fafb;--card:#fff;--soft:#f1f5f8;--line:#e8edf1;--ink:#17212b;--muted:#677486;
  --red:#ef3655;--red-dark:#d62845;--red-soft:#fde8ec;--yellow:#ffcc22;--yellow-dark:#e8b508;--yellow-soft:#fff6cc;
  --cyan:#06b6c8;--cyan-dark:#0590a0;--cyan-soft:#dff6f9;--green:#168344;--green-soft:#ddf2e4;
  --shadow:0 4px 20px rgba(20,34,43,.07);--shadow-lg:0 12px 36px rgba(20,34,43,.16);
  --r:16px;--rb:12px;--tab:64px;--top:env(safe-area-inset-top,0px);--bottom:env(safe-area-inset-bottom,0px);
}
[data-theme=dark]{--bg:#0f141a;--card:#171d25;--soft:#1e2630;--line:#2a3340;--ink:#f2f5f8;--muted:#9aa6b6;--red:#ff5470;--red-dark:#ff7389;--red-soft:#3a1d26;--yellow:#ffcc22;--yellow-soft:#3a3315;--cyan:#2cc9da;--cyan-dark:#5ad4e6;--cyan-soft:#10303a;--green:#3dd68c;--green-soft:#11301f;--shadow:0 4px 20px rgba(0,0,0,.35);--shadow-lg:0 14px 40px rgba(0,0,0,.55)}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;overscroll-behavior-y:contain}
body{overflow-x:hidden}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none;padding:0}
img{display:block;max-width:100%}
.hidden{display:none!important}
#app{min-height:100%;padding-bottom:calc(var(--tab) + var(--bottom) + 16px);position:relative}
.boot{display:grid;place-items:center;gap:18px;height:100vh}
.boot-logo{width:132px;height:108px;background:url(/logo.png) center/contain no-repeat;animation:pop .6s ease both}
.boot-bar{width:120px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--red),var(--yellow),var(--cyan));background-size:200% 100%;animation:slide 1.2s linear infinite}
@keyframes slide{to{background-position:-200% 0}}
@keyframes pop{from{opacity:0;transform:scale(.88)}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
@keyframes fade{from{opacity:0}}
@keyframes shimmer{to{background-position:-200% 0}}

/* шапка: логотип целиком и три кнопки */
.top{position:relative;padding:calc(var(--top) + 8px) 16px 6px;background:var(--card) url(/grid.svg) center top/520px auto;border-bottom:1px solid var(--line)}
.top-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.logo{height:76px;width:auto;object-fit:contain;display:block;max-width:56vw;mix-blend-mode:multiply}
[data-theme=dark] .logo{mix-blend-mode:normal;background:#fff;border-radius:14px;padding:6px}
[data-theme=dark] .top{background:var(--card)}
[data-theme=dark] .hbtn.plain{color:var(--ink)}
.top-actions{display:flex;align-items:center;gap:8px}
.hbtn{position:relative;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:var(--ink);background:var(--soft);transition:transform .15s}
.hbtn:active{transform:scale(.92)}
.hbtn svg{width:22px;height:22px}
.hbtn.plain{background:transparent}
.flag{width:30px;height:20px;border-radius:4px;box-shadow:0 0 0 1px rgba(23,33,43,.18);flex:none;display:block}
.hbtn .flag{width:26px;height:17px}
.menu-row>svg.flag{width:30px;height:20px;color:inherit}
.hbtn .code{position:absolute;right:-2px;bottom:-2px;min-width:20px;height:16px;border-radius:8px;background:var(--cyan);color:#fff;font-size:9px;font-weight:800;display:grid;place-items:center;padding:0 3px;letter-spacing:.02em}

/* нижняя навигация: четыре вкладки, активная красная */
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:30;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--card);border-top:1px solid var(--line);padding:6px 6px calc(var(--bottom) + 6px)}
.tab{display:grid;place-items:center;gap:2px;height:52px;color:var(--muted);font-size:11.5px;font-weight:600;position:relative;transition:color .2s}
.tab svg{width:24px;height:24px}
.tab.on{color:var(--red)}
.tab.on::after{content:"";position:absolute;bottom:0;width:30px;height:3px;border-radius:3px;background:var(--red)}
.tab .count{position:absolute;top:2px;right:calc(50% - 24px);min-width:18px;height:18px;border-radius:9px;background:var(--red);color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center;padding:0 5px}

/* общие элементы */
.page{padding:16px 16px 24px;animation:rise .3s ease both}
h1,h2,h3{margin:0;letter-spacing:-.015em;line-height:1.2}
h1{font-size:28px;font-weight:700}
h2{font-size:20px;font-weight:700}
h3{font-size:16px;font-weight:600}
.sub{color:var(--muted);font-size:14px}
.section{margin-top:24px}
.section>h3{margin-bottom:12px}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 12px}
.section-head:first-child{margin-top:0}
.section-head a,.section-head button{display:inline-flex;align-items:center;gap:2px;color:var(--muted);font-size:13px;font-weight:500}
.section-head svg{width:16px;height:16px}
.chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:12px -16px 0;padding:2px 16px}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;height:38px;padding:0 16px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:14px;font-weight:600;color:var(--muted);white-space:nowrap;transition:all .18s}
.chip.on{background:var(--red);border-color:var(--red);color:#fff}
.chip:active{transform:scale(.96)}
.filter-chip{display:inline-flex;align-items:center;gap:7px}
.filter-chip svg{width:18px;height:18px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;padding:10px 20px;border-radius:var(--rb);font-weight:700;font-size:15px;transition:transform .15s,box-shadow .2s,opacity .2s;white-space:nowrap}
.btn svg{width:20px;height:20px;flex:none}
.btn:active{transform:scale(.97)}
.btn.primary{background:var(--yellow);color:#17212b;box-shadow:0 6px 16px rgba(255,204,34,.3)}
.btn.red{background:var(--red);color:#fff;box-shadow:0 6px 16px rgba(239,54,85,.25)}
.btn.ink{background:var(--ink);color:var(--bg)}
.btn.soft{background:var(--card);border:1px solid var(--line);color:var(--ink)}
.btn.wide{width:100%}
.btn.small{min-height:40px;padding:8px 14px;font-size:13.5px}
.btn[disabled]{opacity:.55;pointer-events:none}
.icon-btn{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--card);box-shadow:var(--shadow);transition:transform .15s;color:var(--ink)}
.icon-btn svg{width:22px;height:22px}
.icon-btn:active{transform:scale(.9)}
.icon-btn.on{color:var(--red)}
.icon-btn.on svg{fill:var(--red);stroke:var(--red)}

/* главная: главное фото с текстом */
.hero{position:relative;border-radius:var(--r);overflow:hidden;min-height:300px;background:var(--cyan-soft);box-shadow:var(--shadow)}
.hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:78% 50%}
.hero::before{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(255,255,255,.95) 0%,rgba(255,255,255,.84) 38%,rgba(255,255,255,0) 72%)}
[data-theme=dark] .hero::before{background:linear-gradient(90deg,rgba(15,20,26,.92) 0%,rgba(15,20,26,.78) 38%,rgba(15,20,26,0) 72%)}
.hero-copy{position:relative;z-index:2;padding:22px 18px;max-width:68%;display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.hero h1{font-size:25px;line-height:1.15;font-weight:800;letter-spacing:-.025em}
.hero p{margin:0;font-size:13px;line-height:1.45;color:#3a4856}
[data-theme=dark] .hero p{color:#c4ccd6}
.hero .btn{margin-top:6px;min-height:44px;padding:8px 18px;font-size:14px}
.actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:16px}
.action{display:grid;justify-items:center;align-content:start;gap:8px;padding:12px 4px 10px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);text-align:center;font-size:10.5px;font-weight:600;line-height:1.25;min-height:104px;transition:transform .15s}
.action:active{transform:scale(.96)}
.action svg{width:30px;height:30px}
.action span{min-width:0;max-width:100%;overflow-wrap:anywhere;hyphens:auto}
.action .chev{width:14px;height:14px;color:var(--muted);align-self:end}
.action.red svg:first-child{color:var(--red)}
.action.yellow svg:first-child{color:var(--yellow-dark)}
.action.cyan svg:first-child{color:var(--cyan)}
.hscroll{display:flex;gap:12px;overflow-x:auto;margin:0 -16px;padding:2px 16px 14px;scroll-snap-type:x proximity;scrollbar-width:none}
.hscroll::-webkit-scrollbar{display:none}
.hscroll .card{flex:none;width:68%;max-width:260px;scroll-snap-align:start}
.adv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.adv-item{display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);font-size:12.5px;font-weight:600;line-height:1.3;box-shadow:var(--shadow)}
.adv-item svg{width:28px;height:28px;flex:none}
.adv-item span{min-width:0;overflow-wrap:anywhere}
.adv-item:nth-child(1) svg{color:var(--red)}
.adv-item:nth-child(2) svg{color:var(--yellow-dark)}
.adv-item:nth-child(3) svg{color:var(--cyan)}
.adv-item:nth-child(4) svg{color:var(--red)}

/* каталог: поиск, карточки в две колонки */
.page-title{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
.page-title .sub{margin-top:4px;font-size:13px}
.catalog-count{font-size:12px;color:var(--muted);white-space:nowrap;padding-bottom:4px}
.catalog-search{height:50px;display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:var(--rb);padding:0 6px 0 14px;box-shadow:var(--shadow);transition:border-color .2s,box-shadow .2s}
.catalog-search:focus-within{border-color:var(--cyan);box-shadow:0 0 0 4px rgba(6,182,200,.14)}
.catalog-search>svg{width:20px;height:20px;color:var(--muted);flex:none}
.catalog-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;font-size:14px}
.catalog-search input::placeholder{color:var(--muted)}
.search-filter{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;color:var(--ink);flex:none}
.search-filter.on{background:var(--red);color:#fff}
.search-filter svg{width:20px;height:20px}
.list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}
.list.rows{grid-template-columns:1fr;gap:14px}
.card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;cursor:pointer;transition:transform .2s;animation:rise .4s ease both;display:flex;flex-direction:column}
.card:active{transform:scale(.985)}
.card .photo{position:relative;margin:6px 6px 0;border-radius:12px;overflow:hidden;aspect-ratio:3/2;background:linear-gradient(110deg,var(--soft) 30%,var(--line) 50%,var(--soft) 70%);background-size:200% 100%;animation:shimmer 1.4s linear infinite}
.card .photo img{width:100%;height:100%;object-fit:cover;animation:fade .4s ease both}
.card .badges{position:absolute;left:8px;top:8px;display:flex;gap:5px;flex-wrap:wrap;z-index:2;max-width:68%}
.badge{height:24px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:600;display:inline-flex;align-items:center;background:var(--yellow);color:#4a3600;white-space:nowrap}
.badge.sale{background:var(--green-soft);color:var(--green)}
.badge.fresh{background:var(--yellow);color:#4a3600}
.badge.drop{background:var(--red);color:#fff}
.badge.build{background:var(--cyan-soft);color:var(--cyan-dark)}
.badge.reserved{background:#17212b;color:#fff}
.card .heart{position:absolute;right:6px;top:6px;z-index:2;width:34px;height:34px;box-shadow:none;background:rgba(255,255,255,.92)}
.card .heart svg{width:19px;height:19px;color:var(--ink)}
.card .heart.on svg{color:var(--red)}
.card .count{position:absolute;right:8px;bottom:8px;z-index:2;height:24px;padding:0 8px;border-radius:999px;background:rgba(23,33,43,.62);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;gap:4px}
.card .count svg{width:13px;height:13px}
.card .body{padding:10px 12px 12px;display:flex;flex-direction:column;flex:1}
.card .body h3{font-size:15px;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .place{display:flex;align-items:flex-start;gap:5px;color:var(--muted);font-size:12px;margin-top:5px;line-height:1.3}
.card .place svg{width:14px;height:14px;color:var(--muted);flex:none;margin-top:1px}
.card-price{font-size:17px;font-weight:800;letter-spacing:-.02em;margin-top:8px;color:var(--ink)}
.card-price s{font-size:12px;color:var(--muted);font-weight:600;margin-right:6px}
.facts-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:auto;padding-top:10px}
.fact{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);font-weight:500}
.fact svg{width:16px;height:16px;color:var(--muted)}
.hscroll .card .body h3{font-size:14px}

/* избранное: карточки строкой */
.fav-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.cmp-link{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--rb);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;font-weight:600;text-align:left;flex:none;max-width:48%}
.cmp-link svg{width:20px;height:20px;flex:none}
.card.row{flex-direction:row;padding:8px;gap:12px;align-items:stretch}
.card.row .photo{margin:0;width:42%;aspect-ratio:auto;min-height:150px;flex:none}
.card.row .body{padding:2px 0 0;min-width:0}
.card.row .head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.card.row .head h3{font-size:16px}
.card.row .heart{position:static;width:30px;height:30px;background:transparent;flex:none}
.card.row .heart svg{width:22px;height:22px}
.card.row .heart.on svg{fill:var(--red)}
.card.row .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.card.row .acts .btn{min-height:38px;padding:6px 10px;font-size:13px;flex:1 1 auto}
.card.row .acts .btn svg{width:18px;height:18px}

/* страница проекта */
.gallery{position:relative;margin:-16px -16px 0;background:var(--card)}
.slides{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:3/2;background:var(--soft)}
.slides::-webkit-scrollbar{display:none}
.slides img{flex:none;width:100%;height:100%;object-fit:cover;scroll-snap-align:center}
.dots{position:absolute;left:0;right:0;bottom:12px;display:flex;justify-content:center;gap:6px}
.dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.6);transition:all .25s}
.dots i.on{width:20px;border-radius:4px;background:#fff}
.gallery .back,.gallery .share{position:absolute;top:calc(var(--top) + 10px);z-index:3}
.gallery .back{left:12px}.gallery .share{right:12px;display:flex;gap:10px}
.sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:18px}
.big-price{font-size:28px;font-weight:800;letter-spacing:-.03em;margin-top:12px}
.big-price s{font-size:15px;color:var(--muted);font-weight:600;margin-right:8px}
.per{color:var(--muted);font-size:13px;margin-top:2px}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:var(--rb);padding:12px;display:flex;gap:10px;align-items:center}
.tile>div:last-child{min-width:0;overflow-wrap:anywhere}
.tile .ico{width:38px;height:38px;border-radius:10px;background:var(--cyan-soft);color:var(--cyan-dark);display:grid;place-items:center;flex:none}
.tile .ico svg{width:21px;height:21px}
.tile small{display:block;color:var(--muted);font-size:11.5px}
.tile b{font-size:14.5px}
.prose{color:var(--ink);font-size:14.5px;line-height:1.6;white-space:pre-line;margin:0 0 10px}
.ticks{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.ticks li{display:flex;gap:10px;align-items:flex-start;font-size:14px;background:var(--card);border:1px solid var(--line);padding:11px 12px;border-radius:var(--rb)}
.ticks li svg{width:19px;height:19px;flex:none;color:var(--cyan);margin-top:1px}
.links{display:flex;gap:10px;flex-wrap:wrap}
.links .btn{min-height:44px;font-size:14px}
.cta{position:fixed;left:0;right:0;bottom:0;z-index:31;display:flex;gap:10px;padding:10px 12px calc(var(--bottom) + 10px);background:var(--card);border-top:1px solid var(--line);box-shadow:0 -8px 24px rgba(20,34,43,.08);animation:rise .3s ease both}
.cta .btn{flex:1 1 0;min-width:0;min-height:50px;padding:0 12px;gap:8px;font-size:15px;overflow:hidden}
.cta .btn span{overflow:hidden;text-overflow:ellipsis}
.cta .btn.primary{flex:1.6 1 0}
.cta .icon-btn{flex:none;width:50px;height:50px;border-radius:var(--rb);box-shadow:none;border:1px solid var(--line)}

/* листы и окна */
.scrim{position:fixed;inset:0;z-index:50;background:rgba(15,20,26,.5);animation:fade .2s ease both}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:51;max-height:92vh;overflow-y:auto;background:var(--bg);border-radius:24px 24px 0 0;padding:9px 16px calc(var(--bottom) + 20px);box-shadow:var(--shadow-lg);animation:sheet .3s cubic-bezier(.2,.9,.3,1) both;border:1px solid var(--line)}
@keyframes sheet{from{transform:translateY(100%)}}
.sheet .grip{width:42px;height:5px;border-radius:3px;background:var(--line);margin:0 auto 12px}
.sheet h2{margin-bottom:4px}
.chat-sheet{display:flex;flex-direction:column;height:86vh;overflow:hidden}
.chat-log{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:12px 2px}
.bubble{max-width:86%;padding:10px 13px;border-radius:16px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.bubble.bot{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:6px}
.bubble.me{align-self:flex-end;background:var(--red);color:#fff;border-bottom-right-radius:6px}
.bubble.typing{color:var(--muted);font-style:italic}
.chat-viewing{align-self:flex-start;margin:0 0 6px}
.chat-suggest{align-self:flex-start;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}
.chat-rate{align-self:flex-start;display:flex;gap:6px;margin:-4px 0 4px;color:var(--muted);font-size:13px}
.chat-rate-btn{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:3px 10px;font-size:15px;line-height:1.2}
.chat-note{align-self:center;max-width:92%;text-align:center;font-size:12.5px;color:var(--muted);background:var(--soft);border-radius:10px;padding:6px 10px}
.chat-input{display:flex;gap:8px;align-items:flex-end;padding-top:8px;border-top:1px solid var(--line)}
.chat-input textarea{flex:1;min-height:44px;max-height:120px;resize:none;border-radius:14px}
.chat-send{width:48px;height:44px;padding:0;flex:none;display:grid;place-items:center}
.chat-send svg{width:20px;height:20px}
.chat-tool{width:44px;height:44px;flex:none;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--muted);display:grid;place-items:center;padding:0}
.chat-tool svg{width:20px;height:20px}
.chat-tool.rec{width:auto;display:flex;align-items:center;gap:6px;padding:0 12px;background:var(--red);border-color:var(--red);color:#fff;font-variant-numeric:tabular-nums;font-weight:600}
.chat-tool:disabled{opacity:.45}
.chat-file{display:none}
.bubble img{display:block;max-width:220px;max-height:260px;border-radius:12px;margin:-2px -4px 6px;object-fit:cover}
.ai-fab{position:fixed;right:16px;bottom:calc(var(--tab) + var(--bottom) + 16px);z-index:31;width:56px;height:56px;border-radius:50%;border:0;background:var(--red);color:#fff;display:grid;place-items:center;box-shadow:0 8px 22px rgba(239,54,85,.35)}
.ai-fab svg{width:26px;height:26px}
.sheet-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.sheet-close{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--card);border:1px solid var(--line);color:var(--muted);flex:none}
.sheet-close svg{width:20px;height:20px}
.field{display:grid;gap:6px;margin-top:14px}
.field label{font-size:12.5px;font-weight:600;color:var(--muted)}
.field input,.field textarea{width:100%;height:50px;border-radius:var(--rb);border:1.5px solid var(--line);background:var(--card);padding:0 14px;outline:none;transition:border-color .2s,box-shadow .2s}
.field textarea{height:92px;padding:12px 14px;resize:none}
.field input:focus,.field textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 4px rgba(6,182,200,.14)}
.switch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding:12px 14px;border-radius:var(--rb);background:var(--card);border:1px solid var(--line);font-weight:600;width:100%;text-align:left}
.switch i{width:48px;height:28px;border-radius:14px;background:var(--line);position:relative;transition:background .2s;flex:none}
.switch i::after{content:"";position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}
.switch.on i{background:var(--cyan)}
.switch.on i::after{transform:translateX(20px)}
.times{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.times .chip{width:100%;padding:0}
.filter-block{margin-top:18px}
.filter-block h3{font-size:13px;margin-bottom:9px;color:var(--muted);font-weight:600}
.filter-options{display:flex;gap:8px;flex-wrap:wrap}
.filter-options .chip{flex:1 1 auto;min-width:72px}
.filter-actions{display:grid;grid-template-columns:minmax(96px,.7fr) minmax(0,1.5fr);gap:10px;position:sticky;bottom:calc(-1 * var(--bottom));background:var(--bg);padding:16px 0 calc(var(--bottom) + 2px);margin-top:6px}
.filter-actions .btn{padding:0 12px}
.booking-summary{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:8px;margin-top:12px}
.booking-summary img{width:84px;height:64px;object-fit:cover;border-radius:10px;flex:none}
.booking-summary>div{min-width:0;display:grid;gap:2px}
.booking-summary b,.booking-summary strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.booking-summary span{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.booking-summary strong{font-size:15px}
.booking-confirmation{display:flex;align-items:center;gap:12px;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin-top:16px}
.booking-confirmation>svg{width:26px;height:26px;color:var(--cyan);flex:none}
.booking-confirmation div{display:grid;gap:2px}
.booking-confirmation span{font-size:13px;color:var(--muted)}
.success-actions{display:grid;gap:10px;margin-top:16px}
.contact-list{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:14px}
.contact-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);text-align:left;width:100%}
.contact-row .ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;flex:none}
.contact-row .ico svg{width:21px;height:21px}
.contact-row>span:last-child{min-width:0;overflow-wrap:anywhere}
.contact-row b{display:block;font-size:15px}
.contact-row small{color:var(--muted)}
.ico.wa{background:#25d366}.ico.tg{background:#2aabee}.ico.call{background:var(--cyan)}.ico.mail{background:var(--red)}.ico.web{background:var(--ink)}.ico.map{background:var(--yellow);color:#4a3600}
.success{text-align:center;padding:14px 0 4px}
.success .check{width:84px;height:84px;border-radius:50%;margin:0 auto 16px;background:var(--green-soft);color:var(--green);display:grid;place-items:center;animation:pop .5s cubic-bezier(.2,1.4,.4,1) both;position:relative}
.success .check svg{width:44px;height:44px;stroke-dasharray:60;stroke-dashoffset:60;animation:draw .5s .25s ease forwards}
.success .check::before,.success .check::after{content:"";position:absolute;width:12px;height:12px;transform:rotate(45deg)}
.success .check::before{background:var(--red);left:-16px;top:20px}
.success .check::after{background:var(--yellow);right:-16px;bottom:18px}
@keyframes draw{to{stroke-dashoffset:0}}
.calc{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;box-shadow:var(--shadow)}
.slider{margin-top:14px}
.slider label{display:flex;justify-content:space-between;font-size:13.5px;font-weight:600}
.slider output{color:var(--red)}
input[type=range]{-webkit-appearance:none;appearance:none;width:100%;margin:10px 0 0;height:28px;background:transparent;--p:50%}
input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--red) var(--p),var(--line) var(--p))}
input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--red) var(--p),var(--line) var(--p))}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;margin-top:-10px;border-radius:50%;background:#fff;border:3px solid var(--red);box-shadow:0 2px 8px rgba(20,34,43,.25)}
input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#fff;border:3px solid var(--red);box-shadow:0 2px 8px rgba(20,34,43,.25)}
.calc-line{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14px}
.calc-line:last-child{border:0}
.calc-line.big{font-size:15px;font-weight:800}
.calc-line span:last-child{white-space:nowrap;text-align:right}
.monthly{background:var(--yellow-soft);border:1px solid var(--yellow);color:var(--ink);border-radius:var(--rb);padding:14px 16px;margin-top:16px}
.monthly small{color:var(--muted);display:block}
.monthly b{font-size:26px;letter-spacing:-.02em}
.note{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5}

/* сравнение, профиль, о компании, пустые состояния */
.cmp{overflow-x:auto;margin:16px -16px 0;padding:0 16px 10px}
.cmp table{border-collapse:separate;border-spacing:0;min-width:100%;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden}
.cmp th,.cmp td{padding:12px 14px;text-align:left;font-size:13.5px;border-bottom:1px solid var(--line);vertical-align:top}
.cmp tr:last-child td{border:0}
.cmp th{font-weight:700;min-width:140px}
.cmp th:first-child,.cmp td:first-child{position:sticky;left:0;z-index:1;background:var(--card);min-width:84px}
.cmp td:first-child{color:var(--muted);font-size:12.5px;white-space:nowrap}
.cmp .best{color:var(--green);font-weight:800;background:var(--green-soft)}
.cmp .cmp-photo{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:10px;margin-bottom:8px}
.empty{text-align:center;padding:36px 20px;color:var(--muted)}
.empty img{width:72%;max-width:280px;margin:0 auto 14px;border-radius:var(--r)}
.empty>svg{width:64px;height:64px;color:var(--line);margin-bottom:10px}
.empty h3{color:var(--ink);margin-bottom:6px}
.empty .btn{margin-top:16px}
.list>.empty{grid-column:1/-1}
.btn.soft.picked{border-color:var(--cyan);color:var(--cyan-dark)}
.logo-link{display:block;padding:0}
.profile-card{display:flex;align-items:center;gap:14px;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);margin-top:14px}
.avatar{width:64px;height:64px;border-radius:50%;background:var(--soft);display:grid;place-items:center;color:var(--muted);flex:none;overflow:hidden}
.avatar svg{width:34px;height:34px}
.avatar img{width:100%;height:100%;object-fit:cover}
.profile-card h3{font-size:17px}
.profile-card .sub{font-size:13px;overflow-wrap:anywhere}
.tag{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;background:var(--cyan-soft);color:var(--cyan-dark);font-size:12px;font-weight:600}
.status-card{margin-top:12px;padding:14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);display:flex;gap:14px;align-items:center;text-align:left;width:100%}
.status-card img{width:84px;height:84px;border-radius:12px;object-fit:cover;flex:none}
.status-card .grow{flex:1;min-width:0}
.status-card h3{font-size:15px}
.status-card .sub{font-size:12.5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stepper{display:grid;grid-template-columns:repeat(3,1fr);margin-top:12px;position:relative}
.stepper::before{content:"";position:absolute;left:16.6%;right:16.6%;top:11px;height:3px;border-radius:2px;background:var(--line)}
.step{position:relative;display:grid;justify-items:center;gap:6px;font-size:11px;text-align:center;color:var(--muted);line-height:1.2}
.step i{width:24px;height:24px;border-radius:50%;background:var(--line);display:grid;place-items:center;color:#fff;position:relative;z-index:1}
.step i svg{width:14px;height:14px}
.step.done{color:var(--ink)}
.step.done i{background:var(--yellow);color:#17212b}
.menu-rows{display:grid;gap:8px;margin-top:14px}
.menu-row{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);text-align:left;width:100%}
.menu-row>svg{width:18px;height:18px;flex:none;color:var(--muted)}
.menu-row>svg:first-child{width:28px;height:28px}
.menu-row .grow{flex:1;min-width:0}
.menu-row b{display:block;font-size:15px}
.menu-row small{color:var(--muted);font-size:12.5px}
.menu-row .chev{width:18px;height:18px;color:var(--muted);flex:none}
.menu-row.red>svg:first-child{color:var(--red)}
.menu-row.cyan>svg:first-child{color:var(--cyan)}
.menu-row.yellow>svg:first-child{color:var(--yellow-dark)}
.menu-row.ink>svg:first-child{color:var(--muted)}
.about-hero{display:flex;gap:14px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px;margin-top:12px}
.about-hero img{width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--soft)}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px}
.stat b{display:block;font-size:24px;font-weight:800;letter-spacing:-.02em}
.acc{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-top:8px;overflow:hidden}
.acc button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:14px 16px;text-align:left;font-weight:700}
.acc button svg{width:20px;height:20px;transition:transform .25s;flex:none}
.acc.open button svg{transform:rotate(90deg)}
.acc .acc-body{display:none;padding:0 16px 14px;color:var(--ink);font-size:14px;line-height:1.55;white-space:pre-line}
.acc.open .acc-body{display:block}
.review{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px;margin-top:8px}
.toast{position:fixed;left:50%;bottom:calc(var(--tab) + var(--bottom) + 24px);transform:translateX(-50%);z-index:80;max-width:86%;background:var(--ink);color:var(--bg);padding:12px 18px;border-radius:var(--rb);font-size:14px;font-weight:600;box-shadow:var(--shadow-lg);animation:rise .25s ease both}
.viewer{position:fixed;inset:0;z-index:70;background:#05070a;animation:fade .2s ease both}
.viewer .slides{height:100%;aspect-ratio:auto;background:transparent}
.viewer img{object-fit:contain}
.viewer .close{position:absolute;right:14px;top:calc(var(--top) + 12px);z-index:2}
.viewer .counter{position:absolute;left:0;right:0;bottom:calc(var(--bottom) + 18px);text-align:center;color:#fff;font-weight:700;font-size:14px}
.skel{height:260px;border-radius:var(--r);background:linear-gradient(110deg,var(--card) 30%,var(--line) 50%,var(--card) 70%);background-size:200% 100%;animation:shimmer 1.3s linear infinite;margin-top:16px}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid rgba(6,182,200,.4);outline-offset:2px}
@media (max-width:359px){.adv{grid-template-columns:1fr}.list{grid-template-columns:1fr}.actions{grid-template-columns:repeat(2,minmax(0,1fr))}.hero-copy{max-width:92%}.logo{height:64px}.card.row .photo{width:38%}.cmp-link{max-width:100%}.fav-head{flex-wrap:wrap}}
@media (min-width:700px){#app{max-width:560px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line);background:var(--bg);box-shadow:0 0 60px rgba(20,34,43,.08)}.tabs,.cta{left:50%;right:auto;width:560px;transform:translateX(-50%)}.sheet{left:50%;right:auto;width:560px;transform:translateX(-50%);animation:none}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

const APP_JS = String.raw`
(function () {
  'use strict';
  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  var devMatch = /[?&]dev=(\d+)/.exec(location.search);
  var root = document.getElementById('app');

  /* ---------- тексты интерфейса ---------- */
  var T = {
    ru: { retry: 'Повторить', pickDay: 'Выберите день', pickTime: 'Выберите время', questionShort: 'Напишите вопрос', unavailable: 'Этот проект сейчас недоступен', tooMany: 'Слишком много действий подряд. Попробуйте через несколько минут.', allCities: 'Все города', catalog: 'Каталог', favorites: 'Избранное', compare: 'Сравнение', about: 'О нас', all: 'Все', sale: 'Продажа', rent: 'Аренда', from: 'от', filters: 'Фильтры', price: 'Цена', priceTo: 'Цена до', anyPrice: 'Любая', bedrooms: 'Спальни', anyBeds: 'Любое', apply: 'Показать', reset: 'Сбросить', found: 'Найдено', none: 'Ничего не найдено', noneHint: 'Измените фильтры или напишите менеджеру: подберём вариант.', remove: 'Убрать', book: 'Записаться на просмотр', bookShort: 'Записаться', contact: 'Связаться', calc: 'Расчёт покупки и ипотеки', similar: 'Похожие проекты', description: 'Описание', facts: 'Характеристики', location: 'Расположение', map: 'Карта', video: 'Видео', site: 'Сайт проекта', readMore: 'Читать полностью', collapse: 'Свернуть', photos: 'Фото', day: 'День', time: 'Время', morning: 'Утром', afternoon: 'Днём', evening: 'Вечером', online: 'Онлайн-показ по видеосвязи', name: 'Ваше имя', phone: 'Телефон', note: 'Комментарий (по желанию)', send: 'Отправить', bookTitle: 'Запись на просмотр', thanks: 'Заявка принята', thanksText: 'Менеджер свяжется с вами, чтобы подтвердить время. Подтверждение придёт в чат с ботом.', confirmed: 'Просмотр подтверждён', confirmedText: 'Время закреплено за вами. Подробности — в чате с ботом.', close: 'Закрыть', call: 'Позвонить', whatsapp: 'WhatsApp', telegram: 'Написать в Telegram', email: 'Написать на e-mail', website: 'Сайт компании', office: 'Офис на карте', callMe: 'Заказать звонок', callMeHint: 'Оставьте номер: перезвоним в удобное время', ask: 'Задать вопрос', askHint: 'Ответим в чате с ботом', question: 'Ваш вопрос', preferred: 'Удобное время для звонка', compareEmpty: 'Добавьте проекты в сравнение', compareEmptyHint: 'Нажмите значок весов на карточке проекта. Можно сравнить до трёх.', favEmpty: 'Здесь пока пусто', favEmptyHint: 'Нажимайте сердечко на понравившихся проектах, чтобы вернуться к ним позже.', limit: 'Сравнить можно не больше трёх проектов', guestHint: 'Откройте приложение из Telegram, чтобы сохранять и записываться', saved: 'Сохранено', removed: 'Убрано', reservedNote: 'Объект забронирован: напишите менеджеру', slotTaken: 'Это время только что заняли: выберите другое', phoneNeeded: 'Укажите телефон: менеджер подтвердит время', noTimes: 'Свободных окон пока нет — оставьте заявку, подберём время', years: 'лет', down: 'Первый взнос', term: 'Срок', rate: 'Ставка', hello: 'Здравствуйте', tagline: 'Проекты у моря', yearsOnMarket: 'лет на рынке', dealsDone: 'сделок', guide: 'Как купить в Испании', reviews: 'Отзывы клиентов', allReviews: 'Все отзывы', manager: 'Ваш менеджер', share: 'Поделиться', sea: 'до пляжа', best: 'лучшее', addCompare: 'В сравнение', inCompare: 'В сравнении', error: 'Не получилось. Попробуйте ещё раз.', loading: 'Загрузка…', reg: 'Регистрация', addr: 'Офис' },
    en: { retry: 'Try again', pickDay: 'Choose a day', pickTime: 'Choose a time', questionShort: 'Please write your question', unavailable: 'This project is not available right now', tooMany: 'Too many actions in a row. Please try again in a few minutes.', allCities: 'All cities', catalog: 'Projects', favorites: 'Saved', compare: 'Compare', about: 'About', all: 'All', sale: 'For sale', rent: 'For rent', from: 'from', filters: 'Filters', price: 'Price', priceTo: 'Price up to', anyPrice: 'Any', bedrooms: 'Bedrooms', anyBeds: 'Any', apply: 'Show', reset: 'Reset', found: 'Found', none: 'Nothing found', noneHint: 'Change the filters or message an agent: we will find an option.', remove: 'Remove', book: 'Book a viewing', bookShort: 'Book viewing', contact: 'Contact', calc: 'Purchase and mortgage calculator', similar: 'Similar projects', description: 'About', facts: 'Details', location: 'Location', map: 'Map', video: 'Video', site: 'Project website', readMore: 'Read more', collapse: 'Show less', photos: 'Photos', day: 'Day', time: 'Time', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', online: 'Online viewing by video call', name: 'Your name', phone: 'Phone', note: 'Comment (optional)', send: 'Send', bookTitle: 'Book a viewing', thanks: 'Request received', thanksText: 'An agent will contact you to confirm the time. The confirmation will arrive in your chat with the bot.', confirmed: 'Viewing confirmed', confirmedText: 'The time is yours. Details are in your chat with the bot.', close: 'Close', call: 'Call', whatsapp: 'WhatsApp', telegram: 'Message on Telegram', email: 'Send an e-mail', website: 'Company website', office: 'Office on the map', callMe: 'Request a call', callMeHint: 'Leave your number and we will call back', ask: 'Ask a question', askHint: 'We will answer in your chat with the bot', question: 'Your question', preferred: 'Convenient time for a call', compareEmpty: 'Add projects to compare', compareEmptyHint: 'Tap the scales icon on a project. Up to three at once.', favEmpty: 'Nothing here yet', favEmptyHint: 'Tap the heart on projects you like to come back to them later.', limit: 'You can compare up to three projects', guestHint: 'Open the app from Telegram to save and book', saved: 'Saved', removed: 'Removed', reservedNote: 'This property is reserved: message an agent', slotTaken: 'That time was just taken: choose another', phoneNeeded: 'Add a phone so an agent can confirm the time', noTimes: 'No free slots yet: leave a request and we will arrange a time', years: 'years', down: 'Down payment', term: 'Term', rate: 'Rate', hello: 'Hello', tagline: 'Projects by the sea', yearsOnMarket: 'years on the market', dealsDone: 'deals', guide: 'How to buy in Spain', reviews: 'Client reviews', allReviews: 'All reviews', manager: 'Your agent', share: 'Share', sea: 'to the beach', best: 'best', addCompare: 'Compare', inCompare: 'In comparison', error: 'Something went wrong. Please try again.', loading: 'Loading…', reg: 'Registration', addr: 'Office' },
    es: { retry: 'Reintentar', pickDay: 'Elige un día', pickTime: 'Elige una hora', questionShort: 'Escribe tu pregunta', unavailable: 'Este proyecto no está disponible ahora', tooMany: 'Demasiadas acciones seguidas. Inténtalo de nuevo en unos minutos.', allCities: 'Todas', catalog: 'Proyectos', favorites: 'Favoritos', compare: 'Comparar', about: 'Nosotros', all: 'Todos', sale: 'Venta', rent: 'Alquiler', from: 'desde', filters: 'Filtros', price: 'Precio', priceTo: 'Precio hasta', anyPrice: 'Cualquiera', bedrooms: 'Dormitorios', anyBeds: 'Cualquiera', apply: 'Mostrar', reset: 'Borrar', found: 'Encontrados', none: 'Sin resultados', noneHint: 'Cambia los filtros o escribe a un asesor: buscaremos una opción.', remove: 'Quitar', book: 'Reservar visita', bookShort: 'Reservar', contact: 'Contactar', calc: 'Calculadora de compra e hipoteca', similar: 'Proyectos similares', description: 'Descripción', facts: 'Características', location: 'Ubicación', map: 'Mapa', video: 'Vídeo', site: 'Web del proyecto', readMore: 'Leer más', collapse: 'Ver menos', photos: 'Fotos', day: 'Día', time: 'Hora', morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche', online: 'Visita online por videollamada', name: 'Tu nombre', phone: 'Teléfono', note: 'Comentario (opcional)', send: 'Enviar', bookTitle: 'Reservar visita', thanks: 'Solicitud recibida', thanksText: 'Un asesor se pondrá en contacto para confirmar la hora. La confirmación llegará al chat con el bot.', confirmed: 'Visita confirmada', confirmedText: 'La hora es tuya. Los detalles están en el chat con el bot.', close: 'Cerrar', call: 'Llamar', whatsapp: 'WhatsApp', telegram: 'Escribir por Telegram', email: 'Enviar un correo', website: 'Web de la empresa', office: 'Oficina en el mapa', callMe: 'Pedir una llamada', callMeHint: 'Deja tu número y te llamaremos', ask: 'Hacer una pregunta', askHint: 'Responderemos en el chat con el bot', question: 'Tu pregunta', preferred: 'Hora cómoda para la llamada', compareEmpty: 'Añade proyectos para comparar', compareEmptyHint: 'Pulsa la balanza en un proyecto. Hasta tres a la vez.', favEmpty: 'Aquí aún no hay nada', favEmptyHint: 'Pulsa el corazón en los proyectos que te gusten para volver a ellos.', limit: 'Se pueden comparar hasta tres proyectos', guestHint: 'Abre la aplicación desde Telegram para guardar y reservar', saved: 'Guardado', removed: 'Quitado', reservedNote: 'Inmueble reservado: escribe a un asesor', slotTaken: 'Esa hora se acaba de ocupar: elige otra', phoneNeeded: 'Añade un teléfono para que un asesor confirme la hora', noTimes: 'Aún no hay huecos libres: deja una solicitud y buscaremos hora', years: 'años', down: 'Entrada', term: 'Plazo', rate: 'Tipo', hello: 'Hola', tagline: 'Proyectos junto al mar', yearsOnMarket: 'años en el mercado', dealsDone: 'operaciones', guide: 'Cómo comprar en España', reviews: 'Opiniones de clientes', allReviews: 'Todas las opiniones', manager: 'Tu asesor', share: 'Compartir', sea: 'a la playa', best: 'mejor', addCompare: 'Comparar', inCompare: 'En comparación', error: 'No ha salido bien. Inténtalo de nuevo.', loading: 'Cargando…', reg: 'Registro', addr: 'Oficina' },
  };

  // Тексты фирменного редизайна вынесены отдельно, чтобы старые установки
  // сохранили весь словарь и получили одинаковую структуру интерфейса.
  Object.assign(T.ru, { search: 'Город, район или объект', showResults: 'Показать', backProperty: 'Вернуться к объекту', writeManager: 'Написать менеджеру', catalog: 'Объекты', about: 'О компании', description: 'Об объекте', map: 'На карте', send: 'Отправить заявку', thanks: 'Заявка отправлена', thanksText: 'Менеджер свяжется с вами и подтвердит время в чате с ботом.' });
  Object.assign(T.en, { search: 'City, area or property', showResults: 'Show', backProperty: 'Back to property', writeManager: 'Message a manager' });
  Object.assign(T.es, { search: 'Ciudad, zona o inmueble', showResults: 'Mostrar', backProperty: 'Volver al inmueble', writeManager: 'Escribir al asesor' });

  // Оформление по набору элементов интерфейса: четыре вкладки, главная с фото, профиль клиента.
  Object.assign(T.ru, { authEmpty: 'Откройте приложение кнопкой в чате Telegram: так мы узнаем вас и сможем принять заявку.', authExpired: 'Вход в приложение устарел. Закройте его и откройте заново кнопкой в чате.', authOther: 'Не удалось проверить вход. Закройте приложение и откройте заново кнопкой в чате.', navHome: 'Главная', navObjects: 'Объекты', navFav: 'Избранное', navProfile: 'Профиль', back: 'Назад', menu: 'Меню', language: 'Язык', heroTitle: 'Строим современную жизнь в Испании', heroText: 'Современные виллы, качественное строительство и продуманные решения для комфортной жизни на побережье Испании.', learnMore: 'Узнать больше', tileObjects: 'Наши объекты', tileBuild: 'Строительство под заказ', tileCalc: 'Рассчитать стоимость', tileProgress: 'Строящиеся объекты', buildPreset: 'Хочу обсудить строительство дома под заказ.', calcPick: 'Для какого проекта считаем?', popular: 'Популярные объекты', allObjects: 'Все объекты', advantages: 'Наши преимущества', adv1: 'Качественное и надёжное строительство', adv2: 'Проверенные материалы и энергоэффективность', adv3: 'Проекты на побережье Коста-Бланка', adv4: 'Индивидуальный подход к каждому клиенту', ourObjects: 'Наши объекты', searchObjects: 'Поиск объектов', inSale: 'В продаже', building: 'Строится', details: 'Подробнее', compareAction: 'Сравнить', compareN: 'Сравнить объекты · {n}', favSub: 'Сохранённые объекты для сравнения и выбора', contactManager: 'Связаться с менеджером', contactUs: 'Связаться с нами', contactManagerHint: 'Задать вопрос или получить консультацию', guestName: 'Гость', guestTag: 'Откройте из Telegram', clientTag: 'Клиент компании', guestProfile: 'Откройте приложение из Telegram, чтобы видеть свои заявки и избранное.', requestStatus: 'Статус заявки', stepAccepted: 'Заявка принята', stepWork: 'Менеджер на связи', stepViewing: 'Просмотр', stepDone: 'Завершена', myRequests: 'Мои заявки', myRequestsHint: 'Статус и история обращений', noRequests: 'Заявок пока нет', savedObjects: 'Сохранённые объекты', savedHint: 'Ваши избранные виллы и апартаменты', history: 'История просмотров', historyHint: 'Недавно просмотренные объекты', noHistory: 'Вы пока ничего не смотрели', settings: 'Язык', settingsHint: 'Русский, Українська, English, Español', compareHint: 'До трёх проектов рядом', aboutHint: 'Команда и как купить', typeViewing: 'Просмотр', typeLead: 'Звонок', typeQuestion: 'Вопрос', typeSelection: 'Подбор', typeInterest: 'Интерес', typeGeneral: 'Обращение' });
  Object.assign(T.en, { authEmpty: 'Open the app with the button in the Telegram chat so we know who you are and can take your request.', authExpired: 'Your session has expired. Close the app and open it again with the button in the chat.', authOther: 'We could not verify your sign-in. Close the app and open it again with the button in the chat.', navHome: 'Home', navObjects: 'Properties', navFav: 'Saved', navProfile: 'Profile', back: 'Back', menu: 'Menu', language: 'Language', heroTitle: 'We build modern living in Spain', heroText: 'Modern villas, quality construction and well-thought-out solutions for comfortable living on the Spanish coast.', learnMore: 'Learn more', tileObjects: 'Our properties', tileBuild: 'Build to order', tileCalc: 'Calculate the cost', tileProgress: 'Under construction', buildPreset: 'I would like to discuss building a house to order.', calcPick: 'Which project should we calculate?', popular: 'Popular properties', allObjects: 'All properties', advantages: 'Why choose us', adv1: 'Quality, reliable construction', adv2: 'Proven materials and energy efficiency', adv3: 'Projects on the Costa Blanca', adv4: 'A personal approach to every client', ourObjects: 'Our properties', searchObjects: 'Search properties', inSale: 'For sale', building: 'Under construction', details: 'Details', compareAction: 'Compare', compareN: 'Compare properties · {n}', favSub: 'Saved properties to compare and choose from', contactManager: 'Contact a manager', contactUs: 'Contact us', contactManagerHint: 'Ask a question or get advice', guestName: 'Guest', guestTag: 'Open from Telegram', clientTag: 'Client', guestProfile: 'Open the app from Telegram to see your requests and favourites.', requestStatus: 'Request status', stepAccepted: 'Request received', stepWork: 'Agent in touch', stepViewing: 'Viewing', stepDone: 'Completed', myRequests: 'My requests', myRequestsHint: 'Status and history', noRequests: 'No requests yet', savedObjects: 'Saved properties', savedHint: 'Your favourite villas and apartments', history: 'Viewing history', historyHint: 'Recently viewed properties', noHistory: 'You have not viewed anything yet', settings: 'Language', settingsHint: 'Русский, Українська, English, Español', compareHint: 'Up to three projects side by side', aboutHint: 'Team and how to buy', typeViewing: 'Viewing', typeLead: 'Call', typeQuestion: 'Question', typeSelection: 'Selection', typeInterest: 'Interest', typeGeneral: 'Request' });
  Object.assign(T.es, { authEmpty: 'Abre la aplicación con el botón del chat de Telegram para que sepamos quién eres y podamos recibir tu solicitud.', authExpired: 'La sesión ha caducado. Cierra la aplicación y ábrela de nuevo con el botón del chat.', authOther: 'No hemos podido verificar tu acceso. Cierra la aplicación y ábrela de nuevo con el botón del chat.', navHome: 'Inicio', navObjects: 'Inmuebles', navFav: 'Favoritos', navProfile: 'Perfil', back: 'Atrás', menu: 'Menú', language: 'Idioma', heroTitle: 'Construimos vida moderna en España', heroText: 'Villas modernas, construcción de calidad y soluciones pensadas para vivir con comodidad en la costa española.', learnMore: 'Saber más', tileObjects: 'Nuestros inmuebles', tileBuild: 'Construcción a medida', tileCalc: 'Calcular el coste', tileProgress: 'En construcción', buildPreset: 'Me gustaría hablar de construir una casa a medida.', calcPick: '¿Para qué proyecto calculamos?', popular: 'Inmuebles destacados', allObjects: 'Todos los inmuebles', advantages: 'Nuestras ventajas', adv1: 'Construcción de calidad y fiable', adv2: 'Materiales probados y eficiencia energética', adv3: 'Proyectos en la Costa Blanca', adv4: 'Trato personal a cada cliente', ourObjects: 'Nuestros inmuebles', searchObjects: 'Buscar inmuebles', inSale: 'En venta', building: 'En construcción', details: 'Detalles', compareAction: 'Comparar', compareN: 'Comparar inmuebles · {n}', favSub: 'Inmuebles guardados para comparar y elegir', contactManager: 'Contactar con un asesor', contactUs: 'Contáctanos', contactManagerHint: 'Haz una pregunta o pide consejo', guestName: 'Invitado', guestTag: 'Abre desde Telegram', clientTag: 'Cliente', guestProfile: 'Abre la aplicación desde Telegram para ver tus solicitudes y favoritos.', requestStatus: 'Estado de la solicitud', stepAccepted: 'Solicitud recibida', stepWork: 'Asesor en contacto', stepViewing: 'Visita', stepDone: 'Completada', myRequests: 'Mis solicitudes', myRequestsHint: 'Estado e historial', noRequests: 'Aún no hay solicitudes', savedObjects: 'Inmuebles guardados', savedHint: 'Tus villas y apartamentos favoritos', history: 'Historial de visitas', historyHint: 'Inmuebles vistos recientemente', noHistory: 'Aún no has visto nada', settings: 'Idioma', settingsHint: 'Русский, Українська, English, Español', compareHint: 'Hasta tres proyectos lado a lado', aboutHint: 'Equipo y cómo comprar', typeViewing: 'Visita', typeLead: 'Llamada', typeQuestion: 'Pregunta', typeSelection: 'Selección', typeInterest: 'Interés', typeGeneral: 'Solicitud' });
  Object.assign(T, { uk: { authEmpty: 'Відкрийте застосунок кнопкою в чаті Telegram: так ми дізнаємося вас і зможемо прийняти заявку.', authExpired: 'Вхід у застосунок застарів. Закрийте його й відкрийте знову кнопкою в чаті.', authOther: 'Не вдалося перевірити вхід. Закрийте застосунок і відкрийте знову кнопкою в чаті.', retry: 'Повторити', pickDay: 'Оберіть день', pickTime: 'Оберіть час', questionShort: 'Напишіть запитання', unavailable: 'Цей проєкт зараз недоступний', tooMany: 'Забагато дій поспіль. Спробуйте за кілька хвилин.', allCities: 'Усі міста', catalog: 'Об’єкти', favorites: 'Обране', compare: 'Порівняння', about: 'Про компанію', all: 'Усі', sale: 'Продаж', rent: 'Оренда', from: 'від', filters: 'Фільтри', price: 'Ціна', priceTo: 'Ціна до', anyPrice: 'Будь-яка', bedrooms: 'Спальні', anyBeds: 'Будь-яка', apply: 'Показати', reset: 'Скинути', found: 'Знайдено', none: 'Нічого не знайдено', noneHint: 'Змініть фільтри або напишіть менеджеру: підберемо варіант.', remove: 'Прибрати', book: 'Записатися на перегляд', bookShort: 'Записатися', contact: 'Зв’язатися', calc: 'Розрахунок купівлі та іпотеки', similar: 'Схожі проєкти', description: 'Про об’єкт', facts: 'Характеристики', location: 'Розташування', map: 'На мапі', video: 'Відео', site: 'Сайт проєкту', readMore: 'Читати повністю', collapse: 'Згорнути', photos: 'Фото', day: 'День', time: 'Час', morning: 'Зранку', afternoon: 'Удень', evening: 'Увечері', online: 'Онлайн-перегляд за відеозв’язком', name: 'Ваше ім’я', phone: 'Телефон', note: 'Коментар (за бажанням)', send: 'Надіслати заявку', bookTitle: 'Запис на перегляд', thanks: 'Заявку надіслано', thanksText: 'Менеджер зв’яжеться з вами та підтвердить час у чаті з ботом.', confirmed: 'Перегляд підтверджено', confirmedText: 'Час закріплено за вами. Подробиці — у чаті з ботом.', close: 'Закрити', call: 'Зателефонувати', whatsapp: 'WhatsApp', telegram: 'Написати в Telegram', email: 'Написати на e-mail', website: 'Сайт компанії', office: 'Офіс на мапі', callMe: 'Замовити дзвінок', callMeHint: 'Залиште номер: передзвонимо у зручний час', ask: 'Поставити запитання', askHint: 'Відповімо в чаті з ботом', question: 'Ваше запитання', preferred: 'Зручний час для дзвінка', compareEmpty: 'Додайте проєкти до порівняння', compareEmptyHint: 'Натисніть значок терезів на картці проєкту. Можна порівняти до трьох.', favEmpty: 'Тут поки порожньо', favEmptyHint: 'Натискайте серце на проєктах, які сподобались, щоб повернутися до них пізніше.', limit: 'Порівняти можна не більше трьох проєктів', guestHint: 'Відкрийте застосунок із Telegram, щоб зберігати та записуватися', saved: 'Збережено', removed: 'Прибрано', reservedNote: 'Об’єкт заброньовано: напишіть менеджеру', slotTaken: 'Цей час щойно зайняли: оберіть інший', phoneNeeded: 'Вкажіть телефон: менеджер підтвердить час', noTimes: 'Вільних вікон поки немає — залиште заявку, підберемо час', years: 'років', down: 'Перший внесок', term: 'Строк', rate: 'Ставка', hello: 'Вітаємо', tagline: 'Проєкти біля моря', yearsOnMarket: 'років на ринку', dealsDone: 'угод', guide: 'Як купити в Іспанії', reviews: 'Відгуки клієнтів', allReviews: 'Усі відгуки', manager: 'Ваш менеджер', share: 'Поділитися', sea: 'до пляжу', best: 'найкраще', addCompare: 'До порівняння', inCompare: 'У порівнянні', error: 'Не вдалося. Спробуйте ще раз.', loading: 'Завантаження…', reg: 'Реєстрація', addr: 'Офіс', search: 'Місто, район або об’єкт', showResults: 'Показати', backProperty: 'Повернутися до об’єкта', writeManager: 'Написати менеджеру', navHome: 'Головна', navObjects: 'Об’єкти', navFav: 'Обране', navProfile: 'Профіль', back: 'Назад', menu: 'Меню', language: 'Мова', heroTitle: 'Будуємо сучасне життя в Іспанії', heroText: 'Сучасні вілли, якісне будівництво та продумані рішення для комфортного життя на узбережжі Іспанії.', learnMore: 'Дізнатися більше', tileObjects: 'Наші об’єкти', tileBuild: 'Будівництво на замовлення', tileCalc: 'Розрахувати вартість', tileProgress: 'Об’єкти, що будуються', buildPreset: 'Хочу обговорити будівництво будинку на замовлення.', calcPick: 'Для якого проєкту рахуємо?', popular: 'Популярні об’єкти', allObjects: 'Усі об’єкти', advantages: 'Наші переваги', adv1: 'Якісне та надійне будівництво', adv2: 'Перевірені матеріали та енергоефективність', adv3: 'Проєкти на узбережжі Коста-Бланка', adv4: 'Індивідуальний підхід до кожного клієнта', ourObjects: 'Наші об’єкти', searchObjects: 'Пошук об’єктів', inSale: 'У продажу', building: 'Будується', details: 'Детальніше', compareAction: 'Порівняти', compareN: 'Порівняти об’єкти · {n}', favSub: 'Збережені об’єкти для порівняння та вибору', contactManager: 'Зв’язатися з менеджером', contactUs: 'Зв’язатися з нами', contactManagerHint: 'Поставити запитання або отримати консультацію', guestName: 'Гість', guestTag: 'Відкрийте з Telegram', clientTag: 'Клієнт компанії', guestProfile: 'Відкрийте застосунок із Telegram, щоб бачити свої заявки та обране.', requestStatus: 'Статус заявки', stepAccepted: 'Заявку прийнято', stepWork: 'Менеджер на зв’язку', stepViewing: 'Перегляд', stepDone: 'Завершено', myRequests: 'Мої заявки', myRequestsHint: 'Статус та історія звернень', noRequests: 'Заявок поки немає', savedObjects: 'Збережені об’єкти', savedHint: 'Ваші обрані вілли та апартаменти', history: 'Історія переглядів', historyHint: 'Нещодавно переглянуті об’єкти', noHistory: 'Ви поки нічого не переглядали', settings: 'Мова', settingsHint: 'Русский, Українська, English, Español', compareHint: 'До трьох проєктів поруч', aboutHint: 'Команда й як купити', typeViewing: 'Перегляд', typeLead: 'Дзвінок', typeQuestion: 'Запитання', typeSelection: 'Підбір', typeInterest: 'Інтерес', typeGeneral: 'Звернення' } });
  // ИИ-консультант: окно чата в приложении.
  [
    ['ru', { aiTitle: 'Консультант', aiHint: 'Ответит на вопросы о проектах, ценах и покупке в Испании', aiAbout: 'Вопрос про «{x}»', aiHello: 'Здравствуйте! Я консультант компании. Спросите о проектах, ценах, рассрочке или покупке в Испании.', aiPlaceholder: 'Ваш вопрос…', aiTyping: 'печатает…', aiHandoff: 'Передали ваш вопрос менеджеру — он напишет в чат с ботом.', aiForwarded: 'Вопрос передан менеджеру — ответ придёт в чат с ботом.', aiViewing: '📅 Записаться на просмотр' }],
    ['uk', { aiTitle: 'Консультант', aiHint: 'Відповість на запитання про проєкти, ціни та купівлю в Іспанії', aiAbout: 'Запитання про «{x}»', aiHello: 'Вітаємо! Я консультант компанії. Запитайте про проєкти, ціни, розстрочку чи купівлю в Іспанії.', aiPlaceholder: 'Ваше запитання…', aiTyping: 'друкує…', aiHandoff: 'Передали ваше запитання менеджеру — він напише в чат із ботом.', aiForwarded: 'Запитання передано менеджеру — відповідь прийде в чат із ботом.', aiViewing: '📅 Записатися на перегляд' }],
    ['en', { aiTitle: 'Consultant', aiHint: 'Answers questions about our projects, prices and buying in Spain', aiAbout: 'Question about “{x}”', aiHello: 'Hello! I am the company consultant. Ask about our projects, prices, payment plans or buying in Spain.', aiPlaceholder: 'Your question…', aiTyping: 'typing…', aiHandoff: 'Your question has been passed to an agent — they will message you in the bot chat.', aiForwarded: 'Your question has been passed to an agent — the reply will come in the bot chat.', aiViewing: '📅 Book a viewing' }],
    ['es', { aiTitle: 'Asesor', aiHint: 'Responde sobre nuestros proyectos, precios y la compra en España', aiAbout: 'Pregunta sobre «{x}»', aiHello: '¡Hola! Soy el asesor de la empresa. Pregunta por los proyectos, precios, pagos a plazos o la compra en España.', aiPlaceholder: 'Tu pregunta…', aiTyping: 'escribiendo…', aiHandoff: 'Hemos pasado tu pregunta a un asesor: te escribirá en el chat con el bot.', aiForwarded: 'Tu pregunta se ha pasado a un asesor: la respuesta llegará al chat con el bot.', aiViewing: '📅 Reservar una visita' }],
  ].forEach(function (pair) { T[pair[0]] = Object.assign(T[pair[0]] || {}, pair[1]); });
  // Фото и голосовое в чате консультанта
  [
    ['ru', { aiPhoto: 'Отправить фото', aiVoice: 'Записать голосовое', aiStop: 'Остановить и отправить', aiMicDenied: 'Нет доступа к микрофону. Разрешите его для Telegram или отправьте голосовое в чат с ботом.', aiPhotoBad: 'Не получилось открыть фото — попробуйте другое.', aiVoiceShort: 'Голосовое слишком короткое.' }],
    ['uk', { aiPhoto: 'Надіслати фото', aiVoice: 'Записати голосове', aiStop: 'Зупинити й надіслати', aiMicDenied: 'Немає доступу до мікрофона. Дозвольте його для Telegram або надішліть голосове в чат із ботом.', aiPhotoBad: 'Не вдалося відкрити фото — спробуйте інше.', aiVoiceShort: 'Голосове надто коротке.' }],
    ['en', { aiPhoto: 'Send a photo', aiVoice: 'Record a voice message', aiStop: 'Stop and send', aiMicDenied: 'No access to the microphone. Allow it for Telegram or send a voice message in the bot chat.', aiPhotoBad: 'Could not open the photo — try another one.', aiVoiceShort: 'The voice message is too short.' }],
    ['es', { aiPhoto: 'Enviar una foto', aiVoice: 'Grabar un audio', aiStop: 'Detener y enviar', aiMicDenied: 'No hay acceso al micrófono. Permítelo para Telegram o envía el audio en el chat con el bot.', aiPhotoBad: 'No se pudo abrir la foto: prueba con otra.', aiVoiceShort: 'El audio es demasiado corto.' }],
  ].forEach(function (pair) { T[pair[0]] = Object.assign(T[pair[0]] || {}, pair[1]); });

  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V21h-6.5v-7h-5v7H3z"/>',
    building: '<rect x="4" y="7" width="10" height="14" rx="1"/><path d="M14 11h6v10H4M7 10h3m-3 4h3m-3 4h3m10-4h-3m3 3h-3"/>',
    hardhat: '<path d="M3 15h18v3H3zM6 15V11a6 6 0 0 1 4-5m8 9V11a6 6 0 0 0-4-5M10 5v8m4-8v8M2 18q10 7 20 0"/>',
    calc: '<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="8" y="5" width="8" height="4" rx=".4"/><path d="M8 13h1m3 0h1m3 0h1M8 17h1m3 0h1m3 0h1"/>',
    progress: '<path d="M5 21V12m5 9V8m5 13V5m5 16V2"/>',
    diamond: '<path d="M7 3h10l5 7-10 12L2 10zM2 10h20M7 3l5 19L17 3"/>',
    shield: '<path d="M12 2 20 5v6c0 6-4 9-8 11-4-2-8-5-8-11V5zM8 12l3 3 5-6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 5a3 3 0 0 1 0 6m0 3a5 5 0 0 1 5 5v2"/>',
    profile: '<circle cx="12" cy="7.5" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    document: '<path d="M6 2h8l5 5v15H6zM14 2v5h5M9 12h7m-7 4h7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M9 2h6l1 3 3 1 3-1 2 5-3 2v3l2 2-3 5-3-1-3 1-1 3H9l-1-3-3-1-3 1-2-5 3-2v-3l-3-2 2-5 3 1 3-1z"/>',
    headset: '<path d="M3 13V11a9 9 0 0 1 18 0v2M3 13h4v7H5a2 2 0 0 1-2-2zm18 0h-4v7h2a2 2 0 0 0 2-2zM17 20q-1 2-5 2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    language: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a17 17 0 0 1 0 20M12 2a17 17 0 0 0 0 20"/>',
    map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
    chevron: '<path d="m9 4 8 8-8 8"/>',
    arrow: '<path d="M4 12h16m-7-7 7 7-7 7"/>',
    sort: '<path d="M4 6h16M4 12h12M4 18h8"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    bed: '<path d="M3 19V9m18 10V9M3 16h18M5 11h7a3 3 0 0 1 3 3v2M3 16V7h7a3 3 0 0 1 3 3M21 16v-5a3 3 0 0 0-3-3h-5"/>',
    bath: '<path d="M3 13h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM6 13V6a3 3 0 0 1 6 0m-7 15v1m14-1v1"/>',
    area: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M3 9l7-6m11 6-7-6M3 15l7 6m11-6-7 6"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>',
    phone: '<path d="M8 3H5a2 2 0 0 0-2 2c0 9 7 16 16 16a2 2 0 0 0 2-2v-3l-5-2-3 3a13 13 0 0 1-6-6l3-3z"/>',
    cal: '<rect x="3" y="5" width="18" height="17" rx="2"/><path d="M3 10h18M7 2v6m10-6v6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/>',
    sliders: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="9" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="7" cy="18" r="2" fill="white"/>',
    scale: '<path d="M5 4v16m-3-3 3 3 3-3m11 3V4m-3 3 3-3 3 3M11 7h2m-2 5h2m-2 5h2"/>',
    build: '<rect x="4" y="7" width="10" height="14" rx="1"/><path d="M14 11h6v10H4M7 10h3m-3 4h3m-3 4h3m10-4h-3m3 3h-3"/>',
    grid: '<path d="M3 10.5 12 3l9 7.5V21h-6.5v-7h-5v7H3z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    wave: '<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7"/>',
    floor: '<path d="M5 21V5l7-2 7 2v16M3 21h18M9 9h2M13 9h2M9 13h2M13 13h2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8zM7.5 8v.01"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    plane: '<path d="M21 4 3 11l6 2.5L11 20l3-4.5L19 18z"/>',
    mail: '<path d="M3 6h18v12H3zM3 7l9 7 9-7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/>',
    video: '<path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    photos: '<path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5v.01"/>',
  };
  function icon(name, extra) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICON[name] || '';
    if (extra) svg.setAttribute('class', extra);
    return svg;
  }
  // Флаги нарисованы самим приложением, а не символами-эмодзи: на компьютерах с Windows эмодзи-флаги показываются буквами.
  function flag(code) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 30 20');
    svg.setAttribute('class', 'flag');
    svg.setAttribute('aria-hidden', 'true');
    function shape(tag, attrs) {
      var node = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
      svg.appendChild(node);
    }
    function band(y, height, fill) { shape('rect', { x: '0', y: String(y), width: '30', height: String(height), fill: fill }); }
    if (code === 'ru') { band(0, 6.67, '#ffffff'); band(6.67, 6.67, '#0039a6'); band(13.33, 6.67, '#d52b1e'); }
    else if (code === 'uk') { band(0, 10, '#0057b7'); band(10, 10, '#ffd700'); }
    else if (code === 'es') { band(0, 5, '#aa151b'); band(5, 10, '#f1bf00'); band(15, 5, '#aa151b'); }
    else {
      band(0, 20, '#012169');
      shape('path', { d: 'M0 0L30 20M30 0L0 20', stroke: '#ffffff', 'stroke-width': '4' });
      shape('path', { d: 'M0 0L30 20M30 0L0 20', stroke: '#c8102e', 'stroke-width': '1.6' });
      shape('rect', { x: '12', y: '0', width: '6', height: '20', fill: '#ffffff' });
      shape('rect', { x: '0', y: '7', width: '30', height: '6', fill: '#ffffff' });
      shape('rect', { x: '13', y: '0', width: '4', height: '20', fill: '#c8102e' });
      shape('rect', { x: '0', y: '8', width: '30', height: '4', fill: '#c8102e' });
    }
    return svg;
  }
  var FACT_ICON = { bedrooms: 'bed', bathrooms: 'bath', area: 'area', plot: 'leaf', sea: 'wave', floor: 'floor', condition: 'building', reference: 'tag' };

  /* ---------- вспомогательное ---------- */
  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === false || value == null) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (kids || []).forEach(function (kid) {
      if (kid == null || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cap(text) { text = String(text || ''); return text.charAt(0).toUpperCase() + text.slice(1); }
  function paintRange(input) {
    var min = Number(input.min || 0), max = Number(input.max || 100), value = Number(input.value);
    input.style.setProperty('--p', (max > min ? (value - min) / (max - min) * 100 : 0) + '%');
  }
  function nbsp(text) { return String(text == null ? '' : text); }
  var S = { lang: 'ru', scrolls: { home: 0, objects: 0, fav: 0 }, loadSeq: 0, renderSeq: 0, boot: null, route: { name: 'home' }, filters: { query: '', type: '', city: '', deal: '', maxPrice: 0, beds: 0, building: false }, detail: {}, sheets: [], scroll: 0 };
  function t(key) { return (T[S.lang] || T.ru)[key] || T.ru[key] || key; }
  function store(key, value) { try { if (value === undefined) return window.localStorage.getItem(key); window.localStorage.setItem(key, value); } catch (e) { return null; } return null; }
  function haptic(kind) { try { if (tg && tg.HapticFeedback) { if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success'); else if (kind === 'err') tg.HapticFeedback.notificationOccurred('error'); else tg.HapticFeedback.impactOccurred('light'); } } catch (e) { return; } }
  function toast(text) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var node = h('div', { class: 'toast', text: text });
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2600);
  }
  function openLink(url) {
    if (!url) return;
    try {
      if (tg && /^https:\/\/(t\.me|telegram\.me)\//.test(url) && tg.openTelegramLink) return tg.openTelegramLink(url);
      if (tg && tg.openLink && /^https?:/.test(url)) return tg.openLink(url);
    } catch (e) { /* ниже обычный переход */ }
    window.open(url, '_blank');
  }
  function api(path, method, body) {
    var headers = { 'content-type': 'application/json' };
    if (tg && tg.initData) headers['x-tg-init-data'] = tg.initData;
    if (devMatch) headers['x-dev-user'] = devMatch[1];
    var options = { method: method || 'GET', headers: headers };
    if (body) {
      if (options.method === 'POST' && S.lang) body.lang = S.lang;
      options.body = JSON.stringify(body);
    }
    return fetch('/api/app' + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(errorText(data));
          error.status = response.status;
          error.code = data.code || '';
          throw error;
        }
        return data;
      });
    });
  }
  var ERROR_KEYS = { 'phone-required': 'phoneNeeded', 'question-short': 'questionShort', 'pick-day': 'pickDay', 'pick-time': 'pickTime', unavailable: 'unavailable', reserved: 'reservedNote', 'slot-taken': 'slotTaken', limit: 'limit', 'too-many': 'tooMany', 'auth-empty': 'authEmpty', 'auth-no-token': 'authEmpty', 'auth-expired': 'authExpired' };
  function errorText(data) {
    var code = data && data.code ? data.code : '';
    var key = code ? ERROR_KEYS[code] : '';
    if (!key && code.indexOf('auth-') === 0) key = 'authOther';
    return key ? t(key) : t('error');
  }
  var tracked = {};
  function track(id, event) {
    var key = id + ':' + event;
    if (isGuest() || tracked[key]) return;
    tracked[key] = true;
    api('/track', 'POST', { id: id, event: event }).catch(function () { return null; });
  }
  function isGuest() { return !S.boot || S.boot.guest; }
  function isFavorite(id) { return S.boot && S.boot.favorites.indexOf(id) >= 0; }
  function inCompare(id) { return S.boot && S.boot.compare.indexOf(id) >= 0; }
  function cardById(id) { return S.boot ? S.boot.cards.filter(function (card) { return card.id === id; })[0] : null; }

  /* ---------- тема Telegram ---------- */
  function applyTheme() {
    var scheme = tg && tg.colorScheme ? tg.colorScheme : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', scheme);
    try {
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (tg && tg.setHeaderColor && bg) { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); }
    } catch (e) { return; }
  }

  /* ---------- листы ---------- */
  function openSheet(build) {
    var scrim = h('div', { class: 'scrim' });
    var sheet = h('div', { class: 'sheet', role: 'dialog' });
    var entry = { scrim: scrim, sheet: sheet };
    function close() {
      var index = S.sheets.indexOf(entry);
      if (index < 0) return;
      S.sheets.splice(index, 1);
      scrim.remove();
      sheet.remove();
      syncBack();
    }
    entry.close = close;
    scrim.addEventListener('click', close);
    sheet.appendChild(h('div', { class: 'grip' }));
    build(sheet, close);
    S.sheets.push(entry);
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    syncBack();
    return entry;
  }
  function syncBack() {
    if (!tg || !tg.BackButton) return;
    var tabRoute = ['home', 'objects', 'fav', 'profile'].indexOf(S.route.name) >= 0;
    if (S.sheets.length || !tabRoute) tg.BackButton.show();
    else tg.BackButton.hide();
  }
  function goBack() {
    if (S.sheets.length) return S.sheets[S.sheets.length - 1].close();
    if (document.querySelector('.viewer')) return document.querySelector('.viewer').remove();
    if (history.length > 1) history.back(); else go('home');
  }

  /* ---------- маршруты ---------- */
  function parseHash() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/');
    if (parts[0] === 'p' && parts[1]) return { name: 'property', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'objects') return { name: 'objects' };
    if (parts[0] === 'fav') return { name: 'fav' };
    if (parts[0] === 'cmp') return { name: 'cmp' };
    if (parts[0] === 'profile') return { name: 'profile' };
    if (parts[0] === 'about') return { name: 'about' };
    if (parts[0] === 'contacts') return { name: 'contacts' };
    return { name: 'home' };
  }
  function go(name, id) {
    if (S.route && S.scrolls[S.route.name] !== undefined) S.scrolls[S.route.name] = window.scrollY;
    var hash = name === 'property' ? '#/p/' + encodeURIComponent(id) : name === 'home' ? '#/' : '#/' + name;
    if (location.hash === hash) render(); else location.hash = hash;
  }
  window.addEventListener('hashchange', function () {
    S.sheets.slice().forEach(function (entry) { entry.close(); });
    var viewer = document.querySelector('.viewer');
    if (viewer) viewer.remove();
    S.route = parseHash();
    render();
  });

  /* ---------- карточка проекта ---------- */
  function heartButton(card) {
    var button = h('button', { class: 'icon-btn heart' + (isFavorite(card.id) ? ' on' : ''), 'aria-label': t('favorites') }, [icon('heart')]);
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleFavorite(card.id, button);
    });
    return button;
  }
  function toggleFavorite(id, button) {
    if (isGuest()) { toast(t('guestHint')); return; }
    var want = !isFavorite(id);
    var list = S.boot.favorites;
    S.boot.favorites = want ? list.concat([id]) : list.filter(function (item) { return item !== id; });
    if (button) button.classList.toggle('on', want);
    haptic();
    api('/favorite', 'POST', { id: id, on: want }).then(function (result) {
      S.boot.favorites = result.favorites;
      updateTabs();
    }).catch(function (error) {
      S.boot.favorites = list;
      if (button) button.classList.toggle('on', !want);
      toast(error.message);
    });
    toast(want ? t('saved') : t('removed'));
    updateTabs();
  }
  function toggleCompare(id, button) {
    if (isGuest()) { toast(t('guestHint')); return; }
    var want = !inCompare(id);
    var list = S.boot.compare;
    if (want && list.length >= 3) { toast(t('limit')); haptic('err'); return; }
    S.boot.compare = want ? list.concat([id]) : list.filter(function (item) { return item !== id; });
    if (button) button.classList.toggle('on', want);
    haptic();
    api('/compare', 'POST', { id: id, on: want }).then(function (result) {
      S.boot.compare = result.compare;
      updateTabs();
    }).catch(function (error) {
      S.boot.compare = list;
      if (button) button.classList.toggle('on', !want);
      toast(error.status === 409 ? t('limit') : error.message);
    });
    updateTabs();
  }
  function factChip(fact) {
    return h('span', { class: 'fact' }, [icon(FACT_ICON[fact.key] || 'tag'), fact.value]);
  }
  function priceBlock(price, big) {
    var parts = [];
    if (price.previous) parts.push(h('s', { text: price.previous }));
    parts.push(document.createTextNode(price.text));
    return parts;
  }
  // Один статус на фото, как в макете: «В продаже» зелёным, «Новый объект» жёлтым; строящимся — голубым.
  function statusBadges(card) {
    var list = [];
    if (card.reserved) list.push(h('span', { class: 'badge reserved', text: card.reservedLabel }));
    else if (card.badges.length) list.push(h('span', { class: 'badge fresh', text: card.badges[0] }));
    else if (card.underConstruction) list.push(h('span', { class: 'badge build', text: card.condition || t('building') }));
    else list.push(h('span', { class: 'badge sale', text: card.deal === 'rent' ? t('rent') : t('inSale') }));
    if (card.price.previous) list.push(h('span', { class: 'badge drop', text: '↓' }));
    return list;
  }
  function factOrder(card) {
    var order = ['area', 'bedrooms', 'bathrooms'];
    return order.map(function (key) { return card.facts.filter(function (fact) { return fact.key === key; })[0]; }).filter(Boolean);
  }
  function openProperty(card) { go('property', card.id); }
  function cardEl(card, index, mode) {
    var row = mode === 'row';
    var photo = h('div', { class: 'photo' });
    if (card.cover) photo.appendChild(h('img', { src: card.cover, alt: card.title, loading: index > 1 ? 'lazy' : 'eager', decoding: 'async' }));
    photo.appendChild(h('div', { class: 'badges' }, statusBadges(card)));
    if (!row) photo.appendChild(heartButton(card));
    var place = h('div', { class: 'place' }, [icon('pin'), card.place || card.typeLabel]);
    var body;
    if (row) {
      var compareButton = h('button', { class: 'btn soft', onclick: function (event) { event.stopPropagation(); toggleCompare(card.id); setTimeout(render, 120); } }, [icon('scale'), t('compareAction')]);
      if (inCompare(card.id)) compareButton.classList.add('picked');
      body = h('div', { class: 'body' }, [
        h('div', { class: 'head' }, [h('h3', { text: card.title }), heartButton(card)]),
        place,
        h('div', { class: 'card-price' }, priceBlock(card.price)),
        h('div', { class: 'facts-row' }, factOrder(card).map(factChip)),
        h('div', { class: 'acts' }, [
          h('button', { class: 'btn red', onclick: function (event) { event.stopPropagation(); openProperty(card); } }, [t('details'), icon('arrow')]),
          compareButton,
        ]),
      ]);
    } else {
      body = h('div', { class: 'body' }, [
        h('h3', { text: card.title }),
        place,
        h('div', { class: 'card-price' }, priceBlock(card.price)),
        h('div', { class: 'facts-row' }, factOrder(card).map(factChip)),
      ]);
    }
    var node = h('article', { class: 'card' + (row ? ' row' : ''), role: 'button', tabindex: '0', style: false }, [photo, body]);
    node.style.animationDelay = Math.min(index || 0, 6) * 50 + 'ms';
    node.addEventListener('click', function () { openProperty(card); });
    node.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProperty(card); } });
    return node;
  }

  /* ---------- шапка и общие листы ---------- */
  function backRow() {
    return h('div', { style: false }, [h('button', { class: 'btn soft small', onclick: goBack }, [icon('back'), t('back')])]);
  }
  function openLanguage() {
    openSheet(function (sheet, close) {
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('language') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      var names = { ru: 'Русский', uk: 'Українська', en: 'English', es: 'Español' };
      var list = h('div', { class: 'menu-rows' });
      ['ru', 'uk', 'en', 'es'].forEach(function (code) {
        list.appendChild(h('button', { class: 'menu-row cyan', onclick: function () { close(); setLanguage(code); } }, [
          flag(code), h('span', { class: 'grow' }, [h('b', { text: names[code] }), h('small', { text: code.toUpperCase() })]), S.lang === code ? icon('check') : null,
        ]));
      });
      sheet.appendChild(list);
    });
  }
  function openMenu() {
    openSheet(function (sheet, close) {
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('menu') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      var list = h('div', { class: 'menu-rows' });
      function row(color, iconName, title, route) {
        list.appendChild(h('button', { class: 'menu-row ' + color, onclick: function () { close(); go(route); } }, [icon(iconName), h('span', { class: 'grow' }, [h('b', { text: title })]), icon('chevron')]));
      }
      row('red', 'home', t('navHome'), 'home');
      row('red', 'building', t('navObjects'), 'objects');
      row('red', 'heart', t('navFav'), 'fav');
      row('cyan', 'scale', t('compare'), 'cmp');
      row('yellow', 'document', t('about'), 'about');
      list.appendChild(h('button', { class: 'menu-row cyan', onclick: function () { close(); go('contacts'); } }, [icon('headset'), h('span', { class: 'grow' }, [h('b', { text: t('contactUs') })]), icon('chevron')]));
      sheet.appendChild(list);
    });
  }
  function headerEl() {
    var company = S.boot.company;
    var language = h('button', { class: 'hbtn', 'aria-label': t('language'), onclick: openLanguage }, [flag(S.lang), h('span', { class: 'code', text: S.lang.toUpperCase() })]);
    var profile = h('button', { class: 'hbtn', 'aria-label': t('navProfile'), onclick: function () { go('profile'); } }, [icon('profile')]);
    var menu = h('button', { class: 'hbtn plain', 'aria-label': t('menu'), onclick: openMenu }, [icon('menu')]);
    return h('header', { class: 'top' }, [h('div', { class: 'top-row' }, [
      h('button', { class: 'logo-link', 'aria-label': company.name, onclick: function () { go('home'); } }, [h('img', { class: 'logo', src: '/logo.png', alt: company.name })]),
      h('div', { class: 'top-actions' }, [language, profile, menu]),
    ])]);
  }

  /* ---------- главная ---------- */
  function searchKey(value) {
    return String(value || '').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }
  function cardMatchesFilters(card, f) {
    var query = searchKey(f.query);
    if (query && searchKey([card.title, card.typeLabel, card.place, card.city, card.reference].filter(Boolean).join(' ')).indexOf(query) < 0) return false;
    if (f.type && card.type !== f.type) return false;
    if (f.city && card.city !== f.city) return false;
    if (f.deal && card.deal !== f.deal) return false;
    if (f.building && !card.underConstruction) return false;
    if (f.maxPrice && card.raw.price && card.raw.price > f.maxPrice) return false;
    if (f.beds && card.raw.bedroomsMax < f.beds) return false;
    return true;
  }
  function filteredCards(value) {
    var f = value || S.filters;
    return S.boot.cards.filter(function (card) { return cardMatchesFilters(card, f); });
  }
  function filtersActive() {
    var f = S.filters;
    return Boolean(f.query || f.type || f.city || f.deal || f.maxPrice || f.beds || f.building);
  }
  function emptyFilters() { return { query: '', type: '', city: '', deal: '', maxPrice: 0, beds: 0, building: false }; }
  function chipRow(options, current, onPick) {
    return h('div', { class: 'chips' }, options.map(function (option) {
      return h('button', { class: 'chip' + (option.key === current ? ' on' : ''), text: option.label, onclick: function () { onPick(option.key); } });
    }));
  }
  function openCalcPicker() {
    openSheet(function (sheet, close) {
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('calcPick') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      var list = h('div', { class: 'menu-rows' });
      S.boot.cards.filter(function (card) { return !card.price.rent && card.raw.price > 0; }).forEach(function (card) {
        list.appendChild(h('button', { class: 'menu-row cyan', onclick: function () { close(); S.focusCalc = true; go('property', card.id); } }, [
          icon('calc'), h('span', { class: 'grow' }, [h('b', { text: card.title }), h('small', { text: card.price.text })]), icon('chevron'),
        ]));
      });
      sheet.appendChild(list);
    });
  }
  function actionTile(color, iconName, label, onClick) {
    return h('button', { class: 'action ' + color, onclick: onClick }, [icon(iconName), h('span', { text: label }), icon('chevron', 'chev')]);
  }
  var ADVANTAGES = [['diamond', 'adv1'], ['shield', 'adv2'], ['pin', 'adv3'], ['users', 'adv4']];
  function renderLanding(view) {
    var company = S.boot.company;
    var page = h('div', { class: 'page' });
    page.appendChild(h('section', { class: 'hero' }, [
      h('img', { src: '/hero.jpg', alt: '', decoding: 'async' }),
      h('div', { class: 'hero-copy' }, [
        h('h1', { text: t('heroTitle') }),
        h('p', { text: t('heroText') }),
        h('button', { class: 'btn primary', onclick: function () { go('about'); } }, [t('learnMore'), icon('arrow')]),
      ]),
    ]));
    var tiles = [
      actionTile('red', 'home', t('tileObjects'), function () { S.filters = emptyFilters(); go('objects'); }),
      actionTile('yellow', 'hardhat', t('tileBuild'), function () { openQuestion(null, t('buildPreset')); }),
      S.boot.calculatorOn
        ? actionTile('cyan', 'calc', t('tileCalc'), openCalcPicker)
        : actionTile('cyan', 'headset', t('contactUs'), function () { go('contacts'); }),
      actionTile('red', 'progress', t('tileProgress'), function () { S.filters = emptyFilters(); S.filters.building = true; go('objects'); }),
    ];
    page.appendChild(h('div', { class: 'actions' }, tiles));
    var cards = S.boot.cards.slice().sort(function (a, b) { return Number(a.reserved) - Number(b.reserved); }).slice(0, 6);
    if (cards.length) {
      page.appendChild(h('div', { class: 'section-head' }, [h('h2', { text: t('popular') }), h('button', { onclick: function () { S.filters = emptyFilters(); go('objects'); } }, [t('allObjects'), icon('chevron')])]));
      page.appendChild(h('div', { class: 'hscroll' }, cards.map(function (card, index) { return cardEl(card, index); })));
    }
    page.appendChild(h('div', { class: 'section-head' }, [h('h2', { text: t('advantages') })]));
    page.appendChild(h('div', { class: 'adv' }, ADVANTAGES.map(function (item) {
      return h('div', { class: 'adv-item' }, [icon(item[0]), h('span', { text: t(item[1]) })]);
    })));
    view.appendChild(page);
  }
  function renderObjects(view) {
    var facets = S.boot.facets;
    var page = h('div', { class: 'page' });
    var count = h('span', { class: 'catalog-count' });
    page.appendChild(h('div', { class: 'page-title' }, [h('h1', { text: t('ourObjects') }), count]));
    var query = h('input', { type: 'search', value: S.filters.query || '', placeholder: t('searchObjects'), autocomplete: 'off', enterkeyhint: 'search', 'aria-label': t('searchObjects') });
    var filterButton = h('button', { class: 'search-filter', 'aria-label': t('filters'), onclick: openFilters }, [icon('sliders')]);
    page.appendChild(h('div', { class: 'catalog-search' }, [icon('search'), query, filterButton]));
    var typeOptions = [{ key: '', label: t('all') }].concat(facets.types.map(function (item) { return { key: item.key, label: item.label }; }));
    if (facets.types.length > 1) page.appendChild(chipRow(typeOptions, S.filters.type, function (key) { S.filters.type = key; render(); }));
    var row = h('div', { class: 'chips' });
    if (facets.cities.length > 1) {
      [{ key: '', label: t('allCities') }].concat(facets.cities.map(function (city) { return { key: city, label: city }; })).forEach(function (option) {
        row.appendChild(h('button', { class: 'chip' + (option.key === S.filters.city ? ' on' : ''), text: option.label, onclick: function () { S.filters.city = option.key; render(); } }));
      });
    }
    if (S.filters.building) row.appendChild(h('button', { class: 'chip on', onclick: function () { S.filters.building = false; render(); } }, [t('tileProgress') + ' ×']));
    row.appendChild(h('button', { class: 'chip filter-chip' + (S.filters.maxPrice || S.filters.beds || S.filters.deal ? ' on' : ''), onclick: openFilters }, [icon('sliders'), t('filters')]));
    page.appendChild(row);
    var list = h('div', { class: 'list' });
    function paintList() {
      var cards = filteredCards();
      clear(list);
      count.textContent = t('found') + ': ' + cards.length;
      filterButton.classList.toggle('on', filtersActive());
      if (!cards.length) {
        list.appendChild(h('div', { class: 'empty', style: false }, [icon('building'), h('h3', { text: t('none') }), h('div', { text: t('noneHint') }), h('div', { style: false }, [
          h('button', { class: 'btn soft', style: false, onclick: function () { S.filters = emptyFilters(); render(); } }, [t('reset')]),
        ])]));
      } else cards.forEach(function (card, index) { list.appendChild(cardEl(card, index)); });
    }
    query.addEventListener('input', function () { S.filters.query = query.value; paintList(); });
    paintList();
    page.appendChild(list);
    view.appendChild(page);
  }
  function openFilters() {
    var facets = S.boot.facets;
    var draft = { query: S.filters.query, type: S.filters.type, city: S.filters.city, deal: S.filters.deal, maxPrice: S.filters.maxPrice, beds: S.filters.beds, building: S.filters.building };
    openSheet(function (sheet, close) {
      var priceLabel = h('output');
      var range = h('input', { type: 'range' });
      var applyButton = null;
      function paintApply() {
        if (applyButton) applyButton.textContent = t('showResults') + ' · ' + filteredCards(draft).length;
      }
      function choiceRow(options, field) {
        var row = h('div', { class: 'filter-options' });
        function repaint() {
          clear(row);
          options.forEach(function (option) {
            row.appendChild(h('button', { class: 'chip' + (option.key === draft[field] ? ' on' : ''), text: option.label, onclick: function () { draft[field] = option.key; repaint(); paintApply(); } }));
          });
        }
        repaint();
        return row;
      }
      var maxValue = facets.price ? facets.price.max : 0;
      var minValue = facets.price ? facets.price.min : 0;
      var step = maxValue > 500000 ? 25000 : 10000;
      range.min = String(Math.max(0, Math.floor(minValue / step) * step));
      range.max = String(Math.ceil(maxValue / step) * step);
      range.step = String(step);
      range.value = String(draft.maxPrice || range.max);
      function paint() {
        var value = Number(range.value);
        priceLabel.textContent = value >= Number(range.max) ? t('anyPrice') : '≤ ' + new Intl.NumberFormat(S.lang).format(value) + ' €';
      }
      paintRange(range);
      range.addEventListener('input', function () { paintRange(range); draft.maxPrice = Number(range.value) >= Number(range.max) ? 0 : Number(range.value); paint(); paintApply(); });
      paint();
      var dealChips = facets.deals.length > 1 ? choiceRow([{ key: '', label: t('all') }, { key: 'sale', label: t('sale') }, { key: 'rent', label: t('rent') }], 'deal') : null;
      var typeOptions = [{ key: '', label: t('all') }].concat(facets.types.map(function (item) { return { key: item.key, label: item.label }; }));
      var typeChips = facets.types.length ? choiceRow(typeOptions, 'type') : null;
      var cityOptions = [{ key: '', label: t('allCities') }].concat(facets.cities.map(function (city) { return { key: city, label: city }; }));
      var cityChips = facets.cities.length > 1 ? choiceRow(cityOptions, 'city') : null;
      var bedOptions = [{ key: 0, label: t('anyBeds') }];
      for (var i = 1; i <= Math.min(4, facets.maxBedrooms); i += 1) bedOptions.push({ key: i, label: i + '+' });
      var bedRow = facets.maxBedrooms > 0 ? choiceRow(bedOptions, 'beds') : null;
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('filters') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      if (dealChips) sheet.appendChild(h('div', { class: 'filter-block' }, [h('h3', { text: t('sale') + ' / ' + t('rent') }), dealChips]));
      if (typeChips) sheet.appendChild(h('div', { class: 'filter-block' }, [h('h3', { text: S.lang === 'ru' ? 'Тип объекта' : S.lang === 'uk' ? 'Тип об’єкта' : S.lang === 'es' ? 'Tipo de inmueble' : 'Property type' }), typeChips]));
      if (cityChips) sheet.appendChild(h('div', { class: 'filter-block' }, [h('h3', { text: t('location') }), cityChips]));
      if (facets.price) sheet.appendChild(h('div', { class: 'filter-block slider' }, [h('label', null, [t('priceTo'), priceLabel]), range]));
      if (bedRow) sheet.appendChild(h('div', { class: 'filter-block' }, [h('h3', { text: t('bedrooms') }), bedRow]));
      applyButton = h('button', { class: 'btn red', onclick: function () { S.filters = draft; close(); go('objects'); } }, [t('showResults')]);
      paintApply();
      sheet.appendChild(h('div', { class: 'filter-actions' }, [
        h('button', { class: 'btn soft', onclick: function () { S.filters = emptyFilters(); close(); render(); } }, [t('reset')]),
        applyButton,
      ]));
    });
  }

  /* ---------- страница объекта ---------- */
  function loadDetail(id) {
    var lang = S.lang;
    if (S.detail[id] && S.detail[id].lang === lang) return Promise.resolve(S.detail[id].data);
    return api('/property/' + encodeURIComponent(id) + '?lang=' + lang).then(function (data) {
      S.detail[id] = { lang: lang, data: data };
      return data;
    });
  }
  function openViewer(images, start) {
    var viewer = h('div', { class: 'viewer' });
    var slides = h('div', { class: 'slides' }, images.map(function (src) { return h('img', { src: src, alt: '' }); }));
    var counter = h('div', { class: 'counter', text: (start + 1) + ' / ' + images.length });
    slides.addEventListener('scroll', function () {
      var index = Math.round(slides.scrollLeft / slides.clientWidth);
      counter.textContent = (index + 1) + ' / ' + images.length;
    });
    viewer.appendChild(slides);
    viewer.appendChild(counter);
    viewer.appendChild(h('button', { class: 'icon-btn close', 'aria-label': t('close'), onclick: function () { viewer.remove(); } }, [icon('x')]));
    document.body.appendChild(viewer);
    slides.scrollLeft = start * slides.clientWidth;
  }
  function galleryEl(detail) {
    var images = detail.images.length ? detail.images : (detail.cover ? [detail.cover] : []);
    var slides = h('div', { class: 'slides' }, images.map(function (src, index) {
      var image = h('img', { src: src, alt: detail.title, loading: index ? 'lazy' : 'eager', decoding: 'async' });
      image.addEventListener('click', function () { track(detail.id, 'galleries'); openViewer(images, index); });
      return image;
    }));
    var dots = h('div', { class: 'dots' }, images.slice(0, 10).map(function (src, index) { return h('i', { class: index ? '' : 'on' }); }));
    slides.addEventListener('scroll', function () {
      var index = Math.round(slides.scrollLeft / slides.clientWidth);
      Array.prototype.forEach.call(dots.children, function (dot, position) { dot.classList.toggle('on', position === index); });
    });
    var back = h('button', { class: 'icon-btn back', 'aria-label': t('close'), onclick: goBack }, [icon('back')]);
    var buttons = h('div', { class: 'share' }, []);
    if (detail.shareUrl) buttons.appendChild(h('button', { class: 'icon-btn', 'aria-label': t('share'), onclick: function () { openLink(detail.shareUrl); } }, [icon('share')]));
    buttons.appendChild(heartButton(detail));
    var node = h('div', { class: 'gallery' }, [slides, images.length > 1 ? dots : null, back, buttons]);
    var fav = buttons.lastChild;
    fav.classList.remove('heart');
    return node;
  }
  function money(value, currency) {
    var symbols = { EUR: '€', USD: '$', GBP: '£' };
    return new Intl.NumberFormat(S.lang, { maximumFractionDigits: 0 }).format(Math.round(value)) + ' ' + (symbols[currency] || currency || '€');
  }
  function calculatorEl(calc) {
    var down = calc.defaults.down, years = calc.defaults.years, rate = calc.defaults.interest;
    var box = h('div', { class: 'calc' });
    var result = h('div');
    function slider(label, min, max, step, value, onInput, format) {
      var out = h('output', { text: format(value) });
      var input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
      paintRange(input);
      input.addEventListener('input', function () { paintRange(input); out.textContent = format(Number(input.value)); onInput(Number(input.value)); paint(); });
      return h('div', { class: 'slider' }, [h('label', null, [label, out]), input]);
    }
    function paint() {
      var price = calc.price;
      var costs = calc.costs.map(function (item) { return { label: item.label, percent: item.percent, amount: price * item.percent / 100 }; });
      var costsTotal = costs.reduce(function (sum, item) { return sum + item.amount; }, 0);
      var downPayment = price * down / 100;
      var loan = price - downPayment;
      var months = years * 12, monthlyRate = rate / 100 / 12;
      var monthly = loan > 0 ? (monthlyRate ? loan * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)) : loan / months) : 0;
      clear(result);
      if (loan > 0) result.appendChild(h('div', { class: 'monthly' }, [h('small', { text: calc.labels.mortgage }), h('b', { text: '≈ ' + money(monthly, calc.currency) }), h('small', { text: calc.labels.monthly })]));
      var lines = [h('div', { class: 'calc-line' }, [h('span', { text: calc.labels.price }), h('b', { text: money(price, calc.currency) })])];
      costs.forEach(function (item) {
        lines.push(h('div', { class: 'calc-line' }, [h('span', { text: item.label + ' ' + String(item.percent).replace('.', S.lang === 'en' ? '.' : ',') + '%' }), h('span', { text: money(item.amount, calc.currency) })]));
      });
      lines.push(h('div', { class: 'calc-line big' }, [h('span', { text: cap(calc.labels.total) }), h('span', { text: '≈ ' + money(price + costsTotal, calc.currency) })]));
      lines.push(h('div', { class: 'calc-line' }, [h('span', { text: cap(calc.labels.loan) }), h('span', { text: money(loan, calc.currency) })]));
      lines.push(h('div', { class: 'calc-line big' }, [h('span', { text: cap(calc.labels.upfront) }), h('span', { text: '≈ ' + money(downPayment + costsTotal, calc.currency) })]));
      result.appendChild(h('div', { style: false }, lines));
      if (calc.note) result.appendChild(h('div', { class: 'note', text: calc.note }));
      result.appendChild(h('div', { class: 'note', text: calc.disclaimer }));
    }
    // Значение из настроек владельца всегда помещается на бегунок, даже если оно вне обычных границ.
    var touched = false;
    function once() {
      if (!touched) { touched = true; if (calc.propertyId) track(calc.propertyId, 'calculator'); }
    }
    box.appendChild(slider(t('down'), Math.min(10, down), Math.max(90, down), down % 5 ? 1 : 5, down, function (v) { once(); down = v; }, function (v) { return v + '%'; }));
    box.appendChild(slider(t('term'), Math.min(5, years), Math.max(30, years), 1, years, function (v) { once(); years = v; }, function (v) { return v + ' ' + t('years'); }));
    box.appendChild(slider(t('rate'), Math.min(1, rate), Math.max(8, rate), 0.25, rate, function (v) { once(); rate = v; }, function (v) { return String(v).replace('.', S.lang === 'en' ? '.' : ',') + '%'; }));
    box.appendChild(result);
    paint();
    return box;
  }
  function descriptionEl(description) {
    var node = h('div');
    if (description.intro) node.appendChild(h('p', { class: 'prose', text: description.intro }));
    if (description.bullets.length) {
      node.appendChild(h('ul', { class: 'ticks' }, description.bullets.map(function (line) { return h('li', null, [icon('check'), line]); })));
    }
    description.paragraphs.forEach(function (paragraph) { node.appendChild(h('p', { class: 'prose', text: paragraph })); });
    return node;
  }
  function renderProperty(view) {
    var id = S.route.id;
    var token = ++S.renderSeq;
    var page = h('div', { class: 'page' }, [h('div', { class: 'skel' })]);
    view.appendChild(page);
    loadDetail(id).then(function (detail) {
      if (S.route.name !== 'property' || S.route.id !== id || token !== S.renderSeq) return;
      clear(view);
      var body = h('div', { class: 'page' });
      body.appendChild(galleryEl(detail));
      var badges = h('div', { class: 'chips' });
      if (detail.reserved) badges.appendChild(h('span', { class: 'badge reserved', text: detail.reservedLabel }));
      if (detail.condition) badges.appendChild(h('span', { class: 'badge build', text: detail.condition }));
      detail.badges.forEach(function (label) { badges.appendChild(h('span', { class: 'badge', text: label })); });
      body.appendChild(h('div', { class: 'sheet-head' }, [h('div', null, [h('h1', { text: detail.title }), h('div', { class: 'place', style: false }, [])]), null]));
      var placeLine = h('div', { class: 'sub', text: detail.typeLabel + (detail.place ? ' · ' + detail.place : '') });
      body.appendChild(placeLine);
      var price = h('div', { class: 'big-price' }, priceBlock(detail.price));
      body.appendChild(price);
      if (detail.price.line && detail.price.line !== detail.price.text) {
        var per = detail.price.line.split('·').slice(1).join('·').trim();
        if (per) body.appendChild(h('div', { class: 'per', text: per }));
      }
      if (badges.childNodes.length) body.appendChild(h('div', { style: false }, [badges]));
      if (detail.factsFull.length) {
        body.appendChild(h('div', { class: 'tiles' }, detail.factsFull.map(function (fact) {
          return h('div', { class: 'tile' }, [h('div', { class: 'ico' }, [icon(FACT_ICON[fact.key] || 'tag')]), h('div', null, [h('small', { text: fact.label }), h('b', { text: fact.value })])]);
        })));
      }
      var hasText = detail.description.intro || detail.description.bullets.length || detail.description.paragraphs.length;
      if (hasText) body.appendChild(h('section', { class: 'section' }, [h('h3', { text: t('description') }), descriptionEl(detail.description)]));
      var links = h('div', { class: 'links' });
      if (detail.links.map) links.appendChild(h('button', { class: 'btn soft', onclick: function () { openLink(detail.links.map); } }, [icon('pin'), t('map')]));
      if (detail.links.video) links.appendChild(h('button', { class: 'btn soft', onclick: function () { openLink(detail.links.video); } }, [icon('video'), t('video')]));
      if (detail.links.site) links.appendChild(h('button', { class: 'btn soft', onclick: function () { openLink(detail.links.site); } }, [icon('globe'), t('site')]));
      if (links.childNodes.length) body.appendChild(h('section', { class: 'section' }, [h('h3', { text: t('location') }), links]));
      if (detail.calculator) {
        detail.calculator.propertyId = detail.id;
        body.appendChild(h('section', { class: 'section calc-section' }, [h('h3', { text: t('calc') }), calculatorEl(detail.calculator)]));
      }
      if (detail.similar.length) {
        body.appendChild(h('section', { class: 'section' }, [h('h3', { text: t('similar') }), h('div', { class: 'hscroll' }, detail.similar.map(function (card, index) { return cardEl(card, index); }))]));
      }
      body.appendChild(h('div', { style: false }, []));
      view.appendChild(body);
      var spacer = h('div', { style: false });
      spacer.style.height = '84px';
      body.appendChild(spacer);
      var compareButton = h('button', { class: 'icon-btn' + (inCompare(detail.id) ? ' on' : ''), 'aria-label': t('addCompare') }, [icon('scale')]);
      compareButton.addEventListener('click', function () { toggleCompare(detail.id, compareButton); });
      var bar = h('div', { class: 'cta' }, [
        compareButton,
        h('button', { class: 'icon-btn', 'aria-label': t('contact'), onclick: function () { openContact(detail); } }, [icon('chat')]),
        h('button', { class: 'btn primary', onclick: function () { openBooking(detail); } }, [icon('cal'), h('span', { text: t('bookShort') })]),
      ]);
      view.appendChild(bar);
      window.scrollTo(0, 0);
      if (S.focusCalc) {
        S.focusCalc = false;
        var target = document.querySelector('.calc-section');
        if (target) target.scrollIntoView();
      }
      syncBack();
    }).catch(function (error) {
      clear(view);
      view.appendChild(h('div', { class: 'page' }, [h('div', { class: 'empty' }, [icon('info'), h('h3', { text: error.message })])]));
    });
  }

  /* ---------- запись и связь ---------- */
  function field(label, input) {
    return h('div', { class: 'field' }, [h('label', { text: label }), input]);
  }
  function openBooking(detail) {
    if (detail.reserved) { toast(t('reservedNote')); return; }
    openSheet(function (sheet, close) {
      var state = { day: '', time: '', online: false };
      var body = h('div');
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('bookTitle') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      var summary = h('div', { class: 'booking-summary' }, []);
      if (detail.cover) summary.appendChild(h('img', { src: detail.cover, alt: '' }));
      summary.appendChild(h('div', null, [h('b', { text: detail.title }), h('span', { text: detail.place || detail.typeLabel }), h('strong', null, priceBlock(detail.price))]));
      sheet.appendChild(summary);
      sheet.appendChild(body);
      body.appendChild(h('div', { class: 'skel' }));
      api('/viewing-options?lang=' + S.lang).then(function (options) {
        var name = h('input', { type: 'text', autocomplete: 'name', value: S.boot.user && (S.boot.user.contactName || S.boot.user.name) || '' });
        var phone = h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '+34 600 000 000', value: S.boot.user && S.boot.user.phone || '' });
        var note = h('textarea', { maxlength: '600' });
        var dayRow = h('div', { class: 'chips' });
        var timeBox = h('div');
        var submit = h('button', { class: 'btn primary wide', style: false, onclick: send }, [t('send')]);
        var online = h('button', { class: 'switch' }, [h('span', { text: t('online') }), h('i')]);
        online.addEventListener('click', function () { state.online = !state.online; online.classList.toggle('on', state.online); });
        function paintTimes() {
          clear(timeBox);
          var day = options.days.filter(function (item) { return item.key === state.day; })[0];
          if (!day) return;
          var labels;
          if (options.mode === 'slots') labels = day.times.map(function (time) { return { key: time, label: time }; });
          else labels = [{ key: 'morning', label: t('morning') }, { key: 'afternoon', label: t('afternoon') }, { key: 'evening', label: t('evening') }];
          timeBox.appendChild(h('div', { class: 'field' }, [h('label', { text: t('time') })]));
          var grid = h('div', { class: 'times' });
          labels.forEach(function (option) {
            grid.appendChild(h('button', { class: 'chip' + (state.time === option.key ? ' on' : ''), text: option.label, onclick: function () { state.time = option.key; paintTimes(); } }));
          });
          timeBox.appendChild(grid);
        }
        function paintDays() {
          clear(dayRow);
          options.days.forEach(function (day) {
            dayRow.appendChild(h('button', { class: 'chip' + (state.day === day.key ? ' on' : ''), text: day.label, onclick: function () { state.day = day.key; state.time = ''; paintDays(); paintTimes(); } }));
          });
        }
        function send() {
          if (!state.day) return toast(t('day'));
          if (!state.time) return toast(t('time'));
          submit.disabled = true;
          api('/viewing', 'POST', { propertyId: detail.id, day: state.day, time: state.time, online: state.online, name: name.value, phone: phone.value, note: note.value }).then(function (result) {
            haptic('ok');
            var chosenDay = options.days.filter(function (item) { return item.key === state.day; })[0];
            var chosenTime = state.time === 'morning' ? t('morning') : state.time === 'afternoon' ? t('afternoon') : state.time === 'evening' ? t('evening') : state.time;
            clear(sheet);
            sheet.appendChild(h('div', { class: 'grip' }));
            sheet.appendChild(h('div', { class: 'success' }, [
              h('div', { class: 'check' }, [icon('check')]),
              h('h2', { text: result.confirmed ? t('confirmed') : t('thanks') }),
              h('p', { class: 'sub', text: result.confirmed ? t('confirmedText') : t('thanksText') }),
              h('div', { class: 'booking-confirmation' }, [icon('cal'), h('div', null, [h('b', { text: detail.title }), h('span', { text: (chosenDay ? chosenDay.label : state.day) + ' · ' + chosenTime })])]),
              h('div', { class: 'success-actions' }, [
                h('button', { class: 'btn primary wide', onclick: close }, [t('backProperty')]),
                h('button', { class: 'btn soft wide', onclick: function () { close(); openContact(detail); } }, [icon('chat'), t('writeManager')]),
              ]),
            ]));
          }).catch(function (error) {
            submit.disabled = false;
            haptic('err');
            toast(error.message);
            if (error.status === 409) { close(); }
          });
        }
        clear(body);
        if (!options.days.length) body.appendChild(h('p', { class: 'sub', text: t('noTimes') }));
        body.appendChild(h('div', { class: 'field' }, [h('label', { text: t('day') }), dayRow]));
        body.appendChild(timeBox);
        body.appendChild(online);
        body.appendChild(field(t('name'), name));
        body.appendChild(field(t('phone'), phone));
        body.appendChild(field(t('note'), note));
        body.appendChild(h('div', { class: 'section' }, [submit]));
        if (options.days.length) { state.day = options.days[0].key; }
        paintDays();
        paintTimes();
      }).catch(function (error) {
        clear(body);
        body.appendChild(h('p', { class: 'sub', text: error.message }));
      });
    });
  }
  function contactRow(kind, iconName, title, hint, action) {
    return h('button', { class: 'contact-row', onclick: action }, [h('span', { class: 'ico ' + kind }, [icon(iconName)]), h('span', null, [h('b', { text: title }), hint ? h('small', { text: hint }) : null])]);
  }
  function openContact(detail) {
    var company = S.boot.company;
    openSheet(function (sheet, close) {
      sheet.appendChild(h('h2', { text: t('contact') }));
      if (company.promise) sheet.appendChild(h('div', { class: 'sub', text: company.promise }));
      var list = h('div', { class: 'contact-list' });
      if (company.whatsapp) list.appendChild(contactRow('wa', 'chat', t('whatsapp'), company.manager, function () { openLink(company.whatsapp); }));
      if (company.telegram) list.appendChild(contactRow('tg', 'plane', t('telegram'), '', function () { openLink(company.telegram); }));
      company.phones.slice(0, 2).forEach(function (phone) {
        list.appendChild(contactRow('call', 'phone', phone.text, t('call'), function () { window.location.href = 'tel:' + phone.tel; }));
      });
      list.appendChild(contactRow('call', 'clock', t('callMe'), t('callMeHint'), function () { close(); openCallForm(detail); }));
      list.appendChild(contactRow('tg', 'chat', t('ask'), t('askHint'), function () { close(); openQuestion(detail); }));
      sheet.appendChild(list);
    });
  }
  function openCallForm(detail) {
    openSheet(function (sheet, close) {
      var name = h('input', { type: 'text', autocomplete: 'name', value: S.boot.user && (S.boot.user.contactName || S.boot.user.name) || '' });
      var phone = h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '+34 600 000 000', value: S.boot.user && S.boot.user.phone || '' });
      var when = h('input', { type: 'text', placeholder: '18:00' });
      var submit = h('button', { class: 'btn primary wide', style: false, onclick: function () {
        submit.disabled = true;
        api('/call', 'POST', { propertyId: detail ? detail.id : '', method: 'call', name: name.value, phone: phone.value, time: when.value }).then(function () {
          haptic('ok');
          toast(t('thanks'));
          close();
        }).catch(function (error) { submit.disabled = false; haptic('err'); toast(error.message); });
      } }, [t('send')]);
      sheet.appendChild(h('h2', { text: t('callMe') }));
      sheet.appendChild(h('div', { class: 'sub', text: t('callMeHint') }));
      sheet.appendChild(field(t('name'), name));
      sheet.appendChild(field(t('phone'), phone));
      sheet.appendChild(field(t('preferred'), when));
      sheet.appendChild(h('div', { class: 'section' }, [submit]));
    });
  }
  function openQuestion(detail, preset) {
    if (S.boot && S.boot.assistant && !isGuest()) return openAssistant(detail, preset);
    openSheet(function (sheet, close) {
      var text = h('textarea', { maxlength: '1000' });
      if (preset) text.value = preset;
      var submit = h('button', { class: 'btn primary wide', style: false, onclick: function () {
        submit.disabled = true;
        api('/question', 'POST', { propertyId: detail ? detail.id : '', text: text.value }).then(function () {
          haptic('ok');
          toast(t('thanks'));
          close();
        }).catch(function (error) { submit.disabled = false; haptic('err'); toast(error.message); });
      } }, [t('send')]);
      sheet.appendChild(h('h2', { text: t('ask') }));
      sheet.appendChild(h('div', { class: 'sub', text: t('askHint') }));
      sheet.appendChild(field(t('question'), text));
      sheet.appendChild(h('div', { class: 'section' }, [submit]));
    });
  }

  /* ---------- ИИ-консультант ---------- */
  // Разговор общий с чатом бота: агент помнит, о чём клиент спрашивал там. Здесь храним только ленту этого открытия приложения.
  function openAssistant(detail, preset) {
    S.chat = S.chat || [];
    openSheet(function (sheet, close) {
      sheet.classList.add('chat-sheet');
      sheet.appendChild(h('div', { class: 'sheet-title' }, [
        h('h2', { text: t('aiTitle') }),
        h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: function () { stopRecording(false); close(); } }, [icon('x')]),
      ]));
      sheet.appendChild(h('div', { class: 'sub', text: detail ? t('aiAbout').replace('{x}', detail.title || '') : t('aiHint') }));
      var log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
      sheet.appendChild(log);
      function add(kind, text, image) {
        var node = h('div', { class: kind === 'note' ? 'chat-note' : 'bubble ' + kind }, [image ? h('img', { src: image, alt: '' }) : null, text || null]);
        log.appendChild(node);
        log.scrollTop = log.scrollHeight;
        return node;
      }
      if (!S.chat.length) S.chat.push({ kind: 'bot', text: t('aiHello') });
      S.chat.forEach(function (item) { add(item.kind, item.text, item.image); });
      var input = h('textarea', { rows: '1', maxlength: '1000', placeholder: t('aiPlaceholder') });
      if (preset) input.value = preset;
      var sendButton = h('button', { class: 'btn primary chat-send', 'aria-label': t('send'), onclick: submit }, [icon('arrow')]);
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
      });
      function busy(on) {
        sendButton.disabled = on;
        photoButton.disabled = on;
        if (!recording) micButton.disabled = on;
      }
      // Ответ консультанта: текст, кнопки объектов и записи, оценка, подсказки следующего вопроса
      function ask(payload) {
        var typing = add('bot typing', t('aiTyping'));
        busy(true);
        payload.propertyId = detail ? detail.id : '';
        return api('/assistant', 'POST', payload).then(function (result) {
          typing.remove();
          // Голосовое: показываем, что консультант расслышал
          if (result.heard) {
            var said = '🎙 ' + result.heard;
            S.chat.push({ kind: 'me', text: said });
            log.insertBefore(h('div', { class: 'bubble me', text: said }), log.lastChild && log.lastChild.classList && log.lastChild.classList.contains('typing') ? log.lastChild : null);
          }
          if (result.reply) {
            S.chat.push({ kind: 'bot', text: result.reply });
            add('bot', result.reply);
            // Консультант зовёт на просмотр объекта — кнопка открывает его карточку с записью.
            if (result.viewingId) {
              log.appendChild(h('button', { class: 'btn primary chat-viewing', type: 'button', text: t('aiViewing'), onclick: function () { close(); go('property', result.viewingId); } }));
            }
            // Объекты, которые предложил консультант, — кнопки открывают их карточки.
            (result.objects || []).forEach(function (object) {
              log.appendChild(h('button', { class: 'btn chat-viewing', type: 'button', text: '🏡 ' + object.title, onclick: function () { close(); go('property', object.id); } }));
            });
            // Оценка ответа 👍/👎 — одна на ответ, после нажатия кнопки исчезают.
            var rate = h('div', { class: 'chat-rate' });
            [['👍', true], ['👎', false]].forEach(function (pair) {
              rate.appendChild(h('button', { class: 'chat-rate-btn', type: 'button', text: pair[0], onclick: function () {
                api('/assistant/rate', 'POST', { up: pair[1] }).catch(function () {});
                rate.textContent = '✓';
                haptic('ok');
              } }));
            });
            log.appendChild(rate);
            // Подсказки следующего вопроса — нажатие отправляет его консультанту.
            if (result.suggest && result.suggest.length) {
              var chips = h('div', { class: 'chat-suggest' });
              result.suggest.forEach(function (question) {
                chips.appendChild(h('button', { class: 'chat-rate-btn', type: 'button', text: question, onclick: function () { chips.remove(); input.value = question; submit(); } }));
              });
              log.appendChild(chips);
            }
            log.scrollTop = log.scrollHeight;
          }
          if (result.handoff || result.forwarded) {
            var note = result.forwarded ? t('aiForwarded') : t('aiHandoff');
            S.chat.push({ kind: 'note', text: note });
            add('note', note);
          }
          haptic('ok');
        }).catch(function (error) {
          typing.remove();
          add('note', error.message);
          haptic('err');
        }).then(function () {
          busy(false);
        });
      }
      function submit() {
        var text = input.value.trim();
        if (text.length < 2 || sendButton.disabled) return;
        input.value = '';
        S.chat.push({ kind: 'me', text: text });
        add('me', text);
        ask({ text: text }).then(function () { input.focus(); });
      }

      // Фото: уменьшаем на телефоне (до 1280 px) и делаем превью; подпись — то, что набрано в поле
      var fileInput = h('input', { type: 'file', accept: 'image/*', class: 'chat-file', 'aria-hidden': 'true', tabindex: '-1' });
      function shrink(img, max, quality) {
        var scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
      }
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var big = shrink(img, 1280, 0.85);
          var small = shrink(img, 320, 0.7);
          URL.revokeObjectURL(url);
          var caption = input.value.trim();
          input.value = '';
          S.chat.push({ kind: 'me', text: caption, image: small });
          add('me', caption, small);
          ask({ text: caption, image: { data: big.split(',')[1], thumb: small.split(',')[1] } });
        };
        img.onerror = function () { URL.revokeObjectURL(url); toast(t('aiPhotoBad')); haptic('err'); };
        img.src = url;
      });
      var photoButton = h('button', { class: 'chat-tool', type: 'button', 'aria-label': t('aiPhoto'), title: t('aiPhoto'), onclick: function () { fileInput.click(); } }, [icon('camera')]);

      // Голосовое: пишем звук с микрофона, на отправке — WAV 16 кГц (одинаково на любом телефоне)
      var recording = null;
      var micButton = h('button', { class: 'chat-tool', type: 'button', 'aria-label': t('aiVoice'), title: t('aiVoice'), onclick: function () { if (recording) stopRecording(true); else startRecording(); } }, [icon('mic')]);
      function showRecording() {
        clear(micButton);
        if (!recording) {
          micButton.className = 'chat-tool';
          micButton.setAttribute('aria-label', t('aiVoice'));
          micButton.appendChild(icon('mic'));
          return;
        }
        var seconds = Math.floor((Date.now() - recording.started) / 1000);
        micButton.className = 'chat-tool rec';
        micButton.setAttribute('aria-label', t('aiStop'));
        micButton.appendChild(icon('stop'));
        micButton.appendChild(document.createTextNode(Math.floor(seconds / 60) + ':' + ('0' + (seconds % 60)).slice(-2)));
      }
      function startRecording() {
        var Context = window.AudioContext || window.webkitAudioContext;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !Context) { toast(t('aiMicDenied')); return; }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          var context = new Context();
          var source = context.createMediaStreamSource(stream);
          var processor = context.createScriptProcessor(4096, 1, 1);
          var chunks = [];
          processor.onaudioprocess = function (event) { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
          source.connect(processor);
          processor.connect(context.destination);
          recording = { stream: stream, context: context, processor: processor, chunks: chunks, started: Date.now() };
          recording.timer = setInterval(function () {
            showRecording();
            if (Date.now() - recording.started > 120000) stopRecording(true);
          }, 500);
          showRecording();
          haptic();
        }).catch(function () { toast(t('aiMicDenied')); haptic('err'); });
      }
      function stopRecording(send) {
        if (!recording) return;
        var r = recording;
        recording = null;
        clearInterval(r.timer);
        try { r.processor.disconnect(); } catch (e) { /* уже отключён */ }
        r.stream.getTracks().forEach(function (track) { track.stop(); });
        var rate = r.context.sampleRate;
        try { r.context.close(); } catch (e) { /* уже закрыт */ }
        showRecording();
        if (!send) return;
        var total = r.chunks.reduce(function (n, c) { return n + c.length; }, 0);
        if (total < rate * 0.7) { toast(t('aiVoiceShort')); return; }
        ask({ voice: wavBase64(r.chunks, total, rate) });
      }
      // Float32 с любой частотой → моно 16 кГц, PCM 16 бит, WAV → base64
      function wavBase64(chunks, total, rate) {
        var all = new Float32Array(total);
        var at = 0;
        chunks.forEach(function (c) { all.set(c, at); at += c.length; });
        var outLength = Math.floor(total * 16000 / rate);
        var buffer = new ArrayBuffer(44 + outLength * 2);
        var view = new DataView(buffer);
        function text(offset, value) { for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); }
        text(0, 'RIFF'); view.setUint32(4, 36 + outLength * 2, true); text(8, 'WAVE');
        text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, outLength * 2, true);
        for (var j = 0; j < outLength; j++) {
          var pos = j * rate / 16000;
          var k = Math.floor(pos);
          var frac = pos - k;
          var sample = all[k] * (1 - frac) + (all[k + 1] || 0) * frac;
          sample = Math.max(-1, Math.min(1, sample));
          view.setInt16(44 + j * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
        }
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var b = 0; b < bytes.length; b += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(b, b + 32768));
        return btoa(binary);
      }

      sheet.appendChild(h('div', { class: 'chat-input' }, [photoButton, micButton, input, sendButton, fileInput]));
      setTimeout(function () { input.focus(); }, 300);
    });
  }

  /* ---------- избранное, сравнение, о нас ---------- */
  function emptyEl(iconName, title, hint) {
    return h('div', { class: 'empty' }, [icon(iconName), h('h3', { text: title }), h('div', { text: hint })]);
  }
  function renderFavorites(view) {
    var page = h('div', { class: 'page' });
    var cards = S.boot.cards.filter(function (card) { return isFavorite(card.id); });
    var head = h('div', { class: 'fav-head' }, [h('div', null, [h('h1', { text: t('navFav') }), h('div', { class: 'sub', text: t('favSub') })])]);
    var picked = S.boot.compare.length;
    if (picked > 1) head.appendChild(h('button', { class: 'cmp-link', onclick: function () { go('cmp'); } }, [icon('sort'), h('span', { text: t('compareN').replace('{n}', String(picked)) }), icon('chevron')]));
    page.appendChild(head);
    if (!cards.length) {
      page.appendChild(h('div', { class: 'empty' }, [
        h('img', { src: '/art/coastal.jpg', alt: '' }),
        h('h3', { text: t('favEmpty') }),
        h('div', { text: t('favEmptyHint') }),
        h('div', { style: false }, [h('button', { class: 'btn red', style: false, onclick: function () { S.filters = emptyFilters(); go('objects'); } }, [t('tileObjects'), icon('arrow')])]),
      ]));
    } else page.appendChild(h('div', { class: 'list rows' }, cards.map(function (card, index) { return cardEl(card, index, 'row'); })));
    view.appendChild(page);
  }

  /* ---------- профиль ---------- */
  var TYPE_KEYS = { viewing: 'typeViewing', lead: 'typeLead', question: 'typeQuestion', selection: 'typeSelection', interest: 'typeInterest', general: 'typeGeneral' };
  function inquiryTitle(item) {
    return item.title || t(TYPE_KEYS[item.type] || 'typeGeneral');
  }
  function inquirySub(item) {
    var parts = [t(TYPE_KEYS[item.type] || 'typeGeneral')];
    if (item.viewing && item.viewing.date) parts.push(item.viewing.date + (item.viewing.time ? ' · ' + item.viewing.time : ''));
    return parts.join(' · ');
  }
  function stepperEl(step) {
    var labels = [t('stepAccepted'), t('stepWork'), t('stepViewing')];
    return h('div', { class: 'stepper' }, labels.map(function (label, index) {
      var done = step > index;
      return h('div', { class: 'step' + (done ? ' done' : '') }, [h('i', null, [done ? icon('check') : null]), h('span', { text: label })]);
    }));
  }
  function statusCardEl(item) {
    var top = h('div', { class: 'status-card' }, []);
    if (item.cover) top.appendChild(h('img', { src: item.cover, alt: '' }));
    top.appendChild(h('div', { class: 'grow' }, [h('h3', { text: t('requestStatus') }), h('div', { class: 'sub', text: inquiryTitle(item) }), stepperEl(item.step)]));
    top.style.cursor = item.propertyId ? 'pointer' : 'default';
    if (item.propertyId) top.addEventListener('click', function () { go('property', item.propertyId); });
    return top;
  }
  function openRequests(me) {
    openSheet(function (sheet, close) {
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('myRequests') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      var list = h('div', { class: 'menu-rows' });
      me.inquiries.forEach(function (item) {
        var stepText = item.step >= 4 ? t('stepDone') : [t('stepAccepted'), t('stepWork'), t('stepViewing')][item.step - 1];
        list.appendChild(h('button', { class: 'menu-row ' + (item.step >= 4 ? 'cyan' : 'yellow'), onclick: function () { close(); if (item.propertyId) go('property', item.propertyId); } }, [
          icon(item.type === 'viewing' ? 'cal' : 'document'), h('span', { class: 'grow' }, [h('b', { text: inquiryTitle(item) }), h('small', { text: inquirySub(item) + ' · ' + stepText })]), item.propertyId ? icon('chevron') : null,
        ]));
      });
      sheet.appendChild(list);
    });
  }
  function openRecent(me) {
    openSheet(function (sheet, close) {
      sheet.appendChild(h('div', { class: 'sheet-title' }, [h('h2', { text: t('history') }), h('button', { class: 'sheet-close', 'aria-label': t('close'), onclick: close }, [icon('x')])]));
      var list = h('div', { class: 'menu-rows' });
      me.recent.forEach(function (card) {
        list.appendChild(h('button', { class: 'menu-row cyan', onclick: function () { close(); go('property', card.id); } }, [
          icon('clock'), h('span', { class: 'grow' }, [h('b', { text: card.title }), h('small', { text: card.price.text })]), icon('chevron'),
        ]));
      });
      sheet.appendChild(list);
    });
  }
  function menuRow(color, iconName, title, hint, onClick) {
    return h('button', { class: 'menu-row ' + color, onclick: onClick }, [icon(iconName), h('span', { class: 'grow' }, [h('b', { text: title }), hint ? h('small', { text: hint }) : null]), icon('chevron')]);
  }
  function renderProfile(view) {
    var user = S.boot.user;
    var page = h('div', { class: 'page' }, [h('h1', { text: t('navProfile') })]);
    var name = user && (user.contactName || user.name) ? (user.contactName || user.name) : t('guestName');
    var who = h('div', { class: 'grow', style: false }, [h('h3', { text: name })]);
    if (user && user.phone) who.appendChild(h('div', { class: 'sub', text: user.phone }));
    who.appendChild(h('span', { class: 'tag', text: user ? t('clientTag') : t('guestTag') }));
    var card = h('div', { class: 'profile-card' }, [h('div', { class: 'avatar' }, [icon('profile')]), who]);
    who.style.minWidth = '0';
    page.appendChild(card);
    var statusHost = h('div');
    page.appendChild(statusHost);
    var rows = h('div', { class: 'menu-rows' });
    var handlers = { requests: function () { toast(t('noRequests')); }, recent: function () { toast(t('noHistory')); } };
    rows.appendChild(menuRow('red', 'document', t('myRequests'), t('myRequestsHint'), function () { handlers.requests(); }));
    rows.appendChild(menuRow('red', 'heart', t('savedObjects'), t('savedHint'), function () { go('fav'); }));
    rows.appendChild(menuRow('yellow', 'clock', t('history'), t('historyHint'), function () { handlers.recent(); }));
    rows.appendChild(menuRow('cyan', 'scale', t('compare'), t('compareHint'), function () { go('cmp'); }));
    rows.appendChild(menuRow('ink', 'settings', t('settings'), t('settingsHint'), openLanguage));
    rows.appendChild(menuRow('cyan', 'headset', t('contactUs'), t('contactManagerHint'), function () { go('contacts'); }));
    rows.appendChild(menuRow('yellow', 'building', t('about'), t('aboutHint'), function () { go('about'); }));
    page.appendChild(rows);
    view.appendChild(page);
    if (isGuest()) {
      statusHost.appendChild(h('p', { class: 'note', text: t('guestProfile') }));
      return;
    }
    api('/me?lang=' + S.lang).then(function (me) {
      if (S.route.name !== 'profile') return;
      if (me.inquiries.length) {
        statusHost.appendChild(statusCardEl(me.inquiries[0]));
        handlers.requests = function () { openRequests(me); };
      }
      if (me.recent.length) handlers.recent = function () { openRecent(me); };
    }).catch(function () { return null; });
  }
    function renderCompare(view) {
    var page = h('div', { class: 'page' }, [backRow(), h('h1', { text: t('compare') })]);
    var cards = S.boot.compare.map(cardById).filter(Boolean);
    if (!cards.length) { page.appendChild(emptyEl('scale', t('compareEmpty'), t('compareEmptyHint'))); view.appendChild(page); return; }
    var table = h('table');
    var head = h('tr', null, [h('th')]);
    cards.forEach(function (card) {
      var photo = card.cover ? h('img', { class: 'cmp-photo', src: card.cover, alt: '' }) : null;
      var cell = h('th', { style: false }, [photo, h('div', { text: card.title })]);
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', function () { go('property', card.id); });
      head.appendChild(cell);
    });
    table.appendChild(head);
    function best(values, lower) {
      var nonZero = values.filter(function (value) { return value > 0; });
      if (nonZero.length < 2) return -1;
      var target = lower ? Math.min.apply(null, nonZero) : Math.max.apply(null, nonZero);
      return values.indexOf(target);
    }
    function row(label, values, texts, lower) {
      if (!values.some(function (value) { return value > 0; })) return;
      var winner = best(values, lower);
      var tr = h('tr', null, [h('td', { text: label })]);
      texts.forEach(function (text, index) { tr.appendChild(h('td', { class: index === winner ? 'best' : '', text: text || '—' })); });
      table.appendChild(tr);
    }
    function factText(card, key) {
      var found = card.facts.filter(function (fact) { return fact.key === key; })[0];
      return found ? found.value : '';
    }
    row(t('price'), cards.map(function (card) { return card.raw.price; }), cards.map(function (card) { return card.price.text; }), true);
    row(t('bedrooms'), cards.map(function (card) { return card.raw.bedroomsMax; }), cards.map(function (card) { return factText(card, 'bedrooms'); }), false);
    row(findLabel(cards, 'area'), cards.map(function (card) { return card.raw.areaMax; }), cards.map(function (card) { return factText(card, 'area'); }), false);
    row(findLabel(cards, 'plot'), cards.map(function (card) { return card.raw.plot; }), cards.map(function (card) { return factText(card, 'plot'); }), false);
    row(findLabel(cards, 'sea'), cards.map(function (card) { return card.raw.sea; }), cards.map(function (card) { return factText(card, 'sea'); }), true);
    table.appendChild(h('tr', null, [h('td'), ].concat(cards.map(function (card) {
      return h('td', null, [h('button', { class: 'chip', text: t('remove'), onclick: function () { toggleCompare(card.id); setTimeout(render, 80); } })]);
    }))));
    page.appendChild(h('div', { class: 'cmp' }, [table]));
    view.appendChild(page);
  }
  function findLabel(cards, key) {
    for (var i = 0; i < cards.length; i += 1) {
      var found = cards[i].facts.filter(function (fact) { return fact.key === key; })[0];
      if (found) return found.label;
    }
    return key;
  }
  function accordion(title, text) {
    var node = h('div', { class: 'acc' });
    var button = h('button', null, [h('span', { text: title }), icon('down')]);
    button.addEventListener('click', function () { node.classList.toggle('open'); });
    node.appendChild(button);
    node.appendChild(h('div', { class: 'acc-body', text: text }));
    return node;
  }
  function renderAbout(view) {
    var company = S.boot.company;
    var page = h('div', { class: 'page' }, [h('h1', { text: String(company.labels.about || t('about')).replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '') })]);
    page.insertBefore(backRow(), page.firstChild);
    var stats = h('div', { class: 'stats' });
    if (company.trust.years) stats.appendChild(h('div', { class: 'stat' }, [h('b', { text: String(company.trust.years) }), h('span', { class: 'sub', text: t('yearsOnMarket') })]));
    if (company.trust.deals) stats.appendChild(h('div', { class: 'stat' }, [h('b', { text: String(company.trust.deals) }), h('span', { class: 'sub', text: t('dealsDone') })]));
    if (stats.childNodes.length) page.appendChild(stats);
    var text = company.about || company.intro;
    if (text) page.appendChild(h('section', { class: 'section' }, [h('p', { class: 'prose', text: text })]));
    if (company.trust.registration) page.appendChild(h('p', { class: 'sub', text: t('reg') + ': ' + company.trust.registration }));
    if (company.trust.office) page.appendChild(h('p', { class: 'sub', text: t('addr') + ': ' + company.trust.office }));
    if (company.trust.reviews.length) {
      page.appendChild(h('section', { class: 'section' }, [h('h3', { text: t('reviews') })].concat(company.trust.reviews.map(function (review) {
        return h('div', { class: 'review' }, [h('b', { text: review.name }), h('p', { class: 'prose', text: review.text })]);
      }))));
    }
    if (company.guide.length) {
      page.appendChild(h('section', { class: 'section' }, [h('h3', { text: t('guide') })].concat(company.guide.map(function (item) { return accordion(item.title, item.text); }))));
    }
    view.appendChild(page);
  }

  function renderContacts(view) {
    var company = S.boot.company;
    var page = h('div', { class: 'page' }, [backRow(), h('h1', { text: t('contactUs') })]);
    var hero = h('div', { class: 'about-hero' }, []);
    if (company.photo) hero.appendChild(h('img', { src: company.photo, alt: company.manager }));
    hero.appendChild(h('div', null, [h('small', { class: 'sub', text: t('manager') }), h('h3', { text: company.manager || company.name }), company.promise ? h('div', { class: 'sub', text: company.promise }) : null]));
    page.appendChild(hero);
    var list = h('div', { class: 'contact-list' });
    if (company.whatsapp) list.appendChild(contactRow('wa', 'chat', t('whatsapp'), '', function () { openLink(company.whatsapp); }));
    if (company.telegram) list.appendChild(contactRow('tg', 'plane', t('telegram'), '', function () { openLink(company.telegram); }));
    company.phones.slice(0, 2).forEach(function (phone) { list.appendChild(contactRow('call', 'phone', phone.text, t('call'), function () { window.location.href = 'tel:' + phone.tel; })); });
    if (company.email) list.appendChild(contactRow('mail', 'mail', company.email, t('email'), function () { window.location.href = 'mailto:' + company.email; }));
    if (company.map) list.appendChild(contactRow('map', 'pin', t('office'), '', function () { openLink(company.map); }));
    if (company.website) list.appendChild(contactRow('web', 'globe', t('website'), '', function () { openLink(company.website); }));
    list.appendChild(contactRow('call', 'clock', t('callMe'), t('callMeHint'), function () { openCallForm(null); }));
    list.appendChild(contactRow('tg', 'chat', t('ask'), t('askHint'), function () { openQuestion(null); }));
    page.appendChild(list);
    view.appendChild(page);
  }

  /* ---------- каркас ---------- */
  var tabsEl = null;
  var TAB_OF = { home: 'home', objects: 'objects', fav: 'fav', cmp: 'fav', profile: 'profile', about: 'profile', contacts: 'profile' };
  function tabButton(name, label, iconName, route) {
    return h('button', { class: 'tab' + (TAB_OF[S.route.name] === name ? ' on' : ''), 'data-tab': name, 'aria-current': TAB_OF[S.route.name] === name ? 'page' : false, onclick: function () { go(route); } }, [icon(iconName), h('span', { text: label })]);
  }
  function updateTabs() {
    if (!tabsEl) return;
    var counts = { fav: S.boot.favorites.length };
    Array.prototype.forEach.call(tabsEl.children, function (tab) {
      var key = tab.getAttribute('data-tab');
      var old = tab.querySelector('.count');
      if (old) old.remove();
      if (counts[key]) tab.appendChild(h('span', { class: 'count', text: String(counts[key]) }));
    });
  }
  function render() {
    S.route = parseHash();
    clear(root);
    document.title = S.boot.company.name;
    var view = h('div', { id: 'view' });
    var main = S.route.name;
    if (main !== 'property') root.appendChild(headerEl());
    if (main === 'home') renderLanding(view);
    else if (main === 'objects') renderObjects(view);
    else if (main === 'fav') renderFavorites(view);
    else if (main === 'cmp') renderCompare(view);
    else if (main === 'profile') renderProfile(view);
    else if (main === 'about') renderAbout(view);
    else if (main === 'contacts') renderContacts(view);
    root.appendChild(view);
    if (main === 'property') renderProperty(view);
    if (main !== 'property') {
      tabsEl = h('nav', { class: 'tabs' }, [
        tabButton('home', t('navHome'), 'home', 'home'),
        tabButton('objects', t('navObjects'), 'building', 'objects'),
        tabButton('fav', t('navFav'), 'heart', 'fav'),
        tabButton('profile', t('navProfile'), 'profile', 'profile'),
      ]);
      root.appendChild(tabsEl);
      updateTabs();
      if (S.boot.assistant && !isGuest()) root.appendChild(h('button', { class: 'ai-fab', 'aria-label': t('aiTitle'), onclick: function () { openAssistant(null); } }, [icon('chat')]));
    } else tabsEl = null;
    var again = S.scrolls[main];
    if (again) {
      S.scrolls[main] = 0;
      window.scrollTo(0, again);
    } else if (main !== 'property') window.scrollTo(0, 0);
    syncBack();
  }
  function setLanguage(code) {
    if (S.lang === code) return;
    S.lang = code;
    store('lang', code);
    document.documentElement.setAttribute('lang', code);
    S.detail = {};
    S.filters.query = '';
    S.filters.city = '';
    S.filters.type = '';
    load();
  }
  function load() {
    var seq = ++S.loadSeq;
    return api('/bootstrap?lang=' + S.lang).then(function (boot) {
      if (seq !== S.loadSeq) return;
      S.boot = boot;
      S.lang = boot.language;
      document.documentElement.setAttribute('lang', S.lang);
      render();
      var start = boot.startParam || (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
      var match = /^prop_(.+)$/.exec(start);
      var query = /[?&]p=([A-Za-z0-9_-]{6,100})/.exec(location.search);
      var wanted = match ? match[1] : query ? query[1] : '';
      if (wanted && !S.openedStart && boot.cards.some(function (card) { return card.id === wanted; })) { S.openedStart = true; go('property', wanted); }
    }).catch(function (error) {
      if (seq !== S.loadSeq) return;
      clear(root);
      root.appendChild(h('div', { class: 'page' }, [h('div', { class: 'empty' }, [icon('info'), h('h3', { text: error.message }), h('button', { class: 'btn ink', onclick: load }, [t('retry')])])]));
    });
  }

  /* ---------- запуск ---------- */
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      if (tg.BackButton) tg.BackButton.onClick(goBack);
      tg.onEvent('themeChanged', applyTheme);
    } catch (e) { /* без возможностей Telegram приложение работает как обычный сайт */ }
  }
  applyTheme();
  var saved = store('lang');
  if (saved === 'ru' || saved === 'uk' || saved === 'en' || saved === 'es') S.lang = saved;
  else S.lang = '';
  S.route = parseHash();
  load();
})();
`;

export { APP_CSS, APP_HTML, APP_JS };
