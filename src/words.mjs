// Поиск слова в сообщении клиента. Корни («налог», «планировк») ищутся внутри слова, а короткие слова (до трёх знаков: itp, iva, nie)
// только целиком: иначе «iva» находилось в «private», а «nie» — в «convenient».

function mentions(message, word) {
  const text = String(message || '');
  const needle = String(word || '');
  if (!needle) return false;
  if (needle.length > 3) return text.includes(needle);
  const at = (index) => (index < 0 || index >= text.length ? '' : text[index]);
  const isLetter = (char) => /[\p{L}\p{N}]/u.test(char || '');
  let from = text.indexOf(needle);
  while (from >= 0) {
    if (!isLetter(at(from - 1)) && !isLetter(at(from + needle.length))) return true;
    from = text.indexOf(needle, from + 1);
  }
  return false;
}

export { mentions };
