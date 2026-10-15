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
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
// Extra host names the panel may be opened by (comma-separated), for example
// when ADMIN_HOST=0.0.0.0 and the computer is reached by its network name.
const ADMIN_ALLOWED_HOSTS = new Set(String(process.env.ADMIN_ALLOWED_HOSTS || '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean));

const LOGIN_ASSET_DIRECTORY = path.join(APP_DIRECTORY, 'Kornilenko_Login_Codex_Assets');
const ADMIN_ASSET_DIRECTORY = path.join(APP_DIRECTORY, 'Kornilenko_Admin_Codex_Assets');
const FONT_DIRECTORY = path.join(APP_DIRECTORY, 'panel-fonts');
const MINIAPP_ASSET_DIRECTORY = path.join(APP_DIRECTORY, 'miniapp-assets');

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

// Всё, что панель показывает до входа и в шапке: фон входа (WebP, 89 КБ вместо PNG 1,3 МБ), логотип целиком
// (равномерно уменьшенный, геометрия не тронута), шрифт Inter (латиница и кириллица, лицензия OFL).
const LOGIN_ASSETS = {
  background: loadBundledAsset(LOGIN_ASSET_DIRECTORY, 'login-background', 'login_background_codex_1920x1080.webp', 'image/webp'),
  logo: loadBundledAsset(LOGIN_ASSET_DIRECTORY, 'login-logo', 'kornilenko_logo_login_440.png', 'image/png'),
};

const ADMIN_ASSETS = {
  sidebarLogo: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-sidebar-logo', 'kornilenko_logo_sidebar_320.png', 'image/png'),
  appIcon192: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-app-icon-192', 'kornilenko_app_icon_192.png', 'image/png'),
  appIcon512: loadBundledAsset(ADMIN_ASSET_DIRECTORY, 'admin-app-icon-512', 'kornilenko_app_icon_512.png', 'image/png'),
};

// Графика приложения в Telegram: логотип целиком (только равномерно уменьшен, без обрезки), главное фото, рисунки для пустых
// экранов и тонкая архитектурная сетка. Фото и рисунки можно заменить файлами с теми же именами.
const MINIAPP_ASSETS = {
  logo: loadBundledAsset(MINIAPP_ASSET_DIRECTORY, 'miniapp-logo', 'logo.png', 'image/png'),
  hero: loadBundledAsset(MINIAPP_ASSET_DIRECTORY, 'miniapp-hero', 'hero.jpg', 'image/jpeg'),
  artCoastal: loadBundledAsset(MINIAPP_ASSET_DIRECTORY, 'miniapp-art-coastal', 'art-coastal.jpg', 'image/jpeg'),
  artPool: loadBundledAsset(MINIAPP_ASSET_DIRECTORY, 'miniapp-art-pool', 'art-pool.jpg', 'image/jpeg'),
  grid: loadBundledAsset(MINIAPP_ASSET_DIRECTORY, 'miniapp-grid', 'grid.svg', 'image/svg+xml'),
  // Пиктограммы пунктов «Что входит в услугу» одной полосой 112×112 на пункт (раздел «Услуги»).
  servicesIcons: loadBundledAsset(MINIAPP_ASSET_DIRECTORY, 'miniapp-services-icons', 'services-icons.png', 'image/png'),
};

const FONT_ASSETS = {
  interLatin: loadBundledAsset(FONT_DIRECTORY, 'font-inter-latin', 'inter-latin-wght-normal.woff2', 'font/woff2'),
  interCyrillic: loadBundledAsset(FONT_DIRECTORY, 'font-inter-cyrillic', 'inter-cyrillic-wght-normal.woff2', 'font/woff2'),
};

export {
  ADMIN_ALLOWED_HOSTS,
  ADMIN_ASSETS,
  ADMIN_ASSET_DIRECTORY,
  APP_DIRECTORY,
  FONT_ASSETS,
  DATA_FILE,
  HOST,
  LOGIN_ASSETS,
  LOGIN_ASSET_DIRECTORY,
  MINIAPP_ASSETS,
  MAX_BACKUP_BODY_BYTES,
  MAX_BACKUP_OUTPUT_BYTES,
  MAX_BODY_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MEDIA_DIRECTORY,
  PENDING_ACTION_TTL_MS,
  PORT,
  SESSION_TTL_MS,
  TELEGRAM_MESSAGE_LIMIT,
  loadBundledAsset,
};
