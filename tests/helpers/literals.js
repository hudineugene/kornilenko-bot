'use strict';

// Строковые литералы исходника без комментариев: простой разбор по знакам. Нужен сторожам, которые ищут слова в тексте,
// который видит человек, а не в комментариях и именах переменных.

// Строковые литералы исходника без комментариев: простой разбор по знакам.
function literals(code) {
  const out = [];
  let i = 0;
  let line = 1;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { const end = code.indexOf('*/', i + 2); const chunk = code.slice(i, end < 0 ? code.length : end + 2); line += (chunk.match(/\n/g) || []).length; i += chunk.length; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const start = line;
      let j = i + 1;
      let text = '';
      while (j < code.length && code[j] !== quote) {
        if (code[j] === '\\') { text += code[j] + code[j + 1]; if (code[j + 1] === '\n') line += 1; j += 2; continue; }
        if (code[j] === '\n') { line += 1; if (quote !== '`') break; }
        text += code[j];
        j += 1;
      }
      out.push({ text, line: start });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}
module.exports = { literals };
