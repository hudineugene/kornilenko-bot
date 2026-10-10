// Проверка адреса перед обращением к нему с сервера: приложение должно быть в интернете, а не во внутренней сети.

import dns from 'node:dns/promises';
import net from 'node:net';

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return privateAddress(value.slice(7));
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8')
    || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
}

// true — имя не найдено или хотя бы один из его адресов внутренний.
async function resolvesToPrivateAddress(hostname) {
  try {
    const records = await dns.lookup(hostname, { all: true });
    return !records.length || records.some((record) => privateAddress(record.address));
  } catch {
    return false;
  }
}

export { privateAddress, resolvesToPrivateAddress };
