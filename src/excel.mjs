// Выгрузка обращений в Excel (.xlsx) без сторонних библиотек.

import zlib from 'node:zlib';
import { data } from './store.mjs';
import { userByChatId, userById } from './users.mjs';
import { INQUIRY_STATUS_LABELS, inquiryTypeLabel } from './inquiries.mjs';
import { localized } from './catalog.mjs';

// --- Excel (.xlsx) export ----------------------------------------------------
// A minimal Office Open XML workbook written by hand, so the export needs no
// npm packages. Text goes into inline-string cells, which Excel never
// evaluates as formulas, so a client message starting with "=" stays text.

function xmlText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelColumn(index) {
  let name = '';
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    name = String.fromCharCode(65 + ((number - 1) % 26)) + name;
  }
  return name;
}

// Excel stores dates as days since 1899-12-30, in local time.
function excelDate(date) {
  return (date.getTime() - date.getTimezoneOffset() * 60000) / 86400000 + 25569;
}

function xlsxSheetXml(columns, rows) {
  const cell = (value, reference, style) => {
    if (value == null || value === '') return '';
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? '<c r="' + reference + '" s="2"><v>' + excelDate(value) + '</v></c>' : '';
    }
    if (typeof value === 'number') return '<c r="' + reference + '"><v>' + value + '</v></c>';
    return '<c r="' + reference + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' + xmlText(value) + '</t></is></c>';
  };
  const header = '<row r="1">' + columns.map((column, index) => cell(column.title, excelColumn(index) + '1', 1)).join('') + '</row>';
  const body = rows.map((row, rowIndex) => '<row r="' + (rowIndex + 2) + '">'
    + row.map((value, index) => cell(value, excelColumn(index) + (rowIndex + 2), 3)).join('') + '</row>').join('');
  const lastCell = excelColumn(columns.length - 1) + (rows.length + 1);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + columns.map((column, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + column.width + '" customWidth="1"/>').join('') + '</cols>'
    + '<sheetData>' + header + body + '</sheetData>'
    + '<autoFilter ref="A1:' + lastCell + '"/>'
    + '</worksheet>';
}

function zipArchive(files) {
  const DOS_DATE_1980_01_01 = 33;
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = zlib.deflateRawSync(file.data);
    const crc = zlib.crc32(file.data) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function xlsxWorkbook(sheetName, columns, rows) {
  const xml = (text) => Buffer.from(text, 'utf8');
  return zipArchive([
    { name: '[Content_Types].xml', data: xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlText(sheetName) + '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + xmlText(sheetName) + '\'!$A$1:$' + excelColumn(columns.length - 1) + '$' + (rows.length + 1) + '</definedName></definedNames></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
    { name: 'xl/styles.xml', data: xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>') },
    { name: 'xl/worksheets/sheet1.xml', data: xml(xlsxSheetXml(columns, rows)) },
  ]);
}

const INQUIRY_EXPORT_COLUMNS = [
  { title: 'Создано', width: 17 },
  { title: 'Статус', width: 11 },
  { title: 'Тип', width: 20 },
  { title: 'Клиент', width: 22 },
  { title: 'Username', width: 18 },
  { title: 'Телефон', width: 18 },
  { title: 'Имя в заявке', width: 20 },
  { title: 'Удобное время', width: 22 },
  { title: 'Язык', width: 6 },
  { title: 'Источник', width: 14 },
  { title: 'Объект', width: 28 },
  { title: 'Текст обращения', width: 60 },
  { title: 'Заметка администратора', width: 30 },
  { title: 'Ответов', width: 9 },
  { title: 'Последний ответ', width: 40 },
  { title: 'Обновлено', width: 17 },
  { title: 'ID обращения', width: 38 },
];

function inquiryExportRows(inquiries) {
  return inquiries.map((inquiry) => {
    const user = userById(inquiry.userId) || userByChatId(inquiry.chatId) || {};
    const property = inquiry.propertyId ? data.objects.find((item) => item.id === inquiry.propertyId) : null;
    const lead = inquiry.lead || {};
    const replies = Array.isArray(inquiry.replies) ? inquiry.replies : [];
    const lastReply = replies[replies.length - 1];
    return [
      new Date(inquiry.createdAt),
      INQUIRY_STATUS_LABELS[inquiry.status] || inquiry.status,
      inquiryTypeLabel(inquiry),
      [user.firstName, user.lastName].filter(Boolean).join(' '),
      user.username ? '@' + user.username : '',
      lead.phone || user.phone || '',
      lead.name || '',
      lead.preferredTime || '',
      String(inquiry.language || '').toUpperCase(),
      user.source || '',
      property ? localized(property.title, 'ru') || property.reference || property.id : '',
      inquiry.text,
      inquiry.note || '',
      replies.length,
      lastReply ? lastReply.text : '',
      new Date(inquiry.updatedAt || inquiry.createdAt),
      inquiry.id,
    ];
  });
}

// --- Клиенты ------------------------------------------------------------------
// Одна строка — один человек: то, что менеджер хочет видеть в таблице для
// обзвона или рассылки по почте, а не переписка (она в выгрузке обращений).
const CLIENT_EXPORT_COLUMNS = [
  { title: 'Клиент', width: 24 },
  { title: 'Username', width: 18 },
  { title: 'Телефон', width: 18 },
  { title: 'Имя для связи', width: 20 },
  { title: 'Удобное время', width: 18 },
  { title: 'Язык', width: 6 },
  { title: 'Источник', width: 14 },
  { title: 'Этап работы', width: 14 },
  { title: 'Следующий шаг', width: 14 },
  { title: 'Обращений', width: 10 },
  { title: 'Последнее обращение', width: 30 },
  { title: 'Избранных объектов', width: 11 },
  { title: 'Согласие на рассылки', width: 12 },
  { title: 'Бот доступен', width: 12 },
  { title: 'Теги', width: 22 },
  { title: 'Заметка', width: 40 },
  { title: 'Первый визит', width: 17 },
  { title: 'Последняя активность', width: 17 },
  { title: 'ID клиента', width: 14 },
];

const PIPELINE_STAGE_LABELS = { new: 'Новый', contact: 'Связались', selection: 'Подбор', viewing: 'Просмотр', negotiation: 'Переговоры', won: 'Сделка', lost: 'Неактуально' };

function clientExportRows(users) {
  const byUser = new Map();
  for (const inquiry of data.inquiries) {
    const key = String(inquiry.userId || '');
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(inquiry);
  }
  const time = (value) => Date.parse(value) || 0;
  const dateOrBlank = (value) => (time(value) ? new Date(value) : '');
  return users.map((user) => {
    const inquiries = (byUser.get(String(user.id)) || []).slice().sort((a, b) => time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt));
    const current = inquiries.find((item) => item.status !== 'closed') || inquiries[0] || null;
    const lead = (current && current.lead) || {};
    return [
      [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени',
      user.username ? '@' + user.username : '',
      user.phone || lead.phone || '',
      user.contactName || lead.name || '',
      user.preferredContactTime || lead.preferredTime || '',
      String(user.preferredLanguage || '').toUpperCase(),
      user.source || '',
      current ? PIPELINE_STAGE_LABELS[current.pipelineStage] || '' : '',
      current && current.status !== 'closed' && current.followUpDate ? current.followUpDate + (current.followUpTime ? ' ' + current.followUpTime : '') : '',
      inquiries.length,
      inquiries[0] ? inquiryTypeLabel(inquiries[0]) + ', ' + (INQUIRY_STATUS_LABELS[inquiries[0].status] || inquiries[0].status) : '',
      Array.isArray(user.favorites) ? user.favorites.length : 0,
      user.newsConsentAt && !user.broadcastsOptOut ? 'да' : 'нет',
      user.blocked ? 'нет (заблокировал бота)' : 'да',
      Array.isArray(user.tags) ? user.tags.join(', ') : '',
      user.note || '',
      dateOrBlank(user.firstSeenAt),
      dateOrBlank(user.lastSeenAt),
      String(user.id),
    ];
  });
}

export {
  CLIENT_EXPORT_COLUMNS,
  INQUIRY_EXPORT_COLUMNS,
  clientExportRows,
  excelColumn,
  excelDate,
  inquiryExportRows,
  xlsxSheetXml,
  xlsxWorkbook,
  xmlText,
  zipArchive,
};
