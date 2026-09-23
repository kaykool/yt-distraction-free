// Minimal DOM/environment shim so the *unmodified* content scripts can be executed
// under Bun's node:vm for fast unit tests. It implements only the slice of the DOM
// surface the extension actually touches; it is NOT a general-purpose DOM.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MATCH_ATTR = /\[([\w-]+)(?:([*^$~|]?=)"([^"]*)")?\]/;
const MATCH_NOT = /:not\(([^)]*)\)/;

class ClassList {
  constructor(node) { this.node = node; }
  _set() { return new Set(String(this.node._class || '').split(/\s+/).filter(Boolean)); }
  _write(set) { this.node._class = [...set].join(' '); }
  add(...names) { const s = this._set(); names.forEach((n) => s.add(n)); this._write(s); }
  remove(...names) { const s = this._set(); names.forEach((n) => s.delete(n)); this._write(s); }
  contains(name) { return this._set().has(name); }
  values() { return [...this._set()]; }
  [Symbol.iterator]() { return this._set()[Symbol.iterator](); }
  toString() { return this.node._class; }
  toggle(name, force) {
    const s = this._set();
    const on = force === undefined ? !s.has(name) : Boolean(force);
    if (on) s.add(name); else s.delete(name);
    this._write(s);
    return on;
  }
}

class EventTargetBase {
  constructor() { this._listeners = new Map(); }
  addEventListener(type, fn, opts) {
    if (typeof fn !== 'function') return;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    const options = typeof opts === 'boolean' ? { capture: opts } : (opts || {});
    this._listeners.get(type).push({
      fn,
      capture: Boolean(options.capture),
      once: Boolean(options.once),
      passive: Boolean(options.passive),
    });
  }
  removeEventListener(type, fn, opts) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
    const i = arr.findIndex((l) => l.fn === fn && l.capture === capture);
    if (i >= 0) arr.splice(i, 1);
  }
  // Runs the listeners for one node in one phase. `once` listeners are removed
  // before invocation, matching the spec. stopImmediatePropagation halts the rest
  // of this node's listeners; stopPropagation only halts later nodes.
  _emit(event, capture) {
    const arr = this._listeners.get(event.type);
    if (!arr || arr.length === 0) return;
    for (const listener of arr.slice()) {
      if (listener.capture !== capture) continue;
      if (listener.once) {
        const live = this._listeners.get(event.type);
        const idx = live.indexOf(listener);
        if (idx >= 0) live.splice(idx, 1);
      }
      listener.fn(event);
      if (event._immediateStopped) return;
    }
  }
  dispatchEvent(event) {
    event.target = this;
    event._stopped = false;
    event._immediateStopped = false;
    // Capture phase: root -> target.
    const chain = [];
    let node = this;
    while (node) {
      chain.push(node);
      node = node.parentElement || node._parentTarget || null;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      chain[i]._emit(event, true);
      if (event._stopped) return !event.defaultPrevented;
    }
    // Target + bubble phase: target -> root.
    chain[0]._emit(event, false);
    if (event._stopped) return !event.defaultPrevented;
    if (event.bubbles) {
      for (let i = 1; i < chain.length; i++) {
        chain[i]._emit(event, false);
        if (event._stopped) return !event.defaultPrevented;
      }
      globalThis.__window?._emit(event, false);
    }
    return !event.defaultPrevented;
  }
}

let nodeSeq = 0;

class Node extends EventTargetBase {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this._class = '';
    this._text = '';
    this.hidden = false;
    this._uid = ++nodeSeq;
  }
  get id() { return this.attributes.get('id') || ''; }
  set id(v) { this.attributes.set('id', String(v)); }
  get className() { return this._class; }
  set className(v) { this._class = String(v); }
  get classList() { return new ClassList(this); }
  get isConnected() {
    let n = this;
    while (n) { if (n === this.ownerDocument) return true; n = n.parentElement; }
    return false;
  }
  get nextSibling() {
    if (!this.parentElement) return null;
    const sibs = this.parentElement.children;
    const i = sibs.indexOf(this);
    return i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this._class = String(value);
    if (name === 'id') this.attributes.set('id', String(value));
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let n = this;
    while (n && n.tagName) { if (matchesSelector(n, selector)) return n; n = n.parentElement; }
    return null;
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement._detach(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    if (child.parentElement) child.parentElement._detach(child);
    const i = this.children.indexOf(ref);
    child.parentElement = this;
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    return child;
  }
  prepend(child) { return this.insertBefore(child, this.children[0] || null); }
  removeChild(child) { this._detach(child); return child; }
  _detach(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentElement = null;
  }
  remove() { if (this.parentElement) this.parentElement._detach(this); }
  click() { this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })); }
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
  _descendants(out = []) {
    for (const c of this.children) { out.push(c); c._descendants(out); }
    return out;
  }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
}

class Document extends EventTargetBase {
  constructor() {
    super();
    this.documentElement = new Node('html', this);
    this.documentElement.parentElement = this;
    this.head = new Node('head', this);
    this.body = new Node('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.readyState = 'complete';
  }
  createElement(tag) { return new Node(tag, this); }
  getElementById(id) { return this._all().find((n) => n.id === id) || null; }
  _all() { return this.documentElement._descendants(); }
  querySelectorAll(sel) { return queryAll(this.documentElement, sel); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get elements() { return this._all(); }
}

function parseCompound(sel) {
  const spec = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let s = sel.trim();
  const notMatch = s.match(MATCH_NOT);
  if (notMatch) {
    spec.nots.push(notMatch[1]);
    s = s.replace(MATCH_NOT, '');
  }
  let attrMatch;
  while ((attrMatch = s.match(MATCH_ATTR))) {
    spec.attrs.push({ name: attrMatch[1], op: attrMatch[2] || null, value: attrMatch[3] });
    s = s.replace(MATCH_ATTR, '');
  }
  const tagMatch = s.match(/^([a-zA-Z][\w-]*)/);
  if (tagMatch) { spec.tag = tagMatch[1].toUpperCase(); s = s.slice(tagMatch[1].length); }
  const idMatch = s.match(/#([\w-]+)/);
  if (idMatch) { spec.id = idMatch[1]; s = s.replace(idMatch[0], ''); }
  const classRe = /\.([\w-]+)/g;
  let m;
  while ((m = classRe.exec(s))) spec.classes.push(m[1]);
  return spec;
}

function matchCompound(node, compound) {
  const spec = parseCompound(compound);
  if (spec.tag && node.tagName !== spec.tag) return false;
  if (spec.id && node.id !== spec.id) return false;
  for (const c of spec.classes) if (!node.classList.contains(c)) return false;
  for (const a of spec.attrs) {
    if (!node.hasAttribute(a.name)) return false;
    if (a.op === '=' && node.getAttribute(a.name) !== a.value) return false;
    if (a.op === '*=' && !String(node.getAttribute(a.name)).includes(a.value)) return false;
    if (a.op === '^=' && !String(node.getAttribute(a.name)).startsWith(a.value)) return false;
    if (a.op === '$=' && !String(node.getAttribute(a.name)).endsWith(a.value)) return false;
  }
  for (const inner of spec.nots) {
    const negated = inner.trim();
    if (negated.startsWith('[')) {
      const a = negated.match(MATCH_ATTR);
      if (a && node.hasAttribute(a[1])) return false;
    } else if (matchesSelector(node, negated)) {
      return false;
    }
  }
  return true;
}

function splitTop(sel) {
  const parts = []; let depth = 0; let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function matchesSelector(node, selector) {
  for (const group of splitTop(selector)) {
    const chain = group.split(/\s+/).filter(Boolean);
    if (chain.length === 0) continue;
    if (!matchCompound(node, chain[chain.length - 1])) continue;
    let ok = true; let n = node.parentElement; let i = chain.length - 2;
    while (i >= 0) {
      let found = false;
      while (n && n.tagName) { if (matchCompound(n, chain[i])) { found = true; n = n.parentElement; break; } n = n.parentElement; }
      if (!found) { ok = false; break; }
      i--;
    }
    if (ok) return true;
  }
  return false;
}

function queryAll(root, selector) {
  return root._descendants().filter((n) => matchesSelector(n, selector));
}

class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.detail = init.detail ?? null;
    this.defaultPrevented = false;
    this.target = null;
    this._stopped = false;
    this._immediateStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
  stopImmediatePropagation() { this._stopped = true; this._immediateStopped = true; }
}
class CustomEvent extends Event {
  constructor(type, init = {}) { super(type, init); this.detail = init.detail ?? null; }
}

export function createEnvironment({ href = 'https://www.youtube.com/watch?v=abc', storage = {} } = {}) {
  const u = new URL(href);
  const document = new Document();
  const window = new EventTargetBase();
  window.scrollBy = () => {};
  window.scrollTo = () => {};
  const localStorageMap = new Map(Object.entries(storage));
  const localStorage = {
    getItem: (k) => (localStorageMap.has(k) ? localStorageMap.get(k) : null),
    setItem: (k, v) => localStorageMap.set(k, String(v)),
    removeItem: (k) => localStorageMap.delete(k),
    clear: () => localStorageMap.clear(),
    get length() { return localStorageMap.size; },
    key: (i) => [...localStorageMap.keys()][i] ?? null,
  };
  const location = {
    href: u.href, pathname: u.pathname, search: u.search,
    origin: u.origin, host: u.host, hostname: u.hostname, hash: u.hash,
  };

  let now = 0; let seq = 1; const timers = new Map();
  const setTimeoutFn = (fn, ms = 0) => { const id = seq++; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimeoutFn = (id) => { timers.delete(id); };
  const runTimers = () => {
    let guard = 0;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0 || guard++ > 10000) break;
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
    }
  };

  const observerRegistry = [];
  class MutationObserverShim {
    constructor(cb) { this.cb = cb; this.observations = []; this.active = true; observerRegistry.push(this); }
    observe(target, options) { this.observations.push({ target, options }); }
    disconnect() { this.active = false; }
    takeRecords() { return []; }
    trigger() { if (this.active) this.cb([], this); }
  }
  globalThis.__window = window;

  const sandbox = {
    document, window, location, localStorage, navigator: { userAgent: 'bun-test' },
    console, URL, Event, CustomEvent, MutationObserver: MutationObserverShim,
    setTimeout: setTimeoutFn, clearTimeout: clearTimeoutFn,
    queueMicrotask, structuredClone, Promise, Object, Array, JSON, Math, Date, String, Number, Boolean, RegExp, Error, TypeError, Symbol, Map, Set, WeakMap, WeakSet, parseInt, parseFloat, isNaN, Infinity, NaN,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  return {
    ctx, document, window, location, localStorage, localStorageMap,
    observers: () => observerRegistry,
    advance(ms) { now += ms; runTimers(); },
    runTimers,
    navigate(newHref) {
      const nu = new URL(newHref);
      location.href = nu.href; location.pathname = nu.pathname; location.search = nu.search;
    },
    load(relPath, { asFilename = true } = {}) {
      const code = fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
      vm.runInContext(code, ctx, { filename: relPath });
    },
  };
}

export { Event, CustomEvent, Node, Document, matchesSelector };
