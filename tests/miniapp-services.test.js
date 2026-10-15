'use strict';

// Раздел «Услуги» в Mini App: пятая вкладка, пять направлений на четырёх языках, страница услуги (что входит, шаги, частые
// вопросы) и обращение к менеджеру с пометкой услуги.

const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/chat');

const { SERVICES, servicesOf } = require('../src/miniapp/services.mjs');
const { bootstrapOf } = require('../src/miniapp/data.mjs');
const { APP_CSS, APP_JS } = require('../src/miniapp/assets.mjs');

const LANGUAGES = ['ru', 'uk', 'en', 'es'];

test('услуги: пять направлений, у каждого полный текст на всех языках', () => {
  assert.deepEqual(SERVICES.map((item) => item.id), ['documents', 'banking', 'mortgage', 'accounting', 'support']);
  const ru = servicesOf('ru');
  for (const language of LANGUAGES) {
    const list = servicesOf(language);
    assert.equal(list.length, 5, language);
    list.forEach((item, index) => {
      const where = language + ' ' + item.id;
      for (const key of ['title', 'lead', 'subtitle', 'why', 'cta']) assert.ok(item[key], where + ' ' + key);
      assert.ok(item.intro.length, where + ' intro');
      // Переводы не теряют пункты: столько же, сколько в русском тексте.
      assert.equal(item.included.length, ru[index].included.length, where + ' included');
      assert.equal(item.steps.length, ru[index].steps.length, where + ' steps');
      assert.equal(item.faq.length, ru[index].faq.length, where + ' faq');
      for (const entry of item.included) assert.ok(entry.title && entry.text, where);
      assert.ok(['red', 'yellow', 'cyan'].includes(item.tone), item.id);
      assert.match(APP_JS, new RegExp('\\b' + item.icon + ": '<"), 'иконка ' + item.icon);
    });
  }
  assert.equal(ru[0].title, 'Документы и NIE');
  assert.equal(ru[2].cta, 'Узнать о возможности ипотеки');
  assert.equal(servicesOf('es')[2].title, 'Asesoría hipotecaria');
});

test('услуги: без цен и обещаний, на каждый частый вопрос есть утверждённый ответ', () => {
  for (const language of LANGUAGES) {
    const text = JSON.stringify(servicesOf(language));
    assert.doesNotMatch(text, /€|\d\s?(евро|eur)/i, language + ': цена до утверждения тарифа');
    assert.doesNotMatch(text, /легализац/i);
    for (const item of servicesOf(language)) {
      assert.equal(item.faq.length, 3, language + ' ' + item.id);
      for (const entry of item.faq) assert.ok(entry.q.endsWith('?') && entry.a.length > 80, language + ' ' + entry.q);
    }
  }
  assert.equal(servicesOf('ru')[0].faq[0].q, 'Можно ли оформить NIE без испанской резиденции?');
  assert.match(servicesOf('es')[3].faq[1].a, /Modelo 210/);
});

test('услуги: у каждого пункта «Что входит» своя пиктограмма из общей полосы', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { PIC_TOTAL } = require('../src/miniapp/services.mjs');
  const { MINIAPP_ASSETS } = require('../src/config.mjs');
  for (const language of LANGUAGES) {
    const pics = servicesOf(language).flatMap((item) => item.included.map((entry) => entry.pic));
    assert.deepEqual(pics, Array.from({ length: PIC_TOTAL }, (_, index) => index), language + ': по порядку, без пропусков');
  }
  assert.equal(PIC_TOTAL, 28);
  const file = path.join(__dirname, '..', 'miniapp-assets', 'services-icons.png');
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32BE(16), 112 * PIC_TOTAL, 'ширина полосы: 112 px на пиктограмму');
  assert.equal(bytes.readUInt32BE(20), 112);
  assert.ok(MINIAPP_ASSETS.servicesIcons && MINIAPP_ASSETS.servicesIcons.mimeType === 'image/png');
  assert.match(APP_CSS, /\.svc-pic\{[^}]*url\(\/services-icons\.png\)/);
  assert.match(APP_JS, /function servicePic\(entry, item\)/);
});

test('услуги приходят в приложение вместе с каталогом', () => {
  const boot = bootstrapOf('en');
  assert.equal(boot.services.length, 5);
  assert.equal(boot.services[1].title, 'Banking services');
  assert.ok(boot.services[1].faq.length >= 3);
});

test('услуги: вкладка, маршруты, страницы, вопросы менеджеру', () => {
  assert.doesNotThrow(() => new vm.Script(APP_JS), 'сценарий приложения разбирается');
  assert.ok(APP_JS.includes("tabButton('services', t('navServices'), 'briefcase', 'services')"));
  assert.match(APP_JS, /parts\[0\] === 'services' && parts\[1\]/);
  assert.match(APP_JS, /'#\/services\/' \+ encodeURIComponent\(id\)/);
  assert.match(APP_JS, /function renderServices\(view\)/);
  assert.match(APP_JS, /function renderService\(view\)/);
  // Вопросы раздела — менеджеру, минуя ИИ-консультанта, и с названием услуги в тексте.
  assert.match(APP_JS, /function askManager\(text\) \{ openQuestion\(null, text, true\); \}/);
  assert.match(APP_JS, /function openQuestion\(detail, preset, toManager\) \{\n\s+if \(!toManager && /);
  assert.match(APP_JS, /askManager\(t\('svcFaqAsk'\)\.replace\('\{x\}', item\.title\) \+ entry\.q\)/);
  for (const key of ['navServices', 'svcTitle', 'svcHeroTitle', 'svcIncluded', 'svcSteps', 'svcWhy', 'svcFaq', 'svcFaqAsk', 'svcFinalText']) {
    assert.equal((APP_JS.match(new RegExp('\\b' + key + ': ', 'g')) || []).length, 4, key + ' на четырёх языках');
  }
  for (const css of ['.svc{', '.svc-hero', '.svc-steps', '.svc-q{', '.tone-yellow{']) assert.ok(APP_CSS.includes(css), css);
  // Пять вкладок помещаются на узком экране: подписи в одну строку.
  assert.match(APP_CSS, /\.tab span\{white-space:nowrap\}/);
});
