'use strict';

// Формы бота приглашают писать ответ словами («Пожалуйста, напишите ответ или
// выберите один из вариантов», «напишите удобные дату и время»), но раньше
// принимали только нажатие кнопки. Клиент писал «25 октября в 17:00» или
// «покупка» — и получал ту же просьбу в ответ, по кругу.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');

const VIEWING = bot.text.viewing.ru;
const SELECTION = bot.text.selection.ru;
const MENU = bot.text.menu.ru;

function inDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}
function dayKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('villa-typed-01', 'Вилла у моря', 'active', { priceValue: 600000 }));
}));
test.after(cleanup);

test.describe('запись на просмотр', () => {
  test('дата, написанная словами, принимается', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-typed-01');
    const soon = inDays(9);
    const written = soon.getDate() + '.' + String(soon.getMonth() + 1).padStart(2, '0');
    const step = await chat.say(written + ' после 16:00');
    assert.match(step.last.text, /Проверьте запись на просмотр|Дата:/, 'бот перешёл к проверке заявки');
    assert.equal(chat.user.pendingAction.step, 'confirm');
    assert.equal(chat.user.pendingAction.data.day, dayKey(soon), 'дата распознана');
    assert.match(step.last.text, new RegExp(written.replace('.', '\\.')), 'в заявке видно, что написал клиент');
  });

  test('вариант с клавиатуры, набранный руками, тоже принимается', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-typed-01');
    const step = await chat.say(VIEWING.dateOptions[1].toLowerCase());
    assert.equal(chat.user.pendingAction.step, 'time', 'бот принял «завтра» и спросил время');
    assert.equal(step.last.text, VIEWING.askTime);
  });

  test('время, написанное словами, принимается', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-typed-01');
    await chat.say(VIEWING.dateOptions[0]);
    const step = await chat.say('в 17:30');
    assert.equal(chat.user.pendingAction.step, 'confirm');
    assert.match(step.last.text, /Время: в 17:30/);
  });

  test('непонятный ответ показывает, из чего выбирать', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-typed-01');
    const step = await chat.say('ну когда-нибудь потом');
    assert.ok(step.last.text.startsWith(VIEWING.invalid));
    for (const option of VIEWING.dateOptions) assert.ok(step.last.text.includes(option), 'в сообщении есть вариант: ' + option);
    assert.equal(chat.user.pendingAction.step, 'date', 'форма не закрылась');
  });
});

test.describe('подбор объекта', () => {
  async function startSelection() {
    const chat = createChat();
    await chat.say(MENU.selection);
    return chat;
  }

  test('цель и тип, написанные словами, принимаются', async () => {
    const chat = await startSelection();
    await chat.say('покупка');
    assert.equal(chat.user.pendingAction.data.deal, SELECTION.dealOptions[0]);
    assert.equal(chat.user.pendingAction.step, 'type');
    await chat.say('квартира');
    assert.equal(chat.user.pendingAction.data.type, SELECTION.typeOptions[0]);
    assert.equal(chat.user.pendingAction.step, 'location');
  });

  test('ответ длиннее варианта тоже понятен', async () => {
    const chat = await startSelection();
    await chat.say('Покупка квартиры у моря');
    assert.equal(chat.user.pendingAction.data.deal, SELECTION.dealOptions[0]);
  });

  test('спальни можно ответить числом', async () => {
    const chat = await startSelection();
    await chat.say(SELECTION.dealOptions[0]);
    await chat.say(SELECTION.typeOptions[0]);
    await chat.say('Бенидорм');
    await chat.say('до 300 000 €');
    assert.equal(chat.user.pendingAction.step, 'bedrooms');
    await chat.say('2');
    assert.equal(chat.user.pendingAction.data.bedrooms, SELECTION.bedroomOptions[1]);
  });

  test('число больше самого большого варианта попадает в «4+»', async () => {
    const { optionFromText } = await import('../src/forms.mjs');
    assert.equal(optionFromText('6', SELECTION.bedroomOptions), SELECTION.bedroomOptions[3]);
    assert.equal(optionFromText('1', SELECTION.bedroomOptions), SELECTION.bedroomOptions[0]);
  });

  test('обычные слова клиента понятны: «купить», «снять», «квартиру», «виллу»', async () => {
    // Варианты назывались «Покупка», «Аренда», «Квартира», «Дом или вилла», а
    // сравнение шло только по началу строки: ни другая форма слова, ни синоним
    // не проходили, и бот переспрашивал по кругу.
    const { optionFromText } = await import('../src/forms.mjs');
    const deal = SELECTION.dealOptions;
    const type = SELECTION.typeOptions;

    assert.equal(optionFromText('Купить', deal), deal[0], 'купить — это покупка');
    assert.equal(optionFromText('хочу купить', deal), deal[0]);
    assert.equal(optionFromText('снять', deal), deal[1], 'снять — это аренда');
    assert.equal(optionFromText('Сниму на год', deal), deal[1]);
    assert.equal(optionFromText('квартиру', type), type[0]);
    assert.equal(optionFromText('ищу квартиру', type), type[0]);
    assert.equal(optionFromText('виллу', type), type[1]);
    assert.equal(optionFromText('дом', type), type[1]);
    assert.equal(optionFromText('участок земли', type), type[2]);
    assert.equal(optionFromText('магазин', type), type[3]);
  });

  test('английская и испанская анкеты понимают то же самое', async () => {
    const { optionFromText } = await import('../src/forms.mjs');
    const en = bot.text.selection.en;
    const es = bot.text.selection.es;

    assert.equal(optionFromText('buying', en.dealOptions), en.dealOptions[0]);
    assert.equal(optionFromText('to rent', en.dealOptions), en.dealOptions[1]);
    assert.equal(optionFromText('flat', en.typeOptions), en.typeOptions[0]);
    assert.equal(optionFromText('a villa', en.typeOptions), en.typeOptions[1]);
    assert.equal(optionFromText('compra', es.dealOptions), es.dealOptions[0]);
    assert.equal(optionFromText('alquiler', es.dealOptions), es.dealOptions[1]);
    assert.equal(optionFromText('piso', es.typeOptions), es.typeOptions[0]);
    // Клиент ответил по-русски в испанской анкете — так тоже бывает.
    assert.equal(optionFromText('снять', es.dealOptions), es.dealOptions[1]);
  });

  test('анкета целиком проходится своими словами', async () => {
    const chat = await startSelection();
    await chat.say('Купить');
    assert.equal(chat.user.pendingAction.data.deal, SELECTION.dealOptions[0]);
    await chat.say('виллу');
    assert.equal(chat.user.pendingAction.data.type, SELECTION.typeOptions[1]);
    assert.equal(chat.user.pendingAction.step, 'location');
  });

  test('двусмысленный ответ не угадывается', async () => {
    const { optionFromText } = await import('../src/forms.mjs');
    // «Не» подходит сразу к нескольким вариантам — лучше переспросить.
    assert.equal(optionFromText('не', SELECTION.typeOptions), '');
    assert.equal(optionFromText('', SELECTION.typeOptions), '');
    assert.equal(optionFromText('дача', SELECTION.typeOptions), '');
  });
});
