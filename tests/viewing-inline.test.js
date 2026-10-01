'use strict';

// Запись на просмотр: одна механика для кнопок и для набранного текста (этап 50, хвост). Раньше нажатие меняло сообщение с
// вопросом на месте, а набранный ответ приходил новым сообщением с клавиатурой чата, подменявшей главное меню. Теперь
// вопрос всегда — сообщение с кнопками под ним; набранный ответ даёт следующий вопрос новым сообщением тоже с кнопками, а
// у прежнего вопроса кнопки убираются, чтобы нажатия не расходились с шагом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { bot, telegram, createChat, property, resetData, cleanup } = require('./helpers/chat');

const { viewing: VIEWING } = bot.text;
const ru = VIEWING.ru;

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('villa-marbella-01', 'Вилла Марбелья', 'active', { address: { ru: 'Calle del Mar, 5', en: '', es: '' } }));
}));
test.after(cleanup);

const isInline = (markup) => Boolean(markup && Array.isArray(markup.inline_keyboard));

test('набранный день и время дают вопросы с кнопками под сообщением, а не клавиатуру чата; прежний вопрос теряет кнопки', async () => {
  const chat = createChat();
  chat.user.phone = '+34600111222';
  await chat.press('property:viewing:villa-marbella-01');
  const firstQuestion = chat.user.pendingAction.inlineMessageId;
  assert.ok(firstQuestion);

  telegram.calls = [];
  const time = await chat.say(ru.dateOptions[1]);
  const asked = time.replies.filter((reply) => reply.text.startsWith(ru.askTime));
  assert.equal(asked.length, 1, 'вопрос про время пришёл новым сообщением');
  assert.ok(isInline(asked[0].markup), 'с кнопками под сообщением');
  assert.ok(!asked[0].markup.keyboard, 'клавиатуры чата нет');
  assert.deepEqual(asked[0].buttons.slice(0, 3), ru.timeOptions.slice(0, 3));
  const stripped = telegram.calls.find((call) => call.method === 'editMessageReplyMarkup' && call.body.message_id === firstQuestion);
  assert.ok(stripped, 'у вопроса про день кнопки убраны');
  assert.deepEqual(stripped.body.reply_markup, { inline_keyboard: [] });
  assert.notEqual(chat.user.pendingAction.inlineMessageId, firstQuestion, 'теперь действует кнопка нового вопроса');

  const review = await chat.say(ru.timeOptions[0]);
  const summary = review.replies.find((reply) => reply.text.startsWith(ru.review));
  assert.ok(summary, 'проверка записи');
  assert.ok(isInline(summary.markup), 'и она — кнопками под сообщением');
  assert.match(summary.text, /^📅 Проверьте запись на просмотр\n/, 'у экрана есть заголовок со значком, без двоеточия');
  assert.deepEqual(summary.buttons, [ru.confirm, ru.editDate, ru.editTime, ru.cancel], 'по одной кнопке в ряду: подписи длинные');

  // Подтверждение нажатием на последнем вопросе: запись создана, кнопки у последнего вопроса сняты.
  telegram.calls = [];
  await chat.press('vf:confirm:0', { messageId: chat.user.pendingAction.inlineMessageId });
  assert.equal(chat.inquiries.length, 1);
  assert.equal(chat.inquiries[0].type, 'viewing');
  assert.equal(chat.user.pendingAction, null);
});

test('набранная дата словами → вопрос про время кнопками; набранное время на итоге; кнопки старых вопросов не действуют', async () => {
  const chat = createChat();
  chat.user.phone = '+34600111222';
  await chat.press('property:viewing:villa-marbella-01');
  const first = chat.user.pendingAction.inlineMessageId;
  await chat.say(ru.dateOptions[3]);
  const custom = await chat.say('25 октября');
  const timeAsk = custom.replies.find((reply) => reply.text.startsWith(ru.askTime));
  assert.ok(timeAsk && isInline(timeAsk.markup), 'после «25 октября» — вопрос про время с кнопками');

  // Нажатие на давно ушедший вопрос (день) — «устарело», запись не двигается.
  const old = await chat.press('vf:date:1', { messageId: first });
  assert.equal(old.popups.length, 1);
  assert.equal(chat.user.pendingAction.step, 'time');
});

test('отмена набранным словом и конец записи: у последнего вопроса кнопок не остаётся, главное меню чата на месте', async () => {
  const chat = createChat();
  await chat.press('property:viewing:villa-marbella-01');
  await chat.say(ru.dateOptions[1]);
  const lastQuestion = chat.user.pendingAction.inlineMessageId;
  telegram.calls = [];
  const cancelled = await chat.say(ru.cancel);
  assert.equal(chat.user.pendingAction, null);
  const closing = telegram.calls.find((call) => call.method === 'editMessageReplyMarkup' && call.body.message_id === lastQuestion);
  assert.ok(closing, 'кнопки последнего вопроса убраны');
  assert.ok(cancelled.last.markup && cancelled.last.markup.keyboard, 'после отмены вернулось главное меню чата');
  assert.equal(chat.inquiries.length, 0);
});

test('время в самой фразе не переспрашивается: «25 октября после 16» — сразу итог; «после обеда» и «at 4 pm» тоже; без времени — вопрос', async () => {
  for (const [phrase, asksTime] of [['25 октября после 16', false], ['25 октября вечером', false], ['25 октября at 4 pm', false], ['25 октября в 17:30', false], ['25 октября', true]]) {
    const chat = createChat();
    chat.user.phone = '+34600111222';
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[3]);
    const answer = await chat.say(phrase);
    const step = chat.user.pendingAction.step;
    assert.equal(step, asksTime ? 'time' : 'confirm', '«' + phrase + '» → шаг ' + step);
  }
});
