// Откуда пришёл клиент: человеческое название метки источника.
//
// Ссылка «Смотреть в боте» из поста в группе несёт метку «g3» (группа №3) или «g3t47» (раздел 47 в ней). Метка короткая —
// после кода объекта в ссылке Telegram остаётся 13 знаков. Номер группы (sourceCode) выдаётся один раз и больше не
// меняется, поэтому старые ссылки не теряются. Остальные метки (instagram, звонок…) — как их написали.

import { data } from './store.mjs';

const GROUP_SOURCE = /^g(\d+)(?:t(\d+))?$/;

function sourceTitle(label) {
  const match = GROUP_SOURCE.exec(String(label || ''));
  if (!match) return '';
  const group = (Array.isArray(data.groups) ? data.groups : []).find((item) => item.sourceCode === match[1]);
  if (!group) return '';
  const name = group.title || 'группа';
  if (!match[2]) return name;
  const topic = (Array.isArray(group.topics) ? group.topics : []).find((item) => item.id === Number(match[2]));
  return name + ' · ' + ((topic && topic.name) || 'раздел №' + match[2]);
}

// То, что показываем человеку: название группы или сама метка.
function sourceDisplay(label) {
  return sourceTitle(label) || String(label || '');
}

export { sourceDisplay, sourceTitle };
