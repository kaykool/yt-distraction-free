#!/usr/bin/env bun
// Differential test: the Bun DOM shim must resolve the selectors the extension
// actually uses the same way real Blink does. A synthetic tree is built with the
// identical markup in both engines and the results are compared.
//
// Lives in bench/ (not test/) on purpose: unlike the unit suite it launches a real
// browser, so `bun test` stays browser-free. Run it with `bun run test:blink`.
import { test, expect, describe } from 'bun:test';
import { Node, Document } from '../test/dom.js';
import { launchPage } from './browser.js';

const MARKUP = `
  <ytd-watch-flexy id="wf" live panels-expanded>
    <div id="columns">
      <div id="primary"><div id="primary-inner"><div id="below">
        <ytd-watch-metadata id="meta"></ytd-watch-metadata>
        <ytd-comments id="comments">
          <ytd-continuation-item-renderer><button id="more">Load</button></ytd-continuation-item-renderer>
        </ytd-comments>
      </div></div></div>
      <div id="secondary"><div id="secondary-inner">
        <ytd-watch-next-secondary-results-renderer id="related"></ytd-watch-next-secondary-results-renderer>
        <ytd-live-chat-frame id="chat" collapsed></ytd-live-chat-frame>
        <iframe id="chatframe" hidden></iframe>
        <div id="panels">
          <ytd-engagement-panel-section-list-renderer id="pc" target-id="engagement-panel-comments-section"></ytd-engagement-panel-section-list-renderer>
          <ytd-engagement-panel-section-list-renderer id="pa" target-id="engagement-panel-ads" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></ytd-engagement-panel-section-list-renderer>
        </div>
      </div></div>
    </div>
    <div id="pco"><div id="pci"><div id="player"><div id="ytd-player">
      <div id="movie_player" class="html5-video-player">
        <div class="ytp-right-controls"><div class="ytp-autonav-toggle-button-container"></div></div>
        <div class="ytp-ambient-canvas"></div>
      </div>
    </div></div></div></div>
    <script>var x = 1;</script>
  </ytd-watch-flexy>
`;

const SELECTORS = [
  '#comments', 'ytd-comments',
  'ytd-item-section-renderer[section-identifier="comment-item-section"]',
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]',
  'ytd-watch-flexy, ytd-watch-grid', '#primary', '#primary-inner', '#below', '#secondary', '#secondary-inner', '#columns',
  'ytd-live-chat-frame, #chat', '#chatframe',
  'ytd-watch-metadata, #below ytd-watch-metadata',
  'ytd-engagement-panel-section-list-renderer',
  'ytd-watch-flexy[live]', 'ytd-watch-flexy[is-live]', 'ytd-watch-flexy[panels-expanded]',
  'ytd-live-chat-frame[collapsed]',
  '[target-id*="comment"]', '[data-target-id*="comment"]',
  'script:not([src])',
  '.html5-video-player', '#movie_player', '#ytd-player', '#player', '#player-container-outer',
  '.ytp-right-controls', '.ytp-autonav-toggle-button-container',
  '#panels ytd-engagement-panel-section-list-renderer',
  '#not-present', 'ytd-nonexistent',
];

// --- build the same tree in the Bun shim by parsing the markup ---
function parseInto(doc, html) {
  const tokens = html.match(/<\/?[^>]+>|[^<]+/g) || [];
  const stack = [doc.body];
  for (const tok of tokens) {
    if (tok.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (tok.startsWith('<')) {
      const name = tok.match(/^<([a-zA-Z][\w-]*)/)[1];
      const node = doc.createElement(name);
      const attrs = tok.matchAll(/([\w:-]+)(?:="([^"]*)")?/g);
      let first = true;
      for (const [, k, v] of attrs) {
        if (first) { first = false; continue; } // skip tag name
        node.setAttribute(k, v === undefined ? '' : v);
      }
      stack[stack.length - 1].appendChild(node);
      if (!tok.endsWith('/>') && !/^(script|iframe)$/i.test(name)) stack.push(node);
      else if (/^(script|iframe)$/i.test(name) && !tok.endsWith('/>') && !tok.includes('</')) stack.push(node);
      continue;
    }
    const text = tok.trim();
    if (text) stack[stack.length - 1].textContent += text;
  }
  return doc;
}

function blobResults(docObject) {
  return Object.fromEntries(SELECTORS.map((s) => [s, docObject.querySelectorAll(s).length]));
}

describe('DOM shim vs Blink: selector parity', () => {
  test('selectors used by the extension resolve identically in both engines', async () => {
    // Shim side
    const shimDoc = new Document();
    parseInto(shimDoc, MARKUP);
    const shimRes = blobResults(shimDoc);

    // Blink side
    const page = await launchPage({ port: 9631, profileDir: '/tmp/domtest-prof' });
    let blinkRes;
    try {
      await page.goto('about:blank');
      blinkRes = await page.evaluate(`(() => {
        document.body.innerHTML = ${JSON.stringify(MARKUP)};
        const sels = ${JSON.stringify(SELECTORS)};
        return Object.fromEntries(sels.map((s) => {
          try { return [s, document.querySelectorAll(s).length]; }
          catch (e) { return [s, 'ERR:' + e.message]; }
        }));
      })()`);
    } finally {
      await page.close();
    }

    for (const sel of SELECTORS) {
      expect({ sel, count: shimRes[sel] }).toEqual({ sel, count: blinkRes[sel] });
    }
  }, 60000);
});
