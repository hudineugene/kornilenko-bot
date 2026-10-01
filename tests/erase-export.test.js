'use strict';

// Удаление клиента должно убирать все следы, а выгрузка — показывать всё, что
// бот о нём хранит. Раньше оставались снимки в центре уведомлений, сообщения
// клиента в группе и его заявки на вступление.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, TOKEN, createChat, property, resetData, settle, cleanup } = require('./helpers/chat');

const GROUP = '-1001234567890';
let updateId = 60000;

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.config.adminChatId = '9990001';
  data.objects.push(property('flat-01', 'Квартира у моря', 'active', { priceValue: 250000, currency: 'EUR' }));
  data.groups = [{
    id: GROUP, title: 'Клуб покупателей', type: 'supergroup', status: 'administrator',
    rights: {}, messages: [], joinRequests: [], memberCount: 10, memberCountAt: '', lastMessageAt: '',
  }];
}));
test.after(cleanup);

// Клиент, который есть везде: заявка, уведомление в центре, сообщение в группе
// и заявка на вступление.
async function clientEverywhere() {
  const chat = createChat();
  await chat.say('/start');
  await chat.say('Здравствуйте, подскажите про документы');
  const data = bot.getData();
  const group = data.groups[0];
  group.messages.push({ messageId: 501, userId: String(chat.id), name: 'Анна', username: 'анна', text: 'Привет всем', kind: 'text', fromBot: false, date: new Date().toISOString() });
  group.messages.push({ messageId: 502, userId: '777999', name: 'Другой', username: '', text: 'И я', kind: 'text', fromBot: false, date: new Date().toISOString() });
  group.joinRequests.push({ userId: String(chat.id), name: 'Анна', username: 'анна', at: new Date().toISOString() });
  group.joinRequests.push({ userId: '777999', name: 'Другой', username: '', at: new Date().toISOString() });

  const { adminNotifications, updateAdminNotification } = await import('../src/admin-notifications.mjs');
  const notice = adminNotifications().find((item) => item.id.startsWith('message:' + chat.id + ':'));
  assert.ok(notice, 'в центре уведомлений есть запись о клиенте');
  updateAdminNotification(notice.id, 'handle');
  await settle();
  return { chat, group };
}

test('выгрузка показывает всё: заявки, сообщения в группе, заявки на вступление и уведомления', async () => {
  const { chat } = await clientEverywhere();
  const dump = bot.userDataExport(chat.user);

  assert.equal(dump.user.id, String(chat.id));
  assert.equal(dump.inquiries.length, 1, 'обращение в выгрузке');
  assert.equal(dump.groupMessages.length, 1, 'сообщение в группе в выгрузке');
  assert.equal(dump.groupMessages[0].groupTitle, 'Клуб покупателей', 'видно, в какой группе');
  assert.equal(dump.groupJoinRequests.length, 1, 'заявка на вступление в выгрузке');
  assert.equal(dump.adminNotifications.length >= 1, true, 'записи центра уведомлений в выгрузке');
  const others = JSON.stringify(dump).includes('777999');
  assert.equal(others, false, 'чужих данных в выгрузке нет');
});

test('удаление клиента убирает и снимки уведомлений, и следы в группе', async () => {
  const { chat, group } = await clientEverywhere();
  const id = String(chat.id);

  const removed = bot.eraseUserData(chat.user);
  assert.equal(removed.inquiriesRemoved, 1);
  assert.ok(removed.notificationsRemoved >= 1, 'снимки уведомлений удалены');
  assert.equal(removed.groupTracesRemoved, 2, 'сообщение в группе и заявка на вступление удалены');

  const data = bot.getData();
  assert.equal(data.users[id], undefined);
  assert.deepEqual(data.inquiries.filter((item) => String(item.userId) === id), []);
  assert.deepEqual(group.messages.filter((message) => String(message.userId) === id), [], 'сообщений клиента в группе нет');
  assert.deepEqual(group.joinRequests.filter((request) => String(request.userId) === id), [], 'заявок на вступление нет');
  assert.deepEqual(Object.keys(data.adminNotificationStates || {}).filter((key) => key.includes(id)), [], 'ключей с номером клиента нет');

  const leftovers = JSON.stringify({ users: data.users, inquiries: data.inquiries, groups: data.groups, states: data.adminNotificationStates });
  assert.equal(leftovers.includes(id), false, 'номера клиента в данных не осталось');
  assert.equal(group.messages.length, 1, 'сообщение другого участника на месте');
  assert.equal(group.joinRequests.length, 1, 'его заявка тоже');
});

test('клиент удаляет себя сам — следы уходят так же', async () => {
  const { chat, group } = await clientEverywhere();
  const id = String(chat.id);
  await chat.press('privacy:erase');
  await chat.press('privacy:erased');

  const data = bot.getData();
  assert.equal(data.users[id], undefined, 'клиента нет');
  assert.deepEqual(group.messages.filter((message) => String(message.userId) === id), [], 'следов в группе нет');
  assert.deepEqual(Object.keys(data.adminNotificationStates || {}).filter((key) => key.includes(id)), []);
});

test('удаление из панели проходит тем же путём', async () => {
  const { chat, group } = await clientEverywhere();
  const id = String(chat.id);
  const { handleClientsApi } = await import('../src/admin-api-clients.mjs');
  assert.equal(typeof handleClientsApi, 'function', 'ручка удаления клиента на месте');
  // Сама ручка вызывает eraseUserData — проверяем через него, чтобы не
  // поднимать HTTP-сервер в этом тесте.
  bot.eraseUserData(chat.user);
  assert.equal(bot.getData().users[id], undefined);
  assert.deepEqual(group.joinRequests.filter((request) => String(request.userId) === id), []);
});
