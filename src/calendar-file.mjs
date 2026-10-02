// Файл календаря (.ics) для подтверждённого просмотра: клиент добавляет встречу
// в свой календарь одним касанием, менеджер — в свой. Чистая сборка текста файла,
// без обращения к данным бота: что писать в поля, решает вызывающий.

const LINE_LIMIT = 75; // октетов в строке по RFC 5545, остальное переносится

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// Длинную строку по правилам формата режем на части, продолжение начинается с
// пробела. Режем по октетам UTF-8, но не посреди символа.
function foldLine(line) {
  const parts = [];
  let current = '';
  let size = 0;
  let limit = LINE_LIMIT;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, 'utf8');
    if (size + bytes > limit) {
      parts.push(current);
      current = ' ';
      size = 1;
      limit = LINE_LIMIT;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n');
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// fields: uid, sequence, start (Date), minutes, summary, location, description,
// url, alarmMinutes (за сколько минут напомнить; 0 — без напоминания).
function buildIcs(fields) {
  const start = fields.start instanceof Date ? fields.start : new Date(fields.start);
  if (Number.isNaN(start.getTime())) throw new Error('Некорректное время начала встречи');
  const end = new Date(start.getTime() + (Number(fields.minutes) || 60) * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Construcciones Kornilenko//Bot//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + escapeText(fields.uid),
    'DTSTAMP:' + utcStamp(fields.stamp || new Date()),
    // Перенос просмотра выходит с тем же UID и большим номером: календарь
    // обновляет прежнюю встречу, а не заводит вторую.
    'SEQUENCE:' + Math.max(0, Math.floor(Number(fields.sequence) || 0)),
    'DTSTART:' + utcStamp(start),
    'DTEND:' + utcStamp(end),
    'SUMMARY:' + escapeText(fields.summary),
  ];
  if (fields.location) lines.push('LOCATION:' + escapeText(fields.location));
  if (fields.description) lines.push('DESCRIPTION:' + escapeText(fields.description));
  if (fields.url) lines.push('URL:' + String(fields.url).replace(/[\r\n]/g, ''));
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  if (Number(fields.alarmMinutes) > 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escapeText(fields.summary), 'TRIGGER:-PT' + Math.floor(Number(fields.alarmMinutes)) + 'M', 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export { buildIcs, escapeText, foldLine };
