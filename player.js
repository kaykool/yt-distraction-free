// Runs in the MAIN world. This is the only place YouTube's page-JS surface is
// reachable: `#movie_player`'s playback API and the `ytd-*` custom-element
// prototypes are expandos on page objects and do NOT exist in the isolated world
// where content scripts run. Anything needing them is done here and published to
// the DOM, which both worlds share.
(() => {
  const BLOCK_KEY = 'ytlite-block-video';
  const PREV_KEY = 'ytlite-prev-quality';

  const read = (key) => { try { return localStorage.getItem(key); } catch (_) { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
  const clear = (key) => { try { localStorage.removeItem(key); } catch (_) {} };

  const isBlocked = () => read(BLOCK_KEY) === 'true';

  const player = () => document.getElementById('movie_player');

  function currentQuality() {
    const p = player();
    if (!p || typeof p.getPlaybackQuality !== 'function') return null;
    try {
      const q = p.getPlaybackQuality();
      return q && q !== 'unknown' ? q : null;
    } catch (_) { return null; }
  }

  function applyQuality(target) {
    const p = player();
    if (!p) return false;
    const q = target === '144' ? 'tiny' : target;
    // setPlaybackQuality delegates to the range call in current builds — call one, not both.
    if (typeof p.setPlaybackQualityRange === 'function') {
      p.setPlaybackQualityRange(q, q);
      return true;
    }
    if (typeof p.setPlaybackQuality === 'function') {
      p.setPlaybackQuality(q);
      return true;
    }
    return false;
  }

  // Audio-only is the only state that lets this script touch playback quality.
  // While it is off the extension must be a complete no-op, otherwise it silently
  // overrides the level the user picked in YouTube's own quality menu.
  function syncQuality() {
    if (isBlocked()) {
      const before = currentQuality();
      if (before && before !== 'tiny' && before !== 'auto') write(PREV_KEY, before);
      applyQuality('144');
      return;
    }
    // Restore the level the user had before Audio-only pinned it, exactly once.
    const previous = read(PREV_KEY);
    if (previous && applyQuality(previous)) clear(PREV_KEY);
  }

  // Publish the authoritative live flag so the isolated-world script can read it
  // without a cross-world call or an inline-bootstrap-JSON scan.
  //
  // Only a *positive* answer is published. A negative from getVideoData() is not
  // reliable enough to publish: on a cold load where the player has not started
  // (for example autoplay blocked) it reports isLive:false for a real live stream,
  // and a published negative is treated as definitive, which would then outrank the
  // DOM's own [live] attribute. Absence of the flag means "ask something else".
  function publishLiveState() {
    const p = player();
    if (!p || typeof p.getVideoData !== 'function') return;
    let data;
    try { data = p.getVideoData(); } catch (_) { return; }
    if (!data || typeof data.isLive !== 'boolean') return;

    const root = document.documentElement;
    if (!data.isLive) {
      root.removeAttribute('data-ytlite-live');
      root.removeAttribute('data-ytlite-video');
      return;
    }
    root.setAttribute('data-ytlite-live', 'true');
    const videoId = data.video_id || data.videoId;
    if (videoId) root.setAttribute('data-ytlite-video', videoId);
  }

  // Read shared localStorage instead of CustomEvent.detail: detail does not
  // survive the ISOLATED -> MAIN world boundary and arrives null.
  window.addEventListener('ytlite-set-quality', syncQuality);

  // Live-chat control needs the custom element's prototype methods, which are only
  // present in this world. The isolated-world button asks for it through an event.
  window.addEventListener('ytlite-open-chat', () => {
    const chat = document.querySelector('ytd-live-chat-frame, #chat');
    if (!chat) return;
    try {
      if (typeof chat.setCollapsedState === 'function') {
        chat.setCollapsedState(false);
      } else if (typeof chat.onShowHideChat === 'function') {
        chat.onShowHideChat();
      }
    } catch (_) {}
  });

  // Click bridge: the AudioOnly toggle button is created by comments.js in the ISOLATED
  // world. Catch its clicks here in the MAIN world so the quality change does
  // not depend on cross-world CustomEvent delivery. Capture phase runs before
  // the button handler; setTimeout(0) reads localStorage after it is written.
  document.addEventListener('click', (e) => {
    const btn = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('.ytlite-video-toggle-btn')
      : null;
    if (!btn) return;
    setTimeout(syncQuality, 0);
  }, true);

  // A stale published flag must never outlive the video it describes.
  window.addEventListener('yt-navigate-start', () => {
    document.documentElement.removeAttribute('data-ytlite-live');
    document.documentElement.removeAttribute('data-ytlite-video');
  });

  window.addEventListener('yt-navigate-finish', () => {
    // The player may not be ready at either tick; both are one-shot, never polling.
    setTimeout(syncQuality, 600);
    setTimeout(publishLiveState, 600);
    setTimeout(publishLiveState, 2000);
  });
})();
