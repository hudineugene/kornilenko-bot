// Проверка того, кто открыл приложение. Telegram передаёт приложению строку initData со сведениями о пользователе и подписью, которую
// можно сделать только зная токен бота (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
// Без верной подписи приложение показывает только открытый каталог и ничего не записывает.

import crypto from 'node:crypto';

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

// → { ok: true, user, authDate, startParam } или { ok: false, reason }
function validateInitData(initData, botToken, options = {}) {
  const maxAge = Number.isFinite(options.maxAgeSeconds) ? options.maxAgeSeconds : DEFAULT_MAX_AGE_SECONDS;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const raw = String(initData || '');
  if (!raw || raw.length > 8192) return { ok: false, reason: 'empty' };
  if (!botToken) return { ok: false, reason: 'no-token' };
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'no-hash' };
  const pairs = [];
  for (const [key, value] of params.entries()) if (key !== 'hash') pairs.push(key + '=' + value);
  pairs.sort();
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  const expected = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'no-date' };
  if (now / 1000 - authDate > maxAge) return { ok: false, reason: 'expired' };
  if (authDate - now / 1000 > 300) return { ok: false, reason: 'from-future' };
  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || !Number.isFinite(Number(user.id)) || Number(user.id) <= 0) return { ok: false, reason: 'no-user' };
  return {
    ok: true,
    user: {
      id: Number(user.id),
      first_name: String(user.first_name || '').slice(0, 128),
      last_name: String(user.last_name || '').slice(0, 128),
      username: String(user.username || '').slice(0, 64),
      language_code: String(user.language_code || '').slice(0, 10),
    },
    authDate,
    startParam: String(params.get('start_param') || '').slice(0, 128),
  };
}

// Для тестов и проверки вручную: собрать подписанную строку так же, как это делает Telegram.
function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(key + '=' + value);
  pairs.sort();
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex'));
  return params.toString();
}

export { signInitData, validateInitData };
