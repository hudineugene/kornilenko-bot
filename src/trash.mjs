// «Корзина» на несколько минут: удалённые объект или акция возвращаются кнопкой
// «Вернуть» на прежнее место — со всем содержимым и фотографиями. Хранится в памяти
// бота: после перезапуска или через UNDO_WINDOW_MS вернуть уже нельзя, и тогда
// освобождаются файлы фотографий (пока отмена возможна, уборка ничейных файлов
// их не трогает).

const UNDO_WINDOW_MS = 15 * 60 * 1000;
const deleted = new Map();

function keyOf(kind, id) {
  return kind + ':' + id;
}

function purgeDeleted(now = Date.now()) {
  for (const [key, entry] of deleted) {
    if (now - entry.at > UNDO_WINDOW_MS) deleted.delete(key);
  }
}

function rememberDeleted(kind, record, index, extra = {}) {
  purgeDeleted();
  deleted.set(keyOf(kind, record.id), { kind, record, index, extra, at: Date.now() });
}

// Достаёт запись из корзины (один раз); пусто, если время отмены вышло.
function takeDeleted(kind, id) {
  purgeDeleted();
  const entry = deleted.get(keyOf(kind, id));
  if (entry) deleted.delete(keyOf(kind, id));
  return entry || null;
}

function peekDeleted(kind, id) {
  purgeDeleted();
  return deleted.get(keyOf(kind, id)) || null;
}

// Для уборки файлов: записи, которые ещё можно вернуть.
function deletedForMedia() {
  purgeDeleted();
  const root = { objects: [], promotions: [] };
  for (const entry of deleted.values()) if (root[entry.kind]) root[entry.kind].push(entry.record);
  return root;
}

function clearDeleted() {
  deleted.clear();
}

export { UNDO_WINDOW_MS, clearDeleted, deletedForMedia, peekDeleted, purgeDeleted, rememberDeleted, takeDeleted };
