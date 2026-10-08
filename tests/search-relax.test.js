'use strict';

// Поиск словами на каталоге из комплексов: «новостройка» находит строящиеся объекты, а пожелание («у моря»), из-за которого пусто,
// предлагается снять — раньше экран «Ничего не найдено» не давал выхода и клиент терял подходящий объект.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChat, property, resetData, cleanup } = require('./helpers/chat');

const shown = (step) => step.calls.map((call) => String(call.body.caption || call.body.text || '')).join('\n');

test.beforeEach(() => resetData((data) => {
  data.config.active = true;
  data.objects.push(property('complex-fin', 'Комплекс в Финестрате', 'active', {
    propertyType: 'apartment', condition: 'under_construction', priceValue: 147000, bedrooms: 1,
    city: { ru: 'Финестрат', en: 'Finestrat', es: 'Finestrat' },
  }));
  data.objects.push(property('villa-alt', 'Вилла в Альтее', 'active', {
    propertyType: 'villa', priceValue: 600000, bedrooms: 3, city: { ru: 'Альтея', en: 'Altea', es: 'Altea' },
  }));
}));
test.after(cleanup);

test('«новостройка» находит строящийся объект, даже если тип у него «Квартира»', async () => {
  const chat = createChat();
  const step = await chat.say('новостройка');
  const text = shown(step);
  assert.match(text, /Комплекс в Финестрате/);
  assert.ok(!/Вилла в Альтее/.test(text), 'готовая вилла — не новостройка');
});

test('нет объектов «у моря» — экран предлагает показать без этого условия и называет, сколько найдётся', async () => {
  const chat = createChat();
  const step = await chat.say('квартира у моря в Финестрате до 200 000 евро');
  const text = shown(step);
  assert.match(text, /Ничего не найдено/);
  assert.match(text, /Без условия «у моря» — найдено: 1/);
});

test('на английском и испанском то же: «Without “by the sea”», «Sin «cerca del mar»»', async () => {
  const english = createChat({ language: 'en' });
  assert.match(shown(await english.say('apartment by the sea in Finestrat under 200k')), /Without “by the sea” — found: 1/);
  const spanish = createChat({ language: 'es' });
  assert.match(shown(await spanish.say('apartamento cerca del mar en Finestrat hasta 200.000')), /Sin «cerca del mar»/i);
});
