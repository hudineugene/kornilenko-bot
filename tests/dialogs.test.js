'use strict';

// Conversation tests for the three forms: callback request (lead), property
// viewing and property selection. Each test talks to the real handleUpdate
// through a simulated Telegram chat; the Bot API is replaced by a local stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { bot, telegram, dataFile, buttonsOf, callbacksOf, createChat, property, resetData, adminNotifications, calendarDate, cleanup } = require('./helpers/chat');

const { lead: LEAD, viewing: VIEWING, selection: SELECTION, menu: MENU, interaction: INTERACTION, propertyActions: PROPERTY } = bot.text;

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('villa-marbella-01', 'Вилла в Марбелье', 'active'));
  data.objects.push(property('flat-reserved-02', 'Квартира у моря', 'reserved'));
}));
test.after(cleanup);

// --- Callback request form ---------------------------------------------------

test.describe('callback request form', () => {
  const ru = LEAD.ru;

  test('the whole path is two answers and remembers the contact details', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    let step = await chat.press('lead:call');
    // Имя бот берёт из Telegram, поэтому первый вопрос — сразу телефон.
    assert.ok(step.last.text.startsWith(ru.askPhone), 'вопрос о телефоне сразу');
    assert.match(step.last.text, /\/privacy/, 'и приписка, где посмотреть, что бот хранит');
    const phoneButton = step.last.markup.keyboard.flat().find((button) => button.request_contact);
    assert.equal(phoneButton.text, ru.phoneButton);

    step = await chat.say('+34 600 123 456');
    assert.equal(step.last.text, ru.askTime);
    assert.deepEqual(step.last.buttons, [...ru.timeOptions, ru.cancel]);

    step = await chat.say(ru.timeOptions[0]);
    assert.equal(step.last.text, ru.success, 'заявка уходит без отдельного экрана проверки');
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.user.contactName, 'Анна');
    assert.equal(chat.user.phone, '+34 600 123 456');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'lead');
    assert.deepEqual(inquiry.lead, { method: 'call', name: 'Анна', phone: '+34 600 123 456', preferredTime: ru.timeOptions[0] + ' (' + calendarDate(new Date()) + ')' });
    assert.ok(adminNotifications().some((text) => text.includes('заявка на звонок') && text.includes('+34 600 123 456')));
  });

  test('a client without a phone chooses how to be contacted', async () => {
    const chat = createChat();
    const step = await chat.press('contact:lead');
    assert.equal(step.last.text, ru.chooseMethod, 'сначала спрашиваем способ связи');
    assert.deepEqual(callbacksOf(step.last.markup), ['lead:call', 'lead:whatsapp', 'lead:telegram']);
    assert.deepEqual(step.last.markup.inline_keyboard.flat().map((button) => button.text), [ru.methodCall, ru.methodWhatsapp, ru.methodTelegram]);
    assert.equal(chat.inquiries.length, 0, 'пока ничего не отправлено');
  });

  test('"message me in Telegram" needs no phone number at all', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    const step = await chat.press('lead:telegram');
    assert.equal(step.last.text, ru.telegramSuccess);
    assert.equal(chat.user.pendingAction, null, 'ни одного вопроса');
    assert.equal(chat.user.phone, '', 'номер не спрашивали и не выдумали');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'lead');
    assert.equal(inquiry.lead.method, 'telegram');
    assert.equal(inquiry.lead.phone, '');
    assert.match(inquiry.text, /Способ связи: Telegram/);
  });

  test('WhatsApp asks only for the number', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    let step = await chat.press('lead:whatsapp');
    assert.ok(step.last.text.startsWith(ru.askWhatsapp));
    step = await chat.say('+34 600 777 888');
    assert.equal(step.last.text, ru.whatsappSuccess.replace('{phone}', '+34 600 777 888'), 'про удобное время не спрашиваем');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.lead.method, 'whatsapp');
    assert.equal(inquiry.lead.preferredTime, '');
    assert.equal(chat.user.phone, '+34 600 777 888');
  });

  test('a known phone turns the request into a single tap', async () => {
    const chat = createChat();
    chat.user.phone = '+34 600 123 456';
    chat.user.contactName = 'Анна Петрова';
    chat.user.preferredContactTime = 'Утром';


    const step = await chat.press('contact:lead');
    assert.deepEqual(step.popups, [ru.callbackToast.replace('{phone}', '+34 600 123 456')], 'клиент сразу видит, куда перезвонят');
    assert.equal(step.last.text, ru.instantSuccess.replace('{phone}', '+34 600 123 456'));
    assert.equal(chat.user.pendingAction, null, 'ничего не спрашиваем');
    assert.equal(chat.inquiries.length, 1);
    assert.deepEqual(chat.inquiries[0].lead, { method: 'call', name: 'Анна Петрова', phone: '+34 600 123 456', preferredTime: 'Утром' });

    // Под подтверждением — кнопка правки: она открывает экран проверки.
    const edit = step.last.markup.inline_keyboard.flat().find((button) => button.callback_data === 'contact:leadedit');
    assert.equal(edit.text, ru.changeDetails);
    const review = await chat.press('contact:leadedit');
    assert.match(review.last.text, new RegExp('^' + ru.review));
    assert.match(review.last.text, /Телефон: \+34 600 123 456/);
    assert.deepEqual(review.last.buttons, [ru.confirm, ru.editName, ru.editPhone, ru.editTime, ru.cancel]);
  });

  test('invalid answers are asked again without moving on', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    let step = await chat.say('12-34');
    assert.equal(step.last.text, ru.invalidPhone);
    assert.equal(chat.user.pendingAction.step, 'phone');

    await chat.say('+34 600 000 111');
    step = await chat.say('x');
    assert.equal(step.last.text, ru.invalidTime);
    assert.equal(chat.user.pendingAction.step, 'time');
    assert.equal(chat.inquiries.length, 0);

  });

  test('the "share my number" button fills the phone from the Telegram contact', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    const step = await chat.shareContact('34600999888');
    assert.equal(step.last.text, ru.askTime);
    assert.equal(chat.user.pendingAction.data.phone, '34600999888');
  });

  test('чужая карточка контакта не становится телефоном клиента', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    // Клиент переслал контакт друга вместо своего: user_id не его.
    const step = await chat.shareContact('34611222333', { ownerId: 5550001 });
    assert.equal(step.last.text, ru.invalidPhone, 'бот просит собственный номер');
    assert.equal(chat.user.pendingAction.step, 'phone', 'анкета осталась на номере');
    assert.notEqual(chat.user.pendingAction.data.phone, '34611222333');
    // Контакт без user_id (карточка не из Telegram) — тоже чужой.
    const none = await chat.shareContact('34611222333', { ownerId: null });
    assert.equal(none.last.text, ru.invalidPhone);
    // Свой контакт принимается как раньше.
    const own = await chat.shareContact('34600999888');
    assert.equal(own.last.text, ru.askTime);
    assert.equal(chat.user.pendingAction.data.phone, '34600999888');
  });

  test('editing one field from the review returns to the review and keeps the rest', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.say('+34 600 000 111');
    await chat.say('После обеда');
    await chat.press('contact:leadedit');
    let step = await chat.say(ru.editPhone);
    assert.ok(step.last.text.startsWith(ru.askPhone), 'вопрос о телефоне на месте');
    assert.match(step.last.text, /\/privacy/, 'и приписка, где посмотреть, что бот хранит');
    step = await chat.say('+34 611 222 333');
    assert.match(step.last.text, new RegExp('^' + ru.review));
    assert.match(step.last.text, /Имя: Анна\n/);
    assert.match(step.last.text, /Телефон: \+34 611 222 333/);
    assert.match(step.last.text, /Удобное время: После обеда/);
  });

  test('a second request offers the saved name and phone', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.say('+34 600 000 111');
    await chat.say('Утром');

    // Вторая заявка уходит сразу, а в правке уже подставлены прежние ответы.
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.press('contact:leadedit');
    let step = await chat.say(ru.editName);
    const savedName = ru.savedName + ': Анна';
    assert.ok(step.last.buttons.includes(savedName));
    await chat.say(savedName);
    step = await chat.say(ru.editPhone);
    const savedPhone = ru.savedPhone + ': +34 600 000 111';
    assert.ok(step.last.buttons.includes(savedPhone));
    await chat.say(savedPhone);
    assert.equal(chat.user.pendingAction.data.name, 'Анна');
    assert.equal(chat.user.pendingAction.data.phone, '+34 600 000 111');
  });

  test('cancelling closes the form without creating an inquiry', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    const step = await chat.say(ru.cancel);
    assert.equal(step.last.text, ru.cancelled);
    assert.deepEqual(step.last.buttons, buttonsOf({ keyboard: [[{ text: MENU.ru.objects }, { text: MENU.ru.selection }], [{ text: MENU.ru.contacts }], [{ text: MENU.ru.guide }, { text: MENU.ru.more }]] }));
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0);
  });

  test('"today" means the day of the answer, not the day the form was opened', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.say('+34 600 000 111');
    // The form was opened yesterday evening and is answered now.
    chat.user.pendingAction.createdAt = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    await chat.say(ru.timeOptions[0]);
    const [inquiry] = chat.inquiries;
    assert.ok(inquiry.lead.preferredTime.includes('(' + calendarDate(new Date()) + ')'), inquiry.lead.preferredTime);
  });

  test('the form is localized for English speakers', async () => {
    const chat = createChat({ language: 'en', firstName: 'John' });
    const en = LEAD.en;
    await chat.press('contact:lead');
    let step = await chat.press('lead:call');
    assert.ok(step.last.text.startsWith(en.askPhone));
    await chat.say('+44 7700 900123');
    step = await chat.say(en.timeOptions[2]);
    assert.equal(step.last.text, en.success);
    assert.equal(chat.inquiries[0].language, 'en');
    assert.equal(chat.inquiries[0].lead.name, 'John', 'имя берётся из Telegram');
  });
});

// --- Viewing form ------------------------------------------------------------

test.describe('viewing form', () => {
  const ru = VIEWING.ru;

  test('the full path books a viewing for the property', async () => {
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    assert.equal(step.last.text, '🏠 Вилла в Марбелье\n\n' + ru.askDate);
    assert.deepEqual(step.last.buttons, [...ru.dateOptions, ru.online, ru.cancel], 'среди вариантов есть онлайн-показ');

    step = await chat.say(ru.dateOptions[1]);
    assert.equal(step.last.text, ru.askTime);
    step = await chat.say(ru.timeOptions[2]);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(step.last.text, [ru.review, '', 'Объект: Вилла в Марбелье', 'Дата: ' + ru.dateOptions[1] + ' (' + calendarDate(tomorrow) + ')', 'Время: ' + ru.timeOptions[2]].join('\n'));
    assert.deepEqual(step.last.buttons, [ru.confirm, ru.editDate, ru.editTime, ru.cancel]);

    step = await chat.say(ru.confirm);
    assert.equal(step.last.text, ru.success + '\n\n🏠 Вилла в Марбелье');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'viewing');
    assert.equal(inquiry.propertyId, 'villa-marbella-01');
    assert.match(inquiry.text, /Время: Вечером/);
    assert.equal(bot.getData().analytics.properties['villa-marbella-01'].viewings, 1);
    assert.ok(adminNotifications().some((text) => text.includes('запись на просмотр') && text.includes('Вилла в Марбелье')));
  });

  test('"another date" takes date and time as one free-text answer', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    let step = await chat.say(ru.dateOptions[3]);
    assert.equal(step.last.text, ru.askCustom);
    step = await chat.say('25 сентября после 16:00');
    assert.match(step.last.text, /Дата: 25 сентября после 16:00\nВремя: Как указано/);
  });

  test('"another time" asks for the time as free text', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[0]);
    let step = await chat.say(ru.timeOptions[3]);
    assert.equal(step.last.text, ru.askCustomTime);
    step = await chat.say('ab');
    assert.equal(step.last.text, ru.invalid);
    step = await chat.say('после 16:00');
    assert.match(step.last.text, /Время: после 16:00/);
  });

  test('changing the date from the review keeps the chosen time', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[1]);
    await chat.say(ru.timeOptions[0]);
    let step = await chat.say(ru.editDate);
    assert.equal(step.last.text, ru.askDate);
    step = await chat.say(ru.dateOptions[0]);
    assert.match(step.last.text, new RegExp('Дата: ' + ru.dateOptions[0] + ' \\(' + calendarDate(new Date()).replace(/\./g, '\\.') + '\\)\nВремя: ' + ru.timeOptions[0]));
  });

  test('"at the weekend" is the coming Saturday–Sunday, and today on a Sunday', () => {
    const weekend = ru.dateOptions[2];
    const at = (day) => bot.viewingDateValue(weekend, ru, 'ru', new Date(2026, 8, day, 12));
    // 14 September 2026 is a Monday.
    assert.equal(at(14), weekend + ' (19.09–20.09)');
    assert.equal(at(18), weekend + ' (19.09–20.09)');
    assert.equal(at(19), weekend + ' (19.09–20.09)');
    assert.equal(at(20), weekend + ' (20.09)');
    assert.equal(at(21), weekend + ' (26.09–27.09)');
  });

  test('text that is not a date is asked again, with the options listed', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    const step = await chat.say('когда-нибудь');
    assert.ok(step.last.text.startsWith(ru.invalid), 'the same request, now with the options');
    assert.ok(step.last.text.includes(ru.dateOptions[0]), 'the client sees what to choose from');
    assert.equal(chat.user.pendingAction.step, 'date');
  });

  test('a reserved property sends an availability question instead of a booking', async () => {
    const chat = createChat();
    const step = await chat.press('property:viewing:flat-reserved-02');
    assert.equal(step.last.text, PROPERTY.ru.received + '\n\n🏠 Квартира у моря');
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries[0].type, 'question');
  });

  test('a property withdrawn during the form closes the form', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    bot.getData().objects[0].status = 'sold';
    const step = await chat.say(ru.dateOptions[0]);
    assert.equal(step.last.text, ru.unavailable);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0);
  });

  test('cancelling closes the form without an inquiry', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[0]);
    const step = await chat.say(ru.cancel);
    assert.equal(step.last.text, ru.cancelled);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0);
  });
});

// --- Selection form ----------------------------------------------------------

test.describe('selection wizard', () => {
  const SELECTION = bot.text.selection.ru;

  test('подбор ведёт по шагам и отдаёт пожелания менеджеру', async () => {
    const chat = createChat();
    const start = await chat.say(MENU.ru.selection);
    assert.match(start.last.text, new RegExp(SELECTION.wizardDeal), 'первый вопрос — о сделке');

    await chat.press('sel:deal:sale');
    await chat.press('sel:skip:city');
    await chat.press('sel:skip:budget');
    await chat.press('sel:skip:bedrooms');
    const done = await chat.press('sel:skip:done');
    const callbacks = callbacksOf(done.calls.filter((call) => call.method === 'editMessageText').pop().body.reply_markup);
    assert.ok(callbacks.includes('cfilter:manager'), 'в конце можно передать менеджеру');

    const sent = await chat.press('cfilter:manager');
    const inquiry = chat.inquiries.find((item) => item.type === 'selection');
    assert.ok(inquiry, 'заявка на подбор ушла менеджеру');
    assert.match(inquiry.text, /Продажа/, 'в ней видно, что клиент выбрал');
    assert.ok(sent.popups.length > 0, 'клиент получил подтверждение');
  });

  test('мастер не спрашивает то, чего нет в каталоге', async () => {
    resetData((data) => {
      data.objects.push(property('only-rent', 'Квартира в аренду', 'active', { dealType: 'rent', propertyType: 'apartment' }));
    });
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    const types = await chat.press('sel:deal:rent');
    const markup = types.calls.filter((call) => call.method === 'editMessageText').pop().body.reply_markup;
    const labels = markup.inline_keyboard.flat().map((button) => button.text);
    assert.ok(labels.includes('Квартира'), 'квартиры в каталоге есть');
    assert.ok(!labels.includes('Вилла'), 'вилл нет — и кнопки нет');
  });
});

test.describe('мастер подбора: тупик и передача менеджеру', () => {
  const SELECTION = bot.text.selection.ru;
  const editedPanel = (step) => step.calls.filter((call) => call.method === 'editMessageText').pop().body;

  test('шаг «Тип» показывает только типы выбранной сделки', async () => {
    resetData((data) => {
      data.objects.push(property('sale-villa', 'Вилла на продажу', 'active', { dealType: 'sale', propertyType: 'villa' }));
      data.objects.push(property('rent-flat', 'Квартира в аренду', 'active', { dealType: 'rent', propertyType: 'apartment' }));
    });
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    const labels = buttonsOf(editedPanel(await chat.press('sel:deal:sale')).reply_markup);
    assert.ok(labels.includes('Вилла'), 'вилла продаётся');
    assert.ok(!labels.includes('Квартира'), 'квартира только в аренде — при «купить» её не предлагаем');
  });

  test('когда ничего не подходит, дальше не спрашивают тип, бюджет и спальни', async () => {
    resetData((data) => {
      data.objects.push(property('sale-only', 'Вилла на продажу', 'active', { dealType: 'sale', propertyType: 'villa' }));
    });
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    const dead = editedPanel(await chat.press('sel:deal:rent'));
    assert.match(dead.text, new RegExp(SELECTION.wizardNothing.slice(0, 20)), 'сказано, что ничего нет');
    const callbacks = callbacksOf(dead.reply_markup);
    assert.ok(!callbacks.some((value) => /^sel:(type|city|price|bed|skip):/.test(value)), 'новых вопросов нет');
    assert.ok(callbacks.includes('cfilter:manager') && callbacks.includes('sel:restart:deal'), 'можно передать менеджеру или начать заново');

    const again = editedPanel(await chat.press('sel:restart:deal'));
    assert.match(again.text, new RegExp(SELECTION.wizardDeal), 'снова первый вопрос');
    assert.equal(chat.user.catalogFilter, null, 'прежние условия сброшены');
  });

  test('«Передать менеджеру» отвечает итогом в чате и не оставляет кнопки повтора', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.press('sel:deal:sale');
    await chat.press('sel:skip:city');
    await chat.press('sel:skip:budget');
    await chat.press('sel:skip:bedrooms');
    await chat.press('sel:skip:done');

    const sent = await chat.press('cfilter:manager');
    const result = editedPanel(sent);
    assert.match(result.text, /^✅ Передали менеджеру:/, 'итог виден в самом чате');
    assert.match(result.text, /Продажа/, 'с тем, что клиент выбрал');
    assert.match(result.text, /Ответим в этом чате/);
    assert.ok(!callbacksOf(result.reply_markup).includes('cfilter:manager'), 'повторить нельзя');
    assert.equal(chat.inquiries.filter((item) => item.type === 'selection').length, 1, 'заявка одна');
  });

  test('«Показать» из мастера оставляет менеджеру запись о том, что искал клиент', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.press('sel:deal:sale');
    await chat.press('sel:skip:city');
    await chat.press('sel:skip:budget');
    await chat.press('sel:skip:bedrooms');
    await chat.press('sel:skip:done');
    assert.equal(chat.inquiries.length, 0, 'пока клиент ничего не показал, записи нет');
    await chat.press('sel:show');
    const [record] = chat.inquiries;
    assert.ok(record, 'запись появилась');
    assert.equal(record.searchLead, true, 'это «искал сам»: ответа она не требует');
    assert.match(record.text, /Подбор в боте: .*Продажа/s, 'видно, что выбрал клиент');
    assert.equal(bot.awaitingReply(record), false, 'в «ждут ответа» она не попадает');
  });
});

test.describe('unfinished form reminder', () => {
  const HOUR = 60 * 60 * 1000;
  const MORNING = new Date(2026, 8, 18, 10, 0);

  test('a client who went quiet in the middle of a form is reminded once', async () => {
    bot.getData().config.active = true;
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.say('Анна');
    chat.user.pendingAction.createdAt = MORNING.toISOString();
    chat.user.lastSeenAt = MORNING.toISOString();
    telegram.calls = [];
    assert.deepEqual(await bot.runFormReminders(new Date(MORNING.getTime() + 3 * HOUR)), [chat.user.id]);
    const reminder = telegram.calls.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
    assert.equal(reminder.body.text, INTERACTION.ru.reminderLead);
    assert.deepEqual(buttonsOf(reminder.body.reply_markup), [INTERACTION.ru.continueForm, INTERACTION.ru.discardForm]);
    assert.deepEqual(await bot.runFormReminders(new Date(MORNING.getTime() + 5 * HOUR)), [], 'only once');

    // The client comes back (the form is still valid: it was started "now").
    chat.user.pendingAction.createdAt = new Date().toISOString();
    const step = await chat.say(INTERACTION.ru.continueForm);
    assert.ok(step.last.text.startsWith(LEAD.ru.askPhone), 'the form goes on from the saved step');
  });

  test('no reminder too early, at night, after the form expired or when the bot is off', async () => {
    bot.getData().config.active = true;
    const fresh = createChat();
    await fresh.press('contact:lead');
    await fresh.press('lead:call');
    const lastSeen = Date.parse(fresh.user.lastSeenAt);
    assert.equal(bot.formReminderDue(fresh.user, new Date(lastSeen + HOUR)), false, 'an hour is too early');

    // Подбор стал мастером без незавершённой формы, поэтому берём заявку.
    const night = createChat();
    await night.press('contact:lead');
    await night.press('lead:call');
    night.user.pendingAction.createdAt = new Date(2026, 8, 18, 20, 0).toISOString();
    night.user.lastSeenAt = night.user.pendingAction.createdAt;
    assert.equal(bot.formReminderDue(night.user, new Date(2026, 8, 18, 23, 0)), false, 'not at night');
    assert.equal(bot.formReminderDue(night.user, new Date(2026, 8, 19, 9, 30)), true, 'in the morning');
    assert.equal(bot.formReminderDue(night.user, new Date(2026, 8, 19, 20, 30)), false, 'close to expiry');

    const question = createChat();
    await question.press('contact:question');
    question.user.pendingAction.createdAt = new Date(2026, 8, 18, 9, 0).toISOString();
    question.user.lastSeenAt = question.user.pendingAction.createdAt;
    assert.equal(bot.formReminderDue(question.user, new Date(2026, 8, 18, 14, 0)), false, 'a single question is not a form');

    bot.getData().config.active = false;
    assert.deepEqual(await bot.runFormReminders(new Date(2026, 8, 19, 10, 0)), [], 'the bot is switched off');
  });
});

// --- Behaviour shared by all forms ------------------------------------------

test.describe('interrupted forms', () => {
  test('a menu button leaves the form and opens the section', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    await chat.say('Анна');
    await chat.say(MENU.ru.promotions);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0);
  });

  test('/start during a form offers to continue from the saved step', async () => {
    // Подбор стал мастером без незавершённой формы — проверяем на записи
    // на просмотр: там шаги по-прежнему сохраняются.
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    let step = await chat.say('/start');
    assert.equal(step.last.text, INTERACTION.ru.unfinished);
    assert.deepEqual(step.last.buttons, [INTERACTION.ru.continueForm, INTERACTION.ru.discardForm]);
    step = await chat.say(INTERACTION.ru.continueForm);
    assert.match(step.last.text, new RegExp(bot.text.viewing.ru.askDate.slice(0, 20)), 'форма продолжается с того же шага');
  });

  test('closing the unfinished form returns to the main menu', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say('/start');
    await chat.say(INTERACTION.ru.discardForm);
    assert.equal(chat.user.pendingAction, null);
  });

  test('/cancel closes any form', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    const step = await chat.say('/cancel');
    assert.equal(step.last.text, bot.text.commands.ru.cancelled);
    assert.equal(chat.user.pendingAction, null);
  });

  test('a form older than a day expires and can be started again', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.press('lead:call');
    chat.user.pendingAction.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    let step = await chat.say('+34 600 000 111');
    assert.equal(step.last.text, INTERACTION.ru.expired);
    assert.deepEqual(step.last.buttons, [INTERACTION.ru.resume, INTERACTION.ru.backToMenu]);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0, 'the old answers are not sent');
    step = await chat.say(INTERACTION.ru.resume);
    assert.equal(step.last.text, LEAD.ru.chooseMethod, 'начинаем с выбора способа связи');
    step = await chat.press('lead:call');
    assert.ok(step.last.text.startsWith(LEAD.ru.askPhone));
    assert.equal(chat.user.pendingAction.step, 'phone');
  });

  test('pressing a form button after the form is finished does nothing harmful', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(SELECTION.ru.dealOptions[0]);
    await chat.say(SELECTION.ru.typeOptions[0]);
    await chat.say('Малага');
    await chat.say('300 000 €');
    await chat.say(SELECTION.ru.bedroomOptions[0]);
    await chat.say(SELECTION.ru.confirm);
    const step = await chat.say(SELECTION.ru.confirm);
    assert.equal(step.last.text, INTERACTION.ru.stale);
    assert.equal(chat.inquiries.length, 1);
  });

  test('a form survives a restart of the bot', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(VIEWING.ru.dateOptions[0]);
    bot.saveDataNow();
    bot.setData(bot.normalizeLoadedData(JSON.parse(fs.readFileSync(dataFile, 'utf8'))));
    const step = await chat.say(VIEWING.ru.timeOptions[1]);
    assert.match(step.last.text, new RegExp('^' + VIEWING.ru.review));
    await chat.say(VIEWING.ru.confirm);
    assert.equal(chat.inquiries.length, 1);
  });
});

// --- Property card -------------------------------------------------------------

test.describe('property card', () => {
  function furnish(record) {
    Object.assign(record, {
      dealType: 'sale',
      propertyType: 'villa',
      priceValue: 850000,
      currency: 'EUR',
      bedrooms: 4,
      city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
      district: { ru: 'Сьерра-Бланка', en: 'Sierra Blanca', es: 'Sierra Blanca' },
      address: { ru: 'Calle Sol 5, Марбелья', en: 'Calle Sol 5, Marbella', es: 'Calle Sol 5, Marbella' },
      description: {
        ru: 'Светлая вилла с видом на море и большим садом.\n\n• Бассейн\n• Гараж на две машины\n\nРядом школы и магазины.',
        en: 'A bright villa.', es: 'Una villa luminosa.',
      },
    });
  }

  test('similar-property ranking never mixes sale and rent and explains its order', () => {
    const source = property('similar-source-01', 'Исходная вилла', 'active', {
      dealType: 'sale', propertyType: 'villa', priceValue: 850000, currency: 'EUR', bedrooms: 4, area: 220,
      city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
      district: { ru: 'Нагуэлес', en: 'Nagueles', es: 'Nagüeles' },
    });
    const exact = property('similar-exact-02', 'Точная альтернатива', 'active', {
      dealType: 'sale', propertyType: 'villa', priceValue: 890000, currency: 'EUR', bedrooms: 4, area: 210,
      city: source.city, district: source.district,
    });
    const related = property('similar-house-03', 'Близкий дом', 'active', {
      dealType: 'sale', propertyType: 'house', priceValue: 800000, currency: 'EUR', bedrooms: 3, area: 240,
      city: source.city,
    });
    const wrongDeal = property('similar-rent-04', 'Та же вилла в аренду', 'active', {
      dealType: 'rent', propertyType: 'villa', priceValue: 4000, currency: 'EUR', bedrooms: 4, area: 220,
      city: source.city, district: source.district,
    });
    const wrongType = property('similar-shop-05', 'Магазин рядом', 'active', {
      dealType: 'sale', propertyType: 'commercial', priceValue: 850000, currency: 'EUR', bedrooms: 4, area: 220,
      city: source.city, district: source.district,
    });
    const ranking = bot.similarPropertyRanking(source, [related, wrongDeal, wrongType, exact], 'ru');
    assert.deepEqual(ranking.map((item) => item.id), ['similar-exact-02', 'similar-house-03']);
    assert.ok(ranking[0].reasons.includes('district'));
    assert.ok(ranking[1].reasons.includes('relatedType'));
  });

  test('similar properties are available from every card as a browsable mini-catalog', async () => {
    const source = bot.getData().objects[0];
    furnish(source);
    bot.getData().objects.push(property('similar-villa-02', 'Вилла по соседству', 'active', {
      dealType: 'sale', propertyType: 'villa', priceValue: 900000, currency: 'EUR', bedrooms: 4, area: 210,
      city: source.city, district: source.district,
    }));
    bot.getData().objects.push(property('similar-house-03', 'Дом неподалёку', 'active', {
      dealType: 'sale', propertyType: 'house', priceValue: 780000, currency: 'EUR', bedrooms: 3, area: 190,
      city: source.city,
    }));
    const chat = createChat();

    const details = await chat.press('property:details:' + source.id);
    assert.ok(callbacksOf(details.last.markup).includes('property:similar:' + source.id), 'available in Details');
    // Экран «Связаться» теперь только про связь: похожие объекты живут в
    // «Подробнее», где их и ищут.
    const manager = await chat.press('property:manager:' + source.id);
    const contactButtons = callbacksOf(manager.last.markup);
    assert.ok(!contactButtons.includes('property:similar:' + source.id), 'на экране связи лишнего нет');
    assert.ok(contactButtons.some((data) => data.startsWith('property:interest:') || data.startsWith('property:availability:')), 'зато есть заявка на звонок');
    assert.ok(contactButtons.includes('property:question:' + source.id), 'и вопрос менеджеру');

    const first = await chat.press('property:similar:' + source.id);
    const firstCard = first.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(firstCard.body.caption.startsWith('<i>' + PROPERTY.ru.similarHeading + '</i>'), 'номер объекта в заголовке не повторяем: он на кнопке');
    assert.match(firstCard.body.caption, /Почему подходит: тот же тип · тот же город · тот же район · близкая цена/);
    assert.ok(callbacksOf(firstCard.body.reply_markup).includes('catalog:similar:1'));
    assert.ok(callbacksOf(firstCard.body.reply_markup).includes('property:return:' + source.id));
    assert.equal(chat.user.catalogContext.mode, 'similar');
    assert.deepEqual(chat.user.similarPropertyIds, ['similar-villa-02', 'similar-house-03']);

    const second = await chat.press('catalog:similar:1');
    const secondCard = second.calls.find((call) => call.method === 'sendPhoto');
    assert.match(secondCard.body.caption, /Дом неподалёку/);
    assert.match(secondCard.body.caption, /близкий тип/);
  });

  test('the card is short and leads to a viewing', async () => {
    const record = bot.getData().objects[0];
    furnish(record);
    // Вторая фотография: кнопка «Фото · N» показывается, когда листать есть что.
    record.imagesByLanguage.ru = [...record.imagesByLanguage.ru, { ...record.imagesByLanguage.ru[0], id: 'second-photo' }];
    const chat = createChat();
    const step = await chat.say(MENU.ru.objects);
    const card = step.calls.find((call) => call.method === 'sendPhoto');
    const caption = card.body.caption;
    assert.match(caption, /💰 850\s000 €/, 'the currency is a symbol');
    assert.match(caption, /📍 Марбелья, Сьерра-Бланка\n/, 'city and district only');
    assert.match(caption, /🛏 4 · 🚿 1 · 📐 80 м²/, 'характеристики одной строкой значками');
    assert.match(caption, /💰 850\s000 € · 10\s625 €\/м²/, 'у продажи видна цена за метр');
    assert.match(caption, /<i>Вилла · Продажа<\/i>/, 'доступность не пишем — она и так по умолчанию');
    assert.ok(!caption.includes('🟢'), 'зелёного «Доступен» на карточке нет');
    assert.ok(!caption.includes('Calle Sol'), 'the address is in Details');
    assert.ok(!caption.includes('VILLA-MARBELLA-01'), 'the reference is in Details');
    assert.ok(caption.endsWith('Светлая вилла с видом на море и большим садом.'), 'only the first paragraph');

    // Четыре ряда вместо шести-семи: главное — записаться и связаться, следом
    // фото и подробности, значки одной строкой.
    const rows = card.body.reply_markup.inline_keyboard;
    assert.ok(rows.length <= 4, 'карточка помещается в четыре ряда, а не в шесть: ' + rows.length);
    assert.deepEqual(rows[0].map((button) => button.callback_data), ['property:viewing:villa-marbella-01', 'property:manager:villa-marbella-01']);
    assert.deepEqual(rows[1].map((button) => button.callback_data), ['property:gallery:villa-marbella-01', 'property:details:villa-marbella-01']);
    // Значки и переход между объектами — одним рядом, без отдельной строки.
    const icons = rows[2].map((button) => button.callback_data);
    assert.deepEqual(icons.slice(0, 2), ['property:favorite:villa-marbella-01', 'property:compare:villa-marbella-01']);
    assert.ok(icons.some((data) => data.startsWith('catalog:')), 'переход между объектами в том же ряду');
    assert.match(rows[1][0].text, /📷 Фото · \d+/, 'фотографии видно прямо с карточки');

    const details = await chat.press('property:details:villa-marbella-01');
    const full = details.replies.map((reply) => reply.text).join('\n');
    const detailsCall = details.calls.find((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
    assert.equal(detailsCall.body.parse_mode, 'HTML');
    assert.match(full, /<b>Характеристики<\/b>/);
    assert.match(full, /<b>Описание<\/b>/);
    assert.match(full, /📍 Сьерра-Бланка, Calle Sol 5, Марбелья/, 'the city is not repeated when the address names it');
    assert.match(full, /VILLA-MARBELLA-01/);
    assert.match(full, /• Гараж на две машины/);
  });

  test('card actions stay readable on a phone in all three languages', async () => {
    for (const record of bot.getData().objects) record.imagesByLanguage.es = [...record.imagesByLanguage.ru];
    for (const language of ['ru', 'en', 'es']) {
      const chat = createChat({ language });
      chat.user.catalogFilter = { deal: 'sale' };
      // «Объекты» из меню фильтр сбрасывает, поэтому каталог с фильтром открываем кнопкой.
      const step = await chat.press('catalog:all:0');
      const card = step.calls.find((call) => call.method === 'sendPhoto');
      assert.match(card.body.caption, /🛏 \d+ · 🚿 \d+ · 📐 \d+/, language + ': характеристики значками одной строкой');
      const rows = card.body.reply_markup.inline_keyboard;
      const rowFor = (callback) => rows.find((row) => row.some((button) => button.callback_data === callback));
      const details = rowFor('property:details:villa-marbella-01');
      const secondary = rowFor('property:favorite:villa-marbella-01');
      const manager = rowFor('property:manager:villa-marbella-01');
      const filter = rowFor('cfilter:open');

      // Второй ряд: «Подробнее» и, если есть что листать или цена по запросу,
      // фотографии и запись на просмотр рядом.
      assert.ok(details.length <= 3, language + ': во втором ряду не больше трёх кнопок');
      assert.equal(details[details.length - 1].callback_data, 'property:details:villa-marbella-01', language + ': «Подробнее» замыкает ряд');
      assert.deepEqual(secondary.map((button) => button.callback_data).slice(0, 2), [
        'property:favorite:villa-marbella-01',
        'property:compare:villa-marbella-01',
      ]);
      // В первом ряду — главное действие и «Связаться»: запись на просмотр или,
      // если цена по запросу, вопрос о цене.
      assert.match(manager[0].callback_data, /^property:(viewing|price):villa-marbella-01$/, language + ': связаться стоит рядом с главным действием');
      assert.equal(manager.length, 2, language + ': в первом ряду две кнопки');
      assert.ok(secondary.every((button) => Array.from(button.text.replaceAll('\uFE0F', '')).length <= 18), language + ': paired labels remain compact');
      assert.equal(filter[0].text, bot.text.catalogFilter[language].button + ' ✓', language + ': an active filter is compact');

      chat.user.favorites = ['villa-marbella-01'];
      const updatedMarkup = bot.contentButtons(bot.getData().objects[0], language, chat.user, 'property');
      const updatedSecondary = updatedMarkup.inline_keyboard
        .find((row) => row.some((button) => button.callback_data === 'property:favorite:villa-marbella-01'));
      assert.equal(updatedSecondary.length, 2, language + ': saving a property does not break the row');
      assert.equal(updatedSecondary[0].text, '💔', language + ': в ряду значков только значок');
    }

    const originalManagerLabel = PROPERTY.es.contact;
    try {
      PROPERTY.es.contact = 'Contactar ahora mismo con nuestro gestor especializado';
      const user = createChat({ language: 'es' }).user;
      const markup = bot.contentButtons(bot.getData().objects[0], 'es', user, 'property');
      const manager = markup.inline_keyboard.flat().find((button) => button.callback_data === 'property:manager:villa-marbella-01');
      assert.ok(manager.text.endsWith('…'), 'a long administrator label is shortened deliberately');
      assert.ok(Array.from(manager.text.replaceAll('\uFE0F', '')).length <= 31);
    } finally {
      PROPERTY.es.contact = originalManagerLabel;
    }
  });

  test('the publication standard requires the same essential fields in every language', () => {
    const ready = property('standard-01', 'Стандартная карточка', 'active');
    assert.deepEqual(bot.propertyPublicationIssues(ready, 'ru'), []);
    delete ready.area;
    ready.description.en = '';
    assert.ok(bot.propertyPublicationIssues(ready, 'ru').includes('площадь'));
    assert.ok(bot.propertyPublicationIssues(ready, 'en').includes('описание'));
    assert.equal(bot.propertyReadyForLanguage(ready, 'ru'), false);

    const draft = bot.parseContentRecord({ title: { ru: 'Черновик' }, status: 'hidden' }, 'objects');
    assert.equal(draft.status, 'hidden', 'an incomplete card can be kept as a draft');
    // An incomplete card can also be saved as active: the catalog hides it per
    // language anyway, and refusing the save made imported cards uneditable.
    const incomplete = bot.parseContentRecord({ title: { ru: 'Неполный объект' }, status: 'active' }, 'objects');
    assert.equal(incomplete.status, 'active');
    assert.equal(bot.propertyReadyForLanguage(incomplete, 'ru'), false, 'clients still do not see it');
  });

  test('the Telegram card emphasizes the title and price and safely escapes text', async () => {
    const data = bot.getData();
    data.objects = [property('safe-html-01', 'Вилла <вид на море>', 'active', { priceValue: 725000 })];
    const chat = createChat();
    const step = await chat.say(MENU.ru.objects);
    const card = step.calls.find((call) => call.method === 'sendPhoto');
    assert.equal(card.body.parse_mode, 'HTML');
    assert.match(card.body.caption, /<b>Вилла &lt;вид на море&gt;<\/b>/);
    assert.match(card.body.caption, /<b>💰 725[^<]+<\/b>/);
  });

  test('the same premium field order is used for every supported language', () => {
    const record = property('uniform-01', 'Единая карточка', 'active', {
      bedrooms: 3, bathrooms: 2, area: 145, plotArea: 420, floor: '2', floors: '4', distanceSea: 750,
    });
    for (const language of ['ru', 'en', 'es']) {
      const caption = bot.objectCaptionHtml(record, language);
      const actions = PROPERTY[language];
      assert.ok(caption.indexOf('💰 ') < caption.indexOf('🛏 '), language + ': commercial block precedes characteristics');
      assert.ok(caption.indexOf('🛏 ') < caption.indexOf('📐 '), language + ': characteristics keep one order');
      assert.match(caption, new RegExp('🌊 750 ' + (language === 'ru' ? 'м' : 'm')), language + ': на карточке значок и число');
      const factRows = caption.split('\n').filter((line) => /^(🛏|🚿|📐|🌿|🏢|🌊)/u.test(line));
      assert.equal(factRows.length, 1, language + ': характеристики занимают одну строку, а не три');

      // В «Подробнее» подписи остаются: там есть место и нужна точность.
      const full = bot.objectCaptionHtml(record, language, { full: true });
      assert.match(full, new RegExp('🌊 ' + actions.distanceSeaLabel + ': 750 ' + (language === 'ru' ? 'м' : 'm')));
      const fullRows = full.split('\n').filter((line) => /^(🛏|🚿|📐|🌿|🏢|🌊)/u.test(line));
      assert.ok(fullRows.every((line) => (line.match(/   ·   /g) || []).length <= 1), language + ': at most two facts per row');
    }
  });

  test('a reserved property has no viewing button on the card', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.objects);
    const step = await chat.press('catalog:all:1');
    const card = step.calls.find((call) => call.method === 'editMessageMedia' || call.method === 'sendPhoto');
    const callbacks = callbacksOf(card.body.reply_markup);
    assert.ok(callbacks.includes('property:details:flat-reserved-02'));
    assert.ok(!callbacks.some((value) => value.startsWith('property:viewing:')));
  });

  test('the main menu is five buttons at most and still understands the old ones', async () => {
    const chat = createChat();
    const step = await chat.say('/menu');
    // Без акций — пять кнопок: объекты, подбор, связаться, «Как купить», «Моё».
    assert.deepEqual(step.last.markup.keyboard.map((row) => row.length), [2, 1, 2]);
    assert.deepEqual(step.last.buttons, [MENU.ru.objects, MENU.ru.selection, MENU.ru.contacts, MENU.ru.guide, MENU.ru.more]);
    assert.ok(!step.last.buttons.includes(MENU.ru.promotions), 'пустой раздел акций в меню не висит');
    assert.ok(!step.last.buttons.includes(MENU.ru.favorites), 'избранное живёт в «Моё»');

    // Прежние кнопки бот понимает: у старых клиентов они ещё на экране.
    const old = await chat.say('📞 Заказать звонок');
    assert.equal(old.last.text, LEAD.ru.chooseMethod);
    const manager = await chat.say('💬 Менеджер');
    assert.match(manager.last.text, /./, 'старая кнопка «Менеджер» открывает связь');
  });

  test('экран связи короткий: мессенджеры в один ряд, «О компании» и сайт в один ряд', async () => {
    Object.assign(bot.getData().contacts, { phone: '+34 600 111 222', whatsapp: '+34 600 111 222', whatsappEnabled: true, telegram: '@kornilenko_agent', website: 'https://example.com', mapUrl: 'https://maps.example.com/office' });
    const chat = createChat();
    const screen = await chat.say(MENU.ru.contacts);
    const rows = screen.last.markup.inline_keyboard;
    assert.ok(rows.length <= 5, 'не больше пяти рядов, а было девять: ' + rows.length);
    const rowOf = (predicate) => rows.find((row) => row.some(predicate));
    assert.equal(rowOf((button) => /WhatsApp/.test(button.text)).length, 2, 'WhatsApp и Telegram вместе');
    assert.equal(rowOf((button) => button.callback_data === 'nav:about').length, 2, '«О компании» и сайт вместе');
    assert.ok(rowOf((button) => button.callback_data === 'nav:menu').some((button) => /example\.com\/office|maps/.test(button.url || '')), 'карта рядом с возвратом в меню');
  });

  test('«Как купить в Испании» — кнопка главного меню на трёх языках, старые клавиатуры тоже работают', async () => {
    for (const language of ['ru', 'en', 'es']) {
      assert.equal(bot.menuItemForText(MENU[language].guide, language), 'guide', language);
      assert.ok(createChat({ language }).user, language);
    }
    const chat = createChat();
    const step = await chat.say(MENU.ru.guide);
    assert.match(step.last.text, /NIE/, 'кнопка открывает первый экран гида');
  });

  test('приветствие говорит, что в каталоге и что боту можно просто написать', async () => {
    resetData((data) => {
      data.objects.push(property('welcome-1', 'Вилла в Альтеа', 'active', { city: { ru: 'Альтеа', en: 'Altea', es: 'Altea' }, dealType: 'sale', bedrooms: 3, priceValue: 320000, currency: 'EUR' }));
      data.objects.push(property('welcome-2', 'Квартира в Кальпе', 'active', { city: { ru: 'Кальпе', en: 'Calpe', es: 'Calpe' } }));
    });
    // Приветствие видит новый клиент — тот, кто пишет боту впервые.
    const chat = createChat();
    chat.user.preferredLanguage = '';
    const step = await chat.say('/start');
    const text = step.last.text || step.last.caption || '';
    assert.match(text, /Сейчас в каталоге: 2 объекта — Альтеа, Кальпе/, 'видно, что бот не пустой и где есть дома');
    assert.match(text, /Можно просто написать, что ищете/, 'и что искать можно словами');
    assert.match(text.replace(/\u00a0/g, ' '), /«Альтеа, 3 спальни, до 350 000 €»/, 'с примером из настоящего каталога');
    assert.equal(step.last.markup.input_field_placeholder, 'Напишите, что ищете', 'тот же пример в поле ввода');
  });

  test('пустой каталог не обещает того, чего нет', async () => {
    resetData();
    const chat = createChat();
    chat.user.preferredLanguage = '';
    const step = await chat.say('/start');
    const text = step.last.text || step.last.caption || '';
    assert.match(text, /Каталог пополняется/, 'честная строка вместо «0 объектов»');
    assert.ok(!/Сейчас в каталоге/.test(text));
  });

  test('«Моё» — шесть строк вместо одиннадцати', async () => {
    const chat = createChat();
    const personal = await chat.say(MENU.ru.more);
    const rows = personal.last.markup.inline_keyboard;
    assert.ok(rows.length <= 7, 'строк не больше семи вместе с возвратом в меню, было одиннадцать');
    const callbacks = callbacksOf(personal.last.markup);
    assert.ok(!callbacks.includes('catalog:recent:0'), 'недавно просмотренные больше не занимают строку');
    assert.ok(!callbacks.includes('saved:view'), 'сохранённый поиск переехал в «Подписки»');
    assert.ok(callbacks.includes('subs:menu'));

    // Сам сохранённый поиск никуда не делся — он внутри «Подписок».
    const subscriptions = await chat.press('subs:menu');
    assert.ok(callbacksOf(subscriptions.last.markup).includes('saved:view'), 'и открывается оттуда');

    // Раздел просмотренных остаётся доступным по прямой ссылке.
    const recent = await chat.press('catalog:recent:0');
    assert.ok(recent.calls.length > 0, 'история просмотров открывается');
  });

  test('гид «Как купить в Испании» листается одним сообщением', async () => {
    const chat = createChat();
    // Гид — кнопка главного меню, а не седьмой ряд экрана связи.
    const contacts = await chat.say(MENU.ru.contacts);
    assert.ok(!callbacksOf(contacts.last.markup).includes('guide:0'), 'с экрана связи гид убран');
    assert.ok(contacts.last.markup.inline_keyboard.length <= 5, 'экран связи — не длиннее пяти рядов');
    const first = await chat.say(MENU.ru.guide);
    assert.match(first.last.text, /NIE/, 'первый экран — про NIE');
    const callbacks = callbacksOf(first.last.markup);
    assert.ok(callbacks.includes('guide:page:1'), 'есть следующий экран');
    assert.ok(callbacks.includes('contact:lead'), 'бесплатная консультация на каждом экране');
    assert.ok(!callbacks.includes('guide:page:-1'), 'назад с первого экрана некуда');

    // Листается тем же сообщением.
    const second = await chat.press('guide:page:1');
    assert.ok(second.calls.some((call) => call.method === 'editMessageText'), 'экран меняется на месте');
    const secondText = second.calls.filter((call) => call.method === 'editMessageText').pop().body.text;
    assert.match(secondText, /Этапы сделки/);

    // Последний экран — пятый.
    const last = await chat.press('guide:page:4');
    const lastCallbacks = callbacksOf(last.calls.filter((call) => call.method === 'editMessageText').pop().body.reply_markup);
    assert.ok(!lastCallbacks.includes('guide:page:5'), 'дальше пятого не листается');
  });

  test('гид: пять экранов на каждом из трёх языков, «Консультация» с любого экрана создаёт заявку', async () => {
    for (const language of ['ru', 'en', 'es']) {
      const chat = createChat({ language });
      chat.user.phone = '+34 600 123 456';
      chat.user.contactName = 'Клиент';
      const first = await chat.say(MENU[language].guide);
      const texts = [first.last.text];
      for (let page = 1; page < 5; page += 1) {
        const step = await chat.press('guide:page:' + page);
        texts.push(step.calls.filter((call) => call.method === 'editMessageText').pop().body.text);
      }
      assert.equal(new Set(texts).size, 5, language + ': пять разных экранов');
      texts.forEach((text, index) => {
        assert.ok(text.length > 40, language + ': экран ' + (index + 1) + ' не пустой');
        // Английский и испанский экран без единой русской буквы: пустой перевод не подменён русским текстом.
        if (language !== 'ru') assert.ok(!/[А-Яа-яЁё]/.test(text), language + ': экран ' + (index + 1) + ' без русского текста');
      });
      // Консультация — на последнем экране, а не только на первом.
      const consult = await chat.press('contact:lead');
      assert.equal(chat.inquiries.length, 1, language + ': заявка создана');
      assert.equal(chat.inquiries[0].type, 'lead');
      assert.ok(consult.last.text, language + ': клиент получил подтверждение');
    }
  });

  test('тексты гида правит владелец, как «О компании»', async () => {
    const data = bot.getData();
    data.guidePages = bot.normalizeGuidePages([{ id: 'nie', title: { ru: 'Свой заголовок' }, text: { ru: 'Свой текст про NIE.' } }]);
    const chat = createChat();
    const page = await chat.press('guide:0');
    assert.match(page.last.text, /Свой заголовок/);
    assert.match(page.last.text, /Свой текст про NIE\./);
    // Ненаписанное остаётся заводским: пустых экранов клиент не увидит.
    const second = await chat.press('guide:page:1');
    const text = second.calls.filter((call) => call.method === 'editMessageText').pop().body.text;
    assert.match(text, /Этапы сделки/);
  });

  test('«О компании» лежит на видном месте, а не в личных настройках', async () => {
    const chat = createChat();
    const contacts = await chat.say(MENU.ru.contacts);
    const callbacks = callbacksOf(contacts.last.markup);
    assert.ok(callbacks.includes('nav:about'), 'рассказ о фирме — там, где решают, доверять ли ей');
    assert.ok(callbacks.includes('contact:lead') && callbacks.includes('contact:question'), 'связь на месте');

    const personal = await chat.say(MENU.ru.more);
    assert.ok(!callbacksOf(personal.last.markup).includes('nav:about'), 'из «Моё» убрано');
    assert.ok(callbacksOf(personal.last.markup).includes('nav:help'), 'справка осталась');

    const about = await chat.press('nav:about');
    assert.ok(about.last.text.length > 0, 'экран «О компании» открывается');
  });

  test('«Акции» появляются в меню с числом, когда акции есть', async () => {
    resetData((data) => {
      data.promotions.push({
        id: 'promo-1', title: { ru: 'Скидка', en: 'Sale', es: 'Oferta' },
        text: { ru: 'Условия', en: 'Terms', es: 'Condiciones' },
        enabled: true, startAt: '', endAt: '', images: [], imagesByLanguage: { ru: [], en: [], es: [] },
      });
    });
    const chat = createChat();
    const step = await chat.say('/menu');
    assert.ok(step.last.buttons.includes(MENU.ru.promotions + ' · 1'), 'на кнопке видно, сколько акций');
    // И кнопка с числом открывает раздел.
    const opened = await chat.say(MENU.ru.promotions + ' · 1');
    assert.match(opened.last.text, /Скидка/);
  });
});
