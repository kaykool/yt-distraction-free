#!/usr/bin/env bun
// Behavioral CSS verification (AGENTS.md §5).
//
// `verify:dom` proves every selector still PARSES and that the page still has the
// anchor elements it targets. It cannot prove a rule still APPLIES: rewriting a
// selector to a class that never matches keeps 100% of selectors "valid" while the
// comments render in plain sight. This script closes that hole by loading the real
// extension into Chrome and asserting computed styles and geometry.
//
// Nothing here reads the YouTube DOM shape for correctness, only for presence.
// YouTube class names change; the properties below are the ones the extension
// promises, so a failure means a promise is broken, not that the DOM moved.
//
// Usage: bun run verify:css [url]
import path from 'node:path';
import { launchPage } from './browser.js';

const EXT_DIR = path.resolve(import.meta.dir, '..');
const URL = process.argv[2] || process.env.VERIFY_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS || 9000);
const PLAYER_MAX_W = 854;
const PLAYER_MAX_H = 480;

// Pages differ in which promises apply. A live stream intentionally suppresses the
// comments reveal button, so button checks are only required on regular videos.
// This is a page-state distinction, not a weaker assertion: on a regular video the
// button is still mandatory.
const NOT_LIVE = `!(document.documentElement.classList.contains('ytlite-live') || location.pathname.startsWith('/live'))`;

const CHECKS = [
  {
    name: 'comments hidden by default',
    why: 'AGENTS.md §4: comments collapsed by default (.ytlite-comments-hide)',
    run: `(() => {
      if (!(${NOT_LIVE})) {
        // Live pages deliberately trade comments for chat, so the hidden class is absent.
        return { ok: true, detail: 'live page: comments not hidden by design (ok)' };
      }
      if (!document.documentElement.classList.contains('ytlite-comments-hide')) {
        return { ok: false, detail: 'html lacks ytlite-comments-hide' };
      }
      const el = document.querySelector('#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]');
      if (!el) return { ok: false, detail: 'no comments container found' };
      const d = getComputedStyle(el).display;
      return { ok: d === 'none', detail: '#comments display=' + d };
    })()`,
  },
  {
    name: 'related sidebar hidden for normal videos',
    why: 'AGENTS.md §4: #secondary hidden by default',
    run: `(() => {
      const el = document.querySelector('#secondary');
      if (!el) return { ok: false, detail: 'no #secondary' };
      const d = getComputedStyle(el).display;
      return { ok: d === 'none', detail: '#secondary display=' + d };
    })()`,
  },
  {
    name: 'related-video renderer hidden',
    why: 'sidebar recommendations must not render inside the sidebar either',
    run: `(() => {
      const el = document.querySelector('#secondary > ytd-watch-next-secondary-results-renderer, #related, #secondary ytd-item-section-renderer[section-identifier="related-items"]');
      if (!el) return { ok: true, detail: 'not mounted on this page (ok)' };
      const d = getComputedStyle(el).display;
      return { ok: d === 'none', detail: 'related display=' + d };
    })()`,
  },
  {
    name: 'ambient canvas disabled',
    why: 'AGENTS.md §3: no ambient/GPU effects',
    // The canvas is absent from many YouTube builds, so its absence proves nothing.
    // A probe element is injected instead: the rule must neutralise it either way.
    run: `(() => {
      const el = document.createElement('div');
      el.className = 'ytp-ambient-canvas';
      document.body.appendChild(el);
      const d = getComputedStyle(el).display;
      el.remove();
      return { ok: d === 'none', detail: 'injected .ytp-ambient-canvas display=' + d };
    })()`,
  },
  {
    name: 'player clamped to 854x480',
    why: 'AGENTS.md §4: player max-width 854px, max-height 480px',
    // Assert the computed clamp itself. Measuring the rendered box is not enough:
    // #primary already constrains width, so a removed clamp is invisible there.
    run: `(() => {
      const el = document.querySelector('#player-container-outer, #player-container-inner, #player, #ytd-player, .html5-video-player');
      if (!el) return { ok: false, detail: 'no player container' };
      const s = getComputedStyle(el);
      const mw = s.maxWidth, mh = s.maxHeight;
      const okW = mw === '${PLAYER_MAX_W}px' || mw === 'none';
      const okH = mh === '${PLAYER_MAX_H}px' || mh === 'none';
      // At least one container in the chain must carry the clamp.
      const chain = ['#player-container-outer', '#player-container-inner', '#ytd-player', '.html5-video-player']
        .map((sel) => document.querySelector(sel))
        .filter(Boolean)
        .map((n) => getComputedStyle(n));
      const hasW = chain.some((c) => c.maxWidth === '${PLAYER_MAX_W}px');
      const hasH = chain.some((c) => c.maxHeight === '${PLAYER_MAX_H}px');
      return { ok: hasW && hasH, detail: 'probe maxW=' + mw + ' maxH=' + mh + ' chainHasW=' + hasW + ' chainHasH=' + hasH };
    })()`,
  },
  {
    name: 'sidebar CSS reveals #secondary when active',
    why: 'AGENTS.md §4: sidebar revealed for live chat / engagement panels',
    // verify:css defaults to a normal video where the sidebar must stay hidden, so
    // the reveal rule is exercised by toggling the class the extension sets.
    run: `(() => {
      const html = document.documentElement;
      const el = document.querySelector('#secondary');
      if (!el) return { ok: false, detail: 'no #secondary' };
      const before = getComputedStyle(el).display;
      const hadClass = html.classList.contains('ytlite-sidebar-active');
      html.classList.add('ytlite-sidebar-active');
      const during = getComputedStyle(el).display;
      if (!hadClass) html.classList.remove('ytlite-sidebar-active');
      const after = getComputedStyle(el).display;
      const ok = before === 'none' && during !== 'none' && after === 'none';
      return { ok, detail: 'hidden=' + before + ' active=' + during + ' restored=' + after };
    })()`,
  },
  {
    name: 'no unintended horizontal overflow',
    why: 'layout must not push the page wider than the viewport',
    run: `(() => {
      const de = document.documentElement;
      const over = de.scrollWidth - de.clientWidth;
      return { ok: over <= 2, detail: 'scrollWidth-clientWidth=' + over };
    })()`,
  },
  {
    name: 'reveal button mounted',
    why: 'AGENTS.md §4: comments rendered on demand via .ytlite-comments-btn',
    run: `(() => {
      if (${NOT_LIVE} === false) {
        const suppressed = !document.querySelector('.ytlite-comments-btn');
        return { ok: suppressed, detail: 'live page: button correctly suppressed=' + suppressed };
      }
      const btn = document.querySelector('.ytlite-comments-btn');
      if (!btn) return { ok: false, detail: 'no .ytlite-comments-btn' };
      return { ok: true, detail: 'label=' + JSON.stringify(btn.textContent) };
    })()`,
  },
  {
    name: 'reveal button sits below the metadata',
    why: 'button must render under the video, not above the title',
    run: `(() => {
      if (!(${NOT_LIVE})) return { ok: true, detail: 'live page: no button to place (ok)' };
      const btn = document.querySelector('.ytlite-button-container');
      const meta = document.querySelector('ytd-watch-metadata');
      if (!btn || !meta) return { ok: false, detail: 'button or metadata missing' };
      const rb = btn.getBoundingClientRect(), rm = meta.getBoundingClientRect();
      return { ok: rb.top >= rm.top, detail: 'btn.top=' + Math.round(rb.top) + ' meta.top=' + Math.round(rm.top) };
    })()`,
  },
  {
    name: 'reveal button precedes the comments container',
    why: 'the button is the way to reveal comments, so it must come before them in document order',
    run: `(() => {
      if (!(${NOT_LIVE})) return { ok: true, detail: 'live page: no button to place (ok)' };
      const btn = document.querySelector('.ytlite-button-container');
      if (!btn) return { ok: false, detail: 'no button container' };
      const comments = document.querySelector('#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]');
      if (!comments) return { ok: true, detail: 'no comments container to compare (ok)' };
      const rel = btn.compareDocumentPosition(comments);
      const precedes = Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING);
      return { ok: precedes, detail: 'buttonPrecedesComments=' + precedes };
    })()`,
  },
  {
    name: 'audio-only toggle mounted beside autoplay',
    why: 'block-video control must live in the player control overlay',
    run: `(() => {
      const btn = document.querySelector('.ytlite-video-toggle-btn');
      if (!btn) return { ok: false, detail: 'no .ytlite-video-toggle-btn' };
      const inControls = !!btn.closest('.ytp-right-controls');
      const s = getComputedStyle(btn);
      return { ok: inControls && s.display !== 'none', detail: 'inRightControls=' + inControls + ' display=' + s.display };
    })()`,
  },
  {
    name: 'masthead is opaque (no blur/alpha)',
    why: 'AGENTS.md §3: no backdrop filters on YouTube chrome',
    run: `(() => {
      const el = document.querySelector('ytd-masthead, #masthead-container');
      if (!el) return { ok: false, detail: 'no masthead' };
      const s = getComputedStyle(el);
      const bf = s.backdropFilter || s.webkitBackdropFilter || 'none';
      return { ok: bf === 'none', detail: 'backdrop-filter=' + bf };
    })()`,
  },
];

async function main() {
  console.log(`Behavioral CSS check against ${URL}\n`);
  const page = await launchPage({ port: 9651, extensionDir: EXT_DIR, profileDir: '/tmp/ytlite-verify-css' });
  let failures = 0;
  try {
    await page.goto(URL);
    await page.evaluate(`new Promise((resolve) => {
      const ready = () => document.querySelector('ytd-watch-flexy, ytd-watch-grid') && document.querySelector('#below');
      if (ready()) return resolve(true);
      const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); resolve(true); } });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(false); }, ${SETTLE_MS});
    })`);
    await Bun.sleep(1500);

    for (const check of CHECKS) {
      let res;
      try {
        res = await page.evaluate(check.run);
      } catch (err) {
        res = { ok: false, detail: 'evaluate failed: ' + err.message };
      }
      const mark = res.ok ? 'ok  ' : 'FAIL';
      if (!res.ok) failures++;
      console.log(`  ${mark}  ${check.name.padEnd(42)} ${res.detail}`);
      if (!res.ok) console.log(`        expected: ${check.why}`);
    }

    console.log(`\n${failures === 0 ? 'OK: every CSS/layout promise holds.' : `FAIL: ${failures} broken promise(s).`}`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    await page.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
