// Настройки из окружения, пути, ограничения и встроенные в exe картинки.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as sea from 'node:sea';

// The folder with bot-data.json, the images and cloudflared.exe: next to
// bot.exe for the built program, the project folder when run from source
// (bot.js sets BOT_APP_DIRECTORY before loading the modules).
const APP_DIRECTORY = globalThis.BOT_APP_DIRECTORY || (sea.isSea() ? path.dirname(process.execPath) : process.cwd());

const HOST = process.env.ADMIN_HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.BOT_DATA_FILE || path.join(APP_DIRECTORY, 'bot-data.json');
const MEDIA_DIRECTORY = process.env.BOT_MEDIA_DIRECTORY || path.join(path.dirname(DATA_FILE), 'bot-media');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_BODY_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_OUTPUT_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Extra host names the panel may be opened by (comma-separated), for example
// when ADMIN_HOST=0.0.0.0 and the computer is reached by its network name.
const ADMIN_ALLOWED_HOSTS = new Set(String(process.env.ADMIN_ALLOWED_HOSTS || '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean));

const LOGIN_ASSET_DIRECTORY = path.join(APP_DIRECTORY, 'Kornilenko_Login_Codex_Assets');
const ADMIN_ASSET_DIRECTORY = path.join(APP_DIRECTORY, 'Kornilenko_Admin_Codex_Assets');

function loadBundledAsset(assetDirectory, assetKey, fileName, mimeType) {
  let bytes = null;
  if (sea.isSea()) {
    try {
      bytes = Buffer.from(sea.getAsset(assetKey));
    } catch {
      bytes = null;
    }
  }
  if (!bytes) {
    const filePath = path.join(assetDirectory, fileName);
    if (fs.existsSync(filePath)) bytes = fs.readFileSync(filePath);
  }
  if (!bytes) return null;
  return {
    bytes,
    mimeType,
    etag: '"' + crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '"',
  };
}

const LOGIN_ASSETS = {
  background: loadBundledAsset(LOGIN_ASSET_DIRECTORY, 'login-background', 'login_background_codex_1920x1080.png', 'image/png'),
  logo: loadBundledAsset(LOGIN_ASSET_DIRECTORY, 'login-logo', 'kornilenko_logo_exact.png', 'image/png'),
};

const ADMIN_ASSETS = {
  header: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-header', 'admin_header_background_1920x480.webp', 'image/webp'),
  headerMobile: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-header-mobile', 'admin_header_background_mobile_960x480.webp', 'image/webp'),
  sidebarLogo: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-sidebar-logo', 'kornilenko_logo_sidebar_320.png', 'image/png'),
};

export {
  ADMIN_ALLOWED_HOSTS,
  ADMIN_ASSETS,
  ADMIN_ASSET_DIRECTORY,
  APP_DIRECTORY,
  DATA_FILE,
  HOST,
  LOGIN_ASSETS,
  LOGIN_ASSET_DIRECTORY,
  MAX_BACKUP_BODY_BYTES,
  MAX_BACKUP_OUTPUT_BYTES,
  MAX_BODY_BYTES,
  MAX_IMAGE_BYTES,
  MEDIA_DIRECTORY,
  PENDING_ACTION_TTL_MS,
  PORT,
  SESSION_TTL_MS,
  TELEGRAM_MESSAGE_LIMIT,
  loadBundledAsset,
};
