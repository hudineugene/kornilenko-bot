// Калькулятор покупки под объектом на продажу: налоги и расходы сверх цены,
// ипотека и сумма на старте. Ставки задаёт администратор; пока калькулятор
// выключен в панели, кнопки нет.

import { CALCULATOR_TEXT, NAVIGATION_TEXT, PROPERTY_ACTION_TEXT } from './texts.mjs';
import { data } from './store.mjs';
import { formatMoney } from './util.mjs';
import { normalizeCalculator } from './data-format.mjs';
import { recordPropertyEvent } from './analytics.mjs';
import { normalizeUser } from './users.mjs';
import { localizedExact, propertyReadyForLanguage, sendUiMessage } from './catalog.mjs';
import { acknowledgeCallback, whatsappPropertyMessage, whatsappRow } from './sections.mjs';

function calculatorSettings() {
  return normalizeCalculator(data.config && data.config.calculator);
}

// Новостройка — это первая продажа от застройщика: платится IVA и гербовый
// сбор. Состояние «новое» у обычной квартиры этого не означает: квартиру без
// ремонта продаёт частное лицо, и там ITP. Раньше такой объект считался
// новостройкой, и расчёт показывал клиенту не тот налог.
function isNewBuild(record) {
  return record.propertyType === 'newbuild' || record.condition === 'under_construction';
}

// Участок и коммерческий объект продаёт, как правило, компания: там IVA 21 %
// вместо 10 % и гербовый сбор сверху. У частного продавца вместо IVA был бы
// ITP — об этом бот честно предупреждает в расчёте.
const BUSINESS_RATE_TYPES = ['land', 'commercial'];

function businessRateApplies(record) {
  return BUSINESS_RATE_TYPES.includes(record && record.propertyType);
}

function calculatorAvailable(record, settings = calculatorSettings()) {
  return Boolean(settings.enabled && record && record.dealType !== 'rent' && Number(record.priceValue) > 0);
}

// Monthly annuity payment.
function monthlyPayment(loan, interestPercent, years) {
  const months = years * 12;
  const rate = interestPercent / 100 / 12;
  if (!(loan > 0) || !(months > 0)) return 0;
  return rate ? loan * rate / (1 - (1 + rate) ** -months) : loan / months;
}

function purchaseEstimate(record, settings = calculatorSettings()) {
  const price = Number(record.priceValue);
  const business = businessRateApplies(record);
  const newBuild = isNewBuild(record);
  const lines = business
    ? [['businessTax', settings.businessTaxPercent], ['stampDuty', settings.stampDutyPercent]]
    : newBuild
      ? [['newBuildTax', settings.newBuildTaxPercent], ['stampDuty', settings.stampDutyPercent]]
      : [['resaleTax', settings.resaleTaxPercent]];
  lines.push(['otherCosts', settings.otherCostsPercent]);
  const costs = lines.filter(([, percent]) => percent > 0).map(([key, percent]) => ({ key, percent, amount: price * percent / 100 }));
  const costsTotal = costs.reduce((sum, item) => sum + item.amount, 0);
  const downPayment = price * settings.downPaymentPercent / 100;
  const loan = price - downPayment;
  return {
    price,
    newBuild,
    business,
    costs,
    costsTotal,
    total: price + costsTotal,
    downPayment,
    loan,
    monthly: monthlyPayment(loan, settings.interestPercent, settings.years),
    upfront: downPayment + costsTotal,
    settings,
  };
}

function money(value, currency, language) {
  return formatMoney(Math.round(value), !currency || currency === 'EUR' ? '€' : currency, language, 0);
}

function percent(value, language) {
  return String(value).replace('.', language === 'en' ? '.' : ',') + '%';
}

function estimateText(record, language, estimate = purchaseEstimate(record)) {
  const copy = CALCULATOR_TEXT[language] || CALCULATOR_TEXT.ru;
  const currency = record.currency || 'EUR';
  const title = localizedExact(record.title, language) || record.reference || '';
  const { settings } = estimate;
  const lines = [
    copy.title,
    title ? '🏠 ' + title : '',
    '',
    '💰 ' + copy.price + ': ' + money(estimate.price, currency, language),
    '🧾 ' + copy.costs + ': ≈ ' + money(estimate.costsTotal, currency, language),
    ...estimate.costs.map((item) => '   • ' + copy[item.key] + ' ' + percent(item.percent, language) + ': ' + money(item.amount, currency, language)),
    '📌 ' + copy.total + ': ≈ ' + money(estimate.total, currency, language),
  ];
  if (settings.downPaymentPercent < 100) {
    lines.push(
      '',
      '🏦 ' + copy.mortgage + ': ' + copy.downPayment + ' ' + percent(settings.downPaymentPercent, language) + ' — ' + money(estimate.downPayment, currency, language)
        + ', ' + copy.loan + ' ' + money(estimate.loan, currency, language) + ', ' + settings.years + ' ' + copy.years + ', ' + percent(settings.interestPercent, language)
        + ': ≈ ' + money(estimate.monthly, currency, language) + ' ' + copy.monthly,
    );
  }
  lines.push('💼 ' + copy.upfront + ': ≈ ' + money(estimate.upfront, currency, language), '');
  if (estimate.business) lines.push(copy.businessNote);
  lines.push(copy.disclaimer);
  return lines.filter((line, index) => line !== '' || index > 0).join('\n').replace(/\n{3,}/g, '\n\n');
}

// short — для ряда из двух кнопок под карточкой: полная подпись обрезалась («🧮 Расчёт покупки и ип…»).
function calculatorButton(record, language, short = false) {
  if (!calculatorAvailable(record)) return null;
  const copy = CALCULATOR_TEXT[language] || CALCULATOR_TEXT.ru;
  return { text: short && copy.openButtonShort ? copy.openButtonShort : copy.openButton, callback_data: 'calc:' + record.id };
}

async function handleCalculatorCallback(query, token) {
  const id = String(query.data || '').split(':').slice(1).join(':');
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  const user = normalizeUser(query.from, chatId, false);
  const language = user.preferredLanguage || 'ru';
  const record = data.objects.find((item) => item.id === id && ['active', 'reserved'].includes(item.status));
  if (!record || !propertyReadyForLanguage(record, language) || !calculatorAvailable(record)) {
    await acknowledgeCallback(query, token, (PROPERTY_ACTION_TEXT[language] || PROPERTY_ACTION_TEXT.ru).propertyUnavailable);
    return;
  }
  await acknowledgeCallback(query, token);
  recordPropertyEvent(record.id, 'calculator');
  const copy = CALCULATOR_TEXT[language] || CALCULATOR_TEXT.ru;
  // Тот, кто досчитал до конца, почти готов писать: WhatsApp рядом с «Обсудить».
  const whatsapp = whatsappRow(whatsappPropertyMessage(record, language));
  await sendUiMessage(chatId, user, estimateText(record, language), token, { reply_markup: { inline_keyboard: [
    [{ text: copy.discuss, callback_data: 'property:manager:' + record.id }],
    ...(whatsapp ? [whatsapp] : []),
    [{ text: '✕ ' + (NAVIGATION_TEXT[language] || NAVIGATION_TEXT.ru).close, callback_data: 'nav:close' }],
  ] } });
}

export {
  businessRateApplies,
  calculatorAvailable,
  calculatorButton,
  calculatorSettings,
  estimateText,
  handleCalculatorCallback,
  isNewBuild,
  monthlyPayment,
  purchaseEstimate,
};
