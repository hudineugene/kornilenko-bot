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

  test('the full path creates a lead and remembers the contact details', async () => {
    const chat = createChat();
    let step = await chat.press('contact:lead');
    assert.equal(step.last.text, ru.askName);
    assert.deepEqual(step.last.buttons, [ru.cancel]);

    step = await chat.say('Анна Петрова');
    assert.equal(step.last.text, ru.askPhone);
    const phoneButton = step.last.markup.keyboard.flat().find((button) => button.request_contact);
    assert.equal(phoneButton.text, ru.phoneButton);

    step = await chat.say('+34 600 123 456');
    assert.equal(step.last.text, ru.askTime);
    assert.deepEqual(step.last.buttons, [...ru.timeOptions, ru.cancel]);

    step = await chat.say(ru.timeOptions[0]);
    assert.match(step.last.text, new RegExp('^' + ru.review));
    assert.match(step.last.text, /Имя: Анна Петрова/);
    assert.match(step.last.text, /Телефон: \+34 600 123 456/);
    assert.ok(step.last.text.includes('Удобное время: ' + ru.timeOptions[0] + ' (' + calendarDate(new Date()) + ')'));
    assert.deepEqual(step.last.buttons, [ru.confirm, ru.editName, ru.editPhone, ru.editTime, ru.cancel]);

    step = await chat.say(ru.confirm);
    assert.equal(step.last.text, ru.success);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.user.contactName, 'Анна Петрова');
    assert.equal(chat.user.phone, '+34 600 123 456');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'lead');
    assert.deepEqual(inquiry.lead, { name: 'Анна Петрова', phone: '+34 600 123 456', preferredTime: ru.timeOptions[0] + ' (' + calendarDate(new Date()) + ')' });
    assert.ok(adminNotifications().some((text) => text.includes('заявка на звонок') && text.includes('+34 600 123 456')));
  });

  test('invalid answers are asked again without moving on', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    let step = await chat.say('А');
    assert.equal(step.last.text, ru.invalidName);
    assert.equal(chat.user.pendingAction.step, 'name');

    await chat.say('Анна');
    step = await chat.say('12-34');
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
    await chat.say('Анна');
    const step = await chat.shareContact('34600999888');
    assert.equal(step.last.text, ru.askTime);
    assert.equal(chat.user.pendingAction.data.phone, '34600999888');
  });

  test('editing one field from the review returns to the review and keeps the rest', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.say('Анна');
    await chat.say('+34 600 000 111');
    await chat.say('После обеда');
    let step = await chat.say(ru.editPhone);
    assert.equal(step.last.text, ru.askPhone);
    step = await chat.say('+34 611 222 333');
    assert.match(step.last.text, new RegExp('^' + ru.review));
    assert.match(step.last.text, /Имя: Анна\n/);
    assert.match(step.last.text, /Телефон: \+34 611 222 333/);
    assert.match(step.last.text, /Удобное время: После обеда/);
  });

  test('a second request offers the saved name and phone', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.say('Анна');
    await chat.say('+34 600 000 111');
    await chat.say('Утром');
    await chat.say(ru.confirm);

    let step = await chat.press('contact:lead');
    const savedName = ru.savedName + ': Анна';
    assert.ok(step.last.buttons.includes(savedName));
    step = await chat.say(savedName);
    const savedPhone = ru.savedPhone + ': +34 600 000 111';
    assert.ok(step.last.buttons.includes(savedPhone));
    await chat.say(savedPhone);
    assert.deepEqual(chat.user.pendingAction.data, { name: 'Анна', phone: '+34 600 000 111' });
  });

  test('cancelling closes the form without creating an inquiry', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.say('Анна');
    const step = await chat.say(ru.cancel);
    assert.equal(step.last.text, ru.cancelled);
    assert.deepEqual(step.last.buttons, buttonsOf({ keyboard: [[{ text: MENU.ru.objects }, { text: MENU.ru.selection }], [{ text: MENU.ru.favorites }, { text: MENU.ru.promotions }], [{ text: MENU.ru.request }, { text: MENU.ru.contacts }], [{ text: MENU.ru.more }]] }));
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0);
  });

  test('"today" means the day of the answer, not the day the form was opened', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.say('Анна');
    await chat.say('+34 600 000 111');
    // The form was opened yesterday evening and is answered now.
    chat.user.pendingAction.createdAt = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const step = await chat.say(ru.timeOptions[0]);
    assert.ok(step.last.text.includes('(' + calendarDate(new Date()) + ')'), step.last.text);
  });

  test('the form is localized for English speakers', async () => {
    const chat = createChat({ language: 'en', firstName: 'John' });
    const en = LEAD.en;
    let step = await chat.press('contact:lead');
    assert.equal(step.last.text, en.askName);
    await chat.say('John Smith');
    await chat.say('+44 7700 900123');
    step = await chat.say(en.timeOptions[2]);
    assert.match(step.last.text, new RegExp(en.reviewLabels[0] + ': John Smith'));
    step = await chat.say(en.confirm);
    assert.equal(step.last.text, en.success);
    assert.equal(chat.inquiries[0].language, 'en');
  });
});

// --- Viewing form ------------------------------------------------------------

test.describe('viewing form', () => {
  const ru = VIEWING.ru;

  test('the full path books a viewing for the property', async () => {
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    assert.equal(step.last.text, '🏠 Вилла в Марбелье\n\n' + ru.askDate);
    assert.deepEqual(step.last.buttons, [...ru.dateOptions, ru.cancel]);

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

  test('free text instead of a date option is rejected', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    const step = await chat.say('когда-нибудь');
    assert.equal(step.last.text, ru.invalid);
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

test.describe('selection form', () => {
  const ru = SELECTION.ru;

  test('the full path from the menu sends the wishes to the manager', async () => {
    const chat = createChat();
    let step = await chat.say(MENU.ru.selection);
    assert.equal(step.last.text, ru.intro + '\n\n' + ru.askDeal);
    assert.deepEqual(step.last.buttons, [...ru.dealOptions, ru.cancel]);
    assert.deepEqual(step.last.markup.keyboard.map((row) => row.length), [2, 1, 1], 'short answers share a row');

    step = await chat.say(ru.dealOptions[0]);
    assert.equal(step.last.text, ru.askType);
    assert.deepEqual(step.last.buttons, [...ru.typeOptions, ru.cancel]);
    step = await chat.say(ru.typeOptions[1]);
    assert.equal(step.last.text, ru.askLocation);
    assert.deepEqual(step.last.buttons, [ru.anyLocation, ru.cancel]);
    step = await chat.say('Марбелья, у моря');
    assert.equal(step.last.text, ru.askBudget);
    step = await chat.say('до 600 000 €');
    assert.equal(step.last.text, ru.askBedrooms);
    step = await chat.say(ru.bedroomOptions[2]);
    assert.equal(step.last.text, [ru.review, '', 'Цель: Покупка', 'Тип: Дом или вилла', 'Район: Марбелья, у моря', 'Бюджет: до 600 000 €', 'Спальни: 3 спальни'].join('\n'));

    assert.deepEqual(step.last.markup.keyboard[0], [{ text: ru.confirm }], '«Send» has a row of its own');
    assert.deepEqual(step.last.markup.keyboard[1], [{ text: ru.editDeal }, { text: ru.editType }], 'the edit buttons go two to a row');

    step = await chat.say(ru.confirm);
    assert.equal(step.replies[0].text, ru.success, 'nothing in the catalog fits yet');
    assert.equal(step.last.text, ru.noMatchesYet);
    assert.deepEqual(callbacksOf(step.last.markup), ['catalog:all:0'], 'the whole catalog is one tap away');
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'selection');
    assert.deepEqual(inquiry.selection, { deal: 'Покупка', type: 'Дом или вилла', location: 'Марбелья, у моря', budget: 'до 600 000 €', bedrooms: '3 спальни' });
    assert.ok(inquiry.text.startsWith(ru.summaryTitle));
    assert.ok(adminNotifications().some((text) => text.includes('подбор недвижимости') && text.includes('до 600 000 €')));
  });

  test('the quick answers for location and budget are accepted', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(ru.dealOptions[1]);
    await chat.say(ru.typeOptions[4]);
    await chat.say(ru.anyLocation);
    await chat.say(ru.noBudget);
    const step = await chat.say(ru.bedroomOptions[4]);
    assert.match(step.last.text, new RegExp('Район: ' + ru.anyLocation + '\nБюджет: ' + ru.noBudget));
  });

  test('editing the budget from the review keeps the other answers', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(ru.dealOptions[0]);
    await chat.say(ru.typeOptions[0]);
    await chat.say('Малага');
    await chat.say('300 000 €');
    await chat.say(ru.bedroomOptions[1]);
    let step = await chat.say(ru.editBudget);
    assert.equal(step.last.text, ru.askBudget);
    step = await chat.say('450 000 €');
    assert.equal(step.last.text, [ru.review, '', 'Цель: Покупка', 'Тип: Квартира', 'Район: Малага', 'Бюджет: 450 000 €', 'Спальни: 2 спальни'].join('\n'));
  });

  test('land and commercial property skip the bedrooms question', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(ru.dealOptions[0]);
    await chat.say(ru.typeOptions[2]);
    await chat.say('Эстепона');
    let step = await chat.say('200 000 €');
    assert.equal(step.last.text, [ru.review, '', 'Цель: Покупка', 'Тип: Участок', 'Район: Эстепона', 'Бюджет: 200 000 €', 'Спальни: Не важно'].join('\n'));

    step = await chat.say(ru.editType);
    assert.equal(step.last.text, ru.askType);
    step = await chat.say(ru.typeOptions[1]);
    assert.equal(step.last.text, ru.askBedrooms, 'a house needs the question that was skipped');
    step = await chat.say(ru.bedroomOptions[3]);
    assert.match(step.last.text, /Тип: Дом или вилла\nРайон: Эстепона\nБюджет: 200 000 €\nСпальни: 4\+ спальни$/);
  });

  test('what already fits is shown right after the form', async () => {
    const data = bot.getData();
    data.objects.push(property('villa-fit-03', 'Вилла с садом', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 4, priceValue: 550000, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }));
    data.objects.push(property('villa-costly-04', 'Вилла на холме', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 5, priceValue: 2500000, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }));
    data.objects.push(property('house-fit-05', 'Дом у гольфа', 'active', { dealType: 'sale', propertyType: 'house', bedrooms: 3, priceValue: 480000, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }));
    data.objects.push(property('flat-fit-06', 'Квартира в центре', 'active', { dealType: 'sale', propertyType: 'apartment', bedrooms: 3, priceValue: 300000, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }));
    data.objects.push(property('villa-price-07', 'Вилла с ценой по запросу', 'active', { dealType: 'sale', propertyType: 'villa', bedrooms: 3, priceValue: null, city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' } }));
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(ru.dealOptions[0]);
    await chat.say(ru.typeOptions[1]);
    await chat.say('Марбелья');
    await chat.say('до 600 000 €');
    await chat.say(ru.bedroomOptions[2]);
    const step = await chat.say(ru.confirm);
    assert.equal(step.replies[0].text, ru.successMatches + '\n\n' + ru.matchSummary.replace('{exact}', '2').replace('{close}', '1').replace('{consider}', '0'));
    assert.deepEqual(chat.user.selectionMatchIds, ['villa-fit-03', 'house-fit-05', 'villa-price-07'], 'exact results come before a useful card with missing price');
    assert.deepEqual(chat.user.selectionMatchDetails.map((item) => [item.id, item.tier]), [['villa-fit-03', 'exact'], ['house-fit-05', 'exact'], ['villa-price-07', 'close']]);
    assert.deepEqual(chat.inquiries[0].matching.results, chat.user.selectionMatchDetails, 'the inquiry keeps the result snapshot for the manager');
    const card = step.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(card.body.caption.startsWith('<i>' + ru.matchesHeading + ' · 1 / 3</i>\n\n<b>' + ru.tierExact + '</b>\n'));
    assert.match(card.body.caption, /Почему: формат сделки · тип объекта · нужный район · в рамках бюджета · нужное число спален/);
    assert.match(card.body.caption, /<b>Вилла с садом<\/b>/);
    assert.equal(card.body.parse_mode, 'HTML');
    assert.ok(callbacksOf(card.body.reply_markup).includes('catalog:matches:1'));
    assert.equal(chat.inquiries.length, 1, 'the manager still gets the request');
    assert.ok(adminNotifications().some((text) => text.includes('В карточках нужно уточнить данные') && text.includes('Вилла с ценой по запросу: цена')));

    const next = await chat.press('catalog:matches:1');
    const edited = next.calls.find((call) => call.method === 'editMessageMedia' || call.method === 'sendPhoto');
    assert.match(edited.body.media ? JSON.stringify(edited.body.media) : edited.body.caption, /Дом у гольфа/);
  });

  test('answers outside the options are rejected', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    let step = await chat.say('хочу виллу');
    assert.equal(step.last.text, ru.invalid);
    assert.equal(chat.user.pendingAction.step, 'deal');
    await chat.say(ru.dealOptions[0]);
    step = await chat.say('Дача');
    assert.equal(step.last.text, ru.invalid);
    assert.equal(chat.user.pendingAction.step, 'type');
    await chat.say(ru.typeOptions[0]);
    step = await chat.say('М');
    assert.equal(step.last.text, ru.invalid);
    assert.equal(chat.user.pendingAction.step, 'location');
  });
});

// --- Reminder about an unfinished form --------------------------------------

test.describe('unfinished form reminder', () => {
  const HOUR = 60 * 60 * 1000;
  const MORNING = new Date(2026, 8, 18, 10, 0);

  test('a client who went quiet in the middle of a form is reminded once', async () => {
    bot.getData().config.active = true;
    const chat = createChat();
    await chat.press('contact:lead');
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
    assert.equal(step.last.text, LEAD.ru.askPhone, 'the form goes on from the saved step');
  });

  test('no reminder too early, at night, after the form expired or when the bot is off', async () => {
    bot.getData().config.active = true;
    const fresh = createChat();
    await fresh.press('contact:lead');
    const lastSeen = Date.parse(fresh.user.lastSeenAt);
    assert.equal(bot.formReminderDue(fresh.user, new Date(lastSeen + HOUR)), false, 'an hour is too early');

    const night = createChat();
    await night.press('selection:start');
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
    await chat.say('Анна');
    await chat.say(MENU.ru.promotions);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0);
  });

  test('/start during a form offers to continue from the saved step', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(SELECTION.ru.dealOptions[0]);
    let step = await chat.say('/start');
    assert.equal(step.last.text, INTERACTION.ru.unfinished);
    assert.deepEqual(step.last.buttons, [INTERACTION.ru.continueForm, INTERACTION.ru.discardForm]);
    step = await chat.say(INTERACTION.ru.continueForm);
    assert.equal(step.last.text, SELECTION.ru.askType);
    step = await chat.say(SELECTION.ru.typeOptions[0]);
    assert.equal(step.last.text, SELECTION.ru.askLocation);
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
    const step = await chat.say('/cancel');
    assert.equal(step.last.text, bot.text.commands.ru.cancelled);
    assert.equal(chat.user.pendingAction, null);
  });

  test('a form older than a day expires and can be started again', async () => {
    const chat = createChat();
    await chat.press('contact:lead');
    await chat.say('Анна');
    chat.user.pendingAction.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    let step = await chat.say('+34 600 000 111');
    assert.equal(step.last.text, INTERACTION.ru.expired);
    assert.deepEqual(step.last.buttons, [INTERACTION.ru.resume, INTERACTION.ru.backToMenu]);
    assert.equal(chat.user.pendingAction, null);
    assert.equal(chat.inquiries.length, 0, 'the old answers are not sent');
    step = await chat.say(INTERACTION.ru.resume);
    assert.equal(step.last.text, LEAD.ru.askName);
    assert.deepEqual(chat.user.pendingAction.data, {});
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
    const manager = await chat.press('property:manager:' + source.id);
    assert.ok(callbacksOf(manager.last.markup).includes('property:similar:' + source.id), 'available in the manager menu too');

    const first = await chat.press('property:similar:' + source.id);
    const firstCard = first.calls.find((call) => call.method === 'sendPhoto');
    assert.ok(firstCard.body.caption.startsWith('<i>' + PROPERTY.ru.similarHeading + ' · 1 / 2</i>'));
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
    furnish(bot.getData().objects[0]);
    const chat = createChat();
    const step = await chat.say(MENU.ru.objects);
    const card = step.calls.find((call) => call.method === 'sendPhoto');
    const caption = card.body.caption;
    assert.match(caption, /💰 850\s000 €/, 'the currency is a symbol');
    assert.match(caption, /📍 Марбелья, Сьерра-Бланка\n/, 'city and district only');
    assert.match(caption, /🛏 Спальни: 4\s+·\s+🚿 Санузлы: 1/, 'characteristics have readable labels and no more than two values per row');
    assert.match(caption, /📐 Площадь: 80 м²/, 'units are kept next to the labelled value');
    assert.match(caption, /<i>🟢 Доступен · Вилла · Продажа<\/i>/, 'status line has a consistent visual hierarchy');
    assert.ok(!caption.includes('Calle Sol'), 'the address is in Details');
    assert.ok(!caption.includes('VILLA-MARBELLA-01'), 'the reference is in Details');
    assert.ok(caption.endsWith('Светлая вилла с видом на море и большим садом.'), 'only the first paragraph');

    const rows = card.body.reply_markup.inline_keyboard;
    assert.deepEqual(rows[0].map((button) => button.callback_data), ['property:viewing:villa-marbella-01']);
    assert.deepEqual(rows[1].map((button) => button.callback_data), ['property:details:villa-marbella-01']);
    assert.deepEqual(rows[2].map((button) => button.callback_data), ['property:favorite:villa-marbella-01', 'property:compare:villa-marbella-01']);
    assert.deepEqual(rows[3].map((button) => button.callback_data), ['property:manager:villa-marbella-01']);

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
      const step = await chat.say(MENU[language].objects);
      const card = step.calls.find((call) => call.method === 'sendPhoto');
      assert.ok(card.body.caption.includes('🛏 ' + PROPERTY[language].bedroomsLabel + ':'));
      assert.ok(card.body.caption.includes('🚿 ' + PROPERTY[language].bathroomsLabel + ':'));
      assert.ok(card.body.caption.includes('📐 ' + PROPERTY[language].areaLabel + ':'));
      const rows = card.body.reply_markup.inline_keyboard;
      const rowFor = (callback) => rows.find((row) => row.some((button) => button.callback_data === callback));
      const details = rowFor('property:details:villa-marbella-01');
      const secondary = rowFor('property:favorite:villa-marbella-01');
      const manager = rowFor('property:manager:villa-marbella-01');
      const filter = rowFor('cfilter:open');

      assert.equal(details.length, 1, language + ': details gets the full phone width');
      assert.deepEqual(secondary.map((button) => button.callback_data), [
        'property:favorite:villa-marbella-01',
        'property:compare:villa-marbella-01',
      ]);
      assert.equal(manager.length, 1, language + ': manager gets the full phone width');
      assert.ok(secondary.every((button) => Array.from(button.text.replaceAll('\uFE0F', '')).length <= 18), language + ': paired labels remain compact');
      assert.equal(filter[0].text, bot.text.catalogFilter[language].button + ' · 1', language + ': an active filter is compact');

      chat.user.favorites = ['villa-marbella-01'];
      const updatedMarkup = bot.contentButtons(bot.getData().objects[0], language, chat.user, 'property');
      const updatedSecondary = updatedMarkup.inline_keyboard
        .find((row) => row.some((button) => button.callback_data === 'property:favorite:villa-marbella-01'));
      assert.equal(updatedSecondary.length, 2, language + ': saving a property does not break the row');
      assert.equal(updatedSecondary[0].text, '💔 ' + PROPERTY[language].cardFavoriteRemove);
    }

    const originalManagerLabel = PROPERTY.es.contactManager;
    try {
      PROPERTY.es.contactManager = 'Contactar ahora mismo con nuestro gestor especializado';
      const user = createChat({ language: 'es' }).user;
      const markup = bot.contentButtons(bot.getData().objects[0], 'es', user, 'property');
      const manager = markup.inline_keyboard.flat().find((button) => button.callback_data === 'property:manager:villa-marbella-01');
      assert.ok(manager.text.endsWith('…'), 'a long administrator label is shortened deliberately');
      assert.ok(Array.from(manager.text.replaceAll('\uFE0F', '')).length <= 31);
    } finally {
      PROPERTY.es.contactManager = originalManagerLabel;
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
    assert.throws(
      () => bot.parseContentRecord({ title: { ru: 'Неполный объект' }, status: 'active' }, 'objects'),
      /Чтобы показывать объект в каталоге/
    );
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
      assert.ok(caption.indexOf('🛏 ' + actions.bedroomsLabel + ':') < caption.indexOf('📐 ' + actions.areaLabel + ':'), language + ': characteristics keep one order');
      assert.match(caption, new RegExp('🌊 ' + actions.distanceSeaLabel + ': 750 ' + (language === 'ru' ? 'м' : 'm')));
      const factRows = caption.split('\n').filter((line) => /^(🛏|🚿|📐|🌿|🏢|🌊)/u.test(line));
      assert.ok(factRows.every((line) => (line.match(/   ·   /g) || []).length <= 1), language + ': at most two facts per row');
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

  test('the main menu has four short rows and still understands the old buttons', async () => {
    const chat = createChat();
    const step = await chat.say('/menu');
    assert.deepEqual(step.last.markup.keyboard.map((row) => row.length), [2, 2, 2, 1]);
    assert.ok(step.last.buttons.includes(MENU.ru.request), '«Call me back» is on the main keyboard');
    const old = await chat.say('📞 Заказать звонок');
    assert.equal(old.last.text, LEAD.ru.askName);
  });
});
