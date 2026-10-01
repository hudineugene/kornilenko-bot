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
    const rendered = lines.map((line, lineIndex) => {
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
    });
    const html = rendered.join('\n');
    return { html, plain: plainOf(html), lines: rendered.map((item) => ({ html: item, plain: plainOf(item) })) };
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

// Сколько описания помещается в budget знаков: целые абзацы, затем целые строки следующего, а если не помещается и
// первый абзац — его начало по границе предложения. Возвращает готовые куски и признак «сократили».
function fitDescription(blocks, budget) {
  const fits = [];
  let left = budget;
  let truncated = false;
  for (const block of blocks) {
    if (block.plain.length + 2 <= left) {
      fits.push(block.html);
      left -= block.plain.length + 2;
      continue;
    }
    truncated = true;
    const lines = [];
    for (const line of block.lines) {
      if (line.plain.length + 1 > left) break;
      lines.push(line.html);
      left -= line.plain.length + 1;
    }
    if (lines.length) fits.push(lines.join('\n'));
    else if (!fits.length && left > 120) {
      const cut = block.plain.slice(0, left - 40);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
      fits.push(escapeTelegramHtml(cut.slice(0, end > 80 ? end + 1 : cut.length).trimEnd()) + '…');
    }
    break;
  }
  return { fits, truncated };
}

// options.layout: «single» (по умолчанию) — одно объявление одним постом: подпись к альбому или фото вмещает всё (до 1024
// знаков), описание — раскрывающейся цитатой, сокращённое до того, что поместилось; «split» — фото и отдельное сообщение
// с полным описанием (до 4096 знаков). Без фотографий в любом режиме — одно текстовое сообщение.
// options.reserve — сколько знаков уйдёт на подпись канала; options.source — метка источника в ссылке на бота.
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
  const layout = options.layout === 'split' ? 'split' : 'single';
  // Всё в подписи к фото: только в режиме «single» и когда фотографии есть.
  const oneCaption = layout === 'single' && images.length > 0;
  const album = images.length >= 2;

  const header = '🏡 <b>' + escapeTelegramHtml(title) + '</b>' + (subtitle ? '\n<i>' + escapeTelegramHtml(subtitle) + '</i>' : '');

  // Геолокация — одной строкой: город, район, адрес и ссылка на карту.
  const mapUrl = validHttpUrl(record.mapUrl);
  const locationLine = place || mapUrl
    ? '📍 ' + [escapeTelegramHtml(place), mapUrl ? '🗺 <a href="' + escapeTelegramHtml(mapUrl) + '">' + text.map + '</a>' : ''].filter(Boolean).join(' · ')
    : '';
  const lead = [header, price, locationLine].filter(Boolean).join('\n');

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

  const buttonUrl = propertyDeepLink(record, cleanText(options.source, 40) || 'group');
  // У альбома кнопок под сообщением не бывает: ссылка на бота — строкой в подписи. У одного фото и у текста — кнопка.
  const botLink = oneCaption && album && buttonUrl ? '🤖 <a href="' + escapeTelegramHtml(buttonUrl) + '">' + escapeTelegramHtml(text.openBot.replace(/^🤖\s*/, '')) + '</a>' : '';

  // В «split» с фотографиями название, цена и геолокация — в подписи альбома, а сообщение начинается с характеристик.
  // Без фотографий и в «single» всё идёт вместе.
  const head = layout === 'split' && images.length
    ? [factsBlock].filter(Boolean)
    : [lead, factsBlock].filter(Boolean);
  const tail = [botLink, links, tags].filter(Boolean);

  // Описание: на своём языке; нет перевода — русское, с честной пометкой, как в карточке бота.
  let description = localizedExact(record.description, lang);
  let inRussian = false;
  if (!description && lang !== 'ru') {
    description = localizedExact(record.description, 'ru');
    inRussian = Boolean(description);
  } else if (lang !== 'ru' && description && description === localizedExact(record.description, 'ru')) inRussian = true;
  const blocks = descriptionBlocks(description);
  const descriptionHeading = blocks.length ? '📝 <b>' + escapeTelegramHtml(copy.descriptionTitle) + '</b>' : '';
  const note = inRussian && copy.inRussian && blocks.length ? '<i>' + escapeTelegramHtml(copy.inRussian) + '</i>' : '';
  const truncatedNote = '<i>' + escapeTelegramHtml(text.truncated) + '</i>';

  // Сколько знаков остаётся описанию: лимит Telegram (подпись — 1024, сообщение — 4096) за вычетом всего остального и
  // подписи канала. Сначала пробуем без пометки «сокращено»; не поместилось — оставляем место и для неё.
  const limit = oneCaption ? CAPTION_LIMIT : MESSAGE_LIMIT;
  const around = [...head, descriptionHeading, ...tail, note].filter(Boolean).map((part) => plainOf(part).length + 2).reduce((sum, value) => sum + value, 0) + reserve + SAFETY;
  let { fits, truncated } = fitDescription(blocks, limit - around);
  if (truncated) ({ fits } = fitDescription(blocks, limit - around - plainOf(truncatedNote).length - 2));
  // Описание — раскрывающейся цитатой: в чате видны первые строки, остальное — по нажатию.
  const descriptionBlock = fits.length ? [descriptionHeading + '\n<blockquote expandable>' + fits.join('\n\n') + '</blockquote>'] : [];
  const body = [...head, ...descriptionBlock, note, truncated ? truncatedNote : '', ...tail].filter(Boolean).join('\n\n');
  const plainLength = plainOf(body).length;

  return {
    language: lang,
    layout,
    title,
    // «single» с фотографиями: всё в подписи, второго сообщения нет. «split»: подпись — начало, текст — продолжение.
    caption: oneCaption ? body : lead,
    text: oneCaption ? '' : body,
    plainLength,
    truncated,
    images,
    album,
    buttonText: text.openBot,
    buttonUrl,
  };
}

export { CAPTION_LIMIT, LISTING_TEXT, MESSAGE_LIMIT, buildListing, hashtag, plainOf };
