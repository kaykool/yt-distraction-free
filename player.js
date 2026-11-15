// Runs in the MAIN world. This is the only place YouTube's page-JS surface is
// reachable: `#movie_player`'s playback API and the `ytd-*` custom-element
// prototypes are expandos on page objects and do NOT exist in the isolated world
// where content scripts run. Anything needing them is done here and published to
// the DOM, which both worlds share.
(() => {
  const BLOCK_KEY = 'ytlite-block-video';
  const PREV_KEY = 'ytlite-prev-quality';

  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  };
  const clear = (key) => {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  };

  const isBlocked = () => read(BLOCK_KEY) === 'true';

  const player = () => document.getElementById('movie_player');
  const isWatchPage = () =>
    location.pathname.startsWith('/watch') ||
    location.pathname.startsWith('/live');

  function videoIdFromUrl() {
    const match = location.search && location.search.match(/[?&]v=([^&#]+)/);
    if (match) return match[1];
    const liveMatch =
      location.pathname && location.pathname.match(/^\/live\/([^/?#]+)/);
    return liveMatch ? liveMatch[1] : null;
  }

  let navTimers = [];
  let hasSpaNavigated = false;
  let watchSyncStarted = false;
  let eventReplay = null;

  const isStreamReplayData = (vd) =>
    Boolean(vd && vd.isLiveContent === true && vd.isLive !== true);

  function clearNavTimers() {
    navTimers.forEach(clearTimeout);
    navTimers = [];
  }

  function clearPublishedLiveState() {
    const root = document.documentElement;
    root.removeAttribute('data-ytlite-live');
    root.removeAttribute('data-ytlite-video');
    root.removeAttribute('data-ytlite-replay');
  }

  function notifyLiveState() {
    try {
      window.dispatchEvent(new CustomEvent('ytlite-live-state'));
    } catch (_) {}
  }

  function currentQuality() {
    const p = player();
    if (!p || typeof p.getPlaybackQuality !== 'function') return null;
    try {
      const q = p.getPlaybackQuality();
      return q && q !== 'unknown' ? q : null;
    } catch (_) {
      return null;
    }
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
      if (before && before !== 'tiny' && before !== 'auto')
        write(PREV_KEY, before);
      applyQuality('144');
      return;
    }
    // Restore the level the user had before Audio-only pinned it, exactly once.
    const previous = read(PREV_KEY);
    if (previous && applyQuality(previous)) clear(PREV_KEY);
  }

  function detectReplay(videoId) {
    if (
      eventReplay &&
      (eventReplay.videoId
        ? !videoId || eventReplay.videoId === videoId
        : !videoId || eventReplay.path === location.pathname)
    ) {
      return true;
    }

    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    const domVideoId =
      watchEl && typeof watchEl.getAttribute === 'function'
        ? watchEl.getAttribute('video-id')
        : null;
    const domMatches = Boolean(watchEl) && (!videoId || domVideoId === videoId);

    if (domMatches) {
      const chat = document.querySelector('ytd-live-chat-frame, #chat');
      const chatData = chat && chat.data;
      if (
        chatData &&
        (chatData.isReplay === true ||
          chatData.liveChatRenderer?.isReplay === true)
      ) {
        return true;
      }
    }

    const flexyVd = watchEl && watchEl.data?.playerResponse?.videoDetails;
    if (
      isStreamReplayData(flexyVd) &&
      (!videoId || (flexyVd.videoId ? flexyVd.videoId === videoId : domMatches))
    ) {
      return true;
    }

    if (!hasSpaNavigated) {
      const initVd = window.ytInitialPlayerResponse?.videoDetails;
      if (
        isStreamReplayData(initVd) &&
        (!videoId || !initVd.videoId || initVd.videoId === videoId)
      ) {
        return true;
      }
      const initChat =
        window.ytInitialData?.contents?.twoColumnWatchNextResults
          ?.conversationBar?.liveChatRenderer;
      if (
        initChat?.isReplay === true &&
        (!videoId || !initVd?.videoId || initVd.videoId === videoId)
      ) {
        return true;
      }
    }
    return false;
  }

  // Publish the authoritative live flag so the isolated-world script can read it
  // without a cross-world call or an inline-bootstrap-JSON scan.
  //
  // Only a *positive* live answer (or an explicit Stream Replay marker) is published.
  // A negative from getVideoData() is not reliable enough to publish as not-live: on
  // a cold load where the player has not started (for example autoplay blocked) it
  // reports isLive:false for a real live stream. Absence of the flag means "ask something else".
  function publishLiveState() {
    if (!isWatchPage()) {
      clearPublishedLiveState();
      return;
    }

    const root = document.documentElement;
    const urlVideoId = videoIdFromUrl();
    const p = player();
    let data = null;
    if (p && typeof p.getVideoData === 'function') {
      try {
        data = p.getVideoData();
      } catch (_) {
        data = null;
      }
    }
    const dataVideoId = data && (data.video_id || data.videoId);

    // During a fast transition, #movie_player can briefly report the previous video.
    if (data && dataVideoId && urlVideoId && dataVideoId !== urlVideoId) {
      return;
    }

    const prevLive = root.getAttribute('data-ytlite-live');
    const prevVideo = root.getAttribute('data-ytlite-video');
    const prevReplay = root.getAttribute('data-ytlite-replay');

    if (data && typeof data.isLive === 'boolean' && data.isLive) {
      const videoId = dataVideoId || urlVideoId;
      root.removeAttribute('data-ytlite-replay');
      root.setAttribute('data-ytlite-live', 'true');
      if (videoId) root.setAttribute('data-ytlite-video', videoId);
      if (
        prevLive !== 'true' ||
        prevVideo !== (videoId || null) ||
        prevReplay !== null
      ) {
        notifyLiveState();
      }
      return;
    }

    root.removeAttribute('data-ytlite-live');
    root.removeAttribute('data-ytlite-video');

    const replayId = urlVideoId || dataVideoId;
    if (detectReplay(replayId)) {
      const nextReplay = replayId || 'true';
      root.setAttribute('data-ytlite-replay', nextReplay);
      if (prevLive !== null || prevReplay !== nextReplay) notifyLiveState();
      return;
    }

    root.removeAttribute('data-ytlite-replay');
    if (prevLive !== null || prevReplay !== null) notifyLiveState();
  }

  function scheduleWatchSync() {
    clearNavTimers();
    if (!isWatchPage()) return;
    // The player may not be ready at either tick; both are one-shot, never polling.
    navTimers.push(setTimeout(syncQuality, 600));
    navTimers.push(setTimeout(publishLiveState, 600));
    navTimers.push(setTimeout(publishLiveState, 2000));
  }

  // Single click-time synchronization path: comments.js writes localStorage and
  // dispatches ytlite-set-quality across worlds (CustomEvent.detail does not cross).
  window.addEventListener('ytlite-set-quality', syncQuality);

  // Live-chat control needs the custom element's prototype methods, which are only
  // present in this world. The isolated-world button asks for it through an event.
  window.addEventListener('ytlite-open-chat', () => {
    const chat = document.querySelector('ytd-live-chat-frame, #chat');
    if (!chat) return;
    try {
      let opened = false;
      if (typeof chat.setCollapsedState === 'function') {
        chat.setCollapsedState(false);
        opened = true;
      } else if (typeof chat.onShowHideChat === 'function') {
        const isClosed =
          chat.collapsed === true ||
          chat.hasAttribute('collapsed') ||
          chat.hasAttribute('hidden') ||
          chat.hasAttribute('hide-chat-frame');
        if (isClosed) {
          chat.onShowHideChat();
          opened = true;
        }
      }
      if (opened) {
        window.dispatchEvent(new CustomEvent('ytlite-chat-opened'));
      }
    } catch (_) {}
  });

  // A stale published flag or pending timer must never outlive the video it describes.
  window.addEventListener('yt-navigate-start', () => {
    hasSpaNavigated = true;
    watchSyncStarted = true;
    eventReplay = null;
    clearNavTimers();
    clearPublishedLiveState();
  });

  window.addEventListener('yt-navigate-finish', (e) => {
    watchSyncStarted = true;
    const resp = e?.detail?.response;
    const pr =
      e?.detail?.playerResponse ||
      resp?.playerResponse ||
      resp?.response?.playerResponse;
    const contents = resp?.response?.contents || resp?.contents;
    const convBar = contents?.twoColumnWatchNextResults?.conversationBar;
    const chatRenderer =
      convBar?.liveChatRenderer ||
      convBar?.liveChatRendererModel ||
      pr?.liveChatRenderer;
    const vd = pr?.videoDetails;
    if (
      isStreamReplayData(vd) ||
      chatRenderer?.isReplay === true ||
      chatRenderer?.liveChatRenderer?.isReplay === true
    ) {
      eventReplay = {
        videoId: vd?.videoId || videoIdFromUrl() || null,
        path: location.pathname,
      };
    } else if (vd) {
      eventReplay = null;
    }

    if (!isWatchPage()) {
      clearNavTimers();
      clearPublishedLiveState();
      return;
    }
    publishLiveState();
    scheduleWatchSync();
  });

  function initWatchSync() {
    if (!isWatchPage()) return;
    publishLiveState();
    if (!watchSyncStarted) {
      watchSyncStarted = true;
      scheduleWatchSync();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWatchSync, {
      once: true,
    });
  } else {
    initWatchSync();
  }
})();
