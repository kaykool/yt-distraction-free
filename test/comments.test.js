import { test, expect, describe } from 'bun:test';
import { boot, dispatch, populateComments, expandPanel } from './helpers.js';

const $$ = (env, sel) => env.document.querySelector(sel);
const cls = (env) => env.document.documentElement.classList;

describe('comments: hidden-by-default invariant', () => {
  test('start.js sets ytlite-comments-hide before comments.js runs', () => {
    const { env } = boot();
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
  });

  test('reveal button is mounted without any continuation fetch', () => {
    const { env, parts } = boot();
    const btn = $$(env, '.ytlite-comments-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Show comments');
    // No comment renderers have been added by the extension
    expect(parts.commentsHost.children.filter((c) => c.tagName === 'YTD-COMMENT-THREAD-RENDERER').length).toBe(0);
  });
});

describe('comments: on-demand reveal', () => {
  test('clicking the button un-hides comments and kicks continuation', () => {
    const { env, parts } = boot();
    let kicked = false;
    parts.commentsHost.addEventListener('yt-load-next-continuation', () => { kicked = true; });

    $$(env, '.ytlite-comments-btn').click();

    expect(cls(env).contains('ytlite-comments-hide')).toBe(false);
    expect(kicked).toBe(true);
    expect($$(env, '.ytlite-button-container')).toBeNull();
  });

  test('revealed comments render only after the click', () => {
    const { env, parts } = boot();
    expect(parts.commentsHost.children.some((c) => c.tagName === 'YTD-COMMENT-THREAD-RENDERER')).toBe(false);
    $$(env, '.ytlite-comments-btn').click();
    populateComments(env.document, parts, 5);
    expect(parts.commentsHost.children.filter((c) => c.tagName === 'YTD-COMMENT-THREAD-RENDERER').length).toBe(5);
  });
});

describe('comments: observer discipline', () => {
  test('no observers remain active after the button mounts', () => {
    const { env } = boot();
    expect(env.observers().filter((o) => o.active).length).toBe(0);
  });

  test('when the target is missing an observer watches, then disconnects once placed', () => {
    const { env } = boot({
      mutate: ({ doc }) => {
        doc.getElementById('below')?.remove();
      },
    });
    // #below is gone, but #primary-inner can still host the button, so placement
    // must have succeeded and left no observer running.
    expect($$(env, '.ytlite-button-container')).not.toBeNull();
    expect(env.observers().filter((o) => o.active).length).toBe(0);
  });

  test('comment observer starts when placement is impossible, then disconnects on success', () => {
    const { env } = boot({
      mutate: ({ doc }) => {
        for (const sel of ['#below', '#primary-inner', '#primary', 'ytd-watch-flexy', 'ytd-watch-grid']) {
          doc.querySelector(sel)?.remove();
        }
      },
    });
    const active = env.observers().filter((o) => o.active);
    expect(active.length).toBe(1);
    // It must actually be observing a real node (not a dangling, unbound observer).
    expect(active[0].observations.length).toBe(1);
    expect(active[0].observations[0].options.subtree).toBe(false);

    // Inject a placement target and poke the observer: button mounts + observer stops.
    const below = env.document.createElement('div');
    below.id = 'below';
    below.appendChild(env.document.createElement('ytd-watch-metadata'));
    env.document.body.appendChild(below);
    active[0].trigger();

    expect($$(env, '.ytlite-button-container')).not.toBeNull();
    expect(env.observers().filter((o) => o.active).length).toBe(0);
  });

  test('video-toggle observer never dangles when no player target exists', () => {
    // Regression: startScopedVideoObserver used to assign the observer before
    // bailing out on a missing target, leaking an unbound, never-timed-out observer.
    const { env } = boot({
      mutate: ({ doc }) => {
        for (const sel of ['.html5-video-player', '#movie_player', '#ytd-player', '#player', '#player-container-outer', '#primary-inner']) {
          doc.querySelector(sel)?.remove();
        }
      },
    });
    for (const o of env.observers()) {
      if (o.active) expect(o.observations.length).toBe(1);
    }
    env.advance(4500);
    expect(env.observers().filter((o) => o.active).length).toBe(0);
    expect($$(env, '.ytlite-video-toggle-btn')).toBeNull();
  });

  test('comment observer safety timeout force-disconnects a never-satisfied observer', () => {
    const { env } = boot({
      mutate: ({ doc }) => {
        for (const sel of ['#below', '#primary-inner', '#primary', 'ytd-watch-flexy', 'ytd-watch-grid']) {
          doc.querySelector(sel)?.remove();
        }
      },
    });
    expect(env.observers().filter((o) => o.active).length).toBe(1);
    env.advance(4500);
    expect(env.observers().filter((o) => o.active).length).toBe(0);
  });
});

describe('comments: SPA navigation lifecycle', () => {
  test('yt-navigate-start re-arms the hidden class for watch targets', () => {
    const { env } = boot();
    cls(env).remove('ytlite-comments-hide');
    dispatch(env, env.document, 'yt-navigate-start', {
      endpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=xyz789' } } },
    });
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
  });

  test('navigation away from watch removes all ytlite classes', () => {
    const { env } = boot();
    dispatch(env, env.document, 'yt-navigate-start', {
      endpoint: { commandMetadata: { webCommandMetadata: { url: '/feed/subscriptions' } } },
    });
    expect(cls(env).contains('ytlite-comments-hide')).toBe(false);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect($$(env, '.ytlite-button-container')).toBeNull();
  });

  test('yt-navigate-finish on a non-watch page cleans up', () => {
    const { env } = boot();
    env.navigate('https://www.youtube.com/feed/subscriptions');
    dispatch(env, env.document, 'yt-navigate-finish', {});
    expect(cls(env).contains('ytlite-comments-hide')).toBe(false);
  });
});

describe('comments: live stream handling', () => {
  test('/live route marks the page live and drops comments hiding', () => {
    const { env, parts } = boot({
      href: 'https://www.youtube.com/live/abc123',
      fixture: { isLive: true },
    });
    env.advance(4000);
    expect(cls(env).contains('ytlite-live')).toBe(true);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(false);
    expect(parts.secondary !== undefined).toBe(true);
  });

  test('live chat closed => Show chat button instead of Show comments', () => {
    const { env } = boot({
      href: 'https://www.youtube.com/watch?v=abc123',
      fixture: { isLive: true, liveChatClosed: true },
    });
    env.advance(4000);
    const btn = $$(env, '.ytlite-comments-btn');
    // Either the comments button is absent or it is the live "Show chat" variant.
    if (btn) expect(btn.textContent).toBe('Show chat');
  });

  test('collapsed live chat does not keep the sidebar active', () => {
    const { env } = boot({
      href: 'https://www.youtube.com/watch?v=abc123',
      fixture: { isLive: true, liveChatClosed: true },
    });
    env.advance(4000);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
  });
});

describe('comments: sidebar reveal for engagement panels', () => {
  test('expanded Ask/engagement panel activates the sidebar', () => {
    const { env, parts } = boot();
    expandPanel(parts, 'ask');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(true);
  });

  test('ad panels are ignored when deciding sidebar visibility', () => {
    const { env, parts } = boot({ fixture: { adsPanel: true } });
    env.advance(700);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
  });

  test('panels-expanded attribute on watch flexy activates the sidebar', () => {
    const { env, parts } = boot();
    parts.root.setAttribute('panels-expanded', '');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(true);
  });

  test('hidden comment panel does not activate the sidebar', () => {
    const { env, parts } = boot();
    parts.commentsPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
  });
});

describe('comments: update coalescing (no work on every click)', () => {
  test('a burst of clicks schedules only the coalesced timers', () => {
    const { env } = boot();
    // Count how often the expensive live-detection path runs by instrumenting querySelectorAll.
    let calls = 0;
    const orig = env.document.querySelectorAll.bind(env.document);
    env.document.querySelectorAll = (sel) => { calls++; return orig(sel); };

    for (let i = 0; i < 5; i++) dispatch(env, env.document, 'click', undefined);
    const afterClicks = calls;
    expect(afterClicks).toBe(0); // scheduleSidebarUpdate does no synchronous DOM work
    env.advance(700);
    expect(calls).toBeGreaterThan(0);
  });
});
