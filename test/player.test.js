import { test, expect, describe } from 'bun:test';
import { bootPlayer } from './helpers.js';

describe('player.js: audio-only quality control', () => {
  test('is a complete no-op while audio-only is off', () => {
    // Regression: this used to pin 480p ("large") on every load and every SPA
    // navigation, silently overriding the level the user picked in YouTube's menu.
    const { env, qualityCalls } = bootPlayer();
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([]);
  });

  test('audio-only on forces 144p ("tiny")', () => {
    const { env, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
  });

  test('uses setPlaybackQualityRange when available, not both APIs', () => {
    const { env, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls.length).toBe(1);
    expect(qualityCalls[0][0]).toBe('range');
  });

  test('falls back to setPlaybackQuality when the range API is missing', () => {
    const { env, parts, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    delete parts.moviePlayer.setPlaybackQualityRange;
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([['single', 'tiny']]);
  });

  test('remembers the pre-audio-only level and restores it exactly once', () => {
    const { env, parts, qualityCalls } = bootPlayer();
    parts.moviePlayer.getPlaybackQuality = () => 'hd1080';
    env.localStorage.setItem('ytlite-block-video', 'true');

    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
    expect(env.localStorage.getItem('ytlite-prev-quality')).toBe('hd1080');

    env.localStorage.setItem('ytlite-block-video', 'false');
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny'], ['range', 'hd1080', 'hd1080']]);

    // The saved level is consumed on restore, so a later event cannot re-apply it.
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls.length).toBe(2);
  });

  test('restores nothing when no prior level was ever recorded', () => {
    const { env, qualityCalls } = bootPlayer();
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([]);
  });

  test('missing player does not throw', () => {
    const { env, parts, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    parts.moviePlayer.remove();
    expect(() => env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'))).not.toThrow();
    expect(qualityCalls.length).toBe(0);
  });

  test('reads shared localStorage, not the (world-crossing) event detail', () => {
    const { env, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality', { detail: { quality: '480' } }));
    // localStorage is the source of truth; the stale detail must be ignored.
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
  });

  test('SPA navigation re-applies quality after the debounce', () => {
    const { env, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    expect(qualityCalls.length).toBe(0); // deferred via setTimeout(600)
    env.advance(700);
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
  });

  test('SPA navigation with audio-only off leaves quality untouched', () => {
    const { env, qualityCalls } = bootPlayer();
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    env.advance(700);
    expect(qualityCalls).toEqual([]);
  });
});

describe('player.js: click bridge', () => {
  test('clicking the toggle re-applies quality from localStorage', () => {
    const { env, parts, qualityCalls } = bootPlayer();
    const btn = env.document.createElement('button');
    btn.className = 'ytlite-video-toggle-btn';
    parts.rightControls.appendChild(btn);

    // Simulate comments.js writing the new state, then the click bubbling.
    env.localStorage.setItem('ytlite-block-video', 'true');
    btn.dispatchEvent(new env.ctx.Event('click', { bubbles: true }));
    expect(qualityCalls.length).toBe(0); // read after setTimeout(0)
    env.advance(1);
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
  });

  test('clicks on unrelated controls are ignored', () => {
    const { env, parts, qualityCalls } = bootPlayer();
    parts.rightControls.dispatchEvent(new env.ctx.Event('click', { bubbles: true }));
    env.advance(10);
    expect(qualityCalls).toEqual([]);
  });
});

describe('player.js: live-state publication (isolated world cannot call the player)', () => {
  const attr = (env, name) => env.document.documentElement.getAttribute(name);

  test('publishes a positive isLive on <html> so the isolated world can read it', () => {
    const { env, parts } = bootPlayer();
    parts.moviePlayer.getVideoData = () => ({ isLive: true, video_id: 'abc123' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    env.advance(700);
    expect(attr(env, 'data-ytlite-live')).toBe('true');
    expect(attr(env, 'data-ytlite-video')).toBe('abc123');
  });

  test('a negative answer is never published', () => {
    // Regression: publishing isLive:false made an unreliable cold-load reading
    // definitive, so it outranked the DOM's own [live] attribute and a live stream
    // could render as a normal video.
    const { env, parts } = bootPlayer();
    parts.moviePlayer.getVideoData = () => ({ isLive: false, video_id: 'abc123' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    env.advance(700);
    expect(attr(env, 'data-ytlite-live')).toBeNull();
    expect(attr(env, 'data-ytlite-video')).toBeNull();
  });

  test('a stale positive is dropped once the player reports not-live', () => {
    const { env, parts } = bootPlayer();
    parts.moviePlayer.getVideoData = () => ({ isLive: true, video_id: 'abc123' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    env.advance(700);
    expect(attr(env, 'data-ytlite-live')).toBe('true');

    let live = true;
    parts.moviePlayer.getVideoData = () => ({ isLive: live, video_id: 'abc123' });
    live = false;
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    env.advance(700);
    expect(attr(env, 'data-ytlite-live')).toBeNull();
  });

  test('a missing or broken player API publishes nothing and does not throw', () => {
    const { env, parts } = bootPlayer();
    parts.moviePlayer.remove();
    expect(() => { env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish')); env.advance(700); }).not.toThrow();
    expect(attr(env, 'data-ytlite-live')).toBeNull();
  });

  test('a stale flag is cleared when the next video starts', () => {
    const { env, parts } = bootPlayer();
    parts.moviePlayer.getVideoData = () => ({ isLive: true, video_id: 'abc123' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    env.advance(700);
    expect(attr(env, 'data-ytlite-live')).toBe('true');

    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-start'));
    expect(attr(env, 'data-ytlite-live')).toBeNull();
    expect(attr(env, 'data-ytlite-video')).toBeNull();
  });

  test('open-chat request reaches the custom element method in this world', () => {
    const { env, parts } = bootPlayer();
    let collapsedState = 'collapsed';
    parts.chatFrame = env.document.createElement('ytd-live-chat-frame');
    parts.chatFrame.setCollapsedState = (v) => { collapsedState = v ? 'collapsed' : 'expanded'; };
    env.document.body.appendChild(parts.chatFrame);

    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-open-chat'));
    expect(collapsedState).toBe('expanded');
  });

  test('open-chat with no chat frame does not throw', () => {
    const { env } = bootPlayer();
    expect(() => env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-open-chat'))).not.toThrow();
  });
});
