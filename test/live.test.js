// Verifies live-stream detection precedence: authoritative YouTube event payloads
// must win over DOM inspection, the MAIN-world player flag published by player.js
// must be honoured, and the isolated world must never try to call page-JS player
// methods (they are expandos that do not cross the world boundary) nor scan
// inline bootstrap JSON.
import { test, expect, describe } from 'bun:test';
import { boot, dispatch } from './helpers.js';

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
        contents: { twoColumnWatchNextResults: { conversationBar: { liveChatRenderer: {} } } },
      },
    });
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('a non-live navigate-finish payload clears live state', () => {
    const { env } = boot({ href: 'https://www.youtube.com/watch?v=abc123', fixture: { isLive: true } });
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
    expect(env.document.documentElement.hasAttribute('data-ytlite-live')).toBe(false);
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('inline bootstrap JSON is never scanned, even as a last resort', () => {
    // The scan was removed: player.js publishes the authoritative answer instead,
    // so the isolated world no longer touches megabyte-sized inline scripts.
    const { env } = boot();
    const script = env.document.createElement('script');
    script.textContent = 'var ytInitialPlayerResponse = {"videoDetails":{"isLive":true,"videoId":"abc123"}};';
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
    parts.moviePlayer.getVideoData = () => { called = true; return { isLive: true }; };
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
    expect(() => { dispatch(env, env.document, 'yt-page-data-updated', {}); env.advance(700); }).not.toThrow();
  });
});
