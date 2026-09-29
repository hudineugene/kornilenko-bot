'use strict';

// «Вернуть» для необратимых действий. Раньше отмена была только у «Скрыть»: удалили
// акцию, объект или отменили пост — назад не вернуть. Теперь удалённая запись
// ещё несколько минут хранится у бота (в памяти) и возвращается на прежнее место
// вместе с фотографиями: файлы, пока отмена возможна, уборка не трогает. Отменённый
// пост возвращается в очередь, если время публикации ещё не прошло.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, property, resetData, cleanup } = require('./helpers/chat');

let base = '';
let headers = {};
let trash;

test.before(async () => {
  trash = await import('../src/trash.mjs');
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

test.beforeEach(async () => {
  trash.clearDeleted();
  resetData((data) => {
    data.config.active = true;
    data.promotions.push({ id: 'promo-1', title: { ru: 'Скидка недели' }, description: { ru: 'Три объекта' }, enabled: true });
    data.promotions.push({ id: 'promo-2', title: { ru: 'Вторая' }, description: { ru: 'Описание' }, enabled: true });
    data.objects.push(property('villa-1', 'Вилла', 'active'), property('villa-2', 'Дом', 'active'));
    data.analytics.properties['villa-1'] = { impressions: 12, details: 5, updatedAt: '2026-09-01T00:00:00.000Z' };
    const password = bot.hashPassword('undo-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
  });
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'undo-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
});

const call = (method, path, extra = {}) => realFetch(base + path, { method, headers: { ...headers, ...extra }, body: method === 'GET' ? undefined : '{}' });

test.describe('акции и объекты', () => {
  test('удалённая акция возвращается на прежнее место, второй раз — нет', async () => {
    assert.equal((await call('DELETE', '/api/promotions/promo-1')).status, 200);
    assert.deepEqual(bot.getData().promotions.map((item) => item.id), ['promo-2']);
    assert.equal((await call('POST', '/api/promotions/promo-1/restore')).status, 200);
    assert.deepEqual(bot.getData().promotions.map((item) => item.id), ['promo-1', 'promo-2'], 'на своём месте — первой');
    assert.equal(bot.getData().promotions[0].title.ru, 'Скидка недели', 'со всем содержимым');
    assert.equal((await call('POST', '/api/promotions/promo-1/restore')).status, 404, 'вернуть можно один раз');
  });

  test('объект возвращается вместе со счётчиками просмотров', async () => {
    assert.equal((await call('DELETE', '/api/objects/villa-1')).status, 200);
    assert.ok(!bot.getData().analytics.properties['villa-1'], 'счётчики убраны вместе с объектом');
    assert.equal((await call('POST', '/api/objects/villa-1/restore')).status, 200);
    assert.deepEqual(bot.getData().objects.map((item) => item.id), ['villa-1', 'villa-2']);
    assert.equal(bot.getData().analytics.properties['villa-1'].impressions, 12, 'счётчики на месте');
  });

  test('нельзя вернуть то, чего не удаляли, и то, что уже пересоздали с тем же номером', async () => {
    assert.equal((await call('POST', '/api/promotions/promo-2/restore')).status, 404, 'не удалялась');
    await call('DELETE', '/api/promotions/promo-1');
    bot.getData().promotions.push({ id: 'promo-1', title: { ru: 'Новая с тем же номером' }, description: { ru: '' }, enabled: true });
    assert.equal((await call('POST', '/api/promotions/promo-1/restore')).status, 409);
    assert.equal(bot.getData().promotions.filter((item) => item.id === 'promo-1').length, 1);
  });

  test('срок отмены ограничен; после него вернуть нельзя', async () => {
    await call('DELETE', '/api/promotions/promo-1');
    trash.purgeDeleted(Date.now() + trash.UNDO_WINDOW_MS + 1000);
    assert.equal((await call('POST', '/api/promotions/promo-1/restore')).status, 404);
  });

  test('фотографии удалённого объекта не считаются ничейными, пока отмена возможна', async () => {
    const { referencedImageFiles } = await import('../src/media.mjs');
    const record = property('with-photo', 'С фото', 'active');
    record.imagesByLanguage = { ru: [{ id: 'i1', mimeType: 'image/jpeg', storageFile: 'undo-photo.jpg' }], en: [], es: [] };
    bot.getData().objects.push(record);
    assert.ok(referencedImageFiles(bot.getData()).has('undo-photo.jpg'), 'предпосылка: файл используется');
    assert.equal((await call('DELETE', '/api/objects/with-photo')).status, 200);
    assert.ok(referencedImageFiles(bot.getData()).has('undo-photo.jpg'), 'после удаления файл ещё нужен: объект можно вернуть');
    trash.purgeDeleted(Date.now() + trash.UNDO_WINDOW_MS + 1000);
    assert.ok(!referencedImageFiles(bot.getData()).has('undo-photo.jpg'), 'когда время отмены вышло — файл свободен для уборки');
  });

  test('возврат требует входа и токена защиты', async () => {
    await call('DELETE', '/api/promotions/promo-1');
    const noLogin = await realFetch(base + '/api/promotions/promo-1/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noLogin.status, 401);
    assert.equal((await call('POST', '/api/promotions/promo-1/restore', { 'x-csrf-token': 'bad' })).status, 403);
    assert.equal(bot.getData().promotions.some((item) => item.id === 'promo-1'), false, 'записи по-прежнему нет');
  });
});

test.describe('отложенные публикации', () => {
  const GROUP = '-1003934963994';
  const future = () => new Date(Date.now() + 86400000).toISOString();
  const past = () => new Date(Date.now() - 86400000).toISOString();

  test('отменённый пост возвращается в очередь', async () => {
    bot.getData().groupPosts = [{ id: 'post-aaaa-1111', groupId: GROUP, text: 'Новый объект', status: 'scheduled', sendAt: future() }];
    assert.equal((await call('DELETE', '/api/group-posts/post-aaaa-1111')).status, 200);
    assert.equal(bot.getData().groupPosts[0].status, 'cancelled');
    assert.equal((await call('POST', '/api/group-posts/post-aaaa-1111/restore')).status, 200);
    assert.equal(bot.getData().groupPosts[0].status, 'scheduled');
    assert.equal(bot.getData().groupPosts[0].text, 'Новый объект');
  });

  test('время публикации уже прошло — вернуть нельзя: пост ушёл бы сразу, о чём никто не просил', async () => {
    bot.getData().groupPosts = [{ id: 'post-bbbb-2222', groupId: GROUP, text: 'Опоздал', status: 'cancelled', sendAt: past() }];
    const answer = await call('POST', '/api/group-posts/post-bbbb-2222/restore');
    assert.equal(answer.status, 409);
    assert.match((await answer.json()).error, /время публикации/i);
    assert.equal(bot.getData().groupPosts[0].status, 'cancelled');
  });

  test('вернуть можно только отменённый; неизвестный — 404', async () => {
    bot.getData().groupPosts = [{ id: 'post-cccc-3333', groupId: GROUP, text: 'Живой', status: 'scheduled', sendAt: future() }];
    assert.equal((await call('POST', '/api/group-posts/post-cccc-3333/restore')).status, 409);
    assert.equal((await call('POST', '/api/group-posts/post-нет-такого/restore')).status, 404);
  });
});
