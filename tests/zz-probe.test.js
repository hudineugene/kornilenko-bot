'use strict';
const test = require('node:test');
const { bot, createChat, property, resetData, cleanup } = require('./helpers/chat');
const { menu: MENU } = bot.text;
test.after(cleanup);
const show = (label, step) => {
  const call = [...step.calls].reverse().find((c) => c.body && (c.body.caption || c.body.text));
  if (!call) return console.log('\n=== ' + label + ': нет сообщения');
  const body = call.body;
  let text = String(body.caption || body.text || '');
  if (body.entities && body.entities[0]) text = '**' + text.slice(0, body.entities[0].length) + '**' + text.slice(body.entities[0].length);
  const rows = ((body.reply_markup || {}).inline_keyboard || []);
  console.log('\n=== ' + label + ' [' + call.method + '] (' + text.split('\n').length + ' строк)\n' + text + '\n--- кнопки');
  for (const row of rows) console.log(row.map((b) => b.text + '[' + [...b.text].length + ']').join(' | '));
};
for (const language of (process.env.PROBE_LANGS || 'ru').split(',')) {
  test('probe ' + language, async () => {
    resetData((data) => {
      data.config.active = true;
      data.config.calculator = { ...(data.config.calculator || {}), enabled: true };
      data.contacts.phone = '+34 664 17 96 37';
      data.contacts.whatsapp = '+34 664179637';
      data.contacts.mapUrl = 'https://maps.example.com/office';
      for (const [id, title, extra] of [
        ['villa-a', 'Вилла у моря', { propertyType: 'villa', priceValue: 650000, area: 180, plotArea: 500, bedrooms: 4, bathrooms: 3, condition: 'renovated', distanceSea: 350 }],
        ['flat-b', 'Квартира в центре', { priceValue: 320000, area: 92, bedrooms: 2, bathrooms: 2, condition: 'new', floor: '3' }],
        ['house-c', 'Дом с садом', { propertyType: 'house', priceValue: 470000, area: 140, plotArea: 250, bedrooms: 3, bathrooms: 2 }],
      ]) data.objects.push(property(id, title, 'active', { currency: 'EUR', ...extra }));
    });
    const chat = createChat({ language });
    await chat.say(MENU[language].objects);
    for (const id of ['villa-a', 'flat-b', 'house-c']) await chat.press('property:compare:' + id);
    show(language + ' сравнение', await chat.press('compare:view'));
    show(language + ' Моё', await chat.say(MENU[language].more));
    show(language + ' калькулятор', await chat.press('calc:villa-a'));
    show(language + ' мои заявки', await chat.press('myreq:list'));
    show(language + ' план', await chat.press('plan:open'));
    show(language + ' политика', await chat.press('privacy:policy'));
    show(language + ' подписки', await chat.press('subs:menu'));
    show(language + ' связаться', await chat.say(MENU[language].contacts));
    show(language + ' подбор', await chat.say(MENU[language].selection));
    show(language + ' гид', await chat.say(MENU[language].guide));
    show(language + ' фильтр', await chat.press('cfilter:open'));
  });
}
