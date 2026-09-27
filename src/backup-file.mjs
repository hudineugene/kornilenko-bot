// Формат файла резервной копии панели.
//
// Раньше копия была одним JSON, внутри которого лежали все фотографии в виде
// base64. Это плохо вдвойне: base64 добавляет треть к весу (52 МБ фотографий →
// 70 МБ текста), а чтобы собрать такой файл, бот держал в памяти сразу и копию
// данных со вставленными снимками, и строку JSON, и её байты — под три сотни
// мегабайт на ровном месте. То же самое при восстановлении.
//
// Теперь копия — простой контейнер: сначала сжатые данные, следом фотографии
// как есть, каждая со своим заголовком. Файл собирается и разбирается по
// одному снимку за раз, а сами снимки (JPEG и PNG) уже сжаты, поэтому ничего
// не теряется в весе.
//
// Формат:
//   "KORNILENKO-BACKUP-2\n"                     — метка, 20 байт
//   для каждой записи:
//     4 байта  — длина заголовка (big-endian)
//     заголовок JSON: {"kind":"data"|"media","name":"…","size":N}
//     N байт   — содержимое записи
//
// Старые копии (.json.gz, .json и зашифрованные .kbk) читаются как раньше.

import zlib from 'node:zlib';
import { cleanText } from './util.mjs';

const BACKUP_MAGIC = Buffer.from('KORNILENKO-BACKUP-2\n', 'utf8');
const MAX_HEADER_BYTES = 4096;

function isContainerBackup(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length > BACKUP_MAGIC.length && bytes.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC);
}

function backupRecord(header, payload) {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length, 0);
  return [length, headerBytes, payload];
}

// Кусочки файла по порядку: метка, данные, затем фотографии по одной.
// Вызывающий пишет их в ответ или в файл, не собирая всё в памяти.
function* backupChunks(payload, mediaFiles) {
  yield BACKUP_MAGIC;
  const data = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 6 });
  yield* backupRecord({ kind: 'data', size: data.length }, data);
  for (const file of mediaFiles) {
    const bytes = file.read();
    if (!bytes || !bytes.length) continue;
    yield* backupRecord({ kind: 'media', name: file.name, size: bytes.length }, bytes);
  }
}

// Разбор контейнера: данные разворачиваются сразу, фотографии отдаются по
// одной, чтобы вызывающий записал их на диск и забыл.
function readBackupContainer(bytes) {
  if (!isContainerBackup(bytes)) throw new Error('Это не файл резервной копии');
  let offset = BACKUP_MAGIC.length;
  let payload = null;
  const media = [];
  while (offset + 4 <= bytes.length) {
    const headerLength = bytes.readUInt32BE(offset);
    offset += 4;
    if (!headerLength || headerLength > MAX_HEADER_BYTES || offset + headerLength > bytes.length) {
      throw new Error('Файл резервной копии повреждён');
    }
    let header;
    try {
      header = JSON.parse(bytes.subarray(offset, offset + headerLength).toString('utf8'));
    } catch {
      throw new Error('Файл резервной копии повреждён');
    }
    offset += headerLength;
    const size = Number(header && header.size) || 0;
    if (size < 0 || offset + size > bytes.length) throw new Error('Файл резервной копии обрывается');
    const content = bytes.subarray(offset, offset + size);
    offset += size;
    if (header.kind === 'data') {
      try {
        payload = JSON.parse(zlib.gunzipSync(content).toString('utf8'));
      } catch {
        throw new Error('Не удалось прочитать данные из резервной копии');
      }
    } else if (header.kind === 'media') {
      const name = cleanText(header.name, 120);
      if (name) media.push({ name, bytes: content });
    }
  }
  if (!payload || typeof payload !== 'object') throw new Error('В резервной копии нет данных');
  return { payload, media };
}

export {
  BACKUP_MAGIC,
  backupChunks,
  isContainerBackup,
  readBackupContainer,
};
