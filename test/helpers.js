import { createEnvironment } from './dom.js';
import { buildWatchPage, populateComments, expandPanel, collapseChat } from './fixture.js';

// Boots a page with the real start.js + comments.js content scripts executed in a
// scoped VM. Returns the environment plus fixture part handles.
export function boot(opts = {}) {
  const {
    href = 'https://www.youtube.com/watch?v=abc123',
    storage = {},
    fixture = {},
    preload = true,
    // Runs after the fixture + start.js are set up, before comments.js loads.
    // Lets tests simulate a not-yet-hydrated page.
    mutate = null,
  } = opts;

  const env = createEnvironment({ href, storage });
  const parts = buildWatchPage(env.document, { videoId: videoIdOf(href), ...fixture });
  env.document.body.appendChild(parts.root);

  if (preload) env.load('./start.js');
  if (mutate) mutate({ env, parts, doc: env.document });
  env.load('./comments.js');

  return { env, parts, doc: env.document };
}

export function bootPlayer(storage = {}) {
  const env = createEnvironment({
    href: 'https://www.youtube.com/watch?v=abc123',
    storage,
  });
  const parts = buildWatchPage(env.document, { videoId: 'abc123' });
  env.document.body.appendChild(parts.root);
  // player.js expects the real YouTube player API surface on #movie_player
  const qualityCalls = [];
  const player = env.document.getElementById('movie_player');
  player.setPlaybackQualityRange = (a, b) => qualityCalls.push(['range', a, b]);
  player.setPlaybackQuality = (q) => qualityCalls.push(['single', q]);
  env.load('./player.js');
  return { env, parts, qualityCalls };
}

export function videoIdOf(href) {
  const m = String(href).match(/[?&]v=([^&#]+)/);
  return m ? m[1] : 'abc123';
}

export function dispatch(env, target, type, detail) {
  const Ev = type.startsWith('yt-') ? env.ctx.CustomEvent : env.ctx.Event;
  const ev = new Ev(type, { bubbles: true, cancelable: true, detail });
  target.dispatchEvent(ev);
  return ev;
}

export { buildWatchPage, populateComments, expandPanel, collapseChat };
