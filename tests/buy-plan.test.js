'use strict';

// «Мой план покупки»: чек-лист из десяти шагов (NIE → регистрация) с отметками
// «Готово» и «Нужна помощь», прогрессом в «Моё» и напоминанием тому, кто начал и
// замолчал. Формулировки нарочно осторожные («обычно»): это ориентир, а не юридическая
// консультация. Тексты шагов владелец правит в панели.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, telegram, callbacksOf, createChat, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const { menu: MENU } = bot.text;
// Среда, 30.09.2026, полдень.
const NOW = new Date(2026, 8, 30, 12, 0);
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

let plan;
let base = '';
let headers = {};

test.before(async () => {
  plan = await import('../src/plan.mjs');
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + bot.server.address().port;
});
test.after(cleanup);
test.beforeEach(() => resetData((data) => { data.config.active = true; }));

// Экран листается в том же сообщении: смотрим на последнее изменение, а не на новое сообщение.
function view(step) {
  const edit = step.calls.filter((call) => call.method === 'editMessageText').pop();
  return edit ? { text: edit.body.text, markup: edit.body.reply_markup } : { text: view(step).text, markup: view(step).markup };
}

const IDS = ['nie', 'bank', 'lawyer', 'mortgage', 'search', 'viewing', 'reservation', 'contract', 'notary', 'register'];

test.describe('данные', () => {
  test('десять шагов в заданном порядке; тексты на трёх языках; незаполненное берётся из прежнего', () => {
    const { buyPlan } = bot.normalizeLoadedData({});
    assert.deepEqual(buyPlan.map((step) => step.id), IDS);
    for (const step of buyPlan) {
      for (const language of ['ru', 'en', 'es']) assert.ok(step.title[language] && step.text[language], step.id + ' / ' + language);
    }
    const edited = bot.normalizeLoadedData({ buyPlan: [{ id: 'nie', title: { ru: 'Свой заголовок' }, text: { ru: '' } }, { id: 'выдуманный', title: { ru: 'X' } }] }).buyPlan;
    assert.equal(edited.length, 10, 'набор шагов не меняется');
    assert.equal(edited[0].title.ru, 'Свой заголовок');
    assert.equal(edited[0].text.ru, buyPlan[0].text.ru, 'пустой текст — прежний');
    assert.equal(edited[0].title.en, buyPlan[0].title.en, 'другие языки не тронуты');
  });

  test('формулировки осторожные: без «гарантируем» и «обязательно»', () => {
    for (const step of bot.normalizeLoadedData({}).buyPlan) {
      for (const language of ['ru', 'en', 'es']) {
        assert.ok(!/гарантир|обязательно|guarantee|garantiz/i.test(step.text[language]), step.id + ' / ' + language + ': ' + step.text[language]);
      }
    }
  });

  test('состояние клиента переживает перезапуск и новые сообщения', async () => {
    const chat = createChat();
    await chat.press('plan:open');
    await chat.press('plan:done:0');
    await chat.say('Здравствуйте');
    assert.ok(chat.user.plan.done.nie);
    const reloaded = bot.normalizeLoadedData(JSON.parse(JSON.stringify(bot.getData())));
    assert.ok(reloaded.users[String(chat.id)].plan.done.nie);
    assert.ok(reloaded.users[String(chat.id)].plan.startedAt);
  });
});

test.describe('у клиента', () => {
  test('вход: в «Моё» и в гиде; в «Моё» после начала виден прогресс', async () => {
    const chat = createChat();
    const personal = await chat.say(MENU.ru.more);
    assert.ok(personal.last.buttons.includes('📋 Мой план покупки'), 'до начала — без счётчика');
    const guide = await chat.say(MENU.ru.guide);
    assert.ok(callbacksOf(guide.last.markup).includes('plan:open'), 'из гида тоже можно перейти к плану');
    await chat.press('plan:open');
    await chat.press('plan:done:0');
    const again = await chat.say(MENU.ru.more);
    assert.ok(again.last.buttons.includes('📋 Мой план покупки · 1/10'), 'после отметки — 1 из 10');
  });

  test('обзор: где я сейчас, десять шагов с отметками, сетка номеров, оговорка', async () => {
    const chat = createChat();
    const step = await chat.press('plan:open');
    const text = view(step).text;
    assert.match(text, /^📋 Мой план покупки/);
    assert.match(text, /Вы на шаге 1 из 10/);
    assert.match(text, /👉 ⬜ 1\. NIE — номер иностранца/, 'текущий шаг отмечен');
    assert.equal((text.match(/⬜/g) || []).length, 10);
    assert.match(text, /не юридическая консультация/, 'оговорка на экране');
    const rows = view(step).markup.inline_keyboard;
    assert.deepEqual(rows.slice(0, 2).map((row) => row.length), [5, 5], 'номера шагов — два ряда по пять');
    assert.deepEqual(callbacksOf(view(step).markup).slice(0, 3), ['plan:step:0', 'plan:step:1', 'plan:step:2']);
    assert.ok(callbacksOf(view(step).markup).includes('nav:menu'));
    assert.ok(chat.user.plan.startedAt, 'начало запомнено');
  });

  test('шаг: заголовок, текст, кнопки; на первом нет «Назад», на последнем — «Дальше»', async () => {
    const chat = createChat();
    const first = await chat.press('plan:step:0');
    assert.match(view(first).text, /^Шаг 1 из 10: NIE — номер иностранца/);
    assert.match(view(first).text, /Обычно оформляется в полиции или консульстве/);
    assert.deepEqual(callbacksOf(view(first).markup), ['plan:done:0', 'plan:help:0', 'plan:step:1', 'plan:open']);
    const last = await chat.press('plan:step:9');
    assert.deepEqual(callbacksOf(view(last).markup), ['plan:done:9', 'plan:help:9', 'plan:step:8', 'plan:open']);
  });

  test('«Готово» отмечает шаг и сразу ведёт к следующему; «Ещё не сделано» снимает отметку', async () => {
    const chat = createChat();
    await chat.press('plan:open');
    const done = await chat.press('plan:done:0');
    assert.ok(chat.user.plan.done.nie);
    const edit = done.calls.find((call) => call.method === 'editMessageText');
    assert.match(edit.body.text, /^Шаг 2 из 10: Банковский счёт/, 'дальше — второй шаг');
    const overview = await chat.press('plan:open');
    assert.match(view(overview).text, /Вы на шаге 2 из 10/);
    assert.match(view(overview).text, /✅ 1\. NIE/);
    assert.match(view(overview).text, /👉 ⬜ 2\./);

    const step = await chat.press('plan:step:0');
    assert.match(view(step).text, /✅ Отмечено как готовое/);
    assert.ok(callbacksOf(view(step).markup).includes('plan:undo:0'));
    await chat.press('plan:undo:0');
    assert.ok(!chat.user.plan.done.nie);
  });

  test('все шаги отмечены: «Все шаги пройдены», без стрелки', async () => {
    const chat = createChat();
    for (let index = 0; index < 10; index += 1) await chat.press('plan:done:' + index);
    const overview = await chat.press('plan:open');
    assert.match(view(overview).text, /Все шаги пройдены 🎉/);
    assert.ok(!view(overview).text.includes('👉'));
    assert.equal((view(overview).text.match(/✅/g) || []).length, 10);
  });

  test('«Нужна помощь»: заявка менеджеру с названием шага, подтверждение, отметка 💬; повтор за сутки не плодит заявок', async () => {
    const chat = createChat();
    await chat.press('plan:step:2');
    const helped = await chat.press('plan:help:2');
    const [inquiry] = chat.inquiries;
    assert.ok(inquiry, 'заявка создана');
    assert.equal(inquiry.type, 'question');
    assert.match(inquiry.text, /шаг 3: Независимый юрист/);
    assert.match(helped.text, /Просьба о помощи передана менеджеру/);
    const edit = helped.calls.find((call) => call.method === 'editMessageText');
    assert.match(edit.body.text, /💬 Помощь запрошена/);
    const overview = await chat.press('plan:open');
    assert.match(view(overview).text, /💬 3\. Независимый юрист/);

    const again = await chat.press('plan:help:2');
    assert.equal(chat.inquiries.length, 1, 'вторая заявка не создана');
    assert.ok(again.popups.some((popup) => /уже передана/.test(popup)));

    // Шаг выполнен — отметка помощи снимается.
    await chat.press('plan:done:2');
    assert.ok(!chat.user.plan.help.lawyer);
  });

  test('неизвестный шаг и действие не принимаются', async () => {
    const chat = createChat();
    for (const data of ['plan:step:99', 'plan:done:-1', 'plan:step:abc', 'plan:hack:1']) {
      const step = await chat.press(data);
      assert.ok(step.popups.length, data);
    }
    assert.ok(!chat.user.plan.done || Object.keys(chat.user.plan.done).length === 0);
  });

  test('на английском и испанском', async () => {
    const en = await createChat({ language: 'en' }).press('plan:open');
    assert.match(view(en).text, /^📋 My buying plan/);
    assert.match(view(en).text, /You are on step 1 of 10/);
    assert.match(view(en).text, /not legal advice/);
    const es = await createChat({ language: 'es' }).press('plan:step:0');
    assert.match(view(es).text, /^Paso 1 de 10: NIE — número de extranjero/);
  });

  test('владелец поправил текст шага — клиент видит его', async () => {
    bot.getData().buyPlan = bot.normalizeLoadedData({ buyPlan: [{ id: 'nie', title: { ru: 'Получите NIE' }, text: { ru: 'Наш юрист поможет оформить.' } }] }).buyPlan;
    const step = await createChat().press('plan:step:0');
    assert.match(view(step).text, /^Шаг 1 из 10: Получите NIE/);
    assert.match(view(step).text, /Наш юрист поможет оформить\./);
  });
});

test.describe('напоминание', () => {
  function started({ daysAgo = 7, extra = {} } = {}) {
    const chat = createChat();
    chat.user.plan = { startedAt: ago(daysAgo + 1), updatedAt: ago(daysAgo), remindedAt: '', remindOptOut: false, done: { nie: ago(daysAgo) }, help: {}, ...extra };
    return chat;
  }
  const token = () => bot.getData().config.botToken;
  const remind = (when = NOW) => plan.runPlanReminders(when, token());
  const sentTo = (chat) => telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));

  test.beforeEach(() => { bot.getData().config.engagement = { digest: false, comeback: false, planReminder: true }; });

  test('начал, шаг отмечен, неделя тишины — одно напоминание со следующим шагом', async () => {
    const chat = started();
    telegram.calls = [];
    assert.deepEqual(await remind(), [String(chat.id)]);
    const [message] = sentTo(chat);
    assert.match(message.body.text, /Ваш план покупки ждёт\. Следующий шаг: 2\. Банковский счёт в Испании/);
    assert.deepEqual(callbacksOf(message.body.reply_markup), ['plan:open', 'plan:off']);
    assert.equal(chat.user.plan.remindedAt, NOW.toISOString());
  });

  test('по умолчанию выключено', async () => {
    const chat = started();
    bot.getData().config.engagement.planReminder = false;
    telegram.calls = [];
    assert.deepEqual(await remind(), []);
    assert.equal(sentTo(chat).length, 0);
  });

  test('сроки: три дня — рано, пятьдесят — поздно; не чаще раза в две недели', async () => {
    const chat = started({ daysAgo: 3 });
    assert.deepEqual(await remind(), []);
    chat.user.plan.updatedAt = ago(50);
    assert.deepEqual(await remind(), [], 'давно ушёл — не тревожим');
    chat.user.plan.updatedAt = ago(7);
    assert.equal((await remind()).length, 1);
    assert.deepEqual(await remind(), [], 'сразу второй раз — нет');
    assert.deepEqual(await remind(new Date(NOW.getTime() + 10 * 86400000)), [], 'через десять дней — ещё рано');
    assert.equal((await remind(new Date(NOW.getTime() + 15 * 86400000))).length, 1, 'через две недели — снова');
  });

  test('не начинал, закончил, отказался или ночью — не приходит', async () => {
    createChat();
    const finished = started({ extra: { done: Object.fromEntries(IDS.map((id) => [id, ago(8)])) } });
    const declined = started({ extra: { remindOptOut: true } });
    assert.deepEqual(await remind(), []);
    finished.user.plan.done = { nie: ago(8) };
    declined.user.plan.remindOptOut = false;
    assert.deepEqual(await remind(new Date(2026, 8, 30, 3, 0)), [], 'ночью');
    assert.equal((await remind()).length, 2);
  });

  test('«Не напоминать» выключает и говорит, где план остался', async () => {
    const chat = started();
    await remind();
    const off = await chat.press('plan:off');
    assert.equal(chat.user.plan.remindOptOut, true);
    assert.match(off.last.text, /больше не напоминаю/);
    chat.user.plan.remindedAt = '';
    chat.user.plan.updatedAt = ago(20);
    assert.deepEqual(await remind(), []);
  });
});

test.describe('панель', () => {
  async function login() {
    const data = bot.getData();
    const password = bot.hashPassword('plan-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    const response = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'plan-password' }) });
    headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await response.json()).csrf };
  }

  test('тексты шагов сохраняются; лишнее игнорируется; без входа и токена — отказ; состояние отдаёт шаги', async () => {
    await login();
    const put = (body, extra = {}) => realFetch(base + '/api/buy-plan', { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const answer = await put({ steps: [{ id: 'bank', title: { ru: 'Счёт' }, text: { en: 'English text' } }, { id: 'ghost', title: { ru: 'X' } }] });
    assert.equal(answer.status, 200);
    const saved = bot.getData().buyPlan;
    assert.equal(saved.length, 10);
    assert.equal(saved[1].title.ru, 'Счёт');
    assert.equal(saved[1].text.en, 'English text');
    const state = await (await realFetch(base + '/api/state', { headers })).json();
    assert.equal(state.buyPlan[1].title.ru, 'Счёт');
    assert.equal((await put({ steps: [] }, { 'x-csrf-token': 'bad' })).status, 403);
    assert.equal((await realFetch(base + '/api/buy-plan', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  });

  test('переключатель напоминаний сохраняется, не трогая остальные', async () => {
    await login();
    bot.getData().config.engagement = { digest: true, comeback: false, planReminder: false };
    const answer = await realFetch(base + '/api/engagement', { method: 'PUT', headers, body: JSON.stringify({ planReminder: true }) });
    assert.equal(answer.status, 200);
    assert.deepEqual(bot.getData().config.engagement, { digest: true, comeback: false, planReminder: true });
  });
});
