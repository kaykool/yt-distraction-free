import { test, expect, describe } from 'bun:test';
import { createEnvironment } from './dom.js';

const runStart = (href, storage) => {
  const env = createEnvironment({ href, storage });
  env.load('./start.js');
  return env.document.documentElement.classList;
};

describe('start.js: pre-paint class application', () => {
  test('watch page hides comments and shows no video-block class by default', () => {
    const cls = runStart('https://www.youtube.com/watch?v=abc');
    expect(cls.contains('ytlite-comments-hide')).toBe(true);
    expect(cls.contains('ytlite-video-blocked')).toBe(false);
  });

  test('restores persisted audio-only state before first paint', () => {
    const cls = runStart('https://www.youtube.com/watch?v=abc', { 'ytlite-block-video': 'true' });
    expect(cls.contains('ytlite-video-blocked')).toBe(true);
  });

  test('/live route marks live + sidebar and does not hide comments', () => {
    const cls = runStart('https://www.youtube.com/live/abc');
    expect(cls.contains('ytlite-live')).toBe(true);
    expect(cls.contains('ytlite-sidebar-active')).toBe(true);
  });

  test('non-watch pages get no classes', () => {
    const cls = runStart('https://www.youtube.com/feed/subscriptions');
    expect(cls.contains('ytlite-comments-hide')).toBe(false);
    expect(cls.contains('ytlite-live')).toBe(false);
  });

  test('localStorage failures are contained', () => {
    const env = createEnvironment({ href: 'https://www.youtube.com/watch?v=abc' });
    env.localStorage.getItem = () => { throw new Error('denied'); };
    expect(() => env.load('./start.js')).not.toThrow();
  });
});
