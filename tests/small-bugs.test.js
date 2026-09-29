'use strict';

// Мелкие ошибки, найденные проходом по новому коду (этап 25): каждая ловится
// одним небольшим случаем на стыке, который в обычной работе не встречается, но
// однажды встретится.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, createChat, property, resetData, cleanup } = require('./helpers/chat');
const { menu: MENU } = bot.text;

const GROUP = '-1003934963994';
let base = '';
let headers = {};

test.before(async () => {
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);

async function login() {
  const data = bot.getData();
  const password = bot.hashPassword('small-bugs-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'small-bugs-password' }) });
  headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
}

test.beforeEach(() => resetData((data) => { data.config.active = true; }));

test.describe('темы группы: ввод ссылки и номера', () => {
  const addTopic = (link) => realFetch(base + '/api/groups/' + GROUP + '/topics/add', { method: 'POST', headers, body: JSON.stringify({ link }) });

  test.beforeEach(async () => {
    const data = bot.getData();
    data.groups = [{ id: GROUP, title: 'Группа', type: 'supergroup', status: 'administrator', username: '', isForum: true, topics: [{ id: 1, name: '', closed: false }], messages: [], joinRequests: [], rights: {} }];
    await login();
  });

  test('ссылка с публичным именем не подходит группе, у которой публичного имени нет', async () => {
    const answer = await addTopic('https://t.me/other/12');
    assert.equal(answer.status, 400);
    assert.match((await answer.json()).error, /другую группу|публичн/);
    assert.deepEqual(bot.getData().groups[0].topics.map((topic) => topic.id), [1], 'чужая тема не добавлена');
    // Ссылка вида t.me/c/… этой группы по-прежнему принимается.
    assert.equal((await addTopic('https://t.me/c/3934963994/12')).status, 200);
  });

  test('«0» — это не «Общая тема», а неверный номер', async () => {
    const zero = await (await addTopic('0')).json();
    assert.ok(!/Общая/.test(zero.error), 'про «Общую» здесь речи нет: ' + zero.error);
    assert.match(zero.error, /номер темы|больше/i);
    // А «1» — действительно «Общая».
    assert.match((await (await addTopic('1')).json()).error, /Общая/);
  });
});

test('выгрузка клиентов: номер вроде «constructor» не даёт строку из прототипа', async () => {
  await login();
  const data = bot.getData();
  data.users['501'] = { id: '501', chatId: 501, firstName: 'Анна', activity: [] };
  const response = await realFetch(base + '/api/users/export', { method: 'POST', headers, body: JSON.stringify({ ids: ['constructor', '__proto__', 'toString', 'hasOwnProperty', '501'] }) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const zlib = require('node:zlib');
  // Строк данных в листе — ровно одна: та, что про настоящего клиента.
  let offset = 0;
  let sheet = '';
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (name === 'xl/worksheets/sheet1.xml') sheet = (method === 8 ? zlib.inflateRawSync(bytes.subarray(start, start + size)) : bytes.subarray(start, start + size)).toString('utf8');
    offset = start + size;
  }
  const rows = (sheet.match(/<row r="\d+">/g) || []).length;
  assert.equal(rows, 2, 'заголовок и один клиент, без мусорных строк');
  assert.ok(sheet.includes('Анна'));
});

test.describe('знаки $ в названиях и введённых данных не искажают текст', () => {
  const SPECIAL = "Вилла $& $' $$ $` End";

  test('WhatsApp с карточки объекта: название целиком, как записано', async () => {
    const data = bot.getData();
    Object.assign(data.contacts, { phone: '+34 600 111 222', whatsapp: '+34 600 111 222', whatsappEnabled: true });
    data.objects.push(property('special-1', 'Вилла', 'active', { title: { ru: SPECIAL, en: SPECIAL, es: SPECIAL } }));
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    const step = await chat.press('property:manager:special-1');
    const markup = step.calls.filter((call) => ['sendMessage', 'editMessageText', 'editMessageReplyMarkup', 'editMessageCaption'].includes(call.method)).pop().body.reply_markup;
    const button = markup.inline_keyboard.flat().find((item) => /WhatsApp/.test(item.text));
    const text = new URL(button.url).searchParams.get('text');
    assert.ok(text.includes(SPECIAL), 'название вошло в текст как есть: ' + text);
  });

  test('приветствие: город со знаками $ в строке о каталоге', async () => {
    const data = bot.getData();
    data.objects.push(property('special-2', 'Дом', 'active', { city: { ru: "Кала $& Бланка $'", en: 'x', es: 'x' } }));
    const chat = createChat();
    chat.user.preferredLanguage = '';
    const step = await chat.say('/start');
    const text = step.last.text || step.last.caption || '';
    assert.ok(text.includes("Кала $& Бланка $'"), 'город целиком: ' + text);
  });
});
