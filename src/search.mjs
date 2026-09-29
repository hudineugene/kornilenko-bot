// Search in a client's ordinary message. A property reference opens one
// card, a city opens that city's catalog, and a sufficiently clear natural
// request becomes a catalog filter. Ambiguous wording still goes to a
// manager instead of silently showing the wrong properties.

import { cleanText, parseMoneyAmount } from './util.mjs';
import { localizedExact, publishedCatalog } from './catalog.mjs';

const DEAL_TERMS = {
  sale: ['купить', 'покупка', 'покупку', 'покупать', 'продажа', 'продажу', 'buy', 'buying', 'purchase', 'sale', 'comprar', 'compra', 'venta'],
  rent: ['аренда', 'аренду', 'аренды', 'снять', 'снимать', 'арендовать', 'rent', 'renting', 'rental', 'alquilar', 'alquiler'],
};
const TYPE_TERMS = {
  apartment: ['квартира', 'квартиру', 'квартиры', 'апартамент', 'апартаменты', 'апартаментов', 'apartment', 'apartments', 'flat', 'flats', 'apartamento', 'apartamentos', 'piso', 'pisos'],
  house: ['дом', 'дома', 'house', 'houses', 'home', 'homes', 'casa', 'casas'],
  villa: ['вилла', 'виллу', 'виллы', 'villa', 'villas'],
  townhouse: ['таунхаус', 'таунхаусы', 'townhouse', 'townhouses', 'adosado', 'adosados'],
  land: ['участок', 'участка', 'земля', 'землю', 'plot', 'plots', 'land', 'terreno', 'terrenos', 'parcela', 'parcelas'],
  commercial: ['коммерческая недвижимость', 'коммерческое помещение', 'офис', 'commercial property', 'commercial', 'office', 'local comercial', 'locales comerciales'],
  newbuild: ['новостройка', 'новостройку', 'новостройки', 'new build', 'newbuild', 'new development', 'obra nueva'],
};
// «3 bed villa» — так пишут чаще, чем «3 bedroom»: короткие «bed»/«beds» тоже спальни.
const BEDROOM_WORDS = ['спальня', 'спальню', 'спальней', 'спальни', 'спален', 'спальнями', 'спальне', 'habitacion', 'habitaciones', 'bedroom', 'bedrooms', 'beds', 'bed', 'dormitorio', 'dormitorios', 'habitacion', 'habitaciones'];
const LOCATION_PREPOSITIONS = ['в', 'около', 'рядом с', 'in', 'near', 'around', 'en', 'cerca de'];

// «Рядом с морем», «near the beach» — пожелание, а не название места: раньше «рядом с» / «near»
// считались незнакомым городом, и вся фраза уходила менеджеру. Такие обороты выбрасываем
// перед проверкой «упомянуто незнакомое место».
const NEUTRAL_PLACE_PHRASES = [
  'у моря', 'рядом с морем', 'около моря', 'возле моря', 'близко к морю', 'недалеко от моря', 'у пляжа', 'рядом с пляжем', 'около пляжа', 'на берегу моря', 'с видом на море',
  'near the beach', 'near the sea', 'close to the beach', 'close to the sea', 'by the sea', 'by the beach', 'next to the beach', 'on the beach', 'with sea view', 'sea view',
  'cerca de la playa', 'cerca del mar', 'junto a la playa', 'junto al mar', 'frente al mar', 'en primera linea', 'con vistas al mar',
].sort((a, b) => b.length - a.length);

function withoutNeutralPlaces(message) {
  let text = ' ' + placeKey(message) + ' ';
  for (const phrase of NEUTRAL_PLACE_PHRASES) text = text.split(' ' + placeKey(phrase) + ' ').join(' ');
  return text.trim();
}

// Числа словами перед словом «спальни»: «две спальни», «two bedroom», «dos dormitorios».
const NUMBER_WORDS = {
  один: 1, одна: 1, одну: 1, одной: 1, два: 2, две: 2, двух: 2, двумя: 2, три: 3, трех: 3, тремя: 3, четыре: 4, четырех: 4, четырьмя: 4,
  one: 1, two: 2, three: 3, four: 4,
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4,
};

// "REF-1024", "ref 1024" and "Ref1024" are the same reference.
function referenceKey(value) {
  return String(value || '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// "Málaga", "malaga" and "МАЛАГА " are the same place for matching.
function placeKey(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function phraseIncluded(text, terms) {
  const haystack = ' ' + placeKey(text) + ' ';
  return terms.some((term) => haystack.includes(' ' + placeKey(term) + ' '));
}

// Russian city names are often typed in a declined form: "Марбелье",
// "Бенидорме". Generate only predictable word endings; unfamiliar places
// are deliberately not guessed.
function placeForms(value) {
  const name = placeKey(value);
  if (!name) return [];
  if (name.includes(' ')) {
    const words = name.split(' ');
    const last = words.pop();
    const prefix = words.join(' ');
    return placeForms(last).map((form) => prefix + ' ' + form);
  }
  const forms = new Set([name]);
  const last = name.slice(-1);
  const base = name.slice(0, -1);
  if (last === 'а') for (const ending of ['е', 'у', 'ы', 'ой']) forms.add(base + ending);
  else if (last === 'я') for (const ending of ['е', 'ю', 'и', 'ей']) forms.add(base + ending);
  else if (last === 'й') for (const ending of ['е', 'я', 'ю']) forms.add(base + ending);
  else if (/[бвгджзклмнпрстфхцчшщ]$/u.test(last)) for (const ending of ['е', 'а', 'у']) forms.add(name + ending);
  return Array.from(forms).filter(Boolean);
}

function mentionedPlaces(message, records, language, field) {
  const normalized = placeKey(message);
  const padded = ' ' + normalized + ' ';
  const tokens = new Set(normalized.split(' ').filter(Boolean));
  const places = new Map();
  for (const record of records) {
    const display = localizedExact(record[field], language, 160);
    if (!display) continue;
    const aliases = ['ru', 'en', 'es'].map((code) => localizedExact(record[field], code, 160)).filter(Boolean);
    const found = aliases.some((alias) => {
      const key = placeKey(alias);
      if (!key) return false;
      if (padded.includes(' ' + key + ' ')) return true;
      return placeForms(key).some((form) => key.includes(' ') ? padded.includes(' ' + form + ' ') : tokens.has(form));
    });
    if (!found) continue;
    const key = placeKey(display);
    if (!places.has(key)) places.set(key, { value: display, records: [] });
    places.get(key).records.push(record);
  }
  return Array.from(places.values());
}

function parseBedrooms(message) {
  const words = BEDROOM_WORDS.join('|');
  const normalized = placeKey(message);
  const numberWords = Object.keys(NUMBER_WORDS).join('|');
  const before = normalized.match(new RegExp('(?<![\\p{L}\\d])(\\d{1,2}|' + numberWords + ')\\s*(?:' + words + ')', 'u'));
  const after = normalized.match(new RegExp('(?:' + words + ')\\s*(?:от|from|desde)?\\s*(\\d{1,2})', 'u'));
  const spoken = before && NUMBER_WORDS[before[1]];
  const count = Number(spoken || before && before[1] || after && after[1] || 0);
  return count > 0 ? Math.min(4, count) : 0;
}

const MONEY_AMOUNT_PATTERN = '(\\d{1,3}(?:[ .\\u00a0\\u202f]\\d{3})+|\\d+(?:[.,]\\d+)?)';
// Longer words must come before their prefixes: otherwise “mil” is captured
// as “m” and 300 mil incorrectly becomes 300 million.
const MONEY_SUFFIX_PATTERN = '(millones|millón|millions|million|млн|тысяч|тыс|mil|k|к|m)?';
const MONEY_CONTEXT_PATTERN = /[€$£]|\b(?:eur|euro|euros|usd|dollar|dollars|gbp|pound|pounds|price|budget|precio|presupuesto|rent|rental|alquiler|sale|venta|buy|purchase)\b|(?:евро|доллар|фунт|цена|бюджет|аренд|покуп|продаж|квартир|недвижим|вилл|дом)/iu;

function moneyWithInheritedScale(amount, suffix, otherSuffix) {
  // Букву приписываем вплотную: с пробелом одиночная «к» или «m» считается
  // единицей измерения, а не масштабом.
  if (suffix) return parseMoneyAmount(amount + suffix);
  const plain = parseMoneyAmount(amount);
  // “300–500 тыс.” conventionally applies “тыс.” to both sides. A fully
  // written 300 000 already has its own scale and must not inherit another.
  if (otherSuffix && plain < 10000) return parseMoneyAmount(amount + otherSuffix);
  return plain;
}

function validPriceRange(message, match) {
  if (!match) return null;
  const minPrice = moneyWithInheritedScale(match[1], match[2] || '', match[4] || '');
  const maxPrice = moneyWithInheritedScale(match[3], match[4] || '', match[2] || '');
  if (minPrice < 100 || maxPrice < 100 || minPrice > maxPrice || maxPrice > 1000000000) return null;
  // A bare “2026–2027” is most likely a date. Ranges without a currency or a
  // scale remain valid when their values are unmistakably property prices.
  const signal = Boolean(match[2] || match[4] || MONEY_CONTEXT_PATTERN.test(String(message || '')));
  if (!signal && minPrice < 10000 && maxPrice < 10000) return null;
  return { minPrice, maxPrice };
}

function parsePriceRange(message) {
  const text = String(message || '');
  const start = '(?:(?:цена|бюджет(?:ом)?|price|budget|precio|presupuesto)\\s*)?(?:от|from|desde|de|between|entre)';
  const separator = '(?:до|to|hasta|a|and|y|[-–—])';
  const explicit = text.match(new RegExp(start + '[^\\d]{0,12}' + MONEY_AMOUNT_PATTERN + '\\s*' + MONEY_SUFFIX_PATTERN + '\\s*(?:€|eur(?:os?)?|евро|usd|dollars?|доллар(?:ов|а)?|gbp|pounds?|фунт(?:ов|а)?)?\\s*' + separator + '[^\\d]{0,12}' + MONEY_AMOUNT_PATTERN + '\\s*' + MONEY_SUFFIX_PATTERN, 'iu'));
  const explicitRange = validPriceRange(text, explicit);
  if (explicitRange) return explicitRange;
  const currency = '(?:€|\\$|£|eur(?:os?)?|евро|usd|dollars?|доллар(?:ов|а)?|gbp|pounds?|фунт(?:ов|а)?)?';
  const dashed = text.match(new RegExp(currency + '\\s*' + MONEY_AMOUNT_PATTERN + '\\s*' + MONEY_SUFFIX_PATTERN + '\\s*' + currency + '\\s*[-–—]\\s*' + currency + '\\s*' + MONEY_AMOUNT_PATTERN + '\\s*' + MONEY_SUFFIX_PATTERN, 'iu'));
  return validPriceRange(text, dashed);
}

// «до» внутри «дом» или «надо» — не признак цены, поэтому слова-указатели
// ищутся целиком. Между словом и суммой допускаем только пробелы, знаки и
// короткие связки: иначе «до моря 150 м» превратилось бы в «до 150 €».
const MONEY_GAP_PATTERN = '(?:[^\\p{L}\\d]|чем|около|примерно|than|about|de|unos|como)*';

function wholeWords(marker) {
  return '(?<![\\p{L}\\d])' + marker + '(?![\\p{L}\\d])';
}

// Сумма без валюты и без «тысяч» ниже этого порога — это не цена, а спальни,
// этаж или минуты до моря.
const MONEY_FLOOR = 100;

function parseMinPrice(message) {
  const range = parsePriceRange(message);
  if (range) return range.minPrice;
  const marker = '(?:не\\s+дешевле|цена\\s+от|бюджет(?:ом)?\\s+от|минимум|от|price\\s+from|budget\\s+from|at\\s+least|minimum|min|from|precio\\s+desde|presupuesto\\s+desde|como\\s+mínimo|como\\s+minimo|mínimo|minimo|desde)';
  const match = String(message || '').match(new RegExp(wholeWords(marker) + MONEY_GAP_PATTERN + MONEY_AMOUNT_PATTERN + '\\s*' + MONEY_SUFFIX_PATTERN, 'iu'));
  const amount = match ? parseMoneyAmount(match[1] + ' ' + (match[2] || '')) : 0;
  return amount >= MONEY_FLOOR ? amount : 0;
}

function parseMaxPrice(message) {
  const range = parsePriceRange(message);
  if (range) return range.maxPrice;
  const text = String(message || '');
  // Do not reinterpret a lower-only boundary (“from 300k”) as a maximum just
  // because the same sentence also contains the word “budget”.
  if (/(?:цена\s+от|бюджет(?:ом)?\s+от|не\s+дешевле|price\s+from|budget\s+from|at\s+least|precio\s+desde|presupuesto\s+desde|como\s+m[ií]nimo)/iu.test(text)) return 0;
  const marker = '(?:не\\s+дороже|цена\\s+до|бюджет(?:ом)?(?:\\s+до)?|максимум|до|up\\s+to|under|below|budget(?:\\s+of)?|maximum|max|hasta|presupuesto(?:\\s+de)?|máximo|maximo)';
  const match = text.match(new RegExp(wholeWords(marker) + MONEY_GAP_PATTERN + MONEY_AMOUNT_PATTERN + '\\s*' + MONEY_SUFFIX_PATTERN, 'iu'));
  // Передаём кусок исходного текста, а не число отдельно: разборщику нужно
  // видеть, что идёт следом — «150 кв.м» и «300 м от моря» это не цена.
  const amount = match ? parseMoneyAmount(text.slice(match.index, match.index + 60)) : 0;
  return amount >= MONEY_FLOOR ? amount : 0;
}

function searchableReference(record) {
  const key = referenceKey(record.reference);
  return key.length >= 3 && /\d/.test(key) ? key : '';
}

function naturalCatalogFilter(message, records, language) {
  const cities = mentionedPlaces(message, records, language, 'city');
  const districts = mentionedPlaces(message, records, language, 'district');
  const normalized = placeKey(message);
  const tokens = new Set(normalized.split(' ').filter(Boolean));
  const hasLocationChoice = (cities.length || districts.length) && ['или', 'or', 'o'].some((word) => tokens.has(word));
  const ambiguousLocation = cities.length > 1 || districts.length > 1 || hasLocationChoice;
  if (ambiguousLocation) return null;

  const deals = Object.keys(DEAL_TERMS).filter((key) => phraseIncluded(message, DEAL_TERMS[key]));
  const types = Object.keys(TYPE_TERMS).filter((key) => phraseIncluded(message, TYPE_TERMS[key]));
  if (deals.length > 1 || types.length > 1) return null;
  const deal = deals[0] || '';
  const type = types[0] || '';
  const bedrooms = parseBedrooms(message);
  const priceRange = parsePriceRange(message);
  const minPrice = priceRange ? priceRange.minPrice : parseMinPrice(message);
  const maxPrice = priceRange ? priceRange.maxPrice : parseMaxPrice(message);
  let city = cities[0] ? cities[0].value : '';
  const district = districts[0] ? districts[0].value : '';

  // A district belongs to a property and can therefore safely imply its city.
  // If the same district exists in several cities, the message remains a
  // manager question unless the client explicitly names one of those cities.
  if (districts[0]) {
    const districtRecords = districts[0].records;
    if (city) {
      if (!districtRecords.some((record) => placeKey(localizedExact(record.city, language, 160)) === placeKey(city))) return null;
    } else {
      const districtCities = new Map();
      for (const record of districtRecords) {
        const value = localizedExact(record.city, language, 160);
        if (value) districtCities.set(placeKey(value), value);
      }
      if (districtCities.size > 1) return null;
      city = Array.from(districtCities.values())[0] || '';
    }
  }

  const filter = { deal, type, bedrooms, city, district, minPrice, maxPrice, sort: '' };
  const count = [deal, type, bedrooms, city, district, minPrice, maxPrice].filter(Boolean).length;
  const mentionsUnknownLocation = !city && !district && phraseIncluded(withoutNeutralPlaces(message), LOCATION_PREPOSITIONS);
  const looksLikeQuestion = /[?？]/u.test(message)
    || phraseIncluded(message, ['есть ли', 'можно ли', 'сколько', 'какая цена', 'is there', 'are there', 'how much', 'what price', 'hay', 'cuánto', 'cuanto', 'qué precio', 'que precio']);

  if (looksLikeQuestion) return null;
  if (count >= 3 && !mentionsUnknownLocation) return filter;
  if (count === 2 && (city || minPrice || maxPrice || bedrooms) && !mentionsUnknownLocation) return filter;
  // «apartment for rent», «снять квартиру»: сделка и тип без города и цены — тоже ясная
  // просьба, если фраза короткая и не задаёт незнакомого места.
  if (count === 2 && deal && type && normalized.split(' ').length <= 6 && !mentionsUnknownLocation) return filter;
  if (count === 1 && city && normalized.split(' ').length <= 3) return filter;
  if (count === 1 && type && TYPE_TERMS[type].some((term) => normalized === placeKey(term))) return filter;
  return null;
}

// Сколько признаков поиска названо в сообщении (сделка, тип, спальни, город, цена), не
// решая, хватает ли их для фильтра. По этому числу бот отличает «искал, но фраза не
// разобралась» от обычного вопроса.
function searchSignalCount(text, user) {
  const message = cleanText(text, 300);
  if (!message) return 0;
  const language = user.preferredLanguage || 'ru';
  const records = publishedCatalog(user);
  const deal = Object.keys(DEAL_TERMS).some((key) => phraseIncluded(message, DEAL_TERMS[key]));
  const type = Object.keys(TYPE_TERMS).some((key) => phraseIncluded(message, TYPE_TERMS[key]));
  const place = mentionedPlaces(message, records, language, 'city').length > 0 || mentionedPlaces(message, records, language, 'district').length > 0;
  const range = parsePriceRange(message);
  const price = Boolean(range || parseMinPrice(message) || parseMaxPrice(message));
  return [deal, type, place, price, parseBedrooms(message) > 0].filter(Boolean).length;
}

// What the message asks for:
//   { kind: 'property', record, exact }  a property reference
//   { kind: 'city', city }               a city name by itself
//   { kind: 'filter', filter }           a confident natural-language search
//   null                                 anything ambiguous or conversational
function catalogRequest(text, user) {
  const message = cleanText(text, 300);
  if (!message) return null;
  const language = user.preferredLanguage || 'ru';
  const records = publishedCatalog(user);
  const whole = referenceKey(message);
  const words = new Set(message.split(/[\s,.;:!?()«»"']+/).map(referenceKey).filter((word) => word.length >= 3));
  for (const record of records) {
    const key = searchableReference(record);
    if (key && whole === key) return { kind: 'property', record, exact: true };
  }
  for (const record of records) {
    const key = searchableReference(record);
    if (key && key.length >= 4 && words.has(key)) return { kind: 'property', record, exact: false };
  }

  const filter = naturalCatalogFilter(message, records, language);
  if (!filter) return null;
  const criteria = [filter.deal, filter.type, filter.bedrooms, filter.city, filter.district, filter.minPrice, filter.maxPrice].filter(Boolean).length;
  if (criteria === 1 && filter.city && !filter.district) return { kind: 'city', city: filter.city };
  return { kind: 'filter', filter };
}

export {
  catalogRequest,
  naturalCatalogFilter,
  parseBedrooms,
  parseMinPrice,
  parseMaxPrice,
  parsePriceRange,
  searchSignalCount,
  placeKey,
  referenceKey,
};
