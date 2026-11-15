import { test, expect, describe } from 'bun:test';
import { Document, matchesSelector } from './dom.js';
import { buildWatchPage, mountChat, populateComments } from './fixture.js';
import {
  bootDualWorld,
  dispatch,
  spaNavigateStart,
  spaNavigateFinish,
  spaPageDataUpdated,
} from './helpers.js';

describe('dom.js: attribute/property sync and selector engine', () => {
  test('syncs hidden attribute and .hidden property bidirectionally', () => {
    const doc = new Document();
    const el = doc.createElement('iframe');
    expect(el.hidden).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);

    el.setAttribute('hidden', '');
    expect(el.hidden).toBe(true);
    expect(el.matches('[hidden]')).toBe(true);

    el.removeAttribute('hidden');
    expect(el.hidden).toBe(false);
    expect(el.matches('[hidden]')).toBe(false);

    el.hidden = true;
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.matches('[hidden]')).toBe(true);

    el.hidden = false;
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.matches('[hidden]')).toBe(false);
  });

  test('syncs class attribute on classList/className and clears _class on removeAttribute', () => {
    const doc = new Document();
    const el = doc.createElement('div');

    el.classList.add('alpha', 'beta');
    expect(el.getAttribute('class')).toBe('alpha beta');
    expect(el.matches('[class*="beta"]')).toBe(true);

    el.removeAttribute('class');
    expect(el.className).toBe('');
    expect(el.classList.contains('alpha')).toBe(false);
    expect(el.hasAttribute('class')).toBe(false);

    el.className = 'gamma delta';
    expect(el.getAttribute('class')).toBe('gamma delta');
    expect(el.classList.contains('delta')).toBe(true);
  });

  test('parses and evaluates multiple :not() clauses and attr operators inside :not()', () => {
    const doc = new Document();
    const wf = doc.createElement('ytd-watch-flexy');
    const sel = 'ytd-watch-flexy:not([fullscreen]):not([theater])';

    expect(matchesSelector(wf, sel)).toBe(true);
    wf.setAttribute('theater', '');
    expect(matchesSelector(wf, sel)).toBe(false);
    wf.removeAttribute('theater');
    wf.setAttribute('fullscreen', '');
    expect(matchesSelector(wf, sel)).toBe(false);

    const panel = doc.createElement(
      'ytd-engagement-panel-section-list-renderer'
    );
    panel.setAttribute('target-id', 'engagement-panel-comments-section');
    expect(
      matchesSelector(
        panel,
        'ytd-engagement-panel-section-list-renderer:not([target-id*="ad"]):not([hidden])'
      )
    ).toBe(true);
    panel.setAttribute('target-id', 'engagement-panel-ads');
    expect(
      matchesSelector(
        panel,
        'ytd-engagement-panel-section-list-renderer:not([target-id*="ad"]):not([hidden])'
      )
    ).toBe(false);
  });

  test('evaluates >, +, ~, descendant combinators, backtracking, and quoted spaces', () => {
    const doc = new Document();
    const sec = doc.createElement('div');
    sec.id = 'secondary';
    const directRelated = doc.createElement(
      'ytd-watch-next-secondary-results-renderer'
    );
    const inner = doc.createElement('div');
    const nestedRelated = doc.createElement(
      'ytd-watch-next-secondary-results-renderer'
    );
    sec.appendChild(directRelated);
    inner.appendChild(nestedRelated);
    sec.appendChild(inner);
    doc.body.appendChild(sec);

    expect(
      doc.querySelectorAll(
        '#secondary > ytd-watch-next-secondary-results-renderer'
      )
    ).toEqual([directRelated]);
    expect(
      doc.querySelectorAll(
        '#secondary>ytd-watch-next-secondary-results-renderer'
      )
    ).toEqual([directRelated]);

    // + and ~ combinators
    const a = doc.createElement('span');
    a.className = 'a';
    const b1 = doc.createElement('span');
    b1.className = 'b';
    const mid = doc.createElement('span');
    const bBefore = doc.createElement('span');
    bBefore.className = 'b';
    const bAfter = doc.createElement('span');
    bAfter.className = 'b';
    const row = doc.createElement('div');
    row.appendChild(bBefore);
    row.appendChild(a);
    row.appendChild(b1);
    row.appendChild(mid);
    row.appendChild(bAfter);
    doc.body.appendChild(row);

    expect(doc.querySelectorAll('.a + .b')).toEqual([b1]);
    expect(doc.querySelectorAll('.a ~ .b')).toEqual([b1, bAfter]);

    // Backtracking across > and descendant
    const root = doc.createElement('div');
    root.className = 'root';
    const outerSpan = doc.createElement('span');
    const other = doc.createElement('div');
    other.className = 'other';
    const innerSpan = doc.createElement('span');
    const link = doc.createElement('a');
    innerSpan.appendChild(link);
    other.appendChild(innerSpan);
    outerSpan.appendChild(other);
    root.appendChild(outerSpan);
    doc.body.appendChild(root);

    expect(matchesSelector(link, 'div.root > span a')).toBe(true);

    // Quoted spaces in attribute selectors & dynamic pseudo-classes
    const btn = doc.createElement('button');
    btn.className = 'ytlite-comments-btn';
    btn.setAttribute('aria-label', 'Show chat');
    doc.body.appendChild(btn);
    expect(doc.querySelectorAll('button[aria-label="Show chat"]')).toEqual([
      btn,
    ]);
    expect(doc.querySelectorAll('.ytlite-comments-btn:hover')).toEqual([]);
  });
});

describe('fixture.js: app shell, video-id, and unhydrated chat', () => {
  test('supports opt-in <ytd-app> -> #content -> <ytd-page-manager> nesting', () => {
    const doc = new Document();
    const parts = buildWatchPage(doc, { appShell: true, videoId: 'vid42' });
    doc.body.appendChild(parts.mount);

    expect(parts.app.tagName).toBe('YTD-APP');
    expect(parts.content.id).toBe('content');
    expect(parts.pageManager.id).toBe('page-manager');
    expect(parts.pageManager.tagName).toBe('YTD-PAGE-MANAGER');
    expect(parts.root.parentElement).toBe(parts.pageManager);
    expect(parts.pageManager.parentElement).toBe(parts.content);
    expect(parts.content.parentElement).toBe(parts.app);
    expect(parts.app.parentElement).toBe(doc.body);
    expect(parts.root.getAttribute('video-id')).toBe('vid42');
  });

  test('omits video-id attribute when videoId is null (transition state)', () => {
    const doc = new Document();
    const parts = buildWatchPage(doc, { videoId: null, isLive: true });
    expect(parts.root.hasAttribute('video-id')).toBe(false);
    expect(parts.root.hasAttribute('live')).toBe(true);
  });

  test('unhydratedChat omits chatFrame and #chatframe until mounted', () => {
    const doc = new Document();
    const parts = buildWatchPage(doc, { isLive: true, unhydratedChat: true });
    doc.body.appendChild(parts.mount);

    expect(parts.chatFrame).toBeNull();
    expect(parts.chatIframe).toBeNull();
    expect(doc.querySelector('ytd-live-chat-frame')).toBeNull();
    expect(doc.getElementById('chatframe')).toBeNull();

    mountChat(doc, parts, { collapsed: true });
    expect(parts.chatFrame).not.toBeNull();
    expect(parts.chatFrame.hasAttribute('collapsed')).toBe(true);
    expect(doc.getElementById('chatframe')).not.toBeNull();
  });
});

describe('helpers.js: dual-world execution & realistic SPA payloads', () => {
  test('isolates page-world expandos from ISOLATED scripts and strips CustomEvent.detail across worlds', () => {
    const { env, isolated, main, parts } = bootDualWorld();

    // Page-world expando on moviePlayer and chatFrame is visible in MAIN, undefined in ISOLATED.
    parts.moviePlayer.getVideoData = () => ({
      isLive: false,
      video_id: 'abc123',
    });
    expect(
      typeof main.document.getElementById('movie_player').getVideoData
    ).toBe('function');
    expect(
      isolated.document.getElementById('movie_player').getVideoData
    ).toBeUndefined();

    // Isolated-world expando does not leak to MAIN.
    isolated.document.getElementById('movie_player').__isoOnly = 'secret';
    expect(
      main.document.getElementById('movie_player').__isoOnly
    ).toBeUndefined();

    // Cross-world CustomEvent strips detail to null in both directions.
    let mainWinDetail = 'unset';
    let isoWinDetail = 'unset';
    let mainDocDetail = 'unset';
    let isoDocDetail = 'unset';
    main.window.addEventListener('test-i2m', (e) => {
      mainWinDetail = e.detail;
    });
    isolated.window.addEventListener('test-m2i', (e) => {
      isoWinDetail = e.detail;
    });
    main.document.addEventListener('test-doc-i2m', (e) => {
      mainDocDetail = e.detail;
    });
    isolated.document.addEventListener('test-doc-m2i', (e) => {
      isoDocDetail = e.detail;
    });

    isolated.window.dispatchEvent(
      new isolated.ctx.CustomEvent('test-i2m', { detail: { a: 1 } })
    );
    main.window.dispatchEvent(
      new main.ctx.CustomEvent('test-m2i', { detail: { b: 2 } })
    );
    isolated.document.dispatchEvent(
      new isolated.ctx.CustomEvent('test-doc-i2m', {
        bubbles: true,
        detail: { c: 3 },
      })
    );
    main.document.dispatchEvent(
      new main.ctx.CustomEvent('test-doc-m2i', {
        bubbles: true,
        detail: { d: 4 },
      })
    );

    expect(mainWinDetail).toBeNull();
    expect(isoWinDetail).toBeNull();
    expect(mainDocDetail).toBeNull();
    expect(isoDocDetail).toBeNull();
    expect(env.document.querySelector('ytd-app')).not.toBeNull();
  });

  test('bridges AudioOnly localStorage/click/quality and open-chat across ISOLATED <-> MAIN', () => {
    const { env, doc, parts, qualityCalls } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=vid1',
      fixture: { isLive: true, liveChatClosed: true },
    });
    parts.moviePlayer.getPlaybackQuality = () => 'hd1080';
    let chatState = 'collapsed';
    parts.chatFrame.setCollapsedState = (c) => {
      chatState = c ? 'collapsed' : 'open';
    };

    // Toggle AudioOnly on and off via the ISOLATED button -> MAIN player.js clamps & restores.
    const toggle = doc.querySelector('.ytlite-video-toggle-btn');
    expect(toggle).not.toBeNull();
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.type).toBe('button');
    expect(toggle.textContent).toBe('AudioOnly');
    expect(toggle.getAttribute('aria-label')).toBe('AudioOnly');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    env.advance(10);
    expect(env.localStorage.getItem('ytlite-block-video')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('AudioOnly');
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);

    toggle.click();
    env.advance(10);
    expect(env.localStorage.getItem('ytlite-block-video')).toBe('false');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('AudioOnly');
    expect(qualityCalls).toEqual([
      ['range', 'tiny', 'tiny'],
      ['range', 'hd1080', 'hd1080'],
    ]);

    // Show chat button in ISOLATED triggers ytlite-open-chat -> MAIN invokes setCollapsedState(false).
    const showChat = doc.querySelector('.ytlite-comments-btn');
    expect(showChat.textContent).toBe('Show chat');
    expect(showChat.getAttribute('aria-expanded')).toBe('false');
    showChat.click();
    expect(chatState).toBe('open');
  });

  test('Show chat invokes MAIN API without double-toggling UI buttons or flipping Hide chat', () => {
    const { env, doc, main, parts, advance } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=liveToggle1',
      fixture: { isLive: true, liveChatClosed: true },
    });

    // Mount YouTube's internal Show/Hide button and teaser button inside DOM.
    const showHideWrap = main.document.createElement('div');
    showHideWrap.id = 'show-hide-button';
    const ytShowBtn = main.document.createElement('button');
    ytShowBtn.setAttribute('aria-label', 'Show chat');
    let ytShowClicks = 0;
    ytShowBtn.addEventListener('click', () => {
      ytShowClicks++;
      if (parts.chatFrame.hasAttribute('collapsed')) {
        parts.chatFrame.removeAttribute('collapsed');
      } else {
        parts.chatFrame.setAttribute('collapsed', '');
      }
    });
    showHideWrap.appendChild(ytShowBtn);
    parts.chatFrame.appendChild(showHideWrap);

    const teaser = main.document.createElement('div');
    teaser.id = 'teaser-carousel';
    const teaserBtn = main.document.createElement('button');
    let teaserClicks = 0;
    teaserBtn.addEventListener('click', () => {
      teaserClicks++;
    });
    teaser.appendChild(teaserBtn);
    parts.below.appendChild(teaser);

    let onShowHideCalls = 0;
    let sawCollapsedWhenCalled = false;
    parts.chatFrame.onShowHideChat = () => {
      onShowHideCalls++;
      sawCollapsedWhenCalled = parts.chatFrame.hasAttribute('collapsed');
      parts.chatFrame.removeAttribute('collapsed');
      parts.chatFrame.removeAttribute('hide-chat-frame');
      ytShowBtn.setAttribute('aria-label', 'Hide chat');
    };

    const btn = doc.querySelector('.ytlite-comments-btn');
    expect(btn?.textContent).toBe('Show chat');
    btn.click();

    expect(onShowHideCalls).toBe(1);
    expect(sawCollapsedWhenCalled).toBe(true);
    expect(ytShowClicks).toBe(0);
    expect(teaserClicks).toBe(0);
    expect(parts.chatFrame.hasAttribute('collapsed')).toBe(false);
    expect(
      doc.documentElement.classList.contains('ytlite-sidebar-active')
    ).toBe(true);
    expect(doc.querySelector('.ytlite-button-container')).toBeNull();

    // Coalesced YouTube events right after opening must keep sidebar open.
    env.document.dispatchEvent(
      new env.ctx.CustomEvent('yt-action', { bubbles: true })
    );
    env.document.dispatchEvent(
      new env.ctx.CustomEvent('yt-chat-collapsed-changed')
    );
    advance(700);
    expect(
      doc.documentElement.classList.contains('ytlite-sidebar-active')
    ).toBe(true);
  });

  test('openLiveChat UI fallback clicks only one Show button when MAIN API is absent and skips Hide buttons', () => {
    const { env, doc, main, parts, advance } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=liveFallback',
      fixture: { isLive: true, liveChatClosed: true },
    });

    const showHideWrap = main.document.createElement('div');
    showHideWrap.id = 'show-hide-button';
    const ytHideBtn = main.document.createElement('button');
    ytHideBtn.setAttribute('aria-label', 'Hide chat');
    let hideClicks = 0;
    ytHideBtn.addEventListener('click', () => {
      hideClicks++;
    });
    showHideWrap.appendChild(ytHideBtn);
    parts.chatFrame.appendChild(showHideWrap);

    const teaser = main.document.createElement('div');
    teaser.id = 'teaser-carousel';
    const teaserBtn = main.document.createElement('button');
    let teaserClicks = 0;
    teaserBtn.addEventListener('click', () => {
      teaserClicks++;
      parts.chatFrame.removeAttribute('collapsed');
      parts.chatFrame.removeAttribute('hide-chat-frame');
    });
    teaser.appendChild(teaserBtn);
    parts.below.appendChild(teaser);

    const btn = doc.querySelector('.ytlite-comments-btn');
    expect(btn?.textContent).toBe('Show chat');
    btn.click();
    advance(700);

    expect(hideClicks).toBe(0);
    expect(teaserClicks).toBe(1);
    expect(
      doc.documentElement.classList.contains('ytlite-sidebar-active')
    ).toBe(true);
  });

  test('MAIN player.js publishes data-ytlite-live on yt-navigate-finish for ISOLATED comments.js', () => {
    const { env, doc, parts } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=stream99',
    });
    parts.moviePlayer.getVideoData = () => ({
      isLive: true,
      video_id: 'stream99',
    });

    // No event playerResponse; MAIN publishes data-ytlite-live after debounce.
    dispatch(env, env.document, 'yt-navigate-finish', {});
    env.advance(700);

    expect(doc.documentElement.getAttribute('data-ytlite-live')).toBe('true');
    expect(doc.documentElement.getAttribute('data-ytlite-video')).toBe(
      'stream99'
    );

    populateComments(doc, parts, 2);
    expect(doc.querySelectorAll('ytd-comment-thread-renderer').length).toBe(2);
  });

  test('builds realistic nested SPA navigation and minimal page-data payloads', () => {
    expect(spaNavigateStart('/watch?v=next1')).toEqual({
      endpoint: {
        commandMetadata: { webCommandMetadata: { url: '/watch?v=next1' } },
      },
    });

    const regularFinish = spaNavigateFinish();
    expect(regularFinish.response.contents).toBeUndefined();
    expect(regularFinish.playerResponse).toBeUndefined();
    expect(
      regularFinish.response.response.contents.twoColumnWatchNextResults
    ).toEqual({});

    const liveFinish = spaNavigateFinish({ hasLiveChat: true });
    expect(
      liveFinish.response.response.contents.twoColumnWatchNextResults
        .conversationBar.liveChatRenderer
    ).toEqual({});

    expect(spaPageDataUpdated()).toEqual({ pageType: 'watch' });
  });

  test('AudioOnly rapid toggling calls setPlaybackQualityRange once per toggle with no stale timers', () => {
    const { env, doc, parts, qualityCalls } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    parts.moviePlayer.getPlaybackQuality = () => 'hd1080';

    const toggle = doc.querySelector('.ytlite-video-toggle-btn');
    toggle.click();
    toggle.click();
    toggle.click();
    env.advance(50);

    expect(qualityCalls).toEqual([
      ['range', 'tiny', 'tiny'],
      ['range', 'hd1080', 'hd1080'],
      ['range', 'tiny', 'tiny'],
    ]);
    expect(env.localStorage.getItem('ytlite-block-video')).toBe('true');
    expect(env.localStorage.getItem('ytlite-prev-quality')).toBe('hd1080');
  });

  test('SPA navigation triggers at most a single quality sync when AudioOnly is on and zero when off', () => {
    const { env, doc, parts, qualityCalls, navigate, advance } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=vid1',
      storage: { 'ytlite-block-video': 'true' },
    });
    parts.moviePlayer.getPlaybackQuality = () => 'hd720';
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);

    qualityCalls.length = 0;
    dispatch(
      env,
      env.document,
      'yt-navigate-start',
      spaNavigateStart('/watch?v=vid2')
    );
    navigate('https://www.youtube.com/watch?v=vid2');
    dispatch(env, env.document, 'yt-navigate-finish', spaNavigateFinish());
    advance(700);
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
    expect(env.localStorage.getItem('ytlite-prev-quality')).toBe('hd720');

    // Toggle AudioOnly off, then navigate again: no quality calls during SPA nav.
    doc.querySelector('.ytlite-video-toggle-btn').click();
    expect(qualityCalls).toEqual([
      ['range', 'tiny', 'tiny'],
      ['range', 'hd720', 'hd720'],
    ]);

    qualityCalls.length = 0;
    dispatch(
      env,
      env.document,
      'yt-navigate-start',
      spaNavigateStart('/watch?v=vid3')
    );
    navigate('https://www.youtube.com/watch?v=vid3');
    dispatch(env, env.document, 'yt-navigate-finish', spaNavigateFinish());
    advance(700);
    expect(qualityCalls).toEqual([]);
  });

  test('comments.js emits ytlite-set-quality without unused detail payloads', () => {
    const details = [];
    const { doc, isolated } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=vid1',
      mutate: ({ isolated: iso }) => {
        iso.window.addEventListener('ytlite-set-quality', (e) =>
          details.push(e.detail)
        );
      },
    });
    doc.querySelector('.ytlite-video-toggle-btn').click();
    expect(details).toEqual([null, null]);
    expect(
      isolated.document.documentElement.classList.contains(
        'ytlite-video-blocked'
      )
    ).toBe(true);
  });
});
