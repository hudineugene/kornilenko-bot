// Объявление об объекте для группы или канала: красиво оформленный пост с полным описанием.
//
// Пост — это альбом из фотографий объекта (под первой — короткая подпись: название, цена, место) и следом сообщение
// с полным текстом: цена, место, характеристики цитатой, описание с выделенными заголовками, ссылки, хештеги и кнопка
// «Смотреть в боте». Сообщения в Telegram не длиннее 4096 знаков, а подпись к фотографии — 1024, поэтому полный текст
// идёт отдельным сообщением, а слишком длинное описание сокращается по абзацам со ссылкой на полную карточку в боте.
// Здесь только сборка текста (без отправки): отправка — в groups.mjs, предпросмотр для панели — в group-api.mjs.

import { cleanText } from './util.mjs';
import { PROPERTY_ACTION_TEXT, PROPERTY_BADGE_LABELS, PROPERTY_CONDITION_LABELS, PROPERTY_TYPE_LABELS } from './texts.mjs';
import {
  escapeTelegramHtml,
  localizedExact,
  locationText,
  objectPriceLine,
  objectPriceText,
  priceDropVisible,
  propertyDeepLink,
  propertySpecRows,
  recordImages,
  validHttpUrl,
} from './catalog.mjs';

const MESSAGE_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
// Запас на то, что Telegram считает иначе, чем мы (пробелы по краям, переносы).
const SAFETY = 40;

const LISTING_TEXT = {
  ru: { openBot: '🤖 Смотреть в боте', map: 'Карта', video: 'Видео', website: 'Сайт', truncated: 'Описание сокращено — полностью и с фото в боте ↓', tagDeal: { sale: 'продажа', rent: 'аренда' } },
  en: { openBot: '🤖 View in the bot', map: 'Map', video: 'Video', website: 'Website', truncated: 'Description shortened — see the full listing with photos in the bot ↓', tagDeal: { sale: 'forsale', rent: 'forrent' } },
  es: { openBot: '🤖 Ver en el bot', map: 'Mapa', video: 'Vídeo', website: 'Web', truncated: 'Descripción abreviada: ficha completa con fotos en el bot ↓', tagDeal: { sale: 'venta', rent: 'alquiler' } },
};

function textOf(language) {
  return LISTING_TEXT[language] || LISTING_TEXT.ru;
}

// Текст без тегов — по нему считается длина сообщения.
function plainOf(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Хештег из слов: только буквы и цифры, пробелы и дефисы склеиваются («El Muscaret» → #ElMuscaret).
function hashtag(value) {
  const word = String(value || '').replace(/[^\p{L}\p{N}]+/gu, '');
  return word.length >= 3 && word.length <= 40 ? '#' + word : '';
}

// «Как купить:» в начале абзаца — жирным; остальное как написано. Маркеры списка остаются на месте.
function descriptionBlocks(description) {
  const paragraphs = String(description || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => {
    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
    const html = lines.map((line, lineIndex) => {
      const bullet = /^[-–—•*·▪✓✔✅☑🔹🔸]\s*/u.exec(line);
      const body = bullet ? line.slice(bullet[0].length) : line;
      const escaped = escapeTelegramHtml(body);
      if (bullet) return '• ' + escaped;
      // Первый абзац — вступление, его не выделяем; заголовок-метку («Расположение:») выделяем у остальных.
      // Метка — короткое слово или два перед двоеточием; «Формат — туристические апартаменты:» (с тире) — уже фраза, не метка.
      const label = index > 0 && lineIndex === 0 && !/\s[—–-]\s/.test(body.split(':')[0]) ? /^([^:\n•.!?]{3,40}):(\s|$)/u.exec(body) : null;
      if (label) return '<b>' + escapeTelegramHtml(label[1]) + ':</b>' + escapeTelegramHtml(body.slice(label[0].length - label[2].length));
      return escaped;
    }).join('\n');
    return { html, plain: plainOf(html) };
  });
}

function priceLines(record, language) {
  const price = objectPriceLine(record, language);
  if (!price) return '';
  if (priceDropVisible(record)) {
    const previous = escapeTelegramHtml(objectPriceText({ ...record, priceValue: record.previousPriceValue }, language));
    return '💶 <s>' + previous + '</s> → <b>' + escapeTelegramHtml(price) + '</b>';
  }
  return '💶 <b>' + escapeTelegramHtml(price) + '</b>';
}

// options.reserve — сколько знаков уйдёт на подпись канала под текстом; options.source — метка источника в ссылке на бота.
function buildListing(record, language, options = {}) {
  const lang = ['ru', 'en', 'es'].includes(language) ? language : 'ru';
  const copy = PROPERTY_ACTION_TEXT[lang] || PROPERTY_ACTION_TEXT.ru;
  const text = textOf(lang);
  const reserve = Math.max(0, Number(options.reserve) || 0);
  const title = localizedExact(record.title, lang) || localizedExact(record.title, 'ru') || cleanText(record.reference, 80);
  const type = (PROPERTY_TYPE_LABELS[lang] || PROPERTY_TYPE_LABELS.ru)[record.propertyType] || '';
  const deal = record.dealType === 'rent' ? copy.forRent : copy.forSale;
  const badges = (Array.isArray(record.badges) ? record.badges : []).map((badge) => (PROPERTY_BADGE_LABELS[lang] || PROPERTY_BADGE_LABELS.ru)[badge]).filter(Boolean);
  const status = record.status === 'reserved' ? '🟡 ' + copy.reserved : '';
  const city = localizedExact(record.city, lang, 160);
  const district = localizedExact(record.district, lang, 160);
  const address = localizedExact(record.address, lang);
  const subtitle = [status, type, deal, badges.length ? '✦ ' + badges.join(' · ') : ''].filter(Boolean).join(' · ');
  const place = locationText([city, district], address);
  const price = priceLines(record, lang);

  // Подпись под первой фотографией: название, цена, место — то, ради чего человек остановится.
  const captionLines = [
    '🏡 <b>' + escapeTelegramHtml(title) + '</b>',
    subtitle ? '<i>' + escapeTelegramHtml(subtitle) + '</i>' : '',
    price,
    [city, district].filter(Boolean).length ? '📍 ' + escapeTelegramHtml([city, district].filter(Boolean).join(', ')) : '',
  ].filter(Boolean);
  const caption = captionLines.join('\n');

  // Характеристики — цитатой: так они отделены от описания и читаются как таблица.
  const facts = propertySpecRows(record, lang, { compact: false });
  const condition = (PROPERTY_CONDITION_LABELS[lang] || PROPERTY_CONDITION_LABELS.ru)[record.condition];
  if (condition) facts.push('🛠 ' + copy.conditionLabel + ': ' + condition);
  if (record.reference) facts.push('🏷 ' + copy.reference + ' ' + cleanText(record.reference, 80));
  const factsBlock = facts.length ? '<blockquote>' + facts.map(escapeTelegramHtml).join('\n') + '</blockquote>' : '';

  const mapUrl = validHttpUrl(record.mapUrl);
  const videoUrl = validHttpUrl(record.videoUrl);
  const siteUrl = validHttpUrl(record.url);
  const links = [
    mapUrl ? '🗺 <a href="' + escapeTelegramHtml(mapUrl) + '">' + text.map + '</a>' : '',
    videoUrl ? '🎥 <a href="' + escapeTelegramHtml(videoUrl) + '">' + escapeTelegramHtml(copy.videoTour || text.video) + '</a>' : '',
    siteUrl ? '🌐 <a href="' + escapeTelegramHtml(siteUrl) + '">' + text.website + '</a>' : '',
  ].filter(Boolean).join('  ·  ');

  const tags = [hashtag(text.tagDeal[record.dealType === 'rent' ? 'rent' : 'sale']), hashtag(type.toLowerCase()), hashtag(city), hashtag(district)]
    .filter(Boolean).filter((tag, index, all) => all.indexOf(tag) === index).join(' ');

  const header = '🏡 <b>' + escapeTelegramHtml(title) + '</b>' + (subtitle ? '\n<i>' + escapeTelegramHtml(subtitle) + '</i>' : '');
  const placeLines = [price, place ? '📍 ' + escapeTelegramHtml(place) : ''].filter(Boolean).join('\n');
  const head = [header, placeLines, factsBlock].filter(Boolean);
  const tail = [links, tags].filter(Boolean);

  // Описание: на своём языке; нет перевода — русское, с честной пометкой, как в карточке бота.
  let description = localizedExact(record.description, lang);
  let inRussian = false;
  if (!description && lang !== 'ru') {
    description = localizedExact(record.description, 'ru');
    inRussian = Boolean(description);
  } else if (lang !== 'ru' && description && description === localizedExact(record.description, 'ru')) inRussian = true;
  const blocks = descriptionBlocks(description);
  const note = inRussian && copy.inRussian ? [{ html: '<i>' + escapeTelegramHtml(copy.inRussian) + '</i>', plain: copy.inRussian }] : [];

  // Сколько знаков остаётся описанию: всё сообщение — не больше лимита Telegram, за вычетом шапки, хвоста и подписи.
  const fixed = [...head, ...tail, ...note.map((item) => item.html)].map((part) => plainOf(part).length + 2).reduce((sum, value) => sum + value, 0) + reserve + SAFETY;
  const truncatedNote = '<i>' + escapeTelegramHtml(text.truncated) + '</i>';
  let budget = MESSAGE_LIMIT - fixed;
  const fits = [];
  let truncated = false;
  for (const block of blocks) {
    if (block.plain.length + 2 <= budget) {
      fits.push(block.html);
      budget -= block.plain.length + 2;
      continue;
    }
    truncated = true;
    // Первый абзац важнее всего: если и он не помещается, режем его по предложению.
    if (!fits.length && budget > 120) {
      const cut = block.plain.slice(0, budget - 40);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
      fits.push(escapeTelegramHtml(cut.slice(0, end > 80 ? end + 1 : cut.length).trimEnd()) + '…');
    }
    break;
  }
  const body = [...head, fits.join('\n\n'), ...note.map((item) => item.html), truncated ? truncatedNote : '', ...tail].filter(Boolean).join('\n\n');
  const plainLength = plainOf(body).length;

  const sourceLabel = cleanText(options.source, 40) || 'group';
  return {
    language: lang,
    title,
    caption,
    text: body,
    plainLength,
    truncated,
    images: recordImages(record, lang),
    buttonText: text.openBot,
    buttonUrl: propertyDeepLink(record, sourceLabel),
  };
}

export { CAPTION_LIMIT, LISTING_TEXT, MESSAGE_LIMIT, buildListing, hashtag, plainOf };
