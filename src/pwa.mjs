// «Установить на экран телефона»: манифест приложения и значок-монограмма. Они
// открыты без входа — браузер запрашивает их без cookie — и не содержат ничего
// личного. Службы фоновой работы нет: панель показывает данные клиентов и без связи с
// ботом работать не должна.

import { securityHeaders } from './admin-http.mjs';
import { APP_NAME, THEME_COLOR } from './panel/brand.mjs';

const MANIFEST = {
  name: APP_NAME,
  short_name: 'Kornilenko',
  description: 'Заявки, клиенты, просмотры и объекты',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#f5f6f8',
  theme_color: THEME_COLOR,
  lang: 'ru',
  icons: [
    { src: '/admin-assets/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/admin-assets/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/admin-assets/sidebar-logo.png', sizes: '320x289', type: 'image/png', purpose: 'any' },
  ],
};

function sendPwaAsset(res, kind) {
  securityHeaders(res);
  res.setHeader('cache-control', 'public, max-age=86400');
  if (kind === 'manifest') {
    const body = JSON.stringify(MANIFEST);
    res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    return res.end(body);
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  return res.end('Не найдено');
}

export { MANIFEST, sendPwaAsset };
