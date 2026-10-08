'use strict';

// Готовый набор шаблонов ответов: кнопка в панели добавляет нейтральные шаблоны на трёх языках, свои не трогает и не дублирует.

const realFetch = global.fetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, resetData, cleanup } = require('./helpers/chat');

const PASSWORD = 'starter-password-3';
let base = '';
let headers = {};

test.beforeEach(async () => {
  resetData((data) => {
    data.config.active = true;
    const password = bot.hashPassword(PASSWORD);
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  if (!bot.server.listening) await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
});
test.after(async () => {
  if (bot.server.listening) await new Promise((resolve) => bot.server.close(resolve));
  cleanup();
});

const post = (path, body = {}) => realFetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });

test('готовый набор: десять шаблонов на трёх языках, повторное нажатие ничего не дублирует', async () => {
  const first = await (await post('/api/reply-templates/starter')).json();
  assert.equal(first.added, 10);
  const templates = bot.getData().replyTemplates;
  assert.equal(templates.length, 10);
  for (const template of templates) {
    assert.ok(template.title && template.title.length <= 80);
    for (const language of ['ru', 'en', 'es']) {
      assert.ok(template.text[language] && template.text[language].length <= 4000, template.title + ' [' + language + ']');
    }
  }
  const again = await (await post('/api/reply-templates/starter')).json();
  assert.equal(again.added, 0);
  assert.equal(bot.getData().replyTemplates.length, 10);
});

test('свой шаблон с тем же названием не затирается и не дублируется; лимит шаблонов не превышается', async () => {
  bot.getData().replyTemplates = [{ id: 'mine', title: 'Приветствие', text: { ru: 'Мой текст', en: '', es: '' }, updatedAt: new Date().toISOString() }];
  const result = await (await post('/api/reply-templates/starter')).json();
  assert.equal(result.added, 9);
  const mine = bot.getData().replyTemplates.find((item) => item.id === 'mine');
  assert.equal(mine.text.ru, 'Мой текст');
  assert.equal(bot.getData().replyTemplates.filter((item) => item.title === 'Приветствие').length, 1);
});

test('в панели у пустого списка шаблонов есть кнопка «Добавить готовый набор»', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel', 'view-inquiries.mjs'), 'utf8');
  assert.match(view, /id="starterTemplates"/);
  assert.match(view, /\/api\/reply-templates\/starter/);
});

test('без входа набор не добавляется', async () => {
  const response = await realFetch(base + '/api/reply-templates/starter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.ok([401, 403].includes(response.status), String(response.status));
});
