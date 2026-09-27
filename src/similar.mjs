// Ranking for the "Similar properties" mini-catalog.
// The function is deliberately pure so the Telegram flow and tests use the
// same rules. A different deal type is never offered as a similar property.

import { cleanText } from './util.mjs';

const SIMILAR_REASON_KEYS = new Set(['type', 'relatedType', 'city', 'district', 'price', 'bedrooms', 'area']);
const SIMILAR_WARNING_KEYS = new Set(['priceDifferent', 'priceMissing', 'currency']);

const PROPERTY_TYPE_GROUPS = {
  apartment: 'apartment',
  newbuild: 'apartment',
  house: 'house',
  villa: 'house',
  townhouse: 'house',
  land: 'land',
  commercial: 'commercial',
  other: 'other',
};

function localizedValue(value, language) {
  return cleanText(value && typeof value === 'object' ? value[language] : '', 160).toLocaleLowerCase();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sameCurrency(first, second) {
  return cleanText(first, 10).toUpperCase() === cleanText(second, 10).toUpperCase();
}

function normalizedSimilarPropertyDetails(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    id: cleanText(item && item.id, 100),
    score: Math.max(0, Math.min(100, Math.round(Number(item && item.score) || 0))),
    reasons: Array.from(new Set((Array.isArray(item && item.reasons) ? item.reasons : [])
      .filter((key) => SIMILAR_REASON_KEYS.has(key)))).slice(0, 7),
    warnings: Array.from(new Set((Array.isArray(item && item.warnings) ? item.warnings : [])
      .filter((key) => SIMILAR_WARNING_KEYS.has(key)))).slice(0, 3),
  })).filter((item) => item.id).slice(0, 20);
}

function similarPropertyRanking(source, candidates, language = 'ru') {
  if (!source || !Array.isArray(candidates)) return [];
  const sourceType = cleanText(source.propertyType, 40);
  const sourceGroup = PROPERTY_TYPE_GROUPS[sourceType] || sourceType;
  const sourceCity = localizedValue(source.city, language);
  const sourceDistrict = localizedValue(source.district, language);
  const sourcePrice = positiveNumber(source.priceValue);
  const sourceBedrooms = positiveNumber(source.bedrooms);
  const sourceArea = positiveNumber(source.propertyType === 'land' ? source.plotArea : source.area);

  return candidates.map((record, index) => {
    if (!record || String(record.id) === String(source.id) || record.status !== 'active' || record.dealType !== source.dealType) return null;
    let score = 0;
    const reasons = [];
    const warnings = [];
    const candidateType = cleanText(record.propertyType, 40);
    const candidateGroup = PROPERTY_TYPE_GROUPS[candidateType] || candidateType;
    let compatibleType = false;
    if (candidateType && candidateType === sourceType) {
      compatibleType = true;
      score += 30;
      reasons.push('type');
    } else if (candidateGroup && candidateGroup === sourceGroup) {
      compatibleType = true;
      score += 20;
      reasons.push('relatedType');
    }

    const candidateCity = localizedValue(record.city, language);
    const candidateDistrict = localizedValue(record.district, language);
    if (sourceCity && candidateCity === sourceCity) {
      score += 20;
      reasons.push('city');
    }
    if (sourceDistrict && candidateDistrict === sourceDistrict) {
      score += 15;
      reasons.push('district');
    }

    const candidatePrice = positiveNumber(record.priceValue);
    if (sourcePrice && candidatePrice) {
      if (!sameCurrency(source.currency || 'EUR', record.currency || 'EUR')) {
        warnings.push('currency');
      } else {
        const difference = Math.abs(candidatePrice - sourcePrice) / sourcePrice;
        if (difference <= 0.1) {
          score += 25;
          reasons.push('price');
        } else if (difference <= 0.25) {
          score += 18;
          reasons.push('price');
        } else if (difference <= 0.5) {
          score += 8;
          warnings.push('priceDifferent');
        } else {
          warnings.push('priceDifferent');
        }
      }
    } else {
      warnings.push('priceMissing');
    }

    const candidateBedrooms = positiveNumber(record.bedrooms);
    if (sourceBedrooms && candidateBedrooms) {
      const difference = Math.abs(candidateBedrooms - sourceBedrooms);
      if (difference === 0) {
        score += 10;
        reasons.push('bedrooms');
      } else if (difference === 1) {
        score += 5;
        reasons.push('bedrooms');
      }
    }

    const candidateArea = positiveNumber(record.propertyType === 'land' ? record.plotArea : record.area);
    if (sourceArea && candidateArea) {
      const difference = Math.abs(candidateArea - sourceArea) / sourceArea;
      if (difference <= 0.15) {
        score += 8;
        reasons.push('area');
      } else if (difference <= 0.35) {
        score += 4;
        reasons.push('area');
      }
    }

    // A shared city alone is not enough to call unrelated real estate
    // similar. Keep a candidate only when several meaningful signals agree.
    if (!compatibleType || score < 25) return null;
    return { record, id: String(record.id), score: Math.min(100, score), reasons, warnings, index };
  }).filter(Boolean)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, 20)
    .map(({ index, ...item }) => item);
}

export {
  SIMILAR_REASON_KEYS,
  SIMILAR_WARNING_KEYS,
  normalizedSimilarPropertyDetails,
  similarPropertyRanking,
};
