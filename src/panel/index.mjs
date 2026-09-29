// Сборка страницы панели: разметка каркаса, стили и один встроенный скрипт.
// Скрипт собирается из модулей разделов — порядок важен только для того,
// чтобы каркас (runtime) шёл первым.

import { PANEL_CSS } from './styles.mjs';
import { PANEL_RUNTIME_JS, PANEL_SHELL } from './runtime.mjs';
import { OVERVIEW_JS } from './view-overview.mjs';
import { INQUIRIES_JS } from './view-inquiries.mjs';
import { NOTIFICATIONS_JS } from './view-notifications.mjs';
import { CATALOG_JS } from './view-catalog.mjs';
import { TEXTS_JS } from './view-texts.mjs';
import { REACH_JS } from './view-reach.mjs';
import { SETTINGS_JS } from './view-settings.mjs';

const PANEL_SCRIPT = [
  PANEL_RUNTIME_JS,
  OVERVIEW_JS,
  INQUIRIES_JS,
  NOTIFICATIONS_JS,
  CATALOG_JS,
  TEXTS_JS,
  REACH_JS,
  SETTINGS_JS,
  'bindShell();\nboot().catch(function (error) { console.error(error); });',
].join('\n');

const PANEL_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Панель Telegram-бота</title>
<link rel="icon" href="/login-assets/logo.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#2f56d9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101828" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/admin-assets/sidebar-logo.png">
<style>${PANEL_CSS}</style>
</head>
<body>
${PANEL_SHELL}
<script>
${PANEL_SCRIPT}
</script>
</body>
</html>`;

export { PANEL_HTML };
