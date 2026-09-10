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

  function isSidebarNeeded() {
    if (!isWatchPage()) return false;

    // 1. Direct /live stream route
    if (location.pathname.startsWith('/live')) return true;

    // 2. Watch container attributes
    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (watchEl) {
      if (hasAttr(watchEl, 'live') || hasAttr(watchEl, 'is-live')) return true;
      if (hasAttr(watchEl, 'panels-expanded')) return true;
    }

    // 3. Active live chat frame
    const chatFrame = document.querySelector('ytd-live-chat-frame, #chat');
    if (chatFrame) {
      const isCollapsed = hasAttr(chatFrame, 'collapsed') ||
        hasAttr(chatFrame, 'hidden') ||
        hasAttr(chatFrame, 'hide-chat-frame');
      if (!isCollapsed) return true;
    }

    // 4. Active chatframe iframe
    const chatIframe = document.getElementById('chatframe');
    if (chatIframe && !chatIframe.hidden) {
      const chatParent = typeof chatIframe.closest === 'function' ? chatIframe.closest('ytd-live-chat-frame, #chat') : null;
      if (!chatParent || (!hasAttr(chatParent, 'collapsed') && !hasAttr(chatParent, 'hidden'))) {
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
    const isLive = location.pathname.startsWith('/live') ||
      Boolean(document.querySelector('ytd-watch-flexy[live], ytd-watch-flexy[is-live], ytd-watch-grid[live], ytd-watch-grid[is-live], ytd-live-chat-frame:not([collapsed]):not([hidden]):not([hide-chat-frame])'));
    if (isLive) {
      document.documentElement.classList.add('ytlite-live');
    } else {
      document.documentElement.classList.remove('ytlite-live');
    }

    const needSidebar = isLive || isSidebarNeeded();
    if (needSidebar) {
      document.documentElement.classList.add('ytlite-sidebar-active');
    } else {
      document.documentElement.classList.remove('ytlite-sidebar-active');
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
    [50, 200, 500, 1000].forEach((delay) => {
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

  let isPlacing = false;

  function place() {
    if (isPlacing) return false;
    if (!isWatchPage()) {
      removeExistingButton();
      disconnectObserver();
      return false;
    }

    if (!document.documentElement.classList.contains('ytlite-comments-hide')) {
      removeExistingButton();
      disconnectObserver();
      return false;
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
    const commentsTarget = document.querySelector('#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]');
    const metadataTarget = document.querySelector('ytd-watch-metadata, #below ytd-watch-metadata');
    const panelTarget = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]');
    const belowTarget = document.getElementById('below');
    const primaryInner = document.getElementById('primary-inner');

    // Only place once comments, metadata, engagement panel, or content in #below is available
    const targetEl = commentsTarget || metadataTarget || panelTarget || (belowTarget && belowTarget.children.length > 0 ? belowTarget : null);
    if (!targetEl || !targetEl.parentElement) return false;

    isPlacing = true;
    try {
      removeExistingButton();

      const container = document.createElement('div');
      container.className = 'ytlite-button-container';

      const commentsBtn = document.createElement('button');
      commentsBtn.type = 'button';
      commentsBtn.className = 'ytlite-comments-btn';
      commentsBtn.textContent = 'Show comments';
      commentsBtn.addEventListener('click', revealComments, { once: true });

      container.appendChild(commentsBtn);

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

    // Catch deferred custom element hydration on direct cold watch page loads
    setTimeout(updateSidebarState, 300);
    setTimeout(updateSidebarState, 1000);

    if (!document.documentElement.classList.contains('ytlite-comments-hide')) {
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

  function handleNavigateFinish() {
    clearSidebarTimer();
    updateSidebarState();
    if (isWatchPage()) {
      document.documentElement.classList.add('ytlite-comments-hide');
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
    if (!isWatchPage() || !document.documentElement.classList.contains('ytlite-comments-hide')) {
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
})();
