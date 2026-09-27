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
  data.config.adminName = 'Олег';
  data.config.managers = [{ id: 'manager-one', name: 'Мария', chatId: '9000501', verifiedAt: '' }];
  data.users['501'] = { id: '501', chatId: 501, firstName: 'Анна', lastName: 'Петрова', username: 'anna', phone: '+34 600 000 501', source: 'instagram', preferredLanguage: 'ru', activity: [] };
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

test.describe('lead sources report', () => {
  test('clients are counted by the label of their link, with how many sent a request', async () => {
    const data = bot.getData();
    data.users['503'] = { id: '503', chatId: 503, firstName: 'Olga', source: 'instagram', firstSeenAt: '2020-01-01T00:00:00.000Z', activity: [] };
    data.users['504'] = { id: '504', chatId: 504, firstName: 'Ivan', source: 'facebook', firstSeenAt: new Date().toISOString(), activity: [] };
    data.users['501'].firstSeenAt = new Date().toISOString();
    try {
      const state = await (await call('GET', '/api/state')).json();
      assert.deepEqual(state.sources, [
        { source: 'instagram', users: 2, recent: 1, withRequests: 1 },
        { source: 'facebook', users: 1, recent: 1, withRequests: 0 },
        { source: '', users: 1, recent: 0, withRequests: 1 },
      ]);
    } finally {
      delete data.users['503'];
      delete data.users['504'];
    }
  });
});

test.describe('property copies and order', () => {
  test('a copy is hidden, placed after the original and shares the photos', async () => {
    const data = bot.getData();
    const original = data.objects.find((item) => item.id === 'villa-1');
    original.reference = 'REF-1';
    original.imagesByLanguage.ru = [{ id: 'photo-1', storageFile: 'abc.jpg', mimeType: 'image/jpeg' }];
    const response = await call('POST', '/api/objects/villa-1/duplicate', {});
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const index = data.objects.findIndex((item) => item.id === 'villa-1');
    const copy = data.objects[index + 1];
    assert.equal(copy.id, id);
    assert.equal(copy.status, 'hidden', 'not shown to clients until checked');
    assert.deepEqual(copy.title, { ru: 'Вилла у моря (копия)', en: 'Sea villa (copy)', es: '' });
    assert.equal(copy.reference, '');
    assert.equal(copy.imagesByLanguage.ru[0].storageFile, 'abc.jpg');
    assert.notEqual(copy.imagesByLanguage.ru[0].id, 'photo-1');
    assert.equal(original.title.ru, 'Вилла у моря', 'the original is untouched');
    assert.equal((await call('POST', '/api/objects/missing/duplicate', {})).status, 404);

    assert.equal((await call('POST', '/api/objects/' + id + '/move', { step: -1 })).status, 200);
    assert.deepEqual(data.objects.slice(0, 2).map((item) => item.id), [id, 'villa-1']);
    const edge = await (await call('POST', '/api/objects/' + id + '/move', { step: -1 })).json();
    assert.equal(edge.moved, false, 'already first');
    assert.equal((await call('POST', '/api/objects/' + id + '/move', { step: 2 })).status, 400);
    assert.equal((await call('DELETE', '/api/objects/' + id)).status, 200);
    original.imagesByLanguage.ru = [];
  });
});

test.describe('property effectiveness', () => {
  test('the manager sees real counters and every interested client', async () => {
    const data = bot.getData();
    data.analytics.properties['villa-1'] = { impressions: 24, details: 9, galleries: 4, managerContacts: 2, favorites: 3, updatedAt: '2026-09-20T10:00:00.000Z' };
    data.users['501'].favorites = ['villa-1'];
    data.users['501'].comparisonIds = ['villa-1'];
    data.users['502'].recentlyViewed = ['villa-1'];
    data.users['502'].selectionMatchIds = ['villa-1'];
    const response = await call('GET', '/api/objects/villa-1/insights');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual([result.analytics.impressions, result.analytics.details, result.analytics.galleries], [24, 9, 4]);
    assert.deepEqual(result.summary, { clients: 2, inquiries: 1, inquiryClients: 1, viewings: 0, favorites: 1, comparisons: 1, viewed: 1, matches: 1 });
    assert.deepEqual(result.clients.map((client) => [client.id, client.signals]), [
      ['502', ['viewed', 'match', 'inquiry']],
      ['501', ['favorite', 'comparison']],
    ]);
    assert.equal(result.clients[0].latestInquiryId, 'inq-question');
    data.stats.statisticsResetAt = '2026-09-18T00:00:00.000Z';
    const afterReset = await (await call('GET', '/api/objects/villa-1/insights')).json();
    assert.equal(afterReset.summary.inquiries, 0, 'old inquiries are not mixed with counters collected after a reset');
    data.stats.statisticsResetAt = '';
    assert.equal((await call('GET', '/api/objects/missing/insights')).status, 404);
  });
});

test.describe('follow-up date in the panel', () => {
  test('a date and an optional time are saved, checked and cleared', async () => {
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { followUpDate: '18.09.2026' })).status, 400);
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { followUpDate: '2026-09-25', followUpTime: '9:00' })).status, 400);
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { followUpDate: '', followUpTime: '10:00' })).status, 400, 'a time needs a date');

    const inquiry = bot.getData().inquiries.find((item) => item.id === 'inq-lead');
    inquiry.followUpNotifiedAt = '2026-09-17T09:00:00.000Z';
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { followUpDate: '2026-09-25', followUpTime: '10:30', note: 'перезвонить' })).status, 200);
    assert.deepEqual([inquiry.followUpDate, inquiry.followUpTime, inquiry.followUpNotifiedAt], ['2026-09-25', '10:30', ''], 'a new date is reminded about again');

    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { status: 'in_progress' })).status, 200);
    assert.equal(inquiry.followUpDate, '2026-09-25', 'saving the status alone keeps the date');
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { followUpDate: '' })).status, 200);
    assert.deepEqual([inquiry.followUpDate, inquiry.followUpTime], ['', '']);
    inquiry.status = 'new';
  });
});

test.describe('conversation center', () => {
  test('the client card keeps editable contact details', async () => {
    const response = await call('PATCH', '/api/users/501', {
      contactName: 'Анна, покупатель', phone: '+34 611 222 333', preferredContactTime: 'после 16:00', preferredLanguage: 'es',
    });
    assert.equal(response.status, 200);
    const user = bot.getData().users['501'];
    assert.deepEqual([user.contactName, user.phone, user.preferredContactTime, user.preferredLanguage], ['Анна, покупатель', '+34 611 222 333', 'после 16:00', 'es']);
  });

  test('unread dialogs are counted by client and opening a dialog marks all their requests read', async () => {
    let state = await (await call('GET', '/api/state')).json();
    assert.equal(state.unreadConversationCount, 2);
    const response = await call('POST', '/api/conversations/501/read', {});
    assert.equal(response.status, 200);
    const readAt = (await response.json()).readAt;
    assert.equal(bot.getData().inquiries.find((item) => item.id === 'inq-lead').readAt, readAt);
    state = await (await call('GET', '/api/state')).json();
    assert.equal(state.unreadConversationCount, 1);
  });

  test('the panel assigns only a configured manager', async () => {
    const inquiry = bot.getData().inquiries.find((item) => item.id === 'inq-lead');
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { assignee: 'Мария' })).status, 200);
    assert.equal(inquiry.assignee, 'Мария');
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { assignee: 'Посторонний' })).status, 400);
    assert.equal(inquiry.assignee, 'Мария');
  });

  test('the sales stage is independent and final stages close the inquiry', async () => {
    const inquiry = bot.getData().inquiries.find((item) => item.id === 'inq-lead');
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { pipelineStage: 'unknown' })).status, 400);
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { pipelineStage: 'selection' })).status, 200);
    assert.deepEqual([inquiry.pipelineStage, inquiry.status], ['selection', 'new']);
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { pipelineStage: 'won' })).status, 200);
    assert.deepEqual([inquiry.pipelineStage, inquiry.status], ['won', 'closed']);
    assert.equal((await call('PATCH', '/api/inquiries/inq-lead', { pipelineStage: 'negotiation' })).status, 200);
    assert.deepEqual([inquiry.pipelineStage, inquiry.status], ['negotiation', 'in_progress'], 'returning to an active stage reopens the inquiry');
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
    assert.equal(header.J, 'Источник');
    assert.equal(header.L, 'Текст обращения');
    assert.equal(third, undefined, 'unknown ids are skipped');

    assert.equal(first.Q, 'inq-question');
    assert.equal(first.B, 'закрыто');
    assert.equal(first.C, 'вопрос по объекту');
    assert.equal(first.K, 'Вилла у моря');
    assert.equal(first.L, '=HYPERLINK(&quot;http://evil&quot;)', 'formula-like text stays a string');
    assert.equal(first.N, 1);
    assert.equal(first.O, 'Yes, it is available');

    assert.equal(second.D, 'Анна Петрова');
    assert.equal(second.E, '@anna');
    assert.equal(second.F, '+34 611 111 111', 'the phone from the request wins over the profile');
    assert.equal(second.G, 'Анна');
    assert.equal(second.H, 'Утром');
    assert.equal(second.M, 'перезвонить');
    assert.equal(second.J, 'instagram');
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
