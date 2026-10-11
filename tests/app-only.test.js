'use strict';

// Режим «только приложение»: клиенту бот отвечает подсказкой и кнопкой приложения, старые разделы не показывает;
// сообщения менеджеру не теряются, нужные кнопки (отписка, согласия) работают, без включённого приложения всё как раньше.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bot, createChat, property, resetData, cleanup,
} = require('./helpers/chat');

const URL = 'https://kornilenko.example.com';

function configure(enabled, appOnly) {
  resetData((data) => {
    data.objects = [property('villa-marbella-01', 'Вилла в Марбелье', 'active', { priceValue: 450000, currency: 'EUR' })];
    data.config.miniApp = { enabled, url: URL, appOnly };
  });
}

function webAppButtons(reply) {
  const rows = reply && reply.markup && reply.markup.keyboard ? reply.markup.keyboard : [];
  return rows.flat().filter((button) => button.web_app);
}

test.after(cleanup);

test('/start: подсказка и одна кнопка приложения вместо старого меню', async () => {
  configure(true, true);
  const chat = createChat({ language: 'ru', firstName: 'Ирина' });
  const result = await chat.say('/start');
  assert.equal(result.replies.length, 1);
  assert.match(result.last.text, /Ирина/);
  assert.match(result.last.text, /приложении/);
  const buttons = webAppButtons(result.last);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].web_app.url, URL);
  assert.equal(result.last.markup.keyboard.flat().length, 1, 'старое меню заменено одной кнопкой');
});

test('кнопки старого меню и ссылка на объект ведут в приложение', async () => {
  configure(true, true);
  const chat = createChat({ language: 'en' });
  const pressed = await chat.press('catalog:all:0');
  assert.equal(pressed.replies.length, 1);
  assert.equal(webAppButtons(pressed.last).length, 1);
  assert.match(pressed.last.text, /app/i);

  const link = await chat.say('/start property_villa-marbella-01');
  assert.equal(webAppButtons(link.last)[0].web_app.url, URL + '?p=villa-marbella-01');
});

test('текст клиента становится заявкой; подсказка не чаще раза в 12 часов', async () => {
  configure(true, true);
  const chat = createChat({ language: 'ru' });
  const first = await chat.say('Хочу узнать про рассрочку');
  assert.equal(chat.inquiries.length, 1, 'сообщение дошло до менеджера');
  assert.match(first.last.text, /передано менеджеру/);
  assert.equal(webAppButtons(first.last).length, 1);
  const second = await chat.say('И ещё вопрос про сроки');
  assert.equal(second.replies.length, 0, 'в диалоге подсказка не повторяется');
  assert.equal(chat.inquiries.length, 1, 'сообщения складываются в одну заявку');
  const third = await chat.say('/menu');
  assert.equal(webAppButtons(third.last).length, 1, 'команда подсказывает всегда');
});

test('нужные кнопки продолжают работать: отписка от новостей', async () => {
  configure(true, true);
  const chat = createChat({ language: 'ru' });
  const result = await chat.press('subs:news:off');
  assert.ok(!result.replies.some((reply) => webAppButtons(reply).length), 'отписка не заменяется подсказкой');
});

test('без включённого приложения или режима бот работает как раньше', async () => {
  configure(true, false);
  let chat = createChat({ language: 'ru' });
  let result = await chat.say('/start');
  assert.ok(!result.replies.some((reply) => webAppButtons(reply).length), 'режим выключен — старое приветствие');
  assert.ok(result.replies.length >= 1);

  configure(false, true);
  chat = createChat({ language: 'ru' });
  result = await chat.say('/start');
  assert.ok(!result.replies.some((reply) => webAppButtons(reply).length), 'приложение выключено — режим не действует');
  const settings = require('../src/miniapp/settings.mjs').miniAppSettings();
  assert.equal(settings.appOnly, false);
});
