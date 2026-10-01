// Тексты недельного дайджеста и мягкого возврата. Отдельным файлом: их читают и
// каталог (заголовок списка), и сам модуль рассылки.

const DIGEST_TEXT = {
  ru: {
    heading: 'Что нового',
    title: '🗞 Что нового за неделю',
    fresh: '🏘 Новые: ',
    drops: '📉 Подешевели: ',
    forYou: '🔔 под ваш поиск',
    showNew: '🏘 Показать новые',
    showDrops: '📉 Показать снижения',
    off: '🔕 Не присылать',
    offDone: 'Хорошо, дайджест больше не пришлю. Включить снова можно кнопкой ниже.',
    on: '🔔 Включить снова',
    onDone: 'Готово, дайджест снова включён.',
    comeback: '👋 За неделю появилось {count}. Показать?',
    comebackForms: ['подходящий объект', 'подходящих объекта', 'подходящих объектов'],
    comebackShow: '🏘 Показать',
    comebackOff: '🔕 Не напоминать',
    comebackOffDone: 'Хорошо, больше не напоминаю.',
    nothing: 'Сейчас показать нечего.',
  },
  en: {
    heading: 'What’s new',
    title: '🗞 What’s new this week',
    fresh: '🏘 New: ',
    drops: '📉 Price drops: ',
    forYou: '🔔 matches your search',
    showNew: '🏘 Show new',
    showDrops: '📉 Show price drops',
    off: '🔕 Stop sending',
    offDone: 'OK, I will stop the digest. You can turn it back on with the button below.',
    on: '🔔 Turn on again',
    onDone: 'Done, the digest is back on.',
    comeback: '👋 This week {count} appeared. Show them?',
    comebackForms: ['matching property', 'matching properties', 'matching properties'],
    comebackShow: '🏘 Show',
    comebackOff: '🔕 Stop reminders',
    comebackOffDone: 'OK, no more reminders.',
    nothing: 'Nothing to show right now.',
  },
  es: {
    heading: 'Novedades',
    title: '🗞 Novedades de la semana',
    fresh: '🏘 Nuevos: ',
    drops: '📉 Bajadas de precio: ',
    forYou: '🔔 coincide con tu búsqueda',
    showNew: '🏘 Ver nuevos',
    showDrops: '📉 Ver bajadas de precio',
    off: '🔕 No enviar más',
    offDone: 'De acuerdo, dejo de enviar el resumen. Puedes volver a activarlo con el botón de abajo.',
    on: '🔔 Activar de nuevo',
    onDone: 'Listo, el resumen vuelve a estar activo.',
    comeback: '👋 Esta semana han aparecido {count}. ¿Te los muestro?',
    comebackForms: ['inmueble que te puede interesar', 'inmuebles que te pueden interesar', 'inmuebles que te pueden interesar'],
    comebackShow: '🏘 Ver',
    comebackOff: '🔕 No recordar más',
    comebackOffDone: 'De acuerdo, no te lo recuerdo más.',
    nothing: 'Ahora mismo no hay nada que mostrar.',
  },
};

function digestCopy(language) {
  return DIGEST_TEXT[language] || DIGEST_TEXT.ru;
}

// «За неделю появилось 2 подходящих объекта» — с правильным окончанием.
function comebackText(language, count) {
  const copy = digestCopy(language);
  const tens = count % 100;
  const ones = count % 10;
  const index = language === 'ru'
    ? (tens >= 11 && tens <= 14 ? 2 : ones === 1 ? 0 : ones >= 2 && ones <= 4 ? 1 : 2)
    : (count === 1 ? 0 : 1);
  return copy.comeback.replace('{count}', () => count + ' ' + copy.comebackForms[index]);
}

function digestHeading(language) {
  return digestCopy(language).heading;
}

export { DIGEST_TEXT, comebackText, digestCopy, digestHeading };
