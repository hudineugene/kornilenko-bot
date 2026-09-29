// «Установить на экран телефона»: манифест приложения и значок-монограмма. Они
// открыты без входа — браузер запрашивает их без cookie — и не содержат ничего
// личного. Службы фоновой работы нет: панель показывает данные клиентов и без связи с
// ботом работать не должна.

import { securityHeaders } from './admin-http.mjs';

const MANIFEST = {
  name: 'Панель Telegram-бота',
  short_name: 'Панель',
  description: 'Заявки, клиенты, просмотры и объекты',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#f5f6f8',
  theme_color: '#2f56d9',
  lang: 'ru',
  icons: [
    { src: '/admin-assets/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/admin-assets/sidebar-logo.png', sizes: '320x289', type: 'image/png', purpose: 'any' },
  ],
};

const APP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#2f56d9"/><path d="M168 132v248M168 256l150-124M198 236l130 144" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function sendPwaAsset(res, kind) {
  securityHeaders(res);
  res.setHeader('cache-control', 'public, max-age=86400');
  if (kind === 'manifest') {
    const body = JSON.stringify(MANIFEST);
    res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    return res.end(body);
  }
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-length': Buffer.byteLength(APP_ICON_SVG) });
  return res.end(APP_ICON_SVG);
}

export { APP_ICON_SVG, MANIFEST, sendPwaAsset };
