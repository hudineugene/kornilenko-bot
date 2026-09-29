'use strict';

// Одна страница клиента — один запрос и одна заметка. Раньше карточка диалога
// сохранялась двумя запросами подряд (заявка, потом клиент): упал второй — первый
// уже применён; у клиента было две заметки («по этой заявке» и «общая»), и
// менеджер не знал, где что искать; а несохранённая правка терялась при уходе со
// страницы, потому что формы не было под наблюдением. Теперь: один запрос
// (заявка + заметка и теги клиента), одна заметка — о клиенте, форма под
// наблюдением.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, ADMIN_CHAT, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

let base = '';
let headers = {};
const minutesAgo = (count) => new Date(Date.now() - count * 60000).toISOString();

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

function inquiry(id, userId, extra = {}) {
  return { id, userId, chatId: userId, language: 'ru', type: 'question', text: 'Вопрос', status: 'new', pipelineStage: 'new', replies: [], messages: [], createdAt: minutesAgo(60), updatedAt: minutesAgo(50), clientMessageAt: minutesAgo(50), ...extra };
}

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    data.config.adminChatId = ADMIN_CHAT;
    data.users['1'] = { id: '1', chatId: 1, firstName: 'Анна', note: 'Любит море', tags: ['горячий'], activity: [] };
    data.inquiries.push(inquiry('a', '1'));
    const password = bot.hashPassword('one-save-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'one-save-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
  telegram.calls = [];
});

const patch = (body) => realFetch(base + '/api/inquiries/a', { method: 'PATCH', headers, body: JSON.stringify(body) });
const user = () => bot.getData().users['1'];
const item = () => bot.getData().inquiries.find((entry) => entry.id === 'a');

test.describe('один запрос', () => {
  test('заявка, заметка и теги клиента сохраняются одним PATCH', async () => {
    const answer = await patch({ status: 'in_progress', pipelineStage: 'contact', followUpDate: '2099-01-05', note: 'Ищет с видом на море', tags: ['покупка', ' горячий '] });
    assert.equal(answer.status, 200);
    assert.equal(item().status, 'in_progress');
    assert.equal(item().followUpDate, '2099-01-05');
    assert.equal(user().note, 'Ищет с видом на море', 'заметка — у клиента');
    assert.deepEqual(user().tags, ['покупка', 'горячий']);
    assert.equal(item().note || '', '', 'у заявки отдельной заметки больше нет');
  });

  test('всё или ничего: неверное поле — отказ, и ни заметка, ни теги, ни статус не применились', async () => {
    const bad = await patch({ status: 'выдуманный', note: 'Не должна сохраниться', tags: ['тег'] });
    assert.equal(bad.status, 400);
    assert.equal(user().note, 'Любит море');
    assert.deepEqual(user().tags, ['горячий']);
    const badDate = await patch({ note: 'И эта тоже', followUpDate: 'вчера', tags: ['тег'] });
    assert.equal(badDate.status, 400);
    assert.equal(user().note, 'Любит море');
    assert.equal(item().status, 'new');
  });

  test('без заметки и тегов клиент не трогается', async () => {
    assert.equal((await patch({ status: 'in_progress' })).status, 200);
    assert.equal(user().note, 'Любит море');
    assert.deepEqual(user().tags, ['горячий']);
  });

  test('пустая заметка стирает заметку клиента; слишком длинная обрезается', async () => {
    await patch({ note: 'x'.repeat(7000) });
    assert.equal(user().note.length, 6000);
    await patch({ note: '' });
    assert.equal(user().note, '');
  });

  test('заявка без клиента (клиента удалили): заметка остаётся у заявки, ничего не падает', async () => {
    delete bot.getData().users['1'];
    assert.equal((await patch({ note: 'Осталась без клиента' })).status, 200);
    assert.equal(item().note, 'Осталась без клиента');
  });
});

test.describe('одна заметка', () => {
  test('переезд: заметки по заявкам добавляются к заметке клиента, ничего не теряется и не дублируется', () => {
    const old = {
      version: 46,
      users: { 1: { id: '1', chatId: 1, firstName: 'Анна', note: 'Любит море' }, 2: { id: '2', chatId: 2, firstName: 'Борис' }, 3: { id: '3', chatId: 3, firstName: 'Вера', note: 'Тут уже есть: позвонить в среду' } },
      inquiries: [
        { id: 'a', userId: '1', type: 'question', createdAt: '2026-09-10T10:00:00.000Z', note: 'Нужен паркинг' },
        { id: 'b', userId: '2', type: 'question', createdAt: '2026-09-11T10:00:00.000Z', note: 'Только вилла' },
        { id: 'c', userId: '3', type: 'question', createdAt: '2026-09-12T10:00:00.000Z', note: 'позвонить в среду' },
        { id: 'd', userId: '1', type: 'question', createdAt: '2026-09-13T10:00:00.000Z', note: '' },
      ],
    };
    const migrated = bot.normalizeLoadedData(old);
    assert.match(migrated.users['1'].note, /^Любит море\n\nПо заявке от 10\.09: Нужен паркинг$/);
    assert.match(migrated.users['2'].note, /^По заявке от 11\.09: Только вилла$/, 'у клиента без заметки она появляется');
    assert.equal(migrated.users['3'].note, 'Тут уже есть: позвонить в среду', 'уже есть в заметке — не дублируем');
    assert.ok(migrated.inquiries.every((entry) => !entry.note), 'у заявок заметок больше нет');

    // Повторная загрузка ничего не добавляет.
    const again = bot.normalizeLoadedData(JSON.parse(JSON.stringify(migrated)));
    assert.equal(again.users['1'].note, migrated.users['1'].note);
  });

  test('не помещается в лимит (6000 знаков) — заметка остаётся у заявки, а не обрезается', () => {
    const migrated = bot.normalizeLoadedData({
      version: 46,
      users: { 1: { id: '1', chatId: 1, firstName: 'Анна', note: "a".repeat(5990) } },
      inquiries: [{ id: 'a', userId: '1', type: 'question', createdAt: '2026-09-10T10:00:00.000Z', note: 'Длинная важная заметка по заявке' }],
    });
    assert.equal(migrated.users['1'].note.length, 5990);
    assert.equal(migrated.inquiries[0].note, 'Длинная важная заметка по заявке');
  });

  test('слияние идёт от старых заявок к новым, как бы они ни лежали в списке', () => {
    const migrated = bot.normalizeLoadedData({
      version: 46,
      users: { 1: { id: '1', chatId: 1, firstName: 'Анна' } },
      inquiries: [
        { id: 'new', userId: '1', type: 'question', createdAt: '2026-09-20T10:00:00.000Z', note: 'Свежая заметка' },
        { id: 'old', userId: '1', type: 'question', createdAt: '2026-09-10T10:00:00.000Z', note: 'Старая заметка' },
      ],
    });
    const note = migrated.users['1'].note;
    assert.ok(note.indexOf('Старая заметка') < note.indexOf('Свежая заметка'), 'старая раньше свежей: ' + note);
  });

  test('длинная заметка клиента (до 6000 знаков) сохраняется целиком', async () => {
    const long = 'Просил не звонить утром. '.repeat(120);
    assert.ok(long.length > 2000 && long.length <= 6000);
    assert.equal((await patch({ note: long })).status, 200);
    assert.equal(user().note.length, long.trim().length);
  });

  test('напоминание «пора связаться» берёт заметку клиента', async () => {
    const { runFollowUpReminders } = await import('../src/notices.mjs');
    user().note = 'Просил звонить после обеда';
    Object.assign(item(), { followUpDate: '2020-01-01', followUpTime: '', followUpNotifiedAt: '' });
    telegram.calls = [];
    await runFollowUpReminders(new Date(2026, 8, 30, 12, 0));
    const message = telegram.calls.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ADMIN_CHAT);
    assert.ok(message, 'напоминание ушло');
    assert.match(message.body.text, /📝 Просил звонить после обеда/);
  });

  test('выгрузка заявок: в колонке «Заметка» — заметка клиента', async () => {
    const { inquiryExportRows, INQUIRY_EXPORT_COLUMNS } = await import('../src/excel.mjs');
    user().note = 'Заметка клиента';
    const column = INQUIRY_EXPORT_COLUMNS.findIndex((title) => /Заметк/i.test(title.title));
    assert.ok(column >= 0, 'колонка есть');
    assert.equal(inquiryExportRows([item()])[0][column], 'Заметка клиента');
  });
});
