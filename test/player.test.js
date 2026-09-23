import { test, expect, describe } from 'bun:test';
import { bootPlayer } from './helpers.js';

describe('player.js: quality control bridge', () => {
  test('uses setPlaybackQualityRange when available, not both APIs', () => {
    const { env, qualityCalls } = bootPlayer();
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    // default storage => normal mode => 480p ("large")
    expect(qualityCalls).toEqual([['range', 'large', 'large']]);
  });

  test('audio-only state forces 144p ("tiny")', () => {
    const { env, qualityCalls } = bootPlayer({ 'ytlite-block-video': 'true' });
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([['range', 'tiny', 'tiny']]);
  });

  test('falls back to setPlaybackQuality when the range API is missing', () => {
    const { env, parts, qualityCalls } = bootPlayer();
    delete parts.moviePlayer.setPlaybackQualityRange;
    env.window.dispatchEvent(new env.ctx.CustomEvent('ytlite-set-quality'));
    expect(qualityCalls).toEqual([['single', 'large']]);
  });

  test('missing player does not throw', () => {
    const { env, parts, qualityCalls } = bootPlayer();
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
    const { env, qualityCalls } = bootPlayer();
    env.window.dispatchEvent(new env.ctx.CustomEvent('yt-navigate-finish'));
    expect(qualityCalls.length).toBe(0); // deferred via setTimeout(600)
    env.advance(700);
    expect(qualityCalls).toEqual([['range', 'large', 'large']]);
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
