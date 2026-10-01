// Мгновенные обновления панели: сервер сам говорит открытой панели «данные изменились», и она тут же спрашивает новое —
// вместо того чтобы ждать таймера (раньше новое сообщение клиента появлялось до 45 секунд). Это поток Server-Sent Events:
// обычный запрос GET, который не закрывается; сообщения в нём — только сигнал «что-то изменилось», сами данные панель
// берёт обычным запросом /api/state (он дёшев: «изменилось ли с моей версии?»). Таймер в панели остаётся запасным путём.

import { onDataChange } from './store.mjs';

const PING_MS = 25 * 1000;
const COALESCE_MS = 400;
const MAX_STREAMS = 20;

const streams = new Set();
let pending = null;

function broadcast() {
  pending = null;
  for (const stream of streams) {
    try {
      stream.res.write('event: changed\ndata: 1\n\n');
    } catch {
      closeStream(stream);
    }
  }
}

// Данные меняются очень часто (каждое сообщение, каждый показ карточки) — сигнал склеивается: не чаще раза в 400 мс и только
// пока панель вообще кто-то смотрит.
onDataChange(() => {
  if (!streams.size || pending) return;
  pending = setTimeout(broadcast, COALESCE_MS);
});

function closeStream(stream) {
  clearInterval(stream.ping);
  streams.delete(stream);
  try {
    stream.res.end();
  } catch {
    // уже закрыт
  }
}

// securityHeaders — те же заголовки безопасности, что у остальных ответов панели.
function openEventStream(req, res, securityHeaders) {
  // Больше двадцати вкладок одновременно не бывает: лишнюю старую закрываем, чтобы потоки не копились.
  while (streams.size >= MAX_STREAMS) closeStream(streams.values().next().value);
  securityHeaders(res);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const stream = { res, ping: null };
  // Пустая строка-комментарий раз в 25 секунд: без неё прокси и туннель считают соединение мёртвым и закрывают его.
  stream.ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      closeStream(stream);
    }
  }, PING_MS);
  if (stream.ping.unref) stream.ping.unref();
  streams.add(stream);
  // Закрыла вкладку или оборвалась связь: у ответа (не у запроса — запрос без тела «закрывается» сразу) приходит close.
  res.on('close', () => closeStream(stream));
  return stream;
}

function eventStreamCount() {
  return streams.size;
}

export { eventStreamCount, openEventStream };
