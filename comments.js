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

  function isLiveVideo() {
    if (location.pathname.startsWith('/live')) return true;

    const match = location.search && location.search.match(/[?&]v=([^&#]+)/);
    const currentVideoId = match ? match[1] : null;

    if (currentVideoId && cachedVideoId === currentVideoId) {
      return cachedIsLive;
    }

    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (watchEl && (
      hasAttr(watchEl, 'live') ||
      hasAttr(watchEl, 'is-live') ||
      hasAttr(watchEl, 'live-chat-present-and-expanded') ||
      hasAttr(watchEl, 'should-stamp-chat')
    )) {
      if (currentVideoId) { cachedVideoId = currentVideoId; cachedIsLive = true; }
      return true;
    }

    const badge = document.querySelector('.ytp-live-badge');
    if (badge && (hasAttr(badge, 'disabled') || (badge.classList && badge.classList.contains('ytp-live-badge-is-livehead')))) {
      if (currentVideoId) { cachedVideoId = currentVideoId; cachedIsLive = true; }
      return true;
    }

    const scripts = typeof document.getElementsByTagName === 'function'
      ? document.getElementsByTagName('script')
      : (typeof document.querySelectorAll === 'function' ? document.querySelectorAll('script') : []);
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      if (s.src) continue;
      const txt = s.textContent;
      if (txt && (txt.includes('"isLive":true') || txt.includes('"isLiveContent":true') || txt.includes('liveChatRenderer'))) {
        if (!currentVideoId || txt.includes(currentVideoId)) {
          if (currentVideoId) { cachedVideoId = currentVideoId; cachedIsLive = true; }
          return true;
        }
      }
    }

    if (currentVideoId) {
      cachedVideoId = currentVideoId;
      cachedIsLive = false;
    }
    return false;
  }

  function isLiveChatClosed() {
    const chatFrame = document.querySelector('ytd-live-chat-frame, #chat');
    if (!chatFrame) return false;
    return hasAttr(chatFrame, 'collapsed') ||
      hasAttr(chatFrame, 'hidden') ||
      hasAttr(chatFrame, 'hide-chat-frame');
  }

  function isSidebarNeeded(isLive) {
    if (!isWatchPage()) return false;

    // 1. Direct /live stream route or live video (when chat is not closed)
    if (isLive !== undefined ? isLive : isLiveVideo()) {
      if (!isLiveChatClosed()) return true;
    }

    // 2. Watch container attributes
    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (watchEl) {
      if ((hasAttr(watchEl, 'live') || hasAttr(watchEl, 'is-live')) && !isLiveChatClosed()) return true;
      if (hasAttr(watchEl, 'panels-expanded')) return true;
    }

    // 3. Active live chat frame
    const chatFrame = document.querySelector('ytd-live-chat-frame, #chat');
    if (chatFrame && !isLiveChatClosed()) {
      return true;
    }

    // 4. Active chatframe iframe
    const chatIframe = document.getElementById('chatframe');
    if (chatIframe && !chatIframe.hidden && !isLiveChatClosed()) {
      const chatParent = typeof chatIframe.closest === 'function' ? chatIframe.closest('ytd-live-chat-frame, #chat') : null;
      if (!chatParent || !isLiveChatClosed()) {
        return true;
      }
    }

    // 5. Engagement panels (Ask AI, conversational AI, transcripts, chapters, etc.)
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const targetId = (getAttr(p, 'target-id') || getAttr(p, 'data-target-id') || '').toLowerCase();
      if (targetId.includes('ad') || targetId.includes('sponsor')) continue;
      if (targetId.includes('comment') && document.documentElement.classList.contains('ytlite-comments-hide')) {
        continue;
      }

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
    const isLive = isLiveVideo() ||
      Boolean(document.querySelector('ytd-watch-flexy[live], ytd-watch-flexy[is-live], ytd-watch-grid[live], ytd-watch-grid[is-live], ytd-live-chat-frame:not([collapsed]):not([hidden]):not([hide-chat-frame])'));
    if (isLive) {
      document.documentElement.classList.add('ytlite-live');
      document.documentElement.classList.remove('ytlite-comments-hide');
      disconnectObserver();
    } else {
      document.documentElement.classList.remove('ytlite-live');
    }

    const needSidebar = isSidebarNeeded(isLive);
    if (needSidebar) {
      document.documentElement.classList.add('ytlite-sidebar-active');
      removeExistingButton();
    } else {
      document.documentElement.classList.remove('ytlite-sidebar-active');
      if (isWatchPage()) {
        place();
      }
    }
  }

  function updateLiveClass() {
    updateSidebarState();
  }

  let sidebarUpdateTimers = [];
  function clearSidebarTimers() {
    sidebarUpdateTimers.forEach(clearTimeout);
    sidebarUpdateTimers = [];
  }

  function clearSidebarTimer() {
    clearSidebarTimers();
  }

  function scheduleSidebarUpdate() {
    if (!isWatchPage()) return;
    updateSidebarState();
    clearSidebarTimers();
    [50, 200, 500, 1000, 2500].forEach((delay) => {
      sidebarUpdateTimers.push(setTimeout(() => {
        updateSidebarState();
      }, delay));
    });
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
    const buttons = document.querySelectorAll('.ytlite-button-container');
    buttons.forEach((b) => b.remove());
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

    // One-time micro-scroll kick to wake Chromium IntersectionObserver if already at scroll position
    window.scrollBy({ top: 1, behavior: 'auto' });
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.scrollBy({ top: -1, behavior: 'auto' });
      });
    } else {
      window.scrollBy({ top: -1, behavior: 'auto' });
    }
  }

  function revealComments() {
    document.documentElement.classList.remove('ytlite-comments-hide');
    removeExistingButton();
    disconnectObserver();
    triggerContinuation();
  }

  function openLiveChat() {
    const chat = document.querySelector('ytd-live-chat-frame, #chat');
    if (chat) {
      if (typeof chat.setCollapsedState === 'function') {
        chat.setCollapsedState(false);
      } else if (typeof chat.onShowHideChat === 'function') {
        chat.onShowHideChat();
      }
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

    // Find the best placement target
    const commentsTarget = !isLive ? document.querySelector('#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]') : null;
    const metadataTarget = document.querySelector('ytd-watch-metadata, #below ytd-watch-metadata');
    const panelTarget = !isLive ? document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]') : null;
    const belowTarget = document.getElementById('below');

    // Only place once comments, metadata, engagement panel, or content in #below is available
    const targetEl = commentsTarget || metadataTarget || panelTarget || (belowTarget && belowTarget.children.length > 0 ? belowTarget : null);
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

      if (commentsTarget && commentsTarget.parentElement) {
        commentsTarget.parentElement.insertBefore(container, commentsTarget);
      } else if (metadataTarget && metadataTarget.parentElement) {
        metadataTarget.parentElement.insertBefore(container, metadataTarget.nextSibling);
      } else if (panelTarget && panelTarget.parentElement) {
        panelTarget.parentElement.insertBefore(container, panelTarget);
      } else if (belowTarget) {
        belowTarget.appendChild(container);
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

  function init() {
    updateSidebarState();
    if (!isWatchPage()) {
      clearSidebarTimer();
      disconnectObserver();
      removeExistingButton();
      document.documentElement.classList.remove('ytlite-sidebar-active');
      document.documentElement.classList.remove('ytlite-live');
      return;
    }

    const isLive = isLiveVideo() || document.documentElement.classList.contains('ytlite-live');
    if (isLive && !isLiveChatClosed()) {
      clearSidebarTimer();
      disconnectObserver();
      removeExistingButton();
      return;
    }

    // Catch deferred custom element hydration on direct cold watch page loads
    setTimeout(updateSidebarState, 300);
    setTimeout(updateSidebarState, 1000);
    setTimeout(updateSidebarState, 2500);
    setTimeout(updateSidebarState, 4500);
    setTimeout(updateSidebarState, 6000);

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
    clearSidebarTimer();
    cachedVideoId = null;
    cachedIsLive = false;
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
  }

  function handleNavigateFinish(e) {
    clearSidebarTimer();
    const resp = e?.detail?.response;
    const pr = e?.detail?.playerResponse || resp?.playerResponse;
    const isLiveFromEvent = Boolean(pr?.videoDetails?.isLive || pr?.videoDetails?.isLiveContent);
    const hasChatFromEvent = Boolean(
      resp?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer ||
      (resp && JSON.stringify(resp).includes('liveChatRenderer'))
    );
    const match = location.search && location.search.match(/[?&]v=([^&#]+)/);
    if (match) {
      cachedVideoId = match[1];
      cachedIsLive = isLiveFromEvent || hasChatFromEvent;
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

  function handleDataUpdated() {
    updateSidebarState();
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
