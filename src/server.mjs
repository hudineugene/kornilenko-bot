// HTTP-сервер панели.

import http from 'node:http';
import { ADMIN_ASSETS, FONT_ASSETS, LOGIN_ASSETS, PORT } from './config.mjs';
import { sendPwaAsset } from './pwa.mjs';
import { runDueBroadcasts } from './broadcasts.mjs';
import { binaryLoginAsset, hostAllowed, html, json, securityHeaders } from './admin-http.mjs';
import { handleApi } from './admin-api.mjs';
import { PANEL_HTML } from './panel/index.mjs';


const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req)) {
      securityHeaders(res);
      res.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Недопустимый адрес панели');
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/login-assets/background.webp' && req.method === 'GET') return binaryLoginAsset(req, res, LOGIN_ASSETS.background);
    if (url.pathname === '/login-assets/logo.png' && req.method === 'GET') return binaryLoginAsset(req, res, LOGIN_ASSETS.logo);
    if (url.pathname === '/admin-assets/app-icon-192.png' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.appIcon192);
    if (url.pathname === '/admin-assets/app-icon-512.png' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.appIcon512);
    if (url.pathname === '/panel-fonts/inter-latin.woff2' && req.method === 'GET') return binaryLoginAsset(req, res, FONT_ASSETS.interLatin);
    if (url.pathname === '/panel-fonts/inter-cyrillic.woff2' && req.method === 'GET') return binaryLoginAsset(req, res, FONT_ASSETS.interCyrillic);
    if (url.pathname === '/admin-assets/sidebar-logo.png' && req.method === 'GET') return binaryLoginAsset(req, res, ADMIN_ASSETS.sidebarLogo);
    if (url.pathname === '/manifest.webmanifest' && req.method === 'GET') return sendPwaAsset(res, 'manifest');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/' && req.method === 'GET') return html(res, PANEL_HTML, req);
    securityHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  } catch (error) {
    if (error.statusCode === 413) {
      res.setHeader('connection', 'close');
      if (!res.headersSent) json(res, 413, { error: error.message });
      return;
    }
    console.error('Ошибка веб-панели:', error.message);
    if (!res.headersSent) json(res, 500, { error: 'Внутренняя ошибка' });
    else res.end();
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('Порт ' + PORT + ' уже занят. Запустите с другим портом: PORT=3001 node bot.js');
  } else {
    console.error('Не удалось запустить веб-панель:', error.message);
  }
  process.exit(1);
});

const broadcastScheduleTimer = setInterval(() => {
  void runDueBroadcasts();
}, 30000);
broadcastScheduleTimer.unref();

export {
  broadcastScheduleTimer,
  server,
};
