'use strict';

// Публикация без трёх языков: владелец заполняет по-русски и копирует русский текст в
// английскую и испанскую карточки. Клиент на другом языке видит текст по-русски с честной
// пометкой, а не выдуманный перевод.

const test = require('node:test');
const assert = require('node:assert/strict');
const { callbacksOf, createChat, property, resetData, cleanup } = require('./helpers/chat');

test.after(cleanup);

function catalog(copied) {
  resetData((data) => {
    data.config.active = true;
    const ru = 'Светлая квартира рядом с морем, большая терраса и парковка.';
    data.objects.push(property('flat-1', 'Квартира у моря', 'active', {
      description: { ru, en: copied ? ru : 'A bright flat near the sea with a big terrace and parking.', es: copied ? ru : 'Piso luminoso cerca del mar con terraza y parking.' },
      title: { ru: 'Квартира у моря', en: copied ? 'Квартира у моря' : 'Flat by the sea', es: copied ? 'Квартира у моря' : 'Piso junto al mar' },
      priceValue: 250000, currency: 'EUR', area: 70, bedrooms: 2, bathrooms: 1,
    }));
  });
}

test('английская карточка с русским текстом — с пометкой «Text in Russian»; с настоящим переводом — без неё', async () => {
  catalog(true);
  const copied = createChat({ language: 'en' });
  await copied.say('/start');
  const step = await copied.press('catalog:all:0');
  const card = step.calls.find((call) => call.method === 'sendPhoto' || call.method === 'sendMessage');
  const caption = (card && (card.body.caption || card.body.text)) || step.text;
  assert.match(caption, /Text in Russian — translation coming soon/, caption);

  catalog(false);
  const translated = createChat({ language: 'en' });
  await translated.say('/start');
  const real = await translated.press('catalog:all:0');
  const realCard = real.calls.find((call) => call.method === 'sendPhoto' || call.method === 'sendMessage');
  assert.ok(!/in Russian/.test((realCard && (realCard.body.caption || realCard.body.text)) || real.text), 'переведённая карточка без пометки');
});

test('русский клиент пометки не видит, даже если тексты во всех языках одинаковы', async () => {
  catalog(true);
  const chat = createChat({ language: 'ru' });
  await chat.say('/start');
  const step = await chat.press('catalog:all:0');
  assert.ok(!/Texto en ruso|Text in Russian|Текст на русском/.test(step.text));
});
