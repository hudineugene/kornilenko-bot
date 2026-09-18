'use strict';

// Conversation tests for the three forms: callback request (lead), property
// viewing and property selection. Each test talks to the real handleUpdate
// through a simulated Telegram chat; the Bot API is replaced by a local stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { bot, dataFile, buttonsOf, createChat, property, resetData, adminNotifications, calendarDate, cleanup } = require('./helpers/chat');

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
    assert.deepEqual(step.last.buttons, buttonsOf({ keyboard: [[{ text: MENU.ru.objects }], [{ text: MENU.ru.selection }], [{ text: MENU.ru.favorites }, { text: MENU.ru.promotions }], [{ text: MENU.ru.contacts }], [{ text: MENU.ru.more }, { text: MENU.ru.language }]] }));
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

    step = await chat.say(ru.dealOptions[0]);
    assert.equal(step.last.text, ru.askLocation);
    assert.deepEqual(step.last.buttons, [ru.anyLocation, ru.cancel]);
    step = await chat.say('Марбелья, у моря');
    assert.equal(step.last.text, ru.askBudget);
    step = await chat.say('до 600 000 €');
    assert.equal(step.last.text, ru.askBedrooms);
    step = await chat.say(ru.bedroomOptions[2]);
    assert.equal(step.last.text, [ru.review, '', 'Цель: Покупка', 'Район: Марбелья, у моря', 'Бюджет: до 600 000 €', 'Спальни: 3 спальни'].join('\n'));

    step = await chat.say(ru.confirm);
    assert.equal(step.last.text, ru.success);
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.type, 'selection');
    assert.deepEqual(inquiry.selection, { deal: 'Покупка', location: 'Марбелья, у моря', budget: 'до 600 000 €', bedrooms: '3 спальни' });
    assert.ok(inquiry.text.startsWith(ru.summaryTitle));
    assert.ok(adminNotifications().some((text) => text.includes('подбор недвижимости') && text.includes('до 600 000 €')));
  });

  test('the quick answers for location and budget are accepted', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(ru.dealOptions[1]);
    await chat.say(ru.anyLocation);
    await chat.say(ru.noBudget);
    const step = await chat.say(ru.bedroomOptions[4]);
    assert.match(step.last.text, new RegExp('Район: ' + ru.anyLocation + '\nБюджет: ' + ru.noBudget));
  });

  test('editing the budget from the review keeps the other answers', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    await chat.say(ru.dealOptions[0]);
    await chat.say('Малага');
    await chat.say('300 000 €');
    await chat.say(ru.bedroomOptions[1]);
    let step = await chat.say(ru.editBudget);
    assert.equal(step.last.text, ru.askBudget);
    step = await chat.say('450 000 €');
    assert.equal(step.last.text, [ru.review, '', 'Цель: Покупка', 'Район: Малага', 'Бюджет: 450 000 €', 'Спальни: 2 спальни'].join('\n'));
  });

  test('answers outside the options are rejected', async () => {
    const chat = createChat();
    await chat.say(MENU.ru.selection);
    let step = await chat.say('хочу виллу');
    assert.equal(step.last.text, ru.invalid);
    assert.equal(chat.user.pendingAction.step, 'deal');
    await chat.say(ru.dealOptions[0]);
    step = await chat.say('М');
    assert.equal(step.last.text, ru.invalid);
    assert.equal(chat.user.pendingAction.step, 'location');
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
    assert.equal(step.last.text, SELECTION.ru.askLocation);
    step = await chat.say('Марбелья');
    assert.equal(step.last.text, SELECTION.ru.askBudget);
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
