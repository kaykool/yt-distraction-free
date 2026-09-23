// Reveal comments on demand. No fetch happens while hidden.
(() => {
  let buttonContainer = null;
  let observer = null;
  let observerSafetyTimer = null;

  function isWatchPage() {
    const path = location.pathname;
    return path.startsWith('/watch') || path.startsWith('/live');
  }

  const hasAttr = (el, attr) => Boolean(el && typeof el.hasAttribute === 'function' && el.hasAttribute(attr));
  const getAttr = (el, attr) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null);

  let cachedVideoId = null;
  let cachedIsLive = false;
  let cachedDefinitive = false; // true when cachedIsLive came from an authoritative source

  // Live status supplied by YouTube's own lifecycle payloads. Authoritative and
  // free, so it is preferred over any DOM inspection.
  let eventLiveSignal = null; // { videoId, isLive }

  function videoIdFromUrl() {
    const match = location.search && location.search.match(/[?&]v=([^&#]+)/);
    return match ? match[1] : null;
  }

  function cacheLive(videoId, isLive, definitive = true) {
    if (videoId) {
      cachedVideoId = videoId;
      cachedIsLive = isLive;
      cachedDefinitive = definitive;
    }
    return isLive;
  }

  function isLiveVideo() {
    if (location.pathname.startsWith('/live')) return true;

    const currentVideoId = videoIdFromUrl();

    // 1. Authoritative: YouTube told us via yt-navigate-finish / yt-page-data-updated.
    //    Checked before the cache because the payload can arrive *after* an initial
    //    probe already concluded "not live" on a not-yet-hydrated page.
    if (eventLiveSignal && eventLiveSignal.videoId === currentVideoId) {
      return cacheLive(currentVideoId, eventLiveSignal.isLive);
    }

    // 2. A definitive answer for this video id is stable. Only *definitive* results
    //    are trusted: an early probe on a not-yet-hydrated page can miss a live
    //    stream, so those indeterminate negatives must not be cached.
    if (currentVideoId && cachedVideoId === currentVideoId && cachedDefinitive) {
      return cachedIsLive;
    }

    // 3. Cheap, stable DOM attributes.
    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (watchEl && (
      hasAttr(watchEl, 'live') ||
      hasAttr(watchEl, 'is-live') ||
      hasAttr(watchEl, 'live-chat-present-and-expanded') ||
      hasAttr(watchEl, 'should-stamp-chat')
    )) {
      return cacheLive(currentVideoId, true);
    }

    const badge = document.querySelector('.ytp-live-badge');
    if (badge && (hasAttr(badge, 'disabled') || (badge.classList && badge.classList.contains('ytp-live-badge-is-livehead')))) {
      return cacheLive(currentVideoId, true);
    }

    // 4. Player API, via the flag player.js (MAIN world) publishes on <html>.
    //    The player object's methods are page-JS expandos and do not exist in this
    //    world, so the player cannot be asked directly from here. Only a positive
    //    answer is ever published there; absence means "no authoritative answer".
    const root = document.documentElement;
    if (hasAttr(root, 'data-ytlite-live')) {
      const publishedFor = getAttr(root, 'data-ytlite-video');
      // A flag published for a different video is stale until player.js refreshes it.
      if (!publishedFor || !currentVideoId || publishedFor === currentVideoId) {
        return cacheLive(currentVideoId, true);
      }
    }

    // No authoritative source was available yet: report "not live" for now without
    // committing it to the cache, so a later event or player signal can still win.
    return cacheLive(currentVideoId, false, false);
  }

  function isLiveChatClosed(chatFrame = document.querySelector('ytd-live-chat-frame, #chat')) {
    if (!chatFrame) return false;
    return hasAttr(chatFrame, 'collapsed') ||
      hasAttr(chatFrame, 'hidden') ||
      hasAttr(chatFrame, 'hide-chat-frame');
  }

  function isSidebarNeeded() {
    if (!isWatchPage()) return false;

    // The sidebar only earns its space when it has content to show. A live video
    // with no chat would otherwise reserve ~400px of column that hide.css empties
    // (the related-video list is hidden), leaving a blank gutter next to the player.
    const chatFrame = document.querySelector('ytd-live-chat-frame, #chat');
    if (chatFrame && !isLiveChatClosed(chatFrame)) return true;

    // Live chat can also be mounted as a bare iframe before its frame element exists.
    const chatIframe = document.getElementById('chatframe');
    if (chatIframe && !chatIframe.hidden) return true;

    // panels-expanded is only set once a panel is genuinely open.
    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (watchEl && hasAttr(watchEl, 'panels-expanded')) return true;

    // Engagement panels (Ask AI, conversational AI, transcripts, chapters, etc.)
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    const commentsHidden = document.documentElement.classList.contains('ytlite-comments-hide');
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const targetId = (getAttr(p, 'target-id') || getAttr(p, 'data-target-id') || '').toLowerCase();
      if (targetId.includes('ad') || targetId.includes('sponsor')) continue;
      if (commentsHidden && targetId.includes('comment')) continue;

      const vis = getAttr(p, 'visibility');
      const isExpanded = vis === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' ||
                         vis === 'ENGAGEMENT_PANEL_VISIBILITY_VISIBLE' ||
                         hasAttr(p, 'opened') ||
                         hasAttr(p, 'expanded') ||
                         hasAttr(p, 'is-expanded') ||
                         (Boolean(vis) && !vis.includes('HIDDEN'));
      const isHidden = hasAttr(p, 'hidden') || vis === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';

      if (isExpanded && !isHidden) {
        return true;
      }
    }

    return false;
  }

  function updateSidebarState() {
    const isLive = isLiveVideo();
    if (isLive) {
      document.documentElement.classList.add('ytlite-live');
      document.documentElement.classList.remove('ytlite-comments-hide');
      disconnectObserver();
    } else {
      document.documentElement.classList.remove('ytlite-live');
    }

    const needSidebar = isSidebarNeeded();
    if (needSidebar) {
      document.documentElement.classList.add('ytlite-sidebar-active');
      if (isLive) {
        removeExistingButton();
      } else if (isWatchPage()) {
        place();
      }
    } else {
      document.documentElement.classList.remove('ytlite-sidebar-active');
      if (isWatchPage()) {
        place();
      }
    }
  }

  let sidebarUpdateTimers = [];
  function clearSidebarTimers() {
    sidebarUpdateTimers.forEach(clearTimeout);
    sidebarUpdateTimers = [];
  }

  function scheduleSidebarUpdate() {
    if (!isWatchPage()) return;
    // Coalesce input bursts: drop the synchronous pass (6-8 DOM queries per click/keypress);
    // the 150/600ms timers below cover the settled state.
    clearSidebarTimers();
    sidebarUpdateTimers.push(setTimeout(updateSidebarState, 150));
    sidebarUpdateTimers.push(setTimeout(updateSidebarState, 600));
  }

  function getUrlFromEvent(e) {
    if (!e || !e.detail) return null;
    if (typeof e.detail.url === 'string') return e.detail.url;
    const ep = e.detail.endpoint;
    if (ep?.commandMetadata?.webCommandMetadata?.url) {
      return ep.commandMetadata.webCommandMetadata.url;
    }
    if (ep?.urlEndpoint?.url) {
      return ep.urlEndpoint.url;
    }
    if (ep?.watchEndpoint?.videoId) {
      return '/watch?v=' + ep.watchEndpoint.videoId;
    }
    if (e.detail.pageType === 'watch') {
      return '/watch';
    }
    return null;
  }

  function isWatchUrl(url) {
    if (!url) return isWatchPage();
    try {
      const u = new URL(url, location.origin);
      return u.pathname.startsWith('/watch') || u.pathname.startsWith('/live');
    } catch (_) {
      return isWatchPage();
    }
  }

  function disconnectObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (observerSafetyTimer) {
      clearTimeout(observerSafetyTimer);
      observerSafetyTimer = null;
    }
  }

  function removeExistingButton() {
    if (buttonContainer) {
      buttonContainer.remove();
      buttonContainer = null;
    }
    const btn = document.querySelector('.ytlite-button-container');
    if (btn) btn.remove();
  }

  function triggerContinuation() {
    const comments = document.querySelector(
      '#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"], ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]'
    );
    if (!comments) return;

    // Scroll into view so IntersectionObserver sees the sentinel
    if (typeof comments.scrollIntoView === 'function') {
      comments.scrollIntoView({ block: 'start', behavior: 'auto' });
    }

    // Trigger internal continuation button if mounted
    const loadBtn = comments.querySelector('ytd-continuation-item-renderer button, tp-yt-paper-button, [role="button"]');
    if (loadBtn && typeof loadBtn.click === 'function') {
      loadBtn.click();
    }

    // Direct continuation dispatch for instant comment loading
    try {
      comments.dispatchEvent(new CustomEvent('yt-load-next-continuation', { bubbles: true }));
      window.dispatchEvent(new Event('scroll'));
    } catch (_) {}

    // One-time micro-scroll kick to wake Chromium IntersectionObserver
    window.scrollBy({ top: 1, behavior: 'auto' });
    window.scrollBy({ top: -1, behavior: 'auto' });
  }

  function revealComments() {
    document.documentElement.classList.remove('ytlite-comments-hide');
    removeExistingButton();
    disconnectObserver();
    triggerContinuation();
  }

  function openLiveChat() {
    // Custom-element methods (setCollapsedState / onShowHideChat) live on the page
    // world prototypes, so the request is handed to player.js. The DOM fallbacks
    // below work from this world and cover a closed chat panel.
    try {
      window.dispatchEvent(new CustomEvent('ytlite-open-chat'));
    } catch (_) {}

    const chat = document.querySelector('ytd-live-chat-frame, #chat');
    if (chat) {
      chat.removeAttribute('collapsed');
      chat.removeAttribute('hidden');
      chat.removeAttribute('hide-chat-frame');
    }
    const showBtn = document.querySelector('#show-hide-button button, [aria-label="Show chat"]');
    if (showBtn) {
      try { showBtn.click(); } catch (_) {}
    }
    const teaserBtn = document.querySelector('#teaser-carousel button, yt-video-metadata-carousel-view-model [role="button"], yt-video-metadata-carousel-view-model button');
    if (teaserBtn) {
      try { teaserBtn.click(); } catch (_) {}
    }
    document.documentElement.classList.add('ytlite-sidebar-active');
    removeExistingButton();
    scheduleSidebarUpdate();
  }

  let isPlacing = false;

  function place() {
    if (isPlacing) return false;
    if (!isWatchPage()) {
      removeExistingButton();
      disconnectObserver();
      return false;
    }

    const isLive = isLiveVideo() || document.documentElement.classList.contains('ytlite-live');
    if (isLive) {
      if (document.documentElement.classList.contains('ytlite-sidebar-active') || !isLiveChatClosed()) {
        removeExistingButton();
        disconnectObserver();
        return false;
      }
    } else {
      if (!document.documentElement.classList.contains('ytlite-comments-hide')) {
        removeExistingButton();
        disconnectObserver();
        return false;
      }
    }

    if (buttonContainer && buttonContainer.isConnected) {
      return true;
    }

    const existing = document.querySelector('.ytlite-button-container');
    if (existing && existing.isConnected) {
      buttonContainer = existing;
      return true;
    }

    // Find the best placement target lazily
    const targetEl = (!isLive && document.querySelector('#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]')) ||
      document.querySelector('ytd-watch-metadata, #below ytd-watch-metadata') ||
      (!isLive && document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]')) ||
      (() => { const b = document.getElementById('below'); return b && b.children.length > 0 ? b : null; })();

    if (!targetEl || !targetEl.parentElement) return false;

    isPlacing = true;
    try {
      removeExistingButton();

      const container = document.createElement('div');
      container.className = 'ytlite-button-container';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytlite-comments-btn';
      if (isLive) {
        btn.textContent = 'Show chat';
        btn.addEventListener('click', openLiveChat, { once: true });
      } else {
        btn.textContent = 'Show comments';
        btn.addEventListener('click', revealComments, { once: true });
      }

      container.appendChild(btn);

      if (targetEl.id === 'below') {
        targetEl.appendChild(container);
      } else if (targetEl.tagName === 'YTD-WATCH-METADATA') {
        targetEl.parentElement.insertBefore(container, targetEl.nextSibling);
      } else {
        targetEl.parentElement.insertBefore(container, targetEl);
      }

      buttonContainer = container;
      return true;
    } finally {
      isPlacing = false;
    }
  }

  function startScopedObserver() {
    disconnectObserver();
    if (!isWatchPage() || !document.documentElement.classList.contains('ytlite-comments-hide')) {
      return;
    }
    if (buttonContainer && buttonContainer.isConnected) {
      return;
    }

    observer = new MutationObserver(() => {
      if (!isWatchPage() || !document.documentElement.classList.contains('ytlite-comments-hide')) {
        disconnectObserver();
        return;
      }
      if (buttonContainer && buttonContainer.isConnected) {
        disconnectObserver();
        return;
      }
      if (place()) {
        disconnectObserver();
      }
    });

    // Scope observer strictly to container elements with subtree: false
    // This completely ignores internal player mutations (buffering, timecode, subtitles)
    const below = document.getElementById('below');
    const primaryInner = document.getElementById('primary-inner');
    const primary = document.getElementById('primary');
    const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');

    const target = (below?.isConnected ? below : null) ||
                   (primaryInner?.isConnected ? primaryInner : null) ||
                   (primary?.isConnected ? primary : null) ||
                   (watchFlexy?.isConnected ? watchFlexy : null) ||
                   document.body;

    if (target) {
      observer.observe(target, { childList: true, subtree: false });
    }

    // Safety timeout: never leak observer into video playback
    observerSafetyTimer = setTimeout(() => {
      disconnectObserver();
    }, 4000);
  }

  let videoToggleBtn = null;
  let videoObserver = null;
  let videoObserverSafetyTimer = null;

  function disconnectVideoObserver() {
    if (videoObserver) {
      videoObserver.disconnect();
      videoObserver = null;
    }
    if (videoObserverSafetyTimer) {
      clearTimeout(videoObserverSafetyTimer);
      videoObserverSafetyTimer = null;
    }
  }

  function updateVideoBtnState(btn) {
    if (!btn) return;
    const isBlocked = document.documentElement.classList.contains('ytlite-video-blocked');
    btn.setAttribute('aria-label', isBlocked ? 'Unblock video (currently Audio Only)' : 'Block video (switch to Audio Only)');
    btn.setAttribute('title', isBlocked ? 'Unblock video (currently Audio Only)' : 'Block video (switch to Audio Only)');
    btn.setAttribute('aria-pressed', isBlocked ? 'true' : 'false');
    btn.textContent = 'AudioOnly';
    btn.classList.toggle('ytlite-ao', isBlocked);
  }

  function placeVideoToggleButton() {
    if (!isWatchPage()) {
      disconnectVideoObserver();
      return false;
    }

    if (videoToggleBtn && videoToggleBtn.isConnected) {
      updateVideoBtnState(videoToggleBtn);
      return true;
    }

    const existing = document.querySelector('.ytlite-video-toggle-btn');
    if (existing && existing.isConnected) {
      videoToggleBtn = existing;
      updateVideoBtnState(videoToggleBtn);
      return true;
    }

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return false;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytp-button ytlite-video-toggle-btn';
    updateVideoBtnState(btn);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextBlocked = !document.documentElement.classList.contains('ytlite-video-blocked');
      document.documentElement.classList.toggle('ytlite-video-blocked', nextBlocked);
      try {
        localStorage.setItem('ytlite-block-video', nextBlocked ? 'true' : 'false');
      } catch (_) {}
      updateVideoBtnState(btn);
      window.dispatchEvent(new CustomEvent('ytlite-set-quality', { detail: { quality: nextBlocked ? '144' : '480' } }));
    });

    // Ensure we find the top-level container inside rightControls, not an inner child
    const autonavContainer = rightControls.querySelector('.ytp-autonav-toggle-button-container');
    if (autonavContainer && autonavContainer.parentElement === rightControls) {
      rightControls.insertBefore(btn, autonavContainer);
    } else {
      rightControls.prepend(btn);
    }

    videoToggleBtn = btn;
    disconnectVideoObserver();
    return true;
  }

  function startScopedVideoObserver() {
    disconnectVideoObserver();
    if (!isWatchPage()) return;
    if (videoToggleBtn && videoToggleBtn.isConnected) return;

    const target = document.querySelector('.html5-video-player, #movie_player, #ytd-player, #player, #player-container-outer, #primary-inner');
    if (!target) return;

    videoObserver = new MutationObserver(() => {
      if (!isWatchPage()) {
        disconnectVideoObserver();
        return;
      }
      if (placeVideoToggleButton()) {
        disconnectVideoObserver();
      }
    });
    videoObserver.observe(target, { childList: true, subtree: true });

    videoObserverSafetyTimer = setTimeout(() => {
      disconnectVideoObserver();
    }, 4000);
  }

  function initVideoToggle() {
    if (!isWatchPage()) {
      disconnectVideoObserver();
      return;
    }
    if (!placeVideoToggleButton()) {
      startScopedVideoObserver();
    }
    const isBlocked = document.documentElement.classList.contains('ytlite-video-blocked');
    window.dispatchEvent(new CustomEvent('ytlite-set-quality', { detail: { quality: isBlocked ? '144' : '480' } }));
  }

  function init() {
    updateSidebarState();
    if (!isWatchPage()) {
      clearSidebarTimers();
      disconnectObserver();
      disconnectVideoObserver();
      removeExistingButton();
      document.documentElement.classList.remove('ytlite-sidebar-active');
      document.documentElement.classList.remove('ytlite-live');
      return;
    }

    initVideoToggle();

    const isLive = isLiveVideo() || document.documentElement.classList.contains('ytlite-live');
    if (isLive && !isLiveChatClosed()) {
      clearSidebarTimers();
      disconnectObserver();
      removeExistingButton();
      return;
    }

    // Catch deferred custom element hydration on direct cold watch page loads
    clearSidebarTimers();
    sidebarUpdateTimers.push(setTimeout(updateSidebarState, 300));
    sidebarUpdateTimers.push(setTimeout(updateSidebarState, 1200));
    sidebarUpdateTimers.push(setTimeout(updateSidebarState, 3000));

    if (!isLive && !document.documentElement.classList.contains('ytlite-comments-hide')) {
      disconnectObserver();
      return;
    }

    if (!place()) {
      startScopedObserver();
    } else {
      disconnectObserver();
    }
  }

  function handleNavigateStart(e) {
    clearSidebarTimers();
    cachedVideoId = null;
    cachedIsLive = false;
    cachedDefinitive = false;
    eventLiveSignal = null;
    const navUrl = getUrlFromEvent(e);
    const willBeWatch = navUrl ? isWatchUrl(navUrl) : isWatchPage();
    if (willBeWatch) {
      document.documentElement.classList.add('ytlite-comments-hide');
      if (navUrl && navUrl.includes('/live')) {
        document.documentElement.classList.add('ytlite-live');
        document.documentElement.classList.add('ytlite-sidebar-active');
      } else if (navUrl && !navUrl.includes('/live')) {
        document.documentElement.classList.remove('ytlite-live');
        document.documentElement.classList.remove('ytlite-sidebar-active');
      }
    } else {
      document.documentElement.classList.remove('ytlite-comments-hide');
      document.documentElement.classList.remove('ytlite-live');
      document.documentElement.classList.remove('ytlite-sidebar-active');
    }
    removeExistingButton();
    disconnectObserver();
    disconnectVideoObserver();
  }

  function handleNavigateFinish(e) {
    clearSidebarTimers();
    const resp = e?.detail?.response;
    const pr = e?.detail?.playerResponse || resp?.playerResponse;
    const isLiveFromEvent = Boolean(pr?.videoDetails?.isLive || pr?.videoDetails?.isLiveContent);
    const hasChatFromEvent = Boolean(
      resp?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer ||
      resp?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRendererModel ||
      pr?.liveChatRenderer
    );
    const match = location.search && location.search.match(/[?&]v=([^&#]+)/);
    if (match && (pr || resp)) {
      // Record the authoritative signal so isLiveVideo() never has to scan scripts.
      eventLiveSignal = { videoId: match[1], isLive: isLiveFromEvent || hasChatFromEvent };
      cachedVideoId = match[1];
      cachedIsLive = eventLiveSignal.isLive;
    }
    if (isLiveFromEvent || hasChatFromEvent) {
      document.documentElement.classList.add('ytlite-live');
      document.documentElement.classList.add('ytlite-sidebar-active');
      document.documentElement.classList.remove('ytlite-comments-hide');
    }

    updateSidebarState();
    if (isWatchPage()) {
      if (!isLiveVideo()) {
        document.documentElement.classList.add('ytlite-comments-hide');
      }
      removeExistingButton();
      init();
    } else {
      document.documentElement.classList.remove('ytlite-comments-hide');
      document.documentElement.classList.remove('ytlite-live');
      document.documentElement.classList.remove('ytlite-sidebar-active');
      disconnectObserver();
      removeExistingButton();
    }
  }

  function handleDataUpdated(e) {
    const resp = e?.detail?.response;
    const pr = e?.detail?.playerResponse || resp?.playerResponse;
    if (pr || resp) {
      const videoId = videoIdFromUrl();
      const isLive = Boolean(pr?.videoDetails?.isLive || pr?.videoDetails?.isLiveContent) ||
        Boolean(resp?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer ||
                resp?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRendererModel ||
                pr?.liveChatRenderer);
      if (videoId) eventLiveSignal = { videoId, isLive };
    }
    updateSidebarState();
    if (isWatchPage()) {
      placeVideoToggleButton();
    }
    if (!isWatchPage() || isLiveVideo() || !document.documentElement.classList.contains('ytlite-comments-hide')) {
      return;
    }
    if (buttonContainer && buttonContainer.isConnected) {
      return;
    }
    if (!place()) {
      startScopedObserver();
    } else {
      disconnectObserver();
    }
  }

  init();
  document.addEventListener('yt-navigate-start', handleNavigateStart);
  document.addEventListener('yt-navigate-finish', handleNavigateFinish);
  document.addEventListener('yt-page-data-updated', handleDataUpdated);
  window.addEventListener('popstate', handleNavigateFinish);
  document.addEventListener('click', scheduleSidebarUpdate, { passive: true });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      scheduleSidebarUpdate();
    }
  }, { passive: true });
  document.addEventListener('yt-engagement-panel-visibility-changed', scheduleSidebarUpdate, { passive: true });
  document.addEventListener('yt-visibility-refresh', scheduleSidebarUpdate, { passive: true });
  document.addEventListener('yt-chat-collapsed-changed', scheduleSidebarUpdate, { passive: true });
})();
