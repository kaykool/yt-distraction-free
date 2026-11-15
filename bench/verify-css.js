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
// Usage: bun run verify:css [url ...]
//        VERIFY_URLS=url1,url2 bun run verify:css
import path from 'node:path';
import { resolveVerifyUrls, verifyAcrossUrls } from './browser.js';

const EXT_DIR = path.resolve(import.meta.dir, '..');
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS || 9000);
const PLAYER_MAX_W = 854;
const PLAYER_MAX_H = 480;

// Pages differ in which promises apply. An active live stream intentionally suppresses the
// comments reveal button, whereas a Stream Replay on /live/<id> has ytlite-live removed
// and follows regular-video comment rules. Rely strictly on ytlite-live class presence.
const NOT_LIVE = `!document.documentElement.classList.contains('ytlite-live')`;
const HAS_OPEN_CHAT = `(() => {
  const cf = document.querySelector('ytd-live-chat-frame, #chat');
  if (cf) {
    const closed = cf.hasAttribute('collapsed') || cf.hasAttribute('hidden') || cf.hasAttribute('hide-chat-frame');
    const unavailable = Boolean(cf.querySelector('ytd-message-renderer'));
    return !closed && !unavailable;
  }
  const iframe = document.getElementById('chatframe');
  return Boolean(iframe && !iframe.hidden);
})()`;

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
    name: 'sidebar visibility matches page state',
    why: 'AGENTS.md §4: #secondary hidden by default, revealed only for open live chat or active panel',
    run: `(() => {
      const el = document.querySelector('#secondary');
      if (!el) return { ok: false, detail: 'no #secondary' };
      const d = getComputedStyle(el).display;
      const isLive = !(${NOT_LIVE});
      const openChat = ${HAS_OPEN_CHAT};
      if (isLive && openChat) {
        const active = document.documentElement.classList.contains('ytlite-sidebar-active');
        return { ok: active && d !== 'none', detail: 'live open chat: active=' + active + ' #secondary display=' + d };
      }
      return { ok: d === 'none', detail: (isLive ? 'live without open chat' : 'non-live video') + ': #secondary display=' + d };
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
    // Assert the computed clamp itself on every container in the 6-element chain.
    // Measuring the rendered box is not enough: #primary already constrains width.
    run: `(() => {
      const sels = ['#player-container-outer', '#player-container-inner', '#player', '#ytd-player', '#movie_player', '.html5-video-player'];
      const present = sels
        .map((sel) => [sel, document.querySelector(sel)])
        .filter(([, n]) => Boolean(n))
        .map(([sel, n]) => {
          const s = getComputedStyle(n);
          return { sel, maxW: s.maxWidth, maxH: s.maxHeight };
        });
      if (present.length === 0) return { ok: false, detail: 'no player containers found' };
      const bad = present.filter((c) => c.maxW !== '${PLAYER_MAX_W}px' || c.maxH !== '${PLAYER_MAX_H}px');
      const ok = bad.length === 0;
      const detail = ok
        ? 'checked=' + present.length + ' maxW=${PLAYER_MAX_W}px maxH=${PLAYER_MAX_H}px'
        : 'unclamped: ' + bad.map((b) => b.sel + '(' + b.maxW + 'x' + b.maxH + ')').join(', ');
      return { ok, detail };
    })()`,
  },
  {
    name: 'sidebar CSS reveals #secondary when active',
    why: 'AGENTS.md §4: sidebar revealed for live chat / engagement panels',
    // Exercise both hidden and active states regardless of whether the page started active.
    run: `(() => {
      const html = document.documentElement;
      const el = document.querySelector('#secondary');
      if (!el) return { ok: false, detail: 'no #secondary' };
      const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
      const hadClass = html.classList.contains('ytlite-sidebar-active');
      const hadPanels = Boolean(watchEl && watchEl.hasAttribute('panels-expanded'));
      if (hadPanels) watchEl.removeAttribute('panels-expanded');

      html.classList.remove('ytlite-sidebar-active');
      const hidden = getComputedStyle(el).display;
      html.classList.add('ytlite-sidebar-active');
      const active = getComputedStyle(el).display;

      html.classList.toggle('ytlite-sidebar-active', hadClass);
      if (hadPanels) watchEl.setAttribute('panels-expanded', '');
      const restored = getComputedStyle(el).display;
      const restoredOk = (hadClass || hadPanels) ? restored !== 'none' : restored === 'none';
      const ok = hidden === 'none' && active !== 'none' && restoredOk;
      return { ok, detail: 'hidden=' + hidden + ' active=' + active + ' restored=' + restored };
    })()`,
  },
  {
    name: 'no unintended horizontal overflow',
    why: 'layout must not push the page wider than the viewport',
    run: `(() => {
      const de = document.documentElement;
      const over = de.scrollWidth - de.clientWidth;
      if (over <= 2) return { ok: true, detail: 'scrollWidth-clientWidth=' + over };
      const offenders = [];
      for (const n of document.querySelectorAll('*')) {
        const r = n.getBoundingClientRect();
        if (r.right > de.clientWidth + 1 || n.scrollWidth > de.clientWidth + 1) {
          offenders.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '(r=' + Math.round(r.right) + ',sw=' + n.scrollWidth + ')');
          if (offenders.length >= 4) break;
        }
      }
      return { ok: false, detail: 'scrollWidth-clientWidth=' + over + (offenders.length ? ' via ' + offenders.join(' ') : '') };
    })()`,
  },
  {
    name: 'reveal button mounted',
    why: 'AGENTS.md §4: comments rendered on demand via .ytlite-comments-btn',
    run: `(() => {
      const btn = document.querySelector('.ytlite-comments-btn');
      if (${NOT_LIVE} === false) {
        const cf = document.querySelector('ytd-live-chat-frame, #chat');
        const unavailable = Boolean(cf && cf.querySelector('ytd-message-renderer'));
        const closed = Boolean(cf && (cf.hasAttribute('collapsed') || cf.hasAttribute('hidden') || cf.hasAttribute('hide-chat-frame')));
        if (closed && !unavailable) {
          return { ok: Boolean(btn && btn.textContent === 'Show chat'), detail: 'live closed chat: label=' + JSON.stringify(btn?.textContent ?? null) };
        }
        const suppressed = !btn;
        return { ok: suppressed, detail: 'live page: button suppressed=' + suppressed };
      }
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
  {
    name: 'interactive: Show comments reveals comments',
    why: 'clicking Show comments must unhide comments and remove the button',
    run: `(async () => {
      if (!(${NOT_LIVE})) return { ok: true, detail: 'live page: Show comments not applicable (ok)' };
      const btn = document.querySelector('.ytlite-comments-btn');
      const comments = document.querySelector('#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]');
      if (!btn || !comments) return { ok: false, detail: 'button or comments missing' };
      if (btn.textContent !== 'Show comments') return { ok: false, detail: 'unexpected label=' + JSON.stringify(btn.textContent) };
      btn.click();
      const end = Date.now() + 1500;
      const done = () =>
        !document.documentElement.classList.contains('ytlite-comments-hide') &&
        !document.querySelector('.ytlite-button-container') &&
        getComputedStyle(comments).display !== 'none';
      while (!done() && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const hiddenGone = !document.documentElement.classList.contains('ytlite-comments-hide');
      const btnGone = !document.querySelector('.ytlite-button-container');
      const d = getComputedStyle(comments).display;
      return {
        ok: hiddenGone && btnGone && d !== 'none',
        detail: 'hiddenGone=' + hiddenGone + ' btnGone=' + btnGone + ' #comments display=' + d,
      };
    })()`,
  },
  {
    name: 'interactive: Show chat opens collapsed chat',
    why: 'closing live chat must offer Show chat, and clicking Show chat must re-open the sidebar',
    run: `(async () => {
      if (${NOT_LIVE}) return { ok: true, detail: 'non-live page: Show chat not applicable (ok)' };
      const html = document.documentElement;
      const sec = document.querySelector('#secondary');
      const cf = document.querySelector('ytd-live-chat-frame, #chat');
      if (!sec) return { ok: false, detail: 'no #secondary' };
      if (!cf) {
        const suppressed = !document.querySelector('.ytlite-comments-btn');
        return { ok: suppressed, detail: 'no chat frame on page; button suppressed=' + suppressed };
      }
      if (cf.querySelector('ytd-message-renderer')) {
        return { ok: !document.querySelector('.ytlite-comments-btn'), detail: 'chat disabled on stream (ok)' };
      }
      const waitUntil = async (fn, ms = 2500) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (fn()) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
        return fn();
      };
      const isClosed = () => cf.hasAttribute('collapsed') || cf.hasAttribute('hidden') || cf.hasAttribute('hide-chat-frame');
      if (!isClosed()) {
        const hideBtn = document.querySelector('#show-hide-button button, [aria-label*="Hide chat"]');
        if (!hideBtn) return { ok: false, detail: 'Hide chat button missing while live chat is open' };
        hideBtn.click();
        const collapsed = await waitUntil(() => !html.classList.contains('ytlite-sidebar-active') && getComputedStyle(sec).display === 'none' && document.querySelector('.ytlite-comments-btn')?.textContent === 'Show chat');
        if (!collapsed) return { ok: false, detail: 'chat did not collapse cleanly: sidebar=' + getComputedStyle(sec).display + ' btn=' + JSON.stringify(document.querySelector('.ytlite-comments-btn')?.textContent ?? null) };
      }
      const showBtn = document.querySelector('.ytlite-comments-btn');
      if (!showBtn || showBtn.textContent !== 'Show chat') {
        return { ok: false, detail: 'Show chat button missing when chat closed' };
      }
      showBtn.click();
      const reopened = await waitUntil(() => html.classList.contains('ytlite-sidebar-active') && getComputedStyle(sec).display !== 'none' && !document.querySelector('.ytlite-comments-btn'));
      return {
        ok: reopened,
        detail: 'reopened=' + reopened + ' sidebar=' + getComputedStyle(sec).display + ' btnAfter=' + Boolean(document.querySelector('.ytlite-comments-btn')),
      };
    })()`,
  },
  {
    name: 'interactive: AudioOnly hides video, syncs quality, plays/seeks stall-free, and restores',
    why: 'AudioOnly must hide <video>, clamp quality to tiny, advance playback & scrub without stalling, and restore visibility/quality on toggle off',
    run: `(async () => {
      const html = document.documentElement;
      const btn = document.querySelector('.ytlite-video-toggle-btn');
      const video = document.querySelector('#movie_player video, .html5-video-player video');
      const mp = document.querySelector('#movie_player');
      if (!btn || !video || !mp) return { ok: false, detail: 'toggle button, <video>, or #movie_player missing' };

      const waitUntil = async (fn, ms = 2500) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (fn()) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
        return fn();
      };
      const isVideoHidden = (el = video) => {
        const vs = getComputedStyle(el);
        return vs.contentVisibility === 'hidden' || vs.visibility === 'hidden' || vs.display === 'none';
      };
      const isVideoSuppressed = (el = video) => {
        const vs = getComputedStyle(el);
        return vs.contentVisibility === 'hidden' && vs.visibility === 'hidden';
      };
      const waitAdvance = async (ms = 2500) => {
        const settled = await waitUntil(
          () => !video.paused && !video.seeking && video.readyState >= 2 && video.currentTime > 0.05,
          5000,
        );
        if (!settled) return { ok: false, from: video.currentTime, to: video.currentTime };
        await new Promise((r) => setTimeout(r, 200));
        const t0 = video.currentTime;
        const ok = await waitUntil(
          () => !video.paused && !video.seeking && video.currentTime > t0 + 0.15,
          ms,
        );
        return { ok, from: t0, to: video.currentTime };
      };
      const seekTo = async (targetTime) => {
        await waitUntil(() => !video.seeking && video.readyState >= 2, 2000);
        const settled = new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            video.removeEventListener('seeked', finish);
            resolve();
          };
          video.addEventListener('seeked', finish);
          setTimeout(finish, 4000);
        });
        video.currentTime = targetTime;
        await settled;
        return video.currentTime;
      };

      const initialBlock = localStorage.getItem('ytlite-block-video');
      const initialPrev = localStorage.getItem('ytlite-prev-quality');
      const initialBlockedCls = html.classList.contains('ytlite-video-blocked');
      const origRange = typeof mp.setPlaybackQualityRange === 'function' ? mp.setPlaybackQualityRange : null;
      const origSingle = typeof mp.setPlaybackQuality === 'function' ? mp.setPlaybackQuality : null;
      const hasQualityApi = Boolean(origRange || origSingle);
      if (!hasQualityApi) {
        return { ok: false, detail: '#movie_player lacks quality API' };
      }

      const calls = [];
      if (origRange) mp.setPlaybackQualityRange = function(...args) { calls.push(['range', ...args]); return origRange.apply(this, args); };
      if (origSingle) mp.setPlaybackQuality = function(...args) { calls.push(['single', ...args]); return origSingle.apply(this, args); };

      const bounded = (p, ms = 1500) =>
        Promise.race([
          Promise.resolve(p).catch(() => {}),
          new Promise((r) => setTimeout(r, ms)),
        ]);
      const videoDiag = () => {
        const adShowing =
          mp.classList.contains('ad-showing') ||
          Boolean(document.querySelector('.ad-showing'));
        const adInterrupting =
          mp.classList.contains('ad-interrupting') ||
          Boolean(document.querySelector('.ad-interrupting'));
        return (
          'readyState=' +
          video.readyState +
          ' networkState=' +
          video.networkState +
          ' paused=' +
          video.paused +
          ' hidden=' +
          isVideoHidden(video) +
          ' currentSrc=' +
          JSON.stringify(video.currentSrc || '') +
          ' adShowing=' +
          adShowing +
          ' adInterrupting=' +
          adInterrupting
        );
      };

      try {
        mp.mute?.();
        video.muted = true;
        mp.playVideo?.();
        if (video.readyState >= 2) {
          await bounded(video.play(), 1500);
        }
        let lastKick = Date.now();
        const ready = await waitUntil(() => {
          if (video.paused || video.readyState < 2) {
            const now = Date.now();
            if (now - lastKick >= 800) {
              lastKick = now;
              mp.mute?.();
              video.muted = true;
              if (mp.classList?.contains('unstarted-mode')) {
                mp.querySelector('.ytp-play-button')?.click();
              }
              mp.playVideo?.();
              if (video.readyState >= 2 && video.paused) {
                Promise.resolve(video.play()).catch(() => {});
              }
            }
          }
          return (
            video.readyState >= 2 &&
            !video.paused &&
            video.currentTime > 0.05 &&
            !isVideoHidden(video)
          );
        }, 8000);
        if (!ready) {
          return {
            ok: false,
            detail: 'video did not start visible playback: ' + videoDiag(),
          };
        }

        const semanticBtn = btn.tagName === 'BUTTON' && btn.type === 'button' && btn.hasAttribute('aria-pressed');
        const visibleInitially = !isVideoHidden(video);

        btn.click();
        await new Promise((r) => setTimeout(r, 60));
        const onCalls = calls.slice();
        const blockedOn = html.classList.contains('ytlite-video-blocked');
        const pressedOn = btn.getAttribute('aria-pressed') === 'true' && btn.classList.contains('ytlite-ao');
        const lsOn = localStorage.getItem('ytlite-block-video') === 'true';
        const hiddenOn = isVideoSuppressed(video);
        const prevSaved = localStorage.getItem('ytlite-prev-quality');
        const qualityTiny = onCalls.length === 1 && onCalls[0][1] === 'tiny';

        await new Promise((r) => setTimeout(r, 350));
        const advOn = await waitAdvance(2500);

        const isLive = html.classList.contains('ytlite-live');
        const seekTarget = isLive && advOn.to >= 15
          ? Math.max(0, advOn.to - 10)
          : Math.min(Number.isFinite(video.duration) && video.duration > 15 ? video.duration - 2 : advOn.to + 10, advOn.to + 10);
        const seekLanded = await seekTo(seekTarget);
        const seekNear = Math.abs(seekLanded - seekTarget) <= 5;
        await new Promise((r) => setTimeout(r, 250));
        const advAfterSeek = await waitAdvance(2500);
        const stillSuppressed = isVideoSuppressed(video);

        btn.click();
        await new Promise((r) => setTimeout(r, 60));
        const offCalls = calls.slice(onCalls.length);
        const blockedOff = !html.classList.contains('ytlite-video-blocked');
        const pressedOff = btn.getAttribute('aria-pressed') === 'false' && !btn.classList.contains('ytlite-ao');
        const lsOff = localStorage.getItem('ytlite-block-video') === 'false';
        const visibleAfter = !isVideoHidden(video);
        const prevCleared = localStorage.getItem('ytlite-prev-quality') === null;
        const qualityRestored = prevSaved ? (offCalls.length === 1 && offCalls[0][1] === prevSaved) : offCalls.length === 0;

        await new Promise((r) => setTimeout(r, 350));
        const advOff = await waitAdvance(2500);

        const ok = semanticBtn && visibleInitially && blockedOn && pressedOn && lsOn && hiddenOn && qualityTiny &&
          advOn.ok && seekNear && advAfterSeek.ok && stillSuppressed &&
          blockedOff && pressedOff && lsOff && visibleAfter && prevCleared && qualityRestored && advOff.ok;
        return {
          ok,
          detail: 'hiddenOn=' + hiddenOn + ' tinyCalls=' + onCalls.length + ' prevSaved=' + prevSaved +
            ' advOn=' + advOn.from.toFixed(2) + '->' + advOn.to.toFixed(2) +
            ' seek=' + seekTarget.toFixed(1) + '@' + seekLanded.toFixed(1) + '->' + advAfterSeek.to.toFixed(2) +
            ' visibleAfter=' + visibleAfter + ' restored=' + qualityRestored +
            ' advOff=' + advOff.from.toFixed(2) + '->' + advOff.to.toFixed(2) +
            (ok ? '' : ' ' + videoDiag()),
        };
      } finally {
        if (origRange) mp.setPlaybackQualityRange = origRange;
        if (origSingle) mp.setPlaybackQuality = origSingle;
        html.classList.toggle('ytlite-video-blocked', initialBlockedCls);
        if (initialBlock === null) localStorage.removeItem('ytlite-block-video');
        else localStorage.setItem('ytlite-block-video', initialBlock);
        if (initialPrev === null) localStorage.removeItem('ytlite-prev-quality');
        else localStorage.setItem('ytlite-prev-quality', initialPrev);
        mp.pauseVideo?.();
        video.pause();
      }
    })()`,
  },
];

export async function runVerifyCss(urls = resolveVerifyUrls(), deps = {}) {
  const { checkTimeoutMs = 30000, ...runnerDeps } = deps;
  const log = runnerDeps.log || console.log;

  return verifyAcrossUrls(urls, {
    port: 9651,
    extensionDir: EXT_DIR,
    profileDir: '/tmp/ytlite-verify-css',
    settleMs: SETTLE_MS,
    ...runnerDeps,
    beforeUrl: (url) => log(`Behavioral CSS check against ${url}\n`),
    verifyPage: async (page) => {
      let failures = 0;
      for (const check of CHECKS) {
        let res;
        let timer;
        try {
          res = await Promise.race([
            page.evaluate(check.run),
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(`check timed out after ${checkTimeoutMs}ms`)
                  ),
                checkTimeoutMs
              );
            }),
          ]);
        } catch (err) {
          res = { ok: false, detail: 'evaluate failed: ' + err.message };
        } finally {
          clearTimeout(timer);
        }
        const mark = res.ok ? 'ok  ' : 'FAIL';
        if (!res.ok) failures++;
        log(`  ${mark}  ${check.name.padEnd(42)} ${res.detail}`);
        if (!res.ok) log(`        expected: ${check.why}`);
      }

      log(
        `\n${failures === 0 ? 'OK: every CSS/layout promise holds.' : `FAIL: ${failures} broken promise(s).`}`
      );
      return failures === 0;
    },
  });
}

async function main() {
  const summary = await runVerifyCss(resolveVerifyUrls());
  process.exitCode = summary.ok ? 0 : 1;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
