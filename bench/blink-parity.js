#!/usr/bin/env bun
// Differential test: the Bun DOM shim must resolve the selectors the extension
// actually uses the same way real Blink does. A synthetic tree is built with the
// identical markup in both engines and the results are compared.
//
// Lives in bench/ (not test/) on purpose: unlike the unit suite it launches a real
// browser, so `bun test` stays browser-free. Run it with `bun run test:blink`.
import { test, expect, describe } from 'bun:test';
import { Document } from '../test/dom.js';
import { launchPage } from './browser.js';
import { extractSelectors } from './verify-dom.js';

const MARKUP = `
  <ytd-masthead id="masthead" class="masthead-host">
    <div id="masthead-container">
      <div id="background" class="ytd-masthead"></div>
      <div id="search-form"><ytd-searchbox><div id="container" class="ytd-searchbox"></div></ytd-searchbox></div>
    </div>
  </ytd-masthead>
  <tp-yt-app-header><div id="background"></div></tp-yt-app-header>
  <ytd-feed-filter-chip-bar-renderer>
    <div id="chips-wrapper"><div id="chips-content">
      <yt-chip-cloud-renderer id="chips"><yt-chip-cloud-chip-renderer></yt-chip-cloud-chip-renderer></yt-chip-cloud-renderer>
    </div></div>
  </ytd-feed-filter-chip-bar-renderer>
  <ytd-app>
    <div id="content">
      <ytd-page-manager id="page-manager">
        <ytd-watch-flexy id="wf" live is-live is-two-columns_ panels-expanded live-chat-present-and-expanded should-stamp-chat video-id="live1">
          <div id="columns">
            <div id="primary"><div id="primary-inner">
              <div id="player-container-outer"><div id="player-container-inner"><div id="player"><div id="ytd-player">
                <div id="movie_player" class="html5-video-player">
                  <video></video>
                  <div class="ytp-right-controls">
                    <button class="ytp-button ytlite-video-toggle-btn ytlite-ao" type="button"></button>
                    <div class="ytp-autonav-toggle-button-container"></div>
                  </div>
                  <div class="ytp-live-badge ytp-live-badge-is-livehead" disabled></div>
                  <div class="ytp-ambient-canvas"></div>
                  <div class="ytp-bezel"><div class="ytp-bezel-text-wrapper"></div></div>
                  <div class="ytp-suggested-action"></div>
                </div>
              </div></div></div></div>
              <div id="below">
                <ytd-watch-metadata id="meta"></ytd-watch-metadata>
                <div class="ytlite-button-container">
                  <button class="ytlite-comments-btn" type="button" aria-label="Show chat">Show chat</button>
                </div>
                <div id="teaser-carousel"><button type="button">Open</button></div>
                <yt-video-metadata-carousel-view-model><div role="button">Open</div></yt-video-metadata-carousel-view-model>
                <ytd-structured-description-content-renderer id="info-contents">
                  <ytd-video-description-transcript-section-renderer></ytd-video-description-transcript-section-renderer>
                  <ytd-video-description-infocards-section-renderer></ytd-video-description-infocards-section-renderer>
                  <ytd-video-description-music-section-renderer></ytd-video-description-music-section-renderer>
                  <ytd-video-description-course-section-renderer></ytd-video-description-course-section-renderer>
                  <ytd-horizontal-card-list-renderer></ytd-horizontal-card-list-renderer>
                  <yt-video-attribute-view-model></yt-video-attribute-view-model>
                  <ytd-compact-infocard-renderer></ytd-compact-infocard-renderer>
                  <ytd-media-lockup-renderer></ytd-media-lockup-renderer>
                  <ytd-metadata-row-container-renderer></ytd-metadata-row-container-renderer>
                  <ytd-expandable-metadata-renderer></ytd-expandable-metadata-renderer>
                  <ytd-reel-shelf-renderer></ytd-reel-shelf-renderer>
                  <div id="footer-section"></div>
                </ytd-structured-description-content-renderer>
                <ytd-ticket-shelf-renderer id="ticket-shelf"></ytd-ticket-shelf-renderer>
                <ytd-merch-shelf-renderer></ytd-merch-shelf-renderer>
                <ytd-product-shelf-renderer></ytd-product-shelf-renderer>
                <ytd-comments id="comments">
                  <ytd-item-section-renderer section-identifier="comment-item-section"></ytd-item-section-renderer>
                  <ytd-continuation-item-renderer>
                    <button id="more">Load</button>
                    <tp-yt-paper-button>More</tp-yt-paper-button>
                    <div role="button">Next</div>
                  </ytd-continuation-item-renderer>
                </ytd-comments>
              </div>
            </div></div>
            <div id="secondary"><div id="secondary-inner">
              <ytd-watch-next-secondary-results-renderer id="related"></ytd-watch-next-secondary-results-renderer>
              <div id="nested-wrap">
                <ytd-watch-next-secondary-results-renderer class="nested-related"></ytd-watch-next-secondary-results-renderer>
              </div>
              <ytd-compact-video-renderer></ytd-compact-video-renderer>
              <ytd-compact-radio-renderer></ytd-compact-radio-renderer>
              <ytd-compact-playlist-renderer></ytd-compact-playlist-renderer>
              <ytd-item-section-renderer section-identifier="related-items"></ytd-item-section-renderer>
              <ytd-ad-slot-renderer></ytd-ad-slot-renderer>
              <ytd-in-feed-ad-layout-renderer></ytd-in-feed-ad-layout-renderer>
              <ytd-live-chat-frame id="chat" collapsed hide-chat-frame>
                <ytd-message-renderer><yt-formatted-string id="message">Disabled</yt-formatted-string></ytd-message-renderer>
              </ytd-live-chat-frame>
              <iframe id="chatframe" hidden></iframe>
              <div id="show-hide-button"><button type="button">Show chat</button></div>
              <div id="panels">
                <ytd-engagement-panel-section-list-renderer id="pc" target-id="engagement-panel-comments-section" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" hidden></ytd-engagement-panel-section-list-renderer>
                <ytd-engagement-panel-section-list-renderer id="pc2" data-target-id="engagement-panel-comments-section" opened></ytd-engagement-panel-section-list-renderer>
                <ytd-engagement-panel-section-list-renderer id="pa" target-id="engagement-panel-ads" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></ytd-engagement-panel-section-list-renderer>
                <ytd-engagement-panel-section-list-renderer id="pa2" data-target-id="engagement-panel-ads" expanded></ytd-engagement-panel-section-list-renderer>
                <ytd-engagement-panel-section-list-renderer id="pask" target-id="engagement-panel-structured-description" is-expanded></ytd-engagement-panel-section-list-renderer>
              </div>
            </div></div>
          </div>
          <script>var x = 1;</script>
        </ytd-watch-flexy>
        <ytd-watch-flexy id="wf-theater" theater>
          <div id="columns"><div id="primary"><div id="player-container-outer"></div></div><div id="secondary"></div></div>
        </ytd-watch-flexy>
        <ytd-watch-grid id="wg-full" fullscreen panels-expanded>
          <div id="columns"><div id="primary"><div id="player" class="skeleton"><div id="player-wrap"><div id="player-api"><div id="player-placeholder"></div></div></div></div></div><div id="secondary"></div></div>
        </ytd-watch-grid>
        <div id="watch-page-skeleton"><div id="container"><div id="info-container"></div></div></div>
        <ytd-rich-item-renderer></ytd-rich-item-renderer>
        <ytd-grid-video-renderer></ytd-grid-video-renderer>
        <ytd-video-renderer></ytd-video-renderer>
        <ytd-playlist-renderer></ytd-playlist-renderer>
        <ytd-channel-renderer></ytd-channel-renderer>
        <ytd-post-renderer></ytd-post-renderer>
        <tp-yt-paper-dialog></tp-yt-paper-dialog>
        <ytd-popup-container></ytd-popup-container>
        <ytd-menu-popup-renderer></ytd-menu-popup-renderer>
        <tp-yt-iron-dropdown></tp-yt-iron-dropdown>
        <yt-button-shape class="yt-spec-button-shape-next"></yt-button-shape>
        <badge-shape class="ytBadgeShapeHost"></badge-shape>
        <paper-ripple></paper-ripple>
        <yt-interaction></yt-interaction>
        <tp-yt-paper-tooltip></tp-yt-paper-tooltip>
      </ytd-page-manager>
    </div>
  </ytd-app>
`;

function collectSelectors() {
  const set = new Set(extractSelectors());
  for (const extra of [
    'ytd-app',
    'ytd-page-manager',
    '#page-manager',
    'ytd-page-manager, #page-manager',
    '#content',
    'ytd-app #content > ytd-page-manager > ytd-watch-flexy',
    '#secondary > ytd-watch-next-secondary-results-renderer',
    '#secondary>ytd-watch-next-secondary-results-renderer',
    '#primary-inner + #secondary',
    '#related + #nested-wrap',
    '#related ~ #panels',
    'ytd-watch-flexy:not([fullscreen]):not([theater]) #player-container-outer',
    'ytd-watch-flexy:not([fullscreen]):not([theater]) #movie_player',
    'ytd-watch-grid:not([fullscreen]):not([theater]) #player',
    'ytd-watch-flexy[live]',
    'ytd-watch-flexy[is-live]',
    'ytd-watch-flexy[live-chat-present-and-expanded]',
    'ytd-watch-flexy[should-stamp-chat]',
    'ytd-watch-flexy[panels-expanded]',
    'ytd-watch-flexy[video-id="live1"]',
    '.ytp-live-badge[disabled]',
    '.ytp-live-badge.ytp-live-badge-is-livehead',
    'ytd-live-chat-frame, #chat',
    'ytd-live-chat-frame[collapsed]',
    'ytd-live-chat-frame[hide-chat-frame]',
    'ytd-live-chat-frame[hidden]',
    'ytd-message-renderer',
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
    'ytd-engagement-panel-section-list-renderer[opened]',
    'ytd-engagement-panel-section-list-renderer[expanded]',
    'ytd-engagement-panel-section-list-renderer[is-expanded]',
    'ytd-engagement-panel-section-list-renderer:not([target-id*="ad"]):not([hidden])',
    '#chatframe[hidden]',
    'script:not([src])',
    '#not-present',
    'ytd-nonexistent',
  ]) {
    set.add(extra);
  }
  return [...set].sort();
}

const SELECTORS = collectSelectors();

const HTML_CLASSES = [
  'ytlite-comments-hide',
  'ytlite-live',
  'ytlite-sidebar-active',
  'ytlite-video-blocked',
];

// --- build the same tree in the Bun shim by parsing the markup ---
function parseInto(doc, html) {
  const tokens = html.match(/<\/?[^>]+>|[^<]+/g) || [];
  const stack = [doc.body];
  for (const tok of tokens) {
    if (tok.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tok.startsWith('<')) {
      const name = tok.match(/^<([a-zA-Z][\w-]*)/)[1];
      const node = doc.createElement(name);
      const attrs = tok.matchAll(/([\w:-]+)(?:="([^"]*)")?/g);
      let first = true;
      for (const [, k, v] of attrs) {
        if (first) {
          first = false;
          continue;
        } // skip tag name
        node.setAttribute(k, v === undefined ? '' : v);
      }
      stack[stack.length - 1].appendChild(node);
      if (!tok.endsWith('/>') && !/^(script|iframe)$/i.test(name))
        stack.push(node);
      else if (
        /^(script|iframe)$/i.test(name) &&
        !tok.endsWith('/>') &&
        !tok.includes('</')
      )
        stack.push(node);
      continue;
    }
    const text = tok.trim();
    if (text) stack[stack.length - 1].textContent += text;
  }
  return doc;
}

function blobResults(docObject) {
  return Object.fromEntries(
    SELECTORS.map((s) => [s, docObject.querySelectorAll(s).length])
  );
}

describe('DOM shim vs Blink: selector parity', () => {
  test('selectors used by the extension resolve identically in both engines', async () => {
    // Shim side
    const shimDoc = new Document();
    for (const c of HTML_CLASSES) shimDoc.documentElement.classList.add(c);
    parseInto(shimDoc, MARKUP);
    const shimRes = blobResults(shimDoc);

    const shimExtra = (() => {
      const chatIframe = shimDoc.getElementById('chatframe');
      const hiddenBeforeRemove = chatIframe.hidden;
      chatIframe.removeAttribute('hidden');
      const hiddenAfterRemove = chatIframe.hidden;
      chatIframe.hidden = true;
      const hiddenAfterSetter = chatIframe.hasAttribute('hidden');
      const wf = shimDoc.getElementById('wf');
      wf.classList.add('tmp-a', 'tmp-b');
      const hadClassAttr = wf.hasAttribute('class');
      wf.removeAttribute('class');
      return {
        hiddenBeforeRemove,
        hiddenAfterRemove,
        hiddenAfterSetter,
        hadClassAttr,
        classAfterRemove: wf.className,
        hasTmpA: wf.classList.contains('tmp-a'),
        hasClassAttrAfterRemove: wf.hasAttribute('class'),
      };
    })();

    // Blink side
    const page = await launchPage({
      port: 9631,
      profileDir: '/tmp/domtest-prof',
    });
    let blinkRes;
    let blinkExtra;
    try {
      await page.goto('about:blank');
      const out = await page.evaluate(`(() => {
        for (const c of ${JSON.stringify(HTML_CLASSES)}) document.documentElement.classList.add(c);
        document.body.innerHTML = ${JSON.stringify(MARKUP)};
        const sels = ${JSON.stringify(SELECTORS)};
        const res = Object.fromEntries(sels.map((s) => {
          try { return [s, document.querySelectorAll(s).length]; }
          catch (e) { return [s, 'ERR:' + e.message]; }
        }));
        const chatIframe = document.getElementById('chatframe');
        const hiddenBeforeRemove = chatIframe.hidden;
        chatIframe.removeAttribute('hidden');
        const hiddenAfterRemove = chatIframe.hidden;
        chatIframe.hidden = true;
        const hiddenAfterSetter = chatIframe.hasAttribute('hidden');
        const wf = document.getElementById('wf');
        wf.classList.add('tmp-a', 'tmp-b');
        const hadClassAttr = wf.hasAttribute('class');
        wf.removeAttribute('class');
        const extra = {
          hiddenBeforeRemove,
          hiddenAfterRemove,
          hiddenAfterSetter,
          hadClassAttr,
          classAfterRemove: wf.className,
          hasTmpA: wf.classList.contains('tmp-a'),
          hasClassAttrAfterRemove: wf.hasAttribute('class'),
        };
        return { res, extra };
      })()`);
      blinkRes = out.res;
      blinkExtra = out.extra;
    } finally {
      await page.close();
    }

    for (const sel of SELECTORS) {
      expect({ sel, count: shimRes[sel] }).toEqual({
        sel,
        count: blinkRes[sel],
      });
    }
    expect(shimExtra).toEqual(blinkExtra);
  }, 60000);
});
