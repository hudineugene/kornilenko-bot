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
  --bg:#f4f2ee;--card:#fff;--soft:#faf9f6;--line:#e8e4dc;--ink:#111826;--muted:#667085;
  --teal:#0aa5bd;--teal-dark:#06788c;--teal-soft:#e2f6fa;--coral:#e5486a;--coral-soft:#fde8ed;--sun:#ffc629;--sun-soft:#fff4cf;
  --ok:#0d8a55;--ok-soft:#e3f6ec;--shadow:0 1px 2px rgba(17,24,38,.05),0 8px 24px rgba(17,24,38,.07);--shadow-lg:0 18px 48px rgba(17,24,38,.18);
  --r:22px;--r-sm:14px;--tab:68px;--top:env(safe-area-inset-top,0px);--bottom:env(safe-area-inset-bottom,0px);
}
[data-theme=dark]{--bg:#0d1117;--card:#161b24;--soft:#1b212c;--line:#283040;--ink:#f1f3f7;--muted:#9aa4b6;--teal:#2cc3da;--teal-dark:#5ad4e6;--teal-soft:#10303a;--coral:#ff6b8a;--coral-soft:#3a1c26;--sun:#ffd24d;--sun-soft:#3a3115;--ok:#38d68f;--ok-soft:#10301f;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);--shadow-lg:0 18px 48px rgba(0,0,0,.6)}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.45;-webkit-font-smoothing:antialiased;overscroll-behavior-y:contain}
body{overflow-x:hidden}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none;padding:0}
img{display:block;max-width:100%}
.hidden{display:none!important}
#app{min-height:100%;padding-bottom:calc(var(--tab) + var(--bottom) + 8px)}
.boot{display:grid;place-items:center;gap:16px;height:100vh}
.boot-logo{width:96px;height:96px;border-radius:26px;background:var(--card) url(/icon.png) center/72% no-repeat;box-shadow:var(--shadow);animation:pop .6s ease both}
.boot-bar{width:120px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--coral),var(--sun),var(--teal));background-size:200% 100%;animation:slide 1.2s linear infinite}
@keyframes slide{to{background-position:-200% 0}}
@keyframes pop{from{opacity:0;transform:scale(.85)}}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}
@keyframes fade{from{opacity:0}}
@keyframes shimmer{to{background-position:-200% 0}}

/* шапка и вкладки */
.top{position:sticky;top:0;z-index:20;padding:calc(var(--top) + 10px) 18px 10px;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.top::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,var(--coral) 0 33%,var(--sun) 33% 66%,var(--teal) 66%);opacity:.9}
.top-row{display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.brand img{width:40px;height:40px;border-radius:12px;background:var(--card);box-shadow:var(--shadow);object-fit:contain}
.brand b{display:block;font-size:15px;line-height:1.15;letter-spacing:-.01em}
.brand span{display:block;font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.langs{display:flex;background:var(--card);border-radius:999px;padding:3px;box-shadow:var(--shadow)}
.langs button{height:30px;min-width:34px;border-radius:999px;font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.04em}
.langs button.on{background:var(--ink);color:var(--bg)}
.tabs{position:fixed;left:12px;right:12px;bottom:calc(var(--bottom) + 10px);z-index:30;height:var(--tab);display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);border:1px solid var(--line);border-radius:26px;box-shadow:var(--shadow-lg);padding:6px}
.tab{display:grid;place-items:center;gap:2px;border-radius:20px;color:var(--muted);font-size:11px;font-weight:600;position:relative;transition:color .2s,background .2s}
.tab svg{width:24px;height:24px}
.tab.on{color:var(--teal-dark);background:var(--teal-soft)}
.tab .count{position:absolute;top:6px;right:calc(50% - 22px);min-width:18px;height:18px;border-radius:9px;background:var(--coral);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 5px}

/* общие элементы */
.page{padding:14px 18px 24px;animation:rise .35s ease both}
h1,h2,h3{margin:0;letter-spacing:-.02em;line-height:1.15}
h1{font-size:28px;font-weight:800}
h2{font-size:22px;font-weight:800}
h3{font-size:17px;font-weight:700}
.sub{color:var(--muted);font-size:14px}
.chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:0 -18px;padding:2px 18px}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;height:38px;padding:0 15px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:14px;font-weight:600;white-space:nowrap;transition:all .18s}
.chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip:active{transform:scale(.96)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:54px;padding:0 22px;border-radius:17px;font-weight:700;font-size:16px;transition:transform .15s,box-shadow .2s,opacity .2s;white-space:nowrap}
.btn svg{width:20px;height:20px;flex:none}
.btn:active{transform:scale(.97)}
.btn.primary{background:linear-gradient(135deg,var(--teal) 0%,var(--teal-dark) 100%);color:#fff;box-shadow:0 10px 24px color-mix(in srgb,var(--teal) 38%,transparent)}
.btn.ink{background:var(--ink);color:var(--bg)}
.btn.soft{background:var(--card);border:1px solid var(--line);color:var(--ink)}
.btn.wide{width:100%}
.btn[disabled]{opacity:.55;pointer-events:none}
.icon-btn{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--card);box-shadow:var(--shadow);transition:transform .15s}
.icon-btn svg{width:22px;height:22px}
.icon-btn:active{transform:scale(.9)}
.icon-btn.on{color:var(--coral)}
.icon-btn.on svg{fill:var(--coral)}

/* карточка проекта */
.list{display:grid;gap:18px;margin-top:16px}
.card{position:relative;background:var(--card);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;cursor:pointer;transition:transform .2s;animation:rise .45s ease both}
.card:active{transform:scale(.985)}
.card .photo{position:relative;aspect-ratio:4/3.1;background:linear-gradient(110deg,var(--soft) 30%,var(--line) 50%,var(--soft) 70%);background-size:200% 100%;animation:shimmer 1.4s linear infinite}
.card .photo img{width:100%;height:100%;object-fit:cover;animation:fade .4s ease both}
.card .photo::after{content:"";position:absolute;inset:auto 0 0;height:55%;background:linear-gradient(0deg,rgba(8,12,20,.62),transparent)}
.card .badges{position:absolute;left:14px;top:14px;display:flex;gap:6px;flex-wrap:wrap;z-index:2;max-width:70%}
.badge{height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;background:var(--sun);color:#3a2c00}
.badge.drop{background:var(--coral);color:#fff}
.badge.build{background:var(--card);color:var(--ink);border:1px solid var(--line)}
.badge.reserved{background:#111826;color:#fff}
.card .heart{position:absolute;right:12px;top:12px;z-index:2}
.card .price-on-photo{position:absolute;left:16px;bottom:14px;z-index:2;color:#fff}
.card .price-on-photo b{display:block;font-size:24px;font-weight:800;letter-spacing:-.02em}
.card .price-on-photo s{opacity:.75;font-size:14px;margin-right:6px}
.card .count{position:absolute;right:14px;bottom:14px;z-index:2;height:28px;padding:0 10px;border-radius:999px;background:rgba(8,12,20,.55);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;backdrop-filter:blur(8px)}
.card .count svg{width:14px;height:14px}
.card .body{padding:16px 18px 18px}
.card .place{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin-top:6px}
.card .place svg{width:15px;height:15px;color:var(--teal)}
.facts-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.fact{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:12px;background:var(--soft);font-size:13px;font-weight:600}
.fact svg{width:17px;height:17px;color:var(--teal-dark)}

/* страница объекта */
.gallery{position:relative;margin:0 -18px}
.slides{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:4/3.2;background:var(--soft)}
.slides::-webkit-scrollbar{display:none}
.slides img{flex:none;width:100%;height:100%;object-fit:cover;scroll-snap-align:center}
.dots{position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:center;gap:6px}
.dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.55);transition:all .25s}
.dots i.on{width:20px;border-radius:4px;background:#fff}
.gallery .back,.gallery .share{position:absolute;top:calc(var(--top) + 8px);z-index:3}
.gallery .back{left:16px}.gallery .share{right:16px;display:flex;gap:10px}
.sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:20px}
.big-price{font-size:30px;font-weight:800;letter-spacing:-.03em;margin-top:14px}
.big-price s{font-size:16px;color:var(--muted);font-weight:600;margin-right:8px}
.per{color:var(--muted);font-size:14px;margin-top:2px}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}
.tile>div:last-child{min-width:0;overflow-wrap:anywhere}
.tile{background:var(--card);border-radius:18px;padding:14px;box-shadow:var(--shadow);display:flex;gap:12px;align-items:center}
.tile .ico{width:40px;height:40px;border-radius:13px;background:var(--teal-soft);color:var(--teal-dark);display:grid;place-items:center;flex:none}
.tile .ico svg{width:22px;height:22px}
.tile small{display:block;color:var(--muted);font-size:12px}
.tile b{font-size:16px}
.section{margin-top:26px}
.section>h3{margin-bottom:12px}
.prose{color:var(--ink);font-size:15.5px;line-height:1.6;white-space:pre-line}
.ticks{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:10px}
.ticks li{display:flex;gap:11px;align-items:flex-start;font-size:15px;background:var(--card);padding:12px 14px;border-radius:15px;box-shadow:var(--shadow)}
.ticks li svg{width:20px;height:20px;flex:none;color:var(--teal);margin-top:1px}
.links{display:flex;gap:10px;flex-wrap:wrap}
.hscroll{display:flex;gap:14px;overflow-x:auto;margin:0 -18px;padding:4px 18px 14px;scroll-snap-type:x proximity;scrollbar-width:none}
.hscroll::-webkit-scrollbar{display:none}
.hscroll .card{flex:none;width:76%;scroll-snap-align:start}
.hscroll .card .photo{aspect-ratio:4/3}
.cta{position:fixed;left:12px;right:12px;bottom:calc(var(--bottom) + 10px);z-index:31;display:flex;gap:10px;padding:10px;border-radius:26px;background:color-mix(in srgb,var(--card) 90%,transparent);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);border:1px solid var(--line);box-shadow:var(--shadow-lg);animation:rise .35s ease both}
.cta .btn{flex:1 1 0;min-width:0;height:52px;padding:0 12px;gap:8px;font-size:15px;overflow:hidden}
.cta .btn span{overflow:hidden;text-overflow:ellipsis}
.cta .btn.primary{flex:1.5 1 0}
.cta .icon-btn{flex:none;width:52px;height:52px;border-radius:18px;box-shadow:none;border:1px solid var(--line)}

/* листы и всплывающие окна */
.scrim{position:fixed;inset:0;z-index:50;background:rgba(8,12,20,.5);animation:fade .2s ease both}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:51;max-height:92vh;overflow-y:auto;background:var(--bg);border-radius:28px 28px 0 0;padding:10px 18px calc(var(--bottom) + 22px);box-shadow:var(--shadow-lg);animation:sheet .32s cubic-bezier(.2,.9,.3,1) both}
@keyframes sheet{from{transform:translateY(100%)}}
.sheet .grip{width:42px;height:5px;border-radius:3px;background:var(--line);margin:0 auto 14px}
.sheet h2{margin-bottom:6px}
.field{display:grid;gap:6px;margin-top:14px}
.field label{font-size:13px;font-weight:600;color:var(--muted)}
.field input,.field textarea{width:100%;height:52px;border-radius:15px;border:1.5px solid var(--line);background:var(--card);padding:0 16px;outline:none;transition:border-color .2s,box-shadow .2s}
.field textarea{height:96px;padding:12px 16px;resize:none}
.field input:focus,.field textarea:focus{border-color:var(--teal);box-shadow:0 0 0 4px color-mix(in srgb,var(--teal) 18%,transparent)}
.switch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line);font-weight:600}
.switch i{width:50px;height:30px;border-radius:15px;background:var(--line);position:relative;transition:background .2s;flex:none}
.switch i::after{content:"";position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}
.switch.on i{background:var(--teal)}
.switch.on i::after{transform:translateX(20px)}
.times{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.times .chip{width:100%;padding:0}
.contact-list{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:14px}
.contact-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:18px;background:var(--card);box-shadow:var(--shadow);text-align:left;width:100%}
.contact-row .ico{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#fff;flex:none}
.contact-row .ico svg{width:22px;height:22px}
.contact-row>span:last-child{min-width:0;overflow-wrap:anywhere}
.contact-row b{display:block;font-size:16px}
.contact-row small{color:var(--muted)}
.ico.wa{background:#25d366}.ico.tg{background:#2aabee}.ico.call{background:var(--teal)}.ico.mail{background:var(--coral)}.ico.web{background:var(--ink)}.ico.map{background:var(--sun);color:#3a2c00}
.success{text-align:center;padding:18px 0 6px}
.success .check{width:92px;height:92px;border-radius:50%;margin:0 auto 18px;background:var(--ok-soft);color:var(--ok);display:grid;place-items:center;animation:pop .5s cubic-bezier(.2,1.4,.4,1) both}
.success .check svg{width:48px;height:48px;stroke-dasharray:60;stroke-dashoffset:60;animation:draw .5s .25s ease forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.calc{background:var(--card);border-radius:22px;padding:18px;box-shadow:var(--shadow)}
.slider{margin-top:14px}
.slider label{display:flex;justify-content:space-between;font-size:14px;font-weight:600}
.slider output{color:var(--teal-dark)}
input[type=range]{-webkit-appearance:none;appearance:none;width:100%;margin:10px 0 0;height:28px;background:transparent;--p:50%}
input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--teal) var(--p),var(--line) var(--p))}
input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--teal) var(--p),var(--line) var(--p))}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;margin-top:-10px;border-radius:50%;background:#fff;border:3px solid var(--teal);box-shadow:0 2px 8px rgba(17,24,38,.25)}
input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#fff;border:3px solid var(--teal);box-shadow:0 2px 8px rgba(17,24,38,.25)}
.calc-line{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14.5px}
.calc-line:last-child{border:0}
.calc-line.big{font-size:15.5px;font-weight:800}
.calc-line span:last-child{white-space:nowrap;text-align:right}
.monthly{background:linear-gradient(135deg,var(--teal),var(--teal-dark));color:#fff;border-radius:18px;padding:16px 18px;margin-top:16px}
.monthly small{opacity:.85;display:block}
.monthly b{font-size:28px;letter-spacing:-.02em}
.note{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}

/* сравнение, о компании, пустые состояния */
.cmp{overflow-x:auto;margin:16px -18px 0;padding:0 18px 10px}
.cmp table{border-collapse:separate;border-spacing:0;min-width:100%;background:var(--card);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}
.cmp th,.cmp td{padding:12px 14px;text-align:left;font-size:14px;border-bottom:1px solid var(--line);vertical-align:top}
.cmp tr:last-child td{border:0}
.cmp th{font-weight:700;min-width:140px}
.cmp th:first-child,.cmp td:first-child{position:sticky;left:0;z-index:1;background:var(--card);min-width:84px}
.cmp td:first-child{color:var(--muted);font-size:13px;white-space:nowrap}
.cmp .best{color:var(--ok);font-weight:800}
.cmp .cmp-photo{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;margin-bottom:8px}
.empty{text-align:center;padding:48px 24px;color:var(--muted)}
.empty svg{width:72px;height:72px;color:var(--line);margin-bottom:10px}
.empty h3{color:var(--ink);margin-bottom:6px}
.about-hero{display:flex;gap:16px;align-items:center;background:var(--card);border-radius:24px;padding:18px;box-shadow:var(--shadow);margin-top:16px}
.about-hero img{width:76px;height:76px;border-radius:22px;object-fit:cover;background:var(--soft)}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}
.stat{background:var(--card);border-radius:18px;padding:16px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:26px;font-weight:800;letter-spacing:-.02em}
.acc{background:var(--card);border-radius:18px;box-shadow:var(--shadow);margin-top:10px;overflow:hidden}
.acc button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:16px 18px;text-align:left;font-weight:700}
.acc button svg{width:20px;height:20px;transition:transform .25s;flex:none}
.acc.open button svg{transform:rotate(180deg)}
.acc .acc-body{display:none;padding:0 18px 16px;color:var(--ink);font-size:15px;line-height:1.55;white-space:pre-line}
.acc.open .acc-body{display:block}
.review{background:var(--card);border-radius:18px;padding:16px;box-shadow:var(--shadow);margin-top:10px}
.toast{position:fixed;left:50%;bottom:calc(var(--tab) + var(--bottom) + 28px);transform:translateX(-50%);z-index:80;max-width:86%;background:var(--ink);color:var(--bg);padding:12px 18px;border-radius:16px;font-size:14px;font-weight:600;box-shadow:var(--shadow-lg);animation:rise .25s ease both}
.viewer{position:fixed;inset:0;z-index:70;background:#05070a;animation:fade .2s ease both}
.viewer .slides{height:100%;aspect-ratio:auto;background:transparent}
.viewer img{object-fit:contain}
.viewer .close{position:absolute;right:16px;top:calc(var(--top) + 12px);z-index:2}
.viewer .counter{position:absolute;left:0;right:0;bottom:calc(var(--bottom) + 18px);text-align:center;color:#fff;font-weight:700;font-size:14px}
.skel{height:300px;border-radius:var(--r);background:linear-gradient(110deg,var(--card) 30%,var(--line) 50%,var(--card) 70%);background-size:200% 100%;animation:shimmer 1.3s linear infinite;margin-top:16px}
@media (min-width:700px){#app{max-width:560px;margin:0 auto}.tabs,.cta{left:50%;right:auto;width:536px;transform:translateX(-50%)}.sheet{left:50%;right:auto;width:560px;transform:translateX(-50%);animation:none}}
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
    ru: { retry: 'Повторить', pickDay: 'Выберите день', pickTime: 'Выберите время', questionShort: 'Напишите вопрос', unavailable: 'Этот проект сейчас недоступен', tooMany: 'Слишком много действий подряд. Попробуйте через несколько минут.', allCities: 'Все города', catalog: 'Каталог', favorites: 'Избранное', compare: 'Сравнение', about: 'О нас', all: 'Все', sale: 'Продажа', rent: 'Аренда', from: 'от', filters: 'Фильтры', price: 'Цена', priceTo: 'Цена до', anyPrice: 'Любая', bedrooms: 'Спальни', anyBeds: 'Любое', apply: 'Показать', reset: 'Сбросить', found: 'Найдено', none: 'Ничего не найдено', noneHint: 'Измените фильтры или напишите менеджеру: подберём вариант.', remove: 'Убрать', book: 'Записаться на просмотр', bookShort: 'Записаться', contact: 'Связаться', calc: 'Расчёт покупки и ипотеки', similar: 'Похожие проекты', description: 'Описание', facts: 'Характеристики', location: 'Расположение', map: 'Карта', video: 'Видео', site: 'Сайт проекта', readMore: 'Читать полностью', collapse: 'Свернуть', photos: 'Фото', day: 'День', time: 'Время', morning: 'Утром', afternoon: 'Днём', evening: 'Вечером', online: 'Онлайн-показ по видеосвязи', name: 'Ваше имя', phone: 'Телефон', note: 'Комментарий (по желанию)', send: 'Отправить', bookTitle: 'Запись на просмотр', thanks: 'Заявка принята', thanksText: 'Менеджер свяжется с вами, чтобы подтвердить время. Подтверждение придёт в чат с ботом.', confirmed: 'Просмотр подтверждён', confirmedText: 'Время закреплено за вами. Подробности — в чате с ботом.', close: 'Закрыть', call: 'Позвонить', whatsapp: 'WhatsApp', telegram: 'Написать в Telegram', email: 'Написать на e-mail', website: 'Сайт компании', office: 'Офис на карте', callMe: 'Заказать звонок', callMeHint: 'Оставьте номер: перезвоним в удобное время', ask: 'Задать вопрос', askHint: 'Ответим в чате с ботом', question: 'Ваш вопрос', preferred: 'Удобное время для звонка', compareEmpty: 'Добавьте проекты в сравнение', compareEmptyHint: 'Нажмите значок весов на карточке проекта. Можно сравнить до трёх.', favEmpty: 'Здесь пока пусто', favEmptyHint: 'Нажимайте сердечко на понравившихся проектах, чтобы вернуться к ним позже.', limit: 'Сравнить можно не больше трёх проектов', guestHint: 'Откройте приложение из Telegram, чтобы сохранять и записываться', saved: 'Сохранено', removed: 'Убрано', reservedNote: 'Объект забронирован: напишите менеджеру', slotTaken: 'Это время только что заняли: выберите другое', phoneNeeded: 'Укажите телефон: менеджер подтвердит время', noTimes: 'Свободных окон пока нет — оставьте заявку, подберём время', years: 'лет', down: 'Первый взнос', term: 'Срок', rate: 'Ставка', hello: 'Здравствуйте', tagline: 'Проекты у моря', yearsOnMarket: 'лет на рынке', dealsDone: 'сделок', guide: 'Как купить в Испании', reviews: 'Отзывы клиентов', allReviews: 'Все отзывы', manager: 'Ваш менеджер', share: 'Поделиться', sea: 'до моря', best: 'лучшее', addCompare: 'В сравнение', inCompare: 'В сравнении', error: 'Не получилось. Попробуйте ещё раз.', loading: 'Загрузка…', reg: 'Регистрация', addr: 'Офис' },
    en: { retry: 'Try again', pickDay: 'Choose a day', pickTime: 'Choose a time', questionShort: 'Please write your question', unavailable: 'This project is not available right now', tooMany: 'Too many actions in a row. Please try again in a few minutes.', allCities: 'All cities', catalog: 'Projects', favorites: 'Saved', compare: 'Compare', about: 'About', all: 'All', sale: 'For sale', rent: 'For rent', from: 'from', filters: 'Filters', price: 'Price', priceTo: 'Price up to', anyPrice: 'Any', bedrooms: 'Bedrooms', anyBeds: 'Any', apply: 'Show', reset: 'Reset', found: 'Found', none: 'Nothing found', noneHint: 'Change the filters or message an agent: we will find an option.', remove: 'Remove', book: 'Book a viewing', bookShort: 'Book viewing', contact: 'Contact', calc: 'Purchase and mortgage calculator', similar: 'Similar projects', description: 'About', facts: 'Details', location: 'Location', map: 'Map', video: 'Video', site: 'Project website', readMore: 'Read more', collapse: 'Show less', photos: 'Photos', day: 'Day', time: 'Time', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', online: 'Online viewing by video call', name: 'Your name', phone: 'Phone', note: 'Comment (optional)', send: 'Send', bookTitle: 'Book a viewing', thanks: 'Request received', thanksText: 'An agent will contact you to confirm the time. The confirmation will arrive in your chat with the bot.', confirmed: 'Viewing confirmed', confirmedText: 'The time is yours. Details are in your chat with the bot.', close: 'Close', call: 'Call', whatsapp: 'WhatsApp', telegram: 'Message on Telegram', email: 'Send an e-mail', website: 'Company website', office: 'Office on the map', callMe: 'Request a call', callMeHint: 'Leave your number and we will call back', ask: 'Ask a question', askHint: 'We will answer in your chat with the bot', question: 'Your question', preferred: 'Convenient time for a call', compareEmpty: 'Add projects to compare', compareEmptyHint: 'Tap the scales icon on a project. Up to three at once.', favEmpty: 'Nothing here yet', favEmptyHint: 'Tap the heart on projects you like to come back to them later.', limit: 'You can compare up to three projects', guestHint: 'Open the app from Telegram to save and book', saved: 'Saved', removed: 'Removed', reservedNote: 'This property is reserved: message an agent', slotTaken: 'That time was just taken: choose another', phoneNeeded: 'Add a phone so an agent can confirm the time', noTimes: 'No free slots yet: leave a request and we will arrange a time', years: 'years', down: 'Down payment', term: 'Term', rate: 'Rate', hello: 'Hello', tagline: 'Projects by the sea', yearsOnMarket: 'years on the market', dealsDone: 'deals', guide: 'How to buy in Spain', reviews: 'Client reviews', allReviews: 'All reviews', manager: 'Your agent', share: 'Share', sea: 'to the sea', best: 'best', addCompare: 'Compare', inCompare: 'In comparison', error: 'Something went wrong. Please try again.', loading: 'Loading…', reg: 'Registration', addr: 'Office' },
    es: { retry: 'Reintentar', pickDay: 'Elige un día', pickTime: 'Elige una hora', questionShort: 'Escribe tu pregunta', unavailable: 'Este proyecto no está disponible ahora', tooMany: 'Demasiadas acciones seguidas. Inténtalo de nuevo en unos minutos.', allCities: 'Todas', catalog: 'Proyectos', favorites: 'Favoritos', compare: 'Comparar', about: 'Nosotros', all: 'Todos', sale: 'Venta', rent: 'Alquiler', from: 'desde', filters: 'Filtros', price: 'Precio', priceTo: 'Precio hasta', anyPrice: 'Cualquiera', bedrooms: 'Dormitorios', anyBeds: 'Cualquiera', apply: 'Mostrar', reset: 'Borrar', found: 'Encontrados', none: 'Sin resultados', noneHint: 'Cambia los filtros o escribe a un asesor: buscaremos una opción.', remove: 'Quitar', book: 'Reservar visita', bookShort: 'Reservar', contact: 'Contactar', calc: 'Calculadora de compra e hipoteca', similar: 'Proyectos similares', description: 'Descripción', facts: 'Características', location: 'Ubicación', map: 'Mapa', video: 'Vídeo', site: 'Web del proyecto', readMore: 'Leer más', collapse: 'Ver menos', photos: 'Fotos', day: 'Día', time: 'Hora', morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche', online: 'Visita online por videollamada', name: 'Tu nombre', phone: 'Teléfono', note: 'Comentario (opcional)', send: 'Enviar', bookTitle: 'Reservar visita', thanks: 'Solicitud recibida', thanksText: 'Un asesor se pondrá en contacto para confirmar la hora. La confirmación llegará al chat con el bot.', confirmed: 'Visita confirmada', confirmedText: 'La hora es tuya. Los detalles están en el chat con el bot.', close: 'Cerrar', call: 'Llamar', whatsapp: 'WhatsApp', telegram: 'Escribir por Telegram', email: 'Enviar un correo', website: 'Web de la empresa', office: 'Oficina en el mapa', callMe: 'Pedir una llamada', callMeHint: 'Deja tu número y te llamaremos', ask: 'Hacer una pregunta', askHint: 'Responderemos en el chat con el bot', question: 'Tu pregunta', preferred: 'Hora cómoda para la llamada', compareEmpty: 'Añade proyectos para comparar', compareEmptyHint: 'Pulsa la balanza en un proyecto. Hasta tres a la vez.', favEmpty: 'Aquí aún no hay nada', favEmptyHint: 'Pulsa el corazón en los proyectos que te gusten para volver a ellos.', limit: 'Se pueden comparar hasta tres proyectos', guestHint: 'Abre la aplicación desde Telegram para guardar y reservar', saved: 'Guardado', removed: 'Quitado', reservedNote: 'Inmueble reservado: escribe a un asesor', slotTaken: 'Esa hora se acaba de ocupar: elige otra', phoneNeeded: 'Añade un teléfono para que un asesor confirme la hora', noTimes: 'Aún no hay huecos libres: deja una solicitud y buscaremos hora', years: 'años', down: 'Entrada', term: 'Plazo', rate: 'Tipo', hello: 'Hola', tagline: 'Proyectos junto al mar', yearsOnMarket: 'años en el mercado', dealsDone: 'operaciones', guide: 'Cómo comprar en España', reviews: 'Opiniones de clientes', allReviews: 'Todas las opiniones', manager: 'Tu asesor', share: 'Compartir', sea: 'al mar', best: 'mejor', addCompare: 'Comparar', inCompare: 'En comparación', error: 'No ha salido bien. Inténtalo de nuevo.', loading: 'Cargando…', reg: 'Registro', addr: 'Oficina' },
  };

  var ICON = {
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/>',
    scale: '<path d="M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5v.01"/>',
    bath: '<path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM6 12V6a2 2 0 0 1 3.5-1.3M7 19l-1 2M17 19l1 2"/>',
    area: '<path d="M4 4h16v16H4zM4 9h5M4 14h3M9 4v5M14 4v3"/>',
    wave: '<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7"/>',
    floor: '<path d="M5 21V5l7-2 7 2v16M3 21h18M9 9h2M13 9h2M9 13h2M13 13h2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8zM7.5 8v.01"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    plane: '<path d="M21 4 3 11l6 2.5L11 20l3-4.5L19 18z"/>',
    mail: '<path d="M3 6h18v12H3zM3 7l9 7 9-7"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M4 12.5 9.5 18 20 6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/>',
    video: '<path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    calc: '<path d="M5 3h14v18H5zM8 7h8M8 12h2M12 12h2M16 12h.01M8 16h2M12 16h2M16 16h.01"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    photos: '<path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5v.01"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>',
    build: '<path d="M3 21h18M6 21V8l6-4 6 4v13M10 21v-5h4v5"/>',
  };
  function icon(name, extra) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICON[name] || '';
    if (extra) svg.setAttribute('class', extra);
    return svg;
  }
  var FACT_ICON = { bedrooms: 'bed', bathrooms: 'bath', area: 'area', plot: 'leaf', sea: 'wave', floor: 'floor', condition: 'build', reference: 'tag' };

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
  var S = { lang: 'ru', scrolls: { home: 0, fav: 0 }, loadSeq: 0, renderSeq: 0, boot: null, route: { name: 'home' }, filters: { type: '', city: '', deal: '', maxPrice: 0, beds: 0 }, detail: {}, sheets: [], scroll: 0 };
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
  var ERROR_KEYS = { 'phone-required': 'phoneNeeded', 'question-short': 'questionShort', 'pick-day': 'pickDay', 'pick-time': 'pickTime', unavailable: 'unavailable', reserved: 'reservedNote', 'slot-taken': 'slotTaken', limit: 'limit', 'too-many': 'tooMany' };
  function errorText(data) {
    var key = data && data.code ? ERROR_KEYS[data.code] : '';
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
    if (S.sheets.length || S.route.name !== 'home' && S.route.name !== 'fav' && S.route.name !== 'cmp' && S.route.name !== 'about') tg.BackButton.show();
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
    if (parts[0] === 'fav') return { name: 'fav' };
    if (parts[0] === 'cmp') return { name: 'cmp' };
    if (parts[0] === 'about') return { name: 'about' };
    return { name: 'home' };
  }
  function go(name, id) {
    if (S.route && (S.route.name === 'home' || S.route.name === 'fav')) S.scrolls[S.route.name] = window.scrollY;
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
  function cardEl(card, index) {
    var photo = h('div', { class: 'photo' });
    if (card.cover) {
      var image = h('img', { src: card.cover, alt: card.title, loading: index > 1 ? 'lazy' : 'eager', decoding: 'async' });
      photo.appendChild(image);
    }
    var badges = h('div', { class: 'badges' });
    if (card.reserved) badges.appendChild(h('span', { class: 'badge reserved', text: card.reservedLabel }));
    if (card.price.previous) badges.appendChild(h('span', { class: 'badge drop', text: '↓' }));
    if (card.underConstruction && card.condition) badges.appendChild(h('span', { class: 'badge build', text: card.condition }));
    card.badges.slice(0, 2).forEach(function (label) { badges.appendChild(h('span', { class: 'badge', text: label })); });
    photo.appendChild(badges);
    photo.appendChild(heartButton(card));
    var priceNode = h('div', { class: 'price-on-photo' }, [h('b', null, priceBlock(card.price))]);
    photo.appendChild(priceNode);
    if (card.photoCount > 1) photo.appendChild(h('span', { class: 'count' }, [icon('photos'), String(card.photoCount)]));
    var body = h('div', { class: 'body' }, [
      h('h3', { text: card.title }),
      h('div', { class: 'place' }, [icon('pin'), card.typeLabel + (card.place ? ' · ' + card.place : '')]),
      h('div', { class: 'facts-row' }, card.facts.slice(0, 4).map(factChip)),
    ]);
    var node = h('article', { class: 'card', role: 'button', tabindex: '0', style: false }, [photo, body]);
    node.style.animationDelay = Math.min(index || 0, 6) * 60 + 'ms';
    node.addEventListener('click', function () { go('property', card.id); });
    return node;
  }

  /* ---------- главная ---------- */
  function headerEl() {
    var company = S.boot.company;
    var user = S.boot.user;
    var greeting = user && user.name ? t('hello') + ', ' + user.name.split(' ')[0] : t('tagline');
    var langs = h('div', { class: 'langs' }, ['ru', 'en', 'es'].map(function (code) {
      return h('button', { class: S.lang === code ? 'on' : '', text: code.toUpperCase(), onclick: function () { setLanguage(code); } });
    }));
    return h('header', { class: 'top' }, [h('div', { class: 'top-row' }, [
      h('div', { class: 'brand' }, [h('img', { src: '/logo.png', alt: '' }), h('div', null, [h('b', { text: company.name }), h('span', { text: greeting })])]),
      langs,
    ])]);
  }
  function filteredCards() {
    var f = S.filters;
    return S.boot.cards.filter(function (card) {
      if (f.type && card.type !== f.type) return false;
      if (f.city && card.city !== f.city) return false;
      if (f.deal && card.deal !== f.deal) return false;
      if (f.maxPrice && card.raw.price && card.raw.price > f.maxPrice) return false;
      if (f.beds && card.raw.bedroomsMax < f.beds) return false;
      return true;
    });
  }
  function filtersActive() {
    var f = S.filters;
    return Boolean(f.type || f.city || f.deal || f.maxPrice || f.beds);
  }
  function chipRow(options, current, onPick) {
    return h('div', { class: 'chips' }, options.map(function (option) {
      return h('button', { class: 'chip' + (option.key === current ? ' on' : ''), text: option.label, onclick: function () { onPick(option.key); } });
    }));
  }
  function renderHome(view) {
    var facets = S.boot.facets;
    var page = h('div', { class: 'page' });
    var cards = filteredCards();
    page.appendChild(h('h1', { text: t('catalog') }));
    page.appendChild(h('div', { class: 'sub', text: S.boot.cards.length ? S.boot.company.promise || '' : '' }));
    var typeOptions = [{ key: '', label: t('all') }].concat(facets.types.map(function (item) { return { key: item.key, label: item.label }; }));
    if (facets.types.length > 1) page.appendChild(h('div', { style: false }, [chipRow(typeOptions, S.filters.type, function (key) { S.filters.type = key; render(); })]));
    var second = [];
    if (facets.cities.length > 1) second.push({ key: '', label: t('allCities') });
    facets.cities.forEach(function (city) { second.push({ key: city, label: city }); });
    var row = h('div', { class: 'chips' });
    if (facets.cities.length > 1) second.forEach(function (option) {
      row.appendChild(h('button', { class: 'chip' + (option.key === S.filters.city ? ' on' : ''), text: option.label, onclick: function () { S.filters.city = option.key; render(); } }));
    });
    row.appendChild(h('button', { class: 'chip' + (S.filters.maxPrice || S.filters.beds || S.filters.deal ? ' on' : ''), onclick: openFilters }, [t('filters')]));
    page.appendChild(row);
    var list = h('div', { class: 'list' });
    if (!cards.length) {
      list.appendChild(h('div', { class: 'empty' }, [icon('grid'), h('h3', { text: t('none') }), h('div', { text: t('noneHint') }), h('div', { style: false }, [
        h('button', { class: 'btn soft', style: false, onclick: function () { S.filters = { type: '', city: '', deal: '', maxPrice: 0, beds: 0 }; render(); } }, [t('reset')]),
      ])]));
    } else cards.forEach(function (card, index) { list.appendChild(cardEl(card, index)); });
    page.appendChild(list);
    view.appendChild(page);
  }
  function openFilters() {
    var facets = S.boot.facets;
    var draft = { deal: S.filters.deal, maxPrice: S.filters.maxPrice, beds: S.filters.beds };
    openSheet(function (sheet, close) {
      var priceLabel = h('output');
      var range = h('input', { type: 'range' });
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
      range.addEventListener('input', function () { paintRange(range); draft.maxPrice = Number(range.value) >= Number(range.max) ? 0 : Number(range.value); paint(); });
      paint();
      var dealChips = facets.deals.length > 1 ? chipRow([{ key: '', label: t('all') }, { key: 'sale', label: t('sale') }, { key: 'rent', label: t('rent') }], draft.deal, function (key) { draft.deal = key; rebuild(); }) : null;
      var bedOptions = [{ key: 0, label: t('anyBeds') }];
      for (var i = 1; i <= Math.min(4, facets.maxBedrooms); i += 1) bedOptions.push({ key: i, label: i + '+' });
      var bedRow = h('div', { class: 'chips' });
      function rebuild() {
        clear(bedRow);
        bedOptions.forEach(function (option) {
          bedRow.appendChild(h('button', { class: 'chip' + (option.key === draft.beds ? ' on' : ''), text: option.label, onclick: function () { draft.beds = option.key; rebuild(); } }));
        });
      }
      rebuild();
      sheet.appendChild(h('h2', { text: t('filters') }));
      if (dealChips) sheet.appendChild(h('div', { class: 'section' }, [dealChips]));
      if (facets.price) sheet.appendChild(h('div', { class: 'slider' }, [h('label', null, [t('priceTo'), priceLabel]), range]));
      if (facets.maxBedrooms > 0) sheet.appendChild(h('div', { class: 'section' }, [h('h3', { text: t('bedrooms') }), h('div', { style: false }, [bedRow])]));
      sheet.appendChild(h('div', { class: 'section' }, [
        h('button', { class: 'btn primary wide', onclick: function () { S.filters.deal = draft.deal; S.filters.maxPrice = draft.maxPrice; S.filters.beds = draft.beds; close(); render(); } }, [t('apply')]),
        h('button', { class: 'btn soft wide', style: false, onclick: function () { S.filters = { type: '', city: '', deal: '', maxPrice: 0, beds: 0 }; close(); render(); } }, [t('reset')]),
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
        body.appendChild(h('section', { class: 'section' }, [h('h3', { text: t('calc') }), calculatorEl(detail.calculator)]));
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
      sheet.appendChild(h('h2', { text: t('bookTitle') }));
      sheet.appendChild(h('div', { class: 'sub', text: detail.title }));
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
            clear(sheet);
            sheet.appendChild(h('div', { class: 'grip' }));
            sheet.appendChild(h('div', { class: 'success' }, [
              h('div', { class: 'check' }, [icon('check')]),
              h('h2', { text: result.confirmed ? t('confirmed') : t('thanks') }),
              h('p', { class: 'sub', text: result.confirmed ? t('confirmedText') : t('thanksText') }),
              h('button', { class: 'btn ink wide', style: false, onclick: close }, [t('close')]),
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
  function openQuestion(detail) {
    openSheet(function (sheet, close) {
      var text = h('textarea', { maxlength: '1000' });
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

  /* ---------- избранное, сравнение, о нас ---------- */
  function emptyEl(iconName, title, hint) {
    return h('div', { class: 'empty' }, [icon(iconName), h('h3', { text: title }), h('div', { text: hint })]);
  }
  function renderFavorites(view) {
    var page = h('div', { class: 'page' }, [h('h1', { text: t('favorites') })]);
    var cards = S.boot.cards.filter(function (card) { return isFavorite(card.id); });
    if (!cards.length) page.appendChild(emptyEl('heart', t('favEmpty'), t('favEmptyHint')));
    else page.appendChild(h('div', { class: 'list' }, cards.map(function (card, index) { return cardEl(card, index); })));
    view.appendChild(page);
  }
  function renderCompare(view) {
    var page = h('div', { class: 'page' }, [h('h1', { text: t('compare') })]);
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
    page.appendChild(list);
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

  /* ---------- каркас ---------- */
  var tabsEl = null;
  function tabButton(name, label, iconName, route) {
    var node = h('button', { class: 'tab' + (S.route.name === route ? ' on' : ''), 'data-tab': name, onclick: function () { go(route); } }, [icon(iconName), h('span', { text: label })]);
    return node;
  }
  function updateTabs() {
    if (!tabsEl) return;
    var counts = { fav: S.boot.favorites.length, cmp: S.boot.compare.length };
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
    if (main === 'home') { root.appendChild(headerEl()); renderHome(view); }
    else if (main === 'fav') { root.appendChild(headerEl()); renderFavorites(view); }
    else if (main === 'cmp') { root.appendChild(headerEl()); renderCompare(view); }
    else if (main === 'about') { root.appendChild(headerEl()); renderAbout(view); }
    root.appendChild(view);
    if (main === 'property') renderProperty(view);
    if (main !== 'property') {
      tabsEl = h('nav', { class: 'tabs' }, [
        tabButton('home', t('catalog'), 'grid', 'home'),
        tabButton('fav', t('favorites'), 'heart', 'fav'),
        tabButton('cmp', t('compare'), 'scale', 'cmp'),
        tabButton('about', t('about'), 'info', 'about'),
      ]);
      root.appendChild(tabsEl);
      updateTabs();
    } else tabsEl = null;
    var again = S.scrolls[main];
    if (again) {
      S.scrolls[main] = 0;
      window.scrollTo(0, again);
    }
    syncBack();
  }
  function setLanguage(code) {
    if (S.lang === code) return;
    S.lang = code;
    store('lang', code);
    document.documentElement.setAttribute('lang', code);
    S.detail = {};
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
  if (saved === 'ru' || saved === 'en' || saved === 'es') S.lang = saved;
  else S.lang = '';
  S.route = parseHash();
  load();
})();
`;

export { APP_CSS, APP_HTML, APP_JS };
