'use strict';

// Права клиента на свои данные: увидеть, что бот о нём хранит, прочитать
// политику и удалить всё самому, не прося менеджера.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, adminNotifications, callbacksOf, cleanup } = require('./helpers/chat');

const ru = () => bot.text.privacy.ru;

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('flat-01', 'Квартира у моря', 'active', { priceValue: 250000, currency: 'EUR' }));
}));
test.after(cleanup);

test.describe('раздел «Мои данные»', () => {
  test('команда /privacy показывает, что хранится, и кнопки', async () => {
    const chat = createChat();
    await chat.say('/start');
    chat.user.phone = '+34 600 111 222';
    chat.user.contactName = 'Анна Петрова';
    chat.user.favorites = ['flat-01'];
    const step = await chat.say('/privacy');

    assert.match(step.last.text, new RegExp('^' + ru().title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(step.last.text, /\+34 600 111 222/, 'клиент видит свой телефон');
    assert.match(step.last.text, /Анна Петрова/);
    assert.match(step.last.text, /избранное: 1/);
    assert.deepEqual(callbacksOf(step.last.markup), ['privacy:policy', 'privacy:erase', 'nav:my']);
  });

  test('новый клиент видит, что о нём почти ничего нет', async () => {
    const chat = createChat();
    await chat.say('/start');
    const step = await chat.say('/privacy');
    assert.match(step.last.text, /имя в Telegram/, 'имя из Telegram бот действительно хранит');
    assert.match(step.last.text, /первое обращение/);
    assert.doesNotMatch(step.last.text, /телефон/, 'телефона нет — и строки о нём тоже');
    assert.doesNotMatch(step.last.text, /избранное/);
  });

  test('политика открывается кнопкой и приходит целиком', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('/privacy');
    telegram.calls = [];
    const shown = await chat.press('privacy:policy');
    const text = shown.replies.map((reply) => reply.text).join('\n');
    assert.match(text, new RegExp(ru().policyTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, /AEPD/, 'клиенту сказано, куда жаловаться');
    assert.match(text, /Telegram/);
    assert.ok(text.length > 500, 'политика не обрезана');
  });

  test('клиент удаляет свои данные сам, с подтверждением', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('Здравствуйте, интересует квартира');
    chat.user.phone = '+34 600 111 222';
    chat.user.favorites = ['flat-01'];
    assert.equal(chat.inquiries.length, 1);

    const asked = await chat.press('privacy:erase');
    assert.match(asked.last.text, new RegExp(ru().eraseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(callbacksOf(asked.last.markup), ['privacy:erased', 'privacy:open']);

    const id = String(chat.id);
    const done = await chat.press('privacy:erased');
    assert.match(done.last.text, new RegExp(ru().erased.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(bot.getData().users[id], undefined, 'клиента в данных больше нет');
    assert.deepEqual(bot.getData().inquiries.filter((item) => String(item.userId) === id), [], 'обращения удалены');
    assert.ok(adminNotifications().some((text) => /удалил свои данные/i.test(text)), 'менеджер знает, что данные удалены по просьбе клиента');
  });

  test('отказ от удаления возвращает в раздел и ничего не теряет', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.say('Вопрос про парковку');
    await chat.press('privacy:erase');
    const back = await chat.press('privacy:open');
    assert.match(back.last.text, new RegExp(ru().title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(bot.getData().users[String(chat.id)] !== undefined, true, 'клиент на месте');
    assert.equal(chat.inquiries.length, 1, 'обращение не удалено');
  });

  test('раздел есть в «Моё» и в списке команд бота', async () => {
    const chat = createChat();
    await chat.say('/start');
    const personal = await chat.say(bot.text.menuLabels.ru.more);
    assert.ok(callbacksOf(personal.last.markup).includes('privacy:open'), 'кнопка в «Моё»');
    assert.ok(personal.last.buttons.includes(ru().menuButton));
    assert.ok(bot.text.commandDescriptions.ru.privacy, 'команда описана для Telegram');
  });
});

test.describe('согласие на обработку телефона', () => {
  test('в вопросе о телефоне сказано зачем и куда смотреть', async () => {
    const chat = createChat();
    await chat.say('/start');
    await chat.press('contact:lead');
    const asked = await chat.say('Анна Петрова');
    assert.ok(asked.last.text.startsWith(bot.text.lead.ru.askPhone), 'сам вопрос не изменился');
    assert.match(asked.last.text, /\/privacy/, 'есть, где посмотреть, что хранится и как удалить');
  });
});

test.describe('политика как черновик', () => {
  test('самопроверка предупреждает, пока в политике остались подстановки', async () => {
    const report = bot.runSelfCheck();
    const check = report.checks.find((entry) => entry.id === 'privacy');
    assert.ok(check, 'проверка политики есть');
    assert.equal(check.status, 'warn');
    assert.match(check.detail, /квадратных скобках/);
  });

  test('когда владелец заполнил политику, предупреждение уходит', async () => {
    const { PRIVACY_TEXT } = await import('../src/texts.mjs');
    const before = { ru: PRIVACY_TEXT.ru.policy, en: PRIVACY_TEXT.en.policy, es: PRIVACY_TEXT.es.policy };
    for (const language of ['ru', 'en', 'es']) PRIVACY_TEXT[language].policy = 'Данные обрабатывает Construcciones Kornilenko, NIF B12345678. Хранение 24 месяца. Жалобы — AEPD.';
    try {
      const check = bot.runSelfCheck().checks.find((entry) => entry.id === 'privacy');
      assert.equal(check.status, 'ok');
    } finally {
      for (const language of ['ru', 'en', 'es']) PRIVACY_TEXT[language].policy = before[language];
    }
  });
});
