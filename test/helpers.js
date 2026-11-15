import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createEnvironment } from './dom.js';
import { buildWatchPage, mountChat, populateComments, expandPanel, collapseChat } from './fixture.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DOM_PROPS = new Set([
  'tagName', 'ownerDocument', 'children', 'parentElement', 'attributes',
  'id', 'className', 'classList', 'hidden', 'isConnected', 'nextSibling',
  'previousElementSibling', 'textContent', 'innerText', 'readyState',
  'documentElement', 'head', 'body', 'elements',
  'setAttribute', 'getAttribute', 'hasAttribute', 'removeAttribute',
  'matches', 'closest', 'appendChild', 'insertBefore', 'prepend',
  'removeChild', 'remove', 'click', 'scrollIntoView', 'getBoundingClientRect',
  'querySelectorAll', 'querySelector', 'createElement', 'getElementById',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
]);

const NODE_RETURN_SINGLE = new Set([
  'ownerDocument', 'parentElement', 'nextSibling', 'previousElementSibling',
  'documentElement', 'head', 'body', 'closest', 'querySelector',
  'createElement', 'getElementById',
]);

const NODE_RETURN_LIST = new Set(['children', 'elements', 'querySelectorAll']);
const NODE_ARG_MUTATORS = new Set(['appendChild', 'insertBefore', 'prepend', 'removeChild']);

// Boots a page with the real start.js + comments.js content scripts executed in a
// scoped VM. Returns the environment plus fixture part handles.
export function boot(opts = {}) {
  const {
    href = 'https://www.youtube.com/watch?v=abc123',
    storage = {},
    fixture = {},
    preload = true,
    // Runs after the fixture + start.js are set up, before comments.js loads.
    // Lets tests simulate a not-yet-hydrated page.
    mutate = null,
  } = opts;

  const env = createEnvironment({ href, storage });
  const parts = buildWatchPage(env.document, { videoId: videoIdOf(href), ...fixture });
  env.document.body.appendChild(parts.mount || parts.root);

  if (preload) env.load('./start.js');
  if (mutate) mutate({ env, parts, doc: env.document });
  env.load('./comments.js');

  return { env, parts, doc: env.document };
}

export function bootPlayer(storage = {}) {
  const env = createEnvironment({
    href: 'https://www.youtube.com/watch?v=abc123',
    storage,
  });
  const parts = buildWatchPage(env.document, { videoId: 'abc123' });
  env.document.body.appendChild(parts.mount || parts.root);
  // player.js expects the real YouTube player API surface on #movie_player
  const qualityCalls = [];
  const player = env.document.getElementById('movie_player');
  player.setPlaybackQualityRange = (a, b) => qualityCalls.push(['range', a, b]);
  player.setPlaybackQuality = (q) => qualityCalls.push(['single', q]);
  env.load('./player.js');
  return { env, parts, qualityCalls };
}

function createWorldBridge(base) {
  const rawDoc = base.document;
  const rawMainWindow = base.window;
  const rawIsoWindow = new rawMainWindow.constructor();
  rawIsoWindow.scrollBy = () => {};
  rawIsoWindow.scrollTo = () => {};
  rawDoc._windows = [rawIsoWindow, rawMainWindow];

  const RAW = Symbol.for('ytlite.raw');
  const rawToIso = new WeakMap();
  const isoExpandos = new WeakMap();
  const listenerRecords = new WeakMap(); // rawTarget -> Map<world, Map<type, Array>>

  const unwrap = (v) => (v && typeof v === 'object' && v[RAW]) ? v[RAW] : v;

  const wrapTarget = (world, target) => {
    if (!target) return null;
    if (world === 'main') {
      if (target === rawIsoWindow) return mainWindow;
      if (target === rawDoc) return mainDoc;
      return target;
    }
    if (target === rawMainWindow || target === rawIsoWindow) return isolatedWindow;
    if (target === rawDoc) return isolatedDoc;
    return wrapIso(target);
  };

  const wrapEvent = (ev, world, crossWorld) => new Proxy(ev, {
    get(target, prop) {
      if (prop === 'detail') return crossWorld ? null : target.detail;
      if (prop === 'target') return wrapTarget(world, target.target);
      const val = Reflect.get(target, prop, target);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });

  const getRecs = (rawTarget, world, type) => {
    let byWorld = listenerRecords.get(rawTarget);
    if (!byWorld) { byWorld = new Map(); listenerRecords.set(rawTarget, byWorld); }
    let byType = byWorld.get(world);
    if (!byType) { byType = new Map(); byWorld.set(world, byType); }
    let arr = byType.get(type);
    if (!arr) { arr = []; byType.set(type, arr); }
    return arr;
  };

  const makeAddListener = (rawTarget, world) => (type, fn, opts) => {
    if (typeof fn !== 'function') return;
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
    const wrapped = (ev) => {
      const crossWorld = Boolean(ev._originWorld && ev._originWorld !== world);
      fn(wrapEvent(ev, world, crossWorld));
    };
    getRecs(rawTarget, world, type).push({ fn, capture, wrapped });
    rawTarget.addEventListener(type, wrapped, opts);
  };

  const makeRemoveListener = (rawTarget, world) => (type, fn, opts) => {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
    const arr = getRecs(rawTarget, world, type);
    const i = arr.findIndex((r) => r.fn === fn && r.capture === capture);
    if (i < 0) return;
    const [{ wrapped }] = arr.splice(i, 1);
    rawTarget.removeEventListener(type, wrapped, opts);
  };

  let isolatedDoc = null;
  let isolatedWindow = null;

  function wrapIso(raw) {
    if (!raw) return null;
    if (raw === rawDoc && isolatedDoc) return isolatedDoc;
    if ((raw === rawMainWindow || raw === rawIsoWindow) && isolatedWindow) return isolatedWindow;
    const cached = rawToIso.get(raw);
    if (cached) return cached;

    const proxy = new Proxy(raw, {
      has(target, prop) {
        if (prop === RAW) return true;
        return DOM_PROPS.has(prop) || Boolean(isoExpandos.get(target)?.has(prop));
      },
      get(target, prop) {
        if (prop === RAW) return target;
        const exp = isoExpandos.get(target);
        if (exp && exp.has(prop)) return exp.get(prop);
        if (!DOM_PROPS.has(prop)) return undefined;

        if (prop === 'addEventListener') return makeAddListener(target, 'isolated');
        if (prop === 'removeEventListener') return makeRemoveListener(target, 'isolated');
        if (prop === 'dispatchEvent') {
          return (ev) => {
            if (!ev._originWorld) ev._originWorld = 'isolated';
            return target.dispatchEvent(ev);
          };
        }
        if (prop === 'click') {
          return () => {
            const ev = new base.ctx.Event('click', { bubbles: true, cancelable: true });
            ev._originWorld = 'isolated';
            target.dispatchEvent(ev);
          };
        }

        const val = Reflect.get(target, prop, target);
        if (typeof val === 'function') {
          return (...args) => {
            const cleanArgs = NODE_ARG_MUTATORS.has(prop) ? args.map(unwrap) : args;
            const res = val.apply(target, cleanArgs);
            if (NODE_RETURN_SINGLE.has(prop) || NODE_ARG_MUTATORS.has(prop)) return wrapIso(res);
            if (NODE_RETURN_LIST.has(prop)) return res.map(wrapIso);
            return res;
          };
        }
        if (NODE_RETURN_SINGLE.has(prop)) return wrapIso(val);
        if (NODE_RETURN_LIST.has(prop)) return val.map(wrapIso);
        return val;
      },
      set(target, prop, value) {
        if (prop === 'id' || prop === 'className' || prop === 'hidden' || prop === 'textContent' || prop === 'innerText') {
          return Reflect.set(target, prop, value, target);
        }
        let exp = isoExpandos.get(target);
        if (!exp) { exp = new Map(); isoExpandos.set(target, exp); }
        exp.set(prop, value);
        return true;
      },
    });
    rawToIso.set(raw, proxy);
    return proxy;
  }

  function wrapWindow(rawWin, otherWin, world) {
    return new Proxy(rawWin, {
      get(target, prop) {
        if (prop === 'addEventListener') return makeAddListener(target, world);
        if (prop === 'removeEventListener') return makeRemoveListener(target, world);
        if (prop === 'dispatchEvent') {
          return (ev) => {
            if (!ev._originWorld) ev._originWorld = world;
            ev.target = target;
            ev._stopped = false;
            ev._immediateStopped = false;
            target._emit(ev, false);
            if (!ev._stopped) otherWin._emit(ev, false);
            return !ev.defaultPrevented;
          };
        }
        const val = Reflect.get(target, prop, target);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }

  isolatedDoc = wrapIso(rawDoc);
  isolatedWindow = wrapWindow(rawIsoWindow, rawMainWindow, 'isolated');
  const mainWindow = wrapWindow(rawMainWindow, rawIsoWindow, 'main');
  const mainDoc = new Proxy(rawDoc, {
    get(target, prop) {
      if (prop === 'addEventListener') return makeAddListener(target, 'main');
      if (prop === 'removeEventListener') return makeRemoveListener(target, 'main');
      if (prop === 'dispatchEvent') {
        return (ev) => {
          if (!ev._originWorld) ev._originWorld = 'main';
          return target.dispatchEvent(ev);
        };
      }
      const val = Reflect.get(target, prop, target);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });

  const BaseObserver = base.ctx.MutationObserver;
  class IsolatedMutationObserver {
    constructor(cb) { this._obs = new BaseObserver((recs) => cb(recs, this)); }
    observe(target, options) { this._obs.observe(unwrap(target), options); }
    disconnect() { this._obs.disconnect(); }
    takeRecords() { return this._obs.takeRecords(); }
    trigger() { this._obs.trigger(); }
  }

  const makeCtx = ({ doc, win, Observer }) => {
    const sandbox = {
      document: doc,
      window: win,
      location: base.location,
      localStorage: base.localStorage,
      navigator: { userAgent: 'bun-test' },
      console,
      URL,
      Event: base.ctx.Event,
      CustomEvent: base.ctx.CustomEvent,
      MutationObserver: Observer,
      setTimeout: base.ctx.setTimeout,
      clearTimeout: base.ctx.clearTimeout,
      queueMicrotask,
      structuredClone,
      Promise,
      Object, Array, JSON, Math, Date, String, Number, Boolean, RegExp, Error, TypeError,
      Symbol, Map, Set, WeakMap, WeakSet, parseInt, parseFloat, isNaN, Infinity, NaN,
    };
    sandbox.globalThis = sandbox;
    return vm.createContext(sandbox);
  };

  const isolatedCtx = makeCtx({ doc: isolatedDoc, win: isolatedWindow, Observer: IsolatedMutationObserver });
  const mainCtx = makeCtx({ doc: mainDoc, win: mainWindow, Observer: BaseObserver });
  const loadIn = (ctx) => (relPath) => {
    const code = fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  };

  return {
    isolated: { ctx: isolatedCtx, document: isolatedDoc, window: isolatedWindow, load: loadIn(isolatedCtx) },
    main: { ctx: mainCtx, document: mainDoc, window: mainWindow, load: loadIn(mainCtx) },
  };
}

// Boots start.js (ISOLATED), player.js (MAIN), and comments.js (ISOLATED) across
// realistic Chromium world boundaries.
export function bootDualWorld(opts = {}) {
  const {
    href = 'https://www.youtube.com/watch?v=abc123',
    storage = {},
    fixture = {},
    preload = true,
    appShell = true,
    mutate = null,
  } = opts;

  const base = createEnvironment({ href, storage });
  const parts = buildWatchPage(base.document, { videoId: videoIdOf(href), appShell, ...fixture });
  base.document.body.appendChild(parts.mount || parts.root);

  const qualityCalls = [];
  if (parts.moviePlayer) {
    parts.moviePlayer.setPlaybackQualityRange = (a, b) => qualityCalls.push(['range', a, b]);
    parts.moviePlayer.setPlaybackQuality = (q) => qualityCalls.push(['single', q]);
  }

  const { isolated, main } = createWorldBridge(base);
  const env = {
    ...base,
    ctx: isolated.ctx,
    document: isolated.document,
    window: isolated.window,
    load: isolated.load,
  };

  if (preload) isolated.load('./start.js');
  main.load('./player.js');
  if (mutate) mutate({ env, isolated, main, parts, doc: isolated.document });
  isolated.load('./comments.js');

  return {
    env,
    isolated,
    main,
    parts,
    doc: isolated.document,
    qualityCalls,
    advance: base.advance,
    runTimers: base.runTimers,
    navigate: base.navigate,
    observers: base.observers,
  };
}

export function spaNavigateStart(url) {
  return { endpoint: { commandMetadata: { webCommandMetadata: { url } } } };
}

export function spaNavigateFinish({ hasLiveChat = false, liveChatModel = false, playerResponse } = {}) {
  const conversationBar = liveChatModel ? { liveChatRendererModel: {} } : { liveChatRenderer: {} };
  const detail = {
    response: {
      response: {
        contents: {
          twoColumnWatchNextResults: hasLiveChat ? { conversationBar } : {},
        },
      },
    },
  };
  if (playerResponse !== undefined) detail.playerResponse = playerResponse;
  return detail;
}

export function spaPageDataUpdated(extra = {}) {
  return { pageType: 'watch', ...extra };
}

export function videoIdOf(href) {
  const m = String(href).match(/[?&]v=([^&#]+)/);
  return m ? m[1] : 'abc123';
}

export function dispatch(env, target, type, detail) {
  const Ev = (type.startsWith('yt') || detail !== undefined) ? env.ctx.CustomEvent : env.ctx.Event;
  const ev = new Ev(type, { bubbles: true, cancelable: true, detail });
  target.dispatchEvent(ev);
  return ev;
}

export { buildWatchPage, mountChat, populateComments, expandPanel, collapseChat };
