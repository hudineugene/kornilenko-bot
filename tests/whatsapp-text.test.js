'use strict';

// Кнопка WhatsApp вела на пустой чат: клиент открывал его и не знал, что писать,
// а менеджер получал «привет» без объекта. Теперь в чат подставлен готовый текст:
// с экрана связи — приветствие, с карточки объекта — «интересует такой-то объект».
// Клиент видит текст в поле ввода и может поправить его перед отправкой.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, cleanup } = require('./helpers/chat');
const { menu: MENU } = bot.text;

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  Object.assign(data.contacts, { phone: '+34 600 111 222', whatsapp: '+34 600 111 222', whatsappEnabled: true });
  data.objects.push(property('demo-001', 'Вилла с видом на море', 'active', { reference: 'DEMO-001', title: { ru: 'Вилла с видом на море', en: 'Sea view villa', es: 'Villa con vistas al mar' } }));
}));
test.after(cleanup);

const whatsappButton = (markup) => markup.inline_keyboard.flat().find((button) => /WhatsApp/.test(button.text));
const textOf = (button) => new URL(button.url).searchParams.get('text');

test.describe('ссылка', () => {
  test('к номеру добавляется текст; в ссылке он закодирован', async () => {
    const { whatsappContactUrl } = await import('../src/catalog.mjs');
    const url = whatsappContactUrl('+34 600 111 222', '', 'Здравствуйте! Интересует объект №1 & «вилла»');
    assert.equal(new URL(url).pathname, '/34600111222');
    assert.equal(new URL(url).searchParams.get('text'), 'Здравствуйте! Интересует объект №1 & «вилла»', 'текст доходит целым, «&» его не рвёт');
    assert.ok(!url.includes(' '), 'пробелов в ссылке нет');
  });

  test('готовая ссылка wa.me владельца сохраняет свои параметры; его собственный text не затирается', async () => {
    const { whatsappContactUrl } = await import('../src/catalog.mjs');
    assert.equal(textOf({ url: whatsappContactUrl('https://wa.me/34600111222?text=Хочу+консультацию', '', 'Другой') }), 'Хочу консультацию');
    const api = whatsappContactUrl('https://api.whatsapp.com/send?phone=34600111222', '', 'Привет');
    assert.equal(new URL(api).searchParams.get('phone'), '34600111222');
    assert.equal(new URL(api).searchParams.get('text'), 'Привет');
  });

  test('без текста — прежняя ссылка; чужой адрес не принимается', async () => {
    const { whatsappContactUrl } = await import('../src/catalog.mjs');
    assert.equal(whatsappContactUrl('+34 600 111 222'), 'https://wa.me/34600111222');
    const foreign = new URL(whatsappContactUrl('https://evil.example/34600111222', '', 'Привет'));
    assert.equal(foreign.hostname, 'wa.me', 'ссылка не на WhatsApp отвергается, берутся цифры');
    assert.equal(foreign.pathname, '/34600111222');
  });
});

test.describe('у клиента', () => {
  for (const language of ['ru', 'en', 'es']) {
    test('экран связи, ' + language + ': приветствие на языке клиента', async () => {
      const chat = createChat({ language });
      const screen = await chat.say(MENU[language].contacts);
      const text = textOf(whatsappButton(screen.last.markup));
      assert.ok(text && text.length > 10, 'текст подставлен');
      const { MANAGER_CONTACT_TEXT } = await import('../src/texts.mjs');
      assert.equal(text, MANAGER_CONTACT_TEXT[language].whatsappHello);
      if (language !== 'ru') assert.ok(!/[А-Яа-яЁё]/.test(text), 'без русских слов');
    });
  }

  test('карточка объекта: «интересует DEMO-001», на языке клиента и с названием', async () => {
    for (const [language, expected] of [['ru', /Интересует объект: Вилла с видом на море \(DEMO-001\)/], ['en', /interested in the property: Sea view villa \(DEMO-001\)/], ['es', /interesa el inmueble: Villa con vistas al mar \(DEMO-001\)/]]) {
      const chat = createChat({ language });
      await chat.say(MENU[language].objects);
      const step = await chat.press('property:manager:demo-001');
      const button = whatsappButton(step.calls.filter((call) => ['sendMessage', 'editMessageText', 'editMessageReplyMarkup', 'editMessageCaption'].includes(call.method)).pop().body.reply_markup);
      assert.ok(button, language + ': кнопка WhatsApp на экране связи по объекту');
      assert.match(textOf(button), expected, language);
    }
  });

  test('WhatsApp выключен — кнопки нет', async () => {
    bot.getData().contacts.whatsappEnabled = false;
    const chat = createChat();
    const screen = await chat.say(MENU.ru.contacts);
    assert.equal(whatsappButton(screen.last.markup), undefined);
  });
});
