// Языки бота и приложения. Русский — основной (из него делается перевод), украинский — добавлен в таблицы текстов через
// словарь uk-dictionary.json: «русская строка → украинская». Всё, чего в словаре нет, показывается по-русски, чтобы клиент
// не остался без текста; тест перечисляет такие строки.

import dictionary from './uk-dictionary.json' with { type: 'json' };

const LANGUAGES = ['ru', 'uk', 'en', 'es'];
const LANGUAGE_NAMES = { ru: 'Русский', uk: 'Українська', en: 'English', es: 'Español' };
// Языки, на которых владелец обязан дать тексты объектов; украинский при их отсутствии показывается русским.
const REQUIRED_LANGUAGES = ['ru', 'en', 'es'];
const LOCALES = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-GB', es: 'es-ES' };

const CYRILLIC = /[А-Яа-яЁёІіЇїЄєҐґ]/;
const missing = new Set();

function ukrainian(text) {
  if (typeof text !== 'string') return text;
  const found = Object.hasOwn(dictionary, text) ? dictionary[text] : undefined;
  if (typeof found === 'string' && found) return found;
  if (CYRILLIC.test(text)) missing.add(text);
  return text;
}

function translateDeep(value) {
  if (typeof value === 'string') return ukrainian(value);
  if (Array.isArray(value)) return value.map(translateDeep);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = translateDeep(item);
    return copy;
  }
  return value;
}

// Дописывает украинский вариант в таблицу текстов «язык → значение» (и во вложенные таблицы). Меняет таблицу на месте.
function addUk(table) {
  if (Array.isArray(table)) {
    for (const item of table) addUk(item);
    return table;
  }
  if (!table || typeof table !== 'object') return table;
  const hasLanguages = Object.hasOwn(table, 'ru') && (Object.hasOwn(table, 'en') || Object.hasOwn(table, 'es'));
  if (hasLanguages && !Object.hasOwn(table, 'uk')) table.uk = translateDeep(table.ru);
  for (const [key, item] of Object.entries(table)) {
    if (key === 'uk' || typeof item !== 'object' || item === null) continue;
    if (hasLanguages && ['ru', 'en', 'es'].includes(key)) continue;
    addUk(item);
  }
  return table;
}

function ukrainianStringsMissing() {
  return Array.from(missing).sort();
}

// Языки на кириллице: единицы, даты и склонения у них общие.
function isCyrillic(language) {
  return language === 'ru' || language === 'uk';
}

function languageOrUnknown(value, fallback = 'ru') {
  return LANGUAGES.includes(value) ? value : fallback;
}

export { LANGUAGES, LANGUAGE_NAMES, LOCALES, REQUIRED_LANGUAGES, addUk, isCyrillic, languageOrUnknown, translateDeep, ukrainian, ukrainianStringsMissing };
