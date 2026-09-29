'use strict';

// Версия формата данных — единственная защита от старого bot.exe: увидев файл
// новее себя, он останавливается вместо того, чтобы молча привести данные к
// своему виду. Защита работает, только пока версию поднимают вместе с
// форматом, — а её несколько раз забывали поднять (newsConsentAt,
// businessTaxPercent, groupPosts.attempts, retentionMonths приехали на версии
// 28). Этот тест сверяет отпечаток набора полей: изменился формат — придётся
// поднять версию и обновить отпечаток осознанно.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Набор полей формата: только имена, без содержимого. Правка текста
// приветствия отпечаток не меняет, добавление поля — меняет.
function fieldPaths(value, path = '', paths = []) {
  if (!value || typeof value !== 'object') return paths;
  if (Array.isArray(value)) {
    for (const item of value) fieldPaths(item, path + '[]', paths);
    return paths;
  }
  for (const key of Object.keys(value).sort()) {
    paths.push(path + '/' + key);
    fieldPaths(value[key], path + '/' + key, paths);
  }
  return paths;
}

test('набор полей формата не меняется без повышения версии', async () => {
  const { DATA_VERSION, normalizeLoadedData } = await import('../src/data-format.mjs');
  const paths = fieldPaths(normalizeLoadedData({}));
  const fingerprint = crypto.createHash('sha1').update(paths.join('\n'), 'utf8').digest('hex').slice(0, 16);

  // Ожидаемое: версия формата и отпечаток её набора полей.
  const expected = { version: 47, fingerprint: 'd9c2fc368d19219c' };

  assert.equal(DATA_VERSION, expected.version, 'версия формата изменилась — обновите ожидаемое значение в этом тесте');
  assert.equal(fingerprint, expected.fingerprint, [
    'Набор полей в bot-data.json изменился.',
    'Поднимите DATA_VERSION в src/data-format.mjs и впишите здесь новые версию и отпечаток (' + fingerprint + ').',
    'Иначе старый bot.exe не заметит, что файл новее, и молча потеряет новые поля.',
  ].join(' '));
});
