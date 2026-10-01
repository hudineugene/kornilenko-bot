// «Нет тупика»: когда похожих объектов нет, клиенту предлагают не только написать
// менеджеру, но и (1) одним нажатием сохранить поиск по параметрам этой карточки —
// бот сообщит, когда появится похожий, и (2) посмотреть ближайшее по бюджету.
// Функции чистые: их используют и Telegram-сценарий, и тесты.

import { cleanText } from './util.mjs';
import { localizedExact } from './catalog.mjs';

const DEAD_END_TEXT = {
  ru: { notify: '🔔 Сообщить о похожих', budget: '💶 Ближайшее по бюджету', budgetHeading: 'Ближайшее по бюджету' },
  en: { notify: '🔔 Tell me about similar', budget: '💶 Closest by budget', budgetHeading: 'Closest by budget' },
  es: { notify: '🔔 Avisarme de similares', budget: '💶 Lo más cercano', budgetHeading: 'Lo más cercano por presupuesto' },
};

// Верхняя граница бюджета для сохранённого поиска: цена карточки плюс пятая часть,
// округлённая вверх до «красивого» шага. Ниже цены искать не ограничиваем.
function budgetCeiling(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = value < 100000 ? 10000 : value < 500000 ? 50000 : 100000;
  return Math.ceil((value * 1.2) / step) * step;
}

// Параметры сохранённого поиска по карточке: сделка, тип, город и бюджет с
// запасом. Спальни и район не берём — поиск не должен быть уже, чем нужно.
function similarSearchFilter(record, language) {
  if (!record) return null;
  return {
    deal: record.dealType === 'rent' ? 'rent' : 'sale',
    type: cleanText(record.propertyType, 40),
    bedrooms: 0,
    city: localizedExact(record.city, language, 160),
    district: '',
    minPrice: 0,
    maxPrice: budgetCeiling(record.priceValue),
    sort: '',
  };
}

// Ближайшие по цене объекты в той же сделке и валюте: до пяти, самые близкие
// первыми. Цена в другой валюте или её отсутствие сравнению не подлежат.
function nearestByBudget(record, candidates) {
  const price = Number(record && record.priceValue);
  if (!record || !(price > 0)) return [];
  const currency = cleanText(record.currency || 'EUR', 10).toUpperCase();
  return candidates
    .filter((item) => item && String(item.id) !== String(record.id) && item.status === 'active' && item.dealType === record.dealType
      && Number(item.priceValue) > 0 && cleanText(item.currency || 'EUR', 10).toUpperCase() === currency)
    .map((item, index) => ({ item, index, difference: Math.abs(Number(item.priceValue) - price) / price }))
    .sort((first, second) => first.difference - second.difference || first.index - second.index)
    .slice(0, 5)
    .map(({ item, difference }) => ({
      id: String(item.id),
      score: Math.max(0, Math.round(100 - difference * 100)),
      reasons: difference <= 0.25 ? ['price'] : [],
      warnings: difference > 0.25 ? ['priceDifferent'] : [],
    }));
}

export { DEAD_END_TEXT, budgetCeiling, nearestByBudget, similarSearchFilter };
