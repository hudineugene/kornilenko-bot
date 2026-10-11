'use strict';

// Бот глазами клиента (этап 52): tools/walk-client.js проходит по всем кнопкам каталога, карточки, похожих, сравнения,
// «Моё», анкет на русском, английском и испанском и сверяет оформление с порогами этапов 44–50 (строк на телефоне,
// длина подписей кнопок, жирный заголовок). Раньше он запускался вручную; теперь — вместе со всеми тестами.
// В песочнице, кроме обычных карточек, есть карточка «цена по запросу» с тремя фотографиями.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const project = path.join(__dirname, '..');

test('прогон клиента на четырёх языках: ни одного молчания бота и ни одного замечания по оформлению', { timeout: 280000 }, () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-walk-test-'));
  try {
    const made = spawnSync(process.execPath, [path.join(project, 'tools', 'sandbox.js'), box], { encoding: 'utf8', timeout: 60000 });
    assert.equal(made.status, 0, 'песочница не собралась: ' + made.stderr);
    const walked = spawnSync(process.execPath, [path.join(project, 'tools', 'walk-client.js'), box, 'ru,uk,en,es'], { encoding: 'utf8', timeout: 240000 });
    const output = walked.stdout + walked.stderr;
    assert.match(output, /замечаний: 0 \(клиент без ответа\); по оформлению: 0/, output.slice(-1500));
    assert.equal(walked.status, 0, output.slice(-1500));

    const protocol = fs.readFileSync(path.join(box, 'walk-client.md'), 'utf8');
    // Карточка без цены и с тремя фотографиями прошла на всех трёх языках.
    for (const phrase of ['Цена по запросу', 'Ціна за запитом', 'Price on request', 'Precio a consultar']) assert.ok(protocol.includes(phrase), 'в протоколе нет карточки «' + phrase + '»');
    for (const phrase of ['Фото · 3', 'Photos · 3', 'Fotos · 3']) assert.ok(protocol.includes(phrase), 'в протоколе нет кнопки «' + phrase + '»');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});
