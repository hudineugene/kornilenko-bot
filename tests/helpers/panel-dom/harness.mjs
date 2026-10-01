// Запуск скрипта панели на настоящем маленьком DOM. Страница собирается из src/panel/index.mjs (она не читает данные бота).
import vm from 'node:vm';
import { createDocument, parseInto, anomalies, context, textNodes, Element } from './minidom.mjs';
import { apiAnswer } from './fixtures.mjs';
import { PANEL_HTML } from '../../../src/panel/index.mjs';

const js = PANEL_HTML.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const shell = PANEL_HTML.slice(PANEL_HTML.indexOf('<body>') + 6, PANEL_HTML.indexOf('<script>'));
export const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
export { anomalies, context, textNodes };

export async function makePanel(state, options = {}) {
  const doc = createDocument();
  context.label = 'каркас (PANEL_SHELL)';
  parseInto(doc.body, shell, doc);
  const requests = [];
  const winListeners = new Map();
  const holder = { state, failNext: null, width: options.width || 1366 };
  let hash = options.hash || '';
  const fire = (type, event) => (winListeners.get(type) || []).slice().forEach((fn) => { try { const r = fn(event || { type }); if (r && r.catch) r.catch((e) => doc.errors.push(context.label + ': window ' + type + ': ' + (e && e.stack || e))); } catch (e) { doc.errors.push(context.label + ': window ' + type + ': ' + (e && e.stack || e)); } });
  const location = {
    get hash() { return hash; },
    set hash(v) { v = String(v); if (v && v[0] !== '#') v = '#' + v; if (v === hash) return; hash = v; setTimeout(() => fire('hashchange'), 0); },
    href: 'http://localhost/', pathname: '/', search: '', reload() { holder.reloaded = (holder.reloaded || 0) + 1; }, assign() {},
  };
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, error(...args) { doc.errors.push(context.label + ': console.error: ' + args.map((a) => (a && a.stack) || String(a)).join(' ')); } },
    document: doc,
    location,
    history: { replaceState(a, b, url) { hash = String(url); }, pushState(a, b, url) { hash = String(url); } },
    localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    navigator: { userAgent: 'audit', clipboard: { writeText: async () => {} } },
    fetch: async (url, opts) => {
      const path = String(url);
      const method = (opts && opts.method) || 'GET';
      let body = null;
      try { body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null; } catch { body = null; }
      requests.push({ url: path, method, body, label: context.label });
      if (holder.failNext && holder.failNext(path, method)) return { ok: false, status: 400, json: async () => ({ error: 'Отказ сервера (проверка)' }), blob: async () => ({}) };
      const payload = apiAnswer(path, method, holder.state);
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)), blob: async () => ({}), headers: { get: () => '' } };
    },
    setTimeout, clearTimeout,
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; },
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    MutationObserver: class { observe() {} disconnect() {} },
    Event: class { constructor(type, init) { this.type = type; this.bubbles = Boolean(init && init.bubbles); } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.bubbles = Boolean(init && init.bubbles); this.detail = init && init.detail; } },
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; setTimeout(() => this.onload && this.onload(), 0); } readAsText() {} },
    Image: class { set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get naturalWidth() { return 1600; } get naturalHeight() { return 300; } },
    URL: Object.assign(function () {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
    Blob, btoa, atob,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
    alert() {}, confirm: () => true, prompt: () => '',
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, fn) { if (!winListeners.has(type)) winListeners.set(type, []); winListeners.get(type).push(fn); },
    removeEventListener() {}, dispatchEvent: () => true,
    scrollTo() {}, open: () => null, print() {},
    get innerWidth() { return holder.width; }, innerHeight: 800,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  context.label = 'запуск';
  new vm.Script(js, { filename: 'panel.js' }).runInContext(sandbox);
  await settle(120);
  const panel = {
    sandbox, doc, requests, holder,
    // То, что в браузере делает MutationObserver через 30 мс: доступность, значки, неразрывные пробелы.
    polish() { const s = sandbox; s.enhanceAccessibility(doc.getElementById('page')); s.enhanceAccessibility(doc.querySelector('.topbar')); s.iconifyButtons(doc.body); s.tightenSpaces(doc.body); },
    async go(view, tab, sub) { location.hash = '#/' + view + (tab ? '/' + tab : '') + (sub ? '/' + sub : ''); await settle(60); },
    dialogs() { return doc.body.children.filter((c) => c.localName === 'dialog'); },
    closeDialogs() { panel.dialogs().forEach((d) => { try { if (d.closeClean) d.closeClean(); else d.close(); } catch (e) {} d.remove(); }); },
    hash: () => hash,
  };
  return panel;
}

// --- анализ ---------------------------------------------------------------------
export function isVisible(el) {
  let n = el;
  while (n && n.nodeType === 1) {
    if (n.classList.contains('hidden') || n.attrs.has('hidden')) return false;
    if (n.localName === 'details' && !n.attrs.has('open') && el !== n) {
      // содержимое закрытой раскрывашки не видно, кроме её summary
      let inside = el; let viaSummary = false;
      while (inside && inside !== n) { if (inside.localName === 'summary' && inside.parentNode === n) viaSummary = true; inside = inside.parentNode; }
      if (!viaSummary) return false;
    }
    n = n.parentNode;
  }
  return true;
}
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
export function hasClickHandler(el) {
  return typeof el.onclick === 'function' || (el._listeners.get('click') || []).length > 0;
}
export function solidButtons(scope) {
  return scope.querySelectorAll('.btn').filter((b) => isVisible(b) && !['secondary', 'ghost', 'danger-outline'].some((c) => b.classList.contains(c)))
    .map((b) => ({ text: text(b) || b.getAttribute('aria-label') || '', cls: b.className, id: b.id, danger: b.classList.contains('danger'), disabled: b.disabled }));
}
export function deadControls(scope) {
  const out = [];
  scope.querySelectorAll('button').forEach((b) => {
    if (hasClickHandler(b)) return;
    if (b.type === 'submit' && b.closest('form')) return;
    out.push({ what: 'button', text: text(b).slice(0, 50), id: b.id, cls: b.className, data: [...b.attrs.keys()].filter((k) => k.startsWith('data-')).join(' '), visible: isVisible(b), disabled: b.disabled });
  });
  scope.querySelectorAll('.clickable').forEach((el) => {
    if (hasClickHandler(el)) return;
    // ячейка внутри кликабельной строки пользуется обработчиком строки
    const row = el.closest('tr');
    if (row && row !== el && hasClickHandler(row)) return;
    if (el.localName === 'label') return;
    out.push({ what: el.localName + '.clickable', text: text(el).slice(0, 50), id: el.id, cls: el.className, data: [...el.attrs.keys()].filter((k) => k.startsWith('data-')).join(' '), visible: isVisible(el) });
  });
  scope.querySelectorAll('a').forEach((a) => { if (!a.getAttribute('href') && !hasClickHandler(a)) out.push({ what: 'a без href', text: text(a).slice(0, 50), cls: a.className }); });
  scope.querySelectorAll('label.btn').forEach((l) => {
    const target = l.getAttribute('for') ? scope.ownerDocument.getElementById(l.getAttribute('for')) : l.querySelector('input');
    if (!target) out.push({ what: 'label.btn без поля', text: text(l).slice(0, 50), cls: l.className });
  });
  return out;
}
export function duplicateIds(doc) {
  const seen = new Map();
  doc.documentElement._walk((el) => { const id = el.attrs.get('id'); if (id) seen.set(id, (seen.get(id) || 0) + 1); });
  return [...seen].filter(([, n]) => n > 1).map(([id, n]) => id + '×' + n);
}
export function iconOnlyButtons(scope) {
  const out = [];
  scope.querySelectorAll('button').forEach((b) => {
    if (!isVisible(b)) return;
    const t = text(b);
    const glyphOnly = t && [...t].length <= 2 && !/[\p{L}\p{N}]/u.test(t);
    if (t && !glyphOnly) return;
    out.push({ text: t, aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), id: b.id, cls: b.className, data: [...b.attrs.keys()].filter((k) => k.startsWith('data-') && k !== 'data-iconified').join(' ') });
  });
  return out;
}
const GLYPH = /[\p{Extended_Pictographic}←-⇿⌀-⏿─-╿☀-➿⬀-⯿×＋]/u;
export function glyphTexts(scope) {
  const out = [];
  textNodes(scope).forEach((node) => {
    if (!GLYPH.test(node.nodeValue)) return;
    const parent = node.parentNode;
    if (!parent || !isVisible(parent)) return;
    if (/^(textarea|option|script|style|code)$/.test(parent.localName)) return;
    let path = [], n = parent, preview = false;
    while (n && n.nodeType === 1 && path.length < 4) { path.push(n.localName + (n.className ? '.' + n.className.split(/\s+/).slice(0, 2).join('.') : '')); n = n.parentNode; }
    n = parent;
    while (n && n.nodeType === 1) { if (/\btg-|markup-bar|message-kind|message-reactions|conversation-thread|tg-preview/.test(n.className)) preview = true; n = n.parentNode; }
    const glyphs = [...node.nodeValue].filter((ch) => GLYPH.test(ch)).join('');
    out.push({ glyphs, text: node.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 60), where: path.join(' < '), preview });
  });
  return out;
}
export function plainSpaceNumbers(scope) {
  const out = [];
  textNodes(scope).forEach((node) => {
    const parent = node.parentNode;
    if (!parent || /^(textarea|option|script|style|code)$/.test(parent.localName) || !isVisible(parent)) return;
    const m = node.nodeValue.match(/\d (?:[а-яёa-z€$£%№]|м²)[а-яёa-z²]*/gi);
    if (m) out.push({ hits: m.join(' | '), text: node.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 70), cls: parent.className });
  });
  return out;
}
export function labelProblems(scope) {
  const doc = scope.ownerDocument;
  const orphanLabels = [], unlabelled = [];
  scope.querySelectorAll('label').forEach((l) => {
    if (l.classList.contains('btn')) return;
    if (l.getAttribute('for')) { if (!doc.getElementById(l.getAttribute('for'))) orphanLabels.push({ text: text(l).slice(0, 40), why: 'for=' + l.getAttribute('for') + ' — такого поля нет' }); return; }
    if (l.querySelector('input,select,textarea')) return;
    orphanLabels.push({ text: text(l).slice(0, 40), why: 'нет for и поля внутри' });
  });
  scope.querySelectorAll('input,select,textarea').forEach((f) => {
    if (f.type === 'hidden') return;
    const id = f.id;
    const labelled = (id && scope.ownerDocument.documentElement.querySelectorAll('label').some((l) => l.getAttribute('for') === id)) || f.closest('label') || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.getAttribute('title');
    if (labelled) return;
    // группа role=group с подписью считается подписью флажков
    const group = f.closest('[role=group]');
    if (group && (f.type === 'checkbox' || f.type === 'radio')) return;
    unlabelled.push({ tag: f.localName + (f.type && f.localName === 'input' ? '[' + f.type + ']' : ''), id, placeholder: f.getAttribute('placeholder') || '', data: [...f.attrs.keys()].filter((k) => k.startsWith('data-')).join(' '), siblingLabel: Boolean(f.parentNode && f.parentNode.children.some((c) => c.localName === 'label')), visible: isVisible(f) });
  });
  return { orphanLabels, unlabelled };
}
export function chips(scope) {
  return scope.querySelectorAll('.chip').filter(isVisible).map((c) => ({ text: text(c), kind: c.className.split(/\s+/).filter((x) => x !== 'chip').join(' '), tag: c.localName }));
}
export function screenStats(scope) {
  const vis = (sel) => scope.querySelectorAll(sel).filter(isVisible);
  return {
    buttons: vis('button').length + vis('label.btn').length,
    fields: vis('input').filter((f) => f.type !== 'hidden' && f.type !== 'file').length + vis('select').length + vis('textarea').length,
    files: vis('input').filter((f) => f.type === 'file').length,
    links: vis('a').length,
    tabGroups: vis('.tabs').length,
    empties: vis('.empty').map((e) => text(e).slice(0, 60)),
    h: { h1: vis('h1').length, h2: vis('h2').length, h3: vis('h3').length },
    banners: vis('.banner').length,
    details: scope.querySelectorAll('details').length,
    inlineStyles: scope.querySelectorAll('[style]').length,
    noTypeButtons: scope.querySelectorAll('button').filter((b) => !b.attrs.has('type')).length,
    blockInInline: (() => { const out = []; scope._walk((el) => { if (el._blockInInline) out.push('<' + el.localName + '> в <' + el._blockInInline + '>'); }); return out; })(),
  };
}
