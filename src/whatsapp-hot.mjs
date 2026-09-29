// Тексты, которые клиент увидит в поле ввода WhatsApp, когда нажмёт «🟢 WhatsApp» на
// «горячих» экранах: в сравнении и в пустой выдаче. Чтобы менеджер сразу понимал, с
// чем к нему пришли, а клиенту не пришлось ничего печатать.

import { cleanText } from './util.mjs';

const WHATSAPP_HOT_TEXT = {
  ru: { compare: 'Здравствуйте! Сравниваю объекты: {list}. Хочу обсудить.', search: 'Здравствуйте! Ищу недвижимость: {summary}. Подскажите, что есть?' },
  en: { compare: 'Hello! I am comparing these properties: {list}. I would like to discuss them.', search: 'Hello! I am looking for a property: {summary}. What do you have?' },
  es: { compare: '¡Hola! Estoy comparando estos inmuebles: {list}. Me gustaría comentarlos.', search: '¡Hola! Busco un inmueble: {summary}. ¿Qué tenéis?' },
};

function hotText(language) {
  return WHATSAPP_HOT_TEXT[language] || WHATSAPP_HOT_TEXT.ru;
}

function compareMessage(titles, language) {
  const list = titles.map((title) => cleanText(title, 80)).filter(Boolean).join(', ');
  return hotText(language).compare.replace('{list}', () => list);
}

function searchMessage(summary, language) {
  return hotText(language).search.replace('{summary}', () => cleanText(summary, 200));
}

export { WHATSAPP_HOT_TEXT, compareMessage, searchMessage };
