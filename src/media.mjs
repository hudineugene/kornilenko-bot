// Хранение фотографий: файлы по SHA-256 содержимого, перенос и очистка.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_FILE, MEDIA_DIRECTORY } from './config.mjs';

function storedImageFile(image) {
  const fileName = image && typeof image.storageFile === 'string' ? image.storageFile.trim() : '';
  if (!fileName || path.basename(fileName) !== fileName || !/^[A-Za-z0-9_-]+\.(?:jpg|png)$/i.test(fileName)) return '';
  return fileName;
}

function imageStoragePath(image) {
  const fileName = storedImageFile(image);
  return fileName ? path.join(MEDIA_DIRECTORY, fileName) : '';
}

function imageExists(image) {
  if (!image || typeof image !== 'object') return false;
  if (typeof image.dataBase64 === 'string' && image.dataBase64.length > 0) return true;
  const filePath = imageStoragePath(image);
  return Boolean(filePath && fs.existsSync(filePath));
}

function imageBytes(image) {
  if (!image || typeof image !== 'object') throw new Error('Изображение не найдено');
  if (typeof image.dataBase64 === 'string' && image.dataBase64.length > 0) {
    return Buffer.from(image.dataBase64, 'base64');
  }
  const filePath = imageStoragePath(image);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Файл изображения не найден');
  return fs.readFileSync(filePath);
}

// Telegram пересобирает фотографии в JPEG и теряет прозрачность, поэтому
// такие картинки отправляются файлом. Здесь — проверка самого PNG.
function bytesHaveTransparency(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 26) return false;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return false;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  // Палитра с прозрачностью: ищем кусок tRNS в первых килобайтах файла.
  return bytes.slice(0, Math.min(bytes.length, 65536)).includes('tRNS');
}

function imageHasTransparency(image) {
  if (!image || typeof image !== 'object') return false;
  if (image.mimeType && image.mimeType !== 'image/png') return false;
  try {
    return bytesHaveTransparency(imageBytes(image));
  } catch (error) {
    return false;
  }
}

function forEachStoredImage(root, callback) {
  if (!root || typeof root !== 'object') return;
  for (const language of ['ru', 'en', 'es']) callback(root.welcomeImages && root.welcomeImages[language]);
  // Плашки рубрик лежат в настройках, а отложенные посты — своим списком:
  // без них уборка ничейных файлов удалила бы их картинки.
  const publishing = root.config && root.config.publishing;
  for (const rubric of publishing && Array.isArray(publishing.rubrics) ? publishing.rubrics : []) callback(rubric && rubric.image);
  for (const post of Array.isArray(root.groupPosts) ? root.groupPosts : []) callback(post && post.image);
  for (const record of Array.isArray(root.objects) ? root.objects : []) {
    callback(record && record.image);
    for (const image of record && Array.isArray(record.images) ? record.images : []) callback(image);
    for (const language of ['ru', 'en', 'es']) {
      for (const image of record && record.imagesByLanguage && Array.isArray(record.imagesByLanguage[language]) ? record.imagesByLanguage[language] : []) callback(image);
    }
  }
  for (const key of ['promotions', 'broadcasts']) {
    for (const record of Array.isArray(root[key]) ? root[key] : []) {
      callback(record && record.image);
      for (const image of record && Array.isArray(record.images) ? record.images : []) callback(image);
      if (key === 'promotions') {
        for (const language of ['ru', 'en', 'es']) {
          for (const image of record && record.imagesByLanguage && Array.isArray(record.imagesByLanguage[language]) ? record.imagesByLanguage[language] : []) callback(image);
        }
      }
    }
  }
}

// A copy without photos (the weekly Telegram copy) restored on another
// computer points at files that are not there. Those references are removed
// so the rest of the data can be restored; returns how many were missing.
function dropMissingImages(root) {
  if (!root || typeof root !== 'object') return 0;
  let missing = 0;
  const keep = (image) => {
    if (!image || imageExists(image)) return true;
    missing += 1;
    return false;
  };
  for (const language of ['ru', 'en', 'es']) {
    if (root.welcomeImages && root.welcomeImages[language] && !keep(root.welcomeImages[language])) root.welcomeImages[language] = null;
  }
  for (const key of ['objects', 'promotions', 'broadcasts']) {
    for (const record of Array.isArray(root[key]) ? root[key] : []) {
      if (!record || typeof record !== 'object') continue;
      if (record.image && !keep(record.image)) record.image = null;
      if (Array.isArray(record.images)) record.images = record.images.filter(keep);
      if (record.imagesByLanguage && typeof record.imagesByLanguage === 'object') {
        for (const language of ['ru', 'en', 'es']) {
          if (Array.isArray(record.imagesByLanguage[language])) record.imagesByLanguage[language] = record.imagesByLanguage[language].filter(keep);
        }
      }
    }
  }
  return missing;
}

function containsEmbeddedImages(root) {
  let found = false;
  forEachStoredImage(root, (image) => {
    if (image && typeof image.dataBase64 === 'string' && image.dataBase64.length) found = true;
  });
  return found;
}

// Files are named by the SHA-256 of their bytes, so the same photo uploaded
// for several languages (or several records) is stored on disk only once.
function contentAddressedName(bytes, mimeType) {
  return crypto.createHash('sha256').update(bytes).digest('hex') + '.' + (mimeType === 'image/png' ? 'png' : 'jpg');
}

function writeMediaFile(fileName, bytes) {
  const target = path.join(MEDIA_DIRECTORY, fileName);
  if (fs.existsSync(target)) return;
  const temporary = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.mkdirSync(MEDIA_DIRECTORY, { recursive: true });
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function persistImage(image) {
  if (!image || typeof image !== 'object' || typeof image.dataBase64 !== 'string' || !image.dataBase64.length) return;
  const bytes = Buffer.from(image.dataBase64, 'base64');
  const safeId = String(image.id || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID();
  const fileName = contentAddressedName(bytes, image.mimeType);
  writeMediaFile(fileName, bytes);
  image.id = safeId;
  image.storageFile = fileName;
  image.size = bytes.length;
  delete image.dataBase64;
}

const CONTENT_ADDRESSED_FILE = /^[0-9a-f]{64}\.(?:jpg|png)$/;

function needsContentAddressing(root) {
  let found = false;
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName && !CONTENT_ADDRESSED_FILE.test(fileName)) found = true;
  });
  return found;
}

// Moves images saved by older versions (one file per upload) to
// content-addressed names. Duplicates collapse into one file; the old files
// become unreferenced and are removed by cleanupOrphanImages.
function contentAddressImages(root) {
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (!fileName || CONTENT_ADDRESSED_FILE.test(fileName)) return;
    const source = path.join(MEDIA_DIRECTORY, fileName);
    if (!fs.existsSync(source)) return;
    const bytes = fs.readFileSync(source);
    const nextName = contentAddressedName(bytes, image.mimeType);
    writeMediaFile(nextName, bytes);
    image.storageFile = nextName;
  });
}

function externalizeImages(root) {
  forEachStoredImage(root, persistImage);
}

function referencedImageFiles(root) {
  const referenced = new Set();
  forEachStoredImage(root, (image) => {
    const fileName = storedImageFile(image);
    if (fileName) referenced.add(fileName.toLocaleLowerCase('en-US'));
  });
  return referenced;
}

function cleanupOrphanImages(root, referenced = referencedImageFiles(root)) {
  if (!fs.existsSync(MEDIA_DIRECTORY)) return;
  for (const entry of fs.readdirSync(MEDIA_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.(?:jpg|png)$/i.test(entry.name)) continue;
    if (!referenced.has(entry.name.toLocaleLowerCase('en-US'))) fs.unlinkSync(path.join(MEDIA_DIRECTORY, entry.name));
  }
}

function ensureMigrationBackup(prefix = 'pre-media-migration') {
  if (!fs.existsSync(DATA_FILE)) return '';
  const backupDirectory = path.join(path.dirname(DATA_FILE), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const existing = fs.readdirSync(backupDirectory).find((name) => name.startsWith(prefix + '-') && name.endsWith('.json'));
  if (existing) return path.join(backupDirectory, existing);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const target = path.join(backupDirectory, prefix + '-' + stamp + '.json');
  fs.copyFileSync(DATA_FILE, target, fs.constants.COPYFILE_EXCL);
  return target;
}

export {
  CONTENT_ADDRESSED_FILE,
  cleanupOrphanImages,
  containsEmbeddedImages,
  contentAddressImages,
  contentAddressedName,
  dropMissingImages,
  ensureMigrationBackup,
  externalizeImages,
  forEachStoredImage,
  imageBytes,
  imageExists,
  imageHasTransparency,
  imageStoragePath,
  needsContentAddressing,
  persistImage,
  referencedImageFiles,
  storedImageFile,
  writeMediaFile,
};
