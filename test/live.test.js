// Verifies live-stream detection precedence: authoritative YouTube event payloads
// must win over DOM/script inspection, and the fragile inline-script scan must
// never run once an event signal has been observed.
import { test, expect, describe } from 'bun:test';
import { boot, dispatch } from './helpers.js';

const cls = (env) => env.document.documentElement.classList;

function countScriptScans(env) {
  // The last-resort path calls querySelectorAll('script:not([src])').
  const state = { calls: 0 };
  const orig = env.document.querySelectorAll.bind(env.document);
  env.document.querySelectorAll = (sel) => {
    if (sel.includes('script:not')) state.calls++;
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

  test('event signal means the inline-script scan is never performed', () => {
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

describe('live detection: cache correctness', () => {
  test('an early negative probe does not permanently strand a later live signal', () => {
    // Regression: isLiveVideo() used to cache "not live" for the video id even when
    // nothing had hydrated yet, so a later authoritative live payload was ignored.
    const { env, parts } = boot();
    // Force an early probe with no signal available at all (player not ready).
    parts.moviePlayer.getVideoData = () => undefined;
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

  test('a definitive non-live answer is cached and reused', () => {
    const { env, parts } = boot();
    parts.moviePlayer.getVideoData = () => ({ isLive: false });
    dispatch(env, env.document, 'yt-page-data-updated', {});
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

  test('player getVideoData() is used before any script scan', () => {
    const { env, parts } = boot();
    parts.moviePlayer.getVideoData = () => ({ isLive: true, video_id: 'abc123' });
    const scans = countScriptScans(env);
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
    expect(scans.calls).toBe(0);
  });

  test('inline bootstrap JSON is the last resort and still detects live', () => {
    const { env } = boot();
    const script = env.document.createElement('script');
    script.textContent = 'var ytInitialPlayerResponse = {"videoDetails":{"isLive":true,"videoId":"abc123"}};';
    env.document.head.appendChild(script);
    dispatch(env, env.document, 'yt-page-data-updated', {});
    env.advance(700);
    expect(cls(env).contains('ytlite-live')).toBe(true);
  });

  test('a broken player API does not throw and falls through safely', () => {
    const { env, parts } = boot();
    parts.moviePlayer.getVideoData = () => { throw new Error('detached'); };
    expect(() => { dispatch(env, env.document, 'yt-page-data-updated', {}); env.advance(700); }).not.toThrow();
    expect(cls(env).contains('ytlite-live')).toBe(false);
  });
});
