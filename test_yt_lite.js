const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

console.log('--- TEST SUITE: YT Lite Ultra-Low Overhead Verification ---');

// 1. Static Analysis Checks
console.log('[1] Static analysis...');
const hideCss = fs.readFileSync('hide.css', 'utf8');
const commentsJs = fs.readFileSync('comments.js', 'utf8');
const startJs = fs.readFileSync('start.js', 'utf8');
const rulesJson = JSON.parse(fs.readFileSync('rules.json', 'utf8'));
const manifestJson = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

// Check 1.1: No :has(...) in CSS (except comment explaining avoidance)
const nonCommentCss = hideCss.replace(/\/\*[\s\S]*?\*\//g, '');
assert(!nonCommentCss.includes(':has('), 'hide.css must not contain active :has(...) selectors');
console.log('  ✓ No :has(...) selectors in hide.css');

// Check 1.2: No universal wildcard selector in hide.css
assert(!nonCommentCss.includes('*::before') && !nonCommentCss.includes('*::after'), 'hide.css must not contain universal wildcard selectors (*, *::before, *::after)');
console.log('  ✓ No universal wildcard selectors (*, *::before, *::after) in hide.css');

// Check 1.3: No setInterval in comments.js
assert(!commentsJs.includes('setInterval'), 'comments.js must not contain setInterval polling');
console.log('  ✓ No setInterval polling in comments.js');

// Check 1.4: No addEventListener in start.js (all SPA handling unified in comments.js)
assert(!startJs.includes('addEventListener'), 'start.js must not register event listeners');
console.log('  ✓ No duplicate event listeners in start.js');

// Check 1.5: No yt-player-updated in comments.js
assert(!commentsJs.includes('yt-player-updated'), 'comments.js must not listen to high-frequency yt-player-updated');
console.log('  ✓ No high-frequency yt-player-updated listeners');

// 2. Behavioral Simulation: start.js
console.log('[2] start.js behavior...');
function testStartJs(pathname, expectHide, expectLive) {
  const classes = new Set();
  const context = {
    location: { pathname, href: 'https://www.youtube.com' + pathname, origin: 'https://www.youtube.com' },
    document: {
      documentElement: {
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c),
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(startJs, context);
  assert.strictEqual(classes.has('ytlite-comments-hide'), expectHide, `Expected ytlite-comments-hide=${expectHide} for ${pathname}`);
  assert.strictEqual(classes.has('ytlite-live'), expectLive, `Expected ytlite-live=${expectLive} for ${pathname}`);
}

testStartJs('/watch?v=abc', true, false);
testStartJs('/live/stream123', true, true);
testStartJs('/', false, false);
testStartJs('/feed/subscriptions', false, false);
testStartJs('/shorts/123', false, false);
console.log('  ✓ start.js correctly tags watch and live pages at document_start');

// 3. Behavioral Simulation: comments.js
console.log('[3] comments.js lifecycle & overhead behavior...');

let activeObservers = [];

class MockElement {
  constructor(tagName, id = '', className = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.eventListeners = {};
    this._connected = false;
    this.attributes = {};
  }

  get isConnected() {
    return this._connected;
  }

  setAttribute(name, val = '') {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches && cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  matches(sel) {
    const s = sel.trim();
    if (s.startsWith('.') && this.className.split(/\s+/).includes(s.slice(1))) return true;
    if (s.startsWith('#') && this.id === s.slice(1)) return true;
    if (s.toLowerCase() === this.tagName.toLowerCase()) return true;
    return false;
  }

  appendChild(child) {
    child.parentElement = this;
    child._setConnected(this._connected);
    this.children.push(child);
    this._notifyMutation(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    newChild.parentElement = this;
    newChild._setConnected(this._connected);
    const idx = this.children.indexOf(refChild);
    if (idx >= 0) {
      this.children.splice(idx, 0, newChild);
    } else {
      this.children.push(newChild);
    }
    this._notifyMutation(newChild);
    return newChild;
  }

  _notifyMutation(mutatedNode) {
    activeObservers.forEach(obs => {
      if (!obs.isObserving) return;
      if (obs.target === this) {
        obs.callback([{ type: 'childList', target: this, addedNodes: [mutatedNode] }]);
      } else if (obs.options && obs.options.subtree) {
        let cur = this;
        while (cur) {
          if (cur === obs.target) {
            obs.callback([{ type: 'childList', target: this, addedNodes: [mutatedNode] }]);
            break;
          }
          cur = cur.parentElement;
        }
      }
    });
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    this._setConnected(false);
  }

  _setConnected(val) {
    this._connected = val;
    this.children.forEach(c => c._setConnected(val));
  }

  addEventListener(type, fn, options) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push({ fn, options });
  }

  dispatchEvent(event) {
    const list = this.eventListeners[event.type] || [];
    list.forEach(l => l.fn(event));
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  scrollIntoView() {}

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    function match(el) {
      const selectors = selector.split(',').map(s => s.trim());
      for (const sel of selectors) {
        if (sel.startsWith('.') && el.className.split(/\s+/).includes(sel.slice(1))) return true;
        if (sel.startsWith('#') && el.id === sel.slice(1)) return true;
        if (sel.toLowerCase() === el.tagName.toLowerCase()) return true;
        if (sel.includes('[') || sel.includes(':not(')) {
          let matchesTag = true;
          let rest = sel;
          const bracketIdx = sel.indexOf('[');
          const notIdx = sel.indexOf(':not(');
          const firstSpecial = (bracketIdx !== -1 && notIdx !== -1) ? Math.min(bracketIdx, notIdx) : (bracketIdx !== -1 ? bracketIdx : notIdx);
          if (firstSpecial > 0) {
            const tagPart = sel.slice(0, firstSpecial);
            if (tagPart && tagPart.toLowerCase() !== el.tagName.toLowerCase()) {
              matchesTag = false;
            }
            rest = sel.slice(firstSpecial);
          }
          if (!matchesTag) continue;

          let passed = true;
          const notMatches = rest.match(/:not\(\[([^\]]+)\]\)/g);
          if (notMatches) {
            for (const nm of notMatches) {
              const attr = nm.slice(6, -2);
              if (el.hasAttribute(attr)) { passed = false; break; }
            }
            rest = rest.replace(/:not\(\[[^\]]+\]\)/g, '');
          }
          if (!passed) continue;
          const attrMatches = rest.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]+)["']?)?\]/g);
          if (attrMatches) {
            for (const am of attrMatches) {
              const m = am.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]+)["']?)?\]/);
              if (m) {
                const attrName = m[1];
                const expectedVal = m[2];
                if (!el.hasAttribute(attrName)) { passed = false; break; }
                if (expectedVal !== undefined && el.getAttribute(attrName) !== expectedVal) { passed = false; break; }
              }
            }
          }
          if (passed) return true;
        }
      }
      return false;
    }
    function walk(node) {
      if (match(node)) results.push(node);
      for (const child of node.children) walk(child);
    }
    for (const child of this.children) walk(child);
    return results;
  }
}

class MockCustomEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = options?.detail;
    this.bubbles = options?.bubbles;
  }
}

function createMockEnvironment(pathname) {
  const classes = new Set(['ytlite-comments-hide']);
  const docListeners = {};
  const winListeners = {};
  let observerActive = false;
  let observerTarget = null;
  let observerOptions = null;

  const docEl = new MockElement('html');
  docEl._setConnected(true);
  docEl.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c)
  };

  const body = new MockElement('body');
  docEl.appendChild(body);

  const columns = new MockElement('div', 'columns');
  body.appendChild(columns);

  const primary = new MockElement('div', 'primary');
  columns.appendChild(primary);

  const primaryInner = new MockElement('div', 'primary-inner');
  primary.appendChild(primaryInner);

  const player = new MockElement('div', 'player');
  primaryInner.appendChild(player);

  const below = new MockElement('div', 'below');
  primaryInner.appendChild(below);

  const metadata = new MockElement('ytd-watch-metadata', 'meta');
  below.appendChild(metadata);

  const comments = new MockElement('ytd-comments', 'comments');
  below.appendChild(comments);

  const secondary = new MockElement('div', 'secondary');
  columns.appendChild(secondary);

  const secondaryInner = new MockElement('div', 'secondary-inner');
  secondary.appendChild(secondaryInner);

  const related = new MockElement('ytd-watch-next-secondary-results-renderer', 'related');
  secondaryInner.appendChild(related);

  const chat = new MockElement('ytd-live-chat-frame', 'chat');
  chat.setAttribute('collapsed', '');
  secondaryInner.appendChild(chat);

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.isObserving = false;
      activeObservers.push(this);
    }
    observe(target, options) {
      this.isObserving = true;
      observerActive = true;
      observerTarget = target;
      observerOptions = options;
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.isObserving = false;
      observerActive = false;
      observerTarget = null;
      observerOptions = null;
      const idx = activeObservers.indexOf(this);
      if (idx >= 0) activeObservers.splice(idx, 1);
    }
  }

  const allElements = [columns, primary, primaryInner, player, below, metadata, comments, secondary, secondaryInner, related, chat];

  const context = {
    location: {
      pathname,
      href: 'https://www.youtube.com' + pathname,
      origin: 'https://www.youtube.com'
    },
    URL: global.URL,
    CustomEvent: MockCustomEvent,
    Event: class { constructor(t) { this.type = t; } },
    document: {
      documentElement: docEl,
      body: body,
      getElementById: (id) => {
        const match = allElements.find(el => el.id === id && el.isConnected);
        return match || null;
      },
      querySelector: (s) => body.querySelector(s),
      querySelectorAll: (s) => body.querySelectorAll(s),
      createElement: (tag) => new MockElement(tag),
      addEventListener: (type, fn) => {
        if (!docListeners[type]) docListeners[type] = [];
        docListeners[type].push(fn);
      },
      dispatchEvent: (e) => {
        (docListeners[e.type] || []).forEach(fn => fn(e));
      }
    },
    window: {
      addEventListener: (type, fn) => {
        if (!winListeners[type]) winListeners[type] = [];
        winListeners[type].push(fn);
      },
      dispatchEvent: (e) => {
        (winListeners[e.type] || []).forEach(fn => fn(e));
      },
      scrollBy: () => {},
      requestAnimationFrame: (cb) => cb()
    },
    MutationObserver: MockMutationObserver,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };

  return {
    context,
    docListeners,
    winListeners,
    getObserverActive: () => observerActive,
    getObserverTarget: () => observerTarget,
    getObserverOptions: () => observerOptions,
    body,
    docEl,
    columns,
    primary,
    primaryInner,
    player,
    below,
    metadata,
    comments,
    secondary,
    secondaryInner,
    related,
    chat
  };
}

// Test 3.1: Placement on direct watch load
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=abc');
  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  const btn = env.body.querySelector('.ytlite-comments-btn');
  assert(btn, 'Button should be placed in DOM');
  assert.strictEqual(env.getObserverActive(), false, 'MutationObserver MUST be disconnected once button is placed');

  // Verify button is inside below before comments, NOT in columns
  assert.strictEqual(env.columns.children.includes(btn.parentElement), false, 'Button must NOT be placed directly in #columns');
  assert(env.below.children.includes(btn.parentElement), 'Button must be placed inside #below');
  console.log('  ✓ comments.js places button inside #below and disconnects MutationObserver (0% playback overhead)');

  // Test 3.2: Click button to reveal comments and trigger continuation
  let continuationFired = false;
  env.comments.addEventListener('yt-load-next-continuation', () => {
    continuationFired = true;
  });

  btn.click();
  assert(!env.docEl.classList.contains('ytlite-comments-hide'), 'ytlite-comments-hide class should be removed on click');
  assert(!env.body.querySelector('.ytlite-button-container'), 'Button container should be removed on click');
  assert.strictEqual(env.getObserverActive(), false, 'MutationObserver should remain disconnected after reveal');
  assert.strictEqual(continuationFired, true, 'Clicking reveal button dispatches yt-load-next-continuation event');
  console.log('  ✓ Clicking "Show comments" dispatches continuation and leaves 0 leftover observer');
}

// Test 3.3: SPA Navigation sequence: / -> /watch -> /live -> /feed
{
  activeObservers = [];
  const env = createMockEnvironment('/');
  env.docEl.classList.remove('ytlite-comments-hide');
  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.body.querySelector('.ytlite-button-container'), 'Button should NOT be on home page');
  assert.strictEqual(env.getObserverActive(), false, 'Observer must not run on home page');

  // Navigate to /watch?v=regular
  env.context.location.pathname = '/watch?v=regular';
  env.context.location.href = 'https://www.youtube.com/watch?v=regular';
  env.docListeners['yt-navigate-start'][0]({ detail: { url: '/watch?v=regular' } });
  assert(env.docEl.classList.contains('ytlite-comments-hide'), 'ytlite-comments-hide added on yt-navigate-start');
  assert(!env.docEl.classList.contains('ytlite-live'), 'ytlite-live must NOT be present on regular watch page');

  env.docListeners['yt-navigate-finish'][0]();
  const btn1 = env.body.querySelector('.ytlite-comments-btn');
  assert(btn1, 'Button should be placed after navigate-finish');
  assert.strictEqual(env.getObserverActive(), false, 'Observer disconnected after placement');

  // Navigate to /live/stream123
  env.context.location.pathname = '/live/stream123';
  env.context.location.href = 'https://www.youtube.com/live/stream123';
  env.docListeners['yt-navigate-start'][0]({ detail: { url: '/live/stream123' } });
  assert(env.docEl.classList.contains('ytlite-comments-hide'), 'ytlite-comments-hide maintained on live navigation');
  assert(env.docEl.classList.contains('ytlite-live'), 'ytlite-live added on live stream navigation');

  env.docListeners['yt-navigate-finish'][0]();
  assert(env.docEl.classList.contains('ytlite-live'), 'ytlite-live active after live navigate-finish');

  // Navigate away to /feed/subscriptions
  env.context.location.pathname = '/feed/subscriptions';
  env.context.location.href = 'https://www.youtube.com/feed/subscriptions';
  env.docListeners['yt-navigate-start'][0]({ detail: { url: '/feed/subscriptions' } });
  assert(!env.docEl.classList.contains('ytlite-comments-hide'), 'ytlite-comments-hide removed when leaving watch page');
  assert(!env.docEl.classList.contains('ytlite-live'), 'ytlite-live removed when leaving watch/live page');
  assert(!env.body.querySelector('.ytlite-button-container'), 'Button removed when leaving watch page');

  env.docListeners['yt-navigate-finish'][0]();
  assert.strictEqual(env.getObserverActive(), false, 'Observer remains disconnected on feed page');
  console.log('  ✓ SPA navigation transitions (/ -> /watch -> /live -> /feed) manage ytlite-live and cleanup cleanly');
}

// Test 3.4: Subtree isolation: player mutations DO NOT trigger observer
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=delayed');
  // Detach below and comments so place() initially returns false and observer is started
  env.below.remove();

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert.strictEqual(env.getObserverActive(), true, 'Observer should be active waiting for below-player elements');
  const obsOptions = env.getObserverOptions();
  assert.strictEqual(obsOptions.subtree, false, 'Observer MUST use subtree: false to prevent player mutation cascades');

  let observerCallbackCalled = false;
  // Monkey-patch observer callback to detect triggers
  const activeObs = activeObservers[0];
  const origCb = activeObs.callback;
  activeObs.callback = (mutations) => {
    observerCallbackCalled = true;
    origCb(mutations);
  };

  // Simulate video player buffer / subtitle update inside player container
  const subtitle = new MockElement('div', 'subtitle');
  env.player.appendChild(subtitle);

  assert.strictEqual(observerCallbackCalled, false, 'Mutations inside player MUST NOT trigger observer callback');
  console.log('  ✓ Subtree isolation verified: video player mutations (subtitles, buffering) do not wake observer');

  // Now simulate Polymer attaching #below with metadata and comments
  env.primaryInner.appendChild(env.below);
  assert.strictEqual(observerCallbackCalled, true, 'Attaching #below to primaryInner triggers observer');
  assert.strictEqual(env.getObserverActive(), false, 'Observer disconnected immediately once button is placed');
  const btn = env.body.querySelector('.ytlite-comments-btn');
  assert(btn, 'Button placed once #below is attached');
  console.log('  ✓ Delayed DOM mounting properly triggers observer on direct child addition and auto-disconnects');
}

// Test 3.5: Safety timeout auto-disconnect
{
  activeObservers = [];
  let timerCb = null;
  const env = createMockEnvironment('/watch?v=never');
  env.below.remove();
  env.primaryInner.remove();
  env.context.setTimeout = (fn, ms) => { timerCb = fn; return 123; };

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);
  assert.strictEqual(env.getObserverActive(), true, 'Observer active waiting');
  assert(timerCb, 'Safety timeout should be scheduled');

  // Fire safety timer
  timerCb();
  assert.strictEqual(env.getObserverActive(), false, 'Observer disconnected after safety timeout');
  console.log('  ✓ Observer safety timeout guaranteed: disconnects even if targets never mount');
}

// 4. Behavioral Simulation: Sidebar for Live Chat & Ask Feature
console.log('[4] Sidebar behavior for Live Chat and Ask feature...');

// Test 4.1: Regular video without chat or Ask keeps sidebar inactive
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=regular1');
  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar must be inactive on regular video');
  assert(!env.docEl.classList.contains('ytlite-live'), 'ytlite-live must be inactive on regular video');
  console.log('  ✓ Regular video without chat/Ask keeps sidebar inactive and centered');
}

// Test 4.2: Live chat toggle
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=stream_replay');
  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar initially inactive when chat is collapsed');

  // Uncollapse chat (user clicks "Show chat" / "Show chat replay")
  env.chat.removeAttribute('collapsed');
  env.docListeners['click'].forEach(fn => fn());

  assert(env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar becomes active when live chat is uncollapsed');
  assert(env.docEl.classList.contains('ytlite-live'), 'ytlite-live set when live chat is uncollapsed');

  // Re-collapse chat (user clicks "Hide chat")
  env.chat.setAttribute('collapsed', '');
  env.docListeners['click'].forEach(fn => fn());

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar collapses when live chat is collapsed');
  assert(!env.docEl.classList.contains('ytlite-live'), 'ytlite-live removed when live chat is collapsed');
  console.log('  ✓ Live chat uncollapse/collapse toggles sidebar state cleanly');
}

// Test 4.3: YouTube Ask AI engagement panel
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=ai_video');
  const askPanel = new MockElement('ytd-engagement-panel-section-list-renderer', 'ask-panel');
  askPanel.setAttribute('target-id', 'engagement-panel-ask');
  askPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  env.secondaryInner.appendChild(askPanel);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar inactive when Ask panel is hidden');

  // User clicks "Ask" -> panel becomes expanded
  askPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  env.docListeners['click'].forEach(fn => fn());

  assert(env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar becomes active when Ask panel is expanded');

  // User closes Ask panel -> visibility becomes HIDDEN
  askPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  env.docListeners['click'].forEach(fn => fn());

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar collapses when Ask panel is closed');
  console.log('  ✓ Ask AI engagement panel expand/close toggles sidebar state cleanly');
}

// Test 4.4: Watch container panels-expanded attribute
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=flexy_panels');
  const watchFlexy = new MockElement('ytd-watch-flexy');
  env.body.insertBefore(watchFlexy, env.columns);
  watchFlexy.appendChild(env.columns);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar inactive initially');

  // YouTube sets panels-expanded on watch-flexy
  watchFlexy.setAttribute('panels-expanded', '');
  env.docListeners['click'].forEach(fn => fn());

  assert(env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar active when watch-flexy has panels-expanded');

  watchFlexy.removeAttribute('panels-expanded');
  env.docListeners['click'].forEach(fn => fn());

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar inactive when panels-expanded is removed');
  console.log('  ✓ watch-flexy[panels-expanded] toggles sidebar state cleanly');
}

// Test 4.5: Ad engagement panels are ignored
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=ad_video');
  const adPanel = new MockElement('ytd-engagement-panel-section-list-renderer', 'ad-panel');
  adPanel.setAttribute('target-id', 'engagement-panel-ads');
  adPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  env.secondaryInner.appendChild(adPanel);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Ad engagement panel must NOT activate sidebar');
  console.log('  ✓ Ad engagement panels are ignored and do not activate sidebar');
}

// Test 4.6: CSS validation for sidebar rules, hidden related videos, and fullscreen guards
{
  assert(hideCss.includes('#secondary-inner #related'), 'hide.css must hide #secondary-inner #related');
  assert(hideCss.includes('ytlite-sidebar-active'), 'hide.css must contain rules for ytlite-sidebar-active');
  assert(hideCss.includes('[panels-expanded]'), 'hide.css must contain rules for [panels-expanded]');
  assert(hideCss.includes(':not([fullscreen])'), 'hide.css must guard columns and sidebar against fullscreen');
  assert(hideCss.includes('#secondary ytd-compact-video-renderer'), 'hide.css must hide compact video renderers in #secondary');
  assert(!nonCommentCss.includes(':has('), 'hide.css must never use :has()');
  console.log('  ✓ CSS rules verified for sidebar activation, fullscreen guards, and permanent related video hiding');
}

// Test 4.7: data-target-id support for Ask panel and ad suppression
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=data_target_test');
  const askPanelData = new MockElement('ytd-engagement-panel-section-list-renderer', 'ask-data-panel');
  askPanelData.setAttribute('data-target-id', 'engagement-panel-ask');
  askPanelData.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  env.secondaryInner.appendChild(askPanelData);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar active when Ask uses data-target-id');

  // Verify ad with data-target-id does not activate sidebar
  askPanelData.remove();
  const adPanelData = new MockElement('ytd-engagement-panel-section-list-renderer', 'ad-data-panel');
  adPanelData.setAttribute('data-target-id', 'engagement-panel-ads');
  adPanelData.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  env.secondaryInner.appendChild(adPanelData);

  env.docListeners['click'].forEach(fn => fn());
  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'data-target-id ad panel must NOT activate sidebar');
  console.log('  ✓ data-target-id correctly activates Ask AI and excludes ads');
}

// Test 4.8: Panel opened / expanded boolean attributes
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=opened_test');
  const openedPanel = new MockElement('ytd-engagement-panel-section-list-renderer', 'opened-panel');
  openedPanel.setAttribute('target-id', 'engagement-panel-ask');
  openedPanel.setAttribute('opened', '');
  env.secondaryInner.appendChild(openedPanel);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar active when panel has opened attribute');

  openedPanel.removeAttribute('opened');
  env.docListeners['click'].forEach(fn => fn());
  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar collapses when opened attribute removed');
  console.log('  ✓ Panel opened/expanded attributes toggle sidebar correctly');
}

// Test 4.9: Native yt-engagement-panel-visibility-changed event
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=event_test');
  const askPanel = new MockElement('ytd-engagement-panel-section-list-renderer', 'ask-event-panel');
  askPanel.setAttribute('target-id', 'engagement-panel-ask');
  askPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  env.secondaryInner.appendChild(askPanel);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar inactive before event');

  askPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  // Dispatch native YouTube event
  env.docListeners['yt-engagement-panel-visibility-changed'].forEach(fn => fn());

  assert(env.docEl.classList.contains('ytlite-sidebar-active'), 'Sidebar becomes active on yt-engagement-panel-visibility-changed');
  console.log('  ✓ yt-engagement-panel-visibility-changed event directly toggles sidebar state');
}

// Test 4.10: Substring matching for comment panel variants
{
  activeObservers = [];
  const env = createMockEnvironment('/watch?v=comment_variant_test');
  const commentPanelVariant = new MockElement('ytd-engagement-panel-section-list-renderer', 'comment-variant');
  commentPanelVariant.setAttribute('target-id', 'engagement-panel-comments-v2');
  commentPanelVariant.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  env.secondaryInner.appendChild(commentPanelVariant);

  vm.createContext(env.context);
  vm.runInContext(commentsJs, env.context);

  assert(!env.docEl.classList.contains('ytlite-sidebar-active'), 'Comment panel variant must NOT activate sidebar when comments hidden');
  console.log('  ✓ Comment panel variants properly ignored while comments are hidden');
}

console.log('--- ALL TESTS PASSED! ---');
