// Маленький настоящий DOM для аудита: терпеливый разбор HTML с учётом аномалий, селекторы, события.
// Не jsdom: только то, чем пользуется панель. Главное отличие от заглушки в тестах проекта —
// querySelector действительно ищет, а не «всегда находит».

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'col', 'wbr']);
const OPTIONAL_END = new Set(['li', 'p', 'option', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'dt', 'dd']);
const BLOCK = new Set(['div', 'p', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'section', 'article', 'aside', 'header', 'footer', 'details', 'form', 'nav', 'main', 'dialog', 'hr']);
const PHRASING_PARENTS = new Set(['span', 'b', 'i', 'small', 'a', 'label', 'button', 'p', 'h1', 'h2', 'h3', 'h4', 'summary', 'time', 'code']);

export const anomalies = [];
export const context = { label: '(startup)' };
function note(kind, html, at, extra) {
  anomalies.push({ kind, label: context.label, snippet: html.slice(Math.max(0, at - 70), at + 90).replace(/\s+/g, ' '), extra: extra || '' });
}

function decode(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[code] ?? m;
  });
}
function encodeText(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function encodeAttr(text) { return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

export class TextNode {
  constructor(value, doc) { this.nodeType = 3; this.nodeValue = value; this.parentNode = null; this.ownerDocument = doc; this.nodeName = '#text'; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
  get parentElement() { return this.parentNode; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get isConnected() { return this.parentNode ? this.parentNode.isConnected : false; }
}

// --- селекторы ---------------------------------------------------------------
function parseCompound(text) {
  const c = { tag: '', id: '', classes: [], attrs: [] };
  let i = 0;
  const m = /^[a-zA-Z*][\w-]*/.exec(text);
  if (m) { c.tag = m[0].toLowerCase(); i = m[0].length; }
  while (i < text.length) {
    const ch = text[i];
    if (ch === '#') { const mm = /^#([\w-]+)/.exec(text.slice(i)); c.id = mm[1]; i += mm[0].length; }
    else if (ch === '.') { const mm = /^\.([\w-]+)/.exec(text.slice(i)); c.classes.push(mm[1]); i += mm[0].length; }
    else if (ch === '[') {
      const end = (() => { let q = '', j = i + 1; for (; j < text.length; j++) { const x = text[j]; if (q) { if (x === q) q = ''; } else if (x === '"' || x === "'") q = x; else if (x === ']') return j; } return -1; })();
      if (end < 0) throw new Error('bad selector: ' + text);
      const body = text.slice(i + 1, end);
      const mm = /^([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/.exec(body);
      if (!mm) throw new Error('bad attribute selector: ' + text);
      c.attrs.push({ name: mm[1], op: mm[2] || '', value: mm[3] ?? mm[4] ?? mm[5] ?? '' });
      i = end + 1;
    } else throw new Error('unsupported selector: ' + text);
  }
  return c;
}
function parseSelector(selector) {
  const out = [];
  // делим по запятым вне скобок и кавычек
  let depth = 0, q = '', start = 0; const parts = [];
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch; else if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === ',' && !depth) { parts.push(selector.slice(start, i)); start = i + 1; }
  }
  parts.push(selector.slice(start));
  for (const part of parts) {
    const tokens = [];
    let buf = '', comb = ' '; depth = 0; q = '';
    const flush = () => { if (buf) { tokens.push({ comb, compound: parseCompound(buf) }); buf = ''; comb = ' '; } };
    const s = part.trim();
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { buf += ch; if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
      if (ch === '[') depth++; if (ch === ']') depth--;
      if (!depth && (ch === ' ' || ch === '>')) { flush(); if (ch === '>') comb = '>'; continue; }
      buf += ch;
    }
    flush();
    if (!tokens.length) throw new Error('empty selector: ' + selector);
    out.push(tokens);
  }
  return out;
}
function matchCompound(el, c) {
  if (c.tag && c.tag !== '*' && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    const v = el.getAttribute(a.name);
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
  }
  return true;
}
function matchComplex(el, tokens, index = tokens.length - 1) {
  if (!matchCompound(el, tokens[index].compound)) return false;
  if (index === 0) return true;
  const comb = tokens[index].comb;
  let parent = el.parentNode;
  if (comb === '>') return Boolean(parent && parent.nodeType === 1 && matchComplex(parent, tokens, index - 1));
  while (parent && parent.nodeType === 1) { if (matchComplex(parent, tokens, index - 1)) return true; parent = parent.parentNode; }
  return false;
}
const selectorCache = new Map();
function matches(el, selector) {
  let parsed = selectorCache.get(selector);
  if (!parsed) { parsed = parseSelector(selector); selectorCache.set(selector, parsed); }
  return parsed.some((tokens) => matchComplex(el, tokens));
}

// --- разбор HTML ---------------------------------------------------------------
export function parseInto(parent, html, doc) {
  html = String(html);
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  const appendText = (text) => { if (text) top().appendChild(new TextNode(decode(text), doc)); };
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { appendText(html.slice(i)); break; }
    if (lt > i) appendText(html.slice(i, lt));
    i = lt;
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i); i = end < 0 ? n : end + 3; continue; }
    if (html[i + 1] === '/') {
      const end = html.indexOf('>', i);
      if (end < 0) { note('конец строки внутри закрывающего тега', html, i); break; }
      const name = html.slice(i + 2, end).trim().toLowerCase();
      i = end + 1;
      let at = -1;
      for (let s = stack.length - 1; s > 0; s--) if (stack[s].localName === name) { at = s; break; }
      if (at < 0) { note('лишний закрывающий тег </' + name + '>', html, lt); continue; }
      for (let s = stack.length - 1; s > at; s--) {
        if (!OPTIONAL_END.has(stack[s].localName)) note('</' + name + '> закрывает незакрытый <' + stack[s].localName + '>', html, lt);
      }
      stack.length = at;
      continue;
    }
    if (!/[a-zA-Z]/.test(html[i + 1] || '')) { note('одинокий знак <', html, i); appendText('<'); i += 1; continue; }
    // открывающий тег
    let j = i + 1;
    while (j < n && /[\w-]/.test(html[j])) j++;
    const name = html.slice(i + 1, j).toLowerCase();
    const el = new Element(name, doc);
    let closed = false, selfClosing = false;
    while (j < n) {
      while (j < n && /\s/.test(html[j])) j++;
      if (j >= n) break;
      if (html[j] === '>') { j++; closed = true; break; }
      if (html[j] === '/' && html[j + 1] === '>') { j += 2; closed = true; selfClosing = true; break; }
      if (html[j] === '/') { j++; continue; }
      const nameStart = j;
      while (j < n && !/[\s=>]/.test(html[j]) && !(html[j] === '/' && html[j + 1] === '>')) j++;
      const attr = html.slice(nameStart, j);
      if (/["'<`]/.test(attr)) note('кавычка или < в имени атрибута: ' + JSON.stringify(attr), html, nameStart, '<' + name + '>');
      let k = j;
      while (k < n && /\s/.test(html[k])) k++;
      let value = '';
      if (html[k] === '=') {
        k++;
        while (k < n && /\s/.test(html[k])) k++;
        const quote = html[k];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, k + 1);
          if (end < 0) { note('незакрытая кавычка в значении атрибута ' + attr, html, k, '<' + name + '>'); value = html.slice(k + 1); j = n; }
          else {
            value = html.slice(k + 1, end);
            j = end + 1;
            if (j < n && !/[\s>\/]/.test(html[j])) note('после значения атрибута ' + attr + ' нет пробела', html, j, '<' + name + '>');
          }
        } else {
          const valueStart = k;
          while (k < n && !/[\s>]/.test(html[k])) k++;
          value = html.slice(valueStart, k);
          if (/["'<=`]/.test(value)) note('кавычка в значении без кавычек: ' + attr + '=' + value, html, valueStart, '<' + name + '>');
          j = k;
        }
      }
      const key = attr.toLowerCase();
      if (!key) { j++; continue; }
      if (el.attrs.has(key)) note('атрибут ' + key + ' указан дважды', html, nameStart, '<' + name + '>');
      else el.attrs.set(key, decode(value));
    }
    if (!closed) { note('тег <' + name + '> не закрыт знаком >', html, i); }
    i = j;
    // неявные закрытия
    const openName = top().localName;
    if (name === 'option' && openName === 'option') stack.pop();
    if ((name === 'td' || name === 'th') && (openName === 'td' || openName === 'th')) stack.pop();
    if (name === 'tr') { while (['td', 'th', 'tr'].includes(top().localName)) stack.pop(); }
    if (name === 'tbody' && ['thead', 'tbody'].includes(top().localName)) stack.pop();
    if (name === 'li' && openName === 'li') stack.pop();
    if (BLOCK.has(name) && top().localName === 'p') { note('<' + name + '> внутри <p>: браузер закроет <p> раньше', html, lt); stack.pop(); }
    // вложенность, которую браузер перестраивает
    for (let s = stack.length - 1; s > 0; s--) {
      const ancestor = stack[s].localName;
      if (name === 'button' && ancestor === 'button') { note('<button> внутри <button>', html, lt); break; }
      if (name === 'a' && ancestor === 'a') { note('<a> внутри <a>', html, lt); break; }
      if (name === 'label' && ancestor === 'label') { note('<label> внутри <label>', html, lt); break; }
      if (name === 'form' && ancestor === 'form') { note('<form> внутри <form>', html, lt); break; }
    }
    if (BLOCK.has(name) && PHRASING_PARENTS.has(top().localName) && top() !== parent) el._blockInInline = top().localName;
    top().appendChild(el);
    if (VOID.has(name) || selfClosing) continue;
    if (name === 'textarea' || name === 'title') {
      const endTag = html.toLowerCase().indexOf('</' + name, i);
      const raw = endTag < 0 ? html.slice(i) : html.slice(i, endTag);
      if (endTag < 0) note('<' + name + '> без закрывающего тега', html, i);
      if (raw) el.appendChild(new TextNode(decode(raw.replace(/^\n/, '')), doc));
      i = endTag < 0 ? n : html.indexOf('>', endTag) + 1;
      continue;
    }
    stack.push(el);
  }
  for (let s = stack.length - 1; s > 0; s--) {
    if (!OPTIONAL_END.has(stack[s].localName)) note('не закрыт <' + stack[s].localName + (stack[s].getAttribute('class') ? ' class="' + stack[s].getAttribute('class') + '"' : '') + '>', html, html.length, 'открыт и не закрыт до конца фрагмента');
  }
}

function serialize(node) {
  if (node.nodeType === 3) return encodeText(node.nodeValue);
  let out = '<' + node.localName;
  for (const [k, v] of node.attrs) out += ' ' + k + (v === '' ? '' : '="' + encodeAttr(v) + '"');
  out += '>';
  if (VOID.has(node.localName)) return out;
  for (const child of node.childNodes) out += serialize(child);
  return out + '</' + node.localName + '>';
}

export class Element {
  constructor(tag, doc) {
    this.nodeType = 1; this.localName = String(tag).toLowerCase(); this.tagName = this.localName.toUpperCase(); this.nodeName = this.tagName;
    this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.ownerDocument = doc;
    this._listeners = new Map(); this.files = []; this.returnValue = '';
    const self = this;
    this.style = new Proxy({}, { set(t, k, v) { t[k] = v; self._styleTouched = true; return true; } });
    this.classList = {
      _list() { return (self.attrs.get('class') || '').split(/\s+/).filter(Boolean); },
      contains(name) { return this._list().includes(name); },
      add(...names) { const l = this._list(); names.forEach((x) => { if (!l.includes(x)) l.push(x); }); self.attrs.set('class', l.join(' ')); },
      remove(...names) { self.attrs.set('class', this._list().filter((x) => !names.includes(x)).join(' ')); },
      toggle(name, force) { const on = force === undefined ? !this.contains(name) : Boolean(force); if (on) this.add(name); else this.remove(name); return on; },
    };
    this.dataset = new Proxy({}, {
      get(t, k) { if (typeof k !== 'string') return undefined; const a = 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); return self.attrs.has(a) ? self.attrs.get(a) : undefined; },
      set(t, k, v) { self.attrs.set('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), String(v)); return true; },
      has(t, k) { return self.attrs.has('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); },
      deleteProperty(t, k) { self.attrs.delete('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); return true; },
    });
  }
  // атрибуты
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(String(name).toLowerCase(), String(value)); }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  get id() { return this.attrs.get('id') || ''; } set id(v) { this.attrs.set('id', String(v)); }
  get className() { return this.attrs.get('class') || ''; } set className(v) { this.attrs.set('class', String(v)); }
  get title() { return this.attrs.get('title') || ''; } set title(v) { this.attrs.set('title', String(v)); }
  get name() { return this.attrs.get('name') || ''; } set name(v) { this.attrs.set('name', String(v)); }
  get href() { return this.attrs.get('href') || ''; } set href(v) { this.attrs.set('href', String(v)); }
  get src() { return this.attrs.get('src') || ''; } set src(v) { this.attrs.set('src', String(v)); if (this.onload) setTimeout(() => this.onload && this.onload(), 0); }
  get placeholder() { return this.attrs.get('placeholder') || ''; }
  get download() { return this.attrs.get('download') || ''; } set download(v) { this.attrs.set('download', String(v)); }
  get type() { return this.attrs.get('type') || (this.localName === 'button' ? 'submit' : this.localName === 'select' ? 'select-one' : this.localName === 'textarea' ? 'textarea' : this.localName === 'input' ? 'text' : ''); }
  set type(v) { this.attrs.set('type', String(v)); }
  get disabled() { return this.attrs.has('disabled'); } set disabled(v) { if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get hidden() { return this.attrs.has('hidden'); } set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get open() { return this.attrs.has('open'); } set open(v) { const was = this.attrs.has('open'); if (v) this.attrs.set('open', ''); else this.attrs.delete('open'); if (was !== Boolean(v) && this.localName === 'details') this.dispatchEvent({ type: 'toggle' }); }
  get checked() { return this._checked === undefined ? this.attrs.has('checked') : this._checked; } set checked(v) { this._checked = Boolean(v); }
  get tabIndex() { return Number(this.attrs.get('tabindex') || 0); }
  get complete() { return true; }
  get naturalWidth() { return 1600; } get naturalHeight() { return 300; }
  get options() { return this.querySelectorAll('option'); }
  get selectedIndex() { const opts = this.options; const v = this.value; return opts.findIndex((o) => o.value === v); }
  get value() {
    if (this.localName === 'select') {
      if (this._value !== undefined) return this._value;
      const opts = this.options; const sel = opts.find((o) => o.attrs.has('selected')) || opts[0];
      return sel ? sel.value : '';
    }
    if (this.localName === 'option') return this.attrs.has('value') ? this.attrs.get('value') : this.textContent;
    if (this.localName === 'textarea') return this._value !== undefined ? this._value : this.textContent;
    if (this._value !== undefined) return this._value;
    return this.attrs.get('value') || '';
  }
  set value(v) {
    v = String(v);
    if (this.localName === 'select') { this._value = this.options.some((o) => o.value === v) ? v : ''; return; }
    this._value = v;
  }
  get selectionStart() { return String(this.value).length; } get selectionEnd() { return String(this.value).length; }
  setSelectionRange() {} select() {}
  // дерево
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling() { if (!this.parentNode) return null; const k = this.parentNode.children; return k[k.indexOf(this) + 1] || null; }
  get previousElementSibling() { if (!this.parentNode) return null; const k = this.parentNode.children; return k[k.indexOf(this) - 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore(child, ref) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; const at = ref ? this.childNodes.indexOf(ref) : -1; if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child); return child; }
  removeChild(child) { const at = this.childNodes.indexOf(child); if (at >= 0) this.childNodes.splice(at, 1); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  append(...nodes) { nodes.forEach((x) => this.appendChild(typeof x === 'string' ? new TextNode(x, this.ownerDocument) : x)); }
  contains(node) { while (node) { if (node === this) return true; node = node.parentNode; } return false; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) {
    this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = [];
    this.ownerDocument.htmlLog.push({ label: context.label, host: this.localName + (this.id ? '#' + this.id : ''), html: String(html) });
    parseInto(this, html, this.ownerDocument);
  }
  get outerHTML() { return serialize(this); }
  insertAdjacentHTML(pos, html) { const holder = new Element('div', this.ownerDocument); parseInto(holder, html, this.ownerDocument); holder.childNodes.slice().forEach((c) => this.appendChild(c)); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; if (this.localName === 'textarea') this._value = undefined; const t = String(v); if (t) this.appendChild(new TextNode(t, this.ownerDocument)); }
  get innerText() { return this.textContent; }
  // поиск
  _walk(fn) { for (const c of this.childNodes) { if (c.nodeType !== 1) continue; if (fn(c) === false) return false; if (c._walk(fn) === false) return false; } return true; }
  querySelectorAll(selector) { const out = []; this._walk((el) => { if (matches(el, selector)) out.push(el); }); return out; }
  querySelector(selector) { let found = null; this._walk((el) => { if (matches(el, selector)) { found = el; return false; } }); return found; }
  matches(selector) { return matches(this, selector); }
  closest(selector) { let n = this; while (n && n.nodeType === 1) { if (matches(n, selector)) return n; n = n.parentNode; } return null; }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }
  // события
  addEventListener(type, fn, options) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this._listeners.get(type) || []; const at = l.indexOf(fn); if (at >= 0) l.splice(at, 1); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.stopPropagation = event.stopPropagation || function () { event._stopped = true; };
    event.preventDefault = event.preventDefault || function () { event.defaultPrevented = true; };
    const bubbles = event.bubbles !== undefined ? event.bubbles : !['close', 'toggle', 'load', 'focus', 'cancel'].includes(event.type);
    let node = this;
    while (node) {
      event.currentTarget = node;
      const handler = node['on' + event.type];
      if (typeof handler === 'function') { const r = handler.call(node, event); if (r && typeof r.catch === 'function') r.catch((e) => node.ownerDocument.errors.push(context.label + ': ' + (e && e.stack || e))); }
      for (const fn of (node._listeners.get(event.type) || []).slice()) { const r = fn.call(node, event); if (r && typeof r.catch === 'function') r.catch((e) => node.ownerDocument.errors.push(context.label + ': ' + (e && e.stack || e))); }
      if (!bubbles || event._stopped) break;
      node = node.parentNode;
    }
    if (bubbles && !event._stopped) this.ownerDocument._fire(event);
    return !event.defaultPrevented;
  }
  click() { if (this.disabled) return; this.dispatchEvent({ type: 'click', bubbles: true }); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  scrollIntoView() {} getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 30, bottom: 30, right: 100 }; }
  get scrollHeight() { return 100; } get offsetWidth() { return 100; } get offsetHeight() { return 30; }
  showModal() { this.attrs.set('open', ''); this._modal = true; }
  close(value) { if (!this.attrs.has('open')) return; this.attrs.delete('open'); if (value !== undefined) this.returnValue = String(value); this.dispatchEvent({ type: 'close' }); }
  getContext() { return { fillRect() {}, drawImage() {}, set fillStyle(v) {} }; }
  toDataURL() { return 'data:image/jpeg;base64,AAAA'; }
}

export function createDocument() {
  const doc = { htmlLog: [], errors: [], _listeners: new Map(), hidden: false, title: 'Kornilenko · Панель', readyState: 'complete' };
  doc.documentElement = new Element('html', doc);
  doc.head = new Element('head', doc);
  doc.body = new Element('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.createElement = (tag) => new Element(tag, doc);
  doc.createTextNode = (text) => new TextNode(String(text), doc);
  doc.createDocumentFragment = () => new Element('fragment', doc);
  doc.getElementById = (id) => { let found = null; doc.documentElement._walk((el) => { if (el.attrs.get('id') === String(id)) { found = el; return false; } }); return found; };
  doc.querySelector = (selector) => doc.documentElement.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.documentElement.querySelectorAll(selector);
  doc.addEventListener = (type, fn) => { if (!doc._listeners.has(type)) doc._listeners.set(type, []); doc._listeners.get(type).push(fn); };
  doc.removeEventListener = (type, fn) => { const l = doc._listeners.get(type) || []; const at = l.indexOf(fn); if (at >= 0) l.splice(at, 1); };
  doc._fire = (event) => { for (const fn of (doc._listeners.get(event.type) || []).slice()) { try { fn(event); } catch (e) { doc.errors.push(context.label + ': document ' + event.type + ': ' + (e && e.stack || e)); } } };
  doc.hasFocus = () => true;
  doc.execCommand = () => true;
  doc.createTreeWalker = (root) => {
    const list = [];
    (function walk(node) { for (const c of node.childNodes) { if (c.nodeType === 3) list.push(c); else walk(c); } })(root);
    let i = -1;
    return { nextNode() { i += 1; return list[i] || null; } };
  };
  return doc;
}

export function textNodes(root, out = []) {
  for (const c of root.childNodes) { if (c.nodeType === 3) out.push(c); else textNodes(c, out); }
  return out;
}
