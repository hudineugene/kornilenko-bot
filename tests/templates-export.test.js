'use strict';

// Reply templates API and the Excel export of inquiries.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-templates-test-'));
process.env.BOT_NO_START = '1';
process.env.BOT_DATA_FILE = path.join(workDirectory, 'bot-data.json');
process.env.BOT_MEDIA_DIRECTORY = path.join(workDirectory, 'bot-media');
process.env.NO_AUTO_OPEN = '1';

const bot = require('../bot.js');

// Reads the files of a ZIP archive (enough for the workbooks the bot writes).
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    files[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    offset = start + compressedSize;
  }
  return files;
}

function sheetCells(xml) {
  const rows = [];
  for (const [, rowXml] of xml.matchAll(/<row r="\d+">(.*?)<\/row>/gs)) {
    rows.push(Array.from(rowXml.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/gs))
      .reduce((cells, [, column, text, number]) => ({ ...cells, [column]: text !== undefined ? text : Number(number) }), {}));
  }
  return rows;
}

let baseUrl;
let cookie;
let csrf;

function call(method, url, body, headers = {}) {
  return fetch(baseUrl + url, {
    method,
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.before(async () => {
  const data = bot.normalizeLoadedData({ version: 15 });
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  data.config.botToken = '12345:ABCDEFGHIJKLMNOPQRSTUV';
  data.config.active = false;
  data.users['501'] = { id: '501', chatId: 501, firstName: 'Анна', lastName: 'Петрова', username: 'anna', phone: '+34 600 000 501', preferredLanguage: 'ru', activity: [] };
  data.users['502'] = { id: '502', chatId: 502, firstName: 'John', preferredLanguage: 'en', activity: [] };
  data.objects.push({ id: 'villa-1', status: 'active', title: { ru: 'Вилла у моря', en: 'Sea villa', es: '' }, imagesByLanguage: { ru: [], en: [], es: [] } });
  data.inquiries.push(
    { id: 'inq-lead', userId: '501', chatId: '501', language: 'ru', type: 'lead', status: 'new', text: 'Имя: Анна\nТелефон: +34 611 111 111', lead: { name: 'Анна', phone: '+34 611 111 111', preferredTime: 'Утром' }, replies: [], note: 'перезвонить', createdAt: '2026-09-17T08:30:00.000Z', updatedAt: '2026-09-17T08:30:00.000Z' },
    { id: 'inq-question', userId: '502', chatId: '502', language: 'en', type: 'question', propertyId: 'villa-1', status: 'closed', text: '=HYPERLINK("http://evil")', replies: [{ id: 'r1', text: 'Yes, it is available', source: 'panel', createdAt: '2026-09-17T10:00:00.000Z' }], createdAt: '2026-09-16T12:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z' },
  );
  bot.setData(data);
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + bot.server.address().port;
  const response = await fetch(baseUrl + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
  cookie = response.headers.get('set-cookie').split(';')[0];
  csrf = (await response.json()).csrf;
});

test.after(() => {
  bot.server.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

test.describe('reply templates', () => {
  test('a template is created, listed, edited and deleted', async () => {
    let response = await call('POST', '/api/reply-templates', { title: 'Ипотека', text: { ru: 'Здравствуйте, {first_name}! Ипотека возможна.', en: 'Hello, {first_name}! A mortgage is possible.' } });
    assert.equal(response.status, 201);
    const { id } = await response.json();

    let state = await (await call('GET', '/api/state')).json();
    assert.deepEqual(state.replyTemplates.map((item) => [item.title, item.text.ru, item.text.es]), [['Ипотека', 'Здравствуйте, {first_name}! Ипотека возможна.', '']]);

    response = await call('PATCH', '/api/reply-templates/' + id, { title: 'Ипотека для нерезидентов', text: { ru: 'Новый текст' } });
    assert.equal(response.status, 200);
    state = await (await call('GET', '/api/state')).json();
    assert.equal(state.replyTemplates[0].title, 'Ипотека для нерезидентов');
    assert.equal(state.replyTemplates[0].text.en, '');

    assert.equal((await call('DELETE', '/api/reply-templates/' + id)).status, 200);
    assert.equal((await call('DELETE', '/api/reply-templates/' + id)).status, 404);
    state = await (await call('GET', '/api/state')).json();
    assert.deepEqual(state.replyTemplates, []);
  });

  test('a template needs a title and text in at least one language', async () => {
    assert.equal((await call('POST', '/api/reply-templates', { title: '', text: { ru: 'Текст' } })).status, 400);
    assert.equal((await call('POST', '/api/reply-templates', { title: 'Пустой', text: { ru: '', en: '', es: '' } })).status, 400);
  });

  test('templates are kept across a restart', () => {
    const saved = bot.normalizeLoadedData({ version: 15, replyTemplates: [{ id: 't1', title: 'Просмотр', text: { ru: 'Когда удобно?' } }, { title: '', text: { ru: 'без названия' } }] });
    assert.deepEqual(saved.replyTemplates.map((item) => [item.id, item.title, item.text.ru]), [['t1', 'Просмотр', 'Когда удобно?']]);
  });

  test('changing templates requires the CSRF token', async () => {
    const response = await call('POST', '/api/reply-templates', { title: 'X', text: { ru: 'Y' } }, { 'x-csrf-token': 'wrong' });
    assert.equal(response.status, 403);
  });
});

test.describe('Excel export', () => {
  test('the selected inquiries are exported in the order shown', async () => {
    const response = await call('POST', '/api/inquiries/export', { ids: ['inq-question', 'inq-lead', 'missing'] });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="inquiries-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/);
    const files = unzip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const [header, first, second, third] = sheetCells(files['xl/worksheets/sheet1.xml']);
    assert.equal(header.A, 'Создано');
    assert.equal(header.K, 'Текст обращения');
    assert.equal(third, undefined, 'unknown ids are skipped');

    assert.equal(first.P, 'inq-question');
    assert.equal(first.B, 'закрыто');
    assert.equal(first.C, 'вопрос по объекту');
    assert.equal(first.J, 'Вилла у моря');
    assert.equal(first.K, '=HYPERLINK(&quot;http://evil&quot;)', 'formula-like text stays a string');
    assert.equal(first.M, 1);
    assert.equal(first.N, 'Yes, it is available');

    assert.equal(second.D, 'Анна Петрова');
    assert.equal(second.E, '@anna');
    assert.equal(second.F, '+34 611 111 111', 'the phone from the request wins over the profile');
    assert.equal(second.G, 'Анна');
    assert.equal(second.H, 'Утром');
    assert.equal(second.L, 'перезвонить');
    assert.equal(typeof second.A, 'number', 'dates are real Excel dates');
    assert.ok(Math.abs(second.A - (Date.parse('2026-09-17T08:30:00.000Z') - new Date('2026-09-17T08:30:00.000Z').getTimezoneOffset() * 60000) / 86400000 - 25569) < 1e-6);
  });

  test('without ids everything is exported', async () => {
    const files = unzip(Buffer.from(await (await call('POST', '/api/inquiries/export', {})).arrayBuffer()));
    assert.equal(sheetCells(files['xl/worksheets/sheet1.xml']).length, 3);
  });

  test('the export requires a logged-in session and the CSRF token', async () => {
    assert.equal((await fetch(baseUrl + '/api/inquiries/export', { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await call('POST', '/api/inquiries/export', {}, { 'x-csrf-token': 'wrong' })).status, 403);
  });

  test('control characters never break the workbook XML', () => {
    const files = unzip(bot.xlsxWorkbook('Лист', [{ title: 'A', width: 10 }], [['badchars <&>']]));
    assert.match(files['xl/worksheets/sheet1.xml'], /badchars &lt;&amp;&gt;/);
  });
});
