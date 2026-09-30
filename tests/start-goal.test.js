'use strict';

// «Старт с целью»: на первом запуске бот спрашивает, что клиенту ближе — купить для
// жизни, инвестиция и аренда или пока смотрит. Ответ подстраивает подсказки и даёт
// менеджеру сегмент. Спрашивают один раз; ссылка на объект не перебивается вопросом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, callbacksOf, createChat, property, resetData, adminMessages, cleanup } = require('./helpers/chat');

const { menu: MENU } = bot.text;

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('goal-villa', 'Вилла', 'active', { propertyType: 'villa', priceValue: 500000 }));
}));
test.after(cleanup);

// Клиент, который пишет боту впервые (язык ещё не выбран, Telegram сообщает свой).
function newcomer(language = 'ru') {
  const chat = createChat({ language });
  chat.user.preferredLanguage = '';
  return chat;
}

test('первый /start: приветствие, затем один вопрос о цели с тремя кнопками', async () => {
  const chat = newcomer();
  const step = await chat.say('/start');
  const question = step.replies[step.replies.length - 1];
  assert.match(question.text, /Что вам ближе\?/);
  assert.deepEqual(callbacksOf(question.markup), ['goal:live', 'goal:invest', 'goal:browse']);
  assert.deepEqual(question.buttons, ['🏡 Купить для жизни', '📈 Инвестиция и аренда', '👀 Пока смотрю']);
  assert.ok(chat.user.goalAskedAt, 'запомнено, что спросили');
  assert.ok(!chat.user.goal, 'ответа ещё нет');

  // Второй /start и любые другие сообщения вопрос не повторяют.
  const again = await chat.say('/start');
  assert.ok(!again.replies.some((reply) => /Что вам ближе\?/.test(reply.text || '')));
});

test('ссылка на объект открывает объект, а не вопрос о цели', async () => {
  const chat = newcomer();
  const step = await chat.say('/start property_goal-villa');
  assert.ok(!step.replies.some((reply) => /Что вам ближе\?/.test(reply.text || '')), 'вопроса нет');
  assert.ok(!chat.user.goalAskedAt);
});

test('«Купить для жизни»: ответ заменяет вопрос, кнопки — подбор, гид, объекты', async () => {
  const chat = newcomer();
  await chat.say('/start');
  telegram.calls = [];
  const step = await chat.press('goal:live');
  assert.equal(chat.user.goal, 'live');
  assert.ok(chat.user.goalAt);
  const edit = step.calls.find((call) => call.method === 'editMessageText');
  assert.ok(edit, 'вопрос заменён ответом в том же сообщении');
  assert.match(edit.body.text, /подберём вариант для жизни/);
  assert.match(edit.body.text, /Моё → Моя цель/, 'сказано, как сменить цель');
  assert.deepEqual(callbacksOf(edit.body.reply_markup), ['selection:start', 'guide:page:0', 'catalog:all:0']);
});

test('«Инвестиция и аренда»: объекты, расходы и налоги, аренда', async () => {
  const chat = newcomer();
  await chat.say('/start');
  const step = await chat.press('goal:invest');
  assert.equal(chat.user.goal, 'invest');
  const edit = step.calls.find((call) => call.method === 'editMessageText');
  assert.match(edit.body.text, /Расчёт покупки/);
  assert.deepEqual(callbacksOf(edit.body.reply_markup), ['catalog:all:0', 'guide:page:2', 'guide:page:4']);
});

test('«Пока смотрю»: объекты и «Сообщать о новых», которое ведёт в подбор, а не «уведомления снова включены»', async () => {
  const chat = newcomer();
  await chat.say('/start');
  const step = await chat.press('goal:browse');
  assert.equal(chat.user.goal, 'browse');
  assert.deepEqual(callbacksOf(step.calls.find((call) => call.method === 'editMessageText').body.reply_markup), ['catalog:all:0', 'selection:start']);
  // Кнопка не отвечает «уведомления и так включены»: без сохранённого поиска сообщать нечего — идём в подбор.
});

test('на английском и испанском вопрос и ответ — на языке клиента', async () => {
  const en = newcomer('en');
  const enStep = await en.say('/start');
  assert.match(enStep.replies[enStep.replies.length - 1].text, /What suits you best\?/);
  const es = newcomer('es');
  const esStep = await es.say('/start');
  assert.match(esStep.replies[esStep.replies.length - 1].text, /¿Qué te interesa más\?/);
  const answer = await es.press('goal:invest');
  assert.match(answer.calls.find((call) => call.method === 'editMessageText').body.text, /rentabilidad/);
});

test('цель можно сменить в «Моё → Моя цель»; текущая отмечена', async () => {
  const chat = newcomer();
  await chat.say('/start');
  await chat.press('goal:browse');
  const personal = await chat.say(MENU.ru.more);
  assert.ok(callbacksOf(personal.last.markup).includes('goal:menu'));
  const menu = await chat.press('goal:menu');
  assert.deepEqual(menu.last.buttons, ['🏡 Купить для жизни', '📈 Инвестиция и аренда', '✓ 👀 Пока смотрю'], 'текущая отмечена галочкой');
  await chat.press('goal:invest');
  assert.equal(chat.user.goal, 'invest');
});

test('неизвестная цель не принимается', async () => {
  const chat = newcomer();
  await chat.say('/start');
  const step = await chat.press('goal:hacker');
  assert.ok(!chat.user.goal);
  assert.ok(step.popups.length, 'клиенту сказано, что кнопка устарела');
});

test('менеджер видит цель: в уведомлении о заявке и о выборе', async () => {
  const chat = newcomer();
  await chat.say('/start');
  telegram.calls = [];
  await chat.press('goal:invest');
  await new Promise((resolve) => setTimeout(resolve, 10));
  bot.getData().config.notifyMode = 'all';
  await chat.say('Хочу купить квартиру для сдачи в аренду');
  const notice = adminMessages().find((message) => /Новое обращение|сообщение/i.test(message.text));
  assert.ok(notice, 'заявка дошла менеджеру');
  assert.match(notice.text, /🎯 инвестиция и аренда/);
});

test('цель переживает перезапуск и новые сообщения', async () => {
  const chat = newcomer();
  await chat.say('/start');
  await chat.press('goal:live');
  await chat.say('Здравствуйте!');
  assert.equal(chat.user.goal, 'live', 'новое сообщение цель не стирает');
  const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
  assert.equal(reloaded.users[String(chat.id)].goal, 'live');
});
