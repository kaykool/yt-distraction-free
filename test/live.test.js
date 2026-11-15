// Verifies live-stream detection precedence: authoritative YouTube event payloads
// must win over DOM inspection, the MAIN-world player flag published by player.js
// must be honoured, and the isolated world must never try to call page-JS player
// methods (they are expandos that do not cross the world boundary) nor scan
// inline bootstrap JSON.
import { test, expect, describe } from 'bun:test';
import {
  boot,
  bootDualWorld,
  dispatch,
  mountChat,
  expandPanel,
  spaNavigateStart,
  spaNavigateFinish,
  spaPageDataUpdated,
} from './helpers.js';

const cls = (env) => env.document.documentElement.classList;

// The MAIN world publishes the player's authoritative answer on <html>; this is
// what player.js does and what comments.js reads. Only positives are published.
function publishPlayerLive(env, videoId = 'abc123') {
  env.document.documentElement.setAttribute('data-ytlite-live', 'true');
  env.document.documentElement.setAttribute('data-ytlite-video', videoId);
}

function countScriptScans(env) {
  // The old last-resort path called querySelectorAll('script:not([src])').
  const state = { calls: 0 };
  const orig = env.document.querySelectorAll.bind(env.document);
  env.document.querySelectorAll = (sel) => {
    if (sel.includes('script')) state.calls++;
    return orig(sel);
  };
  return state;
}

describe('live detection: event payload precedence', () => {
  test('yt-navigate-finish with isLive payload marks the page live', () => {
    const { env } = boot();
    dispatch(env, env.document, 'yt-navigate-finish', {
      playerResponse: { videoDetails: { isLive: true } },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('liveChatRenderer in the response counts as live', () => {
    const { env } = boot();
    dispatch(env, env.document, 'yt-navigate-finish', {
      response: {
        contents: {
          twoColumnWatchNextResults: {
            conversationBar: { liveChatRenderer: {} },
          },
        },
      },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('a non-live navigate-finish payload clears live state', () => {
    const { env } = boot({
      href: 'https://www.youtube.com/watch?v=abc123',
      fixture: { isLive: true },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
    dispatch(env, env.document, 'yt-navigate-finish', {
      playerResponse: { videoDetails: { isLive: false, isLiveContent: false } },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(false);
  });

  test('event signal means no DOM/script fallback probing is needed', () => {
    const { env } = boot();
    dispatch(env, env.document, 'yt-navigate-finish', {
      playerResponse: { videoDetails: { isLive: false } },
    });
    const scans = countScriptScans(env);
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(scans.calls).toBe(0);
  });
});

describe('live detection: MAIN-world player flag', () => {
  test('the published flag is honoured when no event payload exists', () => {
    const { env } = boot();
    publishPlayerLive(env);
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('an absent flag is not treated as a negative answer', () => {
    // The flag is only ever published positive. Absence must fall through to the
    // other cues rather than concluding "not live".
    const { env, parts } = boot();
    parts.root.setAttribute('live', '');
    expect(env.document.documentElement.hasAttribute('data-ytlite-live')).toBe(
      false
    );
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('inline bootstrap JSON is never scanned, even as a last resort', () => {
    // The scan was removed: player.js publishes the authoritative answer instead,
    // so the isolated world no longer touches megabyte-sized inline scripts.
    const { env } = boot();
    const script = env.document.createElement('script');
    script.textContent =
      'var ytInitialPlayerResponse = {"videoDetails":{"isLive":true,"videoId":"abc123"}};';
    env.document.head.appendChild(script);
    const scans = countScriptScans(env);
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(scans.calls).toBe(0);
  });

  test('a flag published for another video is not trusted', () => {
    const { env } = boot();
    publishPlayerLive(env, 'some-other-video');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(false);
  });

  test('the isolated world never calls player methods that only exist in MAIN', () => {
    // Regression: getVideoData() is a page-JS expando, always undefined here.
    const { env, parts } = boot();
    let called = false;
    parts.moviePlayer.getVideoData = () => {
      called = true;
      return { isLive: true };
    };
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(called).toBe(false);
  });
});

describe('live detection: cache correctness', () => {
  test('an early negative probe does not permanently strand a later live signal', () => {
    // Regression: isLiveVideo() used to cache "not live" for the video id even when
    // nothing had hydrated yet, so a later authoritative live payload was ignored.
    const { env } = boot();
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(false);

    // Now YouTube delivers the real answer.
    dispatch(env, env.document, 'yt-navigate-finish', {
      playerResponse: { videoDetails: { isLive: true } },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('a definitive answer is cached and reused', () => {
    const { env, parts } = boot();
    dispatch(env, env.document, 'yt-navigate-finish', {
      playerResponse: { videoDetails: { isLive: false } },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(false);
    // Flip the DOM cue; the cached definitive negative must still win.
    parts.root.setAttribute('live', '');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(false);
  });
});

describe('live detection: fallbacks when no event payload is available', () => {
  test('ytd-watch-flexy[live] attribute is honoured', () => {
    const { env, parts } = boot({ fixture: { isLive: true } });
    parts.root.setAttribute('live', '');
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('a broken published flag does not throw and falls through safely', () => {
    const { env } = boot();
    env.document.documentElement.setAttribute('data-ytlite-live', 'true');
    expect(() => {
      dispatch(env, env.document, 'yt-page-data-updated', {});
      env.advance(700);
    }).not.toThrow();
  });
});

describe('live detection: stale DOM cues after SPA navigation', () => {
  // ytd-watch-flexy is reused across SPA navigations; its video-id and live
  // attributes describe the previous video for a second or more after the URL
  // changes. A mismatched video-id must disqualify them.
  test('a stale video-id disqualifies the live attributes', () => {
    const { env, parts } = boot();
    parts.root.setAttribute('video-id', 'previous-video');
    parts.root.setAttribute('live', '');
    parts.root.setAttribute('should-stamp-chat', '');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(false);
  });

  test('a matching video-id still honours the live attributes', () => {
    const { env, parts } = boot();
    parts.root.setAttribute('video-id', 'abc123');
    parts.root.setAttribute('live', '');
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });
});

describe('live detection: nested SPA payloads without cache poisoning', () => {
  test('nested response.response.contents.twoColumnWatchNextResults.conversationBar marks live without playerResponse', () => {
    const { env } = boot();
    dispatch(
      env,
      env.document,
      'yt-navigate-finish',
      spaNavigateFinish({ hasLiveChat: true })
    );
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(false);

    const { env: envModel } = boot();
    dispatch(
      envModel,
      envModel.document,
      'yt-navigate-finish',
      spaNavigateFinish({ hasLiveChat: true, liveChatModel: true })
    );
    envModel.advance(700);
    expect(cls(envModel).contains('ytlite-live')).toBe(true);
    expect(cls(envModel).contains('ytlite-comments-hide')).toBe(false);
  });

  test('SPA transition from Regular Video to Live Stream with omitted playerResponse still activates ytlite-live via MAIN player', () => {
    const { env, doc, parts, advance, navigate } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=reg1',
    });
    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);

    navigate('https://www.youtube.com/watch?v=live1');
    dispatch(env, doc, 'yt-navigate-start', spaNavigateStart('/watch?v=live1'));
    parts.root.setAttribute('video-id', 'live1');
    parts.moviePlayer.getVideoData = () => ({
      isLive: true,
      video_id: 'live1',
    });

    // Real YouTube SPA events: nested response omitting playerResponse + conversationBar,
    // followed by minimal yt-page-data-updated ({ pageType: 'watch' }).
    dispatch(env, doc, 'yt-navigate-finish', spaNavigateFinish());
    dispatch(env, doc, 'yt-page-data-updated', spaPageDataUpdated());
    advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(true);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')).toBeNull();
  });
});

describe('live detection: strict Live Stream vs Stream Replay boundary', () => {
  test('isLiveContent with isLive !== true treats Stream Replay as Regular Video even with uncollapsed Chat Replay', () => {
    const { env, doc, parts } = boot({
      href: 'https://www.youtube.com/watch?v=replay1',
    });
    mountChat(doc, parts, { collapsed: false });

    dispatch(env, doc, 'yt-navigate-finish', {
      response: {
        playerResponse: {
          videoDetails: { isLive: false, isLiveContent: true },
        },
        response: {
          contents: {
            twoColumnWatchNextResults: {
              conversationBar: { liveChatRenderer: { isReplay: true } },
            },
          },
        },
      },
    });
    env.advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );
  });

  test('videoDetails omitting isLive with isLiveContent: true classifies as Stream Replay', () => {
    const { env, doc, parts } = boot({
      href: 'https://www.youtube.com/watch?v=replay2',
    });
    mountChat(doc, parts, { collapsed: false });

    dispatch(
      env,
      doc,
      'yt-navigate-finish',
      spaNavigateFinish({
        playerResponse: { videoDetails: { isLiveContent: true } },
      })
    );
    env.advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );
  });

  test('nested liveChatRenderer with isReplay: true (and omitted playerResponse) classifies as Stream Replay', () => {
    const { env, doc, parts } = boot({
      href: 'https://www.youtube.com/watch?v=replay3',
    });
    mountChat(doc, parts, { collapsed: false });

    dispatch(env, doc, 'yt-navigate-finish', {
      response: {
        response: {
          contents: {
            twoColumnWatchNextResults: {
              conversationBar: { liveChatRenderer: { isReplay: true } },
            },
          },
        },
      },
    });
    env.advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );
  });

  test('cold-load Stream Replay with should-stamp-chat and Chat Replay stays collapsed behind Show comments', () => {
    const { env, doc, parts, advance } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=replayCold',
      mutate: ({ parts: p, main: m }) => {
        p.root.setAttribute('should-stamp-chat', '');
        p.root.setAttribute('live-chat-present-and-expanded', '');
        mountChat(m.document, p, { collapsed: false });
      },
    });
    // Set MAIN-world expandos via main.document (bootDualWorld's raw DOM).
    parts.moviePlayer.getVideoData = () => ({
      isLive: false,
      video_id: 'replayCold',
    });
    parts.chatFrame.data = { liveChatRenderer: { isReplay: true } };

    advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );

    // Expanding an Engagement Panel on the Stream Replay still reveals the Sidebar.
    expandPanel(parts, 'ask');
    dispatch(env, doc, 'yt-page-data-updated', spaPageDataUpdated());
    advance(700);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(true);
    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
  });

  test('Stream Replay on /live/<id> route does not force Live Stream layout', () => {
    const { env, doc, parts } = boot({
      href: 'https://www.youtube.com/live/replay4',
    });
    mountChat(doc, parts, { collapsed: false });

    dispatch(env, doc, 'yt-navigate-finish', {
      playerResponse: { videoDetails: { isLive: false, isLiveContent: true } },
    });
    env.advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );
  });
});

describe('live detection: transition-safe DOM cues and current YouTube watch containers', () => {
  test('missing video-id during SPA transition disqualifies stale live attributes and badge', () => {
    const { env, doc, parts } = boot({
      href: 'https://www.youtube.com/watch?v=nextVid',
      fixture: { videoId: null },
    });
    parts.root.setAttribute('live', '');
    parts.root.setAttribute('should-stamp-chat', '');
    parts.root.setAttribute('live-chat-present-and-expanded', '');

    const badge = doc.createElement('button');
    badge.className = 'ytp-live-badge ytp-button ytp-live-badge-is-livehead';
    badge.setAttribute('disabled', '');
    parts.moviePlayer.appendChild(badge);

    dispatch(env, doc, 'yt-page-data-updated', spaPageDataUpdated());
    env.advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );
  });

  test('Live Stream -> Regular Video dual-world SPA transition with missing video-id and stale player stays non-live', () => {
    const { env, doc, parts, navigate, advance } = bootDualWorld({
      href: 'https://www.youtube.com/watch?v=live1',
      fixture: { isLive: true },
    });
    parts.root.setAttribute('should-stamp-chat', '');
    parts.root.setAttribute('live-chat-present-and-expanded', '');
    parts.moviePlayer.getVideoData = () => ({
      isLive: true,
      video_id: 'live1',
    });
    advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);

    navigate('https://www.youtube.com/watch?v=reg2');
    dispatch(env, doc, 'yt-navigate-start', spaNavigateStart('/watch?v=reg2'));
    parts.root.removeAttribute('video-id');
    // Stale live attributes and badge linger across transition; player still returns live1.
    dispatch(
      env,
      doc,
      'yt-navigate-finish',
      spaNavigateFinish({ hasLiveChat: false })
    );
    dispatch(env, doc, 'yt-page-data-updated', spaPageDataUpdated());
    advance(700);

    expect(cls(env).contains('ytlite-live')).toBe(false);
    expect(cls(env).contains('ytlite-comments-hide')).toBe(true);
    expect(cls(env).contains('ytlite-sidebar-active')).toBe(false);
    expect(doc.querySelector('.ytlite-comments-btn')?.textContent).toBe(
      'Show comments'
    );
  });

  test('current player live cues honour active tooltip/live-time when video-id matches and ignore hidden badges', () => {
    // Hidden badge must not trigger live classification even when video-id matches.
    const {
      env: e1,
      doc: d1,
      parts: p1,
    } = boot({
      href: 'https://www.youtube.com/watch?v=h1',
      fixture: { videoId: 'h1' },
    });
    const hiddenBadge = d1.createElement('button');
    hiddenBadge.className = 'ytp-live-badge ytp-button';
    hiddenBadge.setAttribute(
      'data-tooltip-title',
      'Skip ahead to live broadcast.'
    );
    hiddenBadge.setAttribute('hidden', '');
    p1.moviePlayer.appendChild(hiddenBadge);
    dispatch(e1, d1, 'yt-page-data-updated', spaPageDataUpdated());
    e1.advance(700);
    expect(cls(e1).contains('ytlite-live')).toBe(false);

    // Non-hidden active tooltip badge on behind-live stream matches when video-id matches.
    const {
      env: e2,
      doc: d2,
      parts: p2,
    } = boot({
      href: 'https://www.youtube.com/watch?v=l2',
      fixture: { videoId: 'l2' },
    });
    const activeBadge = d2.createElement('button');
    activeBadge.className = 'ytp-live-badge ytp-button';
    activeBadge.setAttribute(
      'data-tooltip-title',
      'Skip ahead to live broadcast.'
    );
    activeBadge.setAttribute('aria-label', 'Skip ahead to live broadcast.');
    p2.moviePlayer.appendChild(activeBadge);
    dispatch(e2, d2, 'yt-page-data-updated', spaPageDataUpdated());
    e2.advance(700);
    expect(cls(e2).contains('ytlite-live')).toBe(true);

    // Active live time display class marks live when video-id matches.
    const {
      env: e3,
      doc: d3,
      parts: p3,
    } = boot({
      href: 'https://www.youtube.com/watch?v=l3',
      fixture: { videoId: 'l3' },
    });
    const timeDisp = d3.createElement('div');
    timeDisp.className = 'ytp-time-display ytp-live';
    p3.moviePlayer.appendChild(timeDisp);
    dispatch(e3, d3, 'yt-page-data-updated', spaPageDataUpdated());
    e3.advance(700);
    expect(cls(e3).contains('ytlite-live')).toBe(true);
  });
});
