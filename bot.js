#!/usr/bin/env node
'use strict';

/**
 * Telegram bot + web admin panel for Construcciones Kornilenko.
 * The code lives in src/ as ES modules; this file runs them from source.
 * bot.exe is built from the same modules as one file (npm run build).
 * Requirements: Node.js 22.12+. Start: node bot.js   Tests: npm test
 */

// Where bot-data.json, the images and cloudflared.exe are looked for.
globalThis.BOT_APP_DIRECTORY = __dirname;
module.exports = require('./src/main.mjs');
