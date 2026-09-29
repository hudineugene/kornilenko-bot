'use strict';

// Слова, которые бот говорит владельцу: куда идти («Настройки → Обслуживание →
// …») и как называется состояние. После переделки навигации в самопроверке
// остались адреса несуществующих разделов («Настройки → Подключение», «Тексты
// бота → Интерфейс → privacy»), а на экранах — служебные слова из кода
// («reconnecting», «off», «ref»). Владелец не программист: ему нужны названия
// того, что он видит на экране.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bot, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

async function panelHtml() {
  const { PANEL_HTML } = await import('../src/panel/index.mjs');
  return PANEL_HTML;
}

test.describe('адреса в панели, на которые отсылает бот', () => {
  test('каждое место из списка существует: все его части — названия на экранах панели', async () => {
    const { PLACES } = await import('../src/places.mjs');
    const html = await panelHtml();
    for (const [key, place] of Object.entries(PLACES)) {
      const parts = place.split('→').map((part) => part.trim().replace(/[«»]/g, ''));
      for (const part of parts) {
        assert.ok(html.includes(part), 'место «' + key + '» → «' + place + '»: в панели нет названия «' + part + '»');
      }
    }
  });

  test('самопроверка и сообщения бота называют места только из этого списка', () => {
    // Раньше адреса писались строками прямо в коде и отставали от панели.
    for (const file of ['selfcheck.mjs', 'retention.mjs', 'inquiries.mjs', 'offsite.mjs']) {
      const text = source(file);
      assert.ok(!/Настройки → (Подключение|Данные|Работа с клиентами)/.test(text), file + ': остался адрес несуществующего раздела');
      assert.ok(!text.includes('Интерфейс → privacy'), file + ': остался адрес несуществующей вкладки');
      assert.ok(!text.includes('«Переписка» → «Очистить»'), file + ': остался прежний адрес очистки');
      assert.ok(!text.includes('«Резервная копия» → «Восстановить»'), file + ': остался прежний адрес восстановления');
      assert.ok(!text.includes('Каталог → Объекты'), file + ': остался прежний адрес каталога');
    }
  });

  test('самопроверка отправляет к нынешним экранам', async () => {
    resetData((data) => { data.config.botToken = ''; data.config.active = true; });
    const { runSelfCheck } = await import('../src/selfcheck.mjs');
    const report = runSelfCheck();
    const token = report.checks.find((item) => item.id === 'token');
    assert.equal(token.hint, 'Настройки → Подключение');
  });
});

test.describe('состояние связи — по-русски', () => {
  test('самопроверка не показывает слово из кода вместо состояния', async () => {
    const { connectionDetail } = await import('../src/selfcheck.mjs');
    const { runtime } = await import('../src/store.mjs');
    const saved = { status: runtime.status, failures: runtime.consecutiveFailures, error: runtime.lastError };
    try {
      runtime.status = 'reconnecting';
      runtime.consecutiveFailures = 2;
      runtime.lastError = '';
      const text = connectionDetail();
      assert.ok(!/reconnecting/.test(text), 'слова reconnecting нет: ' + text);
      assert.match(text, /переподключается/);
      assert.match(text, /неудачных попыток подряд: 2/);
    } finally {
      Object.assign(runtime, { status: saved.status, consecutiveFailures: saved.failures, lastError: saved.error });
    }
  });
});

test.describe('слова на экранах панели', () => {
  test('нет служебных слов из кода и прежних названий', async () => {
    const html = await panelHtml();
    for (const word of ['Карточка клиента 360', '(ref)', 'Токен туннеля', 'Интерфейс → privacy', 'chip brand">бот</span>']) {
      assert.ok(!html.includes(word), 'на экранах осталось: ' + word);
    }
    assert.ok(html.includes('от бота'), 'у сообщений бота подпись «от бота», а не «бот опрос»');
  });

  test('состояние туннеля выводится словами', async () => {
    const html = await panelHtml();
    for (const word of ['off: "выключен"', 'starting: "запускается"', 'online: "работает"', 'error: "ошибка"', 'missing: "не найден cloudflared.exe"']) {
      assert.ok(html.includes(word), 'нет перевода состояния: ' + word);
    }
    assert.ok(html.includes('TUNNEL_STATUS_WORDS[tunnel.status]'), 'экран берёт слова из этого списка');
  });

  test('{example} объяснён под приветствием и подставляется в предпросмотре', async () => {
    const html = await panelHtml();
    assert.ok(html.includes('{example} подставит пример запроса'), 'подсказка объясняет, что это такое');
    assert.ok(html.includes('replace(/\\{example\\}/g'), 'предпросмотр заменяет {example} образцом');
  });

  test('у заявки на подбор одно название и в панели, и в файлах, и в Telegram', async () => {
    const { inquiryTypeLabel } = await import('../src/inquiries.mjs');
    assert.equal(inquiryTypeLabel({ type: 'selection' }), 'подбор объекта');
    assert.ok((await panelHtml()).includes('selection: "подбор объекта"'), 'панель называет его так же');
    assert.ok(!(await panelHtml()).includes('подбор недвижимости'));
  });
});
