'use strict';

// Viewings after the request: confirmation (admin chat and panel), the
// client's "My requests" list and cancellation, the reminder the evening
// before, the question afterwards and the admin's list for the day.

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const {
  bot, telegram, ADMIN_CHAT, callbacksOf, createChat, adminPress, property, resetData, adminMessages, cleanup,
} = require('./helpers/chat');

// The chat helper replaces fetch with a Telegram stub; the panel API of this
// process is still reached over real HTTP.
const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const { viewing: VIEWING } = bot.text;
const ru = VIEWING.ru;

function dayKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function daysFromNow(days, hour = 12) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function at(key, addDays, hour, minute = 0) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day + addDays, hour, minute);
}

function sentTo(chat) {
  return telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(chat.id));
}

async function requestViewing(chat, dateOption = 1, timeOption = 1) {
  await chat.press('property:viewing:villa-marbella-01');
  await chat.say(ru.dateOptions[dateOption]);
  await chat.say(ru.timeOptions[timeOption]);
  await chat.say(ru.confirm);
  return chat.inquiries[chat.inquiries.length - 1];
}

test.beforeEach(() => resetData((data) => {
  data.objects.push(property('villa-marbella-01', 'Вилла в Марбелье', 'active', {
    address: { ru: 'Calle del Mar, 5', en: 'Calle del Mar, 5', es: '' },
    city: { ru: 'Марбелья', en: 'Marbella', es: 'Marbella' },
    mapUrl: 'https://maps.example.com/villa',
    dealType: 'sale',
    propertyType: 'villa',
    priceValue: 900000,
  }));
  data.objects.push(property('villa-other-02', 'Вилла в Эстепоне', 'active', { dealType: 'sale', propertyType: 'villa', priceValue: 850000 }));
}));
test.after(cleanup);

test.describe('dates from the viewing form', () => {
  const now = new Date(2026, 8, 18, 12, 0);

  test('free-text dates are read in three languages', () => {
    assert.equal(bot.parseViewingDate('25.09', now), '2026-09-25');
    assert.equal(bot.parseViewingDate('25/09/2026 после обеда', now), '2026-09-25');
    assert.equal(bot.parseViewingDate('25 сентября после 16:00', now), '2026-09-25');
    assert.equal(bot.parseViewingDate('September 25, afternoon', now), '2026-09-25');
    assert.equal(bot.parseViewingDate('25 de septiembre por la tarde', now), '2026-09-25');
    assert.equal(bot.parseViewingDate('3 октября', now), '2026-10-03');
    assert.equal(bot.parseViewingDate('завтра в 16.00', now), '2026-09-19', 'a time with a dot is not a date');
    assert.equal(bot.parseViewingDate('pasado mañana', now), '2026-09-20');
  });

  test('unclear, past or far dates stay open', () => {
    assert.equal(bot.parseViewingDate('в субботу утром', now), '');
    assert.equal(bot.parseViewingDate('el sábado por la mañana', now), '', '"por la mañana" is not "tomorrow"');
    assert.equal(bot.parseViewingDate('31.02', now), '');
    assert.equal(bot.parseViewingDate('10.09.2026', now), '', 'already past');
    assert.equal(bot.parseViewingDate('10.09.2028', now), '', 'more than a year ahead');
    assert.equal(bot.parseViewingDate('05.01', now), '2027-01-05', 'January written in September is next year');
  });

  test('время не превращается в дату', () => {
    // «с 10-12» — это часы, а не 10 декабря: бот показывал клиенту его же
    // текст, а менеджеру отправлял чужую дату и ставил напоминание не на тот
    // день.
    assert.equal(bot.parseViewingDate('в пятницу с 10-12', now), '', 'интервал часов — не дата');
    assert.equal(bot.parseViewingDate('10-12', now), '', 'и сам по себе тоже');
    assert.equal(bot.parseViewingDate('tomorrow 10-11am', now), '2026-09-19', 'день из слова, а не из часов');
    assert.equal(bot.parseViewingDate('завтра в 9.10', now), '2026-09-19');
    assert.equal(bot.parseViewingDate('в 9.10', now), '', 'время с предлогом — не 9 октября');
    assert.equal(bot.parseViewingDate('сегодня 17.00', now), '2026-09-18');
    assert.equal(bot.parseViewingDate('в субботу 14-16', now), '', 'день недели бот не распознаёт — переспросит');
    // Настоящие даты по-прежнему читаются.
    assert.equal(bot.parseViewingDate('10-12-2026', now), '2026-12-10', 'дата с годом остаётся датой');
    assert.equal(bot.parseViewingDate('25.09', now), '2026-09-25');
  });

  test('"tomorrow" in the form is stored as a date, "at the weekend" is not', async () => {
    const chat = createChat();
    const tomorrow = await requestViewing(chat, 1, 1);
    assert.equal(tomorrow.viewing.date, dayKey(daysFromNow(1)));
    assert.equal(tomorrow.viewing.timeText, ru.timeOptions[1]);
    const weekend = await requestViewing(createChat(), 2, 0);
    assert.equal(weekend.viewing.date, '');
    assert.match(weekend.viewing.dateText, new RegExp('^' + ru.dateOptions[2]));
  });

  test('another date is read from the client\'s own words', async () => {
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[3]);
    const future = daysFromNow(10);
    await chat.say(String(future.getDate()).padStart(2, '0') + '.' + String(future.getMonth() + 1).padStart(2, '0') + ' после 16:00');
    await chat.say(ru.confirm);
    assert.equal(chat.inquiries[0].viewing.date, dayKey(future));
  });
});

test.describe('confirmation', () => {
  test('the admin confirms from Telegram and the client gets the details', async () => {
    const chat = createChat();
    const inquiry = await requestViewing(chat);
    const notification = adminMessages().find((message) => message.text.includes('запись на просмотр'));
    assert.deepEqual(callbacksOf(notification.markup), ['inq:confirm:' + inquiry.id, 'inq:in_progress:' + inquiry.id, 'inq:closed:' + inquiry.id, 'inq:follow:' + inquiry.id]);

    telegram.calls = [];
    const pressed = await adminPress('inq:confirm:' + inquiry.id, 321);
    assert.deepEqual(pressed.popups, ['Просмотр подтверждён — клиент получил сообщение']);
    const [message] = sentTo(chat);
    const lines = message.body.text.split('\n');
    assert.equal(lines[0], '✅ Просмотр подтверждён');
    assert.ok(lines.includes('🏠 Вилла в Марбелье'));
    assert.ok(lines.some((line) => line.startsWith('📅 Дата: ') && line.includes(String(daysFromNow(1).getDate()).padStart(2, '0'))));
    assert.ok(lines.includes('🕒 Время: ' + ru.timeOptions[1]));
    assert.ok(lines.includes('📍 Адрес: Марбелья, Calle del Mar, 5'));
    assert.deepEqual(message.body.reply_markup.inline_keyboard.flat().map((button) => button.url || button.callback_data), ['https://maps.example.com/villa', 'myreq:list']);

    assert.equal(inquiry.status, 'in_progress');
    assert.equal(inquiry.viewing.confirmedDate, dayKey(daysFromNow(1)));
    assert.match(inquiry.replies[0].text, /^Просмотр подтверждён: /);
    const edit = pressed.calls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.deepEqual(callbacksOf(edit.body.reply_markup), ['inq:closed:' + inquiry.id, 'inq:follow:' + inquiry.id], 'the confirm button is gone');
  });

  test('only the admin chat can confirm', async () => {
    const chat = createChat();
    const inquiry = await requestViewing(chat);
    await chat.press('inq:confirm:' + inquiry.id);
    assert.equal(inquiry.viewing.confirmedAt, '');
  });

  test('the panel confirms an exact date and time, and can move it', async () => {
    const chat = createChat();
    const inquiry = await requestViewing(chat, 2, 0);
    const data = bot.getData();
    const password = bot.hashPassword('correct-password');
    data.config.passwordSalt = password.salt;
    data.config.passwordHash = password.hash;
    await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
    try {
      const base = 'http://127.0.0.1:' + bot.server.address().port;
      const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
      const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
      const confirm = (body) => fetch(base + '/api/inquiries/' + inquiry.id + '/viewing', { method: 'POST', headers, body: JSON.stringify(body) });

      assert.equal((await confirm({ date: '2020-01-01', time: '11:00' })).status, 400, 'a past date');
      assert.equal((await confirm({ date: dayKey(daysFromNow(3)), time: '25:00' })).status, 400, 'a wrong time');
      assert.equal(inquiry.viewing.confirmedAt, '');

      telegram.calls = [];
      assert.equal((await confirm({ date: dayKey(daysFromNow(3)), time: '11:30' })).status, 200);
      assert.equal(inquiry.viewing.confirmedTime, '11:30');
      assert.ok(sentTo(chat)[0].body.text.includes('🕒 Время: 11:30'));
      assert.equal(inquiry.replies[0].source, 'panel');

      inquiry.viewing.remindedAt = new Date().toISOString();
      assert.equal((await confirm({ date: dayKey(daysFromNow(4)), time: '10:00' })).status, 200);
      assert.equal(inquiry.viewing.remindedAt, '', 'a new date is reminded about again');
      assert.match(inquiry.replies[1].text, /^Просмотр перенесён: /);
    } finally {
      await new Promise((resolve) => bot.server.close(resolve));
    }
  });
});

test.describe('free viewing slots', () => {
  function enableSlots(extra = {}) {
    bot.getData().config.viewingSlots = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], times: ['10:00', '16:00'], daysAhead: 3, perSlot: 1, ...extra };
  }
  const tomorrowLabel = (buttons) => {
    const date = daysFromNow(1);
    const ddmm = String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0');
    return buttons.find((text) => text.includes(ddmm));
  };

  test('the client picks a free day and hour, and the viewing is confirmed at once', async () => {
    enableSlots();
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    const day = tomorrowLabel(step.last.buttons);
    assert.ok(day, 'tomorrow is offered');
    assert.deepEqual(step.last.buttons.slice(-3), [ru.dateOptions[3], ru.online, ru.cancel]);
    step = await chat.say(day);
    assert.deepEqual(step.last.buttons, ['10:00', '16:00', ru.timeOptions[3], ru.cancel]);
    await chat.say('10:00');
    step = await chat.say(ru.confirm);
    assert.equal(step.replies.length, 1, 'одно подтверждение, а не два');
    assert.match(step.replies[0].text, new RegExp('^' + ru.slotBooked.replace(/[!]/g, '\\$&')), 'заголовок и подробности в одном сообщении');
    assert.ok(step.replies[0].text.includes('🕒 Время: 10:00'));
    assert.deepEqual(step.last.markup.keyboard[0].map((button) => button.text), [ru.sharePhoneForViewing], 'телефона нет — предлагаем оставить номер');
    assert.ok(step.last.markup.keyboard[0][0].request_contact);
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.status, 'in_progress');
    assert.deepEqual([inquiry.viewing.confirmedDate, inquiry.viewing.confirmedTime], [dayKey(daysFromNow(1)), '10:00']);
    const notification = adminMessages().find((message) => message.text.includes('запись на просмотр'));
    assert.match(notification.text, /подтверждён автоматически/);
    assert.ok(!callbacksOf(notification.markup).includes('inq:confirm:' + inquiry.id), 'nothing left to confirm');

    const next = createChat();
    step = await next.press('property:viewing:villa-marbella-01');
    step = await next.say(tomorrowLabel(step.last.buttons));
    assert.deepEqual(step.last.buttons, ['16:00', ru.timeOptions[3], ru.cancel], 'the booked hour is taken');
  });

  test('онлайн-показ можно выбрать вместо приезда', async () => {
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    assert.ok(step.last.buttons.includes(ru.online), 'вариант «онлайн-показ» предлагается сразу');

    step = await chat.say(ru.online);
    assert.match(step.last.text, new RegExp(ru.onlineChosen), 'бот объясняет, что приезжать не нужно');
    assert.equal(chat.user.pendingAction.data.online, true);

    step = await chat.say('в субботу после 16:00');
    step = await chat.say(ru.confirm);
    const [inquiry] = chat.inquiries;
    assert.equal(inquiry.viewing.online, true, 'формат сохранён в заявке');
    assert.match(inquiry.text, /📹 Онлайн-показ/, 'менеджер видит, что показ по видеосвязи');
  });

  test('a phone left after the booking reaches the manager', async () => {
    enableSlots();
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    step = await chat.say(tomorrowLabel(step.last.buttons));
    await chat.say('10:00');
    await chat.say(ru.confirm);

    const shared = await chat.shareContact('34600555444');
    assert.equal(shared.last.text, ru.phoneForViewingSaved);
    assert.equal(chat.user.phone, '34600555444', 'номер сохранён в карточке клиента');
    assert.ok(chat.inquiries.some((inquiry) => inquiry.text.includes('34600555444')), 'менеджер видит номер');
    assert.deepEqual(shared.last.markup.keyboard[0].map((button) => button.text), [bot.text.menuLabels.ru.objects, bot.text.menuLabels.ru.selection], 'кнопка больше не нужна');
  });

  test('чужой контакт после записи не сохраняется как телефон клиента', async () => {
    enableSlots();
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    step = await chat.say(tomorrowLabel(step.last.buttons));
    await chat.say('10:00');
    await chat.say(ru.confirm);

    await chat.shareContact('34600123123', { ownerId: 5550002 });
    assert.notEqual(chat.user.phone, '34600123123', 'номер друга не записан клиенту');
  });

  test('a client whose phone is known is not asked for it again', async () => {
    enableSlots();
    const chat = createChat();
    chat.user.phone = '+34 600 111 000';
    let step = await chat.press('property:viewing:villa-marbella-01');
    step = await chat.say(tomorrowLabel(step.last.buttons));
    await chat.say('10:00');
    step = await chat.say(ru.confirm);
    assert.ok(!step.last.markup.keyboard.flat().some((button) => button.request_contact), 'номер уже есть');
  });

  test('a slot taken while the client was deciding is not double-booked', async () => {
    enableSlots();
    const slow = createChat();
    let step = await slow.press('property:viewing:villa-marbella-01');
    await slow.say(tomorrowLabel(step.last.buttons));
    await slow.say('16:00');
    const fast = createChat();
    step = await fast.press('property:viewing:villa-marbella-01');
    await fast.say(tomorrowLabel(step.last.buttons));
    await fast.say('16:00');
    await fast.say(ru.confirm);
    step = await slow.say(ru.confirm);
    assert.equal(step.last.text, ru.slotTaken);
    assert.equal(slow.user.pendingAction.step, 'date');
    assert.equal(slow.inquiries.length, 0);
  });

  test('"another date" still works and waits for the manager', async () => {
    enableSlots();
    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[3]);
    await chat.say('В следующую субботу после обеда');
    await chat.say(ru.confirm);
    assert.equal(chat.inquiries[0].status, 'new');
    assert.equal(chat.inquiries[0].viewing.confirmedAt, '');
  });

  test('without free slots the form offers the usual options', async () => {
    enableSlots({ enabled: false });
    let step = await createChat().press('property:viewing:villa-marbella-01');
    assert.deepEqual(step.last.buttons, [...ru.dateOptions, ru.online, ru.cancel], 'среди вариантов есть онлайн-показ');
    enableSlots({ days: [] });
    step = await createChat().press('property:viewing:villa-marbella-01');
    assert.deepEqual(step.last.buttons, [...ru.dateOptions, ru.online, ru.cancel], 'no days set');
  });
});

test.describe('fixes after review', () => {
  test('an old confirm button does not revive a cancelled viewing or move a confirmed one', async () => {
    const chat = createChat();
    const cancelled = await requestViewing(chat);
    await chat.press('myreq:yes:' + cancelled.id);
    telegram.calls = [];
    let pressed = await adminPress('inq:confirm:' + cancelled.id);
    assert.match(pressed.popups[0], /клиент отменил просмотр/);
    assert.equal(sentTo(chat).length, 0);
    assert.equal(cancelled.status, 'closed');

    const other = createChat();
    const confirmed = await requestViewing(other, 2, 0);
    await bot.confirmViewing(confirmed, { date: dayKey(daysFromNow(3)), time: '14:00', source: 'panel' });
    telegram.calls = [];
    pressed = await adminPress('inq:confirm:' + confirmed.id);
    assert.match(pressed.popups[0], /^Просмотр уже подтверждён на .+, 14:00/);
    assert.equal(confirmed.viewing.confirmedTime, '14:00');
    assert.equal(sentTo(other).length, 0);
  });

  test('подтверждение просмотра двигает этап только вперёд', async () => {
    // Менеджер уже поставил «Переговоры» — подтверждение или перенос просмотра
    // не должны вернуть этап на «Просмотр».
    const advanced = await requestViewing(createChat());
    advanced.pipelineStage = 'negotiation';
    await bot.confirmViewing(advanced, { date: dayKey(daysFromNow(3)), time: '12:00', source: 'panel' });
    assert.equal(advanced.pipelineStage, 'negotiation', 'этап не откатился');
    await bot.confirmViewing(advanced, { date: dayKey(daysFromNow(4)), time: '17:00', source: 'panel' });
    assert.equal(advanced.pipelineStage, 'negotiation', 'и при переносе тоже');

    // Ранний этап подтверждение переводит вперёд, как и раньше.
    const early = await requestViewing(createChat());
    early.pipelineStage = 'contact';
    await bot.confirmViewing(early, { date: dayKey(daysFromNow(3)), time: '10:00', source: 'panel' });
    assert.equal(early.pipelineStage, 'viewing');

    // Закрытое дело новый просмотр оживляет: этап и статус согласованы.
    const closed = await requestViewing(createChat());
    closed.pipelineStage = 'lost';
    closed.status = 'closed';
    await bot.confirmViewing(closed, { date: dayKey(daysFromNow(3)), time: '10:00', source: 'panel' });
    assert.deepEqual([closed.pipelineStage, closed.status], ['viewing', 'in_progress']);
  });

  test('a confirmation the client did not receive is not saved', async () => {
    const chat = createChat();
    const inquiry = await requestViewing(chat);
    const working = global.fetch;
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/sendMessage') && JSON.parse(init.body).chat_id === chat.id) {
        return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
      }
      return working(url, init);
    };
    try {
      await assert.rejects(bot.confirmViewing(inquiry, { source: 'panel' }));
    } finally {
      global.fetch = working;
    }
    assert.equal(inquiry.viewing.confirmedAt, '');
    assert.equal(inquiry.status, 'new');
  });

  test('Spanish weekdays are not months; a new date after "another date" asks the time again', async () => {
    const now = new Date(2026, 8, 18, 12, 0);
    assert.equal(bot.parseViewingDate('el martes 29 por la tarde', now), '', '"martes" is Tuesday, not March');
    assert.equal(bot.parseViewingDate('29 de marzo', now), '2027-03-29');
    assert.equal(bot.parseViewingDate('5 mar', now), '2027-03-05');

    const chat = createChat();
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[3]);
    await chat.say('25 сентября после 16');
    await chat.say(ru.editDate);
    const step = await chat.say(ru.dateOptions[1]);
    assert.equal(step.last.text, ru.askTime, 'the time of the free-text date is gone');
  });

  test('free slots switched off during the form, or a slot too close, are handled honestly', async () => {
    bot.getData().config.viewingSlots = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], times: ['10:00', '16:00'], daysAhead: 3, perSlot: 1 };
    const chat = createChat();
    let step = await chat.press('property:viewing:villa-marbella-01');
    const date = daysFromNow(1);
    const label = step.last.buttons.find((text) => text.includes(String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0')));
    await chat.say(label);
    await chat.say('10:00');
    bot.getData().config.viewingSlots.enabled = false;
    step = await chat.say(ru.confirm);
    assert.equal(chat.inquiries[0].status, 'new', 'no automatic confirmation once slots are off');
    assert.equal(chat.inquiries[0].viewing.confirmedAt, '');

    bot.getData().config.viewingSlots.enabled = true;
    const late = createChat();
    step = await late.press('property:viewing:villa-marbella-01');
    await late.say(step.last.buttons.find((text) => text.includes(String(date.getDate()).padStart(2, '0') + '.')));
    await late.say('16:00');
    bot.getData().config.viewingSlots.times = ['10:00'];
    step = await late.say(ru.confirm);
    assert.equal(step.last.text, ru.slotGone, 'nobody took it: it is just no longer offered');
  });
});

test.describe('my requests', () => {
  test('the list shows each request with its status', async () => {
    const chat = createChat();
    const inquiry = await requestViewing(chat);
    await chat.press('contact:question');
    await chat.say('Можно ли купить в ипотеку?');
    await adminPress('inq:confirm:' + inquiry.id);

    const step = await chat.say('/requests');
    const lines = step.last.text.split('\n');
    assert.equal(lines[0], '📋 Ваши последние заявки и обращения:');
    assert.ok(lines.includes('❓ Вопрос'));
    assert.ok(lines.includes('📅 Просмотр · Вилла в Марбелье'));
    assert.ok(lines.some((line) => line.endsWith('— ✅ просмотр подтверждён')));
    assert.ok(lines.some((line) => /^отправлена \d\d\.\d\d — 🆕 получена/.test(line)));
    assert.deepEqual(callbacksOf(step.last.markup), ['myreq:cancel:' + inquiry.id, 'nav:my']);
  });

  test('"My space" leads to the list; without requests it explains what will appear', async () => {
    const chat = createChat();
    const more = await chat.say(bot.text.menu.ru.more);
    assert.ok(callbacksOf(more.last.markup).includes('myreq:list'));
    const step = await chat.press('myreq:list');
    assert.match(step.last.text, /^У вас пока нет заявок/);
  });

  test('a client cancels a viewing after a second tap, and the admin is told', async () => {
    const chat = createChat();
    const inquiry = await requestViewing(chat);
    let step = await chat.press('myreq:cancel:' + inquiry.id);
    assert.match(step.last.text, /^Отменить просмотр\?/);
    assert.equal(inquiry.status, 'new', 'nothing changes before the answer');

    step = await chat.press('myreq:no:' + inquiry.id);
    assert.deepEqual(step.popups, ['Хорошо, просмотр остаётся в силе.']);

    telegram.calls = [];
    step = await chat.press('myreq:yes:' + inquiry.id);
    assert.match(step.last.text, /^Просмотр отменён/);
    assert.equal(inquiry.status, 'closed');
    assert.ok(inquiry.viewing.cancelledAt);
    assert.ok(adminMessages().some((message) => message.text.startsWith('📩 Клиент отменил просмотр') && message.text.includes('Вилла в Марбелье')));

    step = await chat.press('myreq:yes:' + inquiry.id);
    assert.equal(step.popups.length, 1, 'a second cancel is stale');
  });

  test('nobody can cancel another client\'s viewing', async () => {
    const inquiry = await requestViewing(createChat());
    await createChat().press('myreq:yes:' + inquiry.id);
    assert.equal(inquiry.status, 'new');
  });
});

test.describe('reminder, feedback and the day\'s list', () => {
  async function confirmedViewing(chat, days = 2) {
    const inquiry = await requestViewing(chat);
    inquiry.viewing.confirmedAt = daysFromNow(-1).toISOString();
    inquiry.viewing.confirmedDate = dayKey(daysFromNow(days));
    inquiry.viewing.confirmedTime = '11:00';
    inquiry.status = 'in_progress';
    return inquiry;
  }

  test('the client is reminded the evening before, once', async () => {
    const chat = createChat();
    const inquiry = await confirmedViewing(chat);
    const date = inquiry.viewing.confirmedDate;
    telegram.calls = [];
    assert.deepEqual((await bot.runViewingNotices(at(date, -1, 17))).reminders, [], 'not before 18:00');
    const result = await bot.runViewingNotices(at(date, -1, 18, 15));
    assert.deepEqual(result.reminders, [inquiry.id]);
    const [reminder] = sentTo(chat);
    assert.match(reminder.body.text, /^⏰ Напоминаем: завтра просмотр/);
    assert.ok(reminder.body.text.includes('🕒 Время: 11:00'));
    assert.ok(callbacksOf(reminder.body.reply_markup).includes('myreq:cancel:' + inquiry.id));
    assert.deepEqual((await bot.runViewingNotices(at(date, -1, 19))).reminders, [], 'once');
  });

  test('no reminder for a viewing confirmed that evening, cancelled or not confirmed', async () => {
    const late = await confirmedViewing(createChat());
    late.viewing.confirmedAt = at(late.viewing.confirmedDate, -1, 19).toISOString();
    const cancelled = await confirmedViewing(createChat());
    cancelled.viewing.cancelledAt = new Date().toISOString();
    await requestViewing(createChat(), 1, 0);
    assert.deepEqual((await bot.runViewingNotices(at(late.viewing.confirmedDate, -1, 20))).reminders, []);
  });

  test('the day after, the client is asked how it went', async () => {
    const chat = createChat();
    const inquiry = await confirmedViewing(chat);
    inquiry.viewing.remindedAt = new Date().toISOString();
    const date = inquiry.viewing.confirmedDate;
    assert.deepEqual((await bot.runViewingNotices(at(date, 0, 15))).feedback, [], 'not on the day itself');
    telegram.calls = [];
    assert.deepEqual((await bot.runViewingNotices(at(date, 1, 10, 30))).feedback, [inquiry.id]);
    const [question] = sentTo(chat);
    assert.equal(question.body.text, '🏠 Вилла в Марбелье\n\nКак прошёл просмотр? Нам важно ваше мнение.');
    assert.deepEqual(callbacksOf(question.body.reply_markup), ['vfb:liked:' + inquiry.id, 'vfb:questions:' + inquiry.id, 'vfb:disliked:' + inquiry.id]);
    assert.deepEqual((await bot.runViewingNotices(at(date, 1, 12))).feedback, [], 'asked once');
  });

  test('"liked" becomes a new request for the manager', async () => {
    const chat = createChat();
    const inquiry = await confirmedViewing(chat);
    telegram.calls = [];
    const step = await chat.press('vfb:liked:' + inquiry.id);
    assert.equal(step.last.text, 'Отлично! Менеджер свяжется с вами, чтобы обсудить следующие шаги.');
    assert.equal(inquiry.viewing.feedback, 'liked');
    const interest = chat.inquiries.find((item) => item.type === 'interest');
    assert.match(interest.text, /После просмотра: понравилось/);
    assert.ok(adminMessages().some((message) => message.text.includes('интерес к объекту')));
    const again = await chat.press('vfb:disliked:' + inquiry.id);
    assert.equal(again.popups.length, 1, 'answered once');
    assert.equal(inquiry.viewing.feedback, 'liked');
  });

  test('"questions" waits for the question, "not for me" shows a similar property', async () => {
    const asking = createChat();
    const first = await confirmedViewing(asking);
    await asking.press('vfb:questions:' + first.id);
    assert.deepEqual(asking.user.pendingAction && [asking.user.pendingAction.type, asking.user.pendingAction.propertyId], ['question', 'villa-marbella-01']);

    const unhappy = createChat();
    const second = await confirmedViewing(unhappy);
    telegram.calls = [];
    await unhappy.press('vfb:disliked:' + second.id);
    assert.ok(adminMessages().some((message) => message.text.startsWith('📩 Отзыв после просмотра: не подошло')));
    const photo = telegram.calls.find((call) => call.method === 'sendPhoto' && String(call.body.chat_id) === String(unhappy.id));
    assert.match(photo.body.caption, /Вилла в Эстепоне/);
  });

  test('only the client who was asked can answer', async () => {
    const inquiry = await confirmedViewing(createChat());
    await createChat().press('vfb:liked:' + inquiry.id);
    assert.equal(inquiry.viewing.feedback, '');
  });

  test('the admin gets today\'s viewings in the morning, once', async () => {
    const chat = createChat({ firstName: 'Мария' });
    chat.user.phone = '+34 600 111 222';
    const confirmed = await confirmedViewing(chat, 0);
    confirmed.viewing.confirmedDate = dayKey(new Date(2026, 8, 25));
    const waiting = await requestViewing(createChat({ firstName: 'Пётр' }), 0, 2);
    waiting.viewing.date = '2026-09-25';
    const morning = new Date(2026, 8, 25, 8, 30);
    telegram.calls = [];
    const result = await bot.runViewingNotices(morning);
    assert.equal(result.agenda, [
      '📅 Просмотры сегодня, Пт, 25.09',
      '• 11:00 — Вилла в Марбелье — Мария, +34 600 111 222',
      '',
      '⏳ Ждут подтверждения:',
      '• ' + ru.timeOptions[2] + ' — Вилла в Марбелье — Пётр',
    ].join('\n'));
    assert.equal(adminMessages().filter((message) => message.text.startsWith('📅 Просмотры сегодня')).length, 1);
    assert.equal((await bot.runViewingNotices(new Date(2026, 8, 25, 12))).agenda, '', 'once a day');
    assert.equal(ADMIN_CHAT, bot.getData().config.adminChatId);
  });
});

test('два менеджера жмут «Подтвердить» одновременно — клиент получает одно подтверждение', async () => {
  const chat = createChat();
  const inquiry = await (async () => {
    await chat.press('property:viewing:villa-marbella-01');
    await chat.say(ru.dateOptions[1]);
    await chat.say(ru.timeOptions[0]);
    await chat.say(ru.confirm);
    return chat.inquiries[chat.inquiries.length - 1];
  })();
  telegram.calls = [];

  // Нажатия приходят из двух чатов одновременно: проверка «уже подтверждён»
  // успевает пройти в обоих, пока первое подтверждение ещё отправляется.
  const results = await Promise.allSettled([
    bot.confirmViewing(inquiry, { source: 'telegram' }),
    bot.confirmViewing(inquiry, { source: 'telegram' }),
  ]);
  const confirmations = telegram.calls.filter((call) => call.method === 'sendMessage'
    && String(call.body.chat_id) === String(chat.id)
    && /Просмотр подтверждён|Viewing confirmed/i.test(String(call.body.text)));
  assert.equal(confirmations.length, 1, 'клиенту ушло одно подтверждение');
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1, 'второе нажатие получило отказ');
  assert.match(results.find((item) => item.status === 'rejected').reason.message, /уже подтверждается/);
  assert.equal(inquiry.replies.filter((item) => /Просмотр подтверждён/.test(item.text)).length, 1, 'и запись в переписке одна');
});
