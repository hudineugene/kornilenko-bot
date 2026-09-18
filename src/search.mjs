// Поиск по сообщению клиента: номер объекта («REF-1024») открывает карточку,
// название города — каталог в этом городе. Остальное, как раньше, уходит
// менеджеру.

import { cleanText } from './util.mjs';
import { localizedExact, publishedCatalog } from './catalog.mjs';

// "REF-1024", "ref 1024" and "Ref1024" are the same reference.
function referenceKey(value) {
  return String(value || '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// "Málaga", "malaga" and "МАЛАГА " are the same city.
function placeKey(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// A reference needs a digit and a few characters, so words and small
// numbers in ordinary messages are not taken for one.
function searchableReference(record) {
  const key = referenceKey(record.reference);
  return key.length >= 3 && /\d/.test(key) ? key : '';
}

// What the message asks for:
//   { kind: 'property', record, exact }  a reference; exact when the message
//                                        is nothing but the reference
//   { kind: 'city', city }               a city of the catalog, in the
//                                        client's language
//   null                                 anything else
function catalogRequest(text, user) {
  const message = cleanText(text, 300);
  if (!message) return null;
  const language = user.preferredLanguage || 'ru';
  const records = publishedCatalog(user);
  const whole = referenceKey(message);
  const words = new Set(message.split(/[\s,.;:!?()«»"']+/).map(referenceKey).filter((word) => word.length >= 3));
  for (const record of records) {
    const key = searchableReference(record);
    if (!key) continue;
    if (whole === key) return { kind: 'property', record, exact: true };
  }
  for (const record of records) {
    const key = searchableReference(record);
    if (key && key.length >= 4 && words.has(key)) return { kind: 'property', record, exact: false };
  }
  // Only a short message that is just a place name: "Бенидорм", "Finestrat".
  if (message.length > 40 || message.split(/\s+/).length > 3) return null;
  const wanted = placeKey(message);
  if (!wanted) return null;
  for (const record of records) {
    const names = ['ru', 'en', 'es'].map((code) => localizedExact(record.city, code, 160)).filter(Boolean);
    if (names.some((name) => placeKey(name) === wanted)) {
      const city = localizedExact(record.city, language, 160);
      if (city) return { kind: 'city', city };
    }
  }
  return null;
}

export {
  catalogRequest,
  placeKey,
  referenceKey,
};
