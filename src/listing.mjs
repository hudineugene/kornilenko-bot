// Объявление об объекте для группы или канала: пост, устроенный как карточка в боте.
//
// Первое — все фотографии объекта альбомом (до 10), под первой подпись, как у карточки каталога: название, тип и сделка,
// цена, место и строки значков («🛏 2 · 🚿 1 · 📐 60 м²»). Следом — сообщение с полной карточкой, где части разведены по
// разделам: цена и адрес; «Характеристики» отдельным блоком-цитатой (подпись — значение, значение жирным); «Описание»
// ниже — абзацы с заголовками («💳 Как купить»), списки с маркерами; в конце ссылки, хештеги, подпись канала и кнопка
// «Смотреть в боте». Сообщение в Telegram — не длиннее 4096 знаков, подпись к фото — 1024: слишком длинное описание
// сокращается по абзацам со ссылкой на полную карточку в боте.
// Здесь только сборка текста (без отправки): отправка — в groups.mjs, предпросмотр для панели — в group-api.mjs.

import { cleanText } from './util.mjs';
import { imageHasTransparency } from './media.mjs';
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

// Значок перед заголовком абзаца описания — по смыслу заголовка; нет подходящего — маркер «▸».
const LABEL_ICONS = [
  [/купить|покупк|how to buy|cómo comprar|como comprar/i, '💳'],
  [/срок|график|timeline|schedule|delivery|plazo|entrega/i, '⏳'],
  [/располож|location|ubicaci/i, '📍'],
  [/услови|оплат|terms|payment|condicion|pago/i, '📑'],
  [/доходн|yield|income|rentabilidad/i, '📈'],
  [/комплект|входит|included|equipment|equipamiento|incluye/i, '🛋'],
  [/цен|price|precio/i, '💶'],
];

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

function labelIcon(label) {
  const found = LABEL_ICONS.find(([pattern]) => pattern.test(label));
  return found ? found[1] : '▸';
}

// Описание — по абзацам. Первый — вступление, как есть. Абзац, начинающийся с короткой метки («Как купить:»), получает
// строку-заголовок с значком, текст — под ним. Маркеры списка (•, -, ✓) заменяются одним видом — «▫️».
function descriptionBlocks(description) {
  const paragraphs = String(description || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => {
    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
    const html = lines.map((line, lineIndex) => {
      const bullet = /^[-–—•*·▪✓✔✅☑🔹🔸]\s*/u.exec(line);
      const body = bullet ? line.slice(bullet[0].length) : line;
      if (bullet) return '▫️ ' + escapeTelegramHtml(body);
      // Метка — короткое слово или два перед двоеточием; «Формат — туристические апартаменты:» (с тире) — уже фраза.
      const label = index > 0 && lineIndex === 0 && !/\s[—–-]\s/.test(body.split(':')[0]) ? /^([^:\n•.!?]{3,40}):(\s|$)/u.exec(body) : null;
      if (label) {
        const rest = body.slice(label[0].length - label[2].length).trim();
        const sentence = rest ? rest.charAt(0).toLocaleUpperCase() + rest.slice(1) : '';
        return '<b>' + labelIcon(label[1]) + ' ' + escapeTelegramHtml(label[1]) + '</b>' + (sentence ? '\n' + escapeTelegramHtml(sentence) : '');
      }
      return escapeTelegramHtml(body);
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

// «🛏 Спальни: 2» → «🛏 Спальни: <b>2</b>»: подпись обычным, значение жирным — строки читаются как таблица.
function factRow(row) {
  const split = row.indexOf(': ');
  if (split < 0) return escapeTelegramHtml(row);
  return escapeTelegramHtml(row.slice(0, split + 2)) + '<b>' + escapeTelegramHtml(row.slice(split + 2)) + '</b>';
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
  // Прозрачные картинки Telegram в альбом не берёт как фото — только документом, а документ в альбом не ставится.
  const images = recordImages(record, lang).filter((image) => !imageHasTransparency(image)).slice(0, 10);

  const header = '🏡 <b>' + escapeTelegramHtml(title) + '</b>' + (subtitle ? '\n<i>' + escapeTelegramHtml(subtitle) + '</i>' : '');

  // Геолокация — одной строкой: город, район, адрес и ссылка на карту. Подпись под первой фотографией: название, тип и
  // сделка, цена и эта строка. Характеристик здесь нет — они во втором сообщении, которое ими и начинается: одна и та же
  // информация в двух сообщениях не повторяется.
  const mapUrl = validHttpUrl(record.mapUrl);
  const locationLine = place || mapUrl
    ? '📍 ' + [escapeTelegramHtml(place), mapUrl ? '🗺 <a href="' + escapeTelegramHtml(mapUrl) + '">' + text.map + '</a>' : ''].filter(Boolean).join(' · ')
    : '';
  const caption = [header, price, locationLine].filter(Boolean).join('\n');

  // Характеристики — отдельным блоком-цитатой с заголовком.
  const facts = propertySpecRows(record, lang, { compact: false });
  const condition = (PROPERTY_CONDITION_LABELS[lang] || PROPERTY_CONDITION_LABELS.ru)[record.condition];
  if (condition) facts.push('🛠 ' + copy.conditionLabel + ': ' + condition);
  if (record.reference) facts.push('🏷 ' + copy.reference + ' ' + cleanText(record.reference, 80));
  const factsBlock = facts.length ? '🧾 <b>' + escapeTelegramHtml(copy.specificationsTitle) + '</b>\n<blockquote>' + facts.map(factRow).join('\n') + '</blockquote>' : '';

  const videoUrl = validHttpUrl(record.videoUrl);
  const siteUrl = validHttpUrl(record.url);
  const links = [
    videoUrl ? '🎥 <a href="' + escapeTelegramHtml(videoUrl) + '">' + escapeTelegramHtml(copy.videoTour || text.video) + '</a>' : '',
    siteUrl ? '🌐 <a href="' + escapeTelegramHtml(siteUrl) + '">' + text.website + '</a>' : '',
  ].filter(Boolean).join('  ·  ');

  const tags = [hashtag(text.tagDeal[record.dealType === 'rent' ? 'rent' : 'sale']), hashtag(type.toLowerCase()), hashtag(city), hashtag(district)]
    .filter(Boolean).filter((tag, index, all) => all.indexOf(tag) === index).join(' ');

  // С фотографиями название, цена и геолокация — в подписи альбома, и сообщение начинается с характеристик. Без фотографий
  // альбома нет, и всё идёт одним сообщением: название, цена, геолокация, характеристики.
  const head = images.length
    ? [factsBlock].filter(Boolean)
    : [header, [price, locationLine].filter(Boolean).join('\n'), factsBlock].filter(Boolean);
  const tail = [links, tags].filter(Boolean);

  // Описание: на своём языке; нет перевода — русское, с честной пометкой, как в карточке бота.
  let description = localizedExact(record.description, lang);
  let inRussian = false;
  if (!description && lang !== 'ru') {
    description = localizedExact(record.description, 'ru');
    inRussian = Boolean(description);
  } else if (lang !== 'ru' && description && description === localizedExact(record.description, 'ru')) inRussian = true;
  const blocks = descriptionBlocks(description);
  const descriptionHeading = blocks.length ? '📝 <b>' + escapeTelegramHtml(copy.descriptionTitle) + '</b>' : '';
  const note = inRussian && copy.inRussian && blocks.length ? [{ html: '<i>' + escapeTelegramHtml(copy.inRussian) + '</i>', plain: copy.inRussian }] : [];

  // Сколько знаков остаётся описанию: всё сообщение — не больше лимита Telegram, за вычетом шапки, хвоста и подписи.
  const fixed = [...head, descriptionHeading, ...tail, ...note.map((item) => item.html)].filter(Boolean).map((part) => plainOf(part).length + 2).reduce((sum, value) => sum + value, 0) + reserve + SAFETY;
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
  const descriptionBlock = fits.length ? [descriptionHeading + '\n' + fits.join('\n\n')] : [];
  const body = [...head, ...descriptionBlock, ...note.map((item) => item.html), truncated ? truncatedNote : '', ...tail].filter(Boolean).join('\n\n');
  const plainLength = plainOf(body).length;

  const sourceLabel = cleanText(options.source, 40) || 'group';
  return {
    language: lang,
    title,
    caption,
    text: body,
    plainLength,
    truncated,
    images,
    buttonText: text.openBot,
    buttonUrl: propertyDeepLink(record, sourceLabel),
  };
}

export { CAPTION_LIMIT, LISTING_TEXT, MESSAGE_LIMIT, buildListing, hashtag, plainOf };
